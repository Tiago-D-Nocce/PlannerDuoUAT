import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const PUBLIC = resolve(import.meta.dirname, '..', 'public');
const CORE_SOURCE = readFileSync(resolve(PUBLIC, 'core.js'), 'utf8');
const LOCAL_SOURCE = readFileSync(resolve(PUBLIC, 'local.js'), 'utf8');

class MemoryLocks {
  constructor() { this.queues = new Map(); }
  request(name, _options, operation) {
    const previous = this.queues.get(name) || Promise.resolve();
    const run = previous.then(operation, operation);
    this.queues.set(name, run.catch(() => undefined));
    return run;
  }
}

class MemoryStorage {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
    this.locks = new MemoryLocks();
  }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function harness(localSeed = {}, sessionSeed = {}) {
  const listeners = new Map();
  const sharedLocalStorage = localSeed instanceof MemoryStorage ? localSeed : new MemoryStorage(localSeed);
  const context = {
    console,
    crypto,
    Date,
    Math,
    JSON,
    Intl,
    localStorage: sharedLocalStorage,
    sessionStorage: new MemoryStorage(sessionSeed),
    navigator: { locks: sharedLocalStorage.locks },
    addEventListener(type, listener) {
      const current = listeners.get(type) || [];
      current.push(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter((item) => item !== listener));
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(CORE_SOURCE, context, { filename: 'core.js' });
  vm.runInContext(LOCAL_SOURCE, context, { filename: 'local.js' });
  return {
    core: context.PlannerCore,
    repository: context.PlannerLocal,
    localStorage: context.localStorage,
    sessionStorage: context.sessionStorage,
    dispatchStorage(key, newValue) {
      for (const listener of listeners.get('storage') || []) listener({ key, newValue });
    },
    listenerCount(type) { return (listeners.get(type) || []).length; },
  };
}

describe('inicialização do banco local', () => {
  it('remove o banco legado e cria um workspace realmente vazio', async () => {
    const app = harness({
      'pd-cache:antigo': '{"financas":[1]}',
      'pd-buscas:antigo': '[]',
      'plannerduo-local:v1:users': '{}',
      'pd-tema': 'dark',
      'chave-de-outro-app': 'preservar',
    }, { 'plannerduo-local:v1:session': '{}' });

    const workspace = await app.repository.initialize();
    expect(workspace.name).toBe('');
    expect(workspace.participants.length).toBe(0);
    expect(workspace.finances.length).toBe(0);
    expect(app.localStorage.getItem('pd-cache:antigo')).toBeNull();
    expect(app.localStorage.getItem('pd-buscas:antigo')).toBeNull();
    expect(app.localStorage.getItem('plannerduo-local:v1:users')).toBeNull();
    expect(app.localStorage.getItem('pd-tema')).toBeNull();
    expect(app.sessionStorage.getItem('plannerduo-local:v1:session')).toBeNull();
    expect(app.localStorage.getItem('chave-de-outro-app')).toBe('preservar');
    expect(app.localStorage.getItem(app.repository.CLEAN_START_KEY)).toBe('done');
    expect(app.localStorage.getItem(app.repository.STORAGE_KEY)).not.toBeNull();
  });

  it('executa a limpeza destrutiva somente uma vez', async () => {
    const app = harness();
    const initial = await app.repository.initialize();
    const saved = await app.repository.update((draft) => { draft.name = 'Persistente'; }, initial.generation);
    expect(saved.revision).toBe(1);
    expect(app.repository.load().name).toBe('Persistente');
  });

  it('recupera JSON corrompido e o reset remove o diagnóstico', async () => {
    const app = harness({
      'plannerduo:clean-start:v1': 'done',
      'plannerduo:workspace:v1': '{json inválido',
    });
    const workspace = await app.repository.initialize();
    expect(workspace.participants.length).toBe(0);
    expect(app.repository.getLastWarning().code).toBe('local/storage-corrupt');
    expect([...app.localStorage.values.keys()].some((key) => key.startsWith('plannerduo:corrupt:'))).toBe(true);
    await app.repository.reset();
    expect([...app.localStorage.values.keys()].some((key) => key.startsWith('plannerduo:corrupt:'))).toBe(false);
  });
});

describe('persistência e portabilidade', () => {
  it('aplica mutações sobre o snapshot mais recente e incrementa revisões', async () => {
    const app = harness();
    const initial = await app.repository.initialize();
    const first = await app.repository.update((draft) => { draft.name = 'Workspace'; }, initial.generation);
    const second = await app.repository.update((draft) => { draft.name = 'Workspace atualizado'; }, first.generation);
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(app.repository.load().name).toBe('Workspace atualizado');
  });

  it('faz round-trip de backup completo e rejeita versão incompatível', async () => {
    const app = harness();
    const initial = await app.repository.initialize();
    const workspace = await app.repository.update((draft) => {
      draft.name = 'Backup';
      draft.participants.push(app.core.createParticipant({ name: 'Livre', color: '#6366f1' }, 0));
    }, initial.generation);

    const restored = await app.repository.importJson(app.repository.exportJson(workspace));
    expect(restored.name).toBe('Backup');
    expect(restored.participants[0].name).toBe('Livre');
    expect(() => app.repository.importJson('{"schemaVersion":999}')).toThrow(/versão/i);
  });

  it('rejeita backup que seria coercivo ou perderia campos', async () => {
    const app = harness();
    const workspace = await app.repository.initialize();
    const invalid = JSON.parse(app.repository.exportJson(workspace));
    invalid.participants.push({ id: 'p', name: 'Teste', color: '#6366f1', active: 'false', createdAt: new Date().toISOString() });
    expect(() => app.repository.importJson(JSON.stringify(invalid))).toThrow(/participante|inválidos/i);
  });

  it('reset retorna ao estado vazio com nova geração', async () => {
    const app = harness();
    const initial = await app.repository.initialize();
    const saved = await app.repository.update((draft) => { draft.name = 'Será apagado'; }, initial.generation);
    const empty = await app.repository.reset();
    expect(empty.name).toBe('');
    expect(empty.participants.length).toBe(0);
    expect(empty.revision).toBe(saved.revision + 1);
    expect(empty.generation).not.toBe(saved.generation);
  });

  it('notifica outra aba e remove o listener ao cancelar inscrição', async () => {
    const app = harness();
    const initial = await app.repository.initialize();
    const received = [];
    const unsubscribe = app.repository.subscribe((workspace) => received.push(workspace));
    expect(app.listenerCount('storage')).toBe(1);
    app.dispatchStorage(app.repository.STORAGE_KEY, JSON.stringify({ ...initial, name: 'Outra aba', revision: 2 }));
    expect(received).toHaveLength(1);
    expect(received[0].name).toBe('Outra aba');
    unsubscribe();
    expect(app.listenerCount('storage')).toBe(0);
  });
});

describe('concorrência e exclusão entre abas', () => {
  it('serializa duas mutações concorrentes sem perder campos', async () => {
    const shared = new MemoryStorage();
    const firstTab = harness(shared);
    const secondTab = harness(shared);
    const initial = await firstTab.repository.initialize();
    await secondTab.repository.initialize();

    await Promise.all([
      firstTab.repository.update((draft) => { draft.name = 'Alteração da primeira aba'; }, initial.generation),
      secondTab.repository.update((draft) => {
        draft.goals.push({
          id: 'goal-1', title: 'Meta', emoji: '🎯', target: 10, current: 0,
          deadline: '', description: '', createdAt: new Date().toISOString(),
        });
      }, initial.generation),
    ]);

    const finalState = firstTab.repository.load();
    expect(finalState.name).toBe('Alteração da primeira aba');
    expect(finalState.goals).toHaveLength(1);
    expect(finalState.revision).toBe(2);
  });

  it('invalida writers antigos depois de reset e impede ressurreição', async () => {
    const shared = new MemoryStorage();
    const currentTab = harness(shared);
    const staleTab = harness(shared);
    const initial = await currentTab.repository.initialize();
    const saved = await currentTab.repository.update((draft) => { draft.name = 'Dados existentes'; }, initial.generation);
    const stale = await staleTab.repository.initialize();

    const empty = await currentTab.repository.reset();
    expect(empty.revision).toBe(saved.revision + 1);
    await expect(staleTab.repository.update((draft) => { draft.name = 'Ressuscitado'; }, stale.generation))
      .rejects.toMatchObject({ code: 'local/workspace-replaced' });
    expect(currentTab.repository.load().name).toBe('');
  });

  it('rejeita objetos que não sejam backups completos', () => {
    const app = harness();
    app.repository.load();
    expect(() => app.repository.importJson('{"schemaVersion":1}')).toThrow(/versão|formato/i);
  });
});
