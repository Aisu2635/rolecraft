import type { Catalog } from "../catalog/catalog";
import { MODULES } from "../engine/modules/registry";
import { resolveActions } from "../engine/generic";
import type { Grant, RoleModel } from "../model/model";
import { isDeletion } from "../destructive";
import type { Module } from "../engine/modules/types";
import { ACCESS_LEVELS, type SlimService } from "../types";

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1] as string}`;
}

interface Contribution {
  /** Action names (without service prefix) the grant actually allows. */
  names: string[];
  text?: string;
}

/** What a module grant produces: nothing unless it would really build output. */
function moduleContribution(grant: Grant, mod: Module | undefined): Contribution {
  const none: Contribution = { names: [] };
  if (!mod || grant.service !== mod.service) return none;
  const access = grant.access;
  if (access.type !== "preset") return none;
  const preset = mod.presets.find((p) => p.id === access.preset);
  if (!preset || grant.scope.type !== "module") return none;
  const parsed = mod.dataSchema.safeParse(grant.scope.data);
  if (!parsed.success) return none;
  return { names: [...preset.actions], text: mod.explain(grant, parsed.data) };
}

function sentence(grant: Grant, svc: SlimService): string | undefined {
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
): { can: { grantId: string; text: string }[]; cannot: string[] } {
  const can: { grantId: string; text: string }[] = [];
  const services = new Map<string, { svc: SlimService; granted: Set<string> }>();

  for (const grant of model.grants) {
    try {
      const isModule = grant.module !== undefined;
      const mod = isModule ? MODULES[grant.module as string] : undefined;
      if (isModule && mod !== undefined && grant.service !== mod.service) continue;
      const svc = catalog.getService(grant.service);
      if (!svc) continue;
      let names: string[];
      let text: string | undefined;
      if (isModule) {
        ({ names, text } = moduleContribution(grant, mod));
      } else {
        names = resolveActions(svc, grant.access).actions.map((a) => a.name);
        text = sentence(grant, svc);
      }
      const entry = services.get(svc.key) ?? { svc, granted: new Set<string>() };
      for (const n of names) entry.granted.add(`${svc.key}:${n}`);
      services.set(svc.key, entry);
      if (text !== undefined) can.push({ grantId: grant.id, text });
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
    if (!names.some((n) => isDeletion(n))) {
      cannot.push(`Cannot delete ${svc.name} resources.`);
    }
    if (svc.key === "ec2" && !granted.has("ec2:TerminateInstances")) {
      cannot.push("Cannot terminate EC2 instances.");
    }
  }
  return { can, cannot };
}
