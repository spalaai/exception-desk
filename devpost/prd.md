---
doc: prd
status: approved
---
> Answers relayed by Paul's assistant from Paul's notes on 2026-10-26.

# Exception Desk — Product Requirements

Paste the mess, review the queue—for the solo ops/finance owner at a small online business who handles daily payment exceptions.
Source: `scope.md > The Core Loop`, `scope.md > The POC Boundary`.

## The Core Journey
1. Open the app; header shows **Demo mode (rules)** or **AI: &lt;provider/model&gt;** depending on configuration.
2. On the input area: paste text, upload a file (CSV, JSON, or block-structured plain text), or click **Load sample batch**.
3. Click **Triage**; each item appears in the queue sorted by priority (P1 first).
4. Scan the queue; filter by category and review status; notice related-item flags on linked rows.
5. Select an item; detail panel shows raw text with evidence lines highlighted, category, priority, suggested action, confidence, reasoning, and an editable draft reply.
6. **Approve**, **Reject**, or **Reset**; approved/rejected items show status chips; summary bar updates counts (total, P1, approved, rejected, pending).
7. **Export CSV** of all decisions including final reply text; copy reply from the detail panel as needed.

## Screens and Layout
Single main screen, three areas (source: `scope.md > What "Working" Looks Like`):
- **Header:** app name, mode indicator (demo vs AI provider/model).
- **Input (left or top):** paste box, file upload, **Load sample batch**, **Triage** button.
- **Queue (center):** sortable list by priority; filters for category and status; related-item indicator per row.
- **Detail (right or bottom):** selected item—highlighted evidence in raw text, metadata, editable draft, action buttons.

## Look and Feel
Calm, serious ops tool—not generic "AI app" chrome. Light theme: off-white background, ink-dark text, deep teal accent. Priority chips: muted red (P1), amber (P2), grey (P3). System UI sans or Inter if available locally; monospace for raw exception text. Density similar to Linear: readable but information-dense.

## Features and Behavior

### Input and triage
- Accept pasted text, uploaded CSV/JSON/plain blocks, or built-in sample (~12 invented items).
- **Triage** produces per item: category, priority, suggested next action, draft reply, confidence, why, and evidence line references into the raw text.
- Categories: failed payment, invoice mismatch, refund request, dispute/chargeback, duplicate charge, other / needs human.
- Priorities: P1 urgent (dispute deadlines, large amounts, duplicate charges), P2, P3.

### Review queue
- List sorted by priority; filter by category and status (pending, approved, rejected).
- Related items flagged when batch analysis finds links (same customer/email + amount in a short window, refund referencing failed payment, same invoice number).

### Detail and decisions
- Evidence lines highlighted in raw text; human edits draft before approve.
- **Approve**, **Reject**, **Reset**; status chips on queue rows.
- Summary bar: total, P1 count, approved, rejected, pending.
- Export CSV with final reply text and decision metadata.

## States and Boundaries
- **Empty input** — friendly message; no triage run.
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
