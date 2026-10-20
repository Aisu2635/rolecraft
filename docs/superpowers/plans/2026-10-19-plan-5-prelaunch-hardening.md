# Plan 5 — Pre-launch Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close or explicitly waive every item in `docs/superpowers/plans/hardening-backlog.md`, so RoleCraft can launch. Templates and phone handling (milestone 7) follow in Plan 6.

**Architecture:** These are targeted fixes inside the existing layers. Core lint and module semantics live in `src/core`. The exported script hardening lives in `src/core/export` plus `scripts/check_cli.py`. The UI fixes live in `src/ui`/`src/state`, and the data-sync robustness work lives in `scripts/sync-aws-data.ts`. The last task adds one new CI job that applies the exports against a local AWS emulator (moto), so no AWS account is needed.

**Tech Stack:** TypeScript strict, React 19, Cloudscape, Zustand 5, Vite, Vitest, Playwright, Python 3 (check scripts), GitHub Actions, moto server.

**Spec:** docs/superpowers/specs/2026-10-16-rolecraft-design.md

## Global Constraints

- Branch `feat/plan-5-templates`, cut from `main` after PR #3. Its name predates the split, so keep it; Plan 6 continues on it. Push after every task. Never force-push or touch `main`.
- The core promise: generated policies, scripts and templates never fail when applied, and they stay least-privilege.
- **UI never builds JSON itself; only `core/` does.**
- `src/core/**` stays pure (ESLint-enforced).
- Any change under `src/core/export` or `src/core/engine` must pass `npm run export-fixtures`.
- Reference snapshots stay byte-identical unless the task says they change. When a task changes them, regenerate them and say so in the commit body.
- Gates before every commit:
  - `npm test -- --coverage` (src/core ≥ 95% lines and branches)
  - `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check-bundle`
  - for any UI task: `E2E_PORT=4187 npm run e2e` (local ports 4173/4174 are held by other processes; don't kill them)
- Lazy export rules from Plan 4 hold: `yaml` and `fflate` stay out of the initial bundle, and the ESLint import guard stays.
- No `dangerouslySetInnerHTML`, inline scripts or `eval`. Every icon-only button has an `aria-label`. No emojis.
- UI copy is short, plain English. Error text says what to do.
- Strict TDD: write a failing test first, see it fail, then fix.
- Never run prettier over existing files. Match neighbouring style (~120-col lines).
- Commits: `git -c user.name="Om Hinge" -c user.email="om.hinge.2635@gmail.com" commit -m "<msg>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- <explicit paths>`.
- Record every decision the plan leaves open as `Ruling: <decision> — <why> — <cost if wrong>` in `docs/superpowers/plans/2026-10-19-plan-5-ledger.md`.

## Review Focus

1. **A lint change that silences a real risk.** Widening globMatch use must never hide L_SENSITIVE or L_PASSROLE_STAR on a genuinely broad grant. Test both directions: broad still flagged, narrow not flagged.
2. **The EC2 tag-key guard switching to IgnoreCase.** It must still block re-tagging the selector key in any letter case (`Team`, `team`, `TEAM`), and the reference exports must still validate.
3. **EKS retry narrowed to "invalid principal" only.** A permanent error, such as a cluster that doesn't exist or AccessDenied, must fail fast with a non-zero exit. A propagation error must still retry. Assert both in the generated script text and in the Task 7 emulator run.
4. **Shared redeploy state.** After a failure in the Export modal and a failure in a tab, the second failure overall shows Reload. A success anywhere resets it.
5. **Derive-once refactor.** Every panel must still update on each edit. A stale memo that shows the previous policy is the failure to watch for. E2E typing flows cover this.

---

## Triage of the backlog

Each item is either assigned to a task or waived with a ruling. Waivers also go into the ledger.

| Backlog item | Decision |
|---|---|
| P2 L_QUALIFIED_ONLY / Logs bare-ARN info exact match → globMatch | Task 1 |
| P2 L_SENSITIVE extra escalation actions | Task 1 |
| P2 L_PASSROLE_STAR broader patterns | Task 1 |
| P2 EC2 tags guard IgnoreCase | Task 1 |
| P2 suppress Logs bare-ARN info on Logs-module statements | Task 1 |
| P2 doc line 193 explain() shape | Task 1 |
| P4 explicit "/" beside other prefixes → warning | Task 1 |
| P3 EKS retry only on invalid principal | Task 2 |
| P3 PowerShell retry vs `$PSNativeCommandUseErrorActionPreference` | Task 2 |
| P3 check_cli undefined variables in heredoc / `@"…"@` bodies | Task 2 |
| P3 lazy-load yaml/fflate | Already done in Plan 4 (separate `yaml-*.js`, `fflate-*.js` chunks; check-bundle guards it). Close. |
| P3 moto/EKS-stub apply CI job | Task 7 |
| P4 Reload ignores syncHash status | Task 3 |
| P4 S3 Add prefix on default `[""]` | Task 3 |
| P4 Review shows each error three times | Task 3 |
| P4 generic grant on module service blank in Grid | Task 3 |
| P4 Build an ARN `*` account hint | Task 3 |
| P4 step heading focus invisible | Task 3 |
| P4 redeploy count per hook instance | Task 3 |
| P4 per-keystroke performance | Task 4 |
| P4 E2E GitHub trust / inline / IAM user; layout float equality | Task 5 |
| P1 GitHub link placeholder `https://github.com/` | Task 6 |
| P1 search aliases ("Simple Storage" → S3) | Task 6 |
| P1 sync fetch timeout / 4xx retry / delete-before-write / duplicate keys / url validation; zod Properties strictness | Task 6 |
| P1 no react-hooks ESLint rules | Task 6 (rules-of-hooks as error; exhaustive-deps off) |
| Landing: preview card light in dark mode; footer raw ISO date; S3 snippet shows only `reports/*` | Task 6 |
| P1 favicon, logo renderToStaticMarkup, NUL byte in policy.ts | Already fixed (verified 2026-10-19). Close. |
| Landing og:image | Waive to milestone 8 (launch polish owns the OG image) |
| P1 test-hygiene minors (weak assertions, tie test, console.log in perf tests, `void _ctx`, formatting, missing trailer, magic numbers) | Waive: test- or style-only, no user impact. Ruling recorded. |
| P1 core semantics minors (partial wildcards in region/account, condition values must be strings, single-object Statement rejected, private globMatch duplicate in arn.ts) | Waive: the validator stays strict. Being stricter than AWS can reject an unusual input, but it never produces a failing export. |
| P4 can-wait minors in the Plan 4 ledger not listed above | Waive: reviewed as can-wait in the Plan 4 final review. |

---

### Task 1: Core lint and module precision

**Files:**
- Modify: `src/core/lint/lint.ts`, `src/core/engine/modules/ec2.ts`, `src/core/engine/modules/s3.ts`, `docs/superpowers/plans/2026-10-17-plan-2-modules-linter-explainer.md` (line ~193 only)
- Test: `src/core/lint/lint.test.ts`, `src/core/engine/modules/ec2.test.ts`, `src/core/engine/modules/s3.test.ts`

**Interfaces:**
- Produces: a new issue id `W_S3_PREFIX_ROOT` (severity `warning`), emitted by s3 when `"/"` (or any prefix that normalises to the bucket root) appears beside other prefixes. Message: "Folder <i+1> is the whole bucket, so the other folders add nothing. Remove it to keep access to those folders only." Path: `data.prefixes[i]`. It replaces the info `I_S3_PREFIX_SUBSUMED` for that case only; other subsumption cases keep the info.

- [ ] **Step 1: Failing tests**
  - L_QUALIFIED_ONLY / Logs bare-ARN info: a resource of `arn:aws:lambda:*:*:function:*` or `*` counts as covering the bare function ARN, so no advisory is raised. An exact qualified-only resource (`function:f:1`) still raises it.
  - L_SENSITIVE: add `iam:AddRoleToInstanceProfile`, `iam:UploadSSHPublicKey`, `iam:ResetServiceSpecificCredential`, `iam:TagRole`, `iam:TagUser`. One test per action raises the issue, and `iam:ListRoles` still doesn't.
  - L_PASSROLE_STAR: `arn:aws:iam::<acct>:role*`, `arn:*`, `arn:aws:iam::*:*/*` and `arn:aws:iam::123456789012:role/*` count as broad. `arn:aws:iam::123456789012:role/app-*` does not.
  - EC2 tags preset: the CreateTags/DeleteTags guard uses `ForAllValues:StringNotEqualsIgnoreCase` with `{"aws:TagKeys": [<key>]}`.
  - The Logs bare-ARN info is not emitted for statements built by the Logs module.
  - S3: `["reports/", "/"]` gives `W_S3_PREFIX_ROOT` on `data.prefixes[1]`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/core/lint src/core/engine/modules/ec2 src/core/engine/modules/s3`. Expected: the new tests fail.
- [ ] **Step 3: Implement.** Reuse `globMatch` from `src/core/glob.ts`. Mark Logs-module statements the way the engine already tags module output; if no tag exists, use a module id on the internal statement record. Update the Plan 2 doc line so it reads `explain(): {can:{grantId,text}[], cannot}`.
- [ ] **Step 4: `npm run export-fixtures`.** EC2 reference snapshots will change (IgnoreCase). Regenerate them, check that the diff is only the operator name, and say so in the commit body. Every other snapshot stays byte-identical.
- [ ] **Step 5: Gates, then commit** (`fix(core): …`, one commit per bullet group is fine).

### Task 2: Exported-script retry precision and CLI check

**Files:**
- Modify: `src/core/export/eks.ts`, `src/core/export/cli-bash.ts`, `src/core/export/cli-ps.ts`, `scripts/check_cli.py`
- Test: `src/core/export/cli-bash.test.ts`, `src/core/export/cli-ps.test.ts`, `scripts/test_check_cli.py`

**Interfaces:**
- Consumes: `EKS_RETRY`, `EKS_RETRY_MESSAGE` from `eks.ts`.

- [ ] **Step 1: Failing tests**
  - The bash access-entry loop retries only when the captured stderr matches the EKS propagation error. Match `InvalidParameterException` together with the text `principal`, case-insensitive. Any other failure prints the error and exits non-zero at once.
  - PowerShell does the same. The attempt is wrapped so that `$PSNativeCommandUseErrorActionPreference = $true`, or stderr treated as an error, can't abort the loop. Scope it with `$ErrorActionPreference = 'Continue'` and `$PSNativeCommandUseErrorActionPreference = $false` inside a script block, and restore them after.
  - `check_cli.py` flags a reference to an undefined variable inside an unquoted bash heredoc body and inside a PowerShell `@"…"@` here-string. A quoted heredoc (`<<'EOF'`) and `@'…'@` are not expanded, so they aren't flagged. Add test cases to `scripts/test_check_cli.py`.
- [ ] **Step 2: Run and confirm they fail.** Run `npx vitest run src/core/export/cli-` and `python -m pytest scripts/test_check_cli.py` (or `python scripts/test_check_cli.py` if pytest is absent). On Windows Python may be missing locally. If so, rely on the Export tooling Actions run for the Python side and say so in the report.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm run export-fixtures`.** EKS-case snapshots change (the retry block). Regenerate them, check the diff is only the retry block, and say so in the commit body. Push, then check that the "Export tooling" Actions run on the branch passes (shellcheck, PSScriptAnalyzer, check_cli).
- [ ] **Step 5: Gates, then commit** (`fix(export): …`).

### Task 3: Builder UI correctness polish

**Files:**
- Modify: `src/ui/export/ExporterStatus.tsx`, `src/ui/export/lazy.ts`, `src/ui/builder/scope/S3ScopeEditor.tsx`, `src/state/model-ops.ts` (only if the ruling below needs it), `src/ui/builder/review/ReviewStep.tsx`, `src/ui/builder/output/OutputPanel.tsx` or `IssuesList.tsx`, `src/ui/builder/permissions/GridEditor.tsx`, `src/ui/builder/scope/ScopeEditor.tsx`, `src/ui/builder/BuilderWorkspace.tsx`, `src/ui/global.css`
- Test: the matching `*.test.tsx` files

**Interfaces:**
- Produces: the redeploy-failure state moves from per-hook to module-level in `lazy.ts`, as `{ failures: number; stale: boolean }`, shared by every `useExporters()` caller. A success anywhere resets it. Every subscriber re-renders when it changes (`useSyncExternalStore`).

- [ ] **Step 1: Failing tests, one per bullet**
  - **Reload:** when `syncHash()` returns `"too-large"`, Reload does not call `location.reload()`, and the too-large warning shows.
  - **S3 Add prefix:** with prefixes `[""]`, clicking **Add prefix** gives one empty row the user can type into, never `["", ""]`. Ruling: when the only prefix is `""`, Add prefix replaces nothing and focuses that row's input, and the row's placeholder reads "Folder, e.g. reports/". With two or more filled rows, it appends `""` as today.
  - **Review step:** an error tied to a field shows on that field and in the output panel, not in the Review step's own issues list. Path-less issues still list there. Use the count of the same error text on step 2 = 2.
  - **Grid:** a generic grant on a module service (`{service:"s3"}` without `module`) shows a read-only levels cell with its levels and a "Edit in Sentences" link. It never shows unchecked, disabled presets.
  - **Build an ARN:** when the model has no account ID, the builder shows the hint "No account ID yet, so the account is `*`. Add it on the Review step, then rebuild the ARN." under the Account field.
  - **Step heading:** focused on navigation, it is visible (not `.rc-visually-hidden`) and shows a focus ring (`:focus-visible` outline using the Cloudscape focus token).
  - **Redeploy count:** a failure in the modal followed by a failure in a tab gives `stale: true`, and both show Reload.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gates including e2e, then commit** (one commit per bullet or close group).

### Task 4: Per-keystroke performance

**Files:**
- Modify: `src/state/derive.ts`, `src/ui/builder/Builder.tsx`, `src/ui/builder/output/OutputPanel.tsx`, `src/ui/builder/permissions/PermissionsStep.tsx`, `SentenceEditor.tsx`, `GridEditor.tsx`, `src/ui/builder/sidebar/ServiceSidebar.tsx`, `src/ui/export/FormatTabs.tsx`, `src/ui/export/ExportModal.tsx`
- Test: `src/state/derive.test.ts`, `src/ui/builder/Builder.test.tsx` (or new `Builder.perf.test.tsx`), `FormatTabs.test.tsx`

**Interfaces:**
- Produces: `DerivedContext` (React context) provided once in `Builder.tsx`, and `useDerivedOutput(): Derived`, which reads it. Every former `useDerived(...)` caller inside the builder switches to it. `useDerived` stays as the internal hook that the provider calls.

- [ ] **Step 1: Failing tests.**
  - With `generate` and `explain` spied (vi.spyOn on the derive module's imports), one edit on step 1 calls each exactly once.
  - Typing one character in the sidebar search doesn't re-render the "In this role" list. Use a render counter in a test harness, or React Profiler `onRender`.
  - With the CLI tab open, one model change calls `exportAll` once.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.** Use the context for derive. Use `React.memo` on the sidebar lists with stable props. Hoist `exportAll` into one memo per model in the component that owns the tabs, and pass its files to each tab body.
- [ ] **Step 4: Gates including e2e** (Review Focus 5: typing flows must still update every panel), then commit (`perf(ui): …`).

### Task 5: E2E coverage for the remaining trust and attach flows

**Files:**
- Create: `tests/e2e/trust-flows.spec.ts`
- Modify: `tests/e2e/layout.spec.ts` (tolerance), `tests/e2e/fixtures.ts` (only if a helper is needed)

- [ ] **Step 1: Write the specs.** Each one builds its role through the UI only and asserts the exported files byte-equal the matching golden in `src/core/export/__fixtures__` (the same approach as `s3-group.spec.ts`):
  - `github-deploy`: GitHub OIDC trust, with the account ID on step 0;
  - `group-inline`: inline policy attached to a group;
  - `user-inline-eks`: an IAM-user principal.
- [ ] **Step 2: Layout tolerance.** In `layout.spec.ts`, replace exact float equality with `Math.abs(a - b) <= 1` (px).
- [ ] **Step 3: Run** `E2E_PORT=4187 npm run e2e`. Expected: every spec passes with zero console errors. A spec that exposes a real UI bug is a finding. Fix it in this task, test first.
- [ ] **Step 4: Commit** (`test(e2e): …`).

### Task 6: Launch-blocking odds and ends

**Files:**
- Modify: `src/ui/AppShell.tsx`, `src/core/catalog/curated.ts` (aliases) and the search in `src/core/catalog/catalog.ts`, `scripts/sync-aws-data.ts`, `eslint.config.*`, `package.json`, `src/ui/pages/LandingPage.tsx`, `src/ui/landing/*`
- Test: the matching tests; create `scripts/sync-aws-data.test.ts` if none exists

**Interfaces:**
- Produces: `REPO_URL = "https://github.com/Aisu2635/rolecraft"` exported from a new `src/ui/links.ts`. AppShell's GitHub link uses it. Ruling: the repo is private today, so the owner must make it public at launch, or this link 404s. Note this in the ledger as a launch-checklist item.

- [ ] **Step 1: Failing tests**
  - AppShell's GitHub link `href` equals `REPO_URL`.
  - Search: "Simple Storage" finds S3. Add `aliases: string[]` to curated entries: S3 (`"Simple Storage Service"`), EC2 (`"Elastic Compute Cloud"`), IAM (`"Identity and Access Management"`), SQS (`"Simple Queue Service"`), SNS (`"Simple Notification Service"`), RDS (`"Relational Database Service"`), EKS (`"Elastic Kubernetes Service"`), ECR (`"Elastic Container Registry"`), KMS (`"Key Management Service"`). Search matches aliases the same way it matches names.
  - Sync script:
    - each fetch aborts after 30 s (`AbortSignal.timeout(30_000)`);
    - a 4xx is not retried, while a 5xx or network error is retried as today;
    - a duplicate service key in the upstream list fails the sync with a clear message;
    - an entry `url` must be `https://servicereference.us-east-1.amazonaws.com/…`, or the sync fails;
    - new files are written to a temp dir and swapped in, and stale files are removed only after every write succeeds.
    Test these with an injected `fetch` and a temp dir.
  - Sync zod: the four `Properties` booleans and `ARNFormats` are optional with defaults (`false` / `[]`), so upstream variance doesn't abort the sync.
  - Landing:
    - the preview card follows the dark theme;
    - the footer date renders as "19 Oct 2026" (`Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })`);
    - the S3 snippet comes from the pinned engine output, so it shows both `reports/` and `reports/*`, and its existing equality test against `generate()` stays green.
- [ ] **Step 2: ESLint.** Add `eslint-plugin-react-hooks`, with `react-hooks/rules-of-hooks` as `error` and `exhaustive-deps` off. Ruling: turning exhaustive-deps on now would mean a broad churn of deps before launch. Fix any rules-of-hooks violation it finds, test first.
- [ ] **Step 3: Implement, run gates, then commit** (`fix(…)` per group).

### Task 7: Apply-every-export CI job against a local AWS emulator

**Files:**
- Create: `.github/workflows/apply-exports.yml`, `scripts/apply-exports.sh`, `scripts/iam_state.py`
- Modify: `docs/superpowers/plans/hardening-backlog.md` (mark the backlog closed with links to commits)

**Interfaces:**
- Consumes: `npm run export-fixtures` output, the reference-case export folders (see `scripts/export-fixtures.ts` for the output dir).

- [ ] **Step 1: Job.** On `ubuntu-latest`, triggered by pull_request to main and push to `feat/**`:
  - start `moto_server` (pip `moto[server]`, pinned version) on port 5000;
  - install AWS CLI v2, `pwsh` and `terraform` (pinned);
  - set `AWS_ENDPOINT_URL=http://127.0.0.1:5000`, dummy credentials and `AWS_DEFAULT_REGION=us-east-1`.
- [ ] **Step 2: Apply.** For each reference case, `scripts/apply-exports.sh` runs, against a fresh moto state (POST `/moto-api/reset`):
  - bash `create` → dump IAM state → reset;
  - pwsh → dump → reset;
  - `terraform init && apply -auto-approve`, with the AWS provider pointed at the endpoint via `endpoints { iam = … sts = … eks = … }` in a generated override file, never by editing the export → dump.
  `scripts/iam_state.py` dumps the role/user/group, its trust policy, inline and attached policies and instance profile, normalised as sorted JSON with ARNs and dates removed. The job fails if any format's dump differs from bash's, or if any apply exits non-zero.
- [ ] **Step 3: EKS cases.** If moto doesn't support `create-access-entry`, run those cases with a stub: a PATH-shadowing `aws` wrapper for bash, and a function for pwsh. The stub answers the `eks` subcommands, failing the first call with the propagation error, so the retry path runs. Every other command passes through to the real CLI. Terraform EKS resources are skipped with an explicit allow-list in the script. Ruling, recorded in the ledger: the stub tests our retry logic, not EKS.
- [ ] **Step 4: Run it.** Push and watch the Actions run until it passes. A real export defect it finds is fixed in core, test first.
- [ ] **Step 5: Close the backlog.** Mark every item in `hardening-backlog.md` as done (commit), waived (ruling) or moved (milestone 8), then commit.

---

## Added 2026-10-19 (owner feedback)

Execution order: Task 2, **Task 8**, Task 3, Task 4, **Task 9**, Task 5, Task 6, Task 7.

### Task 8: A calm first run: "to do", not red errors, for fields the user hasn't reached

**Observed (Chromium, 2026-10-19):** a fresh builder is clean. But the first click makes the output panel show red errors for empty fields the user hasn't reached:
- adding Amazon S3 shows "1 error: The Amazon S3 settings are invalid: not a valid S3 bucket name.";
- picking GitHub Actions shows "4 errors" (owner, repository, account ID, owner+repo);
- picking Another AWS account shows "1 error: Trusted account ID must be exactly 12 digits."
The fields themselves already wait for blur or reveal, but the output panel's IssuesList and StatusLine don't.

**Files:**
- Modify: `src/state/builder.ts`, `src/ui/builder/scope/shared.tsx`, `src/ui/builder/trust/TrustStep.tsx`, `src/ui/builder/review/ReviewStep.tsx`, `src/ui/builder/issues.ts`, `src/ui/builder/output/IssuesList.tsx`, `src/ui/builder/output/StatusLine.tsx`, `src/ui/builder/output/OutputPanel.tsx`, `src/ui/export/ExportModal.tsx` (blocked view)
- Test: the matching `*.test.tsx`; `tests/e2e/export-blocked.spec.ts` (extend)

**Interfaces:**
- Produces, in the store:
  - `touched: Record<string, true>`, keyed by the field's focus id (the same ids `focusIdFor` returns);
  - `touch(id: string): void`;
  - `isRevealed(id: string): boolean`, true when `revealErrors || touched[id]`.
  Per-field `useState` touched flags in shared.tsx, TrustStep and ReviewStep move to the store, so the output panel can see them. `reset()`, `replaceModel` and a trust-kind switch clear `touched` for the fields they replace.
- Produces in `issues.ts`: `splitPending(issues: Issue[], revealed: (id: string) => boolean): { pending: Issue[]; shown: Issue[] }`. An error is **pending** when it maps to a field (`focusIdFor(issue)` is non-null) and that field is not revealed. Warnings, infos and errors with no field are never pending.

- [ ] **Step 1: Failing tests**
  - Output panel: after adding S3 with no input, no `status-error` is shown. A neutral "To do" list shows "Enter the bucket name" with a Jump to link, using Cloudscape `StatusIndicator type="pending"`. The status line reads "1 to do, 0 errors, 0 warnings, 1 info".
  - After the bucket input blurs while empty or invalid, the same issue shows as a red error and the "to do" count drops.
  - GitHub Actions picked: there are 0 errors, and every trust error that maps to a field is a to-do. The owner+repo error has no path in core but maps by id to the owner field through `focusIdFor`.
  - Export while there are to-dos: Export is still blocked. The blocked modal lists them as errors, because opening the blocked view calls `revealAllErrors()`, which already exists. Jump to still works.
  - To-do text: for a pending issue whose field is empty, the panel shows a short instruction instead of the validator message. Map it from a table in `issues.ts` keyed by issue id, falling back to the core message:
    - S3 bucket: "Enter the bucket name";
    - GitHub owner: "Enter the GitHub owner";
    - GitHub repo: "Enter the repository name";
    - GitHub account / trusted account ID: "Enter the 12-digit AWS account ID";
    - generic ARN scope: "Choose which resources".
    Add entries for every id the current editors can produce on an empty field. Errors on non-empty, invalid values keep the core message.
  - Pending errors still block Copy and Export exactly as errors do today; only the presentation changes.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Gates including e2e.** Extend `export-blocked.spec.ts`: add S3, check that the panel shows "To do" and no error, click Export, and check that the blocked list shows the error.
- [ ] **Step 5: Commit** (`fix(ui): ...`).

### Task 9: First-run guided tour

**Files:**
- Create: `src/ui/builder/tour/Tour.tsx`, `src/ui/builder/tour/steps.ts`, `src/state/tour.ts`
- Modify: `src/ui/builder/Builder.tsx` (mount), `src/ui/AppShell.tsx` (a "Take the tour" item, builder route only), `tests/e2e/fixtures.ts` (preset the "seen" flag so existing specs aren't covered by the tour)
- Test: `src/ui/builder/tour/Tour.test.tsx`, `src/state/tour.test.ts`, `tests/e2e/tour.spec.ts`

**Interfaces:**
- Produces `useTourStore` with:
  - `{ open: boolean; index: number; start(): void; next(): void; back(): void; close(): void }`;
  - the persisted flag `localStorage["rolecraft.tour.v1"] = "seen"`, set on close or finish.
- `steps.ts` exports `TOUR_STEPS: { target: string; title: string; body: string }[]`. `target` is a `data-tour` attribute value added to the anchor element.

**Behaviour, with exact copy:**
- **When it auto-starts:** on the first visit to `/builder` on desktop (≥ 1024 px) when the flag is not set, **unless** the URL carries a `#s=` share link. Someone opening a shared role sees the role first, and the tour stays available from the menu.
- **What it is:** a popover card next to the highlighted region. Behind it, a dim backdrop with a cut-out around the target, drawn with a CSS outline/box-shadow on a positioned overlay, not canvas. The card has the title, the body, "1 of 5", and **Back**, **Next** (or **Done** on the last step) and **Skip tour**.
- **Keyboard and screen readers:** Esc skips. Focus moves into the card on open and returns to the previous element on close. The card is `role="dialog"` with `aria-modal="false"` and `aria-labelledby` set to the title.
- **Reduced motion:** with `prefers-reduced-motion`, there is no transition.
- **Steps (targets and copy):**
  1. `sidebar`: "Pick AWS services". "Search or browse services here. Each one you add becomes a permission you can fine-tune."
  2. `steps`: "Three steps". "Choose who can use the role, what it can do, then review and export. You can move between steps at any time."
  3. `workspace`: "Describe access in plain English". "Pick what each service may do and on which resources. Sentences and Grid are two views of the same permissions."
  4. `output`: "Your policy, live". "The policy, trust policy and scripts update as you go. Anything that still needs your input is listed here."
  5. `actions`: "Copy, export or share". "Copy the JSON, download ready-to-run scripts and templates, or share a link. Nothing leaves your browser."
- **Replay:** "Take the tour" in the top nav restarts from step 1.
- Below 1024 px the tour never shows, because the builder is replaced by the desktop-only card.

- [ ] **Step 1: Failing tests**
  - Store: `start` / `next` / `back` / `close`; `close` persists the flag; `next` on the last step closes.
  - Tour component:
    - it auto-opens only when the flag is unset and there is no `#s=` in the URL;
    - the card shows the title, the body and "1 of 5";
    - Esc closes and sets the flag;
    - focus returns to the opener;
    - all five `data-tour` targets exist in a rendered BuilderPage.
  - E2E `tour.spec.ts`:
    - a fresh context, with the flag not preset, sees the tour;
    - clicking Next 4 times then Done hides it;
    - after a reload it doesn't reappear;
    - "Take the tour" brings it back;
    - zero console errors.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.** No new dependency.
- [ ] **Step 4: Gates including e2e.** All existing specs must still pass, with the flag preset in their fixtures.
- [ ] **Step 5: Commit** (`feat(ui): first-run guided tour`).

### Task 7 addendum (2026-10-20): weekly AWS data sync workflow

Task 6 found that no workflow runs `npm run sync-data`, although the spec relies on weekly fresh data. Task 7 adds it.

**Files:**
- Create: `.github/workflows/sync-aws-data.yml`

- [ ] **Step S1: Workflow.**
  - **Triggers:** `schedule: cron "17 3 * * 1"` (Mondays 03:17 UTC) and `workflow_dispatch`.
  - **Permissions:** `contents: write`, `pull-requests: write`.
  - **Steps:**
    1. Checkout.
    2. Node 22 with npm cache, then `npm ci`.
    3. `npm run sync-data`.
    4. If `git status --porcelain public/data` is empty, stop with a notice ("AWS data unchanged").
    5. Otherwise run `npm test` and `npm run build`, so a data change that breaks the engine fails the job instead of opening a PR.
    6. Commit to branch `chore/aws-data-sync` (force-updated each week).
    7. Open or update one PR to `main`, titled "chore(data): weekly AWS data sync (<date>)". The body lists the services added, removed and changed (from `git diff --stat public/data`). Use the `gh` CLI with `GITHUB_TOKEN`; no third-party action is needed.
  - **No direct push to `main`.** Merging deploys production, so the owner merges.
  - Note in the PR body: PRs opened with `GITHUB_TOKEN` don't trigger other workflows. Say "CI for this PR runs when you push or re-run; the sync job already ran tests and build."
- [ ] **Step S2: Verify.** Push, run it once with `gh workflow run sync-aws-data.yml --ref feat/plan-5-templates`, watch it, and report the outcome: either "unchanged", or the PR URL. If it opens a PR, leave it open for the owner.
