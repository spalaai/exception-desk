---
doc: spec
status: approved
---
> Answers relayed by Paul's assistant from Paul's notes on 2026-10-26.

# Exception Desk — Technical Spec

## How This Works, In Plain Language
A small **Node server** serves one web page and a few JSON APIs. The browser is the ops desk: you paste or upload a batch, click Triage, and the **server** parses items and runs a **triage engine** (rules by default; optional LLM per item when a key is in the environment). The server never exposes API keys to the browser. Results return to the page as a review queue; your approve/edit/reject choices save in the browser's **localStorage** so a refresh does not wipe decisions. Related-item links are computed on the server with simple deterministic rules across the batch. Export builds a CSV in the browser from the current queue + decisions.

## The Core Journey Through the System
1. Browser loads static HTML/CSS/JS from the server → `prd.md > The Core Journey` step 1.
2. User loads input → client sends batch to `POST /api/triage` → **parser** splits into items → **triage engine** enriches each → **related detector** adds flags → JSON queue returned → client renders list and detail.
3. User selects row → client highlights evidence lines in raw text (client-side from triage payload).
4. User approves/rejects/edits → client updates in-memory model + **localStorage** (`prd.md > Detail and decisions`).
5. Export → client generates CSV download (`prd.md > Review queue`).

## Stack
| Piece | Choice | Docs / notes |
|-------|--------|----------------|
| Runtime | Node 20 | https://nodejs.org/docs/latest-v20.x/api/ |
| Server | Node `http` module (no Express) | Minimal deps; static file + JSON routes |
| Frontend | Plain HTML, CSS, JS (no bundler) | Served from `public/` |
| Tests | Node built-in `node:test` | https://nodejs.org/api/test.html |
| Optional LLM | OpenAI or Google Gemini REST | Keys only in server env |

Rationale: matches learner preference for one command start, minimal dependencies, and easy judge setup.

## Where It Runs and How Someone Tries It
- Local process: `npm install && npm start`
- Default URL: `http://localhost:5173` (override with `PORT`)
- Demo: no keys required—rules engine only; header shows **Demo mode (rules)**.
- AI mode: set `OPENAI_API_KEY` or `GEMINI_API_KEY` in `.env` (see `.env.example`); header shows provider/model.
- Demo video: record local run with sample batch triage + one approve/edit + CSV export.
- Deployment: optional, not required for submission.

## Look and Feel
Implement `prd.md > Look and Feel`: warm off-white (`#f6f5f2`), white cards, ink text (`#16181d`), accent deep teal (`#0d6b6e`), muted P1/P2/P3 chips, status pill colors. `font-family: Inter, system-ui, …` with `Inter` only if installed locally (no CDN, no bundled font files). Raw text in `ui-monospace` / monospace. Compact padding, clear table/list rows—Linear-like density without copying their UI kit.

## Components

### Static frontend (`public/`)
One page with two views: intake (pitch + composer) and review (KPI strip, queue, detail, export dialog). `public/app.js` owns DOM and state; pure logic lives in `public/lib/desk-logic.js` (filters, sort, KPIs, refund-on-approve check, CSV building, formula-safe cells) so it is unit-tested in Node (`test/desk-logic.test.js`).
PRD ref: `prd.md > Screens and Layout`, `prd.md > Features and Behavior`.

### HTTP server (`server/`)
Routes: serve static assets; `POST /api/triage` (body: raw text or structured upload payload); optional `GET /api/mode` for header label.
PRD ref: `prd.md > Input and triage`.

### Batch parser (`server/parser.js`)
Splits CSV, JSON array, or plain text blocks into normalized items `{ id, rawText, fields? }`.
PRD ref: `prd.md > Input and triage`, `prd.md > States and Boundaries` (unparseable → still one item).

### Rules triage engine (`server/rules-engine.js`)
Deterministic keywords, amounts, dates, references → category, priority, action, draft, confidence, why, evidence line indices.
PRD ref: `prd.md > Input and triage`; implements demo mode kernel.

### LLM triage adapter (`server/llm-triage.js`)
If env key present: strict JSON schema prompt per item; validate response; on any error/timeout → delegate to rules for that item and set `fallback: "rules"`.
PRD ref: `prd.md > States and Boundaries` (LLM fallback).

### Related-item detector (`server/related.js`)
Batch pass: same email/customer + same amount within window; refund text referencing failed payment; duplicate invoice numbers (normalised so `INV-2048` and `invoice 2048` match, and the word "invoice" alone never counts as an id).
PRD ref: `prd.md > Review queue`.

### Client app (`public/app.js`)
Renders queue/detail, highlights evidence, filters, localStorage for decisions, CSV export, 100-item cap with message.
PRD ref: `prd.md > Review queue`, `prd.md > Detail and decisions`, `prd.md > States and Boundaries`.

## Data Model
**TriageItem** (server response, held in client memory after triage):
`{ id, rawText, category, priority, suggestedAction, draftReply, confidence, why, matchedSignals, evidenceLines: number[], relatedIds: string[], relatedLinks, source: "rules"|"ai"|"rules-fallback", displaySubject, displayEmail, displayCustomer, displayAmount, facts: {label, value}[] }`
`facts` come from `buildFacts` in `server/batch-context.js` (deterministic, also in AI mode); only fields actually found are included. `applyBatchContext` also sets `batchCheck { kind, verdict, detail, ids }` for cross-item checks (`refund_after_failed`, `duplicate_primary`, `duplicate_secondary`), `flags: string[]` (e.g. shipped but never captured), `replyKind: "customer"|"processor"`, and `dueDate` (YYYY-MM-DD) from `responseDeadline`: stated due date, else business days from the notice date, else an estimate from today. `REASON_CODE_MEANINGS` maps common Visa reason codes to a plain meaning. The failed-payment side of a refund pair gets `batchCheck.kind = "failed_with_refund_request"`. Tests import `test/_offline.js`, which forces rules mode and blocks non-localhost `fetch`, so exported AI keys can't make the suite hang.

**Decision** (client + localStorage key `exception-desk-decisions`, keyed by `triageId` then item id):
`{ status: "pending"|"approved"|"escalated"|"rejected", finalReply, note, updatedAt }`

Triage results are not persisted server-side (new triage replaces queue); decisions merge by `itemId` on reload if the same triage session is restored—on new triage, clear or remap decisions (simplest: clear decisions when a new triage id is issued).

**Session id:** server returns `triageId` (uuid) per run; client stores decisions keyed with `triageId` to avoid stale merges.

## File Structure
```
exception-desk/
├── package.json
├── LICENSE                 # MIT, Copyright 2026 Pavlo Bogosta
├── README.md
├── .env.example
├── .gitignore
├── server/
│   ├── index.js            # HTTP server, routes, PORT
│   ├── parser.js
│   ├── rules-engine.js
│   ├── llm-triage.js
│   ├── related.js
│   └── mode.js             # demo vs AI label for header
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── lib/desk-logic.js   # pure, tested: filters, sort, KPIs, CSV
├── samples/
│   ├── batch.csv
│   └── batch.txt
├── test/
│   ├── parser.test.js
│   ├── rules-engine.test.js
│   ├── related.test.js
│   ├── facts.test.js       # key facts on the sample batch
│   ├── desk-logic.test.js  # client filters, KPIs, CSV export
│   └── triage-http.test.js # smoke POST /api/triage
└── devpost/                # planning docs
```

## External Services and Dependencies
- **OpenAI Chat Completions** (optional): `POST https://api.openai.com/v1/chat/completions` — key `OPENAI_API_KEY`; model from `OPENAI_MODEL` default `gpt-4o-mini` (verify at build time).
- **Google Gemini** (optional): Generative Language API — key `GEMINI_API_KEY`; model from `GEMINI_MODEL` default `gemini-3.8-flash`.
- If both keys set: use `LLM_PROVIDER=openai|gemini`; if unset, use whichever key exists (OpenAI first when both present).

No npm LLM SDK required unless build finds raw `fetch` awkward on Node 20 (native `fetch` is available).

## Important Failure Modes
- **LLM slow/fail/invalid JSON** → per-item rules fallback; row shows fallback label (`prd.md > States and Boundaries`).
- **Empty or over-100 batch** → user message; no partial silent drop (`prd.md > States and Boundaries`).
- **Missing static asset** → server 404; tests catch route wiring.

## What Was Simplified and Why
- **In-memory triage on server** instead of database — POC proves triage + review, not archival (`scope.md > Later`).
- **localStorage for decisions** instead of accounts — single-user desk (`scope.md > Explicitly Cut` auth).
- **Rules-first demo** instead of requiring paid API for judges — `scope.md > The POC Boundary`.
- **Decisions only** instead of real refunds — money movement cut explicitly.

## Decisions and Open Issues
| Decision | Choice | Why |
|----------|--------|-----|
| Server framework | Native `http` | Minimal deps per learner request |
| LLM interface | Strict JSON + Zod/manual validate | Fail safe to rules per item |
| Related items | Server-side deterministic | Kernel; reproducible in demo mode |
| Default port | 5173 | Learner note |

**Learner uncertainty (plan-first practice):** how tightly to couple build steps to spec headings—**clarified:** `5-build` checklist will cite spec component headings and PRD behaviors; no extra tooling required.

**Resolved at build:**
- `LLM_PROVIDER=openai|gemini`; if unset, whichever key exists (OpenAI first if both). Defaults: `OPENAI_MODEL=gpt-4o-mini`, `GEMINI_MODEL=gemini-3.8-flash`. LLM via native `fetch`, 15s timeout, per-item rules fallback.
- P1 amount threshold: **$500 or more**; all disputes/chargebacks and duplicate charges are P1 regardless of amount.
- **Copy reply** button beside the draft field in the detail panel.

**Open issues:** none blocking build.

**Polish pass (2026-10-26):** intake/review views, KPI strip, status tabs + search + sort, Escalate status and internal note, key facts, export preview with reviewed-only option and formula-safe CSV, loading/empty/error states, sample data moved to reserved `.example` domains. No new dependencies; demo (rules) mode unchanged.
