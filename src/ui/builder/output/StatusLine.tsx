import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { JSX } from "react";
import type { Issue } from "../../../core/types";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * Counts of to-dos (only when there are any), errors, warnings and info. The counts are text, so colour is never
 * the only signal. Zero errors is neutral while to-dos remain, and a success only once nothing is left. A visually
 * hidden copy announces changes politely to screen readers.
 */
export function StatusLine(props: { issues: Issue[]; pending?: number; onActivate(): void }): JSX.Element {
  const count = (s: Issue["severity"]): number => props.issues.filter((i) => i.severity === s).length;
  const todo = props.pending ? `${props.pending} to do` : null;
  const errors = plural(count("error"), "error", "errors");
  const warnings = plural(count("warning"), "warning", "warnings");
  const info = `${count("info")} info`;
  return (
    <div>
      <button
        type="button"
        onClick={props.onActivate}
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          padding: 0,
          border: 0,
          background: "none",
          font: "inherit",
          color: "inherit",
          cursor: "pointer",
        }}
      >
        {todo && <StatusIndicator type="pending">{todo}</StatusIndicator>}
        <StatusIndicator type={count("error") > 0 ? "error" : todo ? "stopped" : "success"}>{errors}</StatusIndicator>
        <StatusIndicator type="warning">{warnings}</StatusIndicator>
        <StatusIndicator type="info">{info}</StatusIndicator>
      </button>
      <span className="rc-visually-hidden" aria-live="polite">
        {[todo, errors, warnings, info].filter(Boolean).join(", ")}
      </span>
    </div>
  );
}
