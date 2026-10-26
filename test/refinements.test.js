import './_offline.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTriage } from '../server/triage-run.js';
import { triageWithRules, CATEGORIES } from '../server/rules-engine.js';
import { attachRelatedItems } from '../server/related.js';
import { applyBatchContext } from '../server/batch-context.js';
import { formatAmount } from '../server/extract.js';

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

  it('failed payment without name uses "the customer" in action (EX-10)', async () => {
    const text = await fs.readFile(path.join(__dirname, '..', 'samples', 'batch.txt'), 'utf8');
    const { items } = await runTriage({ text });
    const ex10 = items.find((i) => i.id === 'EX-10');
    assert.ok(ex10.suggestedAction.includes('Ask the customer'));
    assert.ok(!ex10.suggestedAction.includes('Ask there'));
  });

  it('formats large amounts with thousands separators in batch triage', async () => {
    const text = await fs.readFile(path.join(__dirname, '..', 'samples', 'batch.txt'), 'utf8');
    const { items, insights } = await runTriage({ text });
    const ex04 = items.find((i) => i.id === 'EX-04');
    assert.ok(ex04.suggestedAction.includes('$60.00'));
    assert.ok(ex04.suggestedAction.includes('INV-2048'));
    assert.equal(formatAmount(insights.moneyTotal).includes(','), true);
  });

  it('batch.csv and batch.txt triage with matching categories and key actions', async () => {
    const txt = await fs.readFile(path.join(__dirname, '..', 'samples', 'batch.txt'), 'utf8');
    const csv = await fs.readFile(path.join(__dirname, '..', 'samples', 'batch.csv'), 'utf8');
    const fromTxt = await runTriage({ text: txt });
    const fromCsv = await runTriage({ text: csv });

    const pairs = [
      ['EX-02', 'EX-03'],
      ['EX-05', 'EX-06'],
      ['EX-04'],
      ['EX-07'],
    ];

    for (const ids of pairs) {
      for (const id of ids) {
        const t = fromTxt.items.find((i) => i.id === id);
        const c = fromCsv.items.find((i) => i.id === id);
        assert.ok(t && c, `missing ${id}`);
        assert.equal(c.category, t.category, `${id} category`);
      }
    }

    const dupPrimaryTxt = fromTxt.items.find((i) => i.id === 'EX-02');
    const dupSecondaryTxt = fromTxt.items.find((i) => i.id === 'EX-03');
    const dupPrimaryCsv = fromCsv.items.find((i) => i.id === 'EX-02');
    const dupSecondaryCsv = fromCsv.items.find((i) => i.id === 'EX-03');
    assert.ok(dupPrimaryTxt.suggestedAction.includes('Refund one'));
    assert.ok(dupSecondaryTxt.suggestedAction.includes('Same case as EX-02'));
    assert.ok(dupPrimaryCsv.suggestedAction.includes('Refund one'));
    assert.ok(dupSecondaryCsv.suggestedAction.includes('Same case as EX-02'));

    const refundTxt = fromTxt.items.find((i) => i.id === 'EX-05');
    const refundCsv = fromCsv.items.find((i) => i.id === 'EX-05');
    assert.ok(refundTxt.suggestedAction.includes('No refund needed'));
    assert.ok(refundCsv.suggestedAction.includes('No refund needed'));

    const invTxt = fromTxt.items.find((i) => i.id === 'EX-04');
    const invCsv = fromCsv.items.find((i) => i.id === 'EX-04');
    assert.equal(invCsv.category, CATEGORIES.INVOICE);
    assert.ok(invCsv.suggestedAction.includes('$60.00'));
    assert.ok(invCsv.suggestedAction.includes('short'));
    assert.ok(invTxt.suggestedAction.includes('$60.00'));
    assert.ok(
      invCsv.suggestedAction.includes('INV-2048') ||
        invCsv.draftReply.includes('INV-2048') ||
        invCsv.why.includes('INV-2048')
    );

    const smallCsv = fromCsv.items.find((i) => i.id === 'EX-07');
    const smallTxt = fromTxt.items.find((i) => i.id === 'EX-07');
    assert.ok(smallCsv.suggestedAction.includes('$5.00'));
    assert.ok(smallTxt.suggestedAction.includes('$5.00'));
    assert.ok(smallCsv.suggestedAction.includes('INV-3301') || smallCsv.draftReply.includes('INV-3301'));
  });

  it('company customers get team greeting in drafts', async () => {
    const csv = await fs.readFile(path.join(__dirname, '..', 'samples', 'batch.csv'), 'utf8');
    const { items } = await runTriage({ text: csv });
    const harbor = items.find((i) => i.id === 'EX-04');
    assert.ok(harbor.draftReply.startsWith('Hi Harbor Tools team,'));
    assert.ok(!harbor.draftReply.startsWith('Hi Harbor,'));
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
