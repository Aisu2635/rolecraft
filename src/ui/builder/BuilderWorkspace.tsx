import Button from "@cloudscape-design/components/button";
import type { ReactNode } from "react";
import { useBuilderStore, type Step } from "../../state/builder";
import { StepHeader } from "./StepHeader";

export function BuilderWorkspace(props: {
  sidebar: ReactNode;
  steps: [ReactNode, ReactNode, ReactNode];
  output: ReactNode;
}) {
  const step = useBuilderStore((s) => s.step);
  const setStep = useBuilderStore((s) => s.setStep);
  return (
    <div className="rc-ws">
      <aside className="rc-col rc-side" aria-label="Services and templates">
        {props.sidebar}
      </aside>
      <main className="rc-col rc-main">
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
