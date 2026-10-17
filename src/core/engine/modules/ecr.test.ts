import { describe, expect, it } from "vitest";
import type { BuildContext } from "../../arn";
import type { Grant } from "../../model/model";
import type { SlimService, Statement } from "../../types";
import { validateIdentityPolicy } from "../../validate/policy";
import { loadRealCatalog } from "./__test__/catalog";
import { ecrModule } from "./ecr";
import { MODULES, defaultBuilders } from "./registry";
import { runModule } from "./types";

const catalog = loadRealCatalog(["ecr"]);
const svc = { key: "ecr" } as unknown as SlimService;
const ctx: BuildContext = { partition: "aws", region: "us-east-1", accountId: "123456789012" };
const grant = (preset: string, data: unknown): Grant => ({
  id: "g1",
  service: "ecr",
  module: "ecr",
  scope: { type: "module", data },
  access: { type: "preset", preset },
});
const run = (preset: string, data: unknown, c: BuildContext = ctx) =>
  runModule(ecrModule, grant(preset, data), svc, c);
const valid = (statements: Statement[]) =>
  validateIdentityPolicy({ Version: "2012-10-17", Statement: statements }, catalog);
const auth = (sid: string): Statement => ({
  Sid: sid,
  Effect: "Allow",
  Action: "ecr:GetAuthorizationToken",
  Resource: "*",
});

describe("ecr module", () => {
  it("is registered", () => {
    expect(MODULES["ecr"]).toBe(ecrModule);
    expect(defaultBuilders()["ecr"]).toBeTypeOf("function");
  });

  it("pull", () => {
    const r = run("pull", { repository: "team/app" });
    expect(r.issues).toStrictEqual([]);
    expect(r.statements).toStrictEqual([
      {
        Sid: "EcrPullRepository",
        Effect: "Allow",
        Action: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ],
        Resource: "arn:aws:ecr:us-east-1:123456789012:repository/team/app",
      },
      auth("EcrPullAuth"),
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("push", () => {
    const r = run("push", { repository: "app" }, { partition: "aws" });
    expect(r.statements).toStrictEqual([
      {
        Sid: "EcrPushRepository",
        Effect: "Allow",
        Action: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:CompleteLayerUpload",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ],
        Resource: "arn:aws:ecr:*:*:repository/app",
      },
      auth("EcrPushAuth"),
    ]);
  });

  it("every preset ends with the auth statement and validates", () => {
    const sids = { pull: "EcrPullAuth", push: "EcrPushAuth", "pull-push": "EcrPullPushAuth" };
    for (const p of ecrModule.presets) {
      const r = run(p.id, { repository: "a.b-c_d/e" });
      expect(r.statements.at(-1)).toStrictEqual(auth(sids[p.id as keyof typeof sids]));
      expect(valid(r.statements)).toStrictEqual([]);
    }
    const both = run("pull-push", { repository: "a" }).statements[0];
    expect((both?.Action as string[]).length).toBe(7);
  });

  it("rejects invalid data", () => {
    expect(run("pull", { repository: "Team/App" }).issues[0]?.id).toBe("E_MODULE_DATA");
    expect(run("pull", { repository: "a".repeat(257) }).issues[0]?.id).toBe("E_MODULE_DATA");
  });

  it("explains", () => {
    const d = { repository: "app" };
    expect(ecrModule.explain(grant("pull", d), d)).toBe(
      "Can pull images from the ECR repository app.",
    );
    expect(ecrModule.explain(grant("push", d), d)).toBe(
      "Can push images to the ECR repository app.",
    );
    expect(ecrModule.explain(grant("pull-push", d), d)).toBe(
      "Can pull images from and push images to the ECR repository app.",
    );
  });
});
