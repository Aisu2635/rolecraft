/** A concrete KMS key ARN (no wildcards, no aliases). Shared by every module that takes a key. */
export const KMS_KEY_RE = /^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[A-Za-z0-9-]+$/;
export const KMS_KEY_MESSAGE = "not a valid KMS key ARN";
