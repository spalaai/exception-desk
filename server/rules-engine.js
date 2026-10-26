import {
  extractDetails,
  extractAmounts,
  formatAmount,
  itemFullText,
  greetingSalutation,
} from './extract.js';

const P1_AMOUNT = 500;

const CATEGORIES = {
  FAILED: 'failed payment',
  INVOICE: 'invoice mismatch',
  REFUND: 'refund request',
  DISPUTE: 'dispute / chargeback',
  DUPLICATE: 'duplicate charge',
  OTHER: 'other / needs human',
};

/**
 * @param {{ id: string, rawText: string, fields?: Record<string, string>, parseWarning?: string }} item
 */
export function triageWithRules(item) {
  const text = itemFullText(item);
  const lower = text.toLowerCase();
  const lines = item.rawText.split(/\r?\n/);
  const evidenceLines = [];
  const details = extractDetails(item);
  const amounts = details.amounts.length ? details.amounts : extractAmounts(text);
  const maxAmount = amounts.length ? Math.max(...amounts) : 0;

  const signals = [];

  let category = CATEGORIES.OTHER;
  let priority = 'P3';
  let suggestedAction = 'Review manually and assign owner';
  let why = 'No clear signal; needs human judgment.';

  if (item.parseWarning === 'unparseable') {
    return finish(item, {
      category: CATEGORIES.OTHER,
      priority: 'P3',
      suggestedAction: 'Escalate to ops lead for manual review',
      draftReply:
        'Thanks for reaching out. We are reviewing your case manually and will follow up within one business day.',
      confidence: 0.35,
      why: 'Could not parse structured fields from this item.',
      evidenceLines: [0],
      matchedSignals: ['unparseable'],
    });
  }

  if (matchesDuplicate(lower)) {
    category = CATEGORIES.DUPLICATE;
    addSignal(signals, 'duplicate charge language', 0.22, lines, evidenceLines, /duplicate|double|twice|two charges|charged again/i);
    suggestedAction = 'Verify ledger for duplicate capture; void or refund duplicate if confirmed';
    why = 'Language indicates a possible duplicate charge.';
    priority = 'P1';
  } else if (matchesDispute(lower)) {
    category = CATEGORIES.DISPUTE;
    if (/chargeback/i.test(lower)) addSignal(signals, 'chargeback', 0.28, lines, evidenceLines, /chargeback/i);
    if (/reason code/i.test(lower)) addSignal(signals, 'reason code', 0.26, lines, evidenceLines, /reason code/i);
    if (/dispute|card network|representment/i.test(lower)) {
      addSignal(signals, 'dispute', 0.18, lines, evidenceLines, /dispute|card network|representment/i);
    }
    suggestedAction = 'Gather evidence and respond before network deadline';
    why = 'Dispute or chargeback language detected; time-sensitive.';
    priority = 'P1';
  } else if (matchesRefund(lower)) {
    category = CATEGORIES.REFUND;
    addSignal(signals, 'refund request', 0.2, lines, evidenceLines, /refund|money back|return payment|credit customer/i);
    suggestedAction = 'Confirm original payment status; approve refund if eligible';
    why = 'Customer is requesting a refund.';
    priority = maxAmount >= P1_AMOUNT ? 'P1' : 'P2';
  } else if (matchesInvoice(lower)) {
    category = CATEGORIES.INVOICE;
    addSignal(signals, 'invoice mismatch', 0.22, lines, evidenceLines, /invoice|mismatch|does not match|wrong amount|po number|purchase order/i);
    markEvidence(lines, evidenceLines, /invoice.{0,40}\$|total|off by|captured|payment record/i);
    suggestedAction = 'Reconcile invoice line items against payment record';
    why = 'Invoice amount or reference does not align with payment.';
    priority = maxAmount >= P1_AMOUNT ? 'P1' : 'P2';
  } else if (matchesFailed(lower)) {
    category = CATEGORIES.FAILED;
    if (/declined|do not honor|insufficient/i.test(lower)) {
      addSignal(signals, 'decline reason', 0.2, lines, evidenceLines, /declined|do not honor|insufficient/i);
    } else {
      addSignal(signals, 'payment failed', 0.16, lines, evidenceLines, /failed|could not capture|payment error/i);
    }
    suggestedAction = 'Ask customer to update payment method or retry';
    why = 'Payment attempt failed or was declined.';
    priority = maxAmount >= P1_AMOUNT ? 'P1' : 'P2';
  }

  const hintCategory = categoryFromHint(item.fields);
  if (category === CATEGORIES.OTHER && hintCategory && hintCategory !== CATEGORIES.OTHER) {
    category = hintCategory;
    addSignal(signals, `category_hint ${item.fields?.category_hint || item.fields?.category}`, 0.2, lines, evidenceLines, /.*/);
    ({ suggestedAction, why, priority } = defaultsForCategory(category, maxAmount, lower));
    if (category === CATEGORIES.DUPLICATE) priority = 'P1';
    if (category === CATEGORIES.DISPUTE) priority = 'P1';
  }

  if (category === CATEGORIES.OTHER) {
    addSignal(signals, 'weak context', 0.08, lines, evidenceLines, /.*/);
    if (evidenceLines.length === 0) evidenceLines.push(0);
  }

  if (details.reasonCode) {
    addSignal(signals, `reason code ${details.reasonCode}`, 0.1, lines, evidenceLines, /reason code/i);
  }
  if (maxAmount > 0) {
    markEvidence(lines, evidenceLines, /\$[\d,]+(\.\d{2})?/);
    if (maxAmount >= P1_AMOUNT) {
      addSignal(signals, `amount ≥ $${P1_AMOUNT}`, 0.12, lines, evidenceLines, /\$[\d,]+(\.\d{2})?/);
    }
  }

  if (priority !== 'P1' && maxAmount >= P1_AMOUNT) {
    priority = 'P1';
    why += ` Amount ${formatAmount(maxAmount)} meets urgent threshold ($${P1_AMOUNT}+).`;
  }

  const matchedSignals = signals.map((s) => s.label);
  let confidence = 0.42 + signals.reduce((sum, s) => sum + s.weight, 0);
  confidence = Math.min(0.96, Math.max(0.35, confidence));
  if (category === CATEGORIES.OTHER) confidence = Math.min(confidence, 0.52);

  const signalNote = matchedSignals.length ? ` Matched signals: ${matchedSignals.join(', ')}.` : '';
  why = (why + signalNote).trim();

  const draftReply = buildDraft(category, details, maxAmount);

  return finish(item, {
    category,
    priority,
    suggestedAction,
    draftReply,
    confidence,
    why,
    evidenceLines: uniqueSorted(evidenceLines),
    matchedSignals,
  });
}

function finish(item, fields) {
  return {
    id: item.id,
    rawText: item.rawText,
    fields: item.fields,
    relatedIds: [],
    relatedLinks: [],
    source: 'rules',
    ...fields,
  };
}

function addSignal(signals, label, weight, lines, evidenceLines, pattern) {
  signals.push({ label, weight });
  markEvidence(lines, evidenceLines, pattern);
}

function matchesFailed(lower) {
  return /failed|declined|insufficient funds|do not honor|could not capture|payment error|card expired/.test(lower);
}

function matchesInvoice(lower) {
  if (
    /invoice/.test(lower) &&
    /mismatch|doesn't match|does not match|wrong|discrepancy|off by|captured|vs\.?|versus|payment record/.test(
      lower
    )
  ) {
    return true;
  }
  return /\binv-\d+/.test(lower) && /mismatch|captured|vs\.?|versus|total/.test(lower);
}

function categoryFromHint(fields) {
  const hint = String(fields?.category_hint || fields?.category || '').trim().toLowerCase();
  const map = {
    failed: CATEGORIES.FAILED,
    duplicate: CATEGORIES.DUPLICATE,
    invoice: CATEGORIES.INVOICE,
    refund: CATEGORIES.REFUND,
    dispute: CATEGORIES.DISPUTE,
    chargeback: CATEGORIES.DISPUTE,
    other: CATEGORIES.OTHER,
  };
  return map[hint] || null;
}

function defaultsForCategory(category, maxAmount, lower) {
  switch (category) {
    case CATEGORIES.DUPLICATE:
      return {
        suggestedAction: 'Verify ledger for duplicate capture; void or refund duplicate if confirmed',
        why: 'Structured batch marks this as a duplicate charge.',
        priority: 'P1',
      };
    case CATEGORIES.DISPUTE:
      return {
        suggestedAction: 'Gather evidence and respond before network deadline',
        why: 'Structured batch marks this as a dispute or chargeback.',
        priority: 'P1',
      };
    case CATEGORIES.REFUND:
      return {
        suggestedAction: 'Confirm original payment status; approve refund if eligible',
        why: 'Structured batch marks this as a refund request.',
        priority: maxAmount >= P1_AMOUNT ? 'P1' : 'P2',
      };
    case CATEGORIES.INVOICE:
      return {
        suggestedAction: 'Reconcile invoice line items against payment record',
        why: 'Structured batch marks this as an invoice mismatch.',
        priority: maxAmount >= P1_AMOUNT ? 'P1' : 'P2',
      };
    case CATEGORIES.FAILED:
      return {
        suggestedAction: 'Ask customer to update payment method or retry',
        why: 'Structured batch marks this as a failed payment.',
        priority: maxAmount >= P1_AMOUNT ? 'P1' : 'P2',
      };
    default:
      return {
        suggestedAction: 'Review manually and assign owner',
        why: 'Structured batch could not classify further.',
        priority: 'P3',
      };
  }
}

function matchesRefund(lower) {
  return /refund|money back|return the payment|please credit|reverse the charge/.test(lower);
}

function matchesDispute(lower) {
  return /dispute|chargeback|reason code|card network|representment/.test(lower);
}

function matchesDuplicate(lower) {
  return /duplicate|double charge|charged twice|two identical charges|same amount twice/.test(lower);
}

function markEvidence(lines, indices, pattern) {
  lines.forEach((line, i) => {
    if (pattern.test(line)) indices.push(i);
  });
}

function uniqueSorted(arr) {
  return [...new Set(arr)].sort((a, b) => a - b);
}

function buildDraft(category, details, amount) {
  const amt = amount > 0 ? ` for ${formatAmount(amount)}` : '';
  const hi = greetingSalutation(details);
  switch (category) {
    case CATEGORIES.FAILED:
      return `${hi}, we see the payment${amt} did not go through. Please update your card or try again; we have not charged you. Reply if you need a different payment link.`;
    case CATEGORIES.INVOICE:
      return `${hi}, thanks for flagging the invoice mismatch${amt}. We are reconciling against our records and will confirm the correct balance within 1-2 business days.`;
    case CATEGORIES.REFUND:
      return `${hi}, we received your refund request${amt}. We are verifying the original payment status and will confirm next steps shortly.`;
    case CATEGORIES.DISPUTE:
      return `Dispute response${amt}: we contest this dispute and are gathering evidence (receipt, proof of delivery or service, customer communication). [Attach documents before submitting to the processor.]`;
    case CATEGORIES.DUPLICATE:
      return `${hi}, sorry for the duplicate charge${amt}. We are checking our processor now; if confirmed we will refund the extra capture within 2 business days.`;
    default:
      return `Hi, thanks for your message. Our team is reviewing the details and will follow up with a clear next step soon.`;
  }
}

export { CATEGORIES, P1_AMOUNT };
