import { MODULES } from "../core/engine/modules/registry";
import { newGrantId, type Grant, type RoleModel, type Trust } from "../core/model/model";
import { ACCESS_LEVELS, type AccessLevel, type SlimService } from "../core/types";

export type ModelFields = Partial<
  Pick<RoleModel, "name" | "accountId" | "region" | "policyMode" | "managedPolicyArns">
>;

export function setFields(m: RoleModel, patch: ModelFields): RoleModel {
  const out: RoleModel = { ...m, ...patch };
  if (out.accountId === "") delete out.accountId;
  if (out.region === "") delete out.region;
  return out;
}

export function setTrust(m: RoleModel, trust: Trust): RoleModel {
  return { ...m, trust };
}

export function addGrant(m: RoleModel, g: Grant): RoleModel {
  return { ...m, grants: [...m.grants, g] };
}

export function updateGrant(m: RoleModel, id: string, f: (g: Grant) => Grant): RoleModel {
  if (!m.grants.some((g) => g.id === id)) return m;
  return { ...m, grants: m.grants.map((g) => (g.id === id ? f(g) : g)) };
}

export function removeGrant(m: RoleModel, id: string): RoleModel {
  return { ...m, grants: m.grants.filter((g) => g.id !== id) };
}

export function moduleFor(serviceKey: string): string | undefined {
  return Object.keys(MODULES).find((id) => MODULES[id]?.service === serviceKey);
}

const MODULE_DEFAULTS: Record<string, () => unknown> = {
  s3: () => ({ bucket: "", prefixes: [""] }),
  ec2: () => ({ selector: { type: "tag", key: "", value: "" } }),
  ecr: () => ({ repository: "" }),
  eks: () => ({ cluster: "" }),
  lambda: () => ({ functionName: "" }),
  dynamodb: () => ({ table: "" }),
  logs: () => ({ logGroup: "" }),
  secretsmanager: () => ({ secretName: "" }),
  kms: () => ({ keyArn: "" }),
  sqs: () => ({ queueName: "" }),
};

export function defaultModuleData(moduleId: string): unknown {
  return MODULE_DEFAULTS[moduleId]?.() ?? {};
}

export function newGrantFor(svc: SlimService): Grant {
  const id = newGrantId();
  const moduleId = moduleFor(svc.key);
  const mod = moduleId ? MODULES[moduleId] : undefined;
  if (moduleId && mod) {
    const first = mod.presets[0];
    return {
      id,
      service: svc.key,
      module: moduleId,
      scope: { type: "module", data: defaultModuleData(moduleId) },
      access: { type: "preset", preset: first ? first.id : "" },
    };
  }
  const has = (l: AccessLevel) => svc.actions.some((a) => a.level === l);
  const level: AccessLevel | undefined = has("Read") ? "Read" : ACCESS_LEVELS.find(has);
  return {
    id,
    service: svc.key,
    scope: svc.actions.some((a) => a.resources.length > 0) ? { type: "arns", arns: [] } : { type: "all" },
    access: { type: "levels", levels: level ? [level] : [] },
  };
}

export function defaultTrust(kind: Trust["kind"]): Trust {
  switch (kind) {
    case "service":
      return { kind: "service", service: "ec2" };
    case "github":
      return { kind: "github", owner: "", repo: "", ref: { type: "branch", value: "main" } };
    case "account":
      return { kind: "account", accountId: "" };
    case "principal":
      return { kind: "principal", target: "group", name: "" };
  }
}
