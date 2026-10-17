import { describe, expect, it } from "vitest";
import ec2Raw from "../__fixtures__/aws/ec2.json";
import s3Raw from "../__fixtures__/aws/s3.json";
import logsRaw from "../__fixtures__/aws/logs.json";
import textractRaw from "../__fixtures__/aws/textract.json";
import type { BuildContext } from "../arn";
import { toSlimService } from "../catalog/transform";
import type { AccessSelection, Grant, Scope } from "../model/model";
import type { SlimService } from "../types";
import { buildGenericStatements, resolveActions } from "./generic";
import { baseSid, dedupeSids, pascal } from "./sid";

const s3 = toSlimService(s3Raw);
const ec2 = toSlimService(ec2Raw);
const textract = toSlimService(textractRaw);
const logs = toSlimService(logsRaw);
const ctx: BuildContext = { partition: "aws" };

function run(svc: SlimService, scope: Scope, access: AccessSelection) {
  const grant: Grant = { id: "g1", service: svc.key, scope, access };
  return buildGenericStatements(grant, svc, ctx);
}
const acts = (actions: string[]): AccessSelection => ({ type: "actions", actions });
const arns = (a: string[]): Scope => ({ type: "arns", arns: a });
const ids = (r: { issues: { id: string }[] }) => r.issues.map((i) => i.id);

describe("wildcard scope ARNs", () => {
  it("scopes log stream actions to a wildcard log-group ARN", () => {
    const arn = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/fn:*";
    const r = run(logs, arns([arn]), acts(["CreateLogStream", "PutLogEvents"]));
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0]?.Action).toEqual(["logs:CreateLogStream", "logs:PutLogEvents"]);
    expect(r.statements[0]?.Resource).toBe(arn);
    expect(r.issues.map((i) => i.id)).not.toContain("I_ACTION_NOT_SCOPED");
  });
});

describe("sid helpers", () => {
  it("pascal", () => {
    expect(pascal("execute-api")).toBe("ExecuteApi");
    expect(pascal("s3")).toBe("S3");
    expect(pascal("cognito-idp")).toBe("CognitoIdp");
  });
  it("baseSid variants", () => {
    expect(
      baseSid("s3", { type: "levels", levels: ["Permissions management", "List"] }, "All"),
    ).toBe("S3ListPermissionsManagementAll");
    expect(baseSid("s3", acts([]), "Global")).toBe("S3CustomGlobal");
    expect(baseSid("s3", { type: "preset", preset: "read-only_x" }, "Scoped")).toBe(
      "S3ReadOnlyXScoped",
    );
  });
  it("dedupeSids", () => {
    const s = { Sid: "A", Effect: "Allow" as const, Action: "x:y" };
    expect(dedupeSids([s, s, s]).map((x) => x.Sid)).toEqual(["A", "A2", "A3"]);
    const none = { Effect: "Allow" as const, Action: "x:y" };
    expect(dedupeSids([none])).toEqual([none]);
  });
});

describe("resolveActions", () => {
  it("returns nothing for preset", () => {
    expect(resolveActions(s3, { type: "preset", preset: "x" })).toEqual({
      actions: [],
      unknown: [],
    });
  });
  it("dedupes and reports unknown", () => {
    const r = resolveActions(s3, acts(["GetObject", "GetObject", "Nope", "Nope"]));
    expect(r.actions.map((a) => a.name)).toEqual(["GetObject"]);
    expect(r.unknown).toEqual(["Nope"]);
  });
});

describe("buildGenericStatements", () => {
  it("levels Read on textract scope all", () => {
    const r = run(textract, { type: "all" }, { type: "levels", levels: ["Read"] });
    const expected = textract.actions
      .filter((a) => a.level === "Read")
      .map((a) => `textract:${a.name}`)
      .sort();
    expect(r.statements).toStrictEqual([
      { Sid: "TextractReadAll", Effect: "Allow", Action: expected, Resource: "*" },
    ]);
    expect(r.issues).toEqual([]);
  });

  it("explicit single action", () => {
    const r = run(textract, { type: "all" }, acts(["AnalyzeDocument"]));
    expect(r.statements).toStrictEqual([
      {
        Sid: "TextractCustomAll",
        Effect: "Allow",
        Action: "textract:AnalyzeDocument",
        Resource: "*",
      },
    ]);
  });

  it("splits global-only actions into a star statement", () => {
    const r = run(s3, arns(["arn:aws:s3:::b/*"]), acts(["GetObject", "ListAllMyBuckets"]));
    expect(r.statements).toStrictEqual([
      {
        Sid: "S3CustomScoped",
        Effect: "Allow",
        Action: "s3:GetObject",
        Resource: "arn:aws:s3:::b/*",
      },
      { Sid: "S3CustomGlobal", Effect: "Allow", Action: "s3:ListAllMyBuckets", Resource: "*" },
    ]);
    const star = r.issues.find((i) => i.id === "I_REQUIRES_STAR");
    expect(star?.severity).toBe("info");
    expect(star?.message).toContain("s3:ListAllMyBuckets");
    expect(star?.grantId).toBe("g1");
  });

  it("drops actions whose resource types do not match", () => {
    const r = run(s3, arns(["arn:aws:s3:::b/reports/*"]), acts(["ListBucket", "GetObject"]));
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0]?.Action).toBe("s3:GetObject");
    const i = r.issues.find((x) => x.id === "I_ACTION_NOT_SCOPED");
    expect(i?.message).toContain("s3:ListBucket");
    expect(i?.message).toContain("bucket");
  });

  it("groups by ARN set", () => {
    const r = run(
      s3,
      arns(["arn:aws:s3:::b", "arn:aws:s3:::b/*"]),
      acts(["ListBucket", "GetObject"]),
    );
    expect(r.statements.map((s) => [s.Action, s.Resource])).toEqual([
      ["s3:GetObject", "arn:aws:s3:::b/*"],
      ["s3:ListBucket", "arn:aws:s3:::b"],
    ]);
    expect(dedupeSids(r.statements).map((s) => s.Sid)).toEqual([
      "S3CustomScoped",
      "S3CustomScoped2",
    ]);
  });

  it("merges actions sharing an ARN set into a sorted array", () => {
    const r = run(s3, arns(["arn:aws:s3:::b/*"]), acts(["PutObject", "GetObject"]));
    expect(r.statements[0]?.Action).toEqual(["s3:GetObject", "s3:PutObject"]);
  });

  it("warns when only some resource types are covered", () => {
    const r = run(
      ec2,
      arns(["arn:aws:ec2:us-east-1:123456789012:instance/i-1"]),
      acts(["RunInstances"]),
    );
    const w = r.issues.find((i) => i.id === "W_PARTIAL_RESOURCES");
    expect(w?.severity).toBe("warning");
    expect(w?.message).toContain("ec2:RunInstances");
    expect(w?.message).toContain("image");
    expect(w?.message).toContain("subnet");
  });

  it("does not warn for S3 GetObject on an object ARN", () => {
    const r = run(s3, arns(["arn:aws:s3:::b/*"]), acts(["GetObject"]));
    expect(ids(r)).not.toContain("W_PARTIAL_RESOURCES");
  });

  it("unknown action", () => {
    const r = run(s3, { type: "all" }, acts(["GetObject", "Bogus"]));
    expect(r.statements[0]?.Action).toBe("s3:GetObject");
    const e = r.issues.find((i) => i.id === "E_UNKNOWN_ACTION");
    expect(e?.severity).toBe("error");
    expect(e?.message).toContain("s3:Bogus");
  });

  it("only unknown actions yields no statements and no empty-selection issue", () => {
    const r = run(s3, { type: "all" }, acts(["Bogus"]));
    expect(r.statements).toEqual([]);
    expect(ids(r)).toEqual(["E_UNKNOWN_ACTION"]);
  });

  it("foreign ARN", () => {
    const r = run(
      s3,
      arns(["arn:aws:ec2:us-east-1:123456789012:instance/i-1", "arn:aws:s3:::b/*"]),
      acts(["GetObject"]),
    );
    expect(ids(r)).toContain("E_FOREIGN_ARN");
    expect(r.statements).toHaveLength(1);
  });

  it("preset without module", () => {
    const r = run(s3, { type: "all" }, { type: "preset", preset: "x" });
    expect(r.statements).toEqual([]);
    expect(ids(r)).toEqual(["E_PRESET_WITHOUT_MODULE"]);
  });

  it("module scope is an error", () => {
    const r = run(s3, { type: "module", data: {} }, acts(["GetObject"]));
    expect(r.statements).toEqual([]);
    expect(ids(r)).toEqual(["E_MODULE_SCOPE_GENERIC"]);
  });

  it("literal * in arns means all resources", () => {
    const r = run(
      s3,
      arns(["*", "arn:aws:s3:::b/*"]),
      acts(["ListBucket", "GetObject", "ListAllMyBuckets"]),
    );
    expect(r.statements).toStrictEqual([
      {
        Sid: "S3CustomScoped",
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:ListBucket"],
        Resource: "*",
      },
      { Sid: "S3CustomGlobal", Effect: "Allow", Action: "s3:ListAllMyBuckets", Resource: "*" },
    ]);
    expect(ids(r)).not.toContain("E_FOREIGN_ARN");
  });

  it("dedupes ARNs and ignores blanks; empty list scopes nothing", () => {
    const r = run(
      s3,
      arns(["arn:aws:s3:::b/*", " arn:aws:s3:::b/* ", "", "  "]),
      acts(["GetObject"]),
    );
    expect(r.statements[0]?.Resource).toBe("arn:aws:s3:::b/*");
    const empty = run(s3, arns(["", " "]), acts(["GetObject", "ListAllMyBuckets"]));
    expect(ids(empty)).toContain("I_ACTION_NOT_SCOPED");
    expect(empty.statements.map((s) => s.Action)).toEqual(["s3:ListAllMyBuckets"]);
  });

  it("empty selections", () => {
    for (const access of [
      { type: "levels", levels: [] },
      { type: "actions", actions: [] },
    ] as AccessSelection[]) {
      const r = run(s3, { type: "all" }, access);
      expect(r.statements).toEqual([]);
      expect(r.issues).toEqual([
        expect.objectContaining({ id: "I_EMPTY_SELECTION", severity: "info", grantId: "g1" }),
      ]);
    }
  });

  it("is deterministic", () => {
    const go = () =>
      run(s3, arns(["arn:aws:s3:::b", "arn:aws:s3:::b/*"]), {
        type: "levels",
        levels: ["List", "Read", "Write"],
      });
    expect(go()).toStrictEqual(go());
  });
});

describe("E_BAD_ARN", () => {
  it.each(["arn:aws:s3:::b\nc/*", 'arn:aws:s3:::b"c/x', "arn:aws:s3:::b c/x", "arn:aws:s3:::${foo}/x", "arn:aws:*", "arn:aws:s3:*"])(
    "rejects %j without emitting it",
    (arn) => {
      const r = run(s3, arns([arn]), acts(["GetObject"]));
      const bad = r.issues.find((i) => i.id === "E_BAD_ARN");
      expect(bad?.severity).toBe("error");
      expect(bad?.grantId).toBe("g1");
      expect(JSON.stringify(r.statements)).not.toContain("${foo}");
      expect(r.statements.flatMap((s) => [s.Resource].flat())).not.toContain(arn);
    },
  );
  it("accepts a policy-variable ARN", () => {
    const arn = "arn:aws:s3:::home/${aws:username}/*";
    const r = run(s3, arns([arn]), acts(["GetObject"]));
    expect(ids(r)).not.toContain("E_BAD_ARN");
    expect(r.statements[0]?.Resource).toBe(arn);
  });
});
