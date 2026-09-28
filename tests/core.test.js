import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import core from '../public/core.js';

function participant(name, index) {
  return core.createParticipant({ name, color: core.PALETTE[index % core.PALETTE.length] }, index);
}

function expense({ id = 'expense-1', paidById, splitBetweenIds, amount = 100, date = '2026-09-15' }) {
  return {
    id,
    type: 'expense',
    description: 'Despesa compartilhada',
    amount,
    date,
    category: 'outros',
    paidById,
    splitBetweenIds,
    tripId: null,
    notes: '',
    recurring: false,
    recurringSourceId: null,
    createdAt: '2026-09-15T12:00:00.000Z',
  };
}

describe('workspace local vazio', () => {
  it('nasce sem perfis e sem dados de demonstração', () => {
    const workspace = core.createEmptyWorkspace();
    expect(workspace.schemaVersion).toBe(core.SCHEMA_VERSION);
    expect(workspace.name).toBe('');
    expect(workspace.participants).toEqual([]);
    expect(workspace.finances).toEqual([]);
    expect(workspace.trips).toEqual([]);
    expect(workspace.goals).toEqual([]);
    expect(workspace.checklist).toEqual([]);
    expect(workspace.decisions).toEqual([]);
    expect(workspace.budgets).toEqual({});
  });

  it('normaliza entradas malformadas sem propagar valores inválidos', () => {
    const normalized = core.normalizeWorkspace({
      name: '  Espaço livre  ',
      participants: [null, { name: '  Alex  ', color: 'inválida' }],
      finances: [
        { description: '', amount: 'abc', date: 'x' },
        { type: 'income', description: 'Entrada', amount: '1.234,56', date: '2026-09-01', category: 'salario' },
      ],
      budgets: { lazer: '500,50', desconhecida: 10, saude: -1 },
    });
    expect(normalized.name).toBe('Espaço livre');
    expect(normalized.participants).toHaveLength(1);
    expect(normalized.participants[0].name).toBe('Alex');
    expect(normalized.participants[0].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(normalized.finances).toHaveLength(1);
    expect(normalized.finances[0].amount).toBe(1234.56);
    expect(normalized.budgets).toEqual({ lazer: 500.5 });
  });

  it('preserva participantes com nomes iguais por seus IDs estáveis', () => {
    const first = participant('Alex', 0);
    const second = participant('Alex', 1);
    const normalized = core.normalizeWorkspace({ participants: [first, second] });
    expect(normalized.participants.map((item) => item.name)).toEqual(['Alex', 'Alex']);
    expect(new Set(normalized.participants.map((item) => item.id)).size).toBe(2);
  });
});

describe('valores monetários', () => {
  it('aceita formatos decimal e brasileiro', () => {
    expect(core.amount('100.50')).toBe(100.5);
    expect(core.amount('1.234,56')).toBe(1234.56);
    expect(core.amount('0,01')).toBe(0.01);
    expect(core.amount(Number.MAX_VALUE)).toBe(0);
  });

  it('nunca devolve NaN ou valor negativo', () => {
    fc.assert(fc.property(fc.anything(), (value) => {
      expect(Number.isFinite(core.amount(value))).toBe(true);
      expect(core.amount(value)).toBeGreaterThanOrEqual(0);
    }));
  });
});

describe('acerto entre quantidade livre de participantes', () => {
  it('divide centavos sem criar ou perder dinheiro', () => {
    const people = [participant('A', 0), participant('B', 1), participant('C', 2)];
    const result = core.calculateSettlements([
      expense({ paidById: people[0].id, splitBetweenIds: people.map((item) => item.id), amount: 100 }),
    ], people, { month: '2026-09' });

    expect(result.balances.map((item) => item.amount)).toEqual([66.66, -33.33, -33.33]);
    expect(result.transfers.map((item) => item.amount)).toEqual([33.33, 33.33]);
  });

  it('respeita exatamente o subconjunto escolhido no lançamento', () => {
    const people = [participant('A', 0), participant('B', 1), participant('C', 2)];
    const result = core.calculateSettlements([
      expense({ paidById: people[0].id, splitBetweenIds: [people[1].id, people[2].id], amount: 90 }),
    ], people, { month: '2026-09' });
    expect(result.balances.map((item) => item.amount)).toEqual([90, -45, -45]);
  });

  it('mantém a soma dos saldos em zero para grupos de 2 a 8 pessoas', () => {
    fc.assert(fc.property(
      fc.integer({ min: 2, max: 8 }),
      fc.integer({ min: 1, max: 1_000_000 }),
      (count, cents) => {
        const people = Array.from({ length: count }, (_, index) => participant(`Nome ${index}`, index));
        const result = core.calculateSettlements([
          expense({ paidById: people[0].id, splitBetweenIds: people.map((item) => item.id), amount: cents / 100 }),
        ], people, { month: '2026-09' });
        const sumInCents = result.balances.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
        expect(sumInCents).toBe(0);
      }
    ));
  });

  it('ignora outros meses quando o período é informado', () => {
    const people = [participant('A', 0), participant('B', 1)];
    const result = core.calculateSettlements([
      expense({ paidById: people[0].id, splitBetweenIds: people.map((item) => item.id), date: '2026-08-10' }),
    ], people, { month: '2026-09' });
    expect(result.transfers).toEqual([]);
  });
});

describe('participantes e decisões', () => {
  it('remove quem não tem histórico e arquiva quem está referenciado', () => {
    const first = participant('A', 0);
    const second = participant('B', 1);
    const workspace = core.normalizeWorkspace({
      participants: [first, second],
      finances: [expense({ paidById: first.id, splitBetweenIds: [first.id, second.id] })],
    });

    const referenced = core.removeParticipant(workspace, first.id);
    expect(referenced.archived).toBe(true);
    expect(referenced.workspace.participants.find((item) => item.id === first.id).active).toBe(false);

    const unusedWorkspace = core.normalizeWorkspace({ participants: [first, second] });
    const unused = core.removeParticipant(unusedWorkspace, second.id);
    expect(unused.archived).toBe(false);
    expect(unused.workspace.participants.some((item) => item.id === second.id)).toBe(false);
  });

  it('mantém no máximo um voto por participante e permite trocar ou retirar', () => {
    const voter = participant('Votante', 0);
    let workspace = core.normalizeWorkspace({
      participants: [voter],
      decisions: [{
        id: 'decision-1', title: 'Escolha', status: 'open',
        options: [
          { id: 'option-a', label: 'A', voterIds: [] },
          { id: 'option-b', label: 'B', voterIds: [] },
        ],
      }],
    });

    workspace = core.vote(workspace, 'decision-1', 'option-a', voter.id).workspace;
    workspace = core.vote(workspace, 'decision-1', 'option-b', voter.id).workspace;
    expect(workspace.decisions[0].options.map((item) => item.voterIds)).toEqual([[], [voter.id]]);

    workspace = core.vote(workspace, 'decision-1', 'option-b', voter.id).workspace;
    expect(workspace.decisions[0].options.map((item) => item.voterIds)).toEqual([[], []]);
  });

  it('não aceita voto de participante arquivado ou em decisão encerrada', () => {
    const voter = { ...participant('Votante', 0), active: false };
    const workspace = core.normalizeWorkspace({
      participants: [voter],
      decisions: [{
        id: 'decision-1', title: 'Escolha', status: 'closed',
        options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      }],
    });
    expect(core.vote(workspace, 'decision-1', 'a', voter.id).changed).toBe(false);
  });
});

describe('recorrência mensal', () => {
  it('materializa todos os meses ausentes e respeita ocorrências removidas', () => {
    const payer = participant('Pagador', 0);
    let workspace = core.normalizeWorkspace({
      participants: [payer],
      finances: [{
        ...expense({ id: 'series-1', paidById: payer.id, splitBetweenIds: [payer.id], amount: 49.9, date: '2026-01-31' }),
        recurring: true,
        recurrenceSeriesId: 'series-1',
        recurrenceSkippedMonths: [],
      }],
    });

    let result = core.materializeRecurring(workspace, '2026-04');
    expect(result.added).toBe(3);
    expect(result.workspace.finances.map((item) => item.date).sort()).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30',
    ]);

    const march = result.workspace.finances.find((item) => item.occurrenceMonth === '2026-03');
    workspace = core.removeFinance(result.workspace, march.id).workspace;
    expect(workspace.finances.find((item) => item.id === 'series-1').recurrenceSkippedMonths).toContain('2026-03');

    result = core.materializeRecurring(workspace, '2026-04');
    expect(result.added).toBe(0);
    expect(result.workspace.finances.some((item) => item.occurrenceMonth === '2026-03')).toBe(false);
  });
});

describe('competência de recorrência', () => {
  it('não usa a data editada de uma ocorrência para suprimir o mês seguinte', () => {
    const payer = participant('Pagador', 0);
    let workspace = core.normalizeWorkspace({
      participants: [payer],
      finances: [{
        ...expense({ id: 'series-move', paidById: payer.id, splitBetweenIds: [payer.id], date: '2026-01-10' }),
        recurring: true,
        recurrenceSeriesId: 'series-move',
        recurrenceSkippedMonths: [],
      }],
    });
    workspace = core.materializeRecurring(workspace, '2026-03').workspace;
    const march = workspace.finances.find((item) => item.occurrenceMonth === '2026-03');
    march.date = '2026-04-15';

    const result = core.materializeRecurring(workspace, '2026-04');
    expect(result.added).toBe(1);
    expect(result.workspace.finances.filter((item) => item.occurrenceMonth === '2026-04')).toHaveLength(1);
  });
});

describe('encerramento de série recorrente', () => {
  it('desanexa ocorrências históricas ao excluir a fonte', () => {
    const payer = participant('Pagador', 0);
    let workspace = core.normalizeWorkspace({
      participants: [payer],
      finances: [{
        ...expense({ id: 'series-delete', paidById: payer.id, splitBetweenIds: [payer.id], date: '2026-01-10' }),
        recurring: true,
        recurrenceSeriesId: 'series-delete',
        recurrenceSkippedMonths: [],
      }],
    });
    workspace = core.materializeRecurring(workspace, '2026-03').workspace;
    workspace = core.removeFinance(workspace, 'series-delete').workspace;

    expect(workspace.finances).toHaveLength(2);
    expect(workspace.finances.every((item) => item.recurringSourceId === null)).toBe(true);
    expect(workspace.finances.every((item) => item.recurrenceSeriesId === null)).toBe(true);
    expect(workspace.finances.every((item) => item.occurrenceMonth === null)).toBe(true);
  });
});
