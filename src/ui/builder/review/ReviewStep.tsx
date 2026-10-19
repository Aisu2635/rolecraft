import Autosuggest from "@cloudscape-design/components/autosuggest";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useCallback, type JSX, type ReactNode } from "react";
import { validateModelValues } from "../../../core/validate/values";
import { isRevealed, useBuilderStore } from "../../../state/builder";
import { useDerived } from "../../../state/derive";
import { errorTextAt } from "../issues";
import { IssuesList } from "../output/IssuesList";
import { Summary } from "../output/Summary";
import { StringList } from "../scope/shared";
import { useFocusTarget } from "../useFocusTarget";
import { STANDARD_REGIONS } from "./regions";

/** A review field. Its error shows after the user has typed in or left it, after a Jump to, or once errors are revealed. */
function Field(props: {
  path: string;
  label: string;
  description?: string;
  error?: string | undefined;
  children(touch: () => void): ReactNode;
}): JSX.Element {
  const id = "field:" + props.path;
  const touchId = useBuilderStore((s) => s.touch);
  const revealed = useBuilderStore((s) => isRevealed(s, id));
  const touch = useCallback(() => touchId(id), [touchId, id]);
  const ref = useFocusTarget<HTMLDivElement>(id, touch);
  return (
    <div ref={ref} onBlur={touch}>
      <FormField label={props.label} description={props.description} errorText={revealed ? props.error : undefined}>
        {props.children(touch)}
      </FormField>
    </div>
  );
}

const MODES = [
  { value: "managed", label: "Managed policy (reusable, up to 6,144 characters)" },
  { value: "inline", label: "Inline policy (up to 10,240 for a role, 5,120 for a group, 2,048 for a user)" },
];

/** Step 3: name, policy mode and optional details, then every issue and what the role can do. */
export function ReviewStep(): JSX.Element {
  const model = useBuilderStore((s) => s.model);
  const setFields = useBuilderStore((s) => s.setFields);
  const derived = useDerived();
  const issues = derived.kind === "ready" ? derived.input.result.issues : validateModelValues(model);
  const err = (path: string): string | undefined => errorTextAt(issues, path);
  const nameDescription =
    model.trust.kind === "principal" ? `Used to name the policy: ${model.name}-policy` : "Role name";
  return (
    <SpaceBetween size="l">
      <Field path="name" label="Name" description={nameDescription} error={err("name")}>
        {(touch) => (
          <Input
            value={model.name}
            onChange={(e) => {
              touch();
              setFields({ name: e.detail.value });
            }}
          />
        )}
      </Field>
      <Field path="policyMode" label="Policy mode" error={err("policyMode")}>
        {() => (
          <RadioGroup
            value={model.policyMode}
            items={MODES}
            onChange={(e) => setFields({ policyMode: e.detail.value === "inline" ? "inline" : "managed" })}
          />
        )}
      </Field>
      <Field path="accountId" label="AWS account ID" description="Optional" error={err("accountId")}>
        {(touch) => (
          <Input
            value={model.accountId ?? ""}
            inputMode="numeric"
            onChange={(e) => {
              touch();
              setFields({ accountId: e.detail.value });
            }}
          />
        )}
      </Field>
      <Field path="region" label="Region" description="Optional" error={err("region")}>
        {(touch) => (
          <Autosuggest
            value={model.region ?? ""}
            options={STANDARD_REGIONS.map((r) => ({ value: r }))}
            enteredTextLabel={(v) => `Use: ${v}`}
            empty="No matching region"
            onChange={(e) => {
              touch();
              setFields({ region: e.detail.value });
            }}
          />
        )}
      </Field>
      <Field
        path="managedPolicyArns"
        label="Managed policy ARNs"
        description="Optional. AWS managed or customer managed policies to attach as well."
        error={err("managedPolicyArns")}
      >
        {() => (
          <StringList
            item="Managed policy ARN"
            removeNoun="managed policy ARN"
            addLabel="Add managed policy ARN"
            values={model.managedPolicyArns}
            min={0}
            issues={issues}
            pathOf={(i) => `managedPolicyArns[${i}]`}
            focusIdOf={(i) => `field:managedPolicyArns[${i}]`}
            onChange={(managedPolicyArns) => setFields({ managedPolicyArns })}
          />
        )}
      </Field>
      <SpaceBetween size="xs">
        <Header variant="h3">Issues</Header>
        <IssuesList issues={issues} />
      </SpaceBetween>
      {derived.kind === "ready" && (
        <SpaceBetween size="xs">
          <Header variant="h3">What this role can do</Header>
          <Summary summary={derived.input.summary} />
        </SpaceBetween>
      )}
    </SpaceBetween>
  );
}
