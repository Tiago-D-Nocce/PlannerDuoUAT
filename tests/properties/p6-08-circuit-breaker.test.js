import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import runtimeModule from '../../public/modules/agents/skill-runtime.js';
import { fakeClock, settleAll } from './_harness.js';

const { createRuntime } = runtimeModule;

describe('Property 6.08 — circuit breaker', () => {
  it('para qualquer sequência de sucesso/falha: abre exatamente após 3 falhas seguidas e não executa enquanto aberto', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }), // true = sucesso, false = falha
        async (outcomes) => {
          const fk = fakeClock();
          const rt = createRuntime({ clock: fk.clock, random: () => 0 });

          let runCount = 0;
          let nextSucceeds = true;
          rt.define({
            id: 'travel.flights.search',
            agent: 'travel',
            kind: 'read',
            exposure: ['ui'],
            timeoutMs: 30000,
            retryable: false, // sem retry para contagem direta
            validate: (i) => ({ ok: true, value: i }),
            run: () => {
              runCount += 1;
              if (nextSucceeds) return 'ok';
              const e = new Error('x');
              e.code = 'market/down';
              e.retryable = false;
              throw e;
            },
          });

          // modelo de referência do breaker.
          let consecutiveFailures = 0;
          let open = false;
          let executionsWhileOpen = 0;

          for (let i = 0; i < outcomes.length; i++) {
            nextSucceeds = outcomes[i];
            const runsBefore = runCount;
            // chave distinta por iteração evita dedupe/cache.
            const [err] = await settleAll(fk, [rt.invoke('travel.flights.search', { i }, { source: 'ui' })]);
            const executed = runCount > runsBefore;

            if (open) {
              if (executed) executionsWhileOpen += 1;
              expect(err && err.code).toBe('skill/circuit-open');
            } else if (outcomes[i]) {
              consecutiveFailures = 0;
            } else {
              consecutiveFailures += 1;
              if (consecutiveFailures >= 3) open = true;
            }
          }

          expect(executionsWhileOpen).toBe(0);
          const phase = rt.stats().breakers['travel.flights.search'];
          if (open) expect(phase).toBe('open');
          return true;
        },
      ),
      { numRuns: 150 },
    );
  });
});
