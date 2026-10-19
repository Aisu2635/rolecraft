# SDD ledger — plan: docs/superpowers/plans/2026-10-18-plan-4-builder-ui.md

Spec: docs/superpowers/specs/2026-10-16-rolecraft-design.md (reachable). Branch feat/plan-4-builder-ui from main 3aec611 (Plan 3 merged, PR #1).
Repo ledger (committed): docs/superpowers/plans/2026-10-18-plan-4-ledger.md — rulings mirrored there.

## Pre-flight scan
| Rows | Produces / consumes | Finding |
|---|---|---|
| T1→T3,T4,T5,T6,T7,T8,T10 | useBuilderStore, Step, EditorMode, model-ops, newGrantFor | consistent |
| T2→T4,T5,T6,T8 | CatalogContext, useDerived, Derived | consistent |
| T3→T4..T10 | BuilderWorkspace slots, useCopy, BuilderPage | consistent |
| T5→T6,T8,T9 | issuesAt/errorTextAt/grantIssues/focusIdFor/useFocusTarget | consistent |
| T6→T7,T8 | PermissionsStep (T7 adds Grid, T8 adds Summary), ScopeEditor reused by Grid modal | consistent |
| T8→T9,T10 | OutputPanel extraTabs + Export/Share buttons | consistent |
| T9 ESLint guard vs T2 derive.ts | derive imports type ExportInput from core/export/types (not restricted) | consistent |
| T10 → core share.ts | MAX_SHARE_LENGTH exported | consistent |
| T11 → core fixtures | E2E imports REFERENCE_CASES (node fs) under tsconfig.node | risk: tsconfig.node program pulls src/core; implementer adjusts includes if typecheck needs |
| T1 self | defaultModuleData s3 has no allowNavigation | consistent |
| T6 self | test expects allowNavigation:false in data | Ruling: S3 scope editor always writes allowNavigation boolean (schema default false) — explicit model — cost: none (exports identical) |
| T9 self | applySections must keep README byte-identical | consistent (snapshots guard) |
| T11 self | s3 preset label "list + read" exists (s3.ts:63) | consistent |
| Extra | Hero page (user request 2026-10-18) not in plan | Ruling: add as Task H after Task 4 (landing files only) once concept confirmed — user asked alongside Task 1 — cost: landing work done before milestone 7 |

## Progress
Task 1: implementer DONE_WITH_CONCERNS (793d01e); review dispatched (base 7a8a9f9)
Task 1: Ruling (implementer): defaultModuleData returns {} for unknown ids; reset() also resets editor/focusTarget/shareStatus; generic grant for a service with no actions gets levels [] — cost: small changes if later tasks want otherwise
Ruling: pre-existing Windows-only failure src/core/export/zip.test.ts (absolute C:\ path to node --import; ERR_UNSUPPORTED_ESM_URL_SCHEME) — CI Ubuntu green; Task 2 implementer fixes it test-only via pathToFileURL — cost: none (test-only)
Hero: concept chosen "Type, strike, replace"; short design presented, awaiting user approval
Task 1: minor (deferred): setFields copies explicit undefined keys (normalize undefined like "")
Task 1: minor (deferred): defaultModuleData {} for unknown id silent; unreachable `first ? first.id : ""` fallback; schema test assertion lacks zod error detail
Task 1: complete (commits 7a8a9f9..793d01e, review clean)
Ruling: hero runs as the next task once the user approves its design (supersedes "after Task 4") — user expects it soon — cost: none
Task 2: implementer DONE (881b8e2 zip test fix, f0465fb); review dispatched (base 793d01e)
Task 2: minor (deferred): keyInflight cleared one microtask after status=error (retry from a sync subscriber no-ops); useDerived memo deps include unused index
Task 2: complete (commits 793d01e..f0465fb, review clean)
Ruling: Task 3 adds a builder-level effect that calls ensureIndex + ensureServices(unique grant service keys) whenever the model's grant services change — otherwise grants restored from a share URL or replaceModel stay "loading" forever (review minor 3) — cost: none
Task 3: implementer DONE (811f38d); prettier slip reverted — verified git status clean, diff touches only task files; review dispatched (base f0465fb)
Task 3: Ruling (implementer): missing matchMedia = desktop; clipboard as .tsx; "Copied" is a visually-hidden live region; <1280px side columns 200/340; 56px top-nav height assumption, sticky Previous/Next; Share swallows all errors
Ruling: real-browser layout checks (nav height, column scroll, textarea selection) deferred to Task 11 Playwright specs — no browser tooling until then — cost: layout bugs found later
Task 3: minor (deferred): hardcoded calc(100vh - 56px) nav height (verify in Task 11); step-circle colors hardcoded (#8c8c94/#037f0c) not theme tokens; Reset drops query string; DesktopOnlyCard share test no-op await; new files 80-col formatting
Task 3: complete (commits f0465fb..811f38d, review clean)
Ruling: Task 3 minor 1 (copy hint text deviates from Review Focus 4 "Press Ctrl+C (⌘C on Mac) to copy.") and minor 2 (useIsDesktop addListener fallback for old Safari) folded into Task 4's dispatch as a small pre-step with tests — the plan pins the hint text and E2E may assert it — cost: none
Task 4: implementer DONE (2deb545 pre-step fixes, edbc0e4 sidebar); review dispatched (base 811f38d)
Task 4: Ruling (implementer): Ctrl/Cmd+K fires inside text inputs too; per-service in-flight guard (double click = one grant); load failure inline + Retry via catalog.retry; categories/A–Z mount entries on expand; SERVICE_SEARCH_ID set on inner <input> via wrapper effect; Enter in search picks first result (extra)
Task 4: minor (deferred): SERVICE_SEARCH_ID set via DOM effect (fragile; consider ref/store focus); grants for services missing from index vanish from "In this role"; disabled pending button drops keyboard focus; no tests for Popular filtering / category + A–Z sort
Task 4: complete (commits 811f38d..edbc0e4, review clean)
Ruling: Task 4 minors 1 (count has no accessible label) and 2 (e.key.toLowerCase() throws on key-less autofill/IME keydown → uncaught TypeError, would fail E2E) folded into Task 5 pre-step with tests — cheap, real — cost: none
Hero: user approved design ("yes, go ahead with the hero design"); brief task-H-brief.md written; Task H dispatches after Task 5 implementer returns (no parallel implementers), reviewed like a plan task
Ruling: hero shows the engine-generated policy as a pinned string constant (test asserts equality with generate()) — landing must not load service data/engine — cost: constant needs regenerating if the S3 module output changes (test fails loudly)
Ruling: hero moved off the plan branch at user request ("push hero changes quickly for deployment") — built in worktree ../rolecraft-hero on new branch feat/landing-hero from origin/main, parallel to Task 5 (separate checkout, no conflict); reviewed before push; pushing a new branch + PR needs user confirmation — cost: LandingPage.tsx/global.css may conflict when plan-4 merges (small)
Hero: user chose push feat/landing-hero + open PR into main after review passes (user merges)
Task 5: implementer DONE (7179e32 sidebar fixes, 64b666f trust step); review dispatched (base edbc0e4)
Task 5: Ruling (implementer): path-less trust issues E_GITHUB_NEEDS_ACCOUNT / E_GITHUB_REF_VALUE / E_GITHUB_OWNER_REPO_* matched by id and mapped by focusIdFor to step-0 fields; ref type change resets ref value (branch→"main", tag/env→""); unchecked MFA / empty External ID delete keys
Task 5: minor (deferred): GitHub accountId issues can jump to step 0 or step 2 depending on id vs path; E_GITHUB_OWNER_REPO_WILDCARD not displayed on a field (only focus-mapped); no test that kind switch resets touched state
Task 5: complete (commits edbc0e4..64b666f, review clean)
Ruling: Task 5 minors 1 (stale focusTarget that never mounts can steal focus later → clear focusTarget when it can't be satisfied, e.g. on step change before mount check / after a frame) and 2 (re-selecting the same ref type resets value → guard) folded into Task 6 pre-step — cost: none
Hero: implementer DONE_WITH_CONCERNS (e1e27cb on feat/landing-hero, worktree ../rolecraft-hero); review dispatched (base origin/main)
Task 6: implementer DONE_WITH_CONCERNS (5d69ee1 focus/ref fixes, 2ca0849 sentence editor); review dispatched (base 64b666f)
Task 6: Ruling (implementer): unclaimed focus targets cleared in setStep and removeGrant; S3 "" prefix kept, last prefix not removable; EC2 selector switch resets to a fresh valid shape; Grid segment disabled until Task 7
Task 6: concern: ServiceSidebar "renders categories and A-Z lazily" test timed out (5 s) in 2/3 parallel coverage runs — CI flake risk
Hero: review → Needs fixes (Important: policy code hard-clipped/unscrollable at ≤~550 px and 901–~1190 px). Minors: h1/sub start at opacity 0 (LCP), per-char re-render re-highlights policy, permanent will-change glow layer, box-shadow hover transition, stale frame on reduced flip, dead lp-rise class, loop is ~7.8 s not 9.5 s.
Hero: fix round 1/5 dispatched (resume implementer): clipping + fold in Minor 1 (LCP) and Minor 6 (dead class); remaining minors deferred
Task 6: minor (deferred): setStep clears focusTarget → callers must setStep before focus (watch in Task 8 jump-to); ARN errors not tied to an input (core generic issues carry no path); StringList touched state keyed by index; ARN radio all↔specific loses arns; duplicate ARN add no feedback; a failed service load hides every grant's errors (derive "error" gate) — revisit in final review
Task 6: complete (commits 64b666f..2ca0849, review clean)
Ruling: Task 6 minors 2 (row list repeats inline field errors → row list shows only issues without a path) and 8 (flaky ServiceSidebar lazy test timeout) folded into Task 7 pre-step — flake would break CI gates — cost: none
Hero: fix round 1 implementer DONE (18197ab); scoped re-review dispatched
Hero: fix round 1/5 (3 addressed, 0 open; commits e1e27cb..18197ab); complete; pushed feat/landing-hero
Hero: PR #2 opened (feat/landing-hero → main); user merges
Task 7: implementer DONE_WITH_CONCERNS (cc3f9cf pre-step, 0eef262 grid); review dispatched (base 2ca0849)
Task 7: Ruling (implementer): textract has no List level → level-order test uses Read+Write; no virtualScroll in this Cloudscape Multiselect → filtering + memoised options + mount on expand; actions-grant hint in the Individual actions column (no colspan); shared ServiceStatus.tsx used by both editors
Task 7: minor (deferred): grid checkbox/radio aria-labels identical across rows ("Read"); grid issue list not tied to a row, keyed by index; actions grant with actions [] shows no hint; GridEditor 252 lines, some >120 cols; no virtualScroll for EC2 (verify in browser); native radios unstyled
Task 7: complete (commits 2ca0849..0eef262, review clean)
Ruling: untouched invalid fields show no message in Sentences mode (path-less-only row list + blur gating) → Task 8 pre-step: store flag `revealErrors` set by replaceModel (share link / restore) and by any Jump-to; fields show errors when revealErrors || touched; plus Task 8's IssuesList lists every error — the user must always be able to see why export is blocked — cost: restored invalid models show red fields immediately (intended)
Hero: owner feedback — empty white space around small code box during typing (confirmed via Playwright screenshots); header mismatched. Owner chose "Editor + red callouts" redesign. Round 2 dispatched (resume implementer): full-card editor w/ tab + line numbers, 8-line realistic over-broad policy, new "flag" phase with red callouts ("every S3 action", "every bucket"), phase-aware header, fixed stage filled by both phases; browser screenshots per phase at 390/1024/1280
Resume (after usage-limit stop): Task 8 implementer resumed mid pre-step (uncommitted revealErrors changes); hero round 2 implementer resumed (tests only, no impl); preview server for screenshots was stopped
Hero: round 2 DONE (c473eb0). Controller screenshot check: typing/flag good; strike frame washes grey (replace layer cross-fading too early) with overlapping headers; strike line crosses the callout. Round 3 dispatched (clean wipe, sequential header, strike line ends before callouts)
Task 8: implementer DONE (29a1c72 revealErrors pre-step, 148d107 output+review); review dispatched (base 0eef262)
Task 8: Ruling (implementer): Review fields mark touched on change too (account ID error while typing); status line singular "1 error", "N info"; StringList gains optional focusIdOf for managedPolicyArns[i] jump; OutputPanel props extraTabs (with copyText) + actions (Export) + share slots
Task 8: minor (deferred): Review field errors duplicated in IssuesList (test freezes count 2); policyMode Field wrapper unrequested (harmless); GridEditor ExpandableSection jump-to expansion not checked
Task 8: complete (commits 0eef262..148d107, review clean)
Ruling: Task 8 minors 1 (Copy enabled with empty text for async/empty tabs) and 2 (removed active tab leaves stale active) carried into Task 9 (Copy disabled when the active tab has no text; panel falls back to Policy when the active tab disappears) — Task 9 adds async tabs — cost: none
Hero: round 3 DONE (10c6013): wipe replace, callouts fade at strike; controller checked hero3 screenshots (strike crisp, wipe clean); review of rounds 2–3 dispatched
Hero: rounds 2–3 review Approved; minor (deferred): .lp-rc shadow may bleed at rest, duplicate strike transition rule, flag pop scales full-width row, highlight marks lp-bad during typing (harmless)
Hero: pushed 18197ab..10c6013 to feat/landing-hero (PR #2)
Task 9: implementer DONE (3666339 core applySections refactor, bad961d UI export); check-bundle initial closure 1072.0 KB, negative check exit 1; review dispatched (base 148d107)
Task 9: Ruling (implementer): ESLint guard via @typescript-eslint/no-restricted-imports regex patterns (allowTypeImports), tests exempt; OutputPanel gets useExtraTabs(input, active) hook prop + actions as fn of derived input (no second generate()); Copy disabled when active tab text empty
Task 9: Export tooling Actions run on bad961d: success
Task 9: review → Needs fixes (Important: blocked-modal Jump to loses focus to Export button via Cloudscape FocusLock restore). Fix round 1/5 dispatched (resume implementer) + minors 1 (§6.5 copy-with-errors test, wrong premise), 2 (setActive policy on tab loss), 3 (lint guard .ts suffix + exporters only from lazy.ts), 4 (order-dependent memo test)
Task 9: minor (deferred): Retry may not recover a chunk removed by a redeploy (consider reload hint); check-bundle KiB labelled KB, CSS not counted; FormatTabs runs exportAll per tab (hoist); retry state not shared between tabs and modal; repeated h3 headings in modal; leaf modules without separate RED run
Ruling: pushes paused pending owner OK — owner objected to unapproved Cloudflare Pages preview deployments (auto-built per pushed branch); every future push needs explicit approval — cost: commits stay local until approved
Task 9: fix round 1 implementer DONE (552218d, local only — not pushed); scoped re-review dispatched
Task 9: fix round 1/5 (5 addressed, 0 open; commits bad961d..552218d)
Task 9: minor (deferred): 50 ms fixed delay for modal Jump to (heuristic; deterministic onDeactivated/double-rAF would be sturdier; manual nav within 50 ms overridden); ESLint guard doesn't see dynamic import() of core/export (check-bundle covers); test-only resetExportersForTests export in lazy.ts
Task 9: complete (commits 148d107..552218d, review clean) — 552218d local only, not pushed (awaiting owner push decision)
Owner approved pushing ('No, Push Things to GitHub'); pushed 552218d. Owner to disable Cloudflare preview branches in dashboard
Owner turned off Cloudflare preview branches (2026-10-18); pushes to feature branches no longer create previews
Task 10: implementer DONE (f2ba9f5); review dispatched (base 552218d)
Task 10: Ruling (implementer): size tests use 8,192 (ok) and 8,194 (too-large) since lz-string output lengths were even for the fixture (limit is > 8192, so 8,193 behaves the same); no #s= on mount keeps the in-memory role; untouched empty role writes no hash; hashchange without #s= ignored; unmount flush skipped if pathname changed; "too large" text inline, not tooltip
Task 10: minor (deferred): invalid #s= on mount gets replaced by #s=<empty role> after 300 ms (undocumented, untested); written/hashchange echo guard effectively dead in browsers (comment); BuilderErrorBoundary reset drops search/state (pre-existing); no test pairing reset + share sync
Task 10: complete (commits 552218d..f2ba9f5, review clean; pushed)
Ruling: Task 10 minor 2 (ShareButton too-large note not tied via aria-describedby) folded into Task 11 pre-step — cheap a11y fix — cost: none
Owner decision (2026-10-18): Layer 5 (Access Analyzer/Policy Simulator) and Layer 6 (real apply) deferred until after go-live — personal AWS account suspended, org account not allowed; a friend's account will be used post-launch. Plans must not depend on AWS access until then.
Task 11: implementer stopped on usage limit early (reading UI labels); resumed
Hero: PR #2 merged by owner; plan-4 branch to merge main after Task 11
Task 11: implementer DONE (bbb7ab8 share a11y, d41b9c0 test wait, 0a52e6d jump lands on invalid field, 0d2e1e6 nav 57px no page scrollbar, 8326b03 e2e); 13 E2E pass, zero console errors, ZIP goldens byte-equal, s3-group ~3 s; review dispatched (base f2ba9f5)
Task 11: concerns: Grid-mode Jump to only switches step (no focus); collapsed Scope → jump lands on Remove; EC2 picker unreachable (presets) — SageMaker 460 actions ~350 ms; local port 4173 busy → E2E_PORT; fixtures decode hash with own lz-string copy
Task 11: note — ci.yml (verify + e2e jobs) runs only on push to main / PR to main, so the CI e2e job first runs when the Plan 4 PR is opened; Export tooling runs on feat/** pushes
Task 11: minor (deferred): fixtures duplicate lz-string decode (default import in share.ts likely lets them use real decodeModel); waitForTimeout(600) negative check; exact float equality in layout.spec; CSS-text unit test weak; 100vh vs dvh; Grid-mode Jump to only switches step; collapsed Scope jump → Remove; CRLF normalisation on win32 only
Task 11: complete (commits f2ba9f5..8326b03, review clean; pushed)
All 11 tasks complete. Next: merge origin/main (hero PR #2) into plan-4 (expected conflict src/ui/global.css), then final whole-branch review (most capable model) + one fix wave
Merge: 4e830fc merges origin/main 44ee6b1 (hero) into plan-4; only conflict src/ui/global.css (kept both); all gates green, e2e 13 passed (E2E_PORT=4187; 4173/4174 held by other local processes); pushed
Final review: dispatched on opus over 44ee6b184e60712f90aef30d84f6712405f66bb9..HEAD
Ruling: final review on Opus 5.5 — Fable 5.1 (most capable) returned 'requires usage credits' (HTTP 429), same as Plan 3 — cost if wrong: a stronger model might find more
Final review (Opus 5.5) → Ready after fixes. Important: I1 blank extra S3 prefix silently widens to whole bucket (core treats "" as whole bucket, info only); I2 Jump to dead in Grid mode and with Scope collapsed, unclaimed targets steal focus later; I3 lazy export can't recover after a redeploy (removed hashed chunk). Fix-before-merge: T10 invalid #s= replaced → StrictMode hides invalid-link warning; committed ledger stale.
Ruling: final fix wave = I1–I3 + T10/StrictMode + cheap user-visible minors m1 (show dropped-input info notes on rows), m3 (focus step heading), m4 (a11y names/live), m7 (sidebar retry also retries errored keys), m10 (revealErrors reset), m11 (dev missing-key warning) — one fixer (Opus) — cost: larger wave
Ruling: I1 fixed in core (s3: "" with other prefixes = error on data.prefixes[i]) — the least-privilege promise beats UI-only patching; reference snapshots unaffected — cost: shared links holding ["x", ""] now show an error instead of a silent widening (intended)
Final review minors deferred (can wait): M5 perf (derive once, memo ServiceList, hoist exportAll), M6 Review triple-shown errors, M8 generic grant on module service blank in Grid, M9 Build-an-ARN account "*" hint, M13 more E2E goldens (github-deploy/inline/user) + first-CI-run watch
Final fix wave: fixer (aa4c86291b1fa585f) stalled (600 s watchdog) after committing I1 only (3b46e0c, local, not pushed); brief saved to final-fix-brief.md
Ruling: resume the fix wave as two sequential fresh fixers — A: I2 + m3 + m10 (focus/jump), B: I3 + M2 + m1 + m4 + m7 + m11 — smaller dispatches stall less; same brief, I1 marked done — cost: one extra context rebuild
Final fix wave A: dispatched (opus, base 3b46e0c) — I2, m3, m10
Final fix wave A: DONE (5c0fdd2, 7265b76, 60e7486, 4074a75, e906d52, eeea558; local, not pushed); 4463 tests, core 100% lines / 97.77% branches; e2e 14 passed on 4187, no console errors
Ruling (fixer A): I2b Jump to a grant from Grid switches the editor to Sentences — fields only exist there, one line in jump() — cost: Grid users re-click Grid after each Jump to
Ruling (fixer A): m10 adding a grant sets revealErrors false — cost: after a restore, adding a grant hides untouched-field errors until blur/Jump to/blocked Export
Ruling: accept eeea558 (S3 sweep generator emits only valid prefix lists after I1; assertions untouched) — the generator encoded the old widening semantics — cost: none
Final fix wave: minor (deferred): m3 step heading is visually hidden, so sighted keyboard users see no focus ring after a step change
Final fix wave B: dispatched (opus, base eeea558) — I3, M2, m1, m4, m7, m11
Final fix wave B: DONE (5341f6a I3, 4fd6197 M2, 5e4a4a4 m1, fd022c0 m4, 42fc596 m7, 6c2710b m11; local); 4481 tests, core 100% lines / 97.77% branches; export-fixtures unchanged; e2e 14 passed, zero console errors
Ruling (fixer B): I3 redeploy failure count is per hook instance; Reload still offered when role too large (message becomes a warning); m4 Grid aria-labels reuse scopeSummary text — cost: a tab and the modal count failures separately (one extra Retry)
Final fix wave: scoped re-review dispatched (opus) over 4e830fc..6c2710b
Final fix wave: re-review → all findings addressed (I1, I2a–c, I3, M2, m1, m3, m4, m7, m10, m11), no new Critical/Important
Final fix wave: parked — Reload ignores syncHash's status, so an edit <300 ms before Reload that tips the role over the link limit reloads without the too-large warning — Ruling: real, deferred; needs a role at the size limit plus a sub-300 ms edit-then-click after a redeploy; one-line fix (return when status is "too-large") — cost if wrong: a rare user loses an unexported oversized role
Final fix wave: parked — new S3 grant defaults to [""]; Add prefix gives ["",""] → "Folder 1 is empty" — Ruling: correct under I1, deferred UX polish (start new rows non-blank or drop the default row on add) — cost: a confusing first error for some users
Final fix wave: minor (deferred): explicit "/" beside other prefixes still widens to whole bucket with only an info note (now visible on the row); redeploy failure count per useExporters instance
Final fix wave: complete (commits 4e830fc..6c2710b, re-review clean, 2 parked). Committed ledger replaced with this file; next: push, open Plan 4 PR (owner merges)
