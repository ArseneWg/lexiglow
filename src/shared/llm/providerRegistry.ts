
import type { LlmConnection } from "./contracts";
import type { LlmProviderKind, TranslatorSettings } from "../types";

export interface LlmProviderDefinition {
  kind: LlmProviderKind;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  nativeApi: "responses" | "messages" | "interactions" | "chat-completions";
  structuredOutput: "json-schema" | "negotiated";
  customBaseUrl: boolean;
  requiresApiKey: boolean;
}

export const LLM_PROVIDER_OPTIONS: readonly LlmProviderDefinition[] = [
  {
    kind: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.6-luna",
    nativeApi: "responses",
    structuredOutput: "json-schema",
    customBaseUrl: false,
    requiresApiKey: true,
  },
  {
    kind: "deepseek",
    label: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    nativeApi: "responses",
    structuredOutput: "json-schema",
    customBaseUrl: false,
    requiresApiKey: true,
  },
  {
    kind: "gemini",
    label: "Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-3.8-flash",
    nativeApi: "interactions",
    structuredOutput: "json-schema",
    customBaseUrl: false,
    requiresApiKey: true,
  },
  {
    kind: "anthropic",
    label: "Claude (Anthropic)",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5",
    nativeApi: "messages",
    structuredOutput: "json-schema",
    customBaseUrl: false,
    requiresApiKey: true,
  },
  {
    kind: "openai-compatible",
    label: "OpenAI-compatible (Custom)",
    defaultBaseUrl: "http://localhost:8000/v1",
    defaultModel: "local-model",
    nativeApi: "chat-completions",
    structuredOutput: "negotiated",
    customBaseUrl: true,
    requiresApiKey: false,
  },
] as const;

const PROVIDERS = new Map(LLM_PROVIDER_OPTIONS.map((item) => [item.kind, item]));

export function isLlmProviderKind(value: unknown): value is LlmProviderKind {
  return typeof value === "string" && PROVIDERS.has(value as LlmProviderKind);
}

export function getLlmProviderDefinition(provider: LlmProviderKind): LlmProviderDefinition {
  return PROVIDERS.get(provider) ?? LLM_PROVIDER_OPTIONS[0];
}

export function getDefaultLlmBaseUrl(provider: LlmProviderKind): string {
  return getLlmProviderDefinition(provider).defaultBaseUrl;
}

export function getDefaultLlmModel(provider: LlmProviderKind): string {
  return getLlmProviderDefinition(provider).defaultModel;
}

function hostname(value: string | undefined): string {
  try {
    return new URL(value ?? "").hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function resolveStoredLlmProvider(
  rawProvider: unknown,
  baseUrl?: string,
): LlmProviderKind {
  if (rawProvider === "claude") return "anthropic";

  // Legacy releases stored OpenAI, DeepSeek and arbitrary compatible gateways
  // under llmProvider="openai". URL inspection exists only here, at the storage
  // migration boundary; runtime routing never guesses a provider from a URL.
  if (rawProvider === "openai" || rawProvider === undefined || rawProvider === null) {
    const host = hostname(baseUrl);
    if (host === "api.deepseek.com" || host.endsWith(".deepseek.com")) return "deepseek";
    if (!host || host === "api.openai.com" || host.endsWith(".openai.com")) return "openai";
    return "openai-compatible";
  }

  if (isLlmProviderKind(rawProvider)) return rawProvider;
  return "openai";
}

export function connectionFromSettings(
  settings: Pick<TranslatorSettings, "llmProvider" | "providerBaseUrl" | "providerModel" | "apiKey">,
): LlmConnection {
  return {
    provider: settings.llmProvider,
    baseUrl: settings.providerBaseUrl.trim().replace(/\/+$/, ""),
    model: settings.providerModel.trim(),
    apiKey: settings.apiKey.trim(),
  };
}
