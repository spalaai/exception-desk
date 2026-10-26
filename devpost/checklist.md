---
doc: checklist
status: approved
---
<!-- Order approved -->

# Build Checklist

Build mode: fast

## Slices

- [x] **1. Running desk shell with demo mode header**
  Becomes usable: `npm start` serves the single-screen layout (header, input, queue, detail placeholders) and `GET /api/mode` reports Demo mode (rules).
  Why now: End-to-end scaffold first so every later slice lands on a real URL and matches look-and-feel.
  PRD ref: `prd.md > The Core Journey` (step 1), `prd.md > Screens and Layout`
  Spec ref: `spec.md > Stack`, `spec.md > Where It Runs and How Someone Tries It`, `spec.md > Look and Feel`, `spec.md > Components` (Static frontend, HTTP server)
  Build: `package.json`, `.gitignore` check, `server/index.js` (static + `/api/mode`), `server/mode.js`, `public/index.html`, `public/styles.css`, minimal `public/app.js` for mode fetch.
  Verify (mechanical): `npm install && npm start` on a free port; `curl -s http://localhost:$PORT/api/mode` returns JSON with demo label; `curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/` is 200.
  Learner check: Open the app in a browser and confirm the calm ops layout and demo mode badge match what you pictured.
  Commit: `Add HTTP server and desk shell with demo mode header`

- [x] **2. Batch parser splits CSV, JSON, and plain blocks**
  Becomes usable: Parser module turns messy input into normalized items; unparseable chunks become single low-confidence-ready items.
  Why now: Triage cannot run until items exist; parser risk is isolated before the kernel.
  PRD ref: `prd.md > Input and triage`, `prd.md > States and Boundaries` (unparseable)
  Spec ref: `spec.md > Components` (Batch parser), `spec.md > Data Model`
  Build: `server/parser.js`, `test/parser.test.js` covering CSV, JSON, blocks, empty edge.
  Verify (mechanical): `npm test` — parser tests pass.
  Learner check: N/A until wired — Paul can skim parser tests later.
  Commit: `Add batch parser with tests`

- [x] **3. Rules triage engine and POST /api/triage (demo kernel)**
  Becomes usable: Server triages parsed items with deterministic rules (categories, P1≥$500, disputes/duplicates P1), returns queue JSON with evidence line indices.
  Why now: Unique kernel early — demo mode must work without keys before UI polish.
  PRD ref: `prd.md > Input and triage`, `prd.md > Features and Behavior`
  Spec ref: `spec.md > Components` (Rules triage engine, HTTP server), `spec.md > Data Model`, `spec.md > Important Failure Modes`
  Build: `server/rules-engine.js`, wire `POST /api/triage` in `server/index.js`, `test/rules-engine.test.js` on representative cases including $500+ P1.
  Verify (mechanical): `npm test`; `curl -s -X POST localhost:$PORT/api/triage -H 'Content-Type: application/json' -d '{"text":"..."}'` returns items with category and priority.
  Learner check: After slice 4 — load sample and confirm triage categories look right.
  Commit: `Add rules triage engine and triage API`

- [x] **4. Input, sample batch, and priority-sorted queue in the UI**
  Becomes usable: Paste/upload, Load sample batch, Triage fills the queue sorted P1→P3 with category and draft preview.
  Why now: First full core journey visible in the browser.
  PRD ref: `prd.md > The Core Journey` (steps 2–3), `prd.md > Review queue`
  Spec ref: `spec.md > Components` (Client app, Static frontend), `samples/`
  Build: `samples/batch.txt`, `samples/batch.csv` (~12 invented items), `public/app.js` triage flow, file upload, sample loader.
  Verify (mechanical): Start server; `curl` sample file through API matches expected item count; browser-equivalent: POST sample text returns ≥12 items.
  Learner check: Load sample batch, Triage, scan the queue order and row content.
  Commit: `Wire input, sample batch, and triage queue UI`

- [x] **5. Related-item detection across the batch**
  Becomes usable: Server flags related pairs (duplicate charge, refund vs failed payment, same invoice); queue shows related indicators.
  Why now: Kernel differentiator; depends on stable triage IDs from slice 3–4.
  PRD ref: `prd.md > Review queue` (related items)
  Spec ref: `spec.md > Components` (Related-item detector), `spec.md > Data Model`
  Build: `server/related.js`, integrate in triage handler, `test/related.test.js`, UI related badge on rows.
  Verify (mechanical): `npm test` related tests; triage sample batch includes at least two related pairs with `relatedIds` populated.
  Learner check: After triage, spot related flags on the duplicate-charge and refund/failed-payment pair.
  Commit: `Add related-item detection and queue flags`

- [x] **6. Detail panel: evidence highlights, edit draft, approve/reject/reset**
  Becomes usable: Select row → highlighted raw text, metadata, editable draft, Approve/Reject/Reset, Copy reply button; money disclaimer visible.
  Why now: Human review loop completes before persistence and export.
  PRD ref: `prd.md > Detail and decisions`, `prd.md > The Core Journey` (steps 5–6)
  Spec ref: `spec.md > Components` (Client app), `spec.md > Data Model` (Decision)
  Build: Detail rendering, evidence line highlights, decision state in client memory, Copy reply, approved-actions disclaimer in UI.
  Verify (mechanical): Manual script via node or curl triage + inspect client logic; run `npm test` still green.
  Learner check: Open one item, edit draft, Approve; use Copy reply; read disclaimer.
  Commit: `Add detail panel, decisions, and copy reply`

- [x] **7. Summary bar, filters, and localStorage for decisions**
  Becomes usable: Filter by category/status; summary counts; decisions survive reload for same triage session.
  Why now: Ops desk density and persistence per PRD.
  PRD ref: `prd.md > Review queue`, `prd.md > States and Boundaries` (persistence)
  Spec ref: `spec.md > Data Model`, `spec.md > Components` (Client app)
  Build: Filters, summary bar, `triageId` + `exception-desk-decisions` in localStorage; clear decisions on new triage.
  Verify (mechanical): `npm test`; document localStorage behavior in a small node test if added, else verify via curl triage id present.
  Learner check: Filter to P1 only; approve one item; refresh and confirm decision persists.
  Commit: `Add filters, summary bar, and decision persistence`

- [x] **8. Edge cases, CSV export, and input limits**
  Becomes usable: Empty input message, 100-item cap message, unparseable → other/needs human; Export CSV with final replies.
  Why now: Boundary states before optional LLM complexity.
  PRD ref: `prd.md > States and Boundaries`, `prd.md > Features and Behavior` (export)
  Spec ref: `spec.md > Important Failure Modes`, `spec.md > Components` (Client app)
  Build: Server/client caps and messages; CSV export; rules label for unparseable.
  Verify (mechanical): `npm test`; POST empty body returns error/message; POST >100 items capped with message.
  Learner check: Try empty Triage; export CSV after a few decisions and open in a spreadsheet viewer.
  Commit: `Add edge-case handling and CSV export`

- [x] **9. Optional LLM triage with timeout and per-item fallback**
  Becomes usable: With API key, header shows AI provider/model; LLM enriches items; failures fall back to rules with label.
  Why now: Opt-in layer after demo path is solid.
  PRD ref: `prd.md > States and Boundaries` (LLM fallback)
  Spec ref: `spec.md > Components` (LLM triage adapter), `spec.md > External Services`, `spec.md > Decisions and Open Issues`
  Build: `server/llm-triage.js`, `server/mode.js` updates, `.env.example`; 15s fetch timeout; `LLM_PROVIDER` logic.
  Verify (mechanical): `npm test` still passes without keys; mode endpoint still demo without env.
  Learner check: Paul — try with a real key when back.
  Commit: `Add optional LLM triage with rules fallback`

- [x] **10. README, LICENSE, HTTP smoke test, and UI polish pass**
  Becomes usable: MIT LICENSE, README (install, demo vs AI, env vars, tests, structure, Built with, Pre-existing code), `test/triage-http.test.js`, final look-and-feel cohesion.
  Why now: Submission-ready repo; mechanical smoke test locks API contract.
  PRD ref: `prd.md > Look and Feel`
  Spec ref: `spec.md > File Structure`, `spec.md > Where It Runs and How Someone Tries It`
  Build: LICENSE, README.md, `.env.example`, HTTP smoke test, CSS/HTML polish for Linear-like density.
  Verify (mechanical): `npm test` all green; `npm start` + curl smoke; sample batch triage deterministic in rules tests.
  Learner check: Read README quick start; run `npm test` yourself.
  Commit: `Add README, LICENSE, env example, and HTTP smoke test`

## Hands-on Checkpoints

- [ ] Early usable behavior explored — after slice 4 (queue + sample triage) — **waiting for Paul**
- [ ] Final kick-the-tires exploration and feedback completed — **waiting for Paul**

## Final Review

- [x] Queue rows show EX id, subject, customer/email, amount (keep chips)
- [x] Rules confidence reflects signal strength; matched signals appear in Why
- [x] Suggested actions and drafts use extracted details and related-batch context
- [x] Detail panel shows clickable related links with reasons
- [x] Batch insights line above queue (related groups, P1 count, money at stake)
- [x] Evidence highlights cover decision-driving lines (amounts, codes, totals)
- [x] Keyboard shortcuts (j/k, a, r, e) and favicon
- [x] Approve/reject auto-selects next pending item
- [x] AI_PROVIDER alias and LLM prompt includes related context
- [x] Extraction, money format, draft wording, em-dash cleanup, LLM concurrency/source/guardrails
- [x] CSV/JSON/text triage parity, company team greetings, README links and dash cleanup
- [x] Persist triage session and input in localStorage across reload; Clear desk with confirm
- [x] One related link per item with joined reasons in detail panel
- [x] Plain hyphens in sample batch files (no em/en dashes)
- [ ] Final review complete — feedback resolved and learner confirms ready to ship — **waiting for Paul**

## Code Tour and App Map

- [ ] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap — **waiting for Paul** (agent prepared `devpost/app-map.html` as reference route)
- [ ] Optional edit and transfer reflection addressed — **waiting for Paul**
- [x] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

Activity and evidence: Agent generated `devpost/app-map.html` from post-build source (reference route; Paul has not yet done wrap-up activity).
Route and stops: See app-map.html — triage action through `public/app.js`, `server/index.js`, `server/rules-engine.js`.
Edit outcome: not applicable — Paul away
Reflection: not offered yet — waiting for Paul
Activity mode: reference map only until Paul returns

## Revisions

- LLM provider selection, P1 $500+ rule, disputes/duplicates always P1, Copy reply button, model defaults (`gpt-4o-mini`, `gemini-3.8-flash`), 15s fetch timeout — resolved at build; recorded in `spec.md > Decisions and Open Issues`.
- Slices 6–8 UI behaviors landed in commit `Wire input, sample batch, and triage queue UI`; later slice commits mark those checkpoints in git history.
- Final review: EX- batch ids, richer queue rows, signal-based confidence, batch-context suggestions (refund/failed payment, duplicate pairs, invoice variance), related links in detail, batch insights bar, evidence highlighting, keyboard shortcuts + favicon, auto-advance after decisions, `AI_PROVIDER` alias and related context in LLM prompts — verified via `npm test` and curl on `samples/batch.txt` / `samples/batch.csv`.
- Final review (round 2): stricter field extraction (order/invoice/decline, email-based names), en-US money formatting, no em dash in generated copy, duplicate drafts promise future refund not reversal, `LLM_CONCURRENCY`, per-item `source` chips, batch guardrails after LLM with `Batch check:` in Why, mocked Gemini tests — verified via `npm test` and curl demo triage.
- Final review (round 3): `itemFullText` and `category_hint` for rules/related/batch-context parity across CSV, JSON, and text; invoice delta from bare totals and `vs` pairs; company `Hi … team` greetings; README hackathon/skill-pack links and plain punctuation in README and server comments; `batch.csv`/`batch.txt` parity test — verified via `npm test` and curl on port 3847.
- Final review (round 4): `exception-desk-session` localStorage restores triage queue, insights, input text, and per-`triageId` decisions after reload; **Clear desk** wipes session + decisions; `mergeRelatedLinks` dedupes detail related links; `samples/batch.txt` uses ASCII hyphens — verified via `npm test` and curl on port 5301.
- Polish pass (2026-10-26): intake view with who/problem/flow and one-click sample; review view with KPI strip, status tabs, search, sort; Escalate status, internal note, Undo; key facts per item; export preview (all or reviewed only) with formula-safe CSV and richer columns; loading skeleton, empty-input, server-unreachable and no-match states; restored Clear desk (queue header); batch bar, Batch checks strip, verdict-first detail, email-style drafts with processor response for chargebacks, due dates and shipped-but-unpaid flag (round 2); fixed false invoice links in CSV batches; sample data on `.example` domains. Verified via `npm test` and headless-browser screenshots in `devpost/screenshots/`.
- Round 3 (2026-10-26, QA on 9f01ba3): fits a 1440x900 recording frame (KPIs inline in the batch bar, one-line batch checks, 9 queue rows), toast bottom-center, shorter search placeholder, detail bottom padding and shadow; "2 catches · 1 warning"; "Wrong refunds caught"; dispute deadline from the notice date or a labeled estimate; Visa reason-code meanings; "Signal match"; deduplicated why/signals; empty facts hidden; batch-check card on EX-06; tests forced offline. Verified via `npm test` and refreshed screenshots.
- Round 4 (2026-10-26): Paste a new one (facts, case link, quotes verified against the paste, drops shown; rules fallback; mock-AI mode for offline demos), Batch closed receipt, 1280x720 fixes, 'No clear signal' wording, Gemini key moved to a request header, scripts/dry-run-paste.mjs prepared but not run (live AI calls on hold). Verified via `npm test` and screenshots 01-16 plus 1280x720.
