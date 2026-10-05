/* PlannerDuo — PlannerCentralView: a tela Central (compositor + conversa).
 *
 * UMD como public/travel.js (global PlannerCentralView). Sem dependências externas.
 *
 * SEGURANÇA DE RENDERIZAÇÃO (regra dura da etapa 3):
 *   - Só construímos DOM via document.createElement + textContent/setAttribute/append.
 *   - NUNCA usamos innerHTML, outerHTML, insertAdjacentHTML, document.write, eval
 *     nem new Function. Todo texto de usuário/modelo passa por textContent, que
 *     escapa automaticamente. Strings são truncadas para um tamanho são (clamp).
 *
 * API: PlannerCentralView.create({ mount, orchestrator, onAction }) -> { destroy() }
 *   - mount: elemento onde a view é montada (obrigatório).
 *   - orchestrator: PlannerOrchestrator (handle, act, on('block'|'activity'|
 *     'turn:start'|'turn:end'|'cleared')).
 *   - onAction: callback opcional (acao) para recibos/ações; recebe
 *     { type, blockId, action, value, gesture }.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerCentralView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_LEN = 2000; // clamp de qualquer string renderizada

  const SUGGESTIONS = [
    'Voo de São Paulo para Lisboa em dezembro',
    'Gastei 150 no mercado',
    'Minhas viagens',
    'Resumo do mês',
  ];

  function clampStr(v) {
    if (v == null) return '';
    const s = typeof v === 'string' ? v : String(v);
    return s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s;
  }

  function isHttpUrl(u) {
    if (typeof u !== 'string') return false;
    // só http(s); qualquer outra coisa (javascript:, data:, etc.) é inerte.
    return /^https?:\/\//i.test(u.trim());
  }

  function create(opts) {
    opts = opts || {};
    const mount = opts.mount;
    const orchestrator = opts.orchestrator;
    const onAction = typeof opts.onAction === 'function' ? opts.onAction : null;
    if (!mount || typeof mount.ownerDocument === 'undefined') {
      throw new Error('PlannerCentralView.create: mount inválido');
    }
    const doc = mount.ownerDocument;

    // ---------- fábricas DOM seguras ----------
    function el(tag, className, attrs) {
      const node = doc.createElement(tag);
      if (className) node.setAttribute('class', className);
      if (attrs) {
        for (const k in attrs) {
          if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, String(attrs[k]));
        }
      }
      return node;
    }
    function textEl(tag, className, text) {
      const node = el(tag, className);
      node.textContent = clampStr(text); // único caminho de texto -> seguro
      return node;
    }
    function iconSpan(glyph) {
      const i = el('span', 'cv-ic', { 'aria-hidden': 'true' });
      i.textContent = clampStr(glyph);
      return i;
    }

    // ---------- estrutura raiz ----------
    const rootEl = el('section', 'cv-root', { 'data-view': 'central' });

    // atividade dos agentes (um anúncio por mudança)
    const activity = el('div', 'cv-activity', {
      role: 'status',
      'aria-live': 'polite',
    });
    let lastActivityText = '';

    // skeleton estático (sob reduced-motion o CSS remove o shimmer)
    const skeleton = el('div', 'cv-skeleton', { 'aria-hidden': 'true', hidden: 'hidden' });
    skeleton.append(el('div', 'cv-skeleton-line'), el('div', 'cv-skeleton-line'));

    // log da conversa
    const log = el('div', 'cv-log', {
      role: 'log',
      'aria-live': 'polite',
      'aria-label': 'Conversa com os agentes',
      tabindex: '-1',
    });

    // empty state
    const empty = el('div', 'cv-empty');
    empty.append(
      textEl('p', 'cv-empty-title', 'Converse com os agentes'),
      textEl('p', 'cv-empty-sub', 'Peça voos, hospedagens, lançamentos ou um resumo. Tudo acontece aqui.'),
    );
    log.appendChild(empty);
    let messageCount = 0;

    // ---------- compositor ----------
    const composer = el('form', 'cv-composer', { 'aria-label': 'Enviar mensagem' });
    const fieldId = 'cv-field';
    const label = textEl('label', 'cv-composer-label', 'Sua mensagem');
    label.setAttribute('for', fieldId);
    const field = el('textarea', 'cv-field', {
      id: fieldId,
      rows: '2',
      placeholder: 'Escreva aqui (Enter envia, Shift+Enter quebra linha)',
      'aria-label': 'Sua mensagem',
    });
    const sendBtn = el('button', 'cv-send', { type: 'submit' });
    sendBtn.textContent = 'Enviar';

    const composerRow = el('div', 'cv-composer-row');
    composerRow.append(field, sendBtn);

    // chips de sugestão
    const chips = el('div', 'cv-suggestions', { 'aria-label': 'Sugestões' });
    SUGGESTIONS.forEach(function (text) {
      const chip = el('button', 'cv-chip', { type: 'button' });
      chip.textContent = clampStr(text);
      chip.addEventListener('click', function () {
        field.value = text;
        field.focus();
      });
      chips.appendChild(chip);
    });

    composer.append(label, composerRow, chips);

    // ---------- montagem ----------
    rootEl.append(activity, skeleton, log, composer);
    mount.appendChild(rootEl);

    // ---------- envio ----------
    function submitText() {
      const text = clampStr(field.value).trim();
      if (!text) return; // vazio é ignorado
      field.value = '';
      try {
        if (orchestrator && typeof orchestrator.handle === 'function') orchestrator.handle(text);
      } finally {
        field.focus(); // foco volta ao compositor após enviar
      }
    }

    composer.addEventListener('submit', function (e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      submitText();
    });
    field.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        submitText();
      }
    });
    sendBtn.addEventListener('click', function (e) {
      // o form já trata submit; previne duplo disparo em DOM reais.
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      submitText();
    });

    // ---------- ações (recibo/confirmação/erro) ----------
    function fireAction(info) {
      if (onAction) {
        try { onAction(info); } catch (_e) { /* um handler não derruba a view */ }
      }
    }
    function act(blockId, action, gesture, value) {
      fireAction({ type: 'act', blockId: blockId, action: action, value: value, gesture: gesture });
      if (orchestrator && typeof orchestrator.act === 'function') {
        orchestrator.act(blockId, action, gesture);
      }
    }

    // ---------- renderizadores por tipo de bloco ----------
    function actionButton(labelText, className, handler) {
      const b = el('button', className || 'cv-action', { type: 'button' });
      b.textContent = clampStr(labelText);
      b.addEventListener('click', function (e) { handler(e); });
      return b;
    }

    function renderText(block) {
      const node = el('div', 'cv-block cv-block-text', { 'data-type': 'text' });
      const p = block.payload || {};
      node.appendChild(textEl('p', 'cv-text', p.message != null ? p.message : (p.text != null ? p.text : '')));
      appendActions(node, block);
      return node;
    }

    function renderQuestion(block) {
      const node = el('div', 'cv-block cv-block-question', { 'data-type': 'question' });
      const p = block.payload || {};
      node.appendChild(textEl('p', 'cv-prompt', p.prompt != null ? p.prompt : p.message));
      const row = el('div', 'cv-chip-row');
      (block.actions || []).forEach(function (a) {
        const chip = el('button', 'cv-chip', { type: 'button' });
        chip.textContent = clampStr(a.label != null ? a.label : a.value);
        chip.addEventListener('click', function () {
          field.value = a.value != null ? clampStr(a.value) : clampStr(a.label);
          submitText();
        });
        row.appendChild(chip);
      });
      if (row.childElementCount) node.appendChild(row);
      return node;
    }

    function renderLinks(block) {
      const node = el('div', 'cv-block cv-block-links', { 'data-type': 'links' });
      const p = block.payload || {};
      const list = el('ul', 'cv-link-list');
      (p.links || []).forEach(function (link) {
        const li = el('li', 'cv-link-item');
        li.appendChild(iconSpan('↗'));
        const name = clampStr(link.name != null ? link.name : link.providerId);
        if (isHttpUrl(link.url)) {
          const a = el('a', 'cv-link', {
            href: clampStr(link.url),
            rel: 'noopener noreferrer',
            target: '_blank',
          });
          a.textContent = name;
          li.appendChild(a);
        } else {
          // URL não-http: texto inerte, nunca um <a> acionável.
          li.appendChild(textEl('span', 'cv-link-inert', name));
        }
        if (Array.isArray(link.limitations) && link.limitations.length) {
          li.appendChild(textEl('small', 'cv-link-note', link.limitations.join(' · ')));
        }
        list.appendChild(li);
      });
      node.appendChild(list);
      if (Array.isArray(p.skipped) && p.skipped.length) {
        node.appendChild(textEl('small', 'cv-skipped', p.skipped.length + ' provedor(es) sem link seguro.'));
      }
      return node;
    }

    function kvRow(labelText, valueText) {
      const row = el('div', 'cv-kv');
      row.append(
        textEl('span', 'cv-kv-k', labelText),
        textEl('span', 'cv-kv-v cv-num', valueText),
      );
      return row;
    }

    function renderFlights(block) {
      const node = el('div', 'cv-block cv-block-flights', { 'data-type': 'flights' });
      const results = normalizeResults(block.payload);
      if (!results.length) node.appendChild(textEl('p', 'cv-empty-sub', 'Nenhuma opção de voo.'));
      results.forEach(function (f) { node.appendChild(flightCard(f)); });
      return node;
    }

    function flightCard(f) {
      const card = el('article', 'cv-card cv-flight-card');
      // companhia em TEXTO (nome + código), sem logo remoto
      const head = el('header', 'cv-card-head');
      const carrier = clampStr(f.carrier != null ? f.carrier : f.carrierName);
      const code = clampStr(f.carrierCode != null ? f.carrierCode : f.code);
      head.appendChild(textEl('span', 'cv-carrier', code ? (carrier + ' · ' + code) : carrier));
      card.appendChild(head);

      // horários grandes com "+1" quando chega no dia seguinte
      const times = el('div', 'cv-times');
      times.appendChild(textEl('span', 'cv-time cv-num', f.departTime != null ? f.departTime : f.depart));
      times.appendChild(textEl('span', 'cv-time-sep', '→'));
      const arr = el('span', 'cv-time-wrap');
      arr.appendChild(textEl('span', 'cv-time cv-num', f.arriveTime != null ? f.arriveTime : f.arrive));
      if (f.arrivalNextDay || f.nextDay || f.plusDays > 0) {
        arr.appendChild(textEl('sup', 'cv-plus1', '+' + (f.plusDays > 0 ? f.plusDays : 1)));
      }
      times.appendChild(arr);
      card.appendChild(times);

      // duração
      if (f.duration != null) card.appendChild(textEl('p', 'cv-duration', clampStr(f.duration)));

      // escalas com aeroporto e tempo de conexão
      const stops = Array.isArray(f.stops) ? f.stops : [];
      const stopsLine = el('p', 'cv-stops');
      if (!stops.length) {
        stopsLine.textContent = 'Direto';
      } else {
        stopsLine.textContent = stops.map(function (s) {
          const airport = clampStr(s.airport != null ? s.airport : s.code);
          const conn = s.connection != null ? (' ' + clampStr(s.connection)) : '';
          return airport + conn;
        }).join(' · ');
      }
      card.appendChild(stopsLine);

      // bagagem e flexibilidade
      if (f.baggage != null) card.appendChild(kvRow('Bagagem', typeof f.baggage === 'string' ? f.baggage : JSON.stringify(f.baggage)));
      if (f.flexibility != null) card.appendChild(kvRow('Flexibilidade', clampStr(f.flexibility)));

      // preço tabular com moeda
      if (f.price != null || f.priceMinor != null) {
        card.appendChild(kvRow('Preço', formatPrice(f)));
      }

      // rótulos
      appendLabels(card, f.labels);
      // motivos
      appendReasons(card, f.reasons);
      // linha de honestidade (7.13.4)
      if (f.honesty != null) card.appendChild(textEl('p', 'cv-honesty', f.honesty));

      // ações
      card.appendChild(cardActions(f));
      return card;
    }

    function renderStays(block) {
      const node = el('div', 'cv-block cv-block-stays', { 'data-type': 'stays' });
      const results = normalizeResults(block.payload);
      if (!results.length) node.appendChild(textEl('p', 'cv-empty-sub', 'Nenhuma hospedagem.'));
      results.forEach(function (s) { node.appendChild(stayCard(s)); });
      return node;
    }

    function stayCard(s) {
      const card = el('article', 'cv-card cv-stay-card');
      card.appendChild(textEl('header', 'cv-stay-name', s.name));
      if (s.rating != null) {
        const reviews = s.reviews != null ? (' · ' + clampStr(s.reviews) + ' avaliações') : '';
        card.appendChild(textEl('p', 'cv-rating cv-num', clampStr(s.rating) + '/10' + reviews));
      }
      if (s.nights != null) card.appendChild(kvRow('Noites', String(s.nights)));
      if (s.total != null || s.totalMinor != null) card.appendChild(kvRow('Total', formatPrice({ price: s.total, priceMinor: s.totalMinor, currency: s.currency })));
      if (s.perNight != null || s.perNightMinor != null) card.appendChild(kvRow('Por noite', formatPrice({ price: s.perNight, priceMinor: s.perNightMinor, currency: s.currency })));
      if (s.board != null) card.appendChild(kvRow('Regime', clampStr(s.board)));
      if (s.refundable != null) card.appendChild(kvRow('Reembolsável', s.refundable ? 'Sim' : 'Não'));
      appendLabels(card, s.labels);
      appendReasons(card, s.reasons);
      if (s.honesty != null) card.appendChild(textEl('p', 'cv-honesty', s.honesty));
      card.appendChild(cardActions(s));
      return card;
    }

    function cardActions(item) {
      const row = el('div', 'cv-card-actions');
      row.appendChild(actionButton('Ver opções de compra', 'cv-action cv-action-primary', function (e) {
        fireAction({ type: 'buy', item: item, gesture: e });
      }));
      row.appendChild(actionButton('Salvar como viagem', 'cv-action cv-action-secondary', function (e) {
        fireAction({ type: 'save-trip', item: item, gesture: e });
      }));
      return row;
    }

    function appendLabels(card, labels) {
      if (!Array.isArray(labels) || !labels.length) return;
      const row = el('div', 'cv-labels');
      labels.forEach(function (l) {
        row.appendChild(textEl('span', 'cv-label', typeof l === 'string' ? l : (l && l.text)));
      });
      card.appendChild(row);
    }
    function appendReasons(card, reasons) {
      if (!Array.isArray(reasons) || !reasons.length) return;
      const ul = el('ul', 'cv-reasons');
      reasons.forEach(function (r) {
        ul.appendChild(textEl('li', 'cv-reason', typeof r === 'string' ? r : (r && r.text)));
      });
      card.appendChild(ul);
    }

    function formatPrice(x) {
      const currency = clampStr(x.currency != null ? x.currency : 'BRL');
      if (x.price != null) return currency + ' ' + clampStr(x.price);
      if (x.priceMinor != null) {
        const n = Number(x.priceMinor);
        return currency + ' ' + (Number.isFinite(n) ? (n / 100).toFixed(2) : clampStr(x.priceMinor));
      }
      return currency;
    }

    function normalizeResults(payload) {
      const p = payload || {};
      const r = p.results != null ? p.results : p;
      if (Array.isArray(r)) return r;
      if (r && Array.isArray(r.items)) return r.items;
      if (r && Array.isArray(r.offers)) return r.offers;
      if (r && Array.isArray(r.results)) return r.results;
      return [];
    }

    function renderSummary(block) {
      const node = el('div', 'cv-block cv-block-summary', { 'data-type': 'summary' });
      const p = block.payload || {};
      const kind = p.kind || 'generic';
      const data = p.data != null ? p.data : p;
      if (kind === 'list' || Array.isArray(data) || (data && Array.isArray(data.items))) {
        const items = Array.isArray(data) ? data : (data && data.items ? data.items : []);
        const ul = el('ul', 'cv-summary-list');
        items.forEach(function (it) {
          ul.appendChild(textEl('li', 'cv-summary-li', typeof it === 'string' ? it : (it && (it.label || it.title || JSON.stringify(it)))));
        });
        node.appendChild(ul);
      } else if (data && typeof data === 'object') {
        const dl = el('dl', 'cv-summary-kv');
        Object.keys(data).forEach(function (k) {
          dl.append(
            textEl('dt', 'cv-kv-k', k),
            textEl('dd', 'cv-kv-v cv-num', typeof data[k] === 'object' ? JSON.stringify(data[k]) : data[k]),
          );
        });
        node.appendChild(dl);
      } else {
        node.appendChild(textEl('p', 'cv-text', data));
      }
      return node;
    }

    function renderReceipt(block) {
      const node = el('div', 'cv-block cv-block-receipt', { 'data-type': 'receipt' });
      const p = block.payload || {};
      node.appendChild(textEl('p', 'cv-text', p.message != null ? p.message : 'Feito.'));
      const undo = actionButton('Desfazer', 'cv-action cv-action-secondary', function (e) {
        const value = p.id != null ? p.id : (block.actions && block.actions[0] && block.actions[0].value);
        act(block.id, 'undo', e, value);
      });
      node.appendChild(undo);
      return node;
    }

    function renderConfirmation(block) {
      const node = el('div', 'cv-block cv-block-confirmation', { 'data-type': 'confirmation' });
      const p = block.payload || {};
      if (p.title != null) node.appendChild(textEl('h3', 'cv-confirm-title', p.title));
      if (p.message != null) node.appendChild(textEl('p', 'cv-text', p.message));
      // resumo campo a campo
      const fields = Array.isArray(p.fields) ? p.fields : [];
      if (fields.length) {
        const dl = el('dl', 'cv-summary-kv');
        fields.forEach(function (fld) {
          dl.append(
            textEl('dt', 'cv-kv-k', fld.label != null ? fld.label : fld.field),
            textEl('dd', 'cv-kv-v', fld.value),
          );
        });
        node.appendChild(dl);
      }
      const row = el('div', 'cv-card-actions');
      row.appendChild(actionButton('Confirmar', 'cv-action cv-action-primary', function (e) {
        act(block.id, 'confirm', e); // passa o evento real como gesto
      }));
      row.appendChild(actionButton('Cancelar', 'cv-action cv-action-secondary', function (e) {
        act(block.id, 'cancel', e);
      }));
      node.appendChild(row);
      return node;
    }

    function renderError(block) {
      const node = el('div', 'cv-block cv-block-error', { 'data-type': 'error', role: 'alert' });
      const p = block.payload || {};
      node.appendChild(textEl('p', 'cv-text', p.message != null ? p.message : 'Algo deu errado.'));
      node.appendChild(actionButton('Tentar de novo', 'cv-action cv-action-secondary', function (e) {
        const value = block.actions && block.actions[0] && block.actions[0].value;
        fireAction({ type: 'retry', blockId: block.id, value: value, gesture: e });
        field.focus(); // após erro, foco volta ao compositor
      }));
      return node;
    }

    function appendActions(node, block) {
      if (!Array.isArray(block.actions) || !block.actions.length) return;
      const row = el('div', 'cv-chip-row');
      block.actions.forEach(function (a) {
        const b = el('button', 'cv-chip', { type: 'button' });
        b.textContent = clampStr(a.label != null ? a.label : a.value);
        b.addEventListener('click', function (e) {
          fireAction({ type: 'action', blockId: block.id, action: a.id, value: a.value, gesture: e });
        });
        row.appendChild(b);
      });
      node.appendChild(row);
    }

    const RENDERERS = {
      text: renderText,
      question: renderQuestion,
      links: renderLinks,
      flights: renderFlights,
      stays: renderStays,
      summary: renderSummary,
      receipt: renderReceipt,
      confirmation: renderConfirmation,
      error: renderError,
    };

    function renderBlock(block) {
      const type = block && block.type;
      const fn = RENDERERS[type] || renderText;
      return fn(block);
    }

    // ---------- fluxo de eventos ----------
    function onBlock(block) {
      if (messageCount === 0 && empty.parentNode === log) log.removeChild(empty);
      const node = renderBlock(block || {});
      node.setAttribute('tabindex', '-1');
      log.appendChild(node);
      messageCount += 1;
      // foco no último bloco após renderizar
      try { node.focus(); } catch (_e) { /* ambientes sem focus */ }
      if (block && block.type === 'error') {
        try { field.focus(); } catch (_e) { /* volta ao compositor após erro */ }
      }
    }

    function onActivity(info) {
      const title = clampStr(info && (info.title || info.id) ? (info.title || info.id) : '');
      const running = info && info.status === 'running';
      const text = running && title ? ('Executando: ' + title) : (title ? title : '');
      if (text === lastActivityText) return; // um anúncio por mudança
      lastActivityText = text;
      activity.textContent = text;
    }

    function onTurnStart() {
      skeleton.removeAttribute('hidden');
    }
    function onTurnEnd() {
      skeleton.setAttribute('hidden', 'hidden');
    }
    function onCleared() {
      log.replaceChildren(empty);
      messageCount = 0;
      activity.textContent = '';
      lastActivityText = '';
    }

    // ---------- assinaturas ----------
    const unsubs = [];
    function sub(event, handler) {
      if (orchestrator && typeof orchestrator.on === 'function') {
        const off = orchestrator.on(event, handler);
        if (typeof off === 'function') unsubs.push(off);
      }
    }
    sub('block', onBlock);
    sub('activity', onActivity);
    sub('turn:start', onTurnStart);
    sub('turn:end', onTurnEnd);
    sub('cleared', onCleared);

    // ---------- destroy ----------
    function destroy() {
      unsubs.forEach(function (off) { try { off(); } catch (_e) { /* idempotente */ } });
      unsubs.length = 0;
      if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
    }

    return Object.freeze({
      destroy: destroy,
      // expostos para testes/wiring da etapa 4 (sem efeitos colaterais)
      elements: Object.freeze({ root: rootEl, field: field, log: log, activity: activity }),
    });
  }

  return Object.freeze({ create: create });
});
