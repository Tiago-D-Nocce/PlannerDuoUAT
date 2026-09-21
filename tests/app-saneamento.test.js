// tests/app-saneamento.test.js — exercita os helpers de public/app.js.
//
// app.js é um script clássico (sem módulos) acoplado a firebase/DOM. Aqui ele
// é carregado num contexto vm com stubs mínimos, o que permite testar as
// funções que não tocam a tela: saneamento dos dados vindos da nuvem/cache,
// parse de valores pt-BR, escape de HTML e o mapeamento p1/p2 <-> nome.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

const RAIZ_PUBLIC = resolve(import.meta.dirname, '..', 'public');

/** Elemento DOM inerte — app.js só precisa não explodir ao tocá-lo. */
function elementoFalso() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild() {},
    remove() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    focus() {},
    reset() {},
  };
}

/**
 * Carrega public/app.js num contexto isolado e expõe seus objetos de topo.
 * @returns {{Utils:object, DB:object, Estado:object, Auth:object}} objetos internos de app.js
 */
function carregarApp() {
  const ouvintesDocumento = new Map();
  const metricas = { persistencias: 0, observers: 0, observerNext: null, observerError: null };

  // Timers híbridos: agendam num timer real (para caminhos que dependem de
  // disparo automático, como _comTimeout) e também ficam rastreados para que
  // avancarTempo possa forçá-los antecipadamente de forma determinística —
  // usado para exercer o watchdog de login sem esperar 12 s reais.
  const timers = new Map();
  let proximoTimer = 1;
  const agendar = (fn, atraso = 0) => {
    const id = proximoTimer++;
    const disparar = () => {
      if (!timers.has(id)) return;
      timers.delete(id);
      clearTimeout(real);
      fn();
    };
    const real = setTimeout(disparar, atraso);
    if (real && typeof real.unref === 'function') real.unref();
    timers.set(id, { atraso, disparar, real });
    return id;
  };
  const cancelar = (id) => {
    const timer = timers.get(id);
    if (timer) { clearTimeout(timer.real); timers.delete(id); }
  };
  const avancarTempo = (ms) => {
    // Dispara imediatamente todo timer cujo atraso seja <= ms, na ordem de
    // agendamento, sem esperar o tempo real correspondente.
    for (const [, timer] of [...timers.entries()]) {
      if (timer.atraso <= ms) timer.disparar();
    }
  };
  const docFalso = {
    addEventListener(tipo, fn) {
      const lista = ouvintesDocumento.get(tipo) || [];
      lista.push(fn);
      ouvintesDocumento.set(tipo, lista);
    },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => elementoFalso(),
    documentElement: { getAttribute: () => 'light', setAttribute() {} },
  };

  const authAdapter = {
    setPersistence() {
      metricas.persistencias += 1;
      return Promise.resolve();
    },
    // Guarda os callbacks para que os testes possam disparar o observer
    // manualmente (sucesso ou erro), simulando um primeiro estado tardio.
    onAuthStateChanged(onNext, onError) {
      metricas.observers += 1;
      metricas.observerNext = typeof onNext === 'function' ? onNext : null;
      metricas.observerError = typeof onError === 'function' ? onError : null;
      return () => {};
    },
    currentUser: null,
  };
  const authFalso = () => authAdapter;
  authFalso.Auth = { Persistence: { SESSION: 'session' } };

  const docRefFalso = {
    get: async () => ({ exists: false, data: () => ({}) }),
    set: async () => {},
    update: async () => {},
    onSnapshot: () => () => {},
  };

  const contexto = {
    console,
    crypto,
    Intl,
    Date,
    Math,
    JSON,
    // Timers híbridos: disparam sozinhos no tempo real (preserva _comTimeout e
    // UI.toast) e também podem ser forçados por avancarTempo (watchdog de login).
    setTimeout: agendar,
    clearTimeout: cancelar,
    URL,
    Blob: class {},
    Chart: class { destroy() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: docFalso,
    window: {},
    location: { pathname: '/app', replace() { metricas.replaces = (metricas.replaces || 0) + 1; metricas.ultimoReplace = arguments[0]; } },
    navigator: { clipboard: { writeText() {} } },
    firebase: {
      apps: [],
      initializeApp() {},
      auth: authFalso,
      firestore: () => ({ collection: () => ({ doc: () => docRefFalso }) }),
    },
    // Este harness exercita o caminho Firebase (observer, resolverCasalId sobre
    // o Firestore stub). modo-local-sem-firebase tornou 'local' o padrão, então
    // fixamos explicitamente o modo firebase para preservar o que este teste cobre.
    PLANNERDUO_MODO: 'firebase',
  };
  contexto.window = contexto;
  contexto.globalThis = contexto;

  vm.createContext(contexto);

  // Dependências globais clássicas precisam vir antes de app.js.
  vm.runInContext(readFileSync(join(RAIZ_PUBLIC, 'auth-errors.js'), 'utf8'), contexto, { filename: 'auth-errors.js' });
  vm.runInContext(readFileSync(join(RAIZ_PUBLIC, 'core.js'), 'utf8'), contexto, { filename: 'core.js' });
  vm.runInContext(readFileSync(join(RAIZ_PUBLIC, 'app.js'), 'utf8'), contexto, { filename: 'app.js' });

  // modo-local-sem-firebase moveu a init do Firebase para iniciarFirebase().
  // Este harness roda em modo firebase e chama Auth.resolverCasalId/observer
  // diretamente, então inicializamos auth/db aqui (equivalente ao antigo topo).
  vm.runInContext('iniciarFirebase();', contexto);

  // `const` de topo não vira propriedade do global; um segundo script no mesmo
  // contexto compartilha o escopo lexical e consegue reexportá-los.
  vm.runInContext('globalThis.__app = { Utils, DB, Estado, Auth };', contexto);
  contexto.__app.__teste = {
    contexto,
    metricas,
    emitirDocumento(tipo, evento = {}) {
      for (const fn of ouvintesDocumento.get(tipo) || []) fn(evento);
    },
    // Dispara o callback de sucesso do observer registrado por iniciarObserver.
    emitirEstadoAuth(user) {
      if (metricas.observerNext) metricas.observerNext(user);
    },
    // Dispara o callback de erro do observer.
    emitirErroAuth(err) {
      if (metricas.observerError) metricas.observerError(err);
    },
    // Avança o relógio dos timers controláveis do contexto.
    avancarTempo,
  };
  return contexto.__app;
}

let Utils, DB, Estado, Auth, Teste;

beforeEach(() => {
  ({ Utils, DB, Estado, Auth, __teste: Teste } = carregarApp());
});

describe('app.js carrega sem erro', () => {
  it('expõe Utils, DB e Estado', () => {
    expect(typeof Utils.esc).toBe('function');
    expect(typeof DB.normalizar).toBe('function');
    expect(Estado.financas).toEqual([]);
  });
});

// Os rewrites do Hosting/dev-server servem app.html em `/app` e auth.html em
// `/auth`. A detecção de rota precisa reconhecer as duas formas: em `/app` a
// versão antiga caía em "landing" e ninguém redirecionava para o login.
describe('Utils.rotaDe', () => {
  it('reconhece a rota do app com e sem .html', () => {
    expect(Utils.rotaDe('/app.html')).toBe('app');
    expect(Utils.rotaDe('/app')).toBe('app');
    expect(Utils.rotaDe('/app/')).toBe('app');
    expect(Utils.rotaDe('/planner-duo/publico/app')).toBe('app');
  });

  it('reconhece a rota de autenticação com e sem .html', () => {
    expect(Utils.rotaDe('/auth.html')).toBe('auth');
    expect(Utils.rotaDe('/auth')).toBe('auth');
    expect(Utils.rotaDe('/auth/')).toBe('auth');
  });

  it('trata qualquer outro caminho como landing', () => {
    expect(Utils.rotaDe('/')).toBe('landing');
    expect(Utils.rotaDe('')).toBe('landing');
    expect(Utils.rotaDe('/index.html')).toBe('landing');
    expect(Utils.rotaDe('/qualquer-outra-coisa')).toBe('landing');
  });

  it('ignora query string e hash', () => {
    expect(Utils.rotaDe('/app?x=1')).toBe('app');
    expect(Utils.rotaDe('/app#secao')).toBe('app');
  });

  it('tolera maiúsculas', () => {
    expect(Utils.rotaDe('/APP.HTML')).toBe('app');
  });

  it('não lança para null/undefined', () => {
    expect(Utils.rotaDe(null)).toBe('landing');
    expect(Utils.rotaDe(undefined)).toBe('landing');
  });
});

// Teto de tempo do resolverCasalId: sem ele, um get() pendente do Firestore
// deixaria o .finally() (e o loader) presos indefinidamente.
describe('Auth._comTimeout', () => {
  it('rejeita com timeout quando a promessa não resolve no prazo', async () => {
    const nuncaResolve = new Promise(() => {});
    await expect(Auth._comTimeout(nuncaResolve, 20)).rejects.toThrow('timeout');
  });

  it('resolve com o valor quando a promessa ganha a corrida', async () => {
    await expect(Auth._comTimeout(Promise.resolve('casal-1'), 200)).resolves.toBe('casal-1');
  });

  it('propaga a rejeição original quando ela chega antes do prazo', async () => {
    const falha = Promise.reject(new Error('permission-denied'));
    await expect(Auth._comTimeout(falha, 200)).rejects.toThrow('permission-denied');
  });
});

describe('bootstrap autenticado do app', () => {
  const user = { uid: 'usuario-1', email: 'pessoa@example.invalid', displayName: 'Pessoa' };

  it('inicia o observer diretamente sem reconfigurar persistência no app', () => {
    Teste.emitirDocumento('DOMContentLoaded');

    expect(Teste.metricas.observers).toBe(1);
    expect(Teste.metricas.persistencias).toBe(0);
  });

  it('mantém o supervisor ativo e libera a trava quando a navegação lança', () => {
    const chamadas = { fases: 0, conclusoes: 0, falhas: 0, destinos: [] };
    Teste.contexto.PlannerBootstrap = {
      iniciarFase() { chamadas.fases += 1; },
      concluir() { chamadas.conclusoes += 1; },
      falhar() { chamadas.falhas += 1; },
      estadoAtual: () => ({ estado: 'pendente' }),
    };
    Teste.contexto.location.replace = () => { throw new Error('falha-local-de-navegacao'); };

    expect(Auth._redirecionar('auth.html')).toBe(false);
    expect(Auth._navegando).toBe(false);
    expect(chamadas).toMatchObject({ fases: 1, conclusoes: 0, falhas: 1 });

    Teste.contexto.location.replace = (destino) => { chamadas.destinos.push(destino); };
    expect(Auth._redirecionar('auth.html')).toBe(true);
    expect(chamadas.destinos).toEqual(['auth.html']);
    expect(chamadas.conclusoes).toBe(0);
  });

  it('resolverCasalId retorna o ID sem mutar o estado fora da corrida', async () => {
    await expect(Auth.resolverCasalId(user)).resolves.toBe(user.uid);
    expect(Estado.casalId).toBeNull();
  });

  it('só entra no app depois de aplicar o casalId resolvido', async () => {
    let estadoAoEntrar = null;
    Auth.resolverCasalId = async () => 'casal-resolvido';
    Auth._entrarNoApp = () => { estadoAoEntrar = Estado.casalId; };

    await Auth._processarEstado(user);

    expect(Estado.casalId).toBe('casal-resolvido');
    expect(estadoAoEntrar).toBe('casal-resolvido');
  });

  it('propaga falha de montagem para o catch do observer', async () => {
    Auth.resolverCasalId = async () => 'casal-resolvido';
    Auth._entrarNoApp = () => { throw new Error('falha-de-montagem'); };

    await expect(Auth._processarEstado(user)).rejects.toThrow('falha-de-montagem');
  });
});

// Watchdog de login automático: quando o observer do Firebase demora demais
// para o primeiro callback (notebook novo / rede lenta), o usuário não pode
// ficar preso na tela de demora. Passado o orçamento de 12 s na rota do app,
// assumimos ausência de sessão e navegamos para o login.
describe('watchdog de login automático', () => {
  const user = { uid: 'usuario-1', email: 'pessoa@example.invalid', displayName: 'Pessoa' };

  it('navega para auth.html exatamente uma vez quando o observer não dispara em 12 s', () => {
    Teste.emitirDocumento('DOMContentLoaded');
    expect(Teste.metricas.replaces || 0).toBe(0);

    Teste.avancarTempo(12000);

    expect(Teste.metricas.replaces).toBe(1);
    expect(Teste.metricas.ultimoReplace).toBe('auth.html');
  });

  it('cancela o watchdog quando o observer dispara com user null antes do prazo', () => {
    Teste.emitirDocumento('DOMContentLoaded');

    // Observer dispara sem sessão: _processarEstado redireciona para o login.
    Teste.emitirEstadoAuth(null);
    expect(Auth._observerDisparou).toBe(true);

    // Mesmo avançando além do orçamento, o watchdog já foi cancelado: não pode
    // haver navegação dupla — o único replace veio do próprio _processarEstado.
    Teste.avancarTempo(12000);

    expect(Teste.metricas.replaces).toBe(1);
    expect(Teste.metricas.ultimoReplace).toBe('auth.html');
  });

  it('não navega para auth.html quando o observer dispara com user válido antes do prazo', async () => {
    Auth.resolverCasalId = async () => 'casal-resolvido';
    Auth._entrarNoApp = () => {};

    Teste.emitirDocumento('DOMContentLoaded');

    // Observer dispara com sessão válida antes do watchdog: o primeiro estado é
    // registrado (cancelando o watchdog) e o app é montado, sem ir ao login.
    // O callback do observer engole a promessa; aguardamos _processarEstado
    // diretamente para deixar a montagem assíncrona assentar antes do relógio.
    Teste.metricas.observerNext(user);
    expect(Auth._observerDisparou).toBe(true);
    await Auth._processarEstado(user);

    Teste.avancarTempo(12000);

    expect(Teste.metricas.replaces || 0).toBe(0);
  });
});

describe('Utils.esc', () => {
  it('neutraliza os caracteres que quebram innerHTML', () => {
    expect(Utils.esc('<script>')).toBe('&lt;script&gt;');
    expect(Utils.esc('a & b')).toBe('a &amp; b');
    expect(Utils.esc('diz "oi"')).toBe('diz &quot;oi&quot;');
    expect(Utils.esc("o'brien")).toBe('o&#39;brien');
  });

  it('trata null/undefined como string vazia', () => {
    expect(Utils.esc(null)).toBe('');
    expect(Utils.esc(undefined)).toBe('');
  });

  it('não deixa < ou > escaparem, qualquer que seja a entrada', () => {
    for (const s of ['<', '>', '"', '&', '<<>>', 'texto normal', '&lt;']) {
      expect(Utils.esc(s)).not.toMatch(/[<>]/);
    }
  });
});

describe('Utils.urlSegura', () => {
  it('aceita apenas http e https', () => {
    expect(Utils.urlSegura('https://booking.com/x')).toBe('https://booking.com/x');
    expect(Utils.urlSegura('http://azul.com.br')).toBe('http://azul.com.br');
  });

  it('descarta esquemas perigosos e valores vazios', () => {
    expect(Utils.urlSegura('javascript:alert(1)')).toBe('');
    expect(Utils.urlSegura('data:text/html,<script>')).toBe('');
    expect(Utils.urlSegura('booking.com')).toBe('');
    expect(Utils.urlSegura('')).toBe('');
    expect(Utils.urlSegura(null)).toBe('');
  });
});

describe('Utils.parseValor (pt-BR)', () => {
  it('interpreta vírgula como decimal e ponto como milhar', () => {
    expect(Utils.parseValor('100,50')).toBe(100.5);
    expect(Utils.parseValor('1.234,56')).toBe(1234.56);
    expect(Utils.parseValor('5.000,00')).toBe(5000);
  });

  it('mantém o formato com ponto decimal', () => {
    expect(Utils.parseValor('100.50')).toBe(100.5);
    expect(Utils.parseValor('42')).toBe(42);
  });

  // Contrato deliberado: sem vírgula, o ponto é decimal. É o formato que
  // `<input type="number">.value` sempre entrega ('100.5'), então "10.000"
  // vale 10 — desambiguar em favor do milhar quebraria a entrada real.
  it('trata ponto isolado como separador decimal, não de milhar', () => {
    expect(Utils.parseValor('10.000')).toBe(10);
    expect(Utils.parseValor('10.000,00')).toBe(10000);
  });

  it('devolve NaN para entradas vazias ou nulas', () => {
    expect(Utils.parseValor('')).toBeNaN();
    expect(Utils.parseValor('   ')).toBeNaN();
    expect(Utils.parseValor(null)).toBeNaN();
  });
});

describe('Utils.diasAte', () => {
  it('devolve null para data ausente ou inválida', () => {
    expect(Utils.diasAte('')).toBeNull();
    expect(Utils.diasAte(null)).toBeNull();
    expect(Utils.diasAte('data-ruim')).toBeNull();
  });

  it('devolve 0 para hoje', () => {
    expect(Utils.diasAte(Utils.hoje())).toBe(0);
  });
});

describe('Utils.inicial', () => {
  it('cai em ? para nome vazio ou só espaços', () => {
    expect(Utils.inicial('')).toBe('?');
    expect(Utils.inicial('   ')).toBe('?');
    expect(Utils.inicial(null)).toBe('?');
  });

  it('devolve a primeira letra maiúscula', () => {
    expect(Utils.inicial('ana')).toBe('A');
  });
});

describe('mapeamento de responsável p1/p2', () => {
  beforeEach(() => {
    Estado.nome1 = 'Ana';
    Estado.nome2 = 'Bruno';
  });

  it('converte o value do select no nome gravado', () => {
    expect(Utils.respDeValor('p1')).toBe('Ana');
    expect(Utils.respDeValor('p2')).toBe('Bruno');
  });

  it('cai em p1 para value ausente, vazio ou "null"', () => {
    expect(Utils.respDeValor('')).toBe('Ana');
    expect(Utils.respDeValor(null)).toBe('Ana');
    expect(Utils.respDeValor('null')).toBe('Ana');
  });

  it('faz round-trip nome -> value -> nome', () => {
    for (const nome of ['Ana', 'Bruno']) {
      expect(Utils.respDeValor(Utils.valorDeResp(nome))).toBe(nome);
    }
  });

  it('usa os fallbacks estáveis quando os nomes ainda não carregaram', () => {
    Estado.nome1 = null;
    Estado.nome2 = null;
    expect(Utils.respDeValor('p1')).toBe('Pessoa 1');
    expect(Utils.respDeValor('p2')).toBe('Pessoa 2');
    expect(Utils.respDeValor('p1')).not.toBe('null');
  });
});

describe('Utils.nome2De', () => {
  it('prefere dados.nome2 quando presente, ignorando membros', () => {
    const dados = { nome2: 'Bruno', membros: { 'a@x.com': 'Ana', 'c@x.com': 'Carlos' } };
    expect(Utils.nome2De(dados, 'Ana')).toBe('Bruno');
  });

  it('deriva do outro membro quando nome2 está ausente', () => {
    const dados = { membros: { 'a@x.com': 'Ana', 'b@x.com': 'Bruno' } };
    expect(Utils.nome2De(dados, 'Ana')).toBe('Bruno');
    expect(Utils.nome2De({ nome2: '', membros: dados.membros }, 'Ana')).toBe('Bruno');
  });

  it('devolve null quando membros só tem o próprio nome1', () => {
    expect(Utils.nome2De({ membros: { 'a@x.com': 'Ana' } }, 'Ana')).toBeNull();
  });

  it('devolve null para membros vazio, ausente ou dados nulos', () => {
    expect(Utils.nome2De({ membros: {} }, 'Ana')).toBeNull();
    expect(Utils.nome2De({}, 'Ana')).toBeNull();
    expect(Utils.nome2De(null, 'Ana')).toBeNull();
    expect(Utils.nome2De(undefined, 'Ana')).toBeNull();
  });

  it('ignora valores vazios dentro de membros', () => {
    const dados = { membros: { 'a@x.com': 'Ana', 'b@x.com': '', 'c@x.com': null } };
    expect(Utils.nome2De(dados, 'Ana')).toBeNull();
    expect(Utils.nome2De({ membros: { 'b@x.com': '', 'c@x.com': 'Bruno' } }, 'Ana')).toBe('Bruno');
  });
});

describe('DB.normalizar — finanças', () => {
  it('descarta registros sem data utilizável', () => {
    const { financas } = DB.normalizar({
      financas: [
        { id: 'a', data: '2026-03-01', valor: 10 },
        { id: 'b', valor: 10 },
        { id: 'c', data: '01/03/2026', valor: 10 },
        { id: 'd', data: null, valor: 10 },
        null,
      ],
    });
    expect(financas.map(f => f.id)).toEqual(['a']);
  });

  it('converte valor textual pt-BR em número', () => {
    const { financas } = DB.normalizar({
      financas: [{ data: '2026-03-01', valor: '1.234,56' }],
    });
    expect(financas[0].valor).toBe(1234.56);
  });

  it('zera valores inutilizáveis em vez de propagar NaN', () => {
    const { financas } = DB.normalizar({
      financas: [
        { data: '2026-03-01', valor: undefined },
        { data: '2026-03-02', valor: 'abc' },
        { data: '2026-03-03' },
      ],
    });
    for (const f of financas) {
      expect(f.valor).toBe(0);
      expect(Number.isNaN(f.valor)).toBe(false);
    }
  });

  it('substitui resp inválido pelo nome de Pessoa 1', () => {
    Estado.nome1 = 'Ana';
    const { financas } = DB.normalizar({
      financas: [
        { data: '2026-03-01', resp: 'null' },
        { data: '2026-03-02', resp: '' },
        { data: '2026-03-03' },
        { data: '2026-03-04', resp: 'Bruno' },
      ],
    });
    expect(financas.map(f => f.resp)).toEqual(['Ana', 'Ana', 'Ana', 'Bruno']);
  });

  it('normaliza tipo para receita ou despesa', () => {
    const { financas } = DB.normalizar({
      financas: [
        { data: '2026-03-01', tipo: 'receita' },
        { data: '2026-03-02', tipo: 'lixo' },
        { data: '2026-03-03' },
      ],
    });
    expect(financas.map(f => f.tipo)).toEqual(['receita', 'despesa', 'despesa']);
  });

  it('garante desc string e cat preenchida', () => {
    const { financas } = DB.normalizar({
      financas: [{ data: '2026-03-01', desc: undefined }, { data: '2026-03-02', desc: 'Uber centro' }],
    });
    expect(financas[0].desc).toBe('');
    expect(financas[0].cat).toBeTruthy();
    expect(financas[1].cat).toBe('transporte');
  });

  it('atribui id a registros legados sem id', () => {
    const { financas } = DB.normalizar({ financas: [{ data: '2026-03-01' }] });
    expect(typeof financas[0].id).toBe('string');
    expect(financas[0].id.length).toBeGreaterThan(0);
  });

  it('preserva campos extras (recorrente, parcela, viagemId)', () => {
    const { financas } = DB.normalizar({
      financas: [{ data: '2026-03-01', recorrente: 'mensal', viagemId: 'v1', parcela: { atual: 2, total: 3 } }],
    });
    expect(financas[0].recorrente).toBe('mensal');
    expect(financas[0].viagemId).toBe('v1');
    expect(financas[0].parcela).toEqual({ atual: 2, total: 3 });
  });
});

describe('DB.normalizar — viagens, metas, checklist, orçamentos', () => {
  it('converte orçamento e cofrinho da viagem em números', () => {
    const { viagens } = DB.normalizar({
      viagens: [{ destino: 'Paris', ida: '2026-05-01', volta: 'x', orcamento: '5.000,00', guardado: null }],
    });
    expect(viagens[0].orcamento).toBe(5000);
    expect(viagens[0].guardado).toBe(0);
    expect(viagens[0].volta).toBe('');
  });

  it('converte alvo/atual da meta e limpa prazo inválido', () => {
    const { metas } = DB.normalizar({
      metas: [{ titulo: 'Europa', alvo: '10.000,00', atual: undefined, prazo: 'amanhã' }],
    });
    expect(metas[0].alvo).toBe(10000);
    expect(metas[0].atual).toBe(0);
    expect(metas[0].prazo).toBe('');
  });

  it('força feito booleano no checklist', () => {
    const { checklist } = DB.normalizar({
      checklist: [{ texto: 'Passaporte', feito: 'sim' }, { texto: 'Mala' }],
    });
    expect(checklist[0].feito).toBe(true);
    expect(checklist[1].feito).toBe(false);
  });

  it('remove limites de orçamento não positivos', () => {
    const { orcamentos } = DB.normalizar({
      orcamentos: { alimentacao: '1.200,00', lazer: 0, saude: 'abc', transporte: 300 },
    });
    expect(orcamentos).toEqual({ alimentacao: 1200, transporte: 300 });
  });

  it('devolve listas vazias para entrada ausente ou de tipo errado', () => {
    for (const entrada of [undefined, {}, { financas: null, viagens: 'x', metas: 42, checklist: {} }]) {
      const n = DB.normalizar(entrada);
      expect(n.financas).toEqual([]);
      expect(n.viagens).toEqual([]);
      expect(n.metas).toEqual([]);
      expect(n.checklist).toEqual([]);
      expect(n.orcamentos).toEqual({});
    }
  });

  it('é idempotente: normalizar duas vezes não muda o resultado', () => {
    const bruto = {
      financas: [{ data: '2026-03-01', valor: '10,50', resp: 'null' }],
      viagens: [{ destino: 'Roma', ida: '2026-06-01', volta: '2026-06-10', orcamento: '3.000,00' }],
      metas: [{ titulo: 'Casa', alvo: '100.000', atual: '1.000' }],
      checklist: [{ texto: 'RG', feito: 1 }],
      orcamentos: { lazer: '200,00' },
    };
    const uma = DB.normalizar(bruto);
    const duas = DB.normalizar(uma);
    expect(duas.financas.map(f => ({ ...f, id: '_' }))).toEqual(uma.financas.map(f => ({ ...f, id: '_' })));
    expect(duas.viagens).toEqual(uma.viagens);
    expect(duas.metas).toEqual(uma.metas);
    expect(duas.checklist).toEqual(uma.checklist);
    expect(duas.orcamentos).toEqual(uma.orcamentos);
  });
});

// Harness de montagem real com os seis canvases do produto, mas sem expor
// window.Chart/global Chart. Isso representa uma CDN visual bloqueada sem
// substituir Render.tudo(), os relatórios ou a remoção real do loader.
function carregarMontagemSemChart() {
  const canvasIds = [
    'chart-fluxo',
    'chart-categorias',
    'chart-responsavel',
    'chart-cat-fin',
    'chart-rel-evolucao',
    'chart-rel-categorias',
  ];
  const elementos = new Map();
  const adicionar = (id) => {
    const elemento = elementoFalso();
    elemento.id = id;
    elementos.set(id, elemento);
    return elemento;
  };

  for (const id of [
    'sidebar-user-name',
    'sidebar-avatar',
    'loader-tela',
    'tela-app',
    'stat-saldo',
    'welcome-msg',
    'rel-periodo',
    'rel-pessoa',
    'rel-tbody',
  ]) adicionar(id);
  for (const id of canvasIds) {
    const canvas = adicionar(id);
    canvas.getContext = () => ({ canvasId: id });
  }

  elementos.get('loader-tela').style.display = 'flex';
  elementos.get('tela-app').style.opacity = '0';
  elementos.get('rel-periodo').value = '6';
  elementos.get('rel-pessoa').value = 'todos';

  const timers = new Map();
  let proximoTimer = 1;
  const agendar = (fn, atraso = 0) => {
    const id = proximoTimer++;
    timers.set(id, { fn, atraso });
    return id;
  };
  const cancelar = (id) => timers.delete(id);
  const executarTimers = () => {
    while (timers.size) {
      const [id, timer] = [...timers.entries()]
        .sort((a, b) => a[1].atraso - b[1].atraso || a[0] - b[0])[0];
      timers.delete(id);
      timer.fn();
    }
  };

  const documento = {
    addEventListener() {},
    getElementById: (id) => elementos.get(id) || null,
    querySelector: (seletor) => seletor === '.view.ativa' ? { id: 'relatorios' } : null,
    querySelectorAll: () => [],
    createElement: () => elementoFalso(),
    documentElement: { getAttribute: () => 'light', setAttribute() {} },
  };

  const authAdapter = {
    currentUser: null,
    onAuthStateChanged: () => () => {},
    signOut: () => Promise.resolve(),
  };
  const authFalso = () => authAdapter;
  authFalso.Auth = { Persistence: { SESSION: 'session' } };

  const docRefFalso = {
    get: async () => ({ exists: true, data: () => ({}) }),
    set: async () => {},
    update: async () => {},
    onSnapshot: () => () => {},
  };
  const firestoreFalso = () => ({ collection: () => ({ doc: () => docRefFalso }) });
  firestoreFalso.FieldValue = {
    arrayUnion: (valor) => valor,
    arrayRemove: (valor) => valor,
  };

  const contexto = {
    console,
    crypto,
    Intl,
    Date,
    Math,
    JSON,
    setTimeout: agendar,
    clearTimeout: cancelar,
    URL,
    Blob: class {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: documento,
    location: { pathname: '/app', replace() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    firebase: {
      apps: [],
      initializeApp() { this.apps.push({}); },
      auth: authFalso,
      firestore: firestoreFalso,
    },
  };
  contexto.window = contexto;
  contexto.globalThis = contexto;

  const supervisor = {
    estado: 'pendente',
    conclusoes: 0,
    iniciarFase() {},
    estadoAtual() { return { estado: this.estado }; },
    concluir() {
      this.conclusoes += 1;
      this.estado = 'pronto';
      return true;
    },
    falhar() {
      this.estado = 'erro';
      return true;
    },
  };
  contexto.PlannerBootstrap = supervisor;

  vm.createContext(contexto);
  vm.runInContext(readFileSync(join(RAIZ_PUBLIC, 'auth-errors.js'), 'utf8'), contexto, { filename: 'auth-errors.js' });
  vm.runInContext(readFileSync(join(RAIZ_PUBLIC, 'core.js'), 'utf8'), contexto, { filename: 'core.js' });
  vm.runInContext(readFileSync(join(RAIZ_PUBLIC, 'app.js'), 'utf8'), contexto, { filename: 'app.js' });
  vm.runInContext('globalThis.__montagem = { Auth, Estado, Charts, Relatorios };', contexto);

  return {
    ...contexto.__montagem,
    contexto,
    elementos,
    canvasIds,
    supervisor,
    executarTimers,
  };
}

describe('montagem autenticada sem Chart.js', () => {
  it('mantém dashboard e relatórios funcionais, conclui o bootstrap e oculta o loader', () => {
    const harness = carregarMontagemSemChart();
    harness.Estado.casalId = 'espaco-opaco';

    expect(Object.prototype.hasOwnProperty.call(harness.contexto, 'Chart')).toBe(false);
    expect(harness.canvasIds.every((id) => typeof harness.elementos.get(id)?.getContext === 'function')).toBe(true);

    expect(() => harness.Auth._entrarNoApp({
      uid: 'usuario-opaco',
      email: 'pessoa@example.invalid',
      displayName: 'Pessoa',
    })).not.toThrow();
    // Exercita também os gráficos de finanças e os dois gráficos de relatório,
    // além dos gráficos de dashboard já visitados pela montagem real.
    expect(() => harness.Charts.renderizarTodos()).not.toThrow();

    expect(harness.elementos.get('tela-app').style.opacity).toBe('1');
    expect(harness.supervisor.estadoAtual().estado).toBe('pronto');
    expect(harness.supervisor.conclusoes).toBe(1);
    expect(harness.elementos.get('welcome-msg').textContent).toContain('Pessoa');
    expect(harness.elementos.get('stat-saldo').textContent).not.toBe('');
    expect(harness.elementos.get('rel-tbody').innerHTML).toContain('<tr>');

    harness.executarTimers();
    expect(harness.elementos.get('loader-tela').style.display).toBe('none');
  });
});