const BASE_OPERATORS = new Set([
  "StringEquals",
  "StringNotEquals",
  "StringEqualsIgnoreCase",
  "StringNotEqualsIgnoreCase",
  "StringLike",
  "StringNotLike",
  "NumericEquals",
  "NumericNotEquals",
  "NumericLessThan",
  "NumericLessThanEquals",
  "NumericGreaterThan",
  "NumericGreaterThanEquals",
  "DateEquals",
  "DateNotEquals",
  "DateLessThan",
  "DateLessThanEquals",
  "DateGreaterThan",
  "DateGreaterThanEquals",
  "Bool",
  "BinaryEquals",
  "IpAddress",
  "NotIpAddress",
  "ArnEquals",
  "ArnLike",
  "ArnNotEquals",
  "ArnNotLike",
  "Null",
]);

export function isKnownConditionOperator(op: string): boolean {
  let rest = op;
  if (rest.startsWith("ForAllValues:")) rest = rest.slice("ForAllValues:".length);
  else if (rest.startsWith("ForAnyValue:")) rest = rest.slice("ForAnyValue:".length);
  if (rest.endsWith("IfExists")) {
    rest = rest.slice(0, -"IfExists".length);
    if (rest === "Null") return false;
  }
  return BASE_OPERATORS.has(rest);
}

/** Entries ending in "/" are prefixes (a non-empty suffix is required). */
export const GLOBAL_CONDITION_KEYS: readonly string[] = [
  "aws:CalledVia",
  "aws:CalledViaFirst",
  "aws:CalledViaLast",
  "aws:CurrentTime",
  "aws:EpochTime",
  "aws:FederatedProvider",
  "aws:MultiFactorAuthAge",
  "aws:MultiFactorAuthPresent",
  "aws:PrincipalAccount",
  "aws:PrincipalArn",
  "aws:PrincipalIsAWSService",
  "aws:PrincipalOrgID",
  "aws:PrincipalOrgPaths",
  "aws:PrincipalServiceName",
  "aws:PrincipalServiceNamesList",
  "aws:PrincipalTag/",
  "aws:PrincipalType",
  "aws:Referer",
  "aws:RequestedRegion",
  "aws:RequestTag/",
  "aws:ResourceAccount",
  "aws:ResourceOrgID",
  "aws:ResourceOrgPaths",
  "aws:ResourceTag/",
  "aws:SecureTransport",
  "aws:SourceAccount",
  "aws:SourceArn",
  "aws:SourceIdentity",
  "aws:SourceIp",
  "aws:SourceOrgID",
  "aws:SourceOrgPaths",
  "aws:SourceVpc",
  "aws:SourceVpce",
  "aws:TagKeys",
  "aws:TokenIssueTime",
  "aws:UserAgent",
  "aws:userid",
  "aws:username",
  "aws:ViaAWSService",
  "aws:VpcSourceIp",
  "aws:Ec2InstanceSourceVpc",
  "aws:Ec2InstanceSourcePrivateIPv4",
];

/** Extra keys that only make sense in a role trust policy. */
export const TRUST_CONDITION_KEYS: readonly string[] = [
  "sts:ExternalId",
  "sts:RoleSessionName",
  "sts:SourceIdentity",
  "token.actions.githubusercontent.com:aud",
  "token.actions.githubusercontent.com:sub",
];

function matchesAny(key: string, entries: readonly string[]): boolean {
  const k = key.toLowerCase();
  return entries.some((e) => {
    const lower = e.toLowerCase();
    return e.endsWith("/") ? k.startsWith(lower) && k.length > lower.length : k === lower;
  });
}

export function isGlobalKey(key: string): boolean {
  return matchesAny(key, GLOBAL_CONDITION_KEYS);
}

export function isTrustKey(key: string): boolean {
  return isGlobalKey(key) || matchesAny(key, TRUST_CONDITION_KEYS);
}

const TEMPLATE_START = /\$\{|</;

/**
 * Whether a concrete condition key matches a catalog key, which may be a
 * template such as `aws:RequestTag/${TagKey}` or `s3:ExistingObjectTag/<key>`.
 * Comparison is case-insensitive; a template needs a non-empty suffix.
 */
export function keyMatchesTemplate(key: string, template: string): boolean {
  const k = key.toLowerCase();
  const idx = template.search(TEMPLATE_START);
  if (idx < 0) return k === template.toLowerCase();
  const prefix = template.slice(0, idx).toLowerCase();
  return k.startsWith(prefix) && k.length > prefix.length;
}
