import { Check } from "@phosphor-icons/react";
import type { Step } from "../../state/builder";

export const STEP_LABELS = [
  "Trusted entity",
  "Permissions",
  "Review and export",
] as const;

export function StepHeader(props: { step: Step; onSelect(s: Step): void }) {
  return (
    <nav aria-label="Builder steps" className="rc-steps">
      {STEP_LABELS.map((label, i) => {
        const state =
          i < props.step ? "done" : i === props.step ? "cur" : "todo";
        return (
          <button
            key={label}
            type="button"
            className={`rc-st ${state}`}
            aria-current={i === props.step ? "step" : undefined}
            onClick={() => props.onSelect(i as Step)}
          >
            <span className="c" aria-hidden="true">
              {state === "done" ? <Check size={12} weight="bold" /> : i + 1}
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}
