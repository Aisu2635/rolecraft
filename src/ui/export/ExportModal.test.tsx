import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportAll } from "../../core/export";
import { build, moduleGrant, REFERENCE_CASES } from "../../core/export/__fixtures__/cases";
import { applySections } from "../../core/export/readme";
import { useBuilderStore } from "../../state/builder";
import { downloadFile } from "../common/download";
import { ExportButton, ExportModal } from "./ExportModal";

vi.mock("../common/download", () => ({ downloadFile: vi.fn() }));

const input = REFERENCE_CASES["s3-group"]!();
const out = exportAll(input);
const files = out.ok ? out.files : [];

beforeEach(() => {
  useBuilderStore.getState().reset();
  vi.mocked(downloadFile).mockClear();
});
afterEach(cleanup);

describe("ExportModal", () => {
  it("downloads the ZIP of exactly the exported files", async () => {
    render(<ExportModal visible onDismiss={() => {}} input={input} />);
    fireEvent.click(await screen.findByRole("button", { name: "Download ZIP" }));
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [name, data, mime] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(name).toBe("analytics-reader.zip");
    expect(mime).toBe("application/zip");
    const unzipped = unzipSync(data as Uint8Array);
    expect(Object.keys(unzipped)).toEqual(files.map((f) => f.filename));
    for (const f of files) expect(strFromU8(unzipped[f.filename]!)).toBe(f.content);
  });

  it("lists every file with its size and downloads each with the right MIME type", async () => {
    render(<ExportModal visible onDismiss={() => {}} input={input} />);
    await screen.findByRole("button", { name: "Download ZIP" });
    const mimes: Record<string, string> = {
      "policy.json": "application/json",
      "attach-policy.sh": "text/x-shellscript",
      "attach-policy.ps1": "text/plain",
      "main.tf": "text/plain",
      "template.yaml": "text/plain",
      "README.md": "text/markdown",
    };
    expect(files.map((f) => f.filename).sort()).toEqual(Object.keys(mimes).sort());
    for (const f of files) {
      const row = screen.getAllByRole("row").find((r) => within(r).queryByText(f.filename))!;
      expect(row.textContent).toContain(new TextEncoder().encode(f.content).length.toLocaleString("en-US"));
      fireEvent.click(within(row).getByRole("button", { name: `Download ${f.filename}` }));
      expect(downloadFile).toHaveBeenLastCalledWith(f.filename, f.content, mimes[f.filename]);
    }
  });

  it("previews a file per tab and shows the whole how-to-apply text", async () => {
    render(<ExportModal visible onDismiss={() => {}} input={input} />);
    await screen.findByRole("button", { name: "Download ZIP" });
    fireEvent.click(screen.getByRole("tab", { name: "main.tf" }));
    const tf = files.find((f) => f.filename === "main.tf")!.content;
    expect(screen.getAllByLabelText("main.tf").some((e) => e.textContent === tf)).toBe(true);
    for (const s of applySections(input)) {
      if (s.title) expect(screen.getByRole("heading", { name: s.title })).toBeInTheDocument();
    }
  });

  it("when blocked, says why, lists errors and has no download controls; Jump to closes first", async () => {
    const bad = build({
      name: "x",
      trust: { kind: "github", owner: "", repo: "r", ref: { type: "branch", value: "main" } },
      grants: [moduleGrant("g1", "s3", "list-read", { bucket: "b", prefixes: [""] })],
    });
    const onDismiss = vi.fn();
    render(<ExportModal visible onDismiss={onDismiss} input={bad} />);
    expect(await screen.findByText("Export is blocked")).toBeInTheDocument();
    expect(screen.getByText("Fix the errors before exporting.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
    const order: string[] = [];
    onDismiss.mockImplementation(() => order.push("close"));
    const unsub = useBuilderStore.subscribe(() => order.push("nav"));
    fireEvent.click(screen.getAllByRole("button", { name: /^Jump to/ })[0]!);
    expect(order).toEqual(["close"]);
    await waitFor(() => expect(order).toContain("nav"));
    unsub();
  });

  it("is not rendered until visible", () => {
    render(<ExportModal visible={false} onDismiss={() => {}} input={input} />);
    expect(screen.queryByRole("button", { name: "Download ZIP" })).toBeNull();
  });
});

describe("ExportButton", () => {
  it("opens the modal and closes it again", async () => {
    render(<ExportButton input={input} />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await screen.findByRole("button", { name: "Download ZIP" });
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);
    await waitFor(() => expect(document.querySelector("[class*=awsui_hidden]")).not.toBeNull());
  });
});
