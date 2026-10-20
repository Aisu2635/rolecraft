# Pre-launch hardening backlog

Items parked by plan final reviews. All must be resolved (or explicitly waived by the owner) before the LinkedIn launch.

**Status: closed (Plan 5, 2026-10-20).** Every item below is done (commit), waived (ruling from the Plan 5 "Triage of the backlog" table in `2026-10-19-plan-5-prelaunch-hardening.md`) or moved to milestone 8.

## From Plan 2
- L_QUALIFIED_ONLY and the Logs bare-ARN info use exact string membership; use globMatch so `*` / `function:*` count as covering the bare ARN (false advisory today). — **Done** in f71c129.
- L_SENSITIVE: add Write/Tagging-level escalation actions — iam:AddRoleToInstanceProfile, iam:UploadSSHPublicKey, iam:ResetServiceSpecificCredential, iam:TagRole, iam:TagUser. — **Done** in f71c129.
- L_PASSROLE_STAR: also treat `arn:aws:iam::<acct>:role*`, `arn:*`, `arn:aws:iam::*:*/*` as broad. — **Done** in f71c129, with wildcard partition/account probes in 2689375.
- EC2 tags preset: use `ForAllValues:StringNotEqualsIgnoreCase` for the aws:TagKeys guard. — **Done** in f71c129.
- Suppress the Logs bare-ARN info for Logs-module statements (noise). — **Done** in f71c129.
- Plan 2 doc line 193: explain() shape is now `{can:{grantId,text}[], cannot}`. — **Done** in f71c129.

## From Plan 1 (deferred minors still open)
- See docs/superpowers/plans/2026-10-16-plan-1-ledger.md "minor (deferred)" lines marked can-wait. — **Closed**, per group:
  - GitHub link placeholder `https://github.com/`: **done** in 10ee7bc.
  - Search aliases ("Simple Storage" → S3): **done** in 26acb89.
  - Sync fetch timeout / 4xx retry / delete-before-write / duplicate keys / url validation; zod Properties strictness: **done** in 4697d8a and c50c7fa (fail-closed access flags followed in 56a7bb9).
  - No react-hooks ESLint rules: **done** in 9f20a7c (rules-of-hooks as error; exhaustive-deps off).
  - Favicon, logo renderToStaticMarkup, NUL byte in policy.ts: **done** before Plan 5 ("Already fixed (verified 2026-10-19). Close.").
  - Landing og:image: **moved** to milestone 8 ("Waive to milestone 8 (launch polish owns the OG image)").
  - Test-hygiene minors (weak assertions, tie test, console.log in perf tests, `void _ctx`, formatting, missing trailer, magic numbers): **waived** — "Waive: test- or style-only, no user impact. Ruling recorded."
  - Core semantics minors (partial wildcards in region/account, condition values must be strings, single-object Statement rejected, private globMatch duplicate in arn.ts): **waived** — "Waive: the validator stays strict. Being stricter than AWS can reject an unusual input, but it never produces a failing export."

## From Plan 3
- Add a CI job that applies every export case with AWS CLI v2 + moto + an EKS stub (bash, pwsh, terraform apply) and diffs IAM state across formats — catches runtime/argparse/cross-format drift that static Layer-4 tools miss. — **Done** in 509ea43 (`.github/workflows/apply-exports.yml`, `scripts/apply-exports.sh`); its first run found that the CLI scripts' managed policy had no description, fixed in 5d1b198.
- EKS access-entry retry in bash/PS: retry only on "invalid principal" (IAM propagation) so permanent errors fail fast. — **Done** in 83fbe43.
- PowerShell: guard the retry against `$PSNativeCommandUseErrorActionPreference` / ISE stderr-as-error (e.g. scope `$ErrorActionPreference = 'Continue'` around the attempt). — **Done** in 83fbe43.
- check_cli: undefined-variable check inside PowerShell `@"…"@` and unquoted bash heredoc bodies. — **Done** in 2b3ac67 and 8f525c7 (formatting 8f097f4).
- Lazy-load `yaml` and `fflate` on Export (Plan 4 UI) to keep the initial bundle small. — **Done** in Plan 4 ("Already done in Plan 4 (separate `yaml-*.js`, `fflate-*.js` chunks; check-bundle guards it). Close.").


## From Plan 4
- Export Reload ignores `syncHash`'s returned status: an edit under 300 ms before Reload that tips the role over the link limit reloads without the too-large warning. Return before reload when the status is "too-large". — **Done** in 1aec350.
- S3 "Add prefix" on a new grant (default `[""]`) gives `["", ""]` and shows "Folder 1 is empty"; start new rows non-blank or drop the default row on add. — **Done** in cea0d87.
- An explicit `"/"` beside other prefixes still widens to the whole bucket with only an info note; consider a warning. — **Done** in f71c129 (`W_S3_PREFIX_ROOT`).
- Per-keystroke performance: derive once at the Builder (context/store), memoise `ServiceList`, hoist `exportAll` out of per-tab bodies. — **Done** in 7f731bd.
- The Review step shows each error three times (field, Review list, output list). — **Done** in 861c165.
- A generic grant on a module service (`{service:"s3"}` without `module`) shows blank in Grid. — **Done** in ded2e4a.
- Build an ARN fills Account with `*` permanently; hint when no account ID is set yet. — **Done** in 15ab040.
- The step heading focused on navigation is visually hidden, so sighted keyboard users see no focus ring. — **Done** in 9ce329a.
- Redeploy failure count is per `useExporters` instance (a tab and the modal count separately). — **Done** in 1aec350.
- E2E: add GitHub trust, inline mode and IAM-user principal flows (goldens exist); watch `layout.spec` float equality on CI. — **Done** in 2f3ebf8 (1 px layout tolerance).
- The rest of Plan 4's can-wait minors: docs/superpowers/plans/2026-10-18-plan-4-ledger.md ("minor (deferred)" lines). — **Waived** — "Waive: reviewed as can-wait in the Plan 4 final review."

## Added in the Plan 5 triage
- Landing: preview card light in dark mode; footer raw ISO date; S3 snippet shows only `reports/*`. — **Done** in 820c435 (footer month table in 359f470).
