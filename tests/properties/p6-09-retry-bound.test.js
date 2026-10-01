import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import runtimeModule from '../../public/modules/agents/skill-runtime.js';
import { fakeClock, settleAll } from './_harness.js';

const { createRuntime } = runtimeModule;

describe('Property 6.09 — limite de retry', () => {
  it('execuções por invocação <= 2 em read e = 1 em write; erro não-retryable nunca retenta', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          kind: fc.constantFrom('read', 'write'),
          retryableError: fc.boolean(),   // o erro lançado é retryable?
          defRetryable: fc.boolean(),     // def.retryable (só relevante em read)
          firstSucceeds: fc.boolean(),    // primeira tentativa já tem sucesso?
          jitter: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
        async (cfg) => {
          const fk = fakeClock();
          const rt = createRuntime({ clock: fk.clock, random: () => cfg.jitter });

          let runs = 0;
          const def = {
            id: cfg.kind === 'read' ? 'travel.flights.search' : 'finance.transaction.create',
            agent: cfg.kind === 'read' ? 'travel' : 'finance',
            kind: cfg.kind,
            exposure: ['ui'],
            timeoutMs: 30000,
            validate: (i) => ({ ok: true, value: i }),
            run: () => {
              runs += 1;
              if (cfg.firstSucceeds) return 'ok';
              const e = new Error('x');
              e.code = 'market/err';
              e.retryable = cfg.retryableError;
              throw e;
            },
          };
          if (cfg.kind === 'read') def.retryable = cfg.defRetryable;
          rt.define(def);

          await settleAll(fk, [rt.invoke(def.id, { a: 1 }, { source: 'ui' })]);

          if (cfg.kind === 'write') {
            expect(runs).toBe(1); // writes nunca retentam
          } else {
            expect(runs).toBeLessThanOrEqual(2); // no máximo 1 retry
            // retry só quando: falhou, erro retryable, def permite, e primeira tentativa.
            const shouldRetry = !cfg.firstSucceeds && cfg.retryableError && cfg.defRetryable;
            expect(runs).toBe(shouldRetry ? 2 : 1);
          }
          return true;
        },
      ),
      { numRuns: 150 },
    );
  });
});
