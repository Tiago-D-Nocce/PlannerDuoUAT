# Implementation Plan

## Overview

Plano derivado do adendo de 29/09/2026 do `design.md` (7.8.11, 7.12, 7.13, 7.14, Property 6 e 14.13) e de `requirements.md`, em JavaScript: UMD no padrão de `core.js` no navegador, ESM `.mjs` no Node, Vitest e fast-check com no mínimo 100 iterações por propriedade. São 4 etapas estritamente sequenciais (orquestrador e skills → Agente de Viagens → front-end → integração); cada uma termina em checkpoint com `npm test` e `npm run verificar` verdes, e a seguinte só começa depois disso.

Invariantes de todas as tarefas: formato `plannerduo-vault`, chave `plannerduo:vault:v1`, parâmetros criptográficos, `MAX_AMOUNT` e schema v1 inalterados; fachadas globais equivalentes; allowlist de hosts de `travel.js` intacta; zero dependências de runtime; nenhuma chave no navegador; zero chamadas reais a APIs nos testes. Fora do escopo: schema v2 (8.5), cotações, reservas e pós-venda persistidos e multimoeda. Os critérios 6.1–6.17 correspondem 1:1 aos itens da Property 6 e ainda serão criados em `requirements.md`.

## Tasks

### Etapa 1: Orquestrador e skills

- [x] 1. Runtime de skills `PlannerSkills`
  - [x] 1.1 Implementar `public/modules/agents/skill-runtime.js` (UMD, global `PlannerSkills`) conforme 7.12.3–7.12.4
    - `createRuntime({ core, commit, travel, market, clock })` com `define` (id `^[a-z]+(\.[a-z-]+)+$`, `kind`, `exposure`, `timeoutMs` 100–30.000, `cache` só em leitura; congela; id duplicado lança), `invoke(id, input, { source, signal, turnId })`, `on` e `reset`; erros `skill/not-found|invalid-input|timeout|aborted|circuit-open|failed` com `skillId`, `retryable`, `fields` e copy pt-BR de tabela fixa; eventos `skill:start|done|error`
    - Fila FIFO com no máximo 4 em execução e escrita à frente; timeout por `AbortSignal` composto (`AbortSignal.any` ou manual); dedupe em `inflight` por `id:CanonicalJson`, abortado só quando todos os interessados abortam; cache TTL/LRU em memória; breaker 3 falhas → 30 s aberto → 1 prova; 1 retry só em leitura `retryable` (300 ms + jitter injetado); `skill/aborted` e `skill/invalid-input` fora do breaker. Pronto: carrega por `require` e por `<script>` sem efeito além do global
    - _Requirements: 6.6, 6.7, 6.8, 6.9, 2.18_
  - [x] 1.2 Escrever `tests/agents/skill-runtime.test.js` com relógio, aleatoriedade e `fetch` falsos: skill `exposure: ui` invisível ao chat, `fields` de validação, timeout, aborto, escrita nunca cacheada, deduplicada ou repetida, `reset()`, ordem dos eventos e copy sem stack
    - _Requirements: 6.6, 6.7, 6.8, 6.9_
  - [x] 1.3 **Property 6.6: Bounded concurrency** em `tests/properties/p6-06-concurrency.test.js` · **Validates: Requirements 6.6**
  - [x] 1.4 **Property 6.7: Dedupe and cache** em `tests/properties/p6-07-dedupe-cache.test.js` · **Validates: Requirements 6.7**
  - [x] 1.5 **Property 6.8: Circuit breaker** em `tests/properties/p6-08-circuit-breaker.test.js` · **Validates: Requirements 6.8**
  - [x] 1.6 **Property 6.9: Retry bound** em `tests/properties/p6-09-retry-bound.test.js` · **Validates: Requirements 6.9**
- [x] 2. Lugares e NLU pt-BR
  - [x] 2.1 Implementar `public/modules/agents/places.js` (`PlannerPlaces`, puro)
    - Cidades brasileiras e destinos internacionais com aliases sem acento (“bh”, “sampa”, “floripa”), IATA, ISO-2 e coordenadas; `resolve(text)` → `match`, `ambiguous` (candidatos para chips) ou `none`. Pronto: grafias com e sem acento resolvem para o mesmo lugar
    - _Requirements: 6.1, 6.4_
  - [x] 2.2 Implementar `public/modules/agents/nlu.js` (`PlannerNLU`) conforme 7.12.3
    - `normalize` idempotente (NFD sem diacríticos, minúsculas, espaços e pontuação canônicos, até 1.000 caracteres); `parse(text, context, clock)` total, com intent da allowlist ou `unknown`, `confidence ∈ [0, 1]`, `missing` ordenado e slots de `ParsedMessage` (`description` preserva o original); datas absolutas (“12/11”, “12 de novembro”) e relativas (“amanhã”, “próxima sexta”, “daqui a 2 semanas”) com relógio injetado e fuso do dispositivo; dia/mês passado vai para o ano seguinte; intervalos (“de 10 a 15/11”, “volta dia 20”, “por 5 noites”); mês sem dia vira pergunta; “eu e minha esposa” = 2 adultos e criança com idade; follow-ups (“e para 3 pessoas?”, “só direto”, “e em dezembro?”) reutilizam os slots do `context`. Pronto: `parse` nunca lança
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 2.3 Criar `tests/fixtures/nlu/pt-br.json` e `tests/agents/nlu.test.js`: as seis frases de 14.13, virada de mês e ano, 29/02, aliases sem acento, local ambíguo, data inválida ou passada → pergunta e casos de `PlannerPlaces.resolve`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 2.4 **Property 6.2: Normalization idempotence** em `tests/properties/p6-02-normalization.test.js` · **Validates: Requirements 6.2**
  - [x] 2.5 **Property 6.3: Date validity** em `tests/properties/p6-03-date-validity.test.js` · **Validates: Requirements 6.3**
- [ ] 3. Orquestrador `PlannerOrchestrator`
  - [ ] 3.1 Implementar turnos e plano em `public/modules/agents/orchestrator.js` conforme 7.12.5
    - `create({ runtime, nlu, places, clock, aiEnabled })` com `handle(text)`, `act(blockId, action, gesture)`, `clear()` e `on`; supersessão (o turno anterior é abortado e nada tardio renderiza); truncamento em 1.000; `BuildPlan` puro a partir do `validate` das skills; só o 1º slot faltante vira `question` com chips; etapas com passos paralelos (`AsCompleted`) e blocos progressivos `text|question|flights|stays|links|summary|receipt|confirmation|error` com payload de dados, nunca HTML; memória só em RAM, limpa por `clear()`; no máximo 1 `assist.interpret` por turno (confiança < 0,45 e IA habilitada); falha vira `error` com ação segura (“Tentar de novo” ou links). Pronto: `handle` nunca lança nem expõe stack ou corpo upstream
    - _Requirements: 6.1, 6.4, 6.5_
  - [ ] 3.2 Implementar a política de autonomia de 7.12.7 e registrar `assist.help` e `assist.undo` no mesmo módulo
    - Leitura executa direto; escrita explícita local (confiança ≥ 0,75 e slots locais) executa uma vez com `receipt` e “Desfazer” por 30 s ou até a próxima escrita (pré-imagem em memória; recusa com aviso se a entidade mudou); slot remoto ou confiança < 0,75 → `confirmation` campo a campo, executada uma vez só com clique `isTrusted`; skills `exposure: ui` ficam fora do plano (o `text` indica a tela); navegação externa só por clique em link validado, com `noopener noreferrer`. Pronto: nenhuma escrita sem recibo ou confirmação
    - _Requirements: 6.15, 5.11, 5.13, 5.14_
  - [ ] 3.3 Escrever `tests/agents/orchestrator.test.js` com runtime, relógio e workspace em memória: pergunta com chips (“Quem pagou?”), pergunta, recibo e links locais sem esperar rede (≤ 100 ms no relógio falso), follow-ups, `error` sem stack, expiração e recusa do “Desfazer” e gesto com `isTrusted = false` ignorado
    - _Requirements: 6.4, 6.5, 6.15_
  - [ ] 3.4 **Property 6.1: Routing totality** (strings vazias, longas, com controle, bidi ou emoji) em `tests/properties/p6-01-routing-totality.test.js` · **Validates: Requirements 6.1**
  - [ ] 3.5 **Property 6.4: Slot completeness** em `tests/properties/p6-04-slot-completeness.test.js` · **Validates: Requirements 6.4**
  - [ ] 3.6 **Property 6.5: Turn supersession** em `tests/properties/p6-05-supersession.test.js` · **Validates: Requirements 6.5**
  - [ ] 3.7 **Property 6.15: Autonomy policy** em `tests/properties/p6-15-autonomy.test.js` · **Validates: Requirements 6.15**
- [x] 4. Skills dos agentes e caminho único UI/chat
  - [x] 4.1 Implementar `public/modules/skills/planner-skills.js` (`register(runtime)`) conforme o catálogo 7.12.6
    - Checklist (`add`, `toggle`, `list`, `delete`), decisões (`create`, `vote`, `close`, `list`, `delete`), participantes (`add`, `remove`), `planner.workspace.rename|reset`, `planner.backup.export|import`, `planner.account.password|lock|destroy` e `planner.security.settings` via `PlannerLocal`; escrita só pelo `commit` existente (`Repository.update` + validações de `PlannerCore`). Pronto: tipo e exposição iguais aos da tabela
    - _Requirements: 6.15, 6.16, 2.18, 2.19_
  - [x] 4.2 Implementar `public/modules/skills/finance-skills.js`
    - `finance.transaction.create|update|delete`, `finance.budget.set`, `finance.goal.create|update|delete`, `finance.summary`, `finance.settlements` (`calculateSettlements`), `finance.report`, `finance.recurring.materialize` (`materializeRecurring`) e `finance.report.csv`. Pronto: centavos inteiros e `MAX_AMOUNT` inalterados
    - _Requirements: 6.16, 2.2, 2.3, 2.18_
  - [x] 4.3 Implementar a parte local de `public/modules/skills/travel-skills.js`
    - `travel.links.build` (`PlannerTravel.validate`/`build` dos 26 provedores), `travel.trip.list|summary` (orçamento, gasto e guardado) e `travel.trip.create|update|delete`. Pronto: allowlist e URLs idênticas às de `travel.js`
    - _Requirements: 6.16, 2.2, 2.4, 2.5, 2.6_
  - [x] 4.4 Compor o runtime em `public/app.html` e `public/app.js` e migrar os handlers de formulário
    - `skill-runtime.js` e os três arquivos de skills carregam após as fachadas; `app.js` cria o runtime com o `commit` existente e todo handler chama `runtime.invoke(id, input, { source: UI })`, sem segundo caminho de escrita; `fields` de `skill/invalid-input` vão para os campos atuais. Pronto: comportamento, copy e testes atuais preservados
    - _Requirements: 6.16, 2.12, 2.18_
  - [x] 4.5 Escrever `tests/skills/catalog.test.js` e `tests/skills/skills.test.js`: toda skill de 7.12.6 com agente, tipo e exposição corretos, validação e escrita via `commit`; `core.test.js`, `landing-login-flow.test.js` e `modo-local-init.test.js` seguem verdes
    - _Requirements: 6.16, 2.18_
  - [x] 4.6 **Property 6.16: Single UI/chat path** em `tests/properties/p6-16-single-path.test.js` · **Validates: Requirements 6.16**
- [ ] 5. Checkpoint da Etapa 1
  - Garantir que todos os testes passem e perguntar ao usuário se surgirem dúvidas. Gate de 14.13: Property 6.1–6.9, 6.15 e 6.16 e regressão das fachadas; `npm test` e, por último, `npm run verificar`, ambos verdes antes da Etapa 2
  - _Requirements: 6.1–6.9, 6.15, 6.16, 2.18_

### Etapa 2: Agente de Viagens

- [ ] 6. Servidor local modular e guarda de API
  - [ ] 6.1 Criar `vitest.config.mjs` com `setupFiles` em `tests/setup/network-guard.mjs`
    - Guard global que faz falhar qualquer conexão fora do loopback (`fetch`, `http(s).request`, `net.connect`). Pronto: um teste-sentinela prova a falha
    - _Requirements: 6.13, 5.22_
  - [ ] 6.2 Extrair `scripts/server/app-server.mjs`, `config.mjs` e `upstream.mjs` e reduzir `scripts/dev-server.mjs` à entrada
    - `app-server`: estáticos `GET/HEAD`, rewrites, `safePath`, headers atuais, CSP por página (`connect-src 'self'` só em `app.html`, também na meta; `'none'` em `index.html` e `auth.html`; `img-src 'self' data:`) e roteador `/api/*`; `config`: ambiente > `.env.local`, variáveis de 7.13.2 validadas, erro desliga só o recurso e registra o nome, nunca o valor; `upstream`: `fetchImpl` injetável, timeout, `redirect: "error"`, host fixo e teto de bytes; `.env.example` só com nomes; escuta só em loopback. Pronto: `PlannerDuo rodando` no stdout, stderr vazio sem configuração e smoke atual de `verificar-frontend.mjs` verde
    - _Requirements: 6.13, 2.6, 5.2, 5.7, 5.20_
  - [ ] 6.3 Implementar `scripts/server/api-guard.mjs` e `POST /api/status`
    - Só `POST` (demais → 405 sem `Access-Control-*`); Host exato `localhost`, `127.0.0.1` ou `[::1]` na porta vinculada; Origin igual; `Sec-Fetch-Site` `same-origin` quando presente; `X-PlannerDuo: 1`; `Content-Type: application/json`; corpo ≤ 64 KiB em stream; JSON estrito sem `__proto__`, `constructor`, `prototype` ou campo desconhecido; rate limit por rota com `Retry-After`; sem CORS e cookies; `no-store` e `nosniff`. Pronto: requisição fora da guarda nunca alcança upstream e `/api/status` nunca contém chaves
    - _Requirements: 6.13, 5.3, 5.4, 5.5, 5.7_
  - [ ] 6.4 Escrever `tests/server/*.test.js` com `fetchImpl` falso: matriz da guarda (método, Host, Origin, `Sec-Fetch-Site`, `X-PlannerDuo`, `Content-Type`, 64 KiB e 64 KiB + 1, `__proto__`, rate limit) com zero chamadas upstream, CSP por página e config sem vazar valores
    - _Requirements: 6.13, 5.3, 5.4, 5.20, 5.22_
- [ ] 7. Adapters Duffel/LiteAPI e rotas de mercado
  - [ ] 7.1 Implementar `scripts/market/duffel-flights.mjs` e `scripts/market/liteapi-stays.mjs` conforme 7.13.2
    - Duffel: `POST /air/offer_requests?return_offers=true&supplier_timeout=10000` em `api.duffel.com` com `Bearer`, `Duffel-Version: v2`, `slices`, `passengers`, `cabin_class` e `max_connections`, 15 s e 8 MiB; LiteAPI: `POST /v3.0/hotels/rates` em `api.liteapi.travel` com `X-API-Key`, ocupações, `cityName` + `countryCode` (coordenadas e raio de 15.000 m se ambígua), `limit`, `maxRatesPerHotel`, `timeout`, `includeHotelData`, `minReviewsCount` e `refundableRatesOnly`, 12 s e 4 MiB; erros `market/*` sem corpo upstream. Pronto: chaves só em closures
    - _Requirements: 6.13, 6.14_
  - [ ] 7.2 Implementar `scripts/market/normalize.mjs` e montar `POST /api/market/flights|stays` no `app-server`
    - `FlightOffer`/`StayOffer` de 7.13.3 (valor em string → unidades menores sem float, ISO 8601 → minutos, conexões com `airportChange`, `overnight` e `international`, bagagem mínima, total e `HALF_EVEN` por noite, textos limpos até 120 caracteres); acima de 1.000 voos ou 300 hospedagens ficam os de menor preço (desempate por `id`) com `truncated: true`; 30/min e 2 em voo. Pronto: fixtures normalizam sem exceção
    - _Requirements: 6.13, 6.14_
  - [ ] 7.3 Escrever `tests/market/*.test.js` com fixtures sintéticas em `tests/fixtures/market/`: URL, headers e corpo pretendidos (host exato, `Duffel-Version: v2`, `X-API-Key`, `return_offers`, `supplier_timeout`), campos ausentes ou em posição alternativa e cada erro `market/*`
    - _Requirements: 6.13, 6.14, 5.22_
  - [ ]* 7.4 Property test de robustez de `normalize.mjs`: JSON malformado gerado nunca lança e só produz oferta válida ou descarte
    - _Requirements: 6.14_
- [ ] 8. Ranking estrito `PlannerRanking`
  - [ ] 8.1 Implementar `public/modules/agents/ranking.js` (puro, relógio injetado) conforme 7.13.4
    - Primeira regra violada como motivo único (voos: `invalid`, `currency`, `expired`, `unknown-carrier`, `price-ceiling`, `stops`, `airport-change`, `short-connection`, `long-connection`, `too-slow`; hospedagem: `invalid`, `currency`, `price-ceiling`, `not-refundable`, `unrated`, `low-rating`, `few-reviews`); score inteiro 0–100 `HALF_EVEN` com os pesos de 7.13.4; ordem por score, preço, duração e `id`; rótulos `best-value`, `cheapest`, `fastest`, `flexible` e `direct`; top 5 com `cheapest`/`fastest` garantidos, até 3 motivos pt-BR de tabela fixa, resumo de descartes e fatias de até 500 ofertas. Pronto: mesma entrada e relógio produzem o mesmo resultado
    - _Requirements: 6.10, 6.11, 6.12, 6.14, 6.17_
  - [ ] 8.2 Escrever `tests/agents/ranking.test.js`: conexões de 59/60/89/90 min, troca de aeroporto, pernoite, oferta expirada, companhia ausente, moedas mistas e preço zero, negativo ou malformado
    - _Requirements: 6.10, 6.12, 6.14_
  - [ ] 8.3 **Property 6.10: Ranking soundness** em `tests/properties/p6-10-ranking-soundness.test.js` · **Validates: Requirements 6.10**
  - [ ] 8.4 **Property 6.11: Determinism and permutation invariance** em `tests/properties/p6-11-permutation.test.js` · **Validates: Requirements 6.11**
  - [ ] 8.5 **Property 6.12: Label correctness** em `tests/properties/p6-12-labels.test.js` · **Validates: Requirements 6.12**
- [ ] 9. Cliente de mercado e busca paralela
  - [ ] 9.1 Implementar `public/modules/agents/market-client.js` (`PlannerMarketClient`), único `fetch` do navegador
    - `status()`, `flights()`, `stays()` e `interpret()` só para os quatro paths same-origin, com `POST`, `X-PlannerDuo: 1`, JSON, `AbortSignal` do turno, `fetchImpl` injetável e resposta validada por schema; erros `market/*` e `assistant/*` com `retryable`. Pronto: nenhum outro arquivo de `public/` chama `fetch`
    - _Requirements: 6.13, 5.2, 5.17_
  - [ ] 9.2 Adicionar `travel.flights.search` e `travel.stays.search` a `travel-skills.js`
    - Leituras com timeout de 20 s e 15 s; cache de 5 min para voos (nunca além do menor `expiresAt`) e 10 min para hospedagem, em LRU de 50; ranking em fatias; saída com fonte, `fetchedAt`, `live` e descartes, sem conversão de moeda. Pronto: sem `market` injetado, falha com `market/not-configured`
    - _Requirements: 6.7, 6.10, 6.14_
  - [ ] 9.3 Ligar o fluxo de 7.13.5 em `orchestrator.js`
    - Perguntas destino → origem → ida → volta ou noites; 1 adulto por padrão, editável no resumo; voos ‖ hospedagem ‖ links (1 s) em paralelo, links primeiro e skeletons; sem API, upstream indisponível, circuito aberto ou zero aprovados → links dos 26 provedores com rota e datas (`deepLinkMode`) e descartes; “Salvar como viagem” → `travel.trip.create` com recibo e “Desfazer”. Pronto: sem API, o fluxo termina com links e sem preço inventado
    - _Requirements: 6.4, 6.14, 6.15, 2.4, 2.6_
  - [ ] 9.4 Escrever `tests/agents/market-client.test.js` e `tests/agents/travel-flow.test.js`: paths e headers exatos, aborto do turno, schema inválido → `market/response-invalid` e fluxo paralelo com upstream falso lento e falho e fallback para os 26 links
    - _Requirements: 6.13, 6.14, 6.15_
  - [ ] 9.5 **Property 6.14: Market data honesty** em `tests/properties/p6-14-market-honesty.test.js` · **Validates: Requirements 6.14**
- [ ] 10. Interpretação opcional por IA, desligada por padrão
  - [ ] 10.1 Implementar `scripts/assistant/` (adapters `openai-compatible` e `anthropic`) e `POST /api/assistant/interpret`
    - `PLANNERDUO_AI_PROVIDER`, `_API_KEY`, `_MODEL` e `_BASE_URL` com as regras de 7.10.2–7.10.3 (anti-SSRF, limites e tetos); entrada `{ text ≤ 1.000, pending, today }`; saída só se passar no schema `{ intent ∈ allowlist, slots tipados, confidence ∈ [0, 1] }`; erros `assistant/*` de 13.4 sem corpo upstream. Pronto: sem configuração, `/api/status` informa IA indisponível
    - _Requirements: 5.1, 5.6, 5.7, 5.8, 5.18, 5.19, 5.20_
  - [ ] 10.2 Registrar `assist.interpret` (leitura, chat) em `orchestrator.js` com o gate `AiEnabled()`
    - Exige `/api/status` com IA disponível e opt-in da sessão (provedor, host e modelo) só em memória; envia só o texto e os slots pendentes, nunca dados do workspace; JSON exato disponível em “Ver envio”; resultado mesclado com `origin = REMOTE`, e escrita vira `confirmation`. Pronto: IA desligada → zero chamadas a `interpret`
    - _Requirements: 5.1, 5.8, 5.9, 5.11, 5.21, 6.15_
  - [ ] 10.3 Escrever `tests/assistant/*.test.js` com `tests/fakes/fake-llm-upstream.mjs` em `127.0.0.1` e porta aleatória: formatos `openai-compatible` e `anthropic`, JSON inválido, intent fora da allowlist, timeout, 500 e IA desligada → zero chamadas
    - _Requirements: 5.1, 5.17, 5.19, 5.22_
  - [ ] 10.4 **Property 6.13: Key isolation and API guard** (tokens gerados ausentes de respostas, logs, `public/` e workspace) em `tests/properties/p6-13-key-isolation.test.js` · **Validates: Requirements 6.13**
- [ ] 11. Checkpoint da Etapa 2
  - Garantir que todos os testes passem e perguntar ao usuário se surgirem dúvidas. Gate de 14.13: Property 6.10–6.14, matriz da guarda e zero chamadas reais; `npm test` e, por último, `npm run verificar`, ambos verdes antes da Etapa 3
  - _Requirements: 6.10–6.14, 5.22_

### Etapa 3: Front-end

- [ ] 12. Design system minimalista e futurista
  - [ ] 12.1 Reescrever `public/style.css` com os tokens e componentes de 7.14.1–7.14.2
    - Tema escuro padrão e claro com os mesmos papéis; radiais índigo e ciano fixos em cantos opostos; glass com fallback sólido em `@supports`; pilha tipográfica local sem `@font-face` remoto; escala 16/14/13; espaços, raios, elevação e glow; movimento 120/200/320 ms e 0 ms com `prefers-reduced-motion`; foco 2 px `#3ee0ff` com offset; alvos ≥ 44 px; `tabular-nums`; botões, inputs com rótulo persistente, chips, tabs, cards, KPI, bolhas, skeleton, toast, diálogos, landing, acesso, shell, Central, cards de voo e hospedagem e tiles. Pronto: seletores usados por `app.js`, `auth.js` e testes continuam válidos
    - _Requirements: 3.6, 3.7, 3.8, 3.10, 2.8, 2.9_
  - [ ] 12.2 Escrever `tests/ui/tokens.test.js`: contraste dos pares de tokens nos dois temas (≥ 4,5:1 para texto; ≥ 3:1 para foco e bordas), nenhum `font-size` < 13 px e nenhum `@import`, `url(http` ou fonte externa
    - _Requirements: 3.6, 3.8, 2.8, 2.9_
- [ ] 13. Landing e acesso sem erro genérico
  - [ ] 13.1 Redesenhar `public/index.html` e `public/auth.html`
    - “Área de viagens” como identidade, “Buscar passagens” e “Minhas viagens” antes de finanças, layout form-first de 2.11, copy sem “cofre” ou “vault” (texto, `aria-*`, `title`, `alt`) e meta CSP com `connect-src 'none'`. Pronto: ids exigidos pelos testes e por `verificar-frontend.mjs` (`unlock-form`) preservados
    - _Requirements: 2.1, 2.7, 2.8, 2.10, 2.11, 2.12_
  - [ ] 13.2 Implementar preflight de capacidades e mapa completo de erros em `public/auth.js`, com classificação de erro em `withVaultLock` de `public/local.js`
    - Preflight de 2.13 antes da derivação de chave, com probes únicos revertidos; `SecurityError`/origem opaca em `navigator.locks.request` e página aberta por `file://` viram códigos próprios com título, mensagem, ação (abrir pelo servidor local), foco, efeito sobre os dados e retryability; máquina de estados de 13.1 (botão restaurado em até 1.000 ms, senhas limpas, cooldown de 10 s após 5 rejeições); erro desconhecido → retry + ID diagnóstico opaco. Pronto: zero ocorrências de “Não foi possível concluir a operação com segurança” para erro conhecido, com formato, chave e criptografia intactos
    - _Requirements: 2.13, 2.14, 2.15, 2.19_
  - [ ] 13.3 Escrever `tests/access-errors.test.js` e atualizar `tests/landing-login-flow.test.js`: criação de conta e entrada com `SecurityError` em Web Locks, `file://`, contexto inseguro, storage cheio e conta existente (copy, foco, botão e efeito no storage) e nenhum texto visível com “cofre” ou “vault”
    - _Requirements: 2.7, 2.13, 2.14, 2.15_
- [ ] 14. Shell, views e caça a bugs visuais
  - [ ] 14.1 Reestruturar o shell de `public/app.html`
    - Sidebar de 248 px (Central, Painel, Viagens, Finanças, Metas, Checklist, Decisões, Relatórios e Configurações), conteúdo até 1.180 px, drawer modal até 900 px (foco preso, `Escape` fecha e devolve o foco ao menu), uma coluna até 600 px e contêiner da view `central`. Pronto: `data-view-panel` e `travel-search-form` preservados
    - _Requirements: 2.1, 2.10, 2.12, 3.8_
  - [ ] 14.2 Ajustar o render de `public/app.js` e, quando necessário, `public/style.css`
    - Builders com `textContent`, estados vazio, erro e skeleton, cards alinhados, todo botão com nome acessível e ícones decorativos com `aria-hidden`; corrigir overflow de 320 px ao desktop, cortes e sobreposições em zoom 200%, textos < 13 px e alvos < 44 px. Pronto: 14.3 verde
    - _Requirements: 2.8, 2.9, 2.10, 2.12, 3.9, 3.10_
  - [ ] 14.3 Escrever `tests/ui/layout-audit.test.js`: breakpoints de 900 e 600 px, controles ≥ 44 px, nenhuma largura fixa > 320 px fora de media query, `aria-hidden` em ícones decorativos, nome em todo botão e zero “cofre” ou “vault” renderizável em `app.html` e `style.css`
    - _Requirements: 2.7, 2.8, 2.9, 2.10_
- [ ] 15. Central de agentes
  - [ ] 15.1 Implementar `public/modules/ui/central-view.js` (`PlannerCentralView`) com builders DOM seguros
    - Compositor multilinha rotulado com “Enviar”, chips, faixa de atividade `role="status"` (um anúncio por mudança e “Ver envio”) e conversa `role="log"` com `aria-live="polite"`; um renderer por tipo de bloco; cards de voo e hospedagem de 7.14.2 com linha de honestidade, “Ver opções de compra” e “Salvar como viagem”; skeleton, vazio e erro; foco após envio e após erro. Pronto: zero `innerHTML`, `outerHTML` ou `insertAdjacentHTML`
    - _Requirements: 6.14, 6.15, 6.17, 2.12, 3.9, 5.15_
  - [ ] 15.2 Criar `tests/helpers/mini-dom.mjs` (harness `node:vm`, sem dependência nova) e `tests/ui/central-view.test.js`: ordem e tipo dos blocos, chips, `role="log"` e `aria-live`, estados vazio, erro e skeleton, texto externo malicioso renderizado inerte e 30 cards
    - _Requirements: 6.14, 5.15, 2.12_
- [ ] 16. Ícones locais dos provedores (7.8.11)
  - [ ] 16.1 Criar `scripts/fetch-provider-icons.mjs`, executado só por comando explícito de desenvolvimento
    - Para os 26 `providerId`, host da URL de `PlannerTravel.build` (em `allowedHosts`): HTTPS com até 3 redirects no mesmo host, `apple-touch-icon` → maior `<link rel="icon">` → `/favicon.ico` → Google s2 (`sz=128`) só se tudo falhar; validação por assinatura (PNG, WebP, JPEG, ICO ou SVG passivo de 7.8.7), de 1 byte a 256 KiB e de 16 a 512 px; um arquivo por `providerId` e `manifest.json` com `providerId`, `host`, `source`, `sourceUrl`, `fetchedAt`, `mediaType`, `bytes` e `sha256`. Pronto: nunca importado pelo runtime nem pelos testes
    - _Requirements: 2.6, 2.19_
  - [ ] 16.2 Gerar `public/assets/providers/` com o script e trocar os tiles de `app.js` para ícone local + nome textual
    - Tiles sem `iconSvg`/`badgeFor` (`short`/`accent`), que seguem exportados na fachada; ícone ausente ou inválido mostra só o nome, nunca letra ou monograma; `alt=""` com o nome no controle; sem `filter` nem `opacity`. Pronto: nenhum SVG fabricado renderizado
    - _Requirements: 2.6, 2.9, 2.18_
  - [ ] 16.3 Escrever `tests/assets/provider-icons.test.js`: entradas únicas e coerentes com `PlannerTravel`, `sha256` de 64 hex igual aos bytes servidos pelo `app-server`, mutação de um byte reprovada, tipos e tamanhos válidos, SVG ativo rejeitado e nenhuma URL externa de asset
    - _Requirements: 2.6, 2.19, 2.20_
- [ ] 17. Checkpoint da Etapa 3
  - Garantir que todos os testes passem e perguntar ao usuário se surgirem dúvidas. Gate: matriz de 14.3 nos dois temas coberta pelos testes de DOM e de auditoria, zero “cofre” ou “vault” visível e criação de conta sem erro genérico; `npm test` e, por último, `npm run verificar`, ambos verdes antes da Etapa 4
  - _Requirements: 2.1, 2.7–2.15, 3.6–3.10_

### Etapa 4: Integração

- [ ] 18. Composição final, gate e README
  - [ ] 18.1 Compor Central, orquestrador, runtime e `market-client` em `public/app.js` e `public/app.html`
    - Módulos restantes de 7.12.3 carregados na ordem documentada; Central como tela inicial (`/app` abre `central`) com um `POST /api/status` ao abrir; bloquear, auto-lock ou sair chama `orchestrator.clear()` e `runtime.reset()` e descarta recibos, “Ver envio” e consentimento; `Ctrl+K`/`⌘K` e o botão “Comandos” abrem a paleta local (3.5); busca da view Viagens via `travel.*.search` e `travel.links.build`; Configurações → Integrações com `/api/status` (sem chaves) e opt-in da IA na sessão nomeando provedor, host e modelo. Pronto: 18.3 verde
    - _Requirements: 3.5, 5.1, 5.16, 5.21, 6.7, 6.15, 6.16_
  - [ ] 18.2 Atualizar `scripts/verificar-frontend.mjs` conforme 14.12–14.13 e o `README.md`
    - Gate: sintaxe de `public/modules/**`, CSP exata por página, `fetch(` só em `market-client.js` para os quatro paths, smoke HTTP das quatro rotas (`GET`/`OPTIONS` → 405 sem `Access-Control-*`, Host ou Origin inválidos → 403, `/api/status` sem configuração → nada disponível), varredura de chaves (`duffel_`, `sand_`/`sandbox_`/`prod_` + UUID e valores de `PLANNERDUO_DUFFEL_TOKEN`/`PLANNERDUO_LITEAPI_KEY`), proibição de `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` e `new Function` em `agents/**`, `skills/**` e `central-view.js`, manifesto de ícones e mensagem “sem dependências externas de runtime”; README: `npm run dev`, `.env.local` a partir de `.env.example` (Duffel test mode, LiteAPI sandbox e IA opcional), `node scripts/fetch-provider-icons.mjs`, `npm test` e `npm run verificar`
    - _Requirements: 6.13, 2.6, 2.20, 5.2_
  - [ ] 18.3 Escrever `tests/integration/app-composition.test.js`: bloquear e sair limpam runtime, orquestrador e consentimento; a paleta abre e devolve o foco; view Viagens e chat produzem o mesmo resultado; IA desligada → zero chamadas a `/api/assistant/interpret`
    - _Requirements: 3.5, 5.1, 6.7, 6.16_
- [ ] 19. Estresse e zero falhas
  - [ ] 19.1 Escrever `tests/stress/orchestrator-stress.test.js` e corrigir na origem toda falha encontrada: 100 mensagens em rajada (0–20 ms) contra upstream falso lento (até 25 s, relógio falso) e falho (500, timeout, JSON inválido), só o último turno renderiza, nada tardio aparece, chamadas dentro de dedupe e breaker, buscas paralelas e zero `unhandledRejection` ou `uncaughtException`
    - _Requirements: 6.5, 6.6, 6.7, 6.8, 6.17_
  - [ ] 19.2 **Property 6.17: Non-blocking UI** (1.000 caracteres, 5.000 ofertas em fatias e 30 cards sem tarefa síncrona > 50 ms por `performance.now()`) em `tests/properties/p6-17-non-blocking.test.js` · **Validates: Requirements 6.17**
  - [ ]* 19.3 Criar `scripts/browser-smoke.mjs` (Chrome ou Edge instalados via CDP e `WebSocket` nativo, app local com upstream falso): overflow horizontal em 360, 390, 768, 1024 e 1440 px, alvos ≥ 44 px, pilha tipográfica única, foco visível e zero requisições externas; sem navegador, informa “pulado” e sai com código 0
    - _Requirements: 2.10, 3.10, 6.17_
- [ ] 20. Equipe Kiro de agentes, skills e governança
  - [ ] 20.1 Criar `.kiro/agents/*.json` para os 10 agentes de 7.1–7.2
    - `orchestrator`, `architect`, `security-analyst`, `fullstack-developer`, `travel-operations-specialist`, `trip-finance-specialist`, `ai-assistant-engineer`, `ux-accessibility`, `qa-property-testing` e `documentation-release`, com responsabilidades, skills, ferramentas de menor privilégio, handoffs e limites (profundidade 4, fan-out 4, 2 tentativas); write paths de 1.12, com `ai-assistant-engineer` também em `scripts/server/**` e `scripts/market/**` (sucessores de `scripts/dev-server.mjs`). Pronto: conjuntos de escrita disjuntos
    - _Requirements: 1.2, 1.3, 1.6, 1.11, 1.12_
  - [ ] 20.2 Criar `.kiro/skills/<id>/SKILL.md` para as 21 skills de 7.3 e `.kiro/steering/agent-governance.md`
    - Domínio (Viagens 4, Finanças 5, IA 3, Plataforma 9), gatilhos e evidências por skill; steering com despacho central, menor privilégio, gates independentes, handoffs, conflitos e independência adversarial. Pronto: 20.3 verde
    - _Requirements: 1.1, 1.4, 1.5, 1.7, 1.8, 1.9, 1.10, 1.13, 1.14_
  - [ ] 20.3 Escrever `tests/kiro/agent-system.test.js`: exatamente 10 agentes e 21 skills, JSON válido, ids únicos, distribuição 4/5/3/9, toda skill carregada por um agente, handoffs acíclicos e write paths disjuntos
    - _Requirements: 1.2, 1.6, 1.11, 1.12_
- [ ] 21. Checkpoint final
  - Garantir que todos os testes passem e perguntar ao usuário se surgirem dúvidas. Gate: estresse (6.5 e 6.17), Properties 6.1–6.17 e zero rejeições não tratadas; `npm test` e `npm run verificar` por último, ambos verdes
  - _Requirements: 6.1–6.17, 1.11, 2.18, 2.20_

## Notes

- Só 7.4 e 19.3 são opcionais (`*`); os property tests 6.x são obrigatórios porque compõem os gates por etapa de 14.13.
- Ajustes vindos da diretiva: o smoke de navegador se chama `scripts/browser-smoke.mjs` (14.13 usa `smoke-browser.mjs`) e entra na Etapa 4. A reescrita de `verificar-frontend.mjs` fica em 18.2; até lá, cada etapa preserva o que o gate atual exige (`PlannerDuo rodando` no stdout, `unlock-form`, `travel-search-form`, `data-view-panel`, `iconSvg` exportado e `connect-src 'none'` em `index.html` e `auth.html`).
- Arquivos compartilhados mudam em waves distintas: `style.css` (12.1, 14.2, 16.2), `app.js` (4.4, 14.2, 16.2, 18.1), `app.html` (4.4, 6.2, 14.1, 18.1), `orchestrator.js` (3.1, 3.2, 9.3, 10.2) e `app-server.mjs` (6.2, 6.3, 7.2, 10.1).

## Task Dependency Graph

As waves 0–6 formam a Etapa 1 (checkpoint 5), 7–13 a Etapa 2 (checkpoint 11), 14–19 a Etapa 3 (checkpoint 17) e 20–23 a Etapa 4 (checkpoint 21). Nenhuma wave mistura etapas, e cada uma tem no máximo 4 tarefas.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "4.1", "4.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.3", "4.3"] },
    { "id": 3, "tasks": ["1.5", "1.6", "2.4", "3.1"] },
    { "id": 4, "tasks": ["2.5", "3.2", "4.4"] },
    { "id": 5, "tasks": ["3.3", "3.4", "4.5", "4.6"] },
    { "id": 6, "tasks": ["3.5", "3.6", "3.7"] },
    { "id": 7, "tasks": ["6.1", "8.1", "9.1"] },
    { "id": 8, "tasks": ["6.2", "8.2", "8.3", "8.4"] },
    { "id": 9, "tasks": ["6.3", "7.1", "8.5", "9.2"] },
    { "id": 10, "tasks": ["6.4", "7.2", "9.3"] },
    { "id": 11, "tasks": ["7.3", "7.4", "9.4", "10.1"] },
    { "id": 12, "tasks": ["9.5", "10.2"] },
    { "id": 13, "tasks": ["10.3", "10.4"] },
    { "id": 14, "tasks": ["12.1", "16.1"] },
    { "id": 15, "tasks": ["12.2", "13.1", "15.1"] },
    { "id": 16, "tasks": ["13.2", "14.1", "15.2"] },
    { "id": 17, "tasks": ["13.3", "14.2"] },
    { "id": 18, "tasks": ["14.3", "16.2"] },
    { "id": 19, "tasks": ["16.3"] },
    { "id": 20, "tasks": ["18.1", "18.2", "20.1", "20.2"] },
    { "id": 21, "tasks": ["18.3", "20.3"] },
    { "id": 22, "tasks": ["19.1", "19.3"] },
    { "id": 23, "tasks": ["19.2"] }
  ]
}
```
