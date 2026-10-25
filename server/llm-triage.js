import { triageWithRules } from './rules-engine.js';
import { getModeInfo } from './mode.js';

const TIMEOUT_MS = 15_000;

/**
 * LLM triage for one item when AI mode is on (rules baseline + related context in prompt).
 * @param {object} item rules-triaged item with relatedLinks
 * @param {string} relatedSummary
 */
export async function triageItemWithContext(item, relatedSummary) {
  const mode = getModeInfo();
  if (mode.mode !== 'ai') {
    return triageWithRules(item);
  }

  try {
    const llm = await triageWithLlm(item, mode, relatedSummary);
    const validated = validateLlmResult(item, llm);
    return {
      ...validated,
      relatedIds: item.relatedIds,
      relatedLinks: item.relatedLinks,
      relatedReasons: item.relatedReasons,
      source: 'ai',
    };
  } catch {
    const rules = triageWithRules(item);
    return {
      ...rules,
      relatedIds: item.relatedIds,
      relatedLinks: item.relatedLinks,
      relatedReasons: item.relatedReasons,
      source: 'rules-fallback',
    };
  }
}

function validateLlmResult(item, llm) {
  const categories = [
    'failed payment',
    'invoice mismatch',
    'refund request',
    'dispute / chargeback',
    'duplicate charge',
    'other / needs human',
  ];
  const priorities = ['P1', 'P2', 'P3'];
  if (!llm || typeof llm !== 'object') throw new Error('invalid llm');

  const category = categories.includes(llm.category) ? llm.category : 'other / needs human';
  let priority = priorities.includes(llm.priority) ? llm.priority : 'P3';
  if (category === 'dispute / chargeback' || category === 'duplicate charge') priority = 'P1';

  const lines = item.rawText.split(/\r?\n/);
  let evidenceLines = Array.isArray(llm.evidenceLines)
    ? llm.evidenceLines.filter((n) => Number.isInteger(n) && n >= 0 && n < lines.length)
    : [];
  if (!evidenceLines.length) evidenceLines = item.evidenceLines?.length ? item.evidenceLines : [0];

  let confidence = Number(llm.confidence);
  if (!Number.isFinite(confidence)) confidence = item.confidence ?? 0.7;
  confidence = Math.min(1, Math.max(0, confidence));

  return {
    id: item.id,
    rawText: item.rawText,
    fields: item.fields,
    category,
    priority,
    suggestedAction: String(llm.suggestedAction || item.suggestedAction || 'Review and respond'),
    draftReply: String(llm.draftReply || item.draftReply || ''),
    confidence,
    why: String(llm.why || item.why || 'LLM classification'),
    evidenceLines,
    matchedSignals: item.matchedSignals,
  };
}

async function triageWithLlm(item, mode, relatedSummary) {
  const prompt = buildPrompt(item, relatedSummary);
  if (mode.provider === 'gemini') {
    return callGemini(prompt, mode.model);
  }
  return callOpenAI(prompt, mode.model);
}

function buildPrompt(item, relatedSummary) {
  const relatedBlock = relatedSummary
    ? `\nRelated items in this batch (deterministic; align your reasoning with these links):\n${relatedSummary}\n`
    : '\nNo related items detected in this batch.\n';

  return `You triage payment operations exceptions. Return ONLY valid JSON with keys:
category (one of: failed payment, invoice mismatch, refund request, dispute / chargeback, duplicate charge, other / needs human),
priority (P1, P2, or P3; disputes, chargebacks, duplicate charges, and amounts $500+ are P1),
suggestedAction (short imperative),
draftReply (professional email draft using customer name, order/invoice ids, and amounts when present),
confidence (0-1),
why (one sentence; mention matched signals),
evidenceLines (array of 0-based line indices from the source text that support your answer; include amount lines, decline reasons, reason codes, invoice totals).
${relatedBlock}
Source:
${item.rawText}${item.fields ? `\nStructured fields:\n${JSON.stringify(item.fields)}` : ''}`;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI(prompt, model) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('no openai key');
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Respond with a single JSON object only.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  return JSON.parse(content);
}

async function callGemini(prompt, model) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('no gemini key');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(content);
}
