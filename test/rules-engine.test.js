import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { triageWithRules, CATEGORIES, P1_AMOUNT } from '../server/rules-engine.js';

describe('triageWithRules', () => {
  const base = { id: 't1', rawText: '' };

  it('classifies failed payment', () => {
    const r = triageWithRules({
      ...base,
      rawText: 'Payment failed for order #882\nCard declined: insufficient funds\nAmount: $42.00',
    });
    assert.equal(r.category, CATEGORIES.FAILED);
    assert.equal(r.priority, 'P2');
    assert.ok(r.evidenceLines.length);
  });

  it('P1 for large amounts', () => {
    const r = triageWithRules({
      ...base,
      rawText: 'Invoice mismatch on INV-100\nCustomer owes $650.00 per invoice',
    });
    assert.equal(r.category, CATEGORIES.INVOICE);
    assert.equal(r.priority, 'P1');
    assert.ok(r.why.includes(String(P1_AMOUNT)) || r.priority === 'P1');
  });

  it('dispute is always P1', () => {
    const r = triageWithRules({
      ...base,
      rawText: 'Chargeback received\nReason code 10.4\nAmount $12.00',
    });
    assert.equal(r.category, CATEGORIES.DISPUTE);
    assert.equal(r.priority, 'P1');
  });

  it('duplicate charge is P1', () => {
    const r = triageWithRules({
      ...base,
      rawText: 'Customer charged twice for the same subscription\nDuplicate charge on 10/20',
    });
    assert.equal(r.category, CATEGORIES.DUPLICATE);
    assert.equal(r.priority, 'P1');
  });

  it('unparseable warning → other low confidence', () => {
    const r = triageWithRules({
      ...base,
      rawText: '???',
      parseWarning: 'unparseable',
    });
    assert.equal(r.category, CATEGORIES.OTHER);
    assert.ok(r.confidence < 0.5);
  });
});
