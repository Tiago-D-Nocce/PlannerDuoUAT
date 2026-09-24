// Bug-condition exploration for the Firebase Auth bootstrap stall.
//
// Baseline evidence captured against unfixed commit 9ebdd40 with the focused
// command documented in UNFIXED_BASELINE_EVIDENCE. This fixture is deliberately
// limited to timing/state/call-count metadata: no identity, credential, raw
// error, network response, or cloud data is recorded.
//
// Property 1: Bug Condition — Auth bootstrap accepts late valid completion and
// always has a safe exit.
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5**

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import bootstrap from '../public/bootstrap.js';

const PUBLIC_DIR = resolve(import.meta.dirname, '..', 'public');
const readPublic = (file) => readFileSync(resolve(PUBLIC_DIR, file), 'utf8');

const AUTH_HTML_SOURCE = readPublic('auth.html');
const AUTH_INLINE_SOURCE = [...AUTH_HTML_SOURCE.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((source) => source.includes('AUTH PAGE — script independente'));

if (!AUTH_INLINE_SOURCE) throw new Error('Main auth.html inline script was not found');

const PRODUCT_SOURCES = Object.freeze({
  bootstrap: readPublic('bootstrap.js'),
  authErrors: readPublic('auth-errors.js'),
  authInline: AUTH_INLINE_SOURCE,
  core: readPublic('core.js'),
  app: readPublic('app.js'),
});

const UNFIXED_BASELINE_EVIDENCE = Object.freeze({
  commit: '9ebdd40',
  command: 'npx vitest --run tests/firebase-auth-bootstrap-stall.exploration.test.js',
  seed: 20250301,
  numRuns: 100,
  shrunkCounterexample: Object.freeze({ delayMs: 3001 }),
  observed: Object.freeze({ supervisorState: 'erro', observerCalls: 0 }),
});

const TEST_USER = Object.freeze({
  uid: 'opaque-test-user',
  email: '',
  displayName: 'Pessoa de teste',
});

async function flushMicrotasks(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

function createFakeScheduler() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();

  function setTimeoutFake(callback, delayMs = 0) {
    const id = nextId;
    nextId += 1;
    const numericDelay = Number(delayMs);
    const delay = Number.isFinite(numericDelay) ? Math.max(0, numericDelay) : 0;
    pending.set(id, { id, dueAt: now + delay, callback });
    return id;
  }

  function clearTimeoutFake(id) {
    pending.delete(id);
  }

  function nextDueAtOrBefore(targetTime) {
    return [...pending.values()]
      .filter((task) => task.dueAt <= targetTime)
      .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)[0];
  }

  async function advanceTo(targetTime) {
    if (targetTime < now) throw new Error('fake scheduler cannot move backwards');

    let task = nextDueAtOrBefore(targetTime);
    while (task) {
      pending.delete(task.id);
      now = task.dueAt;
      task.callback();
      // Browser promise reactions run between timer tasks. This matters at the
      // 3000 ms boundary and keeps the fake clock faithful to the event loop.
      await flushMicrotasks();
      task = nextDueAtOrBefore(targetTime);
    }

    now = targetTime;
    await flushMicrotasks();
  }

  return Object.freeze({
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake,
    advanceTo,
    advanceBy: (delayMs) => advanceTo(now + delayMs),
    now: () => now,
  });
}

function createFakeElement({ hidden = false, display = '', opacity = '' } = {}) {
  const classes = new Set();
  const attributes = {};
  const listeners = new Map();

  const element = {
    hidden,
    disabled: false,
    type: 'text',
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    dataset: {},
    style: { display, opacity },
    attributes,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      replace: (oldName, newName) => {
        classes.delete(oldName);
        classes.add(newName);
      },
    },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return attributes[name] ?? null; },
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) || [];
      callbacks.push(callback);
      listeners.set(type, callbacks);
    },
    dispatch(type, event = {}) {
      return (listeners.get(type) || []).map((callback) => callback({
        type,
        target: element,
        preventDefault() {},
        ...event,
      }));
    },
    appendChild() {},
    remove() {},
    focus() {},
    reset() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  return element;
}

function createFakeDom() {
  const documentListeners = new Map();
  const loader = createFakeElement({ display: 'flex' });
  loader.setAttribute('aria-busy', 'true');
  loader.dataset.estado = 'carregando';

  const elements = new Map([
    ['loader-tela', loader],
    ['loader-msg', createFakeElement()],
    ['loader-acoes', createFakeElement({ hidden: true, display: 'none' })],
    ['tela-app', createFakeElement({ opacity: '0' })],
    ['sidebar-user-name', createFakeElement()],
    ['sidebar-avatar', createFakeElement()],
    ['auth-bootstrap-error', createFakeElement({ hidden: true })],
    ['auth-bootstrap-detail', createFakeElement()],
  ]);

  const document = {
    documentElement: createFakeElement(),
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => createFakeElement(),
    addEventListener(type, callback) {
      const callbacks = documentListeners.get(type) || [];
      callbacks.push(callback);
      documentListeners.set(type, callbacks);
    },
    removeEventListener(type, callback) {
      const callbacks = documentListeners.get(type) || [];
      documentListeners.set(type, callbacks.filter((item) => item !== callback));
    },
  };

  return Object.freeze({
    document,
    elements,
    dispatch(type, event = {}) {
      for (const callback of documentListeners.get(type) || []) callback(event);
    },
  });
}

function createFakeLocalStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}

function createAuthDom() {
  const elements = new Map();
  const ids = [
    'auth-bootstrap-error',
    'auth-bootstrap-detail',
    'form-login',
    'btn-login',
    'login-email',
    'login-senha',
    'form-cadastro',
    'btn-cadastro',
    'cad-nome1',
    'cad-email',
    'cad-senha',
    'form-reset',
    'reset-email',
    'toast-container',
  ];
  for (const id of ids) elements.set(id, createFakeElement());

  elements.get('auth-bootstrap-error').hidden = true;
  elements.get('login-email').value = 'pessoa@example.invalid';
  elements.get('login-senha').value = 'senha-falsa';
  elements.get('cad-nome1').value = 'Pessoa';
  elements.get('cad-email').value = 'pessoa@example.invalid';
  elements.get('cad-senha').value = 'senha-falsa';

  return Object.freeze({
    elements,
    document: {
      getElementById: (id) => elements.get(id) || null,
      querySelectorAll: () => [],
      createElement: () => createFakeElement(),
    },
  });
}

function createLateAuthHarness({ delayMs, flow }) {
  const scheduler = createFakeScheduler();
  const dom = createAuthDom();
  const localStorage = createFakeLocalStorage();
  const windowListeners = new Map();
  const diagnostics = [];
  const calls = {
    persistence: 0,
    credentials: [],
    redirectResult: 0,
  };
  let persistenceSettledAt = null;

  const neverSettles = () => new Promise(() => {});
  const startCredential = (kind) => {
    calls.credentials.push(Object.freeze({ kind, atMs: scheduler.now() }));
    return neverSettles();
  };
  const authAdapter = {
    languageCode: '',
    setPersistence(kind) {
      calls.persistence += 1;
      return new Promise((resolvePromise) => {
        scheduler.setTimeout(() => {
          persistenceSettledAt = scheduler.now();
          resolvePromise(kind);
        }, delayMs);
      });
    },
    signInWithEmailAndPassword: () => startCredential('login'),
    createUserWithEmailAndPassword: () => startCredential('cadastro'),
    signInWithRedirect: () => startCredential('google'),
    getRedirectResult() {
      calls.redirectResult += 1;
      return Promise.resolve(null);
    },
    signOut: () => Promise.resolve(),
    sendPasswordResetEmail: () => Promise.resolve(),
  };

  function authFactory() { return authAdapter; }
  authFactory.Auth = { Persistence: { SESSION: 'session', LOCAL: 'local' } };
  authFactory.GoogleAuthProvider = class {
    setCustomParameters() {}
  };

  const docRef = {
    get: () => Promise.resolve({ exists: false, data: () => ({}) }),
    set: () => Promise.resolve(),
    update: () => Promise.resolve(),
  };
  const firestoreFactory = () => ({ collection: () => ({ doc: () => docRef }) });
  const location = {
    pathname: '/auth',
    href: 'auth.html',
    replace(destination) { this.href = destination; },
  };
  const context = {
    console: {
      warn: (...args) => diagnostics.push(args),
      error: (...args) => diagnostics.push(args),
      log() {},
    },
    document: dom.document,
    location,
    localStorage,
    firebase: {
      apps: [],
      initializeApp() { this.apps.push(Object.freeze({})); },
      auth: authFactory,
      firestore: firestoreFactory,
    },
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
    confirm: () => true,
    addEventListener(type, callback) {
      const callbacks = windowListeners.get(type) || [];
      callbacks.push(callback);
      windowListeners.set(type, callbacks);
    },
    removeEventListener(type, callback) {
      const callbacks = windowListeners.get(type) || [];
      windowListeners.set(type, callbacks.filter((item) => item !== callback));
    },
  };
  context.window = context;
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(PRODUCT_SOURCES.bootstrap, context, { filename: 'bootstrap.js' });
  context.PlannerBootstrap.iniciar({ pagina: 'auth', timeoutMs: 10000 });
  vm.runInContext(PRODUCT_SOURCES.authErrors, context, { filename: 'auth-errors.js' });
  vm.runInContext(PRODUCT_SOURCES.authInline, context, { filename: 'auth.html:inline' });

  function startFlow() {
    if (flow === 'login') return dom.elements.get('form-login').dispatch('submit')[0];
    if (flow === 'cadastro') return dom.elements.get('form-cadastro').dispatch('submit')[0];
    return vm.runInContext('loginGoogle()', context);
  }

  async function run() {
    startFlow();
    await flushMicrotasks();

    await scheduler.advanceTo(3000);
    const panelAtThreshold = dom.elements.get('auth-bootstrap-error');
    const detailAtThreshold = dom.elements.get('auth-bootstrap-detail');
    const supervisorStateAtThreshold = context.PlannerBootstrap.estadoAtual().estado;
    const credentialCallsBeforeSettlement = calls.credentials.length;
    const warningVisibleAtThreshold = panelAtThreshold.hidden === false
      && panelAtThreshold.dataset.estado === 'demorado'
      && detailAtThreshold.textContent === context.PlannerBootstrap.MENSAGEM_DEMORA_AUTH;

    await scheduler.advanceTo(delayMs);
    await flushMicrotasks();

    const panel = dom.elements.get('auth-bootstrap-error');
    const detail = dom.elements.get('auth-bootstrap-detail');
    const supervisorState = context.PlannerBootstrap.estadoAtual().estado;
    const credentialStartedAfterSettlement = calls.credentials.length === 1
      && persistenceSettledAt !== null
      && calls.credentials[0].atMs >= persistenceSettledAt;
    const warningCleared = panel.hidden === true
      && panel.dataset.estado === 'pronto'
      && detail.textContent === '';

    return Object.freeze({
      supervisorState,
      supervisorStateAtThreshold,
      persistenceCalls: calls.persistence,
      credentialOperationCount: calls.credentials.length,
      credentialCallsBeforeSettlement,
      credentialStartedAfterSettlement,
      warningVisibleAtThreshold,
      warningCleared,
      persistenceSettledAt,
      observerCalls: 0,
      navigationCalls: 0,
      authObserverStarted: false,
      appVisible: false,
      navigationStarted: false,
      actionableRecoveryVisible: false,
      storageSpecificRecoveryVisible: false,
      falseTerminalFailure: supervisorState === 'erro',
      loaderBusy: false,
      credentialOperationStarted: calls.credentials.length > 0,
      localPersistenceUsed: false,
      isRecoverable: supervisorState === 'demorado',
      hasSafeTerminalOutcome: supervisorState === 'pronto',
    });
  }

  return Object.freeze({ run, diagnostics });
}

function createFakeAuth({ scheduler, persistence, observerDelayMs, user }, calls) {
  return {
    currentUser: user,
    setPersistence() {
      calls.persistence += 1;
      return new Promise((resolvePromise, rejectPromise) => {
        if (persistence.outcome === 'pending') return;
        scheduler.setTimeout(() => {
          if (persistence.outcome === 'reject') {
            rejectPromise(Object.freeze({ code: persistence.code }));
          } else {
            resolvePromise('session');
          }
        }, persistence.delayMs);
      });
    },
    onAuthStateChanged(onUser) {
      calls.observer += 1;
      scheduler.setTimeout(() => onUser(user), observerDelayMs);
      return () => {};
    },
    signOut: () => Promise.resolve(),
  };
}

function createFakeFirestore() {
  const doc = {
    get: async () => ({ exists: true, data: () => ({}) }),
    set: async () => {},
    update: async () => {},
    onSnapshot: () => () => {},
  };
  return { collection: () => ({ doc: () => doc }) };
}

function createAppHarness({
  persistence = { outcome: 'success', delayMs: 0 },
  observerDelayMs = 0,
  user = TEST_USER,
  unownedRejectionAtMs = null,
  navigationOutcome = 'success',
} = {}) {
  const scheduler = createFakeScheduler();
  const dom = createFakeDom();
  const localStorage = createFakeLocalStorage();
  const calls = { persistence: 0, observer: 0, navigation: 0 };
  const windowListeners = new Map();
  const diagnostics = [];
  let pageExited = false;

  const authAdapter = createFakeAuth(
    { scheduler, persistence, observerDelayMs, user },
    calls
  );
  const authFactory = () => authAdapter;
  authFactory.Auth = { Persistence: { SESSION: 'session' } };

  const firestoreFactory = () => createFakeFirestore();
  firestoreFactory.FieldValue = {
    arrayUnion: (value) => value,
    arrayRemove: (value) => value,
  };

  const location = {
    pathname: '/app',
    href: '/app',
    replace(destination) {
      calls.navigation += 1;
      if (navigationOutcome === 'throws') {
        throw new Error('synthetic navigation failure');
      }
      if (navigationOutcome === 'success') {
        pageExited = true;
        this.pathname = `/${destination}`;
        this.href = destination;
      }
      // no-page-exit intentionally leaves the current fake document active.
    },
  };

  const context = {
    Intl,
    Date,
    Math,
    JSON,
    URL,
    Blob: class {},
    crypto: { randomUUID: () => 'opaque-random-value' },
    Chart: class { destroy() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage,
    document: dom.document,
    location,
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
    console: {
      warn: (...args) => diagnostics.push(args),
      error: (...args) => diagnostics.push(args),
      log: () => {},
    },
    addEventListener(type, callback) {
      const callbacks = windowListeners.get(type) || [];
      callbacks.push(callback);
      windowListeners.set(type, callbacks);
    },
    removeEventListener(type, callback) {
      const callbacks = windowListeners.get(type) || [];
      windowListeners.set(type, callbacks.filter((item) => item !== callback));
    },
    firebase: {
      apps: [],
      initializeApp() { this.apps.push(Object.freeze({})); },
      auth: authFactory,
      firestore: firestoreFactory,
    },
    // Esta exploração observa o caminho Firebase (observer + supervisor).
    // modo-local-sem-firebase tornou 'local' o padrão; fixamos o modo firebase
    // para preservar a baseline capturada contra o commit não corrigido.
    PLANNERDUO_MODO: 'firebase',
  };
  context.window = context;
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(PRODUCT_SOURCES.bootstrap, context, { filename: 'bootstrap.js' });
  context.PlannerBootstrap.iniciar({ pagina: 'app', timeoutMs: 10000 });
  vm.runInContext(PRODUCT_SOURCES.authErrors, context, { filename: 'auth-errors.js' });
  vm.runInContext(PRODUCT_SOURCES.core, context, { filename: 'core.js' });
  vm.runInContext(PRODUCT_SOURCES.app, context, { filename: 'app.js' });
  vm.runInContext('globalThis.__appUnderTest = { Auth, Estado };', context);

  // Keep unrelated rendering out of this bootstrap property while preserving
  // the real app's decisive guard: an erro supervisor cannot expose the shell.
  context.__appUnderTest.Auth.resolverCasalId = async () => 'opaque-test-space';
  context.__appUnderTest.Auth._entrarNoApp = () => {
    if (context.PlannerBootstrap.estadoAtual().estado === 'erro') return;
    context.__appUnderTest.Auth._esconderLoader();
    context.PlannerBootstrap.concluir();
  };

  function dispatchWindow(type, event = {}) {
    for (const callback of windowListeners.get(type) || []) callback(event);
  }

  async function run(untilMs) {
    dom.dispatch('DOMContentLoaded');
    await flushMicrotasks();

    if (Number.isFinite(unownedRejectionAtMs)) {
      scheduler.setTimeout(
        () => dispatchWindow('unhandledrejection', { promise: Object.freeze({}) }),
        unownedRejectionAtMs
      );
    }

    await scheduler.advanceTo(untilMs);
    await flushMicrotasks();

    const loader = dom.elements.get('loader-tela');
    const actions = dom.elements.get('loader-acoes');
    const app = dom.elements.get('tela-app');
    const supervisorState = context.PlannerBootstrap.estadoAtual().estado;
    const loaderBusy = loader.attributes['aria-busy'] !== 'false'
      && loader.style.display !== 'none';
    const actionableRecoveryVisible = actions.hidden === false
      && loader.attributes['aria-busy'] === 'false';
    const appVisible = app.style.opacity === '1';

    return Object.freeze({
      supervisorState,
      observerCalls: calls.observer,
      persistenceCalls: calls.persistence,
      navigationCalls: calls.navigation,
      authObserverStarted: calls.observer > 0,
      appVisible,
      navigationStarted: pageExited,
      actionableRecoveryVisible,
      storageSpecificRecoveryVisible: false,
      falseTerminalFailure: supervisorState === 'erro',
      loaderBusy,
      credentialOperationStarted: false,
      localPersistenceUsed: false,
      isRecoverable: actionableRecoveryVisible,
      hasSafeTerminalOutcome: appVisible || pageExited || actionableRecoveryVisible,
    });
  }

  return Object.freeze({ run, diagnostics });
}

function createBootstrapEnvironment(scheduler) {
  const dom = createFakeDom();
  const listeners = new Map();
  return {
    dom,
    environment: {
      documento: dom.document,
      janela: {
        addEventListener: (type, callback) => listeners.set(type, callback),
        removeEventListener: (type, callback) => {
          if (listeners.get(type) === callback) listeners.delete(type);
        },
      },
      agendar: scheduler.setTimeout,
      cancelar: scheduler.clearTimeout,
      logger: { warn() {} },
    },
  };
}

async function runCompoundedBudgetScenario(scenario) {
  const scheduler = createFakeScheduler();
  const { dom, environment } = createBootstrapEnvironment(scheduler);
  const supervisor = bootstrap.criarSupervisorBootstrap(environment);
  supervisor.iniciar({ pagina: 'app', timeoutMs: 10000 });

  const startPhase = typeof supervisor.iniciarFase === 'function'
    ? supervisor.iniciarFase.bind(supervisor)
    : typeof supervisor.avancarFase === 'function'
      ? supervisor.avancarFase.bind(supervisor)
      : null;

  for (const phase of scenario.phases) {
    // Fixed implementations may expose either phase spelling. The unfixed
    // supervisor exposes neither and therefore retains its aggregate watchdog.
    if (startPhase) startPhase(phase.name, phase.contractMs + 1);
    await scheduler.advanceBy(phase.durationMs);
  }

  const concluded = supervisor.concluir();
  const state = supervisor.estadoAtual().estado;
  const loader = dom.elements.get('loader-tela');
  const actions = dom.elements.get('loader-acoes');
  const actionableRecoveryVisible = actions.hidden === false
    && loader.attributes['aria-busy'] === 'false';

  return Object.freeze({
    supervisorState: state,
    observerCalls: 1,
    authObserverStarted: true,
    appVisible: concluded && state === 'pronto',
    navigationStarted: false,
    actionableRecoveryVisible,
    storageSpecificRecoveryVisible: false,
    falseTerminalFailure: state === 'erro',
    loaderBusy: loader.attributes['aria-busy'] !== 'false',
    credentialOperationStarted: false,
    localPersistenceUsed: false,
    isRecoverable: actionableRecoveryVisible,
    hasSafeTerminalOutcome: concluded || actionableRecoveryVisible,
  });
}

function lateScenario(delayMs, flow = 'login') {
  return Object.freeze({
    kind: 'late-session-success',
    page: 'auth',
    hasEstablishedSession: false,
    newAuthenticationRequested: true,
    flow,
    persistence: Object.freeze({ outcome: 'success', delayMs }),
    criticalOperationsWouldSucceed: true,
    bootstrapPending: true,
  });
}

function storageScenario({ outcome, delayMs = 0, code = null }) {
  return Object.freeze({
    kind: 'recoverable-storage-interference',
    page: 'app',
    hasEstablishedSession: true,
    persistence: Object.freeze({ outcome, delayMs, code }),
    authObserverWouldSettle: true,
    reportedCategory: 'generic-connection',
    criticalOperationsWouldSucceed: true,
    bootstrapPending: true,
  });
}

function unownedRejectionScenario({ rejectionAtMs, authCallbackAtMs }) {
  return Object.freeze({
    kind: 'unowned-rejection',
    page: 'app',
    hasEstablishedSession: true,
    persistence: Object.freeze({ outcome: 'success', delayMs: 0 }),
    rejection: Object.freeze({ owner: 'unrelated', atMs: rejectionAtMs }),
    authCallbackAtMs,
    criticalOperationsWouldSucceed: true,
    bootstrapPending: true,
  });
}

function compoundedBudgetScenario(durations) {
  const contracts = Object.freeze({ sdk: 2000, persistence: 3000, observer: 1000, data: 6000 });
  return Object.freeze({
    kind: 'compounded-budget',
    page: 'app',
    hasEstablishedSession: true,
    criticalOperationsWouldSucceed: true,
    bootstrapPending: true,
    phases: Object.freeze([
      Object.freeze({ name: 'sdk', durationMs: durations.sdk, contractMs: contracts.sdk }),
      Object.freeze({ name: 'persistence', durationMs: durations.persistence, contractMs: contracts.persistence }),
      Object.freeze({ name: 'observer', durationMs: durations.observer, contractMs: contracts.observer }),
      Object.freeze({ name: 'data', durationMs: durations.data, contractMs: contracts.data }),
    ]),
  });
}

function navigationScenario(outcome) {
  return Object.freeze({
    kind: 'stranded-navigation',
    page: 'app',
    hasEstablishedSession: false,
    persistence: Object.freeze({ outcome: 'success', delayMs: 0 }),
    redirectRequired: true,
    supervisorCompletedBeforeNavigation: true,
    navigation: Object.freeze({ outcome }),
    criticalOperationsWouldSucceed: true,
    bootstrapPending: true,
  });
}

function isBugCondition(scenario) {
  const latePersistence = scenario.kind === 'late-session-success'
    && scenario.page === 'auth'
    && scenario.newAuthenticationRequested
    && scenario.persistence?.outcome === 'success'
    && scenario.persistence.delayMs > 3000
    && scenario.criticalOperationsWouldSucceed;

  const recoverableStorageInterference = scenario.page === 'app'
    && scenario.hasEstablishedSession
    && ['delayed', 'storage-rejection'].includes(scenario.persistence?.outcome)
    && (scenario.authObserverWouldSettle || scenario.reportedCategory === 'generic-connection');

  const unrelatedRejection = scenario.bootstrapPending
    && scenario.rejection?.owner !== undefined
    && scenario.rejection.owner !== 'bootstrap'
    && scenario.criticalOperationsWouldSucceed;

  const compoundedBudget = Array.isArray(scenario.phases)
    && scenario.phases.every((phase) => phase.durationMs <= phase.contractMs)
    && scenario.phases.reduce((total, phase) => total + phase.durationMs, 0) > 10000;

  const strandedNavigation = scenario.redirectRequired
    && scenario.supervisorCompletedBeforeNavigation
    && ['throws', 'no-page-exit'].includes(scenario.navigation?.outcome);

  return latePersistence
    || recoverableStorageInterference
    || unrelatedRejection
    || compoundedBudget
    || strandedNavigation;
}

function expectedBehavior(result, scenario) {
  if (scenario.kind === 'late-session-success') {
    const common = result.supervisorStateAtThreshold === 'demorado'
      && result.warningVisibleAtThreshold
      && result.credentialCallsBeforeSettlement === 0
      && result.supervisorState === 'pronto'
      && result.warningCleared
      && result.persistenceCalls === 1
      && !result.localPersistenceUsed
      && !result.falseTerminalFailure;
    if (scenario.persistence.delayMs > 8000) {
      // O timeout de UI preservado no produto impede iniciar credenciais após
      // uma espera excessiva, mesmo que SESSION conclua posteriormente.
      return common
        && result.credentialOperationCount === 0
        && !result.credentialStartedAfterSettlement;
    }
    return common
      && result.credentialOperationCount === 1
      && result.credentialStartedAfterSettlement;
  }

  if (scenario.actualSessionPolicyFailureBeforeNewLogin) {
    return result.storageSpecificRecoveryVisible
      && !result.credentialOperationStarted
      && !result.localPersistenceUsed
      && result.isRecoverable;
  }

  if (scenario.redirectRequired) {
    return result.navigationStarted
      || (result.actionableRecoveryVisible && !result.loaderBusy);
  }

  if (scenario.hasEstablishedSession && scenario.criticalOperationsWouldSucceed) {
    return result.authObserverStarted
      && result.appVisible
      && !result.falseTerminalFailure;
  }

  if (scenario.explicitOwnedCriticalFailure) {
    return result.actionableRecoveryVisible && !result.loaderBusy;
  }

  return result.hasSafeTerminalOutcome;
}

async function runScenario(scenario) {
  if (scenario.kind === 'late-session-success') {
    return createLateAuthHarness({
      delayMs: scenario.persistence.delayMs,
      flow: scenario.flow,
    }).run();
  }

  if (scenario.kind === 'compounded-budget') {
    return runCompoundedBudgetScenario(scenario);
  }

  let persistence;
  if (scenario.persistence.outcome === 'storage-rejection') {
    persistence = {
      outcome: 'reject',
      delayMs: scenario.persistence.delayMs,
      code: scenario.persistence.code,
    };
  } else {
    persistence = {
      outcome: 'success',
      delayMs: scenario.persistence.delayMs,
    };
  }

  const harness = createAppHarness({
    persistence,
    observerDelayMs: scenario.authCallbackAtMs || 0,
    user: scenario.redirectRequired ? null : TEST_USER,
    unownedRejectionAtMs: scenario.rejection?.atMs ?? null,
    navigationOutcome: scenario.navigation?.outcome || 'success',
  });

  const untilMs = Math.max(
    12001,
    (scenario.persistence.delayMs || 0) + 1000,
    (scenario.authCallbackAtMs || 0) + 1000
  );
  return harness.run(untilMs);
}

function safeFailureEvidence(scenario, result) {
  return JSON.stringify({
    branch: scenario.kind,
    flow: scenario.flow,
    delayMs: scenario.persistence?.delayMs,
    supervisorStateAtThreshold: result.supervisorStateAtThreshold,
    supervisorState: result.supervisorState,
    observerCalls: result.observerCalls,
    persistenceCalls: result.persistenceCalls,
    credentialOperationCount: result.credentialOperationCount,
    credentialCallsBeforeSettlement: result.credentialCallsBeforeSettlement,
    warningCleared: result.warningCleared,
    navigationCalls: result.navigationCalls,
    loaderBusy: result.loaderBusy,
  });
}

const lateScenarioArbitrary = fc.record({
  delayMs: fc.integer({ min: 3001, max: 30000 }),
  flow: fc.constantFrom('login', 'cadastro', 'google'),
}).map(({ delayMs, flow }) => lateScenario(delayMs, flow));

const storageScenarioArbitrary = fc.oneof(
  fc.integer({ min: 3001, max: 30000 }).map((delayMs) => storageScenario({
    outcome: 'delayed',
    delayMs,
  })),
  fc.record({
    delayMs: fc.integer({ min: 0, max: 250 }),
    code: fc.constantFrom(
      'auth/web-storage-unsupported',
      'auth/unsupported-persistence-type',
      'auth/missing-initial-state'
    ),
  }).map(({ delayMs, code }) => storageScenario({
    outcome: 'storage-rejection',
    delayMs,
    code,
  }))
);

const eventOrderingArbitrary = fc.record({
  rejectionAtMs: fc.integer({ min: 1, max: 250 }),
  gapUntilAuthCallbackMs: fc.integer({ min: 1, max: 250 }),
}).map(({ rejectionAtMs, gapUntilAuthCallbackMs }) => unownedRejectionScenario({
  rejectionAtMs,
  authCallbackAtMs: rejectionAtMs + gapUntilAuthCallbackMs,
}));

const phaseDurationsArbitrary = fc.record({
  sdk: fc.integer({ min: 1400, max: 2000 }),
  persistence: fc.integer({ min: 2800, max: 3000 }),
  observer: fc.integer({ min: 500, max: 1000 }),
  data: fc.integer({ min: 5301, max: 6000 }),
}).map(compoundedBudgetScenario);

const navigationOutcomeArbitrary = fc
  .constantFrom('throws', 'no-page-exit')
  .map(navigationScenario);

const branchArbitraries = Object.freeze([
  lateScenarioArbitrary,
  storageScenarioArbitrary,
  eventOrderingArbitrary,
  phaseDurationsArbitrary,
  navigationOutcomeArbitrary,
]);

describe('Property 1 — bug condition on unfixed Firebase Auth bootstrap', () => {
  it.each(['login', 'cadastro', 'google'])(
    'reproduces the scoped 3001 ms late SESSION completion in auth.html (%s)',
    async (flow) => {
      const scenario = lateScenario(3001, flow);
      expect(isBugCondition(scenario)).toBe(true);

      const result = await runScenario(scenario);

      // UNFIXED_BASELINE_EVIDENCE remains the captured 9ebdd40 proof. This
      // corrected harness now follows SESSION's sole owner (auth.html): the
      // 3 s threshold must only warn, and the original 3001 ms settlement must
      // release exactly one credential operation.
      expect(result.supervisorStateAtThreshold).toBe('demorado');
      expect(result.warningVisibleAtThreshold).toBe(true);
      expect(result.credentialCallsBeforeSettlement).toBe(0);
      expect(result.supervisorState).toBe('pronto');
      expect(result.warningCleared).toBe(true);
      expect(result.persistenceCalls).toBe(1);
      expect(result.credentialOperationCount).toBe(1);
      expect(result.credentialStartedAfterSettlement).toBe(true);
      expect(result.falseTerminalFailure).toBe(false);
    }
  );

  it('shrinks every late valid SESSION completion to delayMs=3001', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          delayMs: fc.integer({ min: 3001, max: 30000 }),
          flow: fc.constantFrom('login', 'cadastro', 'google'),
        }),
        async ({ delayMs, flow }) => {
          const scenario = lateScenario(delayMs, flow);
          const result = await runScenario(scenario);
          expect(
            expectedBehavior(result, scenario),
            safeFailureEvidence(scenario, result)
          ).toBe(true);
        }
      ),
      {
        seed: UNFIXED_BASELINE_EVIDENCE.seed,
        numRuns: UNFIXED_BASELINE_EVIDENCE.numRuns,
      }
    );
  });

  it('checks 100 generated cases across every isBugCondition branch', async () => {
    const generatedScenarios = branchArbitraries.flatMap((arbitrary, index) =>
      fc.sample(arbitrary, {
        seed: UNFIXED_BASELINE_EVIDENCE.seed + index,
        numRuns: 20,
      })
    );

    expect(generatedScenarios).toHaveLength(100);
    expect(new Set(generatedScenarios.map((scenario) => scenario.kind))).toEqual(new Set([
      'late-session-success',
      'recoverable-storage-interference',
      'unowned-rejection',
      'compounded-budget',
      'stranded-navigation',
    ]));

    const violations = [];
    for (const scenario of generatedScenarios) {
      expect(isBugCondition(scenario)).toBe(true);
      const result = await runScenario(scenario);
      if (!expectedBehavior(result, scenario)) {
        violations.push(safeFailureEvidence(scenario, result));
      }
    }

    expect(
      violations.length,
      violations[0] || 'all generated bug-condition scenarios had a safe exit'
    ).toBe(0);
  });
});
