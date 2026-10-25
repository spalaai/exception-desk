import { randomUUID } from 'node:crypto';
import { parseBatch } from './parser.js';
import { triageItem } from './llm-triage.js';
import { attachRelatedItems } from './related.js';

const PRIORITY_ORDER = { P1: 0, P2: 1, P3: 2 };

/**
 * @param {{ text?: string, format?: string }} body
 */
export async function runTriage(body) {
  const text = body?.text ?? '';
  const parsed = parseBatch(text, { format: body?.format });

  if (!text.trim()) {
    const err = new Error(parsed.message || 'Empty input');
    err.status = 400;
    throw err;
  }

  if (!parsed.items.length && parsed.message) {
    const err = new Error(parsed.message);
    err.status = 400;
    throw err;
  }

  let triaged = [];
  for (const item of parsed.items) {
    triaged.push(await triageItem(item));
  }

  triaged = attachRelatedItems(triaged);
  triaged.sort((a, b) => {
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pd !== 0) return pd;
    return a.id.localeCompare(b.id);
  });

  return {
    triageId: randomUUID(),
    items: triaged,
    truncated: parsed.truncated,
    message: parsed.message,
  };
}
