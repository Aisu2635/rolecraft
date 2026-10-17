# Plan 3 — handoff to cloud session (2026-10-18)

**Plan:** docs/superpowers/plans/2026-10-17-plan-3-exporters.md · **Spec:** docs/superpowers/specs/2026-10-16-rolecraft-design.md
**Branch:** `feat/plan-3-exporters` (pushed). Base for the plan: `2f4b10c` (main).

## Task status
| Task | Status | Commits |
|---|---|---|
| 1 Export framework, quoting, reference cases | ✅ complete, reviewed (1 fix round) | 2f4b10c..3412aeb |
| 2 AWS CLI bash | ✅ complete, reviewed (1 fix round) | 3412aeb..10b4b78 |
| 3 AWS CLI PowerShell | ✅ complete, reviewed (1 fix round) | 10b4b78..5886c23 |
| 4 Terraform | ⚠️ implemented (c7bdf80), **review NOT done** — terraform fmt/validate never run (no terraform on the Windows machine). Start here: install Terraform, review, fix. | 5886c23..c7bdf80 |
| 5 CloudFormation | ⬜ not started | |
| 6 README, ZIP, exportAll | ⬜ not started | |
| 7 Layer-4 CI tooling | ⬜ not started | |
| Final whole-branch review + one fix wave | ⬜ | |

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
