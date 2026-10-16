# RoleCraft — Design Spec

**Date:** 2026-10-16
**Owner:** Om Hinge
**URL:** https://rolecraft.omhinge.cloud
**Status:** Draft for review

---

## 1. Purpose

RoleCraft is a free, open-source, browser-only tool that lets anyone build least-privilege AWS IAM policies and roles visually, then export them as JSON, AWS CLI, Terraform or CloudFormation.

**Who it is for**
- **Public / portfolio:** visitors arriving from a LinkedIn launch post. They must understand the value in seconds and get a correct role in about a minute.
- **Daily use by the owner:** fast enough to replace hand-writing IAM JSON at work.

**Success criteria**
1. A first-time visitor can produce a correct "S3 folder read-only for a group" policy plus CLI in under 60 seconds, starting from the landing page.
2. Every one of the 456+ services in the AWS Service Reference can be added to a role.
3. Generated policies are valid IAM (correct ARNs, correct action/resource pairing, no `*` unless the action requires it) — verified by automated tests.
4. Nothing the user types ever leaves their browser.
5. Lighthouse performance ≥ 90 on the landing page (desktop).

**Problems it solves (from research)**
| Problem | How RoleCraft addresses it |
|---|---|
| Over-broad policies (`Action: *`) because scoping is hard | Scoping is the default path; `*` only when AWS requires it, and flagged |
| S3 folder trap (bucket ARN vs object ARN, `s3:prefix`) | S3 smart module writes both statements correctly |
| Loose trust policies (GitHub OIDC without `sub` restriction) | Trust builder forces repo + branch/environment |
| Long-lived access keys instead of roles | Roles/OIDC are the easy, default path |
| Forgotten EC2 instance profile | CLI/Terraform/CFN exports include it automatically |
| "What does this policy actually allow?" | Plain-English summary + "cannot" list, live |
| Format fragmentation | One model → JSON, CLI (bash + PowerShell), Terraform, CloudFormation |

---

## 2. Scope

### In scope (v1)
- Landing page, templates gallery, builder workspace.
- Wizard: **1 Trusted entity → 2 Permissions → 3 Review and export**.
- Permissions editor with **Sentences ⇄ Grid** toggle over a single model.
- Service catalog sidebar covering all services in the AWS Service Reference.
- Generic engine for every service + smart modules for S3, EC2, ECR, EKS, Lambda, DynamoDB, CloudWatch Logs, Secrets Manager, KMS, SQS.
- Trust builder: EC2, Lambda, ECS task, GitHub Actions OIDC, another AWS account, IAM group/user (no trust; policy attached directly).
- Linter (risk warnings), plain-English summary, policy size meter.
- Exports: policy JSON, trust JSON, AWS CLI (bash + PowerShell), Terraform, CloudFormation (YAML); copy, download single file, download ZIP.
- 13 templates (section 7).
- Shareable URL (state in URL hash).
- Dark theme default + light toggle.
- Phone visitors: landing + templates browsable; builder replaced by "works best on desktop" card with Copy link / Share.
- Weekly automated refresh of AWS service data.
- Deploy to Cloudflare Pages on `rolecraft.omhinge.cloud`.

### Out of scope (later phases)
- **Phase 2:** "Paste existing policy" reverse mode (import → grid + risk review); resource-based policies (S3 bucket policies, KMS key policies); SCPs; permission boundaries.
- **Phase 3:** Applying directly to an AWS account with user credentials; importing Access Analyzer generated policies; AI "describe in English" (would need a backend).
- No user accounts, no database, no backend in v1.

---

## 3. Architecture

Static single-page app. All logic runs in the browser. No server code.

```
Browser
 ├─ UI (React + Cloudscape)
 │   ├─ Landing, Templates, Builder (wizard + sidebar + editor + output)
 │   └─ reads/writes ──► RoleModel (store)
 │
 ├─ Core (pure TypeScript, no React imports — fully unit-testable)
 │   ├─ catalog/      load + query service data
 │   ├─ model/        RoleModel types, defaults, (de)serialization for share URL
 │   ├─ engine/       RoleModel → IAM policy documents
 │   │    ├─ generic.ts       any service, access levels / individual actions
 │   │    └─ modules/         s3, ec2, ecr, eks, lambda, dynamodb, logs, secretsmanager, kms, sqs
 │   ├─ trust/        RoleModel.trust → trust policy document
 │   ├─ lint/         policy + trust → warnings[]
 │   ├─ explain/      RoleModel → plain-English summary + "cannot" list
 │   ├─ export/       documents → json | cli-bash | cli-ps | terraform | cloudformation | zip
 │   └─ templates/    template definitions (data) + instantiate(template, params) → RoleModel
 │
 └─ Static data (generated at build time)
     ├─ /data/index.json          service list: key, display name, category, action count
     └─ /data/svc/<key>.json      per-service slim data, fetched on first use, cached in memory

Build / CI
  scripts/sync-aws-data.ts  ── fetch AWS Service Reference ──► data/ (committed)
  GitHub Action (weekly)    ── runs sync, commits if changed ──► Cloudflare Pages auto-deploys
```

**Data flow:** UI event → store action updates `RoleModel` → derived values recomputed with memoization: `engine(model)` → `policy`, `trust(model)` → `trustPolicy`, `lint(...)`, `explain(model)`, active export tab text. Output panel re-renders. Share URL hash updated (debounced 300 ms).

**Rule:** UI never builds JSON itself; only `core/` does. Core never touches the DOM.

---

## 4. Tech stack

| Concern | Choice |
|---|---|
| Build | Vite + TypeScript (strict) |
| UI | React 19 + **Cloudscape Design System** (`@cloudscape-design/components`, `global-styles`) — AWS-console look, built-in dark mode |
| Icons | **Phosphor Icons** (`@phosphor-icons/react`) for app/UI icons; Cloudscape built-ins inside Cloudscape components. No emojis. |
| Fonts | Open Sans (UI), JetBrains Mono (code) — self-hosted via `@fontsource` |
| State | Zustand (small store, selectors) |
| Routing | React Router — `/`, `/templates`, `/builder` |
| Code view | Lightweight highlighter (Shiki or Prism, JSON/HCL/YAML/bash/PowerShell only) |
| Share URL | `lz-string` compress model JSON → `#s=<data>` |
| ZIP | `fflate` |
| Tests | Vitest (core), Playwright (smoke e2e) |
| Analytics | Cloudflare Web Analytics (cookieless, no banner needed) |
| Hosting | Cloudflare Pages, Git-connected, custom domain `rolecraft.omhinge.cloud` |
| License | MIT |

---

## 5. Service data pipeline

**Source:** `https://servicereference.us-east-1.amazonaws.com/v1/service-list.json` and `/v1/<service>/<service>.json`.

**`scripts/sync-aws-data.ts`**
1. Fetch the service list; fetch each service JSON (concurrency 8, retry 3× with backoff).
2. Transform each into slim form:
   ```ts
   interface SlimService {
     key: string;               // "s3"  (IAM action prefix)
     name: string;              // "Amazon S3" (from curated map, else title-cased key)
     category: Category;        // curated map, else "Other"
     actions: SlimAction[];
     resources: { name: string; arnFormats: string[] }[];
   }
   interface SlimAction {
     name: string;              // "GetObject"
     level: "List" | "Read" | "Write" | "Tagging" | "Permissions management";
     resources: string[];       // resource-type names; [] means only "*" is supported
     label: string;             // "Get object" (humanized from name)
   }
   ```
3. Access level mapping (first match wins): `IsPermissionManagement` → Permissions management; `IsTaggingOnly` → Tagging; `IsWrite` → Write; `IsList` → List; otherwise Read.
4. Write `data/svc/<key>.json` and `data/index.json` (with `generatedAt` timestamp). Output deterministic (sorted keys) so diffs are meaningful.
5. Sanity check: fail if fewer than 400 services or if `s3`, `ec2`, `iam` are missing — prevents publishing a broken fetch.

**Curated metadata** (`data/curated/services.ts`): display name + category for the ~80 most-used services; everything else falls back to title-cased key and category "Other". Categories: Compute, Storage, Database, Networking, Containers, Serverless, AI/ML, Analytics, Security & Identity, Management, Developer Tools, Messaging, Other.

**Refresh:** `.github/workflows/sync-aws-data.yml` runs weekly (Mon 03:00 UTC) and on manual dispatch; commits `data/` only if changed; Cloudflare Pages rebuilds on push. Footer shows "AWS data updated <generatedAt>".

**Size:** raw EC2 is ~845 KB; slim + Brotli is expected well under 100 KB. Only `index.json` loads up front.

---

## 6. Core model and engines

### 6.1 RoleModel
```ts
interface RoleModel {
  version: 1;
  name: string;                       // "rolecraft-analytics" (validated: [\w+=,.@-]{1,64})
  partition: "aws" | "aws-cn" | "aws-us-gov";   // default "aws"
  accountId?: string;                 // optional, 12 digits; otherwise "*"/placeholder in ARNs
  region?: string;                    // optional; otherwise "*"
  trust: Trust;
  grants: Grant[];                    // one per sentence row / grid block
  policyMode: "inline" | "managed";   // default "managed" (reusable, 6,144 limit)
  managedPolicyArns: string[];        // AWS managed policies to attach as-is (e.g. AmazonSSMManagedInstanceCore); default []
}

type Trust =
  | { kind: "service"; service: "ec2" | "lambda" | "ecs-tasks" }
  | { kind: "github"; owner: string; repo: string; ref: { type: "branch" | "tag" | "environment" | "pull_request"; value?: string } }
  | { kind: "account"; accountId: string; externalId?: string; requireMfa?: boolean }
  | { kind: "principal"; target: "group" | "user"; name: string };   // no trust policy; attach to group/user

interface Grant {
  id: string;
  service: string;                    // service key, e.g. "s3"
  module?: string;                    // smart module id when applicable
  scope: Scope;                       // what resources
  access: AccessSelection;            // what actions
}

type Scope =
  | { type: "all" }                                        // Resource "*"
  | { type: "arns"; values: Record<string, string>[] }     // per resource type, ARN placeholder values
  | { type: "module"; data: unknown };                     // module-specific (e.g. bucket + prefix, tag key/value)

type AccessSelection =
  | { type: "levels"; levels: AccessLevel[] }              // grid columns / generic verbs
  | { type: "actions"; actions: string[] }                 // individual picks
  | { type: "preset"; preset: string };                    // module verb, e.g. "s3.read", "ec2.startstop"
```

### 6.2 Generic engine (all services)
- Resolve actions from `AccessSelection` (levels → all actions at those levels; actions → as given).
- Split actions into **resource-scoped** (non-empty `resources`) and **global-only** (empty `resources`).
- Resource-scoped actions get ARNs built from the service's `arnFormats` with user-provided placeholder values; unknown values become `*` (e.g. `${Account}` → accountId or `*`).
- Global-only actions go in a separate statement with `"Resource": "*"` and the lint info "requires `*`".
- If scope is `all`, a single statement with `"Resource": "*"`.
- Action lists collapse to a wildcard only when *all* actions of a level are selected and the result is exact (e.g. never emit `s3:Get*` if that would include unselected actions). Default: explicit lists, sorted.
- Statements get deterministic `Sid`s: `<Service><Level|Verb><Scope>` in PascalCase, unique within the document.

### 6.3 Smart modules
Each module implements:
```ts
interface Module {
  id: string; service: string;
  presets: { id: string; label: string; actions: string[] }[];   // sentence verbs
  scopeEditor: "s3-bucket-prefix" | "ec2-instances" | "arn-picker"; // which UI control to show ("arn-picker" = generic ARN form)
  build(grant: Grant, ctx: Ctx): Statement[];                     // replaces generic for this grant
  explain(grant: Grant): string;
  extraExports?(model: RoleModel): ExportExtra[];                 // e.g. EC2 instance profile
}
```

| Module | Presets (sentence verbs) | Correctness rules |
|---|---|---|
| **S3** | list, read, list + read, write (upload), read + write, delete, upload only | Scope = bucket + optional prefixes. `s3:ListBucket` on **bucket ARN** with `StringLike s3:prefix: ["<p>", "<p>*"]`. Object actions on `arn:…:::bucket/<p>*`. Optional "allow navigating to the folder" adds a ListBucket statement with `s3:prefix: ["", <each parent>]` + `s3:delimiter: "/"`. Toggle "bucket encrypted with KMS key" adds `kms:Decrypt` (read) / `kms:GenerateDataKey` (write) on the given key ARN. `${aws:username}` supported in prefix. |
| **EC2** | view, start/stop, start/stop/reboot, terminate, manage tags | Describe* actions don't support resource scoping → separate `*` statement. Mutating actions scoped by instance ARNs or `aws:ResourceTag/<k>` condition. Trust=ec2 → exports add instance profile. |
| **ECR** | pull, push, pull + push | `ecr:GetAuthorizationToken` always in its own `*` statement; other actions on repository ARN. |
| **EKS** | describe cluster, access via kubectl | `eks:DescribeCluster` on cluster ARN; note in summary that Kubernetes RBAC / EKS access entries are still required (export adds `aws eks create-access-entry` + `associate-access-policy` in CLI). |
| **Lambda** | invoke, deploy code, manage | Deploy preset includes `iam:PassRole` **only** on an explicit role ARN — linter error if `*`. |
| **DynamoDB** | read, write, read + write | Table ARN **and** `table/<name>/index/*`. |
| **CloudWatch Logs** | write logs, read logs | Write: `logs:CreateLogGroup/CreateLogStream/PutLogEvents` on log-group ARN (`:*` suffix for streams). |
| **Secrets Manager** | read secret | `GetSecretValue`, `DescribeSecret` on secret ARN (with `-??????` suffix wildcard); optional `kms:Decrypt` on CMK. |
| **KMS** | encrypt, decrypt, encrypt + decrypt | Key ARN required; warn if `*`. |
| **SQS** | send, receive/delete, send + receive | Queue ARN. |

Exact action lists for presets live in `core/engine/modules/<id>.ts` and are covered by tests (section 11).

### 6.4 Trust builder
| Trust kind | Output |
|---|---|
| service | `Principal: { Service: "<svc>.amazonaws.com" }`, `sts:AssumeRole` |
| github | `Principal: { Federated: "arn:<partition>:iam::<account>:oidc-provider/token.actions.githubusercontent.com" }`, `sts:AssumeRoleWithWebIdentity`, `StringEquals` on `…:aud = sts.amazonaws.com` **and** `…:sub` = `repo:<owner>/<repo>:ref:refs/heads/<branch>` (or `environment:<env>`, `ref:refs/tags/<tag>`, `pull_request`). Wildcards in owner/repo are **not allowed** in the UI; wildcard branch (`*`) allowed only with a lint warning and `StringLike`. CLI export includes an idempotent "create OIDC provider if missing" step. |
| account | `Principal: { AWS: "arn:<partition>:iam::<id>:root" }`; `StringEquals sts:ExternalId` when given; `Bool aws:MultiFactorAuthPresent` when requireMfa. |
| principal (group/user) | No trust policy; exports create a managed policy and attach to the group/user. Lint info nudges toward groups over users. |

### 6.5 Linter
Each rule returns `{ id, severity: "error" | "warning" | "info", message, grantId? }`.
- error: `iam:PassRole` on `*`; GitHub trust without `sub`; trust with `Principal: "*"` or `{"AWS": "*"}`; policy over size limit; invalid ARN placeholder values (e.g. bucket name rules).
- warning: `Action: "*"` or `<svc>:*`; Delete/Permissions-management level on `Resource: *`; any `iam:*`, `sts:AssumeRole` on `*`, `kms:*`; GitHub branch wildcard; cross-account without ExternalId.
- info: actions that require `*` (named list); attaching to a user instead of a group.
Errors disable "Export" until fixed (copy still allowed, with banner).

**Size meter:** counts characters excluding whitespace (as IAM does). Limits: managed policy 6,144; inline (aggregate per role) 10,240; trust policy 2,048 (default quota). When over, suggest switching mode or splitting (v1: suggestion only).

### 6.6 Explainer
Builds sentences from grants ("Can list and download files in `reports/` of `data-lake`"), plus a "Cannot" list computed from what common destructive levels are *not* granted per service in the role (Delete, Permissions management, Terminate for EC2). Pure function; same text drives the green summary box and the README in the ZIP export.

### 6.7 Exporters
All take `{ model, policy, trust }` and return `{ filename, language, content }[]`.
- **json:** `policy.json`, `trust.json` (2-space indent).
- **cli-bash:** heredoc-written files + `aws iam create-role`, `create-policy` + `attach-role-policy` (managed) or `put-role-policy` (inline); EC2 adds `create-instance-profile` + `add-role-to-instance-profile`; GitHub adds OIDC provider check/create; group/user uses `attach-group-policy` / `attach-user-policy`. Uses `--query` + variables to capture the policy ARN. Every command copy-paste safe.
- **cli-ps:** same steps for PowerShell (single-quoted here-strings, `` ` `` line continuation).
- **terraform:** `aws_iam_role`, `aws_iam_policy` with `jsonencode(...)`, `aws_iam_role_policy_attachment`, `aws_iam_instance_profile`, `aws_iam_openid_connect_provider` (as commented-out block + note to use a data source if it already exists), group/user attachments.
- **cloudformation:** YAML with `AWS::IAM::Role`, `AWS::IAM::ManagedPolicy`, `AWS::IAM::InstanceProfile`.
- **zip:** all of the above + `README.md` (explainer text + how to apply).

### 6.8 Share URL
`#s=` + `lz-string.compressToEncodedURIComponent(JSON.stringify(model))`. The hash fragment is never sent to the server. On load: decode → validate (zod schema) → if invalid, show a toast and start empty. Model `version` allows future migrations.

---

## 7. Templates (v1)

Defined as data: `{ id, title, category, for, description, tags[], params: ParamDef[], build(params) → RoleModel }`. The setup drawer renders `params` as a form; "Open in workspace" loads the instantiated model.

| # | Template | Category | Trust | Params |
|---|---|---|---|---|
| 1 | S3 folder — read only | Storage | group/user/any | bucket, prefix, KMS key? |
| 2 | S3 home folder per user | Storage | group | bucket, base prefix |
| 3 | S3 upload-only drop box | Storage | any | bucket, prefix |
| 4 | Read one secret | Security | ec2/lambda/ecs | secret ARN, KMS key? |
| 5 | EC2 operator | Compute | group/user | tag key, tag value, region? |
| 6 | EC2 app server baseline (SSM + CloudWatch) | Compute | ec2 | log group name |
| 7 | GitHub Actions → S3 static site deploy | CI/CD | github | owner, repo, branch, bucket, CloudFront distribution ID |
| 8 | GitHub Actions → ECR push | CI/CD | github | owner, repo, branch, repository name, region |
| 9 | GitHub Actions → Lambda deploy | CI/CD | github | owner, repo, branch, function name |
| 10 | Lambda + DynamoDB table | Serverless | lambda | table name, log group |
| 11 | Textract document pipeline | AI/ML | lambda/ec2 | bucket, input prefix, output prefix |
| 12 | Bedrock — invoke one model | AI/ML | lambda/ecs/user | model ID, region |
| 13 | Cross-account read-only (with External ID) | Audit | account | account ID, external ID, services to read |

Template 6 attaches AWS managed policy `AmazonSSMManagedInstanceCore` via `RoleModel.managedPolicyArns` (exports attach it by ARN).

Gallery category filters are derived from the templates present (v1: Storage, Security, Compute, CI/CD, Serverless, AI/ML, Audit), so no empty filters appear.

---

## 8. UI

Follows the approved mockup: `docs/design/approved-mockup.html` (open in a browser; tabs Landing / Templates / Workspace).

**Theme:** Cloudscape visual refresh, **dark mode default** (`applyMode(Mode.Dark)`), toggle in top bar, preference in `localStorage` (try/catch; falls back to dark). Primary buttons AWS orange, links/tabs blue. Own logo (Phosphor key mark on orange tile); no AWS logos; footer "Not affiliated with Amazon Web Services".

**Routes**
- `/` Landing: hero (headline, sub, "Browse templates" / "Start from scratch", three facts), preview card, three feature boxes, footer.
- `/templates`: header, search, category segmented control, card grid, setup drawer (Cloudscape `Drawer`/`Modal`) with params form + live JSON preview + "Open in workspace" / "Copy JSON".
- `/builder`: top nav + three columns:
  - **Left (240 px):** service search (all services, fuzzy, ⌘K / Ctrl+K), "In this role" with counts, Popular, Browse by category, A–Z.
  - **Center:** wizard steps (Trusted entity · Permissions · Review and export); Permissions container with **Sentences | Grid** segmented control; summary alert; Previous/Next.
  - **Right (400 px):** tabs Policy · Trust · CLI (bash/PowerShell sub-toggle) · Terraform · CloudFormation; status line (lint counts), size meter, Copy / Export (ZIP).
- **Sentence mode:** one row per Grant: verb select (module presets or access levels) + resource select (module scope editor in a popover) + remove. "Add permission" = pick service then verb.
- **Grid mode:** one container per service; rows = scopes, columns = access levels (or module presets); "Pick individual actions" expandable multiselect with search over all actions of that service, grouped by level.
- **Review step:** role name, policy mode (managed/inline), account ID/region (optional), lint list with "jump to" links, explainer.

**Desktop-first.** Builder requires ≥ 1024 px viewport. Below that, `/builder` shows the "Works best on a laptop or desktop" card with Copy link + Web Share API (`navigator.share`, hidden if unavailable). Landing and templates remain usable on phones; template drawer shows read-only JSON.

**Accessibility:** Cloudscape defaults (keyboard, focus, contrast in both modes); all icon-only buttons have `aria-label`.

---

## 9. Error handling
- Service data fetch fails → inline error in sidebar with Retry; already-loaded services keep working.
- Unknown service in a shared URL (removed by AWS) → grant kept but marked "Service no longer in AWS data"; excluded from output with lint error.
- Invalid share URL → toast, empty model.
- Invalid inputs (bucket names, account IDs, ARNs, role names) → field-level validation messages; engine never receives invalid values (it substitutes nothing and lint reports error).
- Clipboard API unavailable → fallback select-text dialog.
- Global React error boundary with "Reset builder" (clears hash).

---

## 10. Privacy & security
- No backend, no cookies, no third-party trackers except Cloudflare Web Analytics (cookieless, no PII, no URL hash).
- Content-Security-Policy via Cloudflare Pages `_headers`: `default-src 'self'`; scripts self + Cloudflare analytics beacon; no inline scripts.
- Never asks for AWS credentials. Landing and footer state this.
- Generated CLI never embeds secrets; External IDs are user-provided.

---

## 11. Validation & testing

**Goal:** no generated policy, trust policy or export ever fails when a user applies it. Validation runs in six layers; layers 1–5 gate every merge **and** every weekly data refresh (a refresh that breaks anything is not deployed).

### Layer 1 — In-browser strict validator (ships to users, runs on every change)
`core/validate/` — same code used in CI. Blocks Export on any error.
- **Structure:** policy and trust documents validated against a strict IAM policy JSON schema (zod): `Version` = `2012-10-17`; `Effect` ∈ Allow/Deny; Action/Resource non-empty; unique `Sid`s matching `^[A-Za-z0-9]*$`; condition operators from the known IAM operator list.
- **Action existence:** every action exists in the service data (case-sensitive match on name).
- **Action ↔ resource compatibility:** every resource ARN in a statement matches (pattern derived from `arnFormats`) a resource type that **every** action in that statement supports; actions with no resource types appear only with `"*"`. This is the check that catches the S3 bucket-vs-object mistake.
- **Condition key validity:** each condition key is a global `aws:` key, or in the service's `ConditionKeys`, and is supported by at least one action in the statement.
- **Value validation:** bucket names, account IDs (12 digits), role/policy names, ARNs, GitHub owner/repo, regions (known list), KMS key ARNs/IDs — field-level, before reaching the engine.
- **Limits:** size limits (6,144 / 10,240 / 2,048, whitespace excluded), max 10 managed policies per role, role name ≤ 64 chars, policy name ≤ 128.

### Layer 2 — Unit & golden tests (Vitest, `core/` ≥ 95 % lines and branches)
- Access-level mapping from raw AWS JSON fixtures.
- Generic engine: resource-scoped vs `*` split; ARN substitution; deterministic Sids/ordering.
- Each smart module: golden fixtures per preset, hand-reviewed against AWS docs. S3 prefix cases: root, nested, multiple prefixes, `${aws:username}`, KMS.
- Trust builder: every kind and GitHub ref variant.
- Linter and validator: one positive + one negative test per rule.
- Exporters: snapshots for 3 reference roles in every format.
- Every template instantiates with sample params and passes Layer 1.
- Share URL round-trip.

### Layer 3 — Property-based / fuzz testing (fast-check)
- Generate thousands of random valid RoleModels (random services from the real data, random levels/actions/scopes, all trust kinds) → assert generated documents always pass Layer 1, are deterministic (same input → byte-identical output) and never exceed limits without a lint error.
- **Exhaustive sweep:** for **every service × every access level** (≈ 2,300 combinations), generate a policy with sample ARNs and assert it passes Layer 1. Runs in CI on every PR (offline, seconds).

### Layer 4 — Export tooling checks (CI, offline)
- Terraform: `terraform fmt -check` + `terraform init -backend=false` + `terraform validate` with the AWS provider.
- CloudFormation: `cfn-lint`.
- Bash: `shellcheck`; PowerShell: `PSScriptAnalyzer` + a parse check.
- AWS CLI: a script parses every generated `aws` command and checks it against the AWS CLI service models (botocore JSON for `iam`, `eks`): operation exists, all required parameters present, no unknown flags, value types correct.

### Layer 5 — AWS-authoritative validation (CI, needs a sandbox AWS account via GitHub OIDC, read-only/no resources created)
- **IAM Access Analyzer `ValidatePolicy`** on every golden fixture, every template output, and a 300-policy sample from the Layer 3 sweep: identity policies as `IDENTITY_POLICY`; trust policies as `RESOURCE_POLICY` + `AWS::IAM::AssumeRolePolicyDocument`. **Any ERROR or SECURITY_WARNING fails the build**; WARNING/SUGGESTION must be listed in an allowlist with a reason.
- **IAM Policy Simulator `SimulateCustomPolicy`** behaviour tests per template/module — asserting *what the policy actually does*, with context keys, e.g.:
  - S3 folder read-only: `GetObject data-lake/reports/a.pdf` = allowed; `GetObject data-lake/other/a.pdf` = denied; `ListBucket` with `s3:prefix=reports/` = allowed, with `s3:prefix=other/` = denied; `PutObject` = denied.
  - EC2 operator: `StopInstances` on instance with `aws:ResourceTag/env=dev` = allowed, `env=prod` = denied; `TerminateInstances` = denied.
  - Each template ships with its own allow/deny assertion table (the same table drives the "can / cannot" text, so the explainer is verified too).
- **Custom policy check `CheckAccessNotGranted`** for every template: assert dangerous actions (`iam:*` write actions, `iam:PassRole` on `*`, `sts:AssumeRole` on `*`, `organizations:*`, `kms:ScheduleKeyDeletion`, etc.) are not granted. (Paid per call — templates only, a few cents per run.)
- Runs on every PR to `main` (from the same repo) and before every weekly data deploy.

### Layer 6 — Real apply tests (nightly + before release, sandbox AWS account)
For every template and each export format (CLI bash, CLI PowerShell, Terraform, CloudFormation):
1. Create test resources (bucket, tagged instance stopped, ECR repo, secret, table…) via a fixture stack.
2. **Apply the generated export exactly as a user would copy it** (unique name suffix per run).
3. Assume the created role (or use a test user in the group) and run the allowed operations → must succeed; run the denied operations → must fail with AccessDenied.
4. Tear everything down (always runs, plus a sweeper job that deletes anything tagged `rolecraft-test` older than 24 h).
Cost: IAM is free; test resources are minimal (no running instances, tiny objects) — expected < $1/month.
Templates display a **"Verified on AWS · <date>"** badge sourced from the last successful Layer 6 run (written into the build as data).

### UI tests
- **E2E (Playwright, Chromium):** landing → template → fill params → open in workspace → output matches golden; Sentence ⇄ Grid preserves model; theme toggle; share URL restore; copy buttons; export ZIP contents; 390 px viewport shows desktop card; invalid input blocks export with message.
- **Error-free runtime:** Playwright fails on any `console.error` or unhandled rejection; React error boundary reports are counted.

### CI pipeline
`ci.yml` (PR/push): typecheck → ESLint → Layer 2 → Layer 3 → Layer 4 → build → E2E → Layer 5. `nightly.yml`: Layer 6 + sweeper. `sync-aws-data.yml`: sync → all of `ci.yml` → commit only if green.

---

## 12. Deployment
- **Repo:** GitHub `rolecraft` (public, MIT) under the owner's account.
- **Cloudflare Pages:** connect repo; build `npm run build`; output `dist`; Node 22+. Preview deploys per PR.
- **Domain:** in Cloudflare Pages → Custom domains → `rolecraft.omhinge.cloud` (DNS is already on Cloudflare, so the CNAME is created automatically; TLS automatic).
- **Headers:** `public/_headers` for CSP, `Cache-Control: public, max-age=31536000, immutable` on hashed assets and `max-age=3600` on `/data/*`.
- **SPA routing:** `public/_redirects` → `/* /index.html 200`.
- **SEO/social:** title, description, Open Graph + Twitter card image (1200×630, generated static PNG of the builder) for the LinkedIn preview; `robots.txt`, `sitemap.xml`.

---

## 13. Repository layout
```
rolecraft/
├─ src/
│  ├─ core/            catalog/ model/ engine/ trust/ lint/ explain/ export/ templates/
│  ├─ ui/              app shell, routes, components (sidebar, sentence editor, grid editor, output panel, drawers)
│  ├─ state/           zustand store
│  └─ main.tsx
├─ data/               generated service data (committed) + curated/
├─ scripts/            sync-aws-data.ts
├─ public/             _headers, _redirects, og-image.png, robots.txt
├─ tests/              e2e/ (Playwright); unit tests colocated as *.test.ts
├─ docs/superpowers/specs/
├─ .github/workflows/  ci.yml, sync-aws-data.yml
└─ README.md, LICENSE
```

---

## 14. Milestones
1. **Foundation:** repo, Vite/React/Cloudscape shell, dark/light theme, routes, CI.
2. **Data:** sync script, slim data committed, catalog loader + sidebar search.
3. **Core engine:** model, generic engine, trust builder, JSON export, tests.
4. **Builder UI:** wizard, sentence + grid editors, output panel, share URL.
5. **Smart modules + linter + explainer.**
6. **Exporters:** CLI bash/PowerShell, Terraform, CloudFormation, ZIP.
7. **Templates + landing page + phone handling.**
8. **Polish + launch:** OG image, analytics, Cloudflare Pages + domain, README with screenshots/GIF for LinkedIn.
