import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency, runTriage } from '../server/triage-run.js';
import { triageItemWithContext } from '../server/llm-triage.js';
import { triageWithRules } from '../server/rules-engine.js';
import { attachRelatedItems } from '../server/related.js';
import { applyBatchContext } from '../server/batch-context.js';

const originalFetch = globalThis.fetch;

describe('mapWithConcurrency', () => {
  it('preserves result order under concurrency', async () => {
    const items = [1, 2, 3, 4, 5, 6];
    const order = [];
    const out = await mapWithConcurrency(items, 3, async (n) => {
      order.push(n);
      await new Promise((r) => setTimeout(r, (6 - n) * 5));
      return n * 10;
    });
    assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
    assert.equal(order.length, 6);
  });
});

describe('gemini path (mocked fetch)', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.LLM_PROVIDER = 'gemini';
    delete process.env.OPENAI_API_KEY;
    process.env.LLM_CONCURRENCY = '3';

    globalThis.fetch = async () => {
      await new Promise((r) => setTimeout(r, 5));
      return {
        ok: true,
        async json() {
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        category: 'failed payment',
                        priority: 'P2',
                        suggestedAction: 'Wrong AI action',
                        draftReply: 'AI draft',
                        confidence: 1.4,
                        why: 'LLM guess',
                        evidenceLines: [0],
                      }),
                    },
                  ],
                },
              },
            ],
          };
        },
      };
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_CONCURRENCY;
  });

  it('labels source, clamps confidence, and applies batch guardrail on refund vs failed', async () => {
    const triaged = [
      triageWithRules({
        id: 'EX-05',
        rawText:
          'Subject: Refund for order that never cleared\nCustomer: Jen Park <jen@acme.co>\nPlease refund $120.00 for order AC-7781. Payment already failed last week.',
      }),
      triageWithRules({
        id: 'EX-06',
        rawText:
          'Payment failed for jen@acme.co\nOrder AC-7781 amount $120.00 — declined: do not honor',
      }),
    ];
    let linked = attachRelatedItems(triaged);
    const refundItem = linked[0];
    const summary = 'EX-06 (refund vs failed payment in batch; failed payment)';

    const aiResult = await triageItemWithContext(refundItem, summary);
    assert.equal(aiResult.source, 'ai');
    assert.equal(aiResult.confidence, 1);

    let items = [aiResult, linked[1]];
    items = attachRelatedItems(items);
    items = applyBatchContext(items);
    const refund = items.find((i) => i.id === 'EX-05');
    assert.ok(refund.suggestedAction.includes('No refund needed'));
    assert.ok(refund.why.includes('Batch check:'));
  });

  it('runTriage uses concurrent LLM calls and returns ordered sources', async () => {
    const text = `Item A\nrefund $10\na@test.com\n\n---\n\nItem B\nrefund $11\nb@test.com`;
    const { items } = await runTriage({ text });
    assert.equal(items.length, 2);
    assert.equal(items[0].source, 'ai');
    assert.equal(items[1].source, 'ai');
    assert.ok(items[0].id.localeCompare(items[1].id) < 0);
  });
});

describe('rules fallback source', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.LLM_PROVIDER = 'gemini';
    globalThis.fetch = async () => {
      throw new Error('network down');
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_PROVIDER;
  });

  it('sets rules-fallback when LLM fails', async () => {
    const item = triageWithRules({ id: 'EX-01', rawText: 'Refund $5\nx@y.com' });
    const out = await triageItemWithContext(item, '');
    assert.equal(out.source, 'rules-fallback');
  });
});
