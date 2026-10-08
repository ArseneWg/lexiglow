# LexiGlow TODO / Product Roadmap

This file captures the highest-leverage product and engineering improvements for LexiGlow after reviewing the current codebase and comparable reading-learning products.

The intended product direction is not to become another feature-heavy AI dictionary. LexiGlow should remain an adaptive learning layer over the English content users already read: decide what deserves attention, how much attention it deserves, and when to stop interrupting the reader.

## Product principle

> Make the English the user is already reading teach them.

The core differentiation should come from:

- a personal vocabulary model that influences what is highlighted and how explanations are generated;
- learning signals collected from real reading instead of a separate study queue;
- sense-aware and phrase-aware lexical understanding rather than surface-word matching only;
- context-sensitive pronunciation;
- machine-validated LLM output for sentence analysis rather than trusting free-form model text.

---

# P0 — Fix the learning signal model

## 1. Separate encounters from help requests

Current learning progress uses `exposures` as a major familiarity signal. In practice, opening a translation repeatedly can mean the opposite of familiarity: the learner may still be failing to recall the word.

Replace the single exposure concept with explicit behavioral signals.

Suggested model:

```ts
interface LearningProgressEntry {
  status: "learning" | "known" | "ignored";
  familiarity: number;

  encounters: number;
  helpRequests: number;
  successfulRecalls: number;
  failures: number;

  lastEncounterAt?: number;
  lastHelpAt?: number;
  nextReviewAt?: number;
}
```

Suggested interpretation:

- seeing a word again without requesting help -> small positive signal;
- requesting translation again -> neutral or negative familiarity signal;
- explicitly marking a word as known -> strong positive signal;
- moving a known word back to relearning -> strong negative signal;
- recalling a word after a longer interval -> stronger positive signal than repeated encounters in the same session;
- repeated appearances within the same article should affect highlight priority, but should not be treated as equivalent independent long-term memories.

### Acceptance criteria

- [ ] Page encounters and tooltip/translation requests are tracked independently.
- [ ] Repeated translation requests do not automatically increase familiarity.
- [ ] A word encountered after a spaced interval can increase familiarity without requiring an explicit quiz.
- [ ] "Known -> relearning" is recorded as a failure signal.
- [ ] Highlight intensity is derived from the richer signal model.
- [ ] Existing settings data migrates safely from the current schema.
- [ ] Unit tests cover repeated lookup, passive re-encounter, explicit known, and relearning flows.

---

## 2. Cleanly separate lexical identity data from UI copy

The lexical layer should return structured facts; the UI/i18n layer should decide how those facts are presented.

Target shape:

```ts
{
  kind: "shared-inflection" | "independent-inflection" | "compound" | "canonical",
  masteryKey: "work",
  lexicalLemma: "work",
  components?: ["mixed", "precision"],
  reason: "safe-regular"
}
```

Avoid embedding learner-facing strings such as "mastery shared with work" inside lexical resolution code.

### Acceptance criteria

- [ ] `lexicon`/`lexicalSense` return structured mastery metadata only.
- [ ] All learner-facing mastery descriptions live in the i18n/UI layer.
- [ ] LLM prompts receive grammatical form data only, not UI learning-state prose.
- [ ] All supported learner languages render equivalent mastery explanations.

---

## 3. Split `src/content/index.ts`

`src/content/index.ts` currently owns too many responsibilities. Continue feature work only after reducing this concentration of UI and interaction logic.

Suggested structure:

```text
src/content/
  interaction/
    hover.ts
    selection.ts
  tooltip/
    root.ts
    wordView.ts
    pronunciationView.ts
    analysisView.ts
  context/
    extractor.ts
  sentence/
    renderer.ts
  highlightEngine.ts
  index.ts
```

### Acceptance criteria

- [ ] `index.ts` becomes orchestration/bootstrapping rather than the implementation location for most features.
- [ ] Tooltip rendering is separated from selection/hover state management.
- [ ] Sentence-analysis rendering is isolated.
- [ ] Pronunciation interaction is isolated.
- [ ] Existing E2E behavior remains unchanged.

---

# P1 — Build stronger product differentiation

## 4. Known word, unknown sense

A learner may know the common meaning of a word but not the meaning used in the current context.

Examples:

```text
run -> run a model
serve -> serve a model
issue -> software issue / issue a statement
branch -> Git branch
token -> LLM token
volume -> trading volume
```

LexiGlow already has much of the required infrastructure: lexical lemma resolution, structured dictionary senses, contextual POS, semantic hints, and alternative meanings.

Add a sense-level novelty decision before suppressing a known word.

Suggested flow:

```text
word is known
  -> resolve contextual sense
  -> compare current sense with common/default sense
  -> if current sense is sufficiently uncommon or domain-specific
       show a weak "new sense" highlight
```

The learning state of the base lexeme and the learning state of a specific sense should not be identical.

Possible representation:

```ts
interface SenseLearningState {
  lemma: string;
  senseKey: string;
  status: "learning" | "known";
  familiarity: number;
}
```

### UX suggestion

Use a visually distinct, less intrusive treatment from a true unknown word.

Example:

```text
Yellow: unknown lexical unit
Blue/secondary: known word used in a potentially unfamiliar sense
```

### Acceptance criteria

- [ ] Known high-frequency words can still surface when the contextual sense is likely novel.
- [ ] Common senses of known words remain quiet.
- [ ] Sense highlights are visually distinguishable from normal unknown-word highlights.
- [ ] Marking a sense as known does not incorrectly mark every meaning of the word as learned.
- [ ] Technical-domain examples are covered by tests.

---

## 5. Add fast vocabulary calibration

`knownBaseRank` is useful but currently depends too much on the user guessing their vocabulary size.

Add a short initial calibration flow (roughly 2–3 minutes), sampling across frequency bands such as:

```text
500 / 1000 / 1500 / 2500 / 4000 / 6000 / 8000 / 10000
```

For sampled words, ask for a lightweight response:

```text
Know / Unsure / Don't know
```

Use the answers to estimate a starting `knownBaseRank` and create explicit overrides for obvious exceptions.

### Acceptance criteria

- [ ] New users can calibrate without knowing what "Top N words" means.
- [ ] Calibration produces a confidence estimate, not only a raw rank.
- [ ] Strong individual exceptions become overrides rather than distorting the whole threshold.
- [ ] Users can skip calibration and keep manual threshold control.
- [ ] Calibration can be rerun without destroying manually learned data.

---

## 6. Explain why something is highlighted

Adaptive behavior becomes confusing if the reason is invisible.

Add lightweight explanation metadata to the tooltip, for example:

```text
Why this is highlighted
- outside your estimated 3,700-word vocabulary range
- currently in relearning
- appears 4 times in this article
```

For a known-word/new-sense case:

```text
- word itself is known
- this context uses a less common technical sense
```

For morphology:

```text
worked
past form of work
learning state shared with work
```

### Acceptance criteria

- [ ] The highlight engine exposes structured reasons.
- [ ] Tooltip reasons are short and localized.
- [ ] Reasons distinguish frequency, manual overrides, relearning, repetition, phrase, sense, and morphology signals.
- [ ] No raw internal scoring values are exposed unless useful to the learner.

---

## 7. Expand phrase learning beyond a permanently curated list

Keep the current curated MWE list as a high-confidence base, but add scalable phrase candidate discovery.

Potential signals:

- phrasal-verb dictionaries;
- collocation frequency;
- n-gram frequency;
- article-local repetition;
- lexical pattern rules;
- structured dictionary phrase entries.

Do not send whole pages to an LLM merely to discover phrases.

The long-term candidate pipeline should treat these as first-class competing learning units:

```text
word candidate
phrase candidate
sense candidate
```

### Acceptance criteria

- [ ] Phrase discovery can find useful units outside the hand-maintained list.
- [ ] False-positive phrase highlighting remains low.
- [ ] Overlapping phrase/word candidates use deterministic priority rules.
- [ ] Inflected variants continue to share a canonical mastery key when safe.

---

## 8. Add page-level personalized difficulty

LexiGlow already knows enough about a page to provide a lightweight learner-specific difficulty estimate.

Possible summary:

```text
This page
Known vocabulary: 94%
New lexical units: 18
Useful phrases: 6
Dense sentences: 4
Difficulty: B1–B2
```

This should also influence behavior:

- very easy page -> reduce highlighting;
- well-matched page -> normal adaptive highlighting;
- overly difficult page -> increase contextual assistance but avoid highlighting everything.

### Acceptance criteria

- [ ] Difficulty is personalized using current known/relearning state.
- [ ] Multi-word expressions count as lexical units rather than inflating raw word counts.
- [ ] Technical identifiers/proper names are excluded where appropriate.
- [ ] Difficulty can influence highlight density without changing learning state.

---

# P1 — Strengthen existing differentiators

## 9. Scale context-sensitive pronunciation

The pronunciation resolver is already a strong subsystem. Reduce dependence on hand-curated heteronym entries over time.

Target hierarchy:

```text
structured dictionary pronunciation variants
  + contextual POS/form information
  + sentence context
  -> general reading disambiguation
  -> curated exceptions only when necessary
```

Keep the existing principles:

- preserve UK/US variants;
- prefer matching human audio when available;
- never attach unrelated IPA and audio records;
- derive safe regular inflection pronunciation from lemma IPA;
- avoid confident playback when pronunciation remains ambiguous.

### Acceptance criteria

- [ ] More heteronyms resolve from structured POS/context instead of hardcoded entries.
- [ ] Ambiguous cases remain explicitly ambiguous.
- [ ] Morphological derived pronunciations remain traceable to their lemma/source.
- [ ] Human audio continues to outrank TTS when it matches the selected reading.

---

## 10. Improve sentence-analysis reliability, not feature count

Do not turn sentence analysis into a grammar encyclopedia.

Invest in:

- stronger token/range validation;
- stable clause segmentation;
- repeated-token correctness;
- translation-order explanations;
- cross-provider consistency;
- semantic quality validation before rendering;
- targeted retries with validator feedback.

### Acceptance criteria

- [ ] Every highlighted grammar item maps to a validated source token.
- [ ] Clause blocks cover the source without gaps/overlaps.
- [ ] Quality retry is triggered by meaningful structural validation failures.
- [ ] Repeated words such as multiple `that` tokens remain unambiguous.
- [ ] UI stays focused on reading comprehension and translation order.

---

# P2 — Productization

## 11. Replace or re-license the frequency corpus before commercial distribution

The current Google 10k-derived frequency list has upstream licensing caveats for commercial use.

Before commercial distribution:

- evaluate a commercially safe frequency corpus;
- document licensing and attribution clearly;
- ensure migration preserves user-known thresholds as closely as possible when rank ordering changes.

### Acceptance criteria

- [ ] Bundled production frequency data has commercial terms compatible with LexiGlow distribution.
- [ ] Migration from old rank data is tested.
- [ ] Third-party notices are updated.

---

## 12. Optional encrypted synchronization

Once the local learning model is stable, support optional cross-device synchronization for:

- learning progress;
- manual known/unknown/ignored overrides;
- profile configuration without exporting secrets in plaintext;
- sense-level learning state when implemented.

Do not make cloud sync a prerequisite for normal use.

---

## 13. Reading history and learning insights

Add only after the signal model is trustworthy.

Useful insights may include:

- words/senses naturally acquired through reading;
- words repeatedly looked up but not retained;
- recent reading difficulty trend;
- recurring domain vocabulary;
- phrases encountered across multiple pages.

Avoid gamification metrics that optimize for clicks rather than reading.

---

## 14. Lightweight interoperability

Useful low-cost additions:

- [ ] Anki export for selected vocabulary/phrases/senses.
- [ ] Stable JSON learning-data schema/version documentation.
- [ ] Import/export migration tests for future schema versions.

Avoid building a full competing flashcard system inside LexiGlow unless real usage later proves it necessary.

---

# Explicit non-goals for now

Do not prioritize these while the adaptive-reading core is still evolving:

- [ ] Full built-in flashcard/SRS application.
- [ ] AI conversation tutor.
- [ ] YouTube/Netflix subtitle learning platform.
- [ ] Course/curriculum system.
- [ ] Leaderboards, streaks, or heavy gamification.
- [ ] Social/community platform.
- [ ] Large standalone vocabulary notebook UI.

These areas are already crowded and would dilute the strongest product direction.

---

# Suggested release sequence

## v0.2 — Make the learning model trustworthy

- [ ] Separate encounters/help requests/recall/failure signals.
- [ ] Rework familiarity and spacing logic.
- [ ] Add quick vocabulary calibration.
- [ ] Move mastery presentation fully into UI/i18n.
- [ ] Split `src/content/index.ts` into maintainable modules.

## v0.3 — Make LexiGlow clearly different

- [ ] Known-word / unknown-sense detection.
- [ ] Sense-aware highlighting.
- [ ] Explain "why this is highlighted".
- [ ] Dynamic high-confidence phrase discovery.
- [ ] Personalized page difficulty.

## v0.4 — Productize the core

- [ ] Commercial-safe frequency corpus.
- [ ] Optional encrypted sync.
- [ ] Reading history and learning insights.
- [ ] Anki/export interoperability.
- [ ] Chrome Web Store permission/privacy polish.

---

# Highest-leverage next three tasks

If only three items can be worked on next, prioritize them in this order:

1. **Fix the learning signal model.** Repeated lookup must not be mistaken for learning success.
2. **Implement known-word / unknown-sense detection.** Move from detecting unknown words to detecting unknown usages.
3. **Add fast vocabulary calibration.** Improve the initial personal vocabulary model so adaptive behavior is useful immediately.

Together these create the intended feedback loop:

```text
better estimate of what the learner knows
  -> detect genuinely unfamiliar words / senses / phrases
  -> intervene at the right intensity
  -> infer learning from real reading behavior
  -> make future pages quieter and more personalized
```
