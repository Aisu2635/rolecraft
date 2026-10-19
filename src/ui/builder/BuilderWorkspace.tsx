import Button from "@cloudscape-design/components/button";
import { useEffect, type ReactNode } from "react";
import { useBuilderStore, type Step } from "../../state/builder";
import { StepHeader } from "./StepHeader";

export function BuilderWorkspace(props: {
  /** Shown above the step header, e.g. a dismissible notice. */
  banner?: ReactNode;
  sidebar: ReactNode;
  steps: [ReactNode, ReactNode, ReactNode];
  output: ReactNode;
}) {
  const step = useBuilderStore((s) => s.step);
  const setStep = useBuilderStore((s) => s.setStep);
  const target = useBuilderStore((s) => s.focusTarget);
  // Claimers sit inside the step and claim in their own effects, which run before this one. A target still set a
  // tick later has no claimer (e.g. a new grant while the Grid is shown); drop it so it cannot steal focus later.
  useEffect(() => {
    if (target === null) return;
    const t = setTimeout(() => {
      if (useBuilderStore.getState().focusTarget === target) useBuilderStore.getState().focus(null);
    }, 0);
    return () => clearTimeout(t);
  }, [target]);
  return (
    <div className="rc-ws">
      <aside className="rc-col rc-side" aria-label="Services and templates">
        {props.sidebar}
      </aside>
      <main className="rc-col rc-main">
        {props.banner}
        <StepHeader step={step} onSelect={setStep} />
        <div className="rc-step-body">{props.steps[step]}</div>
        <div className="rc-step-nav">
          {step > 0 && (
            <Button onClick={() => setStep((step - 1) as Step)}>
              Previous
            </Button>
          )}
          {step < 2 && (
            <Button
              variant="primary"
              onClick={() => setStep((step + 1) as Step)}
            >
              Next
            </Button>
          )}
        </div>
      </main>
      <section className="rc-col rc-out" aria-label="Generated output">
        {props.output}
      </section>
    </div>
  );
}
