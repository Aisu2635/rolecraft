import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BuildContext } from "../../../core/arn";
import type { Scope } from "../../../core/model/model";
import type { SlimService } from "../../../core/types";
import { ArnScopeEditor } from "./ArnScopeEditor";
import { ScopeHarness, fakeService } from "./harness";

afterEach(cleanup);

const svc: SlimService = fakeService({
  key: "thing",
  resources: [
    { name: "widget", arnFormats: ["arn:${Partition}:thing:${Region}:${Account}:widget/${WidgetId}"], conditionKeys: [] },
    {
      name: "pair",
      arnFormats: ["arn:${Partition}:thing:${Region}:${Account}:pair/${Left}/${Right}", "arn:${Partition}:thing:::pair2"],
      conditionKeys: [],
    },
  ],
});

type Arns = { type: "all" } | { type: "arns"; arns: string[] };

function setup(initial: Arns, ctx: BuildContext = { partition: "aws" }, service: SlimService = svc) {
  const seen: Scope[] = [];
  render(
    <ScopeHarness
      initial={initial}
      seen={seen}
      render={(scope, onChange) => <ArnScopeEditor scope={scope as Arns} svc={service} ctx={ctx} onChange={onChange} />}
    />,
  );
  return seen;
}
function chooseType(value: string): void {
  const select = createWrapper(document.body).findAllSelects()[0]!;
  act(() => select.openDropdown());
  act(() => select.selectOptionByValue(value));
}

describe("ArnScopeEditor", () => {
  it("switches between specific and all resources", () => {
    const seen = setup({ type: "arns", arns: ["a"] });
    fireEvent.click(screen.getByLabelText("All resources (*)"));
    expect(seen.at(-1)).toEqual({ type: "all" });
    expect(screen.queryByLabelText("ARN 1")).toBeNull();
    fireEvent.click(screen.getByLabelText("Specific resources"));
    expect(seen.at(-1)).toEqual({ type: "arns", arns: [] });
  });

  it("adds, edits and removes ARN inputs", () => {
    const seen = setup({ type: "arns", arns: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add ARN" }));
    fireEvent.change(screen.getByLabelText("ARN 1"), { target: { value: "arn:aws:thing:::x" } });
    expect(seen.at(-1)).toEqual({ type: "arns", arns: ["arn:aws:thing:::x"] });
    fireEvent.click(screen.getByRole("button", { name: "Remove ARN 1" }));
    expect(seen.at(-1)).toEqual({ type: "arns", arns: [] });
  });

  it("builds an ARN with region and account from the model, one input per other placeholder", () => {
    const seen = setup({ type: "arns", arns: [] }, { partition: "aws", region: "eu-west-1", accountId: "123456789012" });
    chooseType("widget:0");
    expect(screen.queryByLabelText("Region")).toBeNull();
    expect(screen.queryByLabelText("Account")).toBeNull();
    expect(screen.getByText("arn:aws:thing:eu-west-1:123456789012:widget/*")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("WidgetId"), { target: { value: "w1" } });
    expect(screen.getByText("arn:aws:thing:eu-west-1:123456789012:widget/w1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add this ARN" }));
    expect(seen.at(-1)).toEqual({ type: "arns", arns: ["arn:aws:thing:eu-west-1:123456789012:widget/w1"] });
  });

  it("without an account ID, an Account field explains the * and where to add the ID", () => {
    setup({ type: "arns", arns: [] });
    chooseType("widget:0");
    expect(screen.getByLabelText("Account")).toHaveValue("*");
    expect(screen.getByLabelText("Account")).toHaveAttribute("readonly");
    // The hint sits under the field and is read with it.
    expect(screen.getByLabelText("Account")).toHaveAccessibleDescription(
      "No account ID yet, so the account is *. Add it on the Review step, then rebuild the ARN.",
    );
  });

  it("a format without an account has no Account field", () => {
    setup({ type: "arns", arns: [] });
    chooseType("pair:1");
    expect(screen.queryByLabelText("Account")).toBeNull();
    expect(screen.queryByText(/No account ID yet/)).toBeNull();
  });

  it("does not add the same ARN twice", () => {
    const seen = setup({ type: "arns", arns: ["arn:aws:thing:*:*:widget/w1"] });
    chooseType("widget:0");
    fireEvent.change(screen.getByLabelText("WidgetId"), { target: { value: "w1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add this ARN" }));
    expect(seen).toEqual([]);
  });

  it("offers every format of a resource type and clears values when the type changes", () => {
    setup({ type: "arns", arns: [] });
    chooseType("pair:0");
    fireEvent.change(screen.getByLabelText("Left"), { target: { value: "l" } });
    expect(screen.getByText("arn:aws:thing:*:*:pair/l/*")).toBeInTheDocument();
    chooseType("pair:1");
    expect(screen.getByText("arn:aws:thing:::pair2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Left")).toBeNull();
  });

  it("hides the builder when the service has no resource types", () => {
    setup({ type: "arns", arns: [] }, { partition: "aws" }, fakeService());
    expect(screen.queryByText("Build an ARN")).toBeNull();
  });
});
