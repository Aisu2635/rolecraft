import Multiselect, { type MultiselectProps } from "@cloudscape-design/components/multiselect";
import { useMemo, type JSX } from "react";
import type { AccessSelection, Grant } from "../../../core/model/model";
import { ACCESS_LEVELS, type SlimService } from "../../../core/types";

type Option = MultiselectProps.Option;

/** Options grouped by access level in ACCESS_LEVELS order, labelled with the action and described by its name. */
function buildGroups(svc: SlimService): { groups: MultiselectProps.OptionGroup[]; byName: Map<string, Option> } {
  const byName = new Map<string, Option>();
  const groups: MultiselectProps.OptionGroup[] = [];
  for (const level of ACCESS_LEVELS) {
    const options = svc.actions
      .filter((a) => a.level === level)
      .map((a): Option => {
        const option = { value: a.name, label: a.label, description: a.name };
        byName.set(a.name, option);
        return option;
      });
    if (options.length > 0) groups.push({ label: level, options });
  }
  return { groups, byName };
}

/** Pick individual actions for a grant. Clearing the last one goes back to an empty set of access levels. */
export function ActionPicker(props: {
  grant: Grant;
  svc: SlimService;
  onChange(access: AccessSelection): void;
}): JSX.Element {
  const { grant, svc, onChange } = props;
  // A service has hundreds of actions, so the option list is built once per service, not per keystroke.
  const { groups, byName } = useMemo(() => buildGroups(svc), [svc]);
  const names = grant.access.type === "actions" ? grant.access.actions : [];
  // An action the service no longer has still shows as a token, so it can be removed.
  const selected = names.map((n) => byName.get(n) ?? { value: n, label: n });
  return (
    <Multiselect
      selectedOptions={selected}
      options={groups}
      filteringType="auto"
      placeholder="Choose actions"
      filteringPlaceholder="Find actions"
      filteringAriaLabel="Find actions"
      empty="No matching actions"
      ariaLabel={`Individual ${svc.name} actions`}
      deselectAriaLabel={(o) => `Remove ${o.label ?? o.value ?? "action"}`}
      keepOpen
      onChange={(e) => {
        const actions = e.detail.selectedOptions.flatMap((o) => (o.value === undefined ? [] : [o.value]));
        onChange(actions.length === 0 ? { type: "levels", levels: [] } : { type: "actions", actions });
      }}
    />
  );
}
