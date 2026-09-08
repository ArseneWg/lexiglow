import { describe, expect, test } from "vitest";

import {
  createTooltipSession,
  HIDDEN_TOOLTIP_SESSION,
  isAnalysisTooltipSession,
  isPersistentTooltipSessionState,
  isSelectionTooltipSession,
  shouldPreserveAnalysisContextOnHide,
} from "../src/content/tooltipSession";

describe("tooltip session state", () => {
  test("only interaction sessions that must survive pointer movement are persistent", () => {
    expect(isPersistentTooltipSessionState(HIDDEN_TOOLTIP_SESSION)).toBe(false);
    expect(isPersistentTooltipSessionState(createTooltipSession("hoverWord"))).toBe(false);
    expect(isPersistentTooltipSessionState(createTooltipSession("analysisPrompt"))).toBe(false);
    expect(isPersistentTooltipSessionState(createTooltipSession("reviewWord"))).toBe(true);
    expect(isPersistentTooltipSessionState(createTooltipSession("selection"))).toBe(true);
    expect(isPersistentTooltipSessionState(createTooltipSession("analysis"))).toBe(true);
  });

  test("selection and analysis predicates are mutually explicit", () => {
    expect(isSelectionTooltipSession(createTooltipSession("selection"))).toBe(true);
    expect(isSelectionTooltipSession(createTooltipSession("analysis"))).toBe(false);
    expect(isAnalysisTooltipSession(createTooltipSession("analysisPrompt"))).toBe(true);
    expect(isAnalysisTooltipSession(createTooltipSession("analysis"))).toBe(true);
    expect(isAnalysisTooltipSession(createTooltipSession("reviewWord"))).toBe(false);
  });

  test("only an open analysis panel preserves sentence context while the word view hides", () => {
    expect(shouldPreserveAnalysisContextOnHide(createTooltipSession("analysis"))).toBe(true);
    expect(shouldPreserveAnalysisContextOnHide(createTooltipSession("analysisPrompt"))).toBe(false);
    expect(shouldPreserveAnalysisContextOnHide(createTooltipSession("selection"))).toBe(false);
  });
});
