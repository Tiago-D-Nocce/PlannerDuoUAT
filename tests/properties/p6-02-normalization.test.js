import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import nlu from '../../public/modules/agents/nlu.js';

// Property 6: normalize é total, idempotente, limitada e sem diacríticos.
const DIACRITIC = /[\u0300-\u036f]/;

describe('Property 6.02 — normalização', () => {
  it('é idempotente para qualquer string unicode', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (text) => {
        const once = nlu.normalize(text);
        const twice = nlu.normalize(once);
        return once === twice;
      }),
      { numRuns: 300 },
    );
  });

  it('nunca excede 1000 caracteres', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (text) => nlu.normalize(text).length <= 1000),
      { numRuns: 300 },
    );
  });

  it('não contém marcas diacríticas combinantes após normalizar', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (text) => !DIACRITIC.test(nlu.normalize(text))),
      { numRuns: 300 },
    );
  });

  it('é total: nunca lança e sempre devolve string', () => {
    fc.assert(
      fc.property(fc.oneof(fc.fullUnicodeString(), fc.constant(null), fc.constant(undefined), fc.integer()), (text) => {
        const out = nlu.normalize(text);
        return typeof out === 'string';
      }),
      { numRuns: 200 },
    );
  });

  it('resultado é minúsculo e com espaços colapsados', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const out = nlu.normalize(text);
        return out === out.toLowerCase() && !/\s{2,}/.test(out) && out === out.trim();
      }),
      { numRuns: 200 },
    );
  });
});
