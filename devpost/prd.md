---
doc: prd
status: approved
---
> Answers relayed by Paul's assistant from Paul's notes on 2026-10-26.

# Exception Desk — Product Requirements

Paste the mess, review the queue—for the solo ops/finance owner at a small online business who handles daily payment exceptions.
Source: `scope.md > The Core Loop`, `scope.md > The POC Boundary`.

## The Core Journey
1. Open the app; the intake screen says who it is for, the problem, and the three-step flow. Header shows **Demo mode · rules engine** or **AI: &lt;provider/model&gt;**, plus a "Records only · nothing is sent or refunded" badge.
2. Paste text, upload a file (CSV, JSON, or block-structured plain text), click **Load sample**, or click **Try the sample batch** (loads and triages in one click). The sample is labeled as 12 fictional cases.
3. Click **Triage batch**; a loading skeleton shows, then the review desk opens with the queue sorted by priority (P1 first, larger amounts first within a priority).
4. Scan the KPI strip (to review, P1 open, amount still in review, refunds approved, related groups) and the queue; use status tabs, category filter, search and sort; related rows show which ids they link to.
5. Select an item; detail shows the suggested next step with confidence and why, key facts, related items, source text with evidence lines highlighted, an editable draft reply with **Copy reply**, and an internal note.
6. **Approve** (A), **Escalate** (X) or **Reject** (R); the desk records the decision and moves to the next item still to review. **Undo** returns an item to review.
7. **Export CSV** opens a preview (all or reviewed only), then downloads one row per exception with status, amount, final reply, note and reasoning.

## Screens and Layout
Two views on one page (source: `scope.md > What "Working" Looks Like`):
- **Header (both):** app name, "Records only" safety badge, mode indicator (demo vs AI provider/model), **New batch** when reviewing.
- **Intake view:** left, a short pitch (who it's for, the problem, 3 steps, what it checks across a batch) with **Try the sample batch**; right, the batch composer (paste box, **Upload file**, **Load sample**, **Triage batch**), inline errors, and **Back to review queue** / **Clear saved desk** when a session exists.
- **Review view:** KPI strip on top; queue (left) with status tabs, search, category filter, sort; detail (right) with a pinned decision bar; export dialog with preview.

## Look and Feel
Calm, serious ops tool—not generic "AI app" chrome. Light theme: warm off-white background, white cards with soft shadows, ink-dark text, deep teal accent. Priority chips: muted red (P1), amber (P2), grey (P3); status pills: grey (to review), green (approved), violet (escalated), red (rejected). Inter if installed locally, else the system UI font; monospace with line numbers for raw exception text; tabular numbers for money. Density similar to Linear: readable but information-dense.

## Features and Behavior

### Input and triage
- Accept pasted text, uploaded CSV/JSON/plain blocks, or built-in sample (~12 invented items).
- **Triage** produces per item: category, priority, suggested next action, draft reply, confidence, why, and evidence line references into the raw text.
- Categories: failed payment, invoice mismatch, refund request, dispute/chargeback, duplicate charge, other / needs human.
- Priorities: P1 urgent (dispute deadlines, large amounts, duplicate charges), P2, P3.

### Review queue
- List sorted by priority (then amount); optional sort by amount, lowest confidence, or batch order.
- Status tabs with counts (all, to review, approved, escalated, rejected), category filter, free-text search over names, emails, references and source text.
- Related items flagged when batch analysis finds links (same customer/email + amount in a short window, refund referencing failed payment, same invoice number).

### Detail and decisions
- Evidence lines highlighted in raw text; key facts (customer, email, amount, order, invoice, invoice vs paid, missing reference, merchant ref, reason code, decline reason, response due) shown only when found.
- Human edits draft before approving; **Copy reply** for pasting into their own inbox; optional internal note.
- **Approve**, **Escalate**, **Reject**, **Undo**; status pills on queue rows; auto-advance to the next item to review.
- KPI strip: to review (with progress bar), P1 open, amount still in review, refunds approved (only items whose approved step is an actual refund), related groups.
- When everything is reviewed, the queue says so and offers export.
- Export CSV (preview first; all or reviewed only): id, priority, category, status, subject, customer, email, amount_usd, suggested_action, final_reply (blank when rejected), reviewer_note, confidence, why, related_ids, source, decided_at. Cells that start with `=`, `+`, `-` or `@` are prefixed so spreadsheets don't run them as formulas.

## States and Boundaries
- **First run** — intake view explains the product; nothing to review yet.
- **Loading** — skeleton KPIs, queue and detail while triage runs.
- **Empty input** — inline "Nothing to triage yet" message; no triage run.
- **Server unreachable / server error** — inline error with **Try again**; the pasted batch is kept.
- **No filter matches** — empty state with **Clear filters**.
- **Unparseable item** — category other / needs human, low confidence; item never dropped.
- **LLM error or timeout** — that item falls back to rules; UI labels fallback clearly.
- **Large batch** — cap at 100 items with a clear message.
- **Persistence** — review decisions persist in the browser between reloads (per spec); triage results live for the session.
- **Money** — no automatic refunds or payouts; human click required for any "action" (recorded as decision only in POC).

## Product Decisions
- **Single-screen layout** — keeps demo under one minute; no navigation sprawl.
- **Demo mode default** — judges can run without keys; AI is opt-in via env.
- **Evidence in raw text** — kernel requirement; builds trust for ops users.
- **CSV export** — practical handoff to email/ERP later without building integrations now.

## What We're Building
Everything in `scope.md > The POC Boundary`, with behaviors and edge cases above.

## Deferred From the POC
Live payment processor integrations, outbound email, multi-user auth, cross-session server history.

## Possible Later Enhancements
Connector to Stripe/PayPal/QuickBooks; send approved replies from the tool; team queue with assignment.

## Non-Goals
Issuing refunds or moving money; login; required hosting; mobile-native app (per `scope.md > Explicitly Cut`).

## Open Questions
- None blocking spec—default cap (100 items) and sample batch size (~12) are set in learner notes.
