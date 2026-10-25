import { randomUUID } from 'node:crypto';
import { parseBatch } from './parser.js';
import { triageWithRules } from './rules-engine.js';
import { triageItemWithContext } from './llm-triage.js';
import { attachRelatedItems } from './related.js';
import { applyBatchContext, computeBatchInsights } from './batch-context.js';
import { getModeInfo } from './mode.js';

const PRIORITY_ORDER = { P1: 0, P2: 1, P3: 2 };

function assignBatchIds(items) {
  items.forEach((item, index) => {
    item.id = `EX-${String(index + 1).padStart(2, '0')}`;
  });
}

function buildRelatedSummary(item, allItems) {
  const links = item.relatedLinks || [];
  if (!links.length) return '';
  const byId = new Map(allItems.map((i) => [i.id, i]));
  return links
    .map((l) => {
      const other = byId.get(l.id);
      const cat = other?.category || 'item';
      return `${l.id} (${l.label}; ${cat})`;
    })
    .join('; ');
}

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

  assignBatchIds(parsed.items);

  const mode = getModeInfo();
  let triaged = parsed.items.map((item) => triageWithRules(item));

  triaged = attachRelatedItems(triaged);

  if (mode.mode === 'ai') {
    const enriched = [];
    for (const item of triaged) {
      const relatedSummary = buildRelatedSummary(item, triaged);
      enriched.push(await triageItemWithContext(item, relatedSummary));
    }
    triaged = enriched;
    triaged = attachRelatedItems(triaged);
  }

  triaged = applyBatchContext(triaged);

  triaged.sort((a, b) => {
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pd !== 0) return pd;
    return a.id.localeCompare(b.id);
  });

  const insights = computeBatchInsights(triaged);

  return {
    triageId: randomUUID(),
    items: triaged,
    insights,
    truncated: parsed.truncated,
    message: parsed.message,
  };
}
