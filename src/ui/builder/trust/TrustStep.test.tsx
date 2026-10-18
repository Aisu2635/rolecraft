import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useBuilderStore } from "../../../state/builder";
import { TrustStep } from "./TrustStep";

const store = () => useBuilderStore.getState();
const trust = () => store().model.trust;

function pick(label: string): void {
  const tiles = createWrapper(document.body).findTiles()!;
  const item = tiles.findItems().find((t) => t.findLabel().getElement().textContent === label)!;
  act(() => item.findNativeInput().click());
}
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
function chooseRef(value: string): void {
  const select = createWrapper(document.body).findSelect()!;
  act(() => select.openDropdown());
  act(() => select.selectOptionByValue(value));
}

beforeEach(() => store().reset());
afterEach(cleanup);

describe("TrustStep", () => {
  it("offers the six trusted entities, EC2 selected by default", () => {
    render(<TrustStep />);
    const tiles = createWrapper(document.body).findTiles()!;
    expect(tiles.findItems().map((t) => t.findLabel().getElement().textContent)).toEqual([
      "EC2 instance",
      "Lambda function",
      "ECS task",
      "GitHub Actions",
      "Another AWS account",
      "IAM group or user",
    ]);
    expect(tiles.findItems()[0]!.findNativeInput().getElement()).toBeChecked();
  });

  it("maps the service tiles to service trust", () => {
    render(<TrustStep />);
    pick("Lambda function");
    expect(trust()).toEqual({ kind: "service", service: "lambda" });
    pick("ECS task");
    expect(trust()).toEqual({ kind: "service", service: "ecs-tasks" });
  });

  it("picking GitHub Actions sets the github default", () => {
    render(<TrustStep />);
    pick("GitHub Actions");
    expect(trust()).toEqual({ kind: "github", owner: "", repo: "", ref: { type: "branch", value: "main" } });
    expect(screen.getByLabelText("GitHub owner")).toBeInTheDocument();
  });

  it("does not show an error for a field the user has not left yet", () => {
    render(<TrustStep />);
    pick("GitHub Actions");
    type("GitHub owner", "-bad");
    expect(screen.queryByText(/GitHub owner must be/)).toBeNull();
  });

  it("typing owner -bad then blurring shows the owner error", () => {
    render(<TrustStep />);
    pick("GitHub Actions");
    type("GitHub owner", "-bad");
    fireEvent.blur(screen.getByLabelText("GitHub owner"));
    expect(screen.getByText(/^GitHub owner must be 1-39 letters/)).toBeInTheDocument();
    expect(screen.queryByText(/GitHub repository must be/)).toBeNull();
  });

  it("shows a pristine field's error after a jump-to focus, and only that field's", () => {
    render(<TrustStep />);
    pick("GitHub Actions");
    expect(screen.queryByText(/GitHub repository must be/)).toBeNull();
    act(() => store().focus("field:trust.repo"));
    expect(screen.getByLabelText("Repository")).toHaveFocus();
    expect(screen.getByText(/^GitHub repository must be/)).toBeInTheDocument();
    expect(screen.queryByText(/GitHub owner must be/)).toBeNull();
  });

  it("the GitHub AWS account ID writes the model and shows the needs-account error", () => {
    render(<TrustStep />);
    pick("GitHub Actions");
    expect(screen.getByText("Needed for the GitHub OIDC provider ARN.")).toBeInTheDocument();
    act(() => store().focus("field:accountId"));
    expect(screen.getByLabelText("AWS account ID")).toHaveFocus();
    expect(screen.getByText(/needs an AWS account ID/)).toBeInTheDocument();
    type("AWS account ID", "123456789012");
    expect(store().model.accountId).toBe("123456789012");
    expect(screen.queryByText(/needs an AWS account ID/)).toBeNull();
    type("AWS account ID", "");
    expect(store().model.accountId).toBeUndefined();
  });

  it("the pull request ref hides the value input; other refs relabel it", () => {
    render(<TrustStep />);
    pick("GitHub Actions");
    expect(screen.getByLabelText("Branch name")).toHaveValue("main");
    chooseRef("environment");
    expect(screen.getByLabelText("Environment name")).toBeInTheDocument();
    expect(trust()).toMatchObject({ ref: { type: "environment", value: "" } });
    chooseRef("tag");
    expect(screen.getByLabelText("Tag name")).toBeInTheDocument();
    chooseRef("pull_request");
    expect(screen.queryByLabelText(/ name$/)).toBeNull();
    expect(trust()).toEqual({ kind: "github", owner: "", repo: "", ref: { type: "pull_request" } });
    chooseRef("branch");
    expect(screen.getByLabelText("Branch name")).toHaveValue("main");
  });

  it("keeps owner and repo when the ref type changes", () => {
    render(<TrustStep />);
    pick("GitHub Actions");
    type("GitHub owner", "Aisu2635");
    type("Repository", "rolecraft");
    chooseRef("tag");
    expect(trust()).toMatchObject({ owner: "Aisu2635", repo: "rolecraft", ref: { type: "tag" } });
  });

  it("account trust writes id, optional external ID and MFA, omitting unset keys", () => {
    render(<TrustStep />);
    pick("Another AWS account");
    expect(trust()).toEqual({ kind: "account", accountId: "" });
    type("Trusted account ID", "210987654321");
    type(/External ID/, "rolecraft-ext-01");
    fireEvent.click(screen.getByLabelText("Require MFA"));
    expect(trust()).toEqual({
      kind: "account",
      accountId: "210987654321",
      externalId: "rolecraft-ext-01",
      requireMfa: true,
    });
    type(/External ID/, "");
    fireEvent.click(screen.getByLabelText("Require MFA"));
    expect(trust()).toEqual({ kind: "account", accountId: "210987654321" });
  });

  it("validates the trusted account ID after blur", () => {
    render(<TrustStep />);
    pick("Another AWS account");
    type("Trusted account ID", "12");
    expect(screen.queryByText(/Trusted account ID must be/)).toBeNull();
    fireEvent.blur(screen.getByLabelText("Trusted account ID"));
    expect(screen.getByText(/^Trusted account ID must be exactly 12 digits/)).toBeInTheDocument();
  });

  it("validates the external ID and group or user name", () => {
    render(<TrustStep />);
    pick("Another AWS account");
    type(/External ID/, "a b");
    fireEvent.blur(screen.getByLabelText(/External ID/));
    expect(screen.getByText(/^External ID must be/)).toBeInTheDocument();
    pick("IAM group or user");
    type("Name", "bad name");
    fireEvent.blur(screen.getByLabelText("Name"));
    expect(screen.getByText(/^Name must be 1-128/)).toBeInTheDocument();
  });

  it("IAM group or user then User sets target user, and explains itself", () => {
    render(<TrustStep />);
    pick("IAM group or user");
    expect(trust()).toEqual({ kind: "principal", target: "group", name: "" });
    expect(
      screen.getByText("The policy is attached to an existing IAM group or user. No role is created."),
    ).toBeInTheDocument();
    const seg = createWrapper(document.body).findSegmentedControl()!;
    act(() => seg.findSegments()[1]!.click());
    expect(trust()).toEqual({ kind: "principal", target: "user", name: "" });
    type("Name", "alice");
    expect(trust()).toEqual({ kind: "principal", target: "user", name: "alice" });
  });
});
