import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { createContext, useCallback, useContext, type JSX, type ReactNode } from "react";
import type { Issue } from "../../../core/types";
import { useBuilderStore } from "../../../state/builder";
import { errorTextAt } from "../issues";
import { useFocusTarget } from "../useFocusTarget";

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The touched id of the scope fields below it: their grant's focus id, which is what `focusIdFor` gives the grant's
 * issues, so the output panel holds them back until the user has left one of these fields.
 */
export const ScopeTouchId = createContext("");

/** A form field whose error appears after its first blur, so a fresh grant is not covered in red. */
export function ScopeField(props: {
  label: string;
  description?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}): JSX.Element {
  const id = useContext(ScopeTouchId);
  const touch = useBuilderStore((s) => s.touch);
  const revealed = useBuilderStore((s) => s.isRevealed(id));
  return (
    <div onBlur={() => touch(id)}>
      <FormField label={props.label} description={props.description} errorText={revealed ? props.error : undefined}>
        {props.children}
      </FormField>
    </div>
  );
}

function ListItem(props: {
  label: string;
  removeLabel: string;
  value: string;
  error?: string | undefined;
  canRemove: boolean;
  focusId?: string | undefined;
  onChange(v: string): void;
  onRemove(): void;
}): JSX.Element {
  const scopeId = useContext(ScopeTouchId);
  const id = props.focusId ?? scopeId;
  const touch = useBuilderStore((s) => s.touch);
  const revealed = useBuilderStore((s) => s.isRevealed(id));
  const onFocus = useCallback(() => touch(id), [touch, id]);
  const ref = useFocusTarget<HTMLDivElement>(props.focusId ?? "", onFocus);
  return (
    <div ref={ref} onBlur={onFocus}>
      <FormField errorText={revealed ? props.error : undefined} stretch>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <Input ariaLabel={props.label} value={props.value} onChange={(e) => props.onChange(e.detail.value)} />
          </div>
          <Button
            iconName="close"
            variant="icon"
            ariaLabel={props.removeLabel}
            disabled={!props.canRemove}
            onClick={props.onRemove}
          />
        </div>
      </FormField>
    </div>
  );
}

/** A list of text inputs with Add and Remove. `item` is the singular label, e.g. "Prefix" -> "Prefix 1". */
export function StringList(props: {
  item: string;
  /** Lower-case form used in the remove button name, e.g. "prefix". */
  removeNoun: string;
  addLabel: string;
  values: string[];
  /** Fewest rows the list may have; the remove buttons are disabled at this size. */
  min: number;
  issues: Issue[];
  /** Path of row `i`, e.g. `data.prefixes[0]`. */
  pathOf(i: number): string;
  /** Focus-target id of row `i`, so a "Jump to" can land on it. */
  focusIdOf?(i: number): string;
  onChange(values: string[]): void;
}): JSX.Element {
  const { values, onChange } = props;
  return (
    <SpaceBetween size="xs">
      {values.map((v, i) => (
        <ListItem
          key={i}
          label={`${props.item} ${i + 1}`}
          removeLabel={`Remove ${props.removeNoun} ${i + 1}`}
          value={v}
          error={errorTextAt(props.issues, props.pathOf(i))}
          canRemove={values.length > props.min}
          focusId={props.focusIdOf?.(i)}
          onChange={(next) => onChange(values.map((x, j) => (j === i ? next : x)))}
          onRemove={() => onChange(values.filter((_, j) => j !== i))}
        />
      ))}
      <Button iconName="add-plus" onClick={() => onChange([...values, ""])}>
        {props.addLabel}
      </Button>
    </SpaceBetween>
  );
}
