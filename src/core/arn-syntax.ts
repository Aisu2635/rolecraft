const MAX_ARN_LENGTH = 2048;
const POLICY_VARIABLE =
  /\$\{(?:aws:(?:username|userid|PrincipalAccount|SourceIdentity|principaltype)|aws:PrincipalTag\/[^}\s"\\$]+|\*|\?|\$)\}/g;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\s\u0000-\u001f\u007f"\\]/;

/** True when `arn` is a syntactically valid IAM policy Resource ARN (partition aws), ignoring service semantics. */
export function isValidArnSyntax(arn: string): boolean {
  if (arn.length > MAX_ARN_LENGTH || !arn.startsWith("arn:")) return false;
  if (FORBIDDEN_CHARS.test(arn)) return false;
  const plain = arn.replace(POLICY_VARIABLE, "V");
  if (plain.includes("${")) return false;
  const parts = plain.split(":");
  if (parts.length < 6) return false;
  if (parts[1] !== "aws" && parts[1] !== "*") return false;
  return parts.slice(5).join(":").length > 0;
}

/** True when every "${" in `s` begins a complete, allowed IAM policy variable. */
export function hasOnlyAllowedPolicyVariables(s: string): boolean {
  return !s.replace(POLICY_VARIABLE, "V").includes("${");
}
