import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import runtimeModule from '../../public/modules/agents/skill-runtime.js';
import { fakeClock, settleAll } from './_harness.js';

const { createRuntime } = runtimeModule;

describe('Property 6.07 — dedupe e cache', () => {
  it('reads idênticos concorrentes compartilham 1 execução; writes sempre executam uma vez cada', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }), // número de reads idênticos concorrentes
        fc.integer({ min: 1, max: 6 }), // número de writes
        fc.integer({ min: 0, max: 30 }), // duração do run
        async (nReads, nWrites, durationMs) => {
          const fk = fakeClock();
          const rt = createRuntime({ clock: fk.clock, random: () => 0 });

          let readRuns = 0;
          let writeRuns = 0;
          rt.define({
            id: 'travel.flights.search',
            agent: 'travel',
            kind: 'read',
            exposure: ['ui'],
            timeoutMs: 30000,
            validate: (i) => ({ ok: true, value: i }),
            run: () => new Promise((resolve) => {
              readRuns += 1;
              fk.clock.setTimeout(() => resolve('r'), durationMs);
            }),
          });
          rt.define({
            id: 'finance.transaction.create',
            agent: 'finance',
            kind: 'write',
            exposure: ['ui'],
            timeoutMs: 30000,
            validate: (i) => ({ ok: true, value: i }),
            run: () => new Promise((resolve) => {
              writeRuns += 1;
              fk.clock.setTimeout(() => resolve('w'), durationMs);
            }),
          });

          // mesmo input → mesma chave → dedupe.
          const readPromises = Array.from({ length: nReads }, () =>
            rt.invoke('travel.flights.search', { q: 'rio' }, { source: 'ui' }));
          // writes com inputs distintos.
          const writePromises = Array.from({ length: nWrites }, (_, i) =>
            rt.invoke('finance.transaction.create', { n: i }, { source: 'ui' }));

          await settleAll(fk, [...readPromises, ...writePromises]);

          expect(readRuns).toBe(1);        // dedupe: só uma execução
          expect(writeRuns).toBe(nWrites); // writes nunca deduplicam
          return true;
        },
      ),
      { numRuns: 110 },
    );
  });

  it('read cacheado dentro do TTL não gera execução extra', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100, max: 5000 }), // ttlMs
        fc.integer({ min: 1, max: 6 }),       // número de leituras sequenciais dentro do TTL
        async (ttlMs, repeats) => {
          const fk = fakeClock();
          const rt = createRuntime({ clock: fk.clock, random: () => 0 });
          let runs = 0;
          rt.define({
            id: 'travel.flights.search',
            agent: 'travel',
            kind: 'read',
            exposure: ['ui'],
            timeoutMs: 30000,
            cache: { ttlMs, maxEntries: 10 },
            validate: (i) => ({ ok: true, value: i }),
            run: () => { runs += 1; return 'r'; },
          });

          // primeira leitura popula o cache.
          await settleAll(fk, [rt.invoke('travel.flights.search', { q: 'rio' }, { source: 'ui' })]);
          // leituras seguintes dentro do TTL (relógio não avança além do TTL).
          for (let i = 0; i < repeats; i++) {
            fk.setNow(ttlMs - 1); // ainda fresco
            await settleAll(fk, [rt.invoke('travel.flights.search', { q: 'rio' }, { source: 'ui' })]);
          }
          expect(runs).toBe(1);

          // após o TTL, nova execução.
          fk.setNow(ttlMs + 1);
          await settleAll(fk, [rt.invoke('travel.flights.search', { q: 'rio' }, { source: 'ui' })]);
          expect(runs).toBe(2);
          return true;
        },
      ),
      { numRuns: 110 },
    );
  });
});
