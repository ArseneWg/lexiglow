import { describe, expect, test } from "vitest";

import { parseGoogleTranslateResponse } from "../src/shared/translator";

describe("google response parsing", () => {
  test("joins translation segments", () => {
    const payload = [[["你好", "hello", null, null, 10]], null, "en"];
    expect(parseGoogleTranslateResponse(payload)).toBe("你好");
  });

  test("returns empty string for unexpected payloads", () => {
    expect(parseGoogleTranslateResponse({})).toBe("");
  });
});
