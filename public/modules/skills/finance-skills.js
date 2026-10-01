/* PlannerDuo — skills do Agente Financeiro (transações, orçamentos, metas, acertos e relatórios). */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerFinanceSkills = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const Kit = (root && root.PlannerSkillKit) || (typeof require === 'function' ? require('./skill-kit.js') : null);

  function cloneOr(value) {
    return value == null ? null : Kit.deepClone(value);
  }
  function monthMatch(dateIso, month) {
    return !month || String(dateIso || '').startsWith(month);
  }
  function entityConflict(message) {
    const error = new Error(message || 'Este item foi alterado ou removido em outra aba.');
    error.code = 'local/entity-conflict';
    return error;
  }
  function invalidInput(fields) {
    const err = new Error(fields[0].message);
    err.code = 'skill/invalid-input';
    err.fields = fields;
    return err;
  }

  // Resolve pagador por id direto (paidById) ou referência humana (payer).
  function resolvePayer(ws, value) {
    if (value.paidById != null && value.paidById !== '') {
      const direct = ws.participants.find((p) => p.id === value.paidById);
      if (!direct) return { fields: [Kit.fieldError('paidById', 'Participante do pagamento não encontrado.')] };
      return { id: direct.id };
    }
    if (value.payer != null && value.payer !== '') {
      const r = Kit.resolveParticipant(ws, value.payer, { field: 'payer' });
      if (!r.ok) return { fields: r.fields };
      return { id: r.value.id };
    }
    return { id: null };
  }

  // Resolve divisão: splitBetweenIds (array) OU splitWith ('all' | nomes).
  function resolveSplit(ws, value) {
    if (Array.isArray(value.splitBetweenIds)) {
      const valid = value.splitBetweenIds.map(String).filter((id) => ws.participants.some((p) => p.id === id));
      return { ids: valid, provided: true };
    }
    if (value.splitWith != null && value.splitWith !== '') {
      if (value.splitWith === 'all' || Kit.normalizeKey(value.splitWith) === 'todos') {
        return { ids: ws.participants.filter((p) => p.active).map((p) => p.id), provided: true };
      }
      const names = Array.isArray(value.splitWith) ? value.splitWith : String(value.splitWith).split(',');
      const ids = [];
      for (const name of names) {
        const r = Kit.resolveParticipant(ws, name, { field: 'splitWith' });
        if (!r.ok) return { fields: r.fields };
        if (!ids.includes(r.value.id)) ids.push(r.value.id);
      }
      return { ids, provided: true };
    }
    return { ids: [], provided: false };
  }

  function register(runtime) {
    const ids = [];
    function def(definition) {
      runtime.define(definition);
      ids.push(definition.id);
    }

    // ---------- finance.transaction.create (write) ----------
    def({
      id: 'finance.transaction.create',
      agent: 'finance',
      kind: 'write',
      exposure: ['chat', 'ui'],
      timeoutMs: 4000,
      title: 'Registrar transação',
      slots: [{ name: 'type', required: true, prompt: 'É um gasto ou uma receita?' }, { name: 'description', required: true, prompt: 'Qual é a descrição?' }, { name: 'amount', required: true, prompt: 'Qual é o valor?' }, { name: 'payer', required: true, prompt: 'Quem pagou?' }],
      chipsFor(slotName, workspace) {
        if (!workspace) return null;
        if (slotName === 'payer') return workspace.participants.filter((p) => p.active).map((p) => p.name);
        if (slotName === 'category') return (root.PlannerCore ? root.PlannerCore.CATEGORIES : []).slice();
        return null;
      },
      validate(input) {
        const i = input || {};
        const fields = [];
        const type = i.type === 'income' ? 'income' : (i.type === 'expense' ? 'expense' : null);
        if (!type) fields.push(Kit.fieldError('type', 'Informe se é gasto ou receita.'));
        const desc = Kit.validateText(i.description, 'description', 'a descrição', { max: 100 });
        if (!desc.ok) fields.push(...desc.fields);
        const amount = Kit.validateMoney(i.amount, 'amount', { required: true });
        if (!amount.ok) fields.push(...amount.fields);
        let date = '';
        if (i.date != null && i.date !== '') {
          const d = Kit.validateDate(i.date, 'date');
          if (!d.ok) fields.push(...d.fields); else date = d.value;
        }
        if (fields.length) return Kit.invalid(fields);
        const value = {
          type,
          description: desc.value,
          amount: amount.value,
          date,
          category: i.category != null ? String(i.category) : null,
          notes: i.notes != null ? String(i.notes) : '',
          recurring: Boolean(i.recurring),
        };
        if (i.paidById != null) value.paidById = String(i.paidById);
        if (i.payer != null) value.payer = i.payer;
        if (Array.isArray(i.splitBetweenIds)) value.splitBetweenIds = i.splitBetweenIds;
        if (i.splitWith != null) value.splitWith = i.splitWith;
        if (i.tripId != null) value.tripId = String(i.tripId);
        if (i.tripRef != null) value.tripRef = i.tripRef;
        return Kit.ok(value);
      },
      async run(value, ctx) {
        const ws = ctx.getWorkspace();
        const Core = ctx.core;
        const payer = resolvePayer(ws, value);
        if (payer.fields) throw invalidInput(payer.fields);
        const split = resolveSplit(ws, value);
        if (split.fields) throw invalidInput(split.fields);
        // trip
        let tripId = null;
        if (value.tripId) {
          if (!ws.trips.some((t) => t.id === value.tripId)) throw invalidInput([Kit.fieldError('tripId', 'Viagem não encontrada.')]);
          tripId = value.tripId;
        } else if (value.tripRef != null && value.tripRef !== '') {
          const r = Kit.resolveTrip(ws, value.tripRef);
          if (!r.ok) throw invalidInput(r.fields);
          tripId = r.value.id;
        }
        const activeIds = ws.participants.filter((p) => p.active).map((p) => p.id);
        let splitBetweenIds = split.ids;
        if (value.type === 'expense') {
          if (!split.provided) {
            if (ctx.source === 'chat') {
              // chat: divide com todos os ativos quando há participantes.
              splitBetweenIds = activeIds;
            } else if (activeIds.length) {
              // ui: regra do formulário — exige ao menos um selecionado.
              throw invalidInput([Kit.fieldError('splitBetweenIds', 'Selecione ao menos um participante para esta despesa.')]);
            }
          }
        } else {
          splitBetweenIds = [];
        }
        const financeId = Core.id('finance');
        const date = value.date || Kit.today(ctx.now());
        const category = Core.CATEGORIES.includes(value.category) ? value.category : 'outros';
        const finance = {
          id: financeId,
          type: value.type,
          description: value.description,
          amount: value.amount,
          date,
          category,
          paidById: payer.id,
          splitBetweenIds,
          tripId,
          notes: value.notes || '',
          recurring: value.recurring,
          recurringSourceId: null,
          recurrenceSeriesId: value.recurring ? financeId : null,
          occurrenceMonth: null,
          recurrenceSkippedMonths: [],
          createdAt: new Date().toISOString(),
        };
        const after = await ctx.commit((draft) => {
          draft.finances.push(finance);
          if (finance.recurring) {
            return Core.materializeRecurring(draft, Kit.currentMonth(ctx.now())).workspace;
          }
          return draft;
        }, { source: ctx.source, message: 'Transação adicionada' });
        const created = after.finances.find((f) => f.id === financeId) || null;
        return Kit.receipt({
          entity: 'finance', collection: 'finances', action: 'create', id: financeId,
          before: null, after: cloneOr(created),
          message: `${value.type === 'income' ? 'Receita' : 'Gasto'} “${value.description}” de ${Kit.formatMoney(value.amount)} registrado.`,
        });
      },
    });

    // ---------- finance.transaction.update (write, ui) ----------
    def({
      id: 'finance.transaction.update',
      agent: 'finance',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 4000,
      title: 'Editar transação',
      validate(input) {
        const i = input || {};
        const fields = [];
        const idCheck = Kit.validateId(i.id, 'id', 'a transação');
        if (!idCheck.ok) fields.push(...idCheck.fields);
        const type = i.type === 'income' ? 'income' : (i.type === 'expense' ? 'expense' : null);
        if (!type) fields.push(Kit.fieldError('type', 'Informe se é gasto ou receita.'));
        const desc = Kit.validateText(i.description, 'description', 'a descrição', { max: 100 });
        if (!desc.ok) fields.push(...desc.fields);
        const amount = Kit.validateMoney(i.amount, 'amount', { required: true });
        if (!amount.ok) fields.push(...amount.fields);
        const date = Kit.validateDate(i.date, 'date');
        if (!date.ok) fields.push(...date.fields);
        if (fields.length) return Kit.invalid(fields);
        const value = {
          id: String(i.id),
          type, description: desc.value, amount: amount.value, date: date.value,
          category: i.category != null ? String(i.category) : 'outros',
          paidById: i.paidById != null && i.paidById !== '' ? String(i.paidById) : null,
          splitBetweenIds: Array.isArray(i.splitBetweenIds) ? i.splitBetweenIds.map(String) : [],
          tripId: i.tripId != null && i.tripId !== '' ? String(i.tripId) : null,
          notes: i.notes != null ? String(i.notes) : '',
          recurring: Boolean(i.recurring),
        };
        return Kit.ok(value);
      },
      async run(value, ctx) {
        const ws = ctx.getWorkspace();
        const Core = ctx.core;
        const existing = ws.finances.find((f) => f.id === value.id);
        if (!existing) throw entityConflict('Esta transação foi removida em outra aba.');
        const before = cloneOr(existing);
        if (value.type === 'expense' && ws.participants.some((p) => p.active) && !value.splitBetweenIds.length) {
          throw invalidInput([Kit.fieldError('splitBetweenIds', 'Selecione ao menos um participante para esta despesa.')]);
        }
        const isOccurrence = Boolean(existing.recurringSourceId);
        const recurring = isOccurrence ? false : value.recurring;
        const splitBetweenIds = value.type === 'expense'
          ? value.splitBetweenIds.filter((id) => ws.participants.some((p) => p.id === id))
          : [];
        const finance = {
          id: value.id,
          type: value.type,
          description: value.description,
          amount: value.amount,
          date: value.date,
          category: Core.CATEGORIES.includes(value.category) ? value.category : 'outros',
          paidById: value.paidById && ws.participants.some((p) => p.id === value.paidById) ? value.paidById : null,
          splitBetweenIds,
          tripId: value.tripId && ws.trips.some((t) => t.id === value.tripId) ? value.tripId : null,
          notes: value.notes,
          recurring,
          recurringSourceId: existing.recurringSourceId || null,
          recurrenceSeriesId: isOccurrence
            ? (existing.recurrenceSeriesId || existing.recurringSourceId)
            : (recurring ? (existing.recurrenceSeriesId || value.id) : null),
          occurrenceMonth: existing.occurrenceMonth || null,
          recurrenceSkippedMonths: recurring ? (existing.recurrenceSkippedMonths || []) : [],
          createdAt: existing.createdAt || new Date().toISOString(),
        };
        const after = await ctx.commit((draft) => {
          const index = draft.finances.findIndex((f) => f.id === finance.id);
          if (index < 0) throw entityConflict('Esta transação foi removida em outra aba.');
          if (draft.finances[index].recurring && !finance.recurring && !draft.finances[index].recurringSourceId) {
            draft.finances.forEach((item) => {
              if (item.recurringSourceId !== finance.id) return;
              item.recurringSourceId = null;
              item.recurrenceSeriesId = null;
              item.occurrenceMonth = null;
              item.recurrenceSkippedMonths = [];
            });
          }
          draft.finances[index] = finance;
          if (finance.recurring) {
            return Core.materializeRecurring(draft, Kit.currentMonth(ctx.now())).workspace;
          }
          return draft;
        }, { source: ctx.source, message: 'Transação atualizada' });
        const updated = after.finances.find((f) => f.id === value.id) || null;
        return Kit.receipt({
          entity: 'finance', collection: 'finances', action: 'update', id: value.id,
          before: before, after: cloneOr(updated), message: 'Transação atualizada.',
        });
      },
    });

    // ---------- finance.transaction.delete (write, ui) ----------
    def({
      id: 'finance.transaction.delete',
      agent: 'finance',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 4000,
      title: 'Excluir transação',
      validate(input) {
        return Kit.validateId(input && input.id, 'id', 'a transação');
      },
      async run(id, ctx) {
        const ws = ctx.getWorkspace();
        const Core = ctx.core;
        const current = ws.finances.find((f) => f.id === id);
        const before = cloneOr(current);
        const after = await ctx.commit((draft) => {
          if (!draft.finances.some((f) => f.id === id)) throw entityConflict('Esta transação foi removida em outra aba.');
          return Core.removeFinance(draft, id).workspace;
        }, { source: ctx.source, message: 'Transação excluída' });
        return Kit.receipt({
          entity: 'finance', collection: 'finances', action: 'delete', id: id,
          before: before, after: null, message: 'Transação excluída.',
        });
      },
    });

    // ---------- finance.budget.set (write) ----------
    def({
      id: 'finance.budget.set',
      agent: 'finance',
      kind: 'write',
      exposure: ['chat', 'ui'],
      timeoutMs: 3000,
      title: 'Definir orçamento',
      slots: [{ name: 'category', required: true, prompt: 'Qual categoria?' }, { name: 'amount', required: true, prompt: 'Qual é o limite?' }],
      chipsFor(slotName) {
        if (slotName === 'category') return (root.PlannerCore ? root.PlannerCore.CATEGORIES : []).slice();
        return null;
      },
      validate(input) {
        const i = input || {};
        const fields = [];
        const Core = root.PlannerCore;
        const category = String(i.category || '');
        if (!Core || !Core.CATEGORIES.includes(category)) fields.push(Kit.fieldError('category', 'Categoria inválida.'));
        const amount = Kit.validateMoney(i.amount, 'amount', { required: true });
        if (!amount.ok) fields.push(...amount.fields);
        if (fields.length) return Kit.invalid(fields);
        return Kit.ok({ category, amount: amount.value });
      },
      async run(value, ctx) {
        const ws = ctx.getWorkspace();
        const before = ws.budgets[value.category] != null ? ws.budgets[value.category] : null;
        const after = await ctx.commit((draft) => { draft.budgets[value.category] = value.amount; }, {
          source: ctx.source, message: 'Limite mensal salvo',
        });
        return Kit.receipt({
          entity: 'budget', collection: 'budgets', action: 'set', id: value.category,
          before: before, after: after.budgets[value.category], message: `Orçamento de ${value.category} definido em ${Kit.formatMoney(value.amount)}.`,
        });
      },
    });

    // ---------- finance.budget.delete (write, ui) ----------
    def({
      id: 'finance.budget.delete',
      agent: 'finance',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 3000,
      title: 'Remover orçamento',
      validate(input) {
        return Kit.validateId(input && input.category, 'category', 'a categoria');
      },
      async run(category, ctx) {
        const ws = ctx.getWorkspace();
        const before = ws.budgets[category] != null ? ws.budgets[category] : null;
        await ctx.commit((draft) => { delete draft.budgets[category]; }, { source: ctx.source, message: 'Limite removido' });
        return Kit.receipt({
          entity: 'budget', collection: 'budgets', action: 'delete', id: category,
          before: before, after: null, message: 'Limite removido.',
        });
      },
    });

    // ---------- finance.goal.create (write) ----------
    def({
      id: 'finance.goal.create',
      agent: 'finance',
      kind: 'write',
      exposure: ['chat', 'ui'],
      timeoutMs: 3000,
      title: 'Criar meta',
      slots: [{ name: 'title', required: true, prompt: 'Qual é o objetivo?' }, { name: 'target', required: true, prompt: 'Qual é o valor alvo?' }],
      validate(input) {
        const i = input || {};
        const fields = [];
        const title = Kit.validateText(i.title, 'title', 'o título', { max: 80 });
        if (!title.ok) fields.push(...title.fields);
        const target = Kit.validateMoney(i.target, 'target', { required: true });
        if (!target.ok) fields.push(...target.fields);
        const current = Kit.validateMoney(i.current, 'current', { optional: true });
        if (!current.ok) fields.push(...current.fields);
        const deadline = Kit.validateDate(i.deadline, 'deadline', { optional: true });
        if (!deadline.ok) fields.push(...deadline.fields);
        const description = Kit.validateText(i.description, 'description', 'descrição', { max: 300, optional: true });
        if (!description.ok) fields.push(...description.fields);
        const emoji = Kit.validateText(i.emoji, 'emoji', 'emoji', { max: 8, optional: true });
        if (!emoji.ok) fields.push(...emoji.fields);
        if (fields.length) return Kit.invalid(fields);
        return Kit.ok({
          title: title.value, target: target.value, current: current.value,
          deadline: deadline.value, description: description.value, emoji: emoji.value || '🎯',
        });
      },
      async run(value, ctx) {
        const Core = ctx.core;
        const goal = {
          id: Core.id('goal'), title: value.title, emoji: value.emoji,
          target: value.target, current: value.current, deadline: value.deadline,
          description: value.description, createdAt: new Date().toISOString(),
        };
        const after = await ctx.commit((draft) => { draft.goals.push(goal); }, { source: ctx.source, message: 'Meta criada' });
        const created = after.goals.find((g) => g.id === goal.id) || null;
        return Kit.receipt({
          entity: 'goal', collection: 'goals', action: 'create', id: goal.id,
          before: null, after: cloneOr(created), message: `Meta “${value.title}” criada.`,
        });
      },
    });

    // ---------- finance.goal.update (write, ui) ----------
    def({
      id: 'finance.goal.update',
      agent: 'finance',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 3000,
      title: 'Editar meta',
      validate(input) {
        const i = input || {};
        const fields = [];
        const idCheck = Kit.validateId(i.id, 'id', 'a meta');
        if (!idCheck.ok) fields.push(...idCheck.fields);
        const title = Kit.validateText(i.title, 'title', 'o título', { max: 80 });
        if (!title.ok) fields.push(...title.fields);
        const target = Kit.validateMoney(i.target, 'target', { required: true });
        if (!target.ok) fields.push(...target.fields);
        const current = Kit.validateMoney(i.current, 'current', { optional: true });
        if (!current.ok) fields.push(...current.fields);
        const deadline = Kit.validateDate(i.deadline, 'deadline', { optional: true });
        if (!deadline.ok) fields.push(...deadline.fields);
        if (fields.length) return Kit.invalid(fields);
        return Kit.ok({
          id: String(i.id), title: title.value, target: target.value, current: current.value,
          deadline: deadline.value, description: i.description != null ? String(i.description) : '',
          emoji: i.emoji != null && String(i.emoji).trim() ? String(i.emoji).trim() : '🎯',
        });
      },
      async run(value, ctx) {
        const ws = ctx.getWorkspace();
        const existing = ws.goals.find((g) => g.id === value.id);
        if (!existing) throw entityConflict('Esta meta foi removida em outra aba.');
        const before = cloneOr(existing);
        const after = await ctx.commit((draft) => {
          const index = draft.goals.findIndex((g) => g.id === value.id);
          if (index < 0) throw entityConflict('Esta meta foi removida em outra aba.');
          draft.goals[index] = {
            id: value.id, title: value.title, emoji: value.emoji, target: value.target,
            current: value.current, deadline: value.deadline, description: value.description,
            createdAt: existing.createdAt || new Date().toISOString(),
          };
        }, { source: ctx.source, message: 'Meta atualizada' });
        const updated = after.goals.find((g) => g.id === value.id) || null;
        return Kit.receipt({
          entity: 'goal', collection: 'goals', action: 'update', id: value.id,
          before: before, after: cloneOr(updated), message: 'Meta atualizada.',
        });
      },
    });

    // ---------- finance.goal.fund (write) ----------
    def({
      id: 'finance.goal.fund',
      agent: 'finance',
      kind: 'write',
      exposure: ['chat', 'ui'],
      timeoutMs: 3000,
      title: 'Adicionar valor à meta',
      slots: [{ name: 'goalRef', required: true, prompt: 'Qual meta?' }, { name: 'amount', required: true, prompt: 'Quanto adicionar?' }],
      validate(input) {
        const i = input || {};
        const fields = [];
        const ref = i.id != null && String(i.id).trim() ? i.id : i.goalRef;
        if (ref == null || !String(ref).trim()) fields.push(Kit.fieldError('goalRef', 'Informe a meta.'));
        const amount = Kit.validateMoney(i.amount, 'amount', { required: true });
        if (!amount.ok) fields.push(...amount.fields);
        if (fields.length) return Kit.invalid(fields);
        return Kit.ok({ ref: String(ref), amount: amount.value });
      },
      async run(value, ctx) {
        const ws = ctx.getWorkspace();
        const resolved = Kit.resolveGoal(ws, value.ref);
        if (!resolved.ok) throw invalidInput(resolved.fields);
        const goalId = resolved.value.id;
        const before = cloneOr(resolved.value);
        const after = await ctx.commit((draft) => {
          const goal = draft.goals.find((g) => g.id === goalId);
          if (!goal) throw entityConflict('Esta meta foi removida em outra aba.');
          const nextCents = Math.round(goal.current * 100) + Math.round(value.amount * 100);
          const clampedCents = Math.min(nextCents, Kit.MAX_AMOUNT * 100);
          goal.current = clampedCents / 100;
        }, { source: ctx.source, message: 'Valor adicionado à meta' });
        const updated = after.goals.find((g) => g.id === goalId) || null;
        return Kit.receipt({
          entity: 'goal', collection: 'goals', action: 'fund', id: goalId,
          before: before, after: cloneOr(updated), message: `${Kit.formatMoney(value.amount)} adicionados à meta.`,
        });
      },
    });

    // ---------- finance.goal.delete (write, ui) ----------
    def({
      id: 'finance.goal.delete',
      agent: 'finance',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 3000,
      title: 'Excluir meta',
      validate(input) {
        return Kit.validateId(input && input.id, 'id', 'a meta');
      },
      async run(id, ctx) {
        const ws = ctx.getWorkspace();
        const current = ws.goals.find((g) => g.id === id);
        const before = cloneOr(current);
        await ctx.commit((draft) => {
          if (!draft.goals.some((g) => g.id === id)) throw entityConflict('Esta meta foi removida em outra aba.');
          draft.goals = draft.goals.filter((g) => g.id !== id);
        }, { source: ctx.source, message: 'Meta excluída' });
        return Kit.receipt({
          entity: 'goal', collection: 'goals', action: 'delete', id: id,
          before: before, after: null, message: 'Meta excluída.',
        });
      },
    });

    // ---------- finance.goal.list (read, chat+ui) ----------
    def({
      id: 'finance.goal.list',
      agent: 'finance',
      kind: 'read',
      exposure: ['chat', 'ui'],
      timeoutMs: 1500,
      title: 'Listar metas',
      validate(input) {
        const i = input || {};
        const status = i.status != null && i.status !== '' ? String(i.status) : 'all';
        if (!['all', 'active', 'reached'].includes(status)) {
          return Kit.invalid(Kit.fieldError('status', 'Status inválido. Use all, active ou reached.'));
        }
        return Kit.ok({ status });
      },
      run(value, ctx) {
        const ws = ctx.getWorkspace();
        return ws.goals
          .map((goal) => {
            const targetCents = Math.round(goal.target * 100);
            const currentCents = Math.round(goal.current * 100);
            const reached = currentCents >= targetCents && targetCents > 0;
            const remaining = Math.max(0, (targetCents - currentCents)) / 100;
            const percent = targetCents > 0 ? Math.min(100, Math.round((currentCents / targetCents) * 100)) : 0;
            return {
              id: goal.id, title: goal.title, emoji: goal.emoji,
              target: goal.target, current: goal.current,
              percent, remaining, deadline: goal.deadline || '', reached,
            };
          })
          .filter((goal) => value.status === 'all'
            || (value.status === 'active' && !goal.reached)
            || (value.status === 'reached' && goal.reached))
          .sort((a, b) => {
            const da = a.deadline || '';
            const db = b.deadline || '';
            if (da && db && da !== db) return da < db ? -1 : 1;
            if (da && !db) return -1;
            if (!da && db) return 1;
            return a.title.localeCompare(b.title, 'pt-BR');
          });
      },
    });
    // ---------- finance.summary (read) ----------
    def({
      id: 'finance.summary',
      agent: 'finance',
      kind: 'read',
      exposure: ['chat', 'ui'],
      timeoutMs: 1500,
      title: 'Resumo financeiro',
      validate(input) {
        const i = input || {};
        if (i.month != null && i.month !== '') {
          const m = Kit.validateMonth(i.month, 'month');
          if (!m.ok) return m;
          return Kit.ok({ month: m.value });
        }
        return Kit.ok({ month: null });
      },
      run(value, ctx) {
        const ws = ctx.getWorkspace();
        const month = value.month || Kit.currentMonth(ctx.now());
        const monthFinances = ws.finances.filter((f) => monthMatch(f.date, month));
        let income = 0;
        let expense = 0;
        const byCategory = {};
        monthFinances.forEach((f) => {
          if (f.type === 'income') income += f.amount;
          else {
            expense += f.amount;
            byCategory[f.category] = (byCategory[f.category] || 0) + f.amount;
          }
        });
        const budgets = Object.entries(ws.budgets).map(([category, limit]) => {
          const spent = byCategory[category] || 0;
          return { category, limit, spent, remaining: limit - spent };
        });
        return {
          month,
          income: Math.round(income * 100) / 100,
          expense: Math.round(expense * 100) / 100,
          balance: Math.round((income - expense) * 100) / 100,
          byCategory,
          budgets,
        };
      },
    });

    // ---------- finance.settlements (read) ----------
    def({
      id: 'finance.settlements',
      agent: 'finance',
      kind: 'read',
      exposure: ['chat', 'ui'],
      timeoutMs: 1500,
      title: 'Acertos entre participantes',
      validate(input) {
        const i = input || {};
        if (i.month != null && i.month !== '') {
          const m = Kit.validateMonth(i.month, 'month');
          if (!m.ok) return m;
          return Kit.ok({ month: m.value });
        }
        return Kit.ok({ month: null });
      },
      run(value, ctx) {
        const ws = ctx.getWorkspace();
        const Core = ctx.core;
        const nameOf = (pid) => {
          const p = ws.participants.find((item) => item.id === pid);
          return p ? p.name : 'Não atribuído';
        };
        const result = Core.calculateSettlements(ws.finances, ws.participants, value.month ? { month: value.month } : {});
        return {
          month: value.month || null,
          transfers: result.transfers.map((t) => ({ from: nameOf(t.fromId), to: nameOf(t.toId), amount: t.amount })),
          balances: result.balances.map((b) => ({ participant: nameOf(b.participantId), amount: b.amount })),
        };
      },
    });

    // ---------- finance.report (read) ----------
    def({
      id: 'finance.report',
      agent: 'finance',
      kind: 'read',
      exposure: ['chat', 'ui'],
      timeoutMs: 1500,
      title: 'Relatório financeiro',
      validate(input) {
        const i = input || {};
        const fields = [];
        let month = null;
        if (i.month != null && i.month !== '') {
          const m = Kit.validateMonth(i.month, 'month');
          if (!m.ok) fields.push(...m.fields); else month = m.value;
        }
        let months = 6;
        if (i.months != null && i.months !== '') {
          months = Number(i.months);
          if (!Number.isInteger(months) || months < 1 || months > 12) fields.push(Kit.fieldError('months', 'Escolha entre 1 e 12 meses.'));
        }
        if (fields.length) return Kit.invalid(fields);
        return Kit.ok({ month, months });
      },
      run(value, ctx) {
        const ws = ctx.getWorkspace();
        const baseMonth = value.month || Kit.currentMonth(ctx.now());
        const [by, bm] = baseMonth.split('-').map(Number);
        const series = [];
        for (let offset = value.months - 1; offset >= 0; offset -= 1) {
          const d = new Date(by, bm - 1 - offset, 1);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          const monthFinances = ws.finances.filter((f) => monthMatch(f.date, key));
          const income = monthFinances.filter((f) => f.type === 'income').reduce((s, f) => s + f.amount, 0);
          const expense = monthFinances.filter((f) => f.type === 'expense').reduce((s, f) => s + f.amount, 0);
          series.push({ month: key, income: Math.round(income * 100) / 100, expense: Math.round(expense * 100) / 100 });
        }
        const months = new Set(series.map((s) => s.month));
        const byCategory = {};
        ws.finances.forEach((f) => {
          if (f.type !== 'expense' || !months.has(f.date.slice(0, 7))) return;
          byCategory[f.category] = (byCategory[f.category] || 0) + f.amount;
        });
        const topCategories = Object.entries(byCategory)
          .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 5);
        return { baseMonth, months: value.months, series, topCategories };
      },
    });

    // ---------- finance.recurring.materialize (write, ui) ----------
    def({
      id: 'finance.recurring.materialize',
      agent: 'finance',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 4000,
      title: 'Materializar recorrências',
      validate(input) {
        const i = input || {};
        if (i.throughMonth != null && i.throughMonth !== '') {
          const m = Kit.validateMonth(i.throughMonth, 'throughMonth');
          if (!m.ok) return m;
          return Kit.ok({ throughMonth: m.value });
        }
        return Kit.ok({ throughMonth: null });
      },
      async run(value, ctx) {
        const Core = ctx.core;
        const month = value.throughMonth || Kit.currentMonth(ctx.now());
        const before = ctx.getWorkspace();
        const beforeCount = before.finances.length;
        const after = await ctx.commit((draft) => Core.materializeRecurring(draft, month).workspace, {
          source: ctx.source, message: 'Recorrências atualizadas',
        });
        const added = after.finances.length - beforeCount;
        return Kit.receipt({
          entity: 'recurring', collection: 'finances', action: 'update', id: month,
          before: null, after: null, message: `${added} ${added === 1 ? 'ocorrência gerada' : 'ocorrências geradas'}.`,
        });
      },
    });

    // ---------- finance.report.csv (read, ui) ----------
    def({
      id: 'finance.report.csv',
      agent: 'finance',
      kind: 'read',
      exposure: ['ui'],
      timeoutMs: 2000,
      title: 'Exportar CSV',
      validate(input) {
        const i = input || {};
        const value = {};
        if (i.month != null && i.month !== '') {
          const m = Kit.validateMonth(i.month, 'month');
          if (!m.ok) return m;
          value.month = m.value;
        }
        if (Array.isArray(i.financeIds)) value.financeIds = i.financeIds.map(String);
        return Kit.ok(value);
      },
      run(value, ctx) {
        const ws = ctx.getWorkspace();
        const CATEGORY_LABELS = {
          alimentacao: 'Alimentação', transporte: 'Transporte', moradia: 'Moradia', lazer: 'Lazer',
          saude: 'Saúde', viagem: 'Viagem', educacao: 'Educação', vestuario: 'Vestuário',
          salario: 'Salário', investimento: 'Investimento', outros: 'Outros',
        };
        const nameOf = (pid) => {
          const p = ws.participants.find((item) => item.id === pid);
          return p ? p.name : 'Não atribuído';
        };
        let finances = ws.finances;
        if (value.financeIds) {
          const wanted = new Set(value.financeIds);
          finances = finances.filter((f) => wanted.has(f.id));
        } else if (value.month) {
          finances = finances.filter((f) => monthMatch(f.date, value.month));
        }
        const csvCell = (val) => {
          const source = String(val == null ? '' : val);
          const neutralized = /^[=+\-@]/.test(source.trimStart()) ? `'${source}` : source;
          return `"${neutralized.replace(/"/g, '""')}"`;
        };
        const headers = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Participante', 'Valor', 'Dividido entre', 'Viagem', 'Observações'];
        const rows = finances.map((finance) => {
          const trip = ws.trips.find((t) => t.id === finance.tripId);
          return [
            finance.date,
            finance.type === 'income' ? 'Receita' : 'Despesa',
            finance.description,
            CATEGORY_LABELS[finance.category] || 'Outros',
            nameOf(finance.paidById),
            finance.amount.toFixed(2).replace('.', ','),
            finance.splitBetweenIds.map(nameOf).join(' | '),
            trip ? trip.destination : '',
            finance.notes,
          ];
        });
        const csv = [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
        return { csv: `\ufeff${csv}`, count: rows.length };
      },
    });

    return ids;
  }

  const IDS = [
    'finance.transaction.create', 'finance.transaction.update', 'finance.transaction.delete',
    'finance.budget.set', 'finance.budget.delete',
    'finance.goal.create', 'finance.goal.update', 'finance.goal.fund', 'finance.goal.delete',
    'finance.goal.list',
    'finance.summary', 'finance.settlements', 'finance.report',
    'finance.recurring.materialize', 'finance.report.csv',
  ];

  return Object.freeze({ register, ids: Object.freeze(IDS) });
});
