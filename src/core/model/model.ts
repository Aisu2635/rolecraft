import { z } from "zod";
import { ACCESS_LEVELS, type AccessLevel } from "../types";

export type Trust =
  | { kind: "service"; service: "ec2" | "lambda" | "ecs-tasks" }
  | {
      kind: "github";
      owner: string;
      repo: string;
      ref: { type: "branch" | "tag" | "environment" | "pull_request"; value?: string };
    }
  | { kind: "account"; accountId: string; externalId?: string; requireMfa?: boolean }
  | { kind: "principal"; target: "group" | "user"; name: string };
export type Scope =
  | { type: "all" }
  | { type: "arns"; arns: string[] }
  | { type: "module"; data: unknown };
export type AccessSelection =
  | { type: "levels"; levels: AccessLevel[] }
  | { type: "actions"; actions: string[] }
  | { type: "preset"; preset: string };
export interface Grant {
  id: string;
  service: string;
  module?: string;
  scope: Scope;
  access: AccessSelection;
}
export interface RoleModel {
  version: 1;
  name: string;
  partition: "aws";
  accountId?: string;
  region?: string;
  trust: Trust;
  grants: Grant[];
  policyMode: "inline" | "managed";
  managedPolicyArns: string[];
}

const str = z.string().max(2048);

const trustSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("service"), service: z.enum(["ec2", "lambda", "ecs-tasks"]) }).strict(),
  z
    .object({
      kind: z.literal("github"),
      owner: str,
      repo: str,
      ref: z
        .object({
          type: z.enum(["branch", "tag", "environment", "pull_request"]),
          value: str.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("account"),
      accountId: str,
      externalId: str.optional(),
      requireMfa: z.boolean().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("principal"), target: z.enum(["group", "user"]), name: str }).strict(),
]);

const scopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }).strict(),
  z.object({ type: z.literal("arns"), arns: z.array(str).max(200) }).strict(),
  z.object({ type: z.literal("module"), data: z.unknown() }).strict(),
]);

const accessSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("levels"),
      levels: z.array(z.enum(ACCESS_LEVELS as readonly [AccessLevel, ...AccessLevel[]])),
    })
    .strict(),
  z.object({ type: z.literal("actions"), actions: z.array(str).max(500) }).strict(),
  z.object({ type: z.literal("preset"), preset: str }).strict(),
]);

const grantSchema = z
  .object({
    id: str,
    service: str,
    module: str.optional(),
    scope: scopeSchema,
    access: accessSchema,
  })
  .strict();

export const roleModelSchema: z.ZodType<RoleModel> = z
  .object({
    version: z.literal(1),
    name: str,
    partition: z.literal("aws"),
    accountId: str.optional(),
    region: str.optional(),
    trust: trustSchema,
    grants: z.array(grantSchema).max(100),
    policyMode: z.enum(["inline", "managed"]),
    managedPolicyArns: z.array(str),
  })
  .strict();

export function createEmptyModel(): RoleModel {
  return {
    version: 1,
    name: "rolecraft-role",
    partition: "aws",
    trust: { kind: "service", service: "ec2" },
    grants: [],
    policyMode: "managed",
    managedPolicyArns: [],
  };
}

export function newGrantId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += (b % 36).toString(36);
  return "g_" + s;
}
