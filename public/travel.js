/* PlannerDuo — registry e builders puros de pesquisa de viagens. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerTravel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const providers = Object.freeze([
    { id: 'google-flights', name: 'Google Voos', group: 'flights', accent: '#4285f4', short: 'G', description: 'Compare várias companhias', support: 'assisted' },
    { id: 'kayak', name: 'KAYAK', group: 'flights', accent: '#ff690f', short: 'K', description: 'Voos e combinações', support: 'conditional' },
    { id: 'skyscanner', name: 'Skyscanner', group: 'flights', accent: '#0770e3', short: 'S', description: 'Comparador global', support: 'conditional' },
    { id: 'momondo', name: 'momondo', group: 'flights', accent: '#78256d', short: 'm', description: 'Compare tarifas', support: 'conditional' },
    { id: 'kiwi', name: 'Kiwi.com', group: 'flights', accent: '#00a991', short: 'K', description: 'Rotas e conexões', support: 'exact' },
    { id: 'expedia-flights', name: 'Expedia Voos', group: 'flights', accent: '#1668e3', short: 'E', description: 'Busca documentada', support: 'conditional' },
    { id: 'decolar', name: 'Decolar', group: 'flights', accent: '#6b36d9', short: 'D', description: 'Passagens e pacotes', support: 'conditional' },
    { id: 'latam', name: 'LATAM', group: 'flights', accent: '#d71969', short: 'LA', description: 'Companhia aérea', support: 'conditional' },
    { id: 'gol', name: 'GOL', group: 'flights', accent: '#ff7020', short: 'GOL', description: 'Companhia aérea', support: 'manual' },
    { id: 'azul', name: 'Azul', group: 'flights', accent: '#006cb7', short: 'AZ', description: 'Companhia aérea', support: 'manual' },

    { id: 'airbnb', name: 'Airbnb', group: 'stays', accent: '#ff385c', short: 'A', description: 'Casas e apartamentos', support: 'exact' },
    { id: 'booking', name: 'Booking.com', group: 'stays', accent: '#003b95', short: 'B', description: 'Hotéis e acomodações', support: 'exact' },
    { id: 'expedia-hotels', name: 'Expedia Hotéis', group: 'stays', accent: '#1668e3', short: 'E', description: 'Busca documentada', support: 'exact' },
    { id: 'hoteis', name: 'Hoteis.com', group: 'stays', accent: '#d32f2f', short: 'H', description: 'Hotéis e pousadas', support: 'exact' },
    { id: 'hostelworld', name: 'Hostelworld', group: 'stays', accent: '#f25621', short: 'HW', description: 'Hostels no mundo', support: 'exact' },
    { id: 'vrbo', name: 'Vrbo', group: 'stays', accent: '#1a4f8b', short: 'V', description: 'Aluguel por temporada', support: 'exact' },
    { id: 'agoda', name: 'Agoda', group: 'stays', accent: '#5392f9', short: 'A', description: 'Hotéis e ofertas', support: 'manual' },
    { id: 'trivago', name: 'trivago', group: 'stays', accent: '#e47b20', short: 't', description: 'Compare hospedagens', support: 'manual' },

    { id: 'clickbus', name: 'ClickBus', group: 'ground', accent: '#00a650', short: 'CB', description: 'Passagens rodoviárias', support: 'exact' },
    { id: 'buser', name: 'Buser', group: 'ground', accent: '#e4007d', short: 'BU', description: 'Viagens de ônibus', support: 'exact' },
    { id: 'rome2rio', name: 'Rome2Rio', group: 'ground', accent: '#2f9da6', short: 'R2', description: 'Compare rotas e modais', support: 'assisted' },
    { id: 'omio', name: 'Omio', group: 'ground', accent: '#0b49d1', short: 'O', description: 'Trem, ônibus e voo', support: 'manual' },
    { id: 'flixbus', name: 'FlixBus', group: 'ground', accent: '#73d700', short: 'FX', description: 'Ônibus intermunicipal', support: 'manual' },
    { id: 'busbud', name: 'Busbud', group: 'ground', accent: '#4b72fa', short: 'BB', description: 'Ônibus em vários países', support: 'manual' },

    { id: 'localiza', name: 'Localiza', group: 'cars', accent: '#008c45', short: 'L', description: 'Aluguel de carros', support: 'manual' },
    { id: 'booking-cars', name: 'Booking Cars', group: 'cars', accent: '#003b95', short: 'BC', description: 'Compare carros', support: 'manual' },
  ].map(Object.freeze));

  const allowedHosts = new Set([
    'www.google.com', 'www.kayak.com.br', 'www.skyscanner.com.br', 'www.momondo.com.br',
    'www.kiwi.com', 'www.expedia.com', 'www.decolar.com', 'www.latamairlines.com',
    'www.voegol.com.br', 'www.voeazul.com.br', 'www.airbnb.com.br', 'www.booking.com',
    'www.hoteis.com', 'www.hostelworld.com', 'www.vrbo.com', 'www.agoda.com',
    'www.trivago.com.br', 'www.clickbus.com.br', 'www.buser.com.br', 'www.rome2rio.com',
    'www.omio.com', 'global.flixbus.com', 'www.busbud.com', 'www.localiza.com', 'cars.booking.com',
  ]);

  function getProvider(providerId) {
    return providers.find((provider) => provider.id === providerId) || null;
  }

  function cleanLocation(value) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  function iataCode(value) {
    const source = cleanLocation(value).toUpperCase();
    const exact = source.match(/^[A-Z]{3}$/);
    if (exact) return exact[0];
    const parenthesized = source.match(/\(([A-Z]{3})\)\s*$/);
    if (parenthesized) return parenthesized[1];
    const trailing = source.match(/(?:^|[\s–—-])([A-Z]{3})\s*$/);
    return trailing ? trailing[1] : null;
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
    return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
  }

  function today() {
    const current = new Date();
    return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
  }

  function slug(value) {
    return cleanLocation(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  }

  function groundSlug(value) {
    const withoutAirport = cleanLocation(value)
      .replace(/\s*\([A-Z]{3}\)\s*$/i, '')
      .replace(/\s+[–—-]?\s*[A-Z]{3}\s*$/i, '')
      .trim();
    return slug(withoutAirport);
  }

  function dateToken(value) {
    return value ? value.replace(/-/g, '').slice(2) : '';
  }

  function latamDate(value) {
    return value ? `${value}T12:00:00.000Z` : '';
  }

  function nightsBetween(checkin, checkout) {
    if (!checkin || !checkout) return 0;
    return Math.max(0, Math.round((new Date(`${checkout}T12:00:00Z`) - new Date(`${checkin}T12:00:00Z`)) / 86400000));
  }

  function validate(providerId, input, referenceDate) {
    const provider = getProvider(providerId);
    if (!provider) return { ok: false, title: 'Provedor inválido', message: 'O site escolhido não existe.' };
    const data = {
      origin: cleanLocation(input && input.origin),
      destination: cleanLocation(input && input.destination),
      departure: String((input && input.departure) || ''),
      returnDate: String((input && input.returnDate) || ''),
      passengers: Number((input && input.passengers) || 1),
    };
    const destinationOnly = provider.group === 'stays' || provider.group === 'cars';
    const useful = (value) => /[\p{L}\p{N}]/u.test(value);
    if (!useful(data.destination) || (!destinationOnly && !useful(data.origin))) {
      return {
        ok: false,
        title: 'Complete a busca',
        message: destinationOnly ? 'Informe um destino válido.' : 'Informe origem e destino válidos.',
        field: !destinationOnly && !useful(data.origin) ? 'origin' : 'destination',
      };
    }
    if ((data.departure && !validDate(data.departure)) || (data.returnDate && !validDate(data.returnDate))) {
      return { ok: false, title: 'Datas inválidas', message: 'Informe datas reais no formato solicitado.', field: 'departure' };
    }
    if (data.returnDate && !data.departure) {
      return { ok: false, title: 'Data de ida necessária', message: 'A volta só pode ser usada junto com a ida.', field: 'departure' };
    }
    const baseline = referenceDate || today();
    if (data.departure && data.departure < baseline) {
      return { ok: false, title: 'Data de ida inválida', message: 'Escolha hoje ou uma data futura.', field: 'departure' };
    }
    if (data.departure && data.returnDate && data.returnDate < data.departure) {
      return { ok: false, title: 'Período inválido', message: 'A volta não pode ser anterior à ida.', field: 'return' };
    }
    if (provider.group === 'stays' && data.departure && data.returnDate === data.departure) {
      return { ok: false, title: 'Hospedagem sem diária', message: 'A saída deve ser posterior à entrada.', field: 'return' };
    }
    if (!Number.isInteger(data.passengers) || data.passengers < 1 || data.passengers > 9) {
      return { ok: false, title: 'Quantidade inválida', message: 'Escolha entre 1 e 9 viajantes.', field: 'passengers' };
    }
    return { ok: true, provider, data };
  }

  function result(url, mode, filled, warnings) {
    const target = url instanceof URL ? url : new URL(url);
    if (target.protocol !== 'https:' || target.username || target.password || target.port
      || !allowedHosts.has(target.hostname.toLowerCase())) {
      throw new Error('Destino de busca não autorizado.');
    }
    return Object.freeze({
      url: target.href,
      mode,
      prefilled: mode !== 'manual',
      filled: Object.freeze({
        origin: Boolean(filled && filled.origin), destination: Boolean(filled && filled.destination),
        departure: Boolean(filled && filled.departure), returnDate: Boolean(filled && filled.returnDate),
        passengers: Boolean(filled && filled.passengers),
      }),
      warnings: Object.freeze([...(warnings || [])]),
    });
  }

  function manual(url, warning) {
    return result(url, 'manual', {}, [warning || 'Preencha rota e datas no site.']);
  }

  function build(providerId, input, referenceDate) {
    const checked = validate(providerId, input, referenceDate);
    if (!checked.ok) {
      const error = new Error(checked.message);
      error.code = 'travel/invalid-search';
      error.validation = checked;
      throw error;
    }
    const { provider, data } = checked;
    const originCode = iataCode(data.origin);
    const destinationCode = iataCode(data.destination);
    const originSlug = slug(data.origin);
    const destinationSlug = slug(data.destination);
    const groundOriginSlug = groundSlug(data.origin);
    const groundDestinationSlug = groundSlug(data.destination);
    const all = { origin: true, destination: true, departure: !!data.departure, returnDate: !!data.returnDate, passengers: true };

    if (provider.id === 'google-flights') {
      const url = new URL('https://www.google.com/travel/flights');
      const query = [`Voos de ${data.origin} para ${data.destination}`];
      if (data.departure) query.push(`ida ${data.departure}`);
      if (data.returnDate) query.push(`volta ${data.returnDate}`);
      query.push(`${data.passengers} ${data.passengers === 1 ? 'adulto' : 'adultos'}`);
      url.searchParams.set('q', query.join(' '));
      url.searchParams.set('hl', 'pt-BR');
      url.searchParams.set('curr', 'BRL');
      return result(url, 'assisted', all, ['O Google interpreta a consulta; confirme as datas exibidas.']);
    }

    if (provider.id === 'kayak' || provider.id === 'momondo') {
      if (!originCode || !destinationCode || !data.departure) {
        const home = provider.id === 'kayak' ? 'https://www.kayak.com.br/flights' : 'https://www.momondo.com.br/flight-search';
        return manual(home, 'Use códigos IATA e data de ida para preencher esta busca.');
      }
      const host = provider.id === 'kayak' ? 'www.kayak.com.br' : 'www.momondo.com.br';
      const url = new URL(`https://${host}/flight-search/${originCode}-${destinationCode}/${data.departure}${data.returnDate ? `/${data.returnDate}` : ''}/${data.passengers}adults`);
      return result(url, 'exact', all);
    }

    if (provider.id === 'skyscanner') {
      if (!originCode || !destinationCode || !data.departure) return manual('https://www.skyscanner.com.br/', 'Use códigos IATA e data de ida para preencher esta busca.');
      const url = new URL(`https://www.skyscanner.com.br/transporte/passagens-aereas/${originCode.toLowerCase()}/${destinationCode.toLowerCase()}/${dateToken(data.departure)}${data.returnDate ? `/${dateToken(data.returnDate)}` : ''}/`);
      url.searchParams.set('adultsv2', String(data.passengers));
      url.searchParams.set('cabinclass', 'economy');
      url.searchParams.set('rtn', data.returnDate ? '1' : '0');
      return result(url, 'exact', all, ['Formato de varejo inferido; confirme os dados na página.']);
    }

    if (provider.id === 'kiwi') {
      if (!data.departure || !originSlug || !destinationSlug) return manual('https://www.kiwi.com/br/', 'Informe uma data de ida para preencher esta busca.');
      const url = new URL(`https://www.kiwi.com/br/search/results/${originSlug}/${destinationSlug}/${data.departure}${data.returnDate ? `/${data.returnDate}` : ''}`);
      url.searchParams.set('adults', String(data.passengers));
      return result(url, 'exact', all, ['Confirme as localidades sugeridas pelo site.']);
    }

    if (provider.id === 'expedia-flights') {
      if (!originCode || !destinationCode || !data.departure || !data.returnDate) return manual('https://www.expedia.com/Flights', 'A busca estruturada exige IATA, ida e volta.');
      const url = new URL(`https://www.expedia.com/go/flight/search/Roundtrip/${data.departure}/${data.returnDate}`);
      url.searchParams.set('load', '1');
      url.searchParams.set('FromAirport', originCode);
      url.searchParams.set('ToAirport', destinationCode);
      url.searchParams.set('FromTime', '362');
      url.searchParams.set('ToTime', '362');
      url.searchParams.set('NumAdult', String(data.passengers));
      return result(url, 'exact', all);
    }

    if (provider.id === 'decolar') {
      if (!originCode || !destinationCode || !data.departure || !data.returnDate) return manual('https://www.decolar.com/passagens-aereas/', 'A busca preenchida exige IATA, ida e volta.');
      return result(`https://www.decolar.com/shop/flights/results/roundtrip/${originCode}/${destinationCode}/${data.departure}/${data.returnDate}/${data.passengers}/0/0/NA/NA/NA/NA/NA`, 'exact', all, ['Formato de varejo inferido; confirme os dados na página.']);
    }

    if (provider.id === 'latam') {
      if (!originCode || !destinationCode || !data.departure) return manual('https://www.latamairlines.com/br/pt', 'Use códigos IATA e data de ida para preencher esta busca.');
      const url = new URL('https://www.latamairlines.com/br/pt/oferta-voos');
      url.searchParams.set('origin', originCode);
      url.searchParams.set('destination', destinationCode);
      url.searchParams.set('outbound', latamDate(data.departure));
      if (data.returnDate) url.searchParams.set('inbound', latamDate(data.returnDate));
      url.searchParams.set('adt', String(data.passengers));
      url.searchParams.set('chd', '0');
      url.searchParams.set('inf', '0');
      url.searchParams.set('trip', data.returnDate ? 'RT' : 'OW');
      url.searchParams.set('cabin', 'Economy');
      url.searchParams.set('redemption', 'false');
      return result(url, 'exact', all, ['Formato de varejo inferido; confirme os dados na página.']);
    }

    if (provider.id === 'airbnb') {
      const url = new URL(`https://www.airbnb.com.br/s/${encodeURIComponent(data.destination)}/homes`);
      if (data.departure) url.searchParams.set('checkin', data.departure);
      if (data.returnDate) url.searchParams.set('checkout', data.returnDate);
      url.searchParams.set('adults', String(data.passengers));
      return result(url, data.departure && data.returnDate ? 'exact' : 'assisted', all);
    }

    if (provider.id === 'booking') {
      const url = new URL('https://www.booking.com/searchresults.pt-br.html');
      url.searchParams.set('ss', data.destination);
      if (data.departure) url.searchParams.set('checkin', data.departure);
      if (data.returnDate) url.searchParams.set('checkout', data.returnDate);
      url.searchParams.set('group_adults', String(data.passengers));
      url.searchParams.set('no_rooms', '1');
      url.searchParams.set('group_children', '0');
      return result(url, data.departure && data.returnDate ? 'exact' : 'assisted', all);
    }

    if (provider.id === 'expedia-hotels') {
      if (!data.departure || !data.returnDate) return manual('https://www.expedia.com/Hotels', 'Informe entrada e saída para a busca estruturada.');
      const url = new URL(`https://www.expedia.com/go/hotel/search/Destination/${data.departure}/${data.returnDate}`);
      url.searchParams.set('CityName', data.destination);
      url.searchParams.set('InDate', data.departure);
      url.searchParams.set('OutDate', data.returnDate);
      url.searchParams.set('NumRoom', '1');
      url.searchParams.set('NumAdult-Room1', String(data.passengers));
      return result(url, 'exact', all);
    }

    if (provider.id === 'hoteis') {
      const url = new URL('https://www.hoteis.com/Hotel-Search');
      url.searchParams.set('destination', data.destination);
      if (data.departure) url.searchParams.set('startDate', data.departure);
      if (data.returnDate) url.searchParams.set('endDate', data.returnDate);
      url.searchParams.set('adults', String(data.passengers));
      url.searchParams.set('rooms', '1');
      return result(url, data.departure && data.returnDate ? 'exact' : 'assisted', all, ['Formato de varejo inferido; confirme os dados na página.']);
    }

    if (provider.id === 'hostelworld') {
      const url = new URL('https://www.hostelworld.com/st/hostels/');
      url.searchParams.set('q', data.destination);
      if (data.departure) url.searchParams.set('dateFrom', data.departure);
      if (data.returnDate) url.searchParams.set('dateTo', data.returnDate);
      url.searchParams.set('guests', String(data.passengers));
      return result(url, data.departure && data.returnDate ? 'exact' : 'assisted', all, ['Formato de varejo inferido; confirme os dados na página.']);
    }

    if (provider.id === 'vrbo') {
      const url = new URL('https://www.vrbo.com/search-results');
      url.searchParams.set('destination', data.destination);
      if (data.departure) url.searchParams.set('startDate', data.departure);
      if (data.returnDate) url.searchParams.set('endDate', data.returnDate);
      url.searchParams.set('adults', String(data.passengers));
      return result(url, data.departure && data.returnDate ? 'exact' : 'assisted', all, ['Formato de varejo inferido; confirme os dados na página.']);
    }

    if (provider.id === 'clickbus' || provider.id === 'buser') {
      if (!groundOriginSlug || !groundDestinationSlug || !data.departure) {
        return manual(provider.id === 'clickbus' ? 'https://www.clickbus.com.br/' : 'https://www.buser.com.br/', 'Informe rota e data de ida para preencher esta busca.');
      }
      const url = provider.id === 'clickbus'
        ? new URL(`https://www.clickbus.com.br/onibus/${groundOriginSlug}/${groundDestinationSlug}`)
        : new URL(`https://www.buser.com.br/onibus/${groundOriginSlug}/${groundDestinationSlug}`);
      url.searchParams.set(provider.id === 'clickbus' ? 'departureDate' : 'ida', data.departure);
      if (data.returnDate) url.searchParams.set(provider.id === 'clickbus' ? 'returnDate' : 'volta', data.returnDate);
      return result(url, 'exact', { ...all, passengers: false }, ['A quantidade de passageiros é escolhida depois.']);
    }

    if (provider.id === 'rome2rio') {
      if (!originSlug || !destinationSlug) return manual('https://www.rome2rio.com/', 'Informe uma rota válida.');
      return result(`https://www.rome2rio.com/pt/map/${originSlug}/${destinationSlug}`, 'assisted', { origin: true, destination: true }, ['Datas são escolhidas no site.']);
    }

    const manualUrls = {
      gol: 'https://www.voegol.com.br/br/voos',
      azul: 'https://www.voeazul.com.br/',
      agoda: 'https://www.agoda.com/pt-br/',
      trivago: 'https://www.trivago.com.br/',
      omio: 'https://www.omio.com/',
      flixbus: 'https://global.flixbus.com/',
      busbud: 'https://www.busbud.com/pt',
      localiza: 'https://www.localiza.com/brasil/pt-br/reserva',
      'booking-cars': 'https://cars.booking.com/',
    };
    return manual(manualUrls[provider.id]);
  }

  function genericIcon(short) {
    const safe = String(short || '?').replace(/[^a-z0-9]/gi, '').slice(0, 3);
    return `<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="4" y="4" width="32" height="32" rx="11" fill="currentColor" opacity=".16"/><text x="20" y="24" text-anchor="middle" font-size="11" font-weight="800" fill="currentColor" font-family="Arial,sans-serif">${safe}</text></svg>`;
  }

  function iconSvg(providerId) {
    const provider = getProvider(providerId);
    if (!provider) return genericIcon('?');
    const icons = {
      'google-flights': '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 22h10l9 9 3-2-5-7h7c2 0 3-1 3-2s-1-2-3-2h-7l5-7-3-2-9 9H8l-4-5H2l2 7-2 7h2z" fill="#4285f4"/><circle cx="9" cy="10" r="3" fill="#ea4335"/><circle cx="16" cy="8" r="2" fill="#fbbc05"/><circle cx="5" cy="7" r="2" fill="#34a853"/></svg>',
      kayak: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="2" y="9" width="36" height="22" rx="4" fill="#ff690f"/><path d="M7 13v14m0-7 6-7m-6 7 6 7M18 13v14m0-7 6-7m-6 7 6 7M29 13v14m0-7 5-7m-5 7 5 7" fill="none" stroke="#fff" stroke-width="2"/></svg>',
      skyscanner: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M6 24c4-8 24-8 28 0M9 29c6-5 16-5 22 0M20 8v7M8 12l5 5M32 12l-5 5" fill="none" stroke="#0770e3" stroke-width="3" stroke-linecap="round"/><path d="M13 31h14l-7 5z" fill="#0770e3"/></svg>',
      gol: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="15" cy="20" r="10" fill="none" stroke="#ff7020" stroke-width="4"/><circle cx="25" cy="20" r="10" fill="none" stroke="#ff7020" stroke-width="4"/><circle cx="25" cy="20" r="3" fill="#ff7020"/></svg>',
      azul: '<svg viewBox="0 0 40 40" aria-hidden="true"><g fill="#006cb7"><rect x="6" y="6" width="8" height="8" rx="2"/><rect x="16" y="4" width="7" height="10" rx="2"/><rect x="25" y="8" width="9" height="7" rx="2"/><rect x="5" y="17" width="11" height="7" rx="2"/><rect x="18" y="17" width="7" height="8" rx="2"/><rect x="27" y="18" width="8" height="10" rx="2"/><rect x="10" y="27" width="13" height="8" rx="2"/></g></svg>',
      latam: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 31 17 7l5 10 10-8-7 23-7-9z" fill="#d71969"/><path d="m17 7 8 25-7-9-5 8z" fill="#4d1d82"/></svg>',
      airbnb: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 7c-4 0-11 15-11 21 0 7 7 5 11-1 4 6 11 8 11 1 0-6-7-21-11-21Zm0 8c2 4 4 8 4 10 0 3-2 4-4 0-2 4-4 3-4 0 0-2 2-6 4-10Z" fill="none" stroke="#ff385c" stroke-width="2.4" stroke-linejoin="round"/></svg>',
      booking: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="5" y="5" width="30" height="30" rx="10" fill="#003b95"/><path d="M14 11h7c6 0 8 7 3 9 6 2 4 10-3 10h-7zm5 4v4h2c3 0 3-4 0-4zm0 8v4h3c3 0 3-4 0-4z" fill="#fff"/></svg>',
      buser: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="7" y="6" width="26" height="26" rx="8" fill="#e4007d"/><path d="M12 11h16v13H12zm3 16h2m6 0h2M15 15h10" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>',
      clickbus: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 10h24v20H8z" fill="#00a650"/><path d="M8 15a4 4 0 0 0 0 8m24-8a4 4 0 0 1 0 8M15 14v12m5-12v12m5-12v12" fill="none" stroke="#fff" stroke-width="2"/></svg>',
      rome2rio: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="10" cy="12" r="5" fill="#2f9da6"/><circle cx="30" cy="28" r="5" fill="#2f9da6"/><path d="M13 15c2 9 12 1 14 10" fill="none" stroke="#2f9da6" stroke-width="3" stroke-linecap="round"/><path d="m23 23 5 2-2 5" fill="none" stroke="#2f9da6" stroke-width="2"/></svg>',
      momondo: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="12" cy="20" r="7" fill="none" stroke="#f15a44" stroke-width="4"/><circle cx="20" cy="20" r="7" fill="none" stroke="#f7b32b" stroke-width="4"/><circle cx="28" cy="20" r="7" fill="none" stroke="#78256d" stroke-width="4"/></svg>',
      kiwi: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="15" fill="#00a991"/><path d="M13 12v16m0-8 12-8m-12 8 12 8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>',
      'expedia-flights': '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" fill="#1668e3"/><path d="m8 23 24-10-9 11-2 9-4-7z" fill="#ffdd28"/></svg>',
      'expedia-hotels': '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" fill="#1668e3"/><path d="M11 25h18v5H11zm2-12h6v10h-6zm8 4h6v6h-6z" fill="#ffdd28"/></svg>',
    };
    return icons[providerId] || genericIcon(provider.short);
  }

  function badgeFor(provider) {
    if (provider.support === 'exact') return 'Datas na busca';
    if (provider.support === 'conditional') return 'Datas com requisitos';
    if (provider.support === 'assisted') return 'Busca assistida';
    return 'Preencher no site';
  }

  return Object.freeze({
    providers,
    providerIds: Object.freeze(providers.map((provider) => provider.id)),
    allowedHosts: Object.freeze([...allowedHosts]),
    getProvider,
    cleanLocation,
    iataCode,
    validate,
    build,
    iconSvg,
    badgeFor,
  });
});
