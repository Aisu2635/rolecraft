import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoader } from "../../../core/catalog/loader";
import { moduleGrant } from "../../../core/export/__fixtures__/cases";
import type { Grant } from "../../../core/model/model";
import { useBuilderStore } from "../../../state/builder";
import { createCatalogStore } from "../../../state/catalog";
import { GridEditor } from "./GridEditor";
import { PermissionsStep } from "./PermissionsStep";
import { readyCatalog, withCatalog } from "./test-catalog";

const store = () => useBuilderStore.getState();
const grants = () => store().model.grants;
const never = () => createCatalogStore(createLoader(() => new Promise(() => undefined)));
const region = (name: string) => screen.getByRole("region", { name });
const bodyRows = (name: string) => [...region(name).querySelectorAll<HTMLElement>("tbody tr")];

const S3: Grant = moduleGrant("s3a", "s3", "list-read", { bucket: "data-lake", prefixes: ["reports/"] });
const EC2: Grant = moduleGrant("ec2a", "ec2", "tags", { selector: { type: "tag", key: "Env", value: "dev" } });
const TEXTRACT_ALL: Grant = {
  id: "tx1",
  service: "textract",
  scope: { type: "all" },
  access: { type: "levels", levels: ["Write"] },
};
const TEXTRACT_B: Grant = {
  id: "tx2",
  service: "textract",
  scope: { type: "arns", arns: ["arn:aws:textract:*:*:/adapters/abc123"] },
  access: { type: "levels", levels: ["Read"] },
};
const CLOUDFRONT: Grant = {
  id: "cf1",
  service: "cloudfront",
  scope: { type: "arns", arns: ["arn:aws:cloudfront::123456789012:distribution/E2EXAMPLE"] },
  access: { type: "actions", actions: ["CreateInvalidation"] },
};

beforeEach(() => store().reset());
afterEach(cleanup);

async function setup(...list: Grant[]) {
  const cat = await readyCatalog("s3", "ec2", "textract", "cloudfront");
  for (const g of list) store().addGrant(g);
  render(withCatalog(cat, <GridEditor />));
  return cat;
}

describe("GridEditor", () => {
  it("shows one container per service in order of first grant, one row per grant", async () => {
    await setup(S3, TEXTRACT_ALL, EC2, TEXTRACT_B, { ...S3, id: "s3b" });
    const names = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(names).toEqual(["Amazon S3", "Amazon Textract", "Amazon EC2"]);
    expect(bodyRows("Amazon S3")).toHaveLength(2);
    expect(bodyRows("Amazon Textract")).toHaveLength(2);
    expect(bodyRows("Amazon EC2")).toHaveLength(1);
  });

  it("writes checked levels in access-level order and shows a dash for levels the service lacks", async () => {
    await setup(TEXTRACT_ALL);
    const [row] = bodyRows("Amazon Textract");
    expect(within(row!).getAllByText("—")).toHaveLength(2);
    expect(within(row!).queryByRole("checkbox", { name: "List, All resources" })).toBeNull();
    expect(within(row!).getByRole("checkbox", { name: "Write, All resources" })).toBeChecked();
    fireEvent.click(within(row!).getByRole("checkbox", { name: "Read, All resources" }));
    expect(grants()[0]!.access).toEqual({ type: "levels", levels: ["Read", "Write"] });
    fireEvent.click(within(bodyRows("Amazon Textract")[0]!).getByRole("checkbox", { name: "Write, All resources" }));
    expect(grants()[0]!.access).toEqual({ type: "levels", levels: ["Read"] });
  });

  it("adds a level to a combination without losing the others", async () => {
    await setup({ ...TEXTRACT_ALL, access: { type: "levels", levels: ["Write", "Tagging"] } });
    fireEvent.click(within(bodyRows("Amazon Textract")[0]!).getByRole("checkbox", { name: "Read, All resources" }));
    expect(grants()[0]!.access).toEqual({ type: "levels", levels: ["Read", "Write", "Tagging"] });
  });

  it("an actions grant shows its count, with disabled level checkboxes and a hint", async () => {
    await setup(CLOUDFRONT);
    const [row] = bodyRows("Amazon CloudFront");
    expect(within(row!).getByText("1 individual action")).toBeInTheDocument();
    const boxes = within(row!).getAllByRole("checkbox");
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) expect(b).toBeDisabled();
    expect(within(row!).getByText("Clear the individual actions to use access levels.")).toBeInTheDocument();
  });

  it("the picker sets individual actions, and clearing it goes back to empty levels", async () => {
    await setup({ ...CLOUDFRONT, access: { type: "levels", levels: ["Read"] } });
    const [row] = bodyRows("Amazon CloudFront");
    fireEvent.click(within(row!).getByText("Pick individual actions"));
    const select = createWrapper(document.body).findMultiselect()!;
    act(() => select.openDropdown());
    act(() => select.selectOptionByValue("CreateInvalidation"));
    expect(grants()[0]!.access).toEqual({ type: "actions", actions: ["CreateInvalidation"] });
    act(() => createWrapper(document.body).findMultiselect()!.findToken(1)!.findDismiss().click());
    expect(grants()[0]!.access).toEqual({ type: "levels", levels: [] });
  });

  it("does not mount the action picker until its section is expanded", async () => {
    await setup(TEXTRACT_ALL);
    expect(createWrapper(document.body).findMultiselect()).toBeNull();
  });

  it("a module row has one radio per preset and switches the preset", async () => {
    await setup(S3);
    const [row] = bodyRows("Amazon S3");
    const radios = within(row!).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual([
      "list",
      "read",
      "list + read",
      "upload",
      "read + write",
      "delete",
      "upload only",
    ].map((p) => p + ", data-lake / reports/"));
    expect(within(row!).getByRole("radio", { name: "list + read, data-lake / reports/" })).toBeChecked();
    fireEvent.click(within(row!).getByRole("radio", { name: "read + write, data-lake / reports/" }));
    expect(grants()[0]!.access).toEqual({ type: "preset", preset: "read-write" });
    expect(grants()[0]!.scope).toEqual(S3.scope);
  });

  it("edits the scope in a modal with the same scope editor", async () => {
    await setup(S3);
    const [row] = bodyRows("Amazon S3");
    expect(within(row!).getByText("data-lake / reports/")).toBeInTheDocument();
    fireEvent.click(within(row!).getByRole("button", { name: "Edit scope of Amazon S3" }));
    const modal = within(screen.getByRole("dialog"));
    fireEvent.change(modal.getByLabelText("Bucket"), { target: { value: "other-bucket" } });
    expect(grants()[0]!.scope).toEqual({
      type: "module",
      data: { bucket: "other-bucket", prefixes: ["reports/"], allowNavigation: false },
    });
    fireEvent.click(modal.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("other-bucket / reports/")).toBeInTheDocument();
  });

  it("Add scope adds another grant for that service", async () => {
    await setup(S3, TEXTRACT_ALL);
    fireEvent.click(within(region("Amazon Textract")).getByRole("button", { name: "Add scope" }));
    expect(grants()).toHaveLength(3);
    expect(grants()[2]!.service).toBe("textract");
    expect(grants()[2]!.access).toEqual({ type: "levels", levels: ["Read"] });
    expect(bodyRows("Amazon Textract")).toHaveLength(2);
  });

  it("the remove button removes the grant", async () => {
    await setup(S3, TEXTRACT_ALL);
    fireEvent.click(screen.getByRole("button", { name: "Remove Amazon S3 permission" }));
    expect(grants().map((g) => g.id)).toEqual(["tx1"]);
  });

  it("lists a grant's problems under its service", async () => {
    await setup({ ...S3, scope: { type: "module", data: { bucket: "Bad_Bucket", prefixes: [""] } } });
    expect(within(region("Amazon S3")).getByText(/not a valid S3 bucket name/)).toBeInTheDocument();
  });

  it("says when there are no permissions", async () => {
    await setup();
    expect(screen.getByText("No permissions yet. Pick a service on the left to add one.")).toBeInTheDocument();
  });

  it("shows loading, error with Retry, and missing like the sentence rows", () => {
    const cat = never();
    const retry = vi.fn(() => Promise.resolve());
    cat.setState({
      index: { generatedAt: "", services: [{ key: "s3", name: "Amazon S3", category: "Storage", actionCount: 1 }] },
      status: { s3: "loading", ec2: "error", gone: "missing" },
      retry,
    });
    for (const service of ["s3", "ec2", "gone"]) {
      store().addGrant({ id: service, service, scope: { type: "all" }, access: { type: "levels", levels: ["Read"] } });
    }
    render(withCatalog(cat, <GridEditor />));
    expect(screen.getByText("Loading Amazon S3…")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load this service.")).toBeInTheDocument();
    expect(screen.getByText("Service no longer in AWS data. It is left out of the policy.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledWith("ec2");
    fireEvent.click(screen.getByRole("button", { name: "Remove gone permission" }));
    expect(grants().map((g) => g.id)).toEqual(["s3", "ec2"]);
  });

  it("notes, as info, actions no ARN matches, and warns on an S3 folder that is the whole bucket", async () => {
    await setup(
      { id: "tx0", service: "textract", scope: { type: "arns", arns: [] }, access: { type: "levels", levels: ["Read"] } },
      moduleGrant("s3b", "s3", "list-read", { bucket: "data-lake", prefixes: ["reports/", "/"] }),
    );
    const notes = within(region("Amazon Textract")).getAllByText(/was left out because none of the ARNs match/);
    expect(notes[0]!.closest('[class*="status-info"]')).not.toBeNull();
    const s3 = within(region("Amazon S3")).getByText(/Folder 2 is the whole bucket, so the other folders add nothing/);
    expect(s3.closest('[class*="status-warning"]')).not.toBeNull();
  });
});

describe("Sentences and Grid", () => {
  it("switching editors never touches the model", async () => {
    const cat = await readyCatalog("s3", "ec2", "textract", "cloudfront");
    for (const g of [S3, EC2, TEXTRACT_ALL, CLOUDFRONT, TEXTRACT_B]) store().addGrant(g);
    const original = store().model;
    render(withCatalog(cat, <PermissionsStep />));
    const segments = () => createWrapper(document.body).findSegmentedControl()!.findSegments();
    act(() => segments()[1]!.click());
    expect(store().editor).toBe("grid");
    expect(screen.getAllByRole("region")).toHaveLength(4);
    expect(store().model).toBe(original);
    act(() => segments()[0]!.click());
    expect(store().editor).toBe("sentences");
    expect(screen.queryByRole("region")).toBeNull();
    expect(store().model).toBe(original);
    act(() => segments()[1]!.click());
    expect(store().model).toBe(original);
  });
});

describe("GridEditor to-dos", () => {
  it("lists a new grant's empty field as a to-do, not an error, until the grant is touched", async () => {
    await setup({ ...S3, scope: { type: "module", data: { bucket: "", prefixes: [""] } } });
    const s3 = region("Amazon S3");
    expect(s3.querySelector("[class*=awsui_status-error]")).toBeNull();
    expect(s3.querySelector("[class*=awsui_status-pending]")).toHaveTextContent("Enter the bucket name");
    act(() => store().touch("grant:s3a"));
    expect(s3.querySelector("[class*=awsui_status-pending]")).toBeNull();
    expect(s3.querySelector("[class*=awsui_status-error]")).toHaveTextContent(/not a valid S3 bucket name/);
  });
});
