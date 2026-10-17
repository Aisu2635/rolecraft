import type { BuildContext } from "./arn";
import type { Catalog } from "./catalog/catalog";
import { buildGenericStatements, type BuildResult } from "./engine/generic";
import { dedupeSids } from "./engine/sid";
import { roleModelSchema, type Grant, type RoleModel } from "./model/model";
import { formatPath } from "./validate/schema";
import { buildTrust } from "./trust/trust";
import type { Issue, PolicyDocument, SlimService, Statement } from "./types";
import {
  LIMITS,
  policySize,
  validateIdentityPolicy,
  validateModelValues,
  validateTrustPolicy,
} from "./validate/policy";

export type GrantBuilder = (grant: Grant, svc: SlimService, ctx: BuildContext) => BuildResult;

export interface GenerateResult {
  policy: PolicyDocument | null;
  trust: PolicyDocument | null;
  issues: Issue[];
  sizes: { policy: number; trust: number };
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

const RANK = { error: 0, warning: 1, info: 2 } as const;

function sortIssues(issues: Issue[]): Issue[] {
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => RANK[a.issue.severity] - RANK[b.issue.severity] || a.index - b.index)
    .map((x) => x.issue);
}

export function generate(
  model: RoleModel,
  catalog: Catalog,
  builders: Record<string, GrantBuilder> = {},
): GenerateResult {
  const parsed = roleModelSchema.safeParse(model);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      policy: null,
      trust: null,
      sizes: { policy: 0, trust: 0 },
      issues: [
        {
          id: "V_SCHEMA",
          severity: "error",
          message: `The role model is malformed: ${first?.message ?? "invalid"}.`,
          path: first ? formatPath(first.path) : "",
        },
      ],
    };
  }
  const issues: Issue[] = [...validateModelValues(model)];
  const ctx: BuildContext = {
    partition: model.partition,
    accountId: model.accountId || undefined,
    region: model.region || undefined,
  };

  const statements: Statement[] = [];
  const internal = (grantId?: string): Issue => ({
    id: "E_INTERNAL",
    severity: "error",
    message: "Something went wrong building this permission. Please report it.",
    ...(grantId !== undefined ? { grantId } : {}),
  });
  const buildGrant = (grant: Grant): void => {
    const svc = catalog.getService(grant.service);
    if (!svc) {
      issues.push({
        id: "E_UNKNOWN_SERVICE",
        severity: "error",
        message: `Unknown service "${grant.service}".`,
        grantId: grant.id,
      });
      return;
    }
    let build: GrantBuilder = buildGenericStatements;
    if (grant.module !== undefined) {
      const b = Object.hasOwn(builders, grant.module) ? builders[grant.module] : undefined;
      if (!b) {
        issues.push({
          id: "E_UNKNOWN_MODULE",
          severity: "error",
          message: `Unknown service module "${grant.module}".`,
          grantId: grant.id,
        });
        return;
      }
      build = b;
    }
    const r = build(grant, svc, ctx);
    statements.push(...r.statements);
    issues.push(...r.issues);
  };
  for (const grant of model.grants) {
    try {
      buildGrant(grant);
    } catch {
      issues.push(internal(grant.id));
    }
  }

  let policy: PolicyDocument | null = null;
  if (statements.length === 0) {
    issues.push({
      id: "I_NO_PERMISSIONS",
      severity: "info",
      message: "No permissions yet. Add a service to generate a policy.",
    });
  } else {
    policy = { Version: "2012-10-17", Statement: dedupeSids(statements) };
    issues.push(...validateIdentityPolicy(policy, catalog));
  }

  let trust: PolicyDocument | null = null;
  try {
    const t = buildTrust(model.trust, ctx);
    issues.push(...t.issues);
    trust = t.doc;
    if (trust) issues.push(...validateTrustPolicy(trust));
  } catch {
    trust = null;
    issues.push(internal());
  }

  const sizes = {
    policy: policy ? policySize(policy) : 0,
    trust: trust ? policySize(trust) : 0,
  };
  const limit = model.policyMode === "managed" ? LIMITS.managed : LIMITS.inline;
  if (sizes.policy > limit) {
    issues.push({
      id: "E_POLICY_TOO_LARGE",
      severity: "error",
      message: `The policy is ${sizes.policy} characters, over the ${limit} limit for ${model.policyMode} policies. Remove permissions or split them across roles.`,
    });
  }
  if (sizes.trust > LIMITS.trust) {
    issues.push({
      id: "E_TRUST_TOO_LARGE",
      severity: "error",
      message: `The trust policy is ${sizes.trust} characters, over the ${LIMITS.trust} limit.`,
    });
  }

  return { policy, trust, issues: sortIssues(issues), sizes };
}
