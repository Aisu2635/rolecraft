import { describe, expect, it } from "vitest";
import { VARIANT_CASES } from "./__fixtures__/variants";
import { exportAll } from "./index";
import type { ExportInput } from "./types";

describe("VARIANT_CASES", () => {
  for (const [id, build] of Object.entries(VARIANT_CASES)) {
    it(`${id}: exportable without errors`, () => {
      const input = build();
      expect(input.result.issues.filter((i) => i.severity === "error")).toStrictEqual([]);
      expect(exportAll(input).ok).toBe(true);
    });
  }
  it("group-managed-arns: CloudFormation lists the managed policy attach commands as comments", () => {
    const out = exportAll((VARIANT_CASES["group-managed-arns"] as () => ExportInput)());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const cfn = out.files.find((f) => f.filename === "template.yaml")?.content ?? "";
    expect(cfn).toMatch(/^# .*aws iam attach-group-policy/m);
  });
});
