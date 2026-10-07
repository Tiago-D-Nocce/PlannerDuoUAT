/* TASK 12.2 — Gate dos tokens visuais (etapa 3).
 *
 * Lê public/style.css do disco (sem navegador) e verifica, por regex tolerante a
 * formatação, que a identidade visual é 100% local, acessível e com os tokens de
 * design.md §7.14.1 definidos. Não valida contraste computado (isso é 14.3), e sim
 * a presença dos tokens, a ausência de recursos externos e o piso tipográfico.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, '..', '..', 'public', 'style.css');
const css = readFileSync(cssPath, 'utf8');

describe('tokens.css — recursos 100% locais', () => {
  it('não usa @import', () => {
    expect(/@import\b/i.test(css)).toBe(false);
  });

  it('não referencia url(http...) (nenhum recurso remoto)', () => {
    expect(/url\(\s*['"]?https?:/i.test(css)).toBe(false);
  });

  it('não aponta para CDNs de fontes/assets (googleapis, gstatic, cdn, fonts.)', () => {
    expect(/googleapis/i.test(css)).toBe(false);
    expect(/gstatic/i.test(css)).toBe(false);
    expect(/\bcdn\b/i.test(css)).toBe(false);
    expect(/\bfonts\.[a-z]/i.test(css)).toBe(false);
  });

  it('não declara @font-face remoto', () => {
    // @font-face só seria aceitável com src local; aqui o design não usa nenhum.
    const remoteFontFace = /@font-face[^}]*url\(\s*['"]?https?:/i.test(css);
    expect(remoteFontFace).toBe(false);
  });
});

describe('tokens.css — piso tipográfico (nada abaixo de 13px)', () => {
  const BASE_PX = 16;
  const MIN_PX = 13;
  // tolerância de arredondamento: aceita >= 12.9px, mas o design visa >= 13px.
  const FLOOR_PX = 12.9;

  function collectFontSizes(source) {
    const findings = [];
    const re = /font-size:\s*([^;}]+)[;}]/gi;
    let m;
    while ((m = re.exec(source)) !== null) {
      const raw = m[1].trim();
      // clamp()/calc()/var()/vw: não resolvem para um px fixo pequeno — ignorados.
      if (/clamp\(|calc\(|var\(|vw|vh|%/.test(raw)) continue;
      const pxMatch = raw.match(/^(-?\d*\.?\d+)px$/i);
      if (pxMatch) {
        findings.push({ raw, px: parseFloat(pxMatch[1]) });
        continue;
      }
      const remMatch = raw.match(/^(-?\d*\.?\d+)rem$/i);
      if (remMatch) {
        findings.push({ raw, px: parseFloat(remMatch[1]) * BASE_PX });
        continue;
      }
      const emMatch = raw.match(/^(-?\d*\.?\d+)em$/i);
      if (emMatch) {
        findings.push({ raw, px: parseFloat(emMatch[1]) * BASE_PX });
      }
    }
    return findings;
  }

  it('encontra declarações de font-size para auditar', () => {
    expect(collectFontSizes(css).length).toBeGreaterThan(10);
  });

  it('nenhum font-size resolve abaixo do piso (>= 12.9px; alvo >= 13px)', () => {
    const tooSmall = collectFontSizes(css).filter((f) => f.px < FLOOR_PX);
    expect(tooSmall).toEqual([]);
  });

  it('o menor font-size fixo é >= 13px', () => {
    const sizes = collectFontSizes(css).map((f) => f.px);
    const min = Math.min(...sizes);
    expect(min).toBeGreaterThanOrEqual(MIN_PX - 0.1); // 12.9 por arredondamento
  });
});

describe('tokens.css — paleta de design (§7.14.1)', () => {
  // os tokens escuros vivem em :root (padrão) ou em [data-theme="dark"].
  function darkScope() {
    const rootMatch = css.match(/:root\s*\{[\s\S]*?\}/i);
    const darkMatch = css.match(/\[data-theme=["']dark["']\]\s*\{[\s\S]*?\}/i);
    return (rootMatch ? rootMatch[0] : '') + '\n' + (darkMatch ? darkMatch[0] : '');
  }

  it('define o gradiente de destaque índigo #3a5bd0 -> ciano #27c0d4', () => {
    const scope = darkScope();
    expect(/#3a5bd0/i.test(scope)).toBe(true);
    expect(/#27c0d4/i.test(scope)).toBe(true);
    // o gradiente aparece como linear-gradient com as duas pontas.
    expect(/linear-gradient\([^)]*#3a5bd0[^)]*#27c0d4/i.test(css)).toBe(true);
  });

  it('define o fundo profundo #070a12', () => {
    expect(/#070a12/i.test(darkScope())).toBe(true);
  });

  it('define a cor de foco ciano #27c0d4', () => {
    // #27c0d4 é o ciano usado tanto no destaque quanto no anel de foco.
    expect(/#27c0d4/i.test(darkScope())).toBe(true);
    // existe um token/anel de foco no CSS.
    expect(/focus-ring|:focus-visible/i.test(css)).toBe(true);
  });

  it('define a paleta de referência do design (índigo, ciano, laranja, vermelho)', () => {
    const root = css.match(/:root\s*\{[\s\S]*?\}/i)?.[0] || '';
    expect(/#1e3a8a/i.test(root)).toBe(true); // índigo
    expect(/#27c0d4/i.test(root)).toBe(true); // ciano
    expect(/#f28a1e/i.test(root)).toBe(true); // laranja
    expect(/#f23c13/i.test(root)).toBe(true); // vermelho
  });
});

describe('tokens.css — motion reduzido e fallback de backdrop', () => {
  it('tem bloco @media (prefers-reduced-motion: reduce)', () => {
    expect(/@media[^{]*prefers-reduced-motion:\s*reduce/i.test(css)).toBe(true);
  });

  it('tem fallback @supports not (backdrop-filter ...)', () => {
    expect(/@supports\s+not\s*\(\s*[\s\S]*?backdrop-filter/i.test(css)).toBe(true);
  });
});
