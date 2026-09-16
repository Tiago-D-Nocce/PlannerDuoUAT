// bootstrap.js — supervisor mínimo e independente do carregamento do PlannerDuo.
//
// Ele é carregado antes do Firebase para transformar falhas explícitas de
// recursos obrigatórios ou da inicialização em recuperação visível. Limites de
// fase sinalizam demora recuperável; não fabricam uma falha da operação real.
// Não registra objetos de erro nem dados do usuário.
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
  const MENSAGEM_DEMORA_APP = 'A inicialização está demorando mais que o esperado. Você pode aguardar ou tentar novamente.';
  const MENSAGEM_DEMORA_AUTH = 'A autenticação está demorando mais que o esperado. Você pode aguardar ou tentar novamente.';
  const CATEGORIAS = new Set([
    'timeout',
    'recurso',
    'sdk',
    'autenticacao',
    'armazenamento',
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
    let avisoDemoraAtivo = false;

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
      ouvindo = false;
    }

    function finalizarEscuta() {
      limparTemporizador();
      removerOuvintes();
    }

    function categoriaSegura(valor) {
      return CATEGORIAS.has(valor) ? valor : 'inicializacao';
    }

    function mostrarDemora() {
      avisoDemoraAtivo = true;
      if (pagina === 'auth') {
        const painel = porId('auth-bootstrap-error');
        const detalhe = porId('auth-bootstrap-detail');
        if (detalhe) detalhe.textContent = MENSAGEM_DEMORA_AUTH;
        if (painel) {
          painel.hidden = false;
          if (painel.dataset) painel.dataset.estado = 'demorado';
        }
        return;
      }

      const loader = porId('loader-tela');
      const mensagem = porId('loader-msg');
      const acoes = porId('loader-acoes');
      if (loader) {
        if (loader.dataset) loader.dataset.estado = 'demorado';
        if (typeof loader.setAttribute === 'function') loader.setAttribute('aria-busy', 'false');
      }
      if (mensagem) mensagem.textContent = MENSAGEM_DEMORA_APP;
      if (acoes) {
        acoes.hidden = false;
        if (acoes.style) acoes.style.display = 'flex';
      }
    }

    function limparAvisoDemora(concluido = false) {
      if (!avisoDemoraAtivo) return;
      avisoDemoraAtivo = false;

      if (pagina === 'auth') {
        const painel = porId('auth-bootstrap-error');
        const detalhe = porId('auth-bootstrap-detail');
        if (detalhe && detalhe.textContent === MENSAGEM_DEMORA_AUTH) detalhe.textContent = '';
        if (painel) {
          painel.hidden = true;
          if (painel.dataset) painel.dataset.estado = concluido ? 'pronto' : 'carregando';
        }
        return;
      }

      const loader = porId('loader-tela');
      const mensagem = porId('loader-msg');
      const acoes = porId('loader-acoes');
      if (loader) {
        if (loader.dataset) loader.dataset.estado = concluido ? 'pronto' : 'carregando';
        if (typeof loader.setAttribute === 'function') {
          loader.setAttribute('aria-busy', concluido ? 'false' : 'true');
        }
      }
      if (mensagem && mensagem.textContent === MENSAGEM_DEMORA_APP) mensagem.textContent = '';
      if (acoes) {
        acoes.hidden = true;
        if (acoes.style) acoes.style.display = 'none';
      }
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
      if (estado === 'pronto' || estado === 'erro' || estado === 'ocioso') return false;
      estado = 'erro';
      avisoDemoraAtivo = false;
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
      if (estado !== 'pendente' && estado !== 'demorado') return false;
      estado = 'pronto';
      finalizarEscuta();
      limparAvisoDemora(true);
      return true;
    }

    function demorar() {
      if (estado !== 'pendente') return false;
      temporizador = null;
      estado = 'demorado';
      mostrarDemora();
      return true;
    }

    function recursoObrigatorio(alvo) {
      const tag = alvo && typeof alvo.tagName === 'string' ? alvo.tagName.toLowerCase() : '';
      if (tag !== 'script') return false;

      let atributo = '';
      try {
        if (alvo.dataset && typeof alvo.dataset.bootstrapRequired === 'string') {
          atributo = alvo.dataset.bootstrapRequired;
        } else if (typeof alvo.getAttribute === 'function') {
          atributo = alvo.getAttribute('data-bootstrap-required') || '';
        }
      } catch (_) {
        return false;
      }
      return atributo === 'true';
    }

    function aoErroGlobal(evento) {
      if (recursoObrigatorio(evento && evento.target)) falhar('recurso');
    }

    function agendarDemora(timeoutMs) {
      limparTemporizador();
      const limite = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000;
      if (typeof agendar === 'function') temporizador = agendar(demorar, limite);
    }

    function iniciarFase(_nome, timeoutMs) {
      if (estado !== 'pendente' && estado !== 'demorado') return false;
      if (estado === 'demorado') {
        limparAvisoDemora(false);
        estado = 'pendente';
      }
      agendarDemora(timeoutMs);
      return true;
    }

    function iniciar(opcoes = {}) {
      if (estado !== 'ocioso') return false;
      pagina = opcoes.pagina === 'auth' ? 'auth' : 'app';
      estado = 'pendente';

      if (janela && typeof janela.addEventListener === 'function') {
        janela.addEventListener('error', aoErroGlobal, true);
        ouvindo = true;
      }

      iniciarFase('recursos', opcoes.timeoutMs);
      return true;
    }

    function estadoAtual() {
      return Object.freeze({ pagina, estado });
    }

    return Object.freeze({ iniciar, iniciarFase, concluir, falhar, estadoAtual });
  }

  return Object.freeze({
    MENSAGEM_APP,
    MENSAGEM_AUTH,
    MENSAGEM_DEMORA_APP,
    MENSAGEM_DEMORA_AUTH,
    criarSupervisorBootstrap,
  });
});
