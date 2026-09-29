/* PlannerDuo — aplicação local de página única. */
(function () {
  'use strict';

  const Core = window.PlannerCore;
  const Repository = window.PlannerLocal;
  const state = {
    workspace: null,
    account: null,
    currentView: 'dashboard',
    decisionFilter: 'all',
    travelProviderFilter: 'all',
    voterByDecision: {},
    pendingBackupSource: null,
    unsubscribe: null,
    locking: false,
    sessionExpiresAt: 0,
    lastActivityAt: Date.now(),
    autoLockTimer: null,
  };
  const AUTO_LOCK_MS = 30 * 60 * 1000;

  const CATEGORY_META = Object.freeze({
    alimentacao: { label: 'Alimentação', icon: '🍽', color: '#f97316' },
    transporte: { label: 'Transporte', icon: '↗', color: '#3b82f6' },
    moradia: { label: 'Moradia', icon: '⌂', color: '#8b5cf6' },
    lazer: { label: 'Lazer', icon: '✦', color: '#ec4899' },
    saude: { label: 'Saúde', icon: '✚', color: '#10b981' },
    viagem: { label: 'Viagem', icon: '⌁', color: '#06b6d4' },
    educacao: { label: 'Educação', icon: '▤', color: '#eab308' },
    vestuario: { label: 'Vestuário', icon: '◇', color: '#a855f7' },
    salario: { label: 'Salário', icon: '↥', color: '#22c55e' },
    investimento: { label: 'Investimento', icon: '◒', color: '#14b8a6' },
    outros: { label: 'Outros', icon: '•', color: '#64748b' },
  });

  const CHECKLIST_META = Object.freeze({
    documentos: 'Documentos',
    roupas: 'Roupas',
    higiene: 'Higiene',
    tecnologia: 'Tecnologia',
    saude: 'Saúde',
    outros: 'Outros',
  });

  const Travel = window.PlannerTravel;
  const TRAVEL_PROVIDERS = Travel ? Travel.providers : Object.freeze([]);

  const $ = (selector, parent) => (parent || document).querySelector(selector);
  const $$ = (selector, parent) => [...(parent || document).querySelectorAll(selector)];

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  }

  function money(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
    }).format(Number(value) || 0);
  }

  function parseMoney(value) {
    const source = String(value == null ? '' : value).trim();
    if (!source) return NaN;
    const normalized = source.includes(',')
      ? source.replace(/\./g, '').replace(',', '.')
      : source;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > Core.MAX_AMOUNT) return NaN;
    const cents = Math.round(parsed * 100);
    return Number.isSafeInteger(cents) ? cents / 100 : NaN;
  }

  function parseOptionalMoney(value) {
    return String(value == null ? '' : value).trim() ? parseMoney(value) : 0;
  }

  function today() {
    const current = new Date();
    return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
  }

  function currentMonth() {
    return today().slice(0, 7);
  }

  function formatDate(value) {
    if (!value) return 'Sem data';
    const parsed = new Date(`${value}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return 'Sem data';
    return new Intl.DateTimeFormat('pt-BR').format(parsed);
  }

  function formatMonth(key) {
    const [year, month] = String(key).split('-').map(Number);
    if (!year || !month) return key;
    const label = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' })
      .format(new Date(year, month - 1, 1))
      .replace('.', '');
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function categoryMeta(category) {
    return CATEGORY_META[category] || CATEGORY_META.outros;
  }

  function participantById(id) {
    return state.workspace.participants.find((participant) => participant.id === id) || null;
  }

  function participantName(id) {
    const participant = participantById(id);
    return participant ? participant.name : 'Não atribuído';
  }

  function activeParticipants() {
    return state.workspace.participants.filter((participant) => participant.active);
  }

  function emptyState(icon, title, description) {
    return `<div class="empty-state"><div class="empty-state-icon">${escapeHtml(icon)}</div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></div>`;
  }

  function toast(title, description, type) {
    const container = $('#toast-container');
    if (!container) return;
    const element = document.createElement('div');
    element.className = `toast ${type || ''}`.trim();
    element.innerHTML = `<i>${type === 'success' ? '✓' : type === 'error' ? '!' : 'i'}</i><div><strong>${escapeHtml(title)}</strong>${description ? `<span>${escapeHtml(description)}</span>` : ''}</div>`;
    container.appendChild(element);
    window.setTimeout(() => {
      element.classList.add('out');
      window.setTimeout(() => element.remove(), 220);
    }, 3200);
  }

  function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
  }

  function showDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function setTravelSearchStatus(message, type) {
    const status = $('#travel-search-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('success', type === 'success');
    status.classList.toggle('error', type === 'error');
  }

  function readTravelSearch(provider) {
    const result = Travel.validate(provider.id, {
      origin: $('#travel-search-origin')?.value,
      destination: $('#travel-search-destination')?.value,
      departure: $('#travel-search-departure')?.value,
      returnDate: $('#travel-search-return')?.value,
      passengers: $('#travel-search-passengers')?.value,
    }, today());
    if (result.ok) return result.data;

    setTravelSearchStatus(result.message, 'error');
    toast(result.title, result.message, 'error');
    const fields = {
      origin: '#travel-search-origin',
      destination: '#travel-search-destination',
      departure: '#travel-search-departure',
      return: '#travel-search-return',
      passengers: '#travel-search-passengers',
    };
    $(fields[result.field])?.focus();
    return null;
  }

  function travelSummary(data) {
    const period = data.departure
      ? `${formatDate(data.departure)}${data.returnDate ? ` a ${formatDate(data.returnDate)}` : ' · somente ida'}`
      : 'datas em aberto';
    return `${data.origin || 'Origem em aberto'} → ${data.destination} · ${period} · ${data.passengers} ${data.passengers === 1 ? 'viajante' : 'viajantes'}`;
  }

  function buildTravelProviderSearch(provider, data) {
    return Travel.build(provider.id, data, today());
  }

  async function openTravelProvider(providerId) {
    const provider = TRAVEL_PROVIDERS.find((item) => item.id === providerId);
    if (!provider) return;
    const data = readTravelSearch(provider);
    if (!data) return;

    let search;
    try {
      search = buildTravelProviderSearch(provider, data);
    } catch (_) {
      setTravelSearchStatus('Não foi possível preparar esse site com segurança.', 'error');
      toast('Busca indisponível', 'Tente outro provedor.', 'error');
      return;
    }

    try {
      const link = document.createElement('a');
      link.href = search.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (_) {
      setTravelSearchStatus('O navegador não conseguiu abrir a nova aba. Tente novamente.', 'error');
      toast('Não foi possível abrir', 'Verifique as permissões do navegador.', 'error');
      return;
    }

    let copied = false;
    if (!search.prefilled && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(travelSummary(data));
        copied = true;
      } catch (_) {}
    }
    const modeMessage = search.mode === 'exact'
      ? `${provider.name} aberto com as datas inseridas na URL de busca.`
      : search.mode === 'assisted'
        ? `${provider.name} aberto com uma busca assistida. Confirme os campos exibidos.`
        : `${provider.name} aberto na página oficial.${copied ? ' O resumo foi copiado.' : ' Preencha os campos no site.'}`;
    const detail = search.warnings && search.warnings.length
      ? `${modeMessage} ${search.warnings[0]}`
      : modeMessage;
    setTravelSearchStatus(detail, 'success');
    toast('Busca aberta', detail, 'success');
  }

  function fillTravelSearchFromTrip(tripId) {
    const trip = state.workspace.trips.find((item) => item.id === tripId);
    if (!trip) return;
    const referenceDate = today();
    const departure = trip.startDate && trip.startDate >= referenceDate ? trip.startDate : '';
    const returnDate = departure && trip.endDate && trip.endDate >= departure ? trip.endDate : '';
    $('#travel-search-destination').value = trip.destination;
    $('#travel-search-departure').value = departure;
    $('#travel-search-return').value = returnDate;
    const returnInput = $('#travel-search-return');
    if (returnInput) returnInput.min = departure || referenceDate;
    const datesReused = departure || returnDate;
    const message = datesReused
      ? `Destino e datas futuras de “${trip.destination}” carregados. Informe a origem e escolha um site.`
      : `Destino “${trip.destination}” carregado. Datas passadas ou incompletas ficaram em aberto para uma nova busca.`;
    setTravelSearchStatus(message, 'success');
    $('#travel-search-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!$('#travel-search-origin').value) window.setTimeout(() => $('#travel-search-origin')?.focus(), 350);
  }

  function loginTarget() {
    const allowedViews = new Set(['dashboard', 'finances', 'trips', 'goals', 'checklist', 'decisions', 'reports', 'settings']);
    const view = location.hash.slice(1);
    const next = allowedViews.has(view) ? `app.html#${view}` : 'app.html';
    return `auth.html?next=${encodeURIComponent(next)}`;
  }

  function redirectToLogin() {
    if (location && typeof location.replace === 'function') location.replace(loginTarget());
    else location.href = loginTarget();
  }

  async function lockVault(options) {
    if (state.locking) return;
    state.locking = true;
    try { state.unsubscribe?.(); } catch (_) {}
    state.unsubscribe = null;
    if (state.autoLockTimer) window.clearInterval(state.autoLockTimer);
    state.autoLockTimer = null;
    state.workspace = null;
    state.account = null;
    try {
      await Repository.auth.lock({ allTabs: !options || options.allTabs !== false });
    } catch (_) {
      try { sessionStorage.setItem('plannerduo:auth-warning', 'Não foi possível confirmar o bloqueio das outras abas. Feche-as manualmente.'); } catch (_) {}
    } finally {
      redirectToLogin();
    }
  }

  function setupAutoLock() {
    const expired = () => Date.now() >= state.sessionExpiresAt
      || Date.now() - state.lastActivityAt >= AUTO_LOCK_MS;
    const enforceDeadline = () => {
      if (!state.locking && expired()) {
        lockVault({ allTabs: false });
        return true;
      }
      return false;
    };
    const recordActivity = () => {
      if (!enforceDeadline()) state.lastActivityAt = Date.now();
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach((type) => {
      window.addEventListener(type, recordActivity, { passive: true });
    });
    window.addEventListener('pageshow', enforceDeadline);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') enforceDeadline();
    });
    state.autoLockTimer = window.setInterval(enforceDeadline, 30000);
  }

  function entityConflict(message) {
    const error = new Error(message || 'Este item foi alterado ou removido em outra aba.');
    error.code = 'local/entity-conflict';
    return error;
  }

  async function commit(mutator, successMessage) {
    if (state.locking) return false;
    const expectedGeneration = state.workspace.generation;
    try {
      const updatedWorkspace = await Repository.update(mutator, expectedGeneration);
      if (state.locking) return false;
      state.workspace = updatedWorkspace;
      renderAll();
      if (successMessage) toast(successMessage, '', 'success');
      return true;
    } catch (error) {
      if (error && (error.code === 'local/workspace-replaced' || error.code === 'local/entity-conflict')) {
        state.workspace = error.currentWorkspace || await Repository.load();
        renderAll();
        toast(
          error.code === 'local/workspace-replaced' ? 'Workspace substituído em outra aba' : 'Item alterado em outra aba',
          error.message || 'Sua alteração não foi aplicada. Revise o estado atual.',
          'error'
        );
        return false;
      }
      if (error && ['vault/locked', 'vault/session-invalid', 'vault/invalid-credentials'].includes(error.code)) {
        await lockVault({ allTabs: false });
        return false;
      }
      toast('Não foi possível salvar', error && error.message ? error.message : 'Tente novamente.', 'error');
      return false;
    }
  }

  function monthSeries(count, participantId) {
    const now = new Date();
    const result = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      result.push({ key, label: formatMonth(key), income: 0, expense: 0 });
    }
    const byKey = new Map(result.map((item) => [item.key, item]));
    state.workspace.finances.forEach((finance) => {
      if (participantId && participantId !== 'all' && finance.paidById !== participantId) return;
      const target = byKey.get(finance.date.slice(0, 7));
      if (target) target[finance.type] += finance.amount;
    });
    return result;
  }

  function renderBarChart(selector, series) {
    const container = $(selector);
    if (!container) return;
    const minimum = series.length > 6 ? '42px' : '0';
    container.style.gridTemplateColumns = `repeat(${Math.max(series.length, 1)}, minmax(${minimum}, 1fr))`;
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'Gráfico de receitas e despesas por mês');
    const maximum = Math.max(0, ...series.flatMap((item) => [item.income, item.expense]));
    if (!maximum) {
      container.innerHTML = '<div class="chart-empty">Os lançamentos aparecerão aqui conforme forem registrados.</div>';
      return;
    }
    container.innerHTML = series.map((item) => {
      const incomeHeight = item.income ? Math.max(4, (item.income / maximum) * 100) : 1;
      const expenseHeight = item.expense ? Math.max(4, (item.expense / maximum) * 100) : 1;
      return `<div class="bar-group"><div class="bar-pair"><i class="income" tabindex="0" role="img" aria-label="${escapeHtml(`${item.label}: receitas ${money(item.income)}`)}" style="height:${incomeHeight}%" data-value="${escapeHtml(money(item.income))}"></i><i class="expense" tabindex="0" role="img" aria-label="${escapeHtml(`${item.label}: despesas ${money(item.expense)}`)}" style="height:${expenseHeight}%" data-value="${escapeHtml(money(item.expense))}"></i></div><label>${escapeHtml(item.label)}</label></div>`;
    }).join('');
  }

  function renderWorkspaceIdentity() {
    const workspaceName = state.workspace.name || 'Workspace local';
    const accountName = state.account?.name || 'Conta local';
    setText('#sidebar-account-name', accountName);
    setText('#sidebar-account-email', state.account?.email || 'Cofre desbloqueado');
    setText('#sidebar-account-avatar', initials(accountName));
    setText('#security-account-name', accountName);
    setText('#security-account-email', state.account?.email || '');
    setText('#sidebar-workspace-name', workspaceName);
    setText('#dashboard-greeting', state.workspace.name ? `${state.workspace.name}, em um só lugar.` : 'Planeje do seu jeito.');
    setText('#dashboard-subtitle', activeParticipants().length
      ? 'Finanças, viagens, metas e escolhas organizadas por quem realmente participa.'
      : 'Adicione participantes quando quiser ou use o espaço individualmente.');

    const participants = activeParticipants();
    const sidebar = $('#sidebar-participants');
    if (sidebar) {
      sidebar.innerHTML = participants.length
        ? participants.slice(0, 5).map((participant) => `<span class="mini-avatar" style="background:${participant.color}" title="${escapeHtml(participant.name)}">${escapeHtml(initials(participant.name))}</span>`).join('')
          + (participants.length > 5 ? `<span class="mini-avatar more">+${participants.length - 5}</span>` : '')
        : '<span class="muted">Nenhum participante</span>';
    }

    const ribbon = $('#dashboard-participants');
    if (ribbon) {
      ribbon.innerHTML = participants.map((participant) => `<span class="participant-chip"><i style="background:${participant.color}">${escapeHtml(initials(participant.name))}</i>${escapeHtml(participant.name)}</span>`).join('')
        + '<button class="participant-chip add" type="button" data-view="settings">＋ Gerenciar participantes</button>';
    }

    const financeBadge = $('#nav-finance-count');
    if (financeBadge) {
      financeBadge.textContent = String(state.workspace.finances.length);
      financeBadge.hidden = state.workspace.finances.length === 0;
    }
    const openDecisionCount = state.workspace.decisions.filter((decision) => decision.status === 'open').length;
    const decisionBadge = $('#nav-decision-count');
    if (decisionBadge) {
      decisionBadge.textContent = String(openDecisionCount);
      decisionBadge.hidden = openDecisionCount === 0;
    }
  }

  function renderDashboard() {
    const month = currentMonth();
    const monthFinances = state.workspace.finances.filter((finance) => finance.date.startsWith(month));
    const income = monthFinances.filter((finance) => finance.type === 'income').reduce((sum, finance) => sum + finance.amount, 0);
    const expense = monthFinances.filter((finance) => finance.type === 'expense').reduce((sum, finance) => sum + finance.amount, 0);
    const incomeCount = monthFinances.filter((finance) => finance.type === 'income').length;
    const expenseCount = monthFinances.filter((finance) => finance.type === 'expense').length;
    const openDecisions = state.workspace.decisions.filter((decision) => decision.status === 'open').length;

    setText('#metric-income', money(income));
    setText('#metric-expense', money(expense));
    setText('#metric-balance', money(income - expense));
    setText('#metric-decisions', String(openDecisions));
    setText('#metric-income-note', incomeCount ? `${incomeCount} ${incomeCount === 1 ? 'lançamento' : 'lançamentos'}` : 'Nenhum lançamento');
    setText('#metric-expense-note', expenseCount ? `${expenseCount} ${expenseCount === 1 ? 'lançamento' : 'lançamentos'}` : 'Nenhum lançamento');
    setText('#metric-decisions-note', openDecisions ? 'Aguardando votos' : 'Tudo decidido');

    renderBarChart('#cashflow-chart', monthSeries(6, 'all'));
    renderCategoryChart(monthFinances.filter((finance) => finance.type === 'expense'));
    renderSettlements(month);
    renderDashboardTrips();
  }

  function renderCategoryChart(finances) {
    const container = $('#category-chart');
    if (!container) return;
    const totals = finances.reduce((result, finance) => {
      result[finance.category] = (result[finance.category] || 0) + finance.amount;
      return result;
    }, {});
    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maximum = Math.max(0, ...entries.map((entry) => entry[1]));
    if (!entries.length) {
      container.innerHTML = emptyState('◔', 'Sem despesas no mês', 'As categorias serão comparadas aqui.');
      return;
    }
    container.innerHTML = entries.map(([category, total]) => {
      const meta = categoryMeta(category);
      return `<div class="progress-item"><div class="progress-item-head"><span>${escapeHtml(meta.icon)} ${escapeHtml(meta.label)}</span><strong>${escapeHtml(money(total))}</strong></div><div class="progress-track"><i style="width:${(total / maximum) * 100}%;background:${meta.color}"></i></div></div>`;
    }).join('');
  }

  function renderSettlements(month) {
    const container = $('#settlement-list');
    if (!container) return;
    const participants = state.workspace.participants;
    if (participants.length < 2) {
      container.innerHTML = emptyState('≈', 'Divisão disponível quando você quiser', 'Adicione duas ou mais pessoas e selecione quem participa de cada despesa.');
      return;
    }
    const result = Core.calculateSettlements(state.workspace.finances, participants, { month });
    const hasExpense = state.workspace.finances.some((finance) => finance.type === 'expense' && finance.date.startsWith(month) && finance.paidById);
    if (!hasExpense) {
      container.innerHTML = emptyState('✓', 'Nenhum acerto pendente', 'Registre despesas atribuídas para calcular os saldos automaticamente.');
      return;
    }
    const balanceMarkup = result.balances.map((balance) => {
      const participant = participantById(balance.participantId);
      if (!participant) return '';
      const label = balance.amount > 0 ? 'tem a receber' : balance.amount < 0 ? 'precisa repassar' : 'está em equilíbrio';
      return `<div class="balance-chip"><span>${escapeHtml(participant.name)} · ${label}</span><strong class="${balance.amount > 0 ? 'positive' : balance.amount < 0 ? 'negative' : ''}">${escapeHtml(money(Math.abs(balance.amount)))}</strong></div>`;
    }).join('');
    const transferMarkup = result.transfers.length
      ? `<div class="transfer-list">${result.transfers.map((transfer) => `<div class="transfer-row"><strong>${escapeHtml(participantName(transfer.fromId))}</strong><span>→</span><strong>${escapeHtml(participantName(transfer.toId))}</strong><strong>${escapeHtml(money(transfer.amount))}</strong></div>`).join('')}</div>`
      : '<div class="empty-state compact"><strong>Tudo equilibrado neste mês.</strong></div>';
    container.innerHTML = `<div class="settlement-balances">${balanceMarkup}</div>${transferMarkup}`;
  }

  function renderDashboardTrips() {
    const container = $('#dashboard-trips');
    if (!container) return;
    const current = today();
    const trips = [...state.workspace.trips]
      .filter((trip) => !trip.endDate || trip.endDate >= current)
      .sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999'))
      .slice(0, 3);
    container.innerHTML = trips.length
      ? trips.map((trip) => `<button class="mini-trip text-button" type="button" data-view="trips"><span>${escapeHtml(trip.emoji)}</span><div><strong>${escapeHtml(trip.destination)}</strong><small>${trip.startDate ? `A partir de ${escapeHtml(formatDate(trip.startDate))}` : 'Datas em aberto'}</small></div></button>`).join('')
      : emptyState('⌁', 'Nenhuma viagem planejada', 'Crie um destino e organize o orçamento.');
  }

  function fillSelect(selector, firstOption, options, currentValue) {
    const select = $(selector);
    if (!select) return;
    const previous = currentValue == null ? select.value : currentValue;
    select.innerHTML = firstOption + options;
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }

  function renderDynamicSelectors() {
    const participantOptions = state.workspace.participants.map((participant) => `<option value="${escapeHtml(participant.id)}">${escapeHtml(participant.name)}${participant.active ? '' : ' — arquivado'}</option>`).join('');
    const activeOptions = activeParticipants().map((participant) => `<option value="${escapeHtml(participant.id)}">${escapeHtml(participant.name)}</option>`).join('');
    const tripOptions = state.workspace.trips.map((trip) => `<option value="${escapeHtml(trip.id)}">${escapeHtml(trip.destination)}</option>`).join('');

    fillSelect('#transaction-payer', '<option value="">Não atribuir</option>', activeOptions);
    fillSelect('#finance-participant-filter', '<option value="all">Todos os participantes</option>', participantOptions);
    fillSelect('#report-participant', '<option value="all">Todos os participantes</option>', participantOptions);
    fillSelect('#transaction-trip', '<option value="">Nenhuma viagem</option>', tripOptions);
    fillSelect('#checklist-trip', '<option value="">Nenhuma</option>', tripOptions);
    fillSelect('#checklist-trip-filter', '<option value="all">Todas as viagens</option><option value="none">Sem viagem</option>', tripOptions);

    const split = $('#transaction-split-options');
    if (split) {
      const previous = new Set($$('input:checked', split).map((input) => input.value));
      split.innerHTML = activeParticipants().length
        ? activeParticipants().map((participant) => `<label class="choice-control"><input type="checkbox" value="${escapeHtml(participant.id)}" ${previous.has(participant.id) ? 'checked' : ''}><span><i class="voter-avatar" style="width:18px;height:18px;background:${participant.color}">${escapeHtml(initials(participant.name))}</i>${escapeHtml(participant.name)}</span></label>`).join('')
        : '<span class="muted">Adicione participantes para dividir este gasto.</span>';
    }
  }

  function filteredFinances() {
    const search = String($('#finance-search')?.value || '').trim().toLocaleLowerCase('pt-BR');
    const type = $('#finance-type-filter')?.value || 'all';
    const participant = $('#finance-participant-filter')?.value || 'all';
    const month = $('#finance-month-filter')?.value || '';
    return [...state.workspace.finances]
      .filter((finance) => type === 'all' || finance.type === type)
      .filter((finance) => participant === 'all' || finance.paidById === participant)
      .filter((finance) => !month || finance.date.startsWith(month))
      .filter((finance) => !search || `${finance.description} ${finance.notes} ${categoryMeta(finance.category).label}`.toLocaleLowerCase('pt-BR').includes(search))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  function renderFinances() {
    const finances = filteredFinances();
    const income = finances.filter((finance) => finance.type === 'income').reduce((sum, finance) => sum + finance.amount, 0);
    const expense = finances.filter((finance) => finance.type === 'expense').reduce((sum, finance) => sum + finance.amount, 0);
    setText('#finance-income', money(income));
    setText('#finance-expense', money(expense));
    setText('#finance-balance', money(income - expense));
    setText('#finance-list-title', `${finances.length} ${finances.length === 1 ? 'lançamento' : 'lançamentos'}`);

    const body = $('#finance-table-body');
    if (body) {
      body.innerHTML = finances.length ? finances.map((finance) => {
        const category = categoryMeta(finance.category);
        const payer = participantById(finance.paidById);
        const splitNames = finance.splitBetweenIds.map(participantName).join(', ');
        return `<tr><td>${escapeHtml(formatDate(finance.date))}</td><td><div class="table-primary">${escapeHtml(finance.description)}<small>${escapeHtml(finance.recurring ? 'Recorrente' : finance.notes || (finance.type === 'expense' && splitNames ? `Dividido com: ${splitNames}` : ''))}</small></div></td><td><span class="tag">${escapeHtml(category.icon)} ${escapeHtml(category.label)}</span></td><td>${payer ? `<span class="participant-chip"><i style="background:${payer.color}">${escapeHtml(initials(payer.name))}</i>${escapeHtml(payer.name)}</span>` : '<span class="muted">Não atribuído</span>'}</td><td><strong class="table-value ${finance.type === 'income' ? 'positive' : 'negative'}">${finance.type === 'income' ? '+' : '−'} ${escapeHtml(money(finance.amount))}</strong></td><td><div class="row-actions"><button class="row-action" type="button" data-action="edit-finance" data-id="${escapeHtml(finance.id)}" aria-label="Editar transação">✎</button><button class="row-action delete" type="button" data-action="delete-finance" data-id="${escapeHtml(finance.id)}" aria-label="Excluir transação">×</button></div></td></tr>`;
      }).join('') : `<tr><td colspan="6">${emptyState('↕', 'Nenhum lançamento encontrado', 'Ajuste os filtros ou registre uma nova transação.')}</td></tr>`;
    }
    renderBudgets();
  }

  function renderBudgets() {
    const container = $('#budget-list');
    if (!container) return;
    const month = currentMonth();
    const entries = Object.entries(state.workspace.budgets);
    if (!entries.length) {
      container.innerHTML = emptyState('◒', 'Sem limites definidos', 'Crie limites por categoria para acompanhar o mês.');
      return;
    }
    container.innerHTML = entries.map(([category, limit]) => {
      const meta = categoryMeta(category);
      const spent = state.workspace.finances
        .filter((finance) => finance.type === 'expense' && finance.category === category && finance.date.startsWith(month))
        .reduce((sum, finance) => sum + finance.amount, 0);
      const percent = limit ? Math.min((spent / limit) * 100, 100) : 0;
      return `<div class="budget-item ${spent > limit ? 'over' : ''}"><div class="budget-item-head"><span>${escapeHtml(meta.icon)} ${escapeHtml(meta.label)}</span><strong>${escapeHtml(money(spent))} / ${escapeHtml(money(limit))}</strong></div><div class="progress-track"><i style="width:${percent}%;background:${spent > limit ? 'var(--red)' : meta.color}"></i></div><small>${spent > limit ? `${money(spent - limit)} acima do limite` : `${money(limit - spent)} disponíveis`} · <button class="text-button" type="button" data-action="delete-budget" data-id="${escapeHtml(category)}">remover</button></small></div>`;
    }).join('');
  }

  function renderTravelProviders() {
    const container = $('#travel-provider-grid');
    if (!container || !Travel) return;
    setText('#travel-provider-count', `${TRAVEL_PROVIDERS.length} provedores`);
    $$('[data-travel-provider-filter]').forEach((button) => {
      const active = button.dataset.travelProviderFilter === state.travelProviderFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const providers = TRAVEL_PROVIDERS.filter((provider) => (
      state.travelProviderFilter === 'all' || provider.group === state.travelProviderFilter
    ));
    container.innerHTML = providers.map((provider) => `
      <button class="travel-provider-card" style="--provider-accent:${provider.accent}" type="button" data-action="search-provider" data-provider="${escapeHtml(provider.id)}" aria-label="Pesquisar no ${escapeHtml(provider.name)}">
        <span class="travel-provider-logo" aria-hidden="true">${Travel.iconSvg(provider.id)}</span>
        <span class="travel-provider-copy"><strong>${escapeHtml(provider.name)}</strong><small>${escapeHtml(provider.description)}</small><span class="travel-provider-tag ${provider.support}">${escapeHtml(Travel.badgeFor(provider))}</span></span>
        <span class="travel-provider-arrow" aria-hidden="true">↗</span>
      </button>`).join('');
  }

  function tripStatus(trip) {
    const current = today();
    if (trip.endDate && trip.endDate < current) return { key: 'done', label: 'Concluída' };
    if (trip.startDate && trip.startDate <= current && (!trip.endDate || trip.endDate >= current)) return { key: 'current', label: 'Em andamento' };
    return { key: 'future', label: 'Planejada' };
  }

  function renderTrips() {
    const container = $('#trip-grid');
    if (!container) return;
    if (!state.workspace.trips.length) {
      container.innerHTML = emptyState('⌁', 'Nenhuma viagem no radar', 'Planeje um destino, mesmo que as datas ainda estejam abertas.');
      return;
    }
    container.innerHTML = [...state.workspace.trips]
      .sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999'))
      .map((trip, index) => {
        const status = tripStatus(trip);
        const spent = state.workspace.finances.filter((finance) => finance.type === 'expense' && finance.tripId === trip.id).reduce((sum, finance) => sum + finance.amount, 0);
        const progress = trip.budget ? Math.min(((trip.saved + spent) / trip.budget) * 100, 100) : 0;
        return `<article class="entity-card" style="--card-color:${Core.PALETTE[index % Core.PALETTE.length]}"><div class="entity-hero"><span>${escapeHtml(trip.emoji)}</span><div><small class="status-pill">${escapeHtml(status.label)}</small><h2>${escapeHtml(trip.destination)}</h2></div></div><div class="entity-body"><div class="entity-meta"><span>◷ ${trip.startDate ? escapeHtml(formatDate(trip.startDate)) : 'ida em aberto'}</span><span>→ ${trip.endDate ? escapeHtml(formatDate(trip.endDate)) : 'volta em aberto'}</span></div><p class="entity-copy">${escapeHtml(trip.notes || 'Adicione notas para registrar roteiro, hospedagem ou ideias.')}</p><div class="entity-amounts"><div><small>Orçamento</small><strong>${escapeHtml(money(trip.budget))}</strong></div><div><small>Reservado + gastos</small><strong>${escapeHtml(money(trip.saved + spent))}</strong></div></div><div class="progress-track"><i style="width:${progress}%"></i></div></div><div class="entity-actions"><button class="button ghost small travel-price-button" type="button" data-action="search-trip" data-id="${escapeHtml(trip.id)}">Buscar preços</button><button class="button ghost small" type="button" data-action="edit-trip" data-id="${escapeHtml(trip.id)}">Editar</button><button class="button ghost small" type="button" data-action="delete-trip" data-id="${escapeHtml(trip.id)}">Excluir</button></div></article>`;
      }).join('');
  }

  function renderGoals() {
    const container = $('#goal-grid');
    const summary = $('#goal-summary');
    const goals = state.workspace.goals;
    const totalSaved = goals.reduce((sum, goal) => sum + goal.current, 0);
    const completed = goals.filter((goal) => goal.current >= goal.target).length;
    if (summary) {
      summary.innerHTML = `<article class="metric-card tone-blue"><span class="metric-icon">◎</span><div><small>Metas</small><strong>${goals.length}</strong><em>${completed} concluída${completed === 1 ? '' : 's'}</em></div></article><article class="metric-card tone-green"><span class="metric-icon">↗</span><div><small>Total acumulado</small><strong>${escapeHtml(money(totalSaved))}</strong><em>Em todos os objetivos</em></div></article><article class="metric-card tone-purple"><span class="metric-icon">✓</span><div><small>Taxa de conclusão</small><strong>${goals.length ? Math.round((completed / goals.length) * 100) : 0}%</strong><em>Progresso do conjunto</em></div></article>`;
    }
    if (!container) return;
    if (!goals.length) {
      container.innerHTML = emptyState('◎', 'Nenhuma meta criada', 'Transforme um plano em objetivo mensurável.');
      return;
    }
    container.innerHTML = goals.map((goal) => {
      const percent = goal.target ? Math.min((goal.current / goal.target) * 100, 100) : 0;
      return `<article class="entity-card goal-card"><div class="goal-card-head"><span class="goal-emoji">${escapeHtml(goal.emoji)}</span><div><h2>${escapeHtml(goal.title)}</h2><p>${goal.deadline ? `Prazo: ${escapeHtml(formatDate(goal.deadline))}` : 'Sem prazo definido'}</p></div></div><p class="entity-copy">${escapeHtml(goal.description || 'Sem descrição.')}</p><div class="goal-numbers"><strong>${escapeHtml(money(goal.current))} <small class="muted">de ${escapeHtml(money(goal.target))}</small></strong><span>${Math.round(percent)}%</span></div><div class="progress-track"><i style="width:${percent}%"></i></div><div class="entity-actions"><button class="button primary small" type="button" data-action="fund-goal" data-id="${escapeHtml(goal.id)}">Adicionar valor</button><button class="button ghost small" type="button" data-action="edit-goal" data-id="${escapeHtml(goal.id)}">Editar</button><button class="button ghost small" type="button" data-action="delete-goal" data-id="${escapeHtml(goal.id)}">Excluir</button></div></article>`;
    }).join('');
  }

  function renderChecklist() {
    const total = state.workspace.checklist.length;
    const done = state.workspace.checklist.filter((item) => item.done).length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    setText('#checklist-progress-label', `${done} de ${total} concluídos`);
    setText('#checklist-progress-percent', `${percent}%`);
    const bar = $('#checklist-progress-bar');
    if (bar) bar.style.width = `${percent}%`;

    const category = $('#checklist-category-filter')?.value || 'all';
    const trip = $('#checklist-trip-filter')?.value || 'all';
    const items = state.workspace.checklist.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (trip === 'none' && item.tripId) return false;
      if (trip !== 'all' && trip !== 'none' && item.tripId !== trip) return false;
      return true;
    });
    const container = $('#checklist-list');
    if (!container) return;
    container.innerHTML = items.length ? items.map((item) => {
      const linkedTrip = state.workspace.trips.find((candidate) => candidate.id === item.tripId);
      return `<article class="check-item ${item.done ? 'done' : ''}"><button class="check-toggle" type="button" data-action="toggle-check" data-id="${escapeHtml(item.id)}" aria-label="${item.done ? 'Desmarcar' : 'Marcar'} item">✓</button><div class="check-copy"><span class="check-title">${escapeHtml(item.text)}</span><small>${escapeHtml(CHECKLIST_META[item.category] || 'Outros')}${linkedTrip ? ` · ${escapeHtml(linkedTrip.destination)}` : ''}</small></div><span class="tag">${escapeHtml(CHECKLIST_META[item.category] || 'Outros')}</span><div class="row-actions"><button class="row-action" type="button" data-action="edit-check" data-id="${escapeHtml(item.id)}" aria-label="Editar item">✎</button><button class="row-action delete" type="button" data-action="delete-check" data-id="${escapeHtml(item.id)}" aria-label="Excluir item">×</button></div></article>`;
    }).join('') : emptyState('✓', 'Nenhum item neste filtro', 'Adicione um item ou use o modelo rápido.');
  }

  function renderDecisions() {
    const decisions = state.workspace.decisions.filter((decision) => state.decisionFilter === 'all' || decision.status === state.decisionFilter);
    const container = $('#decision-grid');
    if (!container) return;
    $$('.segmented [data-decision-filter]').forEach((button) => button.classList.toggle('active', button.dataset.decisionFilter === state.decisionFilter));
    if (!decisions.length) {
      container.innerHTML = emptyState('◇', 'Nenhuma decisão neste filtro', 'Crie uma votação com quantas opções precisar.');
      return;
    }
    const active = activeParticipants();
    container.innerHTML = decisions.map((decision) => {
      let selectedVoter = state.voterByDecision[decision.id];
      if (!active.some((participant) => participant.id === selectedVoter)) selectedVoter = active[0]?.id || '';
      state.voterByDecision[decision.id] = selectedVoter;
      const totalVotes = decision.options.reduce((sum, option) => sum + option.voterIds.length, 0);
      const electorateIds = new Set([
        ...active.map((participant) => participant.id),
        ...decision.options.flatMap((option) => option.voterIds),
      ]);
      const participantOptions = active.map((participant) => `<option value="${escapeHtml(participant.id)}" ${participant.id === selectedVoter ? 'selected' : ''}>${escapeHtml(participant.name)}</option>`).join('');
      const options = decision.options.map((option) => {
        const percentage = electorateIds.size ? Math.round((option.voterIds.length / electorateIds.size) * 100) : 0;
        const selected = option.voterIds.includes(selectedVoter);
        const voters = option.voterIds.map((voterId) => participantById(voterId)).filter(Boolean);
        return `<button class="vote-option ${selected ? 'selected' : ''}" type="button" data-action="vote" data-decision-id="${escapeHtml(decision.id)}" data-option-id="${escapeHtml(option.id)}" ${decision.status === 'closed' || !selectedVoter ? 'disabled' : ''}><i class="vote-fill" style="width:${percentage}%"></i><span>${escapeHtml(option.label)}</span><strong>${option.voterIds.length} voto${option.voterIds.length === 1 ? '' : 's'}</strong>${voters.length ? `<span class="voter-list">${voters.map((voter) => `<i class="voter-avatar" style="background:${voter.color}" title="${escapeHtml(voter.name)}">${escapeHtml(initials(voter.name))}</i>`).join('')}</span>` : ''}</button>`;
      }).join('');
      return `<article class="decision-card ${decision.status === 'closed' ? 'closed' : ''}" data-decision-card="${escapeHtml(decision.id)}"><div class="decision-card-head"><div><span class="eyebrow">${totalVotes} VOTO${totalVotes === 1 ? '' : 'S'}</span><h2>${escapeHtml(decision.title)}</h2><p>${escapeHtml(decision.description || 'Sem contexto adicional.')}</p></div><span class="status-pill">${decision.status === 'open' ? 'Aberta' : 'Encerrada'}</span></div><div class="vote-context"><span>Votar como</span><select class="decision-voter-select" aria-label="Votar como" data-decision-id="${escapeHtml(decision.id)}" ${!active.length || decision.status === 'closed' ? 'disabled' : ''}><option value="">Escolha um participante</option>${participantOptions}</select></div><div class="vote-options">${options}</div><div class="decision-actions"><button class="button ghost small" type="button" data-action="toggle-decision" data-id="${escapeHtml(decision.id)}">${decision.status === 'open' ? 'Encerrar votação' : 'Reabrir'}</button><button class="button ghost small" type="button" data-action="delete-decision" data-id="${escapeHtml(decision.id)}">Excluir</button></div></article>`;
    }).join('');
  }

  function renderReports() {
    const period = Number($('#report-period')?.value || 6);
    const participantId = $('#report-participant')?.value || 'all';
    const series = monthSeries(period, participantId);
    renderBarChart('#report-chart', series);
    const body = $('#report-table-body');
    if (body) {
      body.innerHTML = series.slice().reverse().map((item) => `<tr><td><strong>${escapeHtml(item.label)}</strong></td><td class="positive">${escapeHtml(money(item.income))}</td><td class="negative">${escapeHtml(money(item.expense))}</td><td><strong class="${item.income - item.expense < 0 ? 'negative' : 'positive'}">${escapeHtml(money(item.income - item.expense))}</strong></td></tr>`).join('');
    }

    const container = $('#participant-report');
    if (!container) return;
    const monthKeys = new Set(series.map((item) => item.key));
    const totals = state.workspace.participants
      .filter((participant) => participantId === 'all' || participant.id === participantId)
      .map((participant) => ({
      participant,
      total: state.workspace.finances
        .filter((finance) => finance.type === 'expense' && finance.paidById === participant.id && monthKeys.has(finance.date.slice(0, 7)))
        .reduce((sum, finance) => sum + finance.amount, 0),
    })).filter((item) => item.total > 0).sort((a, b) => b.total - a.total);
    const maximum = Math.max(0, ...totals.map((item) => item.total));
    container.innerHTML = totals.length ? totals.map(({ participant, total }) => `<div class="progress-item"><div class="progress-item-head"><span class="participant-chip"><i style="background:${participant.color}">${escapeHtml(initials(participant.name))}</i>${escapeHtml(participant.name)}</span><strong>${escapeHtml(money(total))}</strong></div><div class="progress-track"><i style="width:${(total / maximum) * 100}%;background:${participant.color}"></i></div></div>`).join('') : emptyState('▥', 'Sem gastos atribuídos', 'A participação será calculada a partir de quem pagou.');
  }

  function renderSettings() {
    const vaultStatus = Repository.auth.status();
    const legacyConflict = $('#legacy-conflict');
    if (legacyConflict) legacyConflict.hidden = !vaultStatus.hasLegacyWorkspace;
    const nameInput = $('#workspace-name-input');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = state.workspace.name;
    const container = $('#participant-settings-list');
    if (container) {
      container.innerHTML = state.workspace.participants.length ? state.workspace.participants.map((participant) => `<div class="participant-row ${participant.active ? '' : 'archived'}"><span class="participant-row-avatar" style="background:${participant.color}">${escapeHtml(initials(participant.name))}</span><input value="${escapeHtml(participant.name)}" maxlength="40" data-participant-name="${escapeHtml(participant.id)}" aria-label="Nome do participante"><span class="participant-state">${participant.active ? 'Ativo' : 'Arquivado'}</span><div class="row-actions"><input type="color" value="${participant.color}" data-participant-color="${escapeHtml(participant.id)}" aria-label="Cor de ${escapeHtml(participant.name)}"><button class="row-action" type="button" data-action="toggle-participant" data-id="${escapeHtml(participant.id)}" aria-label="${participant.active ? 'Arquivar' : 'Reativar'} participante">${participant.active ? '−' : '+'}</button><button class="row-action delete" type="button" data-action="remove-participant" data-id="${escapeHtml(participant.id)}" aria-label="Remover participante">×</button></div></div>`).join('') : emptyState('＋', 'Nenhum participante cadastrado', 'O workspace também funciona individualmente. Adicione alguém quando fizer sentido.');
    }
    const dataSummary = $('#data-summary');
    if (dataSummary) {
      const itemCount = state.workspace.finances.length + state.workspace.trips.length + state.workspace.goals.length + state.workspace.checklist.length + state.workspace.decisions.length;
      let size = 0;
      try { size = new Blob([JSON.stringify(state.workspace)]).size; } catch (_) {}
      dataSummary.innerHTML = `<div><dt>Participantes</dt><dd>${state.workspace.participants.length}</dd></div><div><dt>Registros</dt><dd>${itemCount}</dd></div><div><dt>Tamanho</dt><dd>${size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`}</dd></div>`;
    }
  }

  function renderAll() {
    renderWorkspaceIdentity();
    renderDynamicSelectors();
    renderDashboard();
    renderFinances();
    renderTravelProviders();
    renderTrips();
    renderGoals();
    renderChecklist();
    renderDecisions();
    renderReports();
    renderSettings();
  }

  function navigate(view, updateHash) {
    const target = $$('[data-view-panel]').find((panel) => panel.dataset.viewPanel === view);
    if (!target) return;
    state.currentView = view;
    $$('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel === target));
    $$('.nav-item[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    if (updateHash !== false) history.replaceState(null, '', view === 'dashboard' ? location.pathname : `#${view}`);
    closeSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openSidebar() {
    $('#sidebar')?.classList.add('open');
    $('#sidebar-backdrop')?.classList.add('open');
    $('[data-action="open-sidebar"]')?.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    $('#sidebar')?.classList.remove('open');
    $('#sidebar-backdrop')?.classList.remove('open');
    $('[data-action="open-sidebar"]')?.setAttribute('aria-expanded', 'false');
  }

  function applyTheme(theme) {
    const selected = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = selected;
    setText('#theme-icon', selected === 'dark' ? '☀' : '◐');
    try { localStorage.setItem(Repository.THEME_KEY, selected); } catch (_) {}
  }

  function toggleTheme() {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  }

  function prepareNewDialog(id) {
    const dialog = document.getElementById(id);
    const form = dialog?.querySelector('form');
    if (form) form.reset();
    renderDynamicSelectors();
    if (id === 'transaction-dialog') {
      setText('#transaction-dialog-title', 'Nova transação');
      $('#transaction-id').value = '';
      $('#transaction-date').value = today();
      $('#transaction-type').value = 'expense';
      $('#transaction-recurring').disabled = false;
      $$('#transaction-split-options input').forEach((input) => { input.checked = true; });
      syncTransactionType();
    }
    if (id === 'trip-dialog') {
      setText('#trip-dialog-title', 'Planejar viagem');
      $('#trip-id').value = '';
      $('#trip-emoji').value = '🧭';
    }
    if (id === 'goal-dialog') {
      setText('#goal-dialog-title', 'Criar meta');
      $('#goal-id').value = '';
      $('#goal-emoji').value = '🎯';
    }
    if (id === 'checklist-dialog') {
      setText('#checklist-dialog-title', 'Adicionar item');
      $('#checklist-id').value = '';
    }
    if (id === 'setup-dialog') {
      $('#setup-workspace-name').value = state.workspace.name;
      $('#setup-participants').value = '';
    }
  }

  function syncTransactionType() {
    const expense = $('#transaction-type')?.value === 'expense';
    const splitField = $('#transaction-split-field');
    if (splitField) splitField.hidden = !expense;
  }

  function editFinance(id) {
    const finance = state.workspace.finances.find((item) => item.id === id);
    if (!finance) return;
    prepareNewDialog('transaction-dialog');
    setText('#transaction-dialog-title', 'Editar transação');
    $('#transaction-id').value = finance.id;
    $('#transaction-type').value = finance.type;
    $('#transaction-date').value = finance.date;
    $('#transaction-description').value = finance.description;
    $('#transaction-amount').value = String(finance.amount).replace('.', ',');
    $('#transaction-category').value = finance.category;
    const archivedPayer = participantById(finance.paidById);
    if (archivedPayer && !archivedPayer.active) {
      $('#transaction-payer').insertAdjacentHTML('beforeend', `<option value="${escapeHtml(archivedPayer.id)}">${escapeHtml(archivedPayer.name)} — arquivado</option>`);
    }
    const archivedSplit = finance.splitBetweenIds.map(participantById).filter((participant) => participant && !participant.active);
    archivedSplit.forEach((participant) => {
      $('#transaction-split-options').insertAdjacentHTML('beforeend', `<label class="choice-control"><input type="checkbox" value="${escapeHtml(participant.id)}"><span><i class="voter-avatar" style="width:18px;height:18px;background:${participant.color}">${escapeHtml(initials(participant.name))}</i>${escapeHtml(participant.name)} — arquivado</span></label>`);
    });
    $('#transaction-payer').value = finance.paidById || '';
    $('#transaction-trip').value = finance.tripId || '';
    $('#transaction-notes').value = finance.notes;
    $('#transaction-recurring').checked = finance.recurring;
    $('#transaction-recurring').disabled = Boolean(finance.recurringSourceId);
    $$('#transaction-split-options input').forEach((input) => { input.checked = finance.splitBetweenIds.includes(input.value); });
    syncTransactionType();
    showDialog($('#transaction-dialog'));
  }

  function editTrip(id) {
    const trip = state.workspace.trips.find((item) => item.id === id);
    if (!trip) return;
    prepareNewDialog('trip-dialog');
    setText('#trip-dialog-title', 'Editar viagem');
    $('#trip-id').value = trip.id;
    $('#trip-destination').value = trip.destination;
    $('#trip-emoji').value = trip.emoji;
    $('#trip-start').value = trip.startDate;
    $('#trip-end').value = trip.endDate;
    $('#trip-budget').value = String(trip.budget || '').replace('.', ',');
    $('#trip-saved').value = String(trip.saved || '').replace('.', ',');
    $('#trip-notes').value = trip.notes;
    showDialog($('#trip-dialog'));
  }

  function editGoal(id) {
    const goal = state.workspace.goals.find((item) => item.id === id);
    if (!goal) return;
    prepareNewDialog('goal-dialog');
    setText('#goal-dialog-title', 'Editar meta');
    $('#goal-id').value = goal.id;
    $('#goal-title').value = goal.title;
    $('#goal-emoji').value = goal.emoji;
    $('#goal-target').value = String(goal.target).replace('.', ',');
    $('#goal-current').value = String(goal.current || '').replace('.', ',');
    $('#goal-deadline').value = goal.deadline;
    $('#goal-description').value = goal.description;
    showDialog($('#goal-dialog'));
  }

  function editChecklist(id) {
    const item = state.workspace.checklist.find((candidate) => candidate.id === id);
    if (!item) return;
    prepareNewDialog('checklist-dialog');
    setText('#checklist-dialog-title', 'Editar item');
    $('#checklist-id').value = item.id;
    $('#checklist-text').value = item.text;
    $('#checklist-category').value = item.category;
    $('#checklist-trip').value = item.tripId || '';
    showDialog($('#checklist-dialog'));
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    const source = String(value == null ? '' : value);
    const neutralized = /^[=+\-@]/.test(source.trimStart()) ? `'${source}` : source;
    return `"${neutralized.replace(/"/g, '""')}"`;
  }

  function exportCsv(sourceElement) {
    const panel = sourceElement && sourceElement.closest('[data-view-panel]');
    let finances = state.workspace.finances;
    if (panel && panel.dataset.viewPanel === 'finances') {
      finances = filteredFinances();
    } else if (panel && panel.dataset.viewPanel === 'reports') {
      const period = Number($('#report-period')?.value || 6);
      const participantId = $('#report-participant')?.value || 'all';
      const months = new Set(monthSeries(period, 'all').map((item) => item.key));
      finances = finances.filter((finance) => months.has(finance.date.slice(0, 7))
        && (participantId === 'all' || finance.paidById === participantId));
    }
    const headers = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Participante', 'Valor', 'Dividido entre', 'Viagem', 'Observações'];
    const rows = finances.map((finance) => {
      const trip = state.workspace.trips.find((item) => item.id === finance.tripId);
      return [
        finance.date,
        finance.type === 'income' ? 'Receita' : 'Despesa',
        finance.description,
        categoryMeta(finance.category).label,
        participantName(finance.paidById),
        finance.amount.toFixed(2).replace('.', ','),
        finance.splitBetweenIds.map(participantName).join(' | '),
        trip ? trip.destination : '',
        finance.notes,
      ];
    });
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
    download(`plannerduo-financas-${today()}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8');
    toast('CSV gerado', `${rows.length} ${rows.length === 1 ? 'lançamento exportado' : 'lançamentos exportados'}.`, 'success');
  }

  async function exportBackup() {
    try {
      const encrypted = await Repository.exportEncrypted();
      download(`plannerduo-cofre-${today()}.json`, encrypted, 'application/json');
      toast('Backup criptografado concluído', 'O arquivo continua protegido pela senha do cofre.', 'success');
    } catch (error) {
      toast('Falha no backup', error.message || 'Não foi possível exportar o cofre.', 'error');
    }
  }

  function applyChecklistTemplate() {
    const templates = [
      ['Documento de identificação', 'documentos'],
      ['Comprovantes e reservas', 'documentos'],
      ['Carregador do celular', 'tecnologia'],
      ['Medicamentos de uso pessoal', 'saude'],
      ['Itens de higiene', 'higiene'],
      ['Roupas adequadas ao clima', 'roupas'],
    ];
    const existing = new Set(state.workspace.checklist.map((item) => item.text.toLocaleLowerCase('pt-BR')));
    const additions = templates.filter(([text]) => !existing.has(text.toLocaleLowerCase('pt-BR')));
    if (!additions.length) {
      toast('Modelo já aplicado', 'Todos os itens sugeridos já estão no checklist.');
      return;
    }
    commit((draft) => {
      additions.forEach(([text, category]) => draft.checklist.push({
        id: Core.id('check'), text, category, done: false, tripId: null, createdAt: new Date().toISOString(),
      }));
    }, 'Modelo adicionado ao checklist');
  }

  async function handleAction(action, element) {
    const id = element.dataset.id;
    if (action === 'open-sidebar') return openSidebar();
    if (action === 'close-sidebar') return closeSidebar();
    if (action === 'toggle-theme') return toggleTheme();
    if (action === 'lock-vault') return lockVault({ allTabs: true });
    if (action === 'open-security') {
      $('#security-form')?.reset();
      return showDialog($('#security-dialog'));
    }
    if (action === 'search-provider') return openTravelProvider(element.dataset.provider);
    if (action === 'search-trip') return fillTravelSearchFromTrip(id);
    if (action === 'open-setup') {
      prepareNewDialog('setup-dialog');
      return showDialog($('#setup-dialog'));
    }
    if (action === 'dismiss-setup') {
      closeDialog($('#setup-dialog'));
      return commit((draft) => { draft.settings.onboardingCompleted = true; });
    }
    if (action === 'clear-finance-filters') {
      $('#finance-search').value = '';
      $('#finance-type-filter').value = 'all';
      $('#finance-participant-filter').value = 'all';
      $('#finance-month-filter').value = '';
      return renderFinances();
    }
    if (action === 'export-csv') return exportCsv(element);
    if (action === 'export-backup') return exportBackup();
    if (action === 'export-legacy-conflict') {
      try {
        download(`plannerduo-conflito-legado-${today()}.json`, Repository.auth.exportRawLegacy(), 'application/json');
        toast('Cópia legível baixada', 'Revise o arquivo antes de descartá-lo.', 'success');
      } catch (error) {
        toast('Cópia não encontrada', error.message, 'error');
      }
      return;
    }
    if (action === 'discard-legacy-conflict') {
      if (!confirm('Descartar definitivamente a cópia legível conflitante? O cofre criptografado será mantido.')) return;
      await Repository.auth.discardLegacyConflict();
      renderSettings();
      toast('Cópia legível descartada', 'Somente o cofre criptografado permanece.', 'success');
      return;
    }
    if (action === 'choose-import') return $('#backup-file-input')?.click();
    if (action === 'apply-checklist-template') return applyChecklistTemplate();
    if (action === 'clear-completed-checklist') {
      const count = state.workspace.checklist.filter((item) => item.done).length;
      if (!count) return toast('Nada para remover', 'Marque itens como concluídos primeiro.');
      if (confirm(`Remover ${count} ${count === 1 ? 'item concluído' : 'itens concluídos'}?`)) {
        commit((draft) => { draft.checklist = draft.checklist.filter((item) => !item.done); }, 'Itens concluídos removidos');
      }
      return;
    }
    if (action === 'reset-workspace') {
      const confirmation = prompt('Esta ação apaga permanentemente o banco local. Digite APAGAR para confirmar:');
      if (confirmation !== 'APAGAR') return toast('Exclusão cancelada', 'Nenhum dado foi alterado.');
      try {
        state.workspace = await Repository.reset();
        state.voterByDecision = {};
        renderAll();
        toast('Banco local apagado', 'O PlannerDuo voltou ao estado inicial vazio.', 'success');
        prepareNewDialog('setup-dialog');
        showDialog($('#setup-dialog'));
      } catch (error) {
        toast('Não foi possível apagar', error.message, 'error');
      }
      return;
    }
    if (action === 'edit-finance') return editFinance(id);
    if (action === 'delete-finance') {
      if (confirm('Excluir esta transação?')) {
        commit((draft) => Core.removeFinance(draft, id).workspace, 'Transação excluída');
      }
      return;
    }
    if (action === 'edit-trip') return editTrip(id);
    if (action === 'delete-trip') {
      if (confirm('Excluir esta viagem? Os lançamentos vinculados serão mantidos sem vínculo.')) {
        commit((draft) => {
          draft.trips = draft.trips.filter((item) => item.id !== id);
          draft.finances.forEach((finance) => { if (finance.tripId === id) finance.tripId = null; });
          draft.checklist.forEach((item) => { if (item.tripId === id) item.tripId = null; });
        }, 'Viagem excluída');
      }
      return;
    }
    if (action === 'edit-goal') return editGoal(id);
    if (action === 'delete-goal') {
      if (confirm('Excluir esta meta?')) commit((draft) => { draft.goals = draft.goals.filter((item) => item.id !== id); }, 'Meta excluída');
      return;
    }
    if (action === 'fund-goal') {
      const value = parseMoney(prompt('Quanto deseja adicionar à meta?') || '');
      if (!Number.isFinite(value) || value <= 0) return toast('Valor inválido', 'Informe um valor maior que zero.', 'error');
      commit((draft) => {
        const goal = draft.goals.find((item) => item.id === id);
        if (!goal) throw entityConflict('Esta meta foi removida em outra aba.');
        const nextCents = Math.round(goal.current * 100) + Math.round(value * 100);
        if (!Number.isSafeInteger(nextCents) || nextCents > Core.MAX_AMOUNT * 100) {
          throw new Error(`O total da meta não pode ultrapassar ${money(Core.MAX_AMOUNT)}.`);
        }
        goal.current = nextCents / 100;
      }, 'Valor adicionado à meta');
      return;
    }
    if (action === 'edit-check') return editChecklist(id);
    if (action === 'toggle-check') {
      commit((draft) => {
        const item = draft.checklist.find((candidate) => candidate.id === id);
        if (item) item.done = !item.done;
      });
      return;
    }
    if (action === 'delete-check') {
      commit((draft) => { draft.checklist = draft.checklist.filter((item) => item.id !== id); }, 'Item removido');
      return;
    }
    if (action === 'vote') {
      const decisionId = element.dataset.decisionId;
      const optionId = element.dataset.optionId;
      const voterId = state.voterByDecision[decisionId];
      if (!voterId) return toast('Escolha quem está votando', 'Adicione ou selecione um participante.', 'error');
      const changed = await commit((draft) => {
        const result = Core.vote(draft, decisionId, optionId, voterId);
        return result.changed ? result.workspace : draft;
      }, 'Voto atualizado');
      return changed;
    }
    if (action === 'toggle-decision') {
      commit((draft) => {
        const decision = draft.decisions.find((item) => item.id === id);
        if (!decision) return;
        decision.status = decision.status === 'open' ? 'closed' : 'open';
        decision.closedAt = decision.status === 'closed' ? new Date().toISOString() : null;
      }, 'Status da decisão atualizado');
      return;
    }
    if (action === 'delete-decision') {
      if (confirm('Excluir esta decisão e todos os votos?')) commit((draft) => { draft.decisions = draft.decisions.filter((item) => item.id !== id); }, 'Decisão excluída');
      return;
    }
    if (action === 'toggle-participant') {
      commit((draft) => {
        const participant = draft.participants.find((item) => item.id === id);
        if (participant) participant.active = !participant.active;
      }, 'Participante atualizado');
      return;
    }
    if (action === 'remove-participant') {
      const preview = Core.removeParticipant(state.workspace, id);
      if (!preview.found) return;
      const message = preview.archived
        ? 'Este participante possui histórico e será arquivado para preservar os registros.'
        : 'O participante será removido permanentemente. Continuar?';
      if (preview.archived || confirm(message)) {
        const saved = await commit((draft) => Core.removeParticipant(draft, id).workspace,
          preview.archived ? 'Participante arquivado' : 'Participante removido');
        if (saved && preview.archived) toast('Histórico preservado', message);
      }
      return;
    }
    if (action === 'delete-budget') {
      commit((draft) => { delete draft.budgets[id]; }, 'Limite removido');
    }
  }

  function bindForms() {
    $('#security-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const currentPassword = $('#security-current-password').value;
      const newPassword = $('#security-new-password').value;
      const confirmation = $('#security-confirm-password').value;
      if (newPassword !== confirmation) {
        toast('Senhas diferentes', 'A confirmação precisa ser idêntica à nova senha.', 'error');
        return;
      }
      const button = event.currentTarget.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const result = await Repository.auth.changePassword({ currentPassword, newPassword });
        state.account = result.account;
        state.workspace = result.workspace;
        state.sessionExpiresAt = result.expiresAt || state.sessionExpiresAt;
        event.currentTarget.reset();
        closeDialog($('#security-dialog'));
        renderAll();
        toast('Senha alterada', 'As outras abas foram bloqueadas e o cofre foi recriptografado.', 'success');
      } catch (error) {
        toast('Não foi possível alterar a senha', error.message || 'Revise a senha atual e a nova senha.', 'error');
      } finally {
        button.disabled = false;
      }
    });

    $('#backup-password-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.pendingBackupSource) return closeDialog($('#backup-password-dialog'));
      const button = event.currentTarget.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        state.workspace = await Repository.importBackup(state.pendingBackupSource, $('#backup-password').value);
        state.pendingBackupSource = null;
        state.voterByDecision = {};
        event.currentTarget.reset();
        closeDialog($('#backup-password-dialog'));
        renderAll();
        toast('Backup restaurado', 'O conteúdo foi recriptografado com a conta atual.', 'success');
      } catch (error) {
        toast('Não foi possível abrir o backup', error.message || 'Senha ou arquivo inválido.', 'error');
      } finally {
        button.disabled = false;
      }
    });

    $('#travel-search-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await openTravelProvider('google-flights');
    });

    $('#workspace-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = $('#workspace-name-input').value.trim();
      await commit((draft) => { draft.name = name; }, name ? 'Nome do workspace atualizado' : 'Nome do workspace removido');
    });

    $('#participant-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const name = $('#participant-name-input').value.trim();
      if (!name) return;
      const color = $('#participant-color-input').value;
      const saved = await commit((draft) => { draft.participants.push(Core.createParticipant({ name, color }, draft.participants.length)); }, 'Participante adicionado');
      if (!saved) return;
      form.reset();
      $('#participant-color-input').value = Core.PALETTE[state.workspace.participants.length % Core.PALETTE.length];
    });

    $('#transaction-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const id = $('#transaction-id').value;
      const type = $('#transaction-type').value;
      const description = $('#transaction-description').value.trim();
      const value = parseMoney($('#transaction-amount').value);
      const date = $('#transaction-date').value;
      const splitBetweenIds = type === 'expense' ? $$('#transaction-split-options input:checked').map((input) => input.value) : [];
      if (!description || !date || !Number.isFinite(value) || value <= 0) {
        return toast('Revise a transação', 'Descrição, data e valor maior que zero são obrigatórios.', 'error');
      }
      if (type === 'expense' && activeParticipants().length && !splitBetweenIds.length) {
        return toast('Escolha a divisão', 'Selecione ao menos um participante para esta despesa.', 'error');
      }
      const existing = state.workspace.finances.find((item) => item.id === id);
      const financeId = id || Core.id('finance');
      const isOccurrence = Boolean(existing && existing.recurringSourceId);
      const recurring = isOccurrence ? false : $('#transaction-recurring').checked;
      const finance = {
        id: financeId,
        type,
        description,
        amount: value,
        date,
        category: $('#transaction-category').value,
        paidById: $('#transaction-payer').value || null,
        splitBetweenIds,
        tripId: $('#transaction-trip').value || null,
        notes: $('#transaction-notes').value.trim(),
        recurring,
        recurringSourceId: existing?.recurringSourceId || null,
        recurrenceSeriesId: isOccurrence
          ? (existing?.recurrenceSeriesId || existing?.recurringSourceId)
          : (recurring ? (existing?.recurrenceSeriesId || financeId) : null),
        occurrenceMonth: existing?.occurrenceMonth || null,
        recurrenceSkippedMonths: recurring ? (existing?.recurrenceSkippedMonths || []) : [],
        createdAt: existing?.createdAt || new Date().toISOString(),
      };
      const saved = await commit((draft) => {
        const index = draft.finances.findIndex((item) => item.id === finance.id);
        if (id && index < 0) throw entityConflict('Esta transação foi removida em outra aba.');
        if (draft.finances[index]?.recurring && !finance.recurring && !draft.finances[index]?.recurringSourceId) {
          draft.finances.forEach((item) => {
            if (item.recurringSourceId !== finance.id) return;
            item.recurringSourceId = null;
            item.recurrenceSeriesId = null;
            item.occurrenceMonth = null;
            item.recurrenceSkippedMonths = [];
          });
        }
        if (index >= 0) draft.finances[index] = finance;
        else draft.finances.push(finance);
      }, id ? 'Transação atualizada' : 'Transação adicionada');
      if (saved) {
        state.workspace = await materializeRecurring(state.workspace);
        renderAll();
        closeDialog($('#transaction-dialog'));
        form.reset();
      }
    });

    $('#trip-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const id = $('#trip-id').value;
      const startDate = $('#trip-start').value;
      const endDate = $('#trip-end').value;
      if (startDate && endDate && endDate < startDate) return toast('Datas inválidas', 'A volta não pode ser anterior à ida.', 'error');
      const destination = $('#trip-destination').value.trim();
      if (!destination) return;
      const budget = parseOptionalMoney($('#trip-budget').value);
      const savedAmount = parseOptionalMoney($('#trip-saved').value);
      if (!Number.isFinite(budget) || !Number.isFinite(savedAmount)) {
        return toast('Valores inválidos', `Orçamento e valor reservado devem ficar entre zero e ${money(Core.MAX_AMOUNT)}.`, 'error');
      }
      const existing = state.workspace.trips.find((item) => item.id === id);
      const trip = {
        id: id || Core.id('trip'), destination,
        emoji: $('#trip-emoji').value.trim() || '🧭',
        startDate, endDate,
        budget,
        saved: savedAmount,
        notes: $('#trip-notes').value.trim(),
        createdAt: existing?.createdAt || new Date().toISOString(),
      };
      const saved = await commit((draft) => {
        const index = draft.trips.findIndex((item) => item.id === trip.id);
        if (id && index < 0) throw entityConflict('Esta viagem foi removida em outra aba.');
        if (index >= 0) draft.trips[index] = trip;
        else draft.trips.push(trip);
      }, id ? 'Viagem atualizada' : 'Viagem planejada');
      if (saved) closeDialog($('#trip-dialog'));
    });

    $('#goal-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const id = $('#goal-id').value;
      const title = $('#goal-title').value.trim();
      const target = parseMoney($('#goal-target').value);
      const current = parseOptionalMoney($('#goal-current').value);
      if (!title || !Number.isFinite(target) || target <= 0 || !Number.isFinite(current)) {
        return toast('Revise a meta', `Título e valores entre zero e ${money(Core.MAX_AMOUNT)} são obrigatórios.`, 'error');
      }
      const existing = state.workspace.goals.find((item) => item.id === id);
      const goal = {
        id: id || Core.id('goal'), title,
        emoji: $('#goal-emoji').value.trim() || '🎯', target, current,
        deadline: $('#goal-deadline').value,
        description: $('#goal-description').value.trim(),
        createdAt: existing?.createdAt || new Date().toISOString(),
      };
      const saved = await commit((draft) => {
        const index = draft.goals.findIndex((item) => item.id === goal.id);
        if (id && index < 0) throw entityConflict('Esta meta foi removida em outra aba.');
        if (index >= 0) draft.goals[index] = goal;
        else draft.goals.push(goal);
      }, id ? 'Meta atualizada' : 'Meta criada');
      if (saved) closeDialog($('#goal-dialog'));
    });

    $('#checklist-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const id = $('#checklist-id').value;
      const text = $('#checklist-text').value.trim();
      if (!text) return;
      const existing = state.workspace.checklist.find((item) => item.id === id);
      const item = {
        id: id || Core.id('check'),
        text,
        category: $('#checklist-category').value,
        done: existing?.done || false,
        tripId: $('#checklist-trip').value || null,
        createdAt: existing?.createdAt || new Date().toISOString(),
      };
      const saved = await commit((draft) => {
        const index = draft.checklist.findIndex((candidate) => candidate.id === item.id);
        if (id && index < 0) throw entityConflict('Este item foi removido em outra aba.');
        if (index >= 0) draft.checklist[index] = item;
        else draft.checklist.push(item);
      }, id ? 'Item atualizado' : 'Item adicionado');
      if (saved) closeDialog($('#checklist-dialog'));
    });

    $('#decision-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const title = $('#decision-title').value.trim();
      const seen = new Set();
      const options = $('#decision-options').value.split('\n').map((option) => option.trim()).filter((option) => {
        const key = option.toLocaleLowerCase('pt-BR');
        if (!option || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!title || options.length < 2) return toast('Revise a decisão', 'Informe um título e pelo menos duas opções diferentes.', 'error');
      const saved = await commit((draft) => draft.decisions.unshift({
        id: Core.id('decision'), title,
        description: $('#decision-description').value.trim(),
        status: 'open',
        options: options.map((label) => ({ id: Core.id('option'), label, voterIds: [] })),
        createdAt: new Date().toISOString(), closedAt: null,
      }), 'Decisão criada');
      if (saved) closeDialog($('#decision-dialog'));
    });

    $('#budget-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const value = parseMoney($('#budget-amount').value);
      if (!Number.isFinite(value) || value <= 0) return toast('Valor inválido', 'Informe um limite maior que zero.', 'error');
      const category = $('#budget-category').value;
      const saved = await commit((draft) => { draft.budgets[category] = value; }, 'Limite mensal salvo');
      if (saved) closeDialog($('#budget-dialog'));
    });

    $('#setup-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = $('#setup-workspace-name').value.trim();
      const participantNames = $('#setup-participants').value.split('\n').map((item) => item.trim()).filter(Boolean);
      const saved = await commit((draft) => {
        draft.name = name;
        draft.settings.onboardingCompleted = true;
        const existing = new Set(draft.participants.map((participant) => participant.name.toLocaleLowerCase('pt-BR')));
        participantNames.forEach((participantName) => {
          if (existing.has(participantName.toLocaleLowerCase('pt-BR'))) return;
          draft.participants.push(Core.createParticipant({
            name: participantName,
            color: Core.PALETTE[draft.participants.length % Core.PALETTE.length],
          }, draft.participants.length));
          existing.add(participantName.toLocaleLowerCase('pt-BR'));
        });
      }, 'Workspace configurado');
      if (saved) closeDialog($('#setup-dialog'));
    });
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const close = event.target.closest('[data-close-dialog]');
      if (close) {
        closeDialog(close.closest('dialog'));
        return;
      }
      const opener = event.target.closest('[data-open-dialog]');
      if (opener) {
        const id = opener.dataset.openDialog;
        prepareNewDialog(id);
        showDialog(document.getElementById(id));
        return;
      }
      const decisionFilter = event.target.closest('[data-decision-filter]');
      if (decisionFilter) {
        state.decisionFilter = decisionFilter.dataset.decisionFilter;
        renderDecisions();
        return;
      }
      const travelProviderFilter = event.target.closest('[data-travel-provider-filter]');
      if (travelProviderFilter) {
        state.travelProviderFilter = travelProviderFilter.dataset.travelProviderFilter;
        renderTravelProviders();
        return;
      }
      const actionElement = event.target.closest('[data-action]');
      if (actionElement) {
        handleAction(actionElement.dataset.action, actionElement);
        return;
      }
      const viewElement = event.target.closest('[data-view]');
      if (viewElement) navigate(viewElement.dataset.view);
    });

    $$('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog);
    }));

    const travelDeparture = $('#travel-search-departure');
    const travelReturn = $('#travel-search-return');
    if (travelDeparture && travelReturn) {
      travelDeparture.min = today();
      travelReturn.min = today();
      travelDeparture.addEventListener('change', () => {
        travelReturn.min = travelDeparture.value || today();
        if (travelReturn.value && travelReturn.value < travelReturn.min) travelReturn.value = '';
      });
    }

    $('#transaction-type')?.addEventListener('change', syncTransactionType);
    ['#finance-search', '#finance-type-filter', '#finance-participant-filter', '#finance-month-filter']
      .forEach((selector) => $(selector)?.addEventListener(selector === '#finance-search' ? 'input' : 'change', renderFinances));
    ['#checklist-category-filter', '#checklist-trip-filter']
      .forEach((selector) => $(selector)?.addEventListener('change', renderChecklist));
    ['#report-period', '#report-participant']
      .forEach((selector) => $(selector)?.addEventListener('change', renderReports));

    document.addEventListener('change', (event) => {
      const voterSelect = event.target.closest('.decision-voter-select');
      if (voterSelect) {
        state.voterByDecision[voterSelect.dataset.decisionId] = voterSelect.value;
        renderDecisions();
        return;
      }
      if (event.target.matches('[data-participant-name]')) {
        const name = event.target.value.trim();
        const id = event.target.dataset.participantName;
        if (!name) return renderSettings();
        commit((draft) => {
          const participant = draft.participants.find((item) => item.id === id);
          if (participant) participant.name = name;
        }, 'Nome atualizado');
        return;
      }
      if (event.target.matches('[data-participant-color]')) {
        const color = event.target.value;
        const id = event.target.dataset.participantColor;
        commit((draft) => {
          const participant = draft.participants.find((item) => item.id === id);
          if (participant) participant.color = color;
        });
      }
    });

    $('#backup-file-input')?.addEventListener('change', async (event) => {
      const input = event.target;
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const source = await file.text();
        if (!confirm('Importar este backup? O workspace atual será substituído dentro do cofre.')) return;
        try {
          state.workspace = await Repository.importBackup(source);
        } catch (error) {
          if (error && error.code === 'vault/backup-password-required') {
            state.pendingBackupSource = source;
            $('#backup-password-form')?.reset();
            showDialog($('#backup-password-dialog'));
            toast('Senha do backup necessária', 'Informe a senha usada quando esse arquivo foi criado.');
            return;
          }
          throw error;
        }
        state.voterByDecision = {};
        renderAll();
        toast('Backup restaurado', 'Os dados foram validados e recriptografados com a conta atual.', 'success');
      } catch (error) {
        toast('Falha ao importar', error.message || 'Arquivo inválido.', 'error');
      } finally {
        input.value = '';
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSidebar();
    });

    window.addEventListener('hashchange', () => {
      const view = location.hash.slice(1);
      if (view) navigate(view, false);
    });
    bindForms();
  }

  async function materializeRecurring(workspace) {
    const preview = Core.materializeRecurring(workspace, currentMonth());
    if (!preview.added) return preview.workspace;
    try {
      return await Repository.update(
        (draft) => Core.materializeRecurring(draft, currentMonth()).workspace,
        workspace.generation
      );
    } catch (error) {
      if (error && error.code === 'local/workspace-replaced') return error.currentWorkspace || await Repository.load();
      throw error;
    }
  }

  function showFatal(error) {
    const loader = $('#app-loading');
    if (!loader) return;
    loader.innerHTML = `<div class="loading-mark">!</div><strong>Não foi possível abrir o banco local</strong><span>${escapeHtml(error && error.message ? error.message : 'Verifique as permissões do navegador.')}</span><button class="button primary" id="retry-init" type="button">Tentar novamente</button>`;
    $('#retry-init')?.addEventListener('click', () => location.reload());
  }

  async function init() {
    if (!Core || !Repository || !Repository.auth || !Travel) {
      showFatal(new Error('Os módulos locais obrigatórios não foram carregados.'));
      return;
    }
    try {
      const restoredSession = await Repository.auth.restoreSession();
      if (!restoredSession) {
        redirectToLogin();
        return;
      }
      state.account = restoredSession.account;
      state.sessionExpiresAt = restoredSession.expiresAt || 0;
      let theme = 'light';
      try {
        theme = localStorage.getItem(Repository.THEME_KEY)
          || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      } catch (_) {}
      applyTheme(theme);
      state.workspace = await Repository.initialize();
      state.workspace = await materializeRecurring(state.workspace);
      bindEvents();
      renderAll();
      state.unsubscribe = Repository.subscribe((workspace) => {
        if (!state.workspace || workspace.revision <= state.workspace.revision) return;
        state.workspace = workspace;
        renderAll();
        toast('Dados atualizados', 'Outra aba alterou este workspace.');
      }, () => {
        lockVault({ allTabs: false });
      }, () => {
        renderSettings();
        toast('Cópia legível detectada', 'Uma aba antiga gravou dados fora do cofre. Baixe e revise a cópia em Configurações.', 'error');
      });
      setupAutoLock();
      const shell = $('#app-shell');
      const loader = $('#app-loading');
      if (shell) shell.hidden = false;
      if (loader) {
        loader.classList.add('hidden');
        window.setTimeout(() => loader.remove(), 320);
      }
      const requestedView = location.hash.slice(1);
      const validRequestedView = $$('[data-view-panel]').some((panel) => panel.dataset.viewPanel === requestedView);
      navigate(validRequestedView ? requestedView : 'dashboard', false);
      const warning = Repository.getLastWarning();
      if (warning) toast('Banco local recuperado', warning.message, 'error');
      if (!state.workspace.settings.onboardingCompleted
        && !state.workspace.name
        && !state.workspace.participants.length
        && !state.workspace.finances.length
        && !state.workspace.trips.length
        && !state.workspace.goals.length
        && !state.workspace.checklist.length
        && !state.workspace.decisions.length) {
        window.setTimeout(() => {
          prepareNewDialog('setup-dialog');
          showDialog($('#setup-dialog'));
        }, 280);
      }
      window.addEventListener('beforeunload', () => {
        state.unsubscribe?.();
        if (state.autoLockTimer) window.clearInterval(state.autoLockTimer);
      }, { once: true });
    } catch (error) {
      if (error && ['vault/locked', 'vault/session-invalid', 'vault/invalid-credentials'].includes(error.code)) {
        redirectToLogin();
        return;
      }
      showFatal(error);
    }
  }

  window.PlannerApp = Object.freeze({
    getState: () => Core.clone(state.workspace),
    navigate,
    render: renderAll,
    travelSearch: Travel,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
