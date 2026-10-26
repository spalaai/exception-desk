// Canned model replies for the "Paste a new one" box when LLM_PROVIDER=mock.
// For screenshots and offline demos of the AI path only. No network call is made,
// and the UI labels the engine "Mock AI". The Spanish reply deliberately includes one
// quote that is NOT in the message, to show that unverified quotes get dropped.
import { rulesExtract } from './paste.js';

const CANNED = [
  {
    match: /AC-7781/,
    reply: {
      customer: 'Jen Park',
      email: 'jen@acme.example',
      amount: 120,
      currency: 'USD',
      ref: 'AC-7781',
      whatHappened: 'Customer says she was charged for order AC-7781 and received a shipping confirmation.',
      wants: 'full refund today',
      language: 'es',
      linkedCaseId: 'EX-05',
      linkReason: 'same order AC-7781, same email and amount',
      quotes: [
        { text: 'Me cobraron 120,00 US$ por el pedido AC-7781', supports: 'amount' },
        { text: 'me mandaron la confirmación de envío', supports: 'whatHappened' },
        { text: 'Quiero el reembolso completo HOY', supports: 'wants' },
        { text: 'Me cobraron dos veces', supports: 'whatHappened' },
      ],
    },
  },
];

export async function mockPasteModel(prompt) {
  const message = prompt.split('\nMessage:\n').pop() || '';
  const hit = CANNED.find((c) => c.match.test(message));
  if (hit) return structuredClone(hit.reply);
  // Unknown text: answer like a model would, from the deterministic extract.
  const r = rulesExtract(message);
  return { ...r.facts, language: '', linkedCaseId: '', quotes: r.quotes };
}
