/* PlannerDuo — helpers compartilhados das skills (validação pt-BR, resolvers e recibos). */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerSkillKit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_AMOUNT = 1_000_000_000;

  // -------------------- erros de campo --------------------
  function fieldError(field, message) {
    return { field: String(field), message: String(message) };
  }
  function invalid(fields) {
    return { ok: false, fields: Array.isArray(fields) ? fields : [fields] };
  }
  function ok(value) {
    return { ok: true, value: value };
  }

  // -------------------- normalização --------------------
  function stripAccents(value) {
    return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function normalizeKey(value) {
    return stripAccents(value).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // -------------------- validadores --------------------
  // Texto obrigatório com limite de tamanho. Retorna { ok, value } ou field error.
  function validateText(value, field, label, options) {
    const opts = options || {};
    const max = Number.isInteger(opts.max) ? opts.max : 200;
    const text = String(value == null ? '' : value).trim();
    if (!text) {
      if (opts.optional) return ok('');
      return invalid(fieldError(field, `Informe ${label || 'um valor'}.`));
    }
    if (text.length > max) return invalid(fieldError(field, `Use no máximo ${max} caracteres.`));
    return ok(text);
  }

  // Dinheiro decimal em BRL (como os formulários). required => > 0.
  function parseAmount(value) {
    if (value == null || value === '') return NaN;
    let parsed;
    if (typeof value === 'number') {
      parsed = value;
    } else {
      const source = String(value).trim();
      if (!source) return NaN;
      parsed = Number(source.includes(',') ? source.replace(/\./g, '').replace(',', '.') : source);
    }
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_AMOUNT) return NaN;
    const cents = Math.round(parsed * 100);
    return Number.isSafeInteger(cents) ? cents / 100 : NaN;
  }
  function validateMoney(value, field, options) {
    const opts = options || {};
    if ((value == null || value === '') && opts.optional) return ok(0);
    const parsed = parseAmount(value);
    if (!Number.isFinite(parsed)) {
      return invalid(fieldError(field, `Informe um valor entre zero e ${formatMoney(MAX_AMOUNT)}.`));
    }
    if (opts.required && parsed <= 0) {
      return invalid(fieldError(field, 'Informe um valor maior que zero.'));
    }
    return ok(parsed);
  }

  // Data YYYY-MM-DD real. optional => '' permitido.
  function isValidIsoDate(value) {
    const result = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return false;
    const [year, month, day] = result.split('-').map(Number);
    const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
    return !Number.isNaN(parsed.getTime())
      && parsed.getFullYear() === year
      && parsed.getMonth() === month - 1
      && parsed.getDate() === day;
  }
  function validateDate(value, field, options) {
    const opts = options || {};
    const raw = String(value == null ? '' : value).trim();
    if (!raw) {
      if (opts.optional) return ok('');
      return invalid(fieldError(field, 'Informe uma data no formato AAAA-MM-DD.'));
    }
    if (!isValidIsoDate(raw)) return invalid(fieldError(field, 'Informe uma data real no formato AAAA-MM-DD.'));
    return ok(raw);
  }

  // Mês YYYY-MM.
  function validateMonth(value, field, options) {
    const opts = options || {};
    const raw = String(value == null ? '' : value).trim();
    if (!raw) {
      if (opts.optional) return ok('');
      return invalid(fieldError(field, 'Informe um mês no formato AAAA-MM.'));
    }
    if (!/^\d{4}-\d{2}$/.test(raw)) return invalid(fieldError(field, 'Informe um mês no formato AAAA-MM.'));
    return ok(raw);
  }

  // Identificador não vazio.
  function validateId(value, field, label) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return invalid(fieldError(field, `Informe ${label || 'um identificador'}.`));
    return ok(text);
  }

  function formatMoney(value) {
    try {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(Number(value) || 0);
    } catch (_) {
      return `R$ ${(Number(value) || 0).toFixed(2)}`;
    }
  }

  // Data local de hoje (não UTC), a partir de um epoch opcional (ctx.now).
  function today(now) {
    const current = typeof now === 'number' ? new Date(now) : (now instanceof Date ? now : new Date());
    return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
  }
  function currentMonth(now) {
    return today(now).slice(0, 7);
  }

  // -------------------- resolvers --------------------
  // Resolve uma entidade por id exato OU por referência humana.
  // match exato de chave normalizada > único substring. Ambíguo => field error.
  function resolveEntity(list, ref, options) {
    const opts = options || {};
    const field = opts.field || 'ref';
    const label = opts.label || 'item';
    const items = Array.isArray(list) ? list : [];
    const query = String(ref == null ? '' : ref).trim();
    if (!query) return invalid(fieldError(field, `Informe ${label}.`));
    // 1) id exato
    const byId = items.find((item) => item && item.id === query);
    if (byId) return ok(byId);
    const key = normalizeKey(query);
    if (!key) return invalid(fieldError(field, `Informe ${label}.`));
    const labelOf = opts.labelOf || ((item) => item && (item.name || item.destination || item.title || item.text || item.label || ''));
    // 2) match exato de rótulo normalizado
    const exact = items.filter((item) => normalizeKey(labelOf(item)) === key);
    if (exact.length === 1) return ok(exact[0]);
    if (exact.length > 1) return invalid(ambiguous(field, label, exact, labelOf));
    // 3) substring único
    const partial = items.filter((item) => normalizeKey(labelOf(item)).includes(key));
    if (partial.length === 1) return ok(partial[0]);
    if (partial.length > 1) return invalid(ambiguous(field, label, partial, labelOf));
    return invalid(fieldError(field, `Nenhum ${label} corresponde a “${query}”.`));
  }
  function ambiguous(field, label, candidates, labelOf) {
    const names = candidates.slice(0, 5).map((item) => labelOf(item) || item.id).filter(Boolean);
    return fieldError(field, `Mais de um ${label} corresponde. Especifique: ${names.join(', ')}.`);
  }

  function resolveTrip(ws, ref, options) {
    const opts = Object.assign({ field: 'tripRef', label: 'viagem', labelOf: (t) => t && t.destination }, options || {});
    return resolveEntity(ws && ws.trips, ref, opts);
  }
  function resolveGoal(ws, ref, options) {
    const opts = Object.assign({ field: 'goalRef', label: 'meta', labelOf: (g) => g && g.title }, options || {});
    return resolveEntity(ws && ws.goals, ref, opts);
  }
  function resolveChecklistItem(ws, ref, options) {
    const opts = Object.assign({ field: 'itemRef', label: 'item', labelOf: (i) => i && i.text }, options || {});
    return resolveEntity(ws && ws.checklist, ref, opts);
  }
  function resolveDecision(ws, ref, options) {
    const opts = Object.assign({ field: 'decisionRef', label: 'decisão', labelOf: (d) => d && d.title }, options || {});
    return resolveEntity(ws && ws.decisions, ref, opts);
  }
  function resolveOption(decision, ref, options) {
    const opts = Object.assign({ field: 'optionRef', label: 'opção', labelOf: (o) => o && o.label }, options || {});
    return resolveEntity(decision && decision.options, ref, opts);
  }
  // Participante: aceita id, nome, ou 'me'/'eu'. 'me' resolve ao único participante
  // ativo quando há exatamente um (o nome da conta não está disponível aqui).
  function resolveParticipant(ws, ref, options) {
    const opts = Object.assign({ field: 'participantRef', label: 'participante', labelOf: (p) => p && p.name }, options || {});
    const participants = (ws && Array.isArray(ws.participants)) ? ws.participants : [];
    const key = normalizeKey(ref);
    if (key === 'me' || key === 'eu') {
      const actives = participants.filter((p) => p.active);
      if (actives.length === 1) return ok(actives[0]);
      return invalid(fieldError(opts.field, 'Não dá para identificar “eu”: informe o nome do participante.'));
    }
    return resolveEntity(participants, ref, opts);
  }

  // -------------------- recibo --------------------
  function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
  function receipt(data) {
    const d = data || {};
    return {
      entity: d.entity || null,
      collection: d.collection || null,
      action: d.action || null,
      id: d.id != null ? d.id : null,
      before: d.before === undefined ? null : deepClone(d.before),
      after: d.after === undefined ? null : deepClone(d.after),
      message: d.message || '',
    };
  }

  return Object.freeze({
    MAX_AMOUNT,
    fieldError,
    invalid,
    ok,
    stripAccents,
    normalizeKey,
    validateText,
    parseAmount,
    validateMoney,
    isValidIsoDate,
    validateDate,
    validateMonth,
    validateId,
    formatMoney,
    today,
    currentMonth,
    resolveEntity,
    resolveTrip,
    resolveGoal,
    resolveChecklistItem,
    resolveDecision,
    resolveOption,
    resolveParticipant,
    deepClone,
    receipt,
  });
});
