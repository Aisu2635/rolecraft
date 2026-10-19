import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Scope } from "../../../core/model/model";
import type { Issue } from "../../../core/types";
import { FieldsScopeEditor } from "./FieldsScopeEditor";
import { ScopeHarness } from "./harness";
import { MODULE_FIELDS } from "./module-fields";

afterEach(cleanup);
const data = (s: Scope | undefined) => (s as { data: Record<string, unknown> }).data;

function setup(moduleId: keyof typeof MODULE_FIELDS, initial: unknown, issues: Issue[] = []) {
  const seen: Scope[] = [];
  render(
    <ScopeHarness
      initial={{ type: "module", data: initial }}
      seen={seen}
      issues={issues}
      render={(scope, onChange, i) => (
        <FieldsScopeEditor moduleId={moduleId} data={(scope as { data: unknown }).data} issues={i} onChange={onChange} />
      )}
    />,
  );
  return seen;
}

const KEY = "arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";

describe("MODULE_FIELDS", () => {
  it("covers every simple module with a first required text field", () => {
    expect(Object.keys(MODULE_FIELDS).sort()).toEqual([
      "dynamodb",
      "ecr",
      "eks",
      "kms",
      "lambda",
      "logs",
      "secretsmanager",
      "sqs",
    ]);
    for (const specs of Object.values(MODULE_FIELDS)) {
      expect(specs[0]).toMatchObject({ kind: "text" });
      expect(specs[0]?.optional).toBeUndefined();
    }
  });
});

describe("FieldsScopeEditor", () => {
  it("writes the required text field", () => {
    const seen = setup("lambda", { functionName: "" });
    fireEvent.change(screen.getByLabelText("Function name"), { target: { value: "my-fn" } });
    expect(data(seen.at(-1))).toEqual({ functionName: "my-fn" });
  });

  it("dynamodb includeIndexes defaults on and is written as a boolean", () => {
    const seen = setup("dynamodb", { table: "orders" });
    const box = screen.getByLabelText("Include the table indexes");
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(data(seen.at(-1))).toEqual({ table: "orders", includeIndexes: false });
  });

  it("logs createGroup defaults on", () => {
    setup("logs", { logGroup: "/aws/x" });
    expect(screen.getByLabelText("Allow creating the log group")).toBeChecked();
  });

  it("removes an optional blank text field instead of storing an empty string", () => {
    const seen = setup("secretsmanager", { secretName: "db/pass" });
    fireEvent.change(screen.getByLabelText(/KMS key ARN/), { target: { value: KEY } });
    expect(data(seen.at(-1))).toEqual({ secretName: "db/pass", kmsKeyArn: KEY });
    fireEvent.change(screen.getByLabelText(/KMS key ARN/), { target: { value: "" } });
    expect(data(seen.at(-1))).toEqual({ secretName: "db/pass" });
    expect("kmsKeyArn" in data(seen.at(-1))!).toBe(false);
  });

  it("shows field errors from issues at data.<key> after blur", () => {
    setup("ecr", { repository: "" }, [
      { id: "E_MODULE_DATA", severity: "error", message: "bad repo", path: "data.repository" },
    ]);
    expect(screen.queryByText("bad repo")).toBeNull();
    fireEvent.blur(screen.getByLabelText("Repository name"));
    expect(screen.getByText("bad repo")).toBeInTheDocument();
  });
});
