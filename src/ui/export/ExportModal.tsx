import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { useEffect, useMemo, useState, type JSX } from "react";
import type { ExportFile } from "../../core/export/json";
import type { ExportInput } from "../../core/export/types";
import { useBuilderStore } from "../../state/builder";
import { CodeView } from "../builder/output/CodeView";
import { IssuesList } from "../builder/output/IssuesList";
import { downloadFile } from "../common/download";
import { SafeMarkdown } from "../common/SafeMarkdown";
import { ExporterStatus } from "./ExporterStatus";
import { useExporters } from "./lazy";

const MIME: Record<string, string> = { json: "application/json", sh: "text/x-shellscript", md: "text/markdown" };
/** `.ps1`, `.tf`, `.yaml` and anything else: plain text. */
const mimeOf = (filename: string): string => MIME[filename.slice(filename.lastIndexOf(".") + 1)] ?? "text/plain";
const byteLength = (s: string): number => new TextEncoder().encode(s).length;

export function ExportModal(props: { visible: boolean; onDismiss(): void; input: ExportInput }): JSX.Element {
  const { input } = props;
  const exporters = useExporters(props.visible);
  const { mod } = exporters;
  const outcome = useMemo(() => (mod ? mod.exportAll(input) : undefined), [mod, input]);
  const [tab, setTab] = useState<string>();
  const blocked = props.visible && outcome !== undefined && !outcome.ok;
  // The blocked view lists every error as an error, to-dos included, and the builder's fields show them too.
  useEffect(() => {
    if (blocked) useBuilderStore.getState().revealAllErrors();
  }, [blocked]);
  const close = (
    <Box float="right">
      <Button onClick={props.onDismiss}>Close</Button>
    </Box>
  );

  if (outcome && !outcome.ok) {
    return (
      <Modal visible={props.visible} onDismiss={props.onDismiss} header="Export is blocked" closeAriaLabel="Close" footer={close}>
        <SpaceBetween size="s">
          <Alert type="error">{outcome.reason}</Alert>
          <IssuesList issues={input.result.issues} severities={["error"]} onJump={props.onDismiss} />
        </SpaceBetween>
      </Modal>
    );
  }

  const files: ExportFile[] = outcome?.ok ? outcome.files : [];
  return (
    <Modal visible={props.visible} onDismiss={props.onDismiss} header="Export" size="large" closeAriaLabel="Close" footer={close}>
      {!mod || !outcome?.ok ? (
        <ExporterStatus state={exporters} />
      ) : (
        <SpaceBetween size="m">
          <Button
            variant="primary"
            iconName="download"
            onClick={() => downloadFile(`${input.model.name}.zip`, mod.exportZip(files), "application/zip")}
          >
            Download ZIP
          </Button>
          <Table
            variant="embedded"
            items={files}
            trackBy="filename"
            columnDefinitions={[
              { id: "name", header: "File", cell: (f) => f.filename },
              { id: "size", header: "Size", cell: (f) => `${byteLength(f.content).toLocaleString("en-US")} bytes` },
              {
                id: "download",
                header: "Download",
                cell: (f) => (
                  <Button
                    variant="inline-link"
                    ariaLabel={`Download ${f.filename}`}
                    onClick={() => downloadFile(f.filename, f.content, mimeOf(f.filename))}
                  >
                    Download
                  </Button>
                ),
              },
            ]}
          />
          <Tabs
            activeTabId={tab ?? files[0]?.filename}
            onChange={(e) => setTab(e.detail.activeTabId)}
            tabs={files.map((f) => ({
              id: f.filename,
              label: f.filename,
              content: <CodeView text={f.content} language={f.language} label={f.filename} />,
            }))}
          />
          <SpaceBetween size="xs">
            <Box variant="h3">How to apply</Box>
            {mod.applySections(input).map((s) => (
              <SafeMarkdown key={s.title} markdown={s.markdown} />
            ))}
          </SpaceBetween>
        </SpaceBetween>
      )}
    </Modal>
  );
}

/** The Export button of the output panel and the modal it opens. */
export function ExportButton(props: { input: ExportInput }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button iconName="download" onClick={() => setOpen(true)}>
        Export
      </Button>
      <ExportModal visible={open} onDismiss={() => setOpen(false)} input={props.input} />
    </>
  );
}
