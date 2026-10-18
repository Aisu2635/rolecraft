import { describe, expect, it } from "vitest";
import type { Grant } from "../../../core/model/model";
import { scopeSummary } from "./summary";

const s3 = (prefixes: unknown): Grant => ({
  id: "g1",
  service: "s3",
  module: "s3",
  scope: { type: "module", data: { bucket: "data-lake", prefixes } },
  access: { type: "preset", preset: "read" },
});

describe("scopeSummary for S3", () => {
  it("says whole bucket only for a single empty prefix", () => {
    expect(scopeSummary(s3([""]))).toBe("data-lake / whole bucket");
    expect(scopeSummary(s3([]))).toBe("data-lake / whole bucket");
  });

  it("never counts an empty prefix as a folder", () => {
    expect(scopeSummary(s3(["reports/", ""]))).toBe("data-lake / reports/");
    expect(scopeSummary(s3(["a/", "", "b/"]))).toBe("data-lake / 2 folders");
    expect(scopeSummary(s3(["", ""]))).toBe("Not set");
  });

  it("shows one folder or counts several", () => {
    expect(scopeSummary(s3(["reports/"]))).toBe("data-lake / reports/");
    expect(scopeSummary(s3(["a/", "b/"]))).toBe("data-lake / 2 folders");
  });
});
