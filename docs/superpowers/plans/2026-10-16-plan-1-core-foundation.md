# RoleCraft Plan 1 — Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable app shell (dark Cloudscape theme, routes, CI) plus the complete, fully tested policy core: AWS service data pipeline, catalog, RoleModel + share URL, generic policy engine for every service, trust builder, strict Layer-1 validator, policy assembly and JSON export — proven by exhaustive and property-based tests.

**Architecture:** Vite + React SPA. All policy logic lives in `src/core/` as pure, synchronous TypeScript over a preloaded `Catalog`; UI never builds JSON. AWS Service Reference data is fetched by a Node script into committed slim JSON under `public/data/` (served statically, loaded per service).

**Tech Stack:** Node ≥ 22, Vite, React 19, TypeScript strict, Cloudscape (`@cloudscape-design/components`, `@cloudscape-design/global-styles`), `@phosphor-icons/react`, Zustand, React Router, zod, lz-string, Vitest + Testing Library + jsdom, fast-check, ESLint, tsx (scripts).

**Spec:** `docs/superpowers/specs/2026-10-16-rolecraft-design.md` (read §3, §5, §6.1, §6.2, §6.4, §6.8, §11 Layer 1–3, §15).

**Later plans (not in this plan):** 2 — smart modules (S3, EC2, ECR, EKS, Lambda, DynamoDB, Logs, Secrets Manager, KMS, SQS), linter, explainer · 3 — exporters (CLI bash/PS, Terraform, CFN, ZIP) + Layer 4 · 4 — builder UI, templates, landing, phone handling, E2E · 5 — sandbox AWS account, Layers 5–6, Cloudflare Pages deploy, launch assets.

## Global Constraints

- Project root: `C:\Users\iamac\dev\rolecraft` (use absolute path; shell cwd resets).
- `"engines": { "node": ">=22" }`; TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
- `src/core/**` must not import React, DOM APIs, `fetch`, or anything from `src/ui/**`/`src/state/**`.
- Policy `Version` is exactly `"2012-10-17"`.
- Size limits (characters, whitespace excluded): managed policy **6,144**; inline (aggregate per role) **10,240**; trust policy **2,048**.
- Role name regex `^[\w+=,.@-]{1,64}$`; account ID `^\d{12}$`; Sid `^[A-Za-z0-9]*$`, unique per document.
- Access level mapping (first match wins): `IsPermissionManagement` → `"Permissions management"`; `IsTaggingOnly` → `"Tagging"`; `IsWrite` → `"Write"`; `IsList` → `"List"`; else `"Read"`.
- Partition: only `"aws"` in v1.
- Data source: `https://servicereference.us-east-1.amazonaws.com/v1/service-list.json` and each entry's `url`.
- Sanity gate: fail sync if `< 400` services or `s3`, `ec2`, `iam` missing.
- Theme: dark by default; preference key `rolecraft.theme` in `localStorage`, all access in try/catch.
- No emojis in UI; icons from `@phosphor-icons/react`.
- Commit author: `Om Hinge <om.hinge.2635@gmail.com>`; every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Object ARN given to a bucket-level action** (`s3:ListBucket` + `arn:aws:s3:::b/reports/*`) → must never be emitted; action reported as not fitting (Task 7 test `drops actions whose resource types do not match`) and validator flags hand-made docs (Task 9 test `rejects ListBucket on object ARN`).
2. **Multi-resource actions scoped partially** (`ec2:RunInstances` with only an instance ARN) → warning naming missing types (Task 7 test `warns when only some resource types are covered`).
3. **Share URL tampered or from an older/newer version** → `decodeModel` returns `null`, never throws (Task 5 tests `returns null for garbage`, `returns null for wrong version`).
4. **Service removed from AWS data but present in a saved model** → grant excluded, error issue with the grant id, rest of policy still generated (Task 10 test `unknown service yields issue not crash`).
5. **Empty role (no grants) or all actions filtered out** → `policy` is `null` with an info issue, never an empty `Statement: []` (which AWS rejects) (Task 10 test `no grants gives null policy`).

---

## File Structure

```
package.json, tsconfig.json, tsconfig.node.json, vite.config.ts, eslint.config.js, index.html
.github/workflows/ci.yml
scripts/sync-aws-data.ts              fetch + write data (uses src/core/catalog/transform.ts)
public/data/index.json                generated
public/data/svc/<key>.json            generated
src/main.tsx                          mounts <App/>
src/ui/App.tsx                        router + AppShell
src/ui/AppShell.tsx                   top nav, theme toggle, <Outlet/>
src/ui/pages/{Landing,Templates,Builder}Page.tsx   placeholders this plan
src/state/theme.ts                    theme store + storage helpers
src/core/types.ts                     shared core types (data, policy docs, issues)
src/core/catalog/transform.ts         raw AWS JSON → SlimService; index; sanity
src/core/catalog/curated.ts           display names + categories
src/core/catalog/catalog.ts           Catalog + search
src/core/catalog/loader.ts            browser fetch + cache (only non-pure file in core; takes a fetch fn)
src/core/model/model.ts               RoleModel types + zod schema + defaults
src/core/model/share.ts               encode/decode share URL
src/core/arn.ts                       fillArn, classifyArn
src/core/engine/generic.ts            Grant → statements
src/core/engine/sid.ts                sid helpers
src/core/trust/trust.ts               Trust → trust doc
src/core/validate/*.ts                Layer-1 validator
src/core/generate.ts                  RoleModel → { policy, trust, issues }
src/core/export/json.ts               stable stringify + json export
src/core/__fixtures__/aws/*.json      real AWS JSON for s3, ec2, textract, iam, sts, logs
src/core/**/*.test.ts                 unit tests colocated
tests/sweep/*.test.ts                 exhaustive + property tests over public/data
```

---

### Task 1: Scaffold, tooling and CI

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `eslint.config.js`, `index.html`, `src/main.tsx`, `src/smoke.test.ts`, `.github/workflows/ci.yml`, `LICENSE` (MIT, "Om Hinge"), `README.md` (one-paragraph description)

**Interfaces:**
- Produces npm scripts used by every later task: `dev`, `build` (`tsc -b && vite build`), `typecheck` (`tsc -b --noEmit`), `lint` (`eslint .`), `test` (`vitest run`), `test:watch`, `sync-data` (`tsx scripts/sync-aws-data.ts`).

- [ ] **Step 1:** Scaffold with `npm create vite@latest . -- --template react-ts` inside the existing repo (keep `docs/`, `.gitignore`), then install: `@cloudscape-design/components @cloudscape-design/global-styles @phosphor-icons/react react-router-dom zustand zod lz-string` and dev: `vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom fast-check tsx eslint typescript-eslint @types/node`.
- [ ] **Step 2:** Configure `vite.config.ts` with Vitest: `environment: "jsdom"`, `setupFiles: ["src/test-setup.ts"]` (imports `@testing-library/jest-dom/vitest`), `include: ["src/**/*.test.ts?(x)", "tests/**/*.test.ts"]`, coverage provider v8 with thresholds `lines: 95, branches: 95` on `src/core/**` excluding `src/core/catalog/loader.ts` and fixtures. Add `"engines": { "node": ">=22" }`, tsconfig strict + `noUncheckedIndexedAccess`.
- [ ] **Step 3:** Write `src/smoke.test.ts`: `expect(1 + 1).toBe(2)`. Run `npm test` → PASS. Run `npm run typecheck`, `npm run lint`, `npm run build` → all exit 0.
- [ ] **Step 4:** Create `.github/workflows/ci.yml`: on `push` and `pull_request` to `main`; ubuntu-latest; `actions/setup-node` Node 22 with npm cache; `npm ci`, `npm run typecheck`, `npm run lint`, `npm test -- --coverage`, `npm run build`.
- [ ] **Step 5:** Commit `chore: scaffold Vite React TS app with tooling and CI`.

### Task 2: App shell, routes and dark theme

**Files:**
- Create: `src/state/theme.ts`, `src/state/theme.test.ts`, `src/ui/App.tsx`, `src/ui/AppShell.tsx`, `src/ui/App.test.tsx`, `src/ui/pages/LandingPage.tsx`, `src/ui/pages/TemplatesPage.tsx`, `src/ui/pages/BuilderPage.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces: `type ThemeMode = "dark" | "light"`; `readStoredTheme(storage: Pick<Storage,"getItem"> | undefined): ThemeMode`; `writeStoredTheme(storage: Pick<Storage,"setItem"> | undefined, mode: ThemeMode): void`; `useThemeStore` (zustand) with `{ mode: ThemeMode; toggle(): void }` that calls `applyMode(Mode.Dark | Mode.Light)` from `@cloudscape-design/global-styles` on init and on toggle; routes `/`, `/templates`, `/builder`.

- [ ] **Step 1: Failing tests** in `src/state/theme.test.ts`:
  - `defaults to dark when nothing stored` → `readStoredTheme({ getItem: () => null })` is `"dark"`.
  - `defaults to dark when storage throws` → getItem throws → `"dark"`; `readStoredTheme(undefined)` → `"dark"`.
  - `reads light` → stored `"light"` → `"light"`; stored `"banana"` → `"dark"`.
  - `write swallows errors` → setItem throws → no throw.
- [ ] **Step 2:** `npm test -- src/state` → FAIL (module missing).
- [ ] **Step 3:** Implement `src/state/theme.ts` (key `rolecraft.theme`).
- [ ] **Step 4: Failing UI test** `src/ui/App.test.tsx` using `MemoryRouter`-capable `App` (export `AppRoutes` for tests): renders "RoleCraft" brand text; navigating to `/builder` shows heading "Builder"; the theme toggle button has `aria-label="Switch to light theme"` while dark and flips label after click.
- [ ] **Step 5:** Implement `AppShell` with Cloudscape `TopNavigation` (identity title "RoleCraft", logo = Phosphor `Key` icon on an orange tile, utilities: Templates, Builder, GitHub link, theme toggle using Phosphor `Sun`/`Moon`), and placeholder pages (Cloudscape `ContentLayout` + `Header` with titles "RoleCraft", "Templates", "Builder"). Import `@cloudscape-design/global-styles/index.css` in `main.tsx`.
- [ ] **Step 6:** `npm test` → PASS; `npm run dev` and open `/` — dark Cloudscape UI renders, toggle switches to light and survives reload.
- [ ] **Step 7:** Commit `feat: app shell with routes and dark/light theme`.

### Task 3: Core types and AWS data transform

**Files:**
- Create: `src/core/types.ts`, `src/core/catalog/transform.ts`, `src/core/catalog/transform.test.ts`, `src/core/catalog/curated.ts`, `src/core/__fixtures__/aws/{s3,ec2,textract,iam,sts,logs}.json`

**Interfaces:**
- Produces in `src/core/types.ts`:
  ```ts
  export type AccessLevel = "List" | "Read" | "Write" | "Tagging" | "Permissions management";
  export const ACCESS_LEVELS: readonly AccessLevel[]; // in that order
  export type Category = "Compute" | "Storage" | "Database" | "Networking" | "Containers" | "Serverless" | "AI/ML" | "Analytics" | "Security & Identity" | "Management" | "Developer Tools" | "Messaging" | "Other";
  export interface SlimAction { name: string; level: AccessLevel; resources: string[]; label: string; conditionKeys: string[] }
  export interface SlimResource { name: string; arnFormats: string[]; conditionKeys: string[] }
  export interface SlimService { key: string; name: string; category: Category; actions: SlimAction[]; resources: SlimResource[]; conditionKeys: string[] }
  export interface ServiceIndexEntry { key: string; name: string; category: Category; actionCount: number }
  export interface ServiceIndex { generatedAt: string; services: ServiceIndexEntry[] }
  export type Severity = "error" | "warning" | "info";
  export interface Issue { id: string; severity: Severity; message: string; grantId?: string; path?: string }
  export type ConditionBlock = Record<string, Record<string, string | string[]>>;
  export interface Statement { Sid?: string; Effect: "Allow" | "Deny"; Principal?: Record<string, string | string[]> | "*"; Action: string | string[]; Resource?: string | string[]; Condition?: ConditionBlock }
  export interface PolicyDocument { Version: "2012-10-17"; Statement: Statement[] }
  ```
- Produces in `transform.ts`: `mapAccessLevel(props: {IsList:boolean;IsWrite:boolean;IsPermissionManagement:boolean;IsTaggingOnly:boolean} | undefined): AccessLevel`; `humanizeActionName(name: string): string`; `toSlimService(raw: unknown): SlimService` (throws `Error("Invalid service JSON: <reason>")` on shape mismatch, validated with zod); `buildIndex(services: SlimService[], generatedAt: string): ServiceIndex` (sorted by key); `assertSanity(index: ServiceIndex): void`.
- Produces in `curated.ts`: `CURATED: Record<string, { name: string; category: Category }>`; `POPULAR: string[]` = `["s3","ec2","lambda","ecr","eks","dynamodb","bedrock","iam","logs","secretsmanager","kms","sqs","textract","cloudfront"]`.

- [ ] **Step 1:** Download fixtures: `curl -s https://servicereference.us-east-1.amazonaws.com/v1/<k>/<k>.json -o src/core/__fixtures__/aws/<k>.json` for `s3 ec2 textract iam sts logs`.
- [ ] **Step 2: Failing tests** `transform.test.ts`:
  - `mapAccessLevel`: all false → `"Read"`; `IsList` → `"List"`; `IsWrite` → `"Write"`; `IsTaggingOnly`+`IsWrite` → `"Tagging"`; `IsPermissionManagement`+`IsWrite` → `"Permissions management"`; `undefined` → `"Read"`.
  - `humanizeActionName`: `"GetObject"` → `"Get object"`; `"ListMFADevices"` → `"List MFA devices"`; `"PutBucketACL"` → `"Put bucket ACL"`; `"CreateDBInstance"` → `"Create DB instance"`; `"GetObjectV2"`→ `"Get object V2"`.
  - `toSlimService(s3 fixture)`: `key` `"s3"`, `name` `"Amazon S3"`, `category` `"Storage"`; `GetObject` has level `"Read"` and resources containing `"object"`; `ListBucket` level `"List"`, resources containing `"bucket"`; resource `bucket` arnFormats `["arn:${Partition}:s3:::${BucketName}"]`.
  - `toSlimService(textract fixture)`: `AnalyzeDocument` → `resources: []`, level `"Read"`; uncurated key falls back to title case (call with a copy whose `Name` is `"made-up-svc"` → name `"Made Up Svc"`, category `"Other"`).
  - `toSlimService({})` throws `/Invalid service JSON/`.
  - Output determinism: actions sorted by name, resources sorted by name, conditionKeys sorted & deduped.
  - `buildIndex` sorts by key and sets `actionCount`.
  - `assertSanity` throws on 399 services; throws when `iam` missing; passes on 400 incl. s3/ec2/iam.
- [ ] **Step 3:** `npm test -- src/core/catalog` → FAIL.
- [ ] **Step 4:** Implement. `humanizeActionName` splits on the regex `/[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+/g`, lowercases every word except all-caps acronyms (length ≥ 2) and the first word (capitalized). Curated map covers at least every key in `POPULAR` plus: `apigateway, execute-api, sns, rds, elasticloadbalancing, autoscaling, cloudwatch, events, states, ecs, sts, ssm, route53, acm, cognito-idp, athena, glue, kinesis, firehose, elasticache, es, sagemaker, comprehend, rekognition, transcribe, translate, polly, codebuild, codepipeline, codedeploy, cloudformation, organizations, access-analyzer, cloudtrail, config, guardduty, securityhub, wafv2, ebs, elasticfilesystem, backup, redshift, airflow, appsync, amplify, batch, lightsail, ses, xray` with official AWS display names.
- [ ] **Step 5:** `npm test -- src/core/catalog` → PASS.
- [ ] **Step 6:** Commit `feat(core): types and AWS service data transform`.

### Task 4: Data sync script, generated data, catalog and loader

**Files:**
- Create: `scripts/sync-aws-data.ts`, `public/data/index.json`, `public/data/svc/*.json` (generated), `src/core/catalog/catalog.ts`, `src/core/catalog/catalog.test.ts`, `src/core/catalog/loader.ts`, `src/core/catalog/loader.test.ts`

**Interfaces:**
- Consumes: `toSlimService`, `buildIndex`, `assertSanity`.
- Produces: `interface Catalog { getService(key: string): SlimService | undefined; hasService(key: string): boolean }`; `createCatalog(services: SlimService[]): Catalog`; `searchServices(index: ServiceIndex, query: string, limit?: number /*20*/): ServiceIndexEntry[]`; `createLoader(fetchJson: (path: string) => Promise<unknown>): { loadIndex(): Promise<ServiceIndex>; loadService(key: string): Promise<SlimService>; loadServices(keys: string[]): Promise<Catalog> }` (memoizes per key, a failed load is not cached). Data paths: `/data/index.json`, `/data/svc/<key>.json`.

- [ ] **Step 1:** Implement `scripts/sync-aws-data.ts`: fetch list; fetch each service with concurrency 8 and up to 3 retries (backoff 1 s, 2 s, 4 s); `toSlimService`; write each to `public/data/svc/<key>.json` and `public/data/index.json` with `JSON.stringify(x)` (no indentation, deterministic order from Task 3), `generatedAt` = `new Date().toISOString().slice(0,10)`; run `assertSanity` **before** writing anything; delete svc files for services no longer listed. Exit code 1 on any failure.
- [ ] **Step 2:** Run `npm run sync-data` → exits 0; `public/data/svc/` has ≥ 400 files; report total size (`du -sh public/data`).
- [ ] **Step 3: Failing tests** `catalog.test.ts` (build a small index from fixtures): `searchServices(idx,"s3")[0].key === "s3"`; query `"text"` returns `textract` first; `"Simple Storage"` matches s3 by name; `""` returns `[]`; case-insensitive; respects limit. Ranking: exact key > key prefix > name word prefix > substring in key or name; ties by key. `createCatalog([...]).getService("nope")` is `undefined`.
- [ ] **Step 4: Failing tests** `loader.test.ts` with a fake `fetchJson`: `loadService("s3")` twice → fetch called once; rejected fetch then retry → fetch called twice; `loadServices(["s3","ec2"])` returns catalog with both.
- [ ] **Step 5:** Implement; tests PASS.
- [ ] **Step 6:** Commit `feat(core): AWS data sync, generated service data, catalog and loader` (include `public/data`).

### Task 5: RoleModel, schema and share URL

**Files:**
- Create: `src/core/model/model.ts`, `src/core/model/model.test.ts`, `src/core/model/share.ts`, `src/core/model/share.test.ts`

**Interfaces:**
- Produces (exact shapes from spec §6.1 with §15 amendments):
  ```ts
  export type Trust =
    | { kind: "service"; service: "ec2" | "lambda" | "ecs-tasks" }
    | { kind: "github"; owner: string; repo: string; ref: { type: "branch" | "tag" | "environment" | "pull_request"; value?: string } }
    | { kind: "account"; accountId: string; externalId?: string; requireMfa?: boolean }
    | { kind: "principal"; target: "group" | "user"; name: string };
  export type Scope = { type: "all" } | { type: "arns"; arns: string[] } | { type: "module"; data: unknown };
  export type AccessSelection = { type: "levels"; levels: AccessLevel[] } | { type: "actions"; actions: string[] } | { type: "preset"; preset: string };
  export interface Grant { id: string; service: string; module?: string; scope: Scope; access: AccessSelection }
  export interface RoleModel { version: 1; name: string; partition: "aws"; accountId?: string; region?: string; trust: Trust; grants: Grant[]; policyMode: "inline" | "managed"; managedPolicyArns: string[] }
  export const roleModelSchema: z.ZodType<RoleModel>;
  export function createEmptyModel(): RoleModel; // name "rolecraft-role", trust {kind:"service",service:"ec2"}, grants [], policyMode "managed", managedPolicyArns []
  export function newGrantId(): string;           // "g_" + 8 base36 chars
  ```
  `share.ts`: `encodeModel(m: RoleModel): string` (lz-string `compressToEncodedURIComponent` of JSON); `decodeModel(s: string): RoleModel | null`; `readModelFromHash(hash: string): RoleModel | null` (expects `#s=`).
- The schema is structural only (types, enums, `version` literal 1, array/string limits: max 100 grants, max 500 actions per grant, max 200 arns per grant, strings ≤ 2,048 chars). Value rules (role name, account ID regex) are the validator's job (Task 9) so users can hold an in-progress invalid value.

- [ ] **Step 1: Failing tests:** `createEmptyModel()` passes `roleModelSchema.parse`; schema rejects `version: 2`, unknown trust kind, `partition: "aws-cn"`, 101 grants. Share: round-trip equals input (`toEqual`) for empty model and for a model with one grant of each scope/access type; `decodeModel("garbage!!")` → `null`; valid compressed JSON of `{version:2}` → `null`; `readModelFromHash("#s=" + encodeModel(m))` → `m`; `readModelFromHash("#x=1")` → `null`; `decodeModel` never throws (fast-check: arbitrary strings → returns null or a schema-valid model).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(core): RoleModel schema and share URL encoding`.

### Task 6: ARN utilities

**Files:**
- Create: `src/core/arn.ts`, `src/core/arn.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BuildContext { partition: "aws"; accountId?: string; region?: string }
  export function fillArn(format: string, values: Record<string, string>, ctx: BuildContext): string;
  export function classifyArn(arn: string, svc: SlimService): string[]; // resource-type names; [] if none match
  ```
- `fillArn`: `${Partition}` → `ctx.partition`; `${Region}` → `ctx.region ?? "*"`; `${Account}` → `ctx.accountId ?? "*"`; other `${Name}` → `values[Name] ?? "*"`.
- `classifyArn`: convert each format to a regex — literal text escaped; `${Partition}` → `aws`; `${Region}` → `(?:[a-z0-9-]+|\*)`; `${Account}` → `(?:\d{12}|\*)?`; any other placeholder → `.+`; anchored `^…$`. Among resource types with a matching format, return those whose matching format has the **maximum literal character count** (spec §15). `"*"` is not classified (caller handles).

- [ ] **Step 1: Failing tests** (s3, logs, ec2 fixtures via `toSlimService`):
  - `fillArn("arn:${Partition}:s3:::${BucketName}", {BucketName:"data-lake"}, {partition:"aws"})` → `"arn:aws:s3:::data-lake"`.
  - Missing account/region/value → `*` substitutions: logs log-group format with `{LogGroupName:"/aws/lambda/x"}` and no ctx account → `"arn:aws:logs:*:*:log-group:/aws/lambda/x"`.
  - `classifyArn("arn:aws:s3:::data-lake", s3)` → `["bucket"]`.
  - `classifyArn("arn:aws:s3:::data-lake/reports/*", s3)` → contains `"object"` and **not** `"bucket"`.
  - `classifyArn("arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/x:*", logs)` → contains `"log-group"`.
  - `classifyArn("arn:aws:ec2:us-east-1:123456789012:instance/i-0abc", ec2)` → `["instance"]`.
  - `classifyArn("arn:aws:s3:::data-lake", ec2)` → `[]`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (precompile regexes per service lazily, cache in a `WeakMap<SlimService, …>`). **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(core): ARN fill and classification`.

### Task 7: Generic engine

**Files:**
- Create: `src/core/engine/sid.ts`, `src/core/engine/generic.ts`, `src/core/engine/generic.test.ts`

**Interfaces:**
- Consumes: `Grant`, `SlimService`, `BuildContext`, `classifyArn`.
- Produces:
  ```ts
  export interface BuildResult { statements: Statement[]; issues: Issue[] }
  export function resolveActions(svc: SlimService, access: AccessSelection): { actions: SlimAction[]; unknown: string[] };
  export function buildGenericStatements(grant: Grant, svc: SlimService, ctx: BuildContext): BuildResult;
  // sid.ts
  export function pascal(serviceKey: string): string;            // "s3"→"S3", "execute-api"→"ExecuteApi", "cognito-idp"→"CognitoIdp"
  export function baseSid(svc: string, access: AccessSelection, part: "All" | "Scoped" | "Global"): string;
  export function dedupeSids(statements: Statement[]): Statement[]; // second "X" → "X2", third → "X3"
  ```
- `baseSid`: levels → `pascal(svc)` + levels in `ACCESS_LEVELS` order with spaces removed (`"Permissions management"` → `"PermissionsManagement"`) + part; actions → `pascal(svc) + "Custom" + part`; preset → `pascal(svc) + pascal(preset with non-alphanumerics as separators) + part`. Resulting Sid must match `^[A-Za-z0-9]*$`.
- Rules: `preset` access is invalid for the generic engine → issue `E_PRESET_WITHOUT_MODULE` (error). Unknown action names → issue `E_UNKNOWN_ACTION` (error, lists names). Scope `module` → issue `E_MODULE_SCOPE_GENERIC` (error). Scope `all` → one statement, `Resource: "*"`, all resolved actions. Scope `arns`: classify each ARN; for each action with `resources: []` → global group; for each action with resources → the ARNs whose classified types intersect the action's resources; actions with none → issue `I_ACTION_NOT_SCOPED` (info, names action and the resource types it needs). Group scoped actions by identical ARN sets (one statement per distinct set; Sid `…Scoped`, dedupe later). If an action's resources list has more than one type and the grant's ARNs cover only some, issue `W_PARTIAL_RESOURCES` (warning: "`ec2:RunInstances` may also need access to: image, subnet, …"). Global group → statement `Resource: "*"`, Sid `…Global`, plus issue `I_REQUIRES_STAR` (info, lists actions). ARNs not classified for this service → issue `E_FOREIGN_ARN` (error). Single action/resource emitted as string; multiple as sorted array. Action strings `${svc.key}:${name}`. All issues carry `grantId`.
- Statements omit `Condition` (modules add conditions in Plan 2).

- [ ] **Step 1: Failing tests** `generic.test.ts` (fixtures s3, ec2, textract):
  - `levels Read on textract scope all` → one statement `{Sid:"TextractReadAll",Effect:"Allow",Action:[...all textract Read actions sorted],Resource:"*"}`.
  - `explicit single action` → `Action: "textract:AnalyzeDocument"` (string), `Resource:"*"`.
  - `splits global-only actions into a star statement`: s3 actions `["GetObject","ListAllMyBuckets"]` with arns `["arn:aws:s3:::b/*"]` → two statements: Scoped (`s3:GetObject`, `arn:aws:s3:::b/*`) and Global (`s3:ListAllMyBuckets`, `*`) + `I_REQUIRES_STAR`.
  - `drops actions whose resource types do not match`: s3 actions `["ListBucket","GetObject"]` with arns `["arn:aws:s3:::b/reports/*"]` → only GetObject statement; `I_ACTION_NOT_SCOPED` mentions `ListBucket` and `bucket`.
  - `groups by ARN set`: `["ListBucket","GetObject"]` with arns `["arn:aws:s3:::b","arn:aws:s3:::b/*"]` → ListBucket→bucket ARN statement, GetObject→object ARN statement, distinct Sids after `dedupeSids`.
  - `warns when only some resource types are covered`: ec2 `["RunInstances"]` with an instance ARN → `W_PARTIAL_RESOURCES` mentions `image` and `subnet`.
  - `unknown action` → `E_UNKNOWN_ACTION`, no statement for it, others still built.
  - `foreign ARN`: s3 grant with an ec2 ARN → `E_FOREIGN_ARN`.
  - `preset without module` → `E_PRESET_WITHOUT_MODULE`, no statements.
  - Determinism: same input twice → `toStrictEqual`.
  - `pascal("execute-api")` → `"ExecuteApi"`; `dedupeSids` on `[A, A, A]` → `A, A2, A3`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(core): generic policy engine for all services`.

### Task 8: Trust builder

**Files:**
- Create: `src/core/trust/trust.ts`, `src/core/trust/trust.test.ts`

**Interfaces:**
- Produces: `buildTrust(trust: Trust, ctx: BuildContext): { doc: PolicyDocument | null; issues: Issue[] }`.
- Exact outputs (no Sid in trust statements):
  - service → `{Effect:"Allow",Principal:{Service:"<ec2|lambda|ecs-tasks>.amazonaws.com"},Action:"sts:AssumeRole"}`.
  - github → `Principal:{Federated:"arn:aws:iam::<accountId>:oidc-provider/token.actions.githubusercontent.com"}`, `Action:"sts:AssumeRoleWithWebIdentity"`, `Condition:{StringEquals:{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com","token.actions.githubusercontent.com:sub":"<sub>"}}` where sub = branch `repo:<o>/<r>:ref:refs/heads/<v>`; tag `repo:<o>/<r>:ref:refs/tags/<v>`; environment `repo:<o>/<r>:environment:<v>`; pull_request `repo:<o>/<r>:pull_request`. If branch/tag value contains `*`: `aud` stays under `StringEquals`, `sub` moves to `StringLike`, issue `W_GITHUB_WILDCARD` (warning). Missing `ctx.accountId` → `doc: null`, issue `E_GITHUB_NEEDS_ACCOUNT`. Missing value for branch/tag/environment → `E_GITHUB_REF_VALUE`. Owner/repo containing `*` → `E_GITHUB_OWNER_REPO_WILDCARD`.
  - account → `Principal:{AWS:"arn:aws:iam::<id>:root"}`, `Action:"sts:AssumeRole"`; externalId → `Condition.StringEquals["sts:ExternalId"]`; requireMfa → `Condition.Bool["aws:MultiFactorAuthPresent"] = "true"`; no externalId → `W_NO_EXTERNAL_ID` (warning).
  - principal → `doc: null`, no error; target `"user"` → `I_PREFER_GROUP` (info).
- [ ] **Step 1: Failing tests** — one per bullet above, asserting the exact document with `toStrictEqual`, including all four GitHub ref types, wildcard branch, and account with both externalId and MFA.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(core): trust policy builder`.

### Task 9: Layer-1 strict validator

**Files:**
- Create: `src/core/validate/schema.ts`, `src/core/validate/conditions.ts`, `src/core/validate/policy.ts`, `src/core/validate/values.ts`, `src/core/validate/size.ts`, `src/core/validate/*.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function validateIdentityPolicy(doc: PolicyDocument, catalog: Catalog): Issue[];
  export function validateTrustPolicy(doc: PolicyDocument): Issue[];
  export function validateModelValues(model: RoleModel): Issue[];
  export function policySize(doc: PolicyDocument): number;   // JSON.stringify(doc).replace(/\s/g, "").length
  export const LIMITS = { managed: 6144, inline: 10240, trust: 2048 } as const;
  export function isKnownConditionOperator(op: string): boolean;
  export const GLOBAL_CONDITION_KEYS: readonly string[];       // entries ending in "/" are prefixes
  ```
- Issue ids (all `error` unless noted): `V_SCHEMA` (zod structural failure, path in `path`), `V_VERSION`, `V_EMPTY_STATEMENTS`, `V_SID_FORMAT`, `V_SID_DUPLICATE`, `V_ACTION_FORMAT` (must match `^[a-z0-9-]+:[A-Za-z0-9*?]+$` or be `"*"`), `V_UNKNOWN_SERVICE`, `V_UNKNOWN_ACTION` (wildcard actions must match ≥ 1 action), `V_ACTION_RESOURCE_MISMATCH` (for every non-`*` resource in a statement, `classifyArn` result must intersect the `resources` of **every** action in that statement; actions with `resources: []` require `Resource` to be exactly `"*"`), `V_CONDITION_OPERATOR`, `V_CONDITION_KEY` (key must be in `GLOBAL_CONDITION_KEYS` (exact or prefix), or in the union of the statement's actions' `conditionKeys`, their resource types' `conditionKeys`, and the service `conditionKeys`; templates `${TagKey}` / `<key>` in data match any non-empty suffix), `V_TRUST_PRINCIPAL` (missing, or `"*"`, or `{AWS:"*"}`), `V_TRUST_ACTION` (must be one of `sts:AssumeRole`, `sts:AssumeRoleWithWebIdentity`, `sts:AssumeRoleWithSAML`, `sts:TagSession`, `sts:SetSourceIdentity`; `Federated` principal requires `AssumeRoleWithWebIdentity` or `AssumeRoleWithSAML`), `V_TRUST_HAS_RESOURCE`, `V_GITHUB_SUB_MISSING` (Federated GitHub principal without a `…:sub` condition), values: `V_ROLE_NAME`, `V_ACCOUNT_ID` (model.accountId and account-trust id), `V_GITHUB_OWNER` (`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`), `V_GITHUB_REPO` (`^[A-Za-z0-9._-]{1,100}$`), `V_REGION` (`^[a-z]{2}(-gov)?-[a-z]+-\d$`), `V_PRINCIPAL_NAME` (group/user name `^[\w+=,.@-]{1,128}$`).
- Condition operators: the base set `StringEquals StringNotEquals StringEqualsIgnoreCase StringNotEqualsIgnoreCase StringLike StringNotLike NumericEquals NumericNotEquals NumericLessThan NumericLessThanEquals NumericGreaterThan NumericGreaterThanEquals DateEquals DateNotEquals DateLessThan DateLessThanEquals DateGreaterThan DateGreaterThanEquals Bool BinaryEquals IpAddress NotIpAddress ArnEquals ArnLike ArnNotEquals ArnNotLike Null`, optional prefix `ForAllValues:` / `ForAnyValue:`, optional suffix `IfExists` (not allowed on `Null`).
- Global keys list: `aws:CalledVia aws:CalledViaFirst aws:CalledViaLast aws:CurrentTime aws:EpochTime aws:FederatedProvider aws:MultiFactorAuthAge aws:MultiFactorAuthPresent aws:PrincipalAccount aws:PrincipalArn aws:PrincipalIsAWSService aws:PrincipalOrgID aws:PrincipalOrgPaths aws:PrincipalServiceName aws:PrincipalServiceNamesList aws:PrincipalTag/ aws:PrincipalType aws:Referer aws:RequestedRegion aws:RequestTag/ aws:ResourceAccount aws:ResourceOrgID aws:ResourceOrgPaths aws:ResourceTag/ aws:SecureTransport aws:SourceAccount aws:SourceArn aws:SourceIdentity aws:SourceIp aws:SourceOrgID aws:SourceOrgPaths aws:SourceVpc aws:SourceVpce aws:TagKeys aws:TokenIssueTime aws:UserAgent aws:userid aws:username aws:ViaAWSService aws:VpcSourceIp aws:Ec2InstanceSourceVpc aws:Ec2InstanceSourcePrivateIPv4`. Trust validation additionally allows `sts:ExternalId`, `sts:RoleSessionName`, `sts:SourceIdentity`, `token.actions.githubusercontent.com:aud`, `token.actions.githubusercontent.com:sub`.

- [ ] **Step 1: Failing tests** (fixtures catalog s3/ec2/textract/iam/sts/logs):
  - `accepts a correct S3 folder policy` (hand-written ListBucket on bucket ARN with `StringLike s3:prefix` + GetObject on `bucket/reports/*`) → `[]`.
  - `rejects ListBucket on object ARN` → `V_ACTION_RESOURCE_MISMATCH`.
  - `rejects GetObject on bucket ARN` → `V_ACTION_RESOURCE_MISMATCH`.
  - `requires star for global-only actions`: `textract:AnalyzeDocument` on an S3 ARN → `V_ACTION_RESOURCE_MISMATCH`.
  - `rejects unknown action` `s3:GetObjekt` → `V_UNKNOWN_ACTION`; `s3:Get*` accepted; `s3:Zzz*` → `V_UNKNOWN_ACTION`; `nosuchsvc:Get` → `V_UNKNOWN_SERVICE`; `S3:GetObject` → `V_ACTION_FORMAT`.
  - `rejects bad condition operator` `StringEqual` → `V_CONDITION_OPERATOR`; `ForAnyValue:StringLike` ok; `StringEqualsIfExists` ok; `NullIfExists` rejected.
  - `rejects unknown condition key` `s3:prefixx` → `V_CONDITION_KEY`; `aws:ResourceTag/env` on `ec2:StopInstances` ok; `s3:prefix` on `s3:ListBucket` ok.
  - Sids: `"Has Space"` → `V_SID_FORMAT`; duplicate → `V_SID_DUPLICATE`; empty `Statement` → `V_EMPTY_STATEMENTS`; `Version: "2008-10-17"` → `V_VERSION`; missing `Effect` → `V_SCHEMA`.
  - Trust: valid outputs of every Task 8 kind → `[]`; `Principal:"*"` → `V_TRUST_PRINCIPAL`; Federated + `sts:AssumeRole` → `V_TRUST_ACTION`; Resource present → `V_TRUST_HAS_RESOURCE`; GitHub provider without sub → `V_GITHUB_SUB_MISSING`.
  - Values: role name `"my role"` → `V_ROLE_NAME`; 65 chars → `V_ROLE_NAME`; account `"12345"` → `V_ACCOUNT_ID`; owner `"-bad"` → `V_GITHUB_OWNER`; region `"us-east-1"` ok, `"useast1"` → `V_REGION`.
  - `policySize` of `{"Version":"2012-10-17","Statement":[]}` equals its compact JSON length (39).
- [ ] **Step 2:** FAIL. **Step 3:** Implement (structure via zod first; skip semantic checks for a statement that fails structure). **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(core): strict layer-1 policy validator`.

### Task 10: Generate pipeline and JSON export

**Files:**
- Create: `src/core/generate.ts`, `src/core/generate.test.ts`, `src/core/export/json.ts`, `src/core/export/json.test.ts`

**Interfaces:**
- Consumes: everything above. Plan 2 will register smart modules here — leave a seam: `export type GrantBuilder = (grant: Grant, svc: SlimService, ctx: BuildContext) => BuildResult;` and `generate(model, catalog, builders?: Record<string, GrantBuilder>)` — a grant with `module` set uses `builders[module]`; missing builder → issue `E_UNKNOWN_MODULE`.
- Produces:
  ```ts
  export interface GenerateResult { policy: PolicyDocument | null; trust: PolicyDocument | null; issues: Issue[]; sizes: { policy: number; trust: number } }
  export function generate(model: RoleModel, catalog: Catalog, builders?: Record<string, GrantBuilder>): GenerateResult;
  export function hasErrors(issues: Issue[]): boolean;
  // export/json.ts
  export interface ExportFile { filename: string; language: "json" | "bash" | "powershell" | "hcl" | "yaml" | "markdown"; content: string }
  export function stringifyPolicy(doc: PolicyDocument): string; // 2-space indent, key order Version, Statement; statement keys Sid, Effect, Principal, Action, Resource, Condition; trailing newline
  export function exportJson(result: GenerateResult): ExportFile[]; // policy.json and/or trust.json, only for non-null docs
  ```
- `generate` order: `validateModelValues` → per grant: unknown service → `E_UNKNOWN_SERVICE` (with grantId), skip; build → collect statements + issues → `dedupeSids` → policy `null` with `I_NO_PERMISSIONS` if zero statements → `buildTrust` → `validateIdentityPolicy` / `validateTrustPolicy` → size checks: `E_POLICY_TOO_LARGE` when size > `LIMITS.managed` (managed mode) or > `LIMITS.inline` (inline mode); `E_TRUST_TOO_LARGE` > `LIMITS.trust`. Issues sorted: errors, warnings, infos; stable within severity.

- [ ] **Step 1: Failing tests** `generate.test.ts`:
  - `no grants gives null policy` → `policy === null`, issue `I_NO_PERMISSIONS`, trust present for ec2.
  - `unknown service yields issue not crash` → one grant `nosuchsvc` + one valid textract grant → policy has textract statement; `E_UNKNOWN_SERVICE` with that grant id.
  - `duplicate Sids across grants are deduped` (two identical textract grants → `TextractReadAll`, `TextractReadAll2`).
  - `managed size limit`: model with s3 scope all + all five levels in managed mode → if size > 6144 then `E_POLICY_TOO_LARGE`; same in inline mode uses 10240 (assert via `sizes.policy` and the presence/absence of the issue).
  - `principal trust` → `trust === null`, no error.
  - `module grant without builder` → `E_UNKNOWN_MODULE`.
  - Output of a realistic model has zero `error` issues (`hasErrors` false).
- [ ] **Step 2: Failing tests** `json.test.ts`: `stringifyPolicy` key order exact (compare with a literal multi-line string); `exportJson` returns `["policy.json","trust.json"]`, only `trust.json` when policy null, none when both null.
- [ ] **Step 3:** FAIL. **Step 4:** Implement. **Step 5:** PASS.
- [ ] **Step 6:** Commit `feat(core): generate pipeline and JSON export`.

### Task 11: Exhaustive sweep and property tests (Layer 3)

**Files:**
- Create: `tests/sweep/load-data.ts` (reads `public/data` from disk into a `Catalog`), `tests/sweep/exhaustive.test.ts`, `tests/sweep/property.test.ts`

**Interfaces:**
- Consumes: `generate`, `createCatalog`, `fillArn`, `encodeModel`/`decodeModel`.
- Produces: `sampleArns(svc: SlimService): string[]` in `load-data.ts` — for each resource type, `fillArn(firstFormat, values, {partition:"aws",accountId:"123456789012",region:"us-east-1"})` where every non-standard placeholder gets `"example"` (and `"example/path"` when it is the last placeholder and preceded by `/`).

- [ ] **Step 1: Write** `exhaustive.test.ts`: for **every** service in `public/data` × every level that has ≥ 1 action, two cases — scope `all` and scope `arns: sampleArns(svc)` — assert `generate(...)` returns no `error` issues except `E_POLICY_TOO_LARGE` (allowed for scope-all/big services; record count), and `policy` non-null for scope `all`. Also assert every selected action appears in the policy or in an `I_ACTION_NOT_SCOPED` issue (nothing silently lost). Print a summary line: services, cases, too-large count. Use `test.each` grouped per service so failures name the service.
- [ ] **Step 2:** Run `npm test -- tests/sweep/exhaustive` — investigate every failure. A failure is either an engine/validator bug (fix it in the owning file with a new regression unit test in that file's test) or a data quirk (add a documented exception list in `tests/sweep/known-quirks.ts` with the AWS doc reason; each entry needs a comment). Repeat until PASS. Report the final counts.
- [ ] **Step 3: Write** `property.test.ts` with fast-check (≥ 1,000 runs each): arbitrary RoleModel built from real catalog keys/actions/levels, random subsets of `sampleArns`, all trust kinds with valid values →
  - no thrown exceptions;
  - `generate` deterministic (`toStrictEqual` on two calls);
  - every non-null policy passes `validateIdentityPolicy` with zero errors other than size;
  - every non-null trust passes `validateTrustPolicy` with zero errors;
  - `decodeModel(encodeModel(m))` equals `m`.
- [ ] **Step 4:** Run → PASS (fix root causes as in Step 2). Run full `npm test -- --coverage` → coverage thresholds met; `npm run typecheck && npm run lint && npm run build` → exit 0.
- [ ] **Step 5:** Commit `test: exhaustive service sweep and property-based tests`.
