import { z } from "zod";
import { hasOnlyAllowedPolicyVariables } from "../../arn-syntax";
import type { Grant } from "../../model/model";
import type { ConditionBlock, Issue, Statement } from "../../types";
import { pascal } from "../sid";
import { KMS_KEY_RE } from "./kms-arn";
import { prefixed, stmt, type Module, type ModulePreset } from "./types";

const BUCKET_RE =
  /^(?!\d+\.\d+\.\d+\.\d+$)(?!.*\.\.)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

function hasBadChar(s: string): boolean {
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (
      ch === "*" ||
      ch === "?" ||
      ch === '"' ||
      /\s/.test(ch) ||
      c < 0x20 ||
      c === 0x7f
    ) {
      return true;
    }
  }
  return false;
}

export const s3DataSchema = z
  .object({
    bucket: z.string().regex(BUCKET_RE, "not a valid S3 bucket name"),
    prefixes: z
      .array(
        z
          .string()
          .max(1024, "prefix is too long")
          .refine(
            (p) => hasOnlyAllowedPolicyVariables(p),
            "prefix has an unsupported ${...} variable",
          )
          .refine(
            (p) => !hasBadChar(p),
            "prefix must not contain *, ?, quotes, spaces or control characters",
          ),
      )
      .min(1, "add at least one prefix")
      .max(20, "at most 20 prefixes"),
    allowNavigation: z.boolean().default(false),
    kmsKeyArn: z
      .string()
      .regex(KMS_KEY_RE, "not a valid KMS key ARN")
      .optional(),
  })
  .strict();

export type S3Data = z.infer<typeof s3DataSchema>;

const PRESETS: ModulePreset[] = [
  { id: "list", label: "list", actions: ["ListBucket"] },
  { id: "read", label: "read", actions: ["GetObject", "GetObjectVersion"] },
  {
    id: "list-read",
    label: "list + read",
    actions: ["ListBucket", "GetObject", "GetObjectVersion"],
  },
  {
    id: "write",
    label: "upload",
    actions: ["PutObject", "AbortMultipartUpload", "ListMultipartUploadParts"],
  },
  {
    id: "read-write",
    label: "read + write",
    actions: [
      "ListBucket",
      "GetObject",
      "GetObjectVersion",
      "PutObject",
      "AbortMultipartUpload",
      "ListMultipartUploadParts",
    ],
  },
  {
    id: "delete",
    label: "delete",
    actions: ["DeleteObject", "DeleteObjectVersion"],
  },
  {
    id: "upload-only",
    label: "upload only",
    actions: ["PutObject", "AbortMultipartUpload"],
  },
];

/** Strip leading "/", append "/" to non-empty prefixes lacking it; dedupe; sorted. */
function normalize(prefixes: string[]): string[] {
  const out = prefixes.map((raw) => {
    const p = raw.replace(/^\/+/, "");
    return p === "" || p.endsWith("/") ? p : `${p}/`;
  });
  return [...new Set(out)].sort();
}

/** "a/b/c/" -> "", "a/", "a/b/". */
function parents(prefix: string): string[] {
  const parts = prefix.split("/").filter((s) => s.length > 0);
  const out = [""];
  for (let i = 1; i < parts.length; i++)
    out.push(`${parts.slice(0, i).join("/")}/`);
  return out;
}

const presetActions = (preset: string): string[] =>
  PRESETS.find((p) => p.id === preset)?.actions ?? [];

const READ = ["GetObject", "GetObjectVersion"];
const WRITE = ["PutObject", "AbortMultipartUpload", "ListMultipartUploadParts"];

function build(
  grant: Grant,
  data: S3Data,
): { statements: Statement[]; issues: Issue[] } {
  const preset = grant.access.type === "preset" ? grant.access.preset : "";
  const actions = presetActions(preset);
  const sid = `S3${pascal(preset)}`;
  const bucketArn = `arn:aws:s3:::${data.bucket}`;
  const issues: Issue[] = [];
  let prefixes = normalize(data.prefixes);
  const whole = prefixes.includes("");
  if (whole) {
    const dropped = prefixes.filter((p) => p !== "");
    if (dropped.length > 0) {
      issues.push({
        id: "I_S3_PREFIX_SUBSUMED",
        severity: "info",
        grantId: grant.id,
        message: `Because the whole bucket is included, the folder${dropped.length > 1 ? "s" : ""} ${dropped.join(", ")} ${dropped.length > 1 ? "are" : "is"} already covered and left out.`,
      });
    }
    prefixes = [""];
  }

  if (prefixes.some((p) => p.includes("${aws:username}"))) {
    issues.push({
      id: "W_S3_USERNAME_VAR",
      severity: "warning",
      grantId: grant.id,
      message:
        "${aws:username} only works when this policy is attached to an IAM user or group. For roles (EC2, Lambda, GitHub, SSO), use ${aws:userid} or ${aws:PrincipalTag/<key>} instead.",
    });
  }

  const statements: Statement[] = [];
  const canList = actions.includes("ListBucket");
  const objectActions = actions.filter((a) => a !== "ListBucket");

  if (canList) {
    const condition: ConditionBlock | undefined = whole
      ? undefined
      : {
          StringLike: {
            "s3:prefix": [
              ...new Set(prefixes.flatMap((p) => [p, `${p}*`])),
            ].sort(),
          },
        };
    statements.push(
      stmt(
        `${sid}List`,
        prefixed("s3", ["ListBucket"]),
        [bucketArn],
        condition,
      ),
    );
  }
  if (objectActions.length > 0) {
    statements.push(
      stmt(
        `${sid}Objects`,
        prefixed("s3", objectActions),
        prefixes.map((p) => `${bucketArn}/${p}*`),
      ),
    );
  }
  if (canList && data.allowNavigation && !whole) {
    const nav = [...new Set(prefixes.flatMap(parents))].sort();
    statements.push(
      stmt(`${sid}Navigate`, prefixed("s3", ["ListBucket"]), [bucketArn], {
        StringEquals: { "s3:prefix": nav, "s3:delimiter": ["/"] },
      }),
    );
  }
  if (data.kmsKeyArn !== undefined) {
    const reads = objectActions.some((a) => READ.includes(a));
    const writes = objectActions.some((a) => WRITE.includes(a));
    const kms = [
      ...(reads || writes ? ["Decrypt"] : []),
      ...(writes ? ["GenerateDataKey"] : []),
    ];
    if (kms.length > 0) {
      statements.push(
        stmt(`${sid}Kms`, prefixed("kms", kms), [data.kmsKeyArn]),
      );
    }
  }
  return { statements, issues };
}

function explain(grant: Grant, data: S3Data): string {
  const preset = grant.access.type === "preset" ? grant.access.preset : "";
  const actions = presetActions(preset);
  const prefixes = normalize(data.prefixes);
  const list = actions.includes("ListBucket");
  const read = actions.some((a) => READ.includes(a));
  const write = actions.some((a) => WRITE.includes(a));
  const del = actions.some((a) => a.startsWith("Delete"));

  const where = (): string => {
    if (prefixes.includes("")) return `the whole bucket ${data.bucket}`;
    const head = prefixes.slice(0, -1).join(", ");
    const names =
      prefixes.length > 1
        ? `${head} and ${prefixes[prefixes.length - 1] as string}`
        : (prefixes[0] as string);
    return `${names} of ${data.bucket}`;
  };
  if (write && !list && !read && !del) {
    return `Can upload files to ${where()} (cannot list or download).`;
  }
  const verbs = [
    ...(list ? ["list"] : []),
    ...(read ? ["download"] : []),
    ...(write ? ["upload"] : []),
    ...(del ? ["delete"] : []),
  ];
  const joined =
    verbs.length > 1
      ? `${verbs.slice(0, -1).join(", ")} and ${verbs[verbs.length - 1] as string}`
      : (verbs[0] as string);
  return `Can ${joined} files in ${where()}.`;
}

export const s3Module: Module<S3Data> = {
  id: "s3",
  service: "s3",
  label: "Amazon S3",
  presets: PRESETS,
  dataSchema: s3DataSchema,
  build: (grant, data) => build(grant, data),
  explain,
};
