import { MODULES } from "../../../core/engine/modules/registry";
import type { Grant } from "../../../core/model/model";
import { ACCESS_LEVELS, type AccessLevel, type SlimService } from "../../../core/types";

export interface VerbOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Stand-in values for options that only display the grant's current access; picking them changes nothing. */
const COMBO = "__combo";
const ACTIONS = "__actions";

const isLevel = (v: string): v is AccessLevel => (ACCESS_LEVELS as readonly string[]).includes(v);

/** The verb choices for a grant and the one that is currently selected. */
export function verbChoices(grant: Grant, svc: SlimService): { options: VerbOption[]; selected: VerbOption | null } {
  const mod = grant.module ? MODULES[grant.module] : undefined;
  const access = grant.access;
  if (mod) {
    const options = mod.presets.map((p) => ({ value: p.id, label: p.label }));
    const selected = access.type === "preset" ? (options.find((o) => o.value === access.preset) ?? null) : null;
    return { options, selected };
  }
  const options: VerbOption[] = ACCESS_LEVELS.filter((l) => svc.actions.some((a) => a.level === l)).map((l) => ({
    value: l,
    label: l,
  }));
  if (access.type === "actions") {
    const n = access.actions.length;
    const selected = { value: ACTIONS, label: `${n} individual ${n === 1 ? "action" : "actions"}`, disabled: true };
    return { options: [...options, selected], selected };
  }
  if (access.type === "levels") {
    const levels = ACCESS_LEVELS.filter((l) => access.levels.includes(l));
    if (levels.length === 1) {
      const only = levels[0] as AccessLevel;
      // A stale level the service no longer has still shows rather than leaving the select blank.
      const selected = options.find((o) => o.value === only) ?? { value: only, label: only };
      return { options: options.includes(selected) ? options : [...options, selected], selected };
    }
    if (levels.length > 1) {
      const selected = { value: COMBO, label: levels.join(" + ") };
      return { options: [...options, selected], selected };
    }
  }
  return { options, selected: null };
}

/** The grant after the user picks a verb option. Display-only options leave it unchanged. */
export function applyVerb(grant: Grant, value: string): Grant {
  if (grant.module && MODULES[grant.module]) return { ...grant, access: { type: "preset", preset: value } };
  if (isLevel(value)) return { ...grant, access: { type: "levels", levels: [value] } };
  return grant;
}
