/* TASK 9.1 — Verificação de invariância do refinamento visual.
 *
 * Lê public/style.css do disco (sem navegador) e compara com o baseline
 * CONGELADO em tests/ui/_baseline-snapshot.json (capturado ANTES de qualquer
 * edição de refinamento). Cobre as propriedades de corretude P1, P2, P3 e P7
 * de design.md.
 *
 * Importante: o baseline NÃO é recapturado do arquivo vivo aqui — ele é lido do
 * snapshot JSON congelado, para que as asserções de invariância sejam reais e
 * não auto-referentes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  readStyleCss,
  captureColorTokens,
  captureColorLiterals,
  captureLayoutGeometry,
} from './_baseline-style.js';

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(here, '_baseline-snapshot.json');
const BASELINE = JSON.parse(readFileSync(snapshotPath, 'utf8'));

const css = readStyleCss();

describe('visual-refinement — P1: invariância da paleta (tokens de cor em :root)', () => {
  it('o mapa nome→valor dos tokens de cor é idêntico ao baseline', () => {
    const now = captureColorTokens(css);
    expect(now).toEqual(BASELINE.colorTokens);
  });

  it('nenhum token de cor do baseline foi removido', () => {
    const now = captureColorTokens(css);
    for (const name of Object.keys(BASELINE.colorTokens)) {
      expect(now, `token ausente: ${name}`).toHaveProperty(name);
    }
  });
});

describe('visual-refinement — P2: nenhuma cor nova introduzida', () => {
  it('o conjunto de literais de cor é subconjunto do baseline', () => {
    const base = new Set(BASELINE.colorLiteralList);
    const now = [...captureColorLiterals(css)];
    const introduced = now.filter((lit) => !base.has(lit));
    expect(introduced, `cores novas: ${JSON.stringify(introduced)}`).toEqual([]);
  });
});

describe('visual-refinement — P3: invariância da geometria de layout', () => {
  const geo = captureLayoutGeometry(css);

  it('--sidebar-width continua 280px', () => {
    expect(geo.sidebarWidth).toBe('280px');
    expect(geo.sidebarWidth).toBe(BASELINE.layout.sidebarWidth);
  });

  it('.app-shell mantém display: flex', () => {
    expect(geo.appShellDisplay).toBe('flex');
  });

  it('.app-main mantém margin-left: var(--sidebar-width)', () => {
    expect(geo.appMainMarginLeft).toBe('var(--sidebar-width)');
  });

  it('main mantém max-width: 1280px', () => {
    expect(geo.mainMaxWidth).toBe('1280px');
  });

  it('os dois breakpoints (900px e 600px) continuam presentes', () => {
    expect(geo.has900Breakpoint).toBe(true);
    expect(geo.has600Breakpoint).toBe(true);
  });

  it('cada grid-template-columns mantém a mesma contagem de tracks', () => {
    const baseTracks = BASELINE.layout.gridTemplates.map((g) => `${g.selector}=>${g.tracks}`);
    const nowTracks = geo.gridTemplates.map((g) => `${g.selector}=>${g.tracks}`);
    expect(nowTracks).toEqual(baseTracks);
  });
});

describe('visual-refinement — P7: tokens de escala presentes e referenciados', () => {
  const rootMatch = css.match(/:root\s*\{[\s\S]*?\}/i);
  const root = rootMatch ? rootMatch[0] : '';

  it(':root define --space-1..8', () => {
    for (let i = 1; i <= 8; i += 1) {
      expect(new RegExp(`--space-${i}\\s*:`).test(root), `--space-${i} ausente`).toBe(true);
    }
  });

  it(':root define a escala tipográfica --fs-xs..3xl', () => {
    for (const step of ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl']) {
      expect(new RegExp(`--fs-${step}\\s*:`).test(root), `--fs-${step} ausente`).toBe(true);
    }
  });

  it('há uso disseminado de var(--space-*) no CSS (acima do limiar)', () => {
    const uses = (css.match(/var\(\s*--space-/g) || []).length;
    expect(uses).toBeGreaterThanOrEqual(30);
  });

  it('há uso de var(--fs-*) no CSS (acima do limiar)', () => {
    const uses = (css.match(/var\(\s*--fs-/g) || []).length;
    expect(uses).toBeGreaterThanOrEqual(10);
  });
});
