import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { JSX } from "react";
import type { Scope } from "../../../core/model/model";
import type { Issue } from "../../../core/types";
import { errorTextAt } from "../issues";
import { ScopeField, StringList, isRecord, str } from "./shared";

type Selector = { type: "tag"; key: string; value: string } | { type: "ids"; ids: string[] } | { type: "all" };

function read(data: unknown): Selector {
  const sel = isRecord(data) && isRecord(data.selector) ? data.selector : {};
  if (sel.type === "ids") return { type: "ids", ids: Array.isArray(sel.ids) ? sel.ids.map(str) : [""] };
  if (sel.type === "all") return { type: "all" };
  return { type: "tag", key: str(sel.key), value: str(sel.value) };
}

// Switching starts from the new type's empty-but-well-formed shape, so the data always parses structurally.
const FRESH: Record<Selector["type"], Selector> = {
  tag: { type: "tag", key: "", value: "" },
  ids: { type: "ids", ids: [""] },
  all: { type: "all" },
};

export function Ec2ScopeEditor(props: { data: unknown; issues: Issue[]; onChange(scope: Scope): void }): JSX.Element {
  const sel = read(props.data);
  const err = (path: string) => errorTextAt(props.issues, path);
  const write = (selector: Selector): void => props.onChange({ type: "module", data: { selector } });
  return (
    <SpaceBetween size="m">
      <RadioGroup
        value={sel.type}
        ariaLabel="Which instances"
        items={[
          { value: "tag", label: "Instances with tag" },
          { value: "ids", label: "Specific instance IDs" },
          { value: "all", label: "All instances" },
        ]}
        onChange={(e) => write(FRESH[e.detail.value as Selector["type"]])}
      />
      {sel.type === "tag" && (
        <SpaceBetween size="m" direction="horizontal">
          <ScopeField label="Tag key" error={err("data.selector.key")}>
            <Input value={sel.key} placeholder="Env" onChange={(e) => write({ ...sel, key: e.detail.value })} />
          </ScopeField>
          <ScopeField label="Tag value" error={err("data.selector.value")}>
            <Input value={sel.value} placeholder="dev" onChange={(e) => write({ ...sel, value: e.detail.value })} />
          </ScopeField>
        </SpaceBetween>
      )}
      {sel.type === "ids" && (
        <ScopeField label="Instance IDs" error={err("data.selector.ids")}>
          <StringList
            item="Instance ID"
            removeNoun="instance ID"
            addLabel="Add instance ID"
            values={sel.ids}
            min={1}
            issues={props.issues}
            pathOf={(i) => `data.selector.ids[${i}]`}
            onChange={(ids) => write({ type: "ids", ids })}
          />
        </ScopeField>
      )}
    </SpaceBetween>
  );
}
