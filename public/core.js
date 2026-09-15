// core.js — Lógica pura da feature multi-usuario-sso (PlannerDuo)
//
// Funções puras, desacopladas do Firebase, para permitir testes de propriedade
// (fast-check + vitest) sem I/O real. As funções que dependem de persistência
// recebem um `store` injetável (objeto em memória que simula o Firestore).
//
// Este arquivo funciona tanto como módulo Node (require, para testes) quanto
// carregado no navegador via <script> (expõe window.PlannerCore).

// Alfabeto usado na geração de códigos de convite: A-Z (26) + 0-9 (10) = 36 símbolos.
const ALFABETO_CODIGO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Deriva a chave de Cache_Local a partir do identificador do Espaço_Casal.
 * Requirements: 2.6
 * @param {string} casalId identificador do Espaço_Casal
 * @returns {string} chave no formato `pd-cache:${casalId}`
 */
function chaveCache(casalId) {
  return `pd-cache:${casalId}`;
}

/**
 * Retorna o nome padrão de um Membro: a parte local do e-mail (antes do `@`).
 * Se não houver `@`, retorna o e-mail inteiro.
 * Requirements: 3.3
 * @param {string} email e-mail do Membro
 * @returns {string} parte local do e-mail, ou o e-mail inteiro se não houver `@`
 */
function nomePadrao(email) {
  const indice = email.indexOf('@');
  return indice === -1 ? email : email.slice(0, indice);
}

/**
 * Gera um Código_Convite aleatório de 8 caracteres do alfabeto A-Z0-9.
 * Requirements: 4.1
 * @returns {string} código de exatamente 8 caracteres em A-Z0-9
 */
function gerarCodigo() {
  let codigo = '';
  for (let i = 0; i < 8; i++) {
    const indice = Math.floor(Math.random() * ALFABETO_CODIGO.length);
    codigo += ALFABETO_CODIGO[indice];
  }
  return codigo;
}

// ---------------------------------------------------------------------------
// Interface do `store` injetável (simula o Firestore em memória).
//
// As funções puras abaixo recebem um `store` como primeiro parâmetro. O store
// abstrai a persistência, permitindo testar a lógica sem Firebase real. Ele
// DEVE implementar três métodos:
//
//   getDoc(colecao, id) -> objeto|null
//     Retorna os dados do documento `colecao/{id}`, ou `null` se não existir.
//
//   setDoc(colecao, id, dados) -> void
//     Grava (substitui integralmente) o documento `colecao/{id}` com `dados`.
//
//   updateDoc(colecao, id, patch) -> void
//     Mescla os campos de `patch` no documento `colecao/{id}` já existente
//     (semântica de merge raso — apenas as chaves de `patch` são alteradas).
//
// Coleção usada por estas funções: `casais`, com documentos na forma de
// Espaço_Casal completo ou de ponteiro `{ casalIdRef }` (ver design, Decisão D1).
// ---------------------------------------------------------------------------

/**
 * Cria um novo Espaço_Casal em `casais/{user.uid}` com o Criador como primeiro
 * Membro. O nome do Membro vem de `user.displayName`, caindo para
 * `nomePadrao(user.email)` quando ausente/nulo.
 * Requirements: 2.1, 2.2, 3.2, 6.2
 * @param {{getDoc:Function,setDoc:Function,updateDoc:Function}} store store injetável
 * @param {{uid:string,email:string,displayName?:string|null}} user usuário autenticado
 * @returns {string} o `casalId` criado (igual a `user.uid`)
 */
function criarEspacoCasal(store, user) {
  const nome = user.displayName || nomePadrao(user.email);
  store.setDoc('casais', user.uid, {
    membros: { [user.email]: nome },
    nome1: nome,
    nome2: null,
    viagens: [],
    financas: [],
    metas: [],
    checklist: [],
    criadoEm: new Date().toISOString(),
  });
  return user.uid;
}

/**
 * Resolve o identificador do Espaço_Casal do Usuário autenticado (Decisão D1).
 * Sempre lê primeiro `casais/{user.uid}`:
 *   - não existe    -> cria um novo Espaço_Casal e retorna `user.uid`;
 *   - tem casalIdRef -> retorna o ponteiro `casalIdRef`;
 *   - caso contrário -> retorna `user.uid` (é o espaço próprio).
 * Requirements: 2.1, 2.2, 2.3, 2.4, 3.2, 6.2
 * @param {{getDoc:Function,setDoc:Function,updateDoc:Function}} store store injetável
 * @param {{uid:string,email:string,displayName?:string|null}} user usuário autenticado
 * @returns {string} o `casalId` resolvido
 */
function resolverCasalId(store, user) {
  const doc = store.getDoc('casais', user.uid);
  if (!doc) {
    return criarEspacoCasal(store, user);
  }
  if (doc.casalIdRef) {
    return doc.casalIdRef;
  }
  return user.uid;
}

/**
 * Grava uma lista em um campo (`viagens`, `financas`, `metas` ou `checklist`)
 * do documento `casais/{casalId}`, mesclando sobre os demais campos.
 * Requirements: 2.5
 * @param {{getDoc:Function,setDoc:Function,updateDoc:Function}} store store injetável
 * @param {string} casalId identificador do Espaço_Casal
 * @param {string} campo nome do campo de lista
 * @param {Array} lista itens a gravar
 * @returns {void}
 */
function salvarCampo(store, casalId, campo, lista) {
  store.updateDoc('casais', casalId, { [campo]: lista });
}

/**
 * Lê a lista de um campo do documento `casais/{casalId}`.
 * Retorna `[]` quando o documento ou o campo estão ausentes.
 * Requirements: 2.5
 * @param {{getDoc:Function,setDoc:Function,updateDoc:Function}} store store injetável
 * @param {string} casalId identificador do Espaço_Casal
 * @param {string} campo nome do campo de lista
 * @returns {Array} a lista armazenada, ou `[]` se ausente
 */
function lerCampo(store, casalId, campo) {
  const doc = store.getDoc('casais', casalId);
  if (!doc || doc[campo] == null) {
    return [];
  }
  return doc[campo];
}

// ---------------------------------------------------------------------------
// Convites (coleção `convites`, documento `convites/{codigo}` — Decisão D3).
// ---------------------------------------------------------------------------

/**
 * Cria um Convite para o Espaço_Casal `casalId`, gravando `convites/{codigo}`
 * com validade de 72 horas a partir de `agora` (Decisão D3).
 * Requirements: 4.1, 4.2
 * @param {{getDoc:Function,setDoc:Function,updateDoc:Function}} store store injetável
 * @param {string} casalId identificador do Espaço_Casal alvo
 * @param {string} criadoPor e-mail do Membro que gerou o convite
 * @param {number|Date} agora instante base (ms desde a época, ou Date)
 * @returns {string} o Código_Convite gerado
 */
function criarConvite(store, casalId, criadoPor, agora) {
  const baseMs = agora instanceof Date ? agora.getTime() : Number(agora);
  const codigo = gerarCodigo();
  store.setDoc('convites', codigo, {
    casalId,
    criadoPor,
    criadoEm: new Date(baseMs).toISOString(),
    expiraEm: new Date(baseMs + 72 * 60 * 60 * 1000).toISOString(),
  });
  return codigo;
}

/**
 * Valida e processa o aceite de um Convite, ingressando o Usuário no
 * Espaço_Casal. Validações avaliadas em ordem (curto-circuito, sem escrever no
 * store em cada erro): existência -> expiração -> lotação -> duplicidade ->
 * sucesso (design: "Ordem de validação em Convites.aceitar").
 * Requirements: 4.4, 4.5, 4.6, 4.7, 4.8, 4.9
 * @param {{getDoc:Function,setDoc:Function,updateDoc:Function}} store store injetável
 * @param {string} codigo Código_Convite informado
 * @param {{uid:string,email:string,displayName?:string|null}} user usuário autenticado
 * @param {number|Date} agora instante atual (ms desde a época, ou Date)
 * @returns {{ok:boolean, erro?:string, casalId?:string}} resultado do aceite
 */
function aceitarConvite(store, codigo, user, agora) {
  const agoraMs = agora instanceof Date ? agora.getTime() : Number(agora);

  // 1. Existência do convite.
  const convite = store.getDoc('convites', codigo);
  if (!convite) {
    return { ok: false, erro: 'invalido' };
  }

  // 2. Expiração.
  if (new Date(convite.expiraEm).getTime() < agoraMs) {
    return { ok: false, erro: 'expirou' };
  }

  // 3. Lotação do Espaço_Casal (máx. 2 Membros).
  const espaco = store.getDoc('casais', convite.casalId);
  const membros = (espaco && espaco.membros) || {};
  if (Object.keys(membros).length >= 2) {
    return { ok: false, erro: 'cheio' };
  }

  // 4. Já é Membro.
  if (membros[user.email]) {
    return { ok: false, erro: 'ja_membro' };
  }

  // 5. Sucesso: adiciona o Membro e grava o ponteiro de associação.
  const nome = user.displayName || nomePadrao(user.email);
  const membrosAtualizado = Object.assign({}, membros, { [user.email]: nome });
  store.updateDoc('casais', convite.casalId, { membros: membrosAtualizado });
  store.setDoc('casais', user.uid, { casalIdRef: convite.casalId });
  return { ok: true, casalId: convite.casalId };
}

// Export para Node/testes E para navegador.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    chaveCache,
    nomePadrao,
    gerarCodigo,
    criarEspacoCasal,
    resolverCasalId,
    salvarCampo,
    lerCampo,
    criarConvite,
    aceitarConvite,
  };
}
if (typeof window !== 'undefined') {
  window.PlannerCore = {
    chaveCache,
    nomePadrao,
    gerarCodigo,
    criarEspacoCasal,
    resolverCasalId,
    salvarCampo,
    lerCampo,
    criarConvite,
    aceitarConvite,
  };
}
