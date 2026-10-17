# RoleCraft Plan 2 — Smart Modules, Linter, Explainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hand-built, AWS-correct permission modules for the 10 most-used services, a risk linter, and a plain-English "can / cannot" explainer — all wired into `generate`, all proven by golden tests against real AWS data and a module sweep.

**Architecture:** Each module is a pure object in `src/core/engine/modules/<id>.ts` implementing one `Module` interface (zod data schema + presets + `build` + `explain`). A registry feeds `generate`'s existing `builders` seam by default. The linter and explainer are pure functions over `RoleModel` + `GenerateResult`. Every module's output must pass the Layer-1 validator built in Plan 1 — the validator is the arbiter, never relaxed.

**Tech Stack:** TypeScript strict, zod, Vitest, fast-check (all already installed).

**Spec:** `docs/superpowers/specs/2026-10-16-rolecraft-design.md` — §6.3 (modules), §6.5 (linter), §6.6 (explainer), §11 (validation), §15 (engine rules).

## Global Constraints

- Project root `C:\Users\iamac\dev\rolecraft`, branch `feat/plan-2-modules` (created from `main` after Plan 1 closes). Shell cwd resets — always `cd /c/Users/iamac/dev/rolecraft && ...`.
- `src/core/**` stays pure: no React/DOM/fetch (ESLint enforces). TypeScript strict + `noUncheckedIndexedAccess`; coverage ≥ 95% lines and branches on `src/core`.
- **Every statement a module emits must pass `validateIdentityPolicy` with zero errors against the real catalog (`public/data/svc/*.json`).** Never weaken a validator rule; if a module seems to need that, stop and report.
- Partition is `"aws"`; ARNs use `ctx.region ?? "*"` and `ctx.accountId ?? "*"` unless the module data supplies them.
- Statement Sids: `^[A-Za-z0-9]*$`, built as `pascal(service) + PascalPreset + Part` (reuse `pascal` from `src/core/engine/sid.ts`); `generate` dedupes.
- Action strings sorted; single action/resource emitted as a string, multiple as a sorted array (same convention as the generic engine).
- Issue messages are user-facing English; action names written `service:Action`.
- Commits: author `-c user.name="Om Hinge" -c user.email="om.hinge.2635@gmail.com"`, message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; stage explicit paths only.

## Review Focus

1. **DynamoDB index ARN with non-index actions** — `GetItem` supports only `table`; putting `table/T/index/*` in the same statement fails validation. Index ARNs go only with `Query`/`Scan` (Task 4 test `index ARN only on Query/Scan`).
2. **Logs log-group vs log-stream split** — `CreateLogStream`/`PutLogEvents`/`GetLogEvents` need `log-stream` (`log-group:<name>:*`), `CreateLogGroup`/`DescribeLogStreams`/`FilterLogEvents` need `log-group` (`log-group:<name>`) (Task 4 tests per preset).
3. **S3 prefix edge cases** — whole bucket (`""`), nested prefixes, prefix given without trailing `/`, leading `/`, `${aws:username}`, multiple prefixes, navigation parents (Task 2 tests).
4. **Lambda invoke on qualified ARNs** — invoking `function:f:1` or an alias needs `function:f:*` in addition to `function:f` (Task 4 test `invoke covers unqualified and qualified`).
5. **Module data invalid or missing** (empty bucket, bad key ARN, `*` KMS key) → `E_MODULE_DATA` error issue with field path, no statements, never a throw (Task 1 test + one per module).

---

## File Structure

```
src/core/engine/modules/types.ts          Module interface, helpers (statement builder, ARN helpers)
src/core/engine/modules/registry.ts       MODULES registry + defaultBuilders()
src/core/engine/modules/s3.ts             + s3.test.ts
src/core/engine/modules/ec2.ts            + ec2.test.ts
src/core/engine/modules/ecr.ts            + ecr.test.ts
src/core/engine/modules/eks.ts            + eks.test.ts
src/core/engine/modules/lambda.ts         + lambda.test.ts
src/core/engine/modules/dynamodb.ts       + dynamodb.test.ts
src/core/engine/modules/logs.ts           + logs.test.ts
src/core/engine/modules/secretsmanager.ts + secretsmanager.test.ts
src/core/engine/modules/kms.ts            + kms.test.ts
src/core/engine/modules/sqs.ts            + sqs.test.ts
src/core/engine/modules/__test__/catalog.ts   loads real slim data for module tests
src/core/lint/lint.ts                     + lint.test.ts
src/core/explain/explain.ts               + explain.test.ts
src/core/generate.ts                      (modify) default builders + lint
tests/sweep/modules.test.ts               every module × preset × sample data passes validator
```

---

### Task 1: Module framework, registry, generate wiring

**Files:** Create `src/core/engine/modules/types.ts`, `registry.ts`, `__test__/catalog.ts`, `types.test.ts`; Modify `src/core/generate.ts`, `src/core/generate.test.ts`.

**Interfaces:**
- Consumes: `GrantBuilder`, `generate(model, catalog, builders = {})` (Plan 1), `BuildResult`, `pascal`, `Grant` (`module?: string`, `scope: {type:"module"; data: unknown}`, `access: {type:"preset"; preset: string}`).
- Produces:
  ```ts
  export interface ModulePreset { id: string; label: string; actions: string[] }   // actions WITHOUT service prefix, e.g. "GetObject"
  export interface Module<D = unknown> {
    id: string;              // "s3"
    service: string;         // IAM prefix, "s3"
    label: string;           // "Amazon S3"
    presets: ModulePreset[];
    dataSchema: z.ZodType<D>;
    build(grant: Grant, data: D, svc: SlimService, ctx: BuildContext): BuildResult;
    explain(grant: Grant, data: D): string;      // one sentence, starts with "Can "
  }
  export function runModule(mod: Module, grant: Grant, svc: SlimService, ctx: BuildContext): BuildResult;
  export function stmt(sid: string, actions: string[], resources: string[], condition?: ConditionBlock): Statement; // sorts, string-vs-array convention, prefixes nothing
  export function prefixed(service: string, actions: string[]): string[];   // "GetObject" -> "s3:GetObject"
  export const MODULES: Record<string, Module>;                 // registry.ts (empty map in this task; later tasks register)
  export function defaultBuilders(): Record<string, GrantBuilder>; // registry.ts
  export function loadRealCatalog(keys: string[]): Catalog;      // __test__/catalog.ts, reads public/data/svc via fs
  ```
- `runModule` order: grant.access must be `preset` and the preset id must exist in `mod.presets` else `E_MODULE_PRESET` (error, grantId); scope must be `module` else `E_MODULE_SCOPE` (error); `mod.dataSchema.safeParse(scope.data)` failure → `E_MODULE_DATA` (error, grantId, `path` = `data.<zod path>`); otherwise `mod.build(...)`. Never throws (generate's E_INTERNAL guard stays as backstop).
- `generate`'s default `builders` becomes `defaultBuilders()` (explicit `builders` argument still overrides).

- [ ] **Step 1: Failing tests** `types.test.ts` with an inline test module (service `textract`, one preset `analyze` → `["AnalyzeDocument"]`, schema `z.object({}).strict()`): unknown preset → `E_MODULE_PRESET`; `levels` access → `E_MODULE_PRESET`; non-module scope → `E_MODULE_SCOPE`; schema failure (`data: {x:1}`) → `E_MODULE_DATA` with `path` `"data"`-prefixed; success returns the module's statements. `stmt("A", ["s3:B","s3:A"], ["r"])` → `{Sid:"A",Effect:"Allow",Action:["s3:A","s3:B"],Resource:"r"}`; with one action → string. `generate.test.ts`: a grant with `module: "nosuch"` still yields `E_UNKNOWN_MODULE`; explicit builders override defaults.
- [ ] **Step 2:** Run `npx vitest run src/core/engine/modules src/core/generate.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; full `npm test -- --coverage`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 5:** Commit `feat(core): module framework and registry`.

### Task 2: S3 module

**Files:** Create `src/core/engine/modules/s3.ts`, `s3.test.ts`; Modify `registry.ts`.

**Data schema** (`.strict()`): `{ bucket: string; prefixes: string[] (1–20); allowNavigation?: boolean (default false); kmsKeyArn?: string }`.
- `bucket`: `^(?!\d+\.\d+\.\d+\.\d+$)(?!.*\.\.)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$` (AWS bucket rules).
- each prefix: normalized by the module — strip leading `/`; `""` means whole bucket; a non-empty prefix not ending in `/` and not containing `*` gets `/` appended (folders); must not contain `*`, `?`, `"`, whitespace, or control chars; `${aws:username}` allowed; max 1024 chars.
- `kmsKeyArn`: `^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[A-Za-z0-9-]+$`.

**Presets** (ids → actions):
| id | label | actions |
|---|---|---|
| `list` | list | `ListBucket` |
| `read` | read | `GetObject`, `GetObjectVersion` |
| `list-read` | list + read | `ListBucket`, `GetObject`, `GetObjectVersion` |
| `write` | upload | `PutObject`, `AbortMultipartUpload`, `ListMultipartUploadParts` |
| `read-write` | read + write | `ListBucket`, `GetObject`, `GetObjectVersion`, `PutObject`, `AbortMultipartUpload`, `ListMultipartUploadParts` |
| `delete` | delete | `DeleteObject`, `DeleteObjectVersion` |
| `upload-only` | upload only | `PutObject`, `AbortMultipartUpload` |

**Statements:**
- If preset includes `ListBucket`: Sid `S3List…` on `arn:aws:s3:::<bucket>`; if any prefix is `""` → no condition; else `Condition: { StringLike: { "s3:prefix": [p, p + "*"] for each prefix, sorted, deduped } }`.
- Object actions: one statement on resources `arn:aws:s3:::<bucket>/<p>*` per prefix (`p=""` → `<bucket>/*`).
- `allowNavigation: true` (only meaningful with `ListBucket` and non-empty prefixes): extra statement `ListBucket` on bucket ARN with `Condition: { StringEquals: { "s3:prefix": [""] ∪ every proper parent folder of each prefix (e.g. "reports/2026/" → "", "reports/"), "s3:delimiter": ["/"] } }`.
- `kmsKeyArn`: read actions present → `kms:Decrypt`; write actions present → `kms:GenerateDataKey` and `kms:Decrypt` (multipart); on the key ARN, separate statement Sid `S3Kms…`.
- `explain`: e.g. "Can list and download files in reports/ of data-lake." / "Can upload files to uploads/ of data-lake (cannot list or download)."

- [ ] **Step 1: Failing tests** (`loadRealCatalog(["s3","kms"])`), each asserting exact statements with `toStrictEqual` AND `validateIdentityPolicy(doc) === []`:
  - `list-read reports/` → ListBucket+prefix condition `["reports/","reports/*"]` + Get on `data-lake/reports/*`.
  - whole bucket `""` → ListBucket no condition; Get on `data-lake/*`.
  - prefix `"reports"` and `"/reports/"` both normalize to `reports/`.
  - nested `reports/2026/` with `allowNavigation` → navigation statement prefixes `["","reports/"]` + delimiter `"/"`.
  - two prefixes → both in condition and both object ARNs.
  - `home/${aws:username}/` → resource `data-lake/home/${aws:username}/*`.
  - `upload-only` → only Put + AbortMultipartUpload on object ARN, no ListBucket.
  - KMS with `read-write` → Decrypt + GenerateDataKey on key.
  - Invalid: bucket `"Data_Lake"`, prefix containing `*`, KMS key `"*"`, empty prefixes array → `E_MODULE_DATA` with paths.
- [ ] **Step 2:** FAIL. **Step 3:** Implement + register. **Step 4:** PASS + full suite/typecheck/lint.
- [ ] **Step 5:** Commit `feat(core): S3 smart module`.

### Task 3: EC2, ECR, EKS modules

**Files:** Create `ec2.ts`, `ecr.ts`, `eks.ts` + tests; Modify `registry.ts`.

**EC2** — data `.strict()`: `{ selector: {type:"tag"; key: string; value: string} | {type:"ids"; ids: string[] (1–50, each ^i-[0-9a-f]{8,17}$)} | {type:"all"} }`; tag key `^[\w .:/=+\-@]{1,128}$`, value `^[\w .:/=+\-@]{0,256}$`.
Presets: `view` → `DescribeInstances`, `DescribeInstanceStatus`, `DescribeTags` (global-only → own statement `Resource: "*"`); `start-stop` → `view` + `StartInstances`, `StopInstances`; `start-stop-reboot` → + `RebootInstances`; `terminate` → `view` + `TerminateInstances`; `tags` → `view` + `CreateTags`, `DeleteTags`.
Mutating actions: resource `arn:aws:ec2:<region|*>:<account|*>:instance/*` with `Condition: { StringEquals: { "aws:ResourceTag/<key>": <value> } }` for tag selector; `instance/<id>` ARNs for ids; `instance/*` without condition for all. `CreateTags`/`DeleteTags` with tag selector: additionally add `Condition.StringEquals["ec2:CreateAction"]`? No — keep `aws:ResourceTag` only (tag-on-existing-instance). Info issue `I_EC2_KMS_GRANT` on start presets: "If the instances' EBS volumes use a customer managed KMS key, also allow kms:CreateGrant on that key." Warning `W_EC2_ALL_INSTANCES` when selector `all` with a mutating preset.
**ECR** — data `{ repository: string (^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$, ≤256) }`. Presets `pull` → `BatchGetImage`, `GetDownloadUrlForLayer`, `BatchCheckLayerAvailability`; `push` → `BatchCheckLayerAvailability`, `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload`, `PutImage`; `pull-push` → union. Repository ARN `arn:aws:ecr:<region|*>:<account|*>:repository/<name>`. **Always** a separate statement `ecr:GetAuthorizationToken` on `"*"`.
**EKS** — data `{ cluster: string (^[0-9A-Za-z][A-Za-z0-9\-_]{0,99}$) }`. Presets `describe` → `DescribeCluster` on cluster ARN `arn:aws:eks:<region|*>:<account|*>:cluster/<name>`; `kubectl` → `DescribeCluster` + separate `ListClusters` on `"*"`, and info issue `I_EKS_ACCESS_ENTRY`: "kubectl access also needs an EKS access entry or aws-auth mapping for this role — the CLI export includes it."

- [ ] **Step 1: Failing tests** per module and preset — exact statements + validator `[]` (catalog `ec2`, `ecr`, `eks`): tag selector condition; ids → instance ARNs; `view` alone → only the `*` statement; ECR every preset contains the GetAuthorizationToken `*` statement; EKS kubectl info issue; invalid data → `E_MODULE_DATA` (bad instance id, repository with uppercase, cluster with space).
- [ ] **Step 2:** FAIL. **Step 3:** Implement + register. **Step 4:** PASS + full suite/typecheck/lint.
- [ ] **Step 5:** Commit `feat(core): EC2, ECR and EKS smart modules`.

### Task 4: Lambda, DynamoDB, CloudWatch Logs modules

**Files:** Create `lambda.ts`, `dynamodb.ts`, `logs.ts` + tests; Modify `registry.ts`.

**Lambda** — data `{ functionName: string (^[a-zA-Z0-9-_]{1,64}$) }`. Presets `invoke` → `InvokeFunction` on **both** `function:<name>` and `function:<name>:*`; `read` → `GetFunction`, `GetFunctionConfiguration`, `ListVersionsByFunction` on `function:<name>`; `deploy` → `UpdateFunctionCode`, `GetFunction`, `PublishVersion` on `function:<name>` (no `iam:PassRole` — code deploys don't need it). ARN `arn:aws:lambda:<region|*>:<account|*>:function:<name>`.
**DynamoDB** — data `{ table: string (^[a-zA-Z0-9_.-]{3,255}$); includeIndexes?: boolean (default true) }`. Presets `read` → `GetItem`, `BatchGetItem`, `Query`, `Scan`, `DescribeTable`, `ConditionCheckItem`; `write` → `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem`, `DescribeTable`; `read-write` → union. Table ARN `arn:aws:dynamodb:<region|*>:<account|*>:table/<name>`. **Index ARN `…/table/<name>/index/*` goes in a separate statement containing only `Query` and `Scan`** (only when `includeIndexes` and the preset includes them).
**Logs** — data `{ logGroup: string (^[\.\-_/#A-Za-z0-9]{1,512}$); createGroup?: boolean (default true) }`. Presets `write` → `CreateLogStream`, `PutLogEvents` on `log-group:<name>:*` (+ `CreateLogGroup` on `log-group:<name>` when `createGroup`); `read` → `DescribeLogStreams`, `FilterLogEvents` on `log-group:<name>` and `GetLogEvents` on `log-group:<name>:*`; `read-write` → union, grouped by resource. ARN prefix `arn:aws:logs:<region|*>:<account|*>:`.

- [ ] **Step 1: Failing tests** — exact statements + validator `[]` (catalog `lambda`, `dynamodb`, `logs`): `invoke covers unqualified and qualified`; `index ARN only on Query/Scan` (GetItem statement has no index ARN); `includeIndexes:false` → no index ARN; logs write/read resource split; `createGroup:false` omits CreateLogGroup; invalid names → `E_MODULE_DATA`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement + register. **Step 4:** PASS + full suite/typecheck/lint.
- [ ] **Step 5:** Commit `feat(core): Lambda, DynamoDB and CloudWatch Logs smart modules`.

### Task 5: Secrets Manager, KMS, SQS modules

**Files:** Create `secretsmanager.ts`, `kms.ts`, `sqs.ts` + tests; Modify `registry.ts`.

**Secrets Manager** — data `{ secretName: string (^[\w/+=.@-]{1,512}$); kmsKeyArn?: string (same regex as S3) }`. Preset `read` → `GetSecretValue`, `DescribeSecret` on `arn:aws:secretsmanager:<region|*>:<account|*>:secret:<name>-??????`; `kmsKeyArn` → separate `kms:Decrypt` statement on the key.
**KMS** — data `{ keyArn: string (key ARN regex; `*` rejected) }`. Presets `encrypt` → `Encrypt`, `GenerateDataKey`, `DescribeKey`; `decrypt` → `Decrypt`, `DescribeKey`; `encrypt-decrypt` → union. Resource = keyArn.
**SQS** — data `{ queueName: string (^[A-Za-z0-9_-]{1,80}(\.fifo)?$); kmsKeyArn?: string }`. Presets `send` → `SendMessage`, `GetQueueUrl`, `GetQueueAttributes`; `receive` → `ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility`, `GetQueueUrl`, `GetQueueAttributes`; `send-receive` → union. Queue ARN `arn:aws:sqs:<region|*>:<account|*>:<name>`. `kmsKeyArn` → `kms:GenerateDataKey` (send) / `kms:Decrypt` (receive) on the key.

- [ ] **Step 1: Failing tests** — exact statements + validator `[]` (catalog `secretsmanager`, `kms`, `sqs`): secret ARN ends `-??????`; KMS rejects `*` with `E_MODULE_DATA`; SQS fifo name accepted; KMS add-ons per preset.
- [ ] **Step 2:** FAIL. **Step 3:** Implement + register. **Step 4:** PASS + full suite/typecheck/lint.
- [ ] **Step 5:** Commit `feat(core): Secrets Manager, KMS and SQS smart modules`.

### Task 6: Risk linter

**Files:** Create `src/core/lint/lint.ts`, `lint.test.ts`; Modify `src/core/generate.ts` (+ test).

**Interfaces:** `export function lint(model: RoleModel, policy: PolicyDocument | null, trust: PolicyDocument | null, catalog: Catalog): Issue[]`; `generate` appends `lint(...)` output before sorting.

**Rules** (ids, severity):
- `L_PASSROLE_STAR` error — `iam:PassRole` (or `iam:*`, `*`) with `Resource: "*"`.
- `L_ACTION_STAR` warning — `Action` `"*"` or `<svc>:*`.
- `L_DESTRUCTIVE_STAR` warning — any action whose catalog level is `Permissions management`, or whose name starts with `Delete`/`Terminate`, on `Resource: "*"`.
- `L_SENSITIVE` warning — any of `iam:Create*`, `iam:Put*`, `iam:Attach*`, `iam:Update*`, `iam:Delete*`, `sts:AssumeRole` on `*`, `kms:*`, `organizations:*` granted.
- `L_GITHUB_SAML` error — trust with GitHub OIDC `Federated` principal using `sts:AssumeRoleWithSAML`.
- `L_UNUSED_ARN` info — a scope ARN in a generic grant that appears in no emitted statement.
Issue messages name the actions/resources.

- [ ] **Step 1: Failing tests** — positive + negative per rule (e.g. PassRole on a role ARN → no issue); generate integration: a model with `iam` grant levels `Permissions management` scope all → `L_DESTRUCTIVE_STAR` present in `generate(...).issues`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + full suite/typecheck/lint.
- [ ] **Step 5:** Commit `feat(core): risk linter`.

### Task 7: Explainer

**Files:** Create `src/core/explain/explain.ts`, `explain.test.ts`.

**Interfaces:** `export function explain(model: RoleModel, catalog: Catalog): { can: string[]; cannot: string[] }`.
- `can`: one sentence per grant — module grants use `MODULES[id].explain`; generic grants: "Can <levels joined with "and", lowercased> on <service name> (<"all resources" | N specific resources>)." / explicit actions: "Can use <n> <service name> actions: <first 3 labels>…".
- `cannot`: for each distinct service in the role, if no granted action has level `Permissions management` → "Cannot change <service name> permissions."; if no granted action name starts with `Delete` → "Cannot delete <service name> resources."; EC2 without `TerminateInstances` → "Cannot terminate EC2 instances." Order: services by name, then the rule order above. Deterministic.

- [ ] **Step 1: Failing tests** — S3 list-read model → exact `can`/`cannot` arrays; generic textract Read → "Can read on Amazon Textract (all resources)."; EC2 start-stop → includes "Cannot terminate EC2 instances."; empty model → `{can: [], cannot: []}`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + full suite/typecheck/lint.
- [ ] **Step 5:** Commit `feat(core): plain-English explainer`.

### Task 8: Module sweep and property tests

**Files:** Create `tests/sweep/modules.test.ts`.

- [ ] **Step 1: Write** — for every module in `MODULES` × every preset × a table of 3 valid sample data objects per module (hand-written in the test, covering the edge cases from Review Focus) × ctx with and without account/region: `generate` returns no `error` issues and `policy` passes `validateIdentityPolicy` with `[]`. fast-check property (≥ 1,000 runs): random valid data from each module's schema constraints (generate bucket/table/queue names from the regexes' character classes) → no throw, no errors, deterministic output.
- [ ] **Step 2:** Run `npx vitest run tests/sweep/modules.test.ts`; fix any failure at its root in the owning module with a regression unit test there. Full `npm test -- --coverage`, `npm run typecheck`, `npm run lint`, `npm run build` → exit 0.
- [ ] **Step 3:** Commit `test: module sweep and property tests`.
