
import { afterEach, describe, expect, test, vi } from "vitest";
import { requestOpenAiCompatibleTask, resetOpenAiCompatibilityCacheForTests } from "../src/shared/llm/openAiCompatible";

afterEach(() => {
  vi.restoreAllMocks();
  resetOpenAiCompatibilityCacheForTests();
});

function completion(content: string) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("generic OpenAI-compatible adapter", () => {
  test("negotiates plaintext schema errors to JSON object and caches the accepted mode", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let rejectedSchema = false;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      const responseFormat = body.response_format as { type?: string } | undefined;
      if (!rejectedSchema && responseFormat?.type === "json_schema") {
        rejectedSchema = true;
        return new Response("response_format json_schema unsupported", { status: 400, headers: { "Content-Type": "text/plain" } });
      }
      return completion('{"word":"翻译"}');
    }));
    const request = {
      connection: { baseUrl: "https://gpustack.example/v1", model: "local", apiKey: "" },
      task: "selection-translation" as const,
      systemPrompt: "Translate.",
      userPrompt: "text",
      maxTokens: 180,
      timeoutMs: 5000,
    };
    const first = await requestOpenAiCompatibleTask(request);
    expect(first.structuredOutputMode).toBe("json-object");
    expect(bodies).toHaveLength(2);
    bodies.length = 0;
    await requestOpenAiCompatibleTask(request);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].response_format).toEqual({ type: "json_object" });
  });

  test("falls back to prompt-only JSON when response_format is unavailable", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        return new Response(JSON.stringify({ error: { message: "response_format unsupported" } }), { status: 400 });
      }
      return completion('```json\n{"word":"翻译"}\n```');
    }));
    const result = await requestOpenAiCompatibleTask({
      connection: { baseUrl: "http://localhost:8000/v1", model: "local", apiKey: "" },
      task: "selection-translation",
      systemPrompt: "Translate.",
      userPrompt: "text",
      maxTokens: 180,
      timeoutMs: 5000,
    });
    expect(result.structuredOutputMode).toBe("prompt-json");
  });
});
