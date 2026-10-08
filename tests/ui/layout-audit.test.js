/* TASK 14.3 — Auditoria de layout e caça a bugs visuais (gate da etapa 3).
 *
 * Lê os HTML das três telas e o style.css do disco (sem navegador) e verifica:
 *  (a) nenhuma copy visível "cofre"/"vault" (texto ou atributos acessíveis);
 *  (b) breakpoints de 900px e 600px existem;
 *  (c) nenhum width: fixo >= 360px fora de @media (exceto pseudo-elementos
 *      decorativos ::before/::after);
 *  (d) todo <button> em app.html tem texto ou aria-label;
 *  (e) ícones decorativos carregam aria-hidden="true" (>= 10 ocorrências).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', '..', 'public');
const read = (name) => readFileSync(join(pub, name), 'utf8');

const appHtml = read('app.html');
const indexHtml = read('index.html');
const authHtml = read('auth.html');
const css = read('style.css');

describe('layout-audit — sem copy "cofre"/"vault" (§7.7)', () => {
  const files = { 'app.html': appHtml, 'index.html': indexHtml, 'auth.html': authHtml };

  it('nenhum texto visível entre tags contém cofre|vault', () => {
    for (const [name, html] of Object.entries(files)) {
      const visibleText = html.match(/>[^<]*(cofre|vault)[^<]*</gi) || [];
      expect(visibleText, `texto visível com cofre/vault em ${name}`).toEqual([]);
    }
  });

  it('nenhum aria-label/title/placeholder/alt contém cofre|vault', () => {
    const attrRe = /\b(?:aria-label|title|placeholder|alt)\s*=\s*"[^"]*(cofre|vault)[^"]*"/gi;
    for (const [name, html] of Object.entries(files)) {
      const hits = html.match(attrRe) || [];
      expect(hits, `atributo acessível com cofre/vault em ${name}`).toEqual([]);
    }
  });
});

describe('layout-audit — breakpoints responsivos', () => {
  it('tem @media (max-width: 900px)', () => {
    expect(/@media[^{]*\(\s*max-width:\s*900px\s*\)/i.test(css)).toBe(true);
  });
  it('tem @media (max-width: 600px)', () => {
    expect(/@media[^{]*\(\s*max-width:\s*600px\s*\)/i.test(css)).toBe(true);
  });
});

describe('layout-audit — nenhum width fixo largo fora de @media', () => {
  // Divide o CSS em "topo" (fora de @media) e descarta blocos @media completos,
  // depois procura width: >= 360px que NÃO seja em pseudo-elemento decorativo.
  function stripAtMediaBlocks(source) {
    let out = '';
    let i = 0;
    while (i < source.length) {
      const at = source.indexOf('@media', i);
      if (at === -1) { out += source.slice(i); break; }
      out += source.slice(i, at);
      // acha a '{' que abre o bloco @media e consome até o '}' correspondente.
      const open = source.indexOf('{', at);
      if (open === -1) { break; }
      let depth = 1;
      let j = open + 1;
      while (j < source.length && depth > 0) {
        if (source[j] === '{') depth += 1;
        else if (source[j] === '}') depth -= 1;
        j += 1;
      }
      i = j; // pula o bloco @media inteiro
    }
    return out;
  }

  // Para cada regra (selector { ...decls... }) do topo, só aceita width grande
  // quando o seletor é claramente decorativo (::before/::after).
  function offendingWidths(source) {
    const topLevel = stripAtMediaBlocks(source);
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    const offenders = [];
    let m;
    while ((m = ruleRe.exec(topLevel)) !== null) {
      const selector = m[1].trim();
      const body = m[2];
      const decorative = /::(before|after)/i.test(selector);
      // width: Npx (não max-/min-width), N >= 360.
      const widthRe = /(^|[;{\s])width:\s*(\d+)px/gi;
      let w;
      while ((w = widthRe.exec(body)) !== null) {
        const px = parseInt(w[2], 10);
        if (px >= 360 && !decorative) {
          offenders.push({ selector, px });
        }
      }
    }
    return offenders;
  }

  it('não há width: >= 360px fixo em regra não-decorativa fora de @media', () => {
    expect(offendingWidths(css)).toEqual([]);
  });
});

describe('layout-audit — todo botão nomeado em app.html', () => {
  it('cada <button> tem texto visível ou aria-label', () => {
    // Captura cada <button ...>...</button> (sem botões aninhados no HTML real).
    const buttonRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
    const unnamed = [];
    let m;
    let count = 0;
    while ((m = buttonRe.exec(appHtml)) !== null) {
      count += 1;
      const attrs = m[1];
      const inner = m[2];
      const hasAria = /\baria-label\s*=\s*"[^"]*\S[^"]*"/i.test(attrs);
      // texto visível = remove tags internas e checa se sobra algo não-branco.
      const text = inner.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
      const hasAriaLabelledby = /\baria-labelledby\s*=\s*"[^"]*\S[^"]*"/i.test(attrs);
      const hasTitle = /\btitle\s*=\s*"[^"]*\S[^"]*"/i.test(attrs);
      if (!hasAria && !hasAriaLabelledby && !hasTitle && text.length === 0) {
        unnamed.push(m[0].slice(0, 80));
      }
    }
    expect(count).toBeGreaterThan(0);
    expect(unnamed).toEqual([]);
  });
});

describe('layout-audit — ícones decorativos com aria-hidden', () => {
  it('app.html tem >= 10 aria-hidden="true"', () => {
    const hits = appHtml.match(/aria-hidden\s*=\s*"true"/gi) || [];
    expect(hits.length).toBeGreaterThanOrEqual(10);
  });
});

/* ===================================================================
 * TASK 9.3 — Guardas do refinamento visual (P4 + reforço de P3).
 * P4: nenhuma regressão de largura fixa larga (>= 360px) fora de @media.
 * P3: breakpoints de 900px e 600px continuam presentes.
 * =================================================================== */

describe('layout-audit — P4: sem largura fixa larga fora de @media (refinamento)', () => {
  // Reusa a mesma estratégia da auditoria: descarta blocos @media e procura
  // width: >= 360px em regras não decorativas.
  function stripMedia(source) {
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

  function wideFixedWidths(source) {
    const top = stripMedia(source);
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    const offenders = [];
    let m;
    while ((m = ruleRe.exec(top)) !== null) {
      const selector = m[1].trim();
      const body = m[2];
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

  it('não introduziu width: >= 360px fixo fora de @media', () => {
    expect(wideFixedWidths(css)).toEqual([]);
  });
});

describe('layout-audit — P3: breakpoints preservados após o refinamento', () => {
  it('@media (max-width: 900px) continua presente', () => {
    expect(/@media[^{]*\(\s*max-width:\s*900px\s*\)/i.test(css)).toBe(true);
  });
  it('@media (max-width: 600px) continua presente', () => {
    expect(/@media[^{]*\(\s*max-width:\s*600px\s*\)/i.test(css)).toBe(true);
  });
});
