// tests/auth-errors.test.js — regressões do tratamento de falhas do Firebase Auth.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import authErrors from '../public/auth-errors.js';

const {
  MENSAGEM_CREDENCIAL,
  normalizarErroAuth,
  mensagemErroAuth,
  criarDiagnosticoErroAuth,
  registrarErroAuth,
} = authErrors;

const PUBLIC = resolve(import.meta.dirname, '..', 'public');
const lerPublic = (arquivo) => readFileSync(resolve(PUBLIC, arquivo), 'utf8');

describe('normalização de credenciais inválidas', () => {
  it.each([
    ['auth/invalid-credential', 'INVALID_LOGIN_CREDENTIALS'],
    ['auth/invalid-login-credentials', 'credencial rejeitada'],
    ['auth/wrong-password', 'senha rejeitada'],
    ['auth/user-not-found', 'conta ausente'],
  ])('normaliza o alias %s sem revelar qual campo falhou', (code, message) => {
    expect(normalizarErroAuth({ code, message }).codigo).toBe('auth/invalid-credential');
    expect(mensagemErroAuth({ code, message })).toBe(MENSAGEM_CREDENCIAL);
  });

  it.each(['INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD', 'EMAIL_NOT_FOUND'])(
    'converte auth/internal-error legado com %s para a mensagem segura',
    (marcador) => {
      const error = {
        code: 'auth/internal-error',
        message: `Firebase: Error (auth/internal-error). Backend respondeu ${marcador}`,
      };

      expect(normalizarErroAuth(error)).toMatchObject({
        codigo: 'auth/invalid-credential',
        categoria: 'credencial',
        credencialLegada: true,
      });
      expect(mensagemErroAuth(error)).toBe('E-mail ou senha incorretos.');
    }
  );

  it('mantém um auth/internal-error realmente desconhecido genérico e seguro', () => {
    const segredo = 'senha-nao-deve-aparecer';
    const error = {
      code: 'auth/internal-error',
      message: `Falha interna inesperada: ${segredo}`,
    };

    expect(normalizarErroAuth(error)).toMatchObject({
      codigo: 'auth/internal-error',
      categoria: 'interno',
      credencialLegada: false,
    });
    expect(mensagemErroAuth(error)).toBe('Não foi possível concluir a autenticação. Tente novamente.');
    expect(mensagemErroAuth(error)).not.toContain(segredo);
    expect(mensagemErroAuth(error)).not.toContain(error.message);
  });
});

describe('mensagens operacionais úteis e seguras', () => {
  it.each([
    ['auth/app-not-authorized', 'origem'],
    ['auth/unauthorized-domain', 'domínio'],
    ['auth/web-storage-unsupported', 'armazenamento'],
    ['auth/network-request-failed', 'conexão'],
  ])('mapeia %s sem exibir mensagem bruta', (code, trechoEsperado) => {
    const backend = 'RAW_BACKEND_MESSAGE_DO_NOT_SHOW';
    const mensagem = mensagemErroAuth({ code, message: backend });
    expect(mensagem.toLowerCase()).toContain(trechoEsperado);
    expect(mensagem).not.toContain(backend);
  });
});

describe('falhas reais da política de persistência', () => {
  it.each([
    'auth/web-storage-unsupported',
    'auth/unsupported-persistence-type',
    'auth/missing-initial-state',
  ])('classifica %s especificamente como armazenamento', (code) => {
    const erro = { code, message: 'detalhe bruto privado' };

    expect(normalizarErroAuth(erro).categoria).toBe('armazenamento');
    expect(mensagemErroAuth(erro).toLowerCase()).toMatch(/armazenamento|cookies/);
    expect(mensagemErroAuth(erro)).not.toContain(erro.message);
  });

  it('não expõe mais um helper que fabrique auth/timeout', () => {
    expect(authErrors).not.toHaveProperty('limitarOperacaoAuth');
  });
});

describe('diagnósticos sanitizados', () => {
  it('não copia segredos fornecidos em nenhum campo do erro ou da operação', () => {
    const segredos = [
      'pessoa@example.invalid',
      'senha-super-secreta',
      'AIzaSyEXEMPLO_NAO_REAL_123456',
      'eyJhbGciOi-token-exemplo',
      'refresh-token-exemplo',
      '{"password":"payload-secreto"}',
    ];
    const error = {
      code: `auth/${segredos[1]}`,
      message: segredos.join(' '),
      email: segredos[0],
      password: segredos[1],
      customData: { apiKey: segredos[2], request: segredos[5] },
      credential: { accessToken: segredos[3], refreshToken: segredos[4] },
    };
    const registros = [];
    const logger = { warn: (...args) => registros.push(args) };

    const diagnostico = registrarErroAuth(error, segredos[0], logger);
    const serializado = JSON.stringify({ diagnostico, registros });

    expect(diagnostico).toEqual({
      evento: 'firebase-auth-error',
      operacao: 'autenticacao',
      codigo: 'auth/unknown',
      categoria: 'desconhecido',
      credencialLegada: false,
      codigoRecebido: true,
      mensagemRecebida: true,
    });
    for (const segredo of segredos) expect(serializado).not.toContain(segredo);
  });

  it('preserva somente metadados allowlisted úteis para falha interna', () => {
    expect(criarDiagnosticoErroAuth(
      { code: 'auth/internal-error', message: 'detalhe privado' },
      'login'
    )).toEqual({
      evento: 'firebase-auth-error',
      operacao: 'login',
      codigo: 'auth/internal-error',
      categoria: 'interno',
      credencialLegada: false,
      codigoRecebido: true,
      mensagemRecebida: true,
    });
  });
});

describe('integração dos assets compat', () => {
  const urlsEsperadas = [
    'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore-compat.js',
  ];

  function urlsFirebase(html) {
    return urlsEsperadas.filter((url) => html.includes(url));
  }

  it.each(['auth.html', 'app.html'])('%s usa versão compat fixada somente no loader condicional', (arquivo) => {
    const html = lerPublic(arquivo);
    expect(urlsFirebase(html)).toEqual(urlsEsperadas);
    for (const url of urlsEsperadas) expect(html.split(url)).toHaveLength(2);
    expect(html).not.toMatch(/^\s*<script\s+src="https:\/\/www\.gstatic\.com/m);
    expect(html).toContain('document.write(\'<script src="auth-errors.js"');
  });

  it('auth.html passa o erro completo e não volta a silenciar persistência', () => {
    const html = lerPublic('auth.html');
    expect(html).not.toContain('erroFirebase(err.code)');
    expect(html).not.toMatch(/setPersistence\([^;]+\.catch\(\(\) => \{\}\)/s);
    expect(html).toContain("registrarErroAuth(err, 'persistencia')");
  });

  it.each(['auth.html', 'app.html'])('scripts inline de %s têm sintaxe válida', (arquivo) => {
    const html = lerPublic(arquivo);
    const scriptsInline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1])
      .filter((script) => script.trim());

    expect(scriptsInline.length).toBeGreaterThan(0);
    for (const script of scriptsInline) {
      expect(() => new vm.Script(script, { filename: arquivo })).not.toThrow();
    }
  });
});

function trechoEntre(texto, inicio, fim) {
  const indiceInicio = texto.indexOf(inicio);
  const indiceFim = texto.indexOf(fim, indiceInicio + inicio.length);
  expect(indiceInicio).toBeGreaterThanOrEqual(0);
  expect(indiceFim).toBeGreaterThan(indiceInicio);
  return texto.slice(indiceInicio, indiceFim);
}

describe('regressão de saída da sessão', () => {
  const appJs = lerPublic('app.js');
  const authHtml = lerPublic('auth.html');

  it.each([
    ['Auth.logout', '    logout: () => {', '    // Sai do sistema', 'auth.html'],
    ['Auth.sairParaLanding', '    sairParaLanding: () => {', '// BANCO DE DADOS (FIRESTORE)', 'index.html'],
  ])('%s deixa limpeza e navegação somente no callback de sucesso', (_nome, inicio, fim, destino) => {
    const fluxo = trechoEntre(appJs, inicio, fim);

    expect(fluxo).toContain('return auth.signOut().then(');
    expect(fluxo).toContain(`() => Auth._finalizarLogout('${destino}')`);
    expect(fluxo).toContain('Auth._tratarFalhaLogout');
    expect(fluxo).not.toMatch(/\.catch\s*\(/);
    expect(fluxo).not.toMatch(/Estado\.unsubscribe|localStorage\.removeItem|window\.location/);
  });

  it('app mantém a sessão ativa e não limpa nem navega quando signOut rejeita', () => {
    const falha = trechoEntre(appJs, '    _tratarFalhaLogout: (err) => {', '    logout: () => {');

    expect(falha).toContain("PlannerAuthErrors.registrarErroAuth(err, 'logout')");
    expect(falha).toContain("'Sua sessão continua ativa. Tente novamente.'");
    expect(falha).not.toMatch(/_finalizarLogout|_limparSessaoAposLogout/);
    expect(falha).not.toMatch(/Estado\.unsubscribe|localStorage\.removeItem|window\.location/);
    expect(falha).not.toMatch(/err\.(?:message|code)/);
  });

  it('app navega mesmo se uma limpeza pós-signOut lançar exceção', () => {
    const sucesso = trechoEntre(appJs, '    _limparSessaoAposLogout: () => {', '    _tratarFalhaLogout: (err) => {');

    expect(sucesso).toMatch(/_limparSessaoAposLogout:[\s\S]*Estado\.unsubscribe/);
    expect(sucesso).toMatch(/_limparSessaoAposLogout:[\s\S]*localStorage\.removeItem\(DB\.chaveCache\(\)\)/);
    expect(sucesso).toMatch(/_finalizarLogout:[\s\S]*try[\s\S]*Auth\._limparSessaoAposLogout\(\)[\s\S]*finally[\s\S]*window\.location\.href = destino/);
  });

  it('trocarConta só limpa o cache depois do sucesso e preserva a sessão na rejeição', () => {
    const fluxo = trechoEntre(authHtml, 'function trocarConta() {', 'function togglePwd');
    const falha = trechoEntre(authHtml, 'function tratarFalhaTrocaConta(err) {', 'function trocarConta() {');
    const limpeza = trechoEntre(authHtml, 'function limparContaLocalAposLogout() {', 'function tratarFalhaTrocaConta');

    expect(fluxo).toMatch(/if \(MODO_LOCAL\)[\s\S]*return auth\.signOut\(\)/);
    expect(fluxo).toContain("localStorage.removeItem('pd-casalId')");
    expect(fluxo).not.toMatch(/MODO_LOCAL[\s\S]*startsWith\('pd-cache:'\)/);
    expect(fluxo).toMatch(/return persistenciaPronta\s*\.then\(\(\) => auth\.signOut\(\)\)\s*\.then\(limparContaLocalAposLogout, tratarFalhaTrocaConta\);/);
    expect(fluxo).not.toMatch(/window\.location|\.catch\s*\(/);
    expect(limpeza).toContain("localStorage.removeItem('pd-casalId')");
    expect(limpeza).toContain("k.startsWith('pd-cache:')");
    expect(falha).toContain("PlannerAuthErrors.registrarErroAuth(err, 'logout')");
    expect(falha).toContain('Sua sessão continua ativa. Tente novamente.');
    expect(falha).not.toMatch(/limparContaLocalAposLogout|localStorage|window\.location/);
    expect(falha).not.toMatch(/err\.(?:message|code)/);
  });
});
