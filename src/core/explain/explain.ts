import type { Catalog } from "../catalog/catalog";
import { MODULES } from "../engine/modules/registry";
import { resolveActions } from "../engine/generic";
import type { Grant, RoleModel } from "../model/model";
import { ACCESS_LEVELS, type SlimService } from "../types";

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1] as string}`;
}

/** Names (without service prefix) of the actions a grant actually allows. */
function grantedActionNames(grant: Grant, svc: SlimService): string[] {
  const mod = grant.module !== undefined ? MODULES[grant.module] : undefined;
  if (mod !== undefined) {
    if (grant.access.type !== "preset") return [];
    const access = grant.access;
    const preset = mod.presets.find((p) => p.id === access.preset);
    return preset ? [...preset.actions] : [];
  }
  return resolveActions(svc, grant.access).actions.map((a) => a.name);
}

function sentence(grant: Grant, svc: SlimService): string | undefined {
  const mod = grant.module !== undefined ? MODULES[grant.module] : undefined;
  if (grant.module !== undefined) {
    if (!mod || grant.scope.type !== "module") return undefined;
    const parsed = mod.dataSchema.safeParse(grant.scope.data);
    return parsed.success ? mod.explain(grant, parsed.data) : undefined;
  }
  if (grant.scope.type === "module" || grant.access.type === "preset") return undefined;
  const { actions } = resolveActions(svc, grant.access);
  if (actions.length === 0) return undefined;
  if (grant.access.type === "actions") {
    const labels = actions.slice(0, 3).map((a) => a.label);
    return `Can use ${actions.length} ${svc.name} actions: ${labels.join(", ")}${actions.length > 3 ? "…" : "."}`;
  }
  const selected = new Set(grant.access.levels);
  const levels = ACCESS_LEVELS.filter((l) => selected.has(l)).map((l) => l.toLowerCase());
  const scope =
    grant.scope.type === "all"
      ? "all resources"
      : grant.scope.arns.length === 1
        ? "1 specific resource"
        : `${grant.scope.arns.length} specific resources`;
  return `Can ${joinAnd(levels)} on ${svc.name} (${scope}).`;
}

export function explain(
  model: RoleModel,
  catalog: Catalog,
): { can: string[]; cannot: string[] } {
  const can: string[] = [];
  const services = new Map<string, { svc: SlimService; granted: Set<string> }>();

  for (const grant of model.grants) {
    try {
      const mod = grant.module !== undefined ? MODULES[grant.module] : undefined;
      const svc = catalog.getService(mod ? mod.service : grant.service);
      if (!svc) continue;
      const s = sentence(grant, svc);
      const entry = services.get(svc.key) ?? { svc, granted: new Set<string>() };
      for (const n of grantedActionNames(grant, svc)) entry.granted.add(`${svc.key}:${n}`);
      services.set(svc.key, entry);
      if (s !== undefined) can.push(s);
    } catch {
      continue;
    }
  }

  const cannot: string[] = [];
  const ordered = [...services.values()].sort((a, b) => byText(a.svc.name, b.svc.name));
  for (const { svc, granted } of ordered) {
    const levelOf = new Map(svc.actions.map((a) => [`${svc.key}:${a.name}`, a.level]));
    const names = [...granted];
    if (!names.some((n) => levelOf.get(n) === "Permissions management")) {
      cannot.push(`Cannot change ${svc.name} permissions.`);
    }
    if (!names.some((n) => n.slice(svc.key.length + 1).startsWith("Delete"))) {
      cannot.push(`Cannot delete ${svc.name} resources.`);
    }
    if (svc.key === "ec2" && !granted.has("ec2:TerminateInstances")) {
      cannot.push("Cannot terminate EC2 instances.");
    }
  }
  return { can, cannot };
}
