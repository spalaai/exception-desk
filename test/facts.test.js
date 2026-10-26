import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runTriage } from '../server/triage-run.js';

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
    assert.equal(fact(cb, 'Response due'), 'in 5 business days');
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
});
