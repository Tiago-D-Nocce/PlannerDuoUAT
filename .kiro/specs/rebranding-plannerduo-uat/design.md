# Documento de Design

## Visão geral

Este design transforma o PlannerDuo de uma aplicação estritamente offline (cofre local criptografado + servidor estático) em uma aplicação conectada com back-end Node.js + Express, API REST, persistência remota, autenticação de rede por sessão de servidor e migração única dos dados do navegador — ao mesmo tempo em que aplica o rebranding visual azul + laranja e a nova narrativa de ambiente conectado, sem quebrar rotas, serviços de IA ou o estado global existentes.

O design é deliberadamente incremental sobre a base atual, descoberta na fase de clarificação:

- Front-end em JavaScript vanilla servido de `public/` (`index.html`, `auth.html`, `app.html`, `app.js`, `core.js`, `auth.js`, `local.js`, `travel.js`, `style.css`, `modules/agents`, `modules/skills`, `modules/ui`), sem bundler nem etapa de build.
- Camada de dados atual encapsulada em `window.PlannerLocal` (`local.js`): `auth.restoreSession/unlock/createVault/lock/status`, `initialize/load/update/subscribe`. O domínio puro vive em `window.PlannerCore` (`core.js`): `createEmptyWorkspace`, `normalizeWorkspace`, cálculos de settlement, recorrência e voto.
- `app.js` mantém um objeto `state` em memória (o Estado_Global), inicializado por `init()` que faz `Repository.auth.restoreSession()` → `Repository.initialize()` → `materializeRecurring()` → `createSkillRuntime()`.
- CSP atual com `connect-src 'none'` em `index.html`/`auth.html`/`app.html` e em `scripts/dev-server.mjs`.
- `scripts/dev-server.mjs` é um servidor estático GET/HEAD, sem rotas de API nem persistência.
- `package.json`: nome `plannerduo` v1.0.0, scripts `dev`/`test`/`verificar`, devDeps `vitest` + `fast-check`, sem dependências de runtime (Express ainda não presente).
- `.git/config`: `remote origin = https://github.com/Tiago-NoccePRD/PlannerDuoUAT.git`, `user.name = Tiago-NoccePRD`, `user.email = tiagonoccecontato@gmail.com`.
- Testes em `tests/` com Vitest + fast-check, incluindo propriedades em `tests/properties/`.

A estratégia central é **preservar `PlannerCore` intacto** (as regras de domínio e a normalização são reutilizadas no cliente e no servidor) e **substituir a implementação de `PlannerLocal` por um cliente de API** com a mesma superfície pública (`auth.*`, `initialize`, `load`, `update`, `subscribe`), de modo que `app.js` e os módulos de IA continuem funcionando com mudanças mínimas (atende ao Requisito 8).

### Mapa de requisitos → seções

| Requisito | Seções de design |
|---|---|
| 1 — Back-end e API REST | Arquitetura; API_PlannerDuo; Modelos de dados; Tratamento de erros |
| 2 — Autenticação de rede e sessão | API_PlannerDuo (Auth/Sessão); SessionStore; Tratamento de erros |
| 3 — Aposentadoria do cofre | Front-end (refatoração de auth); `local.js`/`auth.js`/`auth.html` |
| 4 — Migração única | Serviço de Migração; Front-end (fluxo de migração) |
| 5 — CSP para rede real | CSP e cabeçalhos; API_PlannerDuo (middleware) |
| 6 — Identidade visual azul + laranja | Rebranding (tokens e componentes) |
| 7 — Narrativa conectada | Rebranding (narrativa e barra lateral) |
| 8 — Preservação de rotas/IA/estado | Front-end (cliente de API); compatibilidade |
| 9 — Tensão arquitetural | Artefato de superseção |
| 10 — Identidade Git/ambiente | Migração de identidade e ambientes |

## Arquitetura

### Diagrama de componentes

```
┌───────────────────────────────────────────────────────────────┐
│                        Front_End (public/)                      │
│                                                                 │
│  index.html / auth.html / app.html   (CSP: connect-src API)     │
│  ┌───────────┐  ┌───────────┐  ┌──────────────────────────┐    │
│  │ core.js   │  │ auth.js   │  │ app.js  (Estado_Global)   │    │
│  │ PlannerCore│ │ (rede)    │  │ state{workspace,account} │    │
│  └─────┬─────┘  └─────┬─────┘  └────────────┬─────────────┘    │
│        │               │                     │                  │
│        │        ┌──────┴─────────────────────┴──────┐           │
│        └───────▶│ local.js → ApiRepository (cliente) │           │
│                 │ auth.* / initialize/load/update/sub │          │
│                 └──────────────────┬──────────────────┘          │
│  modules/agents (orchestrator, skill-runtime, nlu, places)       │
└───────────────────────────────────┼─────────────────────────────┘
                                     │ fetch (HTTPS/JSON, cookie de sessão)
                                     ▼
┌───────────────────────────────────────────────────────────────┐
│                 API_PlannerDuo  (Node.js + Express)             │
│  scripts/server/                                                │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────────────┐    │
│  │ csp.js    │ │ session.js│ │ auth-rate │ │ static.js    │    │
│  │ (headers) │ │ (sessão)  │ │ (lockout) │ │ (serve pages)│    │
│  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └──────┬───────┘    │
│        └─────────────┴─────────────┴──────────────┘            │
│                         Rotas REST                              │
│  /api/auth/{login,logout,session}                               │
│  /api/{finances,trips,goals,checklist,decisions}  (CRUD)        │
│  /api/migration/{status,run}                                    │
│                         │                                       │
│                 ┌───────┴────────┐                              │
│                 │ Camada_de_Persistencia │                      │
│                 │  (SQLite ou JSON file) │                      │
│                 └────────────────────────┘                      │
└───────────────────────────────────────────────────────────────┘
```

### Decisões de arquitetura

1. **Reutilização de `PlannerCore` no servidor.** `core.js` já é um módulo UMD (`module.exports` quando em Node). O servidor importa `PlannerCore` para `normalizeWorkspace` e validações, garantindo que a mesma lógica de domínio valide os dados no cliente e no servidor. Isso evita divergência de contrato (Requisito 8.2) e dá uma fonte única de verdade para os formatos.

2. **`PlannerLocal` vira fachada de cliente de API.** Mantemos exatamente a superfície consumida por `app.js` (`Repository.auth.restoreSession/unlock/lock/status`, `Repository.initialize/load/update/subscribe`, mais `Repository.VAULT_KEY`/`AUTH_EVENT_KEY`/`AUTH_EPOCH_KEY` referenciados por listeners de `storage`). A nova implementação (`ApiRepository`) troca criptografia local por chamadas `fetch`. O código antigo de cofre é extraído para `local-vault-legacy.js` e **não é carregado** nas páginas em produção (Requisito 3.2, 3.5).

3. **Sessão por cookie HttpOnly + token espelhado.** A sessão de servidor é um cookie `HttpOnly; Secure; SameSite=Strict`. O cliente também guarda em `sessionStorage` apenas metadados não sensíveis (`account`, `expiresAt`) para decidir rapidamente se precisa redirecionar ao login (Requisito 2.7), sem armazenar segredo.

4. **Persistência plugável atrás de uma interface.** `PersistenceLayer` define `read(userId)` / `write(userId, workspace)` / `transaction(fn)`. Duas implementações: `JsonFilePersistence` (padrão, zero dependências nativas) e `SqlitePersistence` (opcional via `better-sqlite3`). A escolha é por `PERSISTENCE_DRIVER` no `.env`. O requisito aceita SQLite **ou** JSON (Requisito 1.2); o padrão é JSON em arquivo para manter o projeto sem dependências nativas de build.

5. **Servidor único serve API + páginas.** `scripts/server/index.mjs` evolui o `dev-server.mjs` atual: mantém o roteamento estático e os rewrites (`/app`, `/auth`), adiciona as rotas `/api/*` e aplica a nova CSP a toda resposta de página (Requisito 5.3). `dev-server.mjs` é mantido como atalho fino que delega ao novo servidor para não quebrar `npm run dev`.

### Layout de arquivos

```
scripts/
  server/
    index.mjs            # cria o app Express, monta middlewares e rotas, listen()
    config.mjs           # lê .env: PORT, API_ORIGIN, PERSISTENCE_DRIVER, SESSION_TTL, ENVIRONMENT
    middleware/
      csp.mjs            # monta e valida o header CSP (Req 5)
      session.mjs        # cria/valida/renova sessão, guarda de recurso protegido (Req 1.6,1.7,2.2,2.7)
      auth-rate.mjs      # contador de tentativas + lockout 5/15min (Req 2.4)
      errors.mjs         # normaliza erros → corpo { error: { code, message } } (Req 1.5)
    routes/
      auth.mjs           # POST /api/auth/login, /logout, GET /api/auth/session (Req 2)
      resource.mjs       # fábrica CRUD genérica por domínio (Req 1.1,1.3,1.4)
      migration.mjs      # GET /api/migration/status, POST /api/migration/run (Req 4)
      pages.mjs          # serve HTML/estáticos com CSP (Req 5.3,5.5)
    persistence/
      index.mjs          # seleciona driver
      json-file.mjs      # JsonFilePersistence (padrão)
      sqlite.mjs         # SqlitePersistence (opcional)
      session-store.mjs  # SessionStore (sessões + tentativas), em memória com snapshot
    identity.mjs         # constantes PRD/UAT e caminhos /Dev (Req 10.4,10.5)
  identity-migrate.mjs   # CLI de migração de identidade Git/.env/CI (Req 10)
  dev-server.mjs         # delega a scripts/server/index.mjs (compat npm run dev)
public/
  local.js               # ApiRepository (nova fachada de cliente de API)
  local-vault-legacy.js  # cofre antigo extraído, NÃO referenciado em produção (Req 3.5)
  migration-client.js    # orquestra a migração única no navegador (Req 4)
  auth.js                # fluxo de login/registro de rede (sem cofre) (Req 3)
docs/
  decisions/
    0001-superseção-offline-para-conectado.md   # artefato versionado (Req 9)
.env.example             # modelo de ambiente (Req 10.6)
deploy/
  uat.env  prd.env       # ambientes (Req 10.5,10.6)
.github/workflows/
  ci.yml  deploy-uat.yml  deploy-prd.yml         # CI/CD (Req 10.6)
```

## Componentes e interfaces

### 1. API_PlannerDuo (back-end) — Requisito 1, 2, 5

#### Contratos REST

Todos os corpos são JSON (`application/json; charset=utf-8`). Os domínios de recurso são `finances`, `trips`, `goals`, `checklist`, `decisions`.

Autenticação:

| Método | Rota | Corpo (req) | Resposta (sucesso) | Erros |
|---|---|---|---|---|
| POST | `/api/auth/login` | `{ identifier, credential }` | `200 { account:{ name,email }, expiresAt }` + cookie de sessão | `400 auth/invalid-input`, `401 auth/invalid-credentials`, `429 auth/locked` |
| POST | `/api/auth/logout` | — | `204` (sessão invalidada) | `401 auth/no-session` |
| GET | `/api/auth/session` | — | `200 { account, expiresAt }` (renova) | `401 auth/session-expired` |

Recursos (padrão por domínio `:domain`):

| Método | Rota | Resposta | Observações |
|---|---|---|---|
| GET | `/api/:domain` | `200 { items:[...] }` | leitura (Req 1.4) |
| POST | `/api/:domain` | `201 { item }` | cria; valida por `PlannerCore` (Req 1.3) |
| PUT | `/api/:domain/:id` | `200 { item }` | atualiza (Req 1.3) |
| DELETE | `/api/:domain/:id` | `200 { ok:true }` | remove (Req 1.3) |

Migração:

| Método | Rota | Corpo (req) | Resposta |
|---|---|---|---|
| GET | `/api/migration/status` | — | `200 { completed:boolean, completedAt? }` |
| POST | `/api/migration/run` | `{ workspace }` (dados locais normalizados) | `200 { completed:true, counts }` ou `409 migration/already-done` ou `422 migration/partial` |

Formato de erro padrão (middleware `errors.mjs`):

```json
{ "error": { "code": "auth/invalid-credentials", "message": "Credenciais inválidas." } }
```

#### Middleware de sessão (`session.mjs`) — Requisito 1.6, 1.7, 2.2, 2.7

```text
interface Session {
  id: string            // UUID aleatório (cookie)
  userId: string        // identificador de rede normalizado
  account: { name, email }
  lastAccessAt: number  // epoch ms
  expiresAt: number     // lastAccessAt + SESSION_TTL (60 min)
}

function requireSession(req, res, next):
  session = sessionStore.get(cookie.sid)
  if (!session) → 401 auth/session-expired, não executa operação de dados
  if (now() >= session.expiresAt) → sessionStore.delete; 401 auth/session-expired
  session.lastAccessAt = now()                 // sliding
  session.expiresAt = now() + SESSION_TTL      // renova (Req 2.2)
  req.session = session
  next()
```

Toda rota de recurso e de migração monta `requireSession` antes do handler, garantindo que nenhuma operação de dados ocorra sem sessão válida (Req 1.6) e que sessão ausente/expirada retorne erro de auth sem dados (Req 1.7).

#### Lockout (`auth-rate.mjs`) — Requisito 2.4

```text
interface AttemptRecord { fails: number; firstFailAt: number; lockedUntil: number }

onLoginAttempt(identifier, success):
  rec = attempts.get(identifier) ?? { fails:0, firstFailAt:0, lockedUntil:0 }
  if (now() < rec.lockedUntil) → reject 429 auth/locked
  if (success) → attempts.delete(identifier)
  else:
    rec.fails += 1
    if (rec.fails >= 5) rec.lockedUntil = now() + 15*60*1000   // bloqueia 15 min
    attempts.set(identifier, rec)
```

A validação de credenciais acontece antes de contar a tentativa; identificadores com 1–254 caracteres e credenciais com 8–128 caracteres passam na validação de forma (Req 2.1); fora desses limites retorna `400 auth/invalid-input` sem contar como tentativa de lockout.

#### SessionStore (`session-store.mjs`)

Em memória (Map) com snapshot periódico opcional em arquivo para sobreviver a reinício em UAT. Expõe `create`, `get`, `delete`, `touch`. Tentativas de lockout são mantidas no mesmo módulo. Importante: dados de domínio (workspaces) ficam na `PersistenceLayer`, não aqui.

### 2. Camada_de_Persistencia — Requisito 1.2, 1.5

```text
interface PersistenceLayer {
  read(userId): Promise<Workspace>              // normalizeWorkspace garante shape
  write(userId, workspace): Promise<Workspace>  // atômico; retorna estado gravado
  transaction(userId, fn): Promise<Result>      // snapshot + rollback em falha
}
```

- `JsonFilePersistence`: um arquivo por usuário em `data/{userId}.json`. Escrita atômica via arquivo temporário + `rename`. `transaction` lê snapshot, aplica `fn`, grava; em qualquer exceção não grava nada (preserva o estado anterior — Req 1.5).
- `SqlitePersistence`: tabela por domínio com `user_id` + `payload` JSON; `transaction` usa transação SQL (BEGIN/COMMIT/ROLLBACK). Mesmo contrato.

Durabilidade (Req 1.2): como ambos escrevem em disco, reinstanciar a camada sobre o mesmo arquivo/banco relê os dados idênticos.

### 3. Front-end: `ApiRepository` (nova `local.js`) — Requisito 3, 8

Mantém a superfície consumida por `app.js`:

```text
PlannerLocal = {
  VAULT_KEY, AUTH_EVENT_KEY, AUTH_EPOCH_KEY,   // mantidos como chaves de evento de sessão
  auth: {
    restoreSession(): Promise<{account,expiresAt}|null>  // GET /api/auth/session
    unlock({identifier, credential}): Promise<{account}>  // POST /api/auth/login
    lock({allTabs}): Promise<void>                        // POST /api/auth/logout
    status(): { connected:boolean, account }              // sem conceito de cofre
  },
  initialize(): Promise<Workspace>   // GET /api/* agregando domínios → workspace
  load(): Promise<Workspace>
  update(mutator, expectedGeneration): Promise<Workspace>  // optimistic → PUT/POST/DELETE
  subscribe(cb): unsubscribe          // polling leve + BroadcastChannel entre abas
}
```

Pontos de preservação (Requisito 8):

- `initialize()`/`load()` reconstroem o mesmo objeto `workspace` (via `PlannerCore.normalizeWorkspace`) que `app.js` já espera; `generation`/`revision` continuam existindo para o controle otimista de `update()`. O tratamento de `local/workspace-replaced` em `app.js` é mantido mapeando conflito de revisão do servidor (`409`) para o mesmo `error.code`.
- `subscribe()` troca o antigo evento de `storage` por `BroadcastChannel('plannerduo:session')` + um poll leve de revisão; a assinatura de callback `(workspace) => void` não muda.
- O Estado_Global (`state` em `app.js`) e a sequência de `init()` permanecem; só a fonte dos dados muda de cofre para API. Após reinício, `initialize()` reidrata `state.workspace` a partir do último estado confirmado na API (Req 8.4). Se a resposta divergir de um cache local eventual ou vier corrompida, o cliente sinaliza e **não** reescreve o remoto (Req 8.6).

Serviços de IA: `modules/agents/*` consomem `getState()`/`state.workspace` e `createSkillRuntime()`; como o shape do workspace e as rotas de hash não mudam, o contrato de requisição/resposta do orquestrador é preservado (Req 8.2).

### 4. Refatoração de autenticação — Requisito 3

- `auth.html`: remover a view de cofre (`setup`/`recovery` com senha de cofre, aviso de não recuperação, "E-mail local", strength de senha de cofre) e deixar um único formulário de login de rede (identificador/e-mail + credencial) e um registro amigável. Remover `local.js` do cofre do `<script>` e carregar a nova `local.js` (cliente de API). Resultado: um único caminho de autenticação ativo (Req 3.3).
- `auth.js`: reescrever `initialize()` e os handlers para chamar `Repository.auth.unlock({identifier, credential})` e `restoreSession()`; remover `createVault`, `destroyVault`, `exportRawVault`, `exportRawLegacy`, derivação de chave e os textos de cofre. O contador de 5 tentativas no cliente passa a refletir a resposta `429` do servidor. Em falha, nega acesso e exibe erro sem tocar cofre (Req 3.4).
- `local.js` (cofre) → extraído para `local-vault-legacy.js`, não referenciado em nenhuma página em produção. Nenhum caminho executável de auth/persistência invoca PBKDF2/AES-GCM (Req 3.2); qualquer evento de usuário na tela de auth aciona só o fluxo de rede (Req 3.5).
- `app.html`: a ação `lock-vault` vira `logout` (chama `Repository.auth.lock`), e os painéis de "Conta e segurança"/"Privacidade local" perdem a narrativa e a menção a AES-GCM.

### 5. CSP e cabeçalhos — Requisito 5

Função única `buildCsp(apiOrigin)` em `csp.mjs`, usada tanto para gerar o header de resposta quanto para injetar o `<meta>` nas páginas HTML servidas:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'self' {API_ORIGIN};   ← afrouxado (antes 'none')
object-src 'none';
base-uri 'self';                    ← ajustado de 'none' para 'self' (Req 5.4)
form-action 'self';
frame-ancestors 'none'
```

- `API_ORIGIN` = esquema + host + porta do endpoint da API (Req 5.1). Quando a API serve as próprias páginas, `connect-src` contém a origem da própria API (Req 5.3).
- `pages.mjs` chama `assertCsp(headerValue, apiOrigin)` antes de responder: se o header estiver ausente ou `connect-src` não contiver a origem da API, responde `500 csp/invalid-config` e **não** serve a página (Req 5.5).
- As três páginas HTML (`index.html`, `auth.html`, `app.html`) têm seu `<meta http-equiv="Content-Security-Policy">` atualizado para a mesma política (fonte de verdade compartilhada com o servidor via geração/substituição no `pages.mjs`).

### 6. Serviço de Migração única — Requisito 4

Cliente (`migration-client.js`) + servidor (`routes/migration.mjs`).

Fluxo no primeiro acesso autenticado:

```text
1. GET /api/migration/status
   if completed → segue direto para initialize() (Req 4.6)
2. Coletar dados locais do navegador:
   - lê workspace do armazenamento legado (localStorage) e, se houver cofre antigo,
     os dados já descriptografados em memória nesta sessão.
   - normaliza com PlannerCore.normalizeWorkspace
3. Exibir indicação de progresso; marcar flag em memória para impedir concorrência (Req 4.2)
4. POST /api/migration/run { workspace }
   servidor executa em transação:
     - grava finances/trips/goals/checklist/decisions
     - se tudo OK em ≤ DEADLINE (30s simulável) → grava marcador de conclusão (Req 4.3)
     - senão → ROLLBACK total, sem marcador, retorna 422 migration/partial (Req 4.5)
5. sucesso → Front_End passa a ler/gravar via API (Req 4.4); dados locais podem ser
   preservados mas não são mais fonte de verdade.
   falha → preserva dados locais, exibe erro (Req 4.5)
```

Exclusão mútua (Req 4.2): guarda de concorrência no cliente (uma promessa única `migrationInFlight`) e, no servidor, um lock por usuário no `SessionStore` durante `migration/run`; disparos adicionais recebem `409`.

Idempotência (Req 4.6): o marcador de conclusão é consultado em `migration/status`; se existir, `run` responde `409 migration/already-done` e o cliente omite a transferência.

### 7. Rebranding visual e narrativo — Requisito 6, 7, 9.2

#### Tokens de tema (`style.css`, `:root` e `[data-theme]`)

```css
:root {
  --primary:      #0066FF;   /* Req 6.1: faixa #0066FF–#2563EB */
  --primary-2:    #2563EB;
  --accent-from:  #FF7700;   /* Req 6.2: faixa #FF7700–#FF8C00 */
  --accent-to:    #FF8C00;
  --accent: linear-gradient(135deg, #FF7700, #0066FF); /* destaque→primária (Req 6.7) */
  --bg:           #0B0F19;   /* Req 6.3: faixa #0B0F19–#0F172A */
  --radius:       14px;      /* Req 6.5: faixa 12–16px */
  --radius-sm:    12px;
  --radius-lg:    16px;
  --glow: 0 0 0 1px rgba(0,102,255,.35), 0 0 24px rgba(255,119,0,.20); /* Req 6.6 */
  --shadow: 0 10px 30px rgba(11,15,25,.45);
}
body { font-family: Inter, "Segoe UI Variable Text", "Segoe UI", system-ui,
                   -apple-system, Roboto, sans-serif; } /* Req 6.4 + fallback 6.11 */
```

Componentes:

- Botão de envio do chat: `background: linear-gradient(135deg, var(--accent-from), var(--primary))` (laranja→azul, Req 6.7).
- Logo PlannerDuo (`.brand-mark`): ícone com `background: linear-gradient(135deg, var(--primary), var(--accent-from))` e `-webkit-background-clip` para o texto (Req 6.8).
- Chips de sugestão rápida: contorno em gradiente via `border-image`/pseudo-elemento combinando `--primary` e `--accent-from` (Req 6.9); regra `:hover` com elevação/intensificação do brilho (Req 6.10).
- Ícones de módulo redesenhados + badge de notificação laranja (`--accent-from`); o badge usa `hidden` quando a contagem é 0 (Req 7.5, 7.6) — reaproveita os elementos `#nav-finance-count`/`#nav-decision-count` já presentes, generalizando para os 7 módulos.

#### Narrativa e barra lateral (`index.html`, `auth.html`, `app.html`) — Requisito 7, 9.2

- Remover todas as strings da Narrativa_de_Isolamento (conjunto exato do Req 7.1): "Espaço Local", "Workspace Local", "100% LOCAL · SEM SERVIDOR", "Tudo no seu navegador", "Cofre", "Modo Isolado", "E-mail local"; e qualquer texto de não recuperação por e-mail (Req 7.2). Também zerar "Cofre"/"vault" (case-insensitive) em toda a UI (Req 9.2).
  - `index.html`: pill, hero, features e nota de segurança reescritos para a narrativa conectada.
  - `auth.html`: kicker "ESPAÇO LOCAL", labels "E-mail local", aviso "Não há recuperação por e-mail" e textos de cofre removidos.
  - `app.html`: eyebrows e descrições ("WORKSPACE LOCAL", "PRIVACIDADE LOCAL", "Criptografado neste navegador", AES-GCM) reescritas; ação/label "Bloquear" sem terminologia de cofre.
- Topo da barra lateral passa a exibir simultaneamente (Req 7.3): rótulo **"Ambiente conectado"**, tag **"Tiago-NoccePRD"** e indicador de status com texto **"Online"**.
- Lista de módulos reorganizada para exatamente os 7, nesta ordem (Req 7.4): **Assistente, Visão geral, Finanças, Viagens, Metas, Checklist, Decisões**. (As entradas atuais "Relatórios"/"Configurações" saem do grupo dos 7 módulos de navegação principal; se mantidas, ficam em uma seção utilitária separada, fora do contrato dos 7.)

### 8. Artefato de superseção — Requisito 9

`docs/decisions/0001-superseção-offline-para-conectado.md`, versionado no Git, com campos obrigatórios:

```markdown
# ADR 0001 — Superseção da premissa offline para conectada

- Spec substituída (identificador): multi-agent-code-architecture
  (specId cf23f136-ff0c-424c-8c43-ba04373f3990)
- Data da decisão (ISO 8601): 2025-01-15T00:00:00Z
- Premissa anterior: operação 100% offline, sem servidor, proibindo terminologia de "vault" na UI.
- Premissa adotada: operação conectada (Node.js + Express, API REST, persistência remota,
  autenticação de rede), aposentando o cofre local.
- Resolução de conflito: onde houver conflito entre a premissa offline da spec
  multi-agent-code-architecture e esta direção conectada, prevalece a direção conectada
  desta spec (rebranding-plannerduo-uat).
```

A ausência do arquivo ou de qualquer campo obrigatório caracteriza não conformidade (Req 9.4); a resolução do conflito é registrada no mesmo artefato (Req 9.3).

### 9. Migração de identidade Git e de ambiente — Requisito 10

CLI `scripts/identity-migrate.mjs` (idempotente, atômica):

```text
IDENTITIES = {
  PRD: { name:'Tiago-NoccePRD', path:'Dev/Tiago-NoccePRD' },  // Req 10.4,10.5
  UAT: { name:'PlannerDuoUAT',  path:'Dev/PlannerDuoUAT'  },
}
FORBIDDEN = ['Tiago-Nocce', 'PlannerDuo1.0']   // termos antigos (Req 10.2)

migrate(target):
  1. ler .git/config atual (dry-run em cópia na memória)
  2. definir remote.origin.url, user.name, user.email conforme target (Req 10.1)
  3. gerar/ajustar .env, deploy/*.env, .github/workflows/* para referenciar só o target
  4. VARREDURA FINAL: se qualquer FORBIDDEN permanecer em algum campo/arquivo gerado,
     abortar sem gravar nada e listar cada ocorrência (Req 10.3); config original intacta
  5. só então gravar as mudanças atomicamente
```

Observação sobre o estado atual: `.git/config` já aponta para `Tiago-NoccePRD`/`PlannerDuoUAT`; o termo problemático a remover é a substring **`Tiago-Nocce`** (sem o sufixo `PRD`) e `PlannerDuo1.0`. A verificação do Req 10.2/10.3 trata `Tiago-NoccePRD` como válido e só sinaliza ocorrências de `Tiago-Nocce` que **não** façam parte de `Tiago-NoccePRD` (correspondência por token exato, não substring ingênua).

## Modelos de dados

Reutiliza o schema de `PlannerCore` (um `Workspace` por usuário):

```text
Workspace {
  format: 'plannerduo-workspace'; schemaVersion: 1; id: 'workspace-local';
  generation: string; revision: int;
  participants[]; finances[]; trips[]; goals[]; checklist[]; decisions[];
  budgets{}; settings{ currency:'BRL', defaultSplit:'equal', onboardingCompleted };
  createdAt; updatedAt;
}
```

No servidor, cada domínio é persistido como coleção dentro do workspace do usuário; a API expõe CRUD por domínio mas a `PersistenceLayer` grava o workspace completo de forma atômica (ou por tabela, no SQLite). `generation`/`revision` suportam o controle otimista: `update()` envia `expectedGeneration`; divergência → `409` mapeado para `local/workspace-replaced`.

Entidades auxiliares do servidor:

```text
Session { id, userId, account:{name,email}, lastAccessAt, expiresAt }
AttemptRecord { identifier, fails, firstFailAt, lockedUntil }
MigrationMarker { userId, completedAt (ISO 8601) }
```

## Tratamento de erros

| Situação | Camada | Resposta/Comportamento | Req |
|---|---|---|---|
| Falha na persistência (escrita) | API | `transaction` faz rollback, estado anterior intacto, `500 data/persist-failed`, nunca sucesso | 1.5 |
| Recurso protegido sem sessão | API | `401 auth/session-expired`, nenhum dado de domínio no corpo | 1.7, 2.7 |
| Credenciais inválidas | API | `401 auth/invalid-credentials`, dados remotos inalterados | 2.3 |
| 5+ falhas consecutivas | API | `429 auth/locked` por 15 min | 2.4 |
| CSP inválida ao servir página | API | `500 csp/invalid-config`, não serve a página | 5.5 |
| Migração parcial/timeout | API+cliente | rollback remoto, sem marcador, dados locais preservados, erro exibido | 4.5 |
| Conflito de revisão em `update()` | cliente | `error.code = 'local/workspace-replaced'`, recarrega estado remoto | 8.3 |
| Cache corrompido/divergente | cliente | sinaliza inconsistência, não sobrescreve remoto | 8.6 |
| Rota inexistente | cliente | indicação de erro de navegação, Estado_Global inalterado | 8.5 |
| Identidade antiga remanescente | CLI | aborta migração, lista ocorrências, config original preservada | 10.3 |
| Artefato de superseção ausente/incompleto | verificação | não conformidade sinalizada | 9.4 |

Formato uniforme no servidor: `{ error: { code, message } }`. No cliente, `local.js` traduz `code` → mensagem amigável (como o `errorMessage` atual de `auth.js`, agora com códigos `auth/*` e `data/*`).

## Estratégia de testes

Mantém o conjunto existente (Vitest + fast-check, `tests/` com `tests/properties/` e os helpers `tests/helpers/mini-dom.mjs`, `auth-harness.mjs`).

- **Testes unitários (exemplos/edge/integração):** latência de leitura/escrita (SLA 1.4/2.1/2.5 como exemplos), composição fixa do topo da barra lateral e dos 7 módulos (7.3/7.4), tokens de fonte/gradientes de logo/botão/chips (6.4/6.6/6.7/6.8/6.9/6.10/6.11), igualdade de constantes de identidade e caminhos (10.4/10.5), execução feliz da migração de identidade (10.1), e enforcement de CSP no navegador (5.2) como integração/manual.
- **Testes de propriedade (fast-check, ≥ 100 iterações):** conforme a seção de Correctness Properties. Cada teste referencia a propriedade de design no formato de tag **Feature: rebranding-plannerduo-uat, Property N: ...**.
- **Isolamento:** a `PersistenceLayer` roda sobre arquivo temporário/`memfs`; o relógio (`now()`) é injetável para propriedades temporais (expiração/lockout/deadline de migração); rotinas de cofre são espionadas via wrapper de `crypto.subtle` para afirmar zero invocações.
- **Novas dependências de runtime:** adicionar `express` (e opcionalmente `better-sqlite3` apenas quando `PERSISTENCE_DRIVER=sqlite`). Pinar versões exatas no `package.json`.

## Correctness Properties

*Uma propriedade é uma característica ou comportamento que deve ser verdadeiro em todas as execuções válidas do sistema — uma afirmação formal sobre o que o sistema deve fazer. Propriedades fazem a ponte entre especificações legíveis por humanos e garantias de correção verificáveis por máquina.*

### Property 1: Round-trip de CRUD com durabilidade

Para qualquer sessão válida e qualquer entidade válida de qualquer domínio (finanças, viagens, metas, checklists, decisões), criar e então ler retorna a entidade gravada; atualizar e ler reflete a atualização; excluir e ler não retorna a entidade; e, após reinstanciar a Camada_de_Persistencia sobre o mesmo armazenamento, as leituras permanecem idênticas.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Guarda de sessão no servidor

Para qualquer requisição a um recurso protegido sem Sessao_de_Servidor válida (ausente ou expirada), a API_PlannerDuo responde com erro de autenticação, não executa nenhuma operação na Camada_de_Persistencia e não inclui dados do usuário no corpo.

**Validates: Requirements 1.6, 1.7**

### Property 3: Atomicidade sob falha de operação

Para qualquer operação de dados ou tentativa de autenticação que falhe na Camada_de_Persistencia ou por credenciais inválidas, o estado remoto lido depois é idêntico ao estado anterior e a resposta não indica sucesso.

**Validates: Requirements 1.5, 2.3**

### Property 4: Expiração deslizante de 60 minutos

Para qualquer sequência de acessos a uma Sessao_de_Servidor, a sessão é válida se e somente se o acesso ocorre em até 60 minutos após o último acesso; cada acesso dentro da janela renova a expiração para 60 minutos a partir daquele acesso.

**Validates: Requirements 2.2**

### Property 5: Bloqueio após 5 tentativas por 15 minutos

Para qualquer identificador e qualquer sequência de tentativas de autenticação, novas tentativas são bloqueadas se e somente se houve 5 ou mais falhas consecutivas e o instante atual está dentro de 15 minutos a partir do bloqueio.

**Validates: Requirements 2.4**

### Property 6: Validação de limites de credenciais e invalidação no logout

Para qualquer par (identificador, credencial), a API aceita a tentativa de validação se e somente se o identificador tem de 1 a 254 caracteres e a credencial tem de 8 a 128 caracteres; e, para qualquer sessão ativa, após o logout a validação subsequente dessa sessão falha.

**Validates: Requirements 2.1, 2.5**

### Property 7: Ausência de invocação de rotinas de cofre

Para qualquer fluxo de autenticação de rede (sucesso ou falha) e qualquer operação de persistência de dados, nenhuma rotina de Cofre_Local (derivação PBKDF2-SHA-256 ou criptografia/descriptografia AES-GCM) é invocada.

**Validates: Requirements 2.6, 3.2, 3.4, 3.5**

### Property 8: Sessão expirada força nova autenticação no cliente

Para qualquer Sessao_de_Servidor expirada ou invalidada, qualquer tentativa do Front_End de acessar dados remotos resulta em exigência de nova Autenticacao_de_Rede antes de conceder acesso.

**Validates: Requirements 2.7**

### Property 9: Completude da migração

Para qualquer conjunto de dados locais válidos, após uma Migracao_de_Dados concluída com sucesso, a Camada_de_Persistencia contém exatamente os mesmos registros das categorias finanças, viagens, metas, checklists e decisões presentes nos dados locais.

**Validates: Requirements 4.1**

### Property 10: Disparo único da migração

Para qualquer número de disparos concorrentes ou sobrepostos de Migracao_de_Dados, no máximo uma execução de transferência ocorre.

**Validates: Requirements 4.2**

### Property 11: Idempotência da migração pelo marcador

Para qualquer estado em que o marcador de conclusão da Migracao_de_Dados exista para a pessoa usuária, reexecutar a migração não realiza nenhuma transferência adicional para a Camada_de_Persistencia.

**Validates: Requirements 4.6**

### Property 12: Rollback atômico da migração sob falha

Para qualquer ponto de falha ou estouro do prazo durante a Migracao_de_Dados, os dados locais permanecem inalterados, as gravações parciais na Camada_de_Persistencia são revertidas, o marcador de conclusão não é registrado e um erro é sinalizado.

**Validates: Requirements 4.5**

### Property 13: Roteamento de dados pós-migração

Para qualquer leitura ou gravação após uma Migracao_de_Dados concluída com sucesso, a operação é direcionada à API_PlannerDuo e não ao armazenamento local do navegador.

**Validates: Requirements 4.4**

### Property 14: Invariantes da CSP

Para qualquer origem de API_PlannerDuo configurada, a CSP gerada tem `connect-src` contendo o esquema e a autoridade dessa origem, `object-src` igual a `'none'`, e `script-src` e `base-uri` contendo exclusivamente `'self'` e origens explicitamente listadas.

**Validates: Requirements 5.1, 5.3, 5.4**

### Property 15: Recusa de página com CSP inválida

Para qualquer configuração em que o cabeçalho de CSP esteja ausente ou não contenha a origem da API_PlannerDuo em `connect-src`, servir uma página resulta em resposta de erro de configuração e nenhum conteúdo de página com política incompleta é entregue.

**Validates: Requirements 5.5**

### Property 16: Invariantes de tokens do tema

Para o Tema_Visual aplicado, a cor primária está no intervalo fechado de `#0066FF` a `#2563EB`, a cor de destaque no intervalo fechado de `#FF7700` a `#FF8C00`, o fundo base no intervalo fechado de `#0B0F19` a `#0F172A`, e todo raio de borda de componente de superfície está no intervalo fechado de 12 a 16 pixels.

**Validates: Requirements 6.1, 6.2, 6.3, 6.5**

### Property 17: Ausência de narrativa de isolamento e termos de cofre

Para toda página do Front_End e todo termo do conjunto de Narrativa_de_Isolamento, além dos termos "Cofre" e "vault" (comparação sem distinção entre maiúsculas e minúsculas), o número de ocorrências no texto visível é zero; e nenhuma tela de autenticação contém texto informando ausência de recuperação de conta por e-mail.

**Validates: Requirements 7.1, 7.2, 9.2**

### Property 18: Indicador de notificação por módulo

Para cada um dos 7 módulos da Barra_Lateral e qualquer contagem de notificações, o módulo é renderizado com um ícone associado e o indicador de notificação laranja é exibido se e somente se a contagem for maior que zero.

**Validates: Requirements 7.5, 7.6**

### Property 19: Resolução de rota equivalente à baseline

Para toda rota existente antes da transição, a resolução durante ou após a transição leva ao mesmo destino funcional de antes; e para qualquer rota não resolúvel, o Front_End apresenta indicação de erro de navegação sem alterar o Estado_Global.

**Validates: Requirements 8.1, 8.5**

### Property 20: Equivalência do contrato dos serviços de IA

Para qualquer requisição válida a um serviço de IA existente durante ou após a transição, a forma da requisição e da resposta e o comportamento observável são idênticos aos de antes da transição.

**Validates: Requirements 8.2**

### Property 21: Equivalência de estado através da transição e do reinício

Para qualquer dado confirmado na persistência remota, uma leitura subsequente do Estado_Global retorna o mesmo conteúdo gravado, e após o reinício da aplicação o Estado_Global recuperado é idêntico ao último estado confirmado na persistência remota.

**Validates: Requirements 8.3, 8.4**

### Property 22: Preservação do remoto diante de cache corrompido

Para qualquer recuperação de Estado_Global que divirja do último estado confirmado na persistência remota ou que detecte corrupção do cache de inicialização, o Front_End sinaliza a inconsistência e não sobrescreve os dados remotos com dados corrompidos.

**Validates: Requirements 8.6**

### Property 23: Completude do artefato de superseção

Para o artefato de documentação versionado da decisão de superseção, ele é considerado conforme se e somente se existir e contiver todos os campos obrigatórios bem formados: identificador da spec substituída, data da decisão em formato ISO 8601, premissa anterior e premissa adotada.

**Validates: Requirements 9.1, 9.4**

### Property 24: Atomicidade da migração de identidade Git

Para qualquer configuração em que restaria alguma referência às identidades `Tiago-Nocce` (como token distinto de `Tiago-NoccePRD`) ou `PlannerDuo1.0` após a migração, a migração é interrompida sem aplicar nenhuma alteração, lista cada referência remanescente e preserva a Configuracao_Git original.

**Validates: Requirements 10.3**

### Property 25: Ausência de identidade antiga em configuração e arquivos de ambiente

Para a Configuracao_Git concluída e cada arquivo de ambiente, de implantação e de CI/CD gerado ou ajustado, o número de ocorrências das identidades `Tiago-Nocce` (como token distinto de `Tiago-NoccePRD`) e `PlannerDuo1.0` é zero e cada arquivo referencia exclusivamente a Identidade_de_Ambiente de destino.

**Validates: Requirements 10.2, 10.6**
