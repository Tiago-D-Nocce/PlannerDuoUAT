import { describe, expect, it, beforeEach } from 'vitest';
import runtimeModule from '../../public/modules/agents/skill-runtime.js';
import kit from '../../public/modules/skills/skill-kit.js';
import travelSkills from '../../public/modules/skills/travel-skills.js';
import financeSkills from '../../public/modules/skills/finance-skills.js';
import plannerSkills from '../../public/modules/skills/planner-skills.js';
import Core from '../../public/core.js';
import Travel from '../../public/travel.js';

// Expõe o kit no global para os packs (eles o buscam em root.PlannerSkillKit).
globalThis.PlannerSkillKit = kit;
globalThis.PlannerCore = Core;

const { createRuntime } = runtimeModule;

// Catálogo esperado: id -> { agent, kind, exposure }
const EXPECTED = {
  // travel
  'travel.links.build': { agent: 'travel', kind: 'read', exposure: ['chat', 'ui'] },
  'travel.trip.list': { agent: 'travel', kind: 'read', exposure: ['chat', 'ui'] },
  'travel.trip.summary': { agent: 'travel', kind: 'read', exposure: ['chat', 'ui'] },
  'travel.trip.create': { agent: 'travel', kind: 'write', exposure: ['chat', 'ui'] },
  'travel.trip.update': { agent: 'travel', kind: 'write', exposure: ['chat', 'ui'] },
  'travel.trip.delete': { agent: 'travel', kind: 'write', exposure: ['ui'] },
  // finance
  'finance.transaction.create': { agent: 'finance', kind: 'write', exposure: ['chat', 'ui'] },
  'finance.transaction.update': { agent: 'finance', kind: 'write', exposure: ['ui'] },
  'finance.transaction.delete': { agent: 'finance', kind: 'write', exposure: ['ui'] },
  'finance.budget.set': { agent: 'finance', kind: 'write', exposure: ['chat', 'ui'] },
  'finance.budget.delete': { agent: 'finance', kind: 'write', exposure: ['ui'] },
  'finance.goal.create': { agent: 'finance', kind: 'write', exposure: ['chat', 'ui'] },
  'finance.goal.update': { agent: 'finance', kind: 'write', exposure: ['ui'] },
  'finance.goal.fund': { agent: 'finance', kind: 'write', exposure: ['chat', 'ui'] },
  'finance.goal.delete': { agent: 'finance', kind: 'write', exposure: ['ui'] },
  'finance.goal.list': { agent: 'finance', kind: 'read', exposure: ['chat', 'ui'] },
  'finance.summary': { agent: 'finance', kind: 'read', exposure: ['chat', 'ui'] },
  'finance.settlements': { agent: 'finance', kind: 'read', exposure: ['chat', 'ui'] },
  'finance.report': { agent: 'finance', kind: 'read', exposure: ['chat', 'ui'] },
  'finance.recurring.materialize': { agent: 'finance', kind: 'write', exposure: ['ui'] },
  'finance.report.csv': { agent: 'finance', kind: 'read', exposure: ['ui'] },
  // planner
  'planner.checklist.add': { agent: 'planner', kind: 'write', exposure: ['chat', 'ui'] },
  'planner.checklist.update': { agent: 'planner', kind: 'write', exposure: ['ui'] },
  'planner.checklist.toggle': { agent: 'planner', kind: 'write', exposure: ['chat', 'ui'] },
  'planner.checklist.list': { agent: 'planner', kind: 'read', exposure: ['chat', 'ui'] },
  'planner.checklist.delete': { agent: 'planner', kind: 'write', exposure: ['ui'] },
  'planner.checklist.template': { agent: 'planner', kind: 'write', exposure: ['chat', 'ui'] },
  'planner.checklist.clear-completed': { agent: 'planner', kind: 'write', exposure: ['ui'] },
  'planner.decision.create': { agent: 'planner', kind: 'write', exposure: ['chat', 'ui'] },
  'planner.decision.vote': { agent: 'planner', kind: 'write', exposure: ['chat', 'ui'] },
  'planner.decision.close': { agent: 'planner', kind: 'write', exposure: ['chat', 'ui'] },
  'planner.decision.reopen': { agent: 'planner', kind: 'write', exposure: ['chat', 'ui'] },
  'planner.decision.list': { agent: 'planner', kind: 'read', exposure: ['chat', 'ui'] },
  'planner.decision.delete': { agent: 'planner', kind: 'write', exposure: ['ui'] },
  'planner.participant.add': { agent: 'planner', kind: 'write', exposure: ['chat', 'ui'] },
  'planner.participant.remove': { agent: 'planner', kind: 'write', exposure: ['ui'] },
  'planner.participant.update': { agent: 'planner', kind: 'write', exposure: ['ui'] },
  'planner.workspace.rename': { agent: 'planner', kind: 'write', exposure: ['chat', 'ui'] },
  'planner.workspace.setup': { agent: 'planner', kind: 'write', exposure: ['ui'] },
  'planner.workspace.onboarding': { agent: 'planner', kind: 'write', exposure: ['ui'] },
  'planner.workspace.reset': { agent: 'planner', kind: 'write', exposure: ['ui'] },
  'planner.backup.export': { agent: 'planner', kind: 'read', exposure: ['ui'] },
  'planner.backup.import': { agent: 'planner', kind: 'write', exposure: ['ui'] },
  'planner.account.password': { agent: 'planner', kind: 'write', exposure: ['ui'] },
  'planner.account.lock': { agent: 'planner', kind: 'write', exposure: ['ui'] },
  'planner.security.settings': { agent: 'planner', kind: 'read', exposure: ['ui'] },
};

// Skills destrutivas / sensíveis que devem ser somente ui.
const UI_ONLY = [
  'travel.trip.delete', 'finance.transaction.delete', 'finance.budget.delete',
  'finance.goal.delete', 'finance.transaction.update', 'planner.checklist.delete',
  'planner.decision.delete', 'planner.participant.remove', 'planner.workspace.reset',
  'planner.workspace.setup', 'planner.backup.export', 'planner.backup.import',
  'planner.account.password', 'planner.account.lock', 'planner.security.settings',
  'planner.participant.update', 'planner.checklist.clear-completed', 'planner.workspace.onboarding',
];

function freshRuntime() {
  const runtime = createRuntime({ core: Core, travel: Travel, getWorkspace: () => Core.createEmptyWorkspace(), commit: async () => Core.createEmptyWorkspace() });
  const allIds = [];
  allIds.push(...travelSkills.register(runtime));
  allIds.push(...financeSkills.register(runtime));
  allIds.push(...plannerSkills.register(runtime));
  return { runtime, allIds };
}

describe('catálogo de skills', () => {
  let runtime;
  let allIds;
  beforeEach(() => {
    ({ runtime, allIds } = freshRuntime());
  });

  it('registra exatamente o catálogo esperado', () => {
    const registered = runtime.list().map((d) => d.id).sort();
    expect(registered).toEqual(Object.keys(EXPECTED).sort());
  });

  it('ids retornados por register batem com ids exportados', () => {
    expect(allIds.sort()).toEqual([...travelSkills.ids, ...financeSkills.ids, ...plannerSkills.ids].sort());
  });

  it('ids são únicos', () => {
    const set = new Set(allIds);
    expect(set.size).toBe(allIds.length);
  });

  it('cada skill tem agent, kind e exposure corretos', () => {
    for (const [id, expected] of Object.entries(EXPECTED)) {
      const def = runtime.get(id);
      expect(def, `skill ${id} deve existir`).toBeTruthy();
      expect(def.agent, `agent de ${id}`).toBe(expected.agent);
      expect(def.kind, `kind de ${id}`).toBe(expected.kind);
      expect([...def.exposure].sort(), `exposure de ${id}`).toEqual([...expected.exposure].sort());
    }
  });

  it('skills destrutivas/sensíveis são somente ui', () => {
    for (const id of UI_ONLY) {
      const def = runtime.get(id);
      expect(def, `skill ${id}`).toBeTruthy();
      expect(def.exposure, `${id} deve ser ui-only`).toEqual(['ui']);
    }
  });

  it('toda skill chat tem título em pt-BR', () => {
    for (const def of runtime.list()) {
      expect(typeof def.title, `title de ${def.id}`).toBe('string');
      expect(def.title.length).toBeGreaterThan(0);
    }
  });

  it('skills ui-only são invisíveis ao chat (not-found)', async () => {
    for (const id of UI_ONLY) {
      await expect(runtime.invoke(id, {}, { source: 'chat' })).rejects.toMatchObject({ code: 'skill/not-found' });
    }
  });
});
