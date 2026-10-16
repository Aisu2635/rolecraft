import { describe, expect, it } from "vitest";
import s3 from "../__fixtures__/aws/s3.json";
import textract from "../__fixtures__/aws/textract.json";
import { ACCESS_LEVELS, type ServiceIndex, type SlimService } from "../types";
import {
  assertSanity,
  buildIndex,
  humanizeActionName,
  mapAccessLevel,
  toSlimService,
} from "./transform";

const props = (
  o: Partial<
    Record<
      "IsList" | "IsWrite" | "IsPermissionManagement" | "IsTaggingOnly",
      boolean
    >
  >,
) => ({
  IsList: false,
  IsWrite: false,
  IsPermissionManagement: false,
  IsTaggingOnly: false,
  ...o,
});

describe("mapAccessLevel", () => {
  it("maps flags", () => {
    expect(mapAccessLevel(props({}))).toBe("Read");
    expect(mapAccessLevel(props({ IsList: true }))).toBe("List");
    expect(mapAccessLevel(props({ IsWrite: true }))).toBe("Write");
    expect(mapAccessLevel(props({ IsTaggingOnly: true, IsWrite: true }))).toBe(
      "Tagging",
    );
    expect(
      mapAccessLevel(props({ IsPermissionManagement: true, IsWrite: true })),
    ).toBe("Permissions management");
    expect(mapAccessLevel(undefined)).toBe("Read");
  });
});

describe("humanizeActionName", () => {
  it.each([
    ["GetObject", "Get object"],
    ["ListMFADevices", "List MFA devices"],
    ["PutBucketACL", "Put bucket ACL"],
    ["CreateDBInstance", "Create DB instance"],
    ["GetObjectV2", "Get object V2"],
  ])("%s", (input, expected) => {
    expect(humanizeActionName(input)).toBe(expected);
  });
  it("capitalizes a leading lowercase word and handles empty input", () => {
    expect(humanizeActionName("getThing")).toBe("Get thing");
    expect(humanizeActionName("")).toBe("");
  });
});

describe("toSlimService", () => {
  const svc = toSlimService(s3);
  it("transforms s3", () => {
    expect(svc.key).toBe("s3");
    expect(svc.name).toBe("Amazon S3");
    expect(svc.category).toBe("Storage");
    const get = svc.actions.find((a) => a.name === "GetObject");
    expect(get?.level).toBe("Read");
    expect(get?.resources).toContain("object");
    expect(get?.label).toBe("Get object");
    const list = svc.actions.find((a) => a.name === "ListBucket");
    expect(list?.level).toBe("List");
    expect(list?.resources).toContain("bucket");
    expect(svc.resources.find((r) => r.name === "bucket")?.arnFormats).toEqual([
      "arn:${Partition}:s3:::${BucketName}",
    ]);
  });
  it("handles actions without resources", () => {
    const t = toSlimService(textract);
    const a = t.actions.find((x) => x.name === "AnalyzeDocument");
    expect(a?.resources).toEqual([]);
    expect(a?.level).toBe("Read");
  });
  it("falls back to title case and Other", () => {
    const t = toSlimService({ ...textract, Name: "made-up-svc" });
    expect(t.name).toBe("Made Up Svc");
    expect(t.category).toBe("Other");
  });
  it("throws on invalid shape", () => {
    expect(() => toSlimService({})).toThrow(/Invalid service JSON/);
  });
  it("is deterministic and sorted", () => {
    const raw = {
      Name: "zz",
      Actions: [
        {
          Name: "B",
          ActionConditionKeys: ["k2", "k1", "k2"],
          Resources: [{ Name: "y" }, { Name: "x" }],
        },
        { Name: "A" },
      ],
      Resources: [
        { Name: "r2", ARNFormats: ["a"], ConditionKeys: ["c", "b", "c"] },
        { Name: "r1", ARNFormats: ["b"] },
      ],
      ConditionKeys: [{ Name: "z" }, { Name: "a" }, { Name: "z" }],
      Extra: 1,
    };
    const s = toSlimService(raw);
    expect(s.actions.map((a) => a.name)).toEqual(["A", "B"]);
    expect(s.actions[1]?.conditionKeys).toEqual(["k1", "k2"]);
    expect(s.actions[1]?.resources).toEqual(["x", "y"]);
    expect(s.resources.map((r) => r.name)).toEqual(["r1", "r2"]);
    expect(s.resources[0]?.conditionKeys).toEqual([]);
    expect(s.resources[1]?.conditionKeys).toEqual(["b", "c"]);
    expect(s.conditionKeys).toEqual(["a", "z"]);
    expect(toSlimService(raw)).toEqual(s);
  });
  it("tolerates missing optional top-level lists", () => {
    const s = toSlimService({ Name: "zz", Actions: [{ Name: "A" }] });
    expect(s.resources).toEqual([]);
    expect(s.conditionKeys).toEqual([]);
  });
});

const mk = (key: string, n = 1): SlimService => ({
  key,
  name: key,
  category: "Other",
  actions: Array.from({ length: n }, (_, i) => ({
    name: `A${i}`,
    level: "Read" as const,
    resources: [],
    label: "",
    conditionKeys: [],
  })),
  resources: [],
  conditionKeys: [],
});

describe("buildIndex", () => {
  it("sorts by key and counts actions", () => {
    const idx = buildIndex([mk("s3", 2), mk("ec2", 3)], "t");
    expect(idx.generatedAt).toBe("t");
    expect(idx.services.map((s) => s.key)).toEqual(["ec2", "s3"]);
    expect(idx.services.map((s) => s.actionCount)).toEqual([3, 2]);
  });
});

describe("assertSanity", () => {
  const index = (keys: string[]): ServiceIndex =>
    buildIndex(
      keys.map((k) => mk(k)),
      "t",
    );
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `svc${i}`);
  it("throws on 399 services", () => {
    expect(() =>
      assertSanity(index(["s3", "ec2", "iam", ...filler(396)])),
    ).toThrow(/399/);
  });
  it("throws when iam is missing", () => {
    expect(() => assertSanity(index(["s3", "ec2", ...filler(398)]))).toThrow(
      /iam/,
    );
  });
  it("passes on 400", () => {
    expect(() =>
      assertSanity(index(["s3", "ec2", "iam", ...filler(397)])),
    ).not.toThrow();
  });
});

describe("ACCESS_LEVELS", () => {
  it("is ordered", () => {
    expect(ACCESS_LEVELS).toEqual(["List", "Read", "Write", "Tagging", "Permissions management"]);
  });
});
