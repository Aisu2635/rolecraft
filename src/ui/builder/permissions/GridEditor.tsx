import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import Container from "@cloudscape-design/components/container";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Header from "@cloudscape-design/components/header";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import { useState, type JSX } from "react";
import { MODULES } from "../../../core/engine/modules/registry";
import type { Grant } from "../../../core/model/model";
import { ACCESS_LEVELS, type AccessLevel, type Issue, type SlimService } from "../../../core/types";
import { useBuilderStore } from "../../../state/builder";
import { useDerivedOutput } from "../../../state/derive";
import { moduleFor, newGrantFor } from "../../../state/model-ops";
import { grantIssues, shownOnRow, todoText } from "../issues";
import { usePendingSplit } from "../output/IssuesList";
import { ScopeEditor } from "../scope/ScopeEditor";
import { ActionPicker } from "./ActionPicker";
import { ServiceUnavailable, useServiceInfo } from "./ServiceStatus";
import { scopeSummary } from "./summary";

const ACTIONS_HINT = "Clear the individual actions to use access levels.";
type Column = TableProps.ColumnDefinition<Grant>;

/** Levels in ACCESS_LEVELS order, whatever order they were ticked in. */
const withLevel = (levels: AccessLevel[], level: AccessLevel, on: boolean): AccessLevel[] =>
  ACCESS_LEVELS.filter((l) => (l === level ? on : levels.includes(l)));

function LevelCell(props: { grant: Grant; svc: SlimService; level: AccessLevel }): JSX.Element {
  const { grant, svc, level } = props;
  const updateGrant = useBuilderStore((s) => s.updateGrant);
  if (!svc.actions.some((a) => a.level === level)) return <Box color="text-status-inactive">—</Box>;
  const access = grant.access;
  // Individual actions, and any access the boxes cannot express, are read-only here.
  const levels = access.type === "levels" ? access.levels : [];
  return (
    <Checkbox
      checked={levels.includes(level)}
      disabled={access.type !== "levels"}
      ariaLabel={`${level}, ${scopeSummary(grant)}`}
      onChange={(e) =>
        updateGrant(grant.id, (g) => ({ ...g, access: { type: "levels", levels: withLevel(levels, level, e.detail.checked) } }))
      }
    />
  );
}

function PresetCell(props: { grant: Grant; preset: string; label: string }): JSX.Element {
  const { grant, preset, label } = props;
  const updateGrant = useBuilderStore((s) => s.updateGrant);
  return (
    <input
      type="radio"
      name={"preset-" + grant.id}
      aria-label={`${label}, ${scopeSummary(grant)}`}
      checked={grant.access.type === "preset" && grant.access.preset === preset}
      onChange={() => updateGrant(grant.id, (g) => ({ ...g, access: { type: "preset", preset } }))}
    />
  );
}

/**
 * A generic grant (no module) on a service whose columns are module presets: the presets do not apply, so its access
 * is shown read-only, with a way to edit it where it can be.
 */
function GenericAccessCell(props: { grant: Grant }): JSX.Element {
  const { access, id } = props.grant;
  const n = access.type === "actions" ? access.actions.length : 0;
  const text =
    access.type === "levels"
      ? access.levels.join(", ")
      : access.type === "actions"
        ? `${n} individual ${n === 1 ? "action" : "actions"}`
        : access.preset;
  const edit = (): void => {
    const s = useBuilderStore.getState();
    s.setEditor("sentences");
    s.focus("grant:" + id);
  };
  return (
    <SpaceBetween size="xs" direction="horizontal" alignItems="center">
      <span>{text}</span>
      <Button variant="inline-link" onClick={edit}>
        Edit in Sentences
      </Button>
    </SpaceBetween>
  );
}

function ActionsCell(props: { grant: Grant; svc: SlimService }): JSX.Element {
  const { grant, svc } = props;
  const updateGrant = useBuilderStore((s) => s.updateGrant);
  const [open, setOpen] = useState(false);
  const n = grant.access.type === "actions" ? grant.access.actions.length : 0;
  return (
    <SpaceBetween size="xs">
      {n > 0 && (
        <>
          <Box>{`${n} individual ${n === 1 ? "action" : "actions"}`}</Box>
          <Box variant="small" color="text-body-secondary">
            {ACTIONS_HINT}
          </Box>
        </>
      )}
      {/* The picker mounts only when opened: a service can have ~700 actions. */}
      <ExpandableSection
        variant="footer"
        headerText="Pick individual actions"
        expanded={open}
        onChange={(e) => setOpen(e.detail.expanded)}
      >
        {open && (
          <ActionPicker grant={grant} svc={svc} onChange={(access) => updateGrant(grant.id, (g) => ({ ...g, access }))} />
        )}
      </ExpandableSection>
    </SpaceBetween>
  );
}

function columnsFor(svc: SlimService, name: string, onEdit: (id: string) => void): Column[] {
  const moduleId = moduleFor(svc.key);
  const presets = (moduleId ? MODULES[moduleId]?.presets : undefined) ?? [];
  const scope: Column = {
    id: "scope",
    header: "Scope",
    cell: (g) => (
      <SpaceBetween size="xs" direction="horizontal" alignItems="center">
        <span>{scopeSummary(g)}</span>
        <Button iconName="edit" variant="inline-icon" ariaLabel={`Edit scope of ${name}`} onClick={() => onEdit(g.id)} />
      </SpaceBetween>
    ),
  };
  const remove: Column = {
    id: "remove",
    header: "",
    cell: (g) => (
      <Button
        iconName="close"
        variant="icon"
        ariaLabel={`Remove ${name} permission`}
        onClick={() => useBuilderStore.getState().removeGrant(g.id)}
      />
    ),
  };
  if (presets.length > 0) {
    const cols = presets.map(
      (p, i): Column => ({
        id: "preset-" + p.id,
        header: p.label,
        // A generic grant's access shows once, in the first preset column; its other preset cells stay empty.
        cell: (g) =>
          g.module ? <PresetCell grant={g} preset={p.id} label={p.label} /> : i === 0 ? <GenericAccessCell grant={g} /> : null,
      }),
    );
    return [scope, ...cols, remove];
  }
  const levels = ACCESS_LEVELS.map(
    (level): Column => ({ id: "level-" + level, header: level, cell: (g) => <LevelCell grant={g} svc={svc} level={level} /> }),
  );
  const actions: Column = {
    id: "actions",
    header: "Individual actions",
    cell: (g) => <ActionsCell grant={g} svc={svc} />,
  };
  return [scope, ...levels, actions, remove];
}

function ServiceContainer(props: {
  serviceKey: string;
  grants: Grant[];
  issues: Issue[];
  onEdit(id: string): void;
}): JSX.Element {
  const { serviceKey, grants, issues } = props;
  const info = useServiceInfo(serviceKey);
  const { svc, name } = info;
  const addGrant = useBuilderStore((s) => s.addGrant);
  const removeGrant = useBuilderStore((s) => s.removeGrant);
  const model = useBuilderStore((s) => s.model);
  // Errors on a grant the user has not touched yet are to-dos, as in the output panel.
  const { pending, shown } = usePendingSplit(grants.flatMap((g) => grantIssues(issues, g.id)).filter(shownOnRow));
  return (
    <section aria-label={name}>
      <Container
        header={
          <Header
            actions={
              <Button disabled={info.status !== "ready" || !svc} onClick={() => svc && addGrant(newGrantFor(svc))}>
                Add scope
              </Button>
            }
          >
            {name}
          </Header>
        }
      >
        {info.status === "ready" && svc ? (
          <SpaceBetween size="s">
            <Table
              variant="embedded"
              items={grants}
              trackBy="id"
              wrapLines
              columnDefinitions={columnsFor(svc, name, props.onEdit)}
            />
            {pending.map((i, n) => (
              <StatusIndicator key={"p" + n} type="pending">
                {todoText(i, model)}
              </StatusIndicator>
            ))}
            {shown.map((i, n) => (
              <StatusIndicator key={n} type={i.severity}>
                {i.message}
              </StatusIndicator>
            ))}
          </SpaceBetween>
        ) : (
          <SpaceBetween size="xs">
            <ServiceUnavailable info={info} />
            {grants.map((g) => (
              <Button key={g.id} iconName="close" ariaLabel={`Remove ${name} permission`} onClick={() => removeGrant(g.id)}>
                Remove
              </Button>
            ))}
          </SpaceBetween>
        )}
      </Container>
    </section>
  );
}

function EditScopeModal(props: { grantId: string; issues: Issue[]; onClose(): void }): JSX.Element | null {
  const grant = useBuilderStore((s) => s.model.grants.find((g) => g.id === props.grantId));
  const updateGrant = useBuilderStore((s) => s.updateGrant);
  const info = useServiceInfo(grant?.service ?? "");
  if (!grant || !info.svc) return null;
  return (
    <Modal
      visible
      size="large"
      header={`Edit scope of ${info.name}`}
      closeAriaLabel="Close dialog"
      onDismiss={props.onClose}
      footer={
        <Box float="right">
          <Button variant="primary" onClick={props.onClose}>
            Done
          </Button>
        </Box>
      }
    >
      <ScopeEditor
        grant={grant}
        svc={info.svc}
        issues={grantIssues(props.issues, grant.id)}
        onChange={(scope) => updateGrant(grant.id, (g) => ({ ...g, scope }))}
      />
    </Modal>
  );
}

/** One container per service, one table row per grant. Edits the same model as the sentence editor. */
export function GridEditor(): JSX.Element {
  const grants = useBuilderStore((s) => s.model.grants);
  const derived = useDerivedOutput();
  const issues = derived.kind === "ready" ? derived.input.result.issues : [];
  const [editing, setEditing] = useState<string | null>(null);
  const keys = [...new Set(grants.map((g) => g.service))];
  return (
    <SpaceBetween size="m">
      {keys.length === 0 && (
        <Box color="text-body-secondary">No permissions yet. Pick a service on the left to add one.</Box>
      )}
      {keys.map((key) => (
        <ServiceContainer
          key={key}
          serviceKey={key}
          grants={grants.filter((g) => g.service === key)}
          issues={issues}
          onEdit={setEditing}
        />
      ))}
      {editing !== null && <EditScopeModal grantId={editing} issues={issues} onClose={() => setEditing(null)} />}
    </SpaceBetween>
  );
}
