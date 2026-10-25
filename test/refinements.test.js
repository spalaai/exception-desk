import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTriage } from '../server/triage-run.js';
import { triageWithRules, CATEGORIES } from '../server/rules-engine.js';
import { attachRelatedItems } from '../server/related.js';
import { applyBatchContext } from '../server/batch-context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('final review refinements', () => {
  it('assigns deterministic EX- ids in batch order', async () => {
    const text = await fs.readFile(path.join(__dirname, '..', 'samples', 'batch.txt'), 'utf8');
    const { items } = await runTriage({ text });
    assert.equal(items[0].id.startsWith('EX-'), true);
    const ids = new Set(items.map((i) => i.id));
    assert.equal(ids.size, items.length);
    assert.ok(ids.has('EX-01'));
    assert.ok(ids.has('EX-12'));
  });

  it('confidence varies by signal strength', () => {
    const dispute = triageWithRules({
      id: 'EX-99',
      rawText: 'Chargeback received\nReason code 10.4\nAmount $12.00',
    });
    const weak = triageWithRules({
      id: 'EX-98',
      rawText: 'Question about payout timing\nops@generic.example',
    });
    assert.ok(dispute.confidence > weak.confidence);
    assert.ok(dispute.why.includes('Matched signals'));
    assert.ok(dispute.confidence > 0.8);
    assert.ok(weak.confidence < 0.6);
  });

  it('refund with failed payment in batch suggests no refund needed', () => {
    const triaged = [
      triageWithRules({
        id: 'EX-05',
        rawText:
          'Subject: Refund for order that never cleared\njen@acme.co\nPlease refund $120.00 for order AC-7781. Payment already failed last week.',
      }),
      triageWithRules({
        id: 'EX-06',
        rawText: 'Payment failed for jen@acme.co\nOrder AC-7781 amount $120.00 — declined: do not honor',
      }),
    ];
    let items = attachRelatedItems(triaged);
    items = applyBatchContext(items);
    const refund = items.find((i) => i.id === 'EX-05');
    assert.ok(refund.suggestedAction.includes('No refund needed'));
    assert.ok(refund.draftReply.includes('did not capture') || refund.draftReply.includes('not been charged'));
  });

  it('invoice mismatch states difference amount', () => {
    const triaged = [
      triageWithRules({
        id: 'EX-04',
        rawText:
          'Subject: Invoice does not match payment — INV-2048\nInvoice total: $1,240.00 but we captured $1,180.00.\nPO reference HT-PO-9912 on invoice line 3 missing from payment memo.',
      }),
    ];
    const items = applyBatchContext(attachRelatedItems(triaged));
    const inv = items[0];
    assert.equal(inv.category, CATEGORIES.INVOICE);
    assert.ok(inv.suggestedAction.includes('$60.00') || inv.draftReply.includes('$60.00'));
    assert.ok(inv.suggestedAction.includes('short') || inv.why.includes('short'));
  });
});
