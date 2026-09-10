export type LlmTaskKind =
  | "contextual-word"
  | "contextual-word-sentence"
  | "contextual-word-english"
  | "selection-translation"
  | "english-explanation"
  | "sentence-analysis";

export type LlmTaskReasoning = "off" | "low" | "high" | "max";
export type OpenAiCompatibilityPreset = "openai" | "deepseek" | "custom";
export type StructuredOutputMode = "json-schema" | "json-object" | "prompt-json";

export interface LlmTaskContract {
  kind: LlmTaskKind;
  schemaName: string;
  schema: Record<string, unknown>;
  example: Record<string, unknown>;
  reasoning: LlmTaskReasoning;
  validate(value: unknown): boolean;
}

export interface OpenAiCompatibleConnection {
  baseUrl: string;
  model: string;
  apiKey: string;
  preset: OpenAiCompatibilityPreset;
}

export interface OpenAiCompatibleTaskRequest {
  connection: OpenAiCompatibleConnection;
  task: LlmTaskKind;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  timeoutMs: number;
  reasoning?: LlmTaskReasoning;
}

export interface OpenAiCompatibleTaskResponse {
  content: string;
  finishReason: string;
  payload: unknown;
  response: Response;
  structuredOutputMode: StructuredOutputMode;
}

export class LlmProviderRequestError extends Error {
  status?: number;
  capabilityRelated: boolean;

  constructor(message: string, options?: { status?: number; capabilityRelated?: boolean }) {
    super(message);
    this.name = "LlmProviderRequestError";
    this.status = options?.status;
    this.capabilityRelated = options?.capabilityRelated ?? false;
  }
}

export class LlmProviderFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmProviderFormatError";
  }
}
