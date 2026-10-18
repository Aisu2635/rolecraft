import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Grant } from "../../../core/model/model";
import { ACCESS_LEVELS } from "../../../core/types";
import { ActionPicker } from "./ActionPicker";
import { grantFor, readyCatalog } from "./test-catalog";

afterEach(cleanup);

async function setup(access: Grant["access"], key = "cloudfront") {
  const cat = await readyCatalog(key);
  const svc = cat.getState().services[key]!;
  const onChange = vi.fn();
  render(<ActionPicker grant={{ ...grantFor(cat, key), access }} svc={svc} onChange={onChange} />);
  const select = createWrapper(document.body).findMultiselect()!;
  return { select, onChange, svc };
}

describe("ActionPicker", () => {
  it("groups actions by level in access-level order, with the label and the action name", async () => {
    const { select, svc } = await setup({ type: "levels", levels: [] });
    act(() => select.openDropdown());
    const groups = [...select.findDropdown().getElement().querySelectorAll('[role="group"]')];
    const heads = groups.map((g) => g.querySelector('[role="option"]')?.textContent);
    expect(heads).toEqual(ACCESS_LEVELS.filter((l) => svc.actions.some((a) => a.level === l)));
    const option = select.findDropdown().findOptionByValue("CreateInvalidation")!.getElement();
    expect(option).toHaveTextContent("Create invalidation");
    expect(option).toHaveTextContent("CreateInvalidation");
  });

  it("picking an action emits an actions selection", async () => {
    const { select, onChange } = await setup({ type: "levels", levels: ["Read"] });
    act(() => select.openDropdown());
    act(() => select.selectOptionByValue("CreateInvalidation"));
    expect(onChange).toHaveBeenCalledWith({ type: "actions", actions: ["CreateInvalidation"] });
  });

  it("adds to the current actions in the order picked", async () => {
    const { select, onChange } = await setup({ type: "actions", actions: ["GetInvalidation"] });
    act(() => select.openDropdown());
    act(() => select.selectOptionByValue("CreateInvalidation"));
    expect(onChange).toHaveBeenCalledWith({ type: "actions", actions: ["GetInvalidation", "CreateInvalidation"] });
  });

  it("clearing the last action goes back to an empty levels selection", async () => {
    const { select, onChange } = await setup({ type: "actions", actions: ["CreateInvalidation"] });
    act(() => select.findToken(1)!.findDismiss().click());
    expect(onChange).toHaveBeenCalledWith({ type: "levels", levels: [] });
  });

  it("keeps an action the service no longer has so it can be removed", async () => {
    const { select, onChange } = await setup({ type: "actions", actions: ["Gone", "CreateInvalidation"] });
    expect(select.findTokens().map((t) => t.getElement().textContent)).toEqual([
      expect.stringContaining("Gone"),
      expect.stringContaining("Create invalidation"),
    ]);
    act(() => select.findToken(1)!.findDismiss().click());
    expect(onChange).toHaveBeenCalledWith({ type: "actions", actions: ["CreateInvalidation"] });
  });
});
