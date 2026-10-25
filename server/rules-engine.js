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
 * @returns {import('./rules-engine.js').TriageResult}
 */
export function triageWithRules(item) {
  const text = item.rawText;
  const lower = text.toLowerCase();
  const lines = text.split(/\r?\n/);
  const evidenceLines = [];
  const amounts = extractAmounts(text);
  const maxAmount = amounts.length ? Math.max(...amounts) : 0;

  let category = CATEGORIES.OTHER;
  let priority = 'P3';
  let suggestedAction = 'Review manually and assign owner';
  let confidence = 0.55;
  let why = 'No strong keyword match; needs human judgment.';

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
    });
  }

  if (matchesDuplicate(lower)) {
    category = CATEGORIES.DUPLICATE;
    markEvidence(lines, evidenceLines, /duplicate|double|twice|two charges|charged again/i);
    suggestedAction = 'Verify ledger for duplicate capture; void or refund duplicate if confirmed';
    why = 'Language indicates a possible duplicate charge.';
    priority = 'P1';
  } else if (matchesDispute(lower)) {
    category = CATEGORIES.DISPUTE;
    markEvidence(lines, evidenceLines, /dispute|chargeback|card network|reason code/i);
    suggestedAction = 'Gather evidence and respond before network deadline';
    why = 'Dispute or chargeback language detected — time-sensitive.';
    priority = 'P1';
  } else if (matchesRefund(lower)) {
    category = CATEGORIES.REFUND;
    markEvidence(lines, evidenceLines, /refund|money back|return payment|credit customer/i);
    suggestedAction = 'Confirm original payment status; approve refund if eligible';
    why = 'Customer is requesting a refund.';
    priority = maxAmount >= P1_AMOUNT ? 'P1' : 'P2';
  } else if (matchesInvoice(lower)) {
    category = CATEGORIES.INVOICE;
    markEvidence(lines, evidenceLines, /invoice|mismatch|does not match|wrong amount|po number|purchase order/i);
    suggestedAction = 'Reconcile invoice line items against payment record';
    why = 'Invoice amount or reference does not align with payment.';
    priority = maxAmount >= P1_AMOUNT ? 'P1' : 'P2';
  } else if (matchesFailed(lower)) {
    category = CATEGORIES.FAILED;
    markEvidence(lines, evidenceLines, /failed|declined|insufficient|do not honor|could not capture|payment error/i);
    suggestedAction = 'Ask customer to update payment method or retry';
    why = 'Payment attempt failed or was declined.';
    priority = maxAmount >= P1_AMOUNT ? 'P1' : 'P2';
  }

  if (category === CATEGORIES.OTHER) {
    markEvidence(lines, evidenceLines, /.*/);
    if (evidenceLines.length === 0) evidenceLines.push(0);
  }

  if (priority !== 'P1' && maxAmount >= P1_AMOUNT) {
    priority = 'P1';
    why += ` Amount $${maxAmount.toFixed(2)} meets urgent threshold ($${P1_AMOUNT}+).`;
    markEvidence(lines, evidenceLines, /\$[\d,]+(\.\d{2})?/);
  }

  const draftReply = buildDraft(category, maxAmount);
  confidence = category === CATEGORIES.OTHER ? 0.45 : 0.82;

  return finish(item, {
    category,
    priority,
    suggestedAction,
    draftReply,
    confidence,
    why,
    evidenceLines: uniqueSorted(evidenceLines),
  });
}

function finish(item, fields) {
  return {
    id: item.id,
    rawText: item.rawText,
    relatedIds: [],
    fallback: undefined,
    ...fields,
  };
}

function matchesFailed(lower) {
  return /failed|declined|insufficient funds|do not honor|could not capture|payment error|card expired/.test(lower);
}

function matchesInvoice(lower) {
  return /invoice/.test(lower) && /mismatch|doesn't match|does not match|wrong|discrepancy|off by/.test(lower);
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

function markEvidence(lines, indices, pattern) {
  lines.forEach((line, i) => {
    if (pattern.test(line)) indices.push(i);
  });
}

function uniqueSorted(arr) {
  return [...new Set(arr)].sort((a, b) => a - b);
}

function buildDraft(category, amount) {
  const amt = amount > 0 ? ` for $${amount.toFixed(2)}` : '';
  switch (category) {
    case CATEGORIES.FAILED:
      return `Hi — we see the payment${amt} did not go through. Please update your card or try again; we have not charged you. Reply if you need a different payment link.`;
    case CATEGORIES.INVOICE:
      return `Hi — thanks for flagging the invoice mismatch${amt}. We are reconciling against our records and will confirm the correct balance within 1–2 business days.`;
    case CATEGORIES.REFUND:
      return `Hi — we received your refund request${amt}. We are verifying the original payment status and will confirm next steps shortly.`;
    case CATEGORIES.DISPUTE:
      return `Hi — we are reviewing the dispute${amt} and gathering documentation. We will respond before the network deadline and keep you posted.`;
    case CATEGORIES.DUPLICATE:
      return `Hi — sorry for the duplicate charge${amt}. We are checking our processor now; if confirmed we will reverse the extra capture within 2 business days.`;
    default:
      return `Hi — thanks for your message. Our team is reviewing the details and will follow up with a clear next step soon.`;
  }
}

export { CATEGORIES, P1_AMOUNT };
