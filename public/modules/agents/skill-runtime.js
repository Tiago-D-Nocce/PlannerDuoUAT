/* PlannerDuo — runtime de skills: registry, validação, fila, timeout, dedupe, cache, breaker e retry. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerSkills = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Tabela de mensagens pt-BR (sem causa bruta, sem stack).
  // ---------------------------------------------------------------------------
  const ERROR_MESSAGES = Object.freeze({
    'skill/not-found': 'A habilidade solicitada não está disponível.',
    'skill/invalid-input': 'Alguns campos precisam ser corrigidos.',
    'skill/timeout': 'A operação demorou demais e foi interrompida.',
    'skill/aborted': 'A operação foi cancelada.',
    'skill/circuit-open': 'A habilidade está temporariamente indisponível. Tente novamente em instantes.',
    'skill/failed': 'Não foi possível concluir a operação agora.',
  });

  const GENERIC_CODE = 'skill/failed';

  // Códigos de erro cujo retry nunca ocorre e que não contam no breaker.
  const NON_BREAKER_CODES = Object.freeze(['skill/aborted', 'skill/invalid-input']);

  // ---------------------------------------------------------------------------
  // SkillError
  // ---------------------------------------------------------------------------
  const SKILL_ERROR_BRAND = Symbol.for('plannerduo.SkillError');

  class SkillError extends Error {
    constructor(code, options) {
      const opts = options || {};
      const message = typeof opts.message === 'string' && opts.message
        ? opts.message
        : (ERROR_MESSAGES[code] || ERROR_MESSAGES[GENERIC_CODE]);
      super(message);
      this.name = 'SkillError';
      this.code = typeof code === 'string' ? code : GENERIC_CODE;
      this.skillId = opts.skillId != null ? String(opts.skillId) : null;
      this.retryable = Boolean(opts.retryable);
      this.fields = Array.isArray(opts.fields) ? opts.fields : null;
      // cause nunca enumerável e nunca exposta na mensagem.
      Object.defineProperty(this, 'cause', {
        value: opts.cause,
        enumerable: false,
        writable: false,
        configurable: false,
      });
      // marca para isSkillError resiliente a múltiplas cópias do módulo.
      Object.defineProperty(this, SKILL_ERROR_BRAND, {
        value: true,
        enumerable: false,
      });
    }
  }

  function isSkillError(e) {
    return Boolean(e) && (e instanceof SkillError || (typeof e === 'object' && e[SKILL_ERROR_BRAND] === true));
  }

  // ---------------------------------------------------------------------------
  // canonicalJson — chaves ordenadas, estável.
  // ---------------------------------------------------------------------------
  function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
  }

  function canonicalize(value) {
    if (value === null || typeof value !== 'object') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(canonicalize);
    }
    const keys = Object.keys(value).sort();
    const out = {};
    for (const key of keys) {
      const v = value[key];
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Deep freeze para definições.
  // ---------------------------------------------------------------------------
  function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (v && typeof v === 'object' && !Object.isFrozen(v)) {
        deepFreeze(v);
      }
    }
    return Object.freeze(obj);
  }

  // ---------------------------------------------------------------------------
  // Validação de SkillDefinition
  // ---------------------------------------------------------------------------
  const ID_RE = /^[a-z]+(\.[a-z-]+)+$/;
  const AGENTS = Object.freeze(['orchestrator', 'travel', 'finance', 'planner']);
  const KINDS = Object.freeze(['read', 'write']);
  const EXPOSURES = Object.freeze(['chat', 'ui']);

  function failDef(message) {
    throw new TypeError('Definição de skill inválida: ' + message);
  }

  function isPlainObject(v) {
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  }

  function isInteger(n) {
    return typeof n === 'number' && Number.isInteger(n);
  }

  function validateDefinition(def) {
    if (!isPlainObject(def)) failDef('deve ser um objeto.');
    if (typeof def.id !== 'string' || !ID_RE.test(def.id)) {
      failDef('id deve casar com ^[a-z]+(\\.[a-z-]+)+$.');
    }
    if (!AGENTS.includes(def.agent)) {
      failDef('agent deve ser um de ' + AGENTS.join(', ') + '.');
    }
    if (!KINDS.includes(def.kind)) {
      failDef('kind deve ser read ou write.');
    }
    if (!Array.isArray(def.exposure) || def.exposure.length === 0) {
      failDef('exposure deve ser um array não vazio.');
    }
    for (const e of def.exposure) {
      if (!EXPOSURES.includes(e)) failDef('exposure só aceita chat ou ui.');
    }
    if (!isInteger(def.timeoutMs) || def.timeoutMs < 100 || def.timeoutMs > 30000) {
      failDef('timeoutMs deve ser inteiro entre 100 e 30000.');
    }
    if (def.cache !== undefined) {
      if (def.kind !== 'read') failDef('cache só é permitido em skills read.');
      if (!isPlainObject(def.cache)) failDef('cache deve ser um objeto.');
      if (!isInteger(def.cache.ttlMs) || def.cache.ttlMs <= 0) failDef('cache.ttlMs deve ser inteiro positivo.');
      if (!isInteger(def.cache.maxEntries) || def.cache.maxEntries <= 0) failDef('cache.maxEntries deve ser inteiro positivo.');
    }
    if (def.retryable !== undefined) {
      if (typeof def.retryable !== 'boolean') failDef('retryable deve ser boolean.');
      if (def.kind !== 'read' && def.retryable === true) failDef('retryable só se aplica a skills read.');
    }
    if (def.title !== undefined && typeof def.title !== 'string') failDef('title deve ser string.');
    if (def.description !== undefined && typeof def.description !== 'string') failDef('description deve ser string.');
    if (def.slots !== undefined) {
      if (!Array.isArray(def.slots)) failDef('slots deve ser um array.');
      for (const slot of def.slots) {
        if (!isPlainObject(slot)) failDef('cada slot deve ser um objeto.');
        if (typeof slot.name !== 'string' || !slot.name) failDef('slot.name deve ser string não vazia.');
        if (typeof slot.required !== 'boolean') failDef('slot.required deve ser boolean.');
        if (typeof slot.prompt !== 'string' || !slot.prompt) failDef('slot.prompt deve ser string não vazia.');
        if (slot.chips !== undefined) {
          if (!Array.isArray(slot.chips)) failDef('slot.chips deve ser array de strings.');
          for (const chip of slot.chips) {
            if (typeof chip !== 'string') failDef('slot.chips deve conter apenas strings.');
          }
        }
      }
    }
    if (typeof def.validate !== 'function') failDef('validate deve ser função.');
    if (typeof def.run !== 'function') failDef('run deve ser função.');
  }

  // ---------------------------------------------------------------------------
  // Relógio padrão
  // ---------------------------------------------------------------------------
  function defaultClock() {
    return {
      now: function () { return Date.now(); },
      setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
      clearTimeout: function (id) { return clearTimeout(id); },
    };
  }

  function normalizeClock(clock) {
    if (!clock) return defaultClock();
    const base = defaultClock();
    return {
      now: typeof clock.now === 'function' ? clock.now.bind(clock) : base.now,
      setTimeout: typeof clock.setTimeout === 'function' ? clock.setTimeout.bind(clock) : base.setTimeout,
      clearTimeout: typeof clock.clearTimeout === 'function' ? clock.clearTimeout.bind(clock) : base.clearTimeout,
    };
  }

  // ---------------------------------------------------------------------------
  // Composição de sinais
  // ---------------------------------------------------------------------------
  function abortReasonCode(signal) {
    const reason = signal && signal.reason;
    if (reason && typeof reason === 'object' && typeof reason.code === 'string') return reason.code;
    return 'skill/aborted';
  }

  function anySignal(signals) {
    const parts = signals.filter(Boolean);
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
      return AbortSignal.any(parts);
    }
    const controller = new AbortController();
    for (const s of parts) {
      if (s.aborted) {
        controller.abort(s.reason);
        return controller.signal;
      }
      s.addEventListener('abort', function () { controller.abort(s.reason); }, { once: true });
    }
    return controller.signal;
  }

  // ---------------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------------
  function createRuntime(options) {
    const opts = options || {};
    const core = opts.core || null;
    const commit = opts.commit || null;
    const travel = opts.travel || null;
    const market = opts.market || null;
    const getWorkspace = typeof opts.getWorkspace === 'function' ? opts.getWorkspace : null;
    const local = opts.local || null;
    const clock = normalizeClock(opts.clock);
    const random = typeof opts.random === 'function' ? opts.random : Math.random;
    const maxConcurrent = isInteger(opts.maxConcurrent) && opts.maxConcurrent > 0 ? opts.maxConcurrent : 4;

    const registry = new Map();      // id -> frozen def
    const listeners = new Map();     // event -> Set<handler>
    const cacheStore = new Map();    // key -> { value, expiresAt } (ordem de inserção = LRU)
    const inflight = new Map();      // key -> shared execution record
    const breakers = new Map();      // id -> breaker state

    let running = 0;
    const queue = [];                // itens pendentes do limitador FIFO
    const activeExecutions = new Set(); // marcadores de execução ativa, para reset()

    const BREAKER_THRESHOLD = 3;
    const BREAKER_OPEN_MS = 30000;
    const RETRY_BASE_MS = 300;
    const RETRY_JITTER_MS = 200;

    // -------------------- eventos --------------------
    function on(event, handler) {
      if (typeof handler !== 'function') return function () {};
      if (!listeners.has(event)) listeners.set(event, new Set());
      const set = listeners.get(event);
      set.add(handler);
      return function unsubscribe() { set.delete(handler); };
    }

    function emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const handler of Array.from(set)) {
        try {
          handler(payload);
        } catch (_err) {
          // exceções de handler nunca quebram a invocação.
        }
      }
    }

    // -------------------- breaker --------------------
    function breakerState(id) {
      let b = breakers.get(id);
      if (!b) {
        b = { failures: 0, openedAt: 0, state: 'closed', halfProbe: false };
        breakers.set(id, b);
      }
      return b;
    }

    function breakerPhase(id) {
      const b = breakers.get(id);
      if (!b) return 'closed';
      if (b.state === 'open') {
        if (clock.now() - b.openedAt >= BREAKER_OPEN_MS) return 'half-open';
        return 'open';
      }
      return b.state;
    }

    function breakerAllowsRun(id) {
      const phase = breakerPhase(id);
      if (phase === 'open') return false;
      if (phase === 'half-open') {
        const b = breakerState(id);
        if (b.halfProbe) return false; // já há uma prova em andamento
        b.halfProbe = true;
        return true;
      }
      return true;
    }

    function breakerSuccess(id) {
      const b = breakerState(id);
      b.failures = 0;
      b.openedAt = 0;
      b.state = 'closed';
      b.halfProbe = false;
    }

    function breakerRelease(id) {
      // Libera a prova half-open sem contar como sucesso nem falha.
      // Usado quando a prova termina com skill/aborted ou skill/invalid-input,
      // que nao mexem no breaker: sem isso, halfProbe ficaria preso em true
      // e o breaker nunca mais permitiria uma nova prova.
      const b = breakers.get(id);
      if (b) b.halfProbe = false;
    }
    function breakerFailure(id) {
      const b = breakerState(id);
      if (b.state === 'open' && clock.now() - b.openedAt >= BREAKER_OPEN_MS) {
        // falha na prova half-open → reabre.
        b.openedAt = clock.now();
        b.failures = BREAKER_THRESHOLD;
        b.halfProbe = false;
        return;
      }
      if (b.state === 'open') return;
      b.failures += 1;
      b.halfProbe = false;
      if (b.failures >= BREAKER_THRESHOLD) {
        b.state = 'open';
        b.openedAt = clock.now();
      }
    }

    // -------------------- cache --------------------
    function cacheGetFresh(key) {
      const entry = cacheStore.get(key);
      if (!entry) return null;
      if (clock.now() >= entry.expiresAt) {
        cacheStore.delete(key);
        return null;
      }
      // marca como recém-usado (LRU): reinsere no fim.
      cacheStore.delete(key);
      cacheStore.set(key, entry);
      return entry;
    }

    function cacheSet(key, value, def) {
      if (!def.cache) return;
      const expiresAt = clock.now() + def.cache.ttlMs;
      if (cacheStore.has(key)) cacheStore.delete(key);
      cacheStore.set(key, { value: value, expiresAt: expiresAt });
      while (cacheStore.size > def.cache.maxEntries) {
        const oldest = cacheStore.keys().next().value;
        cacheStore.delete(oldest);
      }
    }

    // -------------------- limitador FIFO (write à frente das leituras) --------------------
    function schedule(kind, fn) {
      return new Promise(function (resolve, reject) {
        const item = { kind: kind, fn: fn, resolve: resolve, reject: reject, cancelled: false };
        if (kind === 'write') {
          let insertAt = queue.length;
          for (let i = 0; i < queue.length; i++) {
            if (queue[i].kind === 'read') { insertAt = i; break; }
          }
          queue.splice(insertAt, 0, item);
        } else {
          queue.push(item);
        }
        item.cancel = function (err) {
          if (item.cancelled) return false;
          const idx = queue.indexOf(item);
          if (idx === -1) return false; // já em execução
          item.cancelled = true;
          queue.splice(idx, 1);
          reject(err);
          return true;
        };
        pump();
      });
    }

    function pump() {
      while (running < maxConcurrent && queue.length > 0) {
        const item = queue.shift();
        if (item.cancelled) continue;
        running += 1;
        Promise.resolve()
          .then(item.fn)
          .then(
            function (value) {
              running -= 1;
              item.resolve(value);
              pump();
            },
            function (err) {
              running -= 1;
              item.reject(err);
              pump();
            },
          );
      }
    }

    // -------------------- erro → SkillError --------------------
    function toSkillError(err, def) {
      if (isSkillError(err)) return err;
      const rawCode = err && typeof err.code === 'string' ? err.code : null;
      if (rawCode) {
        const retryable = typeof err.retryable === 'boolean' ? err.retryable : false;
        const publicMessage = typeof err.publicMessage === 'string' && err.publicMessage ? err.publicMessage : null;
        const message = publicMessage || ERROR_MESSAGES[rawCode] || ERROR_MESSAGES[GENERIC_CODE];
        return new SkillError(rawCode, {
          message: message,
          skillId: def.id,
          retryable: retryable,
          fields: Array.isArray(err.fields) ? err.fields : undefined,
          cause: err,
        });
      }
      return new SkillError(GENERIC_CODE, {
        skillId: def.id,
        retryable: false,
        cause: err,
      });
    }

    // -------------------- execução de um attempt (fila + timeout + abort) --------------------
    function runOnce(def, value, runSignal, baseCtx, attempt) {
      return new Promise(function (resolve) {
        const timeoutController = new AbortController();
        let timedOut = false;
        const timer = clock.setTimeout(function () {
          timedOut = true;
          timeoutController.abort(new SkillError('skill/timeout', { skillId: def.id, retryable: true }));
        }, def.timeoutMs);

        const composed = anySignal([runSignal, timeoutController.signal]);

        let settled = false;
        function finish(outcome) {
          if (settled) return;
          settled = true;
          clock.clearTimeout(timer);
          resolve(outcome);
        }

        if (composed.aborted) {
          finish(abortedOutcome(def, composed, timedOut));
          return;
        }
        const onAbort = function () { finish(abortedOutcome(def, composed, timedOut)); };
        composed.addEventListener('abort', onAbort, { once: true });

        const ctx = Object.assign({}, baseCtx, { signal: composed, attempt: attempt });
        Promise.resolve()
          .then(function () { return def.run(value, ctx); })
          .then(
            function (result) {
              if (composed.removeEventListener) composed.removeEventListener('abort', onAbort);
              finish({ ok: true, value: result });
            },
            function (err) {
              if (composed.removeEventListener) composed.removeEventListener('abort', onAbort);
              if (isSkillError(err) && (err.code === 'skill/timeout' || err.code === 'skill/aborted')) {
                finish({ ok: false, error: err });
                return;
              }
              if (composed.aborted) {
                finish(abortedOutcome(def, composed, timedOut));
                return;
              }
              finish({ ok: false, error: toSkillError(err, def) });
            },
          );
      });
    }

    function abortedOutcome(def, signal, timedOut) {
      if (timedOut) {
        return { ok: false, error: new SkillError('skill/timeout', { skillId: def.id, retryable: true }) };
      }
      const code = abortReasonCode(signal);
      if (code === 'skill/timeout') {
        return { ok: false, error: new SkillError('skill/timeout', { skillId: def.id, retryable: true }) };
      }
      return { ok: false, error: new SkillError('skill/aborted', { skillId: def.id, retryable: false }) };
    }

    // -------------------- backoff abortável --------------------
    function abortableBackoff(ms, externalSignal) {
      return new Promise(function (resolve, reject) {
        if (externalSignal && externalSignal.aborted) {
          reject(new SkillError('skill/aborted', { retryable: false }));
          return;
        }
        let done = false;
        const timer = clock.setTimeout(function () {
          if (done) return;
          done = true;
          if (externalSignal && externalSignal.removeEventListener) externalSignal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        function onAbort() {
          if (done) return;
          done = true;
          clock.clearTimeout(timer);
          reject(new SkillError('skill/aborted', { retryable: false }));
        }
        if (externalSignal) externalSignal.addEventListener('abort', onAbort, { once: true });
      });
    }

    // -------------------- payloads de evento --------------------
    function basePayload(def, source, turnId) {
      return {
        id: def.id,
        agent: def.agent,
        kind: def.kind,
        source: source,
        turnId: turnId,
        at: clock.now(),
        title: typeof def.title === 'string' ? def.title : null,
      };
    }

    function emitStart(def, source, turnId) {
      emit('skill:start', basePayload(def, source, turnId));
    }

    function emitDone(def, source, turnId, extra) {
      emit('skill:done', Object.assign(basePayload(def, source, turnId), extra || {}));
    }

    function emitError(def, source, turnId, extra) {
      emit('skill:error', Object.assign(basePayload(def, source, turnId), extra || {}));
    }

    // -------------------- política completa (breaker, fila, timeout, retry) --------------------
    function runWithPolicy(def, value, key, source, turnId, signal, isRead) {
      const baseCtx = {
        now: clock.now,
        core: core,
        commit: commit,
        travel: travel,
        market: market,
        getWorkspace: getWorkspace,
        local: local,
        turnId: turnId,
        source: source,
        runtime: runtimeApi,
      };

      let startedAt = 0;

      // abort de fila: signal já abortado antes de enfileirar.
      if (signal && signal.aborted) {
        emitStart(def, source, turnId);
        const err = new SkillError('skill/aborted', { skillId: def.id, retryable: false });
        emitError(def, source, turnId, { attempt: 1, code: err.code, ms: 0 });
        return Promise.reject(err);
      }

      function attemptLoop(attempt) {
        if (!breakerAllowsRun(def.id)) {
          if (attempt === 1) emitStart(def, source, turnId);
          const err = new SkillError('skill/circuit-open', { skillId: def.id, retryable: false });
          emitError(def, source, turnId, { attempt: attempt, code: err.code, ms: attempt === 1 ? 0 : clock.now() - startedAt });
          return Promise.reject(err);
        }

        if (attempt === 1) {
          startedAt = clock.now();
          emitStart(def, source, turnId);
        }

        const activeMarker = { controller: new AbortController() };
        const runSignal = anySignal([signal, activeMarker.controller.signal]);
        activeMarker.abort = function (code) {
          activeMarker.controller.abort(new SkillError(code || 'skill/aborted', { skillId: def.id, retryable: false }));
        };
        activeExecutions.add(activeMarker);

        return schedule(def.kind, function () {
          return runOnce(def, value, runSignal, baseCtx, attempt);
        }).then(function (outcome) {
          activeExecutions.delete(activeMarker);

          if (outcome.ok) {
            breakerSuccess(def.id);
            if (isRead && def.cache) cacheSet(key, outcome.value, def);
            emitDone(def, source, turnId, { ms: clock.now() - startedAt, attempt: attempt });
            return outcome.value;
          }

          const error = outcome.error;
          const code = error.code;

          if (NON_BREAKER_CODES.includes(code)) {
            breakerRelease(def.id);
            emitError(def, source, turnId, { ms: clock.now() - startedAt, attempt: attempt, code: code });
            throw error;
          }

          breakerFailure(def.id);

          const canRetry = isRead && error.retryable === true && def.retryable !== false && attempt === 1;
          if (!canRetry) {
            emitError(def, source, turnId, { ms: clock.now() - startedAt, attempt: attempt, code: code });
            throw error;
          }

          const jitter = Math.max(0, random()) * RETRY_JITTER_MS;
          return abortableBackoff(RETRY_BASE_MS + jitter, signal).then(
            function () { return attemptLoop(attempt + 1); },
            function (abortErr) {
              emitError(def, source, turnId, { ms: clock.now() - startedAt, attempt: attempt, code: abortErr.code });
              throw abortErr;
            },
          );
        }, function (scheduleErr) {
          activeExecutions.delete(activeMarker);
          const skillErr = isSkillError(scheduleErr)
            ? scheduleErr
            : new SkillError('skill/aborted', { skillId: def.id, retryable: false });
          emitError(def, source, turnId, { ms: clock.now() - startedAt, attempt: attempt, code: skillErr.code });
          throw skillErr;
        });
      }

      return attemptLoop(1);
    }

    // -------------------- invoke --------------------
    function invoke(id, input, invokeOpts) {
      const o = invokeOpts || {};
      const source = o.source === 'chat' ? 'chat' : 'ui';
      const turnId = o.turnId != null ? o.turnId : null;
      const externalSignal = o.signal || null;

      const def = registry.get(id);
      if (!def || !def.exposure.includes(source)) {
        return Promise.reject(new SkillError('skill/not-found', { skillId: id, retryable: false }));
      }

      // validação antes de qualquer fila/cache.
      let validation;
      try {
        validation = def.validate(input);
      } catch (err) {
        return Promise.reject(new SkillError(GENERIC_CODE, { skillId: id, retryable: false, cause: err }));
      }
      if (!validation || validation.ok !== true) {
        const fields = validation && Array.isArray(validation.fields) ? validation.fields : [];
        return Promise.reject(new SkillError('skill/invalid-input', { skillId: id, retryable: false, fields: fields }));
      }
      const value = validation.value;
      const key = id + ':' + canonicalJson(value);
      const isRead = def.kind === 'read';

      // cache (reads com cache).
      if (isRead && def.cache) {
        const entry = cacheGetFresh(key);
        if (entry) {
          emitStart(def, source, turnId);
          emitDone(def, source, turnId, { cached: true, ms: 0 });
          return Promise.resolve(entry.value);
        }
      }

      // dedupe (reads): junta-se a uma execução em andamento.
      if (isRead && inflight.has(key)) {
        return joinInflight(inflight.get(key), externalSignal);
      }

      if (isRead) {
        const record = {
          promise: null,
          controller: new AbortController(),
          joinedCount: 0,
          abortedCount: 0,
        };
        inflight.set(key, record);
        record.promise = runWithPolicy(def, value, key, source, turnId, record.controller.signal, true)
          .then(
            function (v) { inflight.delete(key); return v; },
            function (e) { inflight.delete(key); throw e; },
          );
        return joinInflight(record, externalSignal);
      }

      // writes: execução direta, sem dedupe/cache.
      return runWithPolicy(def, value, key, source, turnId, externalSignal, false);
    }

    function joinInflight(record, callerSignal) {
      record.joinedCount += 1;
      return new Promise(function (resolve, reject) {
        let settled = false;
        function onAbort() {
          if (settled) return;
          settled = true;
          record.abortedCount += 1;
          // aborta a execução compartilhada só quando todos os interessados abortaram.
          if (record.abortedCount >= record.joinedCount) {
            record.controller.abort(new SkillError('skill/aborted', { retryable: false }));
          }
          reject(new SkillError('skill/aborted', { skillId: null, retryable: false }));
        }
        if (callerSignal) {
          if (callerSignal.aborted) { onAbort(); return; }
          callerSignal.addEventListener('abort', onAbort, { once: true });
        }
        record.promise.then(
          function (v) {
            if (settled) return;
            settled = true;
            if (callerSignal && callerSignal.removeEventListener) callerSignal.removeEventListener('abort', onAbort);
            resolve(v);
          },
          function (e) {
            if (settled) return;
            settled = true;
            if (callerSignal && callerSignal.removeEventListener) callerSignal.removeEventListener('abort', onAbort);
            reject(e);
          },
        );
      });
    }

    // -------------------- registry --------------------
    function define(def) {
      validateDefinition(def);
      if (registry.has(def.id)) {
        throw new TypeError('Definição de skill inválida: id duplicado "' + def.id + '".');
      }
      const normalized = Object.assign({}, def);
      if (normalized.kind === 'read' && normalized.retryable === undefined) {
        normalized.retryable = true;
      }
      const frozen = deepFreeze(normalized);
      registry.set(frozen.id, frozen);
      return frozen;
    }

    function get(id) {
      return registry.get(id) || null;
    }

    function has(id) {
      return registry.has(id);
    }

    function list(filter) {
      const f = filter || {};
      const out = [];
      for (const def of registry.values()) {
        if (f.source && !def.exposure.includes(f.source)) continue;
        if (f.agent && def.agent !== f.agent) continue;
        out.push(def);
      }
      return out;
    }

    // -------------------- reset --------------------
    function reset() {
      for (const marker of Array.from(activeExecutions)) {
        try { marker.abort('skill/aborted'); } catch (_e) {}
      }
      activeExecutions.clear();
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item.cancelled) {
          item.cancelled = true;
          try { item.reject(new SkillError('skill/aborted', { retryable: false })); } catch (_e) {}
        }
      }
      for (const record of inflight.values()) {
        try { record.controller.abort(new SkillError('skill/aborted', { retryable: false })); } catch (_e) {}
      }
      inflight.clear();
      cacheStore.clear();
      breakers.clear();
      // `running` não é zerado: execuções abortadas liquidam pelo limitador e
      // decrementam o contador naturalmente, evitando contagem negativa.
    }

    // -------------------- stats --------------------
    function stats() {
      const breakerPhases = {};
      for (const id of breakers.keys()) {
        breakerPhases[id] = breakerPhase(id);
      }
      return {
        running: running,
        queued: queue.length,
        cacheSize: cacheStore.size,
        inflight: inflight.size,
        breakers: breakerPhases,
      };
    }

    const runtimeApi = Object.freeze({
      define: define,
      get: get,
      has: has,
      list: list,
      invoke: invoke,
      on: on,
      reset: reset,
      stats: stats,
    });

    return runtimeApi;
  }

  return Object.freeze({
    createRuntime: createRuntime,
    SkillError: SkillError,
    isSkillError: isSkillError,
    ERROR_MESSAGES: ERROR_MESSAGES,
    canonicalJson: canonicalJson,
  });
});
