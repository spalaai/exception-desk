---
doc: scope
status: approved
---
> Answers relayed by Paul's assistant from Paul's notes on 2026-10-26.

# Exception Desk

One line: paste or upload a batch of payment/invoice exceptions, triage them into a human-reviewed queue with evidence-backed AI suggestions—no money moves without a click.

## The Unique Kernel
Triage an entire messy batch at once into a review queue where every suggestion shows its reasoning and the exact lines from the raw text; flag related items inside the batch (e.g. duplicate charge, refund for an already-failed payment); nothing that moves money happens without explicit human approval.

## Who It's For
The one ops or finance person at a small online business (about 5–50 people) who owns the "weird cases" inbox—not enterprises with a dedicated payments ops team. Today they read each item, sort urgency, decide next steps, and draft first replies.

## The Core Loop
They paste or upload a batch → run triage → scan a priority-sorted queue (category, next action, draft reply, evidence) → open an item, edit the draft if needed → approve, escalate or reject → export decisions (CSV / copy reply). They come back whenever a new batch lands.

## Inspiration & Identity
Calm, serious ops tool—not a flashy AI demo. Dense but readable, Linear-like energy: trustworthy, fast to scan, evidence visible.

## Why This Matters to the Learner
"Every exception is a small investigation, and the boring part is reading, sorting and writing the first reply, not the decision." Paul wants to practice plan-first building on something that matches real ops pain.

## What "Working" Looks Like
In about a minute on screen: load the sample batch, click Triage, see the queue sorted by priority with categories and draft replies; open one, edit, approve; approve/reject others; export CSV. The "oh, that's cool" beat is seeing messy input become an evidence-linked queue with related-item flags.

## The POC Boundary
- Input: paste, upload (CSV, JSON, or plain text with one item per block), or load sample batch
- Triage: category, priority, suggested action, draft reply, confidence, why, highlighted evidence lines
- Review queue with status tabs, category filter, search and sort; approve / escalate / reject / undo, with an internal note per item
- Key facts per item (customer, amount, order/invoice, reason code, deadline) pulled deterministically from the source
- Related-item detection within the batch
- Export decisions; demo mode without API key (deterministic rules); optional real LLM when env key is set
- Human always approves; no automatic money movement

## Later
Stripe/PayPal/QuickBooks connectors, sending email, multi-user accounts, history across sessions beyond browser local storage.

## Explicitly Cut
Actually issuing refunds or moving money; auth/login; hosting requirement; mobile app.

## Revision note (2026-10-26, polish pass)
Scope unchanged in spirit. Added an **Escalate** decision (common in finance review when something needs a second person), a per-item internal note, search/sort, and a key-facts block. Still no money movement, no sending, no accounts.
