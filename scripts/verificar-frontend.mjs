// Verificação autocontida do frontend local.
import { access, readFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const portArgument = process.argv.indexOf('--port');
const PORT = Number(portArgument !== -1 ? process.argv[portArgument + 1] : 5177);
const BASE = `http://localhost:${PORT}`;
const PAGES = ['index.html', 'app.html', 'auth.html'];
const SCRIPTS = ['core.js', 'local.js', 'travel.js', 'auth.js', 'app.js'];
const failures = [];
const successes = [];

function check(condition, description, detail) {
  if (condition) successes.push(description);
  else failures.push(`${description}${detail ? ` — ${detail}` : ''}`);
}

for (const script of SCRIPTS) {
  try {
    await execFileAsync(process.execPath, ['--check', join(PUBLIC, script)]);
    check(true, `sintaxe válida: ${script}`);
  } catch (error) {
    check(false, `sintaxe válida: ${script}`, String(error.stderr || error.message).trim());
  }
}

const references = new Set();
let publicSource = '';
for (const page of PAGES) {
  const html = await readFile(join(PUBLIC, page), 'utf8');
  publicSource += `\n${html}`;
  for (const match of html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)) {
    const url = match[1];
    if (url.startsWith('#') || url.startsWith('data:')) continue;
    if (/^(https?:)?\/\//i.test(url)) {
      check(false, `recurso local em ${page}`, `URL externa: ${url}`);
      continue;
    }
    references.add(url.split(/[?#]/)[0]);
  }
}
for (const script of SCRIPTS) publicSource += `\n${await readFile(join(PUBLIC, script), 'utf8')}`;
publicSource += `\n${await readFile(join(PUBLIC, 'style.css'), 'utf8')}`;

for (const reference of [...references].filter(Boolean).sort()) {
  try {
    await access(join(PUBLIC, reference));
    check(true, `referência resolvida: ${reference}`);
  } catch (_) {
    check(false, `referência resolvida: ${reference}`, 'arquivo ausente');
  }
}

const forbiddenRuntimePatterns = [
  ['serviço remoto antigo', /firebase|firestore|gstatic/i],
  ['CDN', /cdnjs|jsdelivr|unpkg/i],
  ['perfil fixo', /Pessoa\s*[12]/i],
];
for (const [name, pattern] of forbiddenRuntimePatterns) {
  check(!pattern.test(publicSource), `ausência de ${name} no runtime`);
}
check(/plannerduo:vault:v1/.test(publicSource), 'cofre local versionado presente');
check(/PBKDF2/.test(publicSource) && /SHA-256/.test(publicSource), 'derivação forte de senha presente');
check(/AES-GCM/.test(publicSource), 'criptografia autenticada presente');
check(/id="unlock-form"/.test(publicSource) && /type="password"/.test(publicSource), 'tela de login presente');
check(/Repository\.auth\.restoreSession/.test(publicSource), 'guarda de sessão do painel presente');
check(/data-view-panel="decisions"/.test(publicSource), 'módulo de decisões presente');
check(/data-view-panel="settings"/.test(publicSource), 'gestão de participantes presente');
check(/id="travel-search-form"/.test(publicSource), 'motor de busca de viagens presente');
check(/allowedHosts\.has/.test(publicSource), 'allowlist de provedores de viagem presente');
check(/providerIds/.test(publicSource) && /iconSvg/.test(publicSource), 'registry e ícones locais de viagem presentes');
check(/noopener noreferrer/.test(publicSource), 'navegação externa isolada do aplicativo');
check(/script-src 'self'/.test(publicSource), 'CSP restringe scripts a assets locais');
check(/connect-src 'none'/.test(publicSource), 'CSP bloqueia conexões de dados em segundo plano');

let server;
try {
  server = spawn(process.execPath, [join(ROOT, 'scripts', 'dev-server.mjs'), '--port', String(PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error('tempo esgotado ao iniciar servidor')), 5000);
    const onData = (chunk) => {
      if (String(chunk).includes('PlannerDuo rodando')) {
        clearTimeout(timeout);
        resolveReady();
      }
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', (chunk) => {
      const message = String(chunk).trim();
      if (message) {
        clearTimeout(timeout);
        rejectReady(new Error(message));
      }
    });
    server.once('exit', (code) => {
      if (code != null && code !== 0) {
        clearTimeout(timeout);
        rejectReady(new Error(`servidor encerrou com código ${code}`));
      }
    });
  });

  const expected = {
    '/': ['index.html', 'text/html'],
    '/app': ['app.html', 'text/html'],
    '/auth': ['auth.html', 'text/html'],
    '/style.css': ['style.css', 'text/css'],
    '/core.js': ['core.js', 'text/javascript'],
    '/local.js': ['local.js', 'text/javascript'],
    '/travel.js': ['travel.js', 'text/javascript'],
    '/auth.js': ['auth.js', 'text/javascript'],
    '/app.js': ['app.js', 'text/javascript'],
  };
  for (const [route, [filename, contentType]] of Object.entries(expected)) {
    try {
      const response = await fetch(BASE + route);
      const body = await response.text();
      const disk = await readFile(join(PUBLIC, filename), 'utf8');
      check(response.status === 200, `HTTP 200 em ${route}`, `status ${response.status}`);
      check((response.headers.get('content-type') || '').includes(contentType), `Content-Type de ${route}`);
      check(body === disk, `conteúdo íntegro em ${route}`);
      if (route === '/auth') {
        check(response.headers.get('x-frame-options') === 'DENY', 'login não pode ser enquadrado');
        check((response.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'CSP HTTP bloqueia frame ancestors');
      }
    } catch (error) {
      check(false, `smoke HTTP em ${route}`, error.message);
    }
  }
} catch (error) {
  check(false, 'servidor temporário iniciou', error.message);
} finally {
  if (server && !server.killed) server.kill();
}

console.log(`${successes.length} checagens OK`);
if (failures.length) {
  console.error(`\n${failures.length} FALHA(S):`);
  failures.forEach((failure) => console.error(`  ✗ ${failure}`));
  process.exitCode = 1;
} else {
  console.log('Frontend local íntegro e sem dependências externas.');
}
