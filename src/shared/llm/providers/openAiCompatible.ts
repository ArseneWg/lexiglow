
import type { LlmProviderTaskRequest, LlmProviderTaskResponse } from "../contracts";
import { requestOpenAiCompatibleTask } from "../openAiCompatible";

export async function requestOpenAiCompatibleProviderTask(
  request: LlmProviderTaskRequest,
): Promise<LlmProviderTaskResponse> {
  return requestOpenAiCompatibleTask({
    connection: {
      baseUrl: request.connection.baseUrl,
      model: request.connection.model,
      apiKey: request.connection.apiKey,
    },
    task: request.task,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    maxTokens: request.policy.maxTokens,
    timeoutMs: request.policy.timeoutMs,
  });
}
