import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { JSX } from "react";
import type { Issue, Severity } from "../../../core/types";
import { isRevealed, useBuilderStore } from "../../../state/builder";
import { focusIdFor, issueText, splitPending, todoText } from "../issues";
import { StatusText, type StatusType } from "../../common/StatusText";

/**
 * Open the step that owns the issue, then focus its field. setStep clears the target, so it must go first.
 * A grant's fields live in the Sentences editor; the Grid only summarises them, so a grant target switches to it.
 */
function jump(issue: Issue): void {
  const to = focusIdFor(issue);
  if (!to) return;
  const s = useBuilderStore.getState();
  s.revealAllErrors();
  s.setStep(to.step);
  if (to.target.startsWith("grant:")) s.setEditor("sentences");
  s.focus(to.target);
}

const JUMP_AFTER_CLOSE_MS = 50;

/** Issues split into to-dos (errors on fields the user has not reached yet) and the ones shown as they are. */
export function usePendingSplit(issues: Issue[]): { pending: Issue[]; shown: Issue[] } {
  const touched = useBuilderStore((s) => s.touched);
  const revealErrors = useBuilderStore((s) => s.revealErrors);
  return splitPending(issues, (id) => isRevealed({ revealErrors, touched }, id));
}

function Rows(props: {
  issues: Issue[];
  type(i: Issue): StatusType;
  text(i: Issue): string;
  onJump?: (() => void) | undefined;
}): JSX.Element {
  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
      {props.issues.map((issue, n) => (
        <li key={n} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", padding: "2px 0" }}>
          <StatusText type={props.type(issue)}>{props.text(issue)}</StatusText>
          {focusIdFor(issue) !== null && (
            <Button
              variant="inline-link"
              ariaLabel={`Jump to: ${props.text(issue)}`}
              onClick={() => {
                if (!props.onJump) return jump(issue);
                // A closing modal restores focus to its opener after this commit; jump once that has happened.
                props.onJump();
                setTimeout(() => jump(issue), JUMP_AFTER_CLOSE_MS);
              }}
            >
              Jump to
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Errors on fields the user has not reached yet are listed under To do, as a short instruction, not in red.
 * `onJump` runs first, e.g. to close a modal that covers the builder. `emptyText` replaces "No issues." when empty.
 */
export function IssuesList(props: {
  issues: Issue[];
  severities?: Severity[];
  onJump?: () => void;
  emptyText?: string | undefined;
}): JSX.Element {
  const model = useBuilderStore((s) => s.model);
  const listed = props.severities ? props.issues.filter((i) => props.severities!.includes(i.severity)) : props.issues;
  const { pending, shown } = usePendingSplit(listed);
  if (listed.length === 0) return <Box color="text-body-secondary">{props.emptyText ?? "No issues."}</Box>;
  return (
    <SpaceBetween size="xs">
      {pending.length > 0 && (
        <div>
          {/* A label, not a heading: the list sits under different heading levels in the panel and the Review step. */}
          <Box fontWeight="bold">To do</Box>
          <Rows issues={pending} type={() => "pending"} text={(i) => todoText(i, model)} onJump={props.onJump} />
        </div>
      )}
      {shown.length > 0 && <Rows issues={shown} type={(i) => i.severity} text={(i) => issueText(i, model)} onJump={props.onJump} />}
    </SpaceBetween>
  );
}
