# Pre-launch hardening backlog

Items parked by plan final reviews. All must be resolved (or explicitly waived by the owner) before the LinkedIn launch.

## From Plan 2
- L_QUALIFIED_ONLY and the Logs bare-ARN info use exact string membership; use globMatch so `*` / `function:*` count as covering the bare ARN (false advisory today).
- L_SENSITIVE: add Write/Tagging-level escalation actions — iam:AddRoleToInstanceProfile, iam:UploadSSHPublicKey, iam:ResetServiceSpecificCredential, iam:TagRole, iam:TagUser.
- L_PASSROLE_STAR: also treat `arn:aws:iam::<acct>:role*`, `arn:*`, `arn:aws:iam::*:*/*` as broad.
- EC2 tags preset: use `ForAllValues:StringNotEqualsIgnoreCase` for the aws:TagKeys guard.
- Suppress the Logs bare-ARN info for Logs-module statements (noise).
- Plan 2 doc line 193: explain() shape is now `{can:{grantId,text}[], cannot}`.

## From Plan 1 (deferred minors still open)
- See docs/superpowers/plans/2026-10-16-plan-1-ledger.md "minor (deferred)" lines marked can-wait.

## From Plan 3
- Add a CI job that applies every export case with AWS CLI v2 + moto + an EKS stub (bash, pwsh, terraform apply) and diffs IAM state across formats — catches runtime/argparse/cross-format drift that static Layer-4 tools miss.
- EKS access-entry retry in bash/PS: retry only on "invalid principal" (IAM propagation) so permanent errors fail fast.
- PowerShell: guard the retry against `$PSNativeCommandUseErrorActionPreference` / ISE stderr-as-error (e.g. scope `$ErrorActionPreference = 'Continue'` around the attempt).
- check_cli: undefined-variable check inside PowerShell `@"…"@` and unquoted bash heredoc bodies.
- Lazy-load `yaml` and `fflate` on Export (Plan 4 UI) to keep the initial bundle small.

