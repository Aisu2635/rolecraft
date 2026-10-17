import { z } from "zod";
import type { Grant } from "../../model/model";
import type { Statement } from "../../types";
import { pascal } from "../sid";
import { KMS_KEY_MESSAGE, KMS_KEY_RE } from "./kms-arn";
import { prefixed, stmt, type Module, type ModulePreset } from "./types";

export const sqsDataSchema = z
  .object({
    queueName: z.string().regex(/^[A-Za-z0-9_-]{1,80}(\.fifo)?$/, "not a valid queue name"),
    kmsKeyArn: z.string().regex(KMS_KEY_RE, KMS_KEY_MESSAGE).optional(),
  })
  .strict();

export type SqsData = z.infer<typeof sqsDataSchema>;

const SEND = ["SendMessage", "GetQueueUrl", "GetQueueAttributes"];
const RECEIVE = [
  "ReceiveMessage",
  "DeleteMessage",
  "ChangeMessageVisibility",
  "GetQueueUrl",
  "GetQueueAttributes",
];

const PRESETS: ModulePreset[] = [
  { id: "send", label: "send", actions: SEND },
  { id: "receive", label: "receive", actions: RECEIVE },
  {
    id: "send-receive",
    label: "send + receive",
    actions: [...new Set([...SEND, ...RECEIVE])],
  },
];

const presetOf = (grant: Grant): string =>
  grant.access.type === "preset" ? grant.access.preset : "";

export const sqsModule: Module<SqsData> = {
  id: "sqs",
  service: "sqs",
  label: "Amazon SQS",
  presets: PRESETS,
  dataSchema: sqsDataSchema,
  build: (grant, data, _svc, ctx) => {
    const preset = presetOf(grant);
    const sid = `Sqs${pascal(preset)}`;
    const sends = preset !== "receive";
    const actions = PRESETS.find((p) => p.id === preset)?.actions ?? [];
    const arn = `arn:aws:sqs:${ctx.region ?? "*"}:${ctx.accountId ?? "*"}:${data.queueName}`;
    const statements: Statement[] = [stmt(`${sid}Queue`, prefixed("sqs", actions), [arn])];
    if (data.kmsKeyArn !== undefined) {
      // Producers need Decrypt too: SQS decrypts the data key it generates for SSE-KMS queues.
      const kms = [...(sends ? ["GenerateDataKey"] : []), "Decrypt"];
      statements.push(stmt(`${sid}Kms`, prefixed("kms", kms), [data.kmsKeyArn]));
    }
    return { statements, issues: [] };
  },
  explain: (grant, data) => {
    const preset = presetOf(grant);
    if (preset === "send") return `Can send messages to the queue ${data.queueName}.`;
    if (preset === "receive") {
      return `Can receive and delete messages from the queue ${data.queueName}.`;
    }
    return `Can send, receive and delete messages on the queue ${data.queueName}.`;
  },
};
