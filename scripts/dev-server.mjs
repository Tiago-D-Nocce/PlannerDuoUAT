// scripts/dev-server.mjs — servidor estático local, sem dependências.
//
// Reproduz o comportamento de Firebase Hosting declarado em firebase.json:
// serve o diretório `public/` e aplica os mesmos rewrites (/app -> app.html,
// /auth -> auth.html, resto -> index.html). Serve para abrir o PlannerDuo em
// http://localhost (o Firebase Auth não funciona sob file://).
//
// Uso: npm run dev  [-- --port 5000]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const RAIZ = resolve(import.meta.dirname, '..', 'public');

const argPorta = process.argv.indexOf('--port');
const PORTA = Number(
  argPorta !== -1 ? process.argv[argPorta + 1] : process.env.PORT || 5000
);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Rewrites equivalentes aos de firebase.json.
const REWRITES = { '/app': '/app.html', '/auth': '/auth.html' };

/**
 * Resolve o caminho da requisição para um arquivo dentro de `public/`,
 * recusando qualquer tentativa de escapar do diretório (path traversal).
 * @param {string} urlPath caminho da URL já decodificado
 * @returns {string|null} caminho absoluto seguro, ou null se sair da raiz
 */
function caminhoSeguro(urlPath) {
  const relativo = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const absoluto = join(RAIZ, relativo);
  if (absoluto !== RAIZ && !absoluto.startsWith(RAIZ + sep)) return null;
  return absoluto;
}

async function arquivo(caminho) {
  try {
    const info = await stat(caminho);
    if (info.isDirectory()) return null;
    return await readFile(caminho);
  } catch {
    return null;
  }
}

const servidor = createServer(async (req, res) => {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  const alvo = REWRITES[urlPath] || (urlPath === '/' ? '/index.html' : urlPath);

  const caminho = caminhoSeguro(alvo);
  if (!caminho) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let corpo = await arquivo(caminho);
  let ext = extname(caminho);

  // Fallback de SPA: qualquer rota desconhecida cai na landing, como no
  // rewrite `"source": "**"` do firebase.json.
  if (corpo === null) {
    corpo = await arquivo(join(RAIZ, 'index.html'));
    ext = '.html';
    if (corpo === null) {
      res.writeHead(404).end('Not found');
      return;
    }
  }

  res.writeHead(200, {
    'Content-Type': TIPOS[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(corpo);
});

servidor.listen(PORTA, () => {
  console.log(`PlannerDuo servido em http://localhost:${PORTA}`);
  console.log(`Raiz: ${RAIZ}`);
});
