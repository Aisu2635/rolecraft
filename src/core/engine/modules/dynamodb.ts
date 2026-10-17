import { z } from "zod";
import type { Grant } from "../../model/model";
import type { Statement } from "../../types";
import { pascal } from "../sid";
import { prefixed, stmt, type Module, type ModulePreset } from "./types";

export const dynamodbDataSchema = z
  .object({
    table: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]{3,255}$/, "not a valid DynamoDB table name"),
    includeIndexes: z.boolean().default(true),
  })
  .strict();

export type DynamodbData = z.infer<typeof dynamodbDataSchema>;

const READ = [
  "GetItem",
  "BatchGetItem",
  "Query",
  "Scan",
  "DescribeTable",
  "ConditionCheckItem",
];
const WRITE = [
  "PutItem",
  "UpdateItem",
  "DeleteItem",
  "BatchWriteItem",
  "DescribeTable",
  "ConditionCheckItem",
];

const PRESETS: ModulePreset[] = [
  { id: "read", label: "read", actions: READ },
  { id: "write", label: "write", actions: WRITE },
  {
    id: "read-write",
    label: "read + write",
    actions: [...new Set([...READ, ...WRITE])],
  },
];

const presetOf = (grant: Grant): string =>
  grant.access.type === "preset" ? grant.access.preset : "";

export const dynamodbModule: Module<DynamodbData> = {
  id: "dynamodb",
  service: "dynamodb",
  label: "Amazon DynamoDB",
  presets: PRESETS,
  dataSchema: dynamodbDataSchema,
  build: (grant, data, _svc, ctx) => {
    const preset = presetOf(grant);
    const sid = `Dynamodb${pascal(preset)}`;
    const actions = PRESETS.find((p) => p.id === preset)?.actions ?? [];
    const table = `arn:aws:dynamodb:${ctx.region ?? "*"}:${ctx.accountId ?? "*"}:table/${data.table}`;
    const statements: Statement[] = [
      stmt(`${sid}Table`, prefixed("dynamodb", actions), [table]),
    ];
    const indexed = ["Query", "Scan"].filter((a) => actions.includes(a));
    if (data.includeIndexes && indexed.length > 0) {
      statements.push(
        stmt(`${sid}Index`, prefixed("dynamodb", indexed), [`${table}/index/*`]),
      );
    }
    return { statements, issues: [] };
  },
  explain: (grant, data) => {
    const preset = presetOf(grant);
    const t = `the DynamoDB table ${data.table}`;
    if (preset === "write") return `Can write and delete items in ${t}.`;
    if (preset === "read-write") return `Can read, write and delete items in ${t}.`;
    return `Can read items from ${t}.`;
  },
};
