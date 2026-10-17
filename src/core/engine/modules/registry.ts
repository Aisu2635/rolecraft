import type { GrantBuilder } from "../../generate";
import { ec2Module } from "./ec2";
import { ecrModule } from "./ecr";
import { eksModule } from "./eks";
import { s3Module } from "./s3";
import { runModule, type Module } from "./types";

/** Registered smart modules, keyed by module id. Later tasks add entries. */
export const MODULES: Record<string, Module> = {
  s3: s3Module as Module,
  ec2: ec2Module as Module,
  ecr: ecrModule as Module,
  eks: eksModule as Module,
};

export function defaultBuilders(): Record<string, GrantBuilder> {
  const out: Record<string, GrantBuilder> = {};
  for (const [id, mod] of Object.entries(MODULES)) {
    out[id] = (grant, svc, ctx) => runModule(mod, grant, svc, ctx);
  }
  return out;
}
