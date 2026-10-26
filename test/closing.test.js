import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeClosingSummary } from '../public/lib/desk-logic.js';

const items = [
  { id: 'EX-05', displayAmount: 120, suggestedAction: 'No refund needed: payment never captured', batchCheck: { kind: 'refund_after_failed', ids: ['EX-05', 'EX-06'] } },
  { id: 'EX-03', displayAmount: 89, suggestedAction: 'Close: no separate refund', batchCheck: { kind: 'duplicate_secondary', ids: ['EX-02', 'EX-03'] } },
  { id: 'EX-02', displayAmount: 89, suggestedAction: 'Refund the duplicate capture', batchCheck: { kind: 'duplicate_primary', ids: ['EX-02', 'EX-03'] } },
  { id: 'EX-09', displayAmount: 312, dueDate: '2026-10-30', suggestedAction: 'Respond to dispute' },
];
const at = (s) => new Date(s).toISOString();

describe('computeClosingSummary', () => {
  it('counts decisions, caught refunds, approved refunds and deadlines from the session only', () => {
    const decisions = {
      'EX-05': { status: 'approved', updatedAt: at('2026-10-26T10:00:00') },
      'EX-03': { status: 'escalated', updatedAt: at('2026-10-26T10:02:00') },
      'EX-02': { status: 'approved', updatedAt: at('2026-10-26T10:03:00') },
      'EX-09': { status: 'escalated', updatedAt: at('2026-10-26T10:05:00') },
    };
    const s = computeClosingSummary(items, decisions);
    assert.equal(s.closed, true);
    assert.equal(s.decided, 4);
    assert.equal(s.caughtAmount, 209);
    assert.equal(s.approvedRefunds, 89);
    assert.equal(s.deadlinesMet, 1);
    assert.equal(s.deadlines.length, 1);
  });
  it('does not count a rejected catch, a missed deadline, or an open batch as closed', () => {
    const s = computeClosingSummary(items, {
      'EX-05': { status: 'rejected', updatedAt: at('2026-10-26T10:00:00') },
      'EX-09': { status: 'approved', updatedAt: at('2026-11-02T10:00:00') },
    });
    assert.equal(s.closed, false);
    assert.equal(s.caught.length, 0);
    assert.equal(s.deadlinesMet, 0);
  });
});
