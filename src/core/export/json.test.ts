import { describe, expect, it } from "vitest";
import type { PolicyDocument } from "../types";
import type { GenerateResult } from "../generate";
import { exportJson, stringifyPolicy } from "./json";

const doc: PolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    {
      Condition: { StringEquals: { "aws:PrincipalTag/b": "1", "aws:PrincipalTag/a": ["x", "y"] } },
      Resource: "*",
      Action: ["s3:GetObject", "s3:ListBucket"],
      Principal: { Service: "ec2.amazonaws.com" },
      Effect: "Allow",
      Sid: "Test",
    },
  ],
};

const res = (policy: PolicyDocument | null, trust: PolicyDocument | null): GenerateResult => ({
  policy,
  trust,
  issues: [],
  sizes: { policy: 0, trust: 0 },
});

describe("stringifyPolicy", () => {
  it("emits exact key order, 2-space indent and one trailing newline", () => {
    const expected = [
      "{",
      '  "Version": "2012-10-17",',
      '  "Statement": [',
      "    {",
      '      "Sid": "Test",',
      '      "Effect": "Allow",',
      '      "Principal": {',
      '        "Service": "ec2.amazonaws.com"',
      "      },",
      '      "Action": [',
      '        "s3:GetObject",',
      '        "s3:ListBucket"',
      "      ],",
      '      "Resource": "*",',
      '      "Condition": {',
      '        "StringEquals": {',
      '          "aws:PrincipalTag/b": "1",',
      '          "aws:PrincipalTag/a": [',
      '            "x",',
      '            "y"',
      "          ]",
      "        }",
      "      }",
      "    }",
      "  ]",
      "}",
      "",
    ].join("\n");
    const out = stringifyPolicy(doc);
    expect(out).toBe(expected);
    expect(out.endsWith("}\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
    expect(out).not.toContain("\r");
  });

  it("omits absent optional keys", () => {
    const out = stringifyPolicy({
      Version: "2012-10-17",
      Statement: [{ Effect: "Deny", Action: "*", Resource: "*" }],
    });
    expect(out).not.toContain("Sid");
    expect(out).not.toContain("Condition");
  });
});

describe("exportJson", () => {
  it("returns policy.json and trust.json", () => {
    const files = exportJson(res(doc, doc));
    expect(files.map((f) => f.filename)).toEqual(["policy.json", "trust.json"]);
    expect(files.every((f) => f.language === "json")).toBe(true);
    expect(files[0]?.content).toBe(stringifyPolicy(doc));
  });
  it("only trust.json when policy is null", () => {
    expect(exportJson(res(null, doc)).map((f) => f.filename)).toEqual(["trust.json"]);
  });
  it("nothing when both null", () => {
    expect(exportJson(res(null, null))).toEqual([]);
  });
  it("only policy.json when trust is null", () => {
    expect(exportJson(res(doc, null)).map((f) => f.filename)).toEqual(["policy.json"]);
  });
});
