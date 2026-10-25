import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getModeInfo } from './mode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  const ct = req.headers['content-type'] || '';
  if (ct.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return { text: raw };
    }
  }
  return { text: raw };
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function serveStatic(req, res, urlPath) {
  let filePath = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

/** @type {import('./index.js').createApp} */
export function createApp(handlers = {}) {
  const onTriage = handlers.onTriage || null;

  return async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === 'GET' && pathname === '/api/mode') {
      sendJson(res, 200, getModeInfo());
      return;
    }

    if (req.method === 'GET' && pathname === '/api/sample') {
      try {
        const samplePath = path.join(__dirname, '..', 'samples', 'batch.txt');
        const text = await fs.readFile(samplePath, 'utf8');
        sendJson(res, 200, { text });
      } catch {
        sendJson(res, 404, { error: 'Sample batch not found' });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/triage') {
      if (!onTriage) {
        sendJson(res, 503, { error: 'Triage not configured' });
        return;
      }
      try {
        const body = await readBody(req);
        const result = await onTriage(body);
        sendJson(res, 200, result);
      } catch (err) {
        const status = err.status || 500;
        sendJson(res, status, { error: err.message || 'Triage failed' });
      }
      return;
    }

    if (req.method === 'GET' && !pathname.startsWith('/api')) {
      await serveStatic(req, res, pathname);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  };
}

const app = createApp();

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const server = http.createServer((req, res) => app(req, res));
  server.listen(PORT, () => {
    console.log(`Exception Desk at http://localhost:${PORT}`);
  });
}
