import { create } from "zustand";
import { createEmptyModel, type Grant, type RoleModel, type Trust } from "../core/model/model";
import * as ops from "./model-ops";
import type { ModelFields } from "./model-ops";

export type Step = 0 | 1 | 2;
export type EditorMode = "sentences" | "grid";

export interface BuilderState {
  model: RoleModel;
  step: Step;
  editor: EditorMode;
  focusTarget: string | null;
  shareStatus: "ok" | "too-large";
  /**
   * When true, every field shows its error without waiting for a blur (restored roles, blocked export, Jump to).
   * Adding a grant turns it off: those errors have been shown, and a new blank grant should not start out red.
   */
  revealErrors: boolean;
  /** Fields the user has left or jumped to, keyed by the focus id `focusIdFor` gives their issues. */
  touched: Record<string, true>;
  setFields(p: ModelFields): void;
  setTrust(t: Trust): void;
  addGrant(g: Grant): void;
  updateGrant(id: string, f: (g: Grant) => Grant): void;
  removeGrant(id: string): void;
  replaceModel(m: RoleModel): void;
  reset(): void;
  setStep(s: Step): void;
  setEditor(e: EditorMode): void;
  focus(target: string | null): void;
  setShareStatus(s: BuilderState["shareStatus"]): void;
  revealAllErrors(): void;
  touch(id: string): void;
  /** Whether a field's errors show: the field was touched, or every error is revealed. */
  isRevealed(id: string): boolean;
}

const TRUST_FIELD = "field:trust.";

/** Touched flags without the trust fields, which a new trust kind replaces. */
function withoutTrustFields(touched: Record<string, true>): Record<string, true> {
  return Object.fromEntries(Object.entries(touched).filter(([id]) => !id.startsWith(TRUST_FIELD))) as Record<string, true>;
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  model: createEmptyModel(),
  step: 0,
  editor: "sentences",
  focusTarget: null,
  shareStatus: "ok",
  revealErrors: false,
  touched: {},
  setFields: (p) => set((s) => ({ model: ops.setFields(s.model, p) })),
  setTrust: (t) =>
    set((s) => ({
      model: ops.setTrust(s.model, t),
      touched: t.kind === s.model.trust.kind ? s.touched : withoutTrustFields(s.touched),
    })),
  addGrant: (g) => set((s) => ({ model: ops.addGrant(s.model, g), revealErrors: false })),
  updateGrant: (id, f) => set((s) => ({ model: ops.updateGrant(s.model, id, f) })),
  removeGrant: (id) =>
    set((s) => ({
      model: ops.removeGrant(s.model, id),
      focusTarget: s.focusTarget === "grant:" + id ? null : s.focusTarget,
    })),
  replaceModel: (m) => set({ model: m, revealErrors: true, touched: {} }),
  reset: () =>
    set({
      model: createEmptyModel(),
      step: 0,
      editor: "sentences",
      focusTarget: null,
      shareStatus: "ok",
      revealErrors: false,
      touched: {},
    }),
  // A target that nothing claimed before the step changed can never be satisfied; drop it so it cannot steal focus later.
  setStep: (step) => set({ step, focusTarget: null }),
  setEditor: (editor) => set({ editor }),
  focus: (focusTarget) => set({ focusTarget }),
  setShareStatus: (shareStatus) => set({ shareStatus }),
  revealAllErrors: () => set({ revealErrors: true }),
  touch: (id) => set((s) => (s.touched[id] ? s : { touched: { ...s.touched, [id]: true } })),
  isRevealed: (id) => get().revealErrors || get().touched[id] === true,
}));
