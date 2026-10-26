import './_offline.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBatch } from '../server/parser.js';
import { runPaste, quoteInSource, normalizeForMatch, verifyQuotes, rulesExtract, pasteAmounts } from '../server/paste.js';
import { mockPasteModel } from '../server/paste-mock.js';
import { createApp } from '../server/index.js';
import http from 'node:http';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const cases = parseBatch(read('samples/batch.txt')).items.map((x, i) => ({ id: `EX-${String(i + 1).padStart(2, '0')}`, rawText: x.rawText }));
const spanish = read('samples/paste/spanish-email.txt');
const forwarded = read('samples/paste/forwarded-thread.txt');
const noMatch = read('samples/paste/no-match.txt');

/** Model stub: records the prompt and returns a fixed reply. No network. */
function stubModel(reply) {
  const calls = [];
  const fn = async (prompt) => {
    calls.push(prompt);
    return structuredClone(reply);
  };
  fn.calls = calls;
  return fn;
}

describe('quote verification', () => {
  it('matches across case, curly quotes, email ">" markers and whitespace', () => {
    assert.ok(quoteInSource('our bank says the cardholder   disputed $312.00', forwarded));
    assert.ok(quoteInSource('“Quiero el reembolso completo HOY”', spanish));
    assert.equal(normalizeForMatch('> A\n>  B'), 'a b');
  });
  it('rejects text that is not in the source, and trivially short quotes', () => {
    assert.equal(quoteInSource('Me cobraron dos veces', spanish), false);
    assert.equal(quoteInSource('HOY', spanish), false);
  });
  it('splits verified from dropped', () => {
    const { verified, dropped } = verifyQuotes([{ text: 'pedido AC-7781', supports: 'ref' }, { text: 'invented line', supports: 'amount' }], spanish);
    assert.equal(verified.length, 1);
    assert.equal(dropped.length, 1);
    assert.match(dropped[0].reason, /Not found/);
  });
});

describe('paste: AI path (mocked model)', () => {
  it('marks real quotes verified and drops a hallucinated one, visibly', async () => {
    const r = await runPaste({ text: spanish, cases }, { model: mockPasteModel, source: 'mock-ai' });
    assert.equal(r.source, 'mock-ai');
    assert.ok(r.quotes.length >= 3);
    assert.ok(r.quotes.every((q) => q.verified && quoteInSource(q.text, spanish)));
    assert.deepEqual(r.dropped.map((d) => d.text), ['Me cobraron dos veces']);
    assert.equal(r.facts.amount, 120);
    assert.equal(r.facts.ref, 'AC-7781');
    assert.equal(r.language, 'es');
  });

  it('links to the existing case when the deterministic check agrees', async () => {
    const r = await runPaste({ text: spanish, cases }, { model: mockPasteModel });
    assert.equal(r.link.id, 'EX-05');
    assert.equal(r.link.basis, 'ai+check');
    assert.ok(r.link.otherIds.includes('EX-06'));
    assert.ok(r.link.reasons.some((x) => /AC-7781/.test(x)));
  });

  it('refuses a model link with nothing in common, and says so', async () => {
    const model = stubModel({ customer: 'Priya', amount: 75, ref: 'INV-5120', linkedCaseId: 'EX-04', quotes: [{ text: 'resend invoice INV-5120', supports: 'ref' }] });
    const r = await runPaste({ text: noMatch, cases }, { model });
    assert.equal(model.calls.length, 1);
    assert.equal(r.link, null);
    assert.match(r.linkNote, /EX-04.*Not linked/);
  });

  it('drops a fact value the message does not contain', async () => {
    const model = stubModel({ customer: 'Jen Park', amount: 999, ref: 'AC-9999', quotes: [] });
    const r = await runPaste({ text: spanish, cases }, { model });
    assert.equal(r.facts.amount, undefined);
    assert.equal(r.facts.ref, undefined);
    assert.deepEqual(r.droppedFacts.map((d) => d.field).sort(), ['amount', 'ref']);
  });

  it('returns no link for a message about something not in the batch', async () => {
    const model = stubModel({ email: 'accounts@quillco.example', amount: 75, ref: 'INV-5120', linkedCaseId: '', quotes: [] });
    const r = await runPaste({ text: noMatch, cases }, { model });
    assert.equal(r.link, null);
    assert.equal(r.linkNote, '');
    assert.equal(r.facts.ref, 'INV-5120');
  });

  it('falls back to rules when the model call fails', async () => {
    const r = await runPaste({ text: spanish, cases }, { model: async () => { throw new Error('timeout'); } });
    assert.equal(r.source, 'rules-fallback');
    assert.match(r.fallbackReason, /rules were used/);
    assert.equal(r.link.id, 'EX-05');
  });

  it('sends the cases and the message to the model, and nothing else is needed', async () => {
    const model = stubModel({ quotes: [] });
    await runPaste({ text: forwarded, cases }, { model });
    assert.match(model.calls[0], /\[EX-09\]/);
    assert.match(model.calls[0], /LM-CB-2026-44/);
  });
});

describe('paste: rules mode (no key)', () => {
  it('extracts facts from a Spanish email and links EX-05', async () => {
    const r = await runPaste({ text: spanish, cases });
    assert.equal(r.source, 'rules');
    assert.equal(r.facts.customer, 'Jen Park');
    assert.equal(r.facts.email, 'jen@acme.example');
    assert.equal(r.facts.amount, 120);
    assert.equal(r.facts.wants, 'refund');
    assert.equal(r.link.id, 'EX-05');
    assert.ok(r.quotes.length && r.dropped.length === 0);
  });
  it('links a forwarded chargeback thread to EX-09 by its reference', async () => {
    const r = await runPaste({ text: forwarded, cases });
    assert.equal(r.link.id, 'EX-09');
    assert.equal(r.facts.amount, 312);
    assert.equal(r.category, 'dispute / chargeback');
  });
  it('reports no match for an unrelated message', async () => {
    const r = await runPaste({ text: noMatch, cases });
    assert.equal(r.link, null);
    assert.equal(r.facts.ref, 'INV-5120');
  });
  it('reads comma-decimal and US$ amounts', () => {
    assert.deepEqual(pasteAmounts('Me cobraron 120,00 US$'), [120]);
    assert.ok(pasteAmounts('USD 1,240.00').includes(1240));
    assert.equal(rulesExtract('hola').facts.amount, undefined);
  });
  it('rejects empty and oversized pastes', async () => {
    await assert.rejects(runPaste({ text: '  ' }), /Paste a message/);
    await assert.rejects(runPaste({ text: 'x'.repeat(9000) }), (e) => e.status === 413);
  });
});

describe('POST /api/paste', () => {
  it('serves the rules extract with no key configured', async () => {
    const { pasteHandler } = await import('../server/index.js');
    const server = http.createServer(createApp({ onPaste: pasteHandler }));
    await new Promise((r) => server.listen(0, r));
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/paste`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: spanish, cases }),
      });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.source, 'rules');
      assert.equal(data.link.id, 'EX-05');
      const s = await fetch(`http://127.0.0.1:${port}/api/paste-samples`).then((x) => x.json());
      assert.ok(s.samples['spanish-email'].includes('AC-7781'));
    } finally {
      server.close();
    }
  });
});

describe('gemini key handling (mocked fetch)', () => {
  it('sends the key in a header, never in the URL', async () => {
    const { callModelJson } = await import('../server/llm-triage.js');
    const prev = globalThis.fetch;
    let seen;
    globalThis.fetch = async (url, opts) => {
      seen = { url: String(url), headers: opts.headers };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"quotes":[]}' }] } }] }) };
    };
    process.env.GEMINI_API_KEY = 'fake-test-key';
    try {
      await callModelJson('hi', { provider: 'gemini', model: 'test-model' });
    } finally {
      globalThis.fetch = prev;
      delete process.env.GEMINI_API_KEY;
    }
    assert.ok(!seen.url.includes('fake-test-key'));
    assert.equal(seen.headers['x-goog-api-key'], 'fake-test-key');
  });
});
