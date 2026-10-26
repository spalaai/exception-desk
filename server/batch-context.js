import { CATEGORIES } from './rules-engine.js';
import {
  extractDetails,
  enrichDetailsFromBatch,
  buildEmailNameMap,
  formatAmount,
  greetingSalutation,
  actionCustomerLabel,
} from './extract.js';

const MONEY_CATEGORIES = new Set([
  CATEGORIES.REFUND,
  CATEGORIES.DUPLICATE,
  CATEGORIES.DISPUTE,
  CATEGORIES.INVOICE,
]);

function linkHasReason(link, reason) {
  if (!link?.reason) return false;
  if (link.reason === reason) return true;
  return String(link.reason).split(',').includes(reason);
}

function batchWhy(why, note) {
  const base = (why || '').trim();
  const prefix = `Batch check: ${note}`;
  if (base.includes('Batch check:')) return base;
  return base ? `${prefix} ${base}` : prefix;
}

/**
 * Apply batch-aware suggestions after related-item detection.
 * @param {Array<Record<string, unknown>>} items
 */
export function applyBatchContext(items, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const byId = new Map(items.map((i) => [i.id, i]));
  const duplicateGroups = findDuplicateChargeGroups(items);
  const emailMap = buildEmailNameMap(items);

  for (const item of items) {
    const details = enrichDetailsFromBatch(extractDetails(item), emailMap);
    item.displaySubject = details.subject;
    item.displayEmail = details.email;
    item.displayAmount = details.primaryAmount;
    item.replyKind = item.category === CATEGORIES.DISPUTE ? 'processor' : 'customer';
    item.flags = item.flags || [];
    item.facts = buildFacts(item, details, now);
    const due = item.facts.find((f) => f.label === 'Response due');
    item.dueDate = due?.date || '';
    item.displayCustomer = item.facts.find((f) => f.label === 'Customer')?.value || '';

    applyRefundFailedPair(item, byId, details);
    applyDuplicatePair(item, duplicateGroups, byId, details);
    applyInvoiceMismatch(item, details);
    personalizeGeneric(item, details);
  }

  // Mirror the refund-vs-failed check onto the failed-payment side so both items explain it.
  for (const item of items) {
    if (item.batchCheck?.kind !== 'refund_after_failed') continue;
    const failed = byId.get(item.batchCheck.ids[1]);
    if (!failed || failed.batchCheck) continue;
    const amt = formatAmount(failed.displayAmount) || 'this';
    failed.batchCheck = {
      kind: 'failed_with_refund_request',
      verdict: failed.suggestedAction,
      detail: `${item.id} asks for a refund of this same ${amt} payment. It was declined and never captured, so no refund is due there; handle it as a failed payment.`,
      ids: [failed.id, item.id],
    };
  }

  return items;
}

function applyRefundFailedPair(item, byId, details) {
  const links = item.relatedLinks || [];
  const failedLink = links.find((l) => linkHasReason(l, 'refund_after_failed'));
  if (!failedLink) return;

  const lower = item.rawText.toLowerCase();
  const isRefundSide = item.category === CATEGORIES.REFUND || /refund|money back|credit/.test(lower);
  if (!isRefundSide) return;

  const failed = byId.get(failedLink.id);
  const order = details.orderId || (failed ? enrichDetailsFromBatch(extractDetails(failed), new Map()).orderId : '');
  const amt = formatAmount(details.primaryAmount) || 'the listed amount';
  const hi = greetingSalutation(details);

  item.category = CATEGORIES.REFUND;
  item.suggestedAction = 'No refund needed: payment never captured';
  item.draftReply =
    `${hi}, thanks for writing about order ${order || 'on your account'}. ` +
    `We checked, and the ${amt} payment for this order was declined, so it was never captured and you have not been charged. ` +
    `There is nothing to refund. If you see a pending hold on your statement, it should drop off within a few business days.`;
  item.batchCheck = {
    kind: 'refund_after_failed',
    verdict: 'No refund needed: payment never captured',
    detail: `${failedLink.id} shows the same ${amt} payment${order ? ` for order ${order}` : ''} was declined, so there is no capture to refund.`,
    ids: [item.id, failedLink.id],
  };
  if (/ship(ping|ped)|dispatch|tracking/.test(lower)) {
    item.flags.push(
      `A shipping confirmation was sent although the payment never captured. Check whether ${order ? `order ${order}` : 'the order'} shipped and stop or recover it.`
    );
  }
  item.why = batchWhy(
    item.why,
    'refund requested but linked failed payment in this batch; no capture to refund.'
  );
}

function findDuplicateChargeGroups(items) {
  const dupes = items.filter((i) => i.category === CATEGORIES.DUPLICATE);
  const groups = [];
  const seen = new Set();

  for (const item of dupes) {
    if (seen.has(item.id)) continue;
    const group = new Set([item.id]);
    const stack = [...(item.relatedIds || [])];
    while (stack.length) {
      const id = stack.pop();
      if (group.has(id)) continue;
      const other = items.find((x) => x.id === id);
      if (!other || other.category !== CATEGORIES.DUPLICATE) continue;
      group.add(id);
      for (const rid of other.relatedIds || []) {
        if (!group.has(rid)) stack.push(rid);
      }
    }
    if (group.size >= 2) {
      for (const id of group) seen.add(id);
      const ids = [...group].sort();
      groups.push(ids);
    }
  }
  return groups;
}

function applyDuplicatePair(item, groups, byId, details) {
  if (item.category !== CATEGORIES.DUPLICATE) return;
  const group = groups.find((g) => g.includes(item.id));
  if (!group || group.length < 2) return;

  const primaryId = group[0];
  const isPrimary = item.id === primaryId;
  const amt = formatAmount(details.primaryAmount);
  const hi = greetingSalutation(details);

  if (isPrimary) {
    item.suggestedAction = `Refund one ${amt || ''} capture; void the duplicate after ledger check`.trim();
    item.draftReply =
      `${hi}, we confirmed two ${amt || 'identical'} charges for the same subscription. ` +
      `We will refund the duplicate ${amt || 'charge'} once the ledger check is complete; you should see the adjustment within 2 business days.`;
    item.why = batchWhy(item.why, 'duplicate pair in batch; primary item owns the refund.');
    item.batchCheck = {
      kind: 'duplicate_primary',
      verdict: `Refund one ${amt || ''} capture, not two`.replace('  ', ' '),
      detail: `${group.filter((g) => g !== item.id).join(', ')} reports the same ${amt || 'charge'} from the same customer. Refund once here; the other report is closed under this case.`,
      ids: group,
    };
  } else {
    item.suggestedAction = `Same case as ${primaryId}: no separate refund; link to primary duplicate`;
    item.draftReply =
      `${hi}, thanks for following up. This is the same duplicate ${amt || ''} charge you reported earlier, and we are already refunding it. `.replace('  ', ' ') +
      `There is nothing more you need to do; you will see one refund, not two.`;
    item.why = batchWhy(item.why, `same duplicate case as ${primaryId}.`);
    item.batchCheck = {
      kind: 'duplicate_secondary',
      verdict: `Same case as ${primaryId}: no second refund`,
      detail: `This is a second report of the duplicate ${amt || 'charge'} handled in ${primaryId}. Approving records it as closed without another refund.`,
      ids: group,
    };
  }
}

function applyInvoiceMismatch(item, details) {
  if (item.category !== CATEGORIES.INVOICE) return;
  const delta = details.invoiceDelta;
  const inv = details.invoiceId;
  const hi = greetingSalutation(details);
  if (delta !== null && Math.abs(delta) >= 0.01) {
    const short = delta > 0;
    const diff = formatAmount(Math.abs(delta));
    const dir = short ? 'short' : 'over';
    item.suggestedAction = `Reconcile invoice ${inv || ''}: payment ${diff} ${dir} vs invoice`.trim();
    const ref = details.missingReference ? ` Missing reference: ${details.missingReference}.` : '';
    const po = (details.missingReference.match(/\b((?:[A-Z]{2,}-)?PO-\d+)\b/i) || [])[1];
    item.draftReply =
      `${hi}, thanks for your payment against invoice ${inv || 'on file'}. ` +
      (short
        ? `The amount we received is ${diff} less than the invoice total, so a balance of ${diff} is still open.`
        : `The amount we received is ${diff} more than the invoice total.`) +
      (po ? ` The payment memo is also missing your PO reference ${po}.` : '') +
      (short
        ? ` Could you confirm whether the balance is on its way, or let us know if a deduction was applied?`
        : ` We will confirm how you would like the difference handled.`);
    item.why = batchWhy(
      item.why,
      `invoice variance ${diff} (${dir}).${ref ? ` ${details.missingReference}` : ''}`
    );
  }
}

function personalizeGeneric(item, details) {
  if (item.category === CATEGORIES.OTHER || item.parseWarning === 'unparseable') return;
  const skip = [
    'No refund needed',
    'Same case as',
    'Reconcile invoice',
    'Refund one',
  ];
  if (skip.some((p) => String(item.suggestedAction).includes(p))) return;

  const customer = actionCustomerLabel(details);
  const hi = greetingSalutation(details);
  const amt = formatAmount(details.primaryAmount);
  const order = details.orderId;
  const inv = details.invoiceId;

  if (item.category === CATEGORIES.FAILED) {
    const reason = details.declineReason ? ` (${details.declineReason})` : '';
    item.suggestedAction = `Ask ${customer} to update payment method${order ? ` for order ${order}` : ''}`;
    item.draftReply =
      `${hi}, the ${amt || 'payment'}${order ? ` for order ${order}` : ''} did not go through${reason}. ` +
      `Please update your card or try again; we have not charged you. Reply if you need a different payment link.`;
  } else if (item.category === CATEGORIES.REFUND) {
    item.suggestedAction = `Verify capture for ${order || inv || 'this order'}; approve refund ${amt || ''} if settled`.trim();
    item.draftReply =
      `${hi}, we received your refund request${amt ? ` for ${amt}` : ''}` +
      `${order ? ` (order ${order})` : ''}. We are verifying the original payment and will confirm next steps shortly.`;
  } else if (item.category === CATEGORIES.DISPUTE) {
    const rc = details.reasonCode ? ` (reason code ${details.reasonCode})` : '';
    item.suggestedAction = `Gather evidence for dispute${rc}; respond before network deadline`;
    const ref = (item.rawText.match(/merchant ref(?:erence)?:\s*([A-Z0-9-]+)/i) || [])[1];
    item.draftReply =
      `Dispute response${ref ? ` for ${ref}` : ''}${amt ? `, ${amt}` : ''}${rc}.\n` +
      `We are contesting this dispute and have attached: order receipt, proof of delivery or service, customer communication, and our refund policy.\n` +
      `[Before submitting: confirm the charge was authorised and the order was delivered as described, attach the documents, and check them against the reason code.]`;
  }
}

/**
 * @param {Array<{ id: string, relatedIds?: string[], category: string, displayAmount?: number }>} items
 */
export function computeBatchInsights(items) {
  const p1 = items.filter((i) => i.priority === 'P1').length;

  let moneyTotal = 0;
  for (const item of items) {
    if (!MONEY_CATEGORIES.has(item.category)) continue;
    const amt = item.displayAmount ?? extractDetails(item).primaryAmount;
    if (amt > 0) moneyTotal += amt;
  }

  const parent = new Map();
  function find(x) {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
    return parent.get(x);
  }
  function unite(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  for (const item of items) {
    find(item.id);
    for (const rid of item.relatedIds || []) unite(item.id, rid);
  }

  const components = new Map();
  for (const item of items) {
    const root = find(item.id);
    if (!components.has(root)) components.set(root, new Set());
    components.get(root).add(item.id);
  }
  const relatedGroups = [...components.values()].filter((s) => s.size >= 2).length;

  return { relatedGroups, p1, moneyTotal };
}

/**
 * Structured, reviewer-facing facts pulled from the raw text (deterministic, same in AI mode).
 * Only fields that were actually found are returned.
 * @returns {Array<{ label: string, value: string }>}
 */
/** Plain meanings for common Visa dispute reason codes (Visa chargeback reason code index). */
export const REASON_CODE_MEANINGS = {
  '10.4': 'Visa: fraud, card not present',
  '12.6.1': 'Visa: duplicate processing',
  '13.1': 'Visa: merchandise or services not received',
  '13.2': 'Visa: cancelled recurring transaction',
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Parse "2026-10-23", "Oct 23, 2026" or "23 Oct 2026" into a local date; null if no full date. */
export function parseNoticeDate(text) {
  const t = String(text || '').trim();
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = t.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS.includes(m[1].toLowerCase())) return new Date(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), Number(m[2]));
  m = t.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})\b/);
  if (m && MONTHS.includes(m[2].toLowerCase())) return new Date(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()), Number(m[1]));
  return null;
}

function isoDate(d) {
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function niceDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Response deadline for disputes. Uses an explicit due date, else business days counted
 * from the notice date in the text, else an estimate counted from today (labeled as such).
 */
export function responseDeadline(raw, now = new Date()) {
  const text = String(raw || '');
  const by = text.match(/response due\s+(?:by|on)\s*:?\s*([^\n]+)/i);
  if (by) {
    const d = parseNoticeDate(by[1]);
    if (d) return { label: 'Response due', value: `${niceDate(d)} (stated in the notice)`, date: isoDate(d) };
  }
  const inDays = text.match(/response due\s+in\s+(\d+)\s+business days?/i);
  if (!inDays) {
    const other = text.match(/response due\s+((?:in|by)\s+[^\n.]+)/i);
    return other ? { label: 'Response due', value: other[1].trim() } : null;
  }
  const n = Number(inDays[1]);
  const noticeLine = text.match(/^\s*(?:notice date|date|received|opened|sent)\s*:\s*(.+)$/im);
  const notice = noticeLine ? parseNoticeDate(noticeLine[1]) : null;
  if (notice) {
    const d = addBusinessDays(notice, n);
    const from = notice.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { label: 'Response due', value: `${niceDate(d)} (${n} business days from the notice date, ${from})`, date: isoDate(d) };
  }
  const d = addBusinessDays(now, n);
  return { label: 'Response due', value: `${niceDate(d)} (estimate: ${n} business days from today)`, date: isoDate(d), estimate: true };
}

export function addBusinessDays(from, n) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

export function buildFacts(item, details, now = new Date()) {
  const facts = [];
  const money = (n) =>
    `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const raw = item.rawText || '';
  const account = details.customerName || (raw.match(/^\s*account:\s*(.+)$/im) || [])[1]?.trim() || '';
  if (account) facts.push({ label: 'Customer', value: account });
  if (details.email) facts.push({ label: 'Email', value: details.email });
  if (details.primaryAmount > 0) facts.push({ label: 'Amount', value: money(details.primaryAmount) });
  if (details.orderId) facts.push({ label: 'Order', value: details.orderId });
  if (details.invoiceId) facts.push({ label: 'Invoice', value: details.invoiceId });
  if (details.invoiceDelta !== null && details.invoiceDelta !== undefined && details.invoiceDelta !== 0) {
    facts.push({ label: 'Invoice vs paid', value: `${money(Math.abs(details.invoiceDelta))} ${details.invoiceDelta > 0 ? 'short' : 'over'}` });
  }
  if (details.missingReference) facts.push({ label: 'Missing reference', value: details.missingReference });
  const merchantRef = (raw.match(/merchant ref(?:erence)?:\s*([A-Z0-9-]+)/i) || [])[1];
  if (merchantRef) facts.push({ label: 'Merchant ref', value: merchantRef });
  if (details.reasonCode) {
    const meaning = REASON_CODE_MEANINGS[details.reasonCode];
    facts.push({ label: 'Reason code', value: meaning ? `${details.reasonCode} (${meaning})` : details.reasonCode });
  }
  if (details.declineReason) facts.push({ label: 'Decline reason', value: details.declineReason });
  const deadline = responseDeadline(raw, now);
  if (deadline) facts.push(deadline);
  return facts;
}
