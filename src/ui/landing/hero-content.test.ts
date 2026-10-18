import { describe, expect, it } from "vitest";
import { stringifyPolicy } from "../../core/export/json";
import { loadRealCatalog } from "../../core/engine/modules/__test__/catalog";
import { generate } from "../../core/generate";
import { createEmptyModel } from "../../core/model/model";
import { HAND_WRITTEN_JSON, HERO_POLICY_JSON, heroPolicyLines } from "./hero-content";

async function realPolicy() {
  const model = {
    ...createEmptyModel(),
    name: "analytics-reader",
    trust: { kind: "principal" as const, target: "group" as const, name: "analytics-team" },
    grants: [
      {
        id: "g1",
        service: "s3",
        module: "s3",
        scope: { type: "module" as const, data: { bucket: "data-lake", prefixes: ["reports/"] } },
        access: { type: "preset" as const, preset: "list-read" },
      },
    ],
  };
  const policy = generate(model, await loadRealCatalog(["s3"])).policy;
  if (!policy) throw new Error("no policy generated");
  return policy;
}

describe("hero content", () => {
  it("hand-written JSON is the exact over-broad policy", () => {
    expect(HAND_WRITTEN_JSON).toBe(
      '{\n  "Version": "2012-10-17",\n  "Statement": [{\n    "Effect": "Allow",\n    "Action": "s3:*",\n    "Resource": "*"\n  }]\n}',
    );
    expect(HAND_WRITTEN_JSON.split("\n")).toHaveLength(8);
    expect(JSON.parse(HAND_WRITTEN_JSON).Statement[0]).toEqual({ Effect: "Allow", Action: "s3:*", Resource: "*" });
  });

  it("HERO_POLICY_JSON is exactly what the engine generates", async () => {
    const policy = await realPolicy();
    expect(JSON.parse(HERO_POLICY_JSON)).toEqual(JSON.parse(stringifyPolicy(policy)));
    expect(HERO_POLICY_JSON).toBe(stringifyPolicy(policy));
  });

  it("the compact display lines are derived from it (statements minus Sid)", async () => {
    const policy = await realPolicy();
    const lines = heroPolicyLines();
    const shown = JSON.parse(`[${lines.join("\n")}]`) as unknown[];
    const expected = policy.Statement.map((s) => {
      const rest = { ...(s as unknown as Record<string, unknown>) };
      delete rest.Sid;
      return rest;
    });
    expect(shown).toEqual(expected);
    expect(lines.length).toBeLessThanOrEqual(11);
  });

  it("keeps every display line short enough to fit the card at small widths", () => {
    const lines = heroPolicyLines();
    expect(lines).toHaveLength(11);
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(52);
  });
});
