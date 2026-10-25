/**
 * Deterministic field extraction from raw exception text (and CSV fields).
 * @param {{ rawText: string, fields?: Record<string, string> }} item
 */
export function extractDetails(item) {
  const text = item.rawText;
  const fields = item.fields || {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let subject =
    fields.subject?.trim() ||
    fields.notes?.trim() ||
    (lines.find((l) => /^subject:\s*/i.test(l)) || '').replace(/^subject:\s*/i, '').trim() ||
    '';

  if (!subject || /^[^,]*,[^,]*,[^,]+@[^,]+/.test(subject)) {
    if (fields.notes?.trim()) subject = fields.notes.trim();
    else if (fields.customer?.trim()) subject = fields.customer.trim();
    else subject = lines[0] || '';
  }

  const email =
    pickField(fields, ['email', 'customer email', 'from']) ||
    (text.match(/[\w.+-]+@[\w.-]+\.\w+/i) || [])[0] ||
    '';

  let customerName = pickField(fields, ['customer', 'name', 'bill to', 'account']);
  if (!customerName && /customer:\s*/i.test(text)) {
    const m = text.match(/customer:\s*([^\n<]+)/i);
    customerName = m?.[1]?.trim() || '';
  }
  if (!customerName && /bill to:\s*/i.test(text)) {
    const m = text.match(/bill to:\s*([^\n]+)/i);
    customerName = m?.[1]?.trim() || '';
  }
  if (customerName && email) {
    customerName = customerName.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').trim();
  }
  customerName = customerName.replace(/<[^>]+>/g, '').trim();
  const firstName = customerName.split(/\s+/)[0] || '';

  let amounts = extractAmounts(text);
  const fieldAmount = fields.amount ? parseMoney(fields.amount) : null;
  if (fieldAmount !== null) amounts = [...amounts, fieldAmount];
  const primaryAmount = amounts.length ? Math.max(...amounts) : 0;

  const orderId = extractOrderId(text, fields);
  const invoiceId = extractInvoiceId(text, fields);
  const reasonCode = (text.match(/reason code\s*([0-9.]+)/i) || [])[1] || '';
  const declineReason = extractDeclineReason(text);

  let invoiceDelta = null;
  let missingReference = '';
  const invPay = text.match(
    /invoice(?:\s+total)?[:\s]*\$?\s*([\d,]+(?:\.\d{2})?).{0,80}?(?:captured|payment|paid|shows?)[:\s]*\$?\s*([\d,]+(?:\.\d{2})?)/i
  );
  if (invPay) {
    const inv = parseMoney(invPay[1]);
    const pay = parseMoney(invPay[2]);
    if (inv !== null && pay !== null) invoiceDelta = inv - pay;
  }
  const offBy = text.match(/off by\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (offBy && invoiceDelta === null) {
    invoiceDelta = parseMoney(offBy[1]);
  }
  const poMissing = text.match(/(PO\s+reference\s+[^\n]+missing[^\n]*)/i);
  if (poMissing) missingReference = poMissing[1].trim();

  return {
    subject,
    email,
    customerName,
    firstName,
    amounts,
    primaryAmount,
    orderId,
    invoiceId,
    reasonCode,
    declineReason,
    invoiceDelta,
    missingReference,
  };
}

/** Reuse customer name from another item with the same email in the batch. */
export function buildEmailNameMap(items) {
  const map = new Map();
  for (const item of items) {
    const d = extractDetails(item);
    if (d.email && d.firstName) map.set(d.email.toLowerCase(), d);
  }
  return map;
}

export function enrichDetailsFromBatch(details, emailNameMap) {
  if (details.firstName || !details.email) return details;
  const hit = emailNameMap.get(details.email.toLowerCase());
  if (!hit) return details;
  return { ...details, customerName: hit.customerName, firstName: hit.firstName };
}

function extractOrderId(text, fields) {
  const fromField = pickField(fields, ['order', 'order id', 'order_id']);
  if (fromField && looksLikeOrderId(fromField)) return fromField;

  const patterns = [
    /\bfor order\s+([A-Z]{2,}-\d+)\b/i,
    /\border\s+(?:id\s*)?[#:]?\s*([A-Z]{2,}-\d+)\b/i,
    /\border\s+([A-Z]{2,}-\d+)\b/i,
    /\border\s*#\s*([A-Z0-9-]{4,})\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1] && looksLikeOrderId(m[1])) return m[1];
  }
  return '';
}

function looksLikeOrderId(id) {
  const s = String(id).trim();
  if (!s || ORDER_STOP_WORDS.has(s.toLowerCase())) return false;
  return /^[A-Z]{2,}-\d+$/i.test(s) || /^[A-Z]{2,}\d+$/i.test(s);
}

const ORDER_STOP_WORDS = new Set(['that', 'this', 'which', 'never', 'already', 'cleared']);

function extractInvoiceId(text, fields) {
  const fromField = pickField(fields, ['invoice', 'invoice id']);
  if (fromField && looksLikeInvoiceId(fromField)) return normalizeInvoiceId(fromField);

  const invToken = text.match(/\b(INV-\d+)\b/i);
  if (invToken) return invToken[1].toUpperCase();

  const afterLabel = text.match(/(?:invoice|inv)\s*[#:\s-]+\s*(INV-[A-Z0-9-]+)/i);
  if (afterLabel) return afterLabel[1].toUpperCase();

  return '';
}

function looksLikeInvoiceId(id) {
  return /^INV-/i.test(id) || /^[A-Z]{2,}-\d+/.test(id);
}

function normalizeInvoiceId(id) {
  const s = String(id).trim();
  return /^INV-/i.test(s) ? s.toUpperCase() : s;
}

function extractDeclineReason(text) {
  const inParens = text.match(/\bdeclined?\s*\(([^)]+)\)/i);
  if (inParens) return inParens[1].trim().toLowerCase();

  const keyword = text.match(/\b(do not honor|insufficient funds|authentication required|card expired)\b/i);
  if (keyword) return keyword[1].toLowerCase();

  const afterColon = text.match(/\b(?:declined|failed)\s*:\s*([^\n]+)/i);
  if (afterColon) {
    const reason = afterColon[1].trim();
    if (!/^order\s/i.test(reason)) return reason;
  }

  return '';
}

function pickField(fields, keys) {
  for (const k of keys) {
    const hit = Object.entries(fields).find(([fk]) => fk.toLowerCase() === k);
    if (hit?.[1]?.trim()) return hit[1].trim();
  }
  return '';
}

function parseMoney(s) {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

export function extractAmounts(text) {
  const amounts = [];
  const re = /\$\s*([\d,]+(?:\.\d{2})?)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isNaN(n)) amounts.push(n);
  }
  return amounts;
}

export function formatAmount(n) {
  if (n === null || n === undefined || Number(n) <= 0) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n));
}
