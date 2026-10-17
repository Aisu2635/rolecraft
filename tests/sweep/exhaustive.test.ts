import { describe, expect, test } from "vitest";
import { generate, type GenerateResult } from "../../src/core/generate";
import type { Grant, RoleModel } from "../../src/core/model/model";
import {
  ACCESS_LEVELS,
  type AccessLevel,
  type Issue,
  type SlimService,
} from "../../src/core/types";
import { KNOWN_QUIRKS } from "./known-quirks";
import { loadCatalog, loadServices, sampleArns } from "./load-data";

const services = loadServices();
const catalog = loadCatalog(services);

function modelFor(grant: Grant): RoleModel {
  return {
    version: 1,
    name: "sweep-role",
    partition: "aws",
    accountId: "123456789012",
    region: "us-east-1",
    trust: { kind: "service", service: "ec2" },
    grants: [grant],
    policyMode: "inline",
    managedPolicyArns: [],
  };
}

function tolerated(service: string, id: string): boolean {
  return KNOWN_QUIRKS.some((q) => q.service === service && q.issueId === id);
}

type ScopeKind = "all" | "arns";

function evaluate(svc: SlimService, level: AccessLevel, scopeKind: ScopeKind): GenerateResult {
  const grant: Grant = {
    id: "g1",
    service: svc.key,
    scope: scopeKind === "all" ? { type: "all" } : { type: "arns", arns: sampleArns(svc) },
    access: { type: "levels", levels: [level] },
  };
  return generate(modelFor(grant), catalog);
}

/** Exact `service:Action` tokens named by I_ACTION_NOT_SCOPED issues (no substring matching). */
export function droppedActions(issues: Issue[]): Set<string> {
  const out = new Set<string>();
  for (const i of issues) {
    if (i.id !== "I_ACTION_NOT_SCOPED") continue;
    const m = /^([a-z0-9-]+:[A-Za-z0-9_-]+) was left out because /.exec(i.message);
    if (m?.[1]) out.add(m[1]);
  }
  return out;
}

function missingActions(svc: SlimService, level: AccessLevel, r: GenerateResult): string[] {
  const inPolicy = new Set<string>();
  for (const s of r.policy?.Statement ?? []) {
    for (const a of ([] as string[]).concat(s.Action)) inPolicy.add(a);
  }
  const dropped = droppedActions(r.issues);
  return svc.actions
    .filter((a) => a.level === level)
    .map((a) => `${svc.key}:${a.name}`)
    .filter((a) => !inPolicy.has(a) && !dropped.has(a));
}

function run(svc: SlimService, level: AccessLevel, scopeKind: ScopeKind): void {
  const r = evaluate(svc, level, scopeKind);
  const bad = r.issues.filter(
    (i) =>
      i.severity === "error" &&
      !(i.id === "L_PASSROLE_STAR" && svc.key === "iam") &&
      i.id !== "E_POLICY_TOO_LARGE" && !tolerated(svc.key, i.id),
  );
  expect(bad).toStrictEqual([]);
  if (scopeKind === "all") expect(r.policy).not.toBeNull();
  expect(missingActions(svc, level, r)).toStrictEqual([]);
  if (scopeKind === "arns") expect(unjustifiedDrops(svc, r)).toStrictEqual([]);
}

/** Dropped actions are only legitimate when sampleArns could not have covered them (no ARN-formatted resource type). */
function unjustifiedDrops(svc: SlimService, r: GenerateResult): string[] {
  const withFormat = new Set(svc.resources.filter((t) => t.arnFormats.length > 0).map((t) => t.name));
  const byName = new Map(svc.actions.map((a) => [`${svc.key}:${a.name}`, a]));
  return [...droppedActions(r.issues)].filter((name) => {
    const a = byName.get(name);
    return !a || a.resources.some((t) => withFormat.has(t));
  });
}

const cases = services.map((svc) => {
  const levels = ACCESS_LEVELS.filter((l) => svc.actions.some((a) => a.level === l));
  return [svc.key, svc, levels] as const;
});

describe.each(cases)("sweep %s", (_key, svc, levels) => {
  test.each(levels.flatMap((l) => (["all", "arns"] as const).map((s) => [l, s] as const)))(
    "level %s, scope %s",
    (level, scope) => {
      run(svc, level, scope);
    },
  );
});

describe("sweep guards", () => {
  test("too-large cases stay rare", { timeout: 20_000 }, () => {
    let total = 0;
    let tooLarge = 0;
    let tooLargeAll = 0;
    for (const [, svc, levels] of cases) {
      for (const level of levels) {
        for (const scope of ["all", "arns"] as const) {
          total++;
          const r = evaluate(svc, level, scope);
          if (r.issues.some((i) => i.id === "E_POLICY_TOO_LARGE")) {
            tooLarge++;
            if (scope === "all") tooLargeAll++;
          }
        }
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(tooLarge).toBeLessThanOrEqual(total * 0.01);
    expect(tooLargeAll).toBeLessThanOrEqual(2);
  });

  test("dropped-action matching is exact, so a longer action name cannot mask a drop", () => {
    const issues: Issue[] = [
      {
        id: "I_ACTION_NOT_SCOPED",
        severity: "info",
        message: "s3:GetObjectAcl was left out because none of the ARNs match the resource types it needs: object.",
      },
    ];
    const dropped = droppedActions(issues);
    expect(dropped.has("s3:GetObjectAcl")).toBe(true);
    expect(dropped.has("s3:GetObject")).toBe(false);
  });

  test("a drop of an action with a sampleable resource type is flagged", () => {
    const svc = services.find((s) => s.key === "s3") as SlimService;
    const withType = svc.actions.find((a) => a.resources.length > 0) as SlimService["actions"][number];
    const r = {
      policy: null,
      trust: null,
      issues: [
        {
          id: "I_ACTION_NOT_SCOPED",
          severity: "info" as const,
          message: `s3:${withType.name} was left out because none of the ARNs match the resource types it needs: x.`,
        },
      ],
      sizes: { policy: 0, trust: 0 },
    };
    expect(unjustifiedDrops(svc, r)).toStrictEqual([`s3:${withType.name}`]);
  });

  test("coverage check runs even when the policy is null", () => {
    const svc = services.find((s) => s.key === "s3");
    expect(svc).toBeDefined();
    const r = { policy: null, trust: null, issues: [], sizes: { policy: 0, trust: 0 } };
    expect(missingActions(svc as SlimService, "Read", r).length).toBeGreaterThan(0);
  });
});
