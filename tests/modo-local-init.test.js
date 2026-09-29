import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { resolve } from 'node:path';
import vm from 'node:vm';

const PUBLIC = resolve(import.meta.dirname, '..', 'public');
const CORE_SOURCE = readFileSync(resolve(PUBLIC, 'core.js'), 'utf8');
const LOCAL_SOURCE = readFileSync(resolve(PUBLIC, 'local.js'), 'utf8');
const PASSWORD = 'Frase-Segura-2026';
const EMAIL = 'usuario@local.test';

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

function harness(localSeed = {}, sessionSeed = {}, options = {}) {
  const listeners = new Map();
  const localStorage = localSeed instanceof MemoryStorage ? localSeed : new MemoryStorage(localSeed);
  const sessionStorage = sessionSeed instanceof MemoryStorage ? sessionSeed : new MemoryStorage(sessionSeed);
  const context = {
    console,
    crypto: webcrypto,
    Date,
    Math,
    JSON,
    Intl,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    localStorage,
    sessionStorage,
    navigator: options.withoutLocks ? {} : { locks: localStorage.locks },
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
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
    localStorage,
    sessionStorage,
    dispatchStorage(key, newValue) {
      for (const listener of listeners.get('storage') || []) listener({ key, newValue });
    },
  };
}

async function createDefaultVault(app, overrides = {}) {
  return app.repository.auth.createVault({
    name: 'Conta Protegida', email: EMAIL, password: PASSWORD, ...overrides,
  });
}

function envelopeOf(app) {
  return JSON.parse(app.localStorage.getItem(app.repository.VAULT_KEY));
}

describe('cofre local criptografado', () => {
  it('cria um workspace vazio dentro de envelope AES-GCM', async () => {
    const app = harness();
    const result = await createDefaultVault(app);
    const envelope = envelopeOf(app);

    expect(result.workspace.participants).toEqual([]);
    expect(envelope.format).toBe('plannerduo-vault');
    expect(envelope.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 });
    expect(envelope.cipher).toMatchObject({ name: 'AES-GCM', tagLength: 128 });
    expect(Buffer.from(envelope.kdf.salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(envelope.cipher.iv, 'base64')).toHaveLength(12);
    expect(JSON.parse(app.localStorage.getItem(app.repository.LEGACY_STORAGE_KEY)).migrationTombstone).toBe(true);
    expect(app.sessionStorage.getItem(app.repository.SESSION_KEY)).not.toBeNull();
    expect(await app.repository.initialize()).toEqual(result.workspace);
  }, 15000);

  it('migra o workspace legível e só então remove a origem', async () => {
    const seed = harness();
    const workspace = seed.core.createEmptyWorkspace();
    workspace.name = 'SEGREDO DA VIAGEM';
    workspace.participants.push(seed.core.createParticipant({ name: 'Nome Sensível', color: '#6366f1' }, 0));
    const shared = new MemoryStorage({ 'plannerduo:workspace:v1': JSON.stringify(workspace) });
    const legacySession = new MemoryStorage({ 'pd-cache:legacy': 'SESSAO LEGIVEL' });
    const app = harness(shared, legacySession);

    const result = await createDefaultVault(app);
    const rawVault = app.localStorage.getItem(app.repository.VAULT_KEY);
    expect(result.migrated).toBe(true);
    expect(result.workspace.name).toBe('SEGREDO DA VIAGEM');
    expect(JSON.parse(app.localStorage.getItem(app.repository.LEGACY_STORAGE_KEY)).migrationTombstone).toBe(true);
    expect(rawVault).not.toContain('SEGREDO DA VIAGEM');
    expect(rawVault).not.toContain('Nome Sensível');
    expect(legacySession.getItem('pd-cache:legacy')).toBeNull();
    expect((await app.repository.load()).participants[0].name).toBe('Nome Sensível');
  }, 15000);

  it('senha incorreta não altera nem apaga o ciphertext', async () => {
    const app = harness();
    await createDefaultVault(app);
    await app.repository.auth.lock({ allTabs: false });
    const before = app.localStorage.getItem(app.repository.VAULT_KEY);

    await expect(app.repository.auth.unlock({ email: EMAIL, password: 'Senha-Incorreta-999' }))
      .rejects.toMatchObject({ code: 'vault/invalid-credentials' });
    expect(app.localStorage.getItem(app.repository.VAULT_KEY)).toBe(before);
    expect(app.repository.auth.currentUser()).toBeNull();
  }, 15000);

  it('restaura a sessão após navegação na mesma aba', async () => {
    const sharedLocal = new MemoryStorage();
    const sharedSession = new MemoryStorage();
    const firstPage = harness(sharedLocal, sharedSession);
    await createDefaultVault(firstPage);

    const nextPage = harness(sharedLocal, sharedSession);
    const restored = await nextPage.repository.auth.restoreSession();
    expect(restored.account.email).toBe(EMAIL);
    expect((await nextPage.repository.initialize()).format).toBe('plannerduo-workspace');
  }, 15000);

  it('usa IV novo e nunca grava conteúdo mutado em texto legível', async () => {
    const app = harness();
    const created = await createDefaultVault(app);
    const firstEnvelope = envelopeOf(app);
    const updated = await app.repository.update((draft) => {
      draft.name = 'PLANO ULTRASSECRETO';
    }, created.workspace.generation);
    const secondEnvelope = envelopeOf(app);

    expect(secondEnvelope.sequence).toBe(firstEnvelope.sequence + 1);
    expect(secondEnvelope.cipher.iv).not.toBe(firstEnvelope.cipher.iv);
    expect(JSON.stringify(secondEnvelope)).not.toContain('PLANO ULTRASSECRETO');
    expect(updated.name).toBe('PLANO ULTRASSECRETO');
    expect((await app.repository.load()).name).toBe('PLANO ULTRASSECRETO');
  }, 15000);

  it('serializa alterações de duas abas desbloqueadas', async () => {
    const sharedLocal = new MemoryStorage();
    const firstTab = harness(sharedLocal);
    const created = await createDefaultVault(firstTab);
    const secondTab = harness(sharedLocal);
    await secondTab.repository.auth.unlock({ email: EMAIL, password: PASSWORD });

    await Promise.all([
      firstTab.repository.update((draft) => { draft.name = 'Nome concorrente'; }, created.workspace.generation),
      secondTab.repository.update((draft) => {
        draft.goals.push({ id: 'goal-secure', title: 'Meta', emoji: '🎯', target: 100, current: 0, deadline: '', description: '', createdAt: new Date().toISOString() });
      }, created.workspace.generation),
    ]);
    const finalState = await firstTab.repository.load();
    expect(finalState.name).toBe('Nome concorrente');
    expect(finalState.goals).toHaveLength(1);
    expect(envelopeOf(firstTab).sequence).toBe(2);
  }, 20000);

  it('troca a senha, incrementa a versão da chave e invalida a antiga', async () => {
    const app = harness();
    await createDefaultVault(app);
    const before = envelopeOf(app);
    await app.repository.auth.changePassword({ currentPassword: PASSWORD, newPassword: 'Nova-Frase-Segura-2027' });
    const after = envelopeOf(app);
    expect(after.keyVersion).toBe(before.keyVersion + 1);
    expect(after.kdf.salt).not.toBe(before.kdf.salt);

    await app.repository.auth.lock({ allTabs: false });
    await expect(app.repository.auth.unlock({ email: EMAIL, password: PASSWORD })).rejects.toMatchObject({ code: 'vault/invalid-credentials' });
    await expect(app.repository.auth.unlock({ email: EMAIL, password: 'Nova-Frase-Segura-2027' })).resolves.toBeTruthy();
  }, 25000);

  it('exporta e restaura backup criptografado mantendo a conta atual', async () => {
    const app = harness();
    const created = await createDefaultVault(app);
    await app.repository.update((draft) => { draft.name = 'Conteúdo do backup'; }, created.workspace.generation);
    const backup = await app.repository.exportEncrypted();
    expect(backup).not.toContain('Conteúdo do backup');

    await app.repository.reset();
    expect((await app.repository.load()).name).toBe('');
    const restored = await app.repository.importBackup(backup);
    expect(restored.name).toBe('Conteúdo do backup');
    expect(app.repository.auth.currentUser().email).toBe(EMAIL);
  }, 15000);

  it('falha de forma fechada quando Web Locks não está disponível', async () => {
    const app = harness({}, {}, { withoutLocks: true });
    await expect(createDefaultVault(app)).rejects.toMatchObject({ code: 'vault/locks-unavailable' });
    expect(app.localStorage.getItem(app.repository.VAULT_KEY)).toBeNull();
  }, 15000);
});

describe('bordas destrutivas e integridade do cofre', () => {
  it('rejeita migração de schema futuro sem apagar o plaintext', async () => {
    const seed = harness();
    const future = seed.core.createEmptyWorkspace();
    future.schemaVersion = 2;
    future.futureOnly = { preserve: true };
    const raw = JSON.stringify(future);
    const app = harness({ 'plannerduo:workspace:v1': raw });

    await expect(createDefaultVault(app)).rejects.toMatchObject({ code: 'local/import-version' });
    expect(app.localStorage.getItem(app.repository.LEGACY_STORAGE_KEY)).toBe(raw);
    expect(app.localStorage.getItem(app.repository.VAULT_KEY)).toBeNull();
  }, 15000);

  it('detecta mudança concorrente do plaintext antes do corte', async () => {
    const seed = harness();
    const workspace = seed.core.createEmptyWorkspace();
    const original = JSON.stringify(workspace);
    const shared = new MemoryStorage({ 'plannerduo:workspace:v1': original });
    const nativeSet = shared.setItem.bind(shared);
    let injected = false;
    shared.setItem = (key, value) => {
      nativeSet(key, value);
      if (key === 'plannerduo:vault:v1' && !injected) {
        injected = true;
        nativeSet('plannerduo:workspace:v1', JSON.stringify({ ...workspace, name: 'mudou durante a migração' }));
      }
    };
    const app = harness(shared);

    await expect(createDefaultVault(app)).rejects.toMatchObject({ code: 'vault/migration-conflict' });
    expect(app.localStorage.getItem(app.repository.VAULT_KEY)).toBeNull();
    expect(app.localStorage.getItem(app.repository.LEGACY_STORAGE_KEY)).toContain('mudou durante a migração');
  }, 15000);

  it('rejeita import plaintext com IDs duplicados', async () => {
    const app = harness();
    await createDefaultVault(app);
    const workspace = await app.repository.load();
    const base = {
      type: 'expense', description: 'Duplicada', amount: 10, date: '2026-10-10', category: 'outros',
      paidById: null, splitBetweenIds: [], tripId: null, notes: '', recurring: false,
      recurringSourceId: null, recurrenceSeriesId: null, occurrenceMonth: null,
      recurrenceSkippedMonths: [], createdAt: new Date().toISOString(),
    };
    workspace.finances = [{ ...base, id: 'duplicado' }, { ...base, id: 'duplicado', description: 'Outra' }];
    await expect(app.repository.importBackup(JSON.stringify(workspace))).rejects.toMatchObject({ code: 'local/import-invalid-data' });
  }, 15000);

  it('expõe cofre ou legado malformado para download e recuperação explícita', () => {
    const app = harness({ 'plannerduo:vault:v1': '{' });
    const status = app.repository.auth.status();
    expect(status).toMatchObject({ exists: true, corrupt: true, account: null });
    expect(app.repository.auth.exportRawVault()).toBe('{');

    const legacy = harness({ 'plannerduo:workspace:v1': '{legado' });
    expect(legacy.repository.auth.status()).toMatchObject({ exists: false, legacyCorrupt: true, hasLegacyWorkspace: true });
    expect(legacy.repository.auth.exportRawLegacy()).toBe('{legado');
  });

  it('adulteração do ciphertext falha sem substituir o cofre por vazio', async () => {
    const app = harness();
    await createDefaultVault(app);
    await app.repository.auth.lock({ allTabs: false });
    const envelope = envelopeOf(app);
    envelope.cipher.data = `${envelope.cipher.data.slice(0, -2)}AA`;
    const tampered = JSON.stringify(envelope);
    app.localStorage.setItem(app.repository.VAULT_KEY, tampered);

    await expect(app.repository.auth.unlock({ email: EMAIL, password: PASSWORD }))
      .rejects.toMatchObject({ code: 'vault/invalid-credentials' });
    expect(app.localStorage.getItem(app.repository.VAULT_KEY)).toBe(tampered);
  }, 15000);

  it('uma época global invalida a sessão de outra aba', async () => {
    const shared = new MemoryStorage();
    const first = harness(shared);
    await createDefaultVault(first);
    const second = harness(shared);
    await second.repository.auth.unlock({ email: EMAIL, password: PASSWORD });
    let locked = false;
    second.repository.subscribe(() => {}, () => { locked = true; });

    await first.repository.auth.lock({ allTabs: true });
    const epoch = shared.getItem(first.repository.AUTH_EPOCH_KEY);
    second.dispatchStorage(first.repository.AUTH_EPOCH_KEY, epoch);
    expect(locked).toBe(true);
    expect(second.repository.auth.currentUser()).toBeNull();
  }, 15000);

  it('backup anterior à troca de senha exige e aceita a senha antiga', async () => {
    const app = harness();
    await createDefaultVault(app);
    const backup = await app.repository.exportEncrypted();
    await app.repository.auth.changePassword({ currentPassword: PASSWORD, newPassword: 'Senha-Nova-Protegida-2028' });

    await expect(app.repository.importBackup(backup)).rejects.toMatchObject({ code: 'vault/backup-password-required' });
    await expect(app.repository.importBackup(backup, PASSWORD)).resolves.toBeTruthy();
  }, 25000);

  it('duas criações concorrentes nunca sobrescrevem o primeiro cofre', async () => {
    const shared = new MemoryStorage();
    const first = harness(shared);
    const second = harness(shared);
    const results = await Promise.allSettled([createDefaultVault(first), createDefaultVault(second)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(envelopeOf(first).format).toBe('plannerduo-vault');
  }, 20000);
});

describe('prazo da sessão', () => {
  it('não restaura uma chave de sessão expirada', async () => {
    const sharedLocal = new MemoryStorage();
    const sharedSession = new MemoryStorage();
    const first = harness(sharedLocal, sharedSession);
    await createDefaultVault(first);
    const marker = JSON.parse(sharedSession.getItem(first.repository.SESSION_KEY));
    marker.expiresAt = Date.now() - 1;
    sharedSession.setItem(first.repository.SESSION_KEY, JSON.stringify(marker));

    const reloaded = harness(sharedLocal, sharedSession);
    expect(await reloaded.repository.auth.restoreSession()).toBeNull();
    expect(sharedSession.getItem(first.repository.SESSION_KEY)).toBeNull();
  }, 15000);
});

describe('rollback do cutover', () => {
  it('mantém o plaintext completo se uma etapa anterior ao tombstone falhar', async () => {
    const seed = harness();
    const workspace = seed.core.createEmptyWorkspace();
    workspace.name = 'NÃO PODE SUMIR';
    const raw = JSON.stringify(workspace);
    const shared = new MemoryStorage({ 'plannerduo:workspace:v1': raw });
    const nativeSet = shared.setItem.bind(shared);
    shared.setItem = (key, value) => {
      if (key === 'plannerduo:clean-start:v1') throw new Error('quota simulada');
      nativeSet(key, value);
    };
    const app = harness(shared);

    await expect(createDefaultVault(app)).rejects.toBeTruthy();
    expect(shared.getItem(app.repository.LEGACY_STORAGE_KEY)).toBe(raw);
    expect(shared.getItem(app.repository.VAULT_KEY)).toBeNull();
  }, 15000);

  it('preserva plaintext que reaparece após o corte até decisão do usuário', async () => {
    const app = harness();
    await createDefaultVault(app);
    const current = await app.repository.load();
    const legacyCopy = { ...current, name: 'ALTERAÇÃO DE ABA ANTIGA' };
    app.localStorage.setItem(app.repository.LEGACY_STORAGE_KEY, JSON.stringify(legacyCopy));

    await app.repository.initialize();
    expect(app.repository.auth.status().hasLegacyWorkspace).toBe(true);
    expect(app.repository.auth.exportRawLegacy()).toContain('ALTERAÇÃO DE ABA ANTIGA');
    expect(app.repository.getLastWarning().code).toBe('vault/legacy-reappeared');
    await app.repository.auth.discardLegacyConflict();
    expect(app.repository.auth.status().hasLegacyWorkspace).toBe(false);
  }, 15000);
});
