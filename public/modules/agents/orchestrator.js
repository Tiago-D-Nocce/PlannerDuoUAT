/* PlannerDuo — PlannerOrchestrator: turnos, plano puro, blocos tipados e eventos.
 *
 * UMD como public/travel.js (global PlannerOrchestrator). Não toca o DOM: emite
 * ResponseBlocks como dados puros (payload nunca é HTML) e eventos de atividade.
 *
 * As skills do agente 'orchestrator' (assist.help e assist.undo) são registradas
 * dentro de create(), de forma idempotente (só define quando runtime.has(id) é
 * falso), para que vários orquestradores compartilhem o mesmo runtime sem conflito.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerOrchestrator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const Skills = (root && root.PlannerSkills)
    || (typeof require === 'function' ? require('./skill-runtime.js') : null);
  const canonicalJson = (Skills && Skills.canonicalJson)
    ? Skills.canonicalJson
    : function (v) { return JSON.stringify(v); };

  const AGENTS = ['orchestrator', 'travel', 'finance', 'planner'];
  const UNDO_WINDOW_MS = 30000;
  const MAX_TEXT = 1000;
  const AI_CONFIDENCE_FLOOR = 0.45;
  const AUTONOMY_CONFIDENCE = 0.75;

  // Categorias centrais com rótulos pt-BR (para chips de categoria).
  const CATEGORY_LABELS = {
    alimentacao: 'Alimentação', transporte: 'Transporte', moradia: 'Moradia',
    lazer: 'Lazer', saude: 'Saúde', viagem: 'Viagem', educacao: 'Educação',
    vestuario: 'Vestuário', salario: 'Salário', investimento: 'Investimento', outros: 'Outros',
  };
  const POPULAR_DESTINATIONS = ['Lisboa', 'Paris', 'Rio de Janeiro', 'São Paulo', 'Nova York', 'Buenos Aires'];
  const CAPITAL_ORIGINS = ['São Paulo', 'Rio de Janeiro', 'Brasília', 'Belo Horizonte', 'Recife', 'Porto Alegre'];

  // -------------------------------------------------------------------------
  // utilidades puras
  function isTrustedGesture(gesture) {
    return Boolean(gesture) && gesture.isTrusted === true;
  }
  function safeNumber(n) {
    return typeof n === 'number' && Number.isFinite(n) ? n : 0;
  }
  function minorToDecimal(minor) {
    if (typeof minor !== 'number' || !Number.isFinite(minor)) return null;
    return Math.round(minor) / 100;
  }
  function slotValueText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'object') {
      if (value.name) return value.name;
      if (value.raw) return value.raw;
    }
    return String(value);
  }

  // -------------------------------------------------------------------------
  function create(options) {
    const opts = options || {};
    const runtime = opts.runtime;
    const nlu = opts.nlu;
    const places = opts.places || (root && root.PlannerPlaces) || null;
    const clock = normalizeClock(opts.clock);
    const aiEnabled = typeof opts.aiEnabled === 'function' ? opts.aiEnabled : function () { return false; };
    const getWorkspace = typeof opts.getWorkspace === 'function' ? opts.getWorkspace : function () { return null; };
    if (!runtime) throw new TypeError('PlannerOrchestrator.create exige um runtime.');
    if (!nlu) throw new TypeError('PlannerOrchestrator.create exige um nlu.');

    registerOrchestratorSkills(runtime, function () { return state; });

    // ---- estado em RAM ----
    const state = {
      memory: emptyMemory(),
      // recibo mais recente passível de desfazer: { receipt, skillId, expiresAt, undone }
      lastReceipt: null,
      // confirmações pendentes: blockId -> { executed, run }
      confirmations: new Map(),
    };

    const listeners = new Map(); // event -> Set(handler)
    let current = null; // turno corrente
    let turnSeq = 0;
    let blockSeq = 0;

    // ---------------- eventos ----------------
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
        try { handler(payload); } catch (_err) { /* um listener não derruba os demais */ }
      }
    }

    function nextBlockId() { blockSeq += 1; return 'blk-' + blockSeq; }

    function makeBlock(turn, agent, type, payload, actions) {
      const block = {
        id: nextBlockId(),
        turnId: turn.id,
        agent: AGENTS.includes(agent) ? agent : 'orchestrator',
        type: type,
        payload: payload == null ? {} : payload,
        createdAt: clock.now(),
      };
      if (Array.isArray(actions) && actions.length) block.actions = actions;
      return block;
    }

    // Emite um bloco só se o turno não foi superado.
    function emitBlock(turn, block) {
      if (turn.superseded) return;
      emit('block', block);
    }

    // ---------------- atividade (forward skill:* do turno corrente) ----------------
    const activeStarts = new Map(); // id -> at (ms) para calcular duração
    function forwardActivity(status) {
      return function (payload) {
        const turn = current;
        if (!turn || turn.superseded) return;
        if (payload == null || payload.turnId !== turn.id) return;
        if (status === 'running') activeStarts.set(payload.id, payload.at);
        const started = activeStarts.get(payload.id);
        const ms = typeof payload.ms === 'number'
          ? payload.ms
          : (status === 'running' ? 0 : safeNumber(clock.now() - (started != null ? started : payload.at)));
        if (status !== 'running') activeStarts.delete(payload.id);
        emit('activity', {
          id: payload.id,
          title: payload.title || payload.id,
          agent: payload.agent,
          status: status,
          ms: ms,
        });
      };
    }
    runtime.on('skill:start', forwardActivity('running'));
    runtime.on('skill:done', forwardActivity('done'));
    runtime.on('skill:error', forwardActivity('error'));

    // ---------------- handle ----------------
    async function handle(text) {
      // supersessão: aborta o turno anterior.
      if (current) current.abort();
      const turn = newTurn();
      current = turn;
      const t = String(text == null ? '' : text).slice(0, MAX_TEXT);
      emit('turn:start', { turnId: turn.id, text: t });
      try {
        await runTurn(turn, t);
      } catch (_err) {
        // handle nunca lança nem expõe stacks.
        if (!turn.superseded) {
          emitBlock(turn, makeBlock(turn, 'orchestrator', 'error', {
            message: 'Não consegui concluir agora. Tente novamente.',
          }, [{ id: 'retry', label: 'Tentar de novo', kind: 'secondary', value: t }]));
        }
      } finally {
        if (!turn.superseded) emit('turn:end', { turnId: turn.id });
      }
    }

    async function runTurn(turn, t) {
      // 1) resposta curta a uma pergunta pendente?
      const pending = state.memory.pending;
      if (pending && isBareAnswer(t)) {
        const filled = fillPendingSlot(turn, pending, t);
        if (filled) return; // continuou o fluxo (plano ou nova pergunta)
      }

      // 2) parse local
      let parsed = safeParse(t);

      // 3) assist.interpret (no máximo 1 por turno)
      if (parsed.confidence < AI_CONFIDENCE_FLOOR && aiEnabled() && runtime.has('assist.interpret')) {
        const remote = await invokeSafe('assist.interpret',
          { text: t, pending: parsed.missing || [] }, turn);
        if (turn.superseded) return;
        const merged = mergeRemote(parsed, remote && remote.value !== undefined ? remote.value : remote);
        if (merged) parsed = merged;
      }
      if (turn.superseded) return;

      await planAndRun(turn, parsed, t);
    }

    // Executa o plano para um ParsedMessage.
    async function planAndRun(turn, parsed, rawText) {
      const plan = buildPlan(parsed);

      if (plan.kind === 'text') {
        emitBlock(turn, makeBlock(turn, plan.agent || 'orchestrator', 'text', plan.payload, plan.actions));
        return;
      }

      if (plan.kind === 'question') {
        rememberPending(parsed, plan.slot);
        emitBlock(turn, makeBlock(turn, plan.agent || 'orchestrator', 'question', plan.payload, plan.actions));
        return;
      }

      // a partir daqui há stages a executar.
      state.memory.pending = null;
      rememberParsed(parsed);

      for (const stage of plan.stages) {
        if (turn.superseded) return;
        await runStage(turn, stage, parsed);
        if (turn.superseded) return;
      }
    }

    // Roda os steps de um stage em paralelo; emite cada bloco assim que o step liquida.
    function runStage(turn, stage, parsed) {
      const steps = stage.steps || [];
      if (!steps.length) return Promise.resolve();
      return new Promise(function (resolve) {
        let remaining = steps.length;
        const done = function () { remaining -= 1; if (remaining <= 0) resolve(); };
        steps.forEach(function (step) {
          runStep(turn, step, parsed).then(done, done);
        });
      });
    }

    async function runStep(turn, step, parsed) {
      if (turn.superseded) return;

      // escrita que exige confirmação (slot remoto ou confiança < 0.75): confirmation.
      if (step.write && step.requireConfirm) {
        const block = makeConfirmationBlock(turn, step);
        emitBlock(turn, block);
        return;
      }

      let result;
      try {
        result = await invokeOrThrow(step.skillId, step.input, turn);
      } catch (err) {
        if (turn.superseded) return;
        handleStepError(turn, step, err);
        return;
      }
      if (turn.superseded) return;

      if (step.skillId === 'assist.undo') {
        // desfazer não vira recibo (não é desfazível) — vira texto de confirmação.
        emitBlock(turn, makeBlock(turn, 'orchestrator', 'text', { message: result && result.message ? result.message : 'Desfeito.' }));
        return;
      }
      if (step.write) {
        // escrita autônoma: recibo com Desfazer.
        registerReceipt(result, step.skillId);
        emitBlock(turn, receiptBlock(turn, step, result));
      } else {
        emitBlock(turn, readBlock(turn, step, result));
      }
    }

    function handleStepError(turn, step, err) {
      // skill/invalid-input vira pergunta a partir do primeiro field error.
      if (err && err.code === 'skill/invalid-input' && Array.isArray(err.fields) && err.fields.length) {
        const field = err.fields[0];
        emitBlock(turn, makeBlock(turn, step.agent, 'question', {
          slot: field.field,
          prompt: field.message,
        }, chipsForField(step, field.field)));
        return;
      }
      // demais erros: bloco error sem stack nem corpo upstream.
      emitBlock(turn, makeBlock(turn, step.agent, 'error', {
        message: errorCopy(err),
        retryable: Boolean(err && err.retryable),
      }, [{ id: 'retry', label: 'Tentar de novo', kind: 'secondary' }]));
    }

    // ---------------- blocos tipados ----------------
    function readBlock(turn, step, result) {
      if (step.resultType === 'links') {
        return makeBlock(turn, step.agent, 'links', { links: result && result.links ? result.links : [], skipped: result && result.skipped ? result.skipped : [] });
      }
      if (step.resultType === 'flights') {
        return makeBlock(turn, step.agent, 'flights', { results: result });
      }
      if (step.resultType === 'stays') {
        return makeBlock(turn, step.agent, 'stays', { results: result });
      }
      // leituras diversas -> summary com kind.
      return makeBlock(turn, step.agent, 'summary', { kind: step.summaryKind || 'generic', data: result });
    }

    function receiptBlock(turn, step, receipt) {
      return makeBlock(turn, step.agent, 'receipt', {
        entity: receipt.entity,
        action: receipt.action,
        message: receipt.message,
        id: receipt.id,
      }, [{ id: 'undo', label: 'Desfazer', kind: 'secondary', value: receipt.id }]);
    }

    function makeConfirmationBlock(turn, step) {
      const block = makeBlock(turn, step.agent, 'confirmation', {
        skillId: step.skillId,
        title: step.title || step.skillId,
        fields: summarizeFields(step.input),
        message: 'Confirme para executar.',
      }, [
        { id: 'confirm', label: 'Confirmar', kind: 'primary' },
        { id: 'cancel', label: 'Cancelar', kind: 'secondary' },
      ]);
      // registra executor one-shot.
      state.confirmations.set(block.id, {
        executed: false,
        step: step,
        turn: turn,
      });
      return block;
    }

    // ---------------- act ----------------
    async function act(blockId, action, gesture) {
      const entry = state.confirmations.get(blockId);
      if (!entry) return;
      if (action === 'cancel') {
        state.confirmations.delete(blockId);
        return;
      }
      if (action !== 'confirm') return;
      if (!isTrustedGesture(gesture)) return; // gesto não confiável é ignorado
      if (entry.executed) return; // executa no máximo uma vez
      entry.executed = true;
      state.confirmations.delete(blockId);

      const step = entry.step;
      const turn = entry.turn;
      let result;
      try {
        // confirmações executam fora do ciclo do turno original; usamos o turnId
        // do turno que gerou o card para rastreio, mas sem sinal de supersessão.
        result = await invokeOrThrow(step.skillId, step.input, turn, { ignoreSupersession: true });
      } catch (err) {
        emit('block', makeBlock(turn, step.agent, 'error', {
          message: errorCopy(err),
          retryable: Boolean(err && err.retryable),
        }, [{ id: 'retry', label: 'Tentar de novo', kind: 'secondary' }]));
        return;
      }
      registerReceipt(result, step.skillId);
      emit('block', receiptBlock(turn, step, result));
    }

    // ---------------- clear ----------------
    function clear() {
      if (current) current.abort();
      current = null;
      state.memory = emptyMemory();
      state.lastReceipt = null;
      state.confirmations.clear();
      activeStarts.clear();
      emit('cleared', {});
    }

    // ---------------- snapshot ----------------
    function snapshot() {
      return {
        memory: {
          lastIntent: state.memory.lastIntent,
          pending: state.memory.pending ? { intent: state.memory.pending.intent, slot: state.memory.pending.slot } : null,
          slots: Object.assign({}, state.memory.slots),
          hasReceipt: Boolean(state.lastReceipt && !state.lastReceipt.undone),
        },
        pendingConfirmations: state.confirmations.size,
        turnId: current ? current.id : null,
      };
    }

    // ---------------- invoke helpers ----------------
    function invokeOpts(turn, extra) {
      const o = { source: 'chat', turnId: turn.id };
      if (!(extra && extra.ignoreSupersession)) o.signal = turn.signal;
      return o;
    }
    function invokeOrThrow(skillId, input, turn, extra) {
      return runtime.invoke(skillId, input, invokeOpts(turn, extra));
    }
    async function invokeSafe(skillId, input, turn) {
      try {
        const value = await runtime.invoke(skillId, input, invokeOpts(turn));
        return { value: value };
      } catch (_err) {
        return null;
      }
    }

    // ---------------- plano ----------------
    function buildPlan(parsed) {
      const intent = parsed.intent;
      const slots = parsed.slots || {};
      const hasRemote = anySlotRemote(slots);
      const localConfident = parsed.confidence >= AUTONOMY_CONFIDENCE && !hasRemote;

      // ui-only / entidades não suportadas no chat.
      const uiRedirect = UI_ONLY_HINTS[intent];
      if (uiRedirect) {
        return { kind: 'text', agent: uiRedirect.agent, payload: { message: uiRedirect.message } };
      }

      // ajuda / desconhecido.
      if (intent === 'help' || intent === 'unknown') {
        return {
          kind: 'stages',
          stages: [{ steps: [readStep('assist.help', 'orchestrator', buildHelpInput(), { summaryKind: 'help' })] }],
        };
      }
      if (intent === 'undo') {
        return {
          kind: 'stages',
          stages: [{ steps: [writeStepFixed('assist.undo', 'orchestrator', {}, 'Desfazer', false)] }],
        };
      }

      // valida o primeiro slot faltante (a partir do NLU) e pergunta.
      const missing = Array.isArray(parsed.missing) ? parsed.missing : [];
      if (missing.length) {
        return questionPlan(intent, missing[0], slots);
      }

      const mapping = INTENT_PLANS[intent];
      if (!mapping) {
        return { kind: 'text', agent: 'orchestrator', payload: { message: 'Ainda não sei fazer isso por aqui.' } };
      }
      return mapping(slots, { localConfident });
    }

    function questionPlan(intent, slot, slots) {
      return {
        kind: 'question',
        agent: agentForIntent(intent),
        slot: slot,
        payload: { slot: slot, prompt: promptForSlot(slot), intent: intent },
        actions: chipsForSlot(slot, slots),
      };
    }

    // ---------------- chips ----------------
    function chipsForSlot(slot, slots) {
      const ws = safeWorkspace();
      const chips = [];
      const add = function (label, value) { chips.push({ id: 'chip-' + chips.length, label: label, kind: 'chip', value: value != null ? value : label }); };
      switch (slot) {
        case 'destination':
          POPULAR_DESTINATIONS.forEach(function (d) { add(d); });
          if (places && typeof places.search === 'function' && slots && slots.destinationQuery) {
            places.search(slots.destinationQuery, 4).forEach(function (p) { add(p.name); });
          }
          break;
        case 'origin': {
          if (slots && slots.lastOrigin) add(slotValueText(slots.lastOrigin));
          CAPITAL_ORIGINS.forEach(function (c) { add(c); });
          break;
        }
        case 'departDate':
          add('Amanhã'); add('Próxima sexta'); add('Daqui a 2 semanas');
          break;
        case 'returnDate':
          add('Só ida'); add('3 noites'); add('1 semana');
          break;
        case 'payer':
        case 'voter':
        case 'voterRef':
          activeParticipants(ws).forEach(function (p) { add(p.name, p.id); });
          break;
        case 'category':
          Object.keys(CATEGORY_LABELS).forEach(function (c) { add(CATEGORY_LABELS[c], c); });
          break;
        case 'tripRef':
          (ws && ws.trips ? ws.trips : []).forEach(function (tr) { add(tr.destination, tr.id); });
          break;
        default:
          break;
      }
      return chips.length ? chips : undefined;
    }

    // chips a partir de def.chipsFor(slot, workspace) quando a skill expõe.
    function chipsForField(step, slotName) {
      const def = runtime.get(step.skillId);
      const ws = safeWorkspace();
      if (def && typeof def.chipsFor === 'function') {
        let labels = null;
        try { labels = def.chipsFor(slotName, ws); } catch (_e) { labels = null; }
        if (Array.isArray(labels) && labels.length) {
          return labels.map(function (lbl, i) { return { id: 'chip-' + i, label: String(lbl), kind: 'chip', value: String(lbl) }; });
        }
      }
      return chipsForSlot(slotName, {});
    }

    function activeParticipants(ws) {
      if (!ws || !Array.isArray(ws.participants)) return [];
      return ws.participants.filter(function (p) { return p && p.active; });
    }
    function safeWorkspace() {
      try { return getWorkspace(); } catch (_e) { return null; }
    }

    // ---------------- memória / slot filling ----------------
    function rememberParsed(parsed) {
      state.memory.lastIntent = parsed.intent;
      state.memory.slots = Object.assign({}, parsed.slots || {});
      state.memory.pending = null;
    }
    function rememberPending(parsed, slot) {
      state.memory.lastIntent = parsed.intent;
      state.memory.slots = Object.assign({}, parsed.slots || {});
      state.memory.pending = { intent: parsed.intent, slot: slot, slots: Object.assign({}, parsed.slots || {}) };
    }

    // Preenche o slot pendente a partir de uma resposta curta e continua o fluxo.
    function fillPendingSlot(turn, pending, t) {
      let value;
      try {
        value = typeof nlu.parseSlotValue === 'function'
          ? nlu.parseSlotValue(pending.slot, t, buildMemoryContext(), clock)
          : null;
      } catch (_e) { value = null; }
      if (value == null) return false;

      const slots = Object.assign({}, pending.slots || {});
      applyFilledSlot(slots, pending.slot, value);

      const parsed = {
        intent: pending.intent,
        confidence: 0.8, // resposta local a uma pergunta local
        followUp: true,
        slots: slots,
        missing: recomputeMissing(pending.intent, slots),
      };
      // continua o mesmo intent (plano ou nova pergunta).
      planAndRun(turn, parsed, t);
      return true;
    }

    function applyFilledSlot(slots, slot, value) {
      if (slot === 'returnDate' && value && typeof value === 'object') {
        if (value.oneWay) { slots.oneWay = true; delete slots.returnDate; return; }
        if (value.nights != null) { slots.nights = value.nights; return; }
      }
      slots[slot] = value;
    }

    function recomputeMissing(intent, slots) {
      if (typeof nlu.requiredSlots !== 'function') return [];
      const required = nlu.requiredSlots(intent) || [];
      const missing = [];
      required.forEach(function (name) {
        if (name === 'returnDate') {
          if (slots.oneWay || slots.nights != null || slots.returnDate != null) return;
          missing.push('returnDate');
          return;
        }
        const v = slots[name];
        const present = v != null
          && !(Array.isArray(v) && v.length === 0)
          && !(typeof v === 'string' && v === '')
          && !(typeof v === 'object' && v.unresolved);
        if (!present) missing.push(name);
      });
      return missing;
    }

    function buildMemoryContext() {
      return {
        lastIntent: state.memory.lastIntent,
        slots: state.memory.slots,
      };
    }

    function safeParse(t) {
      try {
        const r = nlu.parse(t, buildMemoryContext(), clock);
        if (!r || typeof r !== 'object') return fallbackParsed(t);
        return r;
      } catch (_e) {
        return fallbackParsed(t);
      }
    }

    // ---------------- recibo / undo ----------------
    function registerReceipt(receipt, skillId) {
      if (!receipt || typeof receipt !== 'object') { state.lastReceipt = null; return; }
      state.lastReceipt = {
        receipt: receipt,
        skillId: skillId,
        expiresAt: clock.now() + UNDO_WINDOW_MS,
        undone: false,
      };
    }

    // -------------------------------------------------------------------------
    return Object.freeze({
      handle: handle,
      act: act,
      clear: clear,
      on: on,
      snapshot: snapshot,
    });

    // ============ funções internas que dependem do turno ============
    function newTurn() {
      turnSeq += 1;
      const controller = new AbortController();
      const turn = {
        id: 'turn-' + turnSeq,
        controller: controller,
        signal: controller.signal,
        superseded: false,
        abort: function () {
          turn.superseded = true;
          try { controller.abort(); } catch (_e) { /* noop */ }
        },
      };
      return turn;
    }

    function fallbackParsed(t) {
      return { intent: 'unknown', confidence: 0, followUp: false, slots: {}, missing: [], text: t };
    }

    function buildHelpInput() {
      return { agents: AGENTS.slice() };
    }
  }

  // ---------------------------------------------------------------------------
  // PLANOS POR INTENT (puro) — mapeia slots do NLU para os campos exatos das skills.
  // Cada entrada recebe (slots, meta) e devolve um plano { kind:'stages', stages:[...] }.
  // Steps de escrita trazem requireConfirm quando a autonomia não permite execução direta.
  const INTENT_PLANS = {
    'travel.search': function (slots, meta) {
      const linkStep = travelLinksStep(slots, 'all');
      const steps = [linkStep];
      if (optionalAvailable('travel.flights.search')) steps.push(flightsStep(slots));
      if (optionalAvailable('travel.stays.search')) steps.push(staysStep(slots));
      return { kind: 'stages', stages: [{ steps: steps }] };
    },
    'travel.flights': function (slots) {
      const steps = [travelLinksStep(slots, 'flights')];
      if (optionalAvailable('travel.flights.search')) steps.push(flightsStep(slots));
      return { kind: 'stages', stages: [{ steps: steps }] };
    },
    'travel.stays': function (slots) {
      const steps = [travelLinksStep(slots, 'stays')];
      if (optionalAvailable('travel.stays.search')) steps.push(staysStep(slots));
      return { kind: 'stages', stages: [{ steps: steps }] };
    },
    'travel.links': function (slots) {
      return { kind: 'stages', stages: [{ steps: [travelLinksStep(slots, 'all')] }] };
    },
    'trip.create': function (slots, meta) {
      const input = { destination: slotValueText(slots.destination) };
      if (slots.departDate) input.startDate = slots.departDate;
      if (slots.returnDate) input.endDate = slots.returnDate;
      return writeStages('travel.trip.create', 'travel', input, 'Planejar viagem', meta);
    },
    'trip.list': function () {
      return { kind: 'stages', stages: [{ steps: [readStepStatic('travel.trip.list', 'travel', { status: 'all' }, 'trip-list')] }] };
    },
    'trip.summary': function (slots) {
      return { kind: 'stages', stages: [{ steps: [readStepStatic('travel.trip.summary', 'travel', { tripRef: slotValueText(slots.tripRef) }, 'trip-summary')] }] };
    },
    'finance.add': function (slots, meta) {
      const input = {
        type: slots.financeType === 'income' ? 'income' : 'expense',
        description: slots.description || '',
        amount: minorToDecimal(slots.amountMinor),
      };
      if (slots.category) input.category = slots.category;
      if (slots.payer) input.payer = slots.payer;
      if (slots.date) input.date = slots.date;
      return writeStages('finance.transaction.create', 'finance', input, 'Registrar transação', meta);
    },
    'finance.summary': function (slots) {
      const input = slots.month ? { month: slots.month } : {};
      return { kind: 'stages', stages: [{ steps: [readStepStatic('finance.summary', 'finance', input, 'finance-summary')] }] };
    },
    'finance.settle': function (slots) {
      const input = slots.month ? { month: slots.month } : {};
      return { kind: 'stages', stages: [{ steps: [readStepStatic('finance.settlements', 'finance', input, 'settlements')] }] };
    },
    'budget.set': function (slots, meta) {
      const input = { category: slots.category, amount: minorToDecimal(slots.amountMinor) };
      return writeStages('finance.budget.set', 'finance', input, 'Definir orçamento', meta);
    },
    'goal.create': function (slots, meta) {
      const input = { title: slots.title || '', target: minorToDecimal(slots.targetMinor) };
      if (slots.deadline) input.deadline = slots.deadline;
      return writeStages('finance.goal.create', 'finance', input, 'Criar meta', meta);
    },
    'goal.fund': function (slots, meta) {
      const input = { goalRef: slotValueText(slots.goalRef), amount: minorToDecimal(slots.amountMinor) };
      return writeStages('finance.goal.fund', 'finance', input, 'Adicionar valor à meta', meta);
    },
    'goal.progress': function () {
      if (!optionalAvailable('finance.goal.list')) {
        return { kind: 'text', agent: 'finance', payload: { message: 'A lista de metas abre na tela de Finanças.' } };
      }
      return { kind: 'stages', stages: [{ steps: [readStepStatic('finance.goal.list', 'finance', {}, 'goals')] }] };
    },
    'checklist.add': function (slots, meta) {
      return writeStages('planner.checklist.add', 'planner', { text: slots.title || '' }, 'Adicionar item ao checklist', meta);
    },
    'checklist.done': function (slots, meta) {
      return writeStages('planner.checklist.toggle', 'planner', { itemRef: slotValueText(slots.itemRef), done: true }, 'Marcar item', meta);
    },
    'checklist.list': function () {
      return { kind: 'stages', stages: [{ steps: [readStepStatic('planner.checklist.list', 'planner', { filter: 'all' }, 'checklist')] }] };
    },
    'decision.create': function (slots, meta) {
      const input = { title: slots.title || '', options: Array.isArray(slots.options) ? slots.options : [] };
      return writeStages('planner.decision.create', 'planner', input, 'Criar decisão', meta);
    },
    'decision.vote': function (slots, meta) {
      const input = { optionRef: slotValueText(slots.optionRef) };
      if (slots.voter) input.voterRef = slots.voter;
      if (slots.decisionRef) input.decisionRef = slotValueText(slots.decisionRef);
      return writeStages('planner.decision.vote', 'planner', input, 'Votar em decisão', meta);
    },
    'decision.list': function () {
      return { kind: 'stages', stages: [{ steps: [readStepStatic('planner.decision.list', 'planner', { filter: 'all' }, 'decisions')] }] };
    },
    'participant.add': function (slots, meta) {
      return writeStages('planner.participant.add', 'planner', { name: slots.participantName || '' }, 'Adicionar participante', meta);
    },
    'report.month': function (slots) {
      const input = slots.month ? { month: slots.month } : {};
      return { kind: 'stages', stages: [{ steps: [readStepStatic('finance.report', 'finance', input, 'report')] }] };
    },
  };

  // Mantém a disponibilidade de skills opcionais acessível aos planos (fechamento global
  // por request): usamos uma referência mutável definida em create via closure. Como os
  // planos são funções-módulo, consultamos o runtime através de um ponteiro corrente.
  let CURRENT_RUNTIME = null;
  function optionalAvailable(id) {
    return Boolean(CURRENT_RUNTIME && CURRENT_RUNTIME.has(id));
  }

  // ---- construtores de step (puros) ----
  function readStep(skillId, agent, input, extra) {
    return Object.assign({ skillId: skillId, agent: agent, input: input, write: false, resultType: 'summary' }, extra || {});
  }
  function readStepStatic(skillId, agent, input, summaryKind) {
    return { skillId: skillId, agent: agent, input: input, write: false, resultType: 'summary', summaryKind: summaryKind };
  }
  function travelLinksStep(slots, group) {
    const input = {
      destination: slotValueText(slots.destination),
      group: group,
    };
    if (slots.origin) input.origin = slotValueText(slots.origin);
    if (slots.departDate) input.departDate = slots.departDate;
    if (slots.returnDate) input.returnDate = slots.returnDate;
    if (slots.adults) input.adults = slots.adults;
    return { skillId: 'travel.links.build', agent: 'travel', input: input, write: false, resultType: 'links' };
  }
  function flightsStep(slots) {
    const input = {
      origin: slotValueText(slots.origin),
      destination: slotValueText(slots.destination),
      departDate: slots.departDate,
      returnDate: slots.returnDate || '',
      adults: slots.adults || 1,
    };
    if (slots.cabin) input.cabin = slots.cabin;
    if (slots.directOnly != null) input.directOnly = slots.directOnly;
    if (slots.maxPriceMinor != null) input.maxPrice = minorToDecimal(slots.maxPriceMinor);
    return { skillId: 'travel.flights.search', agent: 'travel', input: input, write: false, resultType: 'flights' };
  }
  function staysStep(slots) {
    const input = {
      destination: slotValueText(slots.destination),
      checkIn: slots.departDate,
      checkOut: slots.returnDate || '',
      adults: slots.adults || 1,
    };
    if (slots.nights != null) input.nights = slots.nights;
    return { skillId: 'travel.stays.search', agent: 'travel', input: input, write: false, resultType: 'stays' };
  }
  function writeStages(skillId, agent, input, title, meta) {
    const requireConfirm = !(meta && meta.localConfident);
    return { kind: 'stages', stages: [{ steps: [writeStepFixed(skillId, agent, input, title, requireConfirm)] }] };
  }
  function writeStepFixed(skillId, agent, input, title, requireConfirm) {
    return { skillId: skillId, agent: agent, input: input, write: true, title: title, requireConfirm: Boolean(requireConfirm) };
  }

  // ---- redirecionamentos ui-only ----
  const UI_ONLY_HINTS = {
    // intents de exclusão não existem no NLU allowlist, mas tratamos termos comuns
    // que o NLU devolve como 'unknown'; aqui ficam só os mapeamentos diretos.
  };

  // ---- helpers de intent ----
  function agentForIntent(intent) {
    if (!intent) return 'orchestrator';
    if (intent.indexOf('travel') === 0 || intent.indexOf('trip') === 0) return 'travel';
    if (intent.indexOf('finance') === 0 || intent.indexOf('budget') === 0 || intent.indexOf('goal') === 0 || intent === 'report.month') return 'finance';
    if (intent.indexOf('checklist') === 0 || intent.indexOf('decision') === 0 || intent.indexOf('participant') === 0) return 'planner';
    return 'orchestrator';
  }

  const SLOT_PROMPTS = {
    destination: 'Para onde você quer ir?',
    origin: 'De onde você sai?',
    departDate: 'Quando é a ida?',
    returnDate: 'Quando é a volta?',
    nights: 'Quantas noites?',
    adults: 'Quantas pessoas?',
    amountMinor: 'Qual é o valor?',
    targetMinor: 'Qual é o valor alvo?',
    maxPriceMinor: 'Qual é o preço máximo?',
    description: 'Qual é a descrição?',
    category: 'Qual categoria?',
    payer: 'Quem pagou?',
    voter: 'Quem está votando?',
    participantName: 'Qual é o nome do participante?',
    title: 'Qual é o título?',
    options: 'Quais são as opções?',
    tripRef: 'Qual viagem?',
    goalRef: 'Qual meta?',
    itemRef: 'Qual item?',
    optionRef: 'Em qual opção você vota?',
    financeType: 'É um gasto ou uma receita?',
    month: 'De qual mês?',
  };
  function promptForSlot(slot) {
    return SLOT_PROMPTS[slot] || 'Pode me dar esse detalhe?';
  }

  function anySlotRemote(slots) {
    if (!slots) return false;
    for (const key of Object.keys(slots)) {
      const v = slots[key];
      if (v && typeof v === 'object' && v.origin === 'remote') return true;
    }
    return Boolean(slots.__remote);
  }

  function summarizeFields(input) {
    const out = [];
    if (!input) return out;
    Object.keys(input).forEach(function (k) {
      const v = input[k];
      if (v == null || v === '') return;
      out.push({ field: k, value: typeof v === 'object' ? slotValueText(v) : String(v) });
    });
    return out;
  }

  function errorCopy(err) {
    if (err && typeof err.message === 'string' && err.code && err.code.indexOf('skill/') === 0) {
      return err.message;
    }
    return 'Algo deu errado. Você pode tentar de novo.';
  }

  function mergeRemote(parsed, remote) {
    if (!remote || typeof remote !== 'object') return null;
    if (typeof remote.intent !== 'string') return null;
    const slots = Object.assign({}, parsed.slots || {});
    if (remote.slots && typeof remote.slots === 'object') {
      Object.keys(remote.slots).forEach(function (k) {
        const v = remote.slots[k];
        if (v == null) return;
        if (v && typeof v === 'object') slots[k] = Object.assign({}, v, { origin: 'remote' });
        else slots[k] = v;
      });
      slots.__remote = true;
    }
    const confidence = typeof remote.confidence === 'number' ? Math.max(0, Math.min(1, remote.confidence)) : parsed.confidence;
    return {
      intent: remote.intent,
      confidence: confidence,
      followUp: false,
      slots: slots,
      missing: Array.isArray(remote.missing) ? remote.missing : (parsed.missing || []),
    };
  }

  function isBareAnswer(t) {
    const trimmed = String(t || '').trim();
    if (!trimmed) return false;
    // resposta curta: poucas palavras, sem verbo de comando explícito.
    const words = trimmed.split(/\s+/);
    if (words.length > 6) return false;
    return true;
  }

  function emptyMemory() {
    return { lastIntent: null, slots: {}, pending: null };
  }

  function normalizeClock(clock) {
    const base = {
      now: function () { return Date.now(); },
      setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
      clearTimeout: function (id) { return clearTimeout(id); },
    };
    if (!clock) return base;
    return {
      now: typeof clock.now === 'function' ? clock.now.bind(clock) : base.now,
      setTimeout: typeof clock.setTimeout === 'function' ? clock.setTimeout.bind(clock) : base.setTimeout,
      clearTimeout: typeof clock.clearTimeout === 'function' ? clock.clearTimeout.bind(clock) : base.clearTimeout,
    };
  }

  // ---------------------------------------------------------------------------
  // Skills do agente orchestrator. Registradas idempotentemente.
  function registerOrchestratorSkills(runtime, getState) {
    CURRENT_RUNTIME = runtime;
    if (!runtime.has('assist.help')) {
      runtime.define({
        id: 'assist.help',
        agent: 'orchestrator',
        kind: 'read',
        exposure: ['chat', 'ui'],
        timeoutMs: 1000,
        title: 'Ajuda',
        validate: function (input) {
          return { ok: true, value: { agents: (input && Array.isArray(input.agents)) ? input.agents.slice() : AGENTS.slice() } };
        },
        run: function (_value) {
          return {
            capabilities: [
              { agent: 'travel', examples: ['Voo de São Paulo para Lisboa em dezembro', 'Montar links para o Rio', 'Minhas viagens'] },
              { agent: 'finance', examples: ['Gastei 150 no mercado', 'Resumo do mês', 'Definir orçamento de lazer'] },
              { agent: 'planner', examples: ['Adicionar documentos ao checklist', 'Criar decisão: praia ou serra', 'Adicionar participante Ana'] },
            ],
          };
        },
      });
    }
    if (!runtime.has('assist.undo')) {
      runtime.define({
        id: 'assist.undo',
        agent: 'orchestrator',
        kind: 'write',
        exposure: ['chat', 'ui'],
        timeoutMs: 3000,
        title: 'Desfazer',
        validate: function () { return { ok: true, value: {} }; },
        run: function (_value, ctx) {
          const state = getState();
          const entry = state && state.lastReceipt;
          if (!entry || entry.undone) {
            throw undoError('Não há nada recente para desfazer.');
          }
          if (ctx.now() > entry.expiresAt) {
            throw undoError('O prazo para desfazer (30 s) já passou.');
          }
          return applyUndo(ctx, entry).then(function (msg) {
            entry.undone = true;
            state.lastReceipt = null;
            return { entity: 'undo', action: 'undo', message: msg };
          });
        },
      });
    }
  }

  function undoError(message) {
    const err = new Error(message);
    err.code = 'skill/failed';
    err.retryable = false;
    return err;
  }

  // Aplica a pré-imagem do recibo via ctx.commit, recusando se a entidade mudou.
  async function applyUndo(ctx, entry) {
    const receipt = entry.receipt;
    const collection = receipt.collection;
    const action = receipt.action;

    // coleção-nome (workspace rename): before/after são o próprio valor do campo.
    if (receipt.entity === 'workspace' && collection === 'name') {
      const ws = ctx.getWorkspace();
      if (canonicalJson(ws.name == null ? null : ws.name) !== canonicalJson(receipt.after == null ? null : receipt.after)) {
        throw undoError('O nome mudou desde então; não dá para desfazer.');
      }
      await ctx.commit(function (draft) { draft.name = receipt.before; }, { source: ctx.source, message: 'Desfazer' });
      return 'Desfeito.';
    }

    // orçamentos: coleção é um mapa { categoria: valor }.
    if (receipt.entity === 'budget' && collection === 'budgets') {
      const ws = ctx.getWorkspace();
      const curr = ws.budgets ? ws.budgets[receipt.id] : undefined;
      const currNorm = curr == null ? null : curr;
      if (canonicalJson(currNorm) !== canonicalJson(receipt.after == null ? null : receipt.after)) {
        throw undoError('Este orçamento mudou desde então; não dá para desfazer.');
      }
      await ctx.commit(function (draft) {
        if (receipt.before == null) delete draft.budgets[receipt.id];
        else draft.budgets[receipt.id] = receipt.before;
      }, { source: ctx.source, message: 'Desfazer' });
      return 'Desfeito.';
    }

    // coleções de lista (array por id).
    const ws = ctx.getWorkspace();
    const list = ws ? ws[collection] : null;
    if (!Array.isArray(list)) {
      throw undoError('Não foi possível desfazer esta ação.');
    }
    const current = list.find(function (item) { return item && item.id === receipt.id; }) || null;

    if (action === 'create') {
      // criado: a entidade deve existir e ser igual ao after; removemos.
      if (!current) throw undoError('Este item já foi alterado; não dá para desfazer.');
      if (canonicalJson(current) !== canonicalJson(receipt.after)) {
        throw undoError('Este item mudou desde então; não dá para desfazer.');
      }
      await ctx.commit(function (draft) {
        draft[collection] = draft[collection].filter(function (item) { return !(item && item.id === receipt.id); });
      }, { source: ctx.source, message: 'Desfazer' });
      return 'Desfeito.';
    }

    // update/toggle/vote/close/reopen/fund/rename/set: restaura before.
    if (!current) throw undoError('Este item foi removido; não dá para desfazer.');
    if (canonicalJson(current) !== canonicalJson(receipt.after)) {
      throw undoError('Este item mudou desde então; não dá para desfazer.');
    }
    await ctx.commit(function (draft) {
      const idx = draft[collection].findIndex(function (item) { return item && item.id === receipt.id; });
      if (idx < 0) {
        const conflict = new Error('Este item foi removido; não dá para desfazer.');
        conflict.code = 'skill/failed';
        throw conflict;
      }
      draft[collection][idx] = receipt.before;
    }, { source: ctx.source, message: 'Desfazer' });
    return 'Desfeito.';
  }

  return Object.freeze({
    create: create,
    registerOrchestratorSkills: registerOrchestratorSkills,
  });
});
