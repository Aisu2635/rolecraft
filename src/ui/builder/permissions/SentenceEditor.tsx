import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { useCallback, useState, type JSX } from "react";
import type { Grant } from "../../../core/model/model";
import type { Issue, SlimService } from "../../../core/types";
import { useBuilderStore } from "../../../state/builder";
import { useDerived } from "../../../state/derive";
import { grantIssues } from "../issues";
import { ScopeEditor } from "../scope/ScopeEditor";
import { SERVICE_SEARCH_ID } from "../sidebar/ServiceSidebar";
import { useFocusTarget } from "../useFocusTarget";
import { ServiceUnavailable, useServiceInfo } from "./ServiceStatus";
import { scopeSummary } from "./summary";
import { applyVerb, verbChoices } from "./verbs";

const INVALID_FIELD = 'input[aria-invalid="true"]:not([disabled]), textarea[aria-invalid="true"]';
const rowStyle = { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } as const;

/** `userOpen` is the Scope section's state as the user (or a Jump to) last set it; null until then. */
function GrantEditor(props: {
  grant: Grant;
  svc: SlimService;
  issues: Issue[];
  name: string;
  userOpen: boolean | null;
  setUserOpen(open: boolean): void;
}): JSX.Element {
  const { grant, svc, issues, name, userOpen, setUserOpen } = props;
  const updateGrant = useBuilderStore((s) => s.updateGrant);
  const mine = grantIssues(issues, grant.id);
  // Issues with a path appear on their own field; the row lists only the ones no field can show.
  const shown = mine.filter((i) => i.severity !== "info" && i.path === undefined);
  const hasErrors = mine.some((i) => i.severity === "error");
  // Open while the grant has errors, then stay open so the editor does not collapse as the last error is fixed.
  const [sawErrors, setSawErrors] = useState(false);
  if (hasErrors && !sawErrors) setSawErrors(true);
  const { options, selected } = verbChoices(grant, svc);
  return (
    <>
      <div style={rowStyle}>
        <Select
          selectedOption={selected}
          options={options}
          placeholder="Choose access"
          ariaLabel={`${name} access`}
          onChange={(e) => {
            const value = e.detail.selectedOption.value;
            if (value !== undefined) updateGrant(grant.id, (g) => applyVerb(g, value));
          }}
        />
        <Box color="text-body-secondary">{scopeSummary(grant)}</Box>
      </div>
      <ExpandableSection
        headerText="Scope"
        expanded={userOpen ?? sawErrors}
        onChange={(e) => setUserOpen(e.detail.expanded)}
      >
        <ScopeEditor
          grant={grant}
          svc={svc}
          issues={mine}
          onChange={(scope) => updateGrant(grant.id, (g) => ({ ...g, scope }))}
        />
      </ExpandableSection>
      {shown.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
          {shown.map((i, n) => (
            <li key={n}>
              <StatusIndicator type={i.severity === "error" ? "error" : "warning"}>{i.message}</StatusIndicator>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function GrantRow(props: { grant: Grant; issues: Issue[] }): JSX.Element {
  const { grant } = props;
  const info = useServiceInfo(grant.service);
  const { svc, name } = info;
  const removeGrant = useBuilderStore((s) => s.removeGrant);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  // A Jump to reveals the errors first, so the invalid field is marked by the time the row takes focus. It also opens
  // a Scope section the user collapsed, since a hidden field cannot take focus.
  const openScope = useCallback(() => setUserOpen(true), []);
  const ref = useFocusTarget<HTMLDivElement>("grant:" + grant.id, openScope, INVALID_FIELD);
  return (
    <div ref={ref} role="group" aria-label={`${name} permission`} className="rc-grant">
      <SpaceBetween size="xs">
        <div style={{ ...rowStyle, justifyContent: "space-between" }}>
          <Box variant="strong">{name}</Box>
          <Button
            iconName="close"
            variant="icon"
            ariaLabel={`Remove ${name} permission`}
            onClick={() => removeGrant(grant.id)}
          />
        </div>
        {info.status === "ready" && svc ? (
          <GrantEditor
            grant={grant}
            svc={svc}
            issues={props.issues}
            name={name}
            userOpen={userOpen}
            setUserOpen={setUserOpen}
          />
        ) : (
          <ServiceUnavailable info={info} />
        )}
      </SpaceBetween>
    </div>
  );
}

export function SentenceEditor(): JSX.Element {
  const grants = useBuilderStore((s) => s.model.grants);
  const derived = useDerived();
  const issues = derived.kind === "ready" ? derived.input.result.issues : [];
  return (
    <SpaceBetween size="m">
      {grants.length === 0 && (
        <Box color="text-body-secondary">No permissions yet. Pick a service on the left to add one.</Box>
      )}
      {grants.map((g) => (
        <GrantRow key={g.id} grant={g} issues={issues} />
      ))}
      <Button iconName="add-plus" onClick={() => document.getElementById(SERVICE_SEARCH_ID)?.focus()}>
        Add permission
      </Button>
    </SpaceBetween>
  );
}
