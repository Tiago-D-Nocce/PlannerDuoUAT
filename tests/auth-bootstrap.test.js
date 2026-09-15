// tests/auth-bootstrap.test.js — regressões do bootstrap de autenticação/app.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import bootstrap from '../public/bootstrap.js';

const PUBLIC = resolve(import.meta.dirname, '..', 'public');
const RAIZ = resolve(PUBLIC, '..');
const lerPublic = (arquivo) => readFileSync(resolve(PUBLIC, arquivo), 'utf8');

function elementoFalso() {
  return {
    hidden: true,
    textContent: '',
    dataset: {},
    style: {},
    atributos: {},
    setAttribute(nome, valor) { this.atributos[nome] = valor; },
  };
}

function ambienteFalso() {
  const elementos = {
    'loader-tela': elementoFalso(),
    'loader-msg': elementoFalso(),
    'loader-acoes': elementoFalso(),
    'auth-bootstrap-error': elementoFalso(),
    'auth-bootstrap-detail': elementoFalso(),
  };
  const ouvintes = new Map();
  const timers = new Map();
  let proximoTimer = 1;
  const registros = [];

  return {
    elementos,
    ouvintes,
    timers,
    registros,
    janela: {
      addEventListener(tipo, fn) { ouvintes.set(tipo, fn); },
      removeEventListener(tipo, fn) {
        if (ouvintes.get(tipo) === fn) ouvintes.delete(tipo);
      },
    },
    documento: { getElementById: (id) => elementos[id] || null },
    agendar(fn) {
      const id = proximoTimer++;
      timers.set(id, fn);
      return id;
    },
    cancelar(id) { timers.delete(id); },
    logger: { warn: (...args) => registros.push(args) },
  };
}

describe('supervisor de bootstrap', () => {
  it('transforma timeout do app em erro visível com ações de recuperação', () => {
    const ambiente = ambienteFalso();
    const supervisor = bootstrap.criarSupervisorBootstrap(ambiente);

    expect(supervisor.iniciar({ pagina: 'app', timeoutMs: 25 })).toBe(true);
    expect(ambiente.timers.size).toBe(1);
    [...ambiente.timers.values()][0]();

    expect(supervisor.estadoAtual()).toEqual({ pagina: 'app', estado: 'erro' });
    expect(ambiente.elementos['loader-msg'].textContent).toBe(bootstrap.MENSAGEM_APP);
    expect(ambiente.elementos['loader-acoes'].hidden).toBe(false);
    expect(ambiente.elementos['loader-tela'].dataset.estado).toBe('erro');
    expect(ambiente.elementos['loader-tela'].atributos['aria-busy']).toBe('false');
    expect(JSON.stringify(ambiente.registros)).not.toContain('Error');
  });

  it('mostra falha persistente na autenticação quando um script não carrega', () => {
    const ambiente = ambienteFalso();
    const supervisor = bootstrap.criarSupervisorBootstrap(ambiente);
    supervisor.iniciar({ pagina: 'auth' });

    ambiente.ouvintes.get('error')({ target: { tagName: 'SCRIPT' } });

    expect(ambiente.elementos['auth-bootstrap-error'].hidden).toBe(false);
    expect(ambiente.elementos['auth-bootstrap-error'].dataset.estado).toBe('erro');
    expect(ambiente.elementos['auth-bootstrap-detail'].textContent).toBe(bootstrap.MENSAGEM_AUTH);
    expect(ambiente.registros[0][1]).toEqual({
      evento: 'bootstrap-failure',
      pagina: 'auth',
      categoria: 'recurso',
    });
  });

  it('cancela o watchdog ao concluir e ignora falhas tardias', () => {
    const ambiente = ambienteFalso();
    const supervisor = bootstrap.criarSupervisorBootstrap(ambiente);
    supervisor.iniciar({ pagina: 'app' });

    expect(supervisor.concluir()).toBe(true);
    expect(ambiente.timers.size).toBe(0);
    expect(ambiente.ouvintes.size).toBe(0);
    expect(supervisor.falhar('sdk')).toBe(false);
    expect(ambiente.elementos['loader-acoes'].hidden).toBe(true);
    expect(supervisor.estadoAtual()).toEqual({ pagina: 'app', estado: 'pronto' });
  });
});

describe('integração do bootstrap com os assets', () => {
  const appHtml = lerPublic('app.html');
  const authHtml = lerPublic('auth.html');
  const appJs = lerPublic('app.js');
  const firebaseJson = JSON.parse(readFileSync(resolve(RAIZ, 'firebase.json'), 'utf8'));

  it.each([
    ['app.html', appHtml],
    ['auth.html', authHtml],
  ])('%s carrega o supervisor antes do Firebase e oferece recuperação sem SDK', (_arquivo, html) => {
    expect(html.indexOf('src="bootstrap.js"')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('src="bootstrap.js"')).toBeLessThan(html.indexOf('firebase-app-compat.js'));
    expect(html).toContain('window.location.reload()');
    expect(html).toMatch(/bootstrap\.js" onerror="[^"]+/);
  });

  it('app tem watchdog, erro recuperável e só conclui após entrar no app', () => {
    expect(appHtml).toContain("iniciar({ pagina: 'app', timeoutMs: 10000 })");
    expect(appHtml).toContain('id="loader-acoes"');
    expect(appHtml).toContain('Ir para o login');
    expect(appJs).toContain('Auth._processarEstado(user).catch');
    expect(appJs).toContain("Auth._falharBootstrap('autenticacao')");
    expect(appJs).toContain('window.PlannerBootstrap.concluir()');
  });

  it('auth torna a persistência um gate terminal e usa um único redirecionamento substitutivo', () => {
    expect(authHtml).toContain("iniciar({ pagina: 'auth', timeoutMs: 10000 })");
    expect(authHtml).toContain('PlannerAuthErrors.limitarOperacaoAuth(');
    expect(authHtml).not.toContain('const persistenciaPronta = Promise.race');
    expect(authHtml).toContain('await persistenciaPronta');
    expect(authHtml).toContain("window.PlannerBootstrap.falhar('autenticacao')");
    expect(authHtml).toContain('function irParaApp()');
    expect(authHtml).toContain("window.location.replace('app.html')");
  });

  it('Hosting impede cache de assets sem versão e o texto obsoleto não reaparece', () => {
    const cabecalho = firebaseJson.hosting.headers.find((item) => item.source === '**');
    expect(cabecalho.headers).toContainEqual({
      key: 'Cache-Control',
      value: 'no-cache, no-store, must-revalidate',
    });

    for (const conteudo of [appHtml, authHtml, lerPublic('auth-errors.js')]) {
      expect(conteudo).not.toContain('Erro interno do Firebase. Tente novamente.');
    }
  });
});
