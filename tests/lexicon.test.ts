import { describe, expect, test } from "vitest";

import { lookupRank, resolveLookupLemma, resolveMasteryKey } from "../src/shared/lexicon";

describe("lexicon lookup", () => {
  test("prefers an exact ranked word over a broken stem", () => {
    expect(resolveLookupLemma("received")).toBe("received");
    expect(lookupRank(resolveLookupLemma("received"))).toBe(891);
  });

  test("falls back to a lemma candidate when the exact word is not ranked", () => {
    expect(resolveLookupLemma("running")).toBe("running");
    expect(lookupRank(resolveLookupLemma("houses"))).not.toBeNull();
  });

  test("uses safe regular and irregular base forms for mastery", () => {
    expect(resolveMasteryKey("added")).toBe("add");
    expect(resolveMasteryKey("adding")).toBe("add");
    expect(resolveMasteryKey("worked")).toBe("work");
    expect(resolveMasteryKey("went")).toBe("go");
    expect(resolveMasteryKey("written")).toBe("write");
    expect(resolveMasteryKey("addition")).toBe("addition");
  });

  test("does not falsely merge lexical words that merely look inflected", () => {
    expect(resolveMasteryKey("news")).toBe("news");
    expect(resolveMasteryKey("morning")).toBe("morning");
    expect(resolveMasteryKey("hundred")).toBe("hundred");
    expect(resolveMasteryKey("lives")).toBe("lives");
    expect(resolveMasteryKey("saw")).toBe("saw");
    expect(resolveMasteryKey("left")).toBe("left");
  });

  test("uses normalized multi-word phrases as independent mastery keys", () => {
    expect(resolveMasteryKey("Take   Into Account")).toBe("take into account");
    expect(resolveLookupLemma("Take Into Account")).toBe("take into account");
  });
});
