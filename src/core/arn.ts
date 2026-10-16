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

const MAX_ARN_LENGTH = 2048;

/** Pattern element: a literal char, "any" (exactly one arbitrary char) or "star" (zero or more). */
type Elem = string | typeof ANY | typeof STAR;
const ANY = Symbol("any");
const STAR = Symbol("star");

type Field =
  | { kind: "partition" }
  | { kind: "region" }
  | { kind: "account" }
  | { kind: "glob"; pattern: Elem[] };

interface Compiled {
  resource: string;
  header: Field[]; // partition, service, region, account
  pattern: Elem[]; // resource field
  literalCount: number;
}

const cache = new WeakMap<SlimService, Compiled[]>();

/** Split on the first `count` colons; the last part keeps any remaining colons. */
function splitFields(s: string, count: number): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const idx = s.indexOf(":", start);
    if (idx === -1) break;
    parts.push(s.slice(start, idx));
    start = idx + 1;
  }
  parts.push(s.slice(start));
  return parts;
}

function toPattern(text: string): Elem[] {
  const out: Elem[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    out.push(...text.slice(last, m.index));
    out.push(ANY, STAR); // one-or-more arbitrary characters
    last = m.index + m[0].length;
  }
  out.push(...text.slice(last));
  return out;
}

function toField(text: string): Field {
  if (text === "${Partition}") return { kind: "partition" };
  if (text === "${Region}") return { kind: "region" };
  if (text === "${Account}") return { kind: "account" };
  return { kind: "glob", pattern: toPattern(text) };
}

/** Linear-space, O(n*m) worst-case glob match with backtrack-to-last-star. */
function globMatch(pattern: Elem[], text: string): boolean {
  let p = 0;
  let t = 0;
  let starP = -1;
  let starT = 0;
  while (t < text.length) {
    const e = pattern[p];
    if (e === STAR) {
      starP = p++;
      starT = t;
    } else if (e !== undefined && (e === ANY || e === text[t])) {
      p++;
      t++;
    } else if (starP !== -1) {
      p = starP + 1;
      t = ++starT;
    } else {
      return false;
    }
  }
  while (pattern[p] === STAR) p++;
  return p === pattern.length;
}

function isLowerAlnumDash(s: string): boolean {
  if (s.length === 0) return false;
  for (const ch of s) {
    const ok =
      (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === "-";
    if (!ok) return false;
  }
  return true;
}

function isDigits12(s: string): boolean {
  if (s.length !== 12) return false;
  for (const ch of s) if (ch < "0" || ch > "9") return false;
  return true;
}

function fieldMatches(f: Field, v: string): boolean {
  switch (f.kind) {
    case "partition":
      return v === "aws";
    case "region":
      return v === "*" || isLowerAlnumDash(v);
    case "account":
      return v === "" || v === "*" || isDigits12(v);
    case "glob":
      return globMatch(f.pattern, v);
  }
}

function compile(resource: string, format: string): Compiled | undefined {
  const f = splitFields(format, 5);
  if (f.length !== 6 || f[0] !== "arn") return undefined;
  const [, partition, service, region, account, res] = f as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  return {
    resource,
    header: [partition, service, region, account].map(toField),
    pattern: toPattern(res),
    literalCount: format.replace(PLACEHOLDER, "").length,
  };
}

function compiled(svc: SlimService): Compiled[] {
  let c = cache.get(svc);
  if (!c) {
    c = svc.resources.flatMap((r) =>
      r.arnFormats.flatMap((fmt) => compile(r.name, fmt) ?? []),
    );
    cache.set(svc, c);
  }
  return c;
}

/**
 * Resource-type names whose ARN format matches `arn`, restricted to those whose
 * best matching format has the greatest literal character count. Sorted.
 * Matching uses a polynomial-bounded glob matcher; no RegExp touches user input.
 */
export function classifyArn(arn: string, svc: SlimService): string[] {
  if (arn.length > MAX_ARN_LENGTH) return [];
  const parts = splitFields(arn, 5);
  if (parts.length !== 6 || parts[0] !== "arn") return [];
  const best = new Map<string, number>();
  for (const c of compiled(svc)) {
    const ok =
      c.header.every((f, i) => fieldMatches(f, parts[i + 1] as string)) &&
      globMatch(c.pattern, parts[5] as string);
    if (ok)
      best.set(c.resource, Math.max(best.get(c.resource) ?? 0, c.literalCount));
  }
  const max = Math.max(0, ...best.values());
  return [...best]
    .filter(([, n]) => n === max)
    .map(([name]) => name)
    .sort();
}
