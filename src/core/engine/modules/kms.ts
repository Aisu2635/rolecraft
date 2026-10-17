import { z } from "zod";
import type { Grant } from "../../model/model";
import { pascal } from "../sid";
import { KMS_KEY_MESSAGE, KMS_KEY_RE } from "./kms-arn";
import { prefixed, stmt, type Module, type ModulePreset } from "./types";

export const kmsDataSchema = z
  .object({ keyArn: z.string().regex(KMS_KEY_RE, KMS_KEY_MESSAGE) })
  .strict();

export type KmsData = z.infer<typeof kmsDataSchema>;

const PRESETS: ModulePreset[] = [
  { id: "encrypt", label: "encrypt", actions: ["Encrypt", "GenerateDataKey", "DescribeKey"] },
  { id: "decrypt", label: "decrypt", actions: ["Decrypt", "DescribeKey"] },
  {
    id: "encrypt-decrypt",
    label: "encrypt + decrypt",
    actions: ["Encrypt", "GenerateDataKey", "Decrypt", "DescribeKey"],
  },
];

const presetOf = (grant: Grant): string =>
  grant.access.type === "preset" ? grant.access.preset : "";

export const kmsModule: Module<KmsData> = {
  id: "kms",
  service: "kms",
  label: "AWS KMS",
  presets: PRESETS,
  dataSchema: kmsDataSchema,
  build: (grant, data) => {
    const preset = presetOf(grant);
    const actions = PRESETS.find((p) => p.id === preset)?.actions ?? [];
    return {
      statements: [stmt(`Kms${pascal(preset)}Key`, prefixed("kms", actions), [data.keyArn])],
      issues: [],
    };
  },
  explain: (grant, data) => {
    const preset = presetOf(grant);
    const verb =
      preset === "encrypt" ? "encrypt" : preset === "decrypt" ? "decrypt" : "encrypt and decrypt";
    return `Can ${verb} data with the KMS key ${data.keyArn}.`;
  },
};
