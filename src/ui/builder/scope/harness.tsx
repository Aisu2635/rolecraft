import { useState, type JSX } from "react";
import type { Scope } from "../../../core/model/model";
import type { Issue, SlimService } from "../../../core/types";

/** Test helper: owns the scope state and records every value the editor emits. */
export function ScopeHarness(props: {
  initial: Scope;
  seen: Scope[];
  render(scope: Scope, onChange: (s: Scope) => void, issues: Issue[]): JSX.Element;
  issues?: Issue[];
}): JSX.Element {
  const [scope, setScope] = useState<Scope>(props.initial);
  return props.render(
    scope,
    (s) => {
      props.seen.push(s);
      setScope(s);
    },
    props.issues ?? [],
  );
}

export const fakeService = (over: Partial<SlimService> = {}): SlimService => ({
  key: "x",
  name: "X",
  category: "Other",
  actions: [],
  resources: [],
  conditionKeys: [],
  ...over,
});
