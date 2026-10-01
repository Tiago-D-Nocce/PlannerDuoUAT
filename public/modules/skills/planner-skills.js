/* PlannerDuo — skills do Agente de Planejamento (checklist, decisões, participantes e workspace). */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerPlanningSkills = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const Kit = (root && root.PlannerSkillKit) || (typeof require === 'function' ? require('./skill-kit.js') : null);

  function cloneOr(value) {
    return value == null ? null : Kit.deepClone(value);
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

  function register(runtime) {
    const ids = [];
    function def(definition) {
      runtime.define(definition);
      ids.push(definition.id);
    }

    // ---------- planner.checklist.add (write) ----------
    def({
      id: 'planner.checklist.add',
      agent: 'planner',
      kind: 'write',
      exposure: ['chat', 'ui'],
      timeoutMs: 3000,
      title: 'Adicionar item ao checklist',
      slots: [{ name: 'text', required: true, prompt: 'O que adicionar ao checklist?' }],
      validate(input) {
        const i = input || {};
        const fields = [];
        const text = Kit.validateText(i.text, 'text', 'o item', { max: 120 });
        if (!text.ok) fields.push(...text.fields);
        if (fields.length) return Kit.invalid(fields);
        const value = { text: text.value, category: i.category != null ? String(i.category) : 'outros' };
        if (i.tripId != null) value.tripId = String(i.tripId);
        if (i.tripRef != null) value.tripRef = i.tripRef;
        return Kit.ok(value);
      },
      async run(value, ctx) {
        const Core = ctx.core;
        const ws = ctx.getWorkspace();
        let tripId = null;
        if (value.tripId) {
          if (!ws.trips.some((t) => t.id === value.tripId)) throw invalidInput([Kit.fieldError('tripId', 'Viagem não encontrada.')]);
          tripId = value.tripId;
        } else if (value.tripRef != null && value.tripRef !== '') {
          const r = Kit.resolveTrip(ws, value.tripRef);
          if (!r.ok) throw invalidInput(r.fields);
          tripId = r.value.id;
        }
        const item = {
          id: Core.id('check'), text: value.text, category: value.category || 'outros',
          done: false, tripId, createdAt: new Date().toISOString(),
        };
        const after = await ctx.commit((draft) => { draft.checklist.push(item); }, { source: ctx.source, message: 'Item adicionado' });
        const created = after.checklist.find((c) => c.id === item.id) || null;
        return Kit.receipt({
          entity: 'checklist', collection: 'checklist', action: 'create', id: item.id,
          before: null, after: cloneOr(created), message: `Item “${value.text}” adicionado.`,
        });
      },
    });

    // ---------- planner.checklist.update (write, ui) ----------
    def({
      id: 'planner.checklist.update',
      agent: 'planner',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 3000,
      title: 'Editar item do checklist',
      validate(input) {
        const i = input || {};
        const fields = [];
        const idCheck = Kit.validateId(i.id, 'id', 'o item');
        if (!idCheck.ok) fields.push(...idCheck.fields);
        const text = Kit.validateText(i.text, 'text', 'o item', { max: 120 });
        if (!text.ok) fields.push(...text.fields);
        if (fields.length) return Kit.invalid(fields);
        return Kit.ok({
          id: String(i.id), text: text.value,
          category: i.category != null ? String(i.category) : 'outros',
          tripId: i.tripId != null && i.tripId !== '' ? String(i.tripId) : null,
        });
      },
      async run(value, ctx) {
        const ws = ctx.getWorkspace();
        const existing = ws.checklist.find((c) => c.id === value.id);
        if (!existing) throw entityConflict('Este item foi removido em outra aba.');
        const before = cloneOr(existing);
        const after = await ctx.commit((draft) => {
          const item = draft.checklist.find((c) => c.id === value.id);
          if (!item) throw entityConflict('Este item foi removido em outra aba.');
          item.text = value.text;
          item.category = value.category || 'outros';
          item.tripId = value.tripId && draft.trips.some((t) => t.id === value.tripId) ? value.tripId : null;
        }, { source: ctx.source, message: 'Item atualizado' });
        const updated = after.checklist.find((c) => c.id === value.id) || null;
        return Kit.receipt({
          entity: 'checklist', collection: 'checklist', action: 'update', id: value.id,
          before: before, after: cloneOr(updated), message: 'Item atualizado.',
        });
      },
    });

    // ---------- planner.checklist.toggle (write) ----------
    def({
      id: 'planner.checklist.toggle',
      agent: 'planner',
      kind: 'write',
      exposure: ['chat', 'ui'],
      timeoutMs: 3000,
      title: 'Marcar/desmarcar item',
      slots: [{ name: 'itemRef', required: true, prompt: 'Qual item?' }],
      validate(input) {
        const i = input || {};
        const ref = i.id != null && String(i.id).trim() ? i.id : i.itemRef;
        if (ref == null || !String(ref).trim()) return Kit.invalid(Kit.fieldError('itemRef', 'Informe o item.'));
        const value = { ref: String(ref) };
        if (i.done != null) value.done = Boolean(i.done);
        return Kit.ok(value);
      },
      async run(value, ctx) {
        const ws = ctx.getWorkspace();
        const resolved = Kit.resolveChecklistItem(ws, value.ref);
        if (!resolved.ok) throw invalidInput(resolved.fields);
        const itemId = resolved.value.id;
        const before = cloneOr(resolved.value);
        const after = await ctx.commit((draft) => {
          const item = draft.checklist.find((c) => c.id === itemId);
          if (!item) throw entityConflict('Este item foi removido em outra aba.');
          item.done = value.done != null ? value.done : !item.done;
        }, { source: ctx.source, message: 'Checklist atualizado' });
        const updated = after.checklist.find((c) => c.id === itemId) || null;
        return Kit.receipt({
          entity: 'checklist', collection: 'checklist', action: 'toggle', id: itemId,
          before: before, after: cloneOr(updated),
          message: updated && updated.done ? 'Item concluído.' : 'Item reaberto.',
        });
      },
    });

    // ---------- planner.checklist.list (read) ----------
    def({
      id: 'planner.checklist.list',
      agent: 'planner',
      kind: 'read',
      exposure: ['chat', 'ui'],
      timeoutMs: 1000,
      title: 'Listar checklist',
      validate(input) {
        const i = input || {};
        const filter = i.filter || 'all';
        if (!['all', 'pending', 'done'].includes(filter)) return Kit.invalid(Kit.fieldError('filter', 'Filtro inválido.'));
        const value = { filter };
        if (i.tripRef != null && i.tripRef !== '') value.tripRef = i.tripRef;
        return Kit.ok(value);
      },
      run(value, ctx) {
        const ws = ctx.getWorkspace();
        let tripId = null;
        if (value.tripRef != null) {
          const r = Kit.resolveTrip(ws, value.tripRef);
          if (!r.ok) throw invalidInput(r.fields);
          tripId = r.value.id;
        }
        return ws.checklist
          .filter((item) => value.filter === 'all'
            || (value.filter === 'pending' && !item.done)
            || (value.filter === 'done' && item.done))
          .filter((item) => tripId == null || item.tripId === tripId)
          .map((item) => ({ id: item.id, text: item.text, category: item.category, done: item.done, tripId: item.tripId }));
      },
    });

    // ---------- planner.checklist.delete (write, ui) ----------
    def({
      id: 'planner.checklist.delete',
      agent: 'planner',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 3000,
      title: 'Excluir item do checklist',
      validate(input) {
        return Kit.validateId(input && input.id, 'id', 'o item');
      },
      async run(id, ctx) {
        const ws = ctx.getWorkspace();
        const current = ws.checklist.find((c) => c.id === id);
        const before = cloneOr(current);
        await ctx.commit((draft) => {
          if (!draft.checklist.some((c) => c.id === id)) throw entityConflict('Este item foi removido em outra aba.');
          draft.checklist = draft.checklist.filter((c) => c.id !== id);
        }, { source: ctx.source, message: 'Item removido' });
        return Kit.receipt({
          entity: 'checklist', collection: 'checklist', action: 'delete', id: id,
          before: before, after: null, message: 'Item removido.',
        });
      },
    });

    // ---------- planner.decision.create (write) ----------
    def({
      id: 'planner.decision.create',
      agent: 'planner',
      kind: 'write',
      exposure: ['chat', 'ui'],
      timeoutMs: 3000,
      title: 'Criar decisão',
      slots: [{ name: 'title', required: true, prompt: 'O que precisa ser decidido?' }],
      validate(input) {
        const i = input || {};
        const fields = [];
        const title = Kit.validateText(i.title, 'title', 'o título', { max: 120 });
        if (!title.ok) fields.push(...title.fields);
        let options = [];
        if (!Array.isArray(i.options)) {
          fields.push(Kit.fieldError('options', 'Informe as opções da decisão.'));
        } else {
          const seen = new Set();
          options = i.options.map((o) => String(o == null ? '' : o).trim()).filter((o) => {
            const key = Kit.normalizeKey(o);
            if (!o || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          if (options.length < 2) fields.push(Kit.fieldError('options', 'Informe pelo menos duas opções diferentes.'));
          if (options.length > 12) fields.push(Kit.fieldError('options', 'Use no máximo 12 opções.'));
        }
        if (fields.length) return Kit.invalid(fields);
        return Kit.ok({
          title: title.value, options,
          description: i.description != null ? String(i.description).trim() : '',
        });
      },
      async run(value, ctx) {
        const Core = ctx.core;
        const decision = {
          id: Core.id('decision'), title: value.title, description: value.description, status: 'open',
          options: value.options.map((label) => ({ id: Core.id('option'), label, voterIds: [] })),
          createdAt: new Date().toISOString(), closedAt: null,
        };
        const after = await ctx.commit((draft) => { draft.decisions.unshift(decision); }, { source: ctx.source, message: 'Decisão criada' });
        const created = after.decisions.find((d) => d.id === decision.id) || null;
        return Kit.receipt({
          entity: 'decision', collection: 'decisions', action: 'create', id: decision.id,
          before: null, after: cloneOr(created), message: `Decisão “${value.title}” criada.`,
        });
      },
    });

    // ---------- planner.decision.vote (write) ----------
    def({
      id: 'planner.decision.vote',
      agent: 'planner',
      kind: 'write',
      exposure: ['chat', 'ui'],
      timeoutMs: 3000,
      title: 'Votar em decisão',
      slots: [{ name: 'optionRef', required: true, prompt: 'Em qual opção você vota?' }, { name: 'voterRef', required: true, prompt: 'Quem está votando?' }],
      validate(input) {
        const i = input || {};
        const fields = [];
        const optionRef = i.optionId != null && String(i.optionId).trim() ? i.optionId : i.optionRef;
        if (optionRef == null || !String(optionRef).trim()) fields.push(Kit.fieldError('optionRef', 'Informe a opção.'));
        const voterRef = i.participantId != null && String(i.participantId).trim() ? i.participantId : i.voterRef;
        if (voterRef == null || !String(voterRef).trim()) fields.push(Kit.fieldError('voterRef', 'Informe quem está votando.'));
        if (fields.length) return Kit.invalid(fields);
        const value = { optionRef: String(optionRef), voterRef: String(voterRef) };
        const decisionRef = i.decisionId != null && String(i.decisionId).trim() ? i.decisionId : i.decisionRef;
        if (decisionRef != null && String(decisionRef).trim()) value.decisionRef = String(decisionRef);
        return Kit.ok(value);
      },
      async run(value, ctx) {
        const ws = ctx.getWorkspace();
        const Core = ctx.core;
        let decision = null;
        let option = null;
        if (value.decisionRef) {
          const dr = Kit.resolveDecision(ws, value.decisionRef);
          if (!dr.ok) throw invalidInput(dr.fields);
          decision = dr.value;
          const or = Kit.resolveOption(decision, value.optionRef);
          if (!or.ok) throw invalidInput(or.fields);
          option = or.value;
        } else {
          // sem decisionRef: usa a única decisão aberta que contém a opção.
          const candidates = ws.decisions.filter((d) => d.status === 'open'
            && Kit.resolveOption(d, value.optionRef).ok);
          if (!candidates.length) throw invalidInput([Kit.fieldError('optionRef', 'Nenhuma decisão aberta contém essa opção.')]);
          if (candidates.length > 1) throw invalidInput([Kit.fieldError('decisionRef', 'Mais de uma decisão aberta contém essa opção. Especifique a decisão.')]);
          decision = candidates[0];
          option = Kit.resolveOption(decision, value.optionRef).value;
        }
        const voter = Kit.resolveParticipant(ws, value.voterRef, { field: 'voterRef' });
        if (!voter.ok) throw invalidInput(voter.fields);
        if (!voter.value.active) throw invalidInput([Kit.fieldError('voterRef', 'Participante arquivado não pode votar.')]);
        const decisionId = decision.id;
        const optionId = option.id;
        const participantId = voter.value.id;
        const before = cloneOr(decision);
        const after = await ctx.commit((draft) => {
          const result = Core.vote(draft, decisionId, optionId, participantId);
          if (!result.changed) throw entityConflict('Não foi possível registrar o voto. A decisão pode ter mudado.');
          return result.workspace;
        }, { source: ctx.source, message: 'Voto atualizado' });
        const updated = after.decisions.find((d) => d.id === decisionId) || null;
        return Kit.receipt({
          entity: 'decision', collection: 'decisions', action: 'vote', id: decisionId,
          before: before, after: cloneOr(updated), message: `Voto registrado em “${option.label}”.`,
        });
      },
    });

    // ---------- planner.decision.close / reopen (write) ----------
    function toggleDecision(idSuffix, targetStatus, actionLabel, message) {
      def({
        id: `planner.decision.${idSuffix}`,
        agent: 'planner',
        kind: 'write',
        exposure: ['chat', 'ui'],
        timeoutMs: 3000,
        title: idSuffix === 'close' ? 'Encerrar decisão' : 'Reabrir decisão',
        slots: [{ name: 'decisionRef', required: true, prompt: 'Qual decisão?' }],
        validate(input) {
          const i = input || {};
          const ref = i.id != null && String(i.id).trim() ? i.id : (i.decisionId != null && String(i.decisionId).trim() ? i.decisionId : i.decisionRef);
          if (ref == null || !String(ref).trim()) return Kit.invalid(Kit.fieldError('decisionRef', 'Informe a decisão.'));
          return Kit.ok({ ref: String(ref) });
        },
        async run(value, ctx) {
          const ws = ctx.getWorkspace();
          const resolved = Kit.resolveDecision(ws, value.ref);
          if (!resolved.ok) throw invalidInput(resolved.fields);
          const decisionId = resolved.value.id;
          const before = cloneOr(resolved.value);
          const after = await ctx.commit((draft) => {
            const decision = draft.decisions.find((d) => d.id === decisionId);
            if (!decision) throw entityConflict('Esta decisão foi removida em outra aba.');
            decision.status = targetStatus;
            decision.closedAt = targetStatus === 'closed' ? new Date().toISOString() : null;
          }, { source: ctx.source, message: 'Status da decisão atualizado' });
          const updated = after.decisions.find((d) => d.id === decisionId) || null;
          return Kit.receipt({
            entity: 'decision', collection: 'decisions', action: actionLabel, id: decisionId,
            before: before, after: cloneOr(updated), message: message,
          });
        },
      });
    }
    toggleDecision('close', 'closed', 'close', 'Decisão encerrada.');
    toggleDecision('reopen', 'open', 'reopen', 'Decisão reaberta.');

    // ---------- planner.decision.list (read) ----------
    def({
      id: 'planner.decision.list',
      agent: 'planner',
      kind: 'read',
      exposure: ['chat', 'ui'],
      timeoutMs: 1000,
      title: 'Listar decisões',
      validate(input) {
        const i = input || {};
        const filter = i.filter || 'all';
        if (!['all', 'open', 'closed'].includes(filter)) return Kit.invalid(Kit.fieldError('filter', 'Filtro inválido.'));
        return Kit.ok({ filter });
      },
      run(value, ctx) {
        const ws = ctx.getWorkspace();
        return ws.decisions
          .filter((d) => value.filter === 'all' || d.status === value.filter)
          .map((d) => ({
            id: d.id, title: d.title, status: d.status,
            options: d.options.map((o) => ({ id: o.id, label: o.label, votes: o.voterIds.length })),
            totalVotes: d.options.reduce((sum, o) => sum + o.voterIds.length, 0),
          }));
      },
    });

    // ---------- planner.decision.delete (write, ui) ----------
    def({
      id: 'planner.decision.delete',
      agent: 'planner',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 3000,
      title: 'Excluir decisão',
      validate(input) {
        return Kit.validateId(input && input.id, 'id', 'a decisão');
      },
      async run(id, ctx) {
        const ws = ctx.getWorkspace();
        const current = ws.decisions.find((d) => d.id === id);
        const before = cloneOr(current);
        await ctx.commit((draft) => {
          if (!draft.decisions.some((d) => d.id === id)) throw entityConflict('Esta decisão foi removida em outra aba.');
          draft.decisions = draft.decisions.filter((d) => d.id !== id);
        }, { source: ctx.source, message: 'Decisão excluída' });
        return Kit.receipt({
          entity: 'decision', collection: 'decisions', action: 'delete', id: id,
          before: before, after: null, message: 'Decisão excluída.',
        });
      },
    });

    // ---------- planner.participant.add (write) ----------
    def({
      id: 'planner.participant.add',
      agent: 'planner',
      kind: 'write',
      exposure: ['chat', 'ui'],
      timeoutMs: 3000,
      title: 'Adicionar participante',
      slots: [{ name: 'name', required: true, prompt: 'Qual é o nome do participante?' }],
      validate(input) {
        const i = input || {};
        const fields = [];
        const name = Kit.validateText(i.name, 'name', 'o nome', { max: 40 });
        if (!name.ok) fields.push(...name.fields);
        if (i.color != null && i.color !== '' && !/^#[0-9a-f]{6}$/i.test(String(i.color))) {
          fields.push(Kit.fieldError('color', 'Informe uma cor hexadecimal (#rrggbb).'));
        }
        if (fields.length) return Kit.invalid(fields);
        const value = { name: name.value };
        if (i.color != null && i.color !== '') value.color = String(i.color);
        return Kit.ok(value);
      },
      async run(value, ctx) {
        const Core = ctx.core;
        const after = await ctx.commit((draft) => {
          draft.participants.push(Core.createParticipant({ name: value.name, color: value.color }, draft.participants.length));
        }, { source: ctx.source, message: 'Participante adicionado' });
        const created = after.participants.find((p) => Kit.normalizeKey(p.name) === Kit.normalizeKey(value.name)) || null;
        return Kit.receipt({
          entity: 'participant', collection: 'participants', action: 'create', id: created ? created.id : null,
          before: null, after: cloneOr(created), message: `Participante ${value.name} adicionado.`,
        });
      },
    });

    // ---------- planner.participant.remove (write, ui) ----------
    def({
      id: 'planner.participant.remove',
      agent: 'planner',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 3000,
      title: 'Remover participante',
      validate(input) {
        return Kit.validateId(input && input.id, 'id', 'o participante');
      },
      async run(id, ctx) {
        const Core = ctx.core;
        const ws = ctx.getWorkspace();
        const current = ws.participants.find((p) => p.id === id);
        if (!current) throw entityConflict('Este participante foi removido em outra aba.');
        const before = cloneOr(current);
        const preview = Core.removeParticipant(ws, id);
        const after = await ctx.commit((draft) => {
          const result = Core.removeParticipant(draft, id);
          if (!result.found) throw entityConflict('Este participante foi removido em outra aba.');
          return result.workspace;
        }, { source: ctx.source, message: preview.archived ? 'Participante arquivado' : 'Participante removido' });
        const updated = after.participants.find((p) => p.id === id) || null;
        return Kit.receipt({
          entity: 'participant', collection: 'participants', action: preview.archived ? 'update' : 'delete', id: id,
          before: before, after: cloneOr(updated),
          message: preview.archived ? 'Participante arquivado (histórico preservado).' : 'Participante removido.',
        });
      },
    });

    // ---------- planner.workspace.rename (write) ----------
    def({
      id: 'planner.workspace.rename',
      agent: 'planner',
      kind: 'write',
      exposure: ['chat', 'ui'],
      timeoutMs: 3000,
      title: 'Renomear workspace',
      slots: [{ name: 'name', required: true, prompt: 'Qual é o novo nome?' }],
      validate(input) {
        const i = input || {};
        const name = Kit.validateText(i.name, 'name', 'o nome', { max: 80, optional: true });
        if (!name.ok) return name;
        return Kit.ok({ name: name.value });
      },
      async run(value, ctx) {
        const before = ctx.getWorkspace().name;
        const after = await ctx.commit((draft) => { draft.name = value.name; }, {
          source: ctx.source, message: value.name ? 'Nome do workspace atualizado' : 'Nome do workspace removido',
        });
        return Kit.receipt({
          entity: 'workspace', collection: 'name', action: 'rename', id: null,
          before: before, after: after.name, message: value.name ? `Workspace renomeado para “${value.name}”.` : 'Nome do workspace removido.',
        });
      },
    });

    // ---------- planner.workspace.setup (write, ui) ----------
    def({
      id: 'planner.workspace.setup',
      agent: 'planner',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 4000,
      title: 'Configurar workspace',
      validate(input) {
        const i = input || {};
        const name = Kit.validateText(i.name, 'name', 'o nome', { max: 80, optional: true });
        if (!name.ok) return name;
        const participantNames = Array.isArray(i.participantNames)
          ? i.participantNames.map((n) => String(n || '').trim()).filter(Boolean)
          : [];
        return Kit.ok({ name: name.value, participantNames });
      },
      async run(value, ctx) {
        const Core = ctx.core;
        const before = cloneOr(ctx.getWorkspace());
        const after = await ctx.commit((draft) => {
          draft.name = value.name;
          draft.settings.onboardingCompleted = true;
          const existing = new Set(draft.participants.map((p) => Kit.normalizeKey(p.name)));
          value.participantNames.forEach((pname) => {
            const key = Kit.normalizeKey(pname);
            if (existing.has(key)) return;
            draft.participants.push(Core.createParticipant({
              name: pname, color: Core.PALETTE[draft.participants.length % Core.PALETTE.length],
            }, draft.participants.length));
            existing.add(key);
          });
        }, { source: ctx.source, message: 'Workspace configurado' });
        return Kit.receipt({
          entity: 'workspace', collection: 'name', action: 'set', id: null,
          before: before ? before.name : null, after: after.name, message: 'Workspace configurado.',
        });
      },
    });

    // ---------- planner.workspace.reset (write, ui) ----------
    def({
      id: 'planner.workspace.reset',
      agent: 'planner',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 5000,
      title: 'Apagar banco local',
      validate() { return Kit.ok({}); },
      async run(_value, ctx) {
        if (!ctx.local || typeof ctx.local.reset !== 'function') {
          const err = new Error('Reset indisponível neste ambiente.');
          err.code = 'skill/failed';
          throw err;
        }
        const workspace = await ctx.local.reset();
        return Kit.receipt({
          entity: 'workspace', collection: 'name', action: 'set', id: null,
          before: null, after: workspace ? workspace.name : '', message: 'Banco local apagado.',
        });
      },
    });

    // ---------- ui-only wrappers via ctx.local ----------
    def({
      id: 'planner.backup.export',
      agent: 'planner',
      kind: 'read',
      exposure: ['ui'],
      timeoutMs: 5000,
      title: 'Exportar backup',
      validate() { return Kit.ok({}); },
      async run(_value, ctx) {
        const encrypted = await ctx.local.exportEncrypted();
        return { encrypted };
      },
    });

    def({
      id: 'planner.backup.import',
      agent: 'planner',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 8000,
      title: 'Importar backup',
      validate(input) {
        const i = input || {};
        if (i.source == null || !String(i.source).trim()) return Kit.invalid(Kit.fieldError('source', 'Informe o conteúdo do backup.'));
        const value = { source: String(i.source) };
        if (i.password != null) value.password = String(i.password);
        return Kit.ok(value);
      },
      async run(value, ctx) {
        const workspace = await ctx.local.importBackup(value.source, value.password);
        return Kit.receipt({
          entity: 'workspace', collection: 'name', action: 'set', id: null,
          before: null, after: workspace ? workspace.name : '', message: 'Backup restaurado.',
        });
      },
    });

    def({
      id: 'planner.account.password',
      agent: 'planner',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 8000,
      title: 'Alterar senha do cofre',
      validate(input) {
        const i = input || {};
        const fields = [];
        if (i.currentPassword == null || !String(i.currentPassword)) fields.push(Kit.fieldError('currentPassword', 'Informe a senha atual.'));
        if (i.newPassword == null || !String(i.newPassword)) fields.push(Kit.fieldError('newPassword', 'Informe a nova senha.'));
        if (fields.length) return Kit.invalid(fields);
        return Kit.ok({ currentPassword: String(i.currentPassword), newPassword: String(i.newPassword) });
      },
      async run(value, ctx) {
        const result = await ctx.local.auth.changePassword({ currentPassword: value.currentPassword, newPassword: value.newPassword });
        return { account: result.account, workspace: result.workspace, expiresAt: result.expiresAt || null };
      },
    });

    def({
      id: 'planner.account.lock',
      agent: 'planner',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 4000,
      title: 'Bloquear cofre',
      validate(input) {
        const i = input || {};
        return Kit.ok({ allTabs: i.allTabs !== false });
      },
      async run(value, ctx) {
        await ctx.local.auth.lock({ allTabs: value.allTabs });
        return Kit.receipt({
          entity: 'account', collection: 'name', action: 'set', id: null,
          before: null, after: null, message: 'Cofre bloqueado.',
        });
      },
    });

    def({
      id: 'planner.security.settings',
      agent: 'planner',
      kind: 'read',
      exposure: ['ui'],
      timeoutMs: 2000,
      title: 'Ler estado de segurança',
      validate() { return Kit.ok({}); },
      run(_value, ctx) {
        return ctx.local.auth.status();
      },
    });

    // ---------- planner.participant.update (write, ui) ----------
    def({
      id: 'planner.participant.update',
      agent: 'planner',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 3000,
      title: 'Atualizar participante',
      validate(input) {
        const i = input || {};
        const fields = [];
        const idCheck = Kit.validateId(i.id, 'id', 'o participante');
        if (!idCheck.ok) fields.push(...idCheck.fields);
        const value = { id: idCheck.ok ? idCheck.value : String(i.id == null ? '' : i.id) };
        if (i.name !== undefined) {
          const name = Kit.validateText(i.name, 'name', 'o nome', { max: 40 });
          if (!name.ok) fields.push(...name.fields);
          else value.name = name.value;
        }
        if (i.color !== undefined) {
          if (i.color == null || i.color === '' || !/^#[0-9a-f]{6}$/i.test(String(i.color))) {
            fields.push(Kit.fieldError('color', 'Informe uma cor hexadecimal (#rrggbb).'));
          } else {
            value.color = String(i.color);
          }
        }
        if (i.active !== undefined) value.active = Boolean(i.active);
        if (fields.length) return Kit.invalid(fields);
        if (value.name === undefined && value.color === undefined && value.active === undefined) {
          return Kit.invalid(Kit.fieldError('name', 'Informe o que alterar no participante.'));
        }
        return Kit.ok(value);
      },
      async run(value, ctx) {
        const ws = ctx.getWorkspace();
        const existing = ws.participants.find((p) => p.id === value.id);
        if (!existing) throw entityConflict('Este participante foi removido em outra aba.');
        const before = cloneOr(existing);
        const message = value.active !== undefined
          ? 'Participante atualizado'
          : (value.name !== undefined ? 'Nome atualizado' : undefined);
        const after = await ctx.commit((draft) => {
          const participant = draft.participants.find((p) => p.id === value.id);
          if (!participant) throw entityConflict('Este participante foi removido em outra aba.');
          if (value.name !== undefined) participant.name = value.name;
          if (value.color !== undefined) participant.color = value.color;
          if (value.active !== undefined) participant.active = value.active;
        }, { source: ctx.source, message: message });
        const updated = after.participants.find((p) => p.id === value.id) || null;
        return Kit.receipt({
          entity: 'participant', collection: 'participants', action: 'update', id: value.id,
          before: before, after: cloneOr(updated), message: 'Participante atualizado.',
        });
      },
    });
    // ---------- planner.checklist.template (write, chat+ui) ----------
    def({
      id: 'planner.checklist.template',
      agent: 'planner',
      kind: 'write',
      exposure: ['chat', 'ui'],
      timeoutMs: 4000,
      title: 'Aplicar modelo de checklist',
      validate(input) {
        const i = input || {};
        const value = {};
        if (i.templateId != null && i.templateId !== '') value.templateId = String(i.templateId);
        if (i.tripId != null && i.tripId !== '') value.tripId = String(i.tripId);
        if (i.tripRef != null && i.tripRef !== '') value.tripRef = i.tripRef;
        return Kit.ok(value);
      },
      async run(value, ctx) {
        const Core = ctx.core;
        const ws = ctx.getWorkspace();
        let tripId = null;
        if (value.tripId) {
          if (!ws.trips.some((t) => t.id === value.tripId)) throw invalidInput([Kit.fieldError('tripId', 'Viagem não encontrada.')]);
          tripId = value.tripId;
        } else if (value.tripRef != null) {
          const r = Kit.resolveTrip(ws, value.tripRef);
          if (!r.ok) throw invalidInput(r.fields);
          tripId = r.value.id;
        }
        const templates = [
          ['Documento de identificação', 'documentos'],
          ['Comprovantes e reservas', 'documentos'],
          ['Carregador do celular', 'tecnologia'],
          ['Medicamentos de uso pessoal', 'saude'],
          ['Itens de higiene', 'higiene'],
          ['Roupas adequadas ao clima', 'roupas'],
        ];
        const existing = new Set(ws.checklist.map((item) => item.text.toLocaleLowerCase('pt-BR')));
        const additions = templates.filter(([txt]) => !existing.has(txt.toLocaleLowerCase('pt-BR')));
        if (!additions.length) {
          return Kit.receipt({
            entity: 'checklist', collection: 'checklist', action: 'create', id: [],
            before: null, after: [], message: 'Todos os itens sugeridos já estão no checklist.',
          });
        }
        const items = additions.map(([text, category]) => ({
          id: Core.id('check'), text, category, done: false, tripId, createdAt: new Date().toISOString(),
        }));
        const ids = items.map((item) => item.id);
        const after = await ctx.commit((draft) => {
          items.forEach((item) => draft.checklist.push(item));
        }, { source: ctx.source, message: 'Modelo adicionado ao checklist' });
        const created = after.checklist.filter((c) => ids.includes(c.id));
        return Kit.receipt({
          entity: 'checklist', collection: 'checklist', action: 'create', id: ids,
          before: null, after: created.map((c) => cloneOr(c)),
          message: `${items.length} ${items.length === 1 ? 'item adicionado' : 'itens adicionados'} ao checklist.`,
        });
      },
    });
    // ---------- planner.checklist.clear-completed (write, ui) ----------
    def({
      id: 'planner.checklist.clear-completed',
      agent: 'planner',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 4000,
      title: 'Remover itens concluídos do checklist',
      validate() { return Kit.ok({}); },
      async run(_value, ctx) {
        const ws = ctx.getWorkspace();
        const removed = ws.checklist.filter((item) => item.done);
        const ids = removed.map((item) => item.id);
        const before = removed.map((item) => cloneOr(item));
        await ctx.commit((draft) => {
          draft.checklist = draft.checklist.filter((item) => !item.done);
        }, { source: ctx.source, message: 'Itens concluídos removidos' });
        return Kit.receipt({
          entity: 'checklist', collection: 'checklist', action: 'delete', id: ids,
          before: before, after: null,
          message: `${ids.length} ${ids.length === 1 ? 'item removido' : 'itens removidos'}.`,
        });
      },
    });
    // ---------- planner.workspace.onboarding (write, ui) ----------
    def({
      id: 'planner.workspace.onboarding',
      agent: 'planner',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 3000,
      title: 'Atualizar onboarding do workspace',
      validate(input) {
        const i = input || {};
        if (i.completed == null) return Kit.invalid(Kit.fieldError('completed', 'Informe o estado do onboarding.'));
        return Kit.ok({ completed: Boolean(i.completed) });
      },
      async run(value, ctx) {
        const before = Boolean(ctx.getWorkspace().settings.onboardingCompleted);
        const after = await ctx.commit((draft) => {
          draft.settings.onboardingCompleted = value.completed;
        }, { source: ctx.source, message: 'Onboarding atualizado' });
        return Kit.receipt({
          entity: 'workspace', collection: 'settings', action: 'update', id: 'onboardingCompleted',
          before: before, after: Boolean(after.settings.onboardingCompleted),
          message: value.completed ? 'Configuração inicial concluída.' : 'Configuração inicial reaberta.',
        });
      },
    });
    return ids;
  }

  const IDS = [
    'planner.checklist.add', 'planner.checklist.update', 'planner.checklist.toggle',
    'planner.checklist.list', 'planner.checklist.delete',
    'planner.decision.create', 'planner.decision.vote', 'planner.decision.close',
    'planner.decision.reopen', 'planner.decision.list', 'planner.decision.delete',
    'planner.participant.add', 'planner.participant.remove',
    'planner.workspace.rename', 'planner.workspace.setup', 'planner.workspace.reset',
    'planner.backup.export', 'planner.backup.import',
    'planner.account.password', 'planner.account.lock', 'planner.security.settings',
    'planner.participant.update', 'planner.checklist.template',
    'planner.checklist.clear-completed', 'planner.workspace.onboarding',
  ];

  return Object.freeze({ register, ids: Object.freeze(IDS) });
});
