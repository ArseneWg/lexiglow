
import { getLlmTaskContract } from "../taskContracts";
import {
  LlmProviderFormatError,
  type LlmProviderTaskRequest,
  type LlmProviderTaskResponse,
} from "../contracts";
import { fetchProviderPayload, normalizeBaseUrl, validateStructuredContent } from "../providerUtils";

function readClaudeText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const content = (payload as Record<string, unknown>).content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const record = part as Record<string, unknown>;
    return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
  }).join("").trim();
}

function effort(value: LlmProviderTaskRequest["policy"]["reasoning"]): string {
  return value === "off" ? "low" : value;
}

export async function requestAnthropicTask(
  request: LlmProviderTaskRequest,
): Promise<LlmProviderTaskResponse> {
  const contract = getLlmTaskContract(request.task);
  const outputConfig: Record<string, unknown> = {
    effort: effort(request.policy.reasoning),
    format: { type: "json_schema", schema: contract.schema },
  };
  const body: Record<string, unknown> = {
    model: request.connection.model,
    max_tokens: request.policy.maxTokens,
    system: request.systemPrompt,
    messages: [{ role: "user", content: request.userPrompt }],
    output_config: outputConfig,
    thinking: request.policy.reasoning === "off"
      ? { type: "disabled" }
      : { type: "adaptive" },
  };
  const { response, payload } = await fetchProviderPayload(
    `${normalizeBaseUrl(request.connection.baseUrl)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": request.connection.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    },
    request.policy.timeoutMs,
  );
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const finishReason = typeof record.stop_reason === "string" ? record.stop_reason : "";
  if (finishReason === "max_tokens") {
    throw new LlmProviderFormatError("LLM response was truncated by the output-token limit.");
  }
  const content = validateStructuredContent(readClaudeText(payload), request.task);
  return { content, finishReason, payload, response, structuredOutputMode: "json-schema" };
}
