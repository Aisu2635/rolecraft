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

/** Actions that need a log-stream resource vs a log-group resource. */
const STREAM_WRITE = ["CreateLogStream", "PutLogEvents"];
const STREAM_READ = ["GetLogEvents"];
const GROUP_READ = ["DescribeLogStreams", "FilterLogEvents"];

const PRESETS: ModulePreset[] = [
  {
    id: "write",
    label: "write",
    actions: [...STREAM_WRITE, "CreateLogGroup"],
  },
  { id: "read", label: "read", actions: [...GROUP_READ, ...STREAM_READ] },
  {
    id: "read-write",
    label: "read + write",
    actions: [...STREAM_WRITE, "CreateLogGroup", ...GROUP_READ, ...STREAM_READ],
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
    const streamActions = [
      ...(writes ? STREAM_WRITE : []),
      ...(reads ? STREAM_READ : []),
    ];
    const groupActions = [
      ...(writes && data.createGroup ? ["CreateLogGroup"] : []),
      ...(reads ? GROUP_READ : []),
    ];
    return {
      statements: [
        stmt(`${sid}Streams`, prefixed("logs", streamActions), [`${group}:*`]),
        ...(groupActions.length > 0
          ? [stmt(`${sid}Group`, prefixed("logs", groupActions), [group])]
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
