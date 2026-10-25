import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseBatch, getMaxItems } from '../server/parser.js';

describe('parseBatch', () => {
  it('returns empty message for blank input', () => {
    const r = parseBatch('   ');
    assert.equal(r.items.length, 0);
    assert.match(r.message, /paste/i);
  });

  it('parses plain text blocks separated by blank lines', () => {
    const text = 'First exception\nline two\n\nSecond block\nhere';
    const r = parseBatch(text);
    assert.equal(r.items.length, 2);
    assert.match(r.items[0].rawText, /First exception/);
    assert.match(r.items[1].rawText, /Second block/);
  });

  it('parses JSON array of strings', () => {
    const r = parseBatch(JSON.stringify(['alpha', 'beta']));
    assert.equal(r.items.length, 2);
  });

  it('parses CSV with header row', () => {
    const csv = `id,customer,amount,note
1,Ada Lovelace,120.00,failed card
2,Byron Corp,50.00,ok`;
    const r = parseBatch(csv);
    assert.equal(r.items.length, 2);
    assert.equal(r.items[0].fields.customer, 'Ada Lovelace');
  });

  it('caps at max items', () => {
    const blocks = Array.from({ length: getMaxItems() + 5 }, (_, i) => `Item ${i}`).join('\n\n');
    const r = parseBatch(blocks);
    assert.equal(r.items.length, getMaxItems());
    assert.equal(r.truncated, true);
  });

  it('keeps unparseable json as single item via fallback', () => {
    const r = parseBatch('{not valid json');
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].parseWarning, 'unparseable');
  });
});
