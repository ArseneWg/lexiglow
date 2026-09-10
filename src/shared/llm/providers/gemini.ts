
import { getLlmTaskContract } from "../taskContracts";
import {
  LlmProviderFormatError,
  type LlmProviderTaskRequest,
  type LlmProviderTaskResponse,
} from "../contracts";
import { fetchProviderPayload, normalizeBaseUrl, validateStructuredContent } from "../providerUtils";

function readGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const steps = (payload as Record<string, unknown>).steps;
  if (!Array.isArray(steps)) return "";
  const parts: string[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const record = step as Record<string, unknown>;
    if (record.type !== "model_output" || !Array.isArray(record.content)) continue;
    for (const part of record.content) {
      if (!part || typeof part !== "object") continue;
      const item = part as Record<string, unknown>;
      if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
    }
  }
  return parts.join("").trim();
}

function thinkingLevel(value: LlmProviderTaskRequest["policy"]["reasoning"]): string {
  if (value === "high" || value === "max") return "high";
  return "low";
}

export async function requestGeminiTask(
  request: LlmProviderTaskRequest,
): Promise<LlmProviderTaskResponse> {
  const contract = getLlmTaskContract(request.task);
  const { response, payload } = await fetchProviderPayload(
    `${normalizeBaseUrl(request.connection.baseUrl)}/interactions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": request.connection.apiKey,
      },
      body: JSON.stringify({
        model: request.connection.model,
        input: request.userPrompt,
        system_instruction: request.systemPrompt,
        store: false,
        generation_config: {
          max_output_tokens: request.policy.maxTokens,
          thinking_level: thinkingLevel(request.policy.reasoning),
          thinking_summaries: "none",
        },
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: contract.schema,
        },
      }),
    },
    request.policy.timeoutMs,
  );
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const status = typeof record.status === "string" ? record.status : "";
  if (status && status !== "completed") {
    throw new LlmProviderFormatError(`Gemini interaction did not complete: ${status}`);
  }
  const content = validateStructuredContent(readGeminiText(payload), request.task);
  return { content, finishReason: status, payload, response, structuredOutputMode: "json-schema" };
}
