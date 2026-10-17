import type { z } from "zod";
import type { BuildContext } from "../../arn";
import type { Grant } from "../../model/model";
import type { ConditionBlock, Issue, SlimService, Statement } from "../../types";
import { formatPath } from "../../validate/schema";
import type { BuildResult } from "../generic";

/** Preset actions are written WITHOUT the service prefix, e.g. "GetObject". */
export interface ModulePreset {
  id: string;
  label: string;
  actions: string[];
}

export interface Module<D = unknown> {
  id: string;
  service: string;
  label: string;
  presets: ModulePreset[];
  dataSchema: z.ZodType<D>;
  build(grant: Grant, data: D, svc: SlimService, ctx: BuildContext): BuildResult;
  /** One sentence, starts with "Can ". */
  explain(grant: Grant, data: D): string;
}

const sorted = (xs: string[]): string[] => [...xs].sort();
const one = (xs: string[]): string | string[] => (xs.length === 1 ? (xs[0] as string) : xs);

export function prefixed(service: string, actions: string[]): string[] {
  return actions.map((a) => `${service}:${a}`);
}

export function stmt(
  sid: string,
  actions: string[],
  resources: string[],
  condition?: ConditionBlock,
): Statement {
  return {
    Sid: sid,
    Effect: "Allow",
    Action: one(sorted(actions)),
    Resource: one(sorted(resources)),
    ...(condition !== undefined ? { Condition: condition } : {}),
  };
}

export function runModule(
  mod: Module,
  grant: Grant,
  svc: SlimService,
  ctx: BuildContext,
): BuildResult {
  const fail = (issue: Omit<Issue, "severity" | "grantId">): BuildResult => ({
    statements: [],
    issues: [{ ...issue, severity: "error", grantId: grant.id }],
  });
  if (grant.service !== mod.service) {
    return fail({
      id: "E_MODULE_SERVICE",
      message: `${mod.label} can only be used for the ${mod.service} service, not "${grant.service}".`,
    });
  }
  const access = grant.access;
  if (access.type !== "preset" || !mod.presets.some((p) => p.id === access.preset)) {
    return fail({
      id: "E_MODULE_PRESET",
      message: `${mod.label} needs one of its presets (${mod.presets.map((p) => p.id).join(", ")}).`,
    });
  }
  if (grant.scope.type !== "module") {
    return fail({
      id: "E_MODULE_SCOPE",
      message: `${mod.label} needs module-specific scope settings.`,
    });
  }
  const parsed = mod.dataSchema.safeParse(grant.scope.data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail({
      id: "E_MODULE_DATA",
      message: `The ${mod.label} settings are invalid: ${first?.message ?? "invalid"}.`,
      path: formatPath(["data", ...(first?.path ?? [])]),
    });
  }
  return mod.build(grant, parsed.data, svc, ctx);
}
