/* PlannerDuo — regras de domínio locais, sem dependências externas. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const FORMAT = 'plannerduo-workspace';
  const MAX_AMOUNT = 1_000_000_000;
  const PALETTE = Object.freeze([
    '#1e3a8a', '#27c0d4', '#f28a1e', '#f23c13', '#8b5cf6',
    '#0ea5e9', '#22c55e', '#eab308', '#ec4899', '#64748b',
  ]);
  const CATEGORIES = Object.freeze([
    'alimentacao', 'transporte', 'moradia', 'lazer', 'saude',
    'viagem', 'educacao', 'vestuario', 'salario', 'investimento', 'outros',
  ]);

  function nowIso() {
    return new Date().toISOString();
  }

  function id(prefix) {
    const base = root && root.crypto && typeof root.crypto.randomUUID === 'function'
      ? root.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix || 'item'}-${base}`;
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function text(value, fallback) {
    const result = String(value == null ? '' : value).trim();
    return result || (fallback || '');
  }

  function amount(value) {
    let parsed;
    if (typeof value === 'number') {
      parsed = value;
    } else {
      let source;
      try {
        source = String(value == null ? '' : value).trim();
      } catch (_) {
        return 0;
      }
      parsed = Number(source.includes(',')
        ? source.replace(/\./g, '').replace(',', '.')
        : source);
    }
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_AMOUNT) return 0;
    const cents = Math.round(parsed * 100);
    return Number.isSafeInteger(cents) ? cents / 100 : 0;
  }

  function date(value) {
    const result = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return '';
    const [year, month, day] = result.split('-').map(Number);
    const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (Number.isNaN(parsed.getTime())
      || parsed.getFullYear() !== year
      || parsed.getMonth() !== month - 1
      || parsed.getDate() !== day) return '';
    return result;
  }

  function unique(values) {
    return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map(String))];
  }

  function createEmptyWorkspace() {
    const timestamp = nowIso();
    return {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      id: 'workspace-local',
      generation: id('generation'),
      name: '',
      participants: [],
      finances: [],
      trips: [],
      goals: [],
      checklist: [],
      decisions: [],
      budgets: {},
      settings: {
        currency: 'BRL',
        defaultSplit: 'equal',
        onboardingCompleted: false,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 0,
    };
  }

  function normalizeParticipant(item, index) {
    if (!item || typeof item !== 'object') return null;
    const name = text(item.name);
    if (!name) return null;
    return {
      id: text(item.id) || id('participant'),
      name,
      color: /^#[0-9a-f]{6}$/i.test(String(item.color || ''))
        ? String(item.color).toLowerCase()
        : PALETTE[index % PALETTE.length],
      active: item.active !== false,
      createdAt: text(item.createdAt) || nowIso(),
    };
  }

  function normalizeWorkspace(input) {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const base = createEmptyWorkspace();
    const seen = new Set();
    const participants = (Array.isArray(raw.participants) ? raw.participants : [])
      .map(normalizeParticipant)
      .filter(Boolean)
      .map((participant) => {
        if (!seen.has(participant.id)) {
          seen.add(participant.id);
          return participant;
        }
        const replacement = { ...participant, id: id('participant') };
        seen.add(replacement.id);
        return replacement;
      });
    const participantIds = new Set(participants.map((participant) => participant.id));

    const finances = (Array.isArray(raw.finances) ? raw.finances : [])
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const type = item.type === 'income' ? 'income' : 'expense';
        const paidById = participantIds.has(String(item.paidById || ''))
          ? String(item.paidById)
          : null;
        return {
          id: text(item.id) || id('finance'),
          type,
          description: text(item.description),
          amount: amount(item.amount),
          date: date(item.date),
          category: CATEGORIES.includes(item.category) ? item.category : 'outros',
          paidById,
          splitBetweenIds: unique(item.splitBetweenIds).filter((participantId) => participantIds.has(participantId)),
          tripId: text(item.tripId) || null,
          notes: text(item.notes),
          recurring: Boolean(item.recurring),
          recurringSourceId: text(item.recurringSourceId) || null,
          recurrenceSeriesId: text(item.recurrenceSeriesId) || (item.recurring ? (text(item.id) || null) : null),
          occurrenceMonth: /^\d{4}-\d{2}$/.test(String(item.occurrenceMonth || '')) ? String(item.occurrenceMonth) : null,
          recurrenceSkippedMonths: unique(item.recurrenceSkippedMonths).filter((month) => /^\d{4}-\d{2}$/.test(month)),
          createdAt: text(item.createdAt) || nowIso(),
        };
      })
      .filter((item) => item.description && item.amount > 0 && item.date);

    const trips = (Array.isArray(raw.trips) ? raw.trips : [])
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: text(item.id) || id('trip'),
        destination: text(item.destination),
        emoji: text(item.emoji, '🧭').slice(0, 8),
        startDate: date(item.startDate),
        endDate: date(item.endDate),
        budget: amount(item.budget),
        saved: amount(item.saved),
        notes: text(item.notes),
        createdAt: text(item.createdAt) || nowIso(),
      }))
      .filter((item) => item.destination);
    const tripIds = new Set(trips.map((trip) => trip.id));
    finances.forEach((finance) => {
      if (finance.tripId && !tripIds.has(finance.tripId)) finance.tripId = null;
    });

    const goals = (Array.isArray(raw.goals) ? raw.goals : [])
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: text(item.id) || id('goal'),
        title: text(item.title),
        emoji: text(item.emoji, '🎯').slice(0, 8),
        target: amount(item.target),
        current: amount(item.current),
        deadline: date(item.deadline),
        description: text(item.description),
        createdAt: text(item.createdAt) || nowIso(),
      }))
      .filter((item) => item.title && item.target > 0);

    const checklist = (Array.isArray(raw.checklist) ? raw.checklist : [])
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: text(item.id) || id('check'),
        text: text(item.text),
        category: text(item.category, 'outros'),
        done: Boolean(item.done),
        tripId: tripIds.has(String(item.tripId || '')) ? String(item.tripId) : null,
        createdAt: text(item.createdAt) || nowIso(),
      }))
      .filter((item) => item.text);

    const decisions = (Array.isArray(raw.decisions) ? raw.decisions : [])
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const options = (Array.isArray(item.options) ? item.options : [])
          .filter((option) => option && typeof option === 'object' && text(option.label))
          .map((option) => ({
            id: text(option.id) || id('option'),
            label: text(option.label),
            voterIds: unique(option.voterIds).filter((participantId) => participantIds.has(participantId)),
          }));
        const voterOwner = new Set();
        options.forEach((option) => {
          option.voterIds = option.voterIds.filter((participantId) => {
            if (voterOwner.has(participantId)) return false;
            voterOwner.add(participantId);
            return true;
          });
        });
        return {
          id: text(item.id) || id('decision'),
          title: text(item.title),
          description: text(item.description),
          status: item.status === 'closed' ? 'closed' : 'open',
          options,
          createdAt: text(item.createdAt) || nowIso(),
          closedAt: item.status === 'closed' ? (text(item.closedAt) || nowIso()) : null,
        };
      })
      .filter((item) => item.title && item.options.length >= 2);

    const budgets = Object.entries(raw.budgets && typeof raw.budgets === 'object' ? raw.budgets : {})
      .reduce((result, [category, value]) => {
        const normalizedAmount = amount(value);
        if (CATEGORIES.includes(category) && normalizedAmount > 0) result[category] = normalizedAmount;
        return result;
      }, {});

    return {
      ...base,
      schemaVersion: SCHEMA_VERSION,
      id: 'workspace-local',
      generation: text(raw.generation) || base.generation,
      name: text(raw.name),
      participants,
      finances,
      trips,
      goals,
      checklist,
      decisions,
      budgets,
      settings: {
        currency: 'BRL',
        defaultSplit: 'equal',
        onboardingCompleted: Boolean(raw.settings && raw.settings.onboardingCompleted),
      },
      createdAt: text(raw.createdAt) || base.createdAt,
      updatedAt: text(raw.updatedAt) || base.updatedAt,
      revision: Number.isInteger(Number(raw.revision)) && Number(raw.revision) >= 0
        ? Number(raw.revision)
        : 0,
    };
  }

  function createParticipant(data, index) {
    const normalized = normalizeParticipant({
      id: id('participant'),
      name: data && data.name,
      color: data && data.color,
      active: true,
      createdAt: nowIso(),
    }, Number(index) || 0);
    if (!normalized) throw new Error('Informe um nome para o participante.');
    return normalized;
  }

  function isParticipantReferenced(workspace, participantId) {
    const target = String(participantId || '');
    return workspace.finances.some((item) => item.paidById === target || item.splitBetweenIds.includes(target))
      || workspace.decisions.some((decision) => decision.options.some((option) => option.voterIds.includes(target)));
  }

  function removeParticipant(input, participantId) {
    const workspace = normalizeWorkspace(input);
    const target = workspace.participants.find((participant) => participant.id === participantId);
    if (!target) return { workspace, archived: false, found: false };
    if (isParticipantReferenced(workspace, participantId)) {
      target.active = false;
      return { workspace, archived: true, found: true };
    }
    workspace.participants = workspace.participants.filter((participant) => participant.id !== participantId);
    return { workspace, archived: false, found: true };
  }

  function calculateSettlements(inputFinances, inputParticipants, options) {
    const participants = (Array.isArray(inputParticipants) ? inputParticipants : []).filter(Boolean);
    const participantMap = new Map(participants.map((participant) => [participant.id, participant]));
    const balancesInCents = new Map(participants.map((participant) => [participant.id, 0]));
    const month = options && /^\d{4}-\d{2}$/.test(String(options.month || '')) ? options.month : null;

    (Array.isArray(inputFinances) ? inputFinances : []).forEach((finance) => {
      if (!finance || finance.type !== 'expense' || !participantMap.has(finance.paidById)) return;
      if (month && !String(finance.date || '').startsWith(month)) return;
      const cents = Math.round(amount(finance.amount) * 100);
      if (cents <= 0) return;
      let sharedIds = unique(finance.splitBetweenIds).filter((participantId) => participantMap.has(participantId));
      if (!sharedIds.length) sharedIds = participants.filter((participant) => participant.active !== false).map((participant) => participant.id);
      if (!sharedIds.length) return;

      balancesInCents.set(finance.paidById, (balancesInCents.get(finance.paidById) || 0) + cents);
      const baseShare = Math.floor(cents / sharedIds.length);
      let remainder = cents - baseShare * sharedIds.length;
      sharedIds.forEach((participantId) => {
        const share = baseShare + (remainder > 0 ? 1 : 0);
        remainder -= remainder > 0 ? 1 : 0;
        balancesInCents.set(participantId, (balancesInCents.get(participantId) || 0) - share);
      });
    });

    const creditors = [];
    const debtors = [];
    balancesInCents.forEach((balance, participantId) => {
      if (balance > 0) creditors.push({ participantId, cents: balance });
      if (balance < 0) debtors.push({ participantId, cents: -balance });
    });
    creditors.sort((a, b) => b.cents - a.cents);
    debtors.sort((a, b) => b.cents - a.cents);

    const transfers = [];
    let creditorIndex = 0;
    let debtorIndex = 0;
    while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
      const creditor = creditors[creditorIndex];
      const debtor = debtors[debtorIndex];
      const cents = Math.min(creditor.cents, debtor.cents);
      if (cents > 0) {
        transfers.push({
          fromId: debtor.participantId,
          toId: creditor.participantId,
          amount: cents / 100,
        });
      }
      creditor.cents -= cents;
      debtor.cents -= cents;
      if (creditor.cents === 0) creditorIndex += 1;
      if (debtor.cents === 0) debtorIndex += 1;
    }

    return {
      balances: participants.map((participant) => ({
        participantId: participant.id,
        amount: (balancesInCents.get(participant.id) || 0) / 100,
      })),
      transfers,
    };
  }

  function materializeRecurring(input, throughMonth) {
    const workspace = normalizeWorkspace(input);
    const current = new Date();
    const fallbackMonth = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
    const targetMonth = /^\d{4}-\d{2}$/.test(String(throughMonth || '')) ? String(throughMonth) : fallbackMonth;
    let added = 0;

    workspace.finances
      .filter((finance) => finance.recurring && !finance.recurringSourceId && finance.date.slice(0, 7) < targetMonth)
      .forEach((source) => {
        const seriesId = source.recurrenceSeriesId || source.id;
        source.recurrenceSeriesId = seriesId;
        source.recurrenceSkippedMonths = unique(source.recurrenceSkippedMonths);
        const [startYear, startMonth] = source.date.slice(0, 7).split('-').map(Number);
        const [endYear, endMonth] = targetMonth.split('-').map(Number);
        const difference = (endYear - startYear) * 12 + (endMonth - startMonth);
        const firstOffset = Math.max(1, difference - 239);

        for (let offset = firstOffset; offset <= difference; offset += 1) {
          const occurrenceDate = new Date(startYear, startMonth - 1 + offset, 1);
          const month = `${occurrenceDate.getFullYear()}-${String(occurrenceDate.getMonth() + 1).padStart(2, '0')}`;
          if (source.recurrenceSkippedMonths.includes(month)) continue;
          const exists = workspace.finances.some((finance) => (
            finance.id !== source.id
            && (finance.recurrenceSeriesId === seriesId || finance.recurringSourceId === source.id)
            && (finance.occurrenceMonth === month || (!finance.occurrenceMonth && finance.date.slice(0, 7) === month))
          ));
          if (exists) continue;
          const desiredDay = Number(source.date.slice(8, 10)) || 1;
          const lastDay = new Date(occurrenceDate.getFullYear(), occurrenceDate.getMonth() + 1, 0).getDate();
          workspace.finances.push({
            ...clone(source),
            id: id('finance'),
            date: `${month}-${String(Math.min(desiredDay, lastDay)).padStart(2, '0')}`,
            recurring: false,
            recurringSourceId: source.id,
            recurrenceSeriesId: seriesId,
            occurrenceMonth: month,
            recurrenceSkippedMonths: [],
            createdAt: nowIso(),
          });
          added += 1;
        }
      });

    return { workspace, added };
  }

  function removeFinance(input, financeId) {
    const workspace = normalizeWorkspace(input);
    const target = workspace.finances.find((finance) => finance.id === financeId);
    if (!target) return { workspace, found: false, skippedOccurrence: false };
    let skippedOccurrence = false;
    if (target.recurringSourceId && target.occurrenceMonth) {
      const source = workspace.finances.find((finance) => finance.id === target.recurringSourceId);
      if (source) {
        source.recurrenceSkippedMonths = unique([...(source.recurrenceSkippedMonths || []), target.occurrenceMonth]);
        skippedOccurrence = true;
      }
    }
    if (target.recurring && !target.recurringSourceId) {
      workspace.finances.forEach((finance) => {
        if (finance.recurringSourceId !== target.id) return;
        finance.recurringSourceId = null;
        finance.recurrenceSeriesId = null;
        finance.occurrenceMonth = null;
        finance.recurrenceSkippedMonths = [];
      });
    }
    workspace.finances = workspace.finances.filter((finance) => finance.id !== financeId);
    return { workspace, found: true, skippedOccurrence };
  }

  function vote(input, decisionId, optionId, participantId) {
    const workspace = normalizeWorkspace(input);
    const participant = workspace.participants.find((item) => item.id === participantId && item.active);
    const decision = workspace.decisions.find((item) => item.id === decisionId && item.status === 'open');
    const option = decision && decision.options.find((item) => item.id === optionId);
    if (!participant || !decision || !option) return { workspace, changed: false };
    const alreadySelected = option.voterIds.includes(participantId);
    decision.options.forEach((item) => {
      item.voterIds = item.voterIds.filter((voterId) => voterId !== participantId);
    });
    if (!alreadySelected) option.voterIds.push(participantId);
    return { workspace, changed: true };
  }

  const api = Object.freeze({
    SCHEMA_VERSION,
    FORMAT,
    MAX_AMOUNT,
    PALETTE,
    CATEGORIES,
    id,
    clone,
    amount,
    date,
    createEmptyWorkspace,
    normalizeWorkspace,
    createParticipant,
    isParticipantReferenced,
    removeParticipant,
    calculateSettlements,
    materializeRecurring,
    removeFinance,
    vote,
  });

  return api;
});
