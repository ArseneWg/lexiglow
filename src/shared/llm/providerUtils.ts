
import { getLlmTaskContract } from "./taskContracts";
import {
  LlmProviderFormatError,
  LlmProviderRequestError,
  type LlmTaskKind,
} from "./contracts";

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function readProviderErrorMessage(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return typeof record.message === "string" ? record.message : "";
}

async function readPayload(response: Response): Promise<unknown> {
  const raw = await response.text().catch(() => "");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

export async function fetchProviderPayload(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; payload: unknown }> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new LlmProviderRequestError("LLM request timed out.", { retryable: true });
    }
    throw new LlmProviderRequestError(
      error instanceof Error ? error.message : "LLM network request failed.",
      { retryable: true },
    );
  } finally {
    globalThis.clearTimeout(timer);
  }

  const payload = await readPayload(response);
  if (!response.ok) {
    const message = readProviderErrorMessage(payload) || `LLM request failed: ${response.status}`;
    throw new LlmProviderRequestError(message, {
      status: response.status,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    });
  }
  return { response, payload };
}

export function validateStructuredContent(content: string, task: LlmTaskKind): string {
  const trimmed = content.trim();
  if (!trimmed) throw new LlmProviderFormatError("LLM response content was empty.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new LlmProviderFormatError("LLM response was not valid JSON.");
  }
  if (!getLlmTaskContract(task).validate(parsed)) {
    throw new LlmProviderFormatError("LLM response did not satisfy the task contract.");
  }
  return JSON.stringify(parsed);
}

export function readResponsesApiText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text.trim();
  if (!Array.isArray(record.output)) return "";
  const parts: string[] = [];
  for (const item of record.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      if (p.type === "output_text" && typeof p.text === "string") parts.push(p.text);
    }
  }
  return parts.join("").trim();
}

export function assertCompletedResponsesApiPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status : "";
  if (status === "failed") {
    throw new LlmProviderRequestError(readProviderErrorMessage(record) || "LLM response failed.");
  }
  if (status === "incomplete") {
    const details = record.incomplete_details;
    const reason = details && typeof details === "object"
      ? (details as Record<string, unknown>).reason
      : undefined;
    throw new LlmProviderFormatError(
      `LLM response was incomplete${typeof reason === "string" ? `: ${reason}` : "."}`,
    );
  }
  return status;
}
