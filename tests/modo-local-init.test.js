// tests/modo-local-init.test.js — inicialização em MODO LOCAL sem Firebase.
//
// O PlannerDuo abre direto no painel em modo local (window.PLANNERDUO_MODO='local'):
// sem login, sem rede, persistindo em localStorage. Este teste prova que o caminho
// de montagem local NÃO depende dos SDKs do Firebase — o módulo é carregado num
// contexto vm em que `firebase` NÃO está definido — e que a montagem conclui o
// bootstrap (esconde o loader / PlannerBootstrap.concluir()) sem chamar falhar().
//
// O harness espelha `carregarMontagemSemChart` de tests/app-saneamento.test.js:
// os mesmos IDs de DOM que o shell toca, mas fixando o modo local e removendo o
// stub de `firebase` do contexto para exercitar a independência dos SDKs.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

const RAIZ_PUBLIC = resolve(import.meta.dirname, '..', 'public');

/** Elemento DOM inerte — app.js só precisa não explodir ao tocá-lo. */
function elementoFalso() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild() {},
    remove() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    focus() {},
    reset() {},
  };
}

/**
 * Carrega public/app.js em modo local, SEM `firebase` no contexto.
 * Devolve os objetos de topo, o supervisor espião e utilidades do harness.
 */
function carregarModoLocal() {
  const canvasIds = [
    'chart-fluxo',
    'chart-categorias',
    'chart-responsavel',
    'chart-cat-fin',
    'chart-rel-evolucao',
    'chart-rel-categorias',
  ];
  const elementos = new Map();
  const adicionar = (id) => {
    const elemento = elementoFalso();
    elemento.id = id;
    elementos.set(id, elemento);
    return elemento;
  };

  for (const id of [
    'sidebar-user-name',
    'sidebar-avatar',
    'loader-tela',
    'tela-app',
    'stat-saldo',
    'welcome-msg',
    'rel-periodo',
    'rel-pessoa',
    'rel-tbody',
    'fin-data',
    'fin-mes',
  ]) adicionar(id);
  for (const id of canvasIds) {
    const canvas = adicionar(id);
    canvas.getContext = () => ({ canvasId: id });
  }

  elementos.get('loader-tela').style.display = 'flex';
  elementos.get('tela-app').style.opacity = '0';
  elementos.get('rel-periodo').value = '6';
  elementos.get('rel-pessoa').value = 'todos';

  // Coleta os handlers registrados em document para disparar DOMContentLoaded.
  const ouvintesDocumento = new Map();

  const documento = {
    addEventListener(tipo, fn) {
      const lista = ouvintesDocumento.get(tipo) || [];
      lista.push(fn);
      ouvintesDocumento.set(tipo, lista);
    },
    getElementById: (id) => elementos.get(id) || null,
    querySelector: (seletor) => (seletor === '.view.ativa' ? { id: 'relatorios' } : null),
    querySelectorAll: () => [],
    createElement: () => elementoFalso(),
    documentElement: { getAttribute: () => 'light', setAttribute() {} },
  };

  // localStorage em memória: prova que o modo local persiste sem rede.
  const armazenamento = new Map();
  const localStorage = {
    getItem: (k) => (armazenamento.has(k) ? armazenamento.get(k) : null),
    setItem: (k, v) => { armazenamento.set(k, String(v)); },
    removeItem: (k) => { armazenamento.delete(k); },
  };

  // Supervisor espião: começa em 'pendente' e registra as chamadas relevantes.
  const supervisor = {
    estado: 'pendente',
    chamadas: { iniciarFase: 0, concluir: 0, falhar: 0 },
    iniciarFase() { this.chamadas.iniciarFase += 1; },
    estadoAtual() { return { estado: this.estado }; },
    concluir() {
      this.chamadas.concluir += 1;
      this.estado = 'pronto';
      return true;
    },
    falhar() {
      this.chamadas.falhar += 1;
      this.estado = 'erro';
      return true;
    },
  };

  const contexto = {
    console,
    crypto,
    Intl,
    Date,
    Math,
    JSON,
    setTimeout,
    clearTimeout,
    URL,
    Blob: class {},
    localStorage,
    document: documento,
    location: { pathname: '/app', replace() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    // Ponto-chave: MODO local e NENHUM `firebase` no contexto. Se o caminho
    // local tocasse `firebase.*` durante a montagem, o módulo lançaria
    // ReferenceError aqui — o teste falharia.
    PLANNERDUO_MODO: 'local',
    PlannerBootstrap: supervisor,
  };
  contexto.window = contexto;
  contexto.globalThis = contexto;

  vm.createContext(contexto);

  vm.runInContext(readFileSync(join(RAIZ_PUBLIC, 'auth-errors.js'), 'utf8'), contexto, { filename: 'auth-errors.js' });
  vm.runInContext(readFileSync(join(RAIZ_PUBLIC, 'core.js'), 'utf8'), contexto, { filename: 'core.js' });
  vm.runInContext(readFileSync(join(RAIZ_PUBLIC, 'app.js'), 'utf8'), contexto, { filename: 'app.js' });

  vm.runInContext('globalThis.__app = { Auth, Estado, ehModoLocal };', contexto);

  return {
    ...contexto.__app,
    contexto,
    elementos,
    armazenamento,
    supervisor,
    dispararDOMContentLoaded() {
      for (const fn of ouvintesDocumento.get('DOMContentLoaded') || []) fn();
    },
    temFirebaseNoContexto: Object.prototype.hasOwnProperty.call(contexto, 'firebase'),
  };
}

describe('modo local: inicialização abre o painel sem Firebase e conclui o bootstrap', () => {
  it('carrega o módulo em modo local mesmo sem `firebase` definido no contexto', () => {
    const h = carregarModoLocal();
    // Prova de que a carga do módulo não precisou dos SDKs.
    expect(h.temFirebaseNoContexto).toBe(false);
    expect(typeof h.ehModoLocal).toBe('function');
    expect(h.ehModoLocal()).toBe(true);
  });

  it('monta o painel sem lançar, esconde o loader e conclui — sem chamar falhar()', () => {
    const h = carregarModoLocal();
    expect(h.supervisor.estadoAtual().estado).toBe('pendente');

    // Dispara o handler real de DOMContentLoaded (ramo local).
    expect(() => h.dispararDOMContentLoaded()).not.toThrow();

    // Painel visível e bootstrap concluído.
    expect(h.elementos.get('tela-app').style.opacity).toBe('1');
    expect(h.supervisor.estadoAtual().estado).toBe('pronto');
    expect(h.supervisor.chamadas.concluir).toBe(1);
    // O aviso de demora nunca aparece no fluxo local normal.
    expect(h.supervisor.chamadas.falhar).toBe(0);

    // Identidade local sintética montada sem login.
    expect(h.Estado.casalId).toBe('local');
    expect(h.elementos.get('sidebar-user-name').textContent).toBeTruthy();
  });

  it('chamar Auth._entrarModoLocal() diretamente também conclui o bootstrap sem falhar()', () => {
    const h = carregarModoLocal();

    expect(() => h.Auth._entrarModoLocal()).not.toThrow();

    expect(h.elementos.get('tela-app').style.opacity).toBe('1');
    expect(h.supervisor.chamadas.concluir).toBe(1);
    expect(h.supervisor.chamadas.falhar).toBe(0);
    expect(h.Estado.usuarioUid).toBe('local');
  });
});
