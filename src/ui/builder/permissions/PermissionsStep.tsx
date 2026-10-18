import SegmentedControl from "@cloudscape-design/components/segmented-control";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { JSX } from "react";
import { useBuilderStore } from "../../../state/builder";
import { GridEditor } from "./GridEditor";
import { SentenceEditor } from "./SentenceEditor";

/** Step 2. The plain-English summary (Task 8) plug in here. */
export function PermissionsStep(): JSX.Element {
  const editor = useBuilderStore((s) => s.editor);
  const setEditor = useBuilderStore((s) => s.setEditor);
  return (
    <SpaceBetween size="l">
      <SegmentedControl
        selectedId={editor}
        label="Editor"
        options={[
          { id: "sentences", text: "Sentences" },
          { id: "grid", text: "Grid" },
        ]}
        onChange={(e) => setEditor(e.detail.selectedId === "grid" ? "grid" : "sentences")}
      />
      {editor === "grid" ? <GridEditor /> : <SentenceEditor />}
    </SpaceBetween>
  );
}
