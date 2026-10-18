import Alert from "@cloudscape-design/components/alert";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useMemo, useState, type JSX } from "react";
import type { ExportInput } from "../../core/export/types";
import { CodeView } from "../builder/output/CodeView";
import { IssuesList } from "../builder/output/IssuesList";
import type { ExtraTab } from "../builder/output/OutputPanel";
import { SafeMarkdown } from "../common/SafeMarkdown";
import { ExporterStatus } from "./ExporterStatus";
import { useExporters, type Exporters, type ExportersState } from "./lazy";

type Shell = "bash" | "powershell";
type Format = Shell | "terraform" | "cloudformation";

const FORMAT_TABS = ["cli", "terraform", "cloudformation"];
/** Which export file and which how-to-apply section each format shows. */
const FORMAT = {
  bash: { language: "bash", section: "AWS CLI — bash", label: "Bash script" },
  powershell: { language: "powershell", section: "AWS CLI — PowerShell", label: "PowerShell script" },
  terraform: { language: "hcl", section: "Terraform", label: "Terraform configuration" },
  cloudformation: { language: "yaml", section: "CloudFormation", label: "CloudFormation template" },
} as const;

interface Body {
  node: JSX.Element;
  copyText?: string;
}

function body(
  format: Format,
  input: ExportInput,
  mod: Exporters | undefined,
  status: Pick<ExportersState, "status" | "retry">,
): Body {
  if (!mod) return { node: <ExporterStatus state={status} /> };
  const outcome = mod.exportAll(input);
  if (!outcome.ok) {
    return {
      node: (
        <SpaceBetween size="s">
          <Alert type="error">{outcome.reason}</Alert>
          <IssuesList issues={input.result.issues} severities={["error"]} />
        </SpaceBetween>
      ),
    };
  }
  const spec = FORMAT[format];
  const file = outcome.files.find((f) => f.language === spec.language);
  const sections = mod.applySections(input);
  const text = [sections[0], sections.find((s) => s.title === spec.section)]
    .filter((s) => s !== undefined)
    .map((s) => s.markdown)
    .join("\n");
  return {
    copyText: file?.content,
    node: (
      <SpaceBetween size="s">
        {file && <CodeView text={file.content} language={file.language} label={spec.label} />}
        <SafeMarkdown markdown={text} />
      </SpaceBetween>
    ),
  };
}

/**
 * The CLI, Terraform and CloudFormation tabs for the output panel. The exporters chunk is requested the first
 * time one of them is selected; until then (and without a derived input) the hook does nothing.
 */
export function useFormatTabs(input: ExportInput | null, active: string): ExtraTab[] {
  const [started, setStarted] = useState(false);
  const [shell, setShell] = useState<Shell>("bash");
  if (!started && FORMAT_TABS.includes(active)) setStarted(true);
  const { status, mod, retry } = useExporters(started);
  return useMemo(() => {
    if (!input) return [];
    const make = (id: string, label: string, format: Format, lead?: JSX.Element): ExtraTab => {
      const b = body(format, input, mod, { status, retry });
      return {
        id,
        label,
        copyText: b.copyText,
        content: (
          <SpaceBetween size="s">
            {lead}
            {b.node}
          </SpaceBetween>
        ),
      };
    };
    return [
      make(
        "cli",
        "CLI",
        shell,
        <SegmentedControl
          label="Shell"
          selectedId={shell}
          onChange={(e) => setShell(e.detail.selectedId as Shell)}
          options={[
            { id: "bash", text: "bash" },
            { id: "powershell", text: "PowerShell" },
          ]}
        />,
      ),
      make("terraform", "Terraform", "terraform"),
      make("cloudformation", "CloudFormation", "cloudformation"),
    ];
  }, [input, mod, status, retry, shell]);
}
