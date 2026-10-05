import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROVIDERS_DIR = path.join(ROOT, 'public', 'assets', 'providers');
const MANIFEST_JSON = path.join(PROVIDERS_DIR, 'manifest.json');
const MANIFEST_JS = path.join(PROVIDERS_DIR, 'manifest.js');
const APP_JS = path.join(ROOT, 'public', 'app.js');
const APP_HTML = path.join(ROOT, 'public', 'app.html');

describe('manifest.js — módulo local de ícones (regressão: CSP connect-src none)', () => {
  it('public/assets/providers/manifest.js existe', () => {
    expect(existsSync(MANIFEST_JS)).toBe(true);
  });

  it('expõe entries e byId que coincidem com o JSON (fonte da verdade)', () => {
    const json = JSON.parse(readFileSync(MANIFEST_JSON, 'utf8'));
    const mod = require(MANIFEST_JS);
    expect(Array.isArray(mod.entries)).toBe(true);
    expect(mod.entries).toEqual(json);

    // byId deve ser um índice coerente providerId -> entry.
    expect(mod.byId).toBeTypeOf('object');
    expect(mod.byId).not.toBeNull();
    const expectedById = {};
    for (const entry of json) expectedById[entry.providerId] = entry;
    expect(mod.byId).toEqual(expectedById);
  });

  it('expõe PlannerProviderIcons no global ao ser carregado', () => {
    require(MANIFEST_JS);
    expect(globalThis.PlannerProviderIcons).toBeTypeOf('object');
    expect(Array.isArray(globalThis.PlannerProviderIcons.entries)).toBe(true);
  });

  it('sanidade: byId.airbnb.file === "airbnb.png" (quando o airbnb está presente)', () => {
    const mod = require(MANIFEST_JS);
    if (mod.byId.airbnb) {
      expect(mod.byId.airbnb.file).toBe('airbnb.png');
    }
  });

  it('app.js NÃO faz fetch do manifesto (consumido do global, não da rede)', () => {
    const appSource = readFileSync(APP_JS, 'utf8');
    expect(/fetch\(\s*['"]assets\/providers/.test(appSource)).toBe(false);
    expect(appSource.includes("fetch('assets/providers")).toBe(false);
    expect(appSource.includes('fetch("assets/providers')).toBe(false);
    // Nenhum fetch do manifest.json de qualquer forma.
    expect(/fetch\([^)]*manifest\.json/.test(appSource)).toBe(false);
    // Lê do global exposto pelo módulo local.
    expect(appSource.includes('globalThis.PlannerProviderIcons')).toBe(true);
  });

  it('app.html carrega assets/providers/manifest.js via <script src=...>', () => {
    const html = readFileSync(APP_HTML, 'utf8');
    expect(/<script\s+src=["']assets\/providers\/manifest\.js["']><\/script>/.test(html)).toBe(true);
    // Deve vir antes de app.js para que o global esteja disponível no boot.
    const idxManifest = html.indexOf('assets/providers/manifest.js');
    const idxApp = html.indexOf('src="app.js"');
    expect(idxManifest).toBeGreaterThanOrEqual(0);
    expect(idxApp).toBeGreaterThanOrEqual(0);
    expect(idxManifest).toBeLessThan(idxApp);
  });

  it('o CSP de app.html mantém connect-src none (requisito de segurança)', () => {
    const html = readFileSync(APP_HTML, 'utf8');
    expect(html.includes("connect-src 'none'")).toBe(true);
  });
});
