import ProgressBar from "@cloudscape-design/components/progress-bar";
import type { JSX } from "react";

const n = (v: number): string => v.toLocaleString("en-US");

export function SizeMeter(props: { size: number; limit: number }): JSX.Element {
  const { size, limit } = props;
  const over = size > limit;
  return (
    <ProgressBar
      label="Policy size"
      description={`${n(size)} / ${n(limit)}`}
      value={Math.min(100, (size / limit) * 100)}
      status={over ? "error" : "in-progress"}
      resultText={over ? "Over the limit" : undefined}
      additionalInfo={over ? "This policy is larger than AWS allows." : undefined}
    />
  );
}
