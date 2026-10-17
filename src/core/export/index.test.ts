import { describe, expect, it } from "vitest";
import { loadRealCatalog } from "../engine/modules/__test__/catalog";
import { explain } from "../explain/explain";
import { generate } from "../generate";
import { createEmptyModel, type RoleModel } from "../model/model";
import { REFERENCE_CASES } from "./__fixtures__/cases";
import { exportAll } from "./index";
import { stringifyPolicy } from "./json";
import type { ExportInput } from "./types";

const names = Object.keys(REFERENCE_CASES);
const make = (n: string): ExportInput => (REFERENCE_CASES[n] as () => ExportInput)();
const catalog = loadRealCatalog(["s3"]);
const build = (over: Partial<RoleModel>): ExportInput => {
  const model: RoleModel = { ...createEmptyModel(), ...over };
  return { model, result: generate(model, catalog), summary: explain(model, catalog) };
};
const BLOCKED = { ok: false, reason: "Fix the errors before exporting." };

describe("exportAll", () => {
  it.each(names)("file order: %s", (n) => {
    const out = exportAll(make(n));
    if (!out.ok) throw new Error(out.reason);
    const principal = make(n).model.trust.kind === "principal";
    const script = principal ? "attach-policy" : "create-role";
    expect(out.files.map((f) => f.filename)).toEqual([
      "policy.json",
      ...(principal ? [] : ["trust.json"]),
      `${script}.sh`,
      `${script}.ps1`,
      "main.tf",
      "template.yaml",
      "README.md",
    ]);
    expect(out.files.map((f) => f.language)).toEqual([
      "json",
      ...(principal ? [] : ["json"]),
      "bash",
      "powershell",
      "hcl",
      "yaml",
      "markdown",
    ]);
  });

  it("policy.json and trust.json are the canonical documents", () => {
    const input = make("github-deploy");
    const out = exportAll(input);
    if (!out.ok) throw new Error(out.reason);
    expect(out.files[0]?.content).toBe(stringifyPolicy(input.result.policy as never));
    expect(out.files[1]?.content).toBe(stringifyPolicy(input.result.trust as never));
  });

  it("omits policy.json when only managed policy ARNs are attached", () => {
    const out = exportAll(
      build({
        name: "ssm-only",
        trust: { kind: "service", service: "ec2" },
        managedPolicyArns: ["arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"],
      }),
    );
    if (!out.ok) throw new Error(out.reason);
    expect(out.files.map((f) => f.filename)).toEqual([
      "trust.json",
      "create-role.sh",
      "create-role.ps1",
      "main.tf",
      "template.yaml",
      "README.md",
    ]);
  });

  it("is blocked while an error exists", () => {
    const input = build({
      name: "gh",
      trust: { kind: "github", owner: "o", repo: "r", ref: { type: "branch", value: "main" } },
      grants: [
        {
          id: "g1",
          service: "s3",
          module: "s3",
          scope: { type: "module", data: { bucket: "b", prefixes: [""] } },
          access: { type: "preset", preset: "list-read" },
        },
      ],
    });
    expect(input.result.issues.some((i) => i.severity === "error")).toBe(true);
    expect(exportAll(input)).toEqual(BLOCKED);
  });

  it("is blocked when there is nothing to export", () => {
    expect(exportAll(build({ name: "empty" }))).toEqual(BLOCKED);
  });
});
