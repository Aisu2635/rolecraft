import { matchableTypes, type BuildContext } from "../arn";
import type { AccessSelection, Grant } from "../model/model";
import type { Issue, SlimAction, SlimService, Statement } from "../types";
import { baseSid } from "./sid";

export interface BuildResult {
  statements: Statement[];
  issues: Issue[];
}

const byName = (a: SlimAction, b: SlimAction): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export function resolveActions(
  svc: SlimService,
  access: AccessSelection,
): { actions: SlimAction[]; unknown: string[] } {
  if (access.type === "preset") return { actions: [], unknown: [] };
  if (access.type === "levels") {
    const levels = new Set(access.levels);
    return {
      actions: svc.actions.filter((a) => levels.has(a.level)).sort(byName),
      unknown: [],
    };
  }
  const index = new Map(svc.actions.map((a) => [a.name, a]));
  const found = new Map<string, SlimAction>();
  const unknown = new Set<string>();
  for (const name of access.actions) {
    const a = index.get(name);
    if (a) found.set(name, a);
    else unknown.add(name);
  }
  return {
    actions: [...found.values()].sort(byName),
    unknown: [...unknown].sort(),
  };
}

const ALTERNATE = /accesspoint|objectlambda/i;

const one = <T>(xs: T[]): T | T[] => (xs.length === 1 ? (xs[0] as T) : xs);

export function buildGenericStatements(
  grant: Grant,
  svc: SlimService,
  _ctx: BuildContext,
): BuildResult {
  void _ctx;
  const issues: Issue[] = [];
  const statements: Statement[] = [];
  const gid = grant.id;
  const issue = (id: string, severity: Issue["severity"], message: string): void => {
    issues.push({ id, severity, message, grantId: gid });
  };
  const name = (a: SlimAction): string => `${svc.key}:${a.name}`;

  if (grant.access.type === "preset") {
    issue(
      "E_PRESET_WITHOUT_MODULE",
      "error",
      `Preset "${grant.access.preset}" for ${svc.key} needs a service module, which is not available.`,
    );
  }
  if (grant.scope.type === "module") {
    issue(
      "E_MODULE_SCOPE_GENERIC",
      "error",
      `Module scope is not supported for ${svc.key} without a service module.`,
    );
  }
  if (issues.length > 0 || grant.scope.type === "module") {
    return { statements, issues };
  }

  const { actions, unknown } = resolveActions(svc, grant.access);
  if (unknown.length > 0) {
    issue(
      "E_UNKNOWN_ACTION",
      "error",
      `Unknown ${svc.key} action(s): ${unknown.map((n) => `${svc.key}:${n}`).join(", ")}.`,
    );
  }
  if (actions.length === 0) {
    if (unknown.length === 0) {
      issue(
        "I_EMPTY_SELECTION",
        "info",
        `No ${svc.key} actions are selected, so no statements were generated.`,
      );
    }
    return { statements, issues };
  }
  const actionStrings = (xs: SlimAction[]): string | string[] =>
    one(xs.map(name));

  if (grant.scope.type === "all") {
    statements.push({
      Sid: baseSid(svc.key, grant.access, "All"),
      Effect: "Allow",
      Action: actionStrings(actions),
      Resource: "*",
    });
    return { statements, issues };
  }

  const arns = [
    ...new Set(
      grant.scope.arns.map((a) => a.trim()).filter((a) => a.length > 0),
    ),
  ].sort();
  const star = arns.includes("*");
  const classified = new Map<string, string[]>();
  for (const arn of arns) {
    if (arn === "*") continue;
    const types = matchableTypes(arn, svc);
    if (types.length === 0) {
      issue(
        "E_FOREIGN_ARN",
        "error",
        `"${arn}" is not a recognized ${svc.key} resource ARN.`,
      );
    } else classified.set(arn, types);
  }

  const groups = new Map<string, { arns: string[]; actions: SlimAction[] }>();
  const global: SlimAction[] = [];
  for (const a of actions) {
    if (a.resources.length === 0) {
      global.push(a);
      continue;
    }
    const matched: string[] = [];
    const covered = new Set<string>();
    for (const [arn, types] of classified) {
      const hit = types.filter((t) => a.resources.includes(t));
      if (hit.length > 0) {
        matched.push(arn);
        hit.forEach((t) => covered.add(t));
      }
    }
    if (star) {
      matched.length = 0;
      matched.push("*");
    } else if (matched.length === 0) {
      issue(
        "I_ACTION_NOT_SCOPED",
        "info",
        `${name(a)} was left out because none of the ARNs match the resource types it needs: ${a.resources.join(", ")}.`,
      );
      continue;
    } else if (a.resources.length > 1) {
      const missing = a.resources.filter(
        (t) => !covered.has(t) && !ALTERNATE.test(t),
      );
      if (missing.length > 0) {
        issue(
          "W_PARTIAL_RESOURCES",
          "warning",
          `${name(a)} may also need access to: ${missing.join(", ")}.`,
        );
      }
    }
    const key = JSON.stringify(matched);
    const g = groups.get(key);
    if (g) g.actions.push(a);
    else groups.set(key, { arns: matched, actions: [a] });
  }

  for (const g of groups.values()) {
    statements.push({
      Sid: baseSid(svc.key, grant.access, "Scoped"),
      Effect: "Allow",
      Action: actionStrings(g.actions),
      Resource: one(g.arns),
    });
  }
  if (global.length > 0) {
    statements.push({
      Sid: baseSid(svc.key, grant.access, "Global"),
      Effect: "Allow",
      Action: actionStrings(global),
      Resource: "*",
    });
    issue(
      "I_REQUIRES_STAR",
      "info",
      `${global.map(name).join(", ")} do not support resource-level permissions, so they apply to all resources ("*").`,
    );
  }
  return { statements, issues };
}
