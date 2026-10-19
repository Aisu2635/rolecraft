import { describe, expect, it } from "vitest";
import { createEmptyModel, type RoleModel } from "../../core/model/model";
import type { Issue } from "../../core/types";
import { errorTextAt, focusIdFor, grantIssues, issuesAt, splitPending, todoText } from "./issues";

const i = (p: Partial<Issue> & { id: string }): Issue => ({ severity: "error", message: p.id, ...p });

describe("issuesAt", () => {
  it("matches the exact path and lists errors first", () => {
    const list = [
      i({ id: "w", severity: "warning", path: "name" }),
      i({ id: "e", path: "name" }),
      i({ id: "x", path: "name.sub" }),
      i({ id: "y", path: "region" }),
    ];
    expect(issuesAt(list, "name").map((x) => x.id)).toEqual(["e", "w"]);
    expect(issuesAt(list, "nope")).toEqual([]);
  });
});

describe("errorTextAt", () => {
  it("returns the first error message, ignoring warnings", () => {
    const list = [
      i({ id: "w", severity: "warning", path: "name", message: "warn" }),
      i({ id: "e", path: "name", message: "bad" }),
    ];
    expect(errorTextAt(list, "name")).toBe("bad");
    expect(errorTextAt([list[0]!], "name")).toBeUndefined();
    expect(errorTextAt(list, "region")).toBeUndefined();
  });
});

describe("grantIssues", () => {
  it("keeps issues of one grant", () => {
    const list = [i({ id: "a", grantId: "g1" }), i({ id: "b", grantId: "g2" }), i({ id: "c" })];
    expect(grantIssues(list, "g1").map((x) => x.id)).toEqual(["a"]);
  });
});

describe("focusIdFor", () => {
  it("maps grant issues to step 1", () => {
    expect(focusIdFor(i({ id: "a", grantId: "g1", path: "data.bucket" }))).toEqual({ step: 1, target: "grant:g1" });
  });
  it("maps trust paths to step 0", () => {
    expect(focusIdFor(i({ id: "a", path: "trust.owner" }))).toEqual({ step: 0, target: "field:trust.owner" });
  });
  it("maps details paths to step 2", () => {
    for (const path of ["name", "accountId", "region", "policyMode", "managedPolicyArns", "managedPolicyArns[3]"]) {
      expect(focusIdFor(i({ id: "a", path }))).toEqual({ step: 2, target: "field:" + path });
    }
  });
  it("maps path-less GitHub trust issues to their step 0 fields", () => {
    expect(focusIdFor(i({ id: "E_GITHUB_NEEDS_ACCOUNT" }))).toEqual({ step: 0, target: "field:accountId" });
    expect(focusIdFor(i({ id: "E_GITHUB_REF_VALUE" }))).toEqual({ step: 0, target: "field:trust.ref.value" });
    expect(focusIdFor(i({ id: "E_GITHUB_OWNER_REPO_MISSING" }))).toEqual({ step: 0, target: "field:trust.owner" });
  });
  it("returns null for anything else", () => {
    expect(focusIdFor(i({ id: "a" }))).toBeNull();
    expect(focusIdFor(i({ id: "a", path: "other" }))).toBeNull();
    expect(focusIdFor(i({ id: "a", path: "names" }))).toBeNull();
  });
});

describe("splitPending", () => {
  const list = [
    i({ id: "owner", path: "trust.owner" }),
    i({ id: "E_GITHUB_OWNER_REPO_MISSING" }),
    i({ id: "bucket", grantId: "g1", path: "data.bucket" }),
    i({ id: "size" }),
    i({ id: "warn", severity: "warning", path: "trust.repo" }),
    i({ id: "note", severity: "info", grantId: "g1" }),
  ];
  const ids = (xs: Issue[]) => xs.map((x) => x.id);

  it("holds back errors on fields that are not revealed; warnings, infos and field-less errors are never pending", () => {
    const { pending, shown } = splitPending(list, () => false);
    expect(ids(pending)).toEqual(["owner", "E_GITHUB_OWNER_REPO_MISSING", "bucket"]);
    expect(ids(shown)).toEqual(["size", "warn", "note"]);
  });

  it("asks about exactly the focus target of each issue", () => {
    const { pending, shown } = splitPending(list, (id) => id === "field:trust.owner");
    expect(ids(pending)).toEqual(["bucket"]);
    expect(ids(shown)).toEqual(["owner", "E_GITHUB_OWNER_REPO_MISSING", "size", "warn", "note"]);
    expect(ids(splitPending(list, (id) => id === "grant:g1").pending)).toEqual(["owner", "E_GITHUB_OWNER_REPO_MISSING"]);
  });
});

describe("todoText", () => {
  const model = (over: Partial<RoleModel> = {}): RoleModel => ({ ...createEmptyModel(), ...over });
  const withGrant = (module: string, data: unknown): RoleModel =>
    model({ grants: [{ id: "g", service: module, module, scope: { type: "module", data }, access: { type: "preset", preset: "p" } }] });
  const bucketIssue = i({ id: "E_MODULE_DATA", grantId: "g", path: "data.bucket", message: "core says no" });

  it("gives a short instruction for an empty field, and the core message once it has a value", () => {
    expect(todoText(bucketIssue, withGrant("s3", { bucket: "", prefixes: [""] }))).toBe("Enter the bucket name");
    expect(todoText(bucketIssue, withGrant("s3", { bucket: "Bad_Bucket", prefixes: [""] }))).toBe("core says no");
  });

  it("covers the empty fields of the trust editors", () => {
    const github = model({ trust: { kind: "github", owner: "", repo: "", ref: { type: "branch", value: "main" } } });
    expect(todoText(i({ id: "V_GITHUB_OWNER", path: "trust.owner" }), github)).toBe("Enter the GitHub owner");
    expect(todoText(i({ id: "V_GITHUB_REPO", path: "trust.repo" }), github)).toBe("Enter the repository name");
    expect(todoText(i({ id: "E_GITHUB_NEEDS_ACCOUNT" }), github)).toBe("Enter the 12-digit AWS account ID");
    const account = model({ trust: { kind: "account", accountId: "" } });
    expect(todoText(i({ id: "V_ACCOUNT_ID", path: "trust.accountId" }), account)).toBe("Enter the 12-digit AWS account ID");
    const principal = model({ trust: { kind: "principal", target: "group", name: "" } });
    expect(todoText(i({ id: "V_PRINCIPAL_NAME", path: "trust.name" }), principal)).toBe("Enter the group or user name");
  });

  it("covers the empty fields of the review step, including list rows", () => {
    expect(todoText(i({ id: "V_ROLE_NAME", path: "name" }), model({ name: "" }))).toBe("Enter a name");
    const arns = model({ managedPolicyArns: ["arn:aws:iam::aws:policy/X", ""] });
    expect(todoText(i({ id: "V_MANAGED_POLICY_ARN", path: "managedPolicyArns[1]" }), arns)).toBe("Enter the managed policy ARN");
    expect(todoText(i({ id: "V_MANAGED_POLICY_ARN", path: "managedPolicyArns[0]", message: "m" }), arns)).toBe("m");
  });

  it("covers the required field of every module editor", () => {
    const cases: [string, string, unknown, string][] = [
      ["ecr", "data.repository", { repository: "" }, "Enter the repository name"],
      ["eks", "data.cluster", { cluster: "" }, "Enter the cluster name"],
      ["lambda", "data.functionName", { functionName: "" }, "Enter the function name"],
      ["dynamodb", "data.table", { table: "" }, "Enter the table name"],
      ["logs", "data.logGroup", { logGroup: "" }, "Enter the log group name"],
      ["secretsmanager", "data.secretName", { secretName: "" }, "Enter the secret name"],
      ["kms", "data.keyArn", { keyArn: "" }, "Enter the key ARN"],
      ["sqs", "data.queueName", { queueName: "" }, "Enter the queue name"],
      ["ec2", "data.selector.key", { selector: { type: "tag", key: "", value: "" } }, "Enter the tag key"],
      ["ec2", "data.selector.ids[0]", { selector: { type: "ids", ids: [""] } }, "Enter the instance ID"],
    ];
    for (const [mod, path, data, text] of cases) {
      expect(todoText(i({ id: "E_MODULE_DATA", grantId: "g", path }), withGrant(mod, data))).toBe(text);
    }
  });

  it("falls back to the core message for ids without an instruction", () => {
    expect(todoText(i({ id: "E_GITHUB_OWNER_REPO_MISSING", message: "Enter both." }), model())).toBe("Enter both.");
    expect(todoText(i({ id: "X", path: "name", message: "m" }), model({ name: "" }))).toBe("m");
    expect(todoText(i({ id: "E_MODULE_DATA", grantId: "g", path: "data.other", message: "m" }), withGrant("s3", {}))).toBe("m");
  });
});

describe("splitPending: grant errors with no field", () => {
  it("never holds back an error that no field can fix", () => {
    const ids = ["E_INTERNAL", "E_UNKNOWN_SERVICE", "E_UNKNOWN_MODULE", "E_MODULE_SERVICE", "E_UNKNOWN_ACTION"];
    const list = ids.map((id) => i({ id, grantId: "g1" }));
    expect(splitPending(list, () => false).pending).toEqual([]);
  });
});

describe("todoText: S3 folders", () => {
  it("asks for an empty folder to be filled or removed", () => {
    const m: RoleModel = {
      ...createEmptyModel(),
      grants: [
        {
          id: "g",
          service: "s3",
          module: "s3",
          scope: { type: "module", data: { bucket: "b", prefixes: ["", ""] } },
          access: { type: "preset", preset: "p" },
        },
      ],
    };
    expect(todoText(i({ id: "E_S3_PREFIX_EMPTY", grantId: "g", path: "data.prefixes[1]" }), m)).toBe(
      "Enter the folder name, or remove the row",
    );
  });
});
