import { describe, expect, test } from "vitest";

import { cleanSurfaceToken, getLemmaCandidates, toLemma } from "../src/shared/normalize";

describe("normalize helpers", () => {
  test("cleans punctuation from edges", () => {
    expect(cleanSurfaceToken("...Running!")).toBe("Running");
  });

  test("normalizes typographic apostrophes", () => {
    expect(cleanSurfaceToken("don’t")).toBe("don't");
  });

  test("rejects digit-containing words", () => {
    expect(cleanSurfaceToken("gpt4")).toBe("");
  });

  test("normalizes common inflections", () => {
    expect(toLemma("running")).toBe("run");
    expect(toLemma("worked")).toBe("work");
    expect(toLemma("stories")).toBe("story");
    expect(toLemma("knives")).toBe("knif");
  });

  test("normalizes common irregular inflections and plurals", () => {
    expect(toLemma("went")).toBe("go");
    expect(toLemma("written")).toBe("write");
    expect(toLemma("bought")).toBe("buy");
    expect(toLemma("taken")).toBe("take");
    expect(toLemma("children")).toBe("child");
    expect(toLemma("teeth")).toBe("tooth");
  });

  test("provides comparative and superlative candidates", () => {
    expect(getLemmaCandidates("bigger")).toEqual(expect.arrayContaining(["bigger", "big"]));
    expect(getLemmaCandidates("easiest")).toEqual(expect.arrayContaining(["easiest", "easy"]));
    expect(toLemma("better")).toBe("good");
    expect(toLemma("worst")).toBe("bad");
  });

  test("distinguishes contractions from possessives", () => {
    expect(getLemmaCandidates("it's")[0]).toBe("it's");
    expect(getLemmaCandidates("he's")[0]).toBe("he's");
    expect(getLemmaCandidates("that's")[0]).toBe("that's");
    expect(getLemmaCandidates("Alice's")[0]).toBe("alice");
    expect(getLemmaCandidates("students'")[0]).toBe("students");
  });

  test("provides lexicon-friendly candidates for past tense words", () => {
    expect(getLemmaCandidates("received")).toEqual(
      expect.arrayContaining(["received", "receiv", "receive"]),
    );
  });

  test("provides base lemmas for irregular forms", () => {
    expect(getLemmaCandidates("went")).toEqual(expect.arrayContaining(["went", "go"]));
    expect(getLemmaCandidates("spoken")).toEqual(expect.arrayContaining(["spoken", "speak"]));
  });

  test("keeps doubled-consonant stems available for mastery resolution", () => {
    expect(getLemmaCandidates("added")).toEqual(expect.arrayContaining(["added", "add", "ad"]));
    expect(getLemmaCandidates("adding")).toEqual(expect.arrayContaining(["adding", "add", "ad"]));
    expect(getLemmaCandidates("houses")).toEqual(expect.arrayContaining(["houses", "hous", "house"]));
  });

  test("keeps -ves plural candidates that map back to f/fe lemmas", () => {
    expect(getLemmaCandidates("lives")).toEqual(expect.arrayContaining(["lives", "lif", "life"]));
    expect(getLemmaCandidates("knives")).toEqual(expect.arrayContaining(["knives", "knif", "knife"]));
    expect(getLemmaCandidates("wives")).toEqual(expect.arrayContaining(["wives", "wif", "wife"]));
  });
});
