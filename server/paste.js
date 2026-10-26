// "Paste a new one": extract facts from one fresh, messy message and link it to a case
// already in the queue. AI mode asks the model; every quote it returns is checked against
// the pasted source (normalized substring match) and dropped, visibly, when not found.
// Rules mode does a deterministic extract so the feature works without a key.
import { extractDetails, extractAmounts } from './extract.js';
import { triageWithRules } from './rules-engine.js';
import { getModeInfo } from './mode.js';
import { callModelJson } from './llm-triage.js';

export const MAX_PASTE_CHARS = 8000;
export const MAX_CASES = 200;
const FACT_KEYS = ['customer', 'email', 'amount', 'ref', 'whatHappened', 'wants'];

/** Normalize for quote checks: Unicode NFKC, lowercase, straight quotes and dashes,
 * no email quote markers ("> "), whitespace collapsed. Accents are kept. */
export function normalizeForMatch(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033\u00ab\u00bb]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the quote appears in the source after normalization (min 4 chars). */
export function quoteInSource(quote, source) {
  const q = normalizeForMatch(quote).replace(/^["']|["']$/g, '').trim();
  if (q.length < 4) return false;
  return normalizeForMatch(source).includes(q);
}

/** Split model quotes into verified and dropped. */
export function verifyQuotes(quotes, source) {
  const verified = [];
  const dropped = [];
  for (const q of Array.isArray(quotes) ? quotes : []) {
    const text = typeof q === 'string' ? q : String(q?.text ?? '');
    const supports = typeof q === 'object' && q ? String(q.supports ?? '') : '';
    if (!text.trim()) continue;
    if (quoteInSource(text, source)) verified.push({ text: text.trim(), supports, verified: true });
    else dropped.push({ text: text.trim(), supports, reason: 'Not found in the pasted message' });
  }
  return { verified, dropped };
}

/* ---------------- deterministic extract (rules mode, and the link check in every mode) ---------------- */

const WANT_RULES = [
  ['refund', /\b(refund|money back|reembols|devolu|devuelvan|remboursement|rückerstattung)/i],
  ['cancel', /\b(cancel|cancela|anula)/i],
  ['corrected invoice', /\b(correct(ed)? invoice|fix the invoice|factura corregida|corregir la factura)/i],
  ['explanation', /\b(why|explain|what happened|por qué|explica)/i],
];

const HAPPENED_RULES = [
  ['dispute / chargeback', /\b(chargeback|contracargo|reason code|dispute (?:notice|opened|filed))/i, 'Card network dispute (chargeback) opened'],
  ['duplicate charge', /\b(twice|double charge|charged two|duplicate|dos veces|cobro duplicado|doble cobro)/i, 'Customer reports being charged twice'],
  ['refund request', /\b(cobraron|charged me|i was charged|we were charged)/i, 'Customer says they were charged'],
  ['refund request', /\b(refund|reembols|devolu)/i, 'Customer is asking for a refund'],
  ['failed payment', /\b(declined|failed|rechaz|no se (?:completó|proces)|falló)/i, 'Payment did not go through'],
  ['invoice mismatch', /\b(invoice|factura).{0,60}\b(match|wrong|incorrect|no coincide|mal)/i, 'Invoice and payment do not match'],
];

const REF_RE = /\b([A-Z]{2,}(?:-[A-Z0-9]+)*-\d{2,}|INV-\d+)\b/g;

function lineOf(text, re) {
  const lines = String(text).split(/\r?\n/);
  const hit = lines.find((l) => re.test(l));
  return hit ? hit.trim().replace(/^(?:>\s?)+/, '').trim() : '';
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Amounts in "$120.00", "US$120", "120,00 US$", "120.00 USD", "USD 120" forms. */
export function pasteAmounts(text) {
  const out = [...extractAmounts(text)];
  const re = /(?:US\$|USD)\s*([\d.,]+)|([\d.,]+)\s*(?:US\$|USD|\$|dólares|dolares)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = (m[1] || m[2] || '').replace(/[.,]$/, '');
    if (!/\d/.test(raw)) continue;
    let n;
    if (/,\d{2}$/.test(raw)) n = parseFloat(raw.replace(/\./g, '').replace(',', '.'));
    else n = parseFloat(raw.replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return [...new Set(out.map((n) => Math.round(n * 100) / 100))];
}

export function pasteRefs(text) {
  return [...new Set((String(text).match(REF_RE) || []).map((r) => r.toUpperCase()))];
}

function senderName(text) {
  const m = String(text).match(/^(?:>\s*)*(?:from|de|von)\s*:\s*"?([^"<\n@]+?)"?\s*<[^>]+>/im);
  return m ? m[1].trim() : '';
}

/**
 * Deterministic facts from a pasted message. Every fact carries the source line it came from.
 * @param {string} text
 */
export function rulesExtract(text) {
  const details = extractDetails({ rawText: text });
  const triage = triageWithRules({ rawText: text });
  const amounts = pasteAmounts(text);
  const refs = pasteRefs(text);
  const facts = {};
  const quotes = [];
  const put = (key, value, re) => {
    if (value === '' || value == null) return;
    facts[key] = value;
    const line = re ? lineOf(text, re) : '';
    if (line) quotes.push({ text: line, supports: key });
  };

  let customer = senderName(text) || details.customerName;
  if (customer && /@/.test(customer)) customer = '';
  put('customer', customer, customer ? new RegExp(escapeRe(customer), 'i') : null);
  put('email', details.email, details.email ? new RegExp(escapeRe(details.email), 'i') : null);
  const amount = amounts.length ? amounts[0] : null;
  if (amount != null) {
    const whole = String(Math.trunc(amount));
    put('amount', amount, new RegExp(`(\\$|US\\$|USD)?\\s*${whole}([.,]\\d{2})?\\s*(US\\$|USD|\\$)?`, 'i'));
  }
  put('ref', refs[0] || '', refs[0] ? new RegExp(escapeRe(refs[0]), 'i') : null);

  let happened = null;
  for (const [category, re, label] of HAPPENED_RULES) {
    if (re.test(text)) {
      happened = { category, label, re };
      break;
    }
  }
  const category = happened?.category || triage.category;
  if (happened) put('whatHappened', happened.label, happened.re);
  for (const [want, re] of WANT_RULES) {
    if (re.test(text)) {
      put('wants', want, re);
      break;
    }
  }

  return { facts, quotes, category, amounts, refs, email: (details.email || '').toLowerCase() };
}

/* ---------------- linking to an existing case ---------------- */

function caseKeys(c) {
  const d = extractDetails({ rawText: c.rawText || '', fields: c.fields });
  const emails = new Set([...(String(c.rawText || '').match(/[\w.+-]+@[\w.-]+\.\w+/g) || []), d.email].filter(Boolean).map((e) => e.toLowerCase()));
  return { id: c.id, category: c.category || '', emails, amounts: new Set(pasteAmounts(c.rawText || '')), refs: new Set(pasteRefs(c.rawText || '')) };
}

/** Score every case: shared ref is strong; email+amount is strong; email or amount alone is weak. */
export function findCaseLinks(extracted, cases) {
  const scored = [];
  for (const c of (cases || []).slice(0, MAX_CASES)) {
    if (!c?.id) continue;
    const k = caseKeys(c);
    const reasons = [];
    const sharedRef = extracted.refs.find((r) => k.refs.has(r));
    if (sharedRef) reasons.push(`same ref ${sharedRef}`);
    const sameEmail = extracted.email && k.emails.has(extracted.email);
    if (sameEmail) reasons.push('same email');
    const sharedAmt = extracted.amounts.find((a) => k.amounts.has(a));
    if (sharedAmt != null) reasons.push(`same amount $${sharedAmt.toFixed(2)}`);
    const score = (sharedRef ? 3 : 0) + (sameEmail ? 1 : 0) + (sharedAmt != null ? 1 : 0);
    const strong = Boolean(sharedRef) || (sameEmail && sharedAmt != null);
    if (strong) scored.push({ id: c.id, category: k.category, reasons, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.category === extracted.category ? -1 : 0) || String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
  // Prefer a case of the same category as the paste among equally strong matches.
  const top = scored[0]?.score;
  const tied = scored.filter((s) => s.score === top);
  const primary = tied.find((s) => s.category === extracted.category) || scored[0];
  if (!primary) return null;
  return { id: primary.id, reasons: primary.reasons, otherIds: scored.filter((s) => s.id !== primary.id).map((s) => s.id) };
}

/* ---------------- AI path ---------------- */

export function buildPastePrompt(text, cases) {
  const list = (cases || [])
    .slice(0, MAX_CASES)
    .map((c) => `[${c.id}] ${String(c.rawText || '').replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n');
  return `You read one new message sent to a payments ops desk. It may be in any language, angry, or a forwarded thread.
Return ONLY a JSON object with keys:
customer (name of the paying customer or company, "" if unknown),
email (customer email, "" if unknown),
amount (number in the original currency, null if unknown),
currency (ISO code, "" if unknown),
ref (order, invoice or merchant reference, "" if unknown),
whatHappened (one short English sentence),
wants (what the customer asks for, short English phrase),
language (ISO 639-1 code of the message),
linkedCaseId (id of the existing case below that is about the same payment, or "" if none),
linkReason (short reason for the link, "" if none),
quotes (array of {"text": exact words copied from the message, "supports": one of customer|email|amount|ref|whatHappened|wants|link}).
Copy quotes character for character from the message. Do not translate quotes.

Existing cases:
${list || '(none)'}

Message:
${text}`;
}

function cleanAiFacts(ai) {
  const facts = {};
  for (const k of FACT_KEYS) {
    const v = ai?.[k];
    if (k === 'amount') {
      const n = Number(v);
      if (v !== null && v !== '' && Number.isFinite(n) && n > 0) facts.amount = Math.round(n * 100) / 100;
    } else if (typeof v === 'string' && v.trim()) facts[k] = v.trim().slice(0, 200);
  }
  return facts;
}

/** Which facts the source actually backs: a verified quote supports it, or the value appears verbatim. */
function factSupport(facts, verified, text) {
  const out = {};
  const ruleAmounts = pasteAmounts(text);
  for (const [k, v] of Object.entries(facts)) {
    const byQuote = verified.some((q) => q.supports === k);
    let inText = false;
    if (k === 'amount') inText = ruleAmounts.includes(v);
    else if (k === 'customer' || k === 'email' || k === 'ref') inText = quoteInSource(String(v), text);
    out[k] = byQuote || inText ? 'in source' : k === 'whatHappened' || k === 'wants' ? 'summary' : 'not found in source';
  }
  return out;
}

/**
 * @param {{ text?: string, cases?: Array<{ id: string, rawText: string, category?: string }> }} body
 * @param {{ model?: (prompt: string) => Promise<object> }} [opts] injectable model call (tests, mock mode)
 */
export async function runPaste(body, opts = {}) {
  const text = String(body?.text ?? '');
  if (!text.trim()) {
    const err = new Error('Paste a message first.');
    err.status = 400;
    throw err;
  }
  if (text.length > MAX_PASTE_CHARS) {
    const err = new Error(`That message is over ${MAX_PASTE_CHARS.toLocaleString('en-US')} characters. Paste just the relevant part.`);
    err.status = 413;
    throw err;
  }
  const cases = Array.isArray(body?.cases) ? body.cases.filter((c) => c && typeof c.id === 'string') : [];
  const rules = rulesExtract(text);
  const ruleLink = findCaseLinks(rules, cases);
  const modeInfo = getModeInfo();
  const model = opts.model || (modeInfo.mode === 'ai' ? (p) => callModelJson(p, modeInfo) : null);

  if (model) {
    try {
      const ai = await model(buildPastePrompt(text, cases));
      if (!ai || typeof ai !== 'object') throw new Error('invalid model output');
      const facts = cleanAiFacts(ai);
      const { verified, dropped } = verifyQuotes(ai.quotes, text);
      const support = factSupport(facts, verified, text);
      // Facts with a specific value that the source does not contain are dropped too.
      const droppedFacts = [];
      for (const [k, s] of Object.entries(support)) {
        if (s === 'not found in source') {
          droppedFacts.push({ field: k, value: facts[k], reason: 'Value not found in the pasted message' });
          delete facts[k];
          delete support[k];
        }
      }
      // A model link is kept only when the deterministic check agrees (shared ref, or email and amount).
      const aiId = typeof ai.linkedCaseId === 'string' ? ai.linkedCaseId.trim() : '';
      let link = null;
      let linkNote = '';
      const det = findCaseLinks(
        { ...rules, amounts: [...new Set([...rules.amounts, ...(facts.amount ? [facts.amount] : [])])] },
        cases
      );
      if (aiId && det && (det.id === aiId || det.otherIds.includes(aiId))) {
        link = { id: aiId, reasons: det.id === aiId ? det.reasons : ['shares ref, or email and amount'], otherIds: [det.id, ...det.otherIds].filter((x) => x !== aiId), basis: 'ai+check' };
      } else if (aiId) {
        linkNote = cases.some((c) => c.id === aiId)
          ? `The model suggested ${aiId}, but no shared ref, or email and amount, backs it. Not linked.`
          : `The model suggested ${aiId}, which is not in this batch. Not linked.`;
        if (det) link = { ...det, basis: 'rules' };
      } else if (det) {
        link = { ...det, basis: 'rules' };
      }
      return {
        engine: opts.engineLabel || modeInfo.label,
        source: opts.source || 'ai',
        facts,
        support,
        language: typeof ai.language === 'string' ? ai.language.slice(0, 5) : '',
        currency: typeof ai.currency === 'string' ? ai.currency.slice(0, 5) : '',
        category: rules.category,
        quotes: verified,
        dropped,
        droppedFacts,
        link,
        linkNote,
      };
    } catch (err) {
      return rulesResult(text, rules, ruleLink, `The model call failed (${String(err?.message || 'error').slice(0, 80)}); rules were used.`);
    }
  }
  return rulesResult(text, rules, ruleLink, '');
}

function rulesResult(text, rules, link, fallbackReason) {
  const support = {};
  for (const k of Object.keys(rules.facts)) support[k] = 'in source';
  const { verified, dropped } = verifyQuotes(rules.quotes, text);
  return {
    engine: 'Rules',
    source: fallbackReason ? 'rules-fallback' : 'rules',
    fallbackReason,
    facts: rules.facts,
    support,
    language: '',
    currency: '',
    category: rules.category,
    quotes: verified,
    dropped,
    droppedFacts: [],
    link: link ? { ...link, basis: 'rules' } : null,
    linkNote: '',
  };
}
