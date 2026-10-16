import type { Catalog } from "../catalog/catalog";
import { matchableTypes } from "../arn";
import { globMatch } from "../glob";
import type { Issue, SlimAction, SlimService, Statement } from "../types";
import {
  isGlobalKey,
  isKnownConditionOperator,
  isTrustKey,
  keyMatchesTemplate,
} from "./conditions";
import { parseDocument, toList } from "./schema";

export { LIMITS, policySize } from "./size";
export { isKnownConditionOperator, GLOBAL_CONDITION_KEYS } from "./conditions";
export { validateModelValues } from "./values";

const ACTION_FORMAT = /^[a-z0-9-]+:[A-Za-z0-9*?_-]+$/;
const MAX_LISTED = 5;
const MAX_ACTION_LENGTH = 256;

function err(id: string, message: string, path: string): Issue {
  return { id, severity: "error", message, path };
}

function listed(items: string[]): string {
  const shown = items.slice(0, MAX_LISTED).join(", ");
  return items.length > MAX_LISTED ? `${shown} and ${items.length - MAX_LISTED} more` : shown;
}

interface MatchedAction {
  service: SlimService;
  action: SlimAction;
}

/** Checks the operator names and returns the (operator, key) pairs of a Condition block. */
function conditionEntries(
  statement: Statement,
  base: string,
  issues: Issue[],
): { key: string; path: string }[] {
  const keys: { key: string; path: string }[] = [];
  for (const [op, block] of Object.entries(statement.Condition ?? {})) {
    if (!isKnownConditionOperator(op)) {
      issues.push(err("V_CONDITION_OPERATOR", `"${op}" is not a valid condition operator.`, `${base}.Condition.${op}`));
    }
    for (const key of Object.keys(block)) keys.push({ key, path: `${base}.Condition.${op}.${key}` });
  }
  return keys;
}

function validateIdentityStatement(
  statement: Statement,
  index: number,
  catalog: Catalog,
  issues: Issue[],
): void {
  const base = `Statement[${index}]`;
  if (statement.Principal !== undefined) {
    issues.push(err("V_SCHEMA", "Identity policies cannot contain Principal.", `${base}.Principal`));
  }
  if (statement.Resource === undefined) {
    issues.push(err("V_SCHEMA", "Identity policy statements need a Resource.", `${base}.Resource`));
  }

  const matched: MatchedAction[] = [];
  let hasFullWildcard = false;
  toList(statement.Action).forEach((action) => {
    const path = `${base}.Action`;
    if (action === "*") {
      hasFullWildcard = true;
      return;
    }
    if (action.length > MAX_ACTION_LENGTH || !ACTION_FORMAT.test(action)) {
      issues.push(err("V_ACTION_FORMAT", `"${action.slice(0, 64)}" is not a valid action. Use lowercase service prefix and an action name, like s3:GetObject.`, path));
      return;
    }
    const colon = action.indexOf(":");
    const key = action.slice(0, colon);
    const name = action.slice(colon + 1);
    const service = catalog.getService(key);
    if (!service) {
      issues.push(err("V_UNKNOWN_SERVICE", `Unknown service "${key}" in "${action}".`, path));
      return;
    }
    const hits = service.actions.filter((a) => globMatch(name, a.name));
    if (hits.length === 0) {
      issues.push(err("V_UNKNOWN_ACTION", `"${action}" matches no action in ${key}.`, path));
      return;
    }
    for (const a of hits) matched.push({ service, action: a });
  });

  if (statement.Resource !== undefined && !hasFullWildcard) {
    const arns = toList(statement.Resource).filter((r) => r !== "*");
    const badActions = new Set<string>();
    const badArns = new Set<string>();
    const needs = new Set<string>();
    const typeCache = new Map<string, string[]>();
    const typesFor = (arn: string, service: SlimService): string[] => {
      const k = `${service.key}|${arn}`;
      let t = typeCache.get(k);
      if (!t) {
        t = matchableTypes(arn, service);
        typeCache.set(k, t);
      }
      return t;
    };
    for (const arn of arns) {
      for (const { service, action } of matched) {
        const compatible =
          action.resources.length > 0 && typesFor(arn, service).some((t) => action.resources.includes(t));
        if (compatible) continue;
        badActions.add(`${service.key}:${action.name}`);
        badArns.add(arn);
        needs.add(action.resources.length > 0 ? action.resources.join("/") : "no resource type (needs Resource \"*\")");
      }
    }
    if (badActions.size > 0) {
      issues.push(
        err(
          "V_ACTION_RESOURCE_MISMATCH",
          `${listed([...badActions])} cannot be used with ${listed([...badArns])}; it needs a resource of type ${listed([...needs])}.`,
          `${base}.Resource`,
        ),
      );
    }
  }

  for (const { key, path } of conditionEntries(statement, base, issues)) {
    if (isGlobalKey(key)) continue;
    if (hasFullWildcard) {
      const prefix = key.slice(0, key.indexOf(":")).toLowerCase();
      if (key.includes(":") && catalog.hasService(prefix)) continue;
    } else if (matched.some((m) => actionSupportsKey(m, key))) {
      continue;
    }
    issues.push(err("V_CONDITION_KEY", `Condition key "${key}" is not supported by the actions in this statement.`, path));
  }
}

function actionSupportsKey({ service, action }: MatchedAction, key: string): boolean {
  const types = service.resources.filter((r) => action.resources.includes(r.name));
  const candidates = [...action.conditionKeys, ...types.flatMap((t) => t.conditionKeys), ...service.conditionKeys];
  return candidates.some((c) => keyMatchesTemplate(key, c));
}

export function validateIdentityPolicy(doc: unknown, catalog: Catalog): Issue[] {
  const { issues, statements } = parseDocument(doc);
  for (const { index, statement } of statements) {
    validateIdentityStatement(statement, index, catalog, issues);
  }
  return issues;
}

const TRUST_ACTIONS = new Set([
  "sts:AssumeRole",
  "sts:AssumeRoleWithWebIdentity",
  "sts:AssumeRoleWithSAML",
  "sts:TagSession",
  "sts:SetSourceIdentity",
]);
const PRINCIPAL_TYPES = new Set(["AWS", "Service", "Federated", "CanonicalUser"]);
const GITHUB_HOST = "token.actions.githubusercontent.com";

function validateTrustStatement(statement: Statement, index: number, issues: Issue[]): void {
  const base = `Statement[${index}]`;
  const principal = statement.Principal;
  let federated: string[] = [];
  if (principal === undefined) {
    issues.push(err("V_TRUST_PRINCIPAL", "Trust statement needs a Principal.", `${base}.Principal`));
  } else if (principal === "*") {
    issues.push(err("V_TRUST_PRINCIPAL", 'Principal "*" would let anyone assume this role.', `${base}.Principal`));
  } else {
    const entries = Object.entries(principal);
    if (entries.length === 0) {
      issues.push(err("V_TRUST_PRINCIPAL", "Principal is empty.", `${base}.Principal`));
    }
    for (const [type, value] of entries) {
      if (!PRINCIPAL_TYPES.has(type)) {
        issues.push(err("V_TRUST_PRINCIPAL", `Unsupported principal type "${type}".`, `${base}.Principal.${type}`));
      } else if (type === "AWS" && toList(value).includes("*")) {
        issues.push(err("V_TRUST_PRINCIPAL", 'Principal AWS "*" would let any AWS account assume this role.', `${base}.Principal.AWS`));
      }
    }
    federated = principal["Federated"] === undefined ? [] : toList(principal["Federated"]);
  }

  const actions = toList(statement.Action);
  for (const action of actions) {
    if (!TRUST_ACTIONS.has(action)) {
      issues.push(err("V_TRUST_ACTION", `"${action}" is not a valid trust policy action.`, `${base}.Action`));
    }
  }
  if (federated.length > 0 && !actions.some((a) => a === "sts:AssumeRoleWithWebIdentity" || a === "sts:AssumeRoleWithSAML")) {
    issues.push(err("V_TRUST_ACTION", "A Federated principal requires sts:AssumeRoleWithWebIdentity or sts:AssumeRoleWithSAML.", `${base}.Action`));
  }
  if (statement.Resource !== undefined) {
    issues.push(err("V_TRUST_HAS_RESOURCE", "Trust policies must not contain Resource.", `${base}.Resource`));
  }

  const keys = conditionEntries(statement, base, issues);
  for (const { key, path } of keys) {
    if (!isTrustKey(key)) {
      issues.push(err("V_CONDITION_KEY", `Condition key "${key}" is not supported in a trust policy.`, path));
    }
  }
  const subKey = `${GITHUB_HOST}:sub`;
  if (
    federated.some((f) => f.includes(`oidc-provider/${GITHUB_HOST}`)) &&
    !keys.some(({ key }) => key.toLowerCase() === subKey)
  ) {
    issues.push(err("V_GITHUB_SUB_MISSING", `GitHub trust must restrict ${subKey} to a repository.`, `${base}.Condition`));
  }
}

export function validateTrustPolicy(doc: unknown): Issue[] {
  const { issues, statements } = parseDocument(doc);
  for (const { index, statement } of statements) {
    validateTrustStatement(statement, index, issues);
  }
  return issues;
}
