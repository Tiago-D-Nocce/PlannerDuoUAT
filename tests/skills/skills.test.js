import { describe, expect, it, beforeEach } from 'vitest';
import runtimeModule from '../../public/modules/agents/skill-runtime.js';
import kit from '../../public/modules/skills/skill-kit.js';
import travelSkills from '../../public/modules/skills/travel-skills.js';
import financeSkills from '../../public/modules/skills/finance-skills.js';
import plannerSkills from '../../public/modules/skills/planner-skills.js';
import Core from '../../public/core.js';
import Travel from '../../public/travel.js';

globalThis.PlannerSkillKit = kit;
globalThis.PlannerCore = Core;

const { createRuntime } = runtimeModule;

// Monta runtime com um workspace in-memory e commit real sobre PlannerCore.
function harness(initialWorkspace) {
  let ws = Core.normalizeWorkspace(initialWorkspace || Core.createEmptyWorkspace());
  const commit = async (mutator) => {
    const draft = Core.clone(ws);
    const r = mutator(draft);
    ws = Core.normalizeWorkspace(r && typeof r === 'object' ? r : draft);
    return ws;
  };
  const runtime = createRuntime({
    core: Core,
    travel: Travel,
    getWorkspace: () => ws,
    commit,
  });
  travelSkills.register(runtime);
  financeSkills.register(runtime);
  plannerSkills.register(runtime);
  return {
    runtime,
    get ws() { return ws; },
    set ws(v) { ws = Core.normalizeWorkspace(v); },
    ui: (id, input) => runtime.invoke(id, input, { source: 'ui' }),
    chat: (id, input) => runtime.invoke(id, input, { source: 'chat' }),
  };
}

function seedWorkspace() {
  return Core.normalizeWorkspace({
    name: 'Casa',
    participants: [
      { id: 'p-ana', name: 'Ana', color: '#6366f1', active: true },
      { id: 'p-bob', name: 'Bob', color: '#f97316', active: true },
    ],
    trips: [
      { id: 't-rio', destination: 'Rio de Janeiro', startDate: '2030-01-10', endDate: '2030-01-20', budget: 5000, saved: 1000 },
    ],
    goals: [
      { id: 'g-carro', title: 'Carro novo', target: 40000, current: 10000 },
    ],
    checklist: [
      { id: 'c-doc', text: 'Levar documentos', category: 'documentos', done: false },
    ],
    decisions: [
      { id: 'd-dest', title: 'Para onde viajar', options: [
        { id: 'o-praia', label: 'Praia', voterIds: [] },
        { id: 'o-serra', label: 'Serra', voterIds: [] },
      ] },
    ],
  });
}

describe('validação de entrada', () => {
  let h;
  beforeEach(() => { h = harness(seedWorkspace()); });

  it('rejeita transação sem descrição com skill/invalid-input e field', async () => {
    await expect(h.chat('finance.transaction.create', { type: 'expense', amount: 10 }))
      .rejects.toMatchObject({ code: 'skill/invalid-input', fields: [{ field: 'description' }] });
  });

  it('rejeita valor acima do máximo', async () => {
    await expect(h.chat('finance.transaction.create', { type: 'expense', description: 'x', amount: Core.MAX_AMOUNT + 1 }))
      .rejects.toMatchObject({ code: 'skill/invalid-input' });
  });

  it('rejeita viagem com volta anterior à ida', async () => {
    await expect(h.ui('travel.trip.create', { destination: 'Bahia', startDate: '2030-05-10', endDate: '2030-05-01' }))
      .rejects.toMatchObject({ code: 'skill/invalid-input', fields: [{ field: 'endDate' }] });
  });

  it('decisão exige pelo menos 2 opções distintas', async () => {
    await expect(h.chat('planner.decision.create', { title: 'Teste', options: ['A', 'A'] }))
      .rejects.toMatchObject({ code: 'skill/invalid-input', fields: [{ field: 'options' }] });
  });
});

describe('recibos com before/after', () => {
  let h;
  beforeEach(() => { h = harness(seedWorkspace()); });

  it('trip.create retorna recibo com before null e after preenchido', async () => {
    const receipt = await h.chat('travel.trip.create', { destination: 'Salvador', budget: 3000 });
    expect(receipt.entity).toBe('trip');
    expect(receipt.collection).toBe('trips');
    expect(receipt.action).toBe('create');
    expect(receipt.before).toBeNull();
    expect(receipt.after).toMatchObject({ destination: 'Salvador', budget: 3000 });
    expect(h.ws.trips.some((t) => t.destination === 'Salvador')).toBe(true);
  });

  it('goal.fund soma ao valor atual e expõe before/after', async () => {
    const receipt = await h.chat('finance.goal.fund', { goalRef: 'Carro', amount: 5000 });
    expect(receipt.before.current).toBe(10000);
    expect(receipt.after.current).toBe(15000);
  });

  it('goal.fund faz clamp em MAX_AMOUNT', async () => {
    const receipt = await h.chat('finance.goal.fund', { goalRef: 'g-carro', amount: Core.MAX_AMOUNT });
    expect(receipt.after.current).toBe(Core.MAX_AMOUNT);
  });

  it('transaction.delete retorna before e remove', async () => {
    const create = await h.ui('finance.transaction.create', {
      type: 'expense', description: 'Mercado', amount: 100, splitBetweenIds: ['p-ana', 'p-bob'], paidById: 'p-ana',
    });
    const del = await h.ui('finance.transaction.delete', { id: create.id });
    expect(del.before).toMatchObject({ description: 'Mercado' });
    expect(del.after).toBeNull();
    expect(h.ws.finances.some((f) => f.id === create.id)).toBe(false);
  });

  it('entity-conflict quando a entidade some antes do update', async () => {
    const create = await h.ui('finance.goal.create', { title: 'Temp', target: 100 });
    // remove direto do ws
    h.ws = { ...h.ws, goals: h.ws.goals.filter((g) => g.id !== create.id) };
    await expect(h.ui('finance.goal.update', { id: create.id, title: 'Novo', target: 200 }))
      .rejects.toMatchObject({ code: 'local/entity-conflict' });
  });
});

describe('resolução de referências', () => {
  let h;
  beforeEach(() => { h = harness(seedWorkspace()); });

  it('resolve viagem por substring', async () => {
    const summary = await h.chat('travel.trip.summary', { tripRef: 'rio' });
    expect(summary.destination).toBe('Rio de Janeiro');
  });

  it('ambíguo retorna erro listando candidatos', async () => {
    h.ws = { ...h.ws, trips: [
      { id: 't-1', destination: 'Rio Branco' },
      { id: 't-2', destination: 'Rio de Janeiro' },
    ] };
    await expect(h.chat('travel.trip.summary', { tripRef: 'rio' }))
      .rejects.toMatchObject({ code: 'skill/invalid-input' });
  });

  it("participante 'eu' resolve ao único ativo quando há um só", async () => {
    h.ws = Core.normalizeWorkspace({ participants: [{ id: 'p-solo', name: 'Solo', active: true }] });
    const r = kit.resolveParticipant(h.ws, 'eu');
    expect(r.ok).toBe(true);
    expect(r.value.id).toBe('p-solo');
  });

  it("participante 'eu' é ambíguo com dois ativos", () => {
    const r = kit.resolveParticipant(seedWorkspace(), 'me');
    expect(r.ok).toBe(false);
  });

  it('voto sem decisionRef usa a única decisão aberta com a opção', async () => {
    const receipt = await h.chat('planner.decision.vote', { optionRef: 'Praia', voterRef: 'Ana' });
    expect(receipt.action).toBe('vote');
    const decision = h.ws.decisions.find((d) => d.id === 'd-dest');
    const praia = decision.options.find((o) => o.id === 'o-praia');
    expect(praia.voterIds).toContain('p-ana');
  });
});

describe('somas de resumo e acertos', () => {
  let h;
  beforeEach(() => { h = harness(seedWorkspace()); });

  it('summary soma receitas, despesas e saldo do mês', async () => {
    await h.ui('finance.transaction.create', { type: 'income', description: 'Salário', amount: 3000, date: '2030-03-05' });
    await h.ui('finance.transaction.create', { type: 'expense', description: 'Luz', amount: 200, date: '2030-03-10', splitBetweenIds: ['p-ana'], paidById: 'p-ana', category: 'moradia' });
    const summary = await h.chat('finance.summary', { month: '2030-03' });
    expect(summary.income).toBe(3000);
    expect(summary.expense).toBe(200);
    expect(summary.balance).toBe(2800);
    expect(summary.byCategory.moradia).toBe(200);
  });

  it('settlements usa nomes de participantes', async () => {
    await h.ui('finance.transaction.create', { type: 'expense', description: 'Jantar', amount: 100, date: '2030-04-10', splitBetweenIds: ['p-ana', 'p-bob'], paidById: 'p-ana' });
    const result = await h.chat('finance.settlements', { month: '2030-04' });
    expect(result.transfers.length).toBe(1);
    expect(result.transfers[0]).toMatchObject({ from: 'Bob', to: 'Ana', amount: 50 });
  });
});

describe('links idênticos ao PlannerTravel.build', () => {
  let h;
  beforeEach(() => { h = harness(seedWorkspace()); });

  it('cada link bate com Travel.build para o mesmo input', async () => {
    const input = { origin: 'São Paulo', destination: 'Rio de Janeiro', departDate: '2030-01-10', returnDate: '2030-01-20', adults: 2 };
    const out = await h.chat('travel.links.build', input);
    const refDate = kit.today(Date.now());
    const searchInput = { origin: input.origin, destination: input.destination, departure: input.departDate, returnDate: input.returnDate, passengers: input.adults };
    for (const link of out.links) {
      const built = Travel.build(link.providerId, searchInput, refDate);
      expect(link.url).toBe(built.url);
      expect(link.mode).toBe(built.mode);
    }
  });

  it('filtra por grupo flights', async () => {
    const out = await h.chat('travel.links.build', { destination: 'Rio', group: 'flights', adults: 1 });
    const flightIds = new Set(Travel.providers.filter((p) => p.group === 'flights').map((p) => p.id));
    for (const link of out.links) expect(flightIds.has(link.providerId)).toBe(true);
  });
});

describe('divisão de despesa chat vs ui', () => {
  it('chat divide com todos os ativos quando não informado', async () => {
    const h = harness(seedWorkspace());
    const receipt = await h.chat('finance.transaction.create', { type: 'expense', description: 'Feira', amount: 60, paidById: 'p-ana' });
    expect(receipt.after.splitBetweenIds.sort()).toEqual(['p-ana', 'p-bob']);
  });

  it('ui exige seleção quando há participantes ativos', async () => {
    const h = harness(seedWorkspace());
    await expect(h.ui('finance.transaction.create', { type: 'expense', description: 'Feira', amount: 60, paidById: 'p-ana' }))
      .rejects.toMatchObject({ code: 'skill/invalid-input', fields: [{ field: 'splitBetweenIds' }] });
  });
});

describe('recorrência materializa no mesmo commit', () => {
  it('cria ocorrências passadas ao registrar despesa recorrente', async () => {
    const h = harness(seedWorkspace());
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    const past = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
    const receipt = await h.ui('finance.transaction.create', {
      type: 'expense', description: 'Aluguel', amount: 1000, date: past,
      splitBetweenIds: ['p-ana'], paidById: 'p-ana', recurring: true,
    });
    // Deve existir a fonte + ao menos uma ocorrência materializada até o mês atual.
    const series = h.ws.finances.filter((f) => f.recurrenceSeriesId === receipt.id || f.id === receipt.id);
    expect(series.length).toBeGreaterThan(1);
  });
});

describe('CSV com proteção contra injeção de fórmula', () => {
  it('neutraliza células começando com =', async () => {
    const h = harness(seedWorkspace());
    await h.ui('finance.transaction.create', {
      type: 'expense', description: '=SUM(A1:A2)', amount: 10, date: '2030-02-01',
      splitBetweenIds: ['p-ana'], paidById: 'p-ana',
    });
    const out = await h.ui('finance.report.csv', { month: '2030-02' });
    expect(out.csv).toContain("'=SUM(A1:A2)");
    expect(out.count).toBe(1);
  });
});

describe('skills novas (worker)', () => {
  let h;
  beforeEach(() => { h = harness(seedWorkspace()); });

  it('participant.update renomeia e devolve recibo before/after', async () => {
    const receipt = await h.ui('planner.participant.update', { id: 'p-ana', name: 'Aninha' });
    expect(receipt.entity).toBe('participant');
    expect(receipt.collection).toBe('participants');
    expect(receipt.action).toBe('update');
    expect(receipt.before.name).toBe('Ana');
    expect(receipt.after.name).toBe('Aninha');
    expect(h.ws.participants.find((p) => p.id === 'p-ana').name).toBe('Aninha');
  });

  it('participant.update arquiva/reativa via active', async () => {
    const receipt = await h.ui('planner.participant.update', { id: 'p-bob', active: false });
    expect(receipt.after.active).toBe(false);
    expect(h.ws.participants.find((p) => p.id === 'p-bob').active).toBe(false);
    const back = await h.ui('planner.participant.update', { id: 'p-bob', active: true });
    expect(back.after.active).toBe(true);
  });

  it('participant.update recusa cor inválida com field color', async () => {
    await expect(h.ui('planner.participant.update', { id: 'p-ana', color: 'azul' }))
      .rejects.toMatchObject({ code: 'skill/invalid-input', fields: [{ field: 'color' }] });
  });

  it('participant.update exige ao menos um campo', async () => {
    await expect(h.ui('planner.participant.update', { id: 'p-ana' }))
      .rejects.toMatchObject({ code: 'skill/invalid-input' });
  });

  it('participant.update em id inexistente dá entity-conflict', async () => {
    await expect(h.ui('planner.participant.update', { id: 'p-x', name: 'X' }))
      .rejects.toMatchObject({ code: 'local/entity-conflict' });
  });

  it('checklist.template adiciona itens novos e devolve ids+after', async () => {
    const receipt = await h.chat('planner.checklist.template', {});
    expect(receipt.action).toBe('create');
    expect(Array.isArray(receipt.id)).toBe(true);
    expect(receipt.id.length).toBe(6);
    expect(Array.isArray(receipt.after)).toBe(true);
    expect(receipt.after.length).toBe(6);
    expect(h.ws.checklist.some((c) => c.text === 'Carregador do celular')).toBe(true);
  });

  it('checklist.template pula duplicados pelo texto', async () => {
    h.ws = { ...h.ws, checklist: [
      ...h.ws.checklist,
      { id: 'c-x', text: 'Itens de higiene', category: 'higiene', done: false },
    ] };
    const receipt = await h.chat('planner.checklist.template', {});
    expect(receipt.id.length).toBe(5);
    const higiene = h.ws.checklist.filter((c) => c.text === 'Itens de higiene');
    expect(higiene.length).toBe(1);
  });

  it('checklist.template sem novidades devolve lista vazia', async () => {
    await h.chat('planner.checklist.template', {});
    const receipt = await h.chat('planner.checklist.template', {});
    expect(receipt.id).toEqual([]);
    expect(receipt.after).toEqual([]);
  });

  it('checklist.template vincula tripId quando informado', async () => {
    const receipt = await h.ui('planner.checklist.template', { tripId: 't-rio' });
    expect(receipt.after.every((c) => c.tripId === 't-rio')).toBe(true);
  });

  it('checklist.clear-completed remove só os concluídos e devolve before', async () => {
    await h.ui('planner.checklist.update', { id: 'c-doc', text: 'Levar documentos' });
    await h.chat('planner.checklist.toggle', { itemRef: 'c-doc', done: true });
    const receipt = await h.ui('planner.checklist.clear-completed', {});
    expect(receipt.action).toBe('delete');
    expect(Array.isArray(receipt.id)).toBe(true);
    expect(receipt.id).toContain('c-doc');
    expect(receipt.after).toBeNull();
    expect(h.ws.checklist.some((c) => c.id === 'c-doc')).toBe(false);
  });

  it('workspace.onboarding alterna o flag', async () => {
    const done = await h.ui('planner.workspace.onboarding', { completed: true });
    expect(done.after).toBe(true);
    expect(h.ws.settings.onboardingCompleted).toBe(true);
    const reopen = await h.ui('planner.workspace.onboarding', { completed: false });
    expect(reopen.after).toBe(false);
    expect(h.ws.settings.onboardingCompleted).toBe(false);
  });

  it('workspace.onboarding exige completed', async () => {
    await expect(h.ui('planner.workspace.onboarding', {}))
      .rejects.toMatchObject({ code: 'skill/invalid-input', fields: [{ field: 'completed' }] });
  });

  it('goal.list calcula percent/remaining e ordena por deadline depois título', async () => {
    h.ws = Core.normalizeWorkspace({
      goals: [
        { id: 'g-b', title: 'Beta', target: 1000, current: 1000, deadline: '2031-05-01' },
        { id: 'g-a', title: 'Alfa', target: 1000, current: 250, deadline: '2030-01-01' },
        { id: 'g-c', title: 'Gama', target: 1000, current: 500 },
      ],
    });
    const list = await h.chat('finance.goal.list', { status: 'all' });
    expect(list.map((g) => g.id)).toEqual(['g-a', 'g-b', 'g-c']);
    const alfa = list.find((g) => g.id === 'g-a');
    expect(alfa.percent).toBe(25);
    expect(alfa.remaining).toBe(750);
    expect(list.find((g) => g.id === 'g-b').reached).toBe(true);
  });

  it('goal.list filtra por status active/reached', async () => {
    h.ws = Core.normalizeWorkspace({
      goals: [
        { id: 'g-done', title: 'Feita', target: 100, current: 100 },
        { id: 'g-open', title: 'Aberta', target: 100, current: 10 },
      ],
    });
    const active = await h.chat('finance.goal.list', { status: 'active' });
    expect(active.map((g) => g.id)).toEqual(['g-open']);
    const reached = await h.chat('finance.goal.list', { status: 'reached' });
    expect(reached.map((g) => g.id)).toEqual(['g-done']);
  });

  it('goal.list rejeita status inválido', async () => {
    await expect(h.chat('finance.goal.list', { status: 'xpto' }))
      .rejects.toMatchObject({ code: 'skill/invalid-input', fields: [{ field: 'status' }] });
  });
});

describe('skills novas são destrutivas/sensíveis somente ui', () => {
  it('clear-completed, participant.update e onboarding não existem no chat', async () => {
    const h = harness(seedWorkspace());
    for (const id of ['planner.checklist.clear-completed', 'planner.participant.update', 'planner.workspace.onboarding']) {
      await expect(h.chat(id, {})).rejects.toMatchObject({ code: 'skill/not-found' });
    }
  });
});
