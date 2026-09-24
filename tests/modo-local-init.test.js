// tests/modo-local-init.test.js — integração do MODO LOCAL sem Firebase.
//
// O harness carrega os scripts reais em contextos vm sem `firebase`, usa
// localStorage compartilhável entre instâncias e sessionStorage por aba.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

const RAIZ_PUBLIC = resolve(import.meta.dirname, '..', 'public');
const AUTH_SOURCE = readFileSync(join(RAIZ_PUBLIC, 'auth.html'), 'utf8');
const LOCAL_SOURCE = readFileSync(join(RAIZ_PUBLIC, 'local.js'), 'utf8');

/** Elemento DOM inerte — app.js só precisa não explodir ao tocá-lo. */
function elementoFalso() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    hidden: false,
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
 * `armazenamentoCompartilhado` permite simular duas abas sobre a mesma origem.
 */
function carregarModoLocal({ armazenamentoCompartilhado = new Map() } = {}) {
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

  const ouvintesDocumento = new Map();
  const ouvintesJanela = new Map();
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

  // Conta/sessão inicial para os testes de montagem. O documento é legado de
  // propósito: sem _revision, deve ser tratado como revisão zero.
  const usuarioLocal = { uid: 'local-teste', email: 'pessoa@local.invalid', displayName: 'Pessoa Local' };
  if (!armazenamentoCompartilhado.has('plannerduo-local:v1:users')) {
    armazenamentoCompartilhado.set('plannerduo-local:v1:users', JSON.stringify({
      [usuarioLocal.email]: { ...usuarioLocal, password: { salt: '', hash: '' } },
    }));
  }
  if (!armazenamentoCompartilhado.has('pd-cache:local-teste')) {
    armazenamentoCompartilhado.set('pd-cache:local-teste', JSON.stringify({
      membros: { [usuarioLocal.email]: usuarioLocal.displayName },
      nome1: usuarioLocal.displayName,
      nome2: null,
      financas: [], viagens: [], metas: [], checklist: [], orcamentos: {},
    }));
  }

  const operacoesStorage = { set: 0, remove: 0 };
  const localStorage = {
    getItem: (k) => (armazenamentoCompartilhado.has(k) ? armazenamentoCompartilhado.get(k) : null),
    setItem: (k, v) => {
      operacoesStorage.set += 1;
      armazenamentoCompartilhado.set(k, String(v));
    },
    removeItem: (k) => {
      operacoesStorage.remove += 1;
      armazenamentoCompartilhado.delete(k);
    },
  };
  const sessao = new Map([[
    'plannerduo-local:v1:session',
    JSON.stringify({ uid: usuarioLocal.uid, email: usuarioLocal.email }),
  ]]);
  const sessionStorage = {
    getItem: (k) => (sessao.has(k) ? sessao.get(k) : null),
    setItem: (k, v) => { sessao.set(k, String(v)); },
    removeItem: (k) => { sessao.delete(k); },
  };

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
    TextEncoder,
    btoa,
    atob,
    setTimeout,
    clearTimeout,
    URL,
    Blob: class {},
    localStorage,
    sessionStorage,
    document: documento,
    location: { pathname: '/app', hostname: 'localhost', href: '', replace() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    PLANNERDUO_MODO: 'local',
    PlannerBootstrap: supervisor,
    addEventListener(tipo, fn) {
      const lista = ouvintesJanela.get(tipo) || [];
      lista.push(fn);
      ouvintesJanela.set(tipo, lista);
    },
    removeEventListener(tipo, fn) {
      const lista = ouvintesJanela.get(tipo) || [];
      ouvintesJanela.set(tipo, lista.filter(item => item !== fn));
    },
  };
  contexto.window = contexto;
  contexto.globalThis = contexto;

  vm.createContext(contexto);
  vm.runInContext(readFileSync(join(RAIZ_PUBLIC, 'auth-errors.js'), 'utf8'), contexto, { filename: 'auth-errors.js' });
  vm.runInContext(readFileSync(join(RAIZ_PUBLIC, 'core.js'), 'utf8'), contexto, { filename: 'core.js' });
  vm.runInContext(LOCAL_SOURCE, contexto, { filename: 'local.js' });
  vm.runInContext(readFileSync(join(RAIZ_PUBLIC, 'app.js'), 'utf8'), contexto, { filename: 'app.js' });
  vm.runInContext('globalThis.__app = { Auth, Estado, DB, Convites, UI, ehModoLocal };', contexto);

  return {
    ...contexto.__app,
    contexto,
    elementos,
    armazenamento: armazenamentoCompartilhado,
    operacoesStorage,
    supervisor,
    dispararDOMContentLoaded() {
      for (const fn of ouvintesDocumento.get('DOMContentLoaded') || []) fn();
    },
    dispararStorage(key, newValue) {
      for (const fn of [...(ouvintesJanela.get('storage') || [])]) {
        fn({ key, newValue, storageArea: localStorage });
      }
    },
    quantidadeOuvintes(tipo) {
      return (ouvintesJanela.get(tipo) || []).length;
    },
    temFirebaseNoContexto: Object.prototype.hasOwnProperty.call(contexto, 'firebase'),
  };
}

function snapshotArmazenamento(mapa) {
  return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b));
}

describe('modo local: inicialização abre o painel sem Firebase e conclui o bootstrap', () => {
  it('carrega o módulo em modo local mesmo sem `firebase` definido no contexto', () => {
    const h = carregarModoLocal();
    expect(h.temFirebaseNoContexto).toBe(false);
    expect(typeof h.ehModoLocal).toBe('function');
    expect(h.ehModoLocal()).toBe(true);
  });

  it('monta o painel sem lançar, esconde o loader e conclui — sem chamar falhar()', () => {
    const h = carregarModoLocal();
    expect(h.supervisor.estadoAtual().estado).toBe('pendente');

    expect(() => h.dispararDOMContentLoaded()).not.toThrow();

    expect(h.elementos.get('tela-app').style.opacity).toBe('1');
    expect(h.supervisor.estadoAtual().estado).toBe('pronto');
    expect(h.supervisor.chamadas.concluir).toBe(1);
    expect(h.supervisor.chamadas.falhar).toBe(0);
    expect(h.Estado.casalId).toBe('local-teste');
    expect(h.Estado._localRevision).toBe(0);
    expect(h.elementos.get('sidebar-user-name').textContent).toBe('Pessoa Local');
  });

  it('chamar Auth._entrarModoLocal() diretamente também conclui o bootstrap sem falhar()', () => {
    const h = carregarModoLocal();

    expect(() => h.Auth._entrarModoLocal()).not.toThrow();

    expect(h.elementos.get('tela-app').style.opacity).toBe('1');
    expect(h.supervisor.chamadas.concluir).toBe(1);
    expect(h.supervisor.chamadas.falhar).toBe(0);
    expect(h.Estado.usuarioUid).toBe('local-teste');
    expect(h.quantidadeOuvintes('storage')).toBe(1);
  });
});

describe('modo local: autenticação exige credencial', () => {
  it('não expõe atalho de demonstração e oculta o botão alternativo no ramo local', () => {
    const h = carregarModoLocal();
    const nomeAtalhoDemo = 'signIn' + 'Demo';

    expect(Object.prototype.hasOwnProperty.call(h.contexto.PlannerLocal.auth, nomeAtalhoDemo)).toBe(false);
    expect(LOCAL_SOURCE).not.toContain(nomeAtalhoDemo);
    expect(AUTH_SOURCE).not.toContain(nomeAtalhoDemo);
    expect(AUTH_SOURCE).toContain('alternativo.hidden = true');
    expect(AUTH_SOURCE).toContain("if (MODO_LOCAL) return;");
  });

  it('reset exige a senha atual, rejeita prova incorreta e só aceita login com a senha nova', async () => {
    const h = carregarModoLocal();
    const authLocal = h.contexto.PlannerLocal.auth;
    const email = 'reset@local.invalid';

    await authLocal.createUser(email, 'senha-antiga', 'Conta Reset');
    await authLocal.signOut();

    await expect(authLocal.resetPassword(email, '', 'senha-nova')).rejects.toMatchObject({ code: 'auth/invalid-credential' });
    await expect(authLocal.resetPassword(email, 'senha-errada', 'senha-nova')).rejects.toMatchObject({ code: 'auth/invalid-credential' });
    await expect(authLocal.signIn(email, 'senha-antiga')).resolves.toMatchObject({ email });
    await authLocal.signOut();

    await expect(authLocal.resetPassword(email, 'senha-antiga', 'senha-nova')).resolves.toBeUndefined();
    await expect(authLocal.signIn(email, 'senha-antiga')).rejects.toMatchObject({ code: 'auth/invalid-credential' });
    await expect(authLocal.signIn(email, 'senha-nova')).resolves.toMatchObject({ email });
  });
});

describe('modo local: convite não permite reassociação implícita', () => {
  it('bloqueia segundo espaço sem alterar ponteiro ou membros', async () => {
    const h = carregarModoLocal();
    const authLocal = h.contexto.PlannerLocal.auth;
    const store = h.contexto.PlannerLocal.store;
    const core = h.contexto.PlannerCore;
    const agora = Date.now();

    const ana = await authLocal.createUser('ana@local.invalid', 'senha-ana', 'Ana');
    const conviteAna = core.criarConvite(store, ana.uid, ana.email, agora);
    await authLocal.signOut();

    const bia = await authLocal.createUser('bia@local.invalid', 'senha-bia', 'Bia');
    h.Auth._entrarModoLocal();
    await h.Convites.aceitar(conviteAna);
    expect(store.getDoc('casais', bia.uid)).toEqual({ casalIdRef: ana.uid });
    await authLocal.signOut();

    const carla = await authLocal.createUser('carla@local.invalid', 'senha-carla', 'Carla');
    const conviteCarla = core.criarConvite(store, carla.uid, carla.email, agora);
    await authLocal.signOut();
    await authLocal.signIn(bia.email, 'senha-bia');
    h.Auth._entrarModoLocal();

    const antes = snapshotArmazenamento(h.armazenamento);
    const mensagens = [];
    h.UI.toast = (titulo) => mensagens.push(titulo);
    await h.Convites.aceitar(conviteCarla);

    expect(mensagens).toContain('Você já participa de um espaço compartilhado.');
    expect(snapshotArmazenamento(h.armazenamento)).toEqual(antes);
    expect(store.getDoc('casais', bia.uid)).toEqual({ casalIdRef: ana.uid });
    expect(store.getDoc('casais', carla.uid).membros).toEqual({ [carla.email]: 'Carla' });
    expect(store.getDoc('casais', ana.uid).membros[bia.email]).toBe('Bia');
  });
});

describe('modo local: concorrência e sincronização entre abas', () => {
  it('preserva outro campo gravado por instância stale e bloqueia conflito no mesmo campo', async () => {
    const compartilhado = new Map();
    const abaA = carregarModoLocal({ armazenamentoCompartilhado: compartilhado });
    const abaB = carregarModoLocal({ armazenamentoCompartilhado: compartilhado });
    abaA.Auth._entrarModoLocal();
    abaB.Auth._entrarModoLocal();

    abaA.Estado.financas = [{ id: 'f-a', tipo: 'despesa', data: '2026-09-01', desc: 'A', valor: 10 }];
    expect(await abaA.DB.salvar('financas')).toBe(true);

    abaB.Estado.metas = [{ id: 'm-b', titulo: 'Meta B', alvo: 100, atual: 1, prazo: '2026-12-01' }];
    expect(await abaB.DB.salvar('metas')).toBe(true);

    let persistido = JSON.parse(compartilhado.get('pd-cache:local-teste'));
    expect(persistido.financas.map(item => item.id)).toEqual(['f-a']);
    expect(persistido.metas.map(item => item.id)).toEqual(['m-b']);
    expect(persistido._revision).toBe(2);

    abaB.Estado.financas = [{ id: 'f-b', tipo: 'despesa', data: '2026-09-02', desc: 'B', valor: 20 }];
    expect(await abaB.DB.salvar('financas')).toBe(true);
    persistido = JSON.parse(compartilhado.get('pd-cache:local-teste'));
    const revisaoAntesConflito = persistido._revision;

    const mensagens = [];
    abaA.UI.toast = (titulo) => mensagens.push(titulo);
    abaA.Estado.financas = [{ id: 'f-a2', tipo: 'despesa', data: '2026-09-03', desc: 'A2', valor: 30 }];
    expect(await abaA.DB.salvar('financas')).toBe(false);

    persistido = JSON.parse(compartilhado.get('pd-cache:local-teste'));
    expect(persistido._revision).toBe(revisaoAntesConflito);
    expect(persistido.financas.map(item => item.id)).toEqual(['f-b']);
    expect(abaA.Estado.financas.map(item => item.id)).toEqual(['f-b']);
    expect(mensagens).toContain('Dados atualizados em outra aba. Repita sua alteração.');
  });

  it('evento storage atualiza estado/render sem escrever e listener é idempotente/removível', () => {
    const compartilhado = new Map();
    const h = carregarModoLocal({ armazenamentoCompartilhado: compartilhado });
    h.Auth._entrarModoLocal();
    h.DB.ouvirNuvem();
    expect(h.quantidadeOuvintes('storage')).toBe(1);

    const chave = 'pd-cache:local-teste';
    const atual = JSON.parse(compartilhado.get(chave));
    const externo = {
      ...atual,
      metas: [{ id: 'externa', titulo: 'Outra aba', alvo: 50, atual: 5, prazo: '2026-12-31' }],
      _revision: 1,
      _updatedAt: new Date().toISOString(),
      _fieldRevisions: { metas: 1 },
    };
    compartilhado.set(chave, JSON.stringify(externo));
    const escritasAntes = h.operacoesStorage.set;

    h.dispararStorage(chave, JSON.stringify(externo));

    expect(h.Estado._localRevision).toBe(1);
    expect(h.Estado.metas.map(item => item.id)).toEqual(['externa']);
    expect(h.operacoesStorage.set).toBe(escritasAntes);

    h.Auth._finalizarLogoutLocal('auth.html');
    expect(h.quantidadeOuvintes('storage')).toBe(0);
    expect(compartilhado.has(chave)).toBe(true);
  });
});
