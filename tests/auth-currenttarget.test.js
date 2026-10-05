import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

/*
 * Regressão: após `await Repository.auth.createVault(...)`, o navegador zera
 * `event.currentTarget` quando o despacho do evento termina. Se o handler lesse
 * `event.currentTarget` depois do await, chamaria `.reset()` sobre `null`,
 * lançaria TypeError, cairia no catch e mostraria a mensagem genérica em vez de
 * redirecionar — mesmo com a conta já criada.
 *
 * Este teste carrega public/auth.js num contexto node:vm com um DOM mínimo e
 * dispara um 'submit' real em #setup-vault-form. O evento sintético zera o seu
 * próprio currentTarget assim que o microtask do createVault resolve, simulando
 * exatamente a semântica real do navegador.
 */

const AUTH_JS = readFileSync(resolve(import.meta.dirname, '..', 'public', 'auth.js'), 'utf8');

// Elemento DOM mínimo o suficiente para o handler de setup.
function makeElement(id) {
  return {
    id,
    value: '',
    checked: false,
    textContent: '',
    innerHTML: '',
    dataset: {},
    disabled: false,
    hidden: false,
    classList: { toggle() {}, add() {}, remove() {} },
    reset: vi.fn(),
    focus() {},
    addEventListener() {},
    querySelector() { return makeElement('submit-button'); },
    setAttribute() {},
    getAttribute() { return null; },
  };
}

describe('auth.js — referência estável do formulário após await', () => {
  let elements;
  let listeners;
  let createVault;
  let locationReplace;
  let statusEl;

  beforeEach(() => {
    listeners = new Map();
    locationReplace = vi.fn();

    // createVault resolve só depois de um microtask, para que o currentTarget
    // já tenha sido zerado quando (num código bugado) fosse lido de novo.
    createVault = vi.fn(() => Promise.resolve({ migrated: false }));

    const byId = new Map();
    const ensure = (id) => {
      if (!byId.has(id)) byId.set(id, makeElement(id));
      return byId.get(id);
    };
    statusEl = ensure('auth-status');

    const setupForm = makeElement('setup-vault-form');
    const submitListeners = [];
    setupForm.addEventListener = (type, fn) => {
      if (type === 'submit') submitListeners.push(fn);
    };
    setupForm.submitListeners = submitListeners;
    byId.set('setup-vault-form', setupForm);

    // Pré-preenche o formulário de setup com dados válidos.
    ensure('setup-account-password').value = 'frase-super-secreta-123';
    ensure('setup-account-confirm').value = 'frase-super-secreta-123';
    ensure('setup-no-recovery').checked = true;
    ensure('setup-account-name').value = 'Pessoa Teste';
    ensure('setup-account-email').value = 'teste@exemplo.com';

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

    elements = { document, ensure, setupForm };

    const window = {
      PlannerLocal: {
        VAULT_KEY: 'v', AUTH_EVENT_KEY: 'e', AUTH_EPOCH_KEY: 'ep',
        auth: {
          restoreSession: () => Promise.resolve(false),
          status: () => ({ exists: false, hasLegacyWorkspace: false }),
          createVault,
        },
      },
      setTimeout: () => 0, // não dispara foco diferido no teste
      addEventListener() {},
      URL: globalThis.URL,
    };
    window.window = window;

    const sandbox = {
      window,
      document,
      location: { search: '', replace: locationReplace, reload() {} },
      sessionStorage: { getItem: () => null, removeItem() {} },
      URLSearchParams: globalThis.URLSearchParams,
      Blob: class {},
      URL: globalThis.URL,
      Date,
      setTimeout: window.setTimeout,
      console,
    };
    sandbox.globalThis = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(AUTH_JS, sandbox);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redireciona e usa reset() mesmo quando currentTarget vira null após o await', async () => {
    const handler = elements.setupForm.submitListeners[0];
    expect(typeof handler).toBe('function');

    const form = elements.setupForm;
    // Evento sintético: assim que o createVault resolve (microtask), o
    // currentTarget é zerado — exatamente como o navegador faz ao fim do despacho.
    const event = {
      preventDefault() {},
      get currentTarget() { return this._ct; },
      _ct: form,
    };
    // Agenda o "zeramento" para logo após o await de createVault resolver.
    createVault.mockImplementation(() => Promise.resolve().then(() => {
      event._ct = null; // o navegador zera currentTarget quando o dispatch termina
      return { migrated: false };
    }));

    await handler(event);

    // Com a correção, reset() foi chamado via referência estável `form`.
    expect(form.reset).toHaveBeenCalledTimes(1);
    // E o redirecionamento ocorreu em vez da mensagem genérica de erro.
    expect(locationReplace).toHaveBeenCalledWith('app.html');
    expect(statusEl.textContent).toBe('Conta criada, abrindo…');
    expect(statusEl.textContent).not.toContain('Não foi possível concluir a operação com segurança.');
    expect(createVault).toHaveBeenCalledTimes(1);
  });
});
