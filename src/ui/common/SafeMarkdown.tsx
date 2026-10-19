import type { JSX, ReactNode } from "react";
import type { ExportFile } from "../../core/export/json";
import { CodeView } from "../builder/output/CodeView";

const INLINE = /\\([\s\S])|`([^`]+)`|\*\*(.+?)\*\*/g;
const LANGUAGES: Record<string, ExportFile["language"]> = { sh: "bash", bash: "bash", powershell: "powershell" };

/** `code`, **bold** and \x escapes as React text nodes; nothing is ever parsed as HTML. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) out.push(<code key={m.index}>{m[2]}</code>);
    else out.push(<strong key={m.index}>{inline(m[3] as string)}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * The small Markdown subset the README's how-to-apply text uses: ### headings, paragraphs, ``` fences, `code`,
 * **bold** and backslash escapes. Everything else (including HTML) is shown as literal text.
 */
export function SafeMarkdown(props: { markdown: string }): JSX.Element {
  const blocks: JSX.Element[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length > 0) blocks.push(<p key={blocks.length}>{inline(para.join(" "))}</p>);
    para = [];
  };
  const lines = props.markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i] as string); i++) body.push(lines[i] as string);
      const language = LANGUAGES[fence[1] as string] ?? "bash";
      blocks.push(<CodeView key={blocks.length} text={body.join("\n")} language={language} label="Command" />);
    } else if (line.startsWith("### ")) {
      flush();
      blocks.push(<h3 key={blocks.length}>{inline(line.slice(4))}</h3>);
    } else if (line.trim() === "") flush();
    else para.push(line);
  }
  flush();
  return <div>{blocks}</div>;
}
