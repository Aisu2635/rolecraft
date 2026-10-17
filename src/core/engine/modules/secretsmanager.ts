import { z } from "zod";
import type { Grant } from "../../model/model";
import { pascal } from "../sid";
import { KMS_KEY_MESSAGE, KMS_KEY_RE } from "./kms-arn";
import { prefixed, stmt, type Module, type ModulePreset } from "./types";

export const secretsmanagerDataSchema = z
  .object({
    secretName: z.string().regex(/^[\w/+=.@-]{1,512}$/, "not a valid secret name"),
    kmsKeyArn: z.string().regex(KMS_KEY_RE, KMS_KEY_MESSAGE).optional(),
  })
  .strict();

export type SecretsmanagerData = z.infer<typeof secretsmanagerDataSchema>;

const PRESETS: ModulePreset[] = [
  { id: "read", label: "read", actions: ["GetSecretValue", "DescribeSecret"] },
];

const presetOf = (grant: Grant): string =>
  grant.access.type === "preset" ? grant.access.preset : "";

export const secretsmanagerModule: Module<SecretsmanagerData> = {
  id: "secretsmanager",
  service: "secretsmanager",
  label: "AWS Secrets Manager",
  presets: PRESETS,
  dataSchema: secretsmanagerDataSchema,
  build: (grant, data, _svc, ctx) => {
    const sid = `Secretsmanager${pascal(presetOf(grant))}`;
    // Secrets Manager appends a random 6-character suffix to every secret ARN.
    const arn = `arn:aws:secretsmanager:${ctx.region ?? "*"}:${ctx.accountId ?? "*"}:secret:${data.secretName}-??????`;
    return {
      statements: [
        stmt(`${sid}Secret`, prefixed("secretsmanager", PRESETS[0]?.actions ?? []), [arn]),
        ...(data.kmsKeyArn !== undefined
          ? [stmt(`${sid}Kms`, ["kms:Decrypt"], [data.kmsKeyArn])]
          : []),
      ],
      issues: [],
    };
  },
  explain: (_grant, data) => `Can read the value of the secret ${data.secretName}.`,
};
