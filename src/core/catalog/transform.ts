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

const ACCESS_FLAGS = ["IsList", "IsWrite", "IsPermissionManagement", "IsTaggingOnly"] as const;

/** The four flags when all are booleans; undefined (unclassifiable) when Annotations, Properties or any flag is missing. */
function accessProps(annotations: { Properties?: Record<string, unknown> } | undefined): AccessProps | undefined {
  const p = annotations?.Properties;
  if (!p || !ACCESS_FLAGS.every((k) => typeof p[k] === "boolean")) return undefined;
  return p as unknown as AccessProps;
}

export function mapAccessLevel(props: AccessProps): AccessLevel {
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

// Upstream variance must not abort the weekly sync, so the access flags parse loosely here; accessProps() then
// fails closed: an action missing any flag is dropped (never defaulted to Read). A missing ARNFormats is just [].
const RawAction = z.object({
  Name: z.string(),
  ActionConditionKeys: z.array(z.string()).optional(),
  Annotations: z.object({ Properties: z.record(z.string(), z.unknown()).optional() }).optional(),
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

/** The slim service plus the (sorted) names of actions dropped because their access level is unknown. */
export interface TransformResult {
  service: SlimService;
  dropped: string[];
}

export function toSlimService(raw: unknown): SlimService {
  return transformService(raw).service;
}

export function transformService(raw: unknown): TransformResult {
  const parsed = RawService.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid service JSON: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const svc = parsed.data;
  const curated = CURATED[svc.Name];
  const dropped: string[] = [];
  const actions: SlimAction[] = [];
  for (const a of svc.Actions) {
    const props = accessProps(a.Annotations);
    if (!props) {
      dropped.push(a.Name);
      continue;
    }
    actions.push({
      name: a.Name,
      level: mapAccessLevel(props),
      resources: sortedUnique((a.Resources ?? []).map((r) => r.Name)),
      label: humanizeActionName(a.Name),
      conditionKeys: sortedUnique(a.ActionConditionKeys ?? []),
    });
  }
  actions.sort(byName);
  const resources: SlimResource[] = (svc.Resources ?? [])
    .map((r) => ({
      name: r.Name,
      arnFormats: [...r.ARNFormats],
      conditionKeys: sortedUnique(r.ConditionKeys ?? []),
    }))
    .sort(byName);
  const service: SlimService = {
    key: svc.Name,
    name: curated?.name ?? titleCase(svc.Name),
    category: curated?.category ?? "Other",
    actions,
    resources,
    conditionKeys: sortedUnique((svc.ConditionKeys ?? []).map((c) => c.Name)),
  };
  return { service, dropped: dropped.sort() };
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
