
import type { LlmProviderKind } from "../types";

export type LlmTaskKind =
  | "contextual-word"
  | "contextual-word-sentence"
  | "contextual-word-english"
  | "selection-translation"
  | "english-explanation"
  | "sentence-analysis";

export type LlmTaskReasoning = "off" | "low" | "high" | "max";
export type StructuredOutputMode = "json-schema" | "json-object" | "prompt-json";

export interface LlmTaskContract {
  kind: LlmTaskKind;
  schemaName: string;
  schema: Record<string, unknown>;
  example: Record<string, unknown>;
  reasoning: LlmTaskReasoning;
  validate(value: unknown): boolean;
}

export interface LlmConnection {
  provider: LlmProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface LlmExecutionPolicy {
  maxTokens: number;
  timeoutMs: number;
  reasoning: LlmTaskReasoning;
}

export interface LlmProviderTaskRequest {
  connection: LlmConnection;
  task: LlmTaskKind;
  systemPrompt: string;
  userPrompt: string;
  policy: LlmExecutionPolicy;
}

export interface LlmProviderTaskResponse {
  content: string;
  finishReason: string;
  payload: unknown;
  response: Response;
  structuredOutputMode?: StructuredOutputMode;
}

export interface OpenAiCompatibleConnection {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface OpenAiCompatibleTaskRequest {
  connection: OpenAiCompatibleConnection;
  task: LlmTaskKind;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface OpenAiCompatibleTaskResponse extends LlmProviderTaskResponse {
  structuredOutputMode: StructuredOutputMode;
}

export class LlmProviderRequestError extends Error {
  status?: number;
  capabilityRelated: boolean;
  retryable: boolean;

  constructor(message: string, options?: { status?: number; capabilityRelated?: boolean; retryable?: boolean }) {
    super(message);
    this.name = "LlmProviderRequestError";
    this.status = options?.status;
    this.capabilityRelated = options?.capabilityRelated ?? false;
    this.retryable = options?.retryable ?? false;
  }
}

export class LlmProviderFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmProviderFormatError";
  }
}
