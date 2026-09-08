export type TooltipSessionKind =
  | "hidden"
  | "hoverWord"
  | "reviewWord"
  | "selection"
  | "analysisPrompt"
  | "analysis";

export interface TooltipSessionState {
  kind: TooltipSessionKind;
}

export const HIDDEN_TOOLTIP_SESSION: TooltipSessionState = { kind: "hidden" };

export function createTooltipSession(kind: TooltipSessionKind): TooltipSessionState {
  return { kind };
}

export function isPersistentTooltipSessionState(state: TooltipSessionState): boolean {
  return state.kind === "reviewWord" || state.kind === "selection" || state.kind === "analysis";
}

export function isSelectionTooltipSession(state: TooltipSessionState): boolean {
  return state.kind === "selection";
}

export function isAnalysisTooltipSession(state: TooltipSessionState): boolean {
  return state.kind === "analysis" || state.kind === "analysisPrompt";
}

export function shouldPreserveAnalysisContextOnHide(state: TooltipSessionState): boolean {
  return state.kind === "analysis";
}
