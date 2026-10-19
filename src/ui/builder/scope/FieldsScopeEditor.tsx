import Checkbox from "@cloudscape-design/components/checkbox";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { JSX } from "react";
import type { Scope } from "../../../core/model/model";
import type { Issue } from "../../../core/types";
import { errorTextAt } from "../issues";
import { MODULE_FIELDS } from "./module-fields";
import { ScopeField, isRecord, str } from "./shared";

export function FieldsScopeEditor(props: {
  moduleId: keyof typeof MODULE_FIELDS;
  data: unknown;
  issues: Issue[];
  onChange(scope: Scope): void;
}): JSX.Element {
  const data = isRecord(props.data) ? props.data : {};
  const set = (key: string, value: string | boolean | undefined): void => {
    const next = { ...data };
    // Unset optional values are removed, never stored as "", so the model and exports stay minimal.
    if (value === undefined) delete next[key];
    else next[key] = value;
    props.onChange({ type: "module", data: next });
  };
  return (
    <SpaceBetween size="m">
      {MODULE_FIELDS[props.moduleId].map((f) =>
        f.kind === "checkbox" ? (
          <Checkbox
            key={f.key}
            checked={data[f.key] !== false}
            description={f.description}
            onChange={(e) => set(f.key, e.detail.checked)}
          >
            {f.label}
          </Checkbox>
        ) : (
          <ScopeField key={f.key} label={f.label} description={f.description} error={errorTextAt(props.issues, "data." + f.key)}>
            <Input
              value={str(data[f.key])}
              placeholder={f.placeholder}
              onChange={(e) => set(f.key, f.optional && e.detail.value === "" ? undefined : e.detail.value)}
            />
          </ScopeField>
        ),
      )}
    </SpaceBetween>
  );
}
