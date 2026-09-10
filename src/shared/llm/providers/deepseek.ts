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
  return value === "off" ? "none" : value;
}

export async function requestDeepSeekTask(
  request: LlmProviderTaskRequest,
): Promise<LlmProviderTaskResponse> {
  const contract = getLlmTaskContract(request.task);
  const { response, payload } = await fetchProviderPayload(
    `${normalizeBaseUrl(request.connection.baseUrl)}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.connection.apiKey}`,
      },
      body: JSON.stringify({
        model: request.connection.model,
        // DeepSeek's Responses `instructions` field is ignored in thinking mode.
        // Put system rules in the input timeline so sentence-analysis reasoning
        // sees the same task contract as non-thinking requests.
        input: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
        stream: false,
        max_output_tokens: request.policy.maxTokens,
        reasoning: { effort: reasoningEffort(request.policy.reasoning) },
        text: {
          format: {
            type: "json_schema",
            name: contract.schemaName,
            schema: contract.schema,
          },
        },
      }),
    },
    request.policy.timeoutMs,
  );
  const finishReason = assertCompletedResponsesApiPayload(payload);
  const content = validateStructuredContent(readResponsesApiText(payload), request.task);
  return { content, finishReason, payload, response, structuredOutputMode: "json-schema" };
}
