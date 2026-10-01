import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import nlu from '../../public/modules/agents/nlu.js';

// Relógio determinístico: 29/09/2026 12:00 local.
const CLOCK_MS = new Date(2026, 8, 29, 12, 0, 0).getTime();
const clock = { now: () => CLOCK_MS };
const TODAY = { y: 2026, m: 9, d: 29 };

function isValidIso(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  const dim = new Date(y, m, 0).getDate();
  return d >= 1 && d <= dim;
}
function cmp(a, b) {
  return a.y !== b.y ? a.y - b.y : (a.m !== b.m ? a.m - b.m : a.d - b.d);
}
function toYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

const cityNames = ['sao paulo', 'rio', 'recife', 'lisboa', 'paris', 'bariloche', 'nova york', 'bh', 'floripa'];
const dayGen = fc.integer({ min: 1, max: 31 });
const monthGen = fc.integer({ min: 1, max: 12 });

// Gerador de frases de viagem plausíveis (válidas e adversariais).
const phraseGen = fc.oneof(
  fc.record({ city: fc.constantFrom(...cityNames), d1: dayGen, m1: monthGen, d2: dayGen, m2: monthGen })
    .map(({ city, d1, m1, d2, m2 }) => `voo para ${city} de ${d1}/${m1} a ${d2}/${m2}`),
  fc.record({ city: fc.constantFrom(...cityNames), d1: dayGen, m1: monthGen, d2: dayGen })
    .map(({ city, d1, m1, d2 }) => `quero ir pra ${city} em ${d1}/${m1} voltando dia ${d2}`),
  fc.record({ city: fc.constantFrom(...cityNames), rel: fc.constantFrom('amanha', 'depois de amanha', 'semana que vem', 'daqui a 2 semanas') })
    .map(({ city, rel }) => `passagem para ${city} ${rel}`),
  fc.record({ city: fc.constantFrom(...cityNames), n: fc.integer({ min: 1, max: 10 }) })
    .map(({ city, n }) => `hotel em ${city} por ${n} noites`),
);

describe('Property 6.03 — validade das datas e totalidade do parse', () => {
  it('toda data de viagem produzida é ISO válida e não anterior a hoje', () => {
    fc.assert(
      fc.property(phraseGen, (text) => {
        const r = nlu.parse(text, {}, clock);
        for (const slot of ['departDate', 'returnDate']) {
          const v = r.slots[slot];
          if (v != null) {
            expect(isValidIso(v)).toBe(true);
            expect(cmp(toYmd(v), TODAY)).toBeGreaterThanOrEqual(0);
          }
        }
        if (r.slots.departDate != null && r.slots.returnDate != null) {
          expect(cmp(toYmd(r.slots.returnDate), toYmd(r.slots.departDate))).toBeGreaterThan(0);
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('parse nunca lança e sempre respeita o contrato de saída', () => {
    fc.assert(
      fc.property(fc.oneof(phraseGen, fc.fullUnicodeString(), fc.constant(null), fc.constant(undefined)), (text) => {
        const r = nlu.parse(text, {}, clock);
        expect(nlu.INTENTS).toContain(r.intent);
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
        expect(Array.isArray(r.missing)).toBe(true);
        expect(typeof r.slots).toBe('object');
        expect(typeof r.followUp).toBe('boolean');
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('nights, adults e childrenAges respeitam os limites do schema', () => {
    fc.assert(
      fc.property(
        fc.record({ city: fc.constantFrom(...cityNames), n: fc.integer({ min: 1, max: 60 }), p: fc.integer({ min: 1, max: 20 }) }),
        ({ city, n, p }) => {
          const r = nlu.parse(`hotel em ${city} por ${n} noites para ${p} pessoas`, {}, clock);
          if (r.slots.nights != null) {
            expect(r.slots.nights).toBeGreaterThanOrEqual(1);
            expect(r.slots.nights).toBeLessThanOrEqual(30);
          }
          if (r.slots.adults != null) {
            expect(r.slots.adults).toBeGreaterThanOrEqual(1);
            expect(r.slots.adults).toBeLessThanOrEqual(9);
          }
          (r.slots.childrenAges || []).forEach((age) => {
            expect(age).toBeGreaterThanOrEqual(0);
            expect(age).toBeLessThanOrEqual(17);
          });
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});
