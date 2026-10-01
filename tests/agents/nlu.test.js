import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import nlu from '../../public/modules/agents/nlu.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, '../fixtures/nlu/pt-br.json'), 'utf8'));

// Relógio fixo: segunda-feira, 29/09/2026, 12:00 local.
const clock = { now: () => new Date(2026, 8, 29, 12, 0, 0).getTime() };

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

describe('PlannerNLU — corpus pt-BR versionado', () => {
  for (const c of fixtures.cases) {
    it(`"${c.text}" → ${c.intent}`, () => {
      const r = nlu.parse(c.text, {}, clock);
      expect(r.intent).toBe(c.intent);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      expect(nlu.INTENTS).toContain(r.intent);
      if (c.slots) {
        for (const [k, v] of Object.entries(c.slots)) {
          expect(get(r.slots, k)).toEqual(v);
        }
      }
      if (c.missing) {
        c.missing.forEach((m) => expect(r.missing).toContain(m));
      }
      if (c.noSlots) {
        c.noSlots.forEach((n) => expect(r.slots[n]).toBeUndefined());
      }
      if (c.ambiguitySlot) {
        expect(r.ambiguity).toBeTruthy();
        expect(r.ambiguity.slot).toBe(c.ambiguitySlot);
      }
    });
  }
});

describe('PlannerNLU — normalize', () => {
  it('é idempotente', () => {
    const amostras = ['  Olá   MUNDO!! ', 'São Paulo — Lisboa', '“aspas” e \u2013 travessão', 'ÀÉÎÕÜ'];
    amostras.forEach((t) => {
      const once = nlu.normalize(t);
      expect(nlu.normalize(once)).toBe(once);
    });
  });

  it('remove diacríticos e limita a 1000 caracteres', () => {
    expect(nlu.normalize('AÇÃO ótimo')).toBe('acao otimo');
    const longo = 'a'.repeat(2000);
    expect(nlu.normalize(longo).length).toBeLessThanOrEqual(1000);
  });

  it('tolera nulo e tipos estranhos', () => {
    expect(nlu.normalize(null)).toBe('');
    expect(nlu.normalize(undefined)).toBe('');
    expect(nlu.normalize(42)).toBe('42');
  });
});

describe('PlannerNLU — datas e relógio injetado', () => {
  it('rola dia/mês já passado neste ano para o próximo ano', () => {
    // 29/09 é hoje; "dia 10 de janeiro" já passou → 2027
    const r = nlu.parse('voo para recife dia 10 de janeiro', {}, clock);
    expect(r.slots.departDate).toBe('2027-01-10');
  });

  it('resolve datas relativas com o relógio injetado', () => {
    expect(nlu.parse('passagem para recife amanhã', {}, clock).slots.departDate).toBe('2026-09-30');
    expect(nlu.parse('passagem para recife depois de amanhã', {}, clock).slots.departDate).toBe('2026-10-01');
    expect(nlu.parse('passagem para recife daqui a 2 semanas', {}, clock).slots.departDate).toBe('2026-10-13');
  });

  it('intervalo que cruza a virada de ano rola o retorno', () => {
    const r = nlu.parse('quero ir pra ny em 28/12 voltando dia 03/01', {}, clock);
    expect(r.slots.departDate).toBe('2026-12-28');
    expect(r.slots.returnDate).toBe('2027-01-03');
  });

  it('descarta data inválida (31/02) e pede no missing', () => {
    const r = nlu.parse('passagem para recife dia 31/02', {}, clock);
    expect(r.slots.departDate).toBeUndefined();
    expect(r.missing).toContain('departDate');
  });

  it('descarta ano explícito no passado', () => {
    const r = nlu.parse('voo para madri em 10/05/2020', {}, clock);
    expect(r.slots.departDate).toBeUndefined();
    expect(r.missing).toContain('departDate');
  });

  it('bissexto: 29/02 válido em ano bissexto', () => {
    // 2028 é bissexto; a partir de 2026 o próximo 29/02 futuro é 2028
    const r = nlu.parse('voo para recife dia 29/02/2028', {}, clock);
    expect(r.slots.departDate).toBe('2028-02-29');
  });

  it('bissexto: 29/02 inválido em ano não bissexto é descartado', () => {
    const r = nlu.parse('voo para recife dia 29/02/2027', {}, clock);
    expect(r.slots.departDate).toBeUndefined();
    expect(r.missing).toContain('departDate');
  });

  it('mês sem dia vira monthOnly e deixa departDate no missing (travel)', () => {
    const r = nlu.parse('quero ir pra Lisboa em dezembro', {}, clock);
    expect(r.slots.monthOnly).toBe('2026-12');
    expect(r.slots.departDate).toBeUndefined();
    expect(r.missing).toContain('departDate');
  });
});

describe('PlannerNLU — passageiros e dinheiro', () => {
  it('conta "eu e minha esposa" como 2 adultos', () => {
    const r = nlu.parse('quero ir pra lisboa eu e minha esposa', {}, clock);
    expect(r.slots.adults).toBe(2);
  });

  it('separa adultos e crianças com idade', () => {
    const r = nlu.parse('voo para recife eu, minha esposa e meu filho de 5 anos', {}, clock);
    expect(r.slots.adults).toBe(2);
    expect(r.slots.childrenAges).toEqual([5]);
  });

  it('"sozinho" conta 1 adulto', () => {
    const r = nlu.parse('quero ir pra floripa sozinho amanhã', {}, clock);
    expect(r.slots.adults).toBe(1);
  });

  it('interpreta formatos de dinheiro', () => {
    expect(nlu.parseMoney('R$ 45,90')).toBe(4590);
    expect(nlu.parseMoney('45 reais')).toBe(4500);
    expect(nlu.parseMoney('1.200')).toBe(120000);
    expect(nlu.parseMoney('1,2 mil')).toBe(120000);
    expect(nlu.parseMoney('3 mil')).toBe(300000);
  });

  it('maxPriceMinor em contexto de viagem', () => {
    const r = nlu.parse('voo direto para recife até R$ 2.000', {}, clock);
    expect(r.slots.maxPriceMinor).toBe(200000);
    expect(r.slots.directOnly).toBe(true);
  });
});

describe('PlannerNLU — follow-ups', () => {
  it('mescla slots quando o contexto é uma intenção de viagem', () => {
    const ctx = { lastIntent: 'travel.search', slots: { destination: { id: 'pt-lisboa' }, adults: 2 } };
    const r = nlu.parse('e pra 3 pessoas?', ctx, clock);
    expect(r.followUp).toBe(true);
    expect(r.intent).toBe('travel.search');
    expect(r.slots.destination.id).toBe('pt-lisboa');
    expect(r.slots.adults).toBe(3);
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    expect(r.confidence).toBeLessThanOrEqual(0.85);
  });

  it('"de executiva" ajusta a cabine mantendo contexto', () => {
    const ctx = { lastIntent: 'travel.flights', slots: { destination: { id: 'br-recife' } } };
    const r = nlu.parse('de executiva', ctx, clock);
    expect(r.followUp).toBe(true);
    expect(r.slots.cabin).toBe('business');
  });
});

describe('PlannerNLU — ambiguidade e robustez', () => {
  it('destino ambíguo retorna ambiguity com candidatos', () => {
    const r = nlu.parse('quero ir pra santiago em novembro', {}, clock);
    expect(r.ambiguity).toBeTruthy();
    expect(r.ambiguity.slot).toBe('destination');
    expect(r.ambiguity.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('nunca lança, mesmo com entrada bizarra', () => {
    const entradas = [null, undefined, '', '🤔💥\u0000\u202e', 'a'.repeat(5000), {}, 42, [1, 2, 3]];
    entradas.forEach((e) => {
      expect(() => nlu.parse(e, {}, clock)).not.toThrow();
      const r = nlu.parse(e, {}, clock);
      expect(nlu.INTENTS).toContain(r.intent);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    });
  });

  it('entrada sem sentido vira unknown com confiança baixa', () => {
    const r = nlu.parse('asdkfj qwpoei zxcv', {}, clock);
    expect(r.intent).toBe('unknown');
    expect(r.confidence).toBeLessThanOrEqual(0.3);
  });

  it('requiredSlots reflete a ordem de perguntas', () => {
    expect(nlu.requiredSlots('travel.search')).toEqual(['destination', 'origin', 'departDate', 'returnDate']);
    expect(nlu.requiredSlots('finance.add')).toEqual(['amountMinor', 'description']);
    expect(nlu.requiredSlots('decision.create')).toEqual(['title', 'options']);
    expect(nlu.requiredSlots('unknown')).toEqual([]);
  });
});
