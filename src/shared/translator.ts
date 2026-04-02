import type { TranslationResult, TranslatorSettings } from "./types";

export const DEFAULT_TRANSLATOR_SETTINGS: TranslatorSettings = {
  providerBaseUrl: "https://api.deepseek.com/v1",
  providerModel: "deepseek-chat",
  apiKey: "",
  fallbackToGoogle: true,
};

function trimContext(contextText: string): string {
  const compact = contextText.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

function cleanModelOutput(text: string): string {
  return text.trim().replace(/^["'`\s]+|["'`\s]+$/g, "");
}

function readLlmError(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const error = "error" in payload ? (payload as { error?: unknown }).error : payload;

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }

  return "";
}

function shouldFallbackToGoogle(status: number, message: string): boolean {
  const normalized = message.toLowerCase();

  return (
    status === 401 ||
    status === 402 ||
    status === 429 ||
    normalized.includes("quota") ||
    normalized.includes("balance") ||
    normalized.includes("credit") ||
    normalized.includes("insufficient") ||
    normalized.includes("rate limit") ||
    normalized.includes("api key")
  );
}

class TranslatorFallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslatorFallbackError";
  }
}

function firstString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseGoogleTranslateResponse(payload: unknown): string {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
    return "";
  }

  const segments = payload[0]
    .map((segment) => (Array.isArray(segment) ? firstString(segment[0]) : ""))
    .filter(Boolean);

  return segments.join("").trim();
}

export async function translateWithLlm({
  surface,
  contextText,
  settings,
}: {
  surface: string;
  contextText: string;
  settings: TranslatorSettings;
}): Promise<TranslationResult> {
  if (!settings.apiKey.trim()) {
    throw new TranslatorFallbackError("Missing LLM API key.");
  }

  const endpoint = `${settings.providerBaseUrl.replace(/\/+$/, "")}/chat/completions`;
  const sentence = trimContext(contextText || surface);
  const body = {
    model: settings.providerModel,
    temperature: 0,
    max_tokens: 24,
    messages: [
      {
        role: "system",
        content:
          "Translate the target English word into concise Chinese based on the sentence context. Return only the Chinese translation, no explanation.",
      },
      {
        role: "user",
        content: `word: ${surface}\nsentence: ${sentence}`,
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    const message = readLlmError(payload);

    if (shouldFallbackToGoogle(response.status, message)) {
      throw new TranslatorFallbackError(message || `LLM request failed: ${response.status}`);
    }

    throw new Error(message || `LLM request failed: ${response.status}`);
  }

  const content = cleanModelOutput(payload?.choices?.[0]?.message?.content ?? "");

  if (!content) {
    throw new TranslatorFallbackError("LLM translation response was empty.");
  }

  return {
    translation: content,
    provider: "deepseek-chat",
    cached: false,
  };
}

export async function translateWithGoogle({
  lemma,
  surface,
}: {
  lemma: string;
  surface: string;
}): Promise<TranslationResult> {
  const query = encodeURIComponent(surface || lemma);
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${query}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Translation request failed: ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  const translation = parseGoogleTranslateResponse(payload);

  if (!translation) {
    throw new Error("Translation response was empty.");
  }

  return {
    translation,
    provider: "google-web",
    cached: false,
  };
}

export function sanitizeTranslatorSettings(
  input?: Partial<TranslatorSettings> | null,
): TranslatorSettings {
  return {
    providerBaseUrl: input?.providerBaseUrl?.trim() || DEFAULT_TRANSLATOR_SETTINGS.providerBaseUrl,
    providerModel: input?.providerModel?.trim() || DEFAULT_TRANSLATOR_SETTINGS.providerModel,
    apiKey: input?.apiKey?.trim() ?? "",
    fallbackToGoogle: input?.fallbackToGoogle ?? true,
  };
}

export function isTranslatorFallbackError(error: unknown): boolean {
  return error instanceof TranslatorFallbackError;
}
