import type { SlimService } from "./types";

export interface BuildContext {
  partition: "aws";
  accountId?: string;
  region?: string;
}

const PLACEHOLDER = /\$\{([A-Za-z0-9]+)\}/g;

export function fillArn(
  format: string,
  values: Record<string, string>,
  ctx: BuildContext,
): string {
  return format.replace(PLACEHOLDER, (_m, name: string) => {
    if (name === "Partition") return ctx.partition;
    if (name === "Region") return ctx.region ?? "*";
    if (name === "Account") return ctx.accountId ?? "*";
    return values[name] ?? "*";
  });
}

interface Compiled {
  resource: string;
  regex: RegExp;
  literalCount: number;
}

const cache = new WeakMap<SlimService, Compiled[]>();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function placeholderRegex(name: string): string {
  if (name === "Partition") return "aws";
  if (name === "Region") return String.raw`(?:[a-z0-9-]+|\*)`;
  if (name === "Account") return String.raw`(?:\d{12}|\*)?`;
  return ".+";
}

function compileFormat(format: string): {
  regex: RegExp;
  literalCount: number;
} {
  let source = "";
  let last = 0;
  let literalCount = 0;
  for (const m of format.matchAll(PLACEHOLDER)) {
    const literal = format.slice(last, m.index);
    literalCount += literal.length;
    source += escapeRegex(literal) + placeholderRegex(m[1] as string);
    last = m.index + m[0].length;
  }
  const tail = format.slice(last);
  literalCount += tail.length;
  source += escapeRegex(tail);
  return { regex: new RegExp(`^${source}$`), literalCount };
}

function compiled(svc: SlimService): Compiled[] {
  let c = cache.get(svc);
  if (!c) {
    c = svc.resources.flatMap((r) =>
      r.arnFormats.map((f) => ({ resource: r.name, ...compileFormat(f) })),
    );
    cache.set(svc, c);
  }
  return c;
}

/**
 * Resource-type names whose ARN format matches `arn`, restricted to those whose
 * best matching format has the greatest literal character count. Sorted.
 */
export function classifyArn(arn: string, svc: SlimService): string[] {
  const best = new Map<string, number>();
  for (const c of compiled(svc)) {
    if (!c.regex.test(arn)) continue;
    best.set(c.resource, Math.max(best.get(c.resource) ?? 0, c.literalCount));
  }
  const max = Math.max(0, ...best.values());
  return [...best]
    .filter(([, n]) => n === max)
    .map(([name]) => name)
    .sort();
}
