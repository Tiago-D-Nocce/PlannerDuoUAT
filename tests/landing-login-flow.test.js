import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import travel from '../public/travel.js';

const PUBLIC = resolve(import.meta.dirname, '..', 'public');
const read = (name) => readFileSync(resolve(PUBLIC, name), 'utf8');
const landing = read('index.html');
const app = read('app.html');
const auth = read('auth.html');
const appScript = read('app.js');
const authScript = read('auth.js');
const localScript = read('local.js');
const pages = [landing, app, auth].join('\n');

describe('login e guarda do cofre', () => {
  it('encaminha todas as entradas públicas para a tela de login', () => {
    expect((landing.match(/href="auth\.html[^"]*"/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(landing).not.toContain('href="app.html"');
    expect(auth).not.toMatch(/http-equiv="refresh"/i);
    expect(auth).toContain('id="unlock-form"');
    expect(auth).toContain('id="setup-vault-form"');
    expect(auth).toContain('type="password"');
  });

  it('protege o painel com sessão, logout e troca de senha', () => {
    expect(appScript).toContain('Repository.auth.restoreSession()');
    expect(appScript).toContain('redirectToLogin()');
    expect(app).toContain('data-action="lock-vault"');
    expect(app).toContain('id="security-form"');
    expect(localScript).toContain("name: 'PBKDF2'");
    expect(localScript).toContain("hash: 'SHA-256'");
    expect(localScript).toContain("name: 'AES-GCM'");
    expect(localScript).toContain('600000');
  });

  it('carrega somente scripts e estilos locais', () => {
    expect(pages).not.toMatch(/(?:src|href)="https?:\/\//i);
    expect(pages).not.toMatch(/cdnjs|jsdelivr|gstatic|unpkg/i);
    expect(auth).toContain('<script src="auth.js"></script>');
    expect(app).toContain('<script src="travel.js"></script>');
    expect(app).toContain('<script src="app.js"></script>');
  });

  it('não contém papéis fixos de participantes', () => {
    expect([pages, appScript].join('\n')).not.toMatch(/Pessoa\s*[12]|\bp[12]\b|nome[12]/i);
    expect(app).toContain('Sem limite fixo');
  });
});

describe('registry multi-site e ícones locais', () => {
  it('oferece 26 provedores em quatro categorias', () => {
    expect(travel.providerIds).toHaveLength(26);
    expect(new Set(travel.providers.map((provider) => provider.group))).toEqual(new Set(['flights', 'stays', 'ground', 'cars']));
    expect(travel.providerIds).toEqual(expect.arrayContaining([
      'google-flights', 'kayak', 'skyscanner', 'momondo', 'kiwi', 'expedia-flights',
      'gol', 'azul', 'latam', 'airbnb', 'booking', 'hoteis', 'hostelworld',
      'clickbus', 'buser', 'rome2rio', 'omio', 'localiza',
    ]));
  });

  it('renderiza um SVG local seguro para cada site', () => {
    travel.providerIds.forEach((providerId) => {
      const icon = travel.iconSvg(providerId);
      expect(icon).toMatch(/^<svg[\s\S]*<\/svg>$/);
      expect(icon).not.toMatch(/<script|foreignObject|https?:|href=/i);
    });
    expect(travel.iconSvg('gol')).toContain('<circle');
    expect(travel.iconSvg('airbnb')).toContain('<path');
    expect(travel.iconSvg('azul')).toContain('<rect');
  });

  it('mantém todos os destinos em allowlist HTTPS exata', () => {
    expect(travel.allowedHosts).toHaveLength(25);
    travel.allowedHosts.forEach((host) => expect(host).toMatch(/^[a-z0-9.-]+$/));
  });
});

describe('datas estruturadas nos sites compatíveis', () => {
  const search = {
    origin: 'Belo Horizonte (CNF)',
    destination: 'São Paulo (GRU)',
    departure: '2026-12-10',
    returnDate: '2026-12-15',
    passengers: 2,
  };
  const referenceDate = '2026-09-28';

  it('valida rota, período, passageiros e diária de hospedagem', () => {
    expect(travel.validate('kayak', search, referenceDate).ok).toBe(true);
    expect(travel.validate('kayak', { ...search, origin: '---' }, referenceDate).ok).toBe(false);
    expect(travel.validate('kayak', { ...search, departure: '', returnDate: search.returnDate }, referenceDate).ok).toBe(false);
    expect(travel.validate('airbnb', { ...search, returnDate: search.departure }, referenceDate).ok).toBe(false);
    expect(travel.validate('kayak', { ...search, returnDate: search.departure }, referenceDate).ok).toBe(true);
  });

  it.each([
    'kayak', 'skyscanner', 'momondo', 'kiwi', 'expedia-flights', 'decolar', 'latam',
    'airbnb', 'booking', 'expedia-hotels', 'hoteis', 'hostelworld', 'vrbo', 'clickbus', 'buser',
  ])('%s recebe a data de ida na URL estruturada', (providerId) => {
    const built = travel.build(providerId, search, referenceDate);
    expect(built.mode).toBe('exact');
    expect(built.filled.departure).toBe(true);
    expect(built.filled.returnDate).toBe(true);
    const compactDeparture = search.departure.replace(/-/g, '').slice(2);
    expect(built.url.includes(search.departure) || built.url.includes(compactDeparture)).toBe(true);
  });

  it('transmite rota e passageiros nos principais comparadores', () => {
    const kayak = new URL(travel.build('kayak', search, referenceDate).url);
    expect(kayak.pathname).toContain('/CNF-GRU/2026-12-10/2026-12-15/2adults');

    const expedia = new URL(travel.build('expedia-flights', search, referenceDate).url);
    expect(expedia.searchParams.get('FromAirport')).toBe('CNF');
    expect(expedia.searchParams.get('ToAirport')).toBe('GRU');
    expect(expedia.searchParams.get('NumAdult')).toBe('2');

    const booking = new URL(travel.build('booking', search, referenceDate).url);
    expect(booking.searchParams.get('checkin')).toBe(search.departure);
    expect(booking.searchParams.get('checkout')).toBe(search.returnDate);
    expect(booking.searchParams.get('group_adults')).toBe('2');
  });

  it('identifica honestamente buscas assistidas e páginas manuais', () => {
    expect(travel.build('google-flights', search, referenceDate).mode).toBe('assisted');
    expect(travel.build('rome2rio', search, referenceDate).mode).toBe('assisted');
    ['gol', 'azul', 'agoda', 'trivago', 'omio', 'flixbus', 'busbud', 'localiza', 'booking-cars']
      .forEach((providerId) => expect(travel.build(providerId, search, referenceDate).mode).toBe('manual'));
  });

  it('faz fallback quando faltam requisitos de IATA ou período', () => {
    const withoutCodes = { ...search, origin: 'Belo Horizonte', destination: 'São Paulo' };
    expect(travel.build('kayak', withoutCodes, referenceDate).mode).toBe('manual');
    expect(travel.build('latam', withoutCodes, referenceDate).mode).toBe('manual');
    expect(travel.build('expedia-flights', { ...search, returnDate: '' }, referenceDate).mode).toBe('manual');
  });

  it('rejeita qualquer URL fora da allowlist pelo registry', () => {
    travel.providerIds.forEach((providerId) => {
      const built = travel.build(providerId, search, referenceDate);
      const target = new URL(built.url);
      expect(target.protocol).toBe('https:');
      expect(travel.allowedHosts).toContain(target.hostname);
      expect(target.username).toBe('');
      expect(target.password).toBe('');
      expect(target.port).toBe('');
    });
  });
});

describe('degradação honesta dos deep links', () => {
  const oneWay = {
    origin: 'Belo Horizonte (CNF)', destination: 'São Paulo (GRU)',
    departure: '2026-12-10', returnDate: '', passengers: 2,
  };

  it('não chama hospedagem sem checkout de busca exata', () => {
    ['airbnb', 'booking', 'hoteis', 'hostelworld', 'vrbo'].forEach((providerId) => {
      expect(travel.build(providerId, oneWay, '2026-09-28').mode).toBe('assisted');
    });
  });

  it('remove anotações IATA dos slugs rodoviários', () => {
    ['clickbus', 'buser'].forEach((providerId) => {
      const target = new URL(travel.build(providerId, oneWay, '2026-09-28').url);
      expect(target.pathname).toContain('belo-horizonte/sao-paulo');
      expect(target.pathname).not.toMatch(/cnf|gru/i);
    });
  });
});
