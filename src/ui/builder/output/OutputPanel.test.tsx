import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoader } from "../../../core/catalog/loader";
import { stringifyPolicy } from "../../../core/export/json";
import { useBuilderStore } from "../../../state/builder";
import { createCatalogStore } from "../../../state/catalog";
import { deriveOutput } from "../../../state/derive";
import type { JSX } from "react";
import { grantFor, readyCatalog, withCatalog } from "../permissions/test-catalog";
import { ScopeEditor } from "../scope/ScopeEditor";
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

  it("asks for the to-dos, not a service, when a grant exists but its bucket is still empty", async () => {
    const cat = await s3GroupModel({ bucket: "" });
    render(withCatalog(cat, <OutputPanel />));
    expect(ready(cat).issues.some((x) => x.id === "I_NO_PERMISSIONS")).toBe(true);
    expect(screen.queryByText(/No permissions yet/)).toBeNull();
    const panel = screen.getByRole("tabpanel", { name: "Policy" });
    expect(within(panel).getByText("Finish the to-do items to generate a policy.")).toBeInTheDocument();
    expect(screen.getAllByText("Finish the to-do items to generate a policy.").length).toBe(2);
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
      store().revealAllErrors();
    });
    render(withCatalog(cat, <OutputPanel />));
    expect(screen.getByText("This policy has errors. Fix them before you apply it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\d+ errors?/ })).toBeInTheDocument();
    const jump = screen.getAllByRole("button", { name: /^Jump to/ }).find((b) => /owner/i.test(b.getAttribute("aria-label") ?? ""));
    fireEvent.click(jump!);
    expect(store().step).toBe(0);
    expect(store().focusTarget).toBe("field:trust.owner");
  });

  it("disables Copy while errors leave no policy to copy", async () => {
    const cat = await s3GroupModel({ bucket: "Bad Bucket" });
    expect(ready(cat).policy).toBeNull();
    act(() => store().touch("grant:g1"));
    render(withCatalog(cat, <OutputPanel />));
    expect(screen.getByText("This policy has errors. Fix them before you apply it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
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

describe("OutputPanel copy and tab fallbacks", () => {
  it("disables Copy when the active tab has no text", async () => {
    const cat = await readyCatalog("s3");
    act(() => store().setTrust({ kind: "principal", target: "group", name: "devs" }));
    render(
      withCatalog(cat, <OutputPanel extraTabs={[{ id: "cli", label: "CLI", content: <p>loading</p> }]} />),
    );
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "Trust" }));
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "CLI" }));
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("enables Copy for a tab that has text", async () => {
    const cat = await s3GroupModel();
    render(
      withCatalog(cat, <OutputPanel extraTabs={[{ id: "cli", label: "CLI", content: <p>x</p>, copyText: "aws" }]} />),
    );
    expect(screen.getByRole("button", { name: "Copy" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "CLI" }));
    expect(screen.getByRole("button", { name: "Copy" })).not.toBeDisabled();
  });

  it("falls back to the Policy tab when the active tab disappears", async () => {
    const cat = await s3GroupModel();
    const tabs = [{ id: "cli", label: "CLI", content: <p>cli body</p>, copyText: "aws" }];
    const { rerender } = render(withCatalog(cat, <OutputPanel extraTabs={tabs} />));
    fireEvent.click(screen.getByRole("tab", { name: "CLI" }));
    rerender(withCatalog(cat, <OutputPanel extraTabs={[]} />));
    expect(screen.getByRole("tab", { name: "Policy" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Policy JSON")).toBeInTheDocument();
    rerender(withCatalog(cat, <OutputPanel extraTabs={tabs} />));
    expect(screen.getByRole("tab", { name: "Policy" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps Copy enabled and shows the error banner when there are errors AND policy text (spec 6.5)", async () => {
    const cat = await s3GroupModel();
    act(() => {
      store().setTrust({ kind: "github", owner: "", repo: "r", ref: { type: "branch", value: "main" } });
      store().touch("field:trust.owner");
    });
    const r = ready(cat);
    expect(r.issues.some((i) => i.severity === "error")).toBe(true);
    expect(r.policy).not.toBeNull();
    render(withCatalog(cat, <OutputPanel />));
    expect(screen.getByText("This policy has errors. Fix them before you apply it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(stringifyPolicy(r.policy!)));
  });

  it("renders actions given as a function of the derived input", async () => {
    const cat = await s3GroupModel();
    render(withCatalog(cat, <OutputPanel actions={(input) => <button>Export {input.model.grants.length}</button>} />));
    expect(screen.getByRole("button", { name: "Export 1" })).toBeInTheDocument();
  });

  it("hands useExtraTabs the derived input and the active tab", async () => {
    const cat = await s3GroupModel();
    const seen: [boolean, string][] = [];
    const useExtraTabs = (input: unknown, active: string) => {
      seen.push([input !== null, active]);
      return [{ id: "cli", label: "CLI", content: <p>cli body</p>, copyText: "aws" }];
    };
    render(withCatalog(cat, <OutputPanel useExtraTabs={useExtraTabs} />));
    fireEvent.click(screen.getByRole("tab", { name: "CLI" }));
    expect(seen[0]).toEqual([true, "policy"]);
    expect(seen[seen.length - 1]).toEqual([true, "cli"]);
  });
});

/** The S3 grant's scope editor beside the panel, as in the builder. */
function GrantScopeAndPanel(props: { cat: Cat }): JSX.Element {
  const grant = useBuilderStore((s) => s.model.grants[0]!);
  const svc = props.cat.getState().services.s3!;
  return (
    <>
      <ScopeEditor grant={grant} svc={svc} issues={[]} onChange={(scope) => store().updateGrant(grant.id, (g) => ({ ...g, scope }))} />
      <div data-testid="panel">
        <OutputPanel />
      </div>
    </>
  );
}

describe("OutputPanel: a calm first run", () => {
  const panel = () => screen.getByTestId("panel");
  const red = () => panel().querySelector("[class*=awsui_status-error]");

  it("after adding S3, the empty bucket is a to-do, not an error, until the bucket is left", async () => {
    const cat = await readyCatalog("s3");
    act(() => store().addGrant(grantFor(cat, "s3", "g1")));
    render(withCatalog(cat, <GrantScopeAndPanel cat={cat} />));
    expect(red()).toBeNull();
    expect(within(panel()).getByText("To do")).toBeInTheDocument();
    expect(panel().querySelector("[class*=awsui_status-pending]")).toHaveTextContent("1 to do");
    expect(within(panel()).getByText("Enter the bucket name")).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: "Jump to: Enter the bucket name" })).toBeInTheDocument();
    expect(within(panel()).getByText("1 to do, 0 errors, 0 warnings, 1 info")).toBeInTheDocument();
    expect(within(panel()).queryByText("This policy has errors. Fix them before you apply it.")).toBeNull();
    // A calm banner holds the place of the error banner, so the buttons below do not move when it turns red.
    expect(within(panel()).getByText("Finish the to-do items before you apply this policy.")).toBeInTheDocument();

    fireEvent.blur(screen.getByLabelText("Bucket"));
    expect(within(panel()).queryByText("Finish the to-do items before you apply this policy.")).toBeNull();
    expect(within(panel()).queryByText("To do")).toBeNull();
    expect(within(panel()).getByText("1 error, 0 warnings, 1 info")).toBeInTheDocument();
    expect(within(panel()).getByText(/not a valid S3 bucket name/)).toBeInTheDocument();
    expect(within(panel()).getByText("This policy has errors. Fix them before you apply it.")).toBeInTheDocument();
  });

  it("after picking GitHub Actions there are no errors, only to-dos for every trust field", async () => {
    const cat = await readyCatalog("s3");
    act(() => store().setTrust({ kind: "github", owner: "", repo: "", ref: { type: "branch", value: "main" } }));
    render(withCatalog(cat, <div data-testid="panel"><OutputPanel /></div>));
    expect(red()).toBeNull();
    expect(within(panel()).getByText("4 to do, 0 errors, 0 warnings, 1 info")).toBeInTheDocument();
    for (const text of ["Enter the GitHub owner", "Enter the repository name", "Enter the 12-digit AWS account ID"]) {
      expect(within(panel()).getByText(text)).toBeInTheDocument();
    }
    expect(within(panel()).getByText("Enter both the GitHub owner and repository name.")).toBeInTheDocument();
  });

  it("keeps Copy disabled while a to-do leaves no policy", async () => {
    const cat = await readyCatalog("s3");
    act(() => store().addGrant(grantFor(cat, "s3", "g1")));
    render(withCatalog(cat, <div data-testid="panel"><OutputPanel /></div>));
    expect(red()).toBeNull();
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
  });
});

describe("OutputPanel: loading a role", () => {
  const panel = () => screen.getByTestId("panel");
  const load = (bucket: string, cat: Cat) =>
    act(() =>
      store().replaceModel({
        ...store().model,
        grants: [{ ...grantFor(cat, "s3", "g1"), scope: { type: "module", data: { bucket, prefixes: [""] } } }],
      }),
    );

  it("keeps a loaded empty bucket a to-do", async () => {
    const cat = await readyCatalog("s3");
    load("", cat);
    render(withCatalog(cat, <div data-testid="panel"><OutputPanel /></div>));
    expect(panel().querySelector("[class*=awsui_status-error]")).toBeNull();
    expect(within(panel()).getByText("Enter the bucket name")).toBeInTheDocument();
  });

  it("shows a loaded invalid bucket as an error at once", async () => {
    const cat = await readyCatalog("s3");
    load("Bad_Bucket", cat);
    render(withCatalog(cat, <div data-testid="panel"><OutputPanel /></div>));
    expect(within(panel()).queryByText("To do")).toBeNull();
    expect(panel().querySelector("[class*=awsui_status-error]")).not.toBeNull();
    expect(within(panel()).getByText(/not a valid S3 bucket name/)).toBeInTheDocument();
  });
});
