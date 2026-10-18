import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoader } from "../../../core/catalog/loader";
import { moduleGrant } from "../../../core/export/__fixtures__/cases";
import type { Grant } from "../../../core/model/model";
import { useBuilderStore } from "../../../state/builder";
import { createCatalogStore } from "../../../state/catalog";
import { SERVICE_SEARCH_ID } from "../sidebar/ServiceSidebar";
import { SentenceEditor } from "./SentenceEditor";
import { grantFor, readyCatalog, withCatalog } from "./test-catalog";

const store = () => useBuilderStore.getState();
const grants = () => store().model.grants;
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
function chooseVerb(value: string, index = 0): void {
  const select = createWrapper(document.body).findAllSelects()[index]!;
  act(() => select.openDropdown());
  act(() => select.selectOptionByValue(value));
}
const verbText = () => createWrapper(document.body).findAllSelects()[0]!.findTrigger().getElement().textContent;
const never = () => createCatalogStore(createLoader(() => new Promise(() => undefined)));

beforeEach(() => store().reset());
afterEach(cleanup);

describe("SentenceEditor", () => {
  it("builds the reference S3 grant from typed bucket, prefix and verb", async () => {
    const cat = await readyCatalog("s3");
    store().addGrant(grantFor(cat, "s3", "g1"));
    render(withCatalog(cat, <SentenceEditor />));
    type("Bucket", "data-lake");
    type("Prefix 1", "reports/");
    chooseVerb("list-read");
    expect(grants()[0]).toEqual(
      moduleGrant("g1", "s3", "list-read", { bucket: "data-lake", prefixes: ["reports/"], allowNavigation: false }),
    );
    expect(screen.getByText("data-lake / reports/")).toBeInTheDocument();
    expect(verbText()).toBe("list + read");
  });

  it("shows an invalid bucket's message once, on the field, not again in the row", async () => {
    const cat = await readyCatalog("s3");
    store().addGrant(grantFor(cat, "s3"));
    render(withCatalog(cat, <SentenceEditor />));
    type("Bucket", "Bad_Bucket");
    fireEvent.blur(screen.getByLabelText("Bucket"));
    expect(screen.getAllByText(/not a valid S3 bucket name/)).toHaveLength(1);
    type("Bucket", "data-lake");
    expect(screen.queryByText(/not a valid S3 bucket name/)).toBeNull();
  });

  it("lists a path-less error in the row, since no field shows it", async () => {
    const cat = await readyCatalog("textract");
    const foreign = "arn:aws:ec2:us-east-1:123456789012:instance/i-1";
    store().addGrant({ ...grantFor(cat, "textract"), scope: { type: "arns", arns: [foreign] } });
    render(withCatalog(cat, <SentenceEditor />));
    expect(screen.getAllByText(/is not a recognized textract resource ARN/)).toHaveLength(1);
  });

  it("removes the optional KMS key instead of storing an empty string", async () => {
    const cat = await readyCatalog("s3");
    store().addGrant(grantFor(cat, "s3"));
    render(withCatalog(cat, <SentenceEditor />));
    type("Bucket", "data-lake");
    type(/KMS key ARN/, "arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab");
    expect(JSON.stringify(grants()[0]!.scope)).toContain("kmsKeyArn");
    type(/KMS key ARN/, "");
    const scope = grants()[0]!.scope as { data: object };
    expect("kmsKeyArn" in scope.data).toBe(false);
  });

  it("the remove button removes the grant", async () => {
    const cat = await readyCatalog("s3");
    store().addGrant(grantFor(cat, "s3"));
    render(withCatalog(cat, <SentenceEditor />));
    fireEvent.click(screen.getByRole("button", { name: "Remove Amazon S3 permission" }));
    expect(grants()).toEqual([]);
  });

  it("builds a textract ARN that passes generic classification", async () => {
    const cat = await readyCatalog("textract");
    store().addGrant(grantFor(cat, "textract"));
    render(withCatalog(cat, <SentenceEditor />));
    const resourceSelect = createWrapper(document.body)
      .findAllSelects()
      .find((s) => s.findTrigger().getElement().textContent === "Choose a resource type")!;
    act(() => resourceSelect.openDropdown());
    act(() => resourceSelect.selectOptionByValue("adapter:0"));
    type("AdapterId", "abc123");
    expect(screen.getByText("arn:aws:textract:*:*:/adapters/abc123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add this ARN" }));
    expect(grants()[0]!.scope).toEqual({ type: "arns", arns: ["arn:aws:textract:*:*:/adapters/abc123"] });
    expect(screen.queryByText(/not a recognized/)).toBeNull();
    expect(screen.getByText("1 resource")).toBeInTheDocument();
  });

  it("shows the current level combination of a multi-level grant", async () => {
    const cat = await readyCatalog("textract");
    const g: Grant = { ...grantFor(cat, "textract"), access: { type: "levels", levels: ["List", "Read"] } };
    store().addGrant(g);
    render(withCatalog(cat, <SentenceEditor />));
    expect(verbText()).toBe("List + Read");
    chooseVerb("Write");
    expect(grants()[0]!.access).toEqual({ type: "levels", levels: ["Write"] });
  });

  it("shows a disabled count option for an individual-actions grant", async () => {
    const cat = await readyCatalog("textract");
    const access: Grant["access"] = { type: "actions", actions: ["AnalyzeID", "AnalyzeExpense"] };
    store().addGrant({ ...grantFor(cat, "textract"), access });
    render(withCatalog(cat, <SentenceEditor />));
    expect(verbText()).toBe("2 individual actions");
  });

  it("module verbs are the presets", async () => {
    const cat = await readyCatalog("s3");
    store().addGrant(grantFor(cat, "s3"));
    render(withCatalog(cat, <SentenceEditor />));
    const select = createWrapper(document.body).findAllSelects()[0]!;
    act(() => select.openDropdown());
    expect(select.findDropdown().findOptions().map((o) => o.getElement().textContent)).toEqual([
      "list",
      "read",
      "list + read",
      "upload",
      "read + write",
      "delete",
      "upload only",
    ]);
  });

  it("summarises the scope on the row", async () => {
    const cat = await readyCatalog("textract", "s3");
    store().addGrant({ ...grantFor(cat, "textract", "a"), scope: { type: "all" } });
    store().addGrant({ ...grantFor(cat, "textract", "b"), scope: { type: "arns", arns: ["x", "y"] } });
    store().addGrant(grantFor(cat, "textract", "c"));
    store().addGrant(grantFor(cat, "s3", "d"));
    render(withCatalog(cat, <SentenceEditor />));
    expect(screen.getByText("All resources")).toBeInTheDocument();
    expect(screen.getByText("2 resources")).toBeInTheDocument();
    expect(screen.getAllByText("Not set")).toHaveLength(2);
  });

  it("shows a spinner while the service loads", () => {
    const cat = never();
    cat.setState({
      index: { generatedAt: "", services: [{ key: "s3", name: "Amazon S3", category: "Storage", actionCount: 1 }] },
      status: { s3: "loading" },
    });
    store().addGrant({ id: "g1", service: "s3", scope: { type: "all" }, access: { type: "levels", levels: ["Read"] } });
    render(withCatalog(cat, <SentenceEditor />));
    expect(screen.getByText("Loading Amazon S3…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Amazon S3 permission" })).toBeEnabled();
  });

  it("offers Retry when the service failed to load", () => {
    const cat = never();
    const retry = vi.fn(() => Promise.resolve());
    cat.setState({ status: { s3: "error" }, retry });
    store().addGrant({ id: "g1", service: "s3", scope: { type: "all" }, access: { type: "levels", levels: ["Read"] } });
    render(withCatalog(cat, <SentenceEditor />));
    expect(screen.getByText("Couldn't load this service.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledWith("s3");
  });

  it("explains a service that is no longer in the AWS data and keeps remove active", () => {
    const cat = never();
    cat.setState({ status: { gone: "missing" } });
    store().addGrant({ id: "g1", service: "gone", scope: { type: "all" }, access: { type: "levels", levels: ["Read"] } });
    render(withCatalog(cat, <SentenceEditor />));
    expect(screen.getByText("Service no longer in AWS data. It is left out of the policy.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove gone permission" }));
    expect(grants()).toEqual([]);
  });

  it("Add permission focuses the service search", async () => {
    const cat = await readyCatalog("s3");
    render(
      withCatalog(
        cat,
        <>
          <input id={SERVICE_SEARCH_ID} aria-label="search" />
          <SentenceEditor />
        </>,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add permission" }));
    expect(screen.getByLabelText("search")).toHaveFocus();
  });

  it("focuses the row of a grant targeted by the store", async () => {
    const cat = await readyCatalog("s3");
    store().addGrant(grantFor(cat, "s3"));
    render(withCatalog(cat, <SentenceEditor />));
    act(() => store().focus("grant:g1"));
    const row = screen.getByRole("group", { name: "Amazon S3 permission" });
    expect(row.contains(document.activeElement)).toBe(true);
    expect(within(row).getByLabelText("Bucket")).toBeInTheDocument();
  });

  it("a Jump to on a grant with an invalid field focuses that field, not the remove button", async () => {
    const cat = await readyCatalog("s3");
    store().addGrant(grantFor(cat, "s3", "g1"));
    render(withCatalog(cat, <SentenceEditor />));
    type("Bucket", "Bad_Bucket");
    act(() => {
      store().revealAllErrors();
      store().focus("grant:g1");
    });
    expect(screen.getByLabelText("Bucket")).toHaveFocus();
  });
});
