import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { JSX } from "react";
import type { Issue } from "../../../core/types";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Counts of errors, warnings and info. The counts are text, so colour is never the only signal. */
export function StatusLine(props: { issues: Issue[]; onActivate(): void }): JSX.Element {
  const count = (s: Issue["severity"]): number => props.issues.filter((i) => i.severity === s).length;
  return (
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
      <StatusIndicator type="error">{plural(count("error"), "error", "errors")}</StatusIndicator>
      <StatusIndicator type="warning">{plural(count("warning"), "warning", "warnings")}</StatusIndicator>
      <StatusIndicator type="info">{count("info")} info</StatusIndicator>
    </button>
  );
}
