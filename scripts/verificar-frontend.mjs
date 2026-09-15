// scripts/verificar-frontend.mjs — checagem de integridade do front-end.
//
// Confere três coisas que a migração de repositório pode ter quebrado:
//   1. sintaxe dos scripts servidos (app.js, core.js);
//   2. toda referência local em href/src existe dentro de public/;
//   3. cada página e asset responde pelo HTTP com o Content-Type correto
//      (o fallback de SPA devolve 200 mesmo para arquivo inexistente, então
//      comparamos o corpo servido com o arquivo em disco).
//
// Uso: node scripts/dev-server.mjs --port 5177   (em outro terminal)
//      node scripts/verificar-frontend.mjs --port 5177

import { readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const RAIZ = resolve(import.meta.dirname, '..', 'public');

const argPorta = process.argv.indexOf('--port');
const PORTA = Number(argPorta !== -1 ? process.argv[argPorta + 1] : 5177);
const BASE = `http://localhost:${PORTA}`;

const PAGINAS = ['index.html', 'app.html', 'auth.html'];
const SCRIPTS = ['app.js', 'core.js', 'auth-errors.js', 'bootstrap.js'];

const falhas = [];
const ok = [];

function checar(condicao, descricao, detalhe = '') {
  if (condicao) ok.push(descricao);
  else falhas.push(`${descricao}${detalhe ? ` — ${detalhe}` : ''}`);
}

// ── 1. Sintaxe dos scripts ──────────────────────────────────
for (const s of SCRIPTS) {
  try {
    await execFileAsync(process.execPath, ['--check', join(RAIZ, s)]);
    checar(true, `sintaxe válida: ${s}`);
  } catch (err) {
    checar(false, `sintaxe válida: ${s}`, String(err.stderr || err.message).trim());
  }
}

// ── 2. Referências locais existem em public/ ────────────────
const referencias = new Set();
for (const pagina of PAGINAS) {
  const html = await readFile(join(RAIZ, pagina), 'utf8');
  for (const m of html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)) {
    const url = m[1];
    if (/^(https?:)?\/\//.test(url) || url.startsWith('#') || url.startsWith('data:')) continue;
    referencias.add(url);
  }
}

for (const ref of [...referencias].sort()) {
  try {
    await access(join(RAIZ, ref));
    checar(true, `referência resolvida: ${ref}`);
  } catch {
    checar(false, `referência resolvida: ${ref}`, 'arquivo ausente em public/');
  }
}

// ── 3. HTTP: status, Content-Type e corpo idêntico ao disco ─
const ESPERADO = {
  '/': ['index.html', 'text/html'],
  '/index.html': ['index.html', 'text/html'],
  '/app.html': ['app.html', 'text/html'],
  '/auth.html': ['auth.html', 'text/html'],
  '/app': ['app.html', 'text/html'],
  '/auth': ['auth.html', 'text/html'],
  '/style.css': ['style.css', 'text/css'],
  '/app.js': ['app.js', 'text/javascript'],
  '/core.js': ['core.js', 'text/javascript'],
  '/auth-errors.js': ['auth-errors.js', 'text/javascript'],
  '/bootstrap.js': ['bootstrap.js', 'text/javascript'],
};

for (const [rota, [arquivo, tipo]] of Object.entries(ESPERADO)) {
  try {
    const res = await fetch(BASE + rota);
    const corpo = await res.text();
    const disco = await readFile(join(RAIZ, arquivo), 'utf8');
    const ct = res.headers.get('content-type') || '';

    checar(res.status === 200, `HTTP 200 em ${rota}`, `status ${res.status}`);
    checar(ct.includes(tipo), `Content-Type de ${rota}`, `recebido "${ct}"`);
    checar(corpo === disco, `corpo de ${rota} === public/${arquivo}`,
      `servido ${corpo.length}b, disco ${disco.length}b`);
  } catch (err) {
    checar(false, `requisição a ${rota}`, err.message);
  }
}

// ── Relatório ───────────────────────────────────────────────
console.log(`${ok.length} checagens OK`);
if (falhas.length) {
  console.error(`\n${falhas.length} FALHA(S):`);
  for (const f of falhas) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('Front-end íntegro: scripts válidos, nenhuma referência quebrada.');
