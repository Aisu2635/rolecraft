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


## From Plan 4
- Export Reload ignores `syncHash`'s returned status: an edit under 300 ms before Reload that tips the role over the link limit reloads without the too-large warning. Return before reload when the status is "too-large".
- S3 "Add prefix" on a new grant (default `[""]`) gives `["", ""]` and shows "Folder 1 is empty"; start new rows non-blank or drop the default row on add.
- An explicit `"/"` beside other prefixes still widens to the whole bucket with only an info note; consider a warning.
- Per-keystroke performance: derive once at the Builder (context/store), memoise `ServiceList`, hoist `exportAll` out of per-tab bodies.
- The Review step shows each error three times (field, Review list, output list).
- A generic grant on a module service (`{service:"s3"}` without `module`) shows blank in Grid.
- Build an ARN fills Account with `*` permanently; hint when no account ID is set yet.
- The step heading focused on navigation is visually hidden, so sighted keyboard users see no focus ring.
- Redeploy failure count is per `useExporters` instance (a tab and the modal count separately).
- E2E: add GitHub trust, inline mode and IAM-user principal flows (goldens exist); watch `layout.spec` float equality on CI.
- The rest of Plan 4's can-wait minors: docs/superpowers/plans/2026-10-18-plan-4-ledger.md ("minor (deferred)" lines).
