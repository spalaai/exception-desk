import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBatch } from '../server/parser.js';
import { extractDetails, formatAmount, buildEmailNameMap, enrichDetailsFromBatch } from '../server/extract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('extractDetails', () => {
  it('EX-01: decline reason is insufficient funds, not order id fragment', () => {
    const text = `Subject: Card declined — order NW-4412
Customer: Elena Vasquez <elena@brightloom.shop>
Amount: $47.99
Gateway: Payment failed — card declined (insufficient funds)`;
    const d = extractDetails({ rawText: text });
    assert.equal(d.orderId, 'NW-4412');
    assert.equal(d.declineReason, 'insufficient funds');
  });

  it('EX-04: invoice id INV-2048, not "does"', () => {
    const text =
      'Subject: Invoice does not match payment — INV-2048\nInvoice total: $1,240.00 but we captured $1,180.00.';
    const d = extractDetails({ rawText: text });
    assert.equal(d.invoiceId, 'INV-2048');
  });

  it('EX-05: order id AC-7781, not "that"', () => {
    const text =
      'Subject: Refund for order that never cleared\nCustomer: Jen Park <jen@acme.co>\nPlease refund $120.00 for order AC-7781.';
    const d = extractDetails({ rawText: text });
    assert.equal(d.orderId, 'AC-7781');
  });

  it('reuses customer name from same email in batch (EX-03 / EX-06)', async () => {
    const batch = await fs.readFile(path.join(__dirname, '..', 'samples', 'batch.txt'), 'utf8');
    const parsed = parseBatch(batch);
    parsed.items.forEach((item, i) => {
      item.id = `EX-${String(i + 1).padStart(2, '0')}`;
    });
    const emailMap = buildEmailNameMap(parsed.items);
    const ex03 = enrichDetailsFromBatch(extractDetails(parsed.items[2]), emailMap);
    const ex06 = enrichDetailsFromBatch(extractDetails(parsed.items[5]), emailMap);
    assert.equal(ex03.firstName, 'Maya');
    assert.equal(ex06.firstName, 'Jen');
  });
});

describe('formatAmount', () => {
  it('formats en-US currency with thousands separators', () => {
    assert.equal(formatAmount(6200), '$6,200.00');
    assert.equal(formatAmount(1240), '$1,240.00');
    assert.equal(formatAmount(89), '$89.00');
  });
});
