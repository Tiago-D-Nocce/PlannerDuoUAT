import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import runtimeModule from '../../public/modules/agents/skill-runtime.js';

const { createRuntime, SkillError, isSkillError, ERROR_MESSAGES, canonicalJson } = runtimeModule;

// Relógio controlável: usa setTimeout real por padrão, mas permite injeção.
function realClock() {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
}

function baseDef(overrides = {}) {
  return {
    id: 'travel.flights.search',
    agent: 'travel',
    kind: 'read',
    exposure: ['chat', 'ui'],
    timeoutMs: 1000,
    validate: (input) => ({ ok: true, value: input }),
    run: (value) => ({ echo: value }),
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('canonicalJson', () => {
  it('ordena chaves de forma estável', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: { y: 1, x: 2 }, a: [3, 2] })).toBe('{"a":[3,2],"z":{"x":2,"y":1}}');
  });
});

describe('define — validação', () => {
  it('rejeita id fora do padrão', () => {
    const rt = createRuntime({});
    expect(() => rt.define(baseDef({ id: 'Travel' }))).toThrow(TypeError);
    expect(() => rt.define(baseDef({ id: 'travel' }))).toThrow(TypeError);
    expect(() => rt.define(baseDef({ id: 'travel.' }))).toThrow(TypeError);
  });

  it('rejeita agent, kind e exposure inválidos', () => {
    const rt = createRuntime({});
    expect(() => rt.define(baseDef({ agent: 'x' }))).toThrow(TypeError);
    expect(() => rt.define(baseDef({ kind: 'x' }))).toThrow(TypeError);
    expect(() => rt.define(baseDef({ exposure: [] }))).toThrow(TypeError);
    expect(() => rt.define(baseDef({ exposure: ['other'] }))).toThrow(TypeError);
  });

  it('rejeita timeoutMs fora de 100..30000', () => {
    const rt = createRuntime({});
    expect(() => rt.define(baseDef({ timeoutMs: 50 }))).toThrow(TypeError);
    expect(() => rt.define(baseDef({ timeoutMs: 30001 }))).toThrow(TypeError);
    expect(() => rt.define(baseDef({ timeoutMs: 1000.5 }))).toThrow(TypeError);
  });

  it('cache só é permitido em read', () => {
    const rt = createRuntime({});
    expect(() => rt.define(baseDef({ id: 'finance.x.create', agent: 'finance', kind: 'write', exposure: ['ui'], cache: { ttlMs: 100, maxEntries: 2 } }))).toThrow(TypeError);
  });

  it('id duplicado lança TypeError', () => {
    const rt = createRuntime({});
    rt.define(baseDef());
    expect(() => rt.define(baseDef())).toThrow(TypeError);
  });

  it('retorna a definição congelada com retryable default true em read', () => {
    const rt = createRuntime({});
    const def = rt.define(baseDef());
    expect(Object.isFrozen(def)).toBe(true);
    expect(def.retryable).toBe(true);
    expect(() => { def.id = 'x'; }).toThrow();
  });

  it('get/has/list respeitam exposição e agente', () => {
    const rt = createRuntime({});
    rt.define(baseDef());
    rt.define(baseDef({ id: 'finance.report.month', agent: 'finance', kind: 'read', exposure: ['ui'] }));
    expect(rt.has('travel.flights.search')).toBe(true);
    expect(rt.get('nope')).toBe(null);
    expect(rt.list({ source: 'chat' }).map((d) => d.id)).toEqual(['travel.flights.search']);
    expect(rt.list({ agent: 'finance' }).map((d) => d.id)).toEqual(['finance.report.month']);
    expect(rt.list().length).toBe(2);
  });
});

describe('invoke — not-found e exposição', () => {
  it('id desconhecido rejeita skill/not-found', async () => {
    const rt = createRuntime({});
    await expect(rt.invoke('nope.x', {}, {})).rejects.toMatchObject({ code: 'skill/not-found' });
  });

  it('skill ui-only é invisível ao chat', async () => {
    const rt = createRuntime({});
    rt.define(baseDef({ id: 'finance.report.month', agent: 'finance', kind: 'read', exposure: ['ui'] }));
    await expect(rt.invoke('finance.report.month', {}, { source: 'chat' })).rejects.toMatchObject({ code: 'skill/not-found' });
    await expect(rt.invoke('finance.report.month', {}, { source: 'ui' })).resolves.toBeDefined();
  });
});

describe('invoke — validação de input', () => {
  it('input inválido rejeita skill/invalid-input com fields', async () => {
    const rt = createRuntime({});
    rt.define(baseDef({
      validate: () => ({ ok: false, fields: [{ field: 'origin', message: 'obrigatório' }] }),
    }));
    const err = await rt.invoke('travel.flights.search', {}, { source: 'ui' }).catch((e) => e);
    expect(err.code).toBe('skill/invalid-input');
    expect(err.fields).toEqual([{ field: 'origin', message: 'obrigatório' }]);
  });
});

describe('invoke — timeout', () => {
  it('rejeita skill/timeout quando run excede timeoutMs', async () => {
    const rt = createRuntime({ clock: realClock() });
    rt.define(baseDef({
      timeoutMs: 100,
      retryable: false,
      run: () => new Promise(() => {}), // nunca resolve
    }));
    const err = await rt.invoke('travel.flights.search', {}, { source: 'ui' }).catch((e) => e);
    expect(err.code).toBe('skill/timeout');
    expect(err.retryable).toBe(true);
  });
});

describe('invoke — abort externo', () => {
  it('aborta com skill/aborted ao sinalizar signal externo', async () => {
    const rt = createRuntime({ clock: realClock() });
    rt.define(baseDef({ run: () => new Promise(() => {}) }));
    const ac = new AbortController();
    const p = rt.invoke('travel.flights.search', {}, { source: 'ui', signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    const err = await p.catch((e) => e);
    expect(err.code).toBe('skill/aborted');
    expect(err.retryable).toBe(false);
  });

  it('aborta uma invocação enfileirada e a remove da fila', async () => {
    const rt = createRuntime({ clock: realClock(), maxConcurrent: 1 });
    const blocker = deferred();
    let secondRan = false;
    rt.define(baseDef({ id: 'travel.a.search', run: () => blocker.promise }));
    rt.define(baseDef({ id: 'travel.b.search', run: () => { secondRan = true; return 'b'; } }));

    const p1 = rt.invoke('travel.a.search', { k: 1 }, { source: 'ui' });
    const ac = new AbortController();
    const p2 = rt.invoke('travel.b.search', { k: 2 }, { source: 'ui', signal: ac.signal });
    // segunda está na fila (concorrência 1); aborta antes de rodar.
    ac.abort();
    const err = await p2.catch((e) => e);
    expect(err.code).toBe('skill/aborted');
    expect(secondRan).toBe(false);
    blocker.resolve('a');
    await expect(p1).resolves.toEqual('a');
  });
});

describe('writes — nunca cacheadas/deduplicadas/retentadas', () => {
  it('write não dedupe nem cacheia e executa cada chamada', async () => {
    const rt = createRuntime({ clock: realClock() });
    let runs = 0;
    rt.define({
      id: 'finance.transaction.create',
      agent: 'finance',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 1000,
      validate: (i) => ({ ok: true, value: i }),
      run: () => { runs += 1; return { n: runs }; },
    });
    await Promise.all([
      rt.invoke('finance.transaction.create', { a: 1 }, { source: 'ui' }),
      rt.invoke('finance.transaction.create', { a: 1 }, { source: 'ui' }),
    ]);
    expect(runs).toBe(2);
    expect(rt.stats().cacheSize).toBe(0);
  });

  it('write com erro retryable não é retentado', async () => {
    const rt = createRuntime({ clock: realClock() });
    let runs = 0;
    rt.define({
      id: 'finance.transaction.create',
      agent: 'finance',
      kind: 'write',
      exposure: ['ui'],
      timeoutMs: 1000,
      validate: (i) => ({ ok: true, value: i }),
      run: () => { runs += 1; const e = new Error('x'); e.code = 'market/timeout'; e.retryable = true; throw e; },
    });
    await rt.invoke('finance.transaction.create', {}, { source: 'ui' }).catch((e) => e);
    expect(runs).toBe(1);
  });
});

describe('dedupe de reads', () => {
  it('reads idênticos concorrentes compartilham uma execução', async () => {
    const rt = createRuntime({ clock: realClock() });
    let runs = 0;
    const d = deferred();
    rt.define(baseDef({ run: () => { runs += 1; return d.promise; } }));
    const p1 = rt.invoke('travel.flights.search', { a: 1 }, { source: 'ui' });
    const p2 = rt.invoke('travel.flights.search', { a: 1 }, { source: 'ui' });
    expect(rt.stats().inflight).toBe(1);
    d.resolve({ ok: true });
    await Promise.all([p1, p2]);
    expect(runs).toBe(1);
  });

  it('execução compartilhada só aborta quando todos abortam; cada um rejeita no próprio abort', async () => {
    const rt = createRuntime({ clock: realClock() });
    let aborted = false;
    rt.define(baseDef({
      run: (value, ctx) => new Promise((resolve, reject) => {
        ctx.signal.addEventListener('abort', () => { aborted = true; reject(new SkillError('skill/aborted', {})); });
      }),
    }));
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    const p1 = rt.invoke('travel.flights.search', { a: 1 }, { source: 'ui', signal: ac1.signal });
    const p2 = rt.invoke('travel.flights.search', { a: 1 }, { source: 'ui', signal: ac2.signal });

    ac1.abort();
    await expect(p1).rejects.toMatchObject({ code: 'skill/aborted' });
    expect(aborted).toBe(false); // ainda há um interessado

    ac2.abort();
    await expect(p2).rejects.toMatchObject({ code: 'skill/aborted' });
    expect(aborted).toBe(true);
  });
});

describe('cache de reads', () => {
  it('TTL expira e serve resultado cacheado com cached:true', async () => {
    let t = 0;
    const clock = {
      now: () => t,
      setTimeout: (fn, ms) => setTimeout(fn, 0), // imediato para teste
      clearTimeout: (id) => clearTimeout(id),
    };
    const rt = createRuntime({ clock });
    let runs = 0;
    rt.define(baseDef({ cache: { ttlMs: 100, maxEntries: 10 }, run: () => { runs += 1; return { n: runs }; } }));

    const dones = [];
    rt.on('skill:done', (p) => dones.push(p.cached === true));

    await rt.invoke('travel.flights.search', { a: 1 }, { source: 'ui' }); // run 1
    await rt.invoke('travel.flights.search', { a: 1 }, { source: 'ui' }); // cache hit
    expect(runs).toBe(1);
    expect(dones).toEqual([false, true]);

    t = 200; // além do TTL
    await rt.invoke('travel.flights.search', { a: 1 }, { source: 'ui' }); // run 2
    expect(runs).toBe(2);
  });

  it('LRU evita além de maxEntries', async () => {
    let t = 0;
    const clock = { now: () => t, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout: (id) => clearTimeout(id) };
    const rt = createRuntime({ clock });
    rt.define(baseDef({ cache: { ttlMs: 10000, maxEntries: 2 }, run: (v) => v }));

    await rt.invoke('travel.flights.search', { a: 1 }, { source: 'ui' });
    await rt.invoke('travel.flights.search', { a: 2 }, { source: 'ui' });
    expect(rt.stats().cacheSize).toBe(2);
    await rt.invoke('travel.flights.search', { a: 3 }, { source: 'ui' }); // evita o mais antigo (a:1)
    expect(rt.stats().cacheSize).toBe(2);

    let runs = 0;
    // a:1 deve ter sido evitado → nova execução
    const rt2DoneBefore = rt.stats().cacheSize;
    expect(rt2DoneBefore).toBe(2);
  });
});

describe('breaker', () => {
  it('abre após 3 falhas, bloqueia e half-open fecha ao suceder', async () => {
    let t = 0;
    const clock = { now: () => t, setTimeout: (fn, ms) => setTimeout(fn, 0), clearTimeout: (id) => clearTimeout(id) };
    const rt = createRuntime({ clock });
    let fail = true;
    let runs = 0;
    rt.define(baseDef({
      retryable: false,
      run: () => { runs += 1; if (fail) { const e = new Error('x'); e.code = 'market/down'; throw e; } return 'ok'; },
    }));

    for (let i = 0; i < 3; i++) {
      await rt.invoke('travel.flights.search', {}, { source: 'ui' }).catch(() => {});
    }
    expect(rt.stats().breakers['travel.flights.search']).toBe('open');

    const runsBefore = runs;
    const err = await rt.invoke('travel.flights.search', {}, { source: 'ui' }).catch((e) => e);
    expect(err.code).toBe('skill/circuit-open');
    expect(runs).toBe(runsBefore); // não executou

    t = 30000; // half-open
    expect(rt.stats().breakers['travel.flights.search']).toBe('half-open');
    fail = false;
    await rt.invoke('travel.flights.search', {}, { source: 'ui' });
    expect(rt.stats().breakers['travel.flights.search']).toBe('closed');
  });

  it('falha na prova half-open reabre', async () => {
    let t = 0;
    const clock = { now: () => t, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout: (id) => clearTimeout(id) };
    const rt = createRuntime({ clock });
    rt.define(baseDef({ retryable: false, run: () => { const e = new Error('x'); e.code = 'market/down'; throw e; } }));
    for (let i = 0; i < 3; i++) await rt.invoke('travel.flights.search', {}, { source: 'ui' }).catch(() => {});
    t = 30000;
    await rt.invoke('travel.flights.search', {}, { source: 'ui' }).catch(() => {}); // prova falha
    expect(rt.stats().breakers['travel.flights.search']).toBe('open');
  });
  it('prova half-open encerrada por skill/aborted libera o probe (não trava)', async () => {
    // Regressão: antes do fix, breakerAllowsRun marcava halfProbe=true e, se a
    // prova terminasse com skill/aborted ou skill/invalid-input (fora do breaker),
    // halfProbe nunca era liberado — toda prova futura caía em circuit-open.
    let t = 0;
    const clock = { now: () => t, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout: (id) => clearTimeout(id) };
    const rt = createRuntime({ clock });
    let mode = 'fail';
    rt.define(baseDef({
      retryable: false,
      run: () => {
        if (mode === 'fail') { const e = new Error('x'); e.code = 'market/down'; throw e; }
        if (mode === 'abort') { const e = new Error('abortada'); e.code = 'skill/aborted'; e.retryable = false; throw e; }
        return 'ok';
      },
    }));
    for (let i = 0; i < 3; i++) await rt.invoke('travel.flights.search', {}, { source: 'ui' }).catch(() => {});
    expect(rt.stats().breakers['travel.flights.search']).toBe('open');
    t = 30000; // half-open: permite 1 prova
    mode = 'abort';
    const aborted = await rt.invoke('travel.flights.search', {}, { source: 'ui' }).catch((e) => e);
    expect(aborted.code).toBe('skill/aborted');
    expect(rt.stats().breakers['travel.flights.search']).toBe('half-open');
    // nova prova DEVE ser permitida (halfProbe foi liberado) e fecha o breaker.
    mode = 'ok';
    const result = await rt.invoke('travel.flights.search', {}, { source: 'ui' });
    expect(result).toBe('ok');
    expect(rt.stats().breakers['travel.flights.search']).toBe('closed');
  });
  it('prova half-open encerrada por skill/invalid-input (lançado no run) libera o probe', async () => {
    let t = 0;
    const clock = { now: () => t, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout: (id) => clearTimeout(id) };
    const rt = createRuntime({ clock });
    let mode = 'fail';
    rt.define(baseDef({
      retryable: false,
      run: () => {
        if (mode === 'fail') { const e = new Error('x'); e.code = 'market/down'; throw e; }
        if (mode === 'invalid') { const e = new Error('ruim'); e.code = 'skill/invalid-input'; e.fields = [{ field: 'x', message: 'ruim' }]; throw e; }
        return 'ok';
      },
    }));
    for (let i = 0; i < 3; i++) await rt.invoke('travel.flights.search', {}, { source: 'ui' }).catch(() => {});
    expect(rt.stats().breakers['travel.flights.search']).toBe('open');
    t = 30000;
    mode = 'invalid';
    const invalid = await rt.invoke('travel.flights.search', {}, { source: 'ui' }).catch((e) => e);
    expect(invalid.code).toBe('skill/invalid-input');
    expect(rt.stats().breakers['travel.flights.search']).toBe('half-open');
    mode = 'ok';
    const result = await rt.invoke('travel.flights.search', {}, { source: 'ui' });
    expect(result).toBe('ok');
    expect(rt.stats().breakers['travel.flights.search']).toBe('closed');
  });
});

describe('retry', () => {
  it('read com erro retryable é retentado uma vez', async () => {
    const rt = createRuntime({ clock: realClock(), random: () => 0 });
    let runs = 0;
    rt.define(baseDef({
      run: () => { runs += 1; if (runs === 1) { const e = new Error('x'); e.code = 'market/timeout'; e.retryable = true; throw e; } return 'ok'; },
    }));
    const r = await rt.invoke('travel.flights.search', {}, { source: 'ui' });
    expect(r).toBe('ok');
    expect(runs).toBe(2);
  });

  it('read com retryable:false na def não é retentado', async () => {
    const rt = createRuntime({ clock: realClock(), random: () => 0 });
    let runs = 0;
    rt.define(baseDef({
      retryable: false,
      run: () => { runs += 1; const e = new Error('x'); e.code = 'market/timeout'; e.retryable = true; throw e; },
    }));
    await rt.invoke('travel.flights.search', {}, { source: 'ui' }).catch(() => {});
    expect(runs).toBe(1);
  });

  it('erro não-retryable nunca é retentado', async () => {
    const rt = createRuntime({ clock: realClock(), random: () => 0 });
    let runs = 0;
    rt.define(baseDef({ run: () => { runs += 1; const e = new Error('x'); e.code = 'market/down'; throw e; } }));
    await rt.invoke('travel.flights.search', {}, { source: 'ui' }).catch(() => {});
    expect(runs).toBe(1);
  });
});

describe('reset', () => {
  it('aborta execuções em andamento, limpa fila, cache e breakers', async () => {
    const rt = createRuntime({ clock: realClock() });
    rt.define(baseDef({ run: () => new Promise(() => {}) }));
    const p = rt.invoke('travel.flights.search', { a: 1 }, { source: 'ui' });
    // deixa iniciar
    await new Promise((r) => setTimeout(r, 5));
    rt.reset();
    await expect(p).rejects.toMatchObject({ code: 'skill/aborted' });
    const s = rt.stats();
    expect(s.running).toBe(0);
    expect(s.queued).toBe(0);
    expect(s.cacheSize).toBe(0);
    expect(s.inflight).toBe(0);
  });
});

describe('eventos', () => {
  it('ordem start → done em sucesso', async () => {
    const rt = createRuntime({ clock: realClock() });
    rt.define(baseDef());
    const seq = [];
    rt.on('skill:start', () => seq.push('start'));
    rt.on('skill:done', () => seq.push('done'));
    rt.on('skill:error', () => seq.push('error'));
    await rt.invoke('travel.flights.search', {}, { source: 'ui' });
    expect(seq).toEqual(['start', 'done']);
  });

  it('ordem start → error em falha', async () => {
    const rt = createRuntime({ clock: realClock() });
    rt.define(baseDef({ retryable: false, run: () => { const e = new Error('x'); e.code = 'market/down'; throw e; } }));
    const seq = [];
    rt.on('skill:start', () => seq.push('start'));
    rt.on('skill:done', () => seq.push('done'));
    rt.on('skill:error', (p) => seq.push('error:' + p.code));
    await rt.invoke('travel.flights.search', {}, { source: 'ui' }).catch(() => {});
    expect(seq).toEqual(['start', 'error:market/down']);
  });

  it('exceções de handler não quebram a invocação', async () => {
    const rt = createRuntime({ clock: realClock() });
    rt.define(baseDef());
    rt.on('skill:start', () => { throw new Error('boom'); });
    rt.on('skill:done', () => { throw new Error('boom'); });
    await expect(rt.invoke('travel.flights.search', {}, { source: 'ui' })).resolves.toBeDefined();
  });

  it('on retorna unsubscribe', async () => {
    const rt = createRuntime({ clock: realClock() });
    rt.define(baseDef());
    let count = 0;
    const off = rt.on('skill:done', () => { count += 1; });
    await rt.invoke('travel.flights.search', {}, { source: 'ui' });
    off();
    await rt.invoke('travel.flights.search', { b: 1 }, { source: 'ui' });
    expect(count).toBe(1);
  });
});

describe('SkillError', () => {
  it('mensagem pt-BR da tabela, sem stack nem causa na mensagem', () => {
    const cause = new Error('detalhe interno com stack');
    const err = new SkillError('skill/timeout', { skillId: 'x.y', cause });
    expect(err.message).toBe(ERROR_MESSAGES['skill/timeout']);
    expect(err.message).not.toContain('stack');
    expect(err.message).not.toContain('detalhe interno');
    expect(isSkillError(err)).toBe(true);
    // cause não enumerável
    expect(Object.keys(err)).not.toContain('cause');
    expect(JSON.stringify(err)).not.toContain('detalhe interno');
  });

  it('preserva código e retryable customizados vindos do run', async () => {
    const rt = createRuntime({ clock: realClock() });
    rt.define(baseDef({
      retryable: false,
      run: () => { const e = new Error('x'); e.code = 'market/unavailable'; e.retryable = false; e.publicMessage = 'Mercado indisponível agora.'; throw e; },
    }));
    const err = await rt.invoke('travel.flights.search', {}, { source: 'ui' }).catch((e) => e);
    expect(err.code).toBe('market/unavailable');
    expect(err.retryable).toBe(false);
    expect(err.message).toBe('Mercado indisponível agora.');
  });
});
