import type { JSX } from "react";
import type { ExportFile } from "../../../core/export/json";

/** Read-only code block. Focusable so keyboard users can scroll it. */
export function CodeView(props: { text: string; language: ExportFile["language"]; label: string }): JSX.Element {
  return (
    <pre
      tabIndex={0}
      aria-label={props.label}
      data-language={props.language}
      style={{
        margin: 0,
        padding: 12,
        overflow: "auto",
        maxHeight: 420,
        fontFamily: "var(--rc-mono, monospace)",
        fontSize: 12,
        lineHeight: "18px",
        border: "1px solid var(--rc-border)",
        borderRadius: 4,
        background: "var(--rc-bg)",
      }}
    >
      {props.text}
    </pre>
  );
}
