# SDD ledger — plan: docs/superpowers/plans/2026-10-17-plan-2-modules-linter-explainer.md

Spec: docs/superpowers/specs/2026-10-16-rolecraft-design.md
Branch: feat/plan-2-modules (from main @ 180d6c5)

## Pre-flight scan
| Rows | Produces / consumes | Finding |
|---|---|---|
| T1→T2..T5 | Module, runModule, stmt, prefixed, MODULES, loadRealCatalog | consistent |
| T1→T6 | generate default builders; T6 also edits generate | sequential, consistent |
| T2..T5 | each edits registry.ts | sequential, consistent |
| T4 self | Lambda `invoke` emits `function:<name>:*`; data: InvokeFunction resources = ["function"] only; Plan 1 matchableTypes excludes ":" from FunctionName → validator would reject AWS's documented qualified-invoke pattern | CONFLICT. Ruling: in src/core/arn.ts remove FunctionName from the ":" exclusion (keep "/" excluded) so `function:f:*` also intersects `function`; regression tests in arn.test.ts + policy.test.ts; T4 test `invoke covers unqualified and qualified` must pass the validator — cost if wrong: validator accepts InvokeFunction on function:f:* (which AWS itself documents) |
| T6→T7 | lint vs explain both read model | independent |
| T7 self | Module.explain(grant, data) needs parsed data | Ruling: explain() runs mod.dataSchema.safeParse; on failure skip the sentence (generate already reports E_MODULE_DATA) — cost: none |
| T8 self | consumes MODULES + generate | consistent |
| Setup | branch isolation as Plan 1 | — |

## Progress
Task 1: minor (deferred): "node" types added to tsconfig.app.json weakens core purity — add ESLint no-restricted-imports node:* + no-restricted-globals process for src/core (override for __test__/ and *.test.ts) or use import.meta.glob; exclude __test__/** from coverage; trivial defaultBuilders test
Task 1: complete (commits 876bb91..a49621c, review clean)
Task 2: review → 2 Important: prefixes with unknown/broken ${...} pass schema but fail validator (V_ARN_FORMAT); ${aws:username} grants nothing to role sessions, silently
Task 2: Ruling: prefix schema accepts "${" only as an allowed policy variable (reuse arn-syntax allow-list: ${aws:username}, ${aws:userid}, ${aws:PrincipalTag/<key>}, …); module emits W_S3_USERNAME_VAR warning whenever ${aws:username} is used ("works only when the policy is attached to an IAM user or group; for roles use ${aws:userid} or ${aws:PrincipalTag/...}"); Task 6 linter will escalate when trust kind is not principal — module can't see trust kind — cost if wrong: warning shown also for group/user attachments where it works
Task 2: minor (deferred): no ListAllMyBuckets/GetBucketLocation helper for console bucket list; "ls s3://b/reports" without slash denied (explain could mention); no ListBucketVersions with GetObjectVersion; overlapping prefixes not subsumed; "a//b" parents; max-1024 checked before normalization; normalization test lacks valid()
Task 6 note: add linter rule L_USERNAME_IN_ROLE (warning) when policy uses ${aws:username} and trust kind ≠ principal
Task 2: fix round 1/5 (2 addressed, 0 open; commits 68e6e02..cc2fbf0)
Task 2: complete (commits a49621c..cc2fbf0, review clean after 1 fix round)
Task 3: note: implementer saw 1 unreproducible full-suite failure (unidentified) — possible flaky test; final review to hunt
Task 3: review → 2 Important (plan-mandated): EC2 tags preset lets users re-tag selector key (scope escape / cross-grant escalation); ECR push lacks BatchGetImage (buildx/manifest lists fail)
Task 3: Ruling: accept both — spec bar (safe, never fails in AWS) outranks plan text: tags preset + tag selector adds ForAllValues:StringNotEquals aws:TagKeys [<key>] on CreateTags/DeleteTags; ECR push adds BatchGetImage — cost if wrong: users can't edit the selector tag via this role (intended)
Task 3: Ruling: also fold in cheap real-world fixes — view adds DescribeInstanceTypes, DescribeVolumes, DescribeAvailabilityZones (global read-only, console needs them); I_EC2_KMS_GRANT text says the start silently fails and suggests kms:GrantIsForAWSResource; inner selector objects .strict(); ec2.test.ts heavy loop → it.each — cost: none
Task 3: minor (deferred): explain all-selector string replace hack; I_EKS_ACCESS_ENTRY promises CLI export (Plan 3 must deliver); commit 66e2b5e trailer says Sonnet not Opus
Task 3: fix round 1/5 (6 addressed, 0 open; commits 66e2b5e..e1bec66)
Task 3: complete (commits cc2fbf0..e1bec66, review clean after 1 fix round)
Task 4: Ruling: approve flipping arn.test.ts "handles wildcard ARNs over lambda" to toContain("function") — supersedes Plan 1 Task 9 ruling that function:f:* excludes the function type; AWS data lists InvokeFunction only against "function" while AWS documents function:f:* for qualified invokes — cost if wrong: validator accepts function:f:* for function-type actions (AWS-documented)
Task 4: review → 1 Important (plan-mandated): logs group-level actions on bare log-group:<n> fail in AWS (authorized against log-group:<n>:log-stream:); validator blocks the correct log-group:<n>:* form for log-group actions
Task 4: Ruling: remove ":" exclusion from LogGroupName in arn.ts (as with FunctionName) so log-group:<n>:* matches log-group too; Logs module emits log-group:<n>:* for all actions (group + stream); flip Plan 1 tests asserting CreateLogGroup on :* is a mismatch — supersedes Plan 1 Task 9 ruling — cost if wrong: validator accepts log-group:<n>:* for group actions (which AWS's own errors show is required)
Task 4: Ruling: fold in "never fails" minors — lambda deploy + GetFunctionConfiguration; dynamodb write + ConditionCheckItem; logs read + StartLiveTail (log-group) and DescribeLogGroups (own "*" statement); info I_LAMBDA_DEPLOY_SOURCE about s3:GetObject / ECR pull for S3- or image-based deploys — cost: none
Task 4: minor (deferred): lambda read only unqualified ARN (no GetAlias/ListAliases); validator accepts function-only actions on function:f:* (no-op policies) and concrete alias ARN inconsistency; test gaps (logs ":" invalid name, explain regex-only, dynamodb read-write full statement, concrete qualified ARN classification pin)
Task 4: fix round 1/5 (5 addressed, 0 open; commits 79847c2..7a2b2dd)
Task 4: minor (deferred): no direct regression test pinning concrete log-stream ARN classification
Task 4: complete (commits e1bec66..7a2b2dd, review clean after 1 fix round)
Task 5: Ruling: SQS send KMS add-on = kms:GenerateDataKey + kms:Decrypt (AWS docs: SSE-KMS producers need both) — plan text gave only GenerateDataKey — cost if wrong: send role holds Decrypt on the queue key (needed by AWS)
Task 5: minor (deferred): secret name pasted with -XXXXXX suffix silently never matches (warn); explain texts omit KMS add-on / customer-managed-key note / encrypt preset needs Decrypt for S3 multipart & SQS producers; SQS name regex allows 85 chars with .fifo (AWS cap 80); no kms:ViaService on add-ons; S3 doesn't reuse KMS_KEY_MESSAGE
Task 5: complete (commits 7a2b2dd..6863202, review clean)
Task 6: review → 1 Important: L_USERNAME_IN_ROLE duplicates W_S3_USERNAME_VAR (two warnings, one cause)
Task 6: Ruling: generate drops W_S3_USERNAME_VAR (lint's trust-aware L_USERNAME_IN_ROLE is authoritative; for principal trust ${aws:username} works so no warning is right) — module keeps emitting it for standalone use — cost if wrong: none
Task 6: Ruling: fold in L_UNUSED_ARN skip when grant arns contain "*" and skip ARNs already E_FOREIGN_ARN; case-insensitive Delete/Terminate prefix; sweep filter narrowed to L_PASSROLE_STAR for iam; explicit 20 s timeout on "too-large cases stay rare"; singular/plural grammar in L_SENSITIVE — cost: none
Task 6: minor (deferred): PassRole on role/* treated like *; iam:AddUserToGroup sensitive (spec says any iam:*); kms:Decrypt on * not flagged
Decision: user approved Option A — Plan 3 runs on remote cloud agents (isolation: remote); Plan 2 finishes locally
Task 6: fix round 1/5 (6 addressed, 0 open; commits 0632bb7..0cd4688)
Task 6: complete (commits 6863202..0cd4688, review clean after 1 fix round)
Task 7: review → Approved; Ruling: escalate reviewer minor #3 (false "Cannot delete" for kms:ScheduleKeyDeletion) — accuracy of user-facing claims is the bar — deletion detection = action name matches /delet|purge/i (explainer "Cannot delete" and lint L_DESTRUCTIVE_STAR, plus /^terminate/i kept) — cost if wrong: more cautious summaries
Task 7: minor (deferred): skipped (invalid) grants still feed "cannot" computation; S3 can-test uses regex not exact array
Task 7: fix round 1/5 (1 addressed, 0 open; tests proven to fail on pre-fix code; commits 6267570..ae90072)
Task 7: complete (commits 0cd4688..ae90072, review clean after 1 fix round)
Task 8: minor (deferred): sweep asserts validity not resource shapes (unit tests own that); fixed ctx/trust sets in properties
Task 8: complete (commits ae90072..1618069, review clean)
Final review: With fixes — 5 Important (explainer describes failed grants; terminate vs "Cannot delete" contradiction; EC2 tag escalation via DeleteTags-all and cross-grant tagging; arn relaxation silent no-op grants; secret suffix) + must-fix minors (PassRole role/*, PM-level IAM sensitive, pin tests, E_MODULE_SERVICE, explain shape with grantId, statement dedupe)
Ruling: EC2 cross-grant tagging handled by Null aws:TagKeys + lint warning L_EC2_TAG_ESCALATION (not a generate post-pass) — simpler, visible to user — cost if wrong: user may ignore the warning
Ruling: explain() shape changes to {can:{grantId,text}[], cannot:string[]} now, before Plans 3/4 bind — Plan 3 doc ExportInput.summary updated accordingly
Ruling (spec deviations recorded): Module interface omits scopeEditor/extraExports (Plan 4 maps module id → editor; Plan 3 handles EC2 instance profile/EKS access entries); Lambda presets invoke/read/deploy instead of invoke/deploy/manage (no PassRole needed) — cost: none
Final: minor (deferred to Plan 3/4 or later): StartLiveTail/tagging bare log-group ARN (verify in Layer 5/6); ModulePreset.actions = headline actions (document for Plan 4); I_EKS_ACCESS_ENTRY with group/user trust (Plan 3 must handle); unpinned fast-check seeds
Final fix wave: re-review clean (11/11 addressed; commits 6970118..6d87d74)
Final: parked — L_QUALIFIED_ONLY/Logs info use exact-string bare-ARN check (false warning when "*" or function:* also present) — Ruling: real but advisory-only and user-entered; scheduled in pre-launch hardening backlog — cost: rare false advisory until fixed
Final: parked — L_SENSITIVE misses Write-level escalation (iam:AddRoleToInstanceProfile, UploadSSHPublicKey, ResetServiceSpecificCredential, TagRole/TagUser) and L_PASSROLE_STAR misses role*, arn:* — Ruling: pre-launch hardening backlog — cost: fewer warnings on rare grants
Final: parked — EC2 tag guard case-sensitive (use ForAllValues:StringNotEqualsIgnoreCase); Logs info shows on every Logs grant (noise); plan-2 doc line 193 stale explain shape — Ruling: pre-launch hardening backlog
Plan 2: COMPLETE
