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
  const docFalso = {
    addEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => elementoFalso(),
    documentElement: { getAttribute: () => 'light', setAttribute() {} },
  };

  const authFalso = () => ({
    setPersistence: () => ({ catch() {} }),
    onAuthStateChanged() {},
    currentUser: null,
  });
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
    setTimeout,
    clearTimeout,
    URL,
    Blob: class {},
    Chart: class { destroy() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: docFalso,
    window: {},
    navigator: { clipboard: { writeText() {} } },
    firebase: {
      apps: [],
      initializeApp() {},
      auth: authFalso,
      firestore: () => ({ collection: () => ({ doc: () => docRefFalso }) }),
    },
  };
  contexto.window = contexto;
  contexto.globalThis = contexto;

  vm.createContext(contexto);

  // core.js precisa vir antes: app.js usa PlannerCore.chaveCache/nomePadrao.
  vm.runInContext(readFileSync(join(RAIZ_PUBLIC, 'core.js'), 'utf8'), contexto, { filename: 'core.js' });
  vm.runInContext(readFileSync(join(RAIZ_PUBLIC, 'app.js'), 'utf8'), contexto, { filename: 'app.js' });

  // `const` de topo não vira propriedade do global; um segundo script no mesmo
  // contexto compartilha o escopo lexical e consegue reexportá-los.
  vm.runInContext('globalThis.__app = { Utils, DB, Estado, Auth };', contexto);
  return contexto.__app;
}

let Utils, DB, Estado, Auth;

beforeEach(() => {
  ({ Utils, DB, Estado, Auth } = carregarApp());
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
