// Servidor estático local, sem dependências e sem acesso a serviços externos.
// Uso: npm run dev -- --port 5500

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'public');
const portArgument = process.argv.indexOf('--port');
const PORT = Number(portArgument !== -1 ? process.argv[portArgument + 1] : process.env.PORT || 5500);

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  throw new Error('Porta inválida. Use --port entre 0 e 65535.');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const REWRITES = { '/app': '/app.html', '/auth': '/auth.html' };

function safePath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch (_) { return null; }
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  const absolute = join(ROOT, relative);
  if (absolute !== ROOT && !absolute.startsWith(ROOT + sep)) return null;
  return absolute;
}

async function file(path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return await readFile(path);
  } catch (_) {
    return null;
  }
}

const server = createServer(async (request, response) => {
  const method = request.method || 'GET';
  if (!['GET', 'HEAD'].includes(method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const urlPath = new URL(request.url || '/', 'http://localhost').pathname;
  const target = REWRITES[urlPath] || (urlPath === '/' ? '/index.html' : urlPath);
  const path = safePath(target);
  if (!path) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  let body = await file(path);
  let extension = extname(path);
  if (body === null) {
    body = await file(join(ROOT, 'index.html'));
    extension = '.html';
  }
  if (body === null) {
    response.writeHead(404).end('Not found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': TYPES[extension] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(method === 'HEAD' ? undefined : body);
});

server.listen(PORT, 'localhost', () => {
  const address = server.address();
  const activePort = typeof address === 'object' && address ? address.port : PORT;
  console.log(`PlannerDuo rodando em http://localhost:${activePort}/`);
  console.log('Dados salvos somente no navegador. Pressione Ctrl+C para encerrar.');
});
