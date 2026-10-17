import { isValidArnSyntax } from "../arn-syntax";
import type { Catalog } from "../catalog/catalog";
import { globMatch } from "../glob";
import type { RoleModel } from "../model/model";
import type { AccessLevel, Issue, PolicyDocument, SlimAction, SlimService, Statement } from "../types";

const GITHUB_OIDC_HOST = "token.actions.githubusercontent.com";
const MAX_LISTED = 5;

interface Resolved {
  name: string;
  level?: AccessLevel;
}

/** Sensitive action globs; `needsStar` means only risky when Resource is "*". */
const SENSITIVE_GLOBS: { pattern: string; needsStar: boolean }[] = [
  { pattern: "iam:Create*", needsStar: false },
  { pattern: "iam:Put*", needsStar: false },
  { pattern: "iam:Attach*", needsStar: false },
  { pattern: "iam:Update*", needsStar: false },
  { pattern: "iam:Delete*", needsStar: false },
  { pattern: "sts:AssumeRole", needsStar: true },
];
/** Sensitive only when granted as a full service wildcard. */
const SENSITIVE_FULL = ["kms:*", "organizations:*"];

const strs = (x: unknown): string[] =>
  typeof x === "string" ? [x] : Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];

const hasStar = (resource: unknown): boolean => strs(resource).includes("*");

function list(names: string[]): string {
  const sorted = [...new Set(names)].sort();
  const shown = sorted.slice(0, MAX_LISTED).join(", ");
  return sorted.length > MAX_LISTED ? `${shown}, and ${sorted.length - MAX_LISTED} more` : shown;
}

const indexCache = new WeakMap<SlimService, Map<string, SlimAction>>();
function actionIndex(svc: SlimService): Map<string, SlimAction> {
  let m = indexCache.get(svc);
  if (!m) {
    m = new Map(svc.actions.map((a) => [a.name.toLowerCase(), a]));
    indexCache.set(svc, m);
  }
  return m;
}

/** Concrete actions a granted string covers, or "all" for "*". Unknown services expand to nothing. */
function resolve(granted: string, catalog: Catalog): Resolved[] | "all" {
  if (granted === "*") return "all";
  const colon = granted.indexOf(":");
  if (colon < 0) return [];
  if (!/[*?]/.test(granted)) {
    const svc = catalog.getService(granted.slice(0, colon).toLowerCase());
    const hit = svc ? actionIndex(svc).get(granted.slice(colon + 1).toLowerCase()) : undefined;
    return [hit ? { name: granted, level: hit.level } : { name: granted }];
  }
  const svc = catalog.getService(granted.slice(0, colon).toLowerCase());
  if (!svc) return [];
  const g = granted.toLowerCase();
  return svc.actions
    .filter((a) => globMatch(g, `${svc.key}:${a.name}`.toLowerCase()))
    .map((a) => ({ name: `${svc.key}:${a.name}`, level: a.level }));
}

function lintStatement(s: Statement, index: number, catalog: Catalog): Issue[] {
  if (s.Effect !== "Allow") return [];
  const issues: Issue[] = [];
  const path = `Statement[${index}]`;
  const actions = strs(s.Action);
  const star = hasStar(s.Resource);

  const passRole = actions.filter((a) => globMatch(a.toLowerCase(), "iam:passrole"));
  if (star && passRole.length > 0) {
    issues.push({
      id: "L_PASSROLE_STAR",
      severity: "error",
      message: `${list(passRole)} on Resource "*" lets this role pass any IAM role to an AWS service, which can escalate privileges. Restrict it to specific role ARNs.`,
      path,
    });
  }

  const wild = actions.filter((a) => a === "*" || /^[A-Za-z0-9-]+:\*$/.test(a));
  if (wild.length > 0) {
    issues.push({
      id: "L_ACTION_STAR",
      severity: "warning",
      message: `${list(wild)} grants every action ${wild.includes("*") ? "in AWS" : "in the service"}. List only the actions this role needs.`,
      path,
    });
  }

  const memo = new Map<string, Resolved[] | "all">();
  const resolveOnce = (a: string): Resolved[] | "all" => {
    let r = memo.get(a);
    if (r === undefined) {
      r = resolve(a, catalog);
      memo.set(a, r);
    }
    return r;
  };
  const resolved = (): { granted: string; r: Resolved[] | "all" }[] =>
    actions.map((a) => ({ granted: a, r: resolveOnce(a) }));

  if (star) {
    const names: string[] = [];
    for (const { r } of resolved()) {
      if (r === "all") names.push("all actions (*)");
      else {
        for (const a of r) {
          const bare = a.name.slice(a.name.indexOf(":") + 1);
          if (a.level === "Permissions management" || /^(Delete|Terminate)/.test(bare)) names.push(a.name);
        }
      }
    }
    if (names.length > 0) {
      issues.push({
        id: "L_DESTRUCTIVE_STAR",
        severity: "warning",
        message: `${list(names)} can delete resources or change permissions on Resource "*" (every resource in the account). Scope it to specific ARNs.`,
        path,
      });
    }
  }

  const sensitive: string[] = [];
  for (const granted of actions) {
    const g = granted.toLowerCase();
    if (g === "*" || SENSITIVE_FULL.includes(g)) sensitive.push(granted);
    if (!/^(iam|sts):|[*?]/i.test(g)) continue;
    const r = resolveOnce(granted);
    if (r === "all") continue;
    for (const a of r) {
      const lower = a.name.toLowerCase();
      if (SENSITIVE_GLOBS.some((p) => (star || !p.needsStar) && globMatch(p.pattern.toLowerCase(), lower))) {
        sensitive.push(a.name);
      }
    }
  }
  if (sensitive.length > 0) {
    issues.push({
      id: "L_SENSITIVE",
      severity: "warning",
      message: `${list(sensitive)} are sensitive permissions that can change IAM, assume other roles, or manage keys and accounts. Confirm this role needs them.`,
      path,
    });
  }
  return issues;
}

function containsUsername(policy: PolicyDocument): boolean {
  const needle = "${aws:username}";
  const has = (v: unknown): boolean => strs(v).some((x) => x.toLowerCase().includes(needle));
  return policy.Statement.some((s) => {
    if (has(s.Resource)) return true;
    return Object.values(s.Condition ?? {}).some((block) => Object.values(block).some(has));
  });
}

function lintGithubSaml(trust: PolicyDocument): Issue[] {
  const issues: Issue[] = [];
  trust.Statement.forEach((s, i) => {
    const p = s.Principal;
    const federated = p && p !== "*" ? strs(p["Federated"]) : [];
    if (
      federated.some((f) => f.includes(GITHUB_OIDC_HOST)) &&
      strs(s.Action).some((a) => a.toLowerCase() === "sts:assumerolewithsaml")
    ) {
      issues.push({
        id: "L_GITHUB_SAML",
        severity: "error",
        message:
          "GitHub Actions uses OIDC, so its provider must be used with sts:AssumeRoleWithWebIdentity, not sts:AssumeRoleWithSAML.",
        path: `Statement[${i}]`,
      });
    }
  });
  return issues;
}

function lintUnusedArns(model: RoleModel, policy: PolicyDocument): Issue[] {
  const used = new Set(policy.Statement.flatMap((s) => strs(s.Resource)));
  const issues: Issue[] = [];
  for (const g of model.grants) {
    if (g.scope.type !== "arns") continue;
    const seen = new Set<string>();
    for (const raw of g.scope.arns) {
      const arn = raw.trim();
      if (arn === "" || arn === "*" || seen.has(arn) || !isValidArnSyntax(arn)) continue;
      seen.add(arn);
      if (!used.has(arn)) {
        issues.push({
          id: "L_UNUSED_ARN",
          severity: "info",
          message: `${arn} is not used by any ${g.service} permission, because none of the selected actions apply to that resource type.`,
          grantId: g.id,
        });
      }
    }
  }
  return issues;
}

export function lint(
  model: RoleModel,
  policy: PolicyDocument | null,
  trust: PolicyDocument | null,
  catalog: Catalog,
): Issue[] {
  try {
    const issues: Issue[] = [];
    if (policy) {
      policy.Statement.forEach((s, i) => issues.push(...lintStatement(s, i, catalog)));
      if (model.trust.kind !== "principal" && containsUsername(policy)) {
        issues.push({
          id: "L_USERNAME_IN_ROLE",
          severity: "warning",
          message:
            "${aws:username} is empty for role sessions, so these statements grant nothing to this role. Use ${aws:userid} or ${aws:PrincipalTag/<key>}.",
        });
      }
      issues.push(...lintUnusedArns(model, policy));
    }
    if (trust) issues.push(...lintGithubSaml(trust));
    return issues;
  } catch {
    return [];
  }
}
