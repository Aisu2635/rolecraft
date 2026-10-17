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
