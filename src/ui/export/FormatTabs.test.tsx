import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportAll } from "../../core/export";
import { useBuilderStore } from "../../state/builder";
import { deriveOutput } from "../../state/derive";
import { OutputPanel } from "../builder/output/OutputPanel";
import { grantFor, readyCatalog, withCatalog } from "../builder/permissions/test-catalog";
import { useFormatTabs } from "./FormatTabs";

const flags = vi.hoisted(() => ({ fail: false }));
vi.mock("./exporters", async (orig) => {
  if (flags.fail) throw new Error("chunk failed");
  return orig();
});

const store = () => useBuilderStore.getState();
const writeText = vi.fn(() => Promise.resolve());
type Cat = Awaited<ReturnType<typeof readyCatalog>>;

beforeEach(() => {
  store().reset();
  flags.fail = false;
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

async function s3Group(): Promise<Cat> {
  const cat = await readyCatalog("s3");
  const g = grantFor(cat, "s3", "g1");
  act(() => {
    store().setFields({ name: "analytics-reader" });
    store().setTrust({ kind: "principal", target: "group", name: "analytics-team" });
    store().addGrant({
      ...g,
      scope: { type: "module", data: { bucket: "data-lake", prefixes: ["reports/"], allowNavigation: false } },
    });
  });
  return cat;
}

const panel = (cat: Cat) => render(withCatalog(cat, <OutputPanel useExtraTabs={useFormatTabs} />));

function files(cat: Cat) {
  const d = deriveOutput(store().model, cat.getState());
  if (d.kind !== "ready") throw new Error("not ready");
  const out = exportAll(d.input);
  if (!out.ok) throw new Error(out.reason);
  return out.files;
}
const text = (name: string, fs: ReturnType<typeof files>) => fs.find((f) => f.filename === name)!.content;
const panelOf = (name: string) => screen.getByRole("tabpanel", { name });
const activePre = (name = "CLI") => panelOf(name).querySelector("pre") as HTMLElement;

describe("FormatTabs", () => {
  it("shows the load failure, and Retry loads the exporters", async () => {
    const cat = await s3Group();
    flags.fail = true;
    panel(cat);
    fireEvent.click(screen.getByRole("tab", { name: "CLI" }));
    expect(screen.getByText("Loading exporters…")).toBeInTheDocument();
    expect(
      await screen.findByText("Couldn't load the exporters. Check your connection and try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    flags.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(activePre()).toBeTruthy());
  });

  it("CLI tab shows the bash script with its notes, and Copy copies the file", async () => {
    const cat = await s3Group();
    const fs = files(cat);
    panel(cat);
    expect(screen.queryByText("Loading exporters…")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "CLI" }));
    await waitFor(() => expect(activePre().textContent).toBe(text("attach-policy.sh", fs)));
    expect(screen.getByText(/AWS CLI v2 \(2\.15\.38 or later/)).toBeInTheDocument();
    expect(screen.getByText(/Keep its LF line endings/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(text("attach-policy.sh", fs)));
  });

  it("the PowerShell choice shows the .ps1 file and its notes", async () => {
    const cat = await s3Group();
    const fs = files(cat);
    panel(cat);
    fireEvent.click(screen.getByRole("tab", { name: "CLI" }));
    await waitFor(() => expect(activePre()).toBeTruthy());
    fireEvent.click(screen.getByText("PowerShell"));
    await waitFor(() => expect(activePre().textContent).toBe(text("attach-policy.ps1", fs)));
    const body = panelOf("CLI").textContent!;
    for (const t of ["-File", "-ExecutionPolicy Bypass", "Unblock-File", "AWS CLI v2 (2.15.38 or later"]) {
      expect(body).toContain(t);
    }
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(text("attach-policy.ps1", fs)));
  });

  it.each([
    ["Terraform", "main.tf"],
    ["CloudFormation", "template.yaml"],
  ])("%s tab shows %s", async (tab, file) => {
    const cat = await s3Group();
    const fs = files(cat);
    panel(cat);
    fireEvent.click(screen.getByRole("tab", { name: tab }));
    await waitFor(() => expect(activePre(tab).textContent).toBe(text(file, fs)));
    expect(screen.getByRole("heading", { name: tab })).toBeInTheDocument();
  });

  it("an error model says why it can't export and shows no code", async () => {
    const cat = await readyCatalog("s3");
    act(() => store().setTrust({ kind: "github", owner: "", repo: "r", ref: { type: "branch", value: "main" } }));
    panel(cat);
    fireEvent.click(screen.getByRole("tab", { name: "Terraform" }));
    expect(await screen.findByText("Fix the errors before exporting.")).toBeInTheDocument();
    const tabpanel = panelOf("Terraform");
    expect(tabpanel.querySelector("pre")).toBeNull();
    expect(within(tabpanel).getAllByRole("button", { name: /^Jump to/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
  });
});
