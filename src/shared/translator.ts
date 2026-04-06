import type {
  SentenceAnalysisResult,
  SentenceHighlight,
  SentenceHighlightCategory,
  TranslationResult,
  TranslatorSettings,
} from "./types";

export const DEFAULT_TRANSLATOR_SETTINGS: TranslatorSettings = {
  providerBaseUrl: "https://api.deepseek.com/v1",
  providerModel: "deepseek-chat",
  apiKey: "",
  fallbackToGoogle: true,
  llmDisplayMode: "word",
};

function trimContext(contextText: string): string {
  const compact = contextText.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

function cleanModelOutput(text: string): string {
  return text.trim().replace(/^["'`\s]+|["'`\s]+$/g, "");
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
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

export function parseLlmTranslationResponse(payload: string): {
  translation: string;
  sentenceTranslation?: string;
} {
  const content = stripCodeFence(payload);
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");

  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as {
        word?: unknown;
        sentence?: unknown;
      };
      const translation = cleanModelOutput(typeof parsed.word === "string" ? parsed.word : "");
      const sentenceTranslation = cleanModelOutput(
        typeof parsed.sentence === "string" ? parsed.sentence : "",
      );

      if (translation) {
        return {
          translation,
          sentenceTranslation: sentenceTranslation || undefined,
        };
      }
    } catch {
      // Fall back to plain-text parsing below.
    }
  }

  return {
    translation: cleanModelOutput(content),
  };
}

const HIGHLIGHT_CATEGORIES = new Set<SentenceHighlightCategory>([
  "subject",
  "predicate",
  "nonfinite",
  "conjunction",
  "relative",
  "preposition",
]);

function sanitizeAnalysisHighlights(input: unknown): SentenceHighlight[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const text = cleanModelOutput(
        typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "",
      );
      const category =
        typeof (item as { category?: unknown }).category === "string"
          ? ((item as { category: string }).category as SentenceHighlightCategory)
          : null;

      if (!text || !category || !HIGHLIGHT_CATEGORIES.has(category)) {
        return null;
      }

      return { text, category };
    })
    .filter((item): item is SentenceHighlight => Boolean(item));
}

export function parseSentenceAnalysisResponse(payload: string): Omit<
  SentenceAnalysisResult,
  "provider" | "cached"
> {
  const content = stripCodeFence(payload);
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");

  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new Error("Sentence analysis response was not valid JSON.");
  }

  const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as {
    translation?: unknown;
    structure?: unknown;
    analysisSteps?: unknown;
    highlights?: unknown;
  };

  const translation = cleanModelOutput(
    typeof parsed.translation === "string" ? parsed.translation : "",
  );
  const structure = cleanModelOutput(typeof parsed.structure === "string" ? parsed.structure : "");
  const analysisSteps = Array.isArray(parsed.analysisSteps)
    ? parsed.analysisSteps
        .map((step) => cleanModelOutput(typeof step === "string" ? step : ""))
        .filter(Boolean)
    : [];
  const highlights = sanitizeAnalysisHighlights(parsed.highlights);

  if (!translation || !structure || !analysisSteps.length) {
    throw new Error("Sentence analysis response was incomplete.");
  }

  return {
    translation,
    structure,
    analysisSteps,
    highlights,
  };
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
  const needsSentence = settings.llmDisplayMode === "sentence";
  const body = {
    model: settings.providerModel,
    temperature: 0,
    max_tokens: needsSentence ? 96 : 40,
    messages: [
      {
        role: "system",
        content: needsSentence
          ? 'Translate the target English word or short phrase based on the sentence context. Return strict JSON only: {"word":"<concise Chinese meaning of the word or phrase>","sentence":"<full Chinese translation of the sentence>"}. No markdown, no explanation.'
          : 'Translate the target English word or short phrase into concise Chinese based on the sentence context. Return strict JSON only: {"word":"<concise Chinese meaning>"}',
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

  const content = payload?.choices?.[0]?.message?.content ?? "";
  const parsed = parseLlmTranslationResponse(content);

  if (!parsed.translation) {
    throw new TranslatorFallbackError("LLM translation response was empty.");
  }

  return {
    translation: parsed.translation,
    sentenceTranslation: parsed.sentenceTranslation,
    provider: "deepseek-chat",
    cached: false,
  };
}

export async function analyzeSentenceWithLlm({
  text,
  settings,
}: {
  text: string;
  settings: TranslatorSettings;
}): Promise<SentenceAnalysisResult> {
  if (!settings.apiKey.trim()) {
    throw new Error("请先在设置页填写 LLM API Key。");
  }

  const endpoint = `${settings.providerBaseUrl.replace(/\/+$/, "")}/chat/completions`;
  const sentence = trimContext(text);
  const body = {
    model: settings.providerModel,
    temperature: 0.2,
    max_tokens: 420,
    messages: [
      {
        role: "system",
        content:
          'You are an English sentence analysis tutor for Chinese students. Use a Tian Jing style exam-prep method: 1) first use conjunctions, relative words, and punctuation to cut the sentence into layers; 2) then locate the main clause subject and predicate and state the sentence backbone; 3) then explain nonfinite verbs, prepositional phrases, appositives, and subordinate clauses as branches attached to the backbone; 4) finally give a smooth Chinese translation in natural order. The explanation should feel like a teacher walking through a sentence, practical and clear, not vague and not too academic. Return strict JSON only with keys: translation, structure, analysisSteps, highlights. translation is full Chinese translation. structure is one short Chinese summary of the sentence backbone. analysisSteps is an array of exactly 4 Chinese steps, and the four steps should roughly correspond to 切层次 / 抓主干 / 拆枝叶 / 顺译. highlights is an array of exact single-word tokens copied from the original sentence with category from [subject, predicate, nonfinite, conjunction, relative, preposition]. You must include at least one predicate highlight whenever possible. Prefer the most important words only. No markdown or extra text.',
      },
      {
        role: "user",
        content: `sentence: ${sentence}`,
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
    throw new Error(message || `LLM analysis request failed: ${response.status}`);
  }

  const content = payload?.choices?.[0]?.message?.content ?? "";
  const parsed = parseSentenceAnalysisResponse(content);

  return {
    ...parsed,
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
    llmDisplayMode: input?.llmDisplayMode === "sentence" ? "sentence" : "word",
  };
}

export function isTranslatorFallbackError(error: unknown): boolean {
  return error instanceof TranslatorFallbackError;
}
