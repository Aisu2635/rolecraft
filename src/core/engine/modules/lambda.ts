import { z } from "zod";
import type { Grant } from "../../model/model";
import { pascal } from "../sid";
import { prefixed, stmt, type Module, type ModulePreset } from "./types";

export const lambdaDataSchema = z
  .object({
    functionName: z
      .string()
      .regex(/^[a-zA-Z0-9-_]{1,64}$/, "not a valid Lambda function name"),
  })
  .strict();

export type LambdaData = z.infer<typeof lambdaDataSchema>;

const PRESETS: ModulePreset[] = [
  { id: "invoke", label: "invoke", actions: ["InvokeFunction"] },
  {
    id: "read",
    label: "read",
    actions: ["GetFunction", "GetFunctionConfiguration", "ListVersionsByFunction"],
  },
  {
    id: "deploy",
    label: "deploy code",
    actions: [
      "UpdateFunctionCode",
      "GetFunction",
      "GetFunctionConfiguration",
      "PublishVersion",
    ],
  },
];

const presetOf = (grant: Grant): string =>
  grant.access.type === "preset" ? grant.access.preset : "";

export const lambdaModule: Module<LambdaData> = {
  id: "lambda",
  service: "lambda",
  label: "AWS Lambda",
  presets: PRESETS,
  dataSchema: lambdaDataSchema,
  build: (grant, data, _svc, ctx) => {
    const preset = presetOf(grant);
    const actions = PRESETS.find((p) => p.id === preset)?.actions ?? [];
    const fn = `arn:aws:lambda:${ctx.region ?? "*"}:${ctx.accountId ?? "*"}:function:${data.functionName}`;
    const resources = preset === "invoke" ? [fn, `${fn}:*`] : [fn];
    return {
      statements: [
        stmt(`Lambda${pascal(preset)}Function`, prefixed("lambda", actions), resources),
      ],
      issues:
        preset === "deploy"
          ? [
              {
                id: "I_LAMBDA_DEPLOY_SOURCE",
                severity: "info",
                grantId: grant.id,
                message:
                  "Deploying from S3 also needs s3:GetObject on the code object; container-image functions also need ECR pull access (ecr:BatchGetImage, ecr:GetDownloadUrlForLayer) on the image repository.",
              },
            ]
          : [],
    };
  },
  explain: (grant, data) => {
    const preset = presetOf(grant);
    const fn = `the Lambda function ${data.functionName}`;
    if (preset === "read") return `Can view the configuration and versions of ${fn}.`;
    if (preset === "deploy") return `Can upload new code to and publish versions of ${fn}.`;
    return `Can invoke ${fn}, including its versions and aliases.`;
  },
};
