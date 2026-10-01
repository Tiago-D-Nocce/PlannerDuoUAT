/* PlannerDuo — skills do Agente de Viagens (links, viagens e resumos). */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerTravelSkills = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const Kit = (root && root.PlannerSkillKit) || (typeof require === 'function' ? require('./skill-kit.js') : null);

  const GROUPS = ['all', 'flights', 'stays', 'ground', 'cars'];

  function cloneTrip(trip) {
    return trip ? Kit.deepClone(trip) : null;
  }

  function tripStatus(trip, todayIso) {
    const ref = trip.endDate || trip.startDate;
    if (!ref) return 'upcoming';
    return ref >= todayIso ? 'upcoming' : 'past';
  }

  function tripMetrics(ws, trip) {
    const spent = ws.finances
      .filter((f) => f.type === 'expense' && f.tripId === trip.id)
      .reduce((sum, f) => sum + f.amount, 0);
    const saved = trip.saved || 0;
    const budget = trip.budget || 0;
    const applied = saved + spent;
    const remaining = budget > 0 ? budget - applied : 0;
    const progress = budget > 0 ? Math.min(100, Math.round((applied / budget) * 100)) : 0;
    return { spent, saved, budget, remaining, progress };
  }

  function tripSummary(ws, trip, todayIso) {
    const metrics = tripMetrics(ws, trip);
    const linked = ws.checklist.filter((item) => item.tripId === trip.id);
    return Object.assign({
      id: trip.id,
      destination: trip.destination,
      emoji: trip.emoji,
      startDate: trip.startDate,
      endDate: trip.endDate,
      notes: trip.notes,
      status: tripStatus(trip, todayIso),
      checklist: { total: linked.length, done: linked.filter((i) => i.done).length },
    }, metrics);
  }

  // Monta links somente via Travel.validate/build para manter URLs idênticas.
  function buildLinks(travel, value, todayIso) {
    const all = travel.providers;
    let selection = all;
    if (Array.isArray(value.providerIds) && value.providerIds.length) {
      const wanted = new Set(value.providerIds);
      selection = all.filter((p) => wanted.has(p.id));
    } else if (value.group && value.group !== 'all') {
      selection = all.filter((p) => p.group === value.group);
    }
    const links = [];
    const skipped = [];
    const searchInput = {
      origin: value.origin || '',
      destination: value.destination,
      departure: value.departDate || '',
      returnDate: value.returnDate || '',
      passengers: value.adults || 1,
    };
    selection.forEach((provider) => {
      const checked = travel.validate(provider.id, searchInput, todayIso);
      if (!checked.ok) {
        skipped.push({ providerId: provider.id, reason: checked.message });
        return;
      }
      let built;
      try {
        built = travel.build(provider.id, searchInput, todayIso);
      } catch (err) {
        skipped.push({ providerId: provider.id, reason: 'Não foi possível preparar este site com segurança.' });
        return;
      }
      links.push({
        providerId: provider.id,
        name: provider.name,
        group: provider.group,
        url: built.url,
        mode: built.mode,
        filled: built.filled,
        limitations: Array.isArray(built.warnings) ? built.warnings.slice() : [],
      });
    });
    return { links, skipped };
  }

  function register(runtime) {
    const ids = [];
    function def(definition) {
      runtime.define(definition);
      ids.push(definition.id);
    }

    // ---------- travel.links.build (read) ----------
    def({
      id: 'travel.links.build',
      agent: 'travel',
      kind: 'read',
      exposure: ['chat', 'ui'],
      timeoutMs: 2000,
      title: 'Montar links de busca',
      slots: [{ name: 'destination', required: true, prompt: 'Para onde você quer ir?' }],
      validate(input) {
        const i = input || {};
        const fields = [];
        const dest = Kit.validateText(i.destination, 'destination', 'o destino', { max: 120 });
        if (!dest.ok) fields.push(...dest.fields);
        let origin = '';
        if (i.origin != null && String(i.origin).trim()) {
          const o = Kit.validateText(i.origin, 'origin', 'a origem', { max: 120 });
          if (!o.ok) fields.push(...o.fields); else origin = o.value;
        }
        let departDate = '';
        if (i.departDate) {
          const d = Kit.validateDate(i.departDate, 'departDate', { optional: true });
          if (!d.ok) fields.push(...d.fields); else departDate = d.value;
        }
        let returnDate = '';
        if (i.returnDate) {
          const r = Kit.validateDate(i.returnDate, 'returnDate', { optional: true });
          if (!r.ok) fields.push(...r.fields); else returnDate = r.value;
        }
        let adults = 1;
        if (i.adults != null && i.adults !== '') {
          adults = Number(i.adults);
          if (!Number.isInteger(adults) || adults < 1 || adults > 9) {
            fields.push(Kit.fieldError('adults', 'Escolha entre 1 e 9 viajantes.'));
          }
        }
        let group = 'all';
        if (i.group != null && i.group !== '') {
          if (!GROUPS.includes(i.group)) fields.push(Kit.fieldError('group', 'Grupo inválido.'));
          else group = i.group;
        }
        let providerIds;
        if (i.providerIds != null) {
          if (!Array.isArray(i.providerIds)) fields.push(Kit.fieldError('providerIds', 'Informe uma lista de provedores.'));
          else providerIds = i.providerIds.map(String);
        }
        if (fields.length) return Kit.invalid(fields);
        const value = { destination: dest.value, origin, departDate, returnDate, adults, group };
        if (providerIds) value.providerIds = providerIds;
        return Kit.ok(value);
      },
      run(value, ctx) {
        return buildLinks(ctx.travel, value, Kit.today(ctx.now()));
      },
    });

    // ---------- travel.trip.list (read) ----------
    def({
      id: 'travel.trip.list',
      agent: 'travel',
      kind: 'read',
      exposure: ['chat', 'ui'],
      timeoutMs: 1000,
      title: 'Listar viagens',
      validate(input) {
        const status = (input && input.status) || 'all';
        if (!['upcoming', 'past', 'all'].includes(status)) {
          return Kit.invalid(Kit.fieldError('status', 'Filtro inválido.'));
        }
        return Kit.ok({ status });
      },
      run(value, ctx) {
        const ws = ctx.getWorkspace();
        const todayIso = Kit.today(ctx.now());
        return ws.trips
          .map((trip) => Object.assign({
            id: trip.id,
            destination: trip.destination,
            emoji: trip.emoji,
            startDate: trip.startDate,
            endDate: trip.endDate,
            status: tripStatus(trip, todayIso),
          }, tripMetrics(ws, trip)))
          .filter((trip) => value.status === 'all' || trip.status === value.status);
      },
    });

    // ---------- travel.trip.summary (read) ----------
    def({
      id: 'travel.trip.summary',
      agent: 'travel',
      kind: 'read',
      exposure: ['chat', 'ui'],
      timeoutMs: 1000,
      title: 'Resumo da viagem',
      slots: [{ name: 'tripRef', required: true, prompt: 'Qual viagem?' }],
      validate(input) {
        return Kit.validateId(input && input.tripRef, 'tripRef', 'a viagem');
      },
      run(ref, ctx) {
        const ws = ctx.getWorkspace();
        const resolved = Kit.resolveTrip(ws, ref);
        if (!resolved.ok) {
          const err = new Error(resolved.fields[0].message);
          err.code = 'skill/invalid-input';
          err.fields = resolved.fields;
          throw err;
        }
        return tripSummary(ws, resolved.value, Kit.today(ctx.now()));
      },
    });

    // ---------- travel.trip.create (write) ----------
    def({
      id: 'travel.trip.create',
      agent: 'travel',
      kind: 'write',
      exposure: ['chat', 'ui'],
      timeoutMs: 4000,
      title: 'Planejar viagem',
      slots: [{ name: 'destination', required: true, prompt: 'Para onde é a viagem?' }],
      validate(input) {
        const i = input || {};
        const fields = [];
        const dest = Kit.validateText(i.destination, 'destination', 'o destino', { max: 120 });
        if (!dest.ok) fields.push(...dest.fields);
        const start = Kit.validateDate(i.startDate, 'startDate', { optional: true });
        if (!start.ok) fields.push(...start.fields);
        const end = Kit.validateDate(i.endDate, 'endDate', { optional: true });
        if (!end.ok) fields.push(...end.fields);
        if (start.ok && end.ok && start.value && end.value && end.value < start.value) {
          fields.push(Kit.fieldError('endDate', 'A volta não pode ser anterior à ida.'));
        }
        const budget = Kit.validateMoney(i.budget, 'budget', { optional: true });
        if (!budget.ok) fields.push(...budget.fields);
        const saved = Kit.validateMoney(i.saved, 'saved', { optional: true });
        if (!saved.ok) fields.push(...saved.fields);
        const notes = Kit.validateText(i.notes, 'notes', 'notas', { max: 500, optional: true });
        if (!notes.ok) fields.push(...notes.fields);
        const emoji = Kit.validateText(i.emoji, 'emoji', 'emoji', { max: 8, optional: true });
        if (!emoji.ok) fields.push(...emoji.fields);
        if (fields.length) return Kit.invalid(fields);
        return Kit.ok({
          destination: dest.value,
          startDate: start.value,
          endDate: end.value,
          budget: budget.value,
          saved: saved.value,
          notes: notes.value,
          emoji: emoji.value || '🧭',
        });
      },
      async run(value, ctx) {
        const before = ctx.getWorkspace();
        const trip = {
          id: ctx.core.id('trip'),
          destination: value.destination,
          emoji: value.emoji,
          startDate: value.startDate,
          endDate: value.endDate,
          budget: value.budget,
          saved: value.saved,
          notes: value.notes,
          createdAt: new Date().toISOString(),
        };
        const after = await ctx.commit((draft) => { draft.trips.push(trip); }, {
          source: ctx.source,
          message: 'Viagem planejada',
        });
        const created = after.trips.find((t) => t.id === trip.id) || null;
        return Kit.receipt({
          entity: 'trip', collection: 'trips', action: 'create', id: created ? created.id : trip.id,
          before: null, after: cloneTrip(created), message: `Viagem para ${value.destination} planejada.`,
        });
      },
    });

    // ---------- travel.trip.update (write) ----------
    def({
      id: 'travel.trip.update',
      agent: 'travel',
      kind: 'write',
      exposure: ['chat', 'ui'],
      timeoutMs: 4000,
      title: 'Atualizar viagem',
      validate(input) {
        const i = input || {};
        const fields = [];
        const ref = i.id != null && String(i.id).trim() ? i.id : i.tripRef;
        if (ref == null || !String(ref).trim()) fields.push(Kit.fieldError('tripRef', 'Informe a viagem a atualizar.'));
        if (i.destination != null) {
          const dest = Kit.validateText(i.destination, 'destination', 'o destino', { max: 120 });
          if (!dest.ok) fields.push(...dest.fields);
        }
        if (i.startDate != null && i.startDate !== '') {
          const s = Kit.validateDate(i.startDate, 'startDate', { optional: true });
          if (!s.ok) fields.push(...s.fields);
        }
        if (i.endDate != null && i.endDate !== '') {
          const e = Kit.validateDate(i.endDate, 'endDate', { optional: true });
          if (!e.ok) fields.push(...e.fields);
        }
        if (i.budget != null && i.budget !== '') {
          const b = Kit.validateMoney(i.budget, 'budget', { optional: true });
          if (!b.ok) fields.push(...b.fields);
        }
        if (i.saved != null && i.saved !== '') {
          const sv = Kit.validateMoney(i.saved, 'saved', { optional: true });
          if (!sv.ok) fields.push(...sv.fields);
        }
        if (fields.length) return Kit.invalid(fields);
        const value = { ref: String(ref) };
        ['destination', 'startDate', 'endDate', 'budget', 'saved', 'notes', 'emoji'].forEach((k) => {
          if (i[k] != null) value[k] = i[k];
        });
        return Kit.ok(value);
      },
      async run(value, ctx) {
        const ws = ctx.getWorkspace();
        const resolved = Kit.resolveTrip(ws, value.ref);
        if (!resolved.ok) {
          const err = new Error(resolved.fields[0].message);
          err.code = 'skill/invalid-input'; err.fields = resolved.fields; throw err;
        }
        const current = resolved.value;
        const before = cloneTrip(current);
        // valida relação de datas final
        const nextStart = value.startDate != null ? ctx.core.date(value.startDate) : current.startDate;
        const nextEnd = value.endDate != null ? ctx.core.date(value.endDate) : current.endDate;
        if (nextStart && nextEnd && nextEnd < nextStart) {
          const err = new Error('A volta não pode ser anterior à ida.');
          err.code = 'skill/invalid-input'; err.fields = [Kit.fieldError('endDate', 'A volta não pode ser anterior à ida.')]; throw err;
        }
        const after = await ctx.commit((draft) => {
          const trip = draft.trips.find((t) => t.id === current.id);
          if (!trip) {
            const conflict = new Error('Esta viagem foi removida em outra aba.');
            conflict.code = 'local/entity-conflict';
            throw conflict;
          }
          if (value.destination != null) trip.destination = String(value.destination).trim();
          if (value.startDate != null) trip.startDate = ctx.core.date(value.startDate);
          if (value.endDate != null) trip.endDate = ctx.core.date(value.endDate);
          if (value.budget != null) trip.budget = ctx.core.amount(value.budget);
          if (value.saved != null) trip.saved = ctx.core.amount(value.saved);
          if (value.notes != null) trip.notes = String(value.notes).trim();
          if (value.emoji != null) trip.emoji = String(value.emoji).trim() || '🧭';
        }, { source: ctx.source, message: 'Viagem atualizada' });
        const updated = after.trips.find((t) => t.id === current.id) || null;
        return Kit.receipt({
          entity: 'trip', collection: 'trips', action: 'update', id: current.id,
          before: before, after: cloneTrip(updated), message: `Viagem ${current.destination} atualizada.`,
        });
      },
    });

    // ---------- travel.trip.delete (write, ui) ----------
    def({
      id: 'travel.trip.delete',
      agent: 'travel',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 4000,
      title: 'Excluir viagem',
      validate(input) {
        return Kit.validateId(input && input.id, 'id', 'a viagem');
      },
      async run(id, ctx) {
        const ws = ctx.getWorkspace();
        const current = ws.trips.find((t) => t.id === id);
        const before = cloneTrip(current);
        const after = await ctx.commit((draft) => {
          const exists = draft.trips.some((t) => t.id === id);
          if (!exists) {
            const conflict = new Error('Esta viagem foi removida em outra aba.');
            conflict.code = 'local/entity-conflict';
            throw conflict;
          }
          draft.trips = draft.trips.filter((t) => t.id !== id);
          draft.finances.forEach((f) => { if (f.tripId === id) f.tripId = null; });
          draft.checklist.forEach((item) => { if (item.tripId === id) item.tripId = null; });
        }, { source: ctx.source, message: 'Viagem excluída' });
        return Kit.receipt({
          entity: 'trip', collection: 'trips', action: 'delete', id: id,
          before: before, after: null, message: 'Viagem excluída.',
        });
      },
    });

    return ids;
  }

  const IDS = [
    'travel.links.build', 'travel.trip.list', 'travel.trip.summary',
    'travel.trip.create', 'travel.trip.update', 'travel.trip.delete',
  ];

  return Object.freeze({ register, ids: Object.freeze(IDS) });
});
