import { z } from "zod";
import type { Grant } from "../../model/model";
import { pascal } from "../sid";
import { prefixed, stmt, type Module, type ModulePreset } from "./types";

export const logsDataSchema = z
  .object({
    logGroup: z
      .string()
      .regex(/^[.\-_/#A-Za-z0-9]{1,512}$/, "not a valid log group name"),
    createGroup: z.boolean().default(true),
  })
  .strict();

export type LogsData = z.infer<typeof logsDataSchema>;

/** Every action here is authorized on log-group:<name>:* */
const WRITE = ["CreateLogStream", "PutLogEvents"];
const READ = [
  "DescribeLogStreams",
  "FilterLogEvents",
  "GetLogEvents",
  "StartLiveTail",
];

const PRESETS: ModulePreset[] = [
  { id: "write", label: "write", actions: [...WRITE, "CreateLogGroup"] },
  { id: "read", label: "read", actions: [...READ, "DescribeLogGroups"] },
  {
    id: "read-write",
    label: "read + write",
    actions: [...WRITE, "CreateLogGroup", ...READ, "DescribeLogGroups"],
  },
];

const presetOf = (grant: Grant): string =>
  grant.access.type === "preset" ? grant.access.preset : "";

export const logsModule: Module<LogsData> = {
  id: "logs",
  service: "logs",
  label: "Amazon CloudWatch Logs",
  presets: PRESETS,
  dataSchema: logsDataSchema,
  build: (grant, data, _svc, ctx) => {
    const preset = presetOf(grant);
    const sid = `Logs${pascal(preset)}`;
    const writes = preset === "write" || preset === "read-write";
    const reads = preset === "read" || preset === "read-write";
    const group = `arn:aws:logs:${ctx.region ?? "*"}:${ctx.accountId ?? "*"}:log-group:${data.logGroup}`;
    const actions = [
      ...(writes ? [...WRITE, ...(data.createGroup ? ["CreateLogGroup"] : [])] : []),
      ...(reads ? READ : []),
    ];
    return {
      statements: [
        stmt(`${sid}Group`, prefixed("logs", actions), [`${group}:*`]),
        ...(reads
          ? [stmt(`${sid}List`, ["logs:DescribeLogGroups"], ["*"])]
          : []),
      ],
      issues: [],
    };
  },
  explain: (grant, data) => {
    const preset = presetOf(grant);
    const g = `the log group ${data.logGroup}`;
    if (preset === "write") return `Can write log events to ${g}.`;
    if (preset === "read-write") return `Can read and write log events in ${g}.`;
    return `Can read log events from ${g}.`;
  },
};
