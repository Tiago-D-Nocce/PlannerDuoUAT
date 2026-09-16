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

function dispararPrimeiroTimer(ambiente) {
  const [id, callback] = ambiente.timers.entries().next().value;
  ambiente.timers.delete(id);
  callback();
}

function tagDoScript(html, src) {
  const inicio = html.indexOf(`<script src="${src}"`);
  expect(inicio).toBeGreaterThanOrEqual(0);
  const fim = html.indexOf('>', inicio);
  expect(fim).toBeGreaterThan(inicio);
  return html.slice(inicio, fim + 1);
}

describe('supervisor de bootstrap', () => {
  it('torna a demora recuperável e aceita conclusão tardia', () => {
    const ambiente = ambienteFalso();
    const supervisor = bootstrap.criarSupervisorBootstrap(ambiente);

    expect(supervisor.iniciar({ pagina: 'app', timeoutMs: 25 })).toBe(true);
    dispararPrimeiroTimer(ambiente);

    expect(supervisor.estadoAtual()).toEqual({ pagina: 'app', estado: 'demorado' });
    expect(ambiente.elementos['loader-msg'].textContent).toBe(bootstrap.MENSAGEM_DEMORA_APP);
    expect(ambiente.elementos['loader-acoes'].hidden).toBe(false);
    expect(ambiente.elementos['loader-tela'].dataset.estado).toBe('demorado');
    expect(ambiente.elementos['loader-tela'].atributos['aria-busy']).toBe('false');

    expect(supervisor.concluir()).toBe(true);
    expect(supervisor.estadoAtual()).toEqual({ pagina: 'app', estado: 'pronto' });
    expect(ambiente.elementos['loader-acoes'].hidden).toBe(true);
    expect(ambiente.elementos['loader-msg'].textContent).toBe('');
  });

  it('reinicia o contrato ao avançar de fase e limpa o aviso anterior', () => {
    const ambiente = ambienteFalso();
    const supervisor = bootstrap.criarSupervisorBootstrap(ambiente);
    supervisor.iniciar({ pagina: 'app', timeoutMs: 25 });
    dispararPrimeiroTimer(ambiente);

    expect(supervisor.iniciarFase('autenticacao', 50)).toBe(true);
    expect(supervisor.estadoAtual().estado).toBe('pendente');
    expect(ambiente.elementos['loader-acoes'].hidden).toBe(true);
    expect(ambiente.timers.size).toBe(1);

    expect(supervisor.concluir()).toBe(true);
    expect(ambiente.timers.size).toBe(0);
  });

  it('mostra falha persistente somente quando um script marcado não carrega', () => {
    const ambiente = ambienteFalso();
    const supervisor = bootstrap.criarSupervisorBootstrap(ambiente);
    supervisor.iniciar({ pagina: 'auth' });

    ambiente.ouvintes.get('error')({
      target: { tagName: 'SCRIPT', dataset: { bootstrapRequired: 'true' } },
    });

    expect(ambiente.elementos['auth-bootstrap-error'].hidden).toBe(false);
    expect(ambiente.elementos['auth-bootstrap-error'].dataset.estado).toBe('erro');
    expect(ambiente.elementos['auth-bootstrap-detail'].textContent).toBe(bootstrap.MENSAGEM_AUTH);
    expect(ambiente.registros[0][1]).toEqual({
      evento: 'bootstrap-failure',
      pagina: 'auth',
      categoria: 'recurso',
    });
  });

  it('ignora recursos opcionais e não instala rejeição global como decisão fatal', () => {
    const ambiente = ambienteFalso();
    const supervisor = bootstrap.criarSupervisorBootstrap(ambiente);
    supervisor.iniciar({ pagina: 'app' });

    ambiente.ouvintes.get('error')({
      target: { tagName: 'SCRIPT', dataset: {} },
    });

    expect(ambiente.ouvintes.has('unhandledrejection')).toBe(false);
    expect(supervisor.estadoAtual()).toEqual({ pagina: 'app', estado: 'pendente' });
    expect(ambiente.elementos['loader-acoes'].hidden).toBe(true);
  });

  it('cancela o timer ao concluir e ignora falhas tardias', () => {
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
    expect(html).toMatch(/bootstrap\.js" data-bootstrap-required="true" onerror="[^"]+/);
  });

  it('marca apenas os scripts funcionais obrigatórios como fatais', () => {
    const firebase = [
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js',
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth-compat.js',
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore-compat.js',
    ];
    for (const src of ['bootstrap.js', ...firebase, 'auth-errors.js']) {
      expect(tagDoScript(authHtml, src)).toContain('data-bootstrap-required="true"');
    }
    for (const src of ['bootstrap.js', ...firebase, 'auth-errors.js', 'core.js', 'app.js']) {
      expect(tagDoScript(appHtml, src)).toContain('data-bootstrap-required="true"');
    }
    expect(tagDoScript(appHtml, 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'))
      .not.toContain('data-bootstrap-required');
  });

  it('app observa Auth diretamente e avança por Auth, dados e renderização', () => {
    expect(appHtml).toContain("iniciar({ pagina: 'app', timeoutMs: 10000 })");
    expect(appHtml).toContain('id="loader-acoes"');
    expect(appHtml).toContain('Ir para o login');
    expect(appJs).toContain("Auth._iniciarFase('autenticacao', 10000)");
    expect(appJs).toContain('Auth.iniciarObserver();');
    expect(appJs).toContain("Auth._iniciarFase('dados-compartilhados', 6500)");
    expect(appJs).toContain("Auth._iniciarFase('renderizacao', 5000)");
    expect(appJs).not.toContain('setPersistence(');
    expect(appJs).toContain('Auth._processarEstado(user).catch');
    expect(appJs).toContain("Auth._falharBootstrap('autenticacao')");
  });

  it('auth é o único proprietário de SESSION e aguarda a Promise real', () => {
    expect(authHtml).toContain("iniciar({ pagina: 'auth', timeoutMs: 10000 })");
    expect(authHtml.match(/auth\.setPersistence\(/g)).toHaveLength(1);
    expect(authHtml).toContain('firebase.auth.Auth.Persistence.SESSION');
    expect(authHtml).toContain('const persistenciaPronta = Promise.resolve(operacaoPersistencia)');
    expect(authHtml).toContain('await persistenciaPronta');
    expect(authHtml).not.toContain('PlannerAuthErrors.limitarOperacaoAuth(');
    expect(authHtml).not.toContain('Persistence.LOCAL');
    expect(authHtml).toContain("normalizado.categoria === 'armazenamento'");
    expect(authHtml).toContain('function irParaApp()');
    expect(authHtml).toContain("window.location.replace('app.html')");
  });

  it('não conclui o supervisor antes de uma navegação que ainda pode falhar', () => {
    const inicio = appJs.indexOf('    _redirecionar: (destino) => {');
    const fim = appJs.indexOf('    _falharBootstrap:', inicio);
    const fluxo = appJs.slice(inicio, fim);

    expect(fluxo).toContain("Auth._iniciarFase('navegacao', 5000)");
    expect(fluxo).toContain('Auth._navegando = false');
    expect(fluxo).toContain("Auth._falharBootstrap('inicializacao')");
    expect(fluxo).not.toContain('PlannerBootstrap.concluir');
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
