// auth-errors.js — normalização segura de falhas do Firebase Authentication.
//
// O módulo não depende do DOM nem do Firebase. No navegador, expõe
// `window.PlannerAuthErrors`; em testes Node, usa CommonJS.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerAuthErrors = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MENSAGEM_CREDENCIAL = 'E-mail ou senha incorretos.';
  const MENSAGEM_GENERICA = 'Não foi possível concluir a autenticação. Tente novamente.';

  // Códigos que não devem revelar se o e-mail existe ou qual parte da
  // credencial falhou. Os aliases cobrem SDKs antigos e atuais.
  const CODIGOS_CREDENCIAL = new Set([
    'auth/invalid-credential',
    'auth/invalid-login-credentials',
    'auth/wrong-password',
    'auth/user-not-found',
  ]);

  const MARCADOR_CREDENCIAL_LEGADO = /\b(?:INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND)\b/i;

  const MENSAGENS = Object.freeze({
    'auth/invalid-credential': MENSAGEM_CREDENCIAL,
    'auth/invalid-email': 'E-mail inválido.',
    'auth/user-disabled': 'Conta desabilitada.',
    'auth/email-already-in-use': 'E-mail já cadastrado. Faça login.',
    'auth/weak-password': 'Senha muito fraca (mín. 6 caracteres).',
    'auth/network-request-failed': 'Sem conexão. Verifique sua internet e tente novamente.',
    'auth/timeout': 'A autenticação demorou demais. Verifique sua conexão e tente novamente.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
    'auth/missing-password': 'Informe a senha.',
    'auth/missing-email': 'Informe o e-mail.',
    'auth/operation-not-allowed': 'Este método de login não está habilitado no Firebase.',
    'auth/unauthorized-domain': 'Este domínio não está autorizado para login no Firebase.',
    'auth/app-not-authorized': 'Este aplicativo não está autorizado para esta origem. Verifique o domínio e as restrições da chave no Firebase.',
    'auth/operation-not-supported-in-this-environment': 'Este navegador ou origem não oferece suporte a este método de login.',
    'auth/web-storage-unsupported': 'O navegador bloqueou o armazenamento necessário para manter a sessão. Verifique as configurações de privacidade.',
    'auth/unsupported-persistence-type': 'O navegador não oferece suporte ao armazenamento de sessão solicitado.',
    'auth/missing-initial-state': 'Não foi possível recuperar o estado do login. Verifique cookies e armazenamento do navegador.',
    'auth/popup-blocked': 'O navegador bloqueou a janela de login.',
    'auth/popup-closed-by-user': 'Login cancelado.',
    'auth/cancelled-popup-request': 'Login cancelado.',
    'auth/redirect-cancelled-by-user': 'Login cancelado.',
    'auth/redirect-operation-pending': 'Já existe uma tentativa de login em andamento.',
    'auth/account-exists-with-different-credential': 'Este e-mail já está cadastrado com outro método. Use e-mail e senha.',
    'auth/invalid-api-key': 'A configuração de autenticação do aplicativo é inválida.',
    'auth/internal-error': MENSAGEM_GENERICA,
    'auth/unknown': MENSAGEM_GENERICA,
  });

  const CODIGOS_CANCELAMENTO = new Set([
    'auth/popup-closed-by-user',
    'auth/cancelled-popup-request',
    'auth/redirect-cancelled-by-user',
  ]);

  const OPERACOES_SEGURAS = new Set([
    'autenticacao',
    'persistencia',
    'login',
    'cadastro',
    'recuperacao-senha',
    'google-login',
    'google-redirect',
    'logout',
  ]);

  function lerTexto(error, campo) {
    if (!error || (typeof error !== 'object' && typeof error !== 'function')) return '';
    try {
      const valor = error[campo];
      return typeof valor === 'string' ? valor : '';
    } catch (_) {
      return '';
    }
  }

  function codigoBruto(error) {
    return lerTexto(error, 'code').trim().toLowerCase();
  }

  function ehCredencialLegada(error, codigo) {
    return codigo === 'auth/internal-error' && MARCADOR_CREDENCIAL_LEGADO.test(lerTexto(error, 'message'));
  }

  function categoriaDoCodigo(codigo) {
    if (codigo === 'auth/invalid-credential') return 'credencial';
    if (['auth/network-request-failed', 'auth/timeout', 'auth/too-many-requests'].includes(codigo)) return 'rede';
    if (['auth/unauthorized-domain', 'auth/app-not-authorized', 'auth/operation-not-supported-in-this-environment'].includes(codigo)) return 'origem';
    if (['auth/web-storage-unsupported', 'auth/unsupported-persistence-type', 'auth/missing-initial-state'].includes(codigo)) return 'armazenamento';
    if (CODIGOS_CANCELAMENTO.has(codigo)) return 'cancelamento';
    if (['auth/operation-not-allowed', 'auth/invalid-api-key'].includes(codigo)) return 'configuracao';
    if (codigo === 'auth/internal-error') return 'interno';
    if (codigo === 'auth/unknown') return 'desconhecido';
    return 'autenticacao';
  }

  /**
   * Normaliza somente para códigos conhecidos e seguros. Nenhum texto bruto do
   * backend é devolvido, nem mesmo para falhas inesperadas.
   */
  function normalizarErroAuth(error) {
    const recebido = codigoBruto(error);
    const credencialLegada = ehCredencialLegada(error, recebido);
    let codigo;

    if (CODIGOS_CREDENCIAL.has(recebido) || credencialLegada) {
      codigo = 'auth/invalid-credential';
    } else if (Object.prototype.hasOwnProperty.call(MENSAGENS, recebido)) {
      codigo = recebido;
    } else {
      codigo = 'auth/unknown';
    }

    return Object.freeze({
      codigo,
      categoria: categoriaDoCodigo(codigo),
      credencialLegada,
    });
  }

  function mensagemErroAuth(error) {
    const { codigo } = normalizarErroAuth(error);
    return MENSAGENS[codigo] || MENSAGEM_GENERICA;
  }

  /**
   * Produz diagnóstico por allowlist. Não copia message, customData, e-mail,
   * credenciais, tokens, chave de API ou payloads presentes no erro original.
   */
  function criarDiagnosticoErroAuth(error, operacao) {
    const normalizado = normalizarErroAuth(error);
    return Object.freeze({
      evento: 'firebase-auth-error',
      operacao: OPERACOES_SEGURAS.has(operacao) ? operacao : 'autenticacao',
      codigo: normalizado.codigo,
      categoria: normalizado.categoria,
      credencialLegada: normalizado.credencialLegada,
      codigoRecebido: Boolean(codigoBruto(error)),
      mensagemRecebida: Boolean(lerTexto(error, 'message')),
    });
  }

  function registrarErroAuth(error, operacao, logger) {
    const diagnostico = criarDiagnosticoErroAuth(error, operacao);
    const destino = logger || (typeof console !== 'undefined' ? console : null);
    const escrever = destino && (typeof destino.warn === 'function'
      ? destino.warn
      : typeof destino.error === 'function' ? destino.error : null);

    if (escrever) {
      try {
        escrever.call(destino, '[PlannerDuo auth]', diagnostico);
      } catch (_) {
        // Diagnóstico nunca pode interromper o fluxo de autenticação.
      }
    }
    return diagnostico;
  }

  function ehErroAuthCancelado(error) {
    return CODIGOS_CANCELAMENTO.has(codigoBruto(error));
  }


  return Object.freeze({
    MENSAGEM_CREDENCIAL,
    normalizarErroAuth,
    mensagemErroAuth,
    criarDiagnosticoErroAuth,
    registrarErroAuth,
    ehErroAuthCancelado,
  });
});
