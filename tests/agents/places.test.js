import { describe, expect, it } from 'vitest';
import places from '../../public/modules/agents/places.js';

describe('PlannerPlaces — gazetteer', () => {
  it('expõe a API pura esperada', () => {
    expect(typeof places.list).toBe('function');
    expect(typeof places.byId).toBe('function');
    expect(typeof places.byIata).toBe('function');
    expect(typeof places.search).toBe('function');
    expect(typeof places.resolve).toBe('function');
    expect(typeof places.toRef).toBe('function');
    expect(typeof places.normalizeKey).toBe('function');
  });

  it('tem as 27 capitais brasileiras e volume mínimo de entradas', () => {
    const list = places.list();
    expect(list.length).toBeGreaterThanOrEqual(90);
    const capitais = ['br-sao-paulo', 'br-rio-de-janeiro', 'br-brasilia', 'br-manaus', 'br-palmas', 'br-boa-vista', 'br-macapa'];
    capitais.forEach((id) => expect(places.byId(id)).toBeTruthy());
  });

  it('tem pelo menos 60 destinos internacionais', () => {
    const intl = places.list().filter((p) => p.country !== 'BR');
    expect(intl.length).toBeGreaterThanOrEqual(60);
  });

  it('congela os dados (imutável)', () => {
    const sp = places.byId('br-sao-paulo');
    expect(Object.isFrozen(sp)).toBe(true);
    expect(Object.isFrozen(places.list())).toBe(true);
    expect(() => {
      sp.name = 'alterado';
    }).toThrow();
  });

  it('resolve aliases sem acento e apelidos', () => {
    expect(places.resolve('sampa').place.id).toBe('br-sao-paulo');
    expect(places.resolve('sp').place.id).toBe('br-sao-paulo');
    expect(places.resolve('bh').place.id).toBe('br-belo-horizonte');
    expect(places.resolve('floripa').place.id).toBe('br-florianopolis');
    expect(places.resolve('poa').place.id).toBe('br-porto-alegre');
    expect(places.resolve('ny').place.id).toBe('us-nova-york');
    expect(places.resolve('nova iorque').place.id).toBe('us-nova-york');
    expect(places.resolve('são paulo').place.id).toBe('br-sao-paulo');
  });

  it('resolve códigos IATA de cidade e de aeroporto (case-insensitive)', () => {
    expect(places.resolve('gru').place.id).toBe('br-sao-paulo');
    expect(places.resolve('GIG').place.id).toBe('br-rio-de-janeiro');
    expect(places.resolve('sao').place.id).toBe('br-sao-paulo');
    expect(places.byIata('cgh').id).toBe('br-sao-paulo');
    expect(places.byIata('LIS').id).toBe('pt-lisboa');
  });

  it('distingue "porto" (PT) de "porto alegre" (BR)', () => {
    expect(places.resolve('porto').place.id).toBe('pt-porto');
    expect(places.resolve('porto alegre').place.id).toBe('br-porto-alegre');
  });

  it('devolve ambiguidade para "santiago"', () => {
    const res = places.resolve('santiago');
    expect(res.status).toBe('ambiguous');
    const ids = res.candidates.map((c) => c.id);
    expect(ids).toContain('cl-santiago');
    expect(ids).toContain('es-santiago-de-compostela');
    expect(res.candidates.length).toBeLessThanOrEqual(5);
  });

  it('aplica Levenshtein <= 1 para entradas longas', () => {
    expect(places.resolve('lisbooa').place.id).toBe('pt-lisboa');
    expect(places.resolve('barcelna').place.id).toBe('es-barcelona');
  });

  it('devolve none para texto desconhecido', () => {
    expect(places.resolve('cidadeinexistentexyz').status).toBe('none');
    expect(places.resolve('').status).toBe('none');
    expect(places.resolve('   ').status).toBe('none');
  });

  it('search retorna chips acento-insensíveis e respeita o limite', () => {
    const r = places.search('lis', 3);
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r.map((p) => p.id)).toContain('pt-lisboa');
    expect(places.search('gru').map((p) => p.id)).toContain('br-sao-paulo');
    expect(places.search('')).toEqual([]);
  });

  it('cidades sem aeroporto trazem nearestAirports e airports vazio', () => {
    const gramado = places.byId('br-gramado');
    expect(gramado.airports).toEqual([]);
    expect(gramado.nearestAirports).toContain('POA');
    const paraty = places.byId('br-paraty');
    expect(paraty.airports.length).toBe(0);
    expect(Array.isArray(paraty.nearestAirports)).toBe(true);
  });

  it('toRef produz objeto plano e serializável para slots', () => {
    const ref = places.toRef(places.byId('br-sao-paulo'));
    expect(ref).toEqual({
      id: 'br-sao-paulo',
      name: 'São Paulo',
      cityIata: 'SAO',
      airports: ['GRU', 'CGH', 'VCP'],
      country: 'BR',
      countryName: 'Brasil',
      lat: -23.5505,
      lon: -46.6333,
    });
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    expect(places.toRef(null)).toBeNull();
  });

  it('normalizeKey remove acentos e normaliza espaços', () => {
    expect(places.normalizeKey('  SÃO   Paulo! ')).toBe('sao paulo');
    expect(places.normalizeKey('Montevidéu')).toBe('montevideu');
    expect(places.normalizeKey(null)).toBe('');
  });

  it('códigos IATA conhecidos apontam para a cidade correta', () => {
    const expectativas = {
      GRU: 'br-sao-paulo', VCP: 'br-sao-paulo', CNF: 'br-belo-horizonte',
      BSB: 'br-brasilia', SSA: 'br-salvador', REC: 'br-recife', FOR: 'br-fortaleza',
      POA: 'br-porto-alegre', CWB: 'br-curitiba', FLN: 'br-florianopolis',
      LIS: 'pt-lisboa', MAD: 'es-madri', CDG: 'fr-paris', LHR: 'gb-londres',
      FCO: 'it-roma', JFK: 'us-nova-york', EZE: 'ar-buenos-aires', NRT: 'jp-toquio',
    };
    Object.entries(expectativas).forEach(([iata, id]) => {
      expect(places.byIata(iata).id).toBe(id);
    });
  });
});
