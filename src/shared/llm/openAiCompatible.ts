import type { TranslatorSettings } from "../types";
import {
  LlmProviderFormatError,
  LlmProviderRequestError,
  type OpenAiCompatibleConnection,
  type OpenAiCompatibleTaskRequest,
  type OpenAiCompatibleTaskResponse,
  type OpenAiCompatibilityPreset,
  type StructuredOutputMode,
} from "./contracts";
import { getLlmTaskContract } from "./taskContracts";

const ALL_MODES: StructuredOutputMode[] = ["json-schema", "json-object", "prompt-json"];
const structuredModeCache = new Map<string, StructuredOutputMode>();

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function resolveOpenAiCompatibilityPreset(baseUrl: string): OpenAiCompatibilityPreset {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname === "api.deepseek.com" || hostname.endsWith(".deepseek.com")) return "deepseek";
    if (hostname === "api.openai.com" || hostname.endsWith(".openai.com")) return "openai";
  } catch {
    // Custom or invalid URLs are handled by the generic compatibility path.
  }
  return "custom";
}

export function legacyOpenAiConnectionFromSettings(
  settings: Pick<TranslatorSettings, "providerBaseUrl" | "providerModel" | "apiKey">,
): OpenAiCompatibleConnection {
  const baseUrl = normalizeBaseUrl(settings.providerBaseUrl);
  return {
    baseUrl,
    model: settings.providerModel.trim(),
    apiKey: settings.apiKey.trim(),
    preset: resolveOpenAiCompatibilityPreset(baseUrl),
  };
}

function endpointFor(connection: OpenAiCompatibleConnection): string {
  return `${normalizeBaseUrl(connection.baseUrl)}/chat/completions`;
}

function modeCacheKey(connection: OpenAiCompatibleConnection): string {
  return `${normalizeBaseUrl(connection.baseUrl)}::${connection.model}`;
}

function candidateModes(connection: OpenAiCompatibleConnection): StructuredOutputMode[] {
  if (connection.preset === "openai") return ["json-schema"];
  if (connection.preset === "deepseek") return ["json-object"];

  const cached = structuredModeCache.get(modeCacheKey(connection));
  return cached
    ? [cached, ...ALL_MODES.filter((mode) => mode !== cached)]
    : [...ALL_MODES];
}

function readErrorMessage(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (!payload || typeof payload !== "object") return "";
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  const message = (payload as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function isCapabilityError(status: number, message: string): boolean {
  if (![400, 404, 422].includes(status)) return false;
  const value = message.toLowerCase();
  return [
    "response_format",
    "json_schema",
    "json schema",
    "unsupported",
    "unknown parameter",
    "unrecognized",
    "not support",
  ].some((needle) => value.includes(needle));
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const responseLike = response as Response & {
    clone?: () => Response;
    text?: () => Promise<string>;
    json?: () => Promise<unknown>;
  };

  if (typeof responseLike.text === "function") {
    const readable = typeof responseLike.clone === "function"
      ? responseLike.clone()
      : responseLike;
    const rawBody = await readable.text().catch(() => "");
    const value = rawBody.trim();
    if (!value) return null;

    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  if (typeof responseLike.json === "function") {
    return responseLike.json().catch(() => null);
  }

  return null;
}

function readContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";

  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";

  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const text = (part as { text?: unknown }).text;
    return typeof text === "string" ? [text] : [];
  }).join("").trim();
}

function readFinishReason(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const reason = (choices[0] as { finish_reason?: unknown }).finish_reason;
  return typeof reason === "string" ? reason : "";
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function parseAndValidate(
  content: string,
  mode: StructuredOutputMode,
  task: OpenAiCompatibleTaskRequest["task"],
): string {
  if (!content) throw new LlmProviderFormatError("LLM response content was empty.");
  const candidate = mode === "prompt-json" ? stripCodeFence(content) : content.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new LlmProviderFormatError("LLM response was not valid JSON.");
  }

  if (!getLlmTaskContract(task).validate(parsed)) {
    throw new LlmProviderFormatError("LLM response did not satisfy the task contract.");
  }
  return JSON.stringify(parsed);
}

function buildBody(
  request: OpenAiCompatibleTaskRequest,
  mode: StructuredOutputMode,
): Record<string, unknown> {
  const contract = getLlmTaskContract(request.task);
  const systemPrompt = mode === "json-schema"
    ? request.systemPrompt
    : `${request.systemPrompt}\nReturn valid JSON only. JSON example: ${JSON.stringify(contract.example)}`;

  const body: Record<string, unknown> = {
    model: request.connection.model,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: request.userPrompt },
    ],
  };

  if (request.connection.preset === "openai") {
    body.max_completion_tokens = request.maxTokens;
  } else {
    body.max_tokens = request.maxTokens;
  }

  if (mode === "json-schema") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: contract.schemaName,
        strict: true,
        schema: contract.schema,
      },
    };
  } else if (mode === "json-object") {
    body.response_format = { type: "json_object" };
  }

  if (request.connection.preset === "deepseek") {
    if (contract.reasoning === "off") {
      body.thinking = { type: "disabled" };
    } else {
      body.thinking = { type: "enabled" };
      body.reasoning_effort = contract.reasoning === "high" ? "high" : "low";
    }
  }

  return body;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new LlmProviderRequestError("LLM request timed out.");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function requestMode(
  request: OpenAiCompatibleTaskRequest,
  mode: StructuredOutputMode,
): Promise<OpenAiCompatibleTaskResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (request.connection.apiKey) {
    headers.Authorization = `Bearer ${request.connection.apiKey}`;
  }

  const response = await fetchWithTimeout(endpointFor(request.connection), {
    method: "POST",
    headers,
    body: JSON.stringify(buildBody(request, mode)),
  }, request.timeoutMs);
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    const message = readErrorMessage(payload) || `LLM request failed: ${response.status}`;
    throw new LlmProviderRequestError(message, {
      status: response.status,
      capabilityRelated: isCapabilityError(response.status, message),
    });
  }

  const finishReason = readFinishReason(payload);
  if (/^(length|max_tokens|max_output_tokens)$/i.test(finishReason)) {
    throw new LlmProviderFormatError("LLM response was truncated by the output-token limit.");
  }

  const content = parseAndValidate(readContent(payload), mode, request.task);
  return { content, finishReason, payload, response, structuredOutputMode: mode };
}

export async function requestOpenAiCompatibleTask(
  request: OpenAiCompatibleTaskRequest,
): Promise<OpenAiCompatibleTaskResponse> {
  let lastCapabilityError: LlmProviderRequestError | null = null;

  for (const mode of candidateModes(request.connection)) {
    try {
      const result = await requestMode(request, mode);
      if (request.connection.preset === "custom") {
        structuredModeCache.set(modeCacheKey(request.connection), mode);
      }
      return result;
    } catch (error) {
      if (
        request.connection.preset === "custom"
        && error instanceof LlmProviderRequestError
        && error.capabilityRelated
      ) {
        lastCapabilityError = error;
        structuredModeCache.delete(modeCacheKey(request.connection));
        continue;
      }
      throw error;
    }
  }

  throw lastCapabilityError
    ?? new LlmProviderRequestError("No compatible structured output mode was accepted.");
}

export function resetOpenAiCompatibilityCacheForTests(): void {
  structuredModeCache.clear();
}
