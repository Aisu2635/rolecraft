import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoader } from "../../../core/catalog/loader";
import { stringifyPolicy } from "../../../core/export/json";
import { useBuilderStore } from "../../../state/builder";
import { createCatalogStore } from "../../../state/catalog";
import { deriveOutput } from "../../../state/derive";
import { grantFor, readyCatalog, withCatalog } from "../permissions/test-catalog";
import { OutputPanel } from "./OutputPanel";

const store = () => useBuilderStore.getState();
const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  store().reset();
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

type Cat = Awaited<ReturnType<typeof readyCatalog>>;

async function s3GroupModel(over: { inline?: boolean; bucket?: string } = {}): Promise<Cat> {
  const cat = await readyCatalog("s3");
  const g = grantFor(cat, "s3", "g1");
  act(() => {
    store().setTrust({ kind: "principal", target: "group", name: "devs" });
    store().setFields({ policyMode: over.inline ? "inline" : "managed" });
    store().addGrant({
      ...g,
      scope: { type: "module", data: { bucket: over.bucket ?? "my-bucket", prefixes: [""], allowNavigation: false } },
    });
  });
  return cat;
}

function ready(cat: Cat) {
  const d = deriveOutput(store().model, cat.getState());
  if (d.kind !== "ready") throw new Error("expected ready");
  return d.input.result;
}

describe("OutputPanel", () => {
  it("shows the generated policy and the principal-trust message on the Trust tab", async () => {
    const cat = await s3GroupModel();
    render(withCatalog(cat, <OutputPanel />));
    expect(screen.getByLabelText("Policy JSON").textContent).toBe(stringifyPolicy(ready(cat).policy!));
    fireEvent.click(screen.getByRole("tab", { name: "Trust" }));
    expect(
      screen.getByText("No trust policy: the policy is attached directly to the IAM group."),
    ).toBeInTheDocument();
  });

  it("says so when there is no policy yet", async () => {
    const cat = await readyCatalog("s3");
    render(withCatalog(cat, <OutputPanel />));
    const panel = screen.getByRole("tabpanel", { name: "Policy" });
    expect(within(panel).getByText("No permissions yet. Add a service to generate a policy.")).toBeInTheDocument();
  });

  it("copies the active tab's text", async () => {
    const cat = await s3GroupModel();
    render(withCatalog(cat, <OutputPanel />));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(stringifyPolicy(ready(cat).policy!)));
    act(() => store().setTrust({ kind: "service", service: "ec2" }));
    fireEvent.click(screen.getByRole("tab", { name: "Trust" }));
    const trustText = screen.getByLabelText("Trust policy JSON").textContent!;
    expect(trustText).toContain("ec2.amazonaws.com");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(trustText));
  });

  it("measures the policy against the managed limit", async () => {
    const cat = await s3GroupModel();
    render(withCatalog(cat, <OutputPanel />));
    const size = ready(cat).sizes.policy;
    expect(screen.getByText(`${size.toLocaleString("en-US")} / 6,144`)).toBeInTheDocument();
    expect(screen.getByText("Policy size")).toBeInTheDocument();
  });

  it("measures an inline group policy against 5,120", async () => {
    const cat = await s3GroupModel({ inline: true });
    render(withCatalog(cat, <OutputPanel />));
    expect(screen.getByText(/ \/ 5,120$/)).toBeInTheDocument();
  });

  it("an error model shows counts, the banner, and Jump to focuses the field", async () => {
    const cat = await readyCatalog("s3");
    act(() => {
      store().setTrust({ kind: "github", owner: "", repo: "r", ref: { type: "branch", value: "main" } });
      store().setStep(2);
    });
    render(withCatalog(cat, <OutputPanel />));
    expect(screen.getByText("This policy has errors. Fix them before you apply it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\d+ errors?/ })).toBeInTheDocument();
    const jump = screen.getAllByRole("button", { name: /^Jump to/ }).find((b) => /owner/i.test(b.getAttribute("aria-label") ?? ""));
    fireEvent.click(jump!);
    expect(store().step).toBe(0);
    expect(store().focusTarget).toBe("field:trust.owner");
  });

  it("keeps Copy available while errors exist", async () => {
    const cat = await s3GroupModel({ bucket: "Bad Bucket" });
    render(withCatalog(cat, <OutputPanel />));
    expect(screen.getByText("This policy has errors. Fix them before you apply it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).not.toBeDisabled();
  });

  it("shows a spinner while service data loads", async () => {
    const g = grantFor(await readyCatalog("s3"), "s3", "g1");
    const cat = createCatalogStore(createLoader(() => new Promise<never>(() => {})));
    act(() => store().addGrant(g));
    void cat.getState().ensureServices(["s3"]);
    render(withCatalog(cat, <OutputPanel />));
    expect(screen.getByText("Loading service data…")).toBeInTheDocument();
  });

  it("names the services that failed and retries them", async () => {
    const g = grantFor(await readyCatalog("s3"), "s3", "g1");
    const cat = createCatalogStore(createLoader(() => Promise.reject(new Error("offline"))));
    const retry = vi.spyOn(cat.getState(), "retry");
    act(() => store().addGrant(g));
    await act(async () => cat.getState().ensureServices(["s3"]));
    render(withCatalog(cat, <OutputPanel />));
    expect(screen.getByText("Couldn't load service data for: s3.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledWith("s3");
  });

  it("adds extra tabs, copies their text, and renders the action and share slots", async () => {
    const cat = await s3GroupModel();
    render(
      withCatalog(
        cat,
        <OutputPanel
          extraTabs={[{ id: "cli", label: "CLI", content: <p>cli body</p>, copyText: "aws iam" }]}
          actions={<button>Export</button>}
          share={<button>Share</button>}
        />,
      ),
    );
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "CLI" }));
    expect(screen.getByText("cli body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("aws iam"));
  });
});
