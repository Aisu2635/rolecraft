# Plan 3 — handoff to cloud session (2026-10-18)

**Plan:** docs/superpowers/plans/2026-10-17-plan-3-exporters.md · **Spec:** docs/superpowers/specs/2026-10-16-rolecraft-design.md
**Branch:** `feat/plan-3-exporters` (pushed). Base for the plan: `2f4b10c` (main).

## Task status
| Task | Status | Commits |
|---|---|---|
| 1 Export framework, quoting, reference cases | ✅ complete, reviewed (1 fix round) | 2f4b10c..3412aeb |
| 2 AWS CLI bash | ✅ complete, reviewed (1 fix round) | 3412aeb..10b4b78 |
| 3 AWS CLI PowerShell | ✅ complete, reviewed (1 fix round) | 10b4b78..5886c23 |
| 4 Terraform | ✅ complete, reviewed (1 fix round) | 5886c23..63b8b41 |
| 5 CloudFormation | ✅ complete, reviewed (1 fix round + controller wording fix) | 63b8b41..3650f33 |
| 6 README, ZIP, exportAll | ✅ complete, reviewed (1 fix round) | 3650f33..48d5fa4 |
| 7 Layer-4 CI tooling | ✅ complete, reviewed (2 fix rounds); GitHub Actions "Export tooling" green | 48d5fa4..08736a7 |
| Final whole-branch review + one fix wave | ✅ review (Opus 5.5) → fix wave → re-verified Ready; CI green (run 39085949796) | 08736a7..79dc8ee |

## Rulings already made (binding — they refine the plan text)
| Rows | Produces / consumes | Finding |
|---|---|---|
| T1→T2..T6 | ExportInput, exportable, shQuote/psQuote/hclString/tfLabel, REFERENCE_CASES | consistent |
| T2 self | EKS step only for role trust; group trust comment | consistent (doc updated 6970118) |
| T4/T5 self | EKS access entry for principal/group trust not addressed | Ruling: Terraform/CFN skip EKS access entry for principal trust and emit a comment (same wording as bash) — EKS access entries can't target IAM groups — cost: none |
| T1 self | explain() shape {can:{grantId,text}[],cannot} | consistent (doc updated) |
| T7 self | "confirm workflow passes on GitHub (gh run watch)" — remote agent may lack gh auth | Ruling: remote agent pushes; controller verifies the Actions run locally with gh — cost: none |
| T6→T7 | exportAll, REFERENCE_CASES | consistent |


### Execution-time rulings and findings
- Task 1: Ruling: fold in minors — tfLabel("") → "r", unconditional policy validation in cases.test (+ trust null for s3-group), extra quoting tests (shQuote "", newline, backtick; hclString "$${x}"; tfLabel mid-uppercase) — cost: none
- Task 2: review → Approved; Ruling: fold in reliability minors (they cause real failures): EKS for principal user trust creates access entry with arn:aws:iam::<acct|$ACCOUNT_ID>:user/<name> (groups unsupported → comment); `aws iam wait role-exists` before EKS steps; EKS comment notes cluster auth mode API/API_AND_CONFIG_MAP; `export AWS_PAGER=""` at top; create-role/create-access-entry output to /dev/null — same rules carried into Task 3 (PowerShell) — cost: none
- Task 2: minor (deferred): trust.json/policy.json written to cwd (mktemp + trap); old CLI builds need --thumbprint-list (comment)
- Task 2: minor (deferred): no snapshot for user-trust EKS path; PRINCIPAL_ARN hardcodes aws partition (v1 is aws-only)
- Task 3: Ruling: PowerShell output is pure ASCII — JSON in here-strings has non-ASCII chars escaped as \uXXXX (semantically identical JSON; test JSON.parse equality with stringifyPolicy instead of byte equality), header em dash → "-"; no BOM (BOM breaks clipboard paste) — works for download and paste — cost: JSON in .ps1 differs byte-wise from policy.json when non-ASCII present
- Task 3: Ruling: fold in M1 (--no-cli-pager on every aws call in PS; env var deletion on Windows), M2 OIDC check treats "None" as absent in both bash and PS, M6 $PWD.ProviderPath — cost: none
- Task 3: minor (deferred): PowerShell ISE stderr note for docs; header comes after EAP lines
- Ruling (revised after user showed Cloud session credits: $100 included, $57 left, expires 2026-11-05, applied to cloud sessions before plan usage): run remaining Plan 3 implementers + reviewers as remote cloud agents (briefs referenced from repo plan file + rulings inline); local session only coordinates — cost if wrong: credit spent faster; user monitors balance

## Cross-cutting conventions established in Tasks 1–3 (keep consistent in 4–7)
- Exporters mirror the same branches: role trust / principal group / principal user / null trust (comment-only); managed vs inline; managedPolicyArns; EC2 instance profile; GitHub OIDC provider (check-before-create in scripts, commented block in Terraform/CFN); EKS (role → wait/depends_on then access entry + AmazonEKSViewPolicy cluster scope + comment about API/API_AND_CONFIG_MAP auth mode; principal user → access entry for the user ARN; principal group → comment "EKS access entries can't target IAM groups. Ask the cluster admin to add an access entry for each user, or use a role instead.").
- Snapshots in `src/core/export/__snapshots__/<case>/` via `toMatchFileSnapshot`, LF endings (`.gitattributes`), read every snapshot by eye.
- Every model value quoted with the helpers in `src/core/export/types.ts` (`shQuote`, `psQuote` [escapes Unicode quotes], `hclString`, `tfLabel`).
- PowerShell output is pure ASCII (non-ASCII JSON escaped `\uXXXX`), `--no-cli-pager` on every aws call.
- Commit author `-c user.name="Om Hinge" -c user.email="om.hinge.2635@gmail.com"`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Cloud session 2026-10-18 — Tasks 4–7, final review, fix wave

Layer-4 tools installed and run in the cloud container (Ubuntu 24.04): shellcheck 0.9.0, PowerShell 7.4.6 + PSScriptAnalyzer 1.25.0 (incl. PS 5.1/7 compatibility rules), Terraform 1.9.8 (hashicorp/aws latest-in-range and 5.81.0), cfn-lint 1.57.2, botocore 1.43.114 CLI model checker, PyYAML round-trip, ruff. Final state on 79dc8ee: `scripts/check-exports.sh` exit 0 on 16 cases (7 reference + 9 variants) + derived github-oidc case; 325 aws commands match the CLI model; 4165 tests, src/core 100% lines / 97.82% branches. The final reviewer additionally applied every case with AWS CLI v2 + moto + an EKS stub (bash = PowerShell state everywhere; Terraform = bash for non-EKS).

### Execution-time rulings and findings (this session)
- Task 4: review → Changes required (I1 no provider region / model.region ignored; I2 provider >= 5.0 too loose) → fixed in 63b8b41 → re-review Approved. terraform fmt/init/validate (1.9.8, aws 6.69.1; EKS/GitHub cases also at 5.81.0) pass on all 7 cases.
- Task 4: Ruling: always emit provider "aws" — model.region if set; no region + EKS resources → `variable "region"` (no default, apply prompts); otherwise us-east-1 with "IAM is global" comment — without a region the provider fails at plan and EKS hits the wrong region — cost if wrong: users relying on AWS_REGION for EKS are prompted (Minor, noted)
- Task 4: Ruling: aws provider `>= 5.81, < 7.0` — EKS access entry 5.33, IAM-propagation retries 5.35/5.37, optional OIDC thumbprint 5.81; no v6-only per-resource region — cost if wrong: users pinned below 5.81 must upgrade
- Task 4: Ruling: principal-user EKS ARN looked up (`data "aws_iam_user"`; bash/PS `aws iam get-user --query User.Arn`) instead of built from account id — correct for pathed users and any partition (closes Task 2 deferred partition minor) — cost if wrong: applier needs iam:GetUser
- Task 4: Ruling: shared src/core/export/eks.ts for EKS helpers/comments; hclString maps \b/\f to \u0008/\u000c; GitHub OIDC comment adds depends_on hint — cost: none
- Task 4: Ruling: new reference case `eks-user` (principal user deploy-bot, role name deploy-bot-kubectl, cluster prod, region eu-west-1) so Layer-4 tools cover the principal-user EKS branch — cost: none
- Task 4: Ruling (implementer): Terraform data-source label tfLabel(trust.name); principal-group + EKS without region gets us-east-1 (no EKS resources there) — cost: label rename
- Task 4: minor (deferred to final wave/README): region variable description should mention -var / TF_VAR_region; README lists permissions needed to apply (iam:GetUser etc.)
- Task 5: Ruling: CloudFormation YAML serialized as YAML 1.1 so yes/no/on/off/octal-like/date-like/numeric strings are quoted — CloudFormation's parser follows 1.1 semantics; a 1.2 emitter would leave `on`/`yes` unquoted and CFN would read booleans — cost: none
- Task 5: Ruling: principal trust + managedPolicyArns → commented `aws iam attach-<kind>-policy` commands in the template header (comment-only file when no resource remains) — CloudFormation cannot attach an existing managed policy to a group/user it doesn't own — cost: one manual step for that case
- Task 5: Ruling: principal inline → AWS::IAM::GroupPolicy/UserPolicy; principal-user EKS PrincipalArn via Fn::Join with AWS::Partition/AccountId + comment for pathed users (CFN can't look users up) — cost: pathed users must edit the ARN
- Task 5: Ruling: deploy line uses a real, valid stack name derived from model.name (^[a-zA-Z][-a-zA-Z0-9]*$) and --region when model.region set; EKS without region → "deploy in the cluster's region" comment — a `<name>` placeholder pasted into bash is a redirection error — cost: none
- Task 5: Ruling: GitHub trust → commented AWS::IAM::OIDCProvider snippet + DependsOn hint (not created by default per Review Focus 3) — cost: none
- Task 5 (implementer, 9c8bb32): Ruling: `<<` and `=` always double-quoted, merge tag off; strings with control chars/U+2028/2029/BOM etc. double-quoted with \uXXXX; header comment values sanitized ("?" for line breaks); aliasDuplicateObjects:false (cfn-lint W1101 caught anchors for multi-cluster PrincipalArn); logical ids Role/Policy/InlinePolicy/InstanceProfile/EksAccessEntryN; Description "RoleCraft: …"; stack name from cfnStackName never quoted, region shQuoted; no InstanceProfileArn/role PolicyArn outputs — cost: cosmetic
- Task 5: review → Changes required (I1 position-based EKS ids break redeploys; I2 stack-name collisions can replace/delete another role; I3 re-deploy exits 255 on empty changeset; I4 IAM propagation before EKS access entry) → fix round.
- Task 5: Ruling: stable per-cluster ids in CloudFormation AND Terraform (cluster-name based + FNV-1a 8-hex suffix when sanitized) — EKS allows one entry per principal/cluster, so position-based ids conflict on reorder/removal — cost: id change vs earlier unreleased snapshots only
- Task 5: Ruling: cfnStackName appends FNV-1a hash when the name was altered — app_reader/app-reader must never share a stack — cost: less pretty stack names for non-conforming role names
- Task 5: Ruling: deploy line uses --no-fail-on-empty-changeset; header explains delete-stack after a failed first deploy (ROLLBACK_COMPLETE) — cost: none
- Task 5: Ruling: EKS access entries DependsOn every IAM resource + "invalid principal → delete stack and redeploy" comment; CFN handler retry behaviour unverified → Layer 6 must cover eks-kubectl via CloudFormation — cost if wrong: first deploy may need one retry
- Task 5: Ruling: comment-only CFN files say "Do not deploy this file."; Task 6 README must not show the deploy command for them; Task 7 adds a PyYAML round-trip check — cost: none
- Task 5 fix (93391e0, implementer): Ruling: DependsOn lists every IAM resource except Role (implicit via GetAtt; explicit triggers cfn-lint W3005); omitted when no IAM resource exists; full delete-stack command once in header; first-letter uppercasing counts as alteration → hash (keeps prod/Prod distinct); shortHash over UTF-8 bytes — cost: slightly less readable logical ids
- Task 5: re-review Approved. Controller folded in re-review Minor 1: "invalid principal" hint says redeploy, delete only after a failed first deploy — deleting after a failed update deletes an in-use role — cost: none. Accepted (no change): theoretical id collision with a cluster literally named like another's hashed form (needs adversarial name + 32-bit match).
- Task 6: Ruling: README "How to apply" uses real file names per case, PowerShell Unblock-File/ExecutionPolicy note (Windows blocks downloaded scripts), Terraform region prompt/-var/TF_VAR_region note, CloudFormation deploy command from shared helper (never shown for comment-only templates), EKS auth-mode note — cost: none
- Task 6: Ruling: README lists permissions needed to apply, derived from the branches each exporter uses — reviewers flagged iam:GetUser etc. as new requirements — cost: list must be maintained with exporters
- Task 6: Ruling: ZIP mtime new Date(2020,0,1) (local) — fflate uses local getters, so the plan's UTC date gives TZ-dependent bytes; .sh entries 0755 — cost: none
- Task 6: Ruling: exportAll omits policy.json when result.policy is null (managed-ARN-only) — cost: none
- Task 6 (dc0d275, implementer): Ruling: principal trust README headings "What this policy allows"; create-once note varies by what the script actually does; permissions layout one bullet per format (CFN omitted when comment-only); markdown escaping of model/explainer text; extra README notes (PS 5.1 no &&, keep tfstate, GitHub OIDC provider must exist, EKS region); managed ARNs listed under can-do; ZIP modes 0o100755/0o100644 — cost: copy edits
- Task 6: review → Changes required (I1 "delete first" advice can't succeed — DeleteConflict / leftover policy, instance profile, access entry; I2 OIDC provider permissions missing). Verified: AddRoleToInstanceProfile requires iam:PassRole (API reference); ZIP identical across 5 TZs.
- Task 6: Ruling: keep the plan's verbatim create-once sentence and follow it with a per-shape cleanup command list (detach/delete policy, instance profile, EKS access entry, then role) — the sentence alone leads to a failing re-run — cost: longer README
- Task 6: Ruling: exportAll reason "Add a permission before exporting." when nothing is exportable but no errors exist; "Fix the errors before exporting." otherwise — plan's single reason was misleading for empty models — cost: none
- Task 6: Ruling: README markdown escaping trims and escapes `_` only at word boundaries — readable raw files, still no structure/HTML/link injection — cost: none
- Task 6 fix (48d5fa4, implementer): Ruling: README cleanup commands are bash only, policy ARN from sts get-caller-identity (aws partition as in v1 scripts); principal cleanup removes only what blocks a re-run; GitHub OIDC provider never deleted (shared by other roles) — cost: PowerShell-only users translate the cleanup
- Task 6: re-review Approved (cleanup commands checked against botocore + bash -n/shellcheck). Deferred to final wave: "(AWS CloudShell or WSL work)" + "NoSuchEntity for never-created resources is fine" README lines; vite coverage exclude for __snapshots__.
- Task 7: Ruling: tooling also exports ~5 variant cases (src/core/export/__fixtures__/variants.ts) covering branches the 7 reference cases miss — reviews found branch-specific bugs only extra configs exposed — cost: slightly longer CI
- Task 7: Ruling: check_cli.py checks .sh, .ps1 and README bash blocks, aws calls in any command position (incl. $(…), if !), value types, and `cloudformation deploy` against a documented allow-list (CLI customization, not in botocore) — cost: none
- Task 7: Ruling: scripts/check_cfn_yaml.py PyYAML round-trip of templates vs policy.json/trust.json (Task 5 M4) — cost: none
- Task 7: Ruling: Terraform validated twice in CI — latest provider and pinned lower bound 5.81.0 — the constraint promises both work — cost: CI minutes
- Task 7: Ruling: workflow also triggers on push to feat/** and workflow_dispatch so the branch run can be verified before a PR exists; checks live in scripts/check-exports.sh so local and CI run the same thing — cost: CI minutes
- Task 7: Ruling: PSAvoidUsingWriteHost fixed in the exporter (Write-Output), not suppressed — cost: none
- Task 7 (d5d978e, e22a739): tools found 24 PSAvoidUsingWriteHost + SC2034/PSUseDeclaredVarsMoreThanAssignments (unused ROLE_NAME in managed-ARN-only principal / null-trust scripts) — fixed in exporters with tests. GitHub Actions "Export tooling" run 39071769986 on e22a739: success (check step 4m08s).
- Task 7 (implementer): Ruling: sixth variant user-managed-only (only comment-only template + exposed unused-var bug); PowerShell checks in scripts/check-powershell.ps1 (avoids SC2016); pins PSScriptAnalyzer 1.25.0, pyyaml 6.0.3, cfn-lint 1.57.2, botocore 1.43.114; check_cli also checks README inline spans with flags and template.yaml comment commands, sh/bash/shell fences, waiters/pagination/--output/file:// existence; terraform runs on copies under tmp/tfcheck — cost: manual version bumps
- Task 7: review → Changes required (I1 check_cli silent skips — case arm, heredoc marker in string, function body, backticks, env prefix; I2 README bash blocks not shellchecked; I3 PS 5.1 compatibility promised by README but unchecked; I4 uncommented OIDC path never tool-checked; I5 no CLI-equivalent value validation). Mutation harness: ~25 mutations already caught.
- Task 7: Ruling: check_cli fails loudly on any aws-looking line it couldn't parse, on unterminated heredocs, and validates params with botocore.validate.validate_parameters after substituting literal script assignments — the regression net must never silently pass — cost: possible false positives that block CI until fixed
- Task 7: Ruling: README sh blocks shellchecked; PSUseCompatibleSyntax/Commands for 5.1+7 and ASCII-only .ps1 check; derived github-oidc case (mechanically uncommented) through terraform + cfn-lint; terraform validate warnings fail; per-case expected file set from a manifest; pinned shellcheck/PSScriptAnalyzer/ruff; plugin cache cached; ec2-inline variant — cost: CI minutes
- Task 7: Accepted (no change): PR from feat/** runs export tooling twice (push + PR); PowerShell command extraction stays hand-written (pwsh AST optional)
- Task 7: container restart killed the fix implementer mid-work; a fresh implementer verified and committed the partial work as bfde738 (no exporter change needed: no export trips PS 5.1/7 compatibility rules). 31 mutations all fail check-exports.sh.
- Task 7 (implementer): Ruling: README fences shellchecked one file each (each fence is self-contained); TF plugin cache key = hash(terraform.ts)+ISO week (resolved version unknown before init); PSUseCompatibleCommands profiles WinServer2019 5.1 / 7.0 Windows / 7.0 Ubuntu; shellcheck 0.9.0 tarball sha256 pinned — cost: stale cache costs only download time
- Task 7: GitHub Actions Export tooling run 39078245236 on bfde738: success (pinned shellcheck sha256 verified in CI).
- Task 7: re-review of bfde738 → one Important (typo'd/undefined PowerShell variable passes every check → partial apply or policy named "-policy"). Ruling: check_cli reports never-assigned variable references in PowerShell and bash (allow-listed automatic/env vars), matches aws.exe/quoted aws, checks `cat <<EOF | bash` bodies and README prose commands, drops conditionally/scoped-reassigned names to dynamic, counts uncompilable model patterns — cost: possible false positives that fail CI loudly
- Task 7 (08736a7, implementer): Ruling: names assigned anywhere in the file count as assigned (order-insensitive; bash set -u still catches use-before-assign at runtime); extended automatic-variable allow-lists; ${X:-…} forms not references; inline README spans/template comments excluded from undefined-var check; conditionally reassigned literals become dynamic (not validated) — cost: a conditionally assigned bad literal isn't value-checked
- Task 7: re-review of 08736a7 Approved (28 reviewer mutations behave as expected); CI run 39081063989 success. Minor (deferred): undefined vars in PS @"…"@ and unquoted bash heredoc bodies not checked by check_cli (exporters use neither).
- Final review: Ruling: run on Opus 5.5 — Fable 5.1 (attempted as most capable) returned 'requires usage credits' (HTTP 429) — cost if wrong: a stronger model might find more
- Final review (Opus 5.5, on 08736a7) → Changes required. End-to-end harness (AWS CLI v2 + moto + EKS stub): bash = PowerShell state for all 14 cases, Terraform = bash for non-EKS. Important: I1 user/group inline limits (2,048/5,120) not enforced; I2 >10 managed attachments accepted; I3 duplicate ARNs (CFN E3037); I4 no EKS access-entry retry in scripts; I5 names starting with "-" break argparse (verified).
- Final wave: Ruling: fix validator gaps I1–I3 in this branch (Layer-1 code outside the exporter diff) — the failure surfaces in this branch's exports; spec §11 already says max 10 managed policies — cost: users with a raised 20-policy quota are blocked at 10
- Final wave: Ruling: `--flag=value` for name-valued flags in scripts and README instead of rejecting leading "-" — IAM allows such names and principals may already exist — cost: snapshot churn
- Final wave: Ruling: bounded retry (≈6×10 s) around create-access-entry in bash/PS; region preflight for EKS without model.region; GitHub account preflight (scripts) + Terraform precondition + CFN comment; ARN-derived Terraform managed-attachment labels; README min CLI version, EKS view bullet, CRLF note, CloudShell/WSL + NoSuchEntity notes; eslint forbids node builtins in src/core; coverage excludes snapshots — cost: none
- Final wave: Ruling: defer the moto-based end-to-end CI job (reviewer prototype found I5) to the hardening backlog — too large for the single fix wave — cost if wrong: runtime/argparse/cross-format drift bugs can still pass Layer 4 until it lands
- Final wave (62da8ee, 47ead3f, de14f0c, 79dc8ee; implementer): Ruling: I1 via policyLimit(mode, trust) keeping E_POLICY_TOO_LARGE (managed 6,144; inline role 10,240 / group 5,120 / user 2,048); I2 checked in generate() (only it knows whether a managed policy is generated), same 10 for users/groups; I3 V_DUPLICATE_MANAGED_POLICY_ARN per later duplicate — cost: issue ordering
- Final wave (implementer): Ruling: EKS create-access-entry retried 6×10 s on any failure (exact propagation error code unconfirmed offline) — cost: non-transient errors reported ~50 s later
- Final wave (implementer): Ruling: `--flag=value` for every variable/name-derived flag (PS "--x=$Var", literals '--x=lit'), incl. README cleanup and template attach comments; check_cli reads --flag="$X" and rejects separate values starting with "-", allows `aws configure get region|output` and `aws --version`; variants dash-role-eks / dash-user-eks — verified with AWS CLI v2 + moto (bash, pwsh, all 3 PSNativeCommandArgumentPassing modes) — cost: none
- Final wave (implementer): Ruling: README requires AWS CLI ≥ 2.15.38 (EKS access entries 2.15.3/botocore 1.34.3; ThumbprintList optional 2.15.38/botocore 1.34.83, verified from botocore wheels + changelogs) — cost: some users upgrade unnecessarily
- Final wave (implementer): Ruling: region preflight only when access entries are created and model.region unset; Terraform managed labels <label>_managed_<policy name> + hash of ARN; GitHub account check in scripts + Terraform precondition, CFN comment only; sts:GetCallerIdentity listed though it needs no permission; eslint forbids node builtins + process/require/Buffer/__dirname in non-test src/core — cost: longer TF labels

### Open (Minor, not blocking — carried to hardening backlog)
- EKS create-access-entry retry fires on any error, so non-transient failures (entry exists, cluster not found, wrong auth mode) surface after ~50 s; optional: retry only on "invalid principal".
- PowerShell 5.1 ISE / redirected stderr, or a profile setting $PSNativeCommandUseErrorActionPreference, can turn the first failed aws attempt into a terminating error (skips retry); README uses `-File`.
- Terraform managed-attachment labels almost always carry a hash (AWS names are mixed case) — cosmetic.
- check_cli does not check undefined variables inside PS `@"…"@` or unquoted bash heredoc bodies (exporters use neither).
- Deferred: moto-based end-to-end CI job (reviewer prototype found the leading-dash bug); yaml/fflate bundle size → lazy-load on Export (Plan 4); bash/PS exporter duplication accepted.
- Plan 3 remote-agent ruling: the GitHub Actions run was verified with the GitHub MCP tools (no local gh needed).

