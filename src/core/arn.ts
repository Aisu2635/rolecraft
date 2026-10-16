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

/** Characters a placeholder may not match, by placeholder name (default: none). */
const EXCLUDED: Record<string, string> = {
  BucketName: "/:",
  AccessPointName: "/:",
  FunctionName: "/:",
  TableName: "/:",
  QueueName: "/:",
  TopicName: "/:",
  LogGroupName: ":",
};

/** Format-side token: a literal char, or a placeholder (one-or-more of an allowed set). */
type FTok = { lit: string } | { ph: string; star: boolean };

function formatTokens(text: string): FTok[] {
  const out: FTok[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    for (const ch of text.slice(last, m.index)) out.push({ lit: ch });
    out.push({ ph: m[1] as string, star: false }, { ph: m[1] as string, star: true });
    last = m.index + m[0].length;
  }
  for (const ch of text.slice(last)) out.push({ lit: ch });
  return out;
}

/** Can some character be consumed by both the ARN glob char and the format token? */
function compatible(a: string, f: FTok): boolean {
  const arnAny = a === "*" || a === "?";
  if ("lit" in f) return arnAny || a === f.lit;
  return arnAny || !(EXCLUDED[f.ph] ?? "").includes(a);
}

/**
 * Whether the language of an ARN-side glob (`*`, `?`) and a format (literals and
 * placeholders) intersect. Iterative reachability over the product automaton,
 * O(n*m) time and space.
 */
function intersects(arn: string, fmt: FTok[]): boolean {
  const n = arn.length;
  const m = fmt.length;
  const seen = new Uint8Array((n + 1) * (m + 1));
  const stack: number[] = [0];
  seen[0] = 1;
  const visit = (i: number, j: number): void => {
    const k = i * (m + 1) + j;
    if (!seen[k]) {
      seen[k] = 1;
      stack.push(k);
    }
  };
  while (stack.length > 0) {
    const k = stack.pop() as number;
    const i = Math.floor(k / (m + 1));
    const j = k % (m + 1);
    if (i === n && j === m) return true;
    const a = i < n ? (arn[i] as string) : undefined;
    const f = j < m ? (fmt[j] as FTok) : undefined;
    const arnStar = a === "*";
    const fmtStar = f !== undefined && "ph" in f && f.star;
    if (a !== undefined && arnStar) visit(i + 1, j);
    if (f !== undefined && fmtStar) visit(i, j + 1);
    if (a !== undefined && f !== undefined && compatible(a, f)) {
      visit(arnStar ? i : i + 1, fmtStar ? j : j + 1);
    }
  }
  return false;
}

const hasWildcard = (s: string): boolean => s.includes("*") || s.includes("?");

type HeaderTok = "partition" | "region" | "account" | FTok[];

interface TokenizedFormat {
  resource: string;
  header: HeaderTok[]; // partition, service, region, account
  res: FTok[];
}

const tokenCache = new WeakMap<SlimService, TokenizedFormat[]>();

function tokenized(svc: SlimService): TokenizedFormat[] {
  let c = tokenCache.get(svc);
  if (!c) {
    c = svc.resources.flatMap((r) =>
      r.arnFormats.flatMap((fmt): TokenizedFormat[] => {
        const f = splitFields(fmt, 5);
        if (f.length !== 6 || f[0] !== "arn") return [];
        const header = [1, 2, 3, 4].map((i): HeaderTok => {
          const text = f[i] as string;
          if (text === "${Partition}") return "partition";
          if (text === "${Region}") return "region";
          if (text === "${Account}") return "account";
          return formatTokens(text);
        });
        return [{ resource: r.name, header, res: formatTokens(f[5] as string) }];
      }),
    );
    tokenCache.set(svc, c);
  }
  return c;
}

const AWS_TOKENS = formatTokens("aws");

function headerCompatible(h: HeaderTok, field: string): boolean {
  if (h === "partition") return intersects(field, AWS_TOKENS);
  if (h === "region") return hasWildcard(field) || fieldMatches({ kind: "region" }, field);
  if (h === "account") return hasWildcard(field) || fieldMatches({ kind: "account" }, field);
  return intersects(field, h);
}

/**
 * Resource types a policy ARN can apply to. Concrete ARNs behave exactly like
 * `classifyArn`. An ARN containing `*`/`?` is a glob over request ARNs, so every
 * type with at least one format whose language can intersect it is returned.
 * Sorted. No RegExp touches user input.
 */
export function matchableTypes(arn: string, svc: SlimService): string[] {
  if (arn.length > MAX_ARN_LENGTH) return [];
  if (!hasWildcard(arn)) return classifyArn(arn, svc);
  const parts = splitFields(arn, 5);
  if (parts[0] !== "arn") return [];
  if (parts.length < 6) {
    if (parts[parts.length - 1] !== "*") return [];
    while (parts.length < 6) parts.push("*");
  }
  const out = new Set<string>();
  for (const f of tokenized(svc)) {
    if (out.has(f.resource)) continue;
    if (
      f.header.every((h, i) => headerCompatible(h, parts[i + 1] as string)) &&
      intersects(parts[5] as string, f.res)
    ) {
      out.add(f.resource);
    }
  }
  return [...out].sort();
}
