import { describe, expect, test } from "vitest";
import { generate } from "../../src/core/generate";
import type { Grant, RoleModel } from "../../src/core/model/model";
import { ACCESS_LEVELS, type AccessLevel, type SlimService } from "../../src/core/types";
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

function run(svc: SlimService, level: AccessLevel, scopeKind: "all" | "arns"): void {
  const grant: Grant = {
    id: "g1",
    service: svc.key,
    scope: scopeKind === "all" ? { type: "all" } : { type: "arns", arns: sampleArns(svc) },
    access: { type: "levels", levels: [level] },
  };
  const r = generate(modelFor(grant), catalog);
  const bad = r.issues.filter(
    (i) =>
      i.severity === "error" && i.id !== "E_POLICY_TOO_LARGE" && !tolerated(svc.key, i.id),
  );
  expect(bad).toStrictEqual([]);
  if (scopeKind === "all") expect(r.policy).not.toBeNull();

  const selected = svc.actions.filter((a) => a.level === level).map((a) => `${svc.key}:${a.name}`);
  if (r.policy) {
    const inPolicy = new Set<string>();
    for (const s of r.policy.Statement) {
      for (const a of ([] as string[]).concat(s.Action)) inPolicy.add(a);
    }
    const notScoped = r.issues.filter((i) => i.id === "I_ACTION_NOT_SCOPED");
    const missing = selected.filter(
      (a) => !inPolicy.has(a) && !notScoped.some((i) => i.message.includes(a)),
    );
    expect(missing).toStrictEqual([]);
  }
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
