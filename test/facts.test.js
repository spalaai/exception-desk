import './_offline.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runTriage } from '../server/triage-run.js';
import { addBusinessDays } from '../server/batch-context.js';

const sample = fs.readFileSync(new URL('../samples/batch.txt', import.meta.url), 'utf8');

function fact(item, label) {
  return item.facts.find((f) => f.label === label)?.value;
}

describe('reviewer facts', () => {
  it('extracts chargeback reference, reason code and deadline', async () => {
    const { items } = await runTriage({ text: sample });
    const cb = items.find((i) => i.category === 'dispute / chargeback');
    assert.equal(fact(cb, 'Reason code'), '13.1');
    assert.equal(fact(cb, 'Merchant ref'), 'LM-CB-2026-44');
    assert.match(fact(cb, 'Response due'), /\(in 5 business days, counted from today\)$/);
    assert.match(cb.dueDate, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows invoice shortfall and account name', async () => {
    const { items } = await runTriage({ text: sample });
    const inv = items.find((i) => fact(i, 'Invoice') === 'INV-2048');
    assert.equal(fact(inv, 'Invoice vs paid'), '$60.00 short');
    const renewal = items.find((i) => /Enterprise renewal/.test(i.displaySubject));
    assert.equal(renewal.displayCustomer, 'VoltEdge Systems');
    assert.equal(fact(renewal, 'Amount'), '$6,200.00');
  });

  it('returns no invented facts for unreadable items', async () => {
    const { items } = await runTriage({ text: sample });
    const junk = items.find((i) => /Unreadable/.test(i.displaySubject));
    assert.deepEqual(junk.facts, []);
  });

  it('counts business days over weekends', () => {
    const fri = new Date(2026, 9, 23); // Fri Oct 23 2026
    const d = addBusinessDays(fri, 5);
    assert.equal(d.getDate(), 30);
    assert.equal(d.getDay(), 5);
  });

  it('marks cross-item batch checks with a verdict and flags shipped-but-unpaid', async () => {
    const { items } = await runTriage({ text: sample });
    const refund = items.find((i) => /never cleared/.test(i.displaySubject));
    assert.equal(refund.batchCheck.kind, 'refund_after_failed');
    assert.equal(refund.batchCheck.verdict, 'No refund needed: payment never captured');
    assert.equal(refund.flags.length, 1);
    assert.match(refund.flags[0], /shipping confirmation/i);
    const dupes = items.filter((i) => i.batchCheck?.kind?.startsWith('duplicate'));
    assert.equal(dupes.length, 2);
  });

  it('keeps customer drafts free of internal batch wording and ids', async () => {
    const { items } = await runTriage({ text: sample });
    for (const i of items.filter((x) => x.replyKind === 'customer')) {
      assert.doesNotMatch(i.draftReply, /same batch|in this batch|EX-\d+|\.\./, i.id);
    }
    const cb = items.find((i) => i.category === 'dispute / chargeback');
    assert.equal(cb.replyKind, 'processor');
    assert.doesNotMatch(cb.draftReply, /^Hi\b/);
  });
});
