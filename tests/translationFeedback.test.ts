import { expect, test } from "vitest";
import { LlmProviderFormatError, LlmProviderRequestError } from "../src/shared/llm/contracts";
import { translationErrorMessage } from "../src/shared/translator";

test.each([
  [new LlmProviderRequestError("SYNTHETIC_SECRET", { status: 401 }), "401/403"],
  [new LlmProviderRequestError("SYNTHETIC_SECRET", { status: 403 }), "401/403"],
  [new LlmProviderRequestError("SYNTHETIC_SECRET", { status: 429 }), "额度"],
  [new LlmProviderRequestError("SYNTHETIC_SECRET", { status: 402 }), "额度"],
  [new LlmProviderFormatError("SYNTHETIC_SECRET"), "格式无效"],
  [new LlmProviderRequestError("SYNTHETIC_SECRET"), "网络"],
] as const)("classifies %s without leaking its payload", (error, expected) => {
  const text = translationErrorMessage(error, "zh-CN");
  expect(text).toContain(expected);
  expect(text).not.toContain("SYNTHETIC_SECRET");
});
