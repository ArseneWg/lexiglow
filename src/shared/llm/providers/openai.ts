
import { getLlmTaskContract } from "../taskContracts";
import type { LlmProviderTaskRequest, LlmProviderTaskResponse } from "../contracts";
import {
  assertCompletedResponsesApiPayload,
  fetchProviderPayload,
  normalizeBaseUrl,
  readResponsesApiText,
  validateStructuredContent,
} from "../providerUtils";

function reasoningEffort(value: LlmProviderTaskRequest["policy"]["reasoning"]): string {
  if (value === "off") return "none";
  return value;
}

export async function requestOpenAiTask(
  request: LlmProviderTaskRequest,
): Promise<LlmProviderTaskResponse> {
  const contract = getLlmTaskContract(request.task);
  const body: Record<string, unknown> = {
    model: request.connection.model,
    instructions: request.systemPrompt,
    input: request.userPrompt,
    stream: false,
    store: false,
    max_output_tokens: request.policy.maxTokens,
    reasoning: { effort: reasoningEffort(request.policy.reasoning) },
    text: {
      format: {
        type: "json_schema",
        name: contract.schemaName,
        strict: true,
        schema: contract.schema,
      },
    },
  };
  const { response, payload } = await fetchProviderPayload(
    `${normalizeBaseUrl(request.connection.baseUrl)}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.connection.apiKey}`,
      },
      body: JSON.stringify(body),
    },
    request.policy.timeoutMs,
  );
  const finishReason = assertCompletedResponsesApiPayload(payload);
  const content = validateStructuredContent(readResponsesApiText(payload), request.task);
  return { content, finishReason, payload, response, structuredOutputMode: "json-schema" };
}
