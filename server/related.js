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
    const emails = [...new Set((text.match(emailRe) || []).map((e) => e.toLowerCase()))];
    const amounts = extractAmounts(text);

    for (const email of emails) {
      for (const amt of amounts) {
        const key = `${email}|${amt.toFixed(2)}`;
        if (!byEmailAmount.has(key)) byEmailAmount.set(key, []);
        byEmailAmount.get(key).push(item.id);
      }
    }

    let invMatch;
    const invCopy = text;
    invoiceRe.lastIndex = 0;
    while ((invMatch = invoiceRe.exec(invCopy)) !== null) {
      const inv = invMatch[1].toUpperCase();
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
    const emails = (refund.rawText.match(emailRe) || []).map((e) => e.toLowerCase());
    const amounts = extractAmounts(refund.rawText);
    for (const failed of failedPayments) {
      const fEmails = (failed.rawText.match(emailRe) || []).map((e) => e.toLowerCase());
      const sharedEmail = emails.some((e) => fEmails.includes(e));
      const fAmounts = extractAmounts(failed.rawText);
      const sharedAmount = amounts.some((a) => fAmounts.some((b) => Math.abs(a - b) < 0.01));
      if (sharedEmail && (sharedAmount || /already failed|payment failed/.test(refund.rawText.toLowerCase()))) {
        link(refund.id, failed.id, 'refund_after_failed');
      }
    }
  }

  return items.map((item) => {
    const rel = relatedPairs.get(item.id);
    const relatedIds = rel ? [...new Set(rel.ids)] : [];
    const relatedLinks = rel
      ? rel.links.map((l) => ({
          id: l.id,
          reason: l.reason,
          label: REASON_LABELS[l.reason] || l.reason,
        }))
      : [];
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

function extractAmounts(text) {
  const amounts = [];
  const re = /\$\s*([\d,]+(?:\.\d{2})?)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isNaN(n)) amounts.push(n);
  }
  return amounts;
}

export { REASON_LABELS };
