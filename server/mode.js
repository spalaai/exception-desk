/**
 * Resolves demo vs AI mode label for the header (keys never sent to client).
 */
function providerPreference() {
  const fromLlm = process.env.LLM_PROVIDER?.trim()?.toLowerCase();
  const fromAi = process.env.AI_PROVIDER?.trim()?.toLowerCase();
  return fromLlm || fromAi || '';
}

export function getModeInfo() {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const providerPref = providerPreference();

  if (providerPref === 'mock') {
    // Offline demo of the paste box's AI path with canned replies; batch triage stays on rules.
    return { mode: 'demo', label: 'Demo mode (rules) · paste box: mock AI', pasteMock: true };
  }

  if (providerPref === 'rules') {
    return { mode: 'demo', label: 'Demo mode (rules)' };
  }

  let provider = null;
  if (providerPref === 'openai' && openaiKey) provider = 'openai';
  else if (providerPref === 'gemini' && geminiKey) provider = 'gemini';
  else if (openaiKey) provider = 'openai';
  else if (geminiKey) provider = 'gemini';

  if (!provider) {
    return { mode: 'demo', label: 'Demo mode (rules)' };
  }

  const model =
    provider === 'openai'
      ? process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
      : process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';

  const name = provider === 'openai' ? 'OpenAI' : 'Gemini';
  return { mode: 'ai', label: `AI: ${name} / ${model}`, provider, model };
}

export function hasLlmConfigured() {
  return getModeInfo().mode === 'ai';
}
