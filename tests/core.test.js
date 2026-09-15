// tests/core.test.js — testes de propriedade da lógica pura de public/core.js
//
// core.js é o núcleo desacoplado do Firebase: recebe um `store` injetável, o
// que permite exercitar Espaço_Casal e Convites sem I/O real. Os testes usam
// fast-check para as invariantes e casos concretos para a ordem de validação.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import core from '../public/core.js';

const {
  chaveCache,
  nomePadrao,
  gerarCodigo,
  criarEspacoCasal,
  resolverCasalId,
  salvarCampo,
  lerCampo,
  criarConvite,
  aceitarConvite,
} = core;

const HORA = 60 * 60 * 1000;
const VALIDADE_CONVITE = 72 * HORA;

// Store em memória que implementa o contrato documentado em core.js:
// getDoc / setDoc (substitui) / updateDoc (merge raso).
function criarStore(inicial = {}) {
  const dados = structuredClone(inicial);
  return {
    dados,
    getDoc(colecao, id) {
      return dados[colecao] && dados[colecao][id] ? dados[colecao][id] : null;
    },
    setDoc(colecao, id, doc) {
      dados[colecao] = dados[colecao] || {};
      dados[colecao][id] = structuredClone(doc);
    },
    updateDoc(colecao, id, patch) {
      dados[colecao] = dados[colecao] || {};
      dados[colecao][id] = { ...(dados[colecao][id] || {}), ...structuredClone(patch) };
    },
  };
}

const arbUsuario = () =>
  fc.record({
    uid: fc.string({ minLength: 1, maxLength: 24 }).filter(s => s.trim() !== ''),
    email: fc.emailAddress(),
    displayName: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
  });

const arbCampoLista = () => fc.constantFrom('viagens', 'financas', 'metas', 'checklist');

describe('chaveCache', () => {
  it('deriva sempre o prefixo pd-cache: do casalId', () => {
    fc.assert(
      fc.property(fc.string(), (casalId) => {
        expect(chaveCache(casalId)).toBe(`pd-cache:${casalId}`);
      })
    );
  });

  it('casalIds distintos produzem chaves distintas (isolamento de cache)', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        expect(chaveCache(a)).not.toBe(chaveCache(b));
      })
    );
  });
});

describe('nomePadrao', () => {
  it('devolve a parte local do e-mail', () => {
    fc.assert(
      fc.property(fc.emailAddress(), (email) => {
        const nome = nomePadrao(email);
        expect(email.startsWith(`${nome}@`)).toBe(true);
        expect(nome).not.toContain('@');
      })
    );
  });

  it('devolve a string inteira quando não há @', () => {
    fc.assert(
      fc.property(fc.string().filter(s => !s.includes('@')), (s) => {
        expect(nomePadrao(s)).toBe(s);
      })
    );
  });
});

describe('gerarCodigo', () => {
  it('gera 8 caracteres do alfabeto A-Z0-9', () => {
    for (let i = 0; i < 500; i++) {
      const codigo = gerarCodigo();
      expect(codigo).toHaveLength(8);
      expect(codigo).toMatch(/^[A-Z0-9]{8}$/);
    }
  });
});

describe('criarEspacoCasal', () => {
  it('cria o espaço em casais/{uid} com o criador como único membro', () => {
    fc.assert(
      fc.property(arbUsuario(), (user) => {
        const store = criarStore();
        const casalId = criarEspacoCasal(store, user);

        expect(casalId).toBe(user.uid);
        const doc = store.getDoc('casais', user.uid);
        const nomeEsperado = user.displayName || nomePadrao(user.email);

        expect(doc.membros).toEqual({ [user.email]: nomeEsperado });
        expect(doc.nome1).toBe(nomeEsperado);
        expect(doc.nome2).toBeNull();
        expect(doc.viagens).toEqual([]);
        expect(doc.financas).toEqual([]);
        expect(doc.metas).toEqual([]);
        expect(doc.checklist).toEqual([]);
      })
    );
  });

  it('usa a parte local do e-mail quando não há displayName', () => {
    const store = criarStore();
    criarEspacoCasal(store, { uid: 'u1', email: 'ana@exemplo.com', displayName: null });
    expect(store.getDoc('casais', 'u1').nome1).toBe('ana');
  });
});

describe('resolverCasalId', () => {
  it('cria o espaço quando o documento não existe', () => {
    fc.assert(
      fc.property(arbUsuario(), (user) => {
        const store = criarStore();
        expect(resolverCasalId(store, user)).toBe(user.uid);
        expect(store.getDoc('casais', user.uid)).not.toBeNull();
      })
    );
  });

  it('é idempotente: resolver duas vezes devolve o mesmo casalId', () => {
    fc.assert(
      fc.property(arbUsuario(), (user) => {
        const store = criarStore();
        const primeiro = resolverCasalId(store, user);
        const segundo = resolverCasalId(store, user);
        expect(segundo).toBe(primeiro);
      })
    );
  });

  it('segue o ponteiro casalIdRef quando presente', () => {
    fc.assert(
      fc.property(arbUsuario(), fc.string({ minLength: 1 }), (user, alvo) => {
        const store = criarStore({ casais: { [user.uid]: { casalIdRef: alvo } } });
        expect(resolverCasalId(store, user)).toBe(alvo);
      })
    );
  });

  it('devolve o uid quando o documento é o espaço próprio', () => {
    const user = { uid: 'u1', email: 'ana@exemplo.com', displayName: 'Ana' };
    const store = criarStore({ casais: { u1: { membros: { 'ana@exemplo.com': 'Ana' } } } });
    expect(resolverCasalId(store, user)).toBe('u1');
  });
});

describe('salvarCampo / lerCampo', () => {
  it('faz round-trip da lista gravada', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), arbCampoLista(), fc.array(fc.jsonValue()), (casalId, campo, lista) => {
        const store = criarStore({ casais: { [casalId]: { membros: {} } } });
        salvarCampo(store, casalId, campo, lista);
        expect(lerCampo(store, casalId, campo)).toEqual(lista);
      })
    );
  });

  it('devolve [] para documento ou campo ausente', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), arbCampoLista(), (casalId, campo) => {
        expect(lerCampo(criarStore(), casalId, campo)).toEqual([]);
      })
    );
  });

  it('gravar um campo não afeta os demais', () => {
    const store = criarStore({ casais: { c1: { financas: [{ id: 'f1' }], metas: [{ id: 'm1' }] } } });
    salvarCampo(store, 'c1', 'financas', []);
    expect(lerCampo(store, 'c1', 'financas')).toEqual([]);
    expect(lerCampo(store, 'c1', 'metas')).toEqual([{ id: 'm1' }]);
  });
});

describe('criarConvite', () => {
  it('grava validade de exatamente 72h a partir do instante base', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.emailAddress(),
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        (casalId, criadoPor, agora) => {
          const store = criarStore();
          const codigo = criarConvite(store, casalId, criadoPor, agora);
          const convite = store.getDoc('convites', codigo);

          expect(convite.casalId).toBe(casalId);
          expect(convite.criadoPor).toBe(criadoPor);
          const criadoEm = new Date(convite.criadoEm).getTime();
          const expiraEm = new Date(convite.expiraEm).getTime();
          expect(expiraEm - criadoEm).toBe(VALIDADE_CONVITE);
        }
      )
    );
  });

  it('aceita Date além de timestamp numérico', () => {
    const store = criarStore();
    const agora = new Date('2026-01-01T00:00:00.000Z');
    const codigo = criarConvite(store, 'c1', 'ana@exemplo.com', agora);
    expect(store.getDoc('convites', codigo).expiraEm).toBe('2026-01-04T00:00:00.000Z');
  });
});

describe('aceitarConvite', () => {
  const agora = Date.parse('2026-01-01T12:00:00.000Z');
  const dono = { uid: 'dono', email: 'ana@exemplo.com', displayName: 'Ana' };
  const convidado = { uid: 'convidado', email: 'bruno@exemplo.com', displayName: 'Bruno' };

  // Espaço com 1 membro + convite válido.
  function cenario(overrides = {}) {
    const store = criarStore();
    criarEspacoCasal(store, dono);
    const codigo = criarConvite(store, dono.uid, dono.email, agora);
    if (overrides.convite) {
      store.setDoc('convites', codigo, { ...store.getDoc('convites', codigo), ...overrides.convite });
    }
    if (overrides.membros) {
      store.updateDoc('casais', dono.uid, { membros: overrides.membros });
    }
    return { store, codigo };
  }

  it('rejeita código inexistente', () => {
    const { store } = cenario();
    expect(aceitarConvite(store, 'NAOEXISTE', convidado, agora)).toEqual({ ok: false, erro: 'invalido' });
  });

  it('rejeita convite expirado', () => {
    const { store, codigo } = cenario();
    const depois = agora + VALIDADE_CONVITE + 1;
    expect(aceitarConvite(store, codigo, convidado, depois)).toEqual({ ok: false, erro: 'expirou' });
  });

  it('aceita no limite exato da validade', () => {
    const { store, codigo } = cenario();
    expect(aceitarConvite(store, codigo, convidado, agora + VALIDADE_CONVITE).ok).toBe(true);
  });

  it('rejeita espaço já com 2 membros', () => {
    const { store, codigo } = cenario({
      membros: { [dono.email]: 'Ana', 'carla@exemplo.com': 'Carla' },
    });
    expect(aceitarConvite(store, codigo, convidado, agora)).toEqual({ ok: false, erro: 'cheio' });
  });

  it('rejeita quem já é membro', () => {
    const { store, codigo } = cenario({ membros: { [convidado.email]: 'Bruno' } });
    expect(aceitarConvite(store, codigo, convidado, agora)).toEqual({ ok: false, erro: 'ja_membro' });
  });

  it('avalia expiração antes de lotação (ordem de curto-circuito)', () => {
    const { store, codigo } = cenario({
      membros: { [dono.email]: 'Ana', 'carla@exemplo.com': 'Carla' },
    });
    const depois = agora + VALIDADE_CONVITE + 1;
    expect(aceitarConvite(store, codigo, convidado, depois).erro).toBe('expirou');
  });

  it('no sucesso adiciona o membro e grava o ponteiro de associação', () => {
    const { store, codigo } = cenario();
    const res = aceitarConvite(store, codigo, convidado, agora);

    expect(res).toEqual({ ok: true, casalId: dono.uid });
    expect(store.getDoc('casais', dono.uid).membros).toEqual({
      [dono.email]: 'Ana',
      [convidado.email]: 'Bruno',
    });
    expect(store.getDoc('casais', convidado.uid)).toEqual({ casalIdRef: dono.uid });
  });

  it('preserva os dados do espaço ao adicionar o membro', () => {
    const { store, codigo } = cenario();
    salvarCampo(store, dono.uid, 'financas', [{ id: 'f1', valor: 10 }]);
    aceitarConvite(store, codigo, convidado, agora);
    expect(lerCampo(store, dono.uid, 'financas')).toEqual([{ id: 'f1', valor: 10 }]);
  });

  it('usa a parte local do e-mail quando o convidado não tem displayName', () => {
    const { store, codigo } = cenario();
    aceitarConvite(store, codigo, { ...convidado, displayName: null }, agora);
    expect(store.getDoc('casais', dono.uid).membros[convidado.email]).toBe('bruno');
  });

  it('nenhum caminho de erro escreve no store', () => {
    fc.assert(
      fc.property(fc.constantFrom('invalido', 'expirou', 'cheio', 'ja_membro'), (caso) => {
        const overrides = {};
        if (caso === 'cheio') overrides.membros = { [dono.email]: 'Ana', 'carla@exemplo.com': 'Carla' };
        if (caso === 'ja_membro') overrides.membros = { [convidado.email]: 'Bruno' };
        const { store, codigo } = cenario(overrides);

        const antes = structuredClone(store.dados);
        const quando = caso === 'expirou' ? agora + VALIDADE_CONVITE + 1 : agora;
        const res = aceitarConvite(store, caso === 'invalido' ? 'ZZZZZZZZ' : codigo, convidado, quando);

        expect(res.ok).toBe(false);
        expect(res.erro).toBe(caso);
        expect(store.dados).toEqual(antes);
      })
    );
  });
});
