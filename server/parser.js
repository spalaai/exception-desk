import { randomUUID } from 'node:crypto';

const MAX_ITEMS = 100;

/**
 * @typedef {{ id: string, rawText: string, fields?: Record<string, string>, parseWarning?: string }} ParsedItem
 */

export function getMaxItems() {
  return MAX_ITEMS;
}

/**
 * Parse batch input into normalized items. Never drops content; worst case one blob item.
 * @param {string} input
 * @param {{ format?: string }} [opts]
 * @returns {{ items: ParsedItem[], truncated: boolean, message?: string }}
 */
export function parseBatch(input, opts = {}) {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    return { items: [], truncated: false, message: 'Paste or upload a batch before triaging.' };
  }

  let items = [];
  const format = opts.format || detectFormat(trimmed);

  if (format === 'json') {
    items = parseJson(trimmed);
    if (!items.length) {
      items = [makeItem(trimmed, { parseWarning: 'unparseable' })];
    }
  } else if (format === 'csv') {
    items = parseCsv(trimmed);
  } else {
    items = parseBlocks(trimmed);
  }

  if (!items.length) {
    items = [makeItem(trimmed, { parseWarning: 'unparseable' })];
  }

  let truncated = false;
  let message;
  if (items.length > MAX_ITEMS) {
    items = items.slice(0, MAX_ITEMS);
    truncated = true;
    message = `Batch capped at ${MAX_ITEMS} items. Only the first ${MAX_ITEMS} were triaged.`;
  }

  return { items, truncated, message };
}

function detectFormat(text) {
  if (text.startsWith('[') || text.startsWith('{')) return 'json';
  const firstLine = text.split(/\r?\n/)[0] || '';
  if (firstLine.includes(',') && /invoice|amount|email|customer|status|id/i.test(firstLine)) {
    return 'csv';
  }
  if (firstLine.includes(',') && firstLine.split(',').length >= 3) return 'csv';
  return 'blocks';
}

function makeItem(rawText, extra = {}) {
  return { id: randomUUID(), rawText: rawText.trim(), ...extra };
}

function parseJson(text) {
  try {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : data.items || data.exceptions || [data];
    return arr.map((entry) => {
      if (typeof entry === 'string') return makeItem(entry);
      const raw =
        entry.rawText ||
        entry.text ||
        entry.body ||
        entry.message ||
        JSON.stringify(entry, null, 2);
      const fields = {};
      for (const [k, v] of Object.entries(entry)) {
        if (typeof v === 'string' || typeof v === 'number') fields[k] = String(v);
      }
      return makeItem(raw, Object.keys(fields).length ? { fields } : {});
    });
  } catch {
    return [];
  }
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return lines.map((l) => makeItem(l));

  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (!cols.some((c) => c.trim())) continue;
    const fields = {};
    headers.forEach((h, idx) => {
      if (cols[idx] !== undefined) fields[h] = cols[idx].trim();
    });
    const raw = lines[i];
    items.push(makeItem(raw, { fields }));
  }
  return items;
}

function splitCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  result.push(cur);
  return result;
}

function parseBlocks(text) {
  if (/\n---+\n/.test(text)) {
    return text
      .split(/\n---+\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => makeItem(p));
  }
  const parts = text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  return parts.map((p) => makeItem(p));
}
