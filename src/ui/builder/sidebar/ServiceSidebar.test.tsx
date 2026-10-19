import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLoader } from "../../../core/catalog/loader";
import { useBuilderStore } from "../../../state/builder";
import { CatalogContext, createCatalogStore } from "../../../state/catalog";
import { SERVICE_SEARCH_ID, ServiceSidebar } from "./ServiceSidebar";

const read = (p: string): unknown => JSON.parse(readFileSync(resolve("public", p.replace(/^\//, "")), "utf8"));

function setup(fail: (path: string) => boolean = () => false) {
  const calls: string[] = [];
  const store = createCatalogStore(
    createLoader(async (p) => {
      calls.push(p);
      if (fail(p)) throw new Error("boom");
      return read(p);
    }),
  );
  const view = render(
    <CatalogContext.Provider value={store}>
      <ServiceSidebar />
    </CatalogContext.Provider>,
  );
  return { calls, store, ...view };
}

const grants = () => useBuilderStore.getState().model.grants;

beforeEach(() => useBuilderStore.getState().reset());
afterEach(cleanup);

describe("ServiceSidebar", () => {
  it("searches services with the best match first", async () => {
    setup();
    const input = screen.getByLabelText("Search services");
    expect(input).toHaveAttribute("id", SERVICE_SEARCH_ID);
    expect(input).toHaveAttribute("placeholder", "Search 450+ services");
    await screen.findByText("Popular");
    fireEvent.change(input, { target: { value: "s3" } });
    const results = await screen.findByRole("list", { name: "Search results" });
    expect(within(results).getAllByRole("button")[0]).toHaveTextContent("Amazon S3");
  });

  it("says when nothing matches", async () => {
    setup();
    await screen.findByText("Popular");
    fireEvent.change(screen.getByLabelText("Search services"), { target: { value: "zzzzqq" } });
    expect(screen.getByText("No services match.")).toBeInTheDocument();
  });

  it("Enter in the search picks the first result", async () => {
    setup();
    await screen.findByText("Popular");
    const input = screen.getByLabelText("Search services");
    fireEvent.change(input, { target: { value: "s3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(grants()).toHaveLength(1));
    expect(grants()[0]!.service).toBe("s3");
  });

  it("focuses the search on Ctrl+K and Cmd+K, and stops listening after unmount", async () => {
    const { unmount } = setup();
    const input = screen.getByLabelText("Search services");
    expect(input).not.toHaveFocus();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(input).toHaveFocus();
    input.blur();
    fireEvent.keyDown(window, { key: "K", metaKey: true });
    expect(input).toHaveFocus();
    input.blur();
    fireEvent.keyDown(window, { key: "k" });
    expect(input).not.toHaveFocus();
    unmount();
    const ev = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("ignores keydown events that carry no key", () => {
    setup();
    const ev = new KeyboardEvent("keydown", { ctrlKey: true, cancelable: true });
    Object.defineProperty(ev, "key", { value: undefined });
    expect(() => window.dispatchEvent(ev)).not.toThrow();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("prevents the browser default for Ctrl+K", () => {
    setup();
    const ev = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("choosing S3 adds one grant, goes to step 1 and focuses the grant", async () => {
    setup();
    const popular = await screen.findByText("Popular");
    const section = popular.closest("section")!;
    fireEvent.click(within(section).getByRole("button", { name: "Amazon S3" }));
    await waitFor(() => expect(grants()).toHaveLength(1));
    const s = useBuilderStore.getState();
    expect(s.model.grants[0]!.module).toBe("s3");
    expect(s.step).toBe(1);
    expect(s.focusTarget).toBe("grant:" + s.model.grants[0]!.id);
  });

  it("a double click adds a single grant", async () => {
    setup();
    const popular = await screen.findByText("Popular");
    const btn = within(popular.closest("section")!).getByRole("button", { name: "Amazon S3" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(grants()).toHaveLength(1));
    await act(async () => {});
    expect(grants()).toHaveLength(1);
  });

  it("lists services in this role with a count", async () => {
    setup();
    const popular = await screen.findByText("Popular");
    const btn = within(popular.closest("section")!).getByRole("button", { name: "Amazon S3" });
    fireEvent.click(btn);
    await waitFor(() => expect(grants()).toHaveLength(1));
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(grants()).toHaveLength(2));
    const role = screen.getByText("In this role").closest("section")!;
    expect(within(role).getByRole("button", { name: "Amazon S3" })).toBeInTheDocument();
    expect(within(role).getByText("2")).toBeInTheDocument();
    expect(within(role).getByText("permissions")).toBeInTheDocument();
  });

  it("renders categories and A-Z lazily", async () => {
    setup();
    await screen.findByText("Popular");
    expect(screen.getByText("Browse by category")).toBeInTheDocument();
    // Text queries, not role queries: computing roles over ~450 buttons is what made this test slow.
    expect(screen.queryByText("A2c")).toBeNull();
    fireEvent.click(screen.getByText("A–Z"));
    expect(await screen.findByText("A2c")).toBeInTheDocument();
    const s3Before = screen.getAllByText("Amazon S3").length;
    fireEvent.click(screen.getByText("Storage"));
    expect(screen.getAllByText("Amazon S3")).toHaveLength(s3Before + 1);
  });

  it("shows an inline error when a service fails and recovers on Retry", async () => {
    let failS3 = true;
    setup((p) => failS3 && p.endsWith("/s3.json"));
    const popular = await screen.findByText("Popular");
    fireEvent.click(within(popular.closest("section")!).getByRole("button", { name: "Amazon S3" }));
    expect(await screen.findByText(/Couldn't load Amazon S3/)).toBeInTheDocument();
    expect(grants()).toHaveLength(0);
    failS3 = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(grants()).toHaveLength(1));
    expect(screen.queryByText(/Couldn't load Amazon S3/)).toBeNull();
  });

  it("shows a Retry alert when the index fails and recovers", async () => {
    let fail = true;
    setup((p) => fail && p.endsWith("/index.json"));
    expect(await screen.findByText("Couldn't load the AWS service list.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Popular")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the AWS service list.")).toBeNull();
  });

  it("after the index Retry, also retries the services of restored grants that failed with it", async () => {
    let fail = true;
    useBuilderStore.getState().replaceModel({
      ...useBuilderStore.getState().model,
      grants: [{ id: "g1", service: "s3", scope: { type: "all" }, access: { type: "levels", levels: ["Read"] } }],
    });
    const { store } = setup((p) => fail && p.endsWith("/index.json"));
    await act(() => store.getState().ensureServices(["s3"]));
    expect(await screen.findByText("Couldn't load the AWS service list.")).toBeInTheDocument();
    expect(store.getState().status.s3).toBe("error");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(store.getState().status.s3).toBe("ready"));
  });
});
