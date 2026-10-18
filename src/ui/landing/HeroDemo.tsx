import { CaretDown, FileText, UsersThree } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { HAND_BAD_VALUES, HAND_CALLOUTS, HAND_WRITTEN_JSON, HERO_SENTENCE, heroPolicyLines } from "./hero-content";
import { useHeroTimeline } from "./useHeroTimeline";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

const DESCRIPTION =
  "Example: instead of a hand-written policy that allows every S3 action on every resource, RoleCraft builds: " +
  "analytics-team can list and read files in data-lake/reports/.";

const POLICY_LINES = heroPolicyLines();
const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?/g;

/** Colours JSON keys and strings as React nodes (no HTML injection). */
function highlight(line: string, bad: readonly string[] = []): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index;
    if (at > last) out.push(line.slice(last, at));
    const isKey = m[2] !== undefined;
    const isBad = !isKey && bad.includes(m[1] ?? "");
    out.push(
      <span key={at} className={`${isKey ? "k" : m[1]?.includes("*") ? "c" : "s"}${isBad ? " lp-bad" : ""}`}>
        {m[1]}
      </span>,
    );
    if (isKey) out.push(m[2]);
    last = at + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

const HAND_LINES = HAND_WRITTEN_JSON.split("\n").length;

/** The typed prefix of the hand-written JSON, with finished bad values marked. */
function typedCode(typed: number): ReactNode[] {
  const lines = HAND_WRITTEN_JSON.slice(0, typed).split("\n");
  return lines.flatMap((l, i) => [i > 0 ? "\n" : "", <span key={i}>{highlight(l, HAND_BAD_VALUES)}</span>]);
}

function pop(i: number): CSSProperties {
  return { "--i": i } as CSSProperties;
}

export function HeroDemo() {
  const reduced = usePrefersReducedMotion();
  const { phase, typed } = useHeroTimeline(reduced);
  return (
    <div className="lp-preview" role="group" aria-label="Example policy preview">
      <p className="lp-sr">{DESCRIPTION}</p>
      <div className="lp-stage" aria-hidden="true" data-phase={phase} data-reduced={reduced ? "true" : "false"}>
        <div className="lp-hd">
          <div className="lp-ph lp-ph-hand">
            <span className="lp-dot" />
            policy.json <span className="d">— written by hand</span>
          </div>
          <div className="lp-ph lp-ph-rc">
            <FileText size={16} />
            S3 folder — read only <span className="d">· RoleCraft</span>
          </div>
        </div>
        <div className="lp-hand">
          <div className="lp-ed">
            <div className="lp-gutter">
              {Array.from({ length: HAND_LINES }, (_, i) => (
                <span key={i} className={i < HAND_WRITTEN_JSON.slice(0, typed).split("\n").length ? "on" : undefined}>
                  {i + 1}
                </span>
              ))}
            </div>
            <div className="lp-codewrap">
              <pre className="lp-code">
                {typedCode(typed)}
                <span className="lp-caret" />
              </pre>
              <span className="lp-strike" />
              {HAND_CALLOUTS.map((c, i) => (
                <div className="lp-flagrow" key={c.line} style={{ "--ln": c.line - 1, "--i": i } as CSSProperties}>
                  <span className="lp-flag">{c.text}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="lp-bar">
            <span>JSON</span>
            <span>UTF-8</span>
          </div>
        </div>
        <div className="lp-rc">
          <div className="lp-lines">
            <div className="lp-line">
              <span className="lp-who lp-pop" style={pop(0)}>
                <UsersThree size={14} />
                {HERO_SENTENCE.who}
              </span>
              <span className="lp-pop" style={pop(1)}>
                can
              </span>
            </div>
            <div className="lp-line">
              <span className="lp-sel v lp-pop" style={pop(2)}>
                {HERO_SENTENCE.verb}
                <CaretDown size={12} />
              </span>
              <span className="lp-pop" style={pop(3)}>
                files in
              </span>
              <span className="lp-sel lp-pop" style={pop(4)}>
                {HERO_SENTENCE.scope}
                <CaretDown size={12} />
              </span>
            </div>
          </div>
          <div className="lp-out lp-pop" style={pop(5)}>
            <span className="lp-tag good">Least privilege</span>
            <pre className="lp-pre">
              {POLICY_LINES.map((l, i) => (
                <span key={i} className="lp-l">
                  {highlight(l)}
                </span>
              ))}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
