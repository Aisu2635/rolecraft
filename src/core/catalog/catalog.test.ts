import { describe, expect, it } from "vitest";
import s3 from "../__fixtures__/aws/s3.json";
import ec2 from "../__fixtures__/aws/ec2.json";
import textract from "../__fixtures__/aws/textract.json";
import iam from "../__fixtures__/aws/iam.json";
import { createCatalog, searchServices } from "./catalog";
import { CURATED } from "./curated";
import { buildIndex, toSlimService } from "./transform";

const services = [s3, ec2, textract, iam].map(toSlimService);
const index = buildIndex(services, "2026-01-01");

describe("searchServices", () => {
  it("ranks exact key first", () => {
    expect(searchServices(index, "s3")[0]?.key).toBe("s3");
  });
  it("ranks key prefix", () => {
    expect(searchServices(index, "text")[0]?.key).toBe("textract");
  });
  it("matches by name", () => {
    // curated display name is "Amazon S3", so use a full-name entry here
    const idx = {
      ...index,
      services: index.services.map((e) =>
        e.key === "s3" ? { ...e, name: "Amazon Simple Storage Service" } : e,
      ),
    };
    expect(searchServices(idx, "Simple Storage").map((e) => e.key)).toEqual([
      "s3",
    ]);
    expect(searchServices(index, "Amazon S3")[0]?.key).toBe("s3");
  });
  it("returns [] for empty or whitespace", () => {
    expect(searchServices(index, "")).toEqual([]);
    expect(searchServices(index, "   ")).toEqual([]);
  });
  it("is case-insensitive", () => {
    expect(searchServices(index, "S3")[0]?.key).toBe("s3");
    expect(searchServices(index, "TEXT")[0]?.key).toBe("textract");
  });
  it("respects limit", () => {
    expect(searchServices(index, "e", 2)).toHaveLength(2);
  });
  it("orders exact > key prefix > name word prefix > substring, ties by key", () => {
    const idx = {
      generatedAt: "x",
      services: [
        { key: "zsub", name: "Xfoo", category: "Other" as const, actionCount: 1 },
        { key: "wordy", name: "The Foo Bar", category: "Other" as const, actionCount: 1 },
        { key: "foobar", name: "Alpha", category: "Other" as const, actionCount: 1 },
        { key: "foo", name: "Zed", category: "Other" as const, actionCount: 1 },
        { key: "foob", name: "Beta", category: "Other" as const, actionCount: 1 },
      ],
    };
    expect(searchServices(idx, "foo").map((e) => e.key)).toEqual([
      "foo",
      "foob",
      "foobar",
      "wordy",
      "zsub",
    ]);
  });
});

describe("createCatalog", () => {
  it("looks up services", () => {
    const c = createCatalog(services);
    expect(c.getService("s3")?.key).toBe("s3");
    expect(c.hasService("ec2")).toBe(true);
    expect(c.getService("nope")).toBeUndefined();
    expect(c.hasService("nope")).toBe(false);
  });
});

describe("aliases", () => {
  const full: [string, string][] = [
    ["s3", "Simple Storage Service"],
    ["ec2", "Elastic Compute Cloud"],
    ["iam", "Identity and Access Management"],
    ["sqs", "Simple Queue Service"],
    ["sns", "Simple Notification Service"],
    ["rds", "Relational Database Service"],
    ["eks", "Elastic Kubernetes Service"],
    ["ecr", "Elastic Container Registry"],
    ["kms", "Key Management Service"],
  ];
  it("curated entries carry their full AWS names as aliases", () => {
    for (const [key, alias] of full) expect(CURATED[key]?.aliases).toEqual([alias]);
    expect(CURATED.lambda?.aliases).toEqual([]);
  });
  it("finds a service by its alias, the same way as by its name", () => {
    const idx = {
      generatedAt: "x",
      services: full.map(([key]) => ({ key, name: CURATED[key]!.name, category: "Other" as const, actionCount: 1 })),
    };
    expect(searchServices(index, "Simple Storage").map((e) => e.key)).toEqual(["s3"]);
    expect(searchServices(index, "simple storage service")[0]?.key).toBe("s3");
    for (const [key, alias] of full) expect(searchServices(idx, alias)[0]?.key).toBe(key);
    // A word prefix of an alias ranks like a name word prefix; a mid-word substring ranks below it.
    expect(searchServices(idx, "kubern").map((e) => e.key)).toEqual(["eks"]);
    expect(searchServices(idx, "ubernetes").map((e) => e.key)).toEqual(["eks"]);
    expect(searchServices(idx, "simple").map((e) => e.key)).toEqual(["s3", "sns", "sqs"]);
  });
});
