import { z } from "zod";
import type {
  AccessLevel,
  ServiceIndex,
  SlimAction,
  SlimResource,
  SlimService,
} from "../types";
import { CURATED } from "./curated";

interface AccessProps {
  IsList: boolean;
  IsWrite: boolean;
  IsPermissionManagement: boolean;
  IsTaggingOnly: boolean;
}

export function mapAccessLevel(props: AccessProps | undefined): AccessLevel {
  if (!props) return "Read";
  if (props.IsPermissionManagement) return "Permissions management";
  if (props.IsTaggingOnly) return "Tagging";
  if (props.IsWrite) return "Write";
  if (props.IsList) return "List";
  return "Read";
}

const TOKEN = /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+\d*|[A-Z]+\d*|\d+/g;
const ACRONYM = /^[A-Z]+\d*$/;

export function humanizeActionName(name: string): string {
  const tokens = name.match(TOKEN) ?? [];
  return tokens
    .map((t, i) => {
      if (t.length >= 2 && ACRONYM.test(t)) return t;
      const lower = t.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

// Upstream variance (a missing flag or ARNFormats) must not abort the weekly sync: default them.
const RawAction = z.object({
  Name: z.string(),
  ActionConditionKeys: z.array(z.string()).optional(),
  Annotations: z
    .object({
      Properties: z.object({
        IsList: z.boolean().default(false),
        IsPermissionManagement: z.boolean().default(false),
        IsTaggingOnly: z.boolean().default(false),
        IsWrite: z.boolean().default(false),
      }),
    })
    .optional(),
  Resources: z.array(z.object({ Name: z.string() })).optional(),
});
const RawResource = z.object({
  Name: z.string(),
  ARNFormats: z.array(z.string()).default([]),
  ConditionKeys: z.array(z.string()).optional(),
});
const RawService = z.object({
  Name: z.string(),
  Actions: z.array(RawAction),
  Resources: z.array(RawResource).optional(),
  ConditionKeys: z.array(z.object({ Name: z.string() })).optional(),
});

const sortedUnique = (xs: string[]): string[] => [...new Set(xs)].sort();
const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

function titleCase(key: string): string {
  return key
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function toSlimService(raw: unknown): SlimService {
  const parsed = RawService.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid service JSON: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const svc = parsed.data;
  const curated = CURATED[svc.Name];
  const actions: SlimAction[] = svc.Actions.map((a) => ({
    name: a.Name,
    level: mapAccessLevel(a.Annotations?.Properties),
    resources: sortedUnique((a.Resources ?? []).map((r) => r.Name)),
    label: humanizeActionName(a.Name),
    conditionKeys: sortedUnique(a.ActionConditionKeys ?? []),
  })).sort(byName);
  const resources: SlimResource[] = (svc.Resources ?? [])
    .map((r) => ({
      name: r.Name,
      arnFormats: [...r.ARNFormats],
      conditionKeys: sortedUnique(r.ConditionKeys ?? []),
    }))
    .sort(byName);
  return {
    key: svc.Name,
    name: curated?.name ?? titleCase(svc.Name),
    category: curated?.category ?? "Other",
    actions,
    resources,
    conditionKeys: sortedUnique((svc.ConditionKeys ?? []).map((c) => c.Name)),
  };
}

export function buildIndex(
  services: SlimService[],
  generatedAt: string,
): ServiceIndex {
  return {
    generatedAt,
    services: services
      .map((s) => ({
        key: s.key,
        name: s.name,
        category: s.category,
        actionCount: s.actions.length,
      }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  };
}

export function assertSanity(index: ServiceIndex): void {
  const n = index.services.length;
  if (n < 400)
    throw new Error(
      `Sanity check failed: only ${n} services (expected >= 400)`,
    );
  const keys = new Set(index.services.map((s) => s.key));
  for (const k of ["s3", "ec2", "iam"]) {
    if (!keys.has(k))
      throw new Error(`Sanity check failed: missing required service "${k}"`);
  }
}
