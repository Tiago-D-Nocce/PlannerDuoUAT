// Harness compartilhado para testes de propriedade do skill-runtime.
// Relógio falso determinístico + drenagem de microtasks antes de avançar o tempo.

export function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map(); // id -> { at, fn }
  return {
    clock: {
      now: () => now,
      setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn }); return id; },
      clearTimeout: (id) => { timers.delete(id); },
    },
    pending: () => timers.size,
    setNow: (v) => { now = v; },
    fireNext: () => {
      let next = null;
      for (const [id, t] of timers) {
        if (next === null || t.at < next.at) next = { id, ...t };
      }
      if (!next) return false;
      now = Math.max(now, next.at);
      timers.delete(next.id);
      next.fn();
      return true;
    },
  };
}

// Esvazia completamente a fila de microtasks (várias voltas) para que todo
// trabalho síncrono/microtask termine antes de o relógio avançar — espelha a
// realidade, em que timers só disparam depois que o loop de microtasks esvazia.
export async function flushMicrotasks(turns = 30) {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

// Avança microtasks e timers (um por vez) até todas as promessas liquidarem.
export async function settleAll(fk, promises) {
  const list = Array.isArray(promises) ? promises : [promises];
  let done = 0;
  list.forEach((p) => { Promise.resolve(p).then(() => { done += 1; }, () => { done += 1; }); });

  let guard = 0;
  while (done < list.length && guard++ < 200000) {
    await flushMicrotasks();
    if (done >= list.length) break;
    if (!fk.fireNext()) {
      await flushMicrotasks();
      if (done < list.length && fk.pending() === 0) {
        // sem timers e sem progresso: aguarda mais uma volta para evitar laço vazio.
        await flushMicrotasks();
      }
    }
  }
  return Promise.all(list.map((p) => Promise.resolve(p).catch((e) => e)));
}
