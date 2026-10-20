# SDD ledger — plan: docs/superpowers/plans/2026-10-19-plan-5-prelaunch-hardening.md

Spec: docs/superpowers/specs/2026-10-16-rolecraft-design.md (reachable). Branch feat/plan-5-templates from main fe1ef35 (PR #3 merged).
Owner (2026-10-19): backlog first, then templates; no approval stops ("ship ASAP"). Merges to main still need owner OK.

## Pre-flight scan
| Rows | Produces / consumes | Finding |
|---|---|---|
| T1→T7 | T1 changes EC2 snapshots (IgnoreCase); T7 applies snapshots | sequential, consistent |
| T2→T7 | T2 changes EKS retry text; T7 stub exercises it | consistent (T7 stub must emit the error string T2 matches) |
| T3↔T4 | both touch OutputPanel/FormatTabs/ExportModal/GridEditor | sequential; T4 consumes T3's shared lazy.ts state | consistent |
| T3→T5 | T5 E2E may hit T3 Review-list change | consistent |
| T6 self | REPO_URL points at a private repo | Ruling: link real repo URL; owner makes repo public at launch (checklist) — cost: 404 link if not made public |
| T1 self | W_S3_PREFIX_ROOT replaces info only for root-prefix case | consistent |
| T7 self | moto EKS support unknown | stub path specified | consistent |

## Progress
Ruling: backlog waivers per plan triage table (og:image → milestone 8; P1 test/style minors; P1 strict-validator semantics; Plan 4 can-wait minors) — owner granted autonomy, user-visible/correctness items all kept — cost: a waived minor surfaces post-launch
