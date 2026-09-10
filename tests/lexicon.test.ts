import { describe, expect, test } from "vitest";

import {
  lookupRank,
  resolveLookupLemma,
  resolveMasteryIdentity,
  resolveMasteryKey,
} from "../src/shared/lexicon";

describe("lexicon lookup", () => {
  test("prefers an exact ranked word over a broken stem", () => {
    expect(resolveLookupLemma("received")).toBe("received");
    expect(lookupRank(resolveLookupLemma("received"))).toBe(891);
  });

  test("keeps lookup identity separate from mastery identity", () => {
    expect(resolveLookupLemma("running")).toBe("running");
    expect(lookupRank(resolveLookupLemma("houses"))).not.toBeNull();
    expect(resolveMasteryKey("houses")).toBe("house");
  });

  test("uses safe regular, irregular, plural, and degree base forms for mastery", () => {
    expect(resolveMasteryKey("added")).toBe("add");
    expect(resolveMasteryKey("adding")).toBe("add");
    expect(resolveMasteryKey("worked")).toBe("work");
    expect(resolveMasteryKey("went")).toBe("go");
    expect(resolveMasteryKey("written")).toBe("write");
    expect(resolveMasteryKey("children")).toBe("child");
    expect(resolveMasteryKey("knives")).toBe("knife");
    expect(resolveMasteryKey("bigger")).toBe("big");
    expect(resolveMasteryKey("easiest")).toBe("easy");
    expect(resolveMasteryKey("addition")).toBe("addition");
  });

  test("covers more common regular verbs without changing derived-word behavior", () => {
    expect(resolveMasteryKey("talked")).toBe("talk");
    expect(resolveMasteryKey("talking")).toBe("talk");
    expect(resolveMasteryKey("talks")).toBe("talk");
    expect(resolveMasteryKey("supporting")).toBe("support");
    expect(resolveMasteryKey("addition")).toBe("addition");
  });

  test("does not falsely merge lexical or context-ambiguous forms", () => {
    expect(resolveMasteryKey("news")).toBe("news");
    expect(resolveMasteryKey("morning")).toBe("morning");
    expect(resolveMasteryKey("hundred")).toBe("hundred");
    expect(resolveMasteryKey("lives")).toBe("lives");
    expect(resolveMasteryKey("saw")).toBe("saw");
    expect(resolveMasteryKey("left")).toBe("left");
    expect(resolveMasteryKey("rose")).toBe("rose");
  });

  test("explains shared, independent, and compound mastery identities", () => {
    expect(resolveMasteryIdentity("worked", "work")).toMatchObject({
      masteryKey: "work",
      kind: "shared-inflection",
    });
    expect(resolveMasteryIdentity("saw", "see")).toMatchObject({
      masteryKey: "saw",
      kind: "independent-inflection",
      lexicalLemma: "see",
    });
    expect(resolveMasteryIdentity("in-page", "in-page")).toMatchObject({
      masteryKey: "in-page",
      kind: "compound",
      components: ["in", "page"],
    });
  });

  test("uses normalized multi-word phrases as independent mastery keys", () => {
    expect(resolveMasteryKey("Take   Into Account")).toBe("take into account");
    expect(resolveLookupLemma("Take Into Account")).toBe("take into account");
  });
});
