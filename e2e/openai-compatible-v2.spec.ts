import { expect, test } from "./fixtures";
import {
  clearExtensionStorage,
  getHighlightTexts,
  mockDictionaryFailures,
  mockGoogleTranslation,
  openAiResponse,
  seedTranslatorSettings,
  seedUserSettings,
  selectElementText,
  serveTestPage,
} from "./helpers";

function responsesApiResponse(content: unknown, options: { status?: string; incompleteReason?: string } = {}) {
  const status = options.status ?? "completed";
  return JSON.stringify({
    status,
    ...(options.incompleteReason ? { incomplete_details: { reason: options.incompleteReason } } : {}),
    output: [
      {
        type: "message",
        status,
        content: [
          {
            type: "output_text",
            text: typeof content === "string" ? content : JSON.stringify(content),
          },
        ],
      },
    ],
  });
}

async function translateWordThroughRuntime(context: any, extensionId: string, surface: string, contextText: string) {
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/dist/options.html`);
  try {
    return await extensionPage.evaluate(async ({ word, sentence }) => chrome.runtime.sendMessage({
      type: "TRANSLATE_WORD",
      payload: { surface: word, contextText: sentence, provider: "llm", forceTranslate: true },
    }), { word: surface, sentence: contextText });
  } finally {
    await extensionPage.close();
  }
}

async function translateSelectionThroughRuntime(context: any, extensionId: string, text: string) {
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/dist/options.html`);
  try {
    return await extensionPage.evaluate(async (selection) => chrome.runtime.sendMessage({
      type: "TRANSLATE_SELECTION",
      payload: { text: selection, contextText: selection, provider: "llm" },
    }), text);
  } finally {
    await extensionPage.close();
  }
}

async function analyzeSentenceThroughRuntime(context: any, extensionId: string, text: string) {
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/dist/options.html`);
  try {
    return await extensionPage.evaluate(async (sentence) => chrome.runtime.sendMessage({
      type: "ANALYZE_SELECTION",
      payload: { text: sentence },
    }), text);
  } finally {
    await extensionPage.close();
  }
}

test.beforeEach(async ({ context, extensionWorker }) => {
  await clearExtensionStorage(extensionWorker);
  await mockDictionaryFailures(context);
  await context.route("https://kaikki.org/**", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
});

test("DeepSeek quick translation uses native Responses structured output without affecting highlights", async ({
  context, page, extensionWorker, extensionId,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await seedTranslatorSettings(extensionWorker, {
    defaultTranslationProvider: "llm",
    llmProvider: "deepseek",
    providerBaseUrl: "https://api.deepseek.com",
    providerModel: "deepseek-v4-flash",
    apiKey: "e2e-deepseek-key",
    fallbackToGoogle: false,
  });

  let requestBody: Record<string, unknown> | null = null;
  let requestUrl = "";
  let authorization = "";
  await context.route("https://api.deepseek.com/**", async (route) => {
    requestUrl = route.request().url();
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    authorization = route.request().headers().authorization ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: responsesApiResponse({
        word: "预测",
        pos: "noun",
        hint: "此处表示模型给出的预测结果",
      }),
    });
  });

  await serveTestPage(context, page, '<p>The model makes <span id="target">predictions</span> about future demand.</p>');
  await expect.poll(async () => (await getHighlightTexts(page)).includes("predictions")).toBe(true);

  const runtimeResponse = await translateWordThroughRuntime(
    context, extensionId, "predictions", "The model makes predictions about future demand.",
  ) as { ok?: boolean; result?: { translation?: string } };

  expect(runtimeResponse.ok).toBe(true);
  expect(runtimeResponse.result?.translation).toBe("预测");
  expect(requestUrl).toBe("https://api.deepseek.com/responses");
  const body = requestBody as Record<string, unknown>;
  expect(body.reasoning).toEqual({ effort: "none" });
  expect(body.temperature).toBeUndefined();
  expect(body.top_p).toBeUndefined();
  expect(typeof body.max_output_tokens).toBe("number");
  expect(body.text).toMatchObject({ format: { type: "json_schema", name: "lexiglow_contextual_word" } });
  expect(body.instructions).toBeUndefined();
  const input = body.input as Array<{ role?: string; content?: string }>;
  expect(input[0]?.role).toBe("system");
  expect(input[0]?.content).toContain("Return");
  expect(input[1]?.role).toBe("user");
  expect(authorization).toBe("Bearer e2e-deepseek-key");
  expect((await getHighlightTexts(page)).includes("predictions")).toBe(true);
});

test("long DeepSeek selection translation receives a dynamic native output budget", async ({
  context, page, extensionWorker, extensionId,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await seedTranslatorSettings(extensionWorker, {
    defaultTranslationProvider: "llm",
    llmProvider: "deepseek",
    providerBaseUrl: "https://api.deepseek.com",
    providerModel: "deepseek-v4-flash",
    apiKey: "e2e-deepseek-key",
    fallbackToGoogle: false,
  });

  let maxTokens = 0;
  let reasoning: unknown;
  await context.route("https://api.deepseek.com/**", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    maxTokens = Number(body.max_output_tokens ?? 0);
    reasoning = body.reasoning;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: responsesApiResponse({ word: "这是一段完整的长句翻译" }),
    });
  });

  await serveTestPage(context, page, '<p>The model makes <span id="target">predictions</span> about future demand.</p>');
  await expect.poll(async () => (await getHighlightTexts(page)).includes("predictions")).toBe(true);

  const longText = "A technically dense sentence with multiple dependent clauses and detailed qualifications. ".repeat(8);
  const runtimeResponse = await translateSelectionThroughRuntime(context, extensionId, longText) as {
    ok?: boolean; result?: { translation?: string };
  };

  expect(runtimeResponse.ok).toBe(true);
  expect(runtimeResponse.result?.translation).toContain("完整的长句翻译");
  expect(maxTokens).toBeGreaterThan(180);
  expect(reasoning).toEqual({ effort: "none" });
  expect((await getHighlightTexts(page)).includes("predictions")).toBe(true);
});

test("DeepSeek sentence analysis retries empty native output with higher reasoning", async ({
  context, page, extensionWorker, extensionId,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await seedTranslatorSettings(extensionWorker, {
    defaultTranslationProvider: "llm",
    llmProvider: "deepseek",
    providerBaseUrl: "https://api.deepseek.com",
    providerModel: "deepseek-v4-flash",
    apiKey: "e2e-deepseek-key",
    fallbackToGoogle: false,
  });

  const bodies: Array<Record<string, unknown>> = [];
  await context.route("https://api.deepseek.com/**", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    if (bodies.length === 1) {
      await route.fulfill({ status: 200, contentType: "application/json", body: responsesApiResponse("") });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: responsesApiResponse({
        translation: "尽管实验失败，团队仍决定继续，因为证据仍然有用。",
        structure: "the team decided to continue",
        analysisSteps: ["一", "二", "三", "四"],
        highlights: [
          { category: "conjunction", tokenIndex: 0 },
          { category: "subject", tokenIndex: 5 },
          { category: "predicate", tokenIndex: 7 },
        ],
        clauseBlocks: [
          { type: "subordinate", startToken: 0, endToken: 3 },
          { type: "main", startToken: 4, endToken: 9 },
          { type: "subordinate", startToken: 10, endToken: 14 },
        ],
      }),
    });
  });

  const sentence = "Although the experiment failed, the team still decided to continue because the evidence remained useful.";
  await serveTestPage(context, page, '<p>The model makes <span id="target">predictions</span> about future demand.</p>');
  await expect.poll(async () => (await getHighlightTexts(page)).includes("predictions")).toBe(true);

  const runtimeResponse = await analyzeSentenceThroughRuntime(context, extensionId, sentence) as {
    ok?: boolean; result?: { translation?: string };
  };
  expect(runtimeResponse.ok).toBe(true);
  expect(runtimeResponse.result?.translation).toContain("团队");
  expect(bodies).toHaveLength(2);
  expect(bodies[0].reasoning).toEqual({ effort: "low" });
  expect(bodies[1].reasoning).toEqual({ effort: "high" });
  expect(Number(bodies[1].max_output_tokens)).toBeGreaterThan(Number(bodies[0].max_output_tokens));
  expect(JSON.stringify(bodies[1].input)).toContain("quality_retry:");
  expect((await getHighlightTexts(page)).includes("predictions")).toBe(true);
});

test("incomplete DeepSeek Responses output falls back to Google without leaking partial model text", async ({
  context, page, extensionWorker, extensionId,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await seedTranslatorSettings(extensionWorker, {
    defaultTranslationProvider: "llm",
    llmProvider: "deepseek",
    providerBaseUrl: "https://api.deepseek.com",
    providerModel: "deepseek-v4-flash",
    apiKey: "e2e-deepseek-key",
    fallbackToGoogle: true,
  });
  await mockGoogleTranslation(context, "安全回退译文");

  let deepSeekCalls = 0;
  await context.route("https://api.deepseek.com/**", async (route) => {
    deepSeekCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: responsesApiResponse('{"word":"半截结果', {
        status: "incomplete",
        incompleteReason: "max_output_tokens",
      }),
    });
  });

  await serveTestPage(context, page, '<p>The model makes <span id="target">predictions</span> about future demand.</p>');
  await expect.poll(async () => (await getHighlightTexts(page)).includes("predictions")).toBe(true);

  const runtimeResponse = await translateWordThroughRuntime(
    context, extensionId, "predictions", "The model makes predictions about future demand.",
  ) as { ok?: boolean; result?: { translation?: string } };

  expect(deepSeekCalls).toBe(1);
  expect(runtimeResponse.ok).toBe(true);
  expect(runtimeResponse.result?.translation).toBe("安全回退译文");
  expect(runtimeResponse.result?.translation).not.toContain("半截结果");
  expect((await getHighlightTexts(page)).includes("predictions")).toBe(true);
});

test("explicit custom OpenAI-compatible endpoints negotiate structured output once and reuse the capability", async ({
  context, page, extensionWorker,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await seedTranslatorSettings(extensionWorker, {
    defaultTranslationProvider: "llm",
    llmProvider: "openai-compatible",
    providerBaseUrl: "http://llm.test/v1",
    providerModel: "qwen-compatible-model",
    apiKey: "",
    fallbackToGoogle: false,
  });

  const modes: string[] = [];
  await context.route("http://llm.test/**", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const responseFormat = body.response_format as { type?: string } | undefined;
    const mode = responseFormat?.type ?? "prompt-json";
    modes.push(mode);
    if (mode === "json_schema") {
      await route.fulfill({
        status: 400,
        contentType: "text/plain",
        body: "response_format json_schema unsupported by this compatible gateway",
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: openAiResponse({ word: "兼容译文", pos: "noun", hint: "兼容服务返回" }),
    });
  });

  await serveTestPage(
    context,
    page,
    '<p>The model makes <span id="first">predictions</span> and hides <span id="second">obfuscation</span>.</p>',
  );
  await expect.poll(async () => (await getHighlightTexts(page)).includes("predictions")).toBe(true);
  await selectElementText(page, "#first");
  await expect(page.locator(".wordwise-primary-translation")).toContainText("兼容译文");
  await expect.poll(() => modes).toEqual(["json_schema", "json_object"]);

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await selectElementText(page, "#second");
  await expect.poll(() => modes.length).toBe(3);
  expect(modes).toEqual(["json_schema", "json_object", "json_object"]);
  await expect(page.locator(".wordwise-primary-translation")).toContainText("兼容译文");
});
