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
export function applyBatchContext(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const duplicateGroups = findDuplicateChargeGroups(items);
  const emailMap = buildEmailNameMap(items);

  for (const item of items) {
    const details = enrichDetailsFromBatch(extractDetails(item), emailMap);
    item.displaySubject = details.subject;
    item.displayEmail = details.email;
    item.displayAmount = details.primaryAmount;

    applyRefundFailedPair(item, byId, details);
    applyDuplicatePair(item, duplicateGroups, byId, details);
    applyInvoiceMismatch(item, details);
    personalizeGeneric(item, details);
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
    `Our records show the ${amt} payment did not capture (it failed in this same batch). ` +
    `No refund is required; you have not been charged. If you see a pending hold, it should drop off within a few business days.`;
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
  } else {
    item.suggestedAction = `Same case as ${primaryId}: no separate refund; link to primary duplicate`;
    item.draftReply =
      `${hi}, this matches the duplicate charge we are resolving under ${primaryId}. ` +
      `No separate action is needed on this report; the extra capture will be refunded under that case.`;
    item.why = batchWhy(item.why, `same duplicate case as ${primaryId}.`);
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
    item.draftReply =
      `${hi}, we see invoice ${inv || 'on file'} is ${diff} ${dir} compared to what we captured.` +
      ref +
      ` We are aligning the payment memo and will confirm the corrected balance within 1-2 business days.`;
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
    item.draftReply =
      `Hi, we are reviewing the dispute${amt ? ` for ${amt}` : ''}${rc} and gathering documentation. ` +
      `We will respond before the network deadline and keep you posted.`;
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
