import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attachRelatedItems } from '../server/related.js';
import { triageWithRules } from '../server/rules-engine.js';

describe('attachRelatedItems', () => {
  it('links duplicate charges with same email and amount', () => {
    const items = [
      triageWithRules({
        id: 'a',
        rawText: 'Duplicate charge\nmaya@northwind.io\n$89.00 charged twice',
      }),
      triageWithRules({
        id: 'b',
        rawText: 'Double charge same day\nmaya@northwind.io\n$89.00',
      }),
    ];
    const out = attachRelatedItems(items);
    const a = out.find((x) => x.id === 'a');
    assert.ok(a.relatedIds.includes('b'));
  });

  it('links refund to failed payment for same customer', () => {
    const triaged = [
      triageWithRules({
        id: 'f',
        rawText: 'Payment failed\njen@acme.co\n$120.00 declined',
      }),
      triageWithRules({
        id: 'r',
        rawText: 'Refund request — payment already failed\njen@acme.co\nPlease refund $120.00',
      }),
    ];
    const out = attachRelatedItems(triaged);
    const r = out.find((x) => x.id === 'r');
    assert.ok(r.relatedIds.includes('f'));
  });

  it('merges multiple reasons into one related link per id', () => {
    const triaged = [
      triageWithRules({
        id: 'EX-05',
        rawText:
          'Refund for order\njen@acme.co\nPlease refund $120.00. Payment already failed last week.',
        category: 'refund request',
      }),
      triageWithRules({
        id: 'EX-06',
        rawText: 'Payment failed for jen@acme.co\n$120.00 declined',
        category: 'failed payment',
      }),
    ];
    const out = attachRelatedItems(triaged);
    const r = out.find((x) => x.id === 'EX-05');
    const linksToSix = (r.relatedLinks || []).filter((l) => l.id === 'EX-06');
    assert.equal(linksToSix.length, 1);
    assert.match(linksToSix[0].label, /same email and amount/);
    assert.match(linksToSix[0].label, /refund vs failed payment/);
  });

  it('does not link different invoices just because both mention the word invoice', () => {
    const out = attachRelatedItems([
      { id: 'EX-04', rawText: '4,Harbor Tools LLC,billing@harbortools.example,1240.00,invoice,INV-2048 total 1240', category: 'invoice mismatch' },
      { id: 'EX-07', rawText: '7,Smallbatch,desk@smallbatch.example,215.50,invoice,INV-3301 mismatch', category: 'invoice mismatch' },
    ]);
    assert.deepEqual(out[0].relatedIds, []);
    assert.deepEqual(out[1].relatedIds, []);
  });

  it('links the same invoice written as INV-2048 and "invoice 2048"', () => {
    const out = attachRelatedItems([
      { id: 'EX-01', rawText: 'Invoice does not match payment - INV-2048', category: 'invoice mismatch' },
      { id: 'EX-02', rawText: 'Customer asks about invoice 2048 again', category: 'invoice mismatch' },
    ]);
    assert.deepEqual(out[0].relatedIds, ['EX-02']);
  });
});
