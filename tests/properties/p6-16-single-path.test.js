import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
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

function baseWorkspace() {
  return Core.normalizeWorkspace({
    name: 'Base',
    participants: [
      { id: 'p-ana', name: 'Ana', color: '#6366f1', active: true },
      { id: 'p-bob', name: 'Bob', color: '#f97316', active: true },
    ],
    trips: [{ id: 't-rio', destination: 'Rio', startDate: '2030-01-10', endDate: '2030-01-20', budget: 5000, saved: 0 }],
    goals: [{ id: 'g-carro', title: 'Carro', target: 40000, current: 1000 }],
    checklist: [{ id: 'c-doc', text: 'Documentos', category: 'documentos', done: false }],
    decisions: [{ id: 'd-dest', title: 'Destino', options: [
      { id: 'o-praia', label: 'Praia', voterIds: [] },
      { id: 'o-serra', label: 'Serra', voterIds: [] },
    ] }],
  });
}

function harness(initial) {
  let ws = Core.normalizeWorkspace(initial);
  const commit = async (mutator) => {
    const draft = Core.clone(ws);
    const r = mutator(draft);
    ws = Core.normalizeWorkspace(r && typeof r === 'object' ? r : draft);
    return ws;
  };
  const runtime = createRuntime({ core: Core, travel: Travel, getWorkspace: () => ws, commit });
  travelSkills.register(runtime);
  financeSkills.register(runtime);
  plannerSkills.register(runtime);
  return { runtime, get ws() { return ws; } };
}

// Remove ids e timestamps gerados para comparar o resultado estrutural.
function sanitize(ws) {
  const clone = Core.clone(ws);
  const scrubCommon = (o) => {
    if (!o || typeof o !== 'object') return;
    delete o.id;
    delete o.createdAt;
    delete o.updatedAt;
    delete o.closedAt;
    delete o.generation;
    delete o.revision;
    delete o.recurrenceSeriesId;
    delete o.recurringSourceId;
  };
  scrubCommon(clone);
  ['participants', 'finances', 'trips', 'goals', 'checklist'].forEach((col) => {
    (clone[col] || []).forEach(scrubCommon);
  });
  (clone.decisions || []).forEach((d) => {
    scrubCommon(d);
    (d.options || []).forEach((o) => { delete o.id; });
  });
  return clone;
}

// Catálogo de skills chat-write com geradores de inputs válidos e determinísticos
// (sem divergência conhecida entre ui e chat).
const CHAT_WRITE_CASES = {
  'travel.trip.create': fc.record({
    destination: fc.constantFrom('Bahia', 'Salvador', 'Recife'),
    budget: fc.integer({ min: 0, max: 10000 }),
  }),
  'travel.trip.update': fc.record({
    tripRef: fc.constant('t-rio'),
    destination: fc.constantFrom('Rio Atualizado', 'Niterói'),
    budget: fc.integer({ min: 100, max: 9000 }),
  }),
  'finance.transaction.create': fc.record({
    type: fc.constantFrom('expense', 'income'),
    description: fc.constantFrom('Mercado', 'Luz', 'Água'),
    amount: fc.integer({ min: 1, max: 5000 }),
    date: fc.constantFrom('2030-03-10', '2030-04-01'),
    paidById: fc.constant('p-ana'),
    // divisão sempre explícita → ui e chat idênticos
    splitBetweenIds: fc.constant(['p-ana', 'p-bob']),
    category: fc.constantFrom('alimentacao', 'moradia', 'outros'),
  }),
  'finance.budget.set': fc.record({
    category: fc.constantFrom('alimentacao', 'transporte', 'lazer'),
    amount: fc.integer({ min: 1, max: 3000 }),
  }),
  'finance.goal.create': fc.record({
    title: fc.constantFrom('Viagem', 'Reserva', 'Casa'),
    target: fc.integer({ min: 1, max: 50000 }),
    current: fc.integer({ min: 0, max: 1000 }),
  }),
  'finance.goal.fund': fc.record({
    goalRef: fc.constant('g-carro'),
    amount: fc.integer({ min: 1, max: 5000 }),
  }),
  'planner.checklist.add': fc.record({
    text: fc.constantFrom('Comprar protetor', 'Reservar hotel', 'Trocar dinheiro'),
    category: fc.constantFrom('documentos', 'roupas', 'outros'),
  }),
  'planner.checklist.toggle': fc.record({
    itemRef: fc.constant('c-doc'),
    done: fc.boolean(),
  }),
  'planner.decision.create': fc.record({
    title: fc.constantFrom('Qual destino', 'Qual data'),
    options: fc.constant(['Opção A', 'Opção B', 'Opção C']),
  }),
  'planner.decision.vote': fc.record({
    decisionRef: fc.constant('d-dest'),
    optionRef: fc.constantFrom('Praia', 'Serra'),
    voterRef: fc.constantFrom('Ana', 'Bob'),
  }),
  'planner.decision.close': fc.record({ decisionRef: fc.constant('d-dest') }),
  'planner.decision.reopen': fc.record({ decisionRef: fc.constant('d-dest') }),
  'planner.participant.add': fc.record({
    name: fc.constantFrom('Carla', 'Davi', 'Elena'),
  }),
  'planner.workspace.rename': fc.record({
    name: fc.constantFrom('Nova Casa', 'Família'),
  }),
};

const UI_ONLY_IDS = [
  'travel.trip.delete', 'finance.transaction.update', 'finance.transaction.delete',
  'finance.budget.delete', 'finance.goal.update', 'finance.goal.delete',
  'finance.recurring.materialize', 'finance.report.csv',
  'planner.checklist.update', 'planner.checklist.delete', 'planner.decision.delete',
  'planner.participant.remove', 'planner.workspace.setup', 'planner.workspace.reset',
  'planner.backup.export', 'planner.backup.import', 'planner.account.password',
  'planner.account.lock', 'planner.security.settings',
  'planner.participant.update', 'planner.checklist.clear-completed', 'planner.workspace.onboarding',
];

describe('Property 6.16 — caminho único (ui ≡ chat)', () => {
  for (const [id, arb] of Object.entries(CHAT_WRITE_CASES)) {
    it(`${id}: ui e chat produzem o mesmo workspace normalizado`, async () => {
      await fc.assert(
        fc.asyncProperty(arb, async (input) => {
          const hUi = harness(baseWorkspace());
          const hChat = harness(baseWorkspace());
          await hUi.runtime.invoke(id, Core.clone(input), { source: 'ui' });
          await hChat.runtime.invoke(id, Core.clone(input), { source: 'chat' });
          expect(sanitize(hChat.ws)).toEqual(sanitize(hUi.ws));
        }),
        { numRuns: 100 },
      );
    });
  }

  it('skills ui-only sempre rejeitam no chat com skill/not-found', async () => {
    const h = harness(baseWorkspace());
    for (const id of UI_ONLY_IDS) {
      await expect(h.runtime.invoke(id, {}, { source: 'chat' })).rejects.toMatchObject({ code: 'skill/not-found' });
    }
  });
});
