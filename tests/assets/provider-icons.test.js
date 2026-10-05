import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Travel from '../../public/travel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROVIDERS_DIR = path.join(ROOT, 'public', 'assets', 'providers');
const MANIFEST_PATH = path.join(PROVIDERS_DIR, 'manifest.json');
const APP_JS = path.join(ROOT, 'public', 'app.js');

const providerIds = new Set(Travel.providerIds);
const allowedHosts = new Set(Travel.allowedHosts);
const EXPECTED_SOURCES = new Set(['apple-touch-icon', 'icon', 'favicon', 'google-s2']);

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// Detecção de tipo real por magic bytes (espelha o validador do script de fetch).
function detectMediaType(buffer) {
  if (
    buffer.length >= 8 &&
    buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0x01 &&
    buffer[3] === 0x00
  ) {
    return 'image/x-icon';
  }
  if (/<svg[\s>]/i.test(buffer.toString('utf8'))) {
    return 'image/svg+xml';
  }
  return null;
}

const manifestExists = existsSync(MANIFEST_PATH);
const manifest = manifestExists ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : [];

describe('ícones locais dos provedores (manifest + integridade)', () => {
  it('reporta quantos provedores têm ícone local', () => {
    // Não falha com contagem < 26 (a rede pode estar bloqueada em dev); apenas registra.
    console.log(
      `[provider-icons] manifesto: ${manifestExists ? 'presente' : 'ausente'} — ${manifest.length}/${providerIds.size} ícones locais`,
    );
    expect(Array.isArray(manifest)).toBe(true);
  });

  it('o manifesto é um array de entradas (vazio é aceitável)', () => {
    expect(Array.isArray(manifest)).toBe(true);
    for (const entry of manifest) {
      expect(entry).toBeTypeOf('object');
      expect(entry).not.toBeNull();
    }
  });

  it('cada providerId é único e existe no registry de PlannerTravel', () => {
    const seen = new Set();
    for (const entry of manifest) {
      expect(typeof entry.providerId).toBe('string');
      expect(seen.has(entry.providerId)).toBe(false);
      seen.add(entry.providerId);
      expect(providerIds.has(entry.providerId)).toBe(true);
    }
  });

  it('cada host está em PlannerTravel.allowedHosts', () => {
    for (const entry of manifest) {
      expect(allowedHosts.has(entry.host)).toBe(true);
    }
  });

  it('cada source é um dos valores esperados', () => {
    for (const entry of manifest) {
      expect(EXPECTED_SOURCES.has(entry.source)).toBe(true);
    }
  });

  it('o arquivo referenciado existe no disco', () => {
    for (const entry of manifest) {
      expect(typeof entry.file).toBe('string');
      const filePath = path.join(PROVIDERS_DIR, entry.file);
      expect(existsSync(filePath)).toBe(true);
    }
  });

  it('sha256 é 64 hex minúsculos e bate com os bytes do arquivo em disco', () => {
    for (const entry of manifest) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      const bytes = readFileSync(path.join(PROVIDERS_DIR, entry.file));
      expect(sha256Hex(bytes)).toBe(entry.sha256);
    }
  });

  it('inverter um byte do arquivo muda o hash (sensibilidade do SHA-256)', () => {
    for (const entry of manifest) {
      const bytes = readFileSync(path.join(PROVIDERS_DIR, entry.file));
      expect(bytes.length).toBeGreaterThan(0);
      const flipped = Buffer.from(bytes);
      flipped[0] = flipped[0] ^ 1;
      expect(sha256Hex(flipped)).not.toBe(entry.sha256);
    }
  });

  it('mediaType do manifesto bate com os magic bytes do arquivo', () => {
    for (const entry of manifest) {
      const bytes = readFileSync(path.join(PROVIDERS_DIR, entry.file));
      const detected = detectMediaType(bytes);
      expect(detected).not.toBeNull();
      expect(entry.mediaType).toBe(detected);
    }
  });

  it('bytes está no intervalo 1..262144 e coincide com o tamanho do arquivo', () => {
    for (const entry of manifest) {
      const bytes = readFileSync(path.join(PROVIDERS_DIR, entry.file));
      expect(entry.bytes).toBe(bytes.length);
      expect(entry.bytes).toBeGreaterThanOrEqual(1);
      expect(entry.bytes).toBeLessThanOrEqual(262144);
    }
  });

  it('fetchedAt é um instante ISO válido', () => {
    for (const entry of manifest) {
      expect(typeof entry.fetchedAt).toBe('string');
      expect(Number.isNaN(Date.parse(entry.fetchedAt))).toBe(false);
    }
  });
});

describe('runtime permanece 100% local (sem referências externas em app.js)', () => {
  const appSource = readFileSync(APP_JS, 'utf8');

  it('nenhum sourceUrl do manifesto aparece como src/href em app.js', () => {
    for (const entry of manifest) {
      if (entry.sourceUrl) {
        expect(appSource.includes(entry.sourceUrl)).toBe(false);
      }
    }
  });

  it('todo src de imagem de provedor aponta para assets/providers/ (sem URL externa)', () => {
    // Coleta qualquer src="..." no app.js e garante que nenhum é http(s) externo
    // nem aponta para fora de assets/providers para os tiles de provedor.
    const imgSrcMatches = [...appSource.matchAll(/src\s*=\s*(?:"([^"]*)"|'([^']*)'|\$\{[^}]*\}([^"'`\s>]*))/g)];
    for (const match of imgSrcMatches) {
      const literal = match[1] ?? match[2];
      if (literal && /assets\/providers\//.test(literal) === false) {
        // Permite outros src não relacionados a provedores desde que não sejam externos.
        expect(/^https?:\/\//i.test(literal)).toBe(false);
      }
    }
    // A única construção de img de provedor deve referenciar assets/providers/.
    expect(/src="assets\/providers\//.test(appSource)).toBe(true);
    // Nenhuma URL externa literal embutida.
    expect(/src\s*=\s*"https?:\/\//i.test(appSource)).toBe(false);
  });

  it('app.js não usa iconSvg para o tile de imagem do provedor', () => {
    expect(/Travel\.iconSvg\(/.test(appSource)).toBe(false);
  });
});
