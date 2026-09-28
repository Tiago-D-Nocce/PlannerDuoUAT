/* PlannerDuo — repositório persistente do navegador. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerLocal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const STORAGE_KEY = 'plannerduo:workspace:v1';
  const CLEAN_START_KEY = 'plannerduo:clean-start:v1';
  const THEME_KEY = 'plannerduo:theme';
  const LEGACY_EXACT_KEYS = ['pd-casalId', 'pd-buscas', 'pd-tema'];
  const LEGACY_PREFIXES = ['pd-cache:', 'pd-buscas:', 'plannerduo-local:v1:'];
  let lastWarning = null;
  let fallbackLock = Promise.resolve();

  function withWorkspaceLock(operation) {
    const locks = root.navigator && root.navigator.locks;
    if (locks && typeof locks.request === 'function') {
      return locks.request('plannerduo:workspace:v1', { mode: 'exclusive' }, operation);
    }
    const run = fallbackLock.then(operation, operation);
    fallbackLock = run.catch(() => undefined);
    return run;
  }

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

  function removeLegacyKeys(targetStorage) {
    const keys = [];
    for (let index = 0; index < targetStorage.length; index += 1) {
      const key = targetStorage.key(index);
      if (key) keys.push(key);
    }
    keys.forEach((key) => {
      if (LEGACY_EXACT_KEYS.includes(key) || LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        targetStorage.removeItem(key);
      }
    });
    try {
      if (root.sessionStorage) {
        const sessionKeys = [];
        for (let index = 0; index < root.sessionStorage.length; index += 1) {
          const key = root.sessionStorage.key(index);
          if (key) sessionKeys.push(key);
        }
        sessionKeys
          .filter((key) => LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix)))
          .forEach((key) => root.sessionStorage.removeItem(key));
      }
    } catch (_) {
      // A sessão antiga é descartável; falhas aqui não impedem o banco novo.
    }
  }

  function ensureCleanStart() {
    const targetStorage = storage();
    if (targetStorage.getItem(CLEAN_START_KEY) === 'done') return;
    removeLegacyKeys(targetStorage);
    targetStorage.removeItem(STORAGE_KEY);
    targetStorage.setItem(CLEAN_START_KEY, 'done');
  }

  function writeRaw(workspace) {
    try {
      storage().setItem(STORAGE_KEY, JSON.stringify(workspace));
    } catch (cause) {
      throw createError('local/write-failed', 'Não foi possível salvar. Verifique o espaço disponível no navegador.', cause);
    }
  }

  function removeKeysWithPrefix(targetStorage, prefix) {
    const keys = [];
    for (let index = 0; index < targetStorage.length; index += 1) {
      const key = targetStorage.key(index);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => targetStorage.removeItem(key));
  }

  function readWorkspace() {
    const targetStorage = storage();
    const raw = targetStorage.getItem(STORAGE_KEY);
    if (!raw) return { workspace: core().createEmptyWorkspace(), raw: null, changed: true, error: null };
    try {
      const parsed = JSON.parse(raw);
      const workspace = core().normalizeWorkspace(parsed);
      return {
        workspace,
        raw,
        changed: canonicalJson(workspace) !== canonicalJson(parsed),
        error: null,
      };
    } catch (error) {
      return { workspace: core().createEmptyWorkspace(), raw, changed: true, error };
    }
  }

  function load() {
    return clone(readWorkspace().workspace);
  }

  function initialize() {
    return withWorkspaceLock(() => {
      ensureCleanStart();
      const targetStorage = storage();
      const result = readWorkspace();
      if (result.error) {
        lastWarning = {
          code: 'local/storage-corrupt',
          message: 'O banco local estava inválido e foi reiniciado. Um diagnóstico foi preservado no navegador.',
        };
        try {
          removeKeysWithPrefix(targetStorage, 'plannerduo:corrupt:');
          targetStorage.setItem(`plannerduo:corrupt:${Date.now()}`, result.raw);
        } catch (_) {
          // Se a cota estiver cheia, prioriza recuperar um banco utilizável.
        }
      }
      if (result.changed) writeRaw(result.workspace);
      return clone(result.workspace);
    });
  }

  function update(mutator, expectedGeneration) {
    if (typeof mutator !== 'function') return Promise.reject(createError('local/invalid-mutation', 'A alteração local é inválida.'));
    return withWorkspaceLock(() => {
      ensureCleanStart();
      const current = load();
      if (expectedGeneration && current.generation !== expectedGeneration) {
        const conflict = createError('local/workspace-replaced', 'O workspace foi apagado ou restaurado em outra aba.');
        conflict.currentWorkspace = clone(current);
        throw conflict;
      }
      const draft = clone(current);
      const result = mutator(draft);
      const candidate = result && typeof result === 'object' ? result : draft;
      const normalized = core().normalizeWorkspace(candidate);
      normalized.generation = current.generation;
      normalized.revision = current.revision + 1;
      normalized.updatedAt = new Date().toISOString();
      writeRaw(normalized);
      return clone(normalized);
    });
  }

  function resetUnlocked() {
    ensureCleanStart();
    const targetStorage = storage();
    let currentRevision = 0;
    try {
      const current = JSON.parse(targetStorage.getItem(STORAGE_KEY) || 'null');
      currentRevision = Number(current && current.revision) || 0;
    } catch (_) {
      currentRevision = 0;
    }
    removeKeysWithPrefix(targetStorage, 'plannerduo:corrupt:');
    const workspace = core().createEmptyWorkspace();
    workspace.revision = currentRevision + 1;
    workspace.updatedAt = new Date().toISOString();
    writeRaw(workspace);
    return clone(workspace);
  }

  function reset() {
    return withWorkspaceLock(resetUnlocked);
  }

  function exportJson(input) {
    const workspace = core().normalizeWorkspace(input || load());
    return JSON.stringify(workspace, null, 2);
  }

  function validateBackup(parsed) {
    if (parsed.format !== core().FORMAT || Number(parsed.schemaVersion) !== core().SCHEMA_VERSION
      || parsed.id !== 'workspace-local' || typeof parsed.generation !== 'string' || !parsed.generation) {
      throw createError('local/import-version', 'A versão ou o formato deste arquivo não é compatível com o PlannerDuo.');
    }
    const arrayFields = ['participants', 'finances', 'trips', 'goals', 'checklist', 'decisions'];
    if (arrayFields.some((field) => !Array.isArray(parsed[field]))
      || !parsed.budgets || typeof parsed.budgets !== 'object' || Array.isArray(parsed.budgets)
      || !parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) {
      throw createError('local/import-invalid-data', 'O backup está incompleto ou possui uma estrutura inválida.');
    }

    function idsOf(items, label) {
      const ids = new Set();
      items.forEach((item) => {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) {
          throw createError('local/import-invalid-data', `O backup contém IDs inválidos ou duplicados em ${label}.`);
        }
        ids.add(item.id);
      });
      return ids;
    }
    function validOptionalDate(value) {
      return value === '' || value == null || core().date(value) === value;
    }
    function validAmount(value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0
        && value <= core().MAX_AMOUNT && core().amount(value) === value;
    }
    function validMonth(value) {
      if (!/^\d{4}-\d{2}$/.test(String(value || ''))) return false;
      const month = Number(String(value).slice(5, 7));
      return month >= 1 && month <= 12;
    }
    function validTimestamp(value) {
      if (typeof value !== 'string' || !value) return false;
      const parsed = new Date(value);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
    }

    const participantIds = idsOf(parsed.participants, 'participantes');
    const financeIds = idsOf(parsed.finances, 'finanças');
    const tripIds = idsOf(parsed.trips, 'viagens');
    idsOf(parsed.goals, 'metas');
    idsOf(parsed.checklist, 'checklist');
    idsOf(parsed.decisions, 'decisões');
    if (typeof parsed.name !== 'string' || !validTimestamp(parsed.createdAt) || !validTimestamp(parsed.updatedAt)
      || typeof parsed.revision !== 'number' || !Number.isInteger(parsed.revision) || parsed.revision < 0
      || typeof parsed.settings.onboardingCompleted !== 'boolean') {
      throw createError('local/import-invalid-data', 'O backup contém metadados inválidos.');
    }
    parsed.participants.forEach((participant) => {
      if (typeof participant.name !== 'string' || !participant.name.trim()
        || typeof participant.active !== 'boolean' || !validTimestamp(participant.createdAt)
        || !/^#[0-9a-f]{6}$/i.test(String(participant.color || ''))) {
        throw createError('local/import-invalid-data', 'O backup contém um participante inválido.');
      }
    });
    parsed.trips.forEach((trip) => {
      if (typeof trip.destination !== 'string' || !trip.destination.trim()
        || !validOptionalDate(trip.startDate) || !validOptionalDate(trip.endDate)
        || (trip.startDate && trip.endDate && trip.endDate < trip.startDate)
        || !validAmount(trip.budget) || !validAmount(trip.saved) || !validTimestamp(trip.createdAt)) {
        throw createError('local/import-invalid-data', 'O backup contém uma viagem inválida.');
      }
    });
    parsed.finances.forEach((finance) => {
      if (!['income', 'expense'].includes(finance.type)
        || typeof finance.description !== 'string' || !finance.description.trim()
        || core().date(finance.date) !== finance.date
        || !validAmount(finance.amount)
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
        throw createError('local/import-invalid-data', 'O backup contém uma transação inválida ou referências ausentes.');
      }
      if (finance.recurringSourceId) {
        const source = parsed.finances.find((item) => item.id === finance.recurringSourceId);
        if (!source || !source.recurring || source.recurringSourceId
          || source.recurrenceSeriesId !== finance.recurrenceSeriesId) {
          throw createError('local/import-invalid-data', 'O backup contém uma série recorrente inconsistente.');
        }
      }
    });
    parsed.goals.forEach((goal) => {
      if (typeof goal.title !== 'string' || !goal.title.trim() || !validAmount(goal.target)
        || goal.target <= 0 || !validAmount(goal.current) || !validOptionalDate(goal.deadline)
        || !validTimestamp(goal.createdAt)) {
        throw createError('local/import-invalid-data', 'O backup contém uma meta inválida.');
      }
    });
    parsed.checklist.forEach((item) => {
      if (typeof item.text !== 'string' || !item.text.trim()
        || !['documentos', 'roupas', 'higiene', 'tecnologia', 'saude', 'outros'].includes(item.category)
        || typeof item.done !== 'boolean' || !validTimestamp(item.createdAt)
        || (item.tripId != null && !tripIds.has(item.tripId))) {
        throw createError('local/import-invalid-data', 'O backup contém um item de checklist inválido.');
      }
    });
    parsed.decisions.forEach((decision) => {
      if (typeof decision.title !== 'string' || !decision.title.trim()
        || !['open', 'closed'].includes(decision.status)
        || !validTimestamp(decision.createdAt)
        || (decision.status === 'closed' ? !validTimestamp(decision.closedAt) : decision.closedAt != null)
        || !Array.isArray(decision.options) || decision.options.length < 2) {
        throw createError('local/import-invalid-data', 'O backup contém uma decisão inválida.');
      }
      idsOf(decision.options, 'opções de decisão');
      const voters = new Set();
      decision.options.forEach((option) => {
        if (typeof option.label !== 'string' || !option.label.trim() || !Array.isArray(option.voterIds)
          || option.voterIds.some((id) => !participantIds.has(id) || voters.has(id))) {
          throw createError('local/import-invalid-data', 'O backup contém opções ou votos inválidos.');
        }
        option.voterIds.forEach((id) => voters.add(id));
      });
    });
    Object.entries(parsed.budgets).forEach(([category, value]) => {
      if (!core().CATEGORIES.includes(category) || !validAmount(value) || value <= 0) {
        throw createError('local/import-invalid-data', 'O backup contém um orçamento inválido.');
      }
    });
  }

  function importJson(source) {
    let parsed;
    try {
      parsed = typeof source === 'string' ? JSON.parse(source) : clone(source);
    } catch (cause) {
      throw createError('local/import-invalid-json', 'O arquivo não contém um JSON válido.', cause);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw createError('local/import-invalid-data', 'O arquivo não contém um workspace válido.');
    }
    validateBackup(parsed);
    const normalized = core().normalizeWorkspace(parsed);
    if (canonicalJson(normalized) !== canonicalJson(parsed)) {
      throw createError('local/import-lossy', 'O backup contém valores inválidos, campos desconhecidos ou dados que seriam alterados na importação.');
    }
    return withWorkspaceLock(() => {
      ensureCleanStart();
      const current = load();
      normalized.generation = core().id('generation');
      normalized.revision = current.revision + 1;
      normalized.updatedAt = new Date().toISOString();
      writeRaw(normalized);
      return clone(normalized);
    });
  }

  function subscribe(callback) {
    if (!root || typeof root.addEventListener !== 'function') return function noop() {};
    const listener = (event) => {
      if (!event || event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        callback(clone(core().normalizeWorkspace(JSON.parse(event.newValue))));
      } catch (_) {
        // Uma escrita parcial de outra aba não substitui o estado válido atual.
      }
    };
    root.addEventListener('storage', listener);
    return () => root.removeEventListener('storage', listener);
  }

  function getLastWarning() {
    const warning = lastWarning ? { ...lastWarning } : null;
    lastWarning = null;
    return warning;
  }

  return Object.freeze({
    STORAGE_KEY,
    CLEAN_START_KEY,
    THEME_KEY,
    load,
    initialize,
    update,
    reset,
    exportJson,
    importJson,
    subscribe,
    getLastWarning,
  });
});
