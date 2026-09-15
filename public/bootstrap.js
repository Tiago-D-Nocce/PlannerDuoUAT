// bootstrap.js — supervisor mínimo e independente do carregamento do PlannerDuo.
//
// Ele é carregado antes do Firebase para transformar falhas de SDK, scripts ou
// inicialização em um estado visível e recuperável, em vez de deixar a tela em
// um loader infinito. Não registra objetos de erro nem dados do usuário.
(function (root, factory) {
  const api = factory();
  const supervisor = api.criarSupervisorBootstrap({
    janela: root,
    documento: root && root.document,
    agendar: root && typeof root.setTimeout === 'function'
      ? root.setTimeout.bind(root)
      : undefined,
    cancelar: root && typeof root.clearTimeout === 'function'
      ? root.clearTimeout.bind(root)
      : undefined,
    logger: root && root.console,
  });
  const publico = Object.freeze({ ...api, ...supervisor });

  if (typeof module !== 'undefined' && module.exports) module.exports = publico;
  if (root && typeof root === 'object') root.PlannerBootstrap = publico;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MENSAGEM_APP = 'Não foi possível iniciar o PlannerDuo. Verifique sua conexão e tente novamente.';
  const MENSAGEM_AUTH = 'Não foi possível carregar a autenticação. Verifique sua conexão e tente novamente.';
  const CATEGORIAS = new Set([
    'timeout',
    'recurso',
    'sdk',
    'autenticacao',
    'firestore',
    'inicializacao',
  ]);

  function criarSupervisorBootstrap({
    janela,
    documento,
    agendar,
    cancelar,
    logger,
  } = {}) {
    let pagina = 'app';
    let estado = 'ocioso';
    let temporizador = null;
    let ouvindo = false;

    const porId = (id) => documento && typeof documento.getElementById === 'function'
      ? documento.getElementById(id)
      : null;

    function limparTemporizador() {
      if (temporizador !== null && typeof cancelar === 'function') cancelar(temporizador);
      temporizador = null;
    }

    function removerOuvintes() {
      if (!ouvindo || !janela || typeof janela.removeEventListener !== 'function') return;
      janela.removeEventListener('error', aoErroGlobal, true);
      janela.removeEventListener('unhandledrejection', aoRejeicaoGlobal);
      ouvindo = false;
    }

    function finalizarEscuta() {
      limparTemporizador();
      removerOuvintes();
    }

    function categoriaSegura(valor) {
      return CATEGORIAS.has(valor) ? valor : 'inicializacao';
    }

    function mostrarFalha() {
      if (pagina === 'auth') {
        const painel = porId('auth-bootstrap-error');
        const detalhe = porId('auth-bootstrap-detail');
        if (detalhe) detalhe.textContent = MENSAGEM_AUTH;
        if (painel) {
          painel.hidden = false;
          if (painel.dataset) painel.dataset.estado = 'erro';
        }
        return;
      }

      const loader = porId('loader-tela');
      const mensagem = porId('loader-msg');
      const acoes = porId('loader-acoes');
      if (loader) {
        if (loader.dataset) loader.dataset.estado = 'erro';
        if (typeof loader.setAttribute === 'function') loader.setAttribute('aria-busy', 'false');
      }
      if (mensagem) mensagem.textContent = MENSAGEM_APP;
      if (acoes) {
        acoes.hidden = false;
        if (acoes.style) acoes.style.display = 'flex';
      }
    }

    function falhar(categoria = 'inicializacao') {
      if (estado === 'pronto' || estado === 'erro') return false;
      estado = 'erro';
      finalizarEscuta();
      mostrarFalha();

      const escrever = logger && (typeof logger.warn === 'function'
        ? logger.warn
        : typeof logger.error === 'function' ? logger.error : null);
      if (escrever) {
        try {
          escrever.call(logger, '[PlannerDuo bootstrap]', {
            evento: 'bootstrap-failure',
            pagina,
            categoria: categoriaSegura(categoria),
          });
        } catch (_) {
          // O diagnóstico nunca pode impedir a recuperação visual.
        }
      }
      return true;
    }

    function concluir() {
      if (estado !== 'pendente') return false;
      estado = 'pronto';
      finalizarEscuta();
      return true;
    }

    function aoErroGlobal(evento) {
      const alvo = evento && evento.target;
      const tag = alvo && typeof alvo.tagName === 'string' ? alvo.tagName.toLowerCase() : '';
      falhar(tag === 'script' || tag === 'link' ? 'recurso' : 'inicializacao');
    }

    function aoRejeicaoGlobal() {
      falhar('inicializacao');
    }

    function iniciar(opcoes = {}) {
      if (estado !== 'ocioso') return false;
      pagina = opcoes.pagina === 'auth' ? 'auth' : 'app';
      estado = 'pendente';

      if (janela && typeof janela.addEventListener === 'function') {
        janela.addEventListener('error', aoErroGlobal, true);
        janela.addEventListener('unhandledrejection', aoRejeicaoGlobal);
        ouvindo = true;
      }

      const timeoutMs = Number.isFinite(opcoes.timeoutMs) && opcoes.timeoutMs > 0
        ? opcoes.timeoutMs
        : 10000;
      if (typeof agendar === 'function') temporizador = agendar(() => falhar('timeout'), timeoutMs);
      return true;
    }

    function estadoAtual() {
      return Object.freeze({ pagina, estado });
    }

    return Object.freeze({ iniciar, concluir, falhar, estadoAtual });
  }

  return Object.freeze({
    MENSAGEM_APP,
    MENSAGEM_AUTH,
    criarSupervisorBootstrap,
  });
});
