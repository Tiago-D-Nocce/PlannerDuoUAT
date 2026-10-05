/*
 * Harness compartilhado para carregar public/auth.js num contexto node:vm com um
 * DOM mínimo e um window.PlannerLocal falso, sem dependências externas.
 *
 * Reproduz a semântica relevante do navegador: elementos acessados por id/seletor,
 * listeners de 'submit' capturados por formulário e eventos sintéticos cujo
 * currentTarget pode ser zerado após o await (como o navegador faz ao fim do
 * dispatch). Usado por tests/auth-currenttarget.test.js e tests/access-errors.test.js.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { vi } from 'vitest';

const AUTH_JS = readFileSync(resolve(import.meta.dirname, '..', '..', 'public', 'auth.js'), 'utf8');

// Elemento DOM mínimo o suficiente para os handlers de auth.js.
export function makeElement(id) {
  const element = {
    id,
    value: '',
    checked: false,
    textContent: '',
    innerHTML: '',
    type: 'text',
    dataset: {},
    disabled: false,
    hidden: false,
    classList: { toggle() {}, add() {}, remove() {} },
    reset: vi.fn(),
    focus: vi.fn(),
    addEventListener() {},
    querySelector() { return makeElement('submit-button'); },
    setAttribute() {},
    getAttribute() { return null; },
  };
  return element;
}

/*
 * Monta e executa auth.js num sandbox vm.
 *
 * options:
 *   auth           — objeto parcial que sobrescreve o window.PlannerLocal.auth padrão
 *                    (restoreSession/status já resolvem para "sem conta" por padrão).
 *   status         — resultado de auth.status() (padrão: setup, sem conta).
 *   setupValues    — valores pré-preenchidos do formulário de setup.
 *   unlockValues   — valores pré-preenchidos do formulário de unlock.
 *   fakeTimers     — quando true, usa window.setTimeout real do sandbox (encaminhado
 *                    para globalThis.setTimeout, controlável por vi.useFakeTimers()).
 *
 * Retorna um objeto com acessos úteis para os testes.
 */
export function loadAuth(options = {}) {
  const {
    auth: authOverrides = {},
    status = { exists: false, hasLegacyWorkspace: false },
    setupValues = {},
    unlockValues = {},
    fakeTimers = false,
  } = options;

  const listeners = new Map();
  const byId = new Map();
  const ensure = (id) => {
    if (!byId.has(id)) byId.set(id, makeElement(id));
    return byId.get(id);
  };

  const statusEl = ensure('auth-status');

  // Formulários com captura de listeners de submit e um botão de submit ESTÁVEL
  // (o navegador devolve sempre o mesmo elemento para form.querySelector('[type=submit]')).
  const makeForm = (id) => {
    const form = makeElement(id);
    const submitButton = makeElement(`${id}-submit`);
    submitButton.type = 'submit';
    // innerHTML inicial não-vazio: no DOM real o botão tem rótulo ("Criar conta"
    // / "Entrar"), de modo que setButtonLoading salva/restaura essa marcação.
    submitButton.innerHTML = 'Enviar';
    form.submitButton = submitButton;
    form.querySelector = (selector) => {
      if (selector === '[type="submit"]') return submitButton;
      return makeElement('misc');
    };
    const submitListeners = [];
    form.addEventListener = (type, fn) => {
      if (type === 'submit') submitListeners.push(fn);
    };
    form.submitListeners = submitListeners;
    byId.set(id, form);
    return form;
  };
  const setupForm = makeForm('setup-vault-form');
  const unlockForm = makeForm('unlock-form');

  // Pré-preenche valores de formulário.
  const setupDefaults = {
    'setup-account-name': 'Pessoa Teste',
    'setup-account-email': 'teste@exemplo.com',
    'setup-account-password': 'frase-super-secreta-123',
    'setup-account-confirm': 'frase-super-secreta-123',
  };
  for (const [id, value] of Object.entries({ ...setupDefaults, ...setupValues })) {
    ensure(id).value = value;
  }
  ensure('setup-no-recovery').checked = true;

  const unlockDefaults = {
    'unlock-email': 'teste@exemplo.com',
    'unlock-password': 'frase-super-secreta-123',
  };
  for (const [id, value] of Object.entries({ ...unlockDefaults, ...unlockValues })) {
    ensure(id).value = value;
  }

  const document = {
    querySelector(selector) {
      if (selector.startsWith('#')) return ensure(selector.slice(1));
      return makeElement('misc');
    },
    querySelectorAll() { return []; },
    getElementById(id) { return ensure(id); },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    createElement() { return makeElement('created'); },
    body: { appendChild() {} },
  };

  const defaultAuth = {
    restoreSession: () => Promise.resolve(false),
    status: () => status,
    createVault: vi.fn(() => Promise.resolve({ migrated: false })),
    unlock: vi.fn(() => Promise.resolve({})),
    destroyVault: vi.fn(() => Promise.resolve()),
    exportRawVault: () => '{}',
    exportRawLegacy: () => '{}',
  };
  const auth = { ...defaultAuth, ...authOverrides };

  const locationReplace = vi.fn();
  const locationReload = vi.fn();

  const window = {
    PlannerLocal: {
      VAULT_KEY: 'v', AUTH_EVENT_KEY: 'e', AUTH_EPOCH_KEY: 'ep',
      auth,
    },
    setTimeout: fakeTimers ? ((fn, ms) => globalThis.setTimeout(fn, ms)) : (() => 0),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    addEventListener() {},
    URL: globalThis.URL,
  };
  window.window = window;

  const sandbox = {
    window,
    document,
    location: { search: '', replace: locationReplace, reload: locationReload },
    sessionStorage: { getItem: () => null, removeItem() {} },
    URLSearchParams: globalThis.URLSearchParams,
    Blob: class {},
    URL: globalThis.URL,
    Date,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(AUTH_JS, sandbox);

  return {
    ensure,
    get: (id) => byId.get(id),
    statusEl,
    setupForm,
    unlockForm,
    auth,
    locationReplace,
    locationReload,
    listeners,
    // Dispara o handler de submit com um evento sintético. currentTarget pode ser
    // zerado (via event._ct = null) para simular o fim do dispatch no navegador.
    submit(form) {
      const handler = form.submitListeners[0];
      const event = {
        preventDefault() {},
        get currentTarget() { return this._ct; },
        _ct: form,
      };
      return { handler, event, run: () => handler(event) };
    },
  };
}
