import { describe, expect, test } from "vitest";

import { extractWordAtOffset } from "../src/shared/word";

describe("extractWordAtOffset", () => {
  test("extracts a word under the cursor", () => {
    expect(extractWordAtOffset("Hover on running words", 10)).toEqual({
      surface: "running",
      start: 9,
      end: 16,
    });
  });

  test("skips non-english tokens", () => {
    expect(extractWordAtOffset("abc123", 2)).toBeNull();
  });

  test("skips @mention handles", () => {
    expect(extractWordAtOffset("@somebody replied", 4)).toBeNull();
  });
});
