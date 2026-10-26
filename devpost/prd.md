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
- **Review view:** slim batch bar ("12 exceptions loaded · triaged at … · Edit batch / New batch"); KPI strip; a prominent **Batch checks** strip listing cross-item catches (click to open); queue (left) with status tabs, search, category filter, sort; detail (right) with a pinned decision bar; export dialog with preview.

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
- KPI strip: to review (with progress bar), P1 open, amount still in review, refunds approved (only items whose approved step is an actual refund), wrong refunds caught (amounts on batch-check items where no refund or no second refund is due).
- Detail leads with the verdict in large type. Cross-item **batch checks** (refund on a failed payment, duplicate pairs) show "Batch check · cross-checked with EX-xx · deterministic" instead of a confidence number, on both items of a refund/failed-payment pair; other items show "Signal match NN%" with a tooltip saying it is signal strength, not a probability.
- Warnings, e.g. a shipping confirmation sent for a payment that never captured, appear above the verdict and on the queue row.
- Response deadlines become a due date shown on the row and used to sort within a priority: a stated due date is used as is; "in N business days" is counted from the notice date in the text when present, otherwise from today and labeled "estimate: N business days from today".
- Common Visa reason codes show a plain meaning next to the code (10.4, 12.6.1, 13.1 merchandise or services not received, 13.2).
- Key facts hide empty values; the detail shows the why sentence once, with deduplicated signal chips.
- Customer drafts read as an email (To, Subject, proportional font) with no internal batch wording or EX ids. Chargebacks get a dispute response for the processor portal instead of a customer email.
- Approved, escalated and rejected rows are dimmed with a check, arrow or cross; the next item scrolls into view.
- When the last item is decided, a **Batch closed** receipt replaces the queue: decisions made (approved / escalated / rejected), wrong refunds caught (batch-check items whose no-refund suggestion was approved or escalated; a rejected one is not counted), deadlines met (items with a due date decided on or before it), refunds to issue, and time on desk. Every number comes from the batch and this session's decisions; for the sample it is labeled "Sample data · 12 fictional cases". A teal ink **CLOSED** stamp with the date is the one decorative element. **Back to queue**, **Export decisions** and **New batch** sit under it; the queue banner keeps a **Batch summary** link.
- Export CSV (preview first; all or reviewed only): id, priority, category, status, subject, customer, email, amount_usd, suggested_action, final_reply (blank when rejected), reviewer_note, confidence, why, related_ids, source, decided_at. Cells that start with `=`, `+`, `-` or `@` are prefixed so spreadsheets don't run them as formulas.

### Paste a new one
- **Paste a new one** in the batch bar opens a dialog: paste one message as it arrived (an angry email in Spanish, a forwarded thread, a bank letter), or pick an example (Spanish email, Forwarded thread, No match), then **Extract and link**.
- Result: the engine used (AI provider/model, Mock AI, Rules engine or Rules fallback) and the message language; facts (customer, email, amount, order/ref, what happened, what they want), each marked **in source** or **summary**; the case it belongs to with the shared keys (same ref, same email, same amount), what the desk already says about that case, other related ids, **Open EX-xx** and **Add to EX-xx note**; or "No matching case in this batch".
- Every quote the engine returns is checked against the pasted text with a normalized substring match (Unicode NFKC, case, curly quotes and dashes, `>` reply markers and whitespace ignored; accents kept). Matches get a **Verified in source** badge. Anything not found is listed under **Dropped**, struck through, never hidden. A specific fact value (customer, email, amount, ref) the message does not contain is dropped the same way.
- A link the model suggests is kept only if the deterministic check agrees (shared reference, or same email and amount); otherwise the dialog says which case the model suggested and why it was not linked.
- Rules mode (no key) extracts the same facts with patterns that read English and Spanish (`120,00 US$`, `pedido`, `reembolso`) and links by the same check. A model error or timeout falls back to rules and says so.
- The paste never enters the queue, never sends anything and never changes a decision except an explicit **Add to note**.

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
- **Paste errors** — empty paste: toast; over 8,000 characters: inline message; server down: inline error.
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
