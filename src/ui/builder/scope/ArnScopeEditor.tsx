import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useMemo, useState, type JSX } from "react";
import { fillArn, type BuildContext } from "../../../core/arn";
import type { Scope } from "../../../core/model/model";
import type { SlimService } from "../../../core/types";
import { StringList } from "./shared";

type ArnScope = Extract<Scope, { type: "all" | "arns" }>;

const AUTO = new Set(["Partition", "Region", "Account"]);

/** One option per ARN format of each resource type: value "<type>:<format index>". */
function formatOptions(svc: SlimService) {
  return svc.resources.flatMap((r) =>
    r.arnFormats.map((format, i) => ({
      value: `${r.name}:${i}`,
      label: r.arnFormats.length > 1 ? `${r.name} (format ${i + 1})` : r.name,
      description: format,
      format,
    })),
  );
}

const placeholdersOf = (format: string): string[] => [
  ...new Set([...format.matchAll(/\$\{([A-Za-z0-9]+)\}/g)].map((m) => m[1] as string).filter((n) => !AUTO.has(n))),
];

function ArnBuilder(props: { svc: SlimService; ctx: BuildContext; onAdd(arn: string): void }): JSX.Element {
  const options = useMemo(() => formatOptions(props.svc), [props.svc]);
  const [picked, setPicked] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const option = options.find((o) => o.value === picked) ?? null;
  // Blank inputs are left out so fillArn shows "*" for them, rather than an empty segment.
  const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
  const preview = option ? fillArn(option.format, filled, props.ctx) : "";
  return (
    <SpaceBetween size="s">
      <Box variant="h4">Build an ARN</Box>
      <FormField label="Resource type">
        <Select
          selectedOption={option}
          options={options}
          placeholder="Choose a resource type"
          filteringType="auto"
          onChange={(e) => {
            setPicked(e.detail.selectedOption.value ?? null);
            setValues({});
          }}
        />
      </FormField>
      {option &&
        placeholdersOf(option.format).map((name) => (
          <FormField key={name} label={name}>
            <Input value={values[name] ?? ""} onChange={(e) => setValues({ ...values, [name]: e.detail.value })} />
          </FormField>
        ))}
      {option && (
        <>
          <Box variant="code">{preview}</Box>
          <div>
            <Button onClick={() => props.onAdd(preview)}>Add this ARN</Button>
          </div>
        </>
      )}
    </SpaceBetween>
  );
}

export function ArnScopeEditor(props: {
  scope: ArnScope;
  svc: SlimService;
  ctx: BuildContext;
  onChange(scope: Scope): void;
}): JSX.Element {
  const arns = props.scope.type === "arns" ? props.scope.arns : [];
  const add = (arn: string): void => {
    // The same ARN twice changes nothing in the policy, so it is not added again.
    if (!arns.includes(arn)) props.onChange({ type: "arns", arns: [...arns, arn] });
  };
  return (
    <SpaceBetween size="m">
      <RadioGroup
        value={props.scope.type}
        ariaLabel="Which resources"
        items={[
          { value: "arns", label: "Specific resources" },
          { value: "all", label: "All resources (*)" },
        ]}
        onChange={(e) => props.onChange(e.detail.value === "all" ? { type: "all" } : { type: "arns", arns: [] })}
      />
      {props.scope.type === "arns" && (
        <>
          <StringList
            item="ARN"
            removeNoun="ARN"
            addLabel="Add ARN"
            values={arns}
            min={0}
            issues={[]}
            pathOf={() => ""}
            onChange={(next) => props.onChange({ type: "arns", arns: next })}
          />
          {props.svc.resources.length > 0 && <ArnBuilder svc={props.svc} ctx={props.ctx} onAdd={add} />}
        </>
      )}
    </SpaceBetween>
  );
}
