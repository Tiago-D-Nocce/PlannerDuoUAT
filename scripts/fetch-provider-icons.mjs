// PlannerDuo — DEV-ONLY: baixa os ícones reais de marca de cada provedor de viagem.
//
// Executar MANUALMENTE em desenvolvimento: `node scripts/fetch-provider-icons.mjs`.
// NUNCA é importado pelo runtime nem pelos testes. Usa SOMENTE módulos nativos do
// Node (node:https, node:fs, node:crypto, node:path) e o `fetch` global.
//
// Para cada um dos 26 providerId:
//  1. deriva o host oficial a partir do hostname da URL de PlannerTravel.build(id)
//     (precisa estar em allowedHosts — asserção; caso contrário pula e reporta);
//  2. tenta, por HTTPS, com até 3 redirects no MESMO host e timeout ~8s por request:
//       apple-touch-icon -> maior <link rel="icon"> -> /favicon.ico
//       e, só se tudo falhar, o serviço de favicons do Google (google-s2);
//  3. valida por magic bytes (PNG/WEBP/JPEG/ICO/SVG passivo), 1 B..256 KiB,
//     dimensão mínima >=16px e <=512px quando legível;
//  4. grava exatamente um arquivo por providerId em
//       public/assets/providers/<id>.<ext>
//     e um public/assets/providers/manifest.json.
//
// Idempotente: reexecutar sobrescreve os arquivos e o manifesto.

import { createRequire } from 'node:module';
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const PlannerTravel = require('../public/travel.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'providers');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');
const MANIFEST_JS = path.join(OUT_DIR, 'manifest.js');

const REQUEST_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MIN_BYTES = 1;
const MAX_BYTES = 256 * 1024; // 256 KiB
const MIN_DIM = 16;
const MAX_DIM = 512;

const USER_AGENT =
  'Mozilla/5.0 (PlannerDuo dev icon fetcher; local use only) AppleWebKit/537.36';

const allowedHosts = new Set(PlannerTravel.allowedHosts);
const providerIds = PlannerTravel.providerIds;

// Inputs progressivos para obter uma URL oficial de build() por provedor.
const BUILD_PROBES = [
  {},
  { destination: 'Paris' },
  { origin: 'GRU', destination: 'GIG', departure: '2030-01-10', returnDate: '2030-01-20', passengers: 1 },
  { origin: 'Sao Paulo', destination: 'Rio de Janeiro', departure: '2030-01-10', returnDate: '2030-01-20', passengers: 1 },
];

function officialHostFor(providerId) {
  for (const probe of BUILD_PROBES) {
    try {
      const built = PlannerTravel.build(providerId, probe);
      return new URL(built.url).hostname.toLowerCase();
    } catch {
      // tenta o próximo probe
    }
  }
  return null;
}

// --- HTTP helpers (fetch global, HTTPS, redirects limitados ao mesmo host) ---

async function httpGet(targetUrl, { accept } = {}) {
  let current = new URL(targetUrl);
  if (current.protocol !== 'https:') throw new Error(`protocolo não-HTTPS: ${current.protocol}`);
  const startHost = current.hostname.toLowerCase();

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: accept || '*/*',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`redirect ${response.status} sem Location`);
      const next = new URL(location, current);
      if (next.protocol !== 'https:') throw new Error('redirect para não-HTTPS recusado');
      if (next.hostname.toLowerCase() !== startHost) {
        throw new Error(`redirect para host diferente recusado: ${next.hostname}`);
      }
      if (redirects === MAX_REDIRECTS) throw new Error('excesso de redirects');
      current = next;
      continue;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { url: current.href, response };
  }
  throw new Error('excesso de redirects');
}

async function fetchText(targetUrl) {
  const { url, response } = await httpGet(targetUrl, { accept: 'text/html,*/*' });
  const text = await response.text();
  return { url, text };
}

async function fetchBytes(targetUrl, accept) {
  const { url, response } = await httpGet(targetUrl, { accept });
  const buffer = Buffer.from(await response.arrayBuffer());
  const mediaType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  return { url, buffer, mediaType };
}

// O serviço S2 do Google (www.google.com) redireciona para a CDN de favicons
// (t*.gstatic.com). Esse salto é o comportamento documentado do próprio serviço,
// então para o fallback google-s2 permitimos redirects dentro da família
// google.com/gstatic.com (nunca para o host da marca nem para terceiros).
function isGoogleFamily(hostname) {
  const h = hostname.toLowerCase();
  return h === 'www.google.com' || h === 'google.com' || h.endsWith('.gstatic.com') || h.endsWith('.google.com');
}
async function fetchGoogleS2Bytes(targetUrl, accept) {
  let current = new URL(targetUrl);
  if (current.protocol !== 'https:') throw new Error('S2 não-HTTPS');
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: accept || 'image/*,*/*' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('redirect S2 sem Location');
      const next = new URL(location, current);
      if (next.protocol !== 'https:') throw new Error('redirect S2 para não-HTTPS recusado');
      if (!isGoogleFamily(next.hostname)) throw new Error(`redirect S2 para host não-Google recusado: ${next.hostname}`);
      if (redirects === MAX_REDIRECTS) throw new Error('excesso de redirects S2');
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return { url: current.href, buffer };
  }
  throw new Error('excesso de redirects S2');
}

// --- Descoberta de candidatos a partir do HTML da home ------------------------

function parseIconLinks(html) {
  const links = [];
  const linkTagRe = /<link\b[^>]*>/gi;
  let match;
  while ((match = linkTagRe.exec(html)) !== null) {
    const tag = match[0];
    const relMatch = tag.match(/\brel\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const hrefMatch = tag.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!relMatch || !hrefMatch) continue;
    const rel = (relMatch[2] ?? relMatch[3] ?? relMatch[4] ?? '').toLowerCase();
    const href = (hrefMatch[2] ?? hrefMatch[3] ?? hrefMatch[4] ?? '').trim();
    if (!href) continue;
    const sizesMatch = tag.match(/\bsizes\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const sizes = sizesMatch ? (sizesMatch[2] ?? sizesMatch[3] ?? sizesMatch[4] ?? '') : '';
    const area = sizes
      .toLowerCase()
      .split(/\s+/)
      .map((token) => {
        const dim = token.match(/^(\d+)x(\d+)$/);
        return dim ? Number(dim[1]) * Number(dim[2]) : 0;
      })
      .reduce((max, value) => Math.max(max, value), 0);
    links.push({ rel, href, area });
  }
  return links;
}

function resolveHref(baseUrl, href) {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

// --- Validação por magic bytes -----------------------------------------------

function detectRaster(buffer) {
  // PNG
  if (buffer.length >= 24 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    // IHDR em offset 16 (width), 20 (height), big-endian
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { mediaType: 'image/png', ext: 'png', width, height };
  }
  // GIF (algumas marcas usam) — tratado como raster genérico via header
  // WEBP: "RIFF"...."WEBP"
  if (buffer.length >= 30 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    const dims = webpDimensions(buffer);
    return { mediaType: 'image/webp', ext: 'webp', width: dims.width, height: dims.height };
  }
  // JPEG
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9) {
    const dims = jpegDimensions(buffer);
    return { mediaType: 'image/jpeg', ext: 'jpg', width: dims.width, height: dims.height };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    const dims = jpegDimensions(buffer);
    return { mediaType: 'image/jpeg', ext: 'jpg', width: dims.width, height: dims.height };
  }
  // ICO: 00 00 01 00
  if (buffer.length >= 6 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) {
    const count = buffer.readUInt16LE(4);
    let width = 0;
    let height = 0;
    for (let i = 0; i < count; i += 1) {
      const entry = 6 + i * 16;
      if (entry + 2 > buffer.length) break;
      const w = buffer[entry] === 0 ? 256 : buffer[entry];
      const h = buffer[entry + 1] === 0 ? 256 : buffer[entry + 1];
      if (w * h > width * height) {
        width = w;
        height = h;
      }
    }
    return { mediaType: 'image/x-icon', ext: 'ico', width, height };
  }
  return null;
}

function webpDimensions(buffer) {
  try {
    const format = buffer.slice(12, 16).toString('ascii');
    if (format === 'VP8 ') {
      // lossy
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }
    if (format === 'VP8L') {
      const b = buffer.readUInt32LE(21);
      const width = (b & 0x3fff) + 1;
      const height = ((b >> 14) & 0x3fff) + 1;
      return { width, height };
    }
    if (format === 'VP8X') {
      const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
      const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
      return { width, height };
    }
  } catch {
    // ignora
  }
  return { width: undefined, height: undefined };
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // SOF0..SOF15 (exceto DHT/DAC/RST)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    offset += 2 + length;
  }
  return { width: undefined, height: undefined };
}

function isPassiveSvg(buffer) {
  const text = buffer.toString('utf8');
  if (!/<svg[\s>]/i.test(text)) return { ok: false };
  const hostile = [
    /<script/i,
    /\son[a-z]+\s*=/i, // on*=
    /<foreignObject/i,
    /@import/i,
    /<!ENTITY/i,
    /<!DOCTYPE[^>]*\[/i, // DTD interno (entidades externas)
  ];
  for (const pattern of hostile) {
    if (pattern.test(text)) return { ok: false, reason: `SVG com padrão proibido: ${pattern}` };
  }
  // href/url() externos: só permitido se começarem com '#'
  const hrefRe = /\b(?:xlink:href|href)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = hrefRe.exec(text)) !== null) {
    const value = (m[2] ?? m[3] ?? '').trim();
    if (value && !value.startsWith('#')) return { ok: false, reason: `SVG com href externo: ${value}` };
  }
  const urlRe = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;
  while ((m = urlRe.exec(text)) !== null) {
    const value = (m[2] ?? '').trim();
    if (value && !value.startsWith('#')) return { ok: false, reason: `SVG com url() externo: ${value}` };
  }
  return { ok: true, mediaType: 'image/svg+xml', ext: 'svg' };
}

function validateAsset(buffer) {
  if (buffer.length < MIN_BYTES || buffer.length > MAX_BYTES) {
    return { ok: false, reason: `tamanho fora do intervalo (${buffer.length} bytes)` };
  }
  const raster = detectRaster(buffer);
  if (raster) {
    const { width, height } = raster;
    if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
      const minDim = Math.min(width, height);
      const maxDim = Math.max(width, height);
      if (minDim < MIN_DIM) return { ok: false, reason: `dimensão mínima ${minDim}px < ${MIN_DIM}px` };
      if (maxDim > MAX_DIM) return { ok: false, reason: `dimensão máxima ${maxDim}px > ${MAX_DIM}px` };
    }
    return { ok: true, ...raster };
  }
  const svg = isPassiveSvg(buffer);
  if (svg.ok) return svg;
  return { ok: false, reason: svg.reason || 'tipo não reconhecido por magic bytes' };
}

// --- Pipeline de aquisição por provedor --------------------------------------

const SOURCE_ORDER = ['apple-touch-icon', 'icon', 'favicon', 'google-s2'];

async function discoverCandidates(host) {
  // Retorna lista ordenada { source, url }
  const base = `https://${host}/`;
  const candidates = [];
  let html = '';
  try {
    const page = await fetchText(base);
    html = page.text;
    const links = parseIconLinks(html);

    const appleLinks = links
      .filter((link) => /apple-touch-icon/.test(link.rel))
      .sort((a, b) => b.area - a.area);
    for (const link of appleLinks) {
      const resolved = resolveHref(page.url, link.href);
      if (resolved) candidates.push({ source: 'apple-touch-icon', url: resolved });
    }

    const iconLinks = links
      .filter((link) => /(^|\s)icon(\s|$)|shortcut/.test(link.rel) && !/apple-touch-icon/.test(link.rel))
      .sort((a, b) => b.area - a.area);
    for (const link of iconLinks) {
      const resolved = resolveHref(page.url, link.href);
      if (resolved) candidates.push({ source: 'icon', url: resolved });
    }
  } catch (error) {
    // sem HTML: segue para favicon/google
    process.stderr.write(`    (home indisponível: ${error.message})\n`);
  }

  candidates.push({ source: 'favicon', url: `https://${host}/favicon.ico` });
  return candidates;
}

async function acquireForProvider(providerId) {
  const host = officialHostFor(providerId);
  if (!host) return { providerId, ok: false, reason: 'não foi possível derivar URL de build()' };
  if (!allowedHosts.has(host)) {
    return { providerId, ok: false, host, reason: `host fora de allowedHosts: ${host}` };
  }

  const attempts = await discoverCandidates(host);
  // mantém ordem de prioridade por source
  attempts.sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source));

  const failures = [];
  for (const attempt of attempts) {
    try {
      const asset = await fetchBytes(attempt.url, 'image/*,*/*');
      const validation = validateAsset(asset.buffer);
      if (!validation.ok) {
        failures.push(`${attempt.source} ${attempt.url} -> ${validation.reason}`);
        continue;
      }
      return {
        providerId,
        ok: true,
        host,
        source: attempt.source,
        sourceUrl: asset.url,
        buffer: asset.buffer,
        validation,
      };
    } catch (error) {
      failures.push(`${attempt.source} ${attempt.url} -> ${error.message}`);
    }
  }

  // último recurso: Google favicons para o mesmo host
  const googleUrl = `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`;
  try {
    const asset = await fetchGoogleS2Bytes(googleUrl, 'image/*,*/*');
    const validation = validateAsset(asset.buffer);
    if (validation.ok) {
      return {
        providerId,
        ok: true,
        host,
        source: 'google-s2',
        sourceUrl: asset.url,
        buffer: asset.buffer,
        validation,
      };
    }
    failures.push(`google-s2 ${googleUrl} -> ${validation.reason}`);
  } catch (error) {
    failures.push(`google-s2 ${googleUrl} -> ${error.message}`);
  }

  return { providerId, ok: false, host, reason: failures.join(' | ') || 'nenhuma fonte válida' };
}

async function cleanStaleAssets(keepFiles) {
  let existing = [];
  try {
    existing = await readdir(OUT_DIR);
  } catch {
    return;
  }
  for (const file of existing) {
    if (file === 'manifest.json') continue;
    if (!keepFiles.has(file)) {
      await rm(path.join(OUT_DIR, file), { force: true });
    }
  }
}

// Gera o módulo UMD local manifest.js a partir das entradas do manifesto.
// Mantém manifest.js em sincronia com manifest.json (fonte da verdade) para que
// o runtime consuma os ícones via <script src> (script-src 'self') sem fetch,
// respeitando o CSP connect-src 'none'.
function buildManifestModuleSource(list) {
  const byId = {};
  for (const entry of list) {
    if (entry && typeof entry.providerId === 'string') byId[entry.providerId] = entry;
  }
  const payload = JSON.stringify({ entries: list, byId }, null, 2);
  return (
    "/* PlannerDuo — manifesto local de ícones de provedores (GERADO).\n" +
    " * Fonte da verdade: manifest.json. Gerado por scripts/fetch-provider-icons.mjs.\n" +
    " * Exposto como módulo local (script-src 'self') para não violar connect-src 'none'. */\n" +
    "(function (root, factory) {\n" +
    "  'use strict';\n" +
    "  const api = factory();\n" +
    "  if (typeof module !== 'undefined' && module.exports) module.exports = api;\n" +
    "  if (root && typeof root === 'object') root.PlannerProviderIcons = api;\n" +
    "})(typeof globalThis !== 'undefined' ? globalThis : this, function () {\n" +
    "  'use strict';\n" +
    "  return " + payload + ";\n" +
    "});\n"
  );
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`PlannerDuo — baixando ícones de ${providerIds.length} provedores para ${path.relative(ROOT, OUT_DIR)}\n`);

  const manifest = [];
  const okList = [];
  const failList = [];
  const writtenFiles = new Set(['manifest.json']);

  for (const providerId of providerIds) {
    process.stdout.write(`• ${providerId} ... `);
    const result = await acquireForProvider(providerId);
    if (!result.ok) {
      console.log(`FALHOU (${result.reason})`);
      failList.push({ providerId, reason: result.reason });
      continue;
    }

    const { validation, buffer } = result;
    const fileName = `${providerId}.${validation.ext}`;
    const filePath = path.join(OUT_DIR, fileName);
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    await writeFile(filePath, buffer);
    writtenFiles.add(fileName);

    const entry = {
      providerId,
      file: fileName,
      host: result.host,
      source: result.source,
      sourceUrl: result.sourceUrl,
      fetchedAt: new Date().toISOString(),
      mediaType: validation.mediaType,
      bytes: buffer.length,
      sha256,
    };
    if (typeof validation.width === 'number' && validation.width > 0) entry.width = validation.width;
    if (typeof validation.height === 'number' && validation.height > 0) entry.height = validation.height;

    manifest.push(entry);
    okList.push(entry);
    console.log(`OK via ${result.source} (${validation.mediaType}, ${buffer.length}B${entry.width ? `, ${entry.width}x${entry.height}` : ''})`);
  }

  // Remove assets de execuções anteriores que não têm entry agora.
  await cleanStaleAssets(writtenFiles);

  manifest.sort((a, b) => a.providerId.localeCompare(b.providerId));
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(MANIFEST_JS, buildManifestModuleSource(manifest));

  console.log('\n────────── RESUMO ──────────');
  console.log(`${okList.length}/${providerIds.length} ícones baixados.`);
  if (okList.length) {
    console.log('\nFontes:');
    for (const entry of okList) console.log(`  ${entry.providerId.padEnd(18)} ${entry.source}  (${entry.host})`);
  }
  if (failList.length) {
    console.log(`\n${failList.length} falha(s):`);
    for (const fail of failList) console.log(`  ✗ ${fail.providerId}: ${fail.reason}`);
  }
  console.log(`\nManifesto: ${path.relative(ROOT, MANIFEST)}`);
  console.log(`Módulo local: ${path.relative(ROOT, MANIFEST_JS)}`);
}

main().catch((error) => {
  console.error('Erro fatal no fetch de ícones:', error);
  process.exitCode = 1;
});
