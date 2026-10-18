# RoleCraft Plan 4 — Builder UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working `/builder`: a three-step wizard (Trusted entity → Permissions → Review and export) with a service sidebar, Sentence and Grid editors over one `RoleModel`, and a live output panel (policy/trust JSON, lint issues, explainer, size meter, copy). It also adds share URLs, lazy-loaded export previews with a ZIP download that is blocked while there are errors, the "use a desktop" card, and Playwright E2E that fails on any console error.

**Architecture:** One Zustand store holds the `RoleModel`, and pure model operations in `src/state/` change it. A second store loads service data on demand. The output is derived by calling the existing core (`generate`, `explain`, `stringifyPolicy`); the UI never builds JSON. Both editors are views over the same `grants` array, so switching editors writes nothing. Everything that pulls in `yaml` or `fflate` (all of `src/core/export` except `json.ts`/`types.ts`) is reachable only through one dynamic `import()`. A build check and an ESLint rule keep it that way.

**Tech Stack:** React 19, Cloudscape components, Phosphor icons, Zustand 5, React Router 7, lz-string (already in `share.ts`), Vitest + Testing Library + Cloudscape `test-utils/dom` (UI unit tests), Playwright (Chromium) for E2E.

**Spec:** `docs/superpowers/specs/2026-10-16-rolecraft-design.md`: §3 (data flow), §6.1/§6.5/§6.6/§6.8, §8 (UI), §9 (errors), §10 (CSP), §11 "UI tests", §14 milestone 4. Layout and visuals follow `docs/design/approved-mockup.html` (Workspace tab).

## Global Constraints

- Branch `feat/plan-4-builder-ui`, created from `main` after Plan 3 (PR #1) merges. Push after every task. Never force-push or touch `main`.
- **UI never builds JSON itself; only `core/` does.** Policy/trust text shown or copied is always `stringifyPolicy(doc)`; export files are always `exportAll(...)`'s files.
- `src/core/**` stays pure (ESLint-enforced). Any change under `src/core/export` must pass `npm run export-fixtures && bash scripts/check-exports.sh` (or the GitHub Actions "Export tooling" run). Snapshots must stay byte-identical unless the task says otherwise.
- Gates before every commit: `npm test -- --coverage` (src/core ≥ 95% lines and branches), `npm run typecheck`, `npm run lint`, `npm run build`. From Task 9: `npm run check-bundle`. From Task 11: `npm run e2e`.
- **Lazy export:** `yaml` and `fflate` must not be in the initial bundle. Only `src/ui/export/exporters.ts` may import `src/core/export/{index,cli-bash,cli-ps,terraform,cloudformation,readme,zip}`, and only `src/ui/export/lazy.ts` may import `exporters.ts`, via `import()`.
- Builder needs a viewport ≥ 1024 px. Below that `/builder` shows the card "Works best on a laptop or desktop" with **Copy link** and **Share** (`navigator.share`, hidden when unavailable).
- Theme: dark by default; the toggle and its `localStorage` persistence already exist (`src/state/theme.ts`). Don't re-implement them.
- No `dangerouslySetInnerHTML`, no inline scripts, no `eval` (CSP `default-src 'self'`). Every icon-only button has an `aria-label`. No emojis; icons from Phosphor or Cloudscape built-ins.
- Share URL: `#s=<encodeModel(model)>` written with `history.replaceState` (never `pushState`), debounced 300 ms.
- UI copy is short, plain English. Error text says what to do ("Fix the errors before exporting.").
- Commits: `git -c user.name="Om Hinge" -c user.email="om.hinge.2635@gmail.com" commit <explicit paths>`; message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Record every decision the plan leaves open as `Ruling: <decision> — <why> — <cost if wrong>` in `docs/superpowers/plans/2026-10-18-plan-4-ledger.md` (task status table + rulings, same layout as the Plan 3 handoff).

## Review Focus

1. **Share link too long to restore.** `decodeModel` rejects encoded strings over 8,192 characters, so a big role would write a hash that silently fails to open, or leave a stale hash that restores an older role. Expected: no hash is written over the limit, any old hash is cleared, and the Share button explains "This role is too large to share as a link. Export it instead." (Task 10 tests `syncHash` at 8,192 and 8,193 characters, and that a stale hash is cleared.)
2. **Service data still loading, failed, or removed from AWS data.** Before a grant's service JSON arrives, `generate` would report a false "Unknown service". Expected: the output panel shows "Loading service data…". A failed fetch shows Retry. A service missing from `index.json` is marked "Service no longer in AWS data" and the generated policy leaves it out with an error. (Task 2 `deriveOutput` tests; Task 6 row status test.)
3. **Lazy export chunk fails to load** (offline, or a new deploy removed the old hashed chunk). Expected: "Couldn't load the exporters. Check your connection and try again." with a Retry that loads again, not an unhandled rejection. (Task 9 `loadExporters` test with a rejecting importer, then success on retry.)
4. **Clipboard unavailable or denied** (http origin, permissions policy, old browser). Expected: a modal with the text pre-selected in a read-only textarea and the hint "Press Ctrl+C (⌘C on Mac) to copy." (Task 3 `copyText` tests: missing API and a rejected promise.)
5. **Grants the grid can't edit cell by cell** (individual-action grants, module grants, ARN scopes, several grants for one service). Expected: switching Sentence ⇄ Grid ⇄ Sentence leaves the model reference-identical, and the grid shows those grants read-only where a checkbox can't express them. (Task 7 round-trip test over a model with every grant shape.)

---

## File Structure

```
src/state/model-ops.ts            pure RoleModel operations + defaults for new grants/trust
src/state/builder.ts              useBuilderStore: model, step, editor, focusTarget, shareStatus
src/state/catalog.ts              createCatalogStore(loader) + useCatalogStore (fetch-backed)
src/state/derive.ts               deriveOutput(model, catalog) + useDerived()
src/state/share-sync.ts           hash read/write, size guard, hashchange
src/ui/common/clipboard.ts        copyText() + CopyFallbackModal
src/ui/common/download.ts         downloadFile(name, data, mime)
src/ui/common/SafeMarkdown.tsx    text-only renderer: paragraphs, fences, `code`, **bold**, \-escapes
src/ui/common/useIsDesktop.ts
src/ui/builder/BuilderWorkspace.tsx   3-column grid + StepHeader + Previous/Next
src/ui/builder/BuilderErrorBoundary.tsx
src/ui/builder/DesktopOnlyCard.tsx
src/ui/builder/StepHeader.tsx
src/ui/builder/issues.ts          issuesAt / grantIssues / focus ids
src/ui/builder/useFocusTarget.ts
src/ui/builder/sidebar/ServiceSidebar.tsx
src/ui/builder/trust/TrustStep.tsx
src/ui/builder/permissions/PermissionsStep.tsx   Sentences | Grid toggle + summary
src/ui/builder/permissions/SentenceEditor.tsx
src/ui/builder/permissions/GridEditor.tsx
src/ui/builder/permissions/ActionPicker.tsx
src/ui/builder/scope/ScopeEditor.tsx         dispatch by module id / generic
src/ui/builder/scope/S3ScopeEditor.tsx, Ec2ScopeEditor.tsx, FieldsScopeEditor.tsx, ArnScopeEditor.tsx
src/ui/builder/scope/module-fields.ts        field specs for the single-field modules
src/ui/builder/review/ReviewStep.tsx
src/ui/builder/output/OutputPanel.tsx, StatusLine.tsx, SizeMeter.tsx, IssuesList.tsx, Summary.tsx, CodeView.tsx
src/ui/export/exporters.ts        the ONLY static importer of heavy core/export modules
src/ui/export/lazy.ts             loadExporters() (memoized import(), resets on failure) + useExporters()
src/ui/export/FormatTabs.tsx      CLI (bash/PowerShell) · Terraform · CloudFormation previews + how-to-apply
src/ui/export/ExportModal.tsx
src/core/export/readme.ts         + applySections(input) (README text shared with the UI)
src/core/model/share.ts           + export MAX_SHARE_LENGTH
scripts/check-bundle.ts           asserts yaml/fflate chunks are dynamic-only
playwright.config.ts, tests/e2e/*.spec.ts, tests/e2e/fixtures.ts
```

UI unit tests are colocated (`*.test.tsx`). They use `@testing-library/react` and `@cloudscape-design/components/test-utils/dom` wrappers. Catalog-dependent UI tests create a catalog store whose loader reads `public/data` from disk (allowed outside `src/core`).

---

### Task 1: Builder store and model operations

**Files:** Create `src/state/model-ops.ts`, `model-ops.test.ts`, `src/state/builder.ts`, `builder.test.ts`.

**Interfaces:**
- Consumes: `RoleModel`, `Grant`, `Trust`, `createEmptyModel`, `newGrantId` (core/model), `MODULES` (core/engine/modules/registry), `SlimService`, `ACCESS_LEVELS`.
- Produces:
  ```ts
  // model-ops.ts (pure, never mutates its input)
  export type ModelFields = Partial<Pick<RoleModel, "name" | "accountId" | "region" | "policyMode" | "managedPolicyArns">>;
  export function setFields(m: RoleModel, patch: ModelFields): RoleModel;   // "" for accountId/region deletes the key
  export function setTrust(m: RoleModel, trust: Trust): RoleModel;
  export function addGrant(m: RoleModel, g: Grant): RoleModel;              // appends
  export function updateGrant(m: RoleModel, id: string, f: (g: Grant) => Grant): RoleModel; // unknown id → same reference
  export function removeGrant(m: RoleModel, id: string): RoleModel;
  export function moduleFor(serviceKey: string): string | undefined;        // module id whose .service === key
  export function defaultModuleData(moduleId: string): unknown;
  export function newGrantFor(svc: SlimService): Grant;
  export function defaultTrust(kind: Trust["kind"]): Trust;
  // builder.ts
  export type Step = 0 | 1 | 2;
  export type EditorMode = "sentences" | "grid";
  export interface BuilderState {
    model: RoleModel; step: Step; editor: EditorMode; focusTarget: string | null;
    shareStatus: "ok" | "too-large";
    setFields(p: ModelFields): void; setTrust(t: Trust): void;
    addGrant(g: Grant): void; updateGrant(id: string, f: (g: Grant) => Grant): void; removeGrant(id: string): void;
    replaceModel(m: RoleModel): void; reset(): void;
    setStep(s: Step): void; setEditor(e: EditorMode): void;
    focus(target: string | null): void; setShareStatus(s: BuilderState["shareStatus"]): void;
  }
  export const useBuilderStore: UseBoundStore<StoreApi<BuilderState>>;
  ```
- `defaultModuleData`: s3 `{ bucket: "", prefixes: [""] }`; ec2 `{ selector: { type: "tag", key: "", value: "" } }`; ecr `{ repository: "" }`; eks `{ cluster: "" }`; lambda `{ functionName: "" }`; dynamodb `{ table: "" }`; logs `{ logGroup: "" }`; secretsmanager `{ secretName: "" }`; kms `{ keyArn: "" }`; sqs `{ queueName: "" }`.
- `newGrantFor(svc)`: when a module exists → `{ module, scope: { type: "module", data: defaultModuleData(id) }, access: { type: "preset", preset: <first preset id> } }`. Otherwise generic: `levels: ["Read"]` if the service has a Read action, else the first level that has actions. `scope: { type: "arns", arns: [] }` if any action has resource types, else `{ type: "all" }`. Id from `newGrantId()`.
- `defaultTrust`: service → `{ kind: "service", service: "ec2" }`; github → `{ kind: "github", owner: "", repo: "", ref: { type: "branch", value: "main" } }`; account → `{ kind: "account", accountId: "" }`; principal → `{ kind: "principal", target: "group", name: "" }`.

- [ ] **Step 1: Failing tests.** `setFields(m, { accountId: "" })` has no `accountId` key. `setFields` returns a new object and leaves the input deep-equal to its snapshot. `updateGrant(m, "nope", f) === m`. `newGrantFor(s3)` → module `s3`, preset `list` (first S3 preset), data `{ bucket: "", prefixes: [""] }`. `newGrantFor(textract)` → generic `levels: ["Read"]`, `arns: []`. A service whose actions all have `resources: []` → `scope.type === "all"`. Every `defaultModuleData(id)` for `id in MODULES` parses with `roleModelSchema` inside a model. Store: `setEditor("grid")` keeps `state.model` reference-identical (`toBe`). `reset()` returns `createEmptyModel()` with `step 0`.
- [ ] **Step 2:** Run `npx vitest run src/state`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement. The store uses `create` from zustand. Every action calls a model-ops function.
- [ ] **Step 4:** PASS, plus the full gates.
- [ ] **Step 5:** Commit `feat(state): builder store and pure model operations`.

### Task 2: Catalog store and derived output

**Files:** Create `src/state/catalog.ts`, `catalog.test.ts`, `src/state/derive.ts`, `derive.test.ts`.

**Interfaces:**
- Consumes: `createLoader`, `Loader`, `createCatalog`, `generate`, `explain`, `ExportInput` (type only, `core/export/types`), `ServiceIndex`, `SlimService`.
- Produces:
  ```ts
  export type LoadStatus = "loading" | "ready" | "error" | "missing";   // missing = not listed in index.json
  export interface CatalogState {
    index: ServiceIndex | null; indexStatus: "idle" | "loading" | "ready" | "error";
    services: Record<string, SlimService>; status: Record<string, LoadStatus>;
    ensureIndex(): Promise<void>; ensureServices(keys: string[]): Promise<void>; retry(key: string): Promise<void>;
  }
  export function createCatalogStore(loader: Loader): UseBoundStore<StoreApi<CatalogState>>;
  export const useCatalogStore: ReturnType<typeof createCatalogStore>;   // fetch-backed; non-2xx → throws
  export const CatalogContext: React.Context<ReturnType<typeof createCatalogStore>>; // default useCatalogStore; tests inject
  // derive.ts
  export type Derived =
    | { kind: "loading"; pending: string[] }
    | { kind: "error"; failed: string[] }
    | { kind: "ready"; input: ExportInput; missing: string[] };
  export function deriveOutput(model: RoleModel, cat: Pick<CatalogState, "index" | "services" | "status">): Derived;
  export function useDerived(): Derived;   // memoized on (model, services, status)
  ```
- `ensureServices` first awaits `ensureIndex`. Keys not in the index become `missing` without a fetch. A fetch failure sets `error`, and `retry` re-fetches (the loader already drops failed promises).
- `deriveOutput`: if any grant service is `error` → `error`. Otherwise, if any is `loading` (or has no status yet) → `loading`. Otherwise `ready`: the catalog is built from the `ready` services only, so `missing` ones produce `E_UNKNOWN_SERVICE` from `generate`. `input = { model, result: generate(model, catalog), summary: explain(model, catalog) }`.

- [ ] **Step 1: Failing tests** (fake loader backed by `public/data` files read with `node:fs`, plus a loader whose `s3` fetch rejects once). `ensureServices(["s3"])` → status `ready`. Unknown key `gone-svc` → `missing` with no `loadService` call. A rejected fetch → `error`, then `retry` → `ready`. `deriveOutput` with a pending service → `{ kind: "loading", pending: ["s3"] }`. With an error → `kind "error"`. With a missing service → `ready`, `missing: ["gone-svc"]`, and `result.issues` contains `E_UNKNOWN_SERVICE` with that grant's id. Empty model → `ready` with `I_NO_PERMISSIONS`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates.
- [ ] **Step 5:** Commit `feat(state): on-demand catalog store and derived output`.

### Task 3: Builder frame — layout, steps, desktop card, error boundary, clipboard

**Files:** Create `src/ui/common/clipboard.ts(+test)`, `src/ui/common/useIsDesktop.ts(+test)`, `src/ui/builder/{BuilderWorkspace,StepHeader,DesktopOnlyCard,BuilderErrorBoundary}.tsx` + tests. Modify `src/ui/pages/BuilderPage.tsx`, `src/ui/global.css`, `src/ui/App.test.tsx` (the "Builder" heading assertion changes).

**Interfaces:**
- Produces:
  ```ts
  export async function copyText(text: string, nav?: Pick<Navigator, "clipboard">): Promise<"copied" | "fallback">;
  export function CopyFallbackModal(props: { text: string | null; onDismiss(): void }): JSX.Element; // textarea readOnly, selected on open
  export function useCopy(): { copy(text: string): Promise<void>; modal: JSX.Element };               // flashes "Copied"
  export function useIsDesktop(query?: string): boolean;            // default "(min-width: 1024px)", reacts to change events
  export function BuilderWorkspace(props: { sidebar: ReactNode; steps: [ReactNode, ReactNode, ReactNode]; output: ReactNode }): JSX.Element;
  ```
- Layout: CSS grid `240px minmax(0, 1fr) 400px`, full height below the top nav. Each column scrolls on its own. The center column has `StepHeader` (labels exactly "Trusted entity", "Permissions", "Review and export"; each step is a button; the current one has `aria-current="step"`) above the step content, with **Previous** / **Next** at the bottom (Previous hidden on step 0; Next hidden on step 2).
- `BuilderPage`: `useIsDesktop() ? <BuilderErrorBoundary><Builder/></BuilderErrorBoundary> : <DesktopOnlyCard/>`. In this task `<Builder/>` passes placeholders for the sidebar, steps and output. Later tasks replace them.
- DesktopOnlyCard: heading "Works best on a laptop or desktop", the text "The builder needs a screen at least 1024 pixels wide. Open this link on a computer to keep going.", **Copy link** (copies `location.href`) and **Share** (only when `typeof navigator.share === "function"`; calls `navigator.share({ title: "RoleCraft", url: location.href })` and swallows `AbortError`).
- Error boundary fallback: "Something went wrong in the builder." plus **Reset builder**. Reset calls `useBuilderStore.getState().reset()`, then `history.replaceState(null, "", location.pathname)`, then re-mounts its children. `componentDidCatch` logs with `console.error` (the E2E counts it).

- [ ] **Step 1: Failing tests.** `copyText` with `nav.clipboard.writeText` resolving → `"copied"`; missing `clipboard` → `"fallback"`; `writeText` rejecting → `"fallback"`. `useIsDesktop` with a stubbed `matchMedia` (false → true via a change event) re-renders. At 1024+ BuilderPage shows the three step labels; below that, the card heading. Share is hidden when `navigator.share` is undefined. A child that throws renders the fallback; clicking Reset clears the hash and renders the children again. Clicking "Review and export" sets `step` to 2 in the store.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates.
- [ ] **Step 5:** Commit `feat(ui): builder frame, steps, desktop-only card, error boundary, clipboard fallback`.

### Task 4: Service sidebar

**Files:** Create `src/ui/builder/sidebar/ServiceSidebar.tsx(+test)`; wire into `BuilderPage`.

**Interfaces:**
- Consumes: `searchServices`, `POPULAR`, `CURATED` (core/catalog), `CatalogContext`, `useBuilderStore`, `newGrantFor`.
- Produces: `export function ServiceSidebar(): JSX.Element` and `export const SERVICE_SEARCH_ID = "service-search"` (the "Add permission" button and Ctrl+K focus it).
- Sections in order: search input (placeholder "Search 450+ services", `aria-label="Search services"`, results under it via `searchServices(index, q, 20)`); **In this role** (one entry per service with a grant, with its count, in order of first appearance); **Popular** (`POPULAR` entries that exist in the index); **Browse by category** (one `ExpandableSection` per category present, entries sorted by name); **A–Z** (collapsed `ExpandableSection` with all services).
- Choosing a service: `await ensureServices([key])`. When it's `ready`, `addGrant(newGrantFor(svc))`, `setStep(1)` and `focus("grant:" + id)`. On `error`, show an inline error with Retry. Ctrl+K / ⌘K (`keydown` on `window`, `preventDefault`) focuses the search.
- Index load failure: `Alert type="error"` "Couldn't load the AWS service list." with **Retry** (`ensureIndex`). Grants already loaded keep working.

- [ ] **Step 1: Failing tests** (with the real index). Typing "s3" lists "Amazon S3" first. Pressing Ctrl+K focuses the search input. Choosing S3 adds one grant with `module: "s3"`, sets step 1 and sets focusTarget `grant:<id>`. "In this role" shows "Amazon S3" with count 2 after adding it twice. A failing index loader shows the Retry alert, and Retry recovers.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates.
- [ ] **Step 5:** Commit `feat(ui): service sidebar with search, popular, categories and A-Z`.

### Task 5: Step 1 — Trusted entity

**Files:** Create `src/ui/builder/issues.ts(+test)`, `src/ui/builder/useFocusTarget.ts`, `src/ui/builder/trust/TrustStep.tsx(+test)`.

**Interfaces:**
- Produces:
  ```ts
  export function issuesAt(issues: Issue[], path: string): Issue[];          // exact path match, errors first
  export function errorTextAt(issues: Issue[], path: string): string | undefined; // first error message
  export function grantIssues(issues: Issue[], grantId: string): Issue[];
  export function focusIdFor(issue: Issue): { step: Step; target: string } | null;
    // grantId → {1, "grant:<id>"}; path "trust.*" → {0, "field:<path>"}; "name" | "accountId" | "region" | "policyMode" | "managedPolicyArns*" → {2, "field:<path>"}; else null
  export function useFocusTarget<T extends HTMLElement>(id: string): React.RefObject<T | null>; // scrolls into view + focuses first focusable when store.focusTarget === id, then clears it
  ```
- Trust kinds (Cloudscape `Tiles`): "EC2 instance", "Lambda function", "ECS task", "GitHub Actions", "Another AWS account", "IAM group or user". The three services map to `{ kind: "service", service }`. Picking another kind sets `defaultTrust(kind)`.
- Fields (each a `FormField` with `errorText={errorTextAt(issues, path)}`, wrapped for `useFocusTarget("field:" + path)`):
  - GitHub: owner (`trust.owner`), repo (`trust.repo`), ref type select (Branch / Tag / Environment / Pull requests), value (hidden for `pull_request`; label follows the type), and **AWS account ID** (`accountId`, writes `model.accountId`; description "Needed for the GitHub OIDC provider ARN.").
  - Account: account ID (`trust.accountId`), External ID (optional), "Require MFA" checkbox.
  - Principal: Group / User segmented control, name (`trust.name`), plus the info text "The policy is attached to an existing IAM group or user. No role is created."
- Issues come from `useDerived()` (`ready` only). Field errors show after the field's first blur or after any "Jump to" focus, not while the user types into an empty field for the first time.

- [ ] **Step 1: Failing tests.** `focusIdFor` maps each path class as above. Picking "GitHub Actions" sets the github default trust. Typing owner `-bad` and blurring shows "GitHub owner must be 1-39 letters…". The pull_request ref hides the value input. Picking "IAM group or user" then "User" sets `target: "user"`. `useFocusTarget` focuses the element and clears `focusTarget`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates.
- [ ] **Step 5:** Commit `feat(ui): trusted entity step with field-level validation`.

### Task 6: Step 2 — Sentence editor and scope editors

**Files:** Create `src/ui/builder/permissions/{PermissionsStep,SentenceEditor}.tsx(+tests)`, `src/ui/builder/scope/{ScopeEditor,S3ScopeEditor,Ec2ScopeEditor,FieldsScopeEditor,ArnScopeEditor}.tsx(+tests)`, `src/ui/builder/scope/module-fields.ts`.

**Interfaces:**
- Consumes: `MODULES`, `fillArn`, `ACCESS_LEVELS`, `grantIssues`, `useDerived`, `CatalogContext`, `SERVICE_SEARCH_ID`.
- Produces:
  ```ts
  export function PermissionsStep(): JSX.Element;            // Sentences|Grid control (Task 7 adds Grid), editor, Summary (Task 8 fills)
  export function SentenceEditor(): JSX.Element;
  export function ScopeEditor(props: { grant: Grant; svc: SlimService; issues: Issue[]; onChange(scope: Scope): void }): JSX.Element;
  export interface FieldSpec { key: string; label: string; kind: "text" | "checkbox"; optional?: boolean; placeholder?: string; description?: string }
  export const MODULE_FIELDS: Record<"ecr" | "eks" | "lambda" | "dynamodb" | "logs" | "secretsmanager" | "kms" | "sqs", FieldSpec[]>;
  ```
- Row (one per grant, wrapped in `useFocusTarget("grant:" + id)`): service name · verb `Select` · scope summary (e.g. "data-lake / reports/", "All resources", "2 resources", "Not set") · remove button (`aria-label="Remove <service name> permission"`). Below it is an expandable scope editor, open by default while the grant has errors. The row's error and warning messages from `grantIssues` are listed under the row.
- Verb options: for a module grant, its presets (`label`); for a generic grant, one option per level the service has ("List", "Read", "Write", "Tagging", "Permissions management"). When the grant holds several levels, one extra option shows the current combination ("List + Read"). For an actions grant, a disabled option shows "N individual actions". Picking a level option sets `levels: [level]`.
- Scope editors: S3 (bucket, prefixes as a list of inputs with Add/Remove, the description "Leave empty for the whole bucket. `${aws:username}` is allowed.", "Allow navigating to the folder" checkbox, optional KMS key ARN). EC2 (radio: "Instances with tag" key/value · "Specific instance IDs" list · "All instances"). `FieldsScopeEditor` driven by `MODULE_FIELDS`: dynamodb adds the `includeIndexes` checkbox (default on); logs adds `createGroup` (default on); secretsmanager and sqs add an optional `kmsKeyArn`. Optional blank text fields are removed from `data`, never stored as `""`. Generic `ArnScopeEditor`: radio "Specific resources" / "All resources (*)", a list of ARN inputs, and **Build an ARN**: resource-type select from `svc.resources`, one input per `${Placeholder}` other than Partition/Region/Account, preview `fillArn(format, values, ctx)`, then Add.
- Row status from the catalog: `loading` → spinner "Loading Amazon S3…"; `error` → "Couldn't load this service." + Retry; `missing` → "Service no longer in AWS data. It is left out of the policy." with only the remove button active.
- "Add permission" button under the list focuses `#service-search`.

- [ ] **Step 1: Failing tests.** For an S3 grant, typing bucket `data-lake` and prefix `reports/` and choosing the verb "list + read" gives a model grant deep-equal to `moduleGrant(id, "s3", "list-read", { bucket: "data-lake", prefixes: ["reports/"], allowNavigation: false })`. Bucket `Bad_Bucket` shows "not a valid S3 bucket name" under the row. Clearing the optional KMS field leaves no `kmsKeyArn` key. For textract, the Build-an-ARN flow adds an ARN that passes generic classification (no `E_FOREIGN_ARN` in derived issues). The remove button removes the grant. A `missing` service row shows the "no longer in AWS data" text. The verb select of a two-level grant shows "List + Read".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates.
- [ ] **Step 5:** Commit `feat(ui): sentence editor with module and ARN scope editors`.

### Task 7: Grid editor, individual actions, Sentences ⇄ Grid

**Files:** Create `src/ui/builder/permissions/{GridEditor,ActionPicker}.tsx(+tests)`; modify `PermissionsStep.tsx`.

**Interfaces:**
- Produces: `export function GridEditor(): JSX.Element`, `export function ActionPicker(props: { grant: Grant; svc: SlimService; onChange(access: AccessSelection): void }): JSX.Element`.
- `PermissionsStep` renders `SegmentedControl` (options "Sentences" / "Grid", bound to `store.editor`). **Switching only calls `setEditor`; it never writes the model.**
- Grid: one `Container` per service (in order of first grant), header = service name + **Add scope** (adds `newGrantFor(svc)`). A `Table` row is one grant, with a "Scope" column (summary + an edit button that opens the same `ScopeEditor` in a `Modal`). Generic grants get one checkbox column per access level, and a level the service lacks shows "—". For an actions grant, the level cells merge into the text "N individual actions" and are read-only. Module grants get one radio per preset, with columns = the module's presets. Each generic row has an expandable **Pick individual actions** `ActionPicker`: a `Multiselect` with filtering, option groups by level (in `ACCESS_LEVELS` order), each option labelled with the action `label` and the name as `description`. Its value sets `{ type: "actions", actions }`. Toggling a level checkbox on an actions grant is disabled; the hint says "Clear the individual actions to use access levels." When the picker is cleared, the grant becomes `{ type: "levels", levels: [] }`.

- [ ] **Step 1: Failing tests.** Round trip: a model holding a module S3 grant, an EC2 tag grant, a textract levels grant with `scope: all`, a cloudfront actions grant with ARNs, and two textract grants. Rendering Sentences → Grid → Sentences → Grid leaves `useBuilderStore.getState().model` `toBe` the original. Checking "List" on the textract row sets `levels: ["List", "Read"]` (in `ACCESS_LEVELS` order). Picking `CreateInvalidation` in the picker sets `{ type: "actions", actions: ["CreateInvalidation"] }`. Clearing it gives `levels: []`. An actions grant's level checkboxes are disabled. A module row's radio switches the preset.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates.
- [ ] **Step 5:** Commit `feat(ui): grid editor and individual action picker over the same model`.

### Task 8: Output panel and Step 3 — Review

**Files:** Create `src/ui/builder/output/{OutputPanel,StatusLine,SizeMeter,IssuesList,Summary,CodeView}.tsx(+tests)`, `src/ui/builder/review/ReviewStep.tsx(+test)`. Modify `PermissionsStep.tsx` (summary below the editor).

**Interfaces:**
- Consumes: `useDerived`, `stringifyPolicy` (`core/export/json`), `policyLimit` / `LIMITS` (`core/validate/size`), `focusIdFor`, `useCopy`.
- Produces:
  ```ts
  export function OutputPanel(props?: { extraTabs?: TabsProps.Tab[] }): JSX.Element; // Task 9 passes the format tabs
  export function IssuesList(props: { issues: Issue[]; severities?: Severity[] }): JSX.Element; // each with "Jump to" when focusIdFor() ≠ null
  export function Summary(props: { summary: ExportInput["summary"] }): JSX.Element;    // green "Can" list + "Cannot" list
  export function CodeView(props: { text: string; language: ExportFile["language"]; label: string }): JSX.Element; // <pre> monospace, tabIndex 0, aria-label
  ```
- OutputPanel: tabs **Policy** · **Trust** (+ extraTabs). When the policy is null: "No permissions yet. Add a service to generate a policy." For trust null with principal trust: "No trust policy: the policy is attached directly to the IAM <group|user>." Below the tabs: `StatusLine` ("N errors · N warnings · N info" with `StatusIndicator` types error/warning/info; clicking it scrolls to `IssuesList`), `SizeMeter` (label "Policy size", value `sizes.policy / policyLimit(model.policyMode, model.trust)`, text `1,388 / 6,144` with `toLocaleString("en-US")`, status `error` when over), then **Copy** (copies the active tab's text) and **Export** (Task 9). While errors exist, a banner above the code reads "This policy has errors. Fix them before you apply it." (Copy still works, per spec §6.5.) `Derived.kind === "loading"` → `Spinner` "Loading service data…"; `"error"` → "Couldn't load service data for: s3." with Retry.
- Review step: Name (`name`, description "Role name" or, for principal trust, "Used to name the policy: <name>-policy"); Policy mode (`RadioGroup`: "Managed policy (reusable, up to 6,144 characters)" / "Inline policy (up to 10,240 for a role, 5,120 for a group, 2,048 for a user)"); AWS account ID (optional); Region (optional `Autosuggest` over a static list of the standard-partition regions; free text allowed and validated by core); Managed policy ARNs (list editor, each path `managedPolicyArns[i]`); then `IssuesList` of all issues, then `Summary`. Every field uses `errorTextAt` + `useFocusTarget("field:<path>")`.

- [ ] **Step 1: Failing tests.** With the s3-group model, the Policy tab text `===` `stringifyPolicy(result.policy)`. The Trust tab shows the principal message. Copy calls `copyText` with the Policy text, and after switching to Trust with the trust text. The size meter shows `x / 6,144` in managed mode and `x / 5,120` in inline mode with a group. An error model shows the banner, and "Jump to" on a `trust.owner` error sets `step 0` and `focusTarget "field:trust.owner"`. The loading state shows the spinner. On the Review step, typing account ID `123` shows "Account ID must be exactly 12 digits."
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates.
- [ ] **Step 5:** Commit `feat(ui): output panel, lint list, explainer summary and review step`.

### Task 9: Export — lazy exporters, format previews, ZIP

**Files:** Modify `src/core/export/readme.ts` (+ `readme.test.ts`), `vite.config.ts`, `eslint.config.js`, `package.json` (script `check-bundle`), `.github/workflows/ci.yml` (run `npm run check-bundle` after build). Create `src/ui/export/{exporters.ts,lazy.ts,FormatTabs.tsx,ExportModal.tsx}` + tests, `src/ui/common/{download.ts,SafeMarkdown.tsx}` + tests, `scripts/check-bundle.ts`.

**Interfaces:**
- Core addition (README output must stay byte-identical):
  ```ts
  /** The README's "How to apply" text split at its ### headings; preamble (prerequisites incl. AWS CLI ≥ MIN_AWS_CLI) has title "". */
  export function applySections(input: ExportInput): { title: string; markdown: string }[];
  ```
  `exportReadme` builds its "How to apply" part from `applySections` (joined back), so README and UI can't drift. The titles are the existing headings: "AWS CLI — bash", "AWS CLI — PowerShell", "Re-running the AWS CLI scripts", "Terraform", "CloudFormation".
- UI:
  ```ts
  // exporters.ts
  export { exportAll, exportZip } from "../../core/export"; export { applySections } from "../../core/export/readme";
  // lazy.ts
  export type Exporters = typeof import("./exporters");
  export function loadExporters(importer?: () => Promise<Exporters>): Promise<Exporters>; // memoized; a rejection clears the memo
  export function useExporters(enabled: boolean): { status: "idle" | "loading" | "ready" | "error"; mod?: Exporters; retry(): void };
  // download.ts
  export function downloadFile(filename: string, data: string | Uint8Array, mime: string): void; // Blob + <a download>, revokeObjectURL after click
  // SafeMarkdown.tsx — renders only text nodes: paragraphs, ``` fences (CodeView), `code`, **bold**, "\x" → "x"
  export function SafeMarkdown(props: { markdown: string }): JSX.Element;
  ```
- FormatTabs adds the output-panel tabs **CLI** (`SegmentedControl` bash / PowerShell), **Terraform** and **CloudFormation**. Selecting any of them for the first time starts `useExporters(true)`. Content = the matching file from `exportAll(input)`. Below it: the preamble section, then the format's section, rendered through `SafeMarkdown`. That shows the PowerShell notes (`-File`, `-ExecutionPolicy Bypass`, `Unblock-File`) and "AWS CLI v2 (2.15.38 or later…)" exactly as in the README. When `exportAll` returns `ok: false`, the tab shows `Alert type="error"` with `outcome.reason` plus `IssuesList` (errors only), and no code. Loading → spinner "Loading exporters…"; error → "Couldn't load the exporters. Check your connection and try again." + Retry.
- ExportModal (opened by **Export**; loads the exporters too): blocked → header "Export is blocked", the `reason`, and the error `IssuesList` with Jump to (Jump closes the modal), with no download controls. Ready → **Download ZIP** (primary; `downloadFile(\`${model.name}.zip\`, exportZip(files), "application/zip")`), a table of files (name, size in bytes, **Download** each one with the right MIME: `application/json`, `text/x-shellscript`, `text/plain` for `.ps1`/`.tf`/`.yaml`, `text/markdown`), a preview `Tabs` with one tab per file, and the full `applySections` text.
- Build guard: `vite.config.ts` `manualChunks` adds `node_modules/yaml/` → `"yaml"` and `node_modules/fflate/` → `"fflate"`, plus `build.manifest: true`. `scripts/check-bundle.ts` reads `dist/.vite/manifest.json`, walks `imports` (static) from the `index.html` entry, and exits 1 if any visited chunk file starts with `assets/yaml-` or `assets/fflate-`, or if either chunk is missing from the manifest. It prints the entry's static-closure size in KB.
- ESLint (`src/ui/**`, `src/state/**`, except `src/ui/export/exporters.ts`): `no-restricted-imports` with patterns `**/core/export`, `**/core/export/index`, `**/core/export/{cli-bash,cli-ps,terraform,cloudformation,readme,zip}` (`allowTypeImports: true`), message "Load exporters through src/ui/export/lazy.ts so yaml and fflate stay out of the initial bundle."

- [ ] **Step 1: Failing tests.** For every REFERENCE_CASE and VARIANT_CASE, `applySections` joined equals the README's How-to-apply text, and existing README snapshots still match (unchanged). The s3-group sections include a "AWS CLI — PowerShell" section containing `Unblock-File`, `-ExecutionPolicy Bypass` and `pwsh -File`, and the preamble contains `2.15.38`. `loadExporters` with an importer that rejects once: the first call rejects, the second resolves, and a third call returns the same module without calling the importer. `SafeMarkdown` given `` `a` **b** <img src=x onerror=alert(1)> `` renders the literal `<img…>` text with no `img` element. FormatTabs on an error model shows "Fix the errors before exporting." and no `pre`. The ExportModal ZIP click calls `downloadFile` with `analytics-reader.zip`, and `unzipSync` of the bytes gives exactly the `exportAll` files. The PowerShell tab text equals the `.ps1` file content.
- [ ] **Step 2:** FAIL. **Step 3:** Implement.
- [ ] **Step 4:** PASS + gates + `npm run check-bundle` (prints the entry size; record it in the ledger) + `npm run export-fixtures && bash scripts/check-exports.sh` (or the Actions run). Add a temporary static `import "yaml"` to `src/ui/App.tsx`, confirm `check-bundle` exits 1, then remove it.
- [ ] **Step 5:** Commit `feat(ui): lazy-loaded export previews, how-to-apply text and ZIP download`.

### Task 10: Share URL

**Files:** Modify `src/core/model/share.ts` (+ test: export `MAX_SHARE_LENGTH = 8_192` and use it for the existing limit). Create `src/state/share-sync.ts(+test)`; wire into `BuilderPage` and the output panel (**Share** button).

**Interfaces:**
- Produces:
  ```ts
  export function initialModel(hash: string): { model: RoleModel; invalid: boolean }; // no "#s=" → empty, invalid false
  export function syncHash(model: RoleModel, loc: Pick<Location, "pathname" | "search" | "hash">, h: Pick<History, "replaceState" | "state">): "ok" | "too-large";
    // encoded ≤ MAX_SHARE_LENGTH → replaceState(state, "", pathname+search+"#s="+enc); else clears any "#s=" hash → "too-large"
  export function useShareSync(): { invalidLink: boolean; dismiss(): void }; // mount: initialModel → replaceModel; store subscription → debounced 300 ms syncHash → setShareStatus; listens to hashchange
  ```
- On mount: a valid hash → `replaceModel(model)`, `step 1` if the model has grants, else `step 0`. An invalid hash → empty model + `Flashbar` warning "This share link couldn't be opened. It may be incomplete or from a newer version of RoleCraft. Starting with an empty role." (dismissible). A `hashchange` to a different `#s=` value loads that model (same rules). The hash RoleCraft just wrote itself is ignored.
- **Share** button in the output panel: copies `location.href` once the pending debounce has flushed (call `syncHash` immediately before copying). With `shareStatus === "too-large"` it is disabled, with the description "This role is too large to share as a link. Export it instead."

- [ ] **Step 1: Failing tests.** `initialModel("#s=" + encodeModel(m))` deep-equals `m`, `invalid false`. `initialModel("#s=garbage")` → empty model, `invalid true`. `syncHash` on a model whose encoding is exactly 8,192 characters → `ok`; at 8,193 → `too-large`, and `replaceState` was called with a URL that has no hash. Fake timers: three edits within 300 ms → one `replaceState` call. Hashchange to another valid link replaces the model. The invalid link renders the Flashbar text.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (pad a model's role name / grants in the test to hit the exact lengths). **Step 4:** PASS + gates.
- [ ] **Step 5:** Commit `feat(ui): share URL round-trip with size guard`.

### Task 11: Playwright E2E

**Files:** `package.json` (devDependency `@playwright/test`, pinned exact; script `"e2e": "playwright test"`), `playwright.config.ts`, `tsconfig.node.json` (include `playwright.config.ts`), `tests/e2e/fixtures.ts`, `tests/e2e/*.spec.ts`, `.github/workflows/ci.yml` (job `e2e`: checkout, Node 22, `npm ci`, `npx playwright install --with-deps chromium`, `npm run e2e`, upload `playwright-report` on failure), `.gitignore` (`test-results/`, `playwright-report/`).

**Interfaces:**
- Config: `testDir: "tests/e2e"`, Chromium only, viewport 1440×900, `webServer: { command: "npm run build && npx vite preview --port 4173 --strictPort", url: "http://localhost:4173", reuseExistingServer: !process.env.CI }`, `use.baseURL`, `forbidOnly: !!process.env.CI`, `retries: 0`.
- `fixtures.ts` exports `test` / `expect`: a `page` fixture that records `console` messages of type `error` and `pageerror` events, and after each test asserts both lists are empty (printing them). Each spec imports `test` from here, never from `@playwright/test`.
- Helper `readZip(download): Promise<Record<string, string>>` (fflate `unzipSync`) and `modelFromPage(page)` (`decodeModel` of the current hash).
- Specs:
  - `s3-group.spec.ts`: start at `/builder`. Trust "IAM group or user" → Group `analytics-team`. Sidebar search "s3" → Amazon S3 → verb "list + read", bucket `data-lake`, prefix `reports/`. Review → name `analytics-reader`. Download the ZIP: its files equal `exportAll(REFERENCE_CASES["s3-group"]())` file by file, byte-equal (grant ids don't reach any file). Also assert this flow finishes under 60 s (spec success criterion 1).
  - `editors.spec.ts`: build `cross-account` (account trust with External ID + MFA, textract Read with All resources) in **Grid** mode. Capture `modelFromPage` and switch Sentences → Grid → Sentences: the model deep-equals the capture. The ZIP equals the `cross-account` reference export.
  - `share.spec.ts`: build a role, click **Share** (context granted `clipboard-read`/`clipboard-write`), open the clipboard URL in a new page: the Policy tab text is identical. `/builder#s=garbage` shows the invalid-link warning and an empty role.
  - `copy.spec.ts`: Copy on Policy and on Trust → the clipboard equals the visible code text.
  - `export-blocked.spec.ts`: an S3 bucket `Bad_Bucket` → Export shows "Export is blocked", "Fix the errors before exporting.", and no Download ZIP. Jump to focuses the bucket input. The Terraform tab shows the same reason.
  - `lazy.spec.ts`: record requests. After building a role, no request URL matches `/assets/(yaml|fflate)-`. Opening the CLI tab requests both chunks. The PowerShell view shows `Unblock-File` and `2.15.38`.
  - `theme.spec.ts`: dark by default (`body` has class `awsui-dark-mode`); the toggle removes it; a reload keeps light.
  - `mobile.spec.ts`: viewport 390×844 → "Works best on a laptop or desktop" and Copy link are visible, the "Trusted entity" step is absent; Copy link copies the URL including the hash.
- [ ] **Step 1:** Write the specs and run `npm run e2e`. Expected: they fail only where the UI really differs from the spec. Fix the UI (with a unit test for each fix), never the assertion.
- [ ] **Step 2:** All specs pass locally, with zero console errors.
- [ ] **Step 3:** Commit `test(e2e): Playwright builder flows, share, export, theme and phone card`. Push, then confirm the CI `e2e` job is green on GitHub (GitHub MCP tools or `gh run watch`).

---

## Out of scope (later milestones)

Templates gallery and the "Open in workspace" flow (milestone 7), landing page content, `public/_headers` CSP, analytics and OG image (milestone 8), Layer 5/6, self-hosted fonts, syntax highlighting (Shiki/Prism: plain monospace `CodeView` for now; ledger ruling), Phase 2 import.

## Rulings made while writing this plan (copy into the ledger)

- Ruling: custom `StepHeader` + Previous/Next instead of Cloudscape `Wizard` — the approved mockup shows a step strip inside the center column, and `Wizard` takes over the whole page and its buttons — cost: own keyboard/ARIA work (aria-current, buttons).
- Ruling: inline expandable scope editors instead of popovers (spec §8 says popover) — forms with several inputs and validation messages are unreliable in popovers (they close on an outside click and lose focus) — cost: taller sentence rows.
- Ruling: field errors come only from `generate()` issues (paths/grantId), with no second UI-side validator — one source of truth, so the UI and Export can't disagree — cost: messages appear after the derive cycle (same render).
- Ruling: Export stays clickable while errors exist and opens a "blocked" modal with exportAll's reason + the errors (spec says "Errors disable Export") — a disabled button can't explain itself and isn't focusable — cost: one extra click to see why.
- Ruling: CLI/Terraform/CloudFormation previews live in the output panel as tabs that trigger the lazy load on first open, plus the Export modal — matches spec §8's right-panel tabs and keeps yaml/fflate out of the initial bundle — cost: a brief spinner on first open.
- Ruling: how-to-apply text comes from the README generator (`applySections`), rendered by a text-only Markdown subset — the PowerShell notes can't drift from the README — cost: a small core refactor guarded by unchanged snapshots.
- Ruling: switching trust kind resets that kind's fields (`defaultTrust`) — simplest correct behaviour — cost: values typed into a kind are lost when switching away and back.
- Ruling: blank optional fields (accountId, region, module KMS keys) are removed from the model, not stored as "" — cleaner share URLs and identical exports — cost: none.
- Ruling: plain monospace code view, no syntax highlighter in Plan 4 — bundle size, and the spec lists highlighting with polish — cost: less pretty output until milestone 8.
- Ruling: the E2E golden is the core's own `exportAll` of the matching REFERENCE_CASE — the UI must produce byte-identical files to the reviewed, tool-checked snapshots — cost: none.
