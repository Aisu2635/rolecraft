import { describe, expect, it } from "vitest";
import type { BuildContext } from "../../arn";
import type { Grant } from "../../model/model";
import type { SlimService, Statement } from "../../types";
import { validateIdentityPolicy } from "../../validate/policy";
import { loadRealCatalog } from "./__test__/catalog";
import { MODULES, defaultBuilders } from "./registry";
import { s3Module } from "./s3";
import { runModule } from "./types";

const catalog = loadRealCatalog(["s3", "kms"]);
const svc = { key: "s3" } as unknown as SlimService;
const ctx: BuildContext = { partition: "aws" };
const KEY =
  "arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";

const grant = (preset: string, data: unknown): Grant => ({
  id: "g1",
  service: "s3",
  module: "s3",
  scope: { type: "module", data },
  access: { type: "preset", preset },
});
const run = (preset: string, data: unknown) =>
  runModule(s3Module, grant(preset, data), svc, ctx);
const valid = (statements: Statement[]) =>
  validateIdentityPolicy(
    { Version: "2012-10-17", Statement: statements },
    catalog,
  );

describe("s3 module", () => {
  it("is registered", () => {
    expect(MODULES["s3"]).toBe(s3Module);
    expect(defaultBuilders()["s3"]).toBeTypeOf("function");
  });

  it("list-read with one prefix", () => {
    const r = run("list-read", { bucket: "data-lake", prefixes: ["reports/"] });
    expect(r.issues).toStrictEqual([]);
    expect(r.statements).toStrictEqual([
      {
        Sid: "S3ListReadList",
        Effect: "Allow",
        Action: "s3:ListBucket",
        Resource: "arn:aws:s3:::data-lake",
        Condition: { StringLike: { "s3:prefix": ["reports/", "reports/*"] } },
      },
      {
        Sid: "S3ListReadObjects",
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:GetObjectVersion"],
        Resource: "arn:aws:s3:::data-lake/reports/*",
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("an explicit / is the whole bucket: no condition, and it subsumes other prefixes", () => {
    const r = run("list-read", {
      bucket: "data-lake",
      prefixes: ["a/", "/"],
    });
    expect(r.statements).toStrictEqual([
      {
        Sid: "S3ListReadList",
        Effect: "Allow",
        Action: "s3:ListBucket",
        Resource: "arn:aws:s3:::data-lake",
      },
      {
        Sid: "S3ListReadObjects",
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:GetObjectVersion"],
        Resource: "arn:aws:s3:::data-lake/*",
      },
    ]);
    expect(r.issues).toStrictEqual([
      {
        id: "W_S3_PREFIX_ROOT",
        severity: "warning",
        grantId: "g1",
        path: "data.prefixes[1]",
        message:
          "Folder 2 is the whole bucket, so the other folders add nothing. Remove it to keep access to those folders only.",
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("warns on every folder that normalises to the bucket root beside other folders", () => {
    const r = run("read", { bucket: "data-lake", prefixes: ["reports/", "/"] });
    expect(r.issues.map((i) => [i.id, i.path])).toStrictEqual([["W_S3_PREFIX_ROOT", "data.prefixes[1]"]]);
    const two = run("read", { bucket: "data-lake", prefixes: ["//", "a/", "/"] });
    expect(two.issues.map((i) => [i.id, i.path])).toStrictEqual([
      ["W_S3_PREFIX_ROOT", "data.prefixes[0]"],
      ["W_S3_PREFIX_ROOT", "data.prefixes[2]"],
    ]);
    expect(run("read", { bucket: "data-lake", prefixes: ["/", "//"] }).issues).toStrictEqual([]);
  });

  it("a blank extra prefix is an error on that row, never the whole bucket", () => {
    const r = run("list-read", {
      bucket: "data-lake",
      prefixes: ["reports/", ""],
    });
    expect(r.statements).toStrictEqual([]);
    expect(r.issues).toStrictEqual([
      {
        id: "E_S3_PREFIX_EMPTY",
        severity: "error",
        grantId: "g1",
        path: "data.prefixes[1]",
        message: "Folder 2 is empty. Fill it in or remove it.",
      },
    ]);
  });

  it("flags every blank prefix when there are several rows", () => {
    const r = run("read", { bucket: "data-lake", prefixes: ["", "a/", ""] });
    expect(r.statements).toStrictEqual([]);
    expect(r.issues.map((i) => [i.id, i.path, i.message])).toStrictEqual([
      ["E_S3_PREFIX_EMPTY", "data.prefixes[0]", "Folder 1 is empty. Fill it in or remove it."],
      ["E_S3_PREFIX_EMPTY", "data.prefixes[2]", "Folder 3 is empty. Fill it in or remove it."],
    ]);
  });

  it("whole bucket alone raises no issue; navigation is skipped", () => {
    const r = run("list-read", {
      bucket: "data-lake",
      prefixes: [""],
      allowNavigation: true,
    });
    expect(r.issues).toStrictEqual([]);
    expect(r.statements).toHaveLength(2);
  });

  it("normalizes reports and /reports/ to reports/ and dedupes", () => {
    for (const p of [["reports"], ["/reports/"], ["reports", "/reports/"]]) {
      const r = run("read", { bucket: "data-lake", prefixes: p });
      expect(valid(r.statements)).toStrictEqual([]);
      expect(r.statements).toStrictEqual([
        {
          Sid: "S3ReadObjects",
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:GetObjectVersion"],
          Resource: "arn:aws:s3:::data-lake/reports/*",
        },
      ]);
    }
  });

  it("navigation statement lists proper parents", () => {
    const r = run("list-read", {
      bucket: "data-lake",
      prefixes: ["reports/2026/"],
      allowNavigation: true,
    });
    expect(r.statements[2]).toStrictEqual({
      Sid: "S3ListReadNavigate",
      Effect: "Allow",
      Action: "s3:ListBucket",
      Resource: "arn:aws:s3:::data-lake",
      Condition: {
        StringEquals: { "s3:prefix": ["", "reports/"], "s3:delimiter": ["/"] },
      },
    });
    expect(r.statements).toHaveLength(3);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("navigation is ignored without ListBucket", () => {
    const r = run("read", {
      bucket: "data-lake",
      prefixes: ["a/"],
      allowNavigation: true,
    });
    expect(r.statements).toHaveLength(1);
  });

  it("two prefixes", () => {
    const r = run("list-read", { bucket: "data-lake", prefixes: ["b/", "a/"] });
    expect(r.statements[0]?.Condition).toStrictEqual({
      StringLike: { "s3:prefix": ["a/", "a/*", "b/", "b/*"] },
    });
    expect(r.statements[1]?.Resource).toStrictEqual([
      "arn:aws:s3:::data-lake/a/*",
      "arn:aws:s3:::data-lake/b/*",
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("navigation unions parents across prefixes", () => {
    const r = run("list", {
      bucket: "data-lake",
      prefixes: ["x/y/z/", "x/q/"],
      allowNavigation: true,
    });
    expect(r.statements[1]?.Condition).toStrictEqual({
      StringEquals: { "s3:prefix": ["", "x/", "x/y/"], "s3:delimiter": ["/"] },
    });
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("allows ${aws:username}", () => {
    const r = run("read-write", {
      bucket: "data-lake",
      prefixes: ["home/${aws:username}/"],
    });
    expect(r.statements[1]?.Resource).toBe(
      "arn:aws:s3:::data-lake/home/${aws:username}/*",
    );
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("warns that ${aws:username} fails for roles but still emits", () => {
    const r = run("read", {
      bucket: "data-lake",
      prefixes: ["home/${aws:username}/"],
    });
    expect(r.statements).toHaveLength(1);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toStrictEqual({
      id: "W_S3_USERNAME_VAR",
      severity: "warning",
      grantId: "g1",
      message:
        "${aws:username} only works when this policy is attached to an IAM user or group. For roles (EC2, Lambda, GitHub, SSO), use ${aws:userid} or ${aws:PrincipalTag/<key>} instead.",
    });
  });

  it("accepts userid and PrincipalTag variables; no warning", () => {
    for (const p of ["home/${aws:userid}/", "team/${aws:PrincipalTag/team}/"]) {
      const r = run("list-read", { bucket: "data-lake", prefixes: [p] });
      expect(r.issues).toStrictEqual([]);
      expect(valid(r.statements)).toStrictEqual([]);
    }
  });

  it("rejects unknown or incomplete policy variables", () => {
    for (const p of ["home/${foo}/", "a${b/"]) {
      const r = run("read", { bucket: "data-lake", prefixes: [p] });
      expect(r.statements).toStrictEqual([]);
      expect(r.issues[0]).toMatchObject({
        id: "E_MODULE_DATA",
        path: "data.prefixes[0]",
      });
    }
  });

  it("upload-only has no ListBucket", () => {
    const r = run("upload-only", {
      bucket: "data-lake",
      prefixes: ["uploads/"],
    });
    expect(r.statements).toStrictEqual([
      {
        Sid: "S3UploadOnlyObjects",
        Effect: "Allow",
        Action: ["s3:AbortMultipartUpload", "s3:PutObject"],
        Resource: "arn:aws:s3:::data-lake/uploads/*",
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("every preset validates", () => {
    for (const p of s3Module.presets) {
      const r = run(p.id, {
        bucket: "data-lake",
        prefixes: ["a/", "b/c/"],
        allowNavigation: true,
        kmsKeyArn: KEY,
      });
      expect(valid(r.statements)).toStrictEqual([]);
    }
  });

  it("kms with read-write", () => {
    const r = run("read-write", {
      bucket: "data-lake",
      prefixes: ["a/"],
      kmsKeyArn: KEY,
    });
    expect(r.statements.at(-1)).toStrictEqual({
      Sid: "S3ReadWriteKms",
      Effect: "Allow",
      Action: ["kms:Decrypt", "kms:GenerateDataKey"],
      Resource: KEY,
    });
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("kms with read only and write only; none for list/delete", () => {
    const read = run("read", {
      bucket: "b-b",
      prefixes: ["a/"],
      kmsKeyArn: KEY,
    });
    expect(read.statements.at(-1)?.Action).toBe("kms:Decrypt");
    const write = run("upload-only", {
      bucket: "b-b",
      prefixes: ["a/"],
      kmsKeyArn: KEY,
    });
    expect(write.statements.at(-1)?.Action).toStrictEqual([
      "kms:Decrypt",
      "kms:GenerateDataKey",
    ]);
    const list = run("list", {
      bucket: "b-b",
      prefixes: ["a/"],
      kmsKeyArn: KEY,
    });
    expect(list.statements).toHaveLength(1);
    const del = run("delete", {
      bucket: "b-b",
      prefixes: ["a/"],
      kmsKeyArn: KEY,
    });
    expect(del.statements).toHaveLength(1);
  });

  it("rejects invalid data with paths", () => {
    const many = Array.from({ length: 21 }, (_, i) => `p${i}/`);
    const cases: [unknown, string][] = [
      [{ bucket: "Data_Lake", prefixes: ["a/"] }, "data.bucket"],
      [{ bucket: "1.2.3.4", prefixes: ["a/"] }, "data.bucket"],
      [{ bucket: "a..b", prefixes: ["a/"] }, "data.bucket"],
      [{ bucket: "data-lake", prefixes: ["a*/"] }, "data.prefixes[0]"],
      [{ bucket: "data-lake", prefixes: ["a b/"] }, "data.prefixes[0]"],
      [
        { bucket: "data-lake", prefixes: ["a/"], kmsKeyArn: "*" },
        "data.kmsKeyArn",
      ],
      [{ bucket: "data-lake", prefixes: [] }, "data.prefixes"],
      [{ bucket: "data-lake", prefixes: many }, "data.prefixes"],
    ];
    for (const [data, path] of cases) {
      const r = run("read", data);
      expect(r.statements).toStrictEqual([]);
      expect(r.issues[0]).toMatchObject({ id: "E_MODULE_DATA" });
      expect(r.issues[0]?.path).toBe(path);
    }
    const extra = run("read", {
      bucket: "data-lake",
      prefixes: ["a/"],
      extra: 1,
    });
    expect(extra.issues[0]).toMatchObject({ id: "E_MODULE_DATA" });
  });

  it("explains", () => {
    const g = (p: string) => grant(p, {});
    const d = { bucket: "data-lake", prefixes: ["reports/"] };
    const ex = (p: string, data: unknown) =>
      s3Module.explain(g(p), data as never);
    expect(ex("list-read", d)).toBe(
      "Can list and download files in reports/ of data-lake.",
    );
    expect(ex("upload-only", { ...d, prefixes: ["uploads/"] })).toBe(
      "Can upload files to uploads/ of data-lake (cannot list or download).",
    );
    expect(ex("list", d)).toBe("Can list files in reports/ of data-lake.");
    expect(ex("read", d)).toBe("Can download files in reports/ of data-lake.");
    expect(ex("write", d)).toBe(
      "Can upload files to reports/ of data-lake (cannot list or download).",
    );
    expect(ex("read-write", d)).toBe(
      "Can list, download and upload files in reports/ of data-lake.",
    );
    expect(ex("delete", d)).toBe("Can delete files in reports/ of data-lake.");
    expect(ex("read", { ...d, prefixes: ["/", "a/"] })).toBe(
      "Can download files in the whole bucket data-lake.",
    );
    expect(ex("read", { ...d, prefixes: ["a", "b/"] })).toBe(
      "Can download files in a/ and b/ of data-lake.",
    );
    expect(ex("read", { ...d, prefixes: ["reports/", ""] })).toBe(
      "Can download files in reports/ of data-lake.",
    );
    expect(ex("read", { ...d, prefixes: [""] })).toBe(
      "Can download files in the whole bucket data-lake.",
    );
  });
});
