// tests/firebase-auth-bootstrap-stall.preservation.test.js
// Baseline de preservação observado antes da correção do bootstrap.
//
// Resultados públicos fixados no código não corrigido:
// - SESSION rápida precede login/cadastro/Google e libera um único observer;
// - ausência de usuário navega para auth.html sem revelar o shell privado;
// - falhas explícitas de recurso obrigatório/observer mostram recuperação acionável;
// - rejeição ou timeout do Firestore usa cache/UID e ainda abre o shell;
// - cache local bloqueado é tolerado pelo fluxo offline-first;
// - montagem bem-sucedida registra listener/render e remove o loader uma vez;
// - rejeição de logout preserva sessão, cache e página;
// - falha real da política SESSION inicia zero credenciais e nunca escolhe LOCAL;
// - diagnósticos expõem somente metadados allowlisted.
//
// Property 2: Preservation - sessão por aba e falhas críticas permanecem seguras.
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import bootstrap from '../public/bootstrap.js';
import authErrors from '../public/auth-errors.js';

const PUBLIC = resolve(import.meta.dirname, '..', 'public');
const AUTH_ERRORS_SOURCE = readFileSync(resolve(PUBLIC, 'auth-errors.js'), 'utf8');
const CORE_SOURCE = readFileSync(resolve(PUBLIC, 'core.js'), 'utf8');
const APP_SOURCE = readFileSync(resolve(PUBLIC, 'app.js'), 'utf8');
const AUTH_HTML = readFileSync(resolve(PUBLIC, 'auth.html'), 'utf8');
const AUTH_INLINE_SOURCE = [...AUTH_HTML.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((source) => source.includes('AUTH PAGE — script independente'));

if (!AUTH_INLINE_SOURCE) throw new Error('Script inline principal de auth.html não encontrado');

const SESSION = 'session';
const LOCAL = 'local';
const REQUIRED_FIREBASE_AUTH = 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth-compat.js';

async function drenarMicrotarefas(quantidade = 12) {
  for (let indice = 0; indice < quantidade; indice += 1) await Promise.resolve();
}

function criarAgendadorFalso() {
  let agora = 0;
  let proximoId = 1;
  const tarefas = new Map();

  function agendar(fn, atraso = 0, ...args) {
    const id = proximoId++;
    const ms = Number.isFinite(Number(atraso)) ? Math.max(0, Number(atraso)) : 0;
    tarefas.set(id, { id, instante: agora + ms, fn, args });
    return id;
  }

  function cancelar(id) {
    tarefas.delete(id);
  }

  async function avancarAte(instante) {
    if (instante < agora) throw new Error('O relógio falso não pode retroceder');
    while (true) {
      const proxima = [...tarefas.values()]
        .filter((tarefa) => tarefa.instante <= instante)
        .sort((a, b) => a.instante - b.instante || a.id - b.id)[0];
      if (!proxima) break;
      tarefas.delete(proxima.id);
      agora = proxima.instante;
      proxima.fn(...proxima.args);
      // Replica o checkpoint de microtarefas entre callbacks de timer. Isso é
      // relevante em 3000 ms: a resolução SESSION foi agendada antes do limite.
      await drenarMicrotarefas();
    }
    agora = instante;
    await drenarMicrotarefas();
  }

  return {
    agendar,
    cancelar,
    avancarAte,
    avancar: (ms) => avancarAte(agora + ms),
    agora: () => agora,
    pendentes: () => tarefas.size,
  };
}

function criarElementoFalso(id = '') {
  const ouvintes = new Map();
  const classes = new Set();
  const atributos = {};
  const metricas = { classesAdicionadas: [], remocoes: 0 };

  const elemento = {
    id,
    value: '',
    type: 'text',
    textContent: '',
    innerHTML: '',
    className: '',
    hidden: false,
    disabled: false,
    style: {},
    dataset: {},
    children: [],
    atributos,
    metricas,
    classList: {
      add(...nomes) {
        for (const nome of nomes) {
          classes.add(nome);
          metricas.classesAdicionadas.push(nome);
        }
      },
      remove(...nomes) { nomes.forEach((nome) => classes.delete(nome)); },
      contains(nome) { return classes.has(nome); },
      replace(anterior, novo) {
        classes.delete(anterior);
        classes.add(novo);
      },
    },
    setAttribute(nome, valor) { atributos[nome] = String(valor); },
    getAttribute(nome) { return Object.prototype.hasOwnProperty.call(atributos, nome) ? atributos[nome] : null; },
    addEventListener(tipo, fn) {
      const lista = ouvintes.get(tipo) || [];
      lista.push(fn);
      ouvintes.set(tipo, lista);
    },
    removeEventListener(tipo, fn) {
      ouvintes.set(tipo, (ouvintes.get(tipo) || []).filter((item) => item !== fn));
    },
    emitir(tipo, evento = {}) {
      return (ouvintes.get(tipo) || []).map((fn) => fn({ type: tipo, target: elemento, ...evento }));
    },
    appendChild(filho) { this.children.push(filho); return filho; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    reset() {},
    focus() {},
    remove() { metricas.remocoes += 1; },
  };
  return elemento;
}

function criarDocumentoFalso() {
  const elementos = new Map();
  const ouvintes = new Map();
  let criados = 0;

  function obter(id) {
    if (!elementos.has(id)) elementos.set(id, criarElementoFalso(id));
    return elementos.get(id);
  }

  const documentElement = criarElementoFalso('document-element');
  documentElement.setAttribute('data-theme', 'light');

  const documento = {
    documentElement,
    getElementById: (id) => obter(id),
    createElement: () => criarElementoFalso(`criado-${++criados}`),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(tipo, fn) {
      const lista = ouvintes.get(tipo) || [];
      lista.push(fn);
      ouvintes.set(tipo, lista);
    },
    removeEventListener(tipo, fn) {
      ouvintes.set(tipo, (ouvintes.get(tipo) || []).filter((item) => item !== fn));
    },
    emitir(tipo, evento = {}) {
      return (ouvintes.get(tipo) || []).map((fn) => fn({ type: tipo, target: documento, ...evento }));
    },
  };

  obter('loader-tela').style.display = 'flex';
  obter('loader-tela').setAttribute('aria-busy', 'true');
  obter('loader-acoes').hidden = true;
  obter('tela-app').style.opacity = '0';
  obter('auth-bootstrap-error').hidden = true;
  obter('auth-bootstrap-detail').textContent = '';

  return { documento, obter, elementos };
}

function criarAlvoDeEventos() {
  const ouvintes = new Map();
  return {
    addEventListener(tipo, fn) {
      const lista = ouvintes.get(tipo) || [];
      lista.push(fn);
      ouvintes.set(tipo, lista);
    },
    removeEventListener(tipo, fn) {
      ouvintes.set(tipo, (ouvintes.get(tipo) || []).filter((item) => item !== fn));
    },
    emitir(tipo, evento = {}) {
      return (ouvintes.get(tipo) || []).map((fn) => fn(evento));
    },
  };
}

function criarSupervisorInstrumentado({ pagina, documentoFalso, agendador }) {
  const alvo = criarAlvoDeEventos();
  const registros = [];
  const metricas = { conclusoes: 0, falhas: [] };
  const supervisor = bootstrap.criarSupervisorBootstrap({
    janela: alvo,
    documento: documentoFalso.documento,
    agendar: agendador.agendar,
    cancelar: agendador.cancelar,
    logger: { warn: (...args) => registros.push(args) },
  });
  supervisor.iniciar({ pagina, timeoutMs: 10000 });

  // O supervisor público é congelado; envolver seus métodos por Proxy viola as
  // invariantes de propriedades não configuráveis. Uma fachada disjunta mantém
  // a instrumentação e encaminha também futuras APIs de fase do supervisor.
  const facade = {};
  for (const propriedade of Object.keys(supervisor)) {
    if (propriedade === 'concluir') {
      facade.concluir = (...args) => {
        metricas.conclusoes += 1;
        return supervisor.concluir(...args);
      };
    } else if (propriedade === 'falhar') {
      facade.falhar = (categoria, ...args) => {
        metricas.falhas.push(categoria);
        return supervisor.falhar(categoria, ...args);
      };
    } else {
      const valor = supervisor[propriedade];
      facade[propriedade] = typeof valor === 'function'
        ? (...args) => valor(...args)
        : valor;
    }
  }

  return { alvo, facade, supervisor, registros, metricas };
}

function criarStorageFalso({ inicial = {}, bloquearLeitura = false, bloquearEscrita = false } = {}) {
  const dados = new Map(Object.entries(inicial));
  const metricas = { leituras: [], escritas: [], remocoes: [] };
  return {
    storage: {
      getItem(chave) {
        metricas.leituras.push(chave);
        if (bloquearLeitura) throw new Error('storage-bloqueado');
        return dados.has(chave) ? dados.get(chave) : null;
      },
      setItem(chave, valor) {
        metricas.escritas.push([chave, String(valor)]);
        if (bloquearEscrita) throw new Error('storage-bloqueado');
        dados.set(chave, String(valor));
      },
      removeItem(chave) {
        metricas.remocoes.push(chave);
        if (bloquearEscrita) throw new Error('storage-bloqueado');
        dados.delete(chave);
      },
      key(indice) { return [...dados.keys()][indice] || null; },
      get length() { return dados.size; },
    },
    dados,
    metricas,
  };
}

function promessaAgendada(agendador, atrasoMs, resultado, valor) {
  return new Promise((resolvePromise, rejectPromise) => {
    agendador.agendar(() => {
      if (resultado === 'reject') rejectPromise(valor);
      else resolvePromise(valor);
    }, atrasoMs);
  });
}

function criarHarnessAuth({
  atrasoPersistenciaMs = 0,
  resultadoPersistencia = 'resolve',
  erroPersistencia = { code: 'auth/web-storage-unsupported', message: 'raw-storage-detail' },
} = {}) {
  const agendador = criarAgendadorFalso();
  const documentoFalso = criarDocumentoFalso();
  const supervisor = criarSupervisorInstrumentado({ pagina: 'auth', documentoFalso, agendador });
  const storage = criarStorageFalso();
  const registros = [];
  const metricas = {
    persistencias: [],
    credenciais: [],
    eventos: [],
    destinos: [],
    redirectResults: 0,
  };

  const auth = {
    languageCode: '',
    setPersistence(tipo) {
      metricas.persistencias.push(tipo);
      metricas.eventos.push(`persistencia-solicitada:${tipo}`);
      const rejeitar = tipo === SESSION && resultadoPersistencia === 'reject';
      return promessaAgendada(
        agendador,
        atrasoPersistenciaMs,
        rejeitar ? 'reject' : 'resolve',
        rejeitar ? erroPersistencia : tipo
      ).then(
        (valor) => {
          metricas.eventos.push(`persistencia-resolvida:${tipo}`);
          return valor;
        },
        (erro) => {
          metricas.eventos.push(`persistencia-rejeitada:${tipo}`);
          throw erro;
        }
      );
    },
    signInWithEmailAndPassword() {
      metricas.credenciais.push('login');
      metricas.eventos.push('credencial:login');
      return Promise.resolve({ user: { uid: 'uid-login-falso' } });
    },
    createUserWithEmailAndPassword() {
      metricas.credenciais.push('cadastro');
      metricas.eventos.push('credencial:cadastro');
      return Promise.resolve({ user: { uid: 'uid-cadastro-falso' } });
    },
    signInWithRedirect() {
      metricas.credenciais.push('google');
      metricas.eventos.push('credencial:google');
      return Promise.resolve();
    },
    getRedirectResult() {
      metricas.redirectResults += 1;
      return Promise.resolve(null);
    },
    signOut: () => Promise.resolve(),
    sendPasswordResetEmail: () => Promise.resolve(),
  };

  function authFactory() { return auth; }
  authFactory.Auth = { Persistence: { SESSION, LOCAL } };
  authFactory.GoogleAuthProvider = class {
    setCustomParameters() {}
  };

  const docRef = {
    get: () => Promise.resolve({ exists: false, data: () => ({}) }),
    set: () => Promise.resolve(),
    update: () => Promise.resolve(),
  };
  const firebase = {
    apps: [],
    initializeApp() { this.apps.push({}); },
    auth: authFactory,
    firestore: () => ({ collection: () => ({ doc: () => docRef }) }),
  };

  const location = {
    pathname: '/auth',
    href: 'auth.html',
    replace(destino) {
      metricas.destinos.push(destino);
      this.href = destino;
    },
  };
  const contexto = {
    console: {
      warn: (...args) => registros.push(args),
      error: (...args) => registros.push(args),
      log() {},
    },
    document: documentoFalso.documento,
    location,
    localStorage: storage.storage,
    firebase,
    setTimeout: agendador.agendar,
    clearTimeout: agendador.cancelar,
    confirm: () => true,
  };
  contexto.window = contexto;
  contexto.globalThis = contexto;
  contexto.PlannerBootstrap = supervisor.facade;

  vm.createContext(contexto);
  vm.runInContext(AUTH_ERRORS_SOURCE, contexto, { filename: 'auth-errors.js' });
  vm.runInContext(AUTH_INLINE_SOURCE, contexto, { filename: 'auth.html:inline' });

  documentoFalso.obter('login-email').value = 'pessoa@example.invalid';
  documentoFalso.obter('login-senha').value = 'senha-falsa';
  documentoFalso.obter('cad-nome1').value = 'Pessoa';
  documentoFalso.obter('cad-email').value = 'pessoa@example.invalid';
  documentoFalso.obter('cad-senha').value = 'senha-falsa';

  return { contexto, auth, agendador, documentoFalso, supervisor, storage, registros, metricas };
}

async function executarCredencialAuth(harness, fluxo) {
  let execucao;
  const eventoSubmit = { preventDefault() {} };
  if (fluxo === 'login') {
    [execucao] = harness.documentoFalso.obter('form-login').emitir('submit', eventoSubmit);
  } else if (fluxo === 'cadastro') {
    [execucao] = harness.documentoFalso.obter('form-cadastro').emitir('submit', eventoSubmit);
  } else {
    execucao = vm.runInContext('loginGoogle()', harness.contexto);
  }

  await harness.agendador.avancarAte(harness.agendador.agora() + harness.atrasoPersistenciaMs);
  await drenarMicrotarefas();
  await execucao;
  await drenarMicrotarefas();
}

async function observarAuthRapida(atrasoPersistenciaMs, fluxo) {
  const harness = criarHarnessAuth({ atrasoPersistenciaMs });
  // Mantém o atraso acessível sem depender do relógio real.
  harness.atrasoPersistenciaMs = atrasoPersistenciaMs;
  await executarCredencialAuth(harness, fluxo);
  return {
    persistencias: harness.metricas.persistencias,
    credenciais: harness.metricas.credenciais,
    eventos: harness.metricas.eventos,
    destinos: harness.metricas.destinos,
  };
}

function criarHarnessApp({
  atrasoPersistenciaMs = 0,
  resultadoPersistencia = 'resolve',
  resultadoFirestore = 'resolve',
  erroFirestore = { code: 'firestore/indisponivel', message: 'raw-firestore-detail' },
  storageInicial = {},
  bloquearStorageLeitura = false,
  bloquearStorageEscrita = false,
  resultadoLogout = 'resolve',
  erroLogout = { code: 'auth/network-request-failed', message: 'raw-logout-detail' },
} = {}) {
  const agendador = criarAgendadorFalso();
  const documentoFalso = criarDocumentoFalso();
  const supervisor = criarSupervisorInstrumentado({ pagina: 'app', documentoFalso, agendador });
  const storage = criarStorageFalso({
    inicial: storageInicial,
    bloquearLeitura: bloquearStorageLeitura,
    bloquearEscrita: bloquearStorageEscrita,
  });
  const registros = [];
  const metricas = {
    persistencias: [],
    observerCalls: 0,
    observerNext: null,
    observerError: null,
    signOutCalls: 0,
    firestoreGets: 0,
    firestoreSets: 0,
    listenerCalls: 0,
    unsubscribeCalls: 0,
    destinos: [],
  };

  const auth = {
    currentUser: null,
    setPersistence(tipo) {
      metricas.persistencias.push(tipo);
      return promessaAgendada(
        agendador,
        atrasoPersistenciaMs,
        resultadoPersistencia,
        resultadoPersistencia === 'reject' ? { code: 'auth/web-storage-unsupported' } : tipo
      );
    },
    onAuthStateChanged(onNext, onError) {
      metricas.observerCalls += 1;
      metricas.observerNext = onNext;
      metricas.observerError = onError;
      return () => { metricas.unsubscribeCalls += 1; };
    },
    signOut() {
      metricas.signOutCalls += 1;
      return resultadoLogout === 'reject' ? Promise.reject(erroLogout) : Promise.resolve();
    },
  };

  function authFactory() { return auth; }
  authFactory.Auth = { Persistence: { SESSION, LOCAL } };

  const docRef = {
    get() {
      metricas.firestoreGets += 1;
      if (resultadoFirestore === 'pending') return new Promise(() => {});
      if (resultadoFirestore === 'reject') return Promise.reject(erroFirestore);
      return Promise.resolve({ exists: true, data: () => ({ casalIdRef: 'casal-falso' }) });
    },
    set() { metricas.firestoreSets += 1; return Promise.resolve(); },
    update: () => Promise.resolve(),
    onSnapshot() {
      metricas.listenerCalls += 1;
      return () => { metricas.unsubscribeCalls += 1; };
    },
  };
  const db = { collection: () => ({ doc: () => docRef }) };
  const firebase = {
    apps: [],
    initializeApp() { this.apps.push({}); },
    auth: authFactory,
    firestore: () => db,
  };

  const location = {
    pathname: '/app',
    href: 'app.html',
    replace(destino) {
      metricas.destinos.push(destino);
      this.href = destino;
    },
  };
  const contexto = {
    console: {
      warn: (...args) => registros.push(args),
      error: (...args) => registros.push(args),
      log() {},
    },
    crypto: { randomUUID: () => 'uuid-falso' },
    document: documentoFalso.documento,
    location,
    localStorage: storage.storage,
    firebase,
    setTimeout: agendador.agendar,
    clearTimeout: agendador.cancelar,
    confirm: () => true,
    alert() {},
    prompt: () => null,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    URL,
    Blob: class {},
    Chart: class { destroy() {} },
    // Preservação (Property 2): este harness observa o caminho Firebase
    // (observer, resolverCasalId, signOut). modo-local-sem-firebase tornou
    // 'local' o padrão, então fixamos o modo firebase para preservar o baseline.
    PLANNERDUO_MODO: 'firebase',
  };
  contexto.window = contexto;
  contexto.globalThis = contexto;
  contexto.PlannerBootstrap = supervisor.facade;

  vm.createContext(contexto);
  vm.runInContext(AUTH_ERRORS_SOURCE, contexto, { filename: 'auth-errors.js' });
  vm.runInContext(CORE_SOURCE, contexto, { filename: 'core.js' });
  vm.runInContext(APP_SOURCE, contexto, { filename: 'app.js' });
  // modo-local-sem-firebase moveu a inicialização do Firebase para
  // iniciarFirebase(), antes feita no topo do módulo. Os cenários de preservação
  // que exercitam auth/db diretamente (observer, resolverCasalId, signOut) sem
  // passar por DOMContentLoaded precisam desse setup, idêntico ao antigo topo.
  vm.runInContext('iniciarFirebase();', contexto);
  vm.runInContext(
    'globalThis.__plannerApp = { Utils, UI, Auth, DB, Estado, Render, ServicoBusca };',
    contexto
  );

  return {
    contexto,
    app: contexto.__plannerApp,
    auth,
    agendador,
    documentoFalso,
    supervisor,
    storage,
    registros,
    metricas,
    atrasoPersistenciaMs,
  };
}

async function observarObserverAposSessaoRapida(atrasoPersistenciaMs) {
  const harness = criarHarnessApp({ atrasoPersistenciaMs });
  harness.documentoFalso.documento.emitir('DOMContentLoaded');
  await harness.agendador.avancarAte(atrasoPersistenciaMs);
  await drenarMicrotarefas();
  return {
    observerCalls: harness.metricas.observerCalls,
    appVisivel: harness.documentoFalso.obter('tela-app').style.opacity === '1',
  };
}

function resultadoRecuperacao(harness) {
  const loader = harness.documentoFalso.obter('loader-tela');
  return {
    estado: harness.supervisor.supervisor.estadoAtual().estado,
    acoesVisiveis: harness.documentoFalso.obter('loader-acoes').hidden === false,
    ocupado: loader.getAttribute('aria-busy') !== 'false',
    mensagem: harness.documentoFalso.obter('loader-msg').textContent,
  };
}

async function observarSemUsuario() {
  const harness = criarHarnessApp();
  let montagens = 0;
  harness.app.Auth._entrarNoApp = () => { montagens += 1; };
  await harness.app.Auth._processarEstado(null);
  return {
    destino: harness.metricas.destinos.at(-1),
    montagens,
    appVisivel: harness.documentoFalso.obter('tela-app').style.opacity === '1',
  };
}

function observarFalhaRecursoObrigatorio() {
  const agendador = criarAgendadorFalso();
  const documentoFalso = criarDocumentoFalso();
  const supervisor = criarSupervisorInstrumentado({ pagina: 'app', documentoFalso, agendador });
  supervisor.alvo.emitir('error', {
    target: {
      tagName: 'SCRIPT',
      src: REQUIRED_FIREBASE_AUTH,
      dataset: { bootstrapRequired: 'true' },
      getAttribute(nome) {
        if (nome === 'src') return REQUIRED_FIREBASE_AUTH;
        if (nome === 'data-bootstrap-required') return 'true';
        return null;
      },
    },
  });
  return {
    recuperacao: resultadoRecuperacao({ documentoFalso, supervisor }),
    registros: supervisor.registros,
  };
}

async function observarFalhaObserver(segredo) {
  const harness = criarHarnessApp();
  harness.app.Auth.iniciarObserver();
  harness.metricas.observerError({
    code: `auth/observer-${segredo}`,
    message: `raw-observer-${segredo}`,
    token: `token-${segredo}`,
  });
  await drenarMicrotarefas();
  return {
    observerCalls: harness.metricas.observerCalls,
    recuperacao: resultadoRecuperacao(harness),
    serializado: JSON.stringify([harness.registros, harness.supervisor.registros]),
  };
}

async function observarFallbackFirestore({ resultado, cacheId, uid, bloquearCache, segredo }) {
  const harness = criarHarnessApp({
    resultadoFirestore: resultado,
    erroFirestore: {
      code: `firestore/private-${segredo}`,
      message: `raw-firestore-${segredo}`,
      document: `payload-${segredo}`,
    },
    storageInicial: cacheId ? { 'pd-casalId': cacheId } : {},
    bloquearStorageLeitura: bloquearCache,
    bloquearStorageEscrita: bloquearCache,
  });
  let montagens = 0;
  harness.app.Auth._entrarNoApp = () => {
    montagens += 1;
    harness.documentoFalso.obter('tela-app').style.opacity = '1';
  };
  const user = {
    uid,
    email: 'pessoa@example.invalid',
    displayName: 'Pessoa',
  };
  const processamento = harness.app.Auth._processarEstado(user);
  if (resultado === 'pending') await harness.agendador.avancarAte(6000);
  await processamento;
  await drenarMicrotarefas();
  return {
    casalId: harness.app.Estado.casalId,
    montagens,
    appVisivel: harness.documentoFalso.obter('tela-app').style.opacity === '1',
    serializado: JSON.stringify(harness.registros),
  };
}

function instrumentarMontagem(harness, { manterCacheReal = false } = {}) {
  const chamadas = {
    atualizarNomes: 0,
    cache: 0,
    popularMes: 0,
    popularViagens: 0,
    historico: 0,
    listener: 0,
    setupNav: 0,
    render: 0,
  };
  const { UI, DB, Render, ServicoBusca } = harness.app;
  const cacheReal = DB.carregarCache;

  UI.atualizarNomes = () => { chamadas.atualizarNomes += 1; };
  DB.carregarCache = () => {
    chamadas.cache += 1;
    if (manterCacheReal) return cacheReal();
    return undefined;
  };
  Render.popularSelectMes = () => { chamadas.popularMes += 1; };
  Render.popularSelectViagens = () => { chamadas.popularViagens += 1; };
  ServicoBusca.carregarHistorico = () => { chamadas.historico += 1; };
  DB.ouvirNuvem = () => { chamadas.listener += 1; };
  UI.setupNav = () => { chamadas.setupNav += 1; };
  Render.tudo = () => { chamadas.render += 1; };
  return chamadas;
}

async function observarMontagem({ bloquearCache = false } = {}) {
  const harness = criarHarnessApp({
    bloquearStorageLeitura: bloquearCache,
    bloquearStorageEscrita: bloquearCache,
  });
  harness.app.Estado.casalId = 'casal-falso';
  const chamadas = instrumentarMontagem(harness, { manterCacheReal: bloquearCache });
  harness.app.Auth._entrarNoApp({
    uid: 'uid-falso',
    email: 'pessoa@example.invalid',
    displayName: 'Pessoa',
  });
  await harness.agendador.avancarAte(500);

  const loader = harness.documentoFalso.obter('loader-tela');
  return {
    chamadas,
    appVisivel: harness.documentoFalso.obter('tela-app').style.opacity === '1',
    loaderOculto: loader.style.display === 'none',
    remocoesLoader: loader.metricas.classesAdicionadas.filter((nome) => nome === 'saindo').length,
    conclusoes: harness.supervisor.metricas.conclusoes,
  };
}

async function observarLogoutRejeitado(segredo) {
  const harness = criarHarnessApp({
    resultadoLogout: 'reject',
    erroLogout: {
      code: `auth/private-${segredo}`,
      message: `raw-logout-${segredo}`,
      credential: `credential-${segredo}`,
    },
    storageInicial: {
      'pd-casalId': 'casal-preservado',
      'pd-cache:casal-preservado': 'cache-preservado',
    },
  });
  const toasts = [];
  harness.app.UI.toast = (...args) => toasts.push(args);
  let unsubscribeCalls = 0;
  harness.app.Estado.casalId = 'casal-preservado';
  harness.app.Estado.unsubscribe = () => { unsubscribeCalls += 1; };

  await harness.app.Auth.logout();
  await drenarMicrotarefas();
  return {
    signOutCalls: harness.metricas.signOutCalls,
    unsubscribeCalls,
    remocoesStorage: harness.storage.metricas.remocoes,
    destino: harness.contexto.location.href,
    toasts,
    serializado: JSON.stringify(harness.registros),
  };
}

async function observarFalhaPoliticaSession(fluxo, segredo) {
  const erro = {
    code: 'auth/web-storage-unsupported',
    message: `raw-storage-${segredo}`,
    token: `token-${segredo}`,
  };
  const harness = criarHarnessAuth({
    resultadoPersistencia: 'reject',
    erroPersistencia: erro,
  });
  harness.atrasoPersistenciaMs = 0;
  await executarCredencialAuth(harness, fluxo);
  return {
    persistencias: harness.metricas.persistencias,
    credenciais: harness.metricas.credenciais,
    estado: harness.supervisor.supervisor.estadoAtual().estado,
    detalhe: harness.documentoFalso.obter('auth-bootstrap-detail').textContent,
    serializado: JSON.stringify([harness.registros, harness.supervisor.registros]),
  };
}

function observarDiagnosticoSanitizado(segredo) {
  const proibidos = [
    `pessoa-${segredo}@example.invalid`,
    `uid-${segredo}`,
    `token-${segredo}`,
    `raw-message-${segredo}`,
    `document-${segredo}`,
    `password-${segredo}`,
  ];
  const erro = {
    code: `auth/private-${segredo}`,
    message: proibidos[3],
    email: proibidos[0],
    uid: proibidos[1],
    token: proibidos[2],
    password: proibidos[5],
    customData: { document: proibidos[4] },
  };
  const registros = [];
  const diagnostico = authErrors.registrarErroAuth(
    erro,
    `operacao-private-${segredo}`,
    { warn: (...args) => registros.push(args) }
  );
  return { diagnostico, serializado: JSON.stringify(registros), proibidos };
}

function ehCondicaoBug(cenario) {
  const persistencia = cenario.persistence || {};
  const latePersistence = cenario.page === 'APP'
    && cenario.hasEstablishedSession
    && persistencia.outcome === 'SUCCESS'
    && persistencia.delayMs > 3000
    && cenario.criticalOperationsWouldSucceed;
  const storageInterference = cenario.page === 'APP'
    && cenario.hasEstablishedSession
    && ['DELAYED', 'STORAGE_REJECTION'].includes(persistencia.outcome)
    && (cenario.authObserverWouldSettle || cenario.reportedCategory === 'GENERIC_CONNECTION');
  const unrelatedRejection = cenario.bootstrapPending
    && cenario.rejectionOwner !== 'BOOTSTRAP'
    && cenario.criticalOperationsWouldSucceed;
  const phases = cenario.phases || [];
  const compoundedBudget = phases.every((phase) => phase.durationMs <= phase.contractMs)
    && phases.reduce((total, phase) => total + phase.durationMs, 0) > 10000;
  const strandedNavigation = cenario.redirectRequired
    && cenario.supervisorCompletedBeforeNavigation
    && ['THROWS', 'NO_PAGE_EXIT'].includes(cenario.navigationOutcome);
  return latePersistence
    || storageInterference
    || unrelatedRejection
    || compoundedBudget
    || strandedNavigation;
}

function cenarioPreservado(kind, dados = {}) {
  return {
    kind,
    page: 'APP',
    hasEstablishedSession: true,
    persistence: { outcome: 'SUCCESS', delayMs: 0 },
    criticalOperationsWouldSucceed: true,
    authObserverWouldSettle: false,
    reportedCategory: null,
    bootstrapPending: false,
    rejectionOwner: 'BOOTSTRAP',
    phases: [{ durationMs: 10, contractMs: 1000 }],
    redirectRequired: false,
    supervisorCompletedBeforeNavigation: false,
    navigationOutcome: 'SUCCESS',
    ...dados,
  };
}

const segredoArb = fc.hexaString({ minLength: 8, maxLength: 24 });
const cenarioPreservadoArb = fc.oneof(
  fc.record({
    delayMs: fc.integer({ min: 0, max: 3000 }),
    fluxo: fc.constantFrom('login', 'cadastro', 'google'),
  }).map(({ delayMs, fluxo }) => cenarioPreservado('fast-session', {
    page: 'AUTH',
    hasEstablishedSession: false,
    persistence: { outcome: 'SUCCESS', delayMs },
    delayMs,
    fluxo,
  })),
  fc.constant(cenarioPreservado('no-user', {
    hasEstablishedSession: false,
    redirectRequired: true,
    supervisorCompletedBeforeNavigation: true,
    navigationOutcome: 'SUCCESS',
  })),
  fc.constant(cenarioPreservado('required-resource', {
    criticalOperationsWouldSucceed: false,
  })),
  segredoArb.map((segredo) => cenarioPreservado('observer-failure', {
    criticalOperationsWouldSucceed: false,
    segredo,
  })),
  fc.record({
    resultado: fc.constantFrom('reject', 'pending'),
    usarCache: fc.boolean(),
    bloquearCache: fc.boolean(),
    segredo: segredoArb,
  }).map((dados) => cenarioPreservado('firestore-fallback', dados)),
  fc.boolean().map((bloquearCache) => cenarioPreservado('shell-mount', { bloquearCache })),
  segredoArb.map((segredo) => cenarioPreservado('logout-rejection', { segredo })),
  fc.record({
    fluxo: fc.constantFrom('login', 'cadastro', 'google'),
    segredo: segredoArb,
  }).map((dados) => cenarioPreservado('storage-policy-failure', {
    ...dados,
    page: 'AUTH',
    hasEstablishedSession: false,
    persistence: { outcome: 'STORAGE_REJECTION', delayMs: 0 },
    criticalOperationsWouldSucceed: false,
  })),
  segredoArb.map((segredo) => cenarioPreservado('sanitized-diagnostics', { segredo }))
);

async function afirmarCenarioPreservado(cenario) {
  expect(ehCondicaoBug(cenario)).toBe(false);

  if (cenario.kind === 'fast-session') {
    const auth = await observarAuthRapida(cenario.delayMs, cenario.fluxo);
    const app = await observarObserverAposSessaoRapida(cenario.delayMs);
    expect(auth.persistencias).toEqual([SESSION]);
    expect(auth.credenciais).toEqual([cenario.fluxo]);
    expect(auth.eventos.indexOf(`persistencia-resolvida:${SESSION}`))
      .toBeLessThan(auth.eventos.indexOf(`credencial:${cenario.fluxo}`));
    expect(app.observerCalls).toBe(1);
    return;
  }

  if (cenario.kind === 'no-user') {
    await expect(observarSemUsuario()).resolves.toEqual({
      destino: 'auth.html',
      montagens: 0,
      appVisivel: false,
    });
    return;
  }

  if (cenario.kind === 'required-resource') {
    const observado = observarFalhaRecursoObrigatorio();
    expect(observado.recuperacao).toMatchObject({ estado: 'erro', acoesVisiveis: true, ocupado: false });
    expect(observado.registros[0][1]).toMatchObject({ categoria: 'recurso' });
    return;
  }

  if (cenario.kind === 'observer-failure') {
    const observado = await observarFalhaObserver(cenario.segredo);
    expect(observado.observerCalls).toBe(1);
    expect(observado.recuperacao).toMatchObject({ estado: 'erro', acoesVisiveis: true, ocupado: false });
    expect(observado.serializado).not.toContain(cenario.segredo);
    return;
  }

  if (cenario.kind === 'firestore-fallback') {
    const uid = `uid-${cenario.segredo}`;
    const cacheId = cenario.usarCache ? `cache-${cenario.segredo}` : null;
    const observado = await observarFallbackFirestore({
      resultado: cenario.resultado,
      cacheId,
      uid,
      bloquearCache: cenario.bloquearCache,
      segredo: cenario.segredo,
    });
    const esperado = !cenario.bloquearCache && cacheId ? cacheId : uid;
    expect(observado).toMatchObject({ casalId: esperado, montagens: 1, appVisivel: true });
    expect(observado.serializado).not.toContain(cenario.segredo);
    return;
  }

  if (cenario.kind === 'shell-mount') {
    const observado = await observarMontagem({ bloquearCache: cenario.bloquearCache });
    expect(observado).toMatchObject({
      appVisivel: true,
      loaderOculto: true,
      remocoesLoader: 1,
      conclusoes: 1,
    });
    expect(observado.chamadas).toMatchObject({ cache: 1, listener: 1, setupNav: 1, render: 1 });
    return;
  }

  if (cenario.kind === 'logout-rejection') {
    const observado = await observarLogoutRejeitado(cenario.segredo);
    expect(observado).toMatchObject({
      signOutCalls: 1,
      unsubscribeCalls: 0,
      remocoesStorage: [],
      destino: 'app.html',
    });
    expect(observado.toasts[0].join(' ')).toContain('sessão continua ativa');
    expect(observado.serializado).not.toContain(cenario.segredo);
    return;
  }

  if (cenario.kind === 'storage-policy-failure') {
    const observado = await observarFalhaPoliticaSession(cenario.fluxo, cenario.segredo);
    expect(observado.persistencias).toEqual([SESSION]);
    expect(observado.persistencias).not.toContain(LOCAL);
    expect(observado.credenciais).toEqual([]);
    expect(observado.estado).toBe('erro');
    expect(observado.detalhe.toLowerCase()).toContain('armazenamento');
    expect(observado.serializado).not.toContain(cenario.segredo);
    return;
  }

  const observado = observarDiagnosticoSanitizado(cenario.segredo);
  expect(observado.diagnostico).toEqual({
    evento: 'firebase-auth-error',
    operacao: 'autenticacao',
    codigo: 'auth/unknown',
    categoria: 'desconhecido',
    credencialLegada: false,
    codigoRecebido: true,
    mensagemRecebida: true,
  });
  for (const proibido of observado.proibidos) expect(observado.serializado).not.toContain(proibido);
}

describe('observação-first da baseline não corrigida', () => {
  it('mantém SESSION antes de login, cadastro e Google e libera o observer uma vez', async () => {
    for (const fluxo of ['login', 'cadastro', 'google']) {
      const auth = await observarAuthRapida(3000, fluxo);
      expect(auth.persistencias).toEqual([SESSION]);
      expect(auth.credenciais).toEqual([fluxo]);
      expect(auth.eventos.indexOf(`persistencia-resolvida:${SESSION}`))
        .toBeLessThan(auth.eventos.indexOf(`credencial:${fluxo}`));
    }
    await expect(observarObserverAposSessaoRapida(3000)).resolves.toMatchObject({ observerCalls: 1 });
  });

  it('redireciona usuário ausente para auth sem revelar o shell privado', async () => {
    await expect(observarSemUsuario()).resolves.toEqual({
      destino: 'auth.html',
      montagens: 0,
      appVisivel: false,
    });
  });

  it('mantém falhas explícitas de recurso obrigatório e observer acionáveis', async () => {
    const recurso = observarFalhaRecursoObrigatorio();
    const observer = await observarFalhaObserver('baseline-observer');
    expect(recurso.recuperacao).toMatchObject({ estado: 'erro', acoesVisiveis: true, ocupado: false });
    expect(observer.recuperacao).toMatchObject({ estado: 'erro', acoesVisiveis: true, ocupado: false });
  });

  it('usa fallback seguro após rejeição e timeout próprios do Firestore', async () => {
    const rejeicao = await observarFallbackFirestore({
      resultado: 'reject',
      cacheId: 'cache-baseline',
      uid: 'uid-baseline',
      bloquearCache: false,
      segredo: 'baseline-reject',
    });
    const timeout = await observarFallbackFirestore({
      resultado: 'pending',
      cacheId: null,
      uid: 'uid-timeout',
      bloquearCache: false,
      segredo: 'baseline-timeout',
    });
    expect(rejeicao).toMatchObject({ casalId: 'cache-baseline', montagens: 1, appVisivel: true });
    expect(timeout).toMatchObject({ casalId: 'uid-timeout', montagens: 1, appVisivel: true });
  });

  it('tolera cache local bloqueado e conclui a montagem offline-first', async () => {
    await expect(observarMontagem({ bloquearCache: true })).resolves.toMatchObject({
      appVisivel: true,
      loaderOculto: true,
      remocoesLoader: 1,
    });
  });

  it('monta shell, listener e telas uma vez antes de remover o loader', async () => {
    const observado = await observarMontagem();
    expect(observado).toMatchObject({
      appVisivel: true,
      loaderOculto: true,
      remocoesLoader: 1,
      conclusoes: 1,
    });
    expect(observado.chamadas).toMatchObject({ cache: 1, listener: 1, setupNav: 1, render: 1 });
  });

  it('preserva sessão, cache e página quando logout rejeita', async () => {
    const observado = await observarLogoutRejeitado('baseline-logout');
    expect(observado).toMatchObject({
      signOutCalls: 1,
      unsubscribeCalls: 0,
      remocoesStorage: [],
      destino: 'app.html',
    });
    expect(observado.toasts[0].join(' ')).toContain('sessão continua ativa');
  });

  it('bloqueia credenciais em falha SESSION real e nunca seleciona LOCAL', async () => {
    for (const fluxo of ['login', 'cadastro', 'google']) {
      const observado = await observarFalhaPoliticaSession(fluxo, `baseline-${fluxo}`);
      expect(observado.persistencias).toEqual([SESSION]);
      expect(observado.persistencias).not.toContain(LOCAL);
      expect(observado.credenciais).toEqual([]);
      expect(observado.estado).toBe('erro');
      expect(observado.detalhe.toLowerCase()).toContain('armazenamento');
    }
  });

  it('mantém diagnósticos allowlisted sem segredos ou payloads', () => {
    const observado = observarDiagnosticoSanitizado('baseline-diagnostic');
    expect(Object.keys(observado.diagnostico)).toEqual([
      'evento',
      'operacao',
      'codigo',
      'categoria',
      'credencialLegada',
      'codigoRecebido',
      'mensagemRecebida',
    ]);
    for (const proibido of observado.proibidos) expect(observado.serializado).not.toContain(proibido);
  });
});

describe('Property 2: Preservation', () => {
  it('preserva resultados públicos para qualquer cenário gerado fora da Bug_Condition', async () => {
    await fc.assert(
      fc.asyncProperty(cenarioPreservadoArb, afirmarCenarioPreservado),
      {
        numRuns: 120,
        seed: 20250308,
        endOnFailure: true,
      }
    );
  }, 30000);
});
