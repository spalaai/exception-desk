import './_offline.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/index.js';
import { runTriage } from '../server/triage-run.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('POST /api/triage', () => {
  let server;
  let port;

  before(async () => {
    const app = createApp({ onTriage: runTriage });
    server = http.createServer((req, res) => app(req, res));
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('returns triaged items for sample batch', async () => {
    const samplePath = path.join(__dirname, '..', 'samples', 'batch.txt');
    const text = await fs.readFile(samplePath, 'utf8');
    const res = await fetch(`http://127.0.0.1:${port}/api/triage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.triageId);
    assert.equal(data.items.length, 12);
    const p1 = data.items.filter((i) => i.priority === 'P1');
    assert.ok(p1.length >= 4);
    const dupes = data.items.filter((i) => i.category === 'duplicate charge');
    assert.equal(dupes.length, 2);
    const withRelated = data.items.filter((i) => i.relatedIds?.length);
    assert.ok(withRelated.length >= 2);
  });

  it('rejects empty input', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/triage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '  ' }),
    });
    assert.equal(res.status, 400);
  });
});
