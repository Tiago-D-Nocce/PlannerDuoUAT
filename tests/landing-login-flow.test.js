import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import core from '../public/core.js';

const PUBLIC = resolve(import.meta.dirname, '..', 'public');
const landing = readFileSync(resolve(PUBLIC, 'index.html'), 'utf8');
const app = readFileSync(resolve(PUBLIC, 'app.html'), 'utf8');
const auth = readFileSync(resolve(PUBLIC, 'auth.html'), 'utf8');
const appScript = readFileSync(resolve(PUBLIC, 'app.js'), 'utf8');
const pages = [landing, app, auth].join('\n');
const runtime = [pages, appScript].join('\n');

function loadTravelSearchApi() {
  const context = {
    console,
    Date,
    Intl,
    Math,
    JSON,
    URL,
    PlannerCore: core,
    PlannerLocal: {},
    document: {
      readyState: 'loading',
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(appScript, context, { filename: 'app.js' });
  return context.PlannerApp.travelSearch;
}

const travelSearch = loadTravelSearchApi();

describe('entrada direta no aplicativo local', () => {
  it('oferece acesso direto ao workspace sem exigir login', () => {
    expect((landing.match(/href="app\.html(?:#[^"]*)?"/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(runtime).not.toMatch(/type="password"|onAuthStateChanged|signInWith/i);
    expect(auth).toContain('url=app.html');
  });

  it('carrega somente assets locais', () => {
    expect(pages).not.toMatch(/(?:src|href)="https?:\/\//i);
    expect(runtime).not.toMatch(/cdnjs|jsdelivr|gstatic|unpkg/i);
    expect(app).toContain('<script src="core.js"></script>');
    expect(app).toContain('<script src="local.js"></script>');
    expect(app).toContain('<script src="app.js"></script>');
  });

  it('não contém papéis fixos e expõe configuração e decisões', () => {
    expect(runtime).not.toMatch(/Pessoa\s*[12]|\bp[12]\b|nome[12]/i);
    expect(app).toContain('data-view-panel="decisions"');
    expect(app).toContain('data-view-panel="settings"');
    expect(app).toContain('Sem limite fixo');
  });

  it('expõe a busca de viagens sem embeds ou scripts dos provedores', () => {
    expect(app).toContain('id="travel-search-form"');
    expect(app).toContain('id="travel-provider-grid"');
    expect(app).toContain('data-travel-provider-filter="flights"');
    expect(app).toContain('aria-pressed="true"');
    expect(appScript).toContain("id: 'google-flights'");
    expect(appScript).toContain("id: 'airbnb'");
    expect(appScript).toContain("id: 'gol'");
    expect(appScript).toContain("id: 'azul'");
    expect(appScript).toContain("id: 'clickbus'");
    expect(appScript).toContain("link.rel = 'noopener noreferrer'");
  });

  it('restringe navegação externa aos hosts de viagem autorizados', () => {
    const hosts = [...appScript.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map((match) => match[1].toLowerCase());
    expect([...new Set(hosts)].sort()).toEqual([
      'passagens.voeazul.com.br',
      'www.airbnb.com.br',
      'www.booking.com',
      'www.buser.com.br',
      'www.clickbus.com.br',
      'www.decolar.com',
      'www.google.com',
      'www.kayak.com.br',
      'www.latamairlines.com',
      'www.rome2rio.com',
      'www.skyscanner.com.br',
      'www.voegol.com.br',
    ]);
    expect(appScript).toContain('TRAVEL_ALLOWED_HOSTS.has');
  });
});

describe('motor de busca multi-site', () => {
  const validSearch = {
    origin: 'Belo Horizonte (CNF)',
    destination: 'São Paulo (GRU)',
    departure: '2026-12-10',
    returnDate: '2026-12-15',
    passengers: 2,
  };

  it('valida rota, período e regras específicas de hospedagem', () => {
    expect(travelSearch.providerIds).toHaveLength(12);
    expect(travelSearch.validate('google-flights', validSearch, '2026-09-28').ok).toBe(true);
    expect(travelSearch.validate('google-flights', { ...validSearch, origin: '---' }, '2026-09-28').ok).toBe(false);
    expect(travelSearch.validate('google-flights', { ...validSearch, departure: '', returnDate: '2026-12-15' }, '2026-09-28').ok).toBe(false);
    expect(travelSearch.validate('google-flights', { ...validSearch, departure: '2026-01-01' }, '2026-09-28').ok).toBe(false);
    expect(travelSearch.validate('airbnb', { ...validSearch, departure: '2026-12-10', returnDate: '2026-12-10' }, '2026-09-28').ok).toBe(false);
    expect(travelSearch.validate('google-flights', { ...validSearch, departure: '2026-12-10', returnDate: '2026-12-10' }, '2026-09-28').ok).toBe(true);
  });

  it('preenche os comparadores somente quando suas precondições são atendidas', () => {
    const google = travelSearch.build('google-flights', validSearch);
    expect(new URL(google.url).searchParams.get('q')).toContain('Belo Horizonte (CNF)');
    expect(google.prefilled).toBe(true);

    const kayak = travelSearch.build('kayak', validSearch);
    expect(new URL(kayak.url).pathname).toContain('/CNF-GRU/2026-12-10/2026-12-15/2adults');
    expect(kayak.prefilled).toBe(true);
    expect(travelSearch.build('kayak', { ...validSearch, departure: '', returnDate: '' }).prefilled).toBe(false);

    const skyscanner = travelSearch.build('skyscanner', validSearch);
    expect(new URL(skyscanner.url).pathname).toContain('/cnf/gru/261210/261215/');
    expect(skyscanner.prefilled).toBe(true);
  });

  it('codifica hospedagem e rotas sem permitir segmentos vazios', () => {
    const airbnb = new URL(travelSearch.build('airbnb', validSearch).url);
    expect(decodeURIComponent(airbnb.pathname)).toContain('São Paulo (GRU)');
    expect(airbnb.searchParams.get('checkin')).toBe('2026-12-10');

    const booking = new URL(travelSearch.build('booking', validSearch).url);
    expect(booking.searchParams.get('ss')).toBe('São Paulo (GRU)');
    expect(booking.searchParams.get('group_adults')).toBe('2');

    const route = new URL(travelSearch.build('rome2rio', validSearch).url);
    expect(route.pathname).toContain('/Belo-Horizonte-CNF/Sao-Paulo-GRU');
    expect(() => travelSearch.build('rome2rio', { ...validSearch, origin: '---', destination: '💥' })).toThrow(/rota/i);
  });

  it('constrói todos os destinos dentro da allowlist HTTPS', () => {
    const allowed = new Set([
      'passagens.voeazul.com.br', 'www.airbnb.com.br', 'www.booking.com',
      'www.buser.com.br', 'www.clickbus.com.br', 'www.decolar.com',
      'www.google.com', 'www.kayak.com.br', 'www.latamairlines.com',
      'www.rome2rio.com', 'www.skyscanner.com.br', 'www.voegol.com.br',
    ]);
    travelSearch.providerIds.forEach((providerId) => {
      const target = new URL(travelSearch.build(providerId, validSearch).url);
      expect(target.protocol).toBe('https:');
      expect(allowed.has(target.hostname)).toBe(true);
      expect(target.username).toBe('');
      expect(target.password).toBe('');
      expect(target.port).toBe('');
    });
  });
});
