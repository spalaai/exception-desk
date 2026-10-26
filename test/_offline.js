// Imported first by tests that reach triage code. Forces deterministic rules mode and
// blocks real network calls, so exported OPENAI/GEMINI keys can never make tests hang.
// Tests that need the LLM path (llm-triage.test.js) set their own env and mock fetch.
for (const k of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'AI_PROVIDER']) delete process.env[k];
process.env.LLM_PROVIDER = 'rules';

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => {
  const u = String(url);
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(u)) return realFetch(url, ...rest);
  throw new Error(`Network disabled in tests: ${u}`);
};
