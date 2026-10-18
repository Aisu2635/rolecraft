import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { JSX } from "react";
import type { Issue, Severity } from "../../../core/types";
import { useBuilderStore } from "../../../state/builder";
import { focusIdFor } from "../issues";

/** Open the step that owns the issue, then focus its field. setStep clears the target, so it must go first. */
function jump(issue: Issue): void {
  const to = focusIdFor(issue);
  if (!to) return;
  const s = useBuilderStore.getState();
  s.revealAllErrors();
  s.setStep(to.step);
  s.focus(to.target);
}

export function IssuesList(props: { issues: Issue[]; severities?: Severity[] }): JSX.Element {
  const shown = props.severities ? props.issues.filter((i) => props.severities!.includes(i.severity)) : props.issues;
  if (shown.length === 0) return <Box color="text-body-secondary">No issues.</Box>;
  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
      {shown.map((issue, n) => (
        <li key={n} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", padding: "2px 0" }}>
          <StatusIndicator type={issue.severity}>{issue.message}</StatusIndicator>
          {focusIdFor(issue) !== null && (
            <Button variant="inline-link" ariaLabel={`Jump to: ${issue.message}`} onClick={() => jump(issue)}>
              Jump to
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
