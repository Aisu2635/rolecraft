import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Spinner from "@cloudscape-design/components/spinner";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tabs, { type TabsProps } from "@cloudscape-design/components/tabs";
import { useContext, useRef, useState, type JSX, type ReactNode } from "react";
import { stringifyPolicy } from "../../../core/export/json";
import type { ExportInput } from "../../../core/export/types";
import { policyLimit } from "../../../core/validate/size";
import { useBuilderStore } from "../../../state/builder";
import { CatalogContext } from "../../../state/catalog";
import { useDerived } from "../../../state/derive";
import { useCopy } from "../../common/clipboard";
import { CodeView } from "./CodeView";
import { IssuesList } from "./IssuesList";
import { SizeMeter } from "./SizeMeter";
import { StatusLine } from "./StatusLine";

/** A format tab added by a later task. `copyText` is what Copy puts on the clipboard while the tab is active. */
export type ExtraTab = TabsProps.Tab & { copyText?: string };

export interface OutputPanelProps {
  extraTabs?: ExtraTab[];
  /** A hook (called every render, so it must be a stable function) that supplies extra tabs from the derived input. */
  useExtraTabs?: (input: ExportInput | null, active: string) => ExtraTab[];
  /** Beside Copy: the Export button (a function gets the derived input once the output is ready). */
  actions?: ReactNode | ((input: ExportInput) => ReactNode);
  /** Beside Copy: the Share button. */
  share?: ReactNode;
}

export function OutputPanel(props: OutputPanelProps = {}): JSX.Element {
  const derived = useDerived();
  const catalog = useContext(CatalogContext);
  const model = useBuilderStore((s) => s.model);
  const { copy, modal } = useCopy();
  const [active, setActive] = useState("policy");
  const issuesRef = useRef<HTMLDivElement | null>(null);
  const derivedInput = derived.kind === "ready" ? derived.input : null;
  const hookTabs = props.useExtraTabs?.(derivedInput, active) ?? [];

  if (derived.kind === "loading") {
    return (
      <Box textAlign="center" padding="l">
        <Spinner /> Loading service data…
      </Box>
    );
  }
  if (derived.kind === "error") {
    return (
      <SpaceBetween size="s">
        <Box>Couldn&apos;t load service data for: {derived.failed.join(", ")}.</Box>
        <Button onClick={() => derived.failed.forEach((k) => void catalog.getState().retry(k))}>Retry</Button>
      </SpaceBetween>
    );
  }

  const { result } = derived.input;
  const policyText = result.policy ? stringifyPolicy(result.policy) : "";
  const trustText = result.trust ? stringifyPolicy(result.trust) : "";
  const extra = [...(props.extraTabs ?? []), ...hookTabs];
  // A tab that is no longer offered (e.g. a format tab removed) falls back to Policy.
  const current = ["policy", "trust", ...extra.map((t) => t.id)].includes(active) ? active : "policy";
  // Remember the fallback, so the panel does not jump back if the tab reappears.
  if (current !== active) setActive(current);
  const copyText =
    current === "policy" ? policyText : current === "trust" ? trustText : (extra.find((t) => t.id === current)?.copyText ?? "");
  const hasErrors = result.issues.some((i) => i.severity === "error");
  const trustEmpty =
    model.trust.kind === "principal"
      ? `No trust policy: the policy is attached directly to the IAM ${model.trust.target}.`
      : "No trust policy.";

  const tabs: TabsProps.Tab[] = [
    {
      id: "policy",
      label: "Policy",
      content: result.policy ? (
        <CodeView text={policyText} language="json" label="Policy JSON" />
      ) : (
        <Box color="text-body-secondary">No permissions yet. Add a service to generate a policy.</Box>
      ),
    },
    {
      id: "trust",
      label: "Trust",
      content: result.trust ? (
        <CodeView text={trustText} language="json" label="Trust policy JSON" />
      ) : (
        <Box color="text-body-secondary">{trustEmpty}</Box>
      ),
    },
    ...extra,
  ];

  return (
    <SpaceBetween size="m">
      {hasErrors && <Alert type="error">This policy has errors. Fix them before you apply it.</Alert>}
      <Tabs tabs={tabs} activeTabId={current} onChange={(e) => setActive(e.detail.activeTabId)} />
      <StatusLine
        issues={result.issues}
        onActivate={() => issuesRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" })}
      />
      <SizeMeter size={result.sizes.policy} limit={policyLimit(model.policyMode, model.trust)} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button iconName="copy" disabled={copyText === ""} onClick={() => void copy(copyText)}>
          Copy
        </Button>
        {typeof props.actions === "function" ? props.actions(derived.input) : props.actions}
        {props.share}
      </div>
      {modal}
      <div ref={issuesRef} id="rc-output-issues">
        <IssuesList issues={result.issues} />
      </div>
    </SpaceBetween>
  );
}
