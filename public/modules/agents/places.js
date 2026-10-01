/* PlannerDuo — PlannerPlaces: gazetteer puro de cidades brasileiras e destinos
   internacionais, com aliases sem acento, IATA, ISO-2 e coordenadas. Sem DOM. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerPlaces = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // --- normalização de chave: NFD sem diacríticos, minúsculas, espaços únicos ---
  function normalizeKey(text) {
    if (text == null) return '';
    let value = String(text);
    try {
      value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (_err) {
      /* normalize indisponível — segue sem decompor */
    }
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Entrada compacta: [id, name, country, countryName, cityIata|null,
  //   [[iata,name]...], [nearestAirports]|null, lat, lon, [aliases...]]
  // countryName e aliases em pt-BR; aliases já sem acento (normalizados abaixo).
  const RAW = [
    // ===== Capitais brasileiras (27) =====
    ['br-sao-paulo', 'São Paulo', 'BR', 'Brasil', 'SAO', [['GRU', 'Guarulhos'], ['CGH', 'Congonhas'], ['VCP', 'Viracopos']], null, -23.5505, -46.6333, ['sampa', 'sp', 'sao paulo', 'são paulo']],
    ['br-rio-de-janeiro', 'Rio de Janeiro', 'BR', 'Brasil', 'RIO', [['GIG', 'Galeão'], ['SDU', 'Santos Dumont']], null, -22.9068, -43.1729, ['rio', 'rj', 'rio de janeiro', 'cidade maravilhosa']],
    ['br-belo-horizonte', 'Belo Horizonte', 'BR', 'Brasil', 'BHZ', [['CNF', 'Confins'], ['PLU', 'Pampulha']], null, -19.9167, -43.9345, ['bh', 'beaga', 'belo horizonte', 'bhz']],
    ['br-brasilia', 'Brasília', 'BR', 'Brasil', null, [['BSB', 'Brasília']], null, -15.7939, -47.8828, ['bsb', 'brasilia', 'bsb df']],
    ['br-salvador', 'Salvador', 'BR', 'Brasil', null, [['SSA', 'Salvador']], null, -12.9777, -38.5016, ['ssa', 'salvador', 'soteropolis']],
    ['br-recife', 'Recife', 'BR', 'Brasil', null, [['REC', 'Guararapes']], null, -8.0476, -34.877, ['rec', 'recife']],
    ['br-fortaleza', 'Fortaleza', 'BR', 'Brasil', null, [['FOR', 'Pinto Martins']], null, -3.7319, -38.5267, ['for', 'fortaleza']],
    ['br-porto-alegre', 'Porto Alegre', 'BR', 'Brasil', null, [['POA', 'Salgado Filho']], null, -30.0346, -51.2177, ['poa', 'porto alegre']],
    ['br-curitiba', 'Curitiba', 'BR', 'Brasil', null, [['CWB', 'Afonso Pena']], null, -25.4284, -49.2733, ['cwb', 'curitiba']],
    ['br-florianopolis', 'Florianópolis', 'BR', 'Brasil', null, [['FLN', 'Hercílio Luz']], null, -27.5949, -48.548, ['floripa', 'fln', 'florianopolis', 'ilha da magia']],
    ['br-manaus', 'Manaus', 'BR', 'Brasil', null, [['MAO', 'Eduardo Gomes']], null, -3.119, -60.0217, ['mao', 'manaus']],
    ['br-belem', 'Belém', 'BR', 'Brasil', null, [['BEL', 'Val de Cans']], null, -1.4558, -48.4902, ['bel', 'belem']],
    ['br-goiania', 'Goiânia', 'BR', 'Brasil', null, [['GYN', 'Santa Genoveva']], null, -16.6869, -49.2648, ['gyn', 'goiania']],
    ['br-natal', 'Natal', 'BR', 'Brasil', null, [['NAT', 'São Gonçalo do Amarante']], null, -5.7945, -35.211, ['nat', 'natal']],
    ['br-maceio', 'Maceió', 'BR', 'Brasil', null, [['MCZ', 'Zumbi dos Palmares']], null, -9.6498, -35.7089, ['mcz', 'maceio']],
    ['br-joao-pessoa', 'João Pessoa', 'BR', 'Brasil', null, [['JPA', 'Castro Pinto']], null, -7.1195, -34.845, ['jpa', 'joao pessoa']],
    ['br-aracaju', 'Aracaju', 'BR', 'Brasil', null, [['AJU', 'Santa Maria']], null, -10.9472, -37.0731, ['aju', 'aracaju']],
    ['br-teresina', 'Teresina', 'BR', 'Brasil', null, [['THE', 'Senador Petrônio Portella']], null, -5.0892, -42.8019, ['the', 'teresina']],
    ['br-sao-luis', 'São Luís', 'BR', 'Brasil', null, [['SLZ', 'Marechal Cunha Machado']], null, -2.5307, -44.3068, ['slz', 'sao luis']],
    ['br-cuiaba', 'Cuiabá', 'BR', 'Brasil', null, [['CGB', 'Marechal Rondon']], null, -15.6014, -56.0979, ['cgb', 'cuiaba']],
    ['br-campo-grande', 'Campo Grande', 'BR', 'Brasil', null, [['CGR', 'Campo Grande']], null, -20.4697, -54.6201, ['cgr', 'campo grande']],
    ['br-vitoria', 'Vitória', 'BR', 'Brasil', null, [['VIX', 'Eurico de Aguiar Salles']], null, -20.3155, -40.3128, ['vix', 'vitoria']],
    ['br-porto-velho', 'Porto Velho', 'BR', 'Brasil', null, [['PVH', 'Governador Jorge Teixeira']], null, -8.7619, -63.9039, ['pvh', 'porto velho']],
    ['br-rio-branco', 'Rio Branco', 'BR', 'Brasil', null, [['RBR', 'Plácido de Castro']], null, -9.9754, -67.8249, ['rbr', 'rio branco']],
    ['br-macapa', 'Macapá', 'BR', 'Brasil', null, [['MCP', 'Alberto Alcolumbre']], null, 0.0349, -51.0694, ['mcp', 'macapa']],
    ['br-boa-vista', 'Boa Vista', 'BR', 'Brasil', null, [['BVB', 'Atlas Brasil Cantanhede']], null, 2.8235, -60.6758, ['bvb', 'boa vista']],
    ['br-palmas', 'Palmas', 'BR', 'Brasil', null, [['PMW', 'Palmas']], null, -10.1844, -48.3336, ['pmw', 'palmas']],

    // ===== Principais cidades de viagem no Brasil (com aeroporto) =====
    ['br-foz-do-iguacu', 'Foz do Iguaçu', 'BR', 'Brasil', null, [['IGU', 'Cataratas']], null, -25.5478, -54.5882, ['igu', 'foz', 'foz do iguacu', 'cataratas']],
    ['br-porto-seguro', 'Porto Seguro', 'BR', 'Brasil', null, [['BPS', 'Porto Seguro']], null, -16.4383, -39.0808, ['bps', 'porto seguro']],
    ['br-navegantes', 'Navegantes', 'BR', 'Brasil', null, [['NVT', 'Ministro Victor Konder']], null, -26.8799, -48.6514, ['nvt', 'navegantes', 'balneario camboriu', 'camboriu']],
    ['br-campinas', 'Campinas', 'BR', 'Brasil', null, [['VCP', 'Viracopos']], null, -22.9099, -47.0626, ['vcp', 'campinas']],
    ['br-ribeirao-preto', 'Ribeirão Preto', 'BR', 'Brasil', null, [['RAO', 'Leite Lopes']], null, -21.1775, -47.8103, ['rao', 'ribeirao preto', 'ribeirao']],
    ['br-uberlandia', 'Uberlândia', 'BR', 'Brasil', null, [['UDI', 'Ten. Cel. Av. César Bombonato']], null, -18.9186, -48.2772, ['udi', 'uberlandia']],
    ['br-londrina', 'Londrina', 'BR', 'Brasil', null, [['LDB', 'Governador José Richa']], null, -23.3045, -51.1696, ['ldb', 'londrina']],
    ['br-maringa', 'Maringá', 'BR', 'Brasil', null, [['MGF', 'Sílvio Name Júnior']], null, -23.4253, -51.9386, ['mgf', 'maringa']],
    ['br-joinville', 'Joinville', 'BR', 'Brasil', null, [['JOI', 'Lauro Carneiro de Loyola']], null, -26.3045, -48.8487, ['joi', 'joinville']],
    ['br-ilheus', 'Ilhéus', 'BR', 'Brasil', null, [['IOS', 'Jorge Amado']], null, -14.788, -39.0332, ['ios', 'ilheus']],
    ['br-jericoacoara', 'Jericoacoara', 'BR', 'Brasil', null, [['JJD', 'Jericoacoara']], null, -2.9598, -40.5137, ['jjd', 'jeri', 'jericoacoara']],
    ['br-fernando-de-noronha', 'Fernando de Noronha', 'BR', 'Brasil', null, [['FEN', 'Fernando de Noronha']], null, -3.8549, -32.4233, ['fen', 'noronha', 'fernando de noronha']],
    ['br-bonito', 'Bonito', 'BR', 'Brasil', null, [['BYO', 'Bonito']], null, -21.247, -56.4523, ['byo', 'bonito']],
    ['br-chapeco', 'Chapecó', 'BR', 'Brasil', null, [['XAP', 'Serafim Enoss Bertaso']], null, -27.1004, -52.6156, ['xap', 'chapeco']],
    ['br-caxias-do-sul', 'Caxias do Sul', 'BR', 'Brasil', null, [['CXJ', 'Hugo Cantergiani']], null, -29.1968, -51.1875, ['cxj', 'caxias', 'caxias do sul']],
    ['br-petrolina', 'Petrolina', 'BR', 'Brasil', null, [['PNZ', 'Senador Nilo Coelho']], null, -9.3626, -40.5693, ['pnz', 'petrolina']],
    ['br-santarem', 'Santarém', 'BR', 'Brasil', null, [['STM', 'Maestro Wilson Fonseca']], null, -2.4249, -54.7085, ['stm', 'santarem']],
    ['br-montes-claros', 'Montes Claros', 'BR', 'Brasil', null, [['MOC', 'Mário Ribeiro']], null, -16.7073, -43.8647, ['moc', 'montes claros', 'montesclaros']],

    // ===== Cidades de viagem no Brasil SEM aeroporto (nearestAirports) =====
    ['br-juiz-de-fora', 'Juiz de Fora', 'BR', 'Brasil', null, [], ['CNF', 'IZA'], -21.7642, -43.3503, ['juiz de fora', 'jf']],
    ['br-gramado', 'Gramado', 'BR', 'Brasil', null, [], ['POA', 'CXJ'], -29.3789, -50.8763, ['gramado']],
    ['br-campos-do-jordao', 'Campos do Jordão', 'BR', 'Brasil', null, [], ['GRU', 'SJK'], -22.7392, -45.5913, ['campos do jordao', 'campos']],
    ['br-paraty', 'Paraty', 'BR', 'Brasil', null, [], ['SDU', 'GIG'], -23.2178, -44.7131, ['paraty', 'parati']],
    ['br-buzios', 'Búzios', 'BR', 'Brasil', null, [], ['GIG', 'SDU'], -22.7469, -41.8817, ['buzios', 'armacao dos buzios']],
    ['br-ouro-preto', 'Ouro Preto', 'BR', 'Brasil', null, [], ['CNF', 'PLU'], -20.3856, -43.5035, ['ouro preto']],
    ['br-arraial-do-cabo', 'Arraial do Cabo', 'BR', 'Brasil', null, [], ['GIG', 'SDU'], -22.9661, -42.0278, ['arraial', 'arraial do cabo']],

    // ===== Destinos internacionais (>= 60) =====
    // Europa
    ['pt-lisboa', 'Lisboa', 'PT', 'Portugal', null, [['LIS', 'Humberto Delgado']], null, 38.7223, -9.1393, ['lisboa', 'lisbon']],
    ['pt-porto', 'Porto', 'PT', 'Portugal', null, [['OPO', 'Francisco Sá Carneiro']], null, 41.1579, -8.6291, ['porto', 'oporto']],
    ['es-madri', 'Madri', 'ES', 'Espanha', null, [['MAD', 'Barajas']], null, 40.4168, -3.7038, ['madri', 'madrid']],
    ['es-barcelona', 'Barcelona', 'ES', 'Espanha', null, [['BCN', 'El Prat']], null, 41.3851, 2.1734, ['barcelona', 'barna']],
    ['fr-paris', 'Paris', 'FR', 'França', 'PAR', [['CDG', 'Charles de Gaulle'], ['ORY', 'Orly']], null, 48.8566, 2.3522, ['paris']],
    ['gb-londres', 'Londres', 'GB', 'Reino Unido', 'LON', [['LHR', 'Heathrow'], ['LGW', 'Gatwick'], ['STN', 'Stansted']], null, 51.5074, -0.1278, ['londres', 'london']],
    ['it-roma', 'Roma', 'IT', 'Itália', 'ROM', [['FCO', 'Fiumicino']], null, 41.9028, 12.4964, ['roma', 'rome']],
    ['it-milao', 'Milão', 'IT', 'Itália', 'MIL', [['MXP', 'Malpensa'], ['LIN', 'Linate']], null, 45.4642, 9.19, ['milao', 'milan', 'milano']],
    ['it-veneza', 'Veneza', 'IT', 'Itália', null, [['VCE', 'Marco Polo']], null, 45.4408, 12.3155, ['veneza', 'venice', 'venezia']],
    ['it-florenca', 'Florença', 'IT', 'Itália', null, [['FLR', 'Peretola']], null, 43.7696, 11.2558, ['florenca', 'florence', 'firenze']],
    ['nl-amsterda', 'Amsterdã', 'NL', 'Países Baixos', null, [['AMS', 'Schiphol']], null, 52.3676, 4.9041, ['amsterda', 'amsterdam']],
    ['de-frankfurt', 'Frankfurt', 'DE', 'Alemanha', null, [['FRA', 'Frankfurt']], null, 50.1109, 8.6821, ['frankfurt']],
    ['de-munique', 'Munique', 'DE', 'Alemanha', null, [['MUC', 'Franz Josef Strauss']], null, 48.1351, 11.582, ['munique', 'munich', 'munchen']],
    ['de-berlim', 'Berlim', 'DE', 'Alemanha', null, [['BER', 'Brandemburgo']], null, 52.52, 13.405, ['berlim', 'berlin']],
    ['ch-zurique', 'Zurique', 'CH', 'Suíça', null, [['ZRH', 'Zurique']], null, 47.3769, 8.5417, ['zurique', 'zurich']],
    ['at-viena', 'Viena', 'AT', 'Áustria', null, [['VIE', 'Schwechat']], null, 48.2082, 16.3738, ['viena', 'vienna', 'wien']],
    ['cz-praga', 'Praga', 'CZ', 'Tchéquia', null, [['PRG', 'Václav Havel']], null, 50.0755, 14.4378, ['praga', 'prague', 'praha']],
    ['ie-dublin', 'Dublin', 'IE', 'Irlanda', null, [['DUB', 'Dublin']], null, 53.3498, -6.2603, ['dublin']],
    ['gr-atenas', 'Atenas', 'GR', 'Grécia', null, [['ATH', 'Eleftherios Venizelos']], null, 37.9838, 23.7275, ['atenas', 'athens']],
    ['tr-istambul', 'Istambul', 'TR', 'Turquia', null, [['IST', 'Istambul']], null, 41.0082, 28.9784, ['istambul', 'istanbul']],
    // Oriente Médio e África
    ['ae-dubai', 'Dubai', 'AE', 'Emirados Árabes Unidos', null, [['DXB', 'Dubai']], null, 25.2048, 55.2708, ['dubai']],
    ['qa-doha', 'Doha', 'QA', 'Catar', null, [['DOH', 'Hamad']], null, 25.2854, 51.531, ['doha']],
    ['eg-cairo', 'Cairo', 'EG', 'Egito', null, [['CAI', 'Cairo']], null, 30.0444, 31.2357, ['cairo']],
    ['za-cidade-do-cabo', 'Cidade do Cabo', 'ZA', 'África do Sul', null, [['CPT', 'Cidade do Cabo']], null, -33.9249, 18.4241, ['cidade do cabo', 'cape town']],
    ['za-joanesburgo', 'Joanesburgo', 'ZA', 'África do Sul', null, [['JNB', 'O. R. Tambo']], null, -26.2041, 28.0473, ['joanesburgo', 'johannesburg']],
    ['ma-marrakech', 'Marrakech', 'MA', 'Marrocos', null, [['RAK', 'Menara']], null, 31.6295, -7.9811, ['marrakech', 'marraquexe']],
    // América do Norte
    ['us-nova-york', 'Nova York', 'US', 'Estados Unidos', 'NYC', [['JFK', 'John F. Kennedy'], ['EWR', 'Newark'], ['LGA', 'LaGuardia']], null, 40.7128, -74.006, ['nova york', 'nova iorque', 'new york', 'ny', 'nyc']],
    ['us-miami', 'Miami', 'US', 'Estados Unidos', null, [['MIA', 'Miami']], null, 25.7617, -80.1918, ['miami']],
    ['us-orlando', 'Orlando', 'US', 'Estados Unidos', null, [['MCO', 'Orlando']], null, 28.5383, -81.3792, ['orlando']],
    ['us-fort-lauderdale', 'Fort Lauderdale', 'US', 'Estados Unidos', null, [['FLL', 'Fort Lauderdale']], null, 26.1224, -80.1373, ['fort lauderdale', 'lauderdale']],
    ['us-los-angeles', 'Los Angeles', 'US', 'Estados Unidos', null, [['LAX', 'Los Angeles']], null, 34.0522, -118.2437, ['los angeles', 'la']],
    ['us-sao-francisco', 'São Francisco', 'US', 'Estados Unidos', null, [['SFO', 'San Francisco']], null, 37.7749, -122.4194, ['sao francisco', 'san francisco']],
    ['us-las-vegas', 'Las Vegas', 'US', 'Estados Unidos', null, [['LAS', 'Harry Reid']], null, 36.1699, -115.1398, ['las vegas', 'vegas']],
    ['us-chicago', 'Chicago', 'US', 'Estados Unidos', 'CHI', [['ORD', "O'Hare"], ['MDW', 'Midway']], null, 41.8781, -87.6298, ['chicago']],
    ['us-washington', 'Washington', 'US', 'Estados Unidos', 'WAS', [['IAD', 'Dulles'], ['DCA', 'Reagan National']], null, 38.9072, -77.0369, ['washington', 'washington dc', 'dc']],
    ['us-boston', 'Boston', 'US', 'Estados Unidos', null, [['BOS', 'Logan']], null, 42.3601, -71.0589, ['boston']],
    ['ca-toronto', 'Toronto', 'CA', 'Canadá', 'YTO', [['YYZ', 'Pearson']], null, 43.6532, -79.3832, ['toronto']],
    ['ca-montreal', 'Montreal', 'CA', 'Canadá', null, [['YUL', 'Trudeau']], null, 45.5017, -73.5673, ['montreal']],
    ['ca-vancouver', 'Vancouver', 'CA', 'Canadá', null, [['YVR', 'Vancouver']], null, 49.2827, -123.1207, ['vancouver']],
    // América Central e Caribe
    ['mx-cidade-do-mexico', 'Cidade do México', 'MX', 'México', null, [['MEX', 'Benito Juárez']], null, 19.4326, -99.1332, ['cidade do mexico', 'mexico city', 'cdmx']],
    ['mx-cancun', 'Cancún', 'MX', 'México', null, [['CUN', 'Cancún']], null, 21.1619, -86.8515, ['cancun']],
    ['do-punta-cana', 'Punta Cana', 'DO', 'República Dominicana', null, [['PUJ', 'Punta Cana']], null, 18.582, -68.4055, ['punta cana']],
    ['pa-panama', 'Panamá', 'PA', 'Panamá', null, [['PTY', 'Tocumen']], null, 8.9824, -79.5199, ['panama', 'cidade do panama']],
    // América do Sul
    ['co-bogota', 'Bogotá', 'CO', 'Colômbia', null, [['BOG', 'El Dorado']], null, 4.711, -74.0721, ['bogota']],
    ['co-cartagena', 'Cartagena', 'CO', 'Colômbia', null, [['CTG', 'Rafael Núñez']], null, 10.391, -75.4794, ['cartagena']],
    ['co-medellin', 'Medellín', 'CO', 'Colômbia', null, [['MDE', 'José María Córdova']], null, 6.2442, -75.5812, ['medellin']],
    ['pe-lima', 'Lima', 'PE', 'Peru', null, [['LIM', 'Jorge Chávez']], null, -12.0464, -77.0428, ['lima']],
    ['pe-cusco', 'Cusco', 'PE', 'Peru', null, [['CUZ', 'Velasco Astete']], null, -13.5319, -71.9675, ['cusco', 'cuzco', 'machu picchu']],
    ['cl-santiago', 'Santiago', 'CL', 'Chile', null, [['SCL', 'Arturo Merino Benítez']], null, -33.4489, -70.6693, ['santiago', 'santiago do chile']],
    ['ar-buenos-aires', 'Buenos Aires', 'AR', 'Argentina', 'BUE', [['EZE', 'Ezeiza'], ['AEP', 'Aeroparque']], null, -34.6037, -58.3816, ['buenos aires', 'baires', 'bsas']],
    ['ar-bariloche', 'Bariloche', 'AR', 'Argentina', null, [['BRC', 'San Carlos de Bariloche']], null, -41.1335, -71.3103, ['bariloche']],
    ['ar-mendoza', 'Mendoza', 'AR', 'Argentina', null, [['MDZ', 'El Plumerillo']], null, -32.8895, -68.8458, ['mendoza']],
    ['uy-montevideu', 'Montevidéu', 'UY', 'Uruguai', null, [['MVD', 'Carrasco']], null, -34.9011, -56.1645, ['montevideu', 'montevideo']],
    ['uy-punta-del-este', 'Punta del Este', 'UY', 'Uruguai', null, [['PDP', 'Punta del Este']], null, -34.9611, -54.9497, ['punta del este', 'punta']],
    ['py-assuncao', 'Assunção', 'PY', 'Paraguai', null, [['ASU', 'Silvio Pettirossi']], null, -25.2637, -57.5759, ['assuncao', 'asuncion']],
    ['ec-quito', 'Quito', 'EC', 'Equador', null, [['UIO', 'Mariscal Sucre']], null, -0.1807, -78.4678, ['quito']],
    // Ásia e Oceania
    ['jp-toquio', 'Tóquio', 'JP', 'Japão', 'TYO', [['NRT', 'Narita'], ['HND', 'Haneda']], null, 35.6762, 139.6503, ['toquio', 'tokyo', 'tokio']],
    ['kr-seul', 'Seul', 'KR', 'Coreia do Sul', 'SEL', [['ICN', 'Incheon'], ['GMP', 'Gimpo']], null, 37.5665, 126.978, ['seul', 'seoul']],
    ['cn-pequim', 'Pequim', 'CN', 'China', 'BJS', [['PEK', 'Capital'], ['PKX', 'Daxing']], null, 39.9042, 116.4074, ['pequim', 'beijing']],
    ['cn-xangai', 'Xangai', 'CN', 'China', 'SHA', [['PVG', 'Pudong'], ['SHA', 'Hongqiao']], null, 31.2304, 121.4737, ['xangai', 'shanghai']],
    ['hk-hong-kong', 'Hong Kong', 'HK', 'Hong Kong', null, [['HKG', 'Hong Kong']], null, 22.3193, 114.1694, ['hong kong', 'hongkong']],
    ['sg-singapura', 'Singapura', 'SG', 'Singapura', null, [['SIN', 'Changi']], null, 1.3521, 103.8198, ['singapura', 'singapore']],
    ['th-bangkok', 'Bangkok', 'TH', 'Tailândia', 'BKK', [['BKK', 'Suvarnabhumi'], ['DMK', 'Don Mueang']], null, 13.7563, 100.5018, ['bangkok', 'bancoc']],
    ['id-bali', 'Bali', 'ID', 'Indonésia', null, [['DPS', 'Ngurah Rai']], null, -8.3405, 115.092, ['bali', 'denpasar']],
    ['au-sydney', 'Sydney', 'AU', 'Austrália', null, [['SYD', 'Kingsford Smith']], null, -33.8688, 151.2093, ['sydney', 'sidney']],
    ['au-melbourne', 'Melbourne', 'AU', 'Austrália', null, [['MEL', 'Tullamarine']], null, -37.8136, 144.9631, ['melbourne']],
    ['mv-maldivas', 'Maldivas', 'MV', 'Maldivas', null, [['MLE', 'Velana']], null, 4.1755, 73.5093, ['maldivas', 'maldives', 'male']],
    // Desambiguação intencional: 'santiago' vale Santiago/CL e Santiago de Compostela/ES;
    // 'porto' vale Porto/PT (exato) e NÃO Porto Alegre (que resolve por 'porto alegre').
    ['es-santiago-de-compostela', 'Santiago de Compostela', 'ES', 'Espanha', null, [['SCQ', 'Santiago de Compostela']], null, 42.8782, -8.5448, ['santiago de compostela', 'compostela', 'santiago']],
  ];

  function buildPlace(row) {
    const [id, name, country, countryName, cityIata, airports, nearest, lat, lon, aliases] = row;
    const normalizedAliases = [];
    const seen = new Set();
    // nome oficial normalizado também entra como alias de busca
    [name].concat(aliases || []).forEach((alias) => {
      const key = normalizeKey(alias);
      if (key && !seen.has(key)) {
        seen.add(key);
        normalizedAliases.push(key);
      }
    });
    const place = {
      id,
      name,
      aliases: Object.freeze(normalizedAliases),
      country,
      countryName,
      cityIata: cityIata || null,
      airports: Object.freeze((airports || []).map((a) => Object.freeze({ iata: a[0], name: a[1] }))),
      lat,
      lon,
    };
    if (nearest && nearest.length) place.nearestAirports = Object.freeze(nearest.slice());
    return Object.freeze(place);
  }

  const PLACES = Object.freeze(RAW.map(buildPlace));

  // Índices
  const byIdIndex = new Map();
  const byAliasIndex = new Map(); // alias normalizado -> [place...]
  const byIataIndex = new Map(); // IATA maiúsculo (cidade ou aeroporto) -> [place...]

  function pushMulti(map, key, place) {
    const current = map.get(key);
    if (current) {
      if (!current.includes(place)) current.push(place);
    } else {
      map.set(key, [place]);
    }
  }

  PLACES.forEach((place) => {
    byIdIndex.set(place.id, place);
    place.aliases.forEach((alias) => pushMulti(byAliasIndex, alias, place));
    if (place.cityIata) pushMulti(byIataIndex, place.cityIata.toUpperCase(), place);
    place.airports.forEach((a) => pushMulti(byIataIndex, a.iata.toUpperCase(), place));
  });

  // --- Levenshtein com corte simples ---
  function levenshtein(a, b) {
    if (a === b) return 0;
    const al = a.length;
    const bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    if (Math.abs(al - bl) > 2) return 3; // acima do limite que nos interessa
    let prev = new Array(bl + 1);
    let curr = new Array(bl + 1);
    for (let j = 0; j <= bl; j += 1) prev[j] = j;
    for (let i = 1; i <= al; i += 1) {
      curr[0] = i;
      for (let j = 1; j <= bl; j += 1) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      const tmp = prev;
      prev = curr;
      curr = tmp;
    }
    return prev[bl];
  }

  // --- API pública ---
  function list() {
    return PLACES;
  }

  function byId(id) {
    return byIdIndex.get(id) || null;
  }

  function byIata(code) {
    if (code == null) return null;
    const found = byIataIndex.get(String(code).toUpperCase());
    return found && found.length ? found[0] : null;
  }

  function search(prefix, limit) {
    const max = Number.isInteger(limit) && limit > 0 ? limit : 6;
    const key = normalizeKey(prefix);
    if (!key) return [];
    const results = [];
    const seen = new Set();
    const add = (place) => {
      if (!seen.has(place.id)) {
        seen.add(place.id);
        results.push(place);
      }
    };
    // 0) código IATA (cidade ou aeroporto) exato
    if (/^[a-z]{3}$/.test(key)) {
      const iataList = byIataIndex.get(key.toUpperCase());
      if (iataList) iataList.forEach(add);
      if (results.length >= max) return results.slice(0, max);
    }
    // 1) prefixo em algum alias
    for (const place of PLACES) {
      if (seen.has(place.id)) continue;
      if (place.aliases.some((alias) => alias.startsWith(key))) {
        add(place);
        if (results.length >= max) return results;
      }
    }
    // 2) substring em algum alias (complementa)
    for (const place of PLACES) {
      if (seen.has(place.id)) continue;
      if (place.aliases.some((alias) => alias.includes(key))) {
        add(place);
        if (results.length >= max) return results;
      }
    }
    return results;
  }

  function resolve(text) {
    const key = normalizeKey(text);
    if (!key) return { status: 'none' };

    // 1) match exato por alias/nome
    const exact = byAliasIndex.get(key);
    if (exact && exact.length === 1) return { status: 'match', place: exact[0] };
    if (exact && exact.length > 1) {
      return { status: 'ambiguous', candidates: exact.slice(0, 5) };
    }

    // 2) IATA de 3 letras (cidade ou aeroporto)
    if (/^[a-z]{3}$/.test(key)) {
      const iataList = byIataIndex.get(key.toUpperCase());
      if (iataList && iataList.length === 1) return { status: 'match', place: iataList[0] };
      if (iataList && iataList.length > 1) return { status: 'ambiguous', candidates: iataList.slice(0, 5) };
    }

    // 3) prefixo único >= 4 caracteres
    if (key.length >= 4) {
      const prefixMatches = [];
      const seen = new Set();
      for (const place of PLACES) {
        if (place.aliases.some((alias) => alias.startsWith(key)) && !seen.has(place.id)) {
          seen.add(place.id);
          prefixMatches.push(place);
        }
      }
      if (prefixMatches.length === 1) return { status: 'match', place: prefixMatches[0] };
      if (prefixMatches.length > 1) return { status: 'ambiguous', candidates: prefixMatches.slice(0, 5) };
    }

    // 4) Levenshtein <= 1 para entradas >= 5 caracteres
    if (key.length >= 5) {
      const fuzzy = [];
      const seen = new Set();
      for (const [alias, places] of byAliasIndex.entries()) {
        if (Math.abs(alias.length - key.length) > 1) continue;
        if (levenshtein(alias, key) <= 1) {
          places.forEach((place) => {
            if (!seen.has(place.id)) {
              seen.add(place.id);
              fuzzy.push(place);
            }
          });
        }
      }
      if (fuzzy.length === 1) return { status: 'match', place: fuzzy[0] };
      if (fuzzy.length > 1) return { status: 'ambiguous', candidates: fuzzy.slice(0, 5) };
    }

    return { status: 'none' };
  }

  function toRef(place) {
    if (!place) return null;
    return {
      id: place.id,
      name: place.name,
      cityIata: place.cityIata || null,
      airports: place.airports.map((a) => a.iata),
      country: place.country,
      countryName: place.countryName,
      lat: place.lat,
      lon: place.lon,
    };
  }

  return Object.freeze({
    list,
    byId,
    byIata,
    search,
    resolve,
    toRef,
    normalizeKey,
    levenshtein,
    count: PLACES.length,
  });
});
