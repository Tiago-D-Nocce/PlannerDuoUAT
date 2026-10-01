/* PlannerDuo — PlannerNLU: normalização, intents em allowlist, entidades e
   follow-ups. Puro, sem DOM, nunca lança. Obtém lugares de globalThis.PlannerPlaces
   (navegador) ou require('./places.js') (Node). */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerNLU = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function getPlaces() {
    if (typeof globalThis !== 'undefined' && globalThis.PlannerPlaces) return globalThis.PlannerPlaces;
    if (typeof module !== 'undefined' && module.exports) {
      try {
        // eslint-disable-next-line global-require
        return require('./places.js');
      } catch (_err) {
        return null;
      }
    }
    return null;
  }

  // ---------- Intents em allowlist ----------
  const INTENTS = Object.freeze([
    'travel.search', 'travel.flights', 'travel.stays', 'travel.links',
    'trip.create', 'trip.list', 'trip.summary',
    'finance.add', 'finance.summary', 'finance.settle',
    'budget.set', 'goal.create', 'goal.fund', 'goal.progress',
    'checklist.add', 'checklist.done', 'checklist.list',
    'decision.create', 'decision.vote', 'decision.list',
    'participant.add', 'report.month', 'help', 'undo', 'unknown',
  ]);
  const INTENT_SET = new Set(INTENTS);
  const TRAVEL_INTENTS = new Set(['travel.search', 'travel.flights', 'travel.stays', 'travel.links']);

  const MONTHS = {
    janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4,
    maio: 5, mai: 5, junho: 6, jun: 6, julho: 7, jul: 7, agosto: 8, ago: 8,
    setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11, dezembro: 12, dez: 12,
  };
  const WEEKDAYS = {
    domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6,
  };

  // palavras que nunca são lugar (evita vazamento na extração de origem/destino)
  const STOP_PLACE = /\b(\d+)?\s*(pessoas?|adultos?|criancas?|anos?|noites?|dias?|semanas?|mil|reais|executiva|economica|primeira|classe|segunda|terca|quarta|quinta|sexta|sabado|domingo|hoje|amanha|ontem|dezembro|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|direto|direta)\b/;

  // termos que terminam o nome de um lugar na extração
  const PLACE_TERMINATOR = '(?:em|no dia|dia|de|a partir|voltando|ida|volta|por|para|pra|com|no mes|durante|semana|semanas|noite|noites|mes|meses|que vem|proxim[ao]|hoje|amanha|ontem|depois de|daqui|so ida|somente|apenas)';

  // ---------- normalize ----------
  function normalize(text) {
    if (text == null) return '';
    let value = String(text).slice(0, 1000);
    try {
      value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (_err) {
      /* segue sem decompor */
    }
    value = value.toLowerCase();
    value = value
      .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
      .replace(/[\u201c\u201d\u2033]/g, '"')
      .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, '-');
    value = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\ufeff]/g, ' ');
    value = value.replace(/\s+/g, ' ').trim();
    return value.slice(0, 1000);
  }

  // ---------- helpers de data ----------
  function pad2(n) {
    return String(n).padStart(2, '0');
  }
  function isoFromParts(y, m, d) {
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }
  function isValidYmd(y, m, d) {
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
    if (m < 1 || m > 12) return false;
    if (d < 1) return false;
    return d <= daysInMonth(y, m);
  }
  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
  function ymdOf(date) {
    return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
  }
  function addDays(date, n) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    copy.setDate(copy.getDate() + n);
    return copy;
  }
  function compareYmd(a, b) {
    if (a.y !== b.y) return a.y - b.y;
    if (a.m !== b.m) return a.m - b.m;
    return a.d - b.d;
  }

  // ---------- parse de dinheiro ----------
  function parseMoney(raw) {
    if (!raw) return null;
    let s = String(raw).trim().toLowerCase();
    const milMatch = s.match(/^r?\$?\s*(\d+(?:[.,]\d+)?)\s*mil$/);
    if (milMatch) {
      const num = parseFloat(milMatch[1].replace(',', '.'));
      if (!Number.isFinite(num)) return null;
      return Math.round(num * 1000 * 100);
    }
    s = s.replace(/r\$\s*/g, '').replace(/\s*reais?\b/g, '').trim();
    if (!/[0-9]/.test(s)) return null;
    s = s.replace(/\s/g, '');
    let normalized;
    if (s.includes('.') && s.includes(',')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        normalized = s.replace(/\./g, '').replace(',', '.');
      } else {
        normalized = s.replace(/,/g, '');
      }
    } else if (s.includes(',')) {
      const parts = s.split(',');
      if (parts[parts.length - 1].length === 2) {
        normalized = s.replace(',', '.');
      } else {
        normalized = s.replace(/,/g, '');
      }
    } else if (s.includes('.')) {
      const parts = s.split('.');
      if (parts[parts.length - 1].length === 2 && parts.length === 2) {
        normalized = s;
      } else {
        normalized = s.replace(/\./g, '');
      }
    } else {
      normalized = s;
    }
    const num = parseFloat(normalized);
    if (!Number.isFinite(num) || num < 0) return null;
    return Math.round(num * 100);
  }

  // ---------- categoria por palavra-chave ----------
  const CATEGORY_RULES = [
    ['alimentacao', /\b(mercado|supermercado|restaurante|almoc|janta|ifood|lanche|padaria|comida|feira)\w*/],
    ['transporte', /\b(uber|99|taxi|gasolina|onibus|metro|pedagio|combustivel|estacionamento)\w*/],
    ['moradia', /\b(aluguel|condominio|internet|energia|iptu)\w*|\b(luz|agua|gas)\b/],
    ['lazer', /\b(cinema|show|bar|festa|balada|streaming|netflix|jogo)\w*/],
    ['saude', /\b(farmacia|remedio|medico|consulta|dentista|exame|hospital)\w*/],
    ['viagem', /\b(hotel|passagem|airbnb|hospedagem|voo|pousada|resort|pacote)\w*/],
    ['educacao', /\b(curso|faculdade|livro|escola|mensalidade|aula)\w*/],
    ['vestuario', /\b(roupa|sapato|tenis|calca|camisa|vestido|loja)\w*/],
    ['salario', /\b(salario|holerite|ordenado)\w*/],
    ['investimento', /\b(investimento|tesouro|acoes|cdb|cripto|fundo|dividendo)\w*/],
  ];
  function inferCategory(normalized) {
    for (const [cat, rx] of CATEGORY_RULES) {
      if (rx.test(normalized)) return cat;
    }
    return 'outros';
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  // ---------- passageiros ----------
  function parsePassengers(normalized) {
    const out = {};
    const childAges = [];
    const childBlock = normalized.match(/\b(?:crianc\w*|filh\w*|bebe\w*)[^.]*?\bde\s+([\d\s,e]+?)\s*anos?/g);
    if (childBlock) {
      childBlock.forEach((block) => {
        const agesPart = block.match(/\bde\s+([\d\s,e]+?)\s*anos?/);
        if (agesPart) {
          const nums = agesPart[1].match(/\d+/g) || [];
          nums.forEach((n) => {
            const age = parseInt(n, 10);
            if (age >= 0 && age <= 17) childAges.push(age);
          });
        }
      });
    }
    const childCount = normalized.match(/\b(\d+)\s+crianc\w*/);
    if (childCount && childAges.length === 0) {
      const n = parseInt(childCount[1], 10);
      for (let i = 0; i < n && i < 9; i += 1) childAges.push(0);
    }
    if (childAges.length) out.childrenAges = childAges.slice(0, 9);

    const adultsMatch = normalized.match(/\b(\d+)\s+adult/);
    if (adultsMatch) {
      out.adults = clamp(parseInt(adultsMatch[1], 10), 1, 9);
      return out;
    }
    const peopleMatch = normalized.match(/\b(?:para|pra|somos)\s+(\d+)\s+pessoas?/) || normalized.match(/\b(\d+)\s+pessoas?/);
    if (peopleMatch) {
      const total = clamp(parseInt(peopleMatch[1], 10), 1, 9);
      out.adults = Math.max(1, total - childAges.length);
      return out;
    }
    if (/\bsozinh[oa]\b/.test(normalized)) {
      out.adults = 1;
      return out;
    }
    if (/\beu\s+e\s+(minha|meu)\s+(esposa|marido|namorad|parceir|companheir|esposo)/.test(normalized)) {
      out.adults = 2;
      return out;
    }
    if (/\b(minha esposa|meu marido|minha namorada|meu namorado|meu esposo)\b/.test(normalized)) {
      out.adults = 2;
      return out;
    }
    if (childAges.length) out.adults = 2;
    return out;
  }

  // ---------- datas ----------
  function parseDates(normalized, today) {
    const result = {};
    if (/\b(so|somente|apenas)\s+ida\b/.test(normalized)) result.oneWay = true;

    const weekMatch = /\buma semana\b/.test(normalized);
    const nightsMatch = normalized.match(/\b(\d+)\s+noites?\b/);
    const porDiasMatch = normalized.match(/\bpor\s+(\d+)\s+dias?\b/);
    if (nightsMatch) result.nights = clamp(parseInt(nightsMatch[1], 10), 1, 30);
    else if (porDiasMatch) result.nights = clamp(parseInt(porDiasMatch[1], 10), 1, 30);
    else if (weekMatch) result.nights = 7;

    const monthOnly = detectMonthOnly(normalized, today);

    // 1) intervalo explícito
    const range = detectRange(normalized, today);
    if (range) {
      if (range.invalidDepart) result.invalidDepart = true;
      if (range.invalidReturn) result.invalidReturn = true;
      if (range.depart) result.depart = range.depart;
      if (range.ret) result.ret = range.ret;
      return finalizeDateResult(result, monthOnly);
    }

    // 2) ida/volta
    const idaVolta = detectIdaVolta(normalized, today);
    if (idaVolta.depart) result.depart = idaVolta.depart;
    if (idaVolta.ret) result.ret = idaVolta.ret;
    if (idaVolta.invalidDepart) result.invalidDepart = true;
    if (idaVolta.invalidReturn) result.invalidReturn = true;

    // 3) "volta/voltando dia 20" isolado — consome o trecho antes do single date
    let working = normalized;
    let voltaMatch = null;
    if (!result.ret) {
      voltaMatch = normalized.match(/\b(?:volta|retorno|voltando)\s+(?:dia\s+)?(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?/);
      if (voltaMatch) working = normalized.replace(voltaMatch[0], ' ');
    }

    // 4) data única de partida (texto sem o trecho de volta)
    if (!result.depart) {
      const single = detectSingleDate(working, today);
      if (single === 'invalid') result.invalidDepart = true;
      else if (single) result.depart = single;
    }

    // 5) resolve a volta herdando o mês/ano da partida quando não houver mês explícito
    if (voltaMatch && !result.ret) {
      const departMonth = result.depart ? result.depart.m : today.m;
      const parsed = buildDate(voltaMatch, today, departMonth);
      if (parsed === 'invalid') result.invalidReturn = true;
      else if (parsed) result.ret = parsed;
    }

    return finalizeDateResult(result, monthOnly);
  }

  function finalizeDateResult(result, monthOnly) {
    if (!result.depart && monthOnly) result.monthOnly = monthOnly;
    if (result.depart && result.ret) {
      if (compareYmd(result.ret, result.depart) <= 0) {
        const rolled = { y: result.ret.y + 1, m: result.ret.m, d: result.ret.d };
        if (compareYmd(rolled, result.depart) > 0) {
          result.ret = rolled;
        } else {
          result.invalidReturn = true;
          delete result.ret;
        }
      }
    }
    return result;
  }

  function detectMonthOnly(normalized, today) {
    const rx = /\b(?:em|para|pra|no mes de|mes de|durante)\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/;
    const m = normalized.match(rx);
    if (!m) return null;
    if (/\bdia\s+\d{1,2}\b/.test(normalized)) return null;
    if (/\d{1,2}\s*(?:\/|de)\s*(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/.test(normalized)) return null;
    const month = MONTHS[m[1]];
    let year = today.y;
    if (month < today.m) year += 1;
    return `${year}-${pad2(month)}`;
  }

  function buildDate(match, today, defaultMonth) {
    const d = parseInt(match[1], 10);
    let m = match[2] ? parseInt(match[2], 10) : (defaultMonth || null);
    let y = match[3] ? parseInt(match[3], 10) : null;
    if (y != null && y < 100) y += 2000;
    if (m == null) m = today.m;
    if (y == null) {
      y = today.y;
      const candidate = { y, m, d };
      if (compareYmd(candidate, today) < 0) y += 1;
    }
    if (!isValidYmd(y, m, d)) return 'invalid';
    const ymd = { y, m, d };
    if (match[3] && compareYmd(ymd, today) < 0) return 'invalid';
    return ymd;
  }

  function monthFromName(normalized, fromIndex) {
    const rest = normalized.slice(fromIndex);
    const m = rest.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/);
    return m ? MONTHS[m[1]] : null;
  }

  function detectRange(normalized, today) {
    const rx = /\b(?:de|do dia|do)\s+(\d{1,2})\s+(?:a|ao|ate|até)\s+(?:o dia\s+)?(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?(?:\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro))?/;
    const m = normalized.match(rx);
    if (!m) return null;
    const d1 = parseInt(m[1], 10);
    const d2 = parseInt(m[2], 10);
    let month = m[3] ? parseInt(m[3], 10) : null;
    let year = m[4] ? parseInt(m[4], 10) : null;
    if (m[5]) month = MONTHS[m[5]];
    if (year != null && year < 100) year += 2000;
    if (month == null) month = today.m;
    const out = {};
    const dep = buildDate([null, String(d1), String(month), year != null ? String(year) : undefined], today);
    const ret = buildDate([null, String(d2), String(month), year != null ? String(year) : undefined], today);
    if (dep === 'invalid') out.invalidDepart = true;
    else if (dep) out.depart = dep;
    if (ret === 'invalid') out.invalidReturn = true;
    else if (ret) out.ret = ret;
    return out;
  }

  function detectIdaVolta(normalized, today) {
    const out = {};
    const ida = normalized.match(/\bida\s+(?:dia\s+)?(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?/);
    const volta = normalized.match(/\bvolta\s+(?:dia\s+)?(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?/);
    if (ida && volta) {
      const dep = buildDate(ida, today);
      if (dep === 'invalid') out.invalidDepart = true;
      else if (dep) out.depart = dep;
      const departMonth = out.depart ? out.depart.m : today.m;
      const ret = buildDate(volta, today, departMonth);
      if (ret === 'invalid') out.invalidReturn = true;
      else if (ret) out.ret = ret;
    }
    return out;
  }

  function detectSingleDate(normalized, today) {
    if (/\bdepois de amanha\b/.test(normalized)) return ymdOf(addDays(today.date, 2));
    if (/\bhoje\b/.test(normalized)) return ymdOf(today.date);
    if (/\bamanha\b/.test(normalized)) return ymdOf(addDays(today.date, 1));
    if (/\bontem\b/.test(normalized)) return ymdOf(addDays(today.date, -1));

    const weeksRel = normalized.match(/\b(?:daqui a|em)\s+(\d+)\s+semanas?\b/);
    if (weeksRel) return ymdOf(addDays(today.date, parseInt(weeksRel[1], 10) * 7));
    const daysRel = normalized.match(/\b(?:daqui a|em)\s+(\d+)\s+dias?\b/);
    if (daysRel) return ymdOf(addDays(today.date, parseInt(daysRel[1], 10)));

    if (/\bfim de semana que vem\b/.test(normalized) || /\bproximo fim de semana\b/.test(normalized)) {
      return ymdOf(nextWeekday(today.date, 6));
    }
    const wdNext = normalized.match(/\b(?:proxim[ao]\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?\s+que vem\b/);
    const wdProx = normalized.match(/\bproxim[ao]\s+(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?\b/);
    if (wdNext || wdProx) {
      const name = (wdNext || wdProx)[1];
      return ymdOf(nextWeekday(today.date, WEEKDAYS[name]));
    }
    if (/\bsemana que vem\b/.test(normalized) || /\bproxima semana\b/.test(normalized)) {
      return ymdOf(nextWeekday(today.date, 1));
    }
    const wdSimple = normalized.match(/\b(?:na\s+|a partir de\s+|partir de\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?\b/);
    if (wdSimple) {
      return ymdOf(nextWeekday(today.date, WEEKDAYS[wdSimple[1]]));
    }

    const diaMatch = normalized.match(/\bdia\s+(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?\b/);
    if (diaMatch) {
      const monthByName = diaMatch[2] ? null : monthFromName(normalized, normalized.indexOf(diaMatch[0]));
      return buildDate(diaMatch, today, monthByName || undefined);
    }
    const dmName = normalized.match(/\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/);
    if (dmName) {
      return buildDate([null, dmName[1], String(MONTHS[dmName[2]]), dmName[3]], today);
    }
    const slash = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (slash) return buildDate(slash, today);
    return null;
  }

  function nextWeekday(fromDate, targetDow) {
    const base = startOfDay(fromDate);
    const curDow = base.getDay();
    let delta = (targetDow - curDow + 7) % 7;
    if (delta === 0) delta = 7;
    return addDays(base, delta);
  }

  // ---------- lugares ----------
  function extractPlaces(normalized, places) {
    const out = {};
    if (!places) return out;
    const origMatch = normalized.match(new RegExp(`\\b(?:saindo de|partindo de|de)\\s+([a-z][a-z ]*?)(?:\\s+(?:para|pra|ate|até|rumo a|com destino)\\b|$)`));
    const destMatch = normalized.match(new RegExp(`\\b(?:para|pra|ate|até|rumo a|com destino a|destino)\\s+([a-z][a-z ]*?)(?:\\s+${PLACE_TERMINATOR}\\b|\\s+[0-9]|[?.!,]|$)`));
    const emMatch = normalized.match(new RegExp(`\\b(?:em|no|na)\\s+([a-z][a-z ]*?)(?:\\s+${PLACE_TERMINATOR}\\b|\\s+[0-9]|[?.!,]|$)`));

    if (origMatch && !STOP_PLACE.test(origMatch[1])) {
      const ref = resolvePlaceText(origMatch[1], places);
      if (ref && (ref.id || ref.ambiguous)) out.origin = ref;
    }
    let destText = null;
    if (destMatch) destText = destMatch[1];
    else if (emMatch) destText = emMatch[1];
    if (destText && !STOP_PLACE.test(destText)) {
      const ref = resolvePlaceText(destText, places);
      if (ref) out.destination = ref;
    }
    return out;
  }

  function resolvePlaceText(text, places) {
    if (!text) return null;
    const cleaned = text.replace(/\b(o|a|os|as|um|uma|minha|meu|cidade de)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned || STOP_PLACE.test(cleaned)) return { raw: cleaned, unresolved: true };
    const tries = [cleaned];
    const words = cleaned.split(' ');
    if (words.length > 3) tries.push(words.slice(0, 3).join(' '));
    if (words.length > 2) tries.push(words.slice(0, 2).join(' '));
    if (words.length > 1) tries.push(words[0]);
    for (const candidate of tries) {
      if (!candidate || STOP_PLACE.test(candidate)) continue;
      const res = places.resolve(candidate);
      if (res.status === 'match') return places.toRef(res.place);
      if (res.status === 'ambiguous') {
        return { ambiguous: true, candidates: res.candidates.map((c) => places.toRef(c)), raw: candidate };
      }
    }
    return { raw: cleaned, unresolved: true };
  }

  // ---------- intent ----------
  function detectIntent(normalized) {
    const has = (rx) => rx.test(normalized);

    if (/^(oi|ola|opa|e ai|bom dia|boa tarde|boa noite)\b/.test(normalized) || has(/\bajuda\b/) || has(/\bo que voce faz\b/) || has(/\bcomo funciona\b/)) {
      return { intent: 'help', kw: true };
    }
    if (has(/\bdesfazer\b/) || has(/\bdesfaz o ultimo\b/)) {
      return { intent: 'undo', kw: true };
    }

    // acerto de contas
    if (has(/\bquem deve|quanto cada um|dividir a conta|acertar as contas|quem paga quem|quem deve pra quem|quem deve para quem\b/)) {
      return { intent: 'finance.settle', kw: true };
    }
    // resumo financeiro (antes do verbo genérico de gasto)
    if (has(/\bquanto (gastei|gastamos|recebi|sobrou|tenho)\b/) || has(/\bresumo (financeiro|do mes|de gastos)|gastos do mes|total de gastos\b/)) {
      return { intent: 'finance.summary', kw: true };
    }
    // lançamento financeiro: verbo explícito tem prioridade sobre hotel/voo
    if (/\b(gastei|paguei|comprei|recebi|ganhei|pagou|gastou)\b/.test(normalized)) {
      return { intent: 'finance.add', kw: true };
    }

    // lançamento financeiro implícito: valor em dinheiro sem intenção de viagem
    const moneyLike = /r\$\s*[\d.,]+|\b[\d.,]+\s*(?:reais|mil)\b/.test(normalized);
    const travelish = has(/\b(hotel|hospedagem|airbnb|pousada|resort|voo|voos|passage(?:m|ns)|viagem|links?|ir para|ir pra|quero ir)\b/);
    const nonFinance = has(/\b(meta|limite de|orcamento|votacao|enquete)\b/);
    if (moneyLike && !travelish && !nonFinance) {
      return { intent: 'finance.add', kw: true };
    }

    // viagens
    const hasTravelVerb = has(/\b(quero ir|ir para|ir pra|viajar|viagem para|viagem pra)\b/);
    if (has(/\b(hotel|hospedagem|airbnb|pousada|resort|hospedar)\b/)) {
      return { intent: 'travel.stays', kw: true };
    }
    if (has(/\blinks?\b/) && has(/\b(para|pra|de)\b/)) {
      return { intent: 'travel.links', kw: true };
    }
    if (has(/\b(passage(?:m|ns)|voos?|voo)\b/) && !has(/\bplanejar\b/)) {
      return { intent: 'travel.flights', kw: true };
    }
    if (has(/\b(planejar viagem|criar viagem|nova viagem|planejar uma viagem)\b/)) {
      return { intent: 'trip.create', kw: true };
    }
    if (has(/\b(minhas viagens|listar viagens|ver viagens)\b/)) {
      return { intent: 'trip.list', kw: true };
    }
    if (has(/\b(como esta a viagem|resumo da viagem|status da viagem)\b/)) {
      return { intent: 'trip.summary', kw: true };
    }
    if (hasTravelVerb) {
      return { intent: 'travel.search', kw: true };
    }

    // orçamento
    if (has(/\b(limite de|orcamento de|limite para)\b/)) {
      return { intent: 'budget.set', kw: true };
    }

    // metas
    if (has(/\bmeta de\b/) || has(/\b(criar meta|nova meta)\b/)) {
      return { intent: 'goal.create', kw: true };
    }
    if ((has(/\b(guardei|guardar|aportar|aporte)\b/)) && has(/\bmeta\b/)) {
      return { intent: 'goal.fund', kw: true };
    }
    if (has(/\b(minhas metas|como estao minhas metas|progresso das metas|ver metas)\b/)) {
      return { intent: 'goal.progress', kw: true };
    }

    // checklist
    if (has(/\bchecklist\b/) || has(/\blista de tarefas\b/)) {
      if (has(/\b(o que falta|listar|ver)\b/)) return { intent: 'checklist.list', kw: true };
      if (has(/\b(marcar|feito|concluir|concluido)\b/)) return { intent: 'checklist.done', kw: true };
      if (has(/\b(adicionar|incluir|add)\b/)) return { intent: 'checklist.add', kw: true };
      return { intent: 'checklist.list', kw: true };
    }
    if (has(/\bmarcar\b/) && has(/\bcomo feito\b/)) return { intent: 'checklist.done', kw: true };

    // decisões
    if (has(/\b(voto|votar)\s+(?:em|n[oa])\b/)) {
      return { intent: 'decision.vote', kw: true };
    }
    if (has(/\b(criar votacao|criar enquete|nova votacao|nova enquete|votacao|enquete)\b/)) {
      return { intent: 'decision.create', kw: true };
    }
    if (has(/\b(decisoes|listar votacoes|ver votacoes)\b/)) {
      return { intent: 'decision.list', kw: true };
    }

    // participantes
    if (has(/\b(adicionar participante|incluir participante|novo participante)\b/)) {
      return { intent: 'participant.add', kw: true };
    }

    // relatório mensal
    if (has(/\b(relatorio de|resumo de)\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/)) {
      return { intent: 'report.month', kw: true };
    }

    return { intent: 'unknown', kw: false };
  }

  // ---------- slots finanças ----------
  function extractFinanceSlots(normalized, original, slots) {
    const amount = extractAmount(normalized);
    if (amount != null) slots.amountMinor = amount;

    const income = /\b(recebi|ganhei|salario)\b/.test(normalized);
    slots.financeType = income ? 'income' : 'expense';
    slots.category = inferCategory(normalized);

    let desc = extractDescription(normalized, original);
    if (!desc && income) {
      // "recebi 5000 de salário" => descrição "salário"
      const sal = normalized.match(/\bde\s+(salario|freela|freelance|aluguel|dividendos?|bonus|premio)\b/);
      if (sal) desc = findOriginalWord(original, sal[1]);
    }
    if (desc) slots.description = desc;

    if (/\b(paguei|gastei|comprei)\b/.test(normalized)) slots.payer = 'me';
    const payerMatch = normalized.match(/\b(?:a|o)\s+([a-z]+)\s+(?:pagou|gastou)\b/);
    if (payerMatch) slots.payer = capitalizeFromOriginal(original, payerMatch[1]);

    if (/\bdividid[oa] com todos|entre todos|com todos\b/.test(normalized)) slots.splitWith = 'all';
    else {
      const splitMatch = normalized.match(/\bdividid[oa] com\s+([a-z, e]+)/);
      if (splitMatch) {
        const names = splitMatch[1].split(/,|\se\s/).map((s) => s.trim()).filter(Boolean);
        if (names.length) slots.splitWith = names.map((n) => capitalizeFromOriginal(original, n));
      }
    }

    if (/\bhoje\b/.test(normalized)) slots.date = 'hoje';
    else if (/\bontem\b/.test(normalized)) slots.date = 'ontem';
    else {
      const dayMatch = normalized.match(/\bdia\s+(\d{1,2})\b/);
      if (dayMatch) slots.date = `dia ${dayMatch[1]}`;
    }
  }

  function extractAmount(normalized) {
    const candidates = [];
    const rx = /r\$\s*([\d.]+(?:,\d{1,2})?)|([\d.]+(?:,\d{1,2})?)\s*reais\b|(\d+(?:[.,]\d+)?)\s*mil\b|\b(\d{1,3}(?:\.\d{3})+(?:,\d{2})?)\b|\b(\d+,\d{2})\b|\b(\d+)\b/g;
    let m;
    while ((m = rx.exec(normalized)) !== null) {
      const val = parseMoney(m[0]);
      if (val != null) candidates.push(val);
    }
    return candidates.length ? candidates[0] : null;
  }

  function extractDescription(normalized, original) {
    const m = normalized.match(/\b(?:no|na|com|de|do|da|em)\s+([a-z]+)\b/);
    if (m) {
      const generic = new Set(['dia', 'mes', 'reais', 'conta', 'total', 'todos', 'viagem', 'salario']);
      if (!generic.has(m[1])) return findOriginalWord(original, m[1]);
    }
    return null;
  }

  function findOriginalWord(original, normalizedWord) {
    const words = String(original).split(/\s+/);
    for (const w of words) {
      if (normalize(w) === normalizedWord) return w.replace(/[.,!?]+$/, '');
    }
    return normalizedWord;
  }
  function capitalizeFromOriginal(original, normalizedWord) {
    const w = findOriginalWord(original, normalizedWord);
    if (w === normalizedWord) return normalizedWord.charAt(0).toUpperCase() + normalizedWord.slice(1);
    return w;
  }

  function extractCabin(normalized) {
    if (/\bprimeira classe|first\b/.test(normalized)) return 'first';
    if (/\bexecutiv[ao]|business|classe executiva\b/.test(normalized)) return 'business';
    if (/\bpremium\b/.test(normalized)) return 'premium_economy';
    if (/\beconomica|economy\b/.test(normalized)) return 'economy';
    return null;
  }

  function extractTravelExtras(normalized, slots) {
    if (/\bdiret[oa]s?\b/.test(normalized) || /\bsem escala|sem conexao\b/.test(normalized)) slots.directOnly = true;
    const cabin = extractCabin(normalized);
    if (cabin) slots.cabin = cabin;
    Object.assign(slots, parsePassengers(normalized));
    const maxMatch = normalized.match(/\b(?:ate|até|no maximo|maximo de|limite de)\s+(r\$\s*[\d.,]+|\d+(?:[.,]\d+)?\s*mil|[\d.,]+)/);
    if (maxMatch) {
      const val = parseMoney(maxMatch[1]);
      if (val != null) slots.maxPriceMinor = val;
    }
  }

  // ---------- required slots ----------
  function requiredSlots(intent) {
    switch (intent) {
      case 'travel.search':
      case 'travel.flights':
        return ['destination', 'origin', 'departDate', 'returnDate'];
      case 'travel.stays':
        return ['destination', 'departDate', 'returnDate'];
      case 'travel.links':
        return ['destination'];
      case 'trip.create':
        return ['destination'];
      case 'trip.summary':
        return ['tripRef'];
      case 'finance.add':
        return ['amountMinor', 'description'];
      case 'budget.set':
        return ['category', 'amountMinor'];
      case 'goal.create':
        return ['title', 'targetMinor'];
      case 'goal.fund':
        return ['goalRef', 'amountMinor'];
      case 'checklist.add':
        return ['title'];
      case 'checklist.done':
        return ['itemRef'];
      case 'decision.create':
        return ['title', 'options'];
      case 'decision.vote':
        return ['optionRef'];
      case 'participant.add':
        return ['participantName'];
      default:
        return [];
    }
  }

  function computeMissing(intent, slots) {
    const required = requiredSlots(intent);
    const missing = [];
    for (const name of required) {
      if (name === 'returnDate') {
        if (slots.oneWay || slots.nights != null) continue;
        if (slots.returnDate == null) missing.push('returnDate');
        continue;
      }
      if (name === 'departDate') {
        if (slots.departDate == null) missing.push('departDate');
        continue;
      }
      const value = slots[name];
      if ((name === 'destination' || name === 'origin') && value && value.unresolved) {
        missing.push(name);
        continue;
      }
      const present = value != null
        && !(Array.isArray(value) && value.length === 0)
        && !(typeof value === 'string' && value === '');
      if (!present) missing.push(name);
    }
    return missing;
  }

  // ---------- parse principal ----------
  function parse(text, context, clock) {
    const ctx = context || {};
    const nowFn = (clock && typeof clock.now === 'function') ? clock.now : () => Date.now();
    const original = text == null ? '' : String(text).slice(0, 1000);
    try {
      const normalized = normalize(text);
      const nowDate = new Date(nowFn());
      const today = { date: startOfDay(nowDate), y: nowDate.getFullYear(), m: nowDate.getMonth() + 1, d: nowDate.getDate() };
      const places = getPlaces();

      const detected = detectIntent(normalized);
      let intent = detected.intent;
      let followUp = false;

      const isTravelContext = ctx.lastIntent && TRAVEL_INTENTS.has(ctx.lastIntent);
      const slots = {};
      const placeSlots = extractPlaces(normalized, places);

      const effectiveTravel = TRAVEL_INTENTS.has(intent) || (isTravelContext && intent === 'unknown');

      if (effectiveTravel) {
        const dates = parseDates(normalized, today);
        applyPlaceSlots(slots, placeSlots);
        applyTravelDates(slots, dates);
        extractTravelExtras(normalized, slots);
        if (dates.monthOnly) slots.monthOnly = dates.monthOnly;
      } else if (intent === 'trip.create') {
        const dates = parseDates(normalized, today);
        applyPlaceSlots(slots, placeSlots);
        if (dates.monthOnly) slots.monthOnly = dates.monthOnly;
        if (dates.depart) slots.departDate = isoFromParts(dates.depart.y, dates.depart.m, dates.depart.d);
      } else if (intent === 'trip.summary' || intent === 'trip.list') {
        if (placeSlots.destination && !placeSlots.destination.unresolved && !placeSlots.destination.ambiguous) {
          slots.tripRef = placeSlots.destination;
        }
      } else if (intent === 'finance.add') {
        extractFinanceSlots(normalized, original, slots);
      } else if (intent === 'finance.summary' || intent === 'report.month') {
        const month = detectMonthRef(normalized, today);
        if (month) slots.month = month;
      } else if (intent === 'budget.set') {
        const cat = detectBudgetCategory(normalized);
        if (cat) slots.category = cat;
        const amount = extractAmount(normalized);
        if (amount != null) slots.amountMinor = amount;
      } else if (intent === 'goal.create') {
        const title = extractGoalTitle(normalized, original);
        if (title) slots.title = title;
        const target = extractAmount(normalized);
        if (target != null) slots.targetMinor = target;
        const deadline = detectMonthRef(normalized, today);
        if (deadline) slots.deadline = deadline;
      } else if (intent === 'goal.fund') {
        const amount = extractAmount(normalized);
        if (amount != null) slots.amountMinor = amount;
        const gref = extractGoalRef(normalized, original);
        if (gref) slots.goalRef = gref;
      } else if (intent === 'checklist.add' || intent === 'checklist.done') {
        const title = extractChecklistTitle(normalized, original);
        if (title) {
          if (intent === 'checklist.add') slots.title = title;
          else slots.itemRef = title;
        }
      } else if (intent === 'decision.create') {
        const parts = extractDecision(normalized, original);
        if (parts.title) slots.title = parts.title;
        if (parts.options && parts.options.length >= 2) slots.options = parts.options;
      } else if (intent === 'decision.vote') {
        const opt = extractVoteOption(normalized, original);
        if (opt) slots.optionRef = opt;
      } else if (intent === 'participant.add') {
        const name = extractParticipant(normalized, original);
        if (name) slots.participantName = name;
      }

      if (isTravelContext && intent === 'unknown' && hasAnySlot(slots)) {
        followUp = true;
        intent = ctx.lastIntent;
        const merged = Object.assign({}, ctx.slots || {}, slots);
        return finalize(original, normalized, intent, merged, followUp, true, extractAmbiguity(placeSlots));
      }

      return finalize(original, normalized, intent, slots, followUp, detected.kw, extractAmbiguity(placeSlots));
    } catch (_err) {
      return {
        text: original,
        normalized: safeNormalize(original),
        intent: 'unknown',
        confidence: 0,
        followUp: false,
        missing: [],
        slots: {},
      };
    }
  }

  function safeNormalize(t) {
    try {
      return normalize(t);
    } catch (_err) {
      return '';
    }
  }

  function hasAnySlot(slots) {
    return Object.keys(slots).length > 0;
  }

  function applyPlaceSlots(slots, placeSlots) {
    if (placeSlots.origin) {
      slots.origin = placeSlots.origin.ambiguous
        ? { raw: placeSlots.origin.raw, unresolved: true }
        : placeSlots.origin;
    }
    if (placeSlots.destination) {
      slots.destination = placeSlots.destination.ambiguous
        ? { raw: placeSlots.destination.raw, unresolved: true }
        : placeSlots.destination;
    }
  }

  function applyTravelDates(slots, dates) {
    if (dates.depart) slots.departDate = isoFromParts(dates.depart.y, dates.depart.m, dates.depart.d);
    if (dates.ret) slots.returnDate = isoFromParts(dates.ret.y, dates.ret.m, dates.ret.d);
    if (dates.nights != null) slots.nights = dates.nights;
    if (dates.oneWay) slots.oneWay = true;
  }

  function extractAmbiguity(placeSlots) {
    if (placeSlots.destination && placeSlots.destination.ambiguous) {
      return { slot: 'destination', candidates: placeSlots.destination.candidates };
    }
    if (placeSlots.origin && placeSlots.origin.ambiguous) {
      return { slot: 'origin', candidates: placeSlots.origin.candidates };
    }
    return null;
  }

  function detectMonthRef(normalized, today) {
    if (/\beste mes|esse mes|do mes\b/.test(normalized)) return `${today.y}-${pad2(today.m)}`;
    if (/\bmes passado\b/.test(normalized)) {
      const m = today.m === 1 ? 12 : today.m - 1;
      const y = today.m === 1 ? today.y - 1 : today.y;
      return `${y}-${pad2(m)}`;
    }
    const nameMatch = normalized.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/);
    if (nameMatch) {
      const month = MONTHS[nameMatch[1]];
      const year = nameMatch[2] ? parseInt(nameMatch[2], 10) : today.y;
      return `${year}-${pad2(month)}`;
    }
    return null;
  }

  function detectBudgetCategory(normalized) {
    const map = {
      alimentacao: /\baliment|comida|mercado\b/,
      transporte: /\btransporte|uber|combustivel\b/,
      moradia: /\bmoradia|casa|aluguel\b/,
      lazer: /\blazer|diversao\b/,
      saude: /\bsaude\b/,
      viagem: /\bviagem|viagens\b/,
      educacao: /\beducacao|estudo\b/,
      vestuario: /\bvestuario|roupas?\b/,
    };
    for (const cat of Object.keys(map)) {
      if (map[cat].test(normalized)) return cat;
    }
    return null;
  }

  function extractGoalTitle(normalized, original) {
    const m = normalized.match(/\bmeta de\b.*?\b(?:para|pra|chamada)\s+([a-z0-9 ]+?)(?:\s+(?:ate|até|em|no|de)\b|[?.!,]|$)/);
    if (m) return titleFromOriginal(original, m[1].trim());
    const m2 = normalized.match(/\bmeta\s+([a-z0-9 ]+?)(?:\s+(?:de|ate|até|em)\b|[?.!,]|$)/);
    if (m2) return titleFromOriginal(original, m2[1].trim());
    return null;
  }

  function extractGoalRef(normalized, original) {
    const m = normalized.match(/\bmeta\s+([a-z0-9 ]+?)(?:[?.!,]|$)/);
    if (m) return titleFromOriginal(original, m[1].trim());
    return null;
  }

  function extractChecklistTitle(normalized, original) {
    let m = normalized.match(/\b(?:adicionar|incluir|add)\s+([a-z0-9 ]+?)\s+(?:ao|no|na|a)\s+(?:checklist|lista)/);
    if (m) return titleFromOriginal(original, m[1].trim());
    m = normalized.match(/\bmarcar\s+([a-z0-9 ]+?)\s+como\s+(?:feito|concluido)/);
    if (m) return titleFromOriginal(original, m[1].trim());
    m = normalized.match(/\b(?:adicionar|incluir)\s+([a-z0-9 ]+?)(?:[?.!,]|$)/);
    if (m) return titleFromOriginal(original, m[1].trim());
    return null;
  }

  function extractDecision(normalized, original) {
    const out = {};
    const afterColon = normalized.match(/\b(?:votacao|enquete|decisao)\s*:?\s*(.+)$/);
    const content = afterColon ? afterColon[1] : null;
    if (content) {
      const options = content.split(/\s+ou\s+|\s*,\s*|\s+vs\.?\s+/).map((s) => s.trim()).filter(Boolean);
      if (options.length >= 2) {
        out.options = options.map((o) => titleFromOriginal(original, o));
        out.title = out.options.join(' ou ');
      } else if (options.length === 1) {
        out.title = titleFromOriginal(original, options[0]);
      }
    }
    return out;
  }

  function extractVoteOption(normalized, original) {
    const m = normalized.match(/\bvoto\s+(?:em|n[oa])\s+([a-z0-9 ]+?)(?:[?.!,]|$)/)
      || normalized.match(/\bvotar\s+(?:em|n[oa])\s+([a-z0-9 ]+?)(?:[?.!,]|$)/);
    if (m) return titleFromOriginal(original, m[1].trim());
    return null;
  }

  function extractParticipant(normalized, original) {
    const m = normalized.match(/\b(?:adicionar|incluir|novo)\s+participante\s+([a-z]+)/);
    if (m) return capitalizeFromOriginal(original, m[1]);
    return null;
  }

  function titleFromOriginal(original, normalizedPhrase) {
    const words = normalizedPhrase.split(' ').filter(Boolean);
    if (!words.length) return normalizedPhrase;
    const origWords = String(original).split(/\s+/);
    const normOrig = origWords.map((w) => normalize(w));
    for (let i = 0; i + words.length <= normOrig.length; i += 1) {
      let ok = true;
      for (let j = 0; j < words.length; j += 1) {
        if (normOrig[i + j].replace(/[.,!?:]+$/, '') !== words[j]) { ok = false; break; }
      }
      if (ok) return origWords.slice(i, i + words.length).join(' ').replace(/[.,!?:]+$/, '');
    }
    return normalizedPhrase;
  }

  // ---------- confiança ----------
  function computeConfidence(intent, kw, missing, followUp) {
    if (intent === 'unknown') return 0;
    if (followUp) return 0.78;
    if (intent === 'help' || intent === 'undo') return 0.85;
    const required = requiredSlots(intent);
    if (kw && required.length > 0 && missing.length === 0) return 0.88;
    if (kw && required.length === 0) return 0.82;
    if (kw && missing.length > 0 && missing.length < required.length) return 0.7;
    if (kw) return 0.6;
    return 0.3;
  }

  function finalize(original, normalized, intent, slots, followUp, kw, ambiguity) {
    if (!INTENT_SET.has(intent)) intent = 'unknown';
    const missing = intent === 'unknown' ? [] : computeMissing(intent, slots);
    const confidence = computeConfidence(intent, kw, missing, followUp);
    const out = {
      text: original,
      normalized,
      intent,
      confidence: clamp01(confidence),
      followUp: Boolean(followUp),
      missing,
      slots,
    };
    if (ambiguity) out.ambiguity = ambiguity;
    return out;
  }

  // ---------- parseSlotValue (preenchimento de slot por resposta curta) ----------
  // Converte a resposta de uma pergunta (um chip ou texto curto) no valor do slot.
  // Reaproveita os mesmos extratores do parse: lugares, datas/intervalos/noites,
  // dinheiro (em centavos), pessoas e nomes. Nunca lança.
  function parseSlotValue(slot, text, context, clock) {
    const ctx = context || {};
    const nowFn = (clock && typeof clock.now === 'function') ? clock.now : () => Date.now();
    const original = text == null ? '' : String(text).slice(0, 1000);
    try {
      const normalized = normalize(original);
      const nowDate = new Date(nowFn());
      const today = { date: startOfDay(nowDate), y: nowDate.getFullYear(), m: nowDate.getMonth() + 1, d: nowDate.getDate() };
      const places = getPlaces();
      switch (slot) {
        case 'destination':
        case 'origin':
        case 'tripRef':
        case 'goalRef':
        case 'itemRef':
        case 'optionRef':
        case 'decisionRef': {
          // Lugares resolvem por PlannerPlaces; refs humanas voltam como texto cru.
          if (slot === 'destination' || slot === 'origin') {
            const ref = resolvePlaceText(normalized || original, places);
            if (ref && ref.id) return ref;
            if (ref && ref.ambiguous) return { ambiguous: true, candidates: ref.candidates, raw: ref.raw };
            return { raw: original.trim(), unresolved: true };
          }
          return original.trim();
        }
        case 'departDate':
        case 'startDate':
        case 'date': {
          const dates = parseDates(normalized, today);
          if (dates.depart) return isoFromParts(dates.depart.y, dates.depart.m, dates.depart.d);
          const single = detectSingleDate(normalized, today);
          if (single && single !== 'invalid') return isoFromParts(single.y, single.m, single.d);
          return null;
        }
        case 'returnDate': {
          if (/\b(so|somente|apenas)\s+ida\b/.test(normalized) || /\bsó ida\b/i.test(original)) {
            return { oneWay: true };
          }
          const dates = parseDates(normalized, today);
          if (dates.nights != null) return { nights: dates.nights };
          if (dates.ret) return isoFromParts(dates.ret.y, dates.ret.m, dates.ret.d);
          const single = detectSingleDate(normalized, today);
          if (single && single !== 'invalid') return isoFromParts(single.y, single.m, single.d);
          return null;
        }
        case 'nights': {
          const dates = parseDates(normalized, today);
          if (dates.nights != null) return dates.nights;
          const n = normalized.match(/\b(\d+)\b/);
          if (n) return clamp(parseInt(n[1], 10), 1, 30);
          return null;
        }
        case 'adults':
        case 'passengers': {
          const people = parsePassengers(normalized);
          if (people.adults != null) return people.adults;
          const n = normalized.match(/\b(\d+)\b/);
          if (n) return clamp(parseInt(n[1], 10), 1, 9);
          return null;
        }
        case 'amountMinor':
        case 'targetMinor':
        case 'maxPriceMinor': {
          const money = parseMoney(normalized || original);
          return money != null ? money : null;
        }
        case 'month':
        case 'deadline': {
          const month = detectMonthRef(normalized, today);
          return month || null;
        }
        case 'category': {
          const cat = detectBudgetCategory(normalized) || inferCategory(normalized);
          return cat || null;
        }
        case 'type':
        case 'financeType': {
          if (/\b(receita|ganhei|recebi|entrou|salario)\b/.test(normalized)) return 'income';
          if (/\b(gasto|despesa|paguei|gastei|comprei|saida)\b/.test(normalized)) return 'expense';
          return null;
        }
        case 'payer':
        case 'voter':
        case 'voterRef':
        case 'participantName':
        case 'name':
        case 'participant': {
          const trimmed = original.trim();
          if (!trimmed) return null;
          if (/^(eu|me|mim)$/i.test(trimmed)) return 'me';
          // Nome próprio: devolve o texto original com a primeira letra maiúscula.
          return trimmed.replace(/\s+/g, ' ');
        }
        case 'cabin': {
          return extractCabin(normalized) || null;
        }
        case 'directOnly': {
          if (/\b(direto|direta|sem escala|sem conexao)\b/.test(normalized)) return true;
          if (/\b(com escala|nao|não)\b/.test(normalized)) return false;
          return null;
        }
        case 'title':
        case 'text':
        case 'description':
        default: {
          // Slots de texto livre: devolve o texto digitado, sem normalizar.
          const trimmed = original.trim();
          return trimmed || null;
        }
      }
    } catch (_err) {
      return null;
    }
  }
  function clamp01(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  return Object.freeze({
    INTENTS,
    normalize,
    parse,
    requiredSlots,
    parseMoney,
    inferCategory,
    parseSlotValue,
  });
});
