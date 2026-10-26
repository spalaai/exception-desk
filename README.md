# Exception Desk

**Paste the mess, review the queue.** For the one ops or finance person at a small online business who owns the "weird payments" inbox: declined cards, duplicate charges, refund requests, invoice mismatches, chargebacks. Paste or upload a batch; every item gets a category, priority, suggested next step, draft reply, key facts and highlighted evidence, and related cases in the batch are linked. You approve, escalate or reject each one and export the decisions. Nothing is sent and no money moves.

## Quick start

```bash
npm install && npm start
```

Open [http://localhost:5173](http://localhost:5173) (override with `PORT`).

Click **Try the sample batch** to load and triage 12 fictional exceptions (names, companies and `.example` email domains are made up). Each item gets a stable id (`EX-01`, `EX-02`, …) in paste order; the same ids appear in the CSV export.

## Demo mode vs AI mode

| Mode | When | Header |
|------|------|--------|
| **Demo (rules)** | No API keys in `.env` | `Demo mode · rules engine` |
| **AI** | `OPENAI_API_KEY` or `GEMINI_API_KEY` set | `AI: OpenAI / …` or `AI: Gemini / …` |

- `LLM_PROVIDER` or `AI_PROVIDER`: `openai`, `gemini`, or `rules` (forces demo even if keys exist).
- If unset, uses whichever key exists (**OpenAI first** when both are set).
- `OPENAI_MODEL` default `gpt-4o-mini`; `GEMINI_MODEL` default `gemini-3.8-flash`.
- LLM calls use native `fetch` with a **15s timeout** and **`LLM_CONCURRENCY`** (default 4); any failure falls back to **rules per item** (labeled **Rules fallback** in the UI).
- In AI mode, each item’s prompt includes **deterministic related-item context** from the same batch linker used in demo mode.

Copy `.env.example` to `.env` for local AI trials (never commit `.env`).

## Review desk

- **KPI strip**: items to review (with progress), P1 still open, amount still in review, refunds approved (only where the approved step really is a refund), related groups.
- **Queue**: priority, `EX-xx` id, subject, category, customer, linked ids, amount, status. Status tabs with counts, category filter, search (names, emails, order/invoice refs, source text), sort by priority, amount, lowest confidence or batch order.
- **Detail**: suggested next step with confidence and why; key facts (customer, amount, order, invoice vs paid, reason code, response deadline…); related items; source text with line numbers and evidence lines highlighted; editable draft with **Copy reply**; internal note.
- **Decisions**: **Approve**, **Escalate**, **Reject**, **Undo**; the desk moves to the next item to review. Decisions and the queue persist in this browser; **Clear saved desk** on the intake screen wipes them.
- **Export CSV**: preview first, all items or reviewed only. Columns: `id, priority, category, status, subject, customer, email, amount_usd, suggested_action, final_reply, reviewer_note, confidence, why, related_ids, source, decided_at`. Formula-like cells are escaped for spreadsheets.
- **Keyboard**: `j`/`k` or arrows move; `a` approve; `x` escalate; `r` reject; `e` edit reply; `/` search.

## Rules highlights (demo mode)

- **P1**: disputes/chargebacks, duplicate charges, and amounts **≥ $500**.
- Related items in a batch: same email + amount, same invoice number, refund tied to a failed payment.
- Confidence and **Why** reflect matched signals (e.g. reason code vs weak keywords).
- Batch context adjusts suggestions (e.g. refund when payment never captured, duplicate pairs, invoice shortfall).

## Tests

```bash
npm test
```

Covers parser, rules engine, related-item detection, refinement behaviors (ids, confidence, batch context), key facts, client desk logic (filters, sort, KPIs, CSV export), and an HTTP smoke test of `POST /api/triage` on the sample batch.

## Project structure

```
server/          HTTP server, parser, rules/LLM triage, related detection
public/          Single-page desk UI (HTML/CSS/JS, no bundler); public/lib holds tested pure logic
samples/         Invented batch.csv and batch.txt for demos
test/            node:test suites
devpost/         Planning docs and app map (hackathon)
```

## Built with

- [Build With AI: Basics](https://github.com/challengepost/learn-ai-basics) Devpost Learn skill pack (planning under `.agents/`)
- [Learn AI Basics hackathon](https://learn-ai-basics.devpost.com/)
- [Cursor](https://cursor.com/) plan-first agentic build

## Pre-existing code

**None.** Application code in this repository was written fresh for this project on **2026-10-26**. Third-party material is limited to the Devpost Learn skill pack files under `.agents/` (and mirrored `.claude/` / `agent/` paths), which are planning templates, not part of the runtime app.

## License

MIT Copyright (c) 2026 Pavlo Bogosta. See [LICENSE](LICENSE).
