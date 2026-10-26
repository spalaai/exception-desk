import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  refundOnApprove,
  filterItems,
  sortItems,
  computeKpis,
  buildCsv,
  buildCsvRows,
  csvCell,
  CSV_COLUMNS,
} from '../public/lib/desk-logic.js';

const items = [
  { id: 'EX-01', priority: 'P2', category: 'failed payment', displayAmount: 47.99, displaySubject: 'Card declined', confidence: 0.62, draftReply: 'Hi Elena' },
  { id: 'EX-02', suggestedAction: 'Refund one $89.00 capture; void the duplicate after ledger check', priority: 'P1', category: 'duplicate charge', displayAmount: 89, displaySubject: 'Duplicate charge', displayEmail: 'maya@northwind.example', confidence: 0.64, draftReply: 'Hi Maya', relatedIds: ['EX-03'] },
  { id: 'EX-03', suggestedAction: 'Same case as EX-02: no separate refund; link to primary duplicate', priority: 'P1', category: 'duplicate charge', displayAmount: 89, displaySubject: 'Second report', confidence: 0.64, draftReply: 'Hi again' },
  { id: 'EX-10', priority: 'P1', category: 'failed payment', displayAmount: 6200, displaySubject: 'Renewal', confidence: 0.7, draftReply: 'Hello' },
  { id: 'EX-11', priority: 'P3', category: 'other / needs human', displayAmount: 0, displaySubject: '=HYPERLINK("x")', confidence: 0.5, draftReply: '' },
];

describe('desk logic', () => {
  it('filters by status, priority and free-text query', () => {
    const decisions = { 'EX-02': { status: 'approved' } };
    assert.deepEqual(filterItems(items, decisions, { status: 'approved' }).map((i) => i.id), ['EX-02']);
    assert.equal(filterItems(items, decisions, { status: 'pending' }).length, 4);
    assert.deepEqual(filterItems(items, {}, { priority: 'P3' }).map((i) => i.id), ['EX-11']);
    assert.deepEqual(filterItems(items, {}, { query: 'northwind' }).map((i) => i.id), ['EX-02']);
  });

  it('sorts by priority then amount, or by amount', () => {
    assert.deepEqual(sortItems(items).map((i) => i.id), ['EX-10', 'EX-02', 'EX-03', 'EX-01', 'EX-11']);
    assert.equal(sortItems(items, 'amount')[0].id, 'EX-10');
    assert.equal(sortItems(items, 'confidence')[0].id, 'EX-11');
  });

  it('computes review KPIs; refunds approved only count real refund suggestions', () => {
    const decisions = {
      'EX-02': { status: 'approved' },
      'EX-10': { status: 'approved' },
      'EX-03': { status: 'approved' },
    };
    const k = computeKpis(items, decisions);
    assert.equal(k.pending, 2);
    assert.equal(k.reviewed, 3);
    assert.equal(k.approved, 3);
    assert.equal(k.reviewedPct, 60);
    assert.equal(k.p1Open, 0);
    assert.equal(k.approvedRefunds, 89);
    assert.ok(Math.abs(k.openAmount - 47.99) < 1e-9);
  });

  it('exports a CSV with header, final replies, notes and formula-safe cells', () => {
    const decisions = {
      'EX-02': { status: 'approved', finalReply: 'Edited, refund 1', note: 'ledger checked', updatedAt: '2026-10-26T10:00:00Z' },
      'EX-03': { status: 'rejected', finalReply: 'unused' },
    };
    const csv = buildCsv(items, decisions);
    const lines = csv.trim().split('\r\n');
    assert.equal(lines[0], CSV_COLUMNS.join(','));
    assert.equal(lines.length, items.length + 1);
    const rows = buildCsvRows(items, decisions);
    const ex2 = rows.find((r) => r.id === 'EX-02');
    assert.equal(ex2.final_reply, 'Edited, refund 1');
    assert.equal(ex2.reviewer_note, 'ledger checked');
    assert.equal(ex2.amount_usd, '89.00');
    assert.equal(rows.find((r) => r.id === 'EX-03').final_reply, '');
    assert.equal(rows.find((r) => r.id === 'EX-01').final_reply, 'Hi Elena');
    assert.match(csv, /'=HYPERLINK/);
  });

  it('can export reviewed items only', () => {
    const rows = buildCsvRows(items, { 'EX-01': { status: 'escalated' } }, { reviewedOnly: true });
    assert.deepEqual(rows.map((r) => r.id), ['EX-01']);
  });

  it('quotes commas, quotes and newlines', () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('-12.50'), '-12.50');
  });

  it('recognises refund vs no-refund suggestions', () => {
    assert.equal(refundOnApprove({ suggestedAction: 'Verify capture for this order; approve refund $38.00 if settled' }), true);
    assert.equal(refundOnApprove({ suggestedAction: 'No refund needed: payment never captured' }), false);
    assert.equal(refundOnApprove({ suggestedAction: 'Gather evidence for dispute' }), false);
  });

  it('puts deadline items first within a priority', () => {
    const withDue = [...items, { id: 'EX-09', priority: 'P1', category: 'dispute / chargeback', displayAmount: 312, dueDate: '2026-11-02' }];
    assert.equal(sortItems(withDue)[0].id, 'EX-09');
  });
});
