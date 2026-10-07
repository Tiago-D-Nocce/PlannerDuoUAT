/* TASK 1 (bugfix: frontend-layout-standardization) — Teste de EXPLORAÇÃO da condição do bug.
 *
 * Propriedade 1 (Bug Condition): "Missing / Misaligned Auth Component Styling".
 *
 * ESTE TESTE DEVE FALHAR no CSS NÃO corrigido — a falha confirma que o bug existe.
 * Ele lê public/style.css do disco (sem navegador), espelhando a abordagem de
 * parsing de tests/ui/layout-audit.test.js e tests/ui/tokens.test.js, e afirma
 * que, para TODOS os seletores que satisfazem isBugCondition (ver design.md
 * > Bug Details > Bug Condition), existe um bloco de regra PADRONIZADO.
 *
 * Como no código não corrigido esses seletores não têm regra alguma (ou têm
 * regra incompleta no breakpoint de 600px), as asserções abaixo codificam o
 * COMPORTAMENTO ESPERADO e vão falhar. Isso é o caso de SUCESSO para um teste
 * de exploração: ele prova que os componentes caem nos defaults do navegador.
 *
 * Após o fix (tarefa 3), este MESMO teste deve passar (tarefa 3.4).
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.7, 2.8, 2.9, 2.10, 2.11
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, '..', '..', 'public', 'style.css');
const css = readFileSync(cssPath, 'utf8');

/* ----------------------------------------------------------------------------
 * Coletor de regras: separa o CSS de topo (fora de @media) dos blocos @media,
 * e expõe uma busca por seletor que retorna o corpo (declarações) concatenado.
 * Mesma filosofia de parsing das suítes existentes (regex tolerante a formato).
 * -------------------------------------------------------------------------- */

// Extrai o conteúdo do primeiro bloco @media que casa com `widthPx`.
function mediaBlock(source, widthPx) {
  const re = new RegExp(`@media[^{]*\\(\\s*max-width:\\s*${widthPx}px\\s*\\)\\s*\\{`, 'i');
  const start = source.search(re);
  if (start === -1) return '';
  const open = source.indexOf('{', start);
  let depth = 1;
  let j = open + 1;
  while (j < source.length && depth > 0) {
    if (source[j] === '{') depth += 1;
    else if (source[j] === '}') depth -= 1;
    j += 1;
  }
  return source.slice(open + 1, j - 1);
}

// Remove os blocos @media completos, devolvendo só o CSS de topo.
function stripAtMediaBlocks(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const at = source.indexOf('@media', i);
    if (at === -1) { out += source.slice(i); break; }
    out += source.slice(i, at);
    const open = source.indexOf('{', at);
    if (open === -1) break;
    let depth = 1;
    let j = open + 1;
    while (j < source.length && depth > 0) {
      if (source[j] === '{') depth += 1;
      else if (source[j] === '}') depth -= 1;
      j += 1;
    }
    i = j;
  }
  return out;
}

// Retorna uma lista de { selector, body } para cada regra simples do escopo.
function rules(source) {
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  const out = [];
  let m;
  while ((m = ruleRe.exec(source)) !== null) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

const topLevel = stripAtMediaBlocks(css);
const topRules = rules(topLevel);

// Casa uma regra cujo seletor contém EXATAMENTE o token de classe informado
// (fronteira à direita para não casar `.auth-state` dentro de `.auth-state-heading`).
function selectorMatches(selector, token) {
  // token ex.: ".auth-state" — exige que não seja seguido por [A-Za-z0-9_-]
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc}(?![A-Za-z0-9_-])`);
  return re.test(selector);
}

// Concatena o corpo de todas as regras de topo cujo seletor casa o token.
function declsFor(token, scope = topRules) {
  return scope
    .filter((r) => selectorMatches(r.selector, token))
    .map((r) => r.body)
    .join(' ; ');
}

// Verifica se existe ALGUMA regra de topo cujo seletor casa `token` E cujo
// corpo satisfaz `predicate(body)`.
function hasRuleWhere(token, predicate, scope = topRules) {
  return scope.some(
    (r) => selectorMatches(r.selector, token) && predicate(r.body),
  );
}

const has = (body, re) => re.test(body);

/* ============================================================================
 * Propriedade 1 — Bug Condition. Para cada seletor enumerado, um bloco de
 * regra PADRONIZADO deve existir. (Falham no código não corrigido.)
 * ========================================================================== */

describe('auth-standardization (exploração) — Property 1: Bug Condition', () => {
  // Req 2.1 — visibilidade dos estados de auth: só o .active aparece.
  it('.auth-state tem display:none e .auth-state.active tem display:block (Req 2.1)', () => {
    const base = hasRuleWhere('.auth-state', (b) => has(b, /display\s*:\s*none/i));
    const active = topRules.some(
      (r) => /\.auth-state\.active(?![A-Za-z0-9_-])/.test(r.selector)
        && /display\s*:\s*block/i.test(r.body),
    );
    expect(base, '.auth-state { display: none } ausente').toBe(true);
    expect(active, '.auth-state.active { display: block } ausente').toBe(true);
  });

  // Req 2.2 — bloco de perfil: avatar à esquerda via flex alinhado + gap.
  it('.local-account-chip usa display:flex, align-items:center e gap (Req 2.2)', () => {
    const ok = hasRuleWhere('.local-account-chip', (b) =>
      has(b, /display\s*:\s*flex/i)
      && has(b, /align-items\s*:\s*center/i)
      && has(b, /gap\s*:/i));
    expect(ok, '.local-account-chip sem regra flex padronizada (cai no default)').toBe(true);
  });

  // Req 2.3 — campo de senha: contexto de posicionamento/flex + toggle embutido e à direita.
  it('.password-field cria contexto de posição/flex e embute o toggle à direita (Req 2.3)', () => {
    const context = hasRuleWhere('.password-field', (b) =>
      has(b, /position\s*:\s*relative/i) || has(b, /display\s*:\s*flex/i));

    // O toggle [data-toggle-password] deve ser embutido/à direita: ou
    // position:absolute + right:, ou alinhamento flex à direita.
    const toggleDecls = declsFor('[data-toggle-password]');
    const toggleEmbedded =
      (/position\s*:\s*absolute/i.test(toggleDecls) && /right\s*:/i.test(toggleDecls))
      || /margin-left\s*:\s*auto/i.test(toggleDecls)
      || /align-self\s*:/i.test(toggleDecls);

    expect(context, '.password-field sem position:relative/display:flex (toggle flutua abaixo)').toBe(true);
    expect(toggleEmbedded, '[data-toggle-password] não é embutido/alinhado à direita').toBe(true);
  });

  // Req 2.7 — link de texto secundário: sem borda/fundo, cor azul institucional.
  it('.auth-text-action é link de texto sem borda, cor var(--ac-dark-blue) (Req 2.7)', () => {
    const ok = hasRuleWhere('.auth-text-action', (b) => {
      const transparent = /background\s*:\s*transparent/i.test(b)
        || /background-color\s*:\s*transparent/i.test(b);
      const noBorder = /border\s*:\s*none/i.test(b) || /border\s*:\s*0/i.test(b);
      const darkBlue = /color\s*:\s*var\(\s*--ac-dark-blue\s*\)/i.test(b);
      return (transparent || noBorder) && darkBlue;
    });
    expect(ok, '.auth-text-action herda chrome de <button> (borda/fundo) em vez de link').toBe(true);
  });

  // Req 2.8 — consentimento: checkbox inline com o texto via flex.
  it('.auth-agreement usa display:flex para checkbox inline com o texto (Req 2.8)', () => {
    const ok = hasRuleWhere('.auth-agreement', (b) => has(b, /display\s*:\s*flex/i));
    expect(ok, '.auth-agreement sem display:flex (checkbox destacado do texto)').toBe(true);
  });

  // Req 2.9 — aviso de recuperação: bloco de nota com padding + radius token.
  it('.recovery-warning é bloco de nota com padding + border-radius:var(--radius) (Req 2.9)', () => {
    const ok = hasRuleWhere('.recovery-warning', (b) =>
      has(b, /padding\s*:/i)
      && has(b, /border-radius\s*:\s*var\(\s*--radius\s*\)/i));
    expect(ok, '.recovery-warning sem bloco de nota (texto cru sem separação)').toBe(true);
  });

  // Req 2.10 — ações de recuperação: alinhamento via flex.
  it('.auth-recovery-actions usa display:flex para alinhar as ações (Req 2.10)', () => {
    const ok = hasRuleWhere('.auth-recovery-actions', (b) => has(b, /display\s*:\s*flex/i));
    expect(ok, '.auth-recovery-actions sem display:flex (botões default desalinhados)').toBe(true);
  });

  // Req 2.5 — grade de duas colunas empilha no breakpoint de 600px.
  it('@media (max-width:600px) sobrescreve .form-grid.two para grid-template-columns:1fr (Req 2.5)', () => {
    const block = mediaBlock(css, 600);
    const mediaRules = rules(block);
    const ok = mediaRules.some(
      (r) => /\.form-grid\.two(?![A-Za-z0-9_-])/.test(r.selector)
        && /grid-template-columns\s*:\s*1fr\s*(?:;|$)/i.test(r.body),
    );
    expect(ok, '.form-grid.two não é empilhado dentro do @media 600px (placeholder truncado)').toBe(true);
  });

  // Req 2.11 / 3.1 — regras novas usam só tokens var(--...)/paleta existente, sem novo hex.
  // Captura hex apenas nos blocos de regra dos seletores padronizados (não no :root).
  it('as regras padronizadas usam só tokens var(--...) existentes, sem novo hex (Req 2.11, 3.1)', () => {
    const PALETTE = new Set(['#1e3a8a', '#f28a1e', '#74d2e7', '#f23c13'].map((c) => c.toLowerCase()));
    const standardizedSelectors = [
      '.local-account-chip',
      '.password-field',
      '[data-toggle-password]',
      '.auth-text-action',
      '.auth-agreement',
      '.recovery-warning',
      '.auth-recovery-actions',
      '.auth-state',
    ];
    const offenders = [];
    for (const token of standardizedSelectors) {
      const body = declsFor(token);
      const hexes = body.match(/#[0-9a-f]{3,8}\b/gi) || [];
      for (const hex of hexes) {
        if (!PALETTE.has(hex.toLowerCase())) {
          offenders.push({ token, hex });
        }
      }
    }
    expect(offenders, `novo hex fora da paleta nas regras padronizadas: ${JSON.stringify(offenders)}`).toEqual([]);
  });
});

/* ============================================================================
 * TASK 2 (bugfix: frontend-layout-standardization) — Testes de PRESERVAÇÃO.
 *
 * Propriedade 2 (Preservation): "Non-Buggy Inputs Behave Identically".
 *
 * Metodologia observação-primeiro: estas asserções codificam a baseline
 * OBSERVADA no CSS NÃO corrigido (paleta, recursos 100% locais, piso de 13px,
 * nenhum width fixo largo fora de @media). Elas DEVEM PASSAR no código não
 * corrigido — isso confirma a baseline a ser preservada — e devem continuar
 * passando após o fix (tarefa 3.5).
 *
 * São propriedades sobre o CSS INTEIRO (property-based, via fast-check),
 * iterando sobre TODAS as declarações de font-size, TODAS as regras de topo e
 * TODAS as ocorrências de url(...)/@import — reutilizando a abordagem de coletor
 * das suítes tokens.test.js e layout-audit.test.js.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 * ========================================================================== */

import fc from 'fast-check';

/* ----------------------------------------------------------------------------
 * Coletores reutilizados das suítes existentes.
 * -------------------------------------------------------------------------- */

// Piso tipográfico: mesma lógica de collectFontSizes de tokens.test.js.
const BASE_PX = 16;
const FLOOR_PX = 12.9; // tolerância de arredondamento; alvo >= 13px.

function collectFontSizes(source) {
  const findings = [];
  const re = /font-size:\s*([^;}]+)[;}]/gi;
  let m;
  while ((m = re.exec(source)) !== null) {
    const raw = m[1].trim();
    if (/clamp\(|calc\(|var\(|vw|vh|%/.test(raw)) continue;
    const pxMatch = raw.match(/^(-?\d*\.?\d+)px$/i);
    if (pxMatch) { findings.push({ raw, px: parseFloat(pxMatch[1]) }); continue; }
    const remMatch = raw.match(/^(-?\d*\.?\d+)rem$/i);
    if (remMatch) { findings.push({ raw, px: parseFloat(remMatch[1]) * BASE_PX }); continue; }
    const emMatch = raw.match(/^(-?\d*\.?\d+)em$/i);
    if (emMatch) { findings.push({ raw, px: parseFloat(emMatch[1]) * BASE_PX }); }
  }
  return findings;
}

// Larguras fixas largas fora de @media: mesma lógica de layout-audit.test.js.
function offendingWidths(source) {
  const top = stripAtMediaBlocks(source);
  const offenders = [];
  for (const { selector, body } of rules(top)) {
    const decorative = /::(before|after)/i.test(selector);
    const widthRe = /(^|[;{\s])width:\s*(\d+)px/gi;
    let w;
    while ((w = widthRe.exec(body)) !== null) {
      const px = parseInt(w[2], 10);
      if (px >= 360 && !decorative) offenders.push({ selector, px });
    }
  }
  return offenders;
}

// Todas as ocorrências de url(...) e @import, com flag de remoto.
function collectResourceRefs(source) {
  const refs = [];
  const urlRe = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
  let u;
  while ((u = urlRe.exec(source)) !== null) {
    const target = u[2].trim();
    refs.push({ kind: 'url', target, remote: /^(?:https?:)?\/\//i.test(target) });
  }
  const importRe = /@import\s+(?:url\(\s*(['"]?)([^'")]*)\1\s*\)|(['"])([^'"]*)\3)/gi;
  let im;
  while ((im = importRe.exec(source)) !== null) {
    const target = (im[2] || im[4] || '').trim();
    refs.push({ kind: '@import', target, remote: /^(?:https?:)?\/\//i.test(target) });
  }
  return refs;
}

const PALETTE = ['#1e3a8a', '#f28a1e', '#74d2e7', '#f23c13'];
function rootScope() {
  const m = css.match(/:root\s*\{[\s\S]*?\}/i);
  return m ? m[0] : '';
}

describe('auth-standardization (preservação) — Property 2: baseline a preservar', () => {
  // Req 3.3 — piso tipográfico: TODA declaração de font-size fixa >= 13px.
  it('sobre TODAS as declarações de font-size, todo valor fixo resolve a >= 13px (Req 3.3)', () => {
    const sizes = collectFontSizes(css);
    expect(sizes.length).toBeGreaterThan(10);
    fc.assert(
      fc.property(fc.constantFrom(...sizes), (f) => f.px >= FLOOR_PX),
      { numRuns: Math.max(sizes.length, 50) },
    );
  });

  // Req 3.5 — nenhuma regra de topo não-decorativa tem width fixo >= 360px.
  it('sobre TODAS as regras de topo (fora de @media), nenhuma não-decorativa tem width fixo >= 360px (Req 3.5)', () => {
    const top = stripAtMediaBlocks(css);
    const allRules = rules(top);
    expect(allRules.length).toBeGreaterThan(0);
    // Propriedade sobre o conjunto inteiro de regras de topo.
    fc.assert(
      fc.property(fc.constantFrom(...allRules), (r) => {
        const decorative = /::(before|after)/i.test(r.selector);
        if (decorative) return true;
        const widthRe = /(^|[;{\s])width:\s*(\d+)px/gi;
        let w;
        while ((w = widthRe.exec(r.body)) !== null) {
          if (parseInt(w[2], 10) >= 360) return false;
        }
        return true;
      }),
      { numRuns: Math.max(allRules.length, 50) },
    );
    // Garante que o coletor completo também não encontra ofensores.
    expect(offendingWidths(css)).toEqual([]);
  });

  // Req 3.2 — recursos 100% locais: nenhuma url(...)/@import remota.
  it('sobre TODAS as ocorrências de url(...)/@import, nenhuma é remota (Req 3.2)', () => {
    const refs = collectResourceRefs(css);
    fc.assert(
      fc.property(fc.constantFrom(...(refs.length ? refs : [{ kind: 'none', target: '', remote: false }])), (r) => r.remote === false),
      { numRuns: Math.max(refs.length, 10) },
    );
    expect(refs.filter((r) => r.remote)).toEqual([]);
  });

  // Req 3.1 — os quatro valores de paleta continuam presentes em :root.
  it('os quatro valores de paleta permanecem presentes em :root (Req 3.1)', () => {
    const root = rootScope();
    expect(root).not.toEqual('');
    fc.assert(
      fc.property(fc.constantFrom(...PALETTE), (hex) => new RegExp(hex, 'i').test(root)),
      { numRuns: PALETTE.length },
    );
  });
});
