# Exception Desk

**Paste the mess, review the queue.** Ops and finance teams paste or upload a batch of payment exceptions; the server triages each item into category, priority, suggested action, draft reply, and evidence lines. You review, approve, edit, or reject—nothing moves money automatically.

## Quick start

```bash
npm install && npm start
```

Open [http://localhost:5173](http://localhost:5173) (override with `PORT`).

Click **Load sample batch**, then **Triage**, to see ~12 invented exceptions sorted by priority.

## Demo mode vs AI mode

| Mode | When | Header |
|------|------|--------|
| **Demo (rules)** | No API keys in `.env` | `Demo mode (rules)` |
| **AI** | `OPENAI_API_KEY` or `GEMINI_API_KEY` set | `AI: OpenAI / …` or `AI: Gemini / …` |

- `LLM_PROVIDER=openai` or `gemini` — if unset, uses whichever key exists (**OpenAI first** when both are set).
- `OPENAI_MODEL` default `gpt-4o-mini`; `GEMINI_MODEL` default `gemini-3.8-flash`.
- LLM calls use native `fetch` with a **15s timeout**; any failure falls back to **rules per item** (labeled in the UI).

Copy `.env.example` to `.env` for local AI trials (never commit `.env`).

## Rules highlights (demo mode)

- **P1**: disputes/chargebacks, duplicate charges, and amounts **≥ $500**.
- Related items in a batch: same email + amount, same invoice number, refund tied to a failed payment.

## Tests

```bash
npm test
```

Covers parser, rules engine, related-item detection, and an HTTP smoke test of `POST /api/triage` on the sample batch.

## Project structure

```
server/          HTTP server, parser, rules/LLM triage, related detection
public/          Single-page desk UI (HTML/CSS/JS, no bundler)
samples/         Invented batch.csv and batch.txt for demos
test/            node:test suites
devpost/         Planning docs and app map (hackathon)
```

## Built with

- [Build With AI: Basics](https://devpost.com/) — Devpost Learn skill pack (planning under `.agents/`)
- [Cursor](https://cursor.com/) — plan-first agentic build

## Pre-existing code

**None.** Application code in this repository was written fresh for this project on **2026-10-26**. Third-party material is limited to the Devpost Learn skill pack files under `.agents/` (and mirrored `.claude/` / `agent/` paths), which are planning templates—not part of the runtime app.

## License

MIT — Copyright (c) 2026 Pavlo Bogosta. See [LICENSE](LICENSE).
