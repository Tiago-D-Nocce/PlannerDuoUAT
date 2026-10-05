import { describe, expect, it } from 'vitest';
import runtimeModule from '../../public/modules/agents/skill-runtime.js';
import orchestratorModule from '../../public/modules/agents/orchestrator.js';
import nlu from '../../public/modules/agents/nlu.js';
import places from '../../public/modules/agents/places.js';
import kit from '../../public/modules/skills/skill-kit.js';
import financeSkills from '../../public/modules/skills/finance-skills.js';
import plannerSkills from '../../public/modules/skills/planner-skills.js';
import Core from '../../public/core.js';

globalThis.PlannerSkillKit = kit;
globalThis.PlannerCore = Core;
globalThis.PlannerPlaces = places;

const { createRuntime } = runtimeModule;
const PARSE_NOW = new Date(2026, 8, 29, 12, 0, 0).getTime();

// Relógio controlável: now fixo para o NLU, timers manuais para delays de skills.
function makeClock() {
  let now = PARSE_NOW;
  const timers = new Map();
  let seq = 0;
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    advance(ms) {
      const target = now + ms;
      let guard = 0;
      while (guard++ < 10000) {
        let next = null;
        for (const [id, t] of timers) { if (t.at <= target && (next === null || t.at < next.at)) next = { id, ...t }; }
        if (!next) break;
        now = next.at;
        timers.delete(next.id);
        next.fn();
      }
      now = target;
    },
  };
}

function baseWorkspace() {
  return Core.normalizeWorkspace({
    name: 'Casa',
    participants: [
      { id: 'p-ana', name: 'Ana', color: '#6366f1', active: true },
      { id: 'p-bob', name: 'Bob', color: '#f97316', active: true },
    ],
    trips: [{ id: 't-rio', destination: 'Rio de Janeiro', startDate: '2030-01-10', endDate: '2030-01-20', budget: 5000, saved: 0 }],
    goals: [{ id: 'g-carro', title: 'Carro novo', target: 40000, current: 10000 }],
    checklist: [{ id: 'c-doc', text: 'Levar documentos', category: 'documentos', done: false }],
    decisions: [{ id: 'd-dest', title: 'Destino', options: [
      { id: 'o-praia', label: 'Praia', voterIds: [] },
      { id: 'o-serra', label: 'Serra', voterIds: [] },
    ] }],
  });
}

// Ambiente: runtime real + skills reais de finanças/planner, skills de viagem falsas
// (links rápido, voos lento controlável) e o orquestrador com coletores de eventos.
function harness(custom) {
  const cfg = custom || {};
  let ws = Core.normalizeWorkspace(cfg.workspace || baseWorkspace());
  const commit = async (mutator) => {
    const draft = Core.clone(ws);
    const r = mutator(draft);
    ws = Core.normalizeWorkspace(r && typeof r === 'object' ? r : draft);
    return ws;
  };
  const clock = makeClock();
  const runtime = createRuntime({ core: Core, getWorkspace: () => ws, commit, clock });

  // reais: finanças e planner (recibos com before/after para undo).
  financeSkills.register(runtime);
  if (!cfg.skipPlanner) plannerSkills.register(runtime);

  // falsas: links de viagem (rápido).
  runtime.define({
    id: 'travel.links.build', agent: 'travel', kind: 'read', exposure: ['chat', 'ui'], timeoutMs: 2000,
    title: 'Links',
    validate: (i) => (i && i.destination
      ? kit.ok({ destination: String(i.destination), group: i.group || 'all' })
      : kit.invalid(kit.fieldError('destination', 'Para onde?'))),
    run: (v) => ({ links: [{ providerId: 'g', name: 'Google', group: v.group, url: 'https://x/' + v.destination }], skipped: [] }),
  });
  runtime.define({
    id: 'travel.trip.list', agent: 'travel', kind: 'read', exposure: ['chat', 'ui'], timeoutMs: 1000,
    title: 'Viagens', validate: () => kit.ok({ status: 'all' }), run: () => ws.trips.map((t) => ({ id: t.id, destination: t.destination })),
  });
  const delays = cfg.slowDelays || {};
  if (cfg.slowFlights) {
    runtime.define({
      id: 'travel.flights.search', agent: 'travel', kind: 'read', exposure: ['chat', 'ui'], timeoutMs: 6000,
      title: 'Voos', validate: (i) => kit.ok({ destination: String(i.destination || '') }),
      run: (v) => new Promise((resolve) => { clock.setTimeout(() => resolve({ offers: [{ to: v.destination }] }), delays.flights != null ? delays.flights : 500); }),
    });
  }

  const orch = orchestratorModule.create({
    runtime,
    nlu,
    places,
    clock,
    aiEnabled: cfg.aiEnabled || (() => false),
    getWorkspace: () => ws,
  });

  const blocks = [];
  const activity = [];
  const events = [];
  orch.on('block', (b) => blocks.push(b));
  orch.on('activity', (a) => activity.push(a));
  orch.on('turn:start', () => events.push('start'));
  orch.on('turn:end', () => events.push('end'));
  orch.on('cleared', () => events.push('cleared'));

  return { runtime, orch, clock, blocks, activity, events, get ws() { return ws; } };
}

async function flush(turns = 60) { for (let i = 0; i < turns; i++) await Promise.resolve(); }

describe('PlannerOrchestrator — perguntas e chips', () => {
  it('pergunta "Quem pagou?" com chips dos participantes ativos', async () => {
    const h = harness();
    await h.orch.handle('gastei 150 no mercado');
    await flush();
    const q = h.blocks.find((b) => b.type === 'question');
    expect(q).toBeTruthy();
    expect(q.payload.slot).toBe('payer');
    const labels = (q.actions || []).map((a) => a.label);
    expect(labels).toContain('Ana');
    expect(labels).toContain('Bob');
  });

  it('destino ausente gera pergunta com chips', async () => {
    const h = harness();
    await h.orch.handle('quero montar links de viagem');
    await flush();
    const q = h.blocks.find((b) => b.type === 'question');
    expect(q).toBeTruthy();
    expect(q.payload.slot).toBe('destination');
    expect((q.actions || []).some((a) => a.kind === 'chip')).toBe(true);
  });
});

describe('PlannerOrchestrator — preenchimento por resposta curta', () => {
  it('responde "Ana" à pergunta de pagador e registra o gasto', async () => {
    const h = harness();
    await h.orch.handle('gastei 150 no mercado');
    await flush();
    expect(h.blocks.some((b) => b.type === 'question' && b.payload.slot === 'payer')).toBe(true);
    h.blocks.length = 0;
    await h.orch.handle('Ana');
    await flush();
    const receipt = h.blocks.find((b) => b.type === 'receipt');
    expect(receipt).toBeTruthy();
    expect(receipt.payload.entity).toBe('finance');
    expect(h.ws.finances.length).toBe(1);
  });
});

describe('PlannerOrchestrator — renderização progressiva', () => {
  it('emite links antes da busca lenta de voos', async () => {
    const h = harness({ slowFlights: true, slowDelays: { flights: 800 } });
    const seen = [];
    h.orch.on('block', (b) => seen.push(b.type));
    const p = h.orch.handle('voo de São Paulo para Lisboa ida 10/12 volta 20/12');
    await flush();
    expect(h.blocks.some((b) => b.type === 'links')).toBe(true);
    expect(h.blocks.some((b) => b.type === 'flights')).toBe(false);
    h.clock.advance(900);
    await flush();
    await p;
    expect(h.blocks.some((b) => b.type === 'flights')).toBe(true);
    expect(seen.indexOf('flights')).toBeGreaterThan(seen.indexOf('links'));
  });
});

describe('PlannerOrchestrator — supersessão', () => {
  it('turno superado não emite blocos tardios', async () => {
    const h = harness({ slowFlights: true, slowDelays: { flights: 1000 } });
    const p1 = h.orch.handle('voo de São Paulo para Lisboa ida 10/12 volta 20/12');
    await flush();
    const flightsAfterFirst = h.blocks.filter((b) => b.type === 'flights').length;
    const p2 = h.orch.handle('minhas viagens');
    await flush();
    h.clock.advance(2000);
    await flush();
    await Promise.allSettled([p1, p2]);
    expect(h.blocks.filter((b) => b.type === 'flights').length).toBe(flightsAfterFirst);
    expect(h.blocks.some((b) => b.type === 'summary' && b.payload.kind === 'trip-list')).toBe(true);
  });
});

describe('PlannerOrchestrator — follow-ups', () => {
  it('reaproveita slots da última busca em "só direto"', async () => {
    const h = harness({ slowFlights: true, slowDelays: { flights: 10 } });
    await h.orch.handle('voo de São Paulo para Lisboa ida 10/12 volta 20/12');
    h.clock.advance(50);
    await flush();
    h.blocks.length = 0;
    await h.orch.handle('só direto');
    h.clock.advance(50);
    await flush();
    expect(h.blocks.some((b) => b.type === 'links')).toBe(true);
  });
});

describe('PlannerOrchestrator — erros', () => {
  it('erro de skill vira bloco error sem stack nem corpo upstream', async () => {
    // sem planner real: definimos uma decisão.list que falha propositalmente.
    const h = harness({ skipPlanner: true });
    h.runtime.define({
      id: 'planner.decision.list', agent: 'planner', kind: 'read', exposure: ['chat', 'ui'], timeoutMs: 500,
      title: 'Decisões', validate: () => kit.ok({ filter: 'all' }),
      run: () => { const e = new Error('upstream secreto'); e.code = 'skill/failed'; e.retryable = false; throw e; },
    });
    await h.orch.handle('listar decisões');
    await flush();
    const err = h.blocks.find((b) => b.type === 'error');
    expect(err).toBeTruthy();
    const asText = JSON.stringify(err.payload);
    expect(asText).not.toContain('upstream secreto');
    expect(asText).not.toMatch(/\bat \w+.*:\d+:\d+/);
  });
});

describe('PlannerOrchestrator — undo', () => {
  it('desfaz uma criação dentro da janela de 30 s', async () => {
    const h = harness();
    await h.orch.handle('adicionar participante Carlos');
    await flush();
    const receipt = h.blocks.find((b) => b.type === 'receipt');
    expect(receipt).toBeTruthy();
    expect(h.ws.participants.some((p) => p.name === 'Carlos')).toBe(true);
    h.blocks.length = 0;
    await h.orch.handle('desfazer');
    await flush();
    expect(h.ws.participants.some((p) => p.name === 'Carlos')).toBe(false);
  });

  it('recusa desfazer após expirar a janela de 30 s', async () => {
    const h = harness();
    await h.orch.handle('adicionar participante Carlos');
    await flush();
    h.blocks.length = 0;
    h.clock.advance(31000);
    await h.orch.handle('desfazer');
    await flush();
    const err = h.blocks.find((b) => b.type === 'error');
    expect(err).toBeTruthy();
    expect(err.payload.message).toMatch(/30 s|prazo/i);
    expect(h.ws.participants.some((p) => p.name === 'Carlos')).toBe(true);
  });

  it('recusa desfazer quando a entidade mudou', async () => {
    const h = harness();
    await h.orch.handle('adicionar documentos ao checklist');
    await flush();
    const receipt = h.blocks.find((b) => b.type === 'receipt');
    expect(receipt).toBeTruthy();
    const id = receipt.payload.id;
    await h.runtime.invoke('planner.checklist.toggle', { itemRef: id, done: true }, { source: 'ui' });
    await flush();
    h.blocks.length = 0;
    await h.orch.handle('desfazer');
    await flush();
    const err = h.blocks.find((b) => b.type === 'error');
    expect(err).toBeTruthy();
    expect(err.payload.message).toMatch(/mudou|desfazer/i);
  });
});

describe('PlannerOrchestrator — confirmação e gestos', () => {
  it('escrita com slot remoto exige confirmação por gesto confiável e executa uma vez', async () => {
    const remote = { intent: 'participant.add', confidence: 0.9, slots: { participantName: 'Diana' }, missing: [] };
    const h = harness({ aiEnabled: () => true });
    h.runtime.define({
      id: 'assist.interpret', agent: 'orchestrator', kind: 'read', exposure: ['chat'], timeoutMs: 1000,
      title: 'Interpretar', validate: (i) => kit.ok({ text: String(i.text || '') }),
      run: () => remote,
    });
    await h.orch.handle('zzzxxx qqqq');
    await flush();
    const conf = h.blocks.find((b) => b.type === 'confirmation');
    expect(conf).toBeTruthy();
    expect(h.ws.participants.some((p) => p.name === 'Diana')).toBe(false);

    await h.orch.act(conf.id, 'confirm', { isTrusted: false });
    await flush();
    expect(h.ws.participants.some((p) => p.name === 'Diana')).toBe(false);

    await h.orch.act(conf.id, 'confirm', { isTrusted: true });
    await flush();
    expect(h.ws.participants.some((p) => p.name === 'Diana')).toBe(true);

    const before = h.ws.participants.length;
    await h.orch.act(conf.id, 'confirm', { isTrusted: true });
    await flush();
    expect(h.ws.participants.length).toBe(before);
  });
});

describe('PlannerOrchestrator — clear', () => {
  it('clear limpa memória pendente e emite cleared', async () => {
    const h = harness();
    await h.orch.handle('gastei 150 no mercado');
    await flush();
    expect(h.orch.snapshot().memory.pending).toBeTruthy();
    h.orch.clear();
    expect(h.events).toContain('cleared');
    expect(h.orch.snapshot().memory.pending).toBeNull();
  });
});
