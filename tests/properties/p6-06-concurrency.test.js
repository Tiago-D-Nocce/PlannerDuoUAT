import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import runtimeModule from '../../public/modules/agents/skill-runtime.js';
import { fakeClock, settleAll } from './_harness.js';

const { createRuntime } = runtimeModule;

describe('Property 6.06 — limitador de concorrência', () => {
  it('para qualquer lote de reads/writes, execuções simultâneas <= maxConcurrent e tudo liquida', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.array(
          fc.record({
            kind: fc.constantFrom('read', 'write'),
            durationMs: fc.integer({ min: 0, max: 60 }),
            key: fc.integer({ min: 0, max: 5 }),
          }),
          { minLength: 1, maxLength: 14 },
        ),
        async (maxConcurrent, batch) => {
          const fk = fakeClock();
          const rt = createRuntime({ clock: fk.clock, maxConcurrent, random: () => 0 });

          let active = 0;
          let peak = 0;
          const readDef = {
            id: 'travel.read.search',
            agent: 'travel',
            kind: 'read',
            exposure: ['ui'],
            timeoutMs: 30000,
            validate: (i) => ({ ok: true, value: i }),
            run: (value) => new Promise((resolve) => {
              active += 1;
              peak = Math.max(peak, active);
              fk.clock.setTimeout(() => { active -= 1; resolve('ok'); }, value.durationMs);
            }),
          };
          const writeDef = { ...readDef, id: 'finance.write.create', agent: 'finance', kind: 'write' };
          rt.define(readDef);
          rt.define(writeDef);

          const promises = batch.map((op, i) => {
            const id = op.kind === 'read' ? 'travel.read.search' : 'finance.write.create';
            // chave única por item evita dedupe/cache mascarar execuções.
            return rt.invoke(id, { durationMs: op.durationMs, key: op.key, i }, { source: 'ui' }).catch(() => 'err');
          });

          const results = await settleAll(fk, promises);

          expect(peak).toBeLessThanOrEqual(maxConcurrent);
          expect(results.length).toBe(batch.length);
          for (const r of results) expect(r === 'ok' || r === 'err').toBe(true);
          expect(rt.stats().running).toBe(0);
          expect(rt.stats().queued).toBe(0);
        },
      ),
      { numRuns: 120 },
    );
  });
});
