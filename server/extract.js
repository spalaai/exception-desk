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
  if (customerName && email) {
    customerName = customerName.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').trim();
  }
  customerName = customerName.replace(/<[^>]+>/g, '').trim();
  const firstName = customerName.split(/\s+/)[0] || '';

  let amounts = extractAmounts(text);
  const fieldAmount = fields.amount ? parseMoney(fields.amount) : null;
  if (fieldAmount !== null) amounts = [...amounts, fieldAmount];
  const primaryAmount = amounts.length ? Math.max(...amounts) : 0;

  const orderId =
    pickField(fields, ['order', 'order id', 'order_id']) ||
    (text.match(/\border\s*[#:-]?\s*([A-Z0-9-]{3,})/i) || [])[1] ||
    '';

  const invoiceId =
    pickField(fields, ['invoice', 'invoice id']) ||
    (text.match(/(?:invoice|inv)\s*[#:-]?\s*([A-Z0-9-]{4,})/i) || [])[1] ||
    '';

  const reasonCode = (text.match(/reason code\s*([0-9.]+)/i) || [])[1] || '';
  const declineMatch = text.match(/(?:declined|failed)[^.\n]*(?:[:—-]\s*)([^\n]+)/i);
  const declineReason =
    declineMatch?.[1]?.trim() ||
    (text.match(/(?:do not honor|insufficient funds|authentication required)/i) || [])[0] ||
    '';

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
  if (!n || n <= 0) return '';
  return `$${n.toFixed(2)}`;
}
