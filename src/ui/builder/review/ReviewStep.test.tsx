import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useBuilderStore } from "../../../state/builder";
import { grantFor, readyCatalog, withCatalog } from "../permissions/test-catalog";
import { OutputPanel } from "../output/OutputPanel";
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
    // Under the field only: the output panel lists it, so the Review list does not.
    expect(screen.getAllByText("Account ID must be exactly 12 digits.")).toHaveLength(1);
  });

  it("writes the region and validates free text", async () => {
    await setup();
    type("Region", "us-gov-west-1");
    expect(store().model.region).toBe("us-gov-west-1");
    expect(screen.getAllByText(/Only regions in the standard AWS partition/)).toHaveLength(1);
    type("Region", "");
    expect(store().model.region).toBeUndefined();
  });

  it("edits managed policy ARNs at managedPolicyArns[i]", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Add managed policy ARN" }));
    type("Managed policy ARN 1", "nope");
    expect(store().model.managedPolicyArns).toEqual(["nope"]);
    expect(screen.queryByText(/Managed policy ARN must look like/)).toBeNull();
    fireEvent.blur(screen.getByLabelText("Managed policy ARN 1"));
    expect(screen.getAllByText(/Managed policy ARN must look like/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove managed policy ARN 1" }));
    expect(store().model.managedPolicyArns).toEqual([]);
  });

  it("a Jump to focus lands on the field and shows its error", async () => {
    await setup();
    act(() => store().setFields({ accountId: "12" }));
    expect(screen.queryByText("Account ID must be exactly 12 digits.")).toBeNull();
    act(() => store().focus("field:accountId"));
    expect(screen.getByLabelText("AWS account ID")).toHaveFocus();
    expect(screen.getAllByText("Account ID must be exactly 12 digits.")).toHaveLength(1);
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

describe("ReviewStep beside the output panel", () => {
  const ACCOUNT_ERR = "Account ID must be exactly 12 digits.";
  async function both() {
    const cat = await readyCatalog("s3");
    render(
      withCatalog(
        cat,
        <>
          <section aria-label="Review">
            <ReviewStep />
          </section>
          <section aria-label="Output">
            <OutputPanel />
          </section>
        </>,
      ),
    );
  }

  it("a field's error shows on the field and in the output panel, not again in the Review list", async () => {
    await both();
    type("AWS account ID", "123");
    fireEvent.blur(screen.getByLabelText("AWS account ID"));
    expect(screen.getAllByText(ACCOUNT_ERR)).toHaveLength(2);
    expect(within(screen.getByRole("region", { name: "Output" })).getByText(ACCOUNT_ERR)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Review" })).getAllByText(ACCOUNT_ERR)).toHaveLength(1);
  });

  it("an untouched field's error is a to-do in the panel, not red, and not in the Review list", async () => {
    await both();
    act(() => store().setFields({ accountId: "12" }));
    // Not under the field yet; once, as a to-do, in the panel.
    expect(screen.getAllByText(ACCOUNT_ERR)).toHaveLength(1);
    expect(screen.getAllByText("To do")).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "Output" })).getByText("To do")).toBeInTheDocument();
  });

  it("issues without a path still list in the Review step", async () => {
    await both();
    act(() => store().setTrust({ kind: "principal", target: "user", name: "ann" }));
    const review = within(screen.getByRole("region", { name: "Review" }));
    expect(review.getByText(/Prefer granting permissions through an IAM group/)).toBeInTheDocument();
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

  it("an untouched empty row is not an error under the field or in the Review list", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Add managed policy ARN" }));
    expect(screen.queryByText("To do")).toBeNull();
    expect(screen.queryByText(/Managed policy ARN must look like/)).toBeNull();
  });

  it("says No other issues. when the only issues are on its own fields", async () => {
    const cat = await setup();
    const g = grantFor(cat, "s3", "g1");
    act(() => {
      store().setFields({ name: "ok-role", accountId: "12" });
      store().addGrant({ ...g, scope: { type: "module", data: { bucket: "my-bucket", prefixes: [""], allowNavigation: false } } });
    });
    expect(screen.queryByText(/No permissions yet/)).toBeNull();
    expect(screen.getByText("No other issues.")).toBeInTheDocument();
  });
});
