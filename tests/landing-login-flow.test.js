// tests/landing-login-flow.test.js — garante que a landing (public/index.html)
// sempre encaminha o usuário para a tela de login (auth.html), nunca direto ao
// app. Sem isso, uma sessão do Firebase ainda persistida faria app.html entrar
// no sistema pulando o login. Teste estático: lê o HTML e valida os hrefs.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX_HTML = resolve(import.meta.dirname, '..', 'public', 'index.html');
const html = readFileSync(INDEX_HTML, 'utf8');

describe('fluxo de login a partir da landing', () => {
  it('não aponta nenhum botão da landing direto para app.html', () => {
    expect(html).not.toContain('href="app.html"');
  });

  it('encaminha para a tela de login (auth.html) em pelo menos dois pontos', () => {
    const ocorrencias = html.match(/href="auth\.html"/g) || [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2);
  });

  // Defensivo: a landing não deve auto-logar. Um observer aqui pularia o login,
  // que é justamente o comportamento que estamos evitando.
  it('não introduz um observer de auth na landing', () => {
    expect(html).not.toContain('onAuthStateChanged');
  });
});
