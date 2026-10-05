/* PlannerDuo — criação e desbloqueio do acesso local. */
(function () {
  'use strict';
  const Repository = window.PlannerLocal;
  const $ = (selector, parent) => (parent || document).querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const AUTH_VIEWS = new Set(['unlock', 'setup', 'recovery']);
  let failedAttempts = 0;
  let recoverySource = 'vault';
  function initials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    return words.length ? (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() : '?';
  }
  function nextTarget() {
    const requested = new URLSearchParams(location.search).get('next') || '';
    const match = requested.match(/^app\.html(?:#(dashboard|finances|trips|goals|checklist|decisions|reports|settings))?$/);
    return match ? requested : 'app.html';
  }
  function showView(view) {
    const selected = AUTH_VIEWS.has(view) ? view : 'unlock';
    $$('.auth-state').forEach((element) => element.classList.toggle('active', element.id === `auth-${selected}`));
    $('#auth-status').textContent = '';
    window.setTimeout(() => $(`#auth-${selected} input:not([type="hidden"]):not([readonly])`)?.focus(), 60);
  }
  function setStatus(message, type) {
    const status = $('#auth-status');
    status.textContent = message || '';
    status.className = `auth-inline-status ${type || ''}`.trim();
  }
  function setButtonLoading(button, loading, label) {
    if (!button) return;
    if (loading) {
      button.dataset.original = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span>${label || 'Processando...'}`;
    } else {
      button.disabled = false;
      button.innerHTML = button.dataset.original || button.innerHTML;
    }
  }
  function redirectToApp() {
    location.replace(nextTarget());
  }
  function errorMessage(error) {
    const known = {
      'vault/invalid-email': 'Informe um e-mail válido.',
      'vault/invalid-name': 'Informe um nome entre 2 e 60 caracteres.',
      'vault/weak-password': 'A senha precisa ter de 10 a 128 caracteres, com letra e número.',
      'vault/invalid-credentials': 'E-mail ou senha incorretos.',
      'vault/already-exists': 'Esta conta já existe neste navegador. Faça login.',
      'vault/legacy-invalid': 'Os dados atuais estão inválidos e não puderam ser protegidos automaticamente.',
      'vault/crypto-unavailable': 'Atualize o navegador e acesse o app por localhost para usar criptografia.',
      'vault/locks-unavailable': 'Atualize o navegador: o bloqueio seguro entre abas não está disponível.',
      'local/storage-unavailable': 'Permita armazenamento local para criar ou abrir sua conta.',
      'local/write-failed': 'Não há espaço suficiente para criptografar os dados. A cópia atual foi preservada.',
    };
    return known[error && error.code] || 'Não foi possível concluir a operação com segurança.';
  }
  async function initialize() {
    if (!Repository || !Repository.auth) {
      setStatus('Os módulos de segurança não foram carregados.', 'error');
      return;
    }
    const restored = await Repository.auth.restoreSession();
    if (restored) {
      redirectToApp();
      return;
    }
    const status = Repository.auth.status();
    if (status.corrupt || status.legacyCorrupt) {
      recoverySource = status.corrupt ? 'vault' : 'legacy';
      $('#recovery-warning-title').textContent = status.corrupt ? 'Dados corrompidos' : 'Banco anterior inválido';
      $('#recovery-warning-text').textContent = status.corrupt
        ? 'Seus dados não puderam ser validados. Baixe a cópia bruta antes de apagar e recomeçar.'
        : 'O banco legível anterior não pode ser migrado sem perdas. Baixe a cópia bruta antes de apagar e recomeçar.';
      $('#download-raw-vault').hidden = false;
      showView('recovery');
    } else if (status.exists) {
      recoverySource = 'vault';
      $('#download-raw-vault').hidden = false;
      $('#unlock-email').value = status.account.email;
      $('#unlock-account-name').textContent = status.account.name;
      $('#unlock-account-email').textContent = status.account.email;
      $('#unlock-account-avatar').textContent = initials(status.account.name);
      showView('unlock');
    } else {
      $('#legacy-migration-notice').hidden = !status.hasLegacyWorkspace;
      showView('setup');
    }
    try {
      const warning = sessionStorage.getItem('plannerduo:auth-warning');
      if (warning) {
        sessionStorage.removeItem('plannerduo:auth-warning');
        setStatus(warning, 'error');
      }
    } catch (_) {}
  }
  $('#unlock-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    if (failedAttempts >= 5) {
      setStatus('Muitas tentativas. Aguarde alguns segundos antes de tentar novamente.', 'error');
      button.disabled = true;
      window.setTimeout(() => { failedAttempts = 0; button.disabled = false; }, 10000);
      return;
    }
    setButtonLoading(button, true, 'Descriptografando...');
    setStatus('Derivando a chave local. Isso pode levar alguns instantes.', 'working');
    try {
      await Repository.auth.unlock({
        email: $('#unlock-email').value,
        password: $('#unlock-password').value,
      });
      $('#unlock-password').value = '';
      setStatus('Pronto, abrindo…', 'success');
      redirectToApp();
    } catch (error) {
      failedAttempts += 1;
      $('#unlock-password').value = '';
      setStatus(errorMessage(error), 'error');
      setButtonLoading(button, false);
      $('#unlock-password').focus();
    }
  });
  $('#setup-vault-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = $('#setup-account-password').value;
    const confirmation = $('#setup-account-confirm').value;
    if (password !== confirmation) {
      setStatus('As senhas não coincidem.', 'error');
      $('#setup-account-confirm').focus();
      return;
    }
    if (!$('#setup-no-recovery').checked) {
      setStatus('Confirme que entende a política sem recuperação de senha.', 'error');
      return;
    }
    const button = form.querySelector('[type="submit"]');
    setButtonLoading(button, true, 'Criptografando dados...');
    setStatus('Protegendo seus dados antes de remover qualquer cópia legível.', 'working');
    try {
      const result = await Repository.auth.createVault({
        name: $('#setup-account-name').value,
        email: $('#setup-account-email').value,
        password,
      });
      form.reset();
      setStatus(result.migrated ? 'Dados existentes protegidos, abrindo…' : 'Conta criada, abrindo…', 'success');
      redirectToApp();
    } catch (error) {
      setStatus(errorMessage(error), 'error');
      setButtonLoading(button, false);
    }
  });
  $('#setup-account-password')?.addEventListener('input', (event) => {
    const value = event.target.value;
    const checks = [value.length >= 10, /[\p{L}]/u.test(value), /\d/.test(value), value.length >= 14 && /[^\p{L}\d]/u.test(value)];
    const level = checks.filter(Boolean).length;
    const strength = $('#password-strength');
    strength.dataset.level = String(level);
    $('span', strength).textContent = level < 3 ? 'Use no mínimo 10 caracteres, com letra e número.' : level === 3 ? 'Senha válida. Uma frase maior será ainda melhor.' : 'Senha forte para uso local.';
  });
  document.addEventListener('click', async (event) => {
    const toggle = event.target.closest('[data-toggle-password]');
    if (toggle) {
      const input = document.getElementById(toggle.dataset.togglePassword);
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggle.textContent = showing ? '◉' : '○';
      toggle.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
      return;
    }
    const viewButton = event.target.closest('[data-auth-view]');
    if (viewButton) {
      showView(viewButton.dataset.authView);
      return;
    }
    if (event.target.closest('#download-raw-vault')) {
      try {
        const raw = recoverySource === 'legacy'
          ? Repository.auth.exportRawLegacy()
          : Repository.auth.exportRawVault();
        const blob = new Blob([raw], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `plannerduo-dados-corrompidos-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setStatus('Cópia bruta baixada. Guarde-a antes de apagar seus dados.', 'success');
      } catch (_) {
        setStatus('Não foi possível baixar a cópia bruta.', 'error');
      }
      return;
    }
    if (event.target.closest('#destroy-vault-button')) {
      if ($('#destroy-vault-confirmation').value !== 'APAGAR') {
        setStatus('Digite APAGAR exatamente para confirmar.', 'error');
        return;
      }
      const button = $('#destroy-vault-button');
      setButtonLoading(button, true, 'Apagando dados...');
      try {
        await Repository.auth.destroyVault();
        $('#destroy-vault-confirmation').value = '';
        location.reload();
      } catch (error) {
        setStatus(errorMessage(error), 'error');
        setButtonLoading(button, false);
      }
    }
  });
  window.addEventListener('storage', (event) => {
    if ([Repository.VAULT_KEY, Repository.AUTH_EVENT_KEY, Repository.AUTH_EPOCH_KEY].includes(event.key)) location.reload();
  });
  initialize().catch(() => setStatus('Não foi possível iniciar a tela de segurança.', 'error'));
})();
