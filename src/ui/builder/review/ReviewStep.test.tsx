import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useBuilderStore } from "../../../state/builder";
import { grantFor, readyCatalog, withCatalog } from "../permissions/test-catalog";
import { ReviewStep } from "./ReviewStep";

const store = () => useBuilderStore.getState();
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => store().reset());
afterEach(cleanup);

async function setup() {
  const cat = await readyCatalog("s3");
  render(withCatalog(cat, <ReviewStep />));
  return cat;
}

describe("ReviewStep", () => {
  it("describes the role name, or the policy name for a principal trust", async () => {
    await setup();
    expect(screen.getByText("Role name")).toBeInTheDocument();
    act(() => store().setTrust({ kind: "principal", target: "user", name: "ann" }));
    act(() => store().setFields({ name: "ops" }));
    expect(screen.getByText("Used to name the policy: ops-policy")).toBeInTheDocument();
  });

  it("offers managed and inline policy modes", async () => {
    await setup();
    const group = createWrapper(document.body).findRadioGroup()!;
    expect(group.findButtons().map((b) => b.findLabel().getElement().textContent)).toEqual([
      "Managed policy (reusable, up to 6,144 characters)",
      "Inline policy (up to 10,240 for a role, 5,120 for a group, 2,048 for a user)",
    ]);
    act(() => group.findButtons()[1]!.findNativeInput().click());
    expect(store().model.policyMode).toBe("inline");
  });

  it("typing an account ID of 123 shows the 12-digit error", async () => {
    await setup();
    type("AWS account ID", "123");
    expect(store().model.accountId).toBe("123");
    // Once under the field and once in the issues list.
    expect(screen.getAllByText("Account ID must be exactly 12 digits.")).toHaveLength(2);
  });

  it("writes the region and validates free text", async () => {
    await setup();
    type("Region", "us-gov-west-1");
    expect(store().model.region).toBe("us-gov-west-1");
    expect(screen.getAllByText(/Only regions in the standard AWS partition/)).toHaveLength(2);
    type("Region", "");
    expect(store().model.region).toBeUndefined();
  });

  it("edits managed policy ARNs at managedPolicyArns[i]", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Add managed policy ARN" }));
    type("Managed policy ARN 1", "nope");
    expect(store().model.managedPolicyArns).toEqual(["nope"]);
    expect(screen.getAllByText(/Managed policy ARN must look like/)).toHaveLength(1);
    fireEvent.blur(screen.getByLabelText("Managed policy ARN 1"));
    expect(screen.getAllByText(/Managed policy ARN must look like/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove managed policy ARN 1" }));
    expect(store().model.managedPolicyArns).toEqual([]);
  });

  it("a Jump to focus lands on the field and shows its error", async () => {
    await setup();
    act(() => store().setFields({ accountId: "12" }));
    expect(screen.getAllByText("Account ID must be exactly 12 digits.")).toHaveLength(1);
    act(() => store().focus("field:accountId"));
    expect(screen.getByLabelText("AWS account ID")).toHaveFocus();
    expect(screen.getAllByText("Account ID must be exactly 12 digits.")).toHaveLength(2);
  });

  it("lists every issue and the summary of what the role can do", async () => {
    const cat = await setup();
    const g = grantFor(cat, "s3", "g1");
    act(() => store().addGrant(g));
    expect(screen.getByRole("heading", { name: "Issues" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Jump to/ }).length).toBeGreaterThan(0);
    act(() =>
      store().updateGrant("g1", (x) => ({
        ...x,
        scope: { type: "module", data: { bucket: "my-bucket", prefixes: [""], allowNavigation: false } },
      })),
    );
    expect(screen.getByRole("heading", { name: "What this role can do" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Can" })).toBeInTheDocument();
  });
});

describe("ReviewStep touched fields", () => {
  it("records touched fields under their focus ids, list rows included", async () => {
    await setup();
    type("Name", "x");
    fireEvent.click(screen.getByRole("button", { name: "Add managed policy ARN" }));
    fireEvent.blur(screen.getByLabelText("Managed policy ARN 1"));
    expect(store().touched["field:name"]).toBe(true);
    expect(store().touched["field:managedPolicyArns[0]"]).toBe(true);
  });

  it("lists an untouched empty row as a to-do", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Add managed policy ARN" }));
    expect(screen.getByText("To do")).toBeInTheDocument();
    expect(screen.getByText("Enter the managed policy ARN")).toBeInTheDocument();
  });
});
