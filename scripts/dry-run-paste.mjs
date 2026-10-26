#!/usr/bin/env node
// Dry run of the "Paste a new one" AI path against the real Gemini API.
// Live AI check of the paste box. Nothing runs without --approved.
//
//   node scripts/dry-run-paste.mjs --approved --key-file <path-to-key-file> [--one] [--model <name>]
//   node scripts/dry-run-paste.mjs --selftest   (offline: fake key, stubbed Gemini reply, no network)
//
// - The key file may hold just the key, or a line GEMINI_API_KEY=...; it is loaded into
//   process.env only. The key is never printed: all console output is redacted.
// - At most 2 model calls (1 with --one); any further network call throws. Only
//   generativelanguage.googleapis.com is allowed. The batch itself is triaged with rules (no call).
// - Prints only the extracted facts, the linked case, and which quotes were verified or dropped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const SELFTEST = flag('--selftest');
if (!SELFTEST && !flag('--approved')) {
  console.log('Not run: live AI calls are opt-in. Re-run with --approved --key-file <path>.');
  process.exit(1);
}
const keyFile = opt('--key-file');
if (!SELFTEST && !keyFile) {
  console.log('Missing --key-file <path>.');
  process.exit(1);
}

// Load the key without echoing it.
let key = '';
if (SELFTEST) key = 'selftest-fake-key-0000';
else try {
  const raw = fs.readFileSync(keyFile, 'utf8');
  const line = raw.split(/\r?\n/).find((l) => /^\s*(export\s+)?GEMINI_API_KEY\s*=/.test(l));
  key = (line ? line.split('=').slice(1).join('=') : raw).trim().replace(/^['"]|['"]$/g, '');
} catch {
  console.log('Could not read the key file.');
  process.exit(1);
}
if (!key || /\s/.test(key)) {
  console.log('The key file does not contain a single key value.');
  process.exit(1);
}
process.env.GEMINI_API_KEY = key;
process.env.LLM_PROVIDER = 'gemini';
delete process.env.OPENAI_API_KEY;
if (opt('--model')) process.env.GEMINI_MODEL = opt('--model');

// Redact the key from anything printed, just in case.
const redact = (v) => (typeof v === 'string' ? v.split(key).join('[redacted]') : v);
for (const m of ['log', 'error', 'warn', 'info']) {
  const orig = console[m].bind(console);
  console[m] = (...a) => orig(...a.map((x) => (typeof x === 'string' ? redact(x) : redact(JSON.stringify(x, null, 2)))));
}

// Hard cap on network calls.
const MAX_CALLS = flag('--one') ? 1 : 2;
let calls = 0;
let realFetch = globalThis.fetch;
if (SELFTEST) {
  const { mockPasteModel } = await import('../server/paste-mock.js');
  realFetch = async (_url, init) => {
    const prompt = JSON.parse(init.body).contents[0].parts[0].text;
    const reply = await mockPasteModel(prompt);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }) };
  };
}
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  if (u.hostname !== 'generativelanguage.googleapis.com') throw new Error('blocked host');
  if (calls >= MAX_CALLS) throw new Error('call cap reached');
  calls++;
  return realFetch(url, init);
};

const { parseBatch } = await import('../server/parser.js');
const { triageWithRules } = await import('../server/rules-engine.js');
const { runPaste } = await import('../server/paste.js');
const { getModeInfo } = await import('../server/mode.js');

const cases = parseBatch(fs.readFileSync(path.join(root, 'samples', 'batch.txt'), 'utf8')).items.map((x, i) => {
  const id = `EX-${String(i + 1).padStart(2, '0')}`;
  return { id, rawText: x.rawText, category: triageWithRules({ ...x, id }).category };
});

const samples = ['spanish-email', 'forwarded-thread'].slice(0, MAX_CALLS);
console.log(`Mode: ${getModeInfo().label}${SELFTEST ? ' · SELFTEST (stubbed, no network)' : ''} · cap ${MAX_CALLS} call(s)`);
for (const name of samples) {
  const text = fs.readFileSync(path.join(root, 'samples', 'paste', `${name}.txt`), 'utf8');
  const r = await runPaste({ text, cases });
  console.log(`\n=== ${name} (${r.source}${r.fallbackReason ? `: ${r.fallbackReason}` : ''})`);
  console.log('Facts:', JSON.stringify(r.facts));
  console.log('Linked case:', r.link ? `${r.link.id} (${r.link.reasons.join(', ')}; ${r.link.basis})` : 'none');
  if (r.linkNote) console.log('Link note:', r.linkNote);
  console.log(`Verified quotes (${r.quotes.length}):`);
  for (const q of r.quotes) console.log(`  ✓ "${q.text}" [${q.supports}]`);
  console.log(`Dropped (${r.dropped.length + r.droppedFacts.length}):`);
  for (const d of r.dropped) console.log(`  ✕ "${d.text}" [${d.supports}] ${d.reason}`);
  for (const d of r.droppedFacts) console.log(`  ✕ ${d.field}: ${d.value} ${d.reason}`);
}
console.log(`\nModel calls made: ${calls}`);
