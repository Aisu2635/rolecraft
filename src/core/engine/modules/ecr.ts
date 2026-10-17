import { z } from "zod";
import type { Grant } from "../../model/model";
import { pascal } from "../sid";
import { prefixed, stmt, type Module, type ModulePreset } from "./types";

const REPO_RE =
  /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export const ecrDataSchema = z
  .object({
    repository: z
      .string()
      .max(256, "repository name is too long")
      .regex(REPO_RE, "not a valid ECR repository name"),
  })
  .strict();

export type EcrData = z.infer<typeof ecrDataSchema>;

const PULL = [
  "BatchGetImage",
  "GetDownloadUrlForLayer",
  "BatchCheckLayerAvailability",
];
const PUSH = [
  "BatchCheckLayerAvailability",
  "InitiateLayerUpload",
  "UploadLayerPart",
  "CompleteLayerUpload",
  "PutImage",
];

const PRESETS: ModulePreset[] = [
  { id: "pull", label: "pull", actions: PULL },
  { id: "push", label: "push", actions: PUSH },
  {
    id: "pull-push",
    label: "pull + push",
    actions: [...new Set([...PULL, ...PUSH])],
  },
];

const presetOf = (grant: Grant): string =>
  grant.access.type === "preset" ? grant.access.preset : "";

export const ecrModule: Module<EcrData> = {
  id: "ecr",
  service: "ecr",
  label: "Amazon ECR",
  presets: PRESETS,
  dataSchema: ecrDataSchema,
  build: (grant, data, _svc, ctx) => {
    const preset = presetOf(grant);
    const sid = `Ecr${pascal(preset)}`;
    const actions = PRESETS.find((p) => p.id === preset)?.actions ?? [];
    return {
      statements: [
        stmt(`${sid}Repository`, prefixed("ecr", actions), [
          `arn:aws:ecr:${ctx.region ?? "*"}:${ctx.accountId ?? "*"}:repository/${data.repository}`,
        ]),
        stmt(`${sid}Auth`, ["ecr:GetAuthorizationToken"], ["*"]),
      ],
      issues: [],
    };
  },
  explain: (grant, data) => {
    const preset = presetOf(grant);
    const repo = `the ECR repository ${data.repository}`;
    if (preset === "push") return `Can push images to ${repo}.`;
    if (preset === "pull-push")
      return `Can pull images from and push images to ${repo}.`;
    return `Can pull images from ${repo}.`;
  },
};
