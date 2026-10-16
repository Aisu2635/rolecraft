import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { roleModelSchema, type RoleModel } from "./model";

const MAX_ENCODED_LENGTH = 100_000;
const HASH_PREFIX = "#s=";

export function encodeModel(m: RoleModel): string {
  return compressToEncodedURIComponent(JSON.stringify(m));
}

export function decodeModel(s: string): RoleModel | null {
  if (s.length > MAX_ENCODED_LENGTH) return null;
  try {
    const json = decompressFromEncodedURIComponent(s);
    if (!json) return null;
    const result = roleModelSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function readModelFromHash(hash: string): RoleModel | null {
  return hash.startsWith(HASH_PREFIX) ? decodeModel(hash.slice(HASH_PREFIX.length)) : null;
}
