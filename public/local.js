/* PlannerDuo — cofre local autenticado e repositório criptografado. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerLocal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const VAULT_KEY = 'plannerduo:vault:v1';
  const LEGACY_STORAGE_KEY = 'plannerduo:workspace:v1';
  const SESSION_KEY = 'plannerduo:vault-session:v1';
  const AUTH_EVENT_KEY = 'plannerduo:vault-event:v1';
  const AUTH_EPOCH_KEY = 'plannerduo:vault-auth-epoch:v1';
  const CLEAN_START_KEY = 'plannerduo:clean-start:v1';
  const THEME_KEY = 'plannerduo:theme:v2';
  const VAULT_FORMAT = 'plannerduo-vault';
  const VAULT_VERSION = 1;
  const KDF_ITERATIONS = 600000;
  const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
  const LEGACY_EXACT_KEYS = ['pd-casalId', 'pd-buscas', 'pd-tema'];
  const LEGACY_PREFIXES = ['pd-cache:', 'pd-buscas:', 'plannerduo-local:v1:'];
  let activeSession = null;
  let lastWarning = null;
  let lastDeliveredSequence = -1;

  function core() {
    if (!root.PlannerCore) throw createError('local/core-unavailable', 'O módulo de dados não foi carregado.');
    return root.PlannerCore;
  }

  function createError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }

  function cryptoApi() {
    const api = root.crypto;
    if (!api || !api.subtle || typeof api.getRandomValues !== 'function') {
      throw createError('vault/crypto-unavailable', 'Este navegador não oferece a criptografia necessária. Use uma versão atual por localhost.');
    }
    return api;
  }

  function storage() {
    if (!root.localStorage) throw createError('local/storage-unavailable', 'O armazenamento local não está disponível.');
    const probe = 'plannerduo:storage-probe';
    try {
      root.localStorage.setItem(probe, '1');
      root.localStorage.removeItem(probe);
      return root.localStorage;
    } catch (cause) {
      throw createError('local/storage-unavailable', 'Permita o armazenamento do navegador para usar o PlannerDuo.', cause);
    }
  }

  function sessionStorageApi() {
    if (!root.sessionStorage) throw createError('vault/session-unavailable', 'O armazenamento da sessão não está disponível.');
    try {
      const probe = 'plannerduo:session-probe';
      root.sessionStorage.setItem(probe, '1');
      root.sessionStorage.removeItem(probe);
      return root.sessionStorage;
    } catch (cause) {
      throw createError('vault/session-unavailable', 'Permita o armazenamento da sessão para manter o cofre desbloqueado.', cause);
    }
  }

  function readAuthEpoch() {
    try { return storage().getItem(AUTH_EPOCH_KEY) || '0'; }
    catch (_) { return '0'; }
  }

  function advanceAuthEpoch() {
    const next = randomId('epoch');
    const targetStorage = storage();
    targetStorage.setItem(AUTH_EPOCH_KEY, next);
    if (targetStorage.getItem(AUTH_EPOCH_KEY) !== next) {
      throw createError('vault/global-lock-failed', 'Não foi possível invalidar as outras sessões.');
    }
    return next;
  }

  function withVaultLock(operation) {
    const locks = root.navigator && root.navigator.locks;
    if (!locks || typeof locks.request !== 'function') {
      return Promise.reject(createError('vault/locks-unavailable', 'Este navegador não suporta bloqueio seguro entre abas. Atualize o navegador.'));
    }
    return locks.request(LEGACY_STORAGE_KEY, { mode: 'exclusive' }, operation);
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function canonicalJson(value) {
    function sort(current) {
      if (Array.isArray(current)) return current.map(sort);
      if (!current || typeof current !== 'object') return current;
      return Object.keys(current).sort().reduce((result, key) => {
        result[key] = sort(current[key]);
        return result;
      }, {});
    }
    return JSON.stringify(sort(value));
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let index = 0; index < source.length; index += 1) binary += String.fromCharCode(source[index]);
    if (typeof root.btoa !== 'function') throw createError('vault/encoding-unavailable', 'Codificação segura indisponível.');
    return root.btoa(binary);
  }

  function base64ToBytes(value) {
    if (typeof value !== 'string' || typeof root.atob !== 'function') throw createError('vault/invalid-envelope', 'Cofre local inválido.');
    try {
      const binary = root.atob(value);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch (cause) {
      throw createError('vault/invalid-envelope', 'Cofre local inválido.', cause);
    }
  }

  function randomBytes(size) {
    const bytes = new Uint8Array(size);
    cryptoApi().getRandomValues(bytes);
    return bytes;
  }

  function randomId(prefix) {
    const api = cryptoApi();
    if (typeof api.randomUUID === 'function') return `${prefix}-${api.randomUUID()}`;
    return `${prefix}-${bytesToBase64(randomBytes(18)).replace(/[^a-z0-9]/gi, '')}`;
  }

  function normalizeEmail(value) {
    const email = String(value == null ? '' : value).normalize('NFKC').trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw createError('vault/invalid-email', 'Informe um e-mail válido. Ele será usado apenas como identificador local.');
    }
    return email;
  }

  function validateDisplayName(value) {
    const name = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 60) throw createError('vault/invalid-name', 'Informe um nome entre 2 e 60 caracteres.');
    return name;
  }

  function validatePassword(value) {
    const password = String(value == null ? '' : value);
    if (password.length < 10 || password.length > 128 || !/[\p{L}]/u.test(password) || !/\d/.test(password)) {
      throw createError('vault/weak-password', 'Use de 10 a 128 caracteres, com pelo menos uma letra e um número.');
    }
    return password;
  }

  async function deriveKeyMaterial(email, password, salt, iterations) {
    const api = cryptoApi();
    const encoder = new TextEncoder();
    const source = encoder.encode(`${email}\u0000${password}`);
    const material = await api.subtle.importKey('raw', source, 'PBKDF2', false, ['deriveBits']);
    const bits = await api.subtle.deriveBits({
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    }, material, 256);
    const bytes = new Uint8Array(bits);
    const key = await api.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return { key, bytes };
  }

  async function importSessionKey(encoded) {
    return cryptoApi().subtle.importKey('raw', base64ToBytes(encoded), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  function envelopeHeader(envelope) {
    return {
      format: envelope.format,
      version: envelope.version,
      vaultId: envelope.vaultId,
      sequence: envelope.sequence,
      keyVersion: envelope.keyVersion,
      account: envelope.account,
      kdf: envelope.kdf,
      cipher: {
        name: envelope.cipher.name,
        tagLength: envelope.cipher.tagLength,
        iv: envelope.cipher.iv,
      },
      createdAt: envelope.createdAt,
      updatedAt: envelope.updatedAt,
    };
  }

  function parseEnvelope(input) {
    let envelope = input;
    if (typeof input === 'string') {
      try { envelope = JSON.parse(input); }
      catch (cause) { throw createError('vault/invalid-envelope', 'O cofre local está danificado.', cause); }
    }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || envelope.format !== VAULT_FORMAT || envelope.version !== VAULT_VERSION
      || typeof envelope.vaultId !== 'string' || !envelope.vaultId
      || !Number.isInteger(envelope.sequence) || envelope.sequence < 0
      || !Number.isInteger(envelope.keyVersion) || envelope.keyVersion < 1
      || !envelope.account || typeof envelope.account !== 'object'
      || typeof envelope.account.email !== 'string' || typeof envelope.account.name !== 'string'
      || !envelope.kdf || envelope.kdf.name !== 'PBKDF2' || envelope.kdf.hash !== 'SHA-256'
      || !Number.isInteger(envelope.kdf.iterations) || envelope.kdf.iterations < 100000 || envelope.kdf.iterations > 2000000
      || !envelope.cipher || envelope.cipher.name !== 'AES-GCM' || envelope.cipher.tagLength !== 128
      || typeof envelope.cipher.data !== 'string'
      || typeof envelope.createdAt !== 'string' || typeof envelope.updatedAt !== 'string') {
      throw createError('vault/invalid-envelope', 'O cofre local está danificado.');
    }
    const salt = base64ToBytes(envelope.kdf.salt);
    const iv = base64ToBytes(envelope.cipher.iv);
    const data = base64ToBytes(envelope.cipher.data);
    if (salt.length !== 16 || iv.length !== 12 || data.length < 17) throw createError('vault/invalid-envelope', 'O cofre local está danificado.');
    return clone(envelope);
  }

  async function encryptWorkspace(workspace, key, options) {
    const normalized = core().normalizeWorkspace(workspace);
    const iv = randomBytes(12);
    const updatedAt = options.updatedAt || new Date().toISOString();
    const envelope = {
      format: VAULT_FORMAT,
      version: VAULT_VERSION,
      vaultId: options.vaultId,
      sequence: options.sequence,
      keyVersion: options.keyVersion,
      account: clone(options.account),
      kdf: clone(options.kdf),
      cipher: {
        name: 'AES-GCM',
        tagLength: 128,
        iv: bytesToBase64(iv),
        data: '',
      },
      createdAt: options.createdAt,
      updatedAt,
    };
    const encoder = new TextEncoder();
    const ciphertext = await cryptoApi().subtle.encrypt({
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(canonicalJson(envelopeHeader(envelope))),
      tagLength: 128,
    }, key, encoder.encode(JSON.stringify(normalized)));
    envelope.cipher.data = bytesToBase64(new Uint8Array(ciphertext));
    return { envelope, workspace: normalized };
  }

  async function decryptEnvelope(envelopeInput, key) {
    const envelope = parseEnvelope(envelopeInput);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let plaintext;
    try {
      plaintext = await cryptoApi().subtle.decrypt({
        name: 'AES-GCM',
        iv: base64ToBytes(envelope.cipher.iv),
        additionalData: new TextEncoder().encode(canonicalJson(envelopeHeader(envelope))),
        tagLength: 128,
      }, key, base64ToBytes(envelope.cipher.data));
    } catch (cause) {
      throw createError('vault/invalid-credentials', 'Credenciais incorretas ou cofre local danificado.', cause);
    }
    let parsed;
    try { parsed = JSON.parse(decoder.decode(plaintext)); }
    catch (cause) { throw createError('vault/invalid-data', 'O conteúdo criptografado do cofre é inválido.', cause); }
    validateWorkspace(parsed);
    return core().normalizeWorkspace(parsed);
  }

  function readVaultEnvelope() {
    const raw = storage().getItem(VAULT_KEY);
    if (!raw) return null;
    return parseEnvelope(raw);
  }

  function removeKeysWithPrefix(targetStorage, prefix) {
    const keys = [];
    for (let index = 0; index < targetStorage.length; index += 1) {
      const key = targetStorage.key(index);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => targetStorage.removeItem(key));
  }

  function isMigrationTombstone(raw) {
    if (!raw) return false;
    try { return JSON.parse(raw).migrationTombstone === true; }
    catch (_) { return false; }
  }

  function writeMigrationTombstone(sourceRevision) {
    const tombstone = core().createEmptyWorkspace();
    tombstone.generation = randomId('migrated');
    tombstone.revision = Math.max(0, Number(sourceRevision) || 0) + 1;
    tombstone.settings.onboardingCompleted = true;
    tombstone.migrationTombstone = true;
    tombstone.migratedAt = new Date().toISOString();
    storage().setItem(LEGACY_STORAGE_KEY, JSON.stringify(tombstone));
  }

  function clearLegacySessionStorage() {
    try {
      const session = sessionStorageApi();
      const sessionKeys = [];
      for (let index = 0; index < session.length; index += 1) {
        const key = session.key(index);
        if (key) sessionKeys.push(key);
      }
      sessionKeys.filter((key) => LEGACY_EXACT_KEYS.includes(key) || LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix)))
        .forEach((key) => session.removeItem(key));
    } catch (_) {
      // A sessão nova continua válida; resíduos legados serão tentados novamente.
    }
  }

  function removeLegacyAfterMigration(expectedLegacyRaw, sourceRevision) {
    const targetStorage = storage();
    const currentLegacyRaw = targetStorage.getItem(LEGACY_STORAGE_KEY);
    clearLegacySessionStorage();
    if (expectedLegacyRaw === undefined && currentLegacyRaw && !isMigrationTombstone(currentLegacyRaw)) {
      lastWarning = {
        code: 'vault/legacy-reappeared',
        message: 'Uma versão antiga gravou dados legíveis após a migração. A cópia foi preservada para download e não substituiu o cofre.',
      };
      return false;
    }
    if (expectedLegacyRaw !== undefined && currentLegacyRaw !== expectedLegacyRaw) {
      throw createError('vault/migration-conflict', 'Os dados antigos mudaram durante a migração. A cópia legível foi preservada.');
    }
    LEGACY_EXACT_KEYS.forEach((key) => targetStorage.removeItem(key));
    const keys = [];
    for (let index = 0; index < targetStorage.length; index += 1) {
      const key = targetStorage.key(index);
      if (key) keys.push(key);
    }
    keys.filter((key) => LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix)))
      .forEach((key) => targetStorage.removeItem(key));
    removeKeysWithPrefix(targetStorage, 'plannerduo:corrupt:');
    targetStorage.setItem(CLEAN_START_KEY, 'vault');
    // Última operação: depois deste ponto não há etapa que possa deixar apenas o tombstone.
    if (!isMigrationTombstone(currentLegacyRaw)) writeMigrationTombstone(sourceRevision);
  }

  function writeEnvelope(envelope) {
    try {
      storage().setItem(VAULT_KEY, JSON.stringify(envelope));
    } catch (cause) {
      throw createError('local/write-failed', 'Não foi possível salvar o cofre. Verifique o espaço disponível no navegador.', cause);
    }
  }

  function sessionMarker() {
    let marker;
    try { marker = JSON.parse(sessionStorageApi().getItem(SESSION_KEY) || 'null'); }
    catch (_) { return null; }
    if (!marker || marker.format !== 'plannerduo-vault-session' || typeof marker.key !== 'string'
      || typeof marker.vaultId !== 'string' || !Number.isInteger(marker.keyVersion)
      || typeof marker.epoch !== 'string' || marker.epoch !== readAuthEpoch()
      || !Number.isFinite(marker.expiresAt) || marker.expiresAt <= Date.now()) return null;
    return marker;
  }

  function clearSession() {
    activeSession = null;
    lastDeliveredSequence = -1;
    try { sessionStorageApi().removeItem(SESSION_KEY); } catch (_) {}
  }

  async function saveSession(envelope, key, keyBytes) {
    const marker = {
      format: 'plannerduo-vault-session',
      vaultId: envelope.vaultId,
      keyVersion: envelope.keyVersion,
      email: envelope.account.email,
      epoch: readAuthEpoch(),
      key: bytesToBase64(keyBytes),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    sessionStorageApi().setItem(SESSION_KEY, JSON.stringify(marker));
    activeSession = {
      vaultId: envelope.vaultId,
      keyVersion: envelope.keyVersion,
      email: envelope.account.email,
      account: clone(envelope.account),
      epoch: marker.epoch,
      key,
      expiresAt: marker.expiresAt,
    };
    lastDeliveredSequence = envelope.sequence;
  }

  async function restoreSession() {
    if (activeSession && activeSession.expiresAt > Date.now() && activeSession.epoch === readAuthEpoch()) {
      return { account: clone(activeSession.account), expiresAt: activeSession.expiresAt };
    }
    const marker = sessionMarker();
    if (!marker) {
      clearSession();
      return null;
    }
    let envelope;
    try {
      envelope = readVaultEnvelope();
      if (!envelope || envelope.vaultId !== marker.vaultId || envelope.keyVersion !== marker.keyVersion
        || envelope.account.email !== marker.email) throw createError('vault/session-invalid', 'A sessão não corresponde ao cofre atual.');
      const key = await importSessionKey(marker.key);
      await decryptEnvelope(envelope, key);
      activeSession = {
        vaultId: envelope.vaultId,
        keyVersion: envelope.keyVersion,
        email: envelope.account.email,
        account: clone(envelope.account),
        epoch: marker.epoch,
        key,
        expiresAt: marker.expiresAt,
      };
      lastDeliveredSequence = envelope.sequence;
      return { account: clone(envelope.account), expiresAt: marker.expiresAt };
    } catch (_) {
      clearSession();
      return null;
    }
  }

  async function requireSession() {
    const restored = await restoreSession();
    if (!restored || !activeSession) throw createError('vault/locked', 'O cofre está bloqueado. Entre novamente.');
    return activeSession;
  }

  function vaultStatus() {
    const targetStorage = storage();
    const rawEnvelope = targetStorage.getItem(VAULT_KEY);
    let envelope = null;
    let corrupt = false;
    if (rawEnvelope) {
      try { envelope = parseEnvelope(rawEnvelope); }
      catch (_) { corrupt = true; }
    }
    const legacyRaw = targetStorage.getItem(LEGACY_STORAGE_KEY);
    let legacyCorrupt = false;
    if (legacyRaw && !isMigrationTombstone(legacyRaw)) {
      try { validateWorkspace(JSON.parse(legacyRaw)); }
      catch (_) { legacyCorrupt = true; }
    }
    return Object.freeze({
      exists: Boolean(rawEnvelope),
      corrupt,
      legacyCorrupt,
      account: envelope ? clone(envelope.account) : null,
      hasLegacyWorkspace: Boolean(legacyRaw && !isMigrationTombstone(legacyRaw)),
      sessionActive: Boolean(sessionMarker()),
    });
  }

  async function createVault(input) {
    const name = validateDisplayName(input && input.name);
    const email = normalizeEmail(input && input.email);
    const password = validatePassword(input && input.password);
    const salt = randomBytes(16);
    const material = await deriveKeyMaterial(email, password, salt, KDF_ITERATIONS);
    const result = await withVaultLock(async () => {
      if (storage().getItem(VAULT_KEY)) throw createError('vault/already-exists', 'Já existe um cofre neste navegador. Entre com a conta existente.');
      const legacyRaw = storage().getItem(LEGACY_STORAGE_KEY);
      const hasLegacyData = Boolean(legacyRaw && !isMigrationTombstone(legacyRaw));
      let workspace = core().createEmptyWorkspace();
      if (hasLegacyData) {
        let parsedLegacy;
        try { parsedLegacy = JSON.parse(legacyRaw); }
        catch (cause) { throw createError('vault/legacy-invalid', 'Os dados atuais estão inválidos. Exporte ou corrija o banco antes de criar o cofre.', cause); }
        validateWorkspace(parsedLegacy);
        workspace = clone(parsedLegacy);
      }
      const timestamp = new Date().toISOString();
      const options = {
        vaultId: randomId('vault'),
        sequence: 0,
        keyVersion: 1,
        account: { email, name },
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS, salt: bytesToBase64(salt) },
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const encrypted = await encryptWorkspace(workspace, material.key, options);
      writeEnvelope(encrypted.envelope);
      let persisted;
      let verified;
      try {
        persisted = readVaultEnvelope();
        verified = await decryptEnvelope(persisted, material.key);
        if (canonicalJson(verified) !== canonicalJson(encrypted.workspace)) throw new Error('verification-mismatch');
      } catch (cause) {
        storage().removeItem(VAULT_KEY);
        throw createError('vault/migration-failed', 'Não foi possível verificar o novo cofre. Os dados antigos foram preservados.', cause);
      }
      try {
        removeLegacyAfterMigration(legacyRaw, workspace.revision);
      } catch (cause) {
        storage().removeItem(VAULT_KEY);
        throw cause;
      }
      return { envelope: persisted, workspace: verified, migrated: hasLegacyData };
    });
    await saveSession(result.envelope, material.key, material.bytes);
    return { account: clone(result.envelope.account), workspace: clone(result.workspace), migrated: result.migrated };
  }

  async function unlock(input) {
    const email = normalizeEmail(input && input.email);
    const password = String((input && input.password) || '');
    return withVaultLock(async () => {
      const envelope = readVaultEnvelope();
      if (!envelope) throw createError('vault/not-found', 'Nenhum cofre foi criado neste navegador.');
      if (envelope.account.email !== email) throw createError('vault/invalid-credentials', 'E-mail ou senha incorretos.');
      const material = await deriveKeyMaterial(email, password, base64ToBytes(envelope.kdf.salt), envelope.kdf.iterations);
      let workspace;
      try { workspace = await decryptEnvelope(envelope, material.key); }
      catch (_) { throw createError('vault/invalid-credentials', 'E-mail ou senha incorretos.'); }
      await saveSession(envelope, material.key, material.bytes);
      removeLegacyAfterMigration(undefined, workspace.revision);
      return { account: clone(envelope.account), workspace: clone(workspace) };
    });
  }

  async function currentEnvelopeAndWorkspace() {
    const session = await requireSession();
    const envelope = readVaultEnvelope();
    if (!envelope || envelope.vaultId !== session.vaultId || envelope.keyVersion !== session.keyVersion) {
      clearSession();
      throw createError('vault/session-invalid', 'A conta ou a senha mudou. Entre novamente.');
    }
    const workspace = await decryptEnvelope(envelope, session.key);
    return { session, envelope, workspace };
  }

  async function initialize() {
    return withVaultLock(async () => {
      const current = await currentEnvelopeAndWorkspace();
      removeLegacyAfterMigration(undefined, current.workspace.revision);
      return clone(current.workspace);
    });
  }

  async function load() {
    const current = await currentEnvelopeAndWorkspace();
    return clone(current.workspace);
  }

  async function update(mutator, expectedGeneration) {
    if (typeof mutator !== 'function') throw createError('local/invalid-mutation', 'A alteração local é inválida.');
    return withVaultLock(async () => {
      const current = await currentEnvelopeAndWorkspace();
      if (expectedGeneration && current.workspace.generation !== expectedGeneration) {
        const conflict = createError('local/workspace-replaced', 'O workspace foi apagado ou restaurado em outra aba.');
        conflict.currentWorkspace = clone(current.workspace);
        throw conflict;
      }
      const draft = clone(current.workspace);
      const result = mutator(draft);
      const candidate = result && typeof result === 'object' ? result : draft;
      const normalized = core().normalizeWorkspace(candidate);
      normalized.generation = current.workspace.generation;
      normalized.revision = current.workspace.revision + 1;
      normalized.updatedAt = new Date().toISOString();
      const encrypted = await encryptWorkspace(normalized, current.session.key, {
        ...envelopeHeader(current.envelope),
        sequence: current.envelope.sequence + 1,
        updatedAt: normalized.updatedAt,
      });
      writeEnvelope(encrypted.envelope);
      lastDeliveredSequence = encrypted.envelope.sequence;
      return clone(encrypted.workspace);
    });
  }

  async function reset() {
    return withVaultLock(async () => {
      const current = await currentEnvelopeAndWorkspace();
      const workspace = core().createEmptyWorkspace();
      workspace.revision = current.workspace.revision + 1;
      workspace.updatedAt = new Date().toISOString();
      const encrypted = await encryptWorkspace(workspace, current.session.key, {
        ...envelopeHeader(current.envelope),
        sequence: current.envelope.sequence + 1,
        updatedAt: workspace.updatedAt,
      });
      writeEnvelope(encrypted.envelope);
      removeKeysWithPrefix(storage(), 'plannerduo:corrupt:');
      lastDeliveredSequence = encrypted.envelope.sequence;
      return clone(encrypted.workspace);
    });
  }

  function validateWorkspace(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || parsed.format !== core().FORMAT || Number(parsed.schemaVersion) !== core().SCHEMA_VERSION
      || parsed.id !== 'workspace-local' || typeof parsed.generation !== 'string' || !parsed.generation) {
      throw createError('local/import-version', 'A versão ou o formato do workspace não é compatível.');
    }
    const arrayFields = ['participants', 'finances', 'trips', 'goals', 'checklist', 'decisions'];
    if (arrayFields.some((field) => !Array.isArray(parsed[field]))
      || !parsed.budgets || typeof parsed.budgets !== 'object' || Array.isArray(parsed.budgets)
      || !parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) {
      throw createError('local/import-invalid-data', 'O workspace está incompleto ou possui estrutura inválida.');
    }

    function idsOf(items, label) {
      const ids = new Set();
      items.forEach((item) => {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) {
          throw createError('local/import-invalid-data', `Há IDs inválidos ou duplicados em ${label}.`);
        }
        ids.add(item.id);
      });
      return ids;
    }
    function validTimestamp(value) {
      if (typeof value !== 'string' || !value) return false;
      const date = new Date(value);
      return !Number.isNaN(date.getTime()) && date.toISOString() === value;
    }
    function validDateOrEmpty(value) {
      return value === '' || value == null || core().date(value) === value;
    }
    function validAmount(value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0
        && value <= core().MAX_AMOUNT && core().amount(value) === value;
    }
    function validMonth(value) {
      return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
    }

    const participantIds = idsOf(parsed.participants, 'participantes');
    const financeIds = idsOf(parsed.finances, 'finanças');
    const tripIds = idsOf(parsed.trips, 'viagens');
    idsOf(parsed.goals, 'metas');
    idsOf(parsed.checklist, 'checklist');
    idsOf(parsed.decisions, 'decisões');

    if (typeof parsed.name !== 'string' || !validTimestamp(parsed.createdAt) || !validTimestamp(parsed.updatedAt)
      || !Number.isInteger(parsed.revision) || parsed.revision < 0
      || parsed.settings.currency !== 'BRL' || parsed.settings.defaultSplit !== 'equal'
      || typeof parsed.settings.onboardingCompleted !== 'boolean') {
      throw createError('local/import-invalid-data', 'Os metadados do workspace são inválidos.');
    }
    parsed.participants.forEach((participant) => {
      if (typeof participant.name !== 'string' || !participant.name.trim()
        || typeof participant.active !== 'boolean' || !validTimestamp(participant.createdAt)
        || !/^#[0-9a-f]{6}$/i.test(String(participant.color || ''))) {
        throw createError('local/import-invalid-data', 'Há um participante inválido.');
      }
    });
    parsed.trips.forEach((trip) => {
      if (typeof trip.destination !== 'string' || !trip.destination.trim()
        || !validDateOrEmpty(trip.startDate) || !validDateOrEmpty(trip.endDate)
        || (trip.startDate && trip.endDate && trip.endDate < trip.startDate)
        || !validAmount(trip.budget) || !validAmount(trip.saved) || !validTimestamp(trip.createdAt)) {
        throw createError('local/import-invalid-data', 'Há uma viagem inválida.');
      }
    });
    parsed.finances.forEach((finance) => {
      if (!['income', 'expense'].includes(finance.type)
        || typeof finance.description !== 'string' || !finance.description.trim()
        || core().date(finance.date) !== finance.date || !validAmount(finance.amount)
        || !core().CATEGORIES.includes(finance.category)
        || (finance.paidById != null && !participantIds.has(finance.paidById))
        || !Array.isArray(finance.splitBetweenIds)
        || new Set(finance.splitBetweenIds).size !== finance.splitBetweenIds.length
        || finance.splitBetweenIds.some((id) => !participantIds.has(id))
        || (finance.tripId != null && !tripIds.has(finance.tripId))
        || typeof finance.recurring !== 'boolean' || !validTimestamp(finance.createdAt)
        || !Array.isArray(finance.recurrenceSkippedMonths)
        || finance.recurrenceSkippedMonths.some((month) => !validMonth(month))
        || (finance.recurrenceSeriesId != null && (typeof finance.recurrenceSeriesId !== 'string' || !finance.recurrenceSeriesId))
        || (finance.recurring && (finance.recurringSourceId != null || !finance.recurrenceSeriesId))
        || (finance.recurringSourceId != null && (!financeIds.has(finance.recurringSourceId)
          || finance.recurringSourceId === finance.id || !finance.recurrenceSeriesId || !validMonth(finance.occurrenceMonth)))
        || (finance.occurrenceMonth != null && (!finance.recurringSourceId || !validMonth(finance.occurrenceMonth)))) {
        throw createError('local/import-invalid-data', 'Há uma transação inválida ou uma referência ausente.');
      }
      if (finance.recurringSourceId) {
        const source = parsed.finances.find((item) => item.id === finance.recurringSourceId);
        if (!source || !source.recurring || source.recurringSourceId
          || source.recurrenceSeriesId !== finance.recurrenceSeriesId) {
          throw createError('local/import-invalid-data', 'Há uma série recorrente inconsistente.');
        }
      }
    });
    parsed.goals.forEach((goal) => {
      if (typeof goal.title !== 'string' || !goal.title.trim() || !validAmount(goal.target)
        || goal.target <= 0 || !validAmount(goal.current) || !validDateOrEmpty(goal.deadline)
        || !validTimestamp(goal.createdAt)) throw createError('local/import-invalid-data', 'Há uma meta inválida.');
    });
    parsed.checklist.forEach((item) => {
      if (typeof item.text !== 'string' || !item.text.trim()
        || !['documentos', 'roupas', 'higiene', 'tecnologia', 'saude', 'outros'].includes(item.category)
        || typeof item.done !== 'boolean' || !validTimestamp(item.createdAt)
        || (item.tripId != null && !tripIds.has(item.tripId))) {
        throw createError('local/import-invalid-data', 'Há um item de checklist inválido.');
      }
    });
    parsed.decisions.forEach((decision) => {
      if (typeof decision.title !== 'string' || !decision.title.trim()
        || !['open', 'closed'].includes(decision.status) || !validTimestamp(decision.createdAt)
        || (decision.status === 'closed' ? !validTimestamp(decision.closedAt) : decision.closedAt != null)
        || !Array.isArray(decision.options) || decision.options.length < 2) {
        throw createError('local/import-invalid-data', 'Há uma decisão inválida.');
      }
      idsOf(decision.options, 'opções de decisão');
      const voters = new Set();
      decision.options.forEach((option) => {
        if (typeof option.label !== 'string' || !option.label.trim() || !Array.isArray(option.voterIds)
          || option.voterIds.some((id) => !participantIds.has(id) || voters.has(id))) {
          throw createError('local/import-invalid-data', 'Há votos ou opções inválidos.');
        }
        option.voterIds.forEach((id) => voters.add(id));
      });
    });
    Object.entries(parsed.budgets).forEach(([category, value]) => {
      if (!core().CATEGORIES.includes(category) || !validAmount(value) || value <= 0) {
        throw createError('local/import-invalid-data', 'Há um orçamento inválido.');
      }
    });

    const normalized = core().normalizeWorkspace(parsed);
    if (canonicalJson(normalized) !== canonicalJson(parsed)) {
      throw createError('local/import-lossy', 'O workspace contém valores inválidos, desconhecidos ou inconsistentes.');
    }
  }

  async function exportEncrypted() {
    return withVaultLock(async () => {
      await currentEnvelopeAndWorkspace();
      return JSON.stringify(readVaultEnvelope(), null, 2);
    });
  }

  function exportJson(input) {
    const workspace = core().normalizeWorkspace(input);
    return JSON.stringify(workspace, null, 2);
  }

  async function importBackup(source, password) {
    let parsed;
    try { parsed = typeof source === 'string' ? JSON.parse(source) : clone(source); }
    catch (cause) { throw createError('local/import-invalid-json', 'O arquivo não contém JSON válido.', cause); }
    let importedWorkspace;
    if (parsed && parsed.format === VAULT_FORMAT) {
      const backupEnvelope = parseEnvelope(parsed);
      const current = await requireSession();
      if (backupEnvelope.account.email === current.email && backupEnvelope.keyVersion === current.keyVersion) {
        try { importedWorkspace = await decryptEnvelope(backupEnvelope, current.key); } catch (_) {}
      }
      if (!importedWorkspace) {
        if (!password) throw createError('vault/backup-password-required', 'Este backup exige a senha usada quando ele foi criado.');
        const material = await deriveKeyMaterial(
          backupEnvelope.account.email,
          String(password),
          base64ToBytes(backupEnvelope.kdf.salt),
          backupEnvelope.kdf.iterations
        );
        importedWorkspace = await decryptEnvelope(backupEnvelope, material.key);
      }
    } else {
      validateWorkspace(parsed);
      importedWorkspace = core().normalizeWorkspace(parsed);
    }
    validateWorkspace(importedWorkspace);
    return withVaultLock(async () => {
      const current = await currentEnvelopeAndWorkspace();
      importedWorkspace.generation = core().id('generation');
      importedWorkspace.revision = current.workspace.revision + 1;
      importedWorkspace.updatedAt = new Date().toISOString();
      const encrypted = await encryptWorkspace(importedWorkspace, current.session.key, {
        ...envelopeHeader(current.envelope),
        sequence: current.envelope.sequence + 1,
        updatedAt: importedWorkspace.updatedAt,
      });
      writeEnvelope(encrypted.envelope);
      lastDeliveredSequence = encrypted.envelope.sequence;
      return clone(encrypted.workspace);
    });
  }

  async function changePassword(input) {
    const currentPassword = String((input && input.currentPassword) || '');
    const newPassword = validatePassword(input && input.newPassword);
    const result = await withVaultLock(async () => {
      const session = await requireSession();
      const envelope = readVaultEnvelope();
      const oldMaterial = await deriveKeyMaterial(
        envelope.account.email,
        currentPassword,
        base64ToBytes(envelope.kdf.salt),
        envelope.kdf.iterations
      );
      let workspace;
      try { workspace = await decryptEnvelope(envelope, oldMaterial.key); }
      catch (_) { throw createError('vault/invalid-credentials', 'A senha atual está incorreta.'); }
      const salt = randomBytes(16);
      const material = await deriveKeyMaterial(envelope.account.email, newPassword, salt, KDF_ITERATIONS);
      const encrypted = await encryptWorkspace(workspace, material.key, {
        ...envelopeHeader(envelope),
        sequence: envelope.sequence + 1,
        keyVersion: envelope.keyVersion + 1,
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS, salt: bytesToBase64(salt) },
        updatedAt: new Date().toISOString(),
      });
      writeEnvelope(encrypted.envelope);
      return { envelope: encrypted.envelope, workspace: encrypted.workspace, material, previousSession: session };
    });
    await saveSession(result.envelope, result.material.key, result.material.bytes);
    return { account: clone(result.envelope.account), workspace: clone(result.workspace), expiresAt: activeSession.expiresAt };
  }

  function broadcastAuthEvent(type, epoch) {
    const payload = { type, epoch, id: randomId('event'), at: Date.now() };
    let channel = null;
    try {
      if (typeof root.BroadcastChannel === 'function') {
        channel = new root.BroadcastChannel('plannerduo-vault-auth');
        channel.postMessage(payload);
      }
    } catch (_) {
      // AUTH_EPOCH_KEY continua sendo o canal autoritativo.
    } finally {
      try { channel?.close(); } catch (_) {}
    }
    try {
      const targetStorage = storage();
      targetStorage.setItem(AUTH_EVENT_KEY, JSON.stringify(payload));
      targetStorage.removeItem(AUTH_EVENT_KEY);
    } catch (_) {
      // AUTH_EPOCH_KEY já é persistente e também dispara storage nas outras abas.
    }
  }

  async function lock(options) {
    const allTabs = !options || options.allTabs !== false;
    let epoch = readAuthEpoch();
    await withVaultLock(async () => {
      clearSession();
      if (allTabs) epoch = advanceAuthEpoch();
    });
    if (allTabs) broadcastAuthEvent('lock', epoch);
  }

  function exportRawVault() {
    const raw = storage().getItem(VAULT_KEY);
    if (!raw) throw createError('vault/not-found', 'Nenhum cofre foi encontrado.');
    return raw;
  }

  function exportRawLegacy() {
    const raw = storage().getItem(LEGACY_STORAGE_KEY);
    if (!raw || isMigrationTombstone(raw)) throw createError('vault/legacy-not-found', 'Nenhuma cópia legível conflitante foi encontrada.');
    return raw;
  }

  async function discardLegacyConflict() {
    return withVaultLock(async () => {
      const current = await currentEnvelopeAndWorkspace();
      writeMigrationTombstone(current.workspace.revision);
      clearLegacySessionStorage();
      return true;
    });
  }

  async function destroyVault() {
    let epoch;
    await withVaultLock(async () => {
      const targetStorage = storage();
      epoch = advanceAuthEpoch();
      targetStorage.removeItem(VAULT_KEY);
      targetStorage.removeItem(LEGACY_STORAGE_KEY);
      removeKeysWithPrefix(targetStorage, 'plannerduo:corrupt:');
      targetStorage.removeItem(CLEAN_START_KEY);
      clearLegacySessionStorage();
      clearSession();
    });
    broadcastAuthEvent('destroy', epoch);
  }

  function currentUser() {
    const marker = sessionMarker();
    if (!marker) return null;
    let envelope;
    try { envelope = readVaultEnvelope(); } catch (_) { return null; }
    if (!envelope || marker.vaultId !== envelope.vaultId || marker.keyVersion !== envelope.keyVersion) return null;
    return Object.freeze(clone(envelope.account));
  }

  function subscribe(callback, onLocked, onLegacyConflict) {
    if (!root || typeof root.addEventListener !== 'function') return function noop() {};
    let queue = Promise.resolve();
    let channel = null;
    const notifyLocked = (reason) => {
      clearSession();
      if (typeof onLocked === 'function') onLocked(reason);
    };
    const listener = (event) => {
      if (!event) return;
      if (event.key === LEGACY_STORAGE_KEY && event.newValue && !isMigrationTombstone(event.newValue)) {
        lastWarning = {
          code: 'vault/legacy-reappeared',
          message: 'Uma aba antiga gravou uma cópia legível. Ela foi preservada para revisão.',
        };
        if (typeof onLegacyConflict === 'function') onLegacyConflict();
        return;
      }
      if ((event.key === AUTH_EVENT_KEY && event.newValue)
        || (event.key === AUTH_EPOCH_KEY && event.newValue && activeSession && event.newValue !== activeSession.epoch)) {
        notifyLocked('locked-in-another-tab');
        return;
      }
      if (event.key !== VAULT_KEY || !event.newValue) return;
      queue = queue.then(async () => {
        let envelope;
        try { envelope = parseEnvelope(event.newValue); }
        catch (_) { return; }
        if (envelope.sequence <= lastDeliveredSequence) return;
        try {
          const session = await requireSession();
          if (envelope.vaultId !== session.vaultId || envelope.keyVersion !== session.keyVersion) {
            throw createError('vault/session-invalid', 'A conta ou senha mudou.');
          }
          const workspace = await decryptEnvelope(envelope, session.key);
          if (envelope.sequence <= lastDeliveredSequence) return;
          lastDeliveredSequence = envelope.sequence;
          callback(clone(workspace));
        } catch (_) {
          notifyLocked('session-invalidated');
        }
      });
    };
    root.addEventListener('storage', listener);
    if (typeof root.BroadcastChannel === 'function') {
      try {
        channel = new root.BroadcastChannel('plannerduo-vault-auth');
        channel.addEventListener('message', () => notifyLocked('locked-in-another-tab'));
      } catch (_) { channel = null; }
    }
    return () => {
      root.removeEventListener('storage', listener);
      try { channel?.close(); } catch (_) {}
    };
  }

  function getLastWarning() {
    const warning = lastWarning ? { ...lastWarning } : null;
    lastWarning = null;
    return warning;
  }

  const auth = Object.freeze({
    status: vaultStatus,
    createVault,
    unlock,
    restoreSession,
    currentUser,
    changePassword,
    lock,
    destroyVault,
    exportRawVault,
    exportRawLegacy,
    discardLegacyConflict,
    validatePassword,
    normalizeEmail,
  });

  return Object.freeze({
    STORAGE_KEY: VAULT_KEY,
    VAULT_KEY,
    LEGACY_STORAGE_KEY,
    SESSION_KEY,
    AUTH_EVENT_KEY,
    AUTH_EPOCH_KEY,
    CLEAN_START_KEY,
    THEME_KEY,
    VAULT_FORMAT,
    VAULT_VERSION,
    auth,
    load,
    initialize,
    update,
    reset,
    exportJson,
    exportEncrypted,
    importBackup,
    subscribe,
    getLastWarning,
  });
});
