import { describe, expect, it } from "vitest";

import { t } from "../src/shared/i18n";

describe("t", () => {
  it("returns localized strings for supported learner languages", () => {
    expect(t("ja", "tooltipSentenceAnalysis")).toBe("英文解析");
    expect(t("ru", "popupOpenFullSettings")).toBe("Открыть полные настройки");
    expect(t("ar", "tooltipTranslation")).toBe("الترجمة");
  });

  it("interpolates variables in localized templates", () => {
    expect(t("fr", "tooltipRankLabel", { rank: 42 })).toBe("Fréquence #42");
    expect(t("th", "analysisStepFallback", { index: 3 })).toBe("ขั้นที่ 3");
    expect(t("zh-CN", "tooltipSelectionTooLong", { limit: 1200 })).toContain("1200");
  });

  it("uses precise structural labels for single-token highlights", () => {
    expect(t("en", "highlightSubject")).toBe("Subject head");
    expect(t("en", "highlightPredicate")).toBe("Main verb");
    expect(t("zh-CN", "highlightSubject")).toBe("主语中心词");
    expect(t("zh-CN", "highlightPredicate")).toBe("主句谓语");
  });

  it("falls back to English for unknown language codes", () => {
    expect(t("xx", "tooltipSentenceAnalysis")).toBe("Sentence Analysis");
    expect(t("ja", "tooltipSelectionTooLong", { limit: 1200 })).toBe(
      "This selection is too long. Select up to 1200 characters.",
    );
  });
});
