import { extractDetails, extractAmounts } from './extract.js';

const REASON_LABELS = {
  same_customer_amount: 'same email and amount',
  same_invoice: 'same invoice',
  refund_after_failed: 'refund vs failed payment in batch',
};

/**
 * Deterministic related-item detection across a triaged batch.
 * @param {Array<{ id: string, rawText: string, category: string }>} items
 */
export function attachRelatedItems(items) {
  const emailRe = /[\w.+-]+@[\w.-]+\.\w+/gi;
  const invoiceRe = /(?:invoice|inv)[#\s:-]*([A-Z0-9-]{4,})/gi;

  const byEmailAmount = new Map();
  const byInvoice = new Map();
  const failedPayments = [];
  const refundRequests = [];

  for (const item of items) {
    const text = item.rawText;
    const lower = text.toLowerCase();
    const details = extractDetails(item);
    const emails = [
      ...new Set([
        ...(details.email ? [details.email.toLowerCase()] : []),
        ...(text.match(emailRe) || []).map((e) => e.toLowerCase()),
      ]),
    ];
    const amounts = details.amounts.length ? details.amounts : extractAmounts(text);

    for (const email of emails) {
      for (const amt of amounts) {
        const key = `${email}|${amt.toFixed(2)}`;
        if (!byEmailAmount.has(key)) byEmailAmount.set(key, []);
        byEmailAmount.get(key).push(item.id);
      }
    }

    const invoiceIds = new Set();
    if (details.invoiceId) invoiceIds.add(details.invoiceId.toUpperCase());
    let invMatch;
    const invCopy = text;
    invoiceRe.lastIndex = 0;
    while ((invMatch = invoiceRe.exec(invCopy)) !== null) {
      invoiceIds.add(invMatch[1].toUpperCase());
    }
    const notes = item.fields?.notes || '';
    const invToken = notes.match(/\b(INV-\d+)\b/i);
    if (invToken) invoiceIds.add(invToken[1].toUpperCase());
    for (const inv of invoiceIds) {
      if (!byInvoice.has(inv)) byInvoice.set(inv, []);
      byInvoice.get(inv).push(item.id);
    }

    if (item.category === 'failed payment' || /failed|declined/.test(lower)) {
      failedPayments.push(item);
    }
    if (item.category === 'refund request' || /refund/.test(lower)) {
      refundRequests.push(item);
    }
  }

  const relatedPairs = new Map();

  function link(a, b, reason) {
    if (a === b) return;
    addRel(relatedPairs, a, b, reason);
    addRel(relatedPairs, b, a, reason);
  }

  for (const ids of byEmailAmount.values()) {
    if (ids.length >= 2) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          link(ids[i], ids[j], 'same_customer_amount');
        }
      }
    }
  }

  for (const ids of byInvoice.values()) {
    if (ids.length >= 2) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          link(ids[i], ids[j], 'same_invoice');
        }
      }
    }
  }

  for (const refund of refundRequests) {
    const rDetails = extractDetails(refund);
    const emails = [
      ...(rDetails.email ? [rDetails.email.toLowerCase()] : []),
      ...(refund.rawText.match(emailRe) || []).map((e) => e.toLowerCase()),
    ];
    const amounts = rDetails.amounts.length ? rDetails.amounts : extractAmounts(refund.rawText);
    for (const failed of failedPayments) {
      const fDetails = extractDetails(failed);
      const fEmails = [
        ...(fDetails.email ? [fDetails.email.toLowerCase()] : []),
        ...(failed.rawText.match(emailRe) || []).map((e) => e.toLowerCase()),
      ];
      const sharedEmail = emails.some((e) => fEmails.includes(e));
      const fAmounts = fDetails.amounts.length ? fDetails.amounts : extractAmounts(failed.rawText);
      const sharedAmount = amounts.some((a) => fAmounts.some((b) => Math.abs(a - b) < 0.01));
      if (sharedEmail && (sharedAmount || /already failed|payment failed/.test(refund.rawText.toLowerCase()))) {
        link(refund.id, failed.id, 'refund_after_failed');
      }
    }
  }

  return items.map((item) => {
    const rel = relatedPairs.get(item.id);
    const relatedIds = rel ? [...new Set(rel.ids)] : [];
    const relatedLinks = rel ? mergeRelatedLinks(rel.links) : [];
    const relatedReasons = rel ? rel.reasons : [];
    return { ...item, relatedIds, relatedLinks, relatedReasons };
  });
}

function addRel(map, from, to, reason) {
  if (!map.has(from)) map.set(from, { ids: [], reasons: [], links: [] });
  const entry = map.get(from);
  if (!entry.ids.includes(to)) entry.ids.push(to);
  if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
  if (!entry.links.some((l) => l.id === to && l.reason === reason)) {
    entry.links.push({ id: to, reason });
  }
}

/** One link per related id; multiple detection reasons joined in label. */
function mergeRelatedLinks(links) {
  const byId = new Map();
  for (const l of links) {
    const label = REASON_LABELS[l.reason] || l.reason;
    if (!byId.has(l.id)) {
      byId.set(l.id, { id: l.id, reasons: [], labels: [] });
    }
    const entry = byId.get(l.id);
    if (!entry.reasons.includes(l.reason)) {
      entry.reasons.push(l.reason);
      entry.labels.push(label);
    }
  }
  return [...byId.values()].map((e) => ({
    id: e.id,
    reason: e.reasons.join(','),
    label: e.labels.join(', '),
  }));
}

export { REASON_LABELS };
