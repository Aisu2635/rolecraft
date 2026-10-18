import Box from "@cloudscape-design/components/box";
import Checkbox from "@cloudscape-design/components/checkbox";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tiles from "@cloudscape-design/components/tiles";
import { useCallback, useState, type JSX, type ReactNode } from "react";
import type { Trust } from "../../../core/model/model";
import { useBuilderStore } from "../../../state/builder";
import { useDerived } from "../../../state/derive";
import { defaultTrust } from "../../../state/model-ops";
import { errorTextAt } from "../issues";
import { useFocusTarget } from "../useFocusTarget";

type Github = Extract<Trust, { kind: "github" }>;
type Account = Extract<Trust, { kind: "account" }>;
type Principal = Extract<Trust, { kind: "principal" }>;
type RefType = Github["ref"]["type"];

const TILES = [
  { value: "ec2", label: "EC2 instance" },
  { value: "lambda", label: "Lambda function" },
  { value: "ecs-tasks", label: "ECS task" },
  { value: "github", label: "GitHub Actions" },
  { value: "account", label: "Another AWS account" },
  { value: "principal", label: "IAM group or user" },
];

const REF_OPTIONS = [
  { value: "branch", label: "Branch" },
  { value: "tag", label: "Tag" },
  { value: "environment", label: "Environment" },
  { value: "pull_request", label: "Pull requests" },
];
const REF_VALUE: Record<Exclude<RefType, "pull_request">, { label: string; placeholder: string }> = {
  branch: { label: "Branch name", placeholder: "main" },
  tag: { label: "Tag name", placeholder: "v1.0.0" },
  environment: { label: "Environment name", placeholder: "production" },
};

const tileOf = (t: Trust): string => (t.kind === "service" ? t.service : t.kind);

function trustForTile(value: string): Trust {
  switch (value) {
    case "ec2":
    case "lambda":
    case "ecs-tasks":
      return { kind: "service", service: value };
    case "github":
      return defaultTrust("github");
    case "account":
      return defaultTrust("account");
    default:
      return defaultTrust("principal");
  }
}

/** Unset optional keys are removed rather than stored empty or false, so the model stays minimal. */
function withAccount(t: Account, patch: Partial<Omit<Account, "kind">>): Account {
  const { accountId, externalId, requireMfa } = { ...t, ...patch };
  const out: Account = { kind: "account", accountId };
  if (externalId) out.externalId = externalId;
  if (requireMfa) out.requireMfa = true;
  return out;
}

/** A form field whose error appears after its first blur or after a "Jump to" focus on it. */
function Field(props: {
  path: string;
  label: string;
  description?: string;
  error?: string | undefined;
  children: ReactNode;
}): JSX.Element {
  const [touched, setTouched] = useState(false);
  const reveal = useCallback(() => setTouched(true), []);
  const ref = useFocusTarget<HTMLDivElement>("field:" + props.path, reveal);
  return (
    <div ref={ref} onBlur={reveal}>
      <FormField
        label={props.label}
        description={props.description}
        errorText={touched ? props.error : undefined}
      >
        {props.children}
      </FormField>
    </div>
  );
}

function GithubFields(props: { trust: Github; error(path: string, id?: string): string | undefined }): JSX.Element {
  const { trust, error } = props;
  const setTrust = useBuilderStore((s) => s.setTrust);
  const setFields = useBuilderStore((s) => s.setFields);
  const accountId = useBuilderStore((s) => s.model.accountId ?? "");
  const { ref } = trust;
  const onType = (type: RefType): void =>
    setTrust({ ...trust, ref: type === "pull_request" ? { type } : { type, value: type === "branch" ? "main" : "" } });
  return (
    <SpaceBetween size="m">
      <Field path="trust.owner" label="GitHub owner" error={error("trust.owner")}>
        <Input value={trust.owner} onChange={(e) => setTrust({ ...trust, owner: e.detail.value })} />
      </Field>
      <Field path="trust.repo" label="Repository" error={error("trust.repo")}>
        <Input value={trust.repo} onChange={(e) => setTrust({ ...trust, repo: e.detail.value })} />
      </Field>
      <Field path="trust.ref.type" label="Ref type">
        <Select
          selectedOption={REF_OPTIONS.find((o) => o.value === ref.type) ?? null}
          options={REF_OPTIONS}
          onChange={(e) => onType(e.detail.selectedOption.value as RefType)}
        />
      </Field>
      {ref.type !== "pull_request" && (
        <Field
          path="trust.ref.value"
          label={REF_VALUE[ref.type].label}
          error={error("trust.ref.value", "E_GITHUB_REF_VALUE")}
        >
          <Input
            value={ref.value ?? ""}
            placeholder={REF_VALUE[ref.type].placeholder}
            onChange={(e) => setTrust({ ...trust, ref: { type: ref.type, value: e.detail.value } })}
          />
        </Field>
      )}
      <Field
        path="accountId"
        label="AWS account ID"
        description="Needed for the GitHub OIDC provider ARN."
        error={error("accountId", "E_GITHUB_NEEDS_ACCOUNT")}
      >
        <Input value={accountId} inputMode="numeric" onChange={(e) => setFields({ accountId: e.detail.value })} />
      </Field>
    </SpaceBetween>
  );
}

function AccountFields(props: { trust: Account; error(path: string): string | undefined }): JSX.Element {
  const { trust, error } = props;
  const setTrust = useBuilderStore((s) => s.setTrust);
  return (
    <SpaceBetween size="m">
      <Field path="trust.accountId" label="Trusted account ID" error={error("trust.accountId")}>
        <Input
          value={trust.accountId}
          inputMode="numeric"
          onChange={(e) => setTrust(withAccount(trust, { accountId: e.detail.value }))}
        />
      </Field>
      <Field
        path="trust.externalId"
        label="External ID (optional)"
        description="Recommended when a third party will assume this role."
        error={error("trust.externalId")}
      >
        <Input
          value={trust.externalId ?? ""}
          onChange={(e) => setTrust(withAccount(trust, { externalId: e.detail.value }))}
        />
      </Field>
      <Checkbox
        checked={trust.requireMfa === true}
        onChange={(e) => setTrust(withAccount(trust, { requireMfa: e.detail.checked }))}
      >
        Require MFA
      </Checkbox>
    </SpaceBetween>
  );
}

function PrincipalFields(props: { trust: Principal; error(path: string): string | undefined }): JSX.Element {
  const { trust, error } = props;
  const setTrust = useBuilderStore((s) => s.setTrust);
  return (
    <SpaceBetween size="m">
      <Box color="text-body-secondary">
        The policy is attached to an existing IAM group or user. No role is created.
      </Box>
      <FormField label="Attach to">
        <SegmentedControl
          selectedId={trust.target}
          label="Attach to"
          options={[
            { id: "group", text: "Group" },
            { id: "user", text: "User" },
          ]}
          onChange={(e) => setTrust({ ...trust, target: e.detail.selectedId === "user" ? "user" : "group" })}
        />
      </FormField>
      <Field path="trust.name" label="Name" error={error("trust.name")}>
        <Input value={trust.name} onChange={(e) => setTrust({ ...trust, name: e.detail.value })} />
      </Field>
    </SpaceBetween>
  );
}

export function TrustStep(): JSX.Element {
  const trust = useBuilderStore((s) => s.model.trust);
  const setTrust = useBuilderStore((s) => s.setTrust);
  const derived = useDerived();
  const issues = derived.kind === "ready" ? derived.input.result.issues : [];
  // The trust builder reports some problems without a path; match those by id.
  const error = (path: string, id?: string): string | undefined =>
    errorTextAt(issues, path) ?? (id ? issues.find((i) => i.id === id && i.severity === "error")?.message : undefined);
  return (
    <SpaceBetween size="l">
      <Tiles
        items={TILES}
        value={tileOf(trust)}
        columns={3}
        onChange={(e) => {
          if (e.detail.value !== tileOf(trust)) setTrust(trustForTile(e.detail.value));
        }}
      />
      {trust.kind === "github" && <GithubFields trust={trust} error={error} />}
      {trust.kind === "account" && <AccountFields trust={trust} error={error} />}
      {trust.kind === "principal" && <PrincipalFields trust={trust} error={error} />}
    </SpaceBetween>
  );
}
