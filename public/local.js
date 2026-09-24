// local.js — simulador local de autenticação e persistência do PlannerDuo.
(function (global) {
  'use strict';

  const PREFIXO = 'plannerduo-local:v1:';
  const CHAVE_USUARIOS = PREFIXO + 'users';
  const CHAVE_SESSAO = PREFIXO + 'session';
  const ITERACOES = 150000;

  function erro(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  function clone(valor) {
    if (valor == null) return valor;
    return JSON.parse(JSON.stringify(valor));
  }

  function emailNormalizado(email) {
    return String(email || '').trim().toLowerCase();
  }

  function storageDisponivel(storage, nome) {
    if (!storage) throw erro('local/storage-unavailable', nome + ' não está disponível neste navegador.');
    try {
      const chave = PREFIXO + 'probe';
      storage.setItem(chave, '1');
      storage.removeItem(chave);
    } catch (_) {
      throw erro('local/storage-unavailable', 'Permita o armazenamento do navegador para usar o modo local.');
    }
  }

  function exigirCrypto() {
    if (!global.crypto || !global.crypto.subtle || typeof global.crypto.getRandomValues !== 'function') {
      throw erro('local/crypto-unavailable', 'Seu navegador não oferece criptografia segura. Atualize-o ou acesse por localhost.');
    }
    return global.crypto;
  }

  function bytesParaBase64(bytes) {
    let binario = '';
    bytes.forEach(function (byte) { binario += String.fromCharCode(byte); });
    return global.btoa(binario);
  }

  function base64ParaBytes(texto) {
    const binario = global.atob(texto);
    return Uint8Array.from(binario, function (char) { return char.charCodeAt(0); });
  }

  function saltAleatorio() {
    const bytes = new Uint8Array(16);
    exigirCrypto().getRandomValues(bytes);
    return bytesParaBase64(bytes);
  }

  async function derivarSenha(senha, salt) {
    const crypto = exigirCrypto();
    const encoder = new TextEncoder();
    const material = await crypto.subtle.importKey(
      'raw', encoder.encode(String(senha)), { name: 'PBKDF2' }, false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: base64ParaBytes(salt),
      iterations: ITERACOES,
    }, material, 256);
    return bytesParaBase64(new Uint8Array(bits));
  }

  function lerUsuarios() {
    storageDisponivel(global.localStorage, 'localStorage');
    try {
      const dados = JSON.parse(global.localStorage.getItem(CHAVE_USUARIOS) || '{}');
      return dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
    } catch (_) {
      throw erro('local/storage-corrupt', 'Os dados de contas locais estão inválidos. Limpe os dados locais do site para recomeçar.');
    }
  }

  function gravarUsuarios(usuarios) {
    try {
      global.localStorage.setItem(CHAVE_USUARIOS, JSON.stringify(usuarios));
    } catch (_) {
      throw erro('local/storage-unavailable', 'Não foi possível salvar a conta local. Verifique o espaço e as permissões do navegador.');
    }
  }

  function usuarioPublico(registro) {
    return registro ? Object.freeze({
      uid: registro.uid,
      email: registro.email,
      displayName: registro.displayName || null,
    }) : null;
  }

  function iniciarSessao(registro) {
    storageDisponivel(global.sessionStorage, 'sessionStorage');
    try {
      global.sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({ uid: registro.uid, email: registro.email }));
    } catch (_) {
      throw erro('local/storage-unavailable', 'Não foi possível iniciar a sessão local. Permita sessionStorage no navegador.');
    }
    return usuarioPublico(registro);
  }

  function criarUid() {
    const crypto = exigirCrypto();
    if (typeof crypto.randomUUID === 'function') return 'local-' + crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return 'local-' + Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
  }

  function chaveCasal(id) { return 'pd-cache:' + id; }
  function chavePonteiro(id) { return PREFIXO + 'casais:pointer:' + id; }
  function chaveConvite(id) { return PREFIXO + 'convites:' + id; }

  const store = Object.freeze({
    getDoc: function (colecao, id) {
      storageDisponivel(global.localStorage, 'localStorage');
      const docId = String(id || '');
      let raw = null;
      if (colecao === 'casais') {
        raw = global.localStorage.getItem(chavePonteiro(docId));
        if (raw == null) raw = global.localStorage.getItem(chaveCasal(docId));
      } else if (colecao === 'convites') {
        raw = global.localStorage.getItem(chaveConvite(docId));
      } else {
        throw erro('local/invalid-collection', 'Coleção local não suportada.');
      }
      if (raw == null) return null;
      try { return clone(JSON.parse(raw)); }
      catch (_) { throw erro('local/storage-corrupt', 'Há dados locais inválidos. Limpe os dados locais do site para recomeçar.'); }
    },

    setDoc: function (colecao, id, dados) {
      storageDisponivel(global.localStorage, 'localStorage');
      const docId = String(id || '');
      const copia = clone(dados || {});
      let chave;
      if (colecao === 'casais') {
        const ponteiro = Object.keys(copia).length === 1 && typeof copia.casalIdRef === 'string';
        chave = ponteiro ? chavePonteiro(docId) : chaveCasal(docId);
        if (!ponteiro) {
          const revisao = Number(copia._revision);
          copia._revision = Number.isInteger(revisao) && revisao >= 0 ? revisao : 0;
          if (!copia._fieldRevisions || typeof copia._fieldRevisions !== 'object' || Array.isArray(copia._fieldRevisions)) {
            copia._fieldRevisions = {};
          }
        }
        // O ponteiro vive em namespace próprio e nunca sobrescreve/apaga o
        // espaço pessoal já persistido com pd-cache:<id>.
        if (!ponteiro) global.localStorage.removeItem(chavePonteiro(docId));
      } else if (colecao === 'convites') {
        chave = chaveConvite(docId);
      } else {
        throw erro('local/invalid-collection', 'Coleção local não suportada.');
      }
      try { global.localStorage.setItem(chave, JSON.stringify(copia)); }
      catch (_) { throw erro('local/storage-unavailable', 'Não foi possível salvar os dados locais. Verifique o espaço do navegador.'); }
    },

    updateDoc: function (colecao, id, patch) {
      const atual = store.getDoc(colecao, id);
      if (!atual) throw erro('local/not-found', 'Documento local não encontrado.');
      const copiaPatch = clone(patch || {});
      if (colecao === 'casais' && typeof atual.casalIdRef !== 'string' && !Object.prototype.hasOwnProperty.call(copiaPatch, '_revision')) {
        const revisaoAtual = Number.isInteger(Number(atual._revision)) ? Number(atual._revision) : 0;
        const novaRevisao = Math.max(0, revisaoAtual) + 1;
        const revisoesCampos = atual._fieldRevisions && typeof atual._fieldRevisions === 'object'
          ? clone(atual._fieldRevisions)
          : {};
        Object.keys(copiaPatch).forEach(function (campo) {
          if (!campo.startsWith('_')) revisoesCampos[campo] = novaRevisao;
        });
        copiaPatch._revision = novaRevisao;
        copiaPatch._updatedAt = new Date().toISOString();
        copiaPatch._fieldRevisions = revisoesCampos;
      }
      store.setDoc(colecao, id, Object.assign({}, atual, copiaPatch));
    },

    canJoinSpace: function (user, targetId) {
      const atual = store.getDoc('casais', user && user.uid);
      if (!atual) return false;
      if (typeof atual.casalIdRef === 'string') return atual.casalIdRef === String(targetId || '');
      const membros = atual.membros && typeof atual.membros === 'object' ? atual.membros : {};
      const emails = Object.keys(membros);
      return emails.length === 1 && emails[0] === user.email;
    },
  });

  const auth = Object.freeze({
    currentUser: function () {
      storageDisponivel(global.sessionStorage, 'sessionStorage');
      let sessao;
      try { sessao = JSON.parse(global.sessionStorage.getItem(CHAVE_SESSAO) || 'null'); }
      catch (_) { return null; }
      if (!sessao || !sessao.email || !sessao.uid) return null;
      const registro = lerUsuarios()[emailNormalizado(sessao.email)];
      return registro && registro.uid === sessao.uid ? usuarioPublico(registro) : null;
    },

    createUser: async function (email, password, displayName) {
      const normalizado = emailNormalizado(email);
      const nome = String(displayName || '').trim();
      if (!/^\S+@\S+\.\S+$/.test(normalizado)) throw erro('auth/invalid-email', 'Informe um e-mail válido.');
      if (String(password || '').length < 6) throw erro('auth/weak-password', 'A senha deve ter no mínimo 6 caracteres.');
      if (!nome) throw erro('auth/missing-name', 'Informe seu nome.');
      const usuarios = lerUsuarios();
      if (usuarios[normalizado]) throw erro('auth/email-already-in-use', 'Este e-mail já está cadastrado no modo local.');
      const salt = saltAleatorio();
      const registro = {
        uid: criarUid(),
        email: normalizado,
        displayName: nome,
        password: { algorithm: 'PBKDF2-SHA-256', iterations: ITERACOES, salt: salt, hash: await derivarSenha(password, salt) },
        criadoEm: new Date().toISOString(),
      };
      usuarios[normalizado] = registro;
      gravarUsuarios(usuarios);
      if (!global.PlannerCore) throw erro('local/core-unavailable', 'Não foi possível iniciar o espaço local. Recarregue a página.');
      global.PlannerCore.criarEspacoCasal(store, usuarioPublico(registro));
      return iniciarSessao(registro);
    },

    signIn: async function (email, password) {
      const normalizado = emailNormalizado(email);
      const registro = lerUsuarios()[normalizado];
      if (!registro || !registro.password || await derivarSenha(password, registro.password.salt) !== registro.password.hash) {
        throw erro('auth/invalid-credential', 'E-mail ou senha inválidos.');
      }
      return iniciarSessao(registro);
    },

    signOut: async function () {
      storageDisponivel(global.sessionStorage, 'sessionStorage');
      global.sessionStorage.removeItem(CHAVE_SESSAO);
    },

    resetPassword: async function (email, currentPassword, newPassword) {
      const normalizado = emailNormalizado(email);
      const usuarios = lerUsuarios();
      const registro = usuarios[normalizado];
      if (!registro || !registro.password
          || await derivarSenha(currentPassword, registro.password.salt) !== registro.password.hash) {
        throw erro('auth/invalid-credential', 'E-mail ou senha atual inválidos.');
      }
      if (String(newPassword || '').length < 6) {
        throw erro('auth/weak-password', 'A nova senha deve ter no mínimo 6 caracteres.');
      }
      const salt = saltAleatorio();
      registro.password = {
        algorithm: 'PBKDF2-SHA-256',
        iterations: ITERACOES,
        salt: salt,
        hash: await derivarSenha(newPassword, salt),
      };
      gravarUsuarios(usuarios);
    },
  });

  global.PlannerLocal = Object.freeze({ auth: auth, store: store });
}(window));
