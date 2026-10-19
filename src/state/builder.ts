import { create } from "zustand";
import { createEmptyModel, type Grant, type RoleModel, type Trust } from "../core/model/model";
import * as ops from "./model-ops";
import type { ModelFields } from "./model-ops";
import { filledFieldIds, withoutGrant, withoutRemovedRows, withoutTrustFields, type Touched } from "./touched";

export type Step = 0 | 1 | 2;
export type EditorMode = "sentences" | "grid";

export interface BuilderState {
  model: RoleModel;
  step: Step;
  editor: EditorMode;
  focusTarget: string | null;
  shareStatus: "ok" | "too-large";
  /**
   * When true, every field shows its error without waiting for a blur (blocked export, Jump to). Adding a grant
   * turns it off: those errors have been shown, and a new blank grant should not start out red.
   */
  revealErrors: boolean;
  /**
   * Fields the user has left or jumped to, keyed by the focus id `focusIdFor` gives their issues. A loaded role
   * starts with the fields that hold a value.
   */
  touched: Touched;
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
}

/** Whether a field's errors show: the field was touched, or every error is revealed. Selectors pass their own state. */
export const isRevealed = (s: Pick<BuilderState, "revealErrors" | "touched">, id: string): boolean =>
  s.revealErrors || s.touched[id] === true;

export const useBuilderStore = create<BuilderState>((set) => ({
  model: createEmptyModel(),
  step: 0,
  editor: "sentences",
  focusTarget: null,
  shareStatus: "ok",
  revealErrors: false,
  touched: {},
  setFields: (p) =>
    set((s) => ({
      model: ops.setFields(s.model, p),
      touched: p.managedPolicyArns
        ? withoutRemovedRows(s.touched, s.model.managedPolicyArns, p.managedPolicyArns)
        : s.touched,
    })),
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
      touched: withoutGrant(s.touched, id),
    })),
  replaceModel: (m) => set({ model: m, revealErrors: false, touched: filledFieldIds(m) }),
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
}));
