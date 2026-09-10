
import type { TranslatorSettings } from "../types";
import {
  LlmProviderFormatError,
  LlmProviderRequestError,
  type LlmExecutionPolicy,
  type LlmProviderTaskResponse,
  type LlmTaskKind,
} from "./contracts";
import { connectionFromSettings, getLlmProviderDefinition } from "./providerRegistry";
import { requestAnthropicTask } from "./providers/anthropic";
import { requestDeepSeekTask } from "./providers/deepseek";
import { requestGeminiTask } from "./providers/gemini";
import { requestOpenAiTask } from "./providers/openai";
import { requestOpenAiCompatibleProviderTask } from "./providers/openAiCompatible";

const WORD_TIMEOUT_MS = 8000;
const SELECTION_TIMEOUT_MS = 10000;
const LONG_SELECTION_TIMEOUT_MS = 18000;
const SENTENCE_TIMEOUT_MS = 30000;
const COMPLEX_SENTENCE_TIMEOUT_MS = 45000;
const RETRY_SENTENCE_TIMEOUT_MS = 60000;

function selectionMaxTokens(text: string): number {
  const words = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)?.length ?? 0;
  return Math.min(1600, Math.max(180, Math.ceil(text.length * 0.9), words * 4 + 96));
}

function selectionTimeoutMs(text: string): number {
  if (text.length > 500) return LONG_SELECTION_TIMEOUT_MS;
  if (text.length > 220) return 14000;
  return SELECTION_TIMEOUT_MS;
}

function sentenceIsComplex(sentence: string): boolean {
  const words = sentence.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)?.length ?? 0;
  const clauseMarkers = sentence.match(/\b(?:although|though|whereas|while|because|since|if|unless|when|whenever|which|who|whom|whose|where|whether|and|but|yet)\b/gi)?.length ?? 0;
  const punctuation = sentence.match(/[,;:—()]/g)?.length ?? 0;
  return words >= 24
    || sentence.length >= 180
    || clauseMarkers >= 3
    || (words >= 16 && punctuation >= 2);
}

export function resolveLlmExecutionPolicy(
  task: LlmTaskKind,
  sourceText = "",
  qualityRetry = false,
): LlmExecutionPolicy {
  if (task === "sentence-analysis") {
    const complex = sentenceIsComplex(sourceText);
    if (qualityRetry) {
      return {
        reasoning: "high",
        maxTokens: complex ? 8000 : 6000,
        timeoutMs: RETRY_SENTENCE_TIMEOUT_MS,
      };
    }
    return {
      reasoning: complex ? "high" : "low",
      maxTokens: complex ? 6000 : 3200,
      timeoutMs: complex ? COMPLEX_SENTENCE_TIMEOUT_MS : SENTENCE_TIMEOUT_MS,
    };
  }

  if (task === "selection-translation") {
    return {
      reasoning: "off",
      maxTokens: selectionMaxTokens(sourceText),
      timeoutMs: selectionTimeoutMs(sourceText),
    };
  }

  const maxTokens = task === "contextual-word-english"
    ? 240
    : task === "contextual-word-sentence"
      ? 220
      : task === "english-explanation"
        ? 140
        : 180;
  return { reasoning: "off", maxTokens, timeoutMs: WORD_TIMEOUT_MS };
}

export async function executeLlmTask({
  settings,
  task,
  systemPrompt,
  userPrompt,
  sourceText = "",
  qualityRetry = false,
}: {
  settings: TranslatorSettings;
  task: LlmTaskKind;
  systemPrompt: string;
  userPrompt: string;
  sourceText?: string;
  qualityRetry?: boolean;
}): Promise<LlmProviderTaskResponse> {
  const connection = connectionFromSettings(settings);
  const request = {
    connection,
    task,
    systemPrompt,
    userPrompt,
    policy: resolveLlmExecutionPolicy(task, sourceText, qualityRetry),
  };

  switch (connection.provider) {
    case "openai":
      return requestOpenAiTask(request);
    case "deepseek":
      return requestDeepSeekTask(request);
    case "gemini":
      return requestGeminiTask(request);
    case "anthropic":
      return requestAnthropicTask(request);
    case "openai-compatible":
      return requestOpenAiCompatibleProviderTask(request);
  }
}

export function requiresLlmApiKey(
  settings: Pick<TranslatorSettings, "llmProvider">,
): boolean {
  return getLlmProviderDefinition(settings.llmProvider).requiresApiKey;
}

export function getLlmRequestStatus(error: unknown): number {
  return error instanceof LlmProviderRequestError ? error.status ?? 0 : 0;
}

export function shouldFallbackToGoogleOnLlmError(error: unknown): boolean {
  if (error instanceof LlmProviderFormatError) return true;
  if (!(error instanceof LlmProviderRequestError)) return false;
  return [400, 401, 402, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504].includes(error.status ?? 0)
    || /quota|billing|insufficient|credit|rate limit|api key|unauthorized|forbidden|timeout/i.test(error.message);
}

export function getRuntimeLlmCacheSignature(settings: Pick<
  TranslatorSettings,
  "llmProvider" | "providerBaseUrl" | "providerModel" | "learnerLanguageCode"
>): string {
  return [
    settings.llmProvider,
    settings.providerBaseUrl.trim().replace(/\/+$/, ""),
    settings.providerModel.trim(),
    settings.learnerLanguageCode,
  ].join("::");
}
