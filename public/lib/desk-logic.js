// Pure helpers shared by the browser desk (public/app.js) and node tests.
// No DOM access here.

export const STATUSES = ['pending', 'approved', 'escalated', 'rejected'];

export const STATUS_LABELS = {
  pending: 'To review',
  approved: 'Approved',
  escalated: 'Escalated',
  rejected: 'Rejected',
};

/**
 * True when approving this item's suggested action means refunding the customer.
 * "No refund needed" / "no separate refund" suggestions (e.g. refund asked for a payment
 * that never captured, or the second report of a duplicate) do not count.
 */
export function refundOnApprove(item) {
  const action = String(item?.suggestedAction || '');
  if (!/\brefund\b/i.test(action)) return false;
  return !/\bno (?:separate )?refund\b|refund (?:is )?not needed|nothing to refund/i.test(action);
}

const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2 };

export function formatMoney(n, { blankZero = true } = {}) {
  const v = Number(n);
  if (!Number.isFinite(v) || (blankZero && v <= 0)) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

export function decisionFor(decisions, id) {
  return (decisions && decisions[id]) || { status: 'pending', finalReply: '', note: '' };
}

/**
 * @param {any[]} items
 * @param {Record<string, any>} decisions
 * @param {{ category?: string, status?: string, priority?: string, query?: string }} f
 */
export function filterItems(items, decisions, f = {}) {
  const q = (f.query || '').trim().toLowerCase();
  return items.filter((item) => {
    if (f.category && item.category !== f.category) return false;
    if (f.priority && item.priority !== f.priority) return false;
    if (f.status && decisionFor(decisions, item.id).status !== f.status) return false;
    if (q) {
      const hay = [
        item.id,
        item.displaySubject,
        item.displayEmail,
        item.displayCustomer,
        item.category,
        item.rawText,
        ...(item.facts || []).map((x) => x.value),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** @param {'priority'|'amount'|'id'|'confidence'} key */
export function sortItems(items, key = 'priority') {
  const byId = (a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
  const byPriority = (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  const out = [...items];
  out.sort((a, b) => {
    if (key === 'amount') return (Number(b.displayAmount) || 0) - (Number(a.displayAmount) || 0) || byPriority(a, b) || byId(a, b);
    if (key === 'id') return byId(a, b);
    if (key === 'confidence') return (a.confidence ?? 0) - (b.confidence ?? 0) || byPriority(a, b) || byId(a, b);
    return byPriority(a, b) || (Number(b.displayAmount) || 0) - (Number(a.displayAmount) || 0) || byId(a, b);
  });
  return out;
}

export function computeKpis(items, decisions) {
  const k = {
    total: items.length,
    pending: 0,
    approved: 0,
    escalated: 0,
    rejected: 0,
    p1Open: 0,
    openAmount: 0,
    approvedRefunds: 0,
    reviewed: 0,
    reviewedPct: 0,
  };
  for (const item of items) {
    const st = decisionFor(decisions, item.id).status;
    k[st] = (k[st] || 0) + 1;
    const amt = Number(item.displayAmount) || 0;
    if (st === 'pending') {
      k.openAmount += amt;
      if (item.priority === 'P1') k.p1Open++;
    }
    if (st === 'approved' && refundOnApprove(item)) k.approvedRefunds += amt;
  }
  k.reviewed = k.total - k.pending;
  k.reviewedPct = k.total ? Math.round((k.reviewed / k.total) * 100) : 0;
  return k;
}

export const CSV_COLUMNS = [
  'id',
  'priority',
  'category',
  'status',
  'subject',
  'customer',
  'email',
  'amount_usd',
  'suggested_action',
  'final_reply',
  'reviewer_note',
  'confidence',
  'why',
  'related_ids',
  'source',
  'decided_at',
];

/** Quote for CSV and neutralise spreadsheet formula injection (=, +, -, @ at start). */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {any[]} items
 * @param {Record<string, any>} decisions
 * @param {{ reviewedOnly?: boolean }} opts
 */
export function buildCsvRows(items, decisions, opts = {}) {
  const rows = [];
  for (const item of sortItems(items, 'id')) {
    const d = decisionFor(decisions, item.id);
    if (opts.reviewedOnly && d.status === 'pending') continue;
    const amt = Number(item.displayAmount) || 0;
    rows.push({
      id: item.id,
      priority: item.priority,
      category: item.category,
      status: d.status,
      subject: item.displaySubject || '',
      customer: item.displayCustomer || '',
      email: item.displayEmail || '',
      amount_usd: amt > 0 ? amt.toFixed(2) : '',
      suggested_action: item.suggestedAction || '',
      final_reply: d.status === 'rejected' ? '' : d.finalReply || item.draftReply || '',
      reviewer_note: d.note || '',
      confidence: item.confidence !== undefined ? Number(item.confidence).toFixed(2) : '',
      why: item.why || '',
      related_ids: (item.relatedIds || []).join(';'),
      source: item.source || '',
      decided_at: d.status === 'pending' ? '' : d.updatedAt || '',
    });
  }
  return rows;
}

export function buildCsv(items, decisions, opts = {}) {
  const rows = buildCsvRows(items, decisions, opts);
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function exportFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `exception-desk-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.csv`;
}
