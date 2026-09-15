# Design Document

## Overview

O sintoma é simples: `public/` virou a raiz publicada (`hosting.public` em `firebase.json`), a raiz do workspace ficou sem `index.html`, e o Live Server — que serve a raiz do workspace — passou a mostrar a listagem do repositório em `http://127.0.0.1:5500/`.

O design corrige isso em quatro artefatos, nenhum deles código de produto:

| Artefato | Estado | Papel |
| --- | --- | --- |
| `.vscode/settings.json` | **criar** (o diretório existe, o arquivo não) | Raiz, rotas, host e porta do Live_Server |
| `scripts/dev-server.mjs` | ajuste mínimo | Caminho de paridade total; passa a ler as rotas de `firebase.json` e a fixar o host |
| `scripts/verificar-frontend.mjs` | estender | Verificação de paridade contra qualquer host/porta e contra as rotas declaradas |
| `README.md` | estender | URLs dos dois servidores e nota de Authorized domains |

O destravamento imediato do usuário está inteiramente no primeiro artefato:

```jsonc
// .vscode/settings.json
{
  "liveServer.settings.root": "/public",
  "liveServer.settings.host": "localhost",
  "liveServer.settings.port": 5500,
  "liveServer.settings.mount": [
    ["/app", "./public/app.html"],
    ["/auth", "./public/auth.html"]
  ]
}
```

Com isso, `http://localhost:5500/` passa a servir `public/index.html` (o Live Server usa `index.html` como índice de diretório) e a listagem de arquivos desaparece. O resto do design cuida de paridade, isolamento e verificação.

## Architecture

Dois caminhos de desenvolvimento, uma única fonte de verdade para rotas.

```
firebase.json  (hosting.public + rewrites)  ← fonte única
        │
        ├── scripts/rotas-hosting.mjs  (leitura + resolução, puro)
        │        ├── Dev_Server        → http://localhost:5000   paridade total
        │        └── Verificador       → compara os dois perfis
        │
        └── .vscode/settings.json      → http://localhost:5500   paridade parcial
                 └── Live_Server (extensão VS Code, não executa código do repo)
```

Comparação dos dois perfis:

| Aspecto | Live_Server | Dev_Server |
| --- | --- | --- |
| URL | `http://localhost:5500` | `http://localhost:5000` |
| Raiz servida | `public/` via `liveServer.settings.root` | `public/` via `resolve(__dirname, '..', 'public')` |
| `/` | `public/index.html` (índice de diretório) | `public/index.html` (rewrite explícito) |
| `/app`, `/auth` | `mount` | `REWRITES` derivados de `firebase.json` |
| Rota desconhecida | **404** — divergência conhecida | `public/index.html` (catch-all `**`) |
| Travessia de diretório | bloqueada pela raiz da extensão | 403 via `caminhoSeguro` |
| Live reload | sim | não |

A assimetria da penúltima linha é a única divergência funcional, e é deliberada (ver Decisão D3).

Resolução de uma requisição no Dev_Server, na ordem em que o Firebase Hosting resolve:

1. o caminho bate em um `source` de rewrite? → serve o `destination`;
2. `/`? → `public/index.html`;
3. existe arquivo em `public/` no caminho pedido? → serve o arquivo com o `Content-Type` da extensão;
4. o caminho escapa de `public/`? → 403;
5. nada acima? → `public/index.html` com 200 (catch-all).

## Components and Interfaces

### 1. Configuracao_Live_Server — `.vscode/settings.json`

Quatro chaves, cada uma amarrada a um critério:

- `liveServer.settings.root: "/public"` — caminho **relativo à raiz do workspace**, com barra inicial. É o que faz `/` servir a landing (R1.3) e o que remove do alcance da extensão tudo que está fora de `public/` (R3.3).
- `liveServer.settings.mount: [["/app", "./public/app.html"], ["/auth", "./public/auth.html"]]` — reproduz os dois primeiros rewrites (R2.1, R2.2).
- `liveServer.settings.host: "localhost"` — troca o padrão `127.0.0.1` por um host que o Firebase autoriza de fábrica (R4.2).
- `liveServer.settings.port: 5500` — fixa a porta em vez de deixar a extensão escolher, para que a porta documentada seja a porta real (R6.2).

**Pegadinha a registrar em comentário no próprio arquivo:** `root` e `mount` usam bases diferentes. `root` é relativo à raiz do workspace e define o que passa a ser `/`. Os alvos de `mount` **continuam relativos à raiz do WORKSPACE**, não à raiz servida. Por isso `"./public/app.html"` e não `"./app.html"` — escrever `"./app.html"` aqui é o erro natural e resulta em 404 em `/app`.

### 2. Rotas_Hosting — `scripts/rotas-hosting.mjs` (novo, puro, sem I/O de rede)

Extrai para um módulo o que hoje é a constante `REWRITES` embutida no Dev_Server, de modo que servidor, verificador e testes leiam a mesma tabela.

```js
/**
 * @typedef {{ origem: string, destino: string }} Rewrite
 * @typedef {{ raiz: string, rewrites: Rewrite[], fallback: string|null }} TabelaRotas
 */

/** Traduz o objeto já parseado de firebase.json em TabelaRotas. Puro. */
export function lerRotasHosting(firebaseJson) {}

/** Rota → arquivo esperado dentro da raiz, na ordem do Hosting.
 *  @param {TabelaRotas} tabela
 *  @param {string} rota
 *  @param {(caminhoRelativo: string) => boolean} existe  injetado, para testabilidade
 *  @returns {{ arquivo: string|null, motivo: 'rewrite'|'arquivo'|'fallback'|'proibido' }} */
export function resolverRota(tabela, rota, existe) {}

/** Pares origem→destino que a configuração do Live_Server declara. Puro. */
export function rotasDeSettings(settingsJson) {}
```

`resolverRota` recebe `existe` como parâmetro em vez de tocar o disco: é o que permite testar a resolução com propriedades sem montar uma árvore de arquivos.

### 3. Dev_Server — `scripts/dev-server.mjs`

Já atende R1, R2 e R3 hoje: serve `public/`, aplica os três rewrites e devolve 403 em travessia via `caminhoSeguro`. Duas mudanças pequenas, nenhuma reescrita:

- passar a derivar `REWRITES` de `firebase.json` via `lerRotasHosting`, mantendo a tabela atual como valor embutido de reserva;
- `servidor.listen(PORTA, HOST)` com `HOST` padrão `localhost` (hoje escuta em todas as interfaces), alinhando com R4.2 e reduzindo exposição na rede local.

A função `caminhoSeguro` permanece como está — é ela que satisfaz R3.2, inclusive para travessia percent-encoded, porque decodifica antes de normalizar e confere o prefixo do caminho absoluto resultante.

### 4. Verificador_Paridade — `scripts/verificar-frontend.mjs`

O script já compara corpo servido com corpo em disco em `/`, `/index.html`, `/app.html`, `/auth.html`, `/app`, `/auth`, `/style.css`, `/app.js`, `/core.js`. Ele é o ponto de extensão de R6.3. Quatro adições:

**a) Base configurável.** Hoje aceita `--port` (default 5177) e monta `http://localhost:${porta}`. Passa a aceitar `--base http://localhost:5500`, mantendo `--port` por compatibilidade. É o que permite rodar o mesmo verificador contra o Live Server e contra o Dev Server.

**b) Tabela de rotas derivada, não hard-coded.** A constante `ESPERADO` passa a ser gerada de `lerRotasHosting(firebase.json)` + varredura de `public/`. Se alguém adicionar um rewrite em `firebase.json`, a rota nova entra automaticamente no conjunto verificado — é assim que R2.5 deixa de depender de disciplina humana.

**c) Perfil de servidor.** `--perfil dev-server|live-server`. O perfil descreve as divergências esperadas: em `live-server`, uma rota desconhecida deve responder 404 e isso conta como divergência conhecida, não como falha. Assim o comando roda verde nos dois servidores sem mentir sobre o comportamento de nenhum deles.

**d) Checagem estática de configuração, sem servidor.** `--somente-config` compara `rotasDeSettings('.vscode/settings.json')` com os rewrites de `firebase.json` e confere que cada alvo de `mount` existe em `public/`. Roda no CI e nos testes, sem subir nada.

Comandos em `package.json`:

```json
"verificar": "node scripts/verificar-frontend.mjs",
"verificar:config": "node scripts/verificar-frontend.mjs --somente-config",
"verificar:live": "node scripts/verificar-frontend.mjs --base http://localhost:5500 --perfil live-server"
```

### 5. Documentação — `README.md`

Uma seção de desenvolvimento local com: as duas URLs (`http://localhost:5500` e `http://localhost:5000`), a afirmação de que são alternativas equivalentes com a divergência do catch-all anotada (R6.4), e a nota de que `localhost` já é Dominio_Autorizado no Firebase enquanto `127.0.0.1` normalmente não é (R4.4).

### 6. Limpeza — `.kiro/skills/specs`

`.kiro/skills/specs/` está vazio, resíduo da migração. Remover o diretório. Item trivial.

## Data Models

```js
/** Tabela derivada de firebase.json. Fonte única de rotas. */
const tabela = {
  raiz: 'public',
  rewrites: [
    { origem: '/app',  destino: '/app.html' },
    { origem: '/auth', destino: '/auth.html' },
  ],
  fallback: '/index.html',   // do rewrite "**"; null se ausente
};

/** Entrada de liveServer.settings.mount: [rota, caminho relativo ao WORKSPACE] */
const mount = [['/app', './public/app.html'], ['/auth', './public/auth.html']];

/** Perfil usado pelo verificador. */
const perfil = {
  nome: 'live-server',
  base: 'http://localhost:5500',
  suportaCatchAll: false,       // true no dev-server
  statusRotaDesconhecida: 404,  // 200 no dev-server
};
```

Invariante que liga os dois modelos: para todo `rewrite` com `origem !== '**'`, existe uma entrada de `mount` com a mesma rota e com alvo `./public` + `destino`.

## Error Handling

| Situação | Comportamento | Onde |
| --- | --- | --- |
| `firebase.json` ausente ou malformado | Dev_Server avisa no stderr e usa a tabela embutida de reserva; nunca deixa de subir. O verificador falha com mensagem explícita | Dev_Server / Verificador |
| `mount` divergente dos rewrites | `verificar:config` sai com código 1 apontando o par que difere | Verificador |
| Alvo de `mount` inexistente em `public/` | `verificar:config` sai com código 1 nomeando o arquivo ausente | Verificador |
| Porta 5500 ou 5000 ocupada | Erro do próprio servidor; o README instrui `npm run dev -- --port <outra>` e o verificador aceita `--base` | Documentação |
| Travessia de diretório | 403 `Forbidden`, sem corpo do arquivo | `caminhoSeguro` |
| Arquivo pedido inexistente | Dev_Server: `index.html` com 200. Live_Server: 404 | Ambos |
| `public/index.html` ausente | 404 `Not found` (a falha fica visível em vez de virar listagem) | Dev_Server |
| Login Google falha com `auth/unauthorized-domain` | README instrui usar `localhost`, não `127.0.0.1` | Documentação |

## Design Decisions

**D1 — `root: "/public"` em vez de mover arquivos para a raiz.** A alternativa seria devolver os assets à raiz do workspace, mas `hosting.public = "public"` faria o deploy publicar um diretório vazio. A configuração se adapta ao layout do Hosting, não o contrário.

**D2 — `mount` com alvo `./public/...`.** Os alvos de `mount` são resolvidos contra a raiz do workspace, não contra a raiz servida por `root`. Documentar isso em comentário no `settings.json` custa uma linha e evita o 404 silencioso em `/app`.

**D3 — Dev_Server é o caminho de paridade total; o Live_Server tem divergência documentada.** O Live Server não tem equivalente ao rewrite catch-all `**` → `/index.html`: `mount` mapeia rotas nomeadas, uma a uma. Não existe chave que faça qualquer rota desconhecida cair na landing. Consequência honesta: no Live Server, `/rota-inexistente` devolve 404 onde o Hosting devolveria a landing com 200 — R2.3 não é atendido nesse caminho, e R6.1 é atendido para `/`, `/app`, `/auth` e arquivos existentes, mas não para rotas desconhecidas. Duas opções foram consideradas:

- aceitar a divergência, documentá-la e eleger o Dev_Server como o caminho de paridade total; ou
- abandonar o Live Server.

A escolha é a primeira. O Live Server entrega live reload, que é o motivo de existir dele no fluxo, e a divergência só aparece em rotas que o app não usa (a navegação do PlannerDuo é `/`, `/app`, `/auth`). A regra prática que vai para o README: para testar comportamento de rota desconhecida ou validar paridade antes do deploy, use `npm run dev`.

**D4 — `host: "localhost"` em vez de autorizar `127.0.0.1` no console.** O padrão do Live Server é `127.0.0.1`, que normalmente **não** está em Authentication → Authorized domains, e isso quebra o `signInWithRedirect` do Google com `auth/unauthorized-domain`. Duas saídas: adicionar `127.0.0.1` no console do Firebase, ou fixar `localhost` na configuração. A recomendação é fixar `localhost`: é versionado, vale para qualquer clone, não exige acesso ao console e não amplia a lista de domínios autorizados do projeto. Mudança no console é ação manual, por máquina, fora do controle de versão — exatamente o que R5.2 pede para evitar.

**D5 — Portas 5500 e 5000.** Já são distintas; a decisão é apenas fixá-las explicitamente na configuração e no README, para que rodar os dois ao mesmo tempo seja o caso normal e a verificação de paridade possa comparar os dois simultaneamente.

**D6 — `firebase.json` como fonte única de rotas.** Rewrites duplicados em três lugares (Hosting, Dev_Server, Live_Server) divergem com o tempo. Dois deles passam a derivar de `firebase.json` em tempo de execução; o terceiro, o `settings.json`, não pode (é lido pela extensão, não por código nosso), então fica coberto pela checagem estática de `verificar:config`.

**D7 — Estender o verificador existente em vez de criar um script novo.** `verificar-frontend.mjs` já faz comparação corpo-a-corpo com o disco, que é a parte difícil. Falta apenas base configurável, tabela derivada e perfil de divergência.

**D8 — Limpeza de `.kiro/` é só no working tree.** O Git não rastreia diretórios vazios, então `.kiro/skills/specs/` não existe no índice: remover não gera diff e não há risco para arquivos rastreados. R7.2 é satisfeito por construção; a verificação é uma conferência de `git status`.

## Requirements Traceability

| Requisito | Componente que atende | Observação |
| --- | --- | --- |
| 1.1 `/` → landing | `root: "/public"` (Live) + rewrite `/` (Dev) | Índice de diretório no Live Server |
| 1.2 Diretório → landing, sem listagem | `root: "/public"` (Live) + fallback (Dev) | Correção do sintoma relatado |
| 1.3 Raiz do Live_Server = `public/` | `.vscode/settings.json` | — |
| 2.1 `/app` | `mount` (Live) + `REWRITES` (Dev) | — |
| 2.2 `/auth` | `mount` (Live) + `REWRITES` (Dev) | — |
| 2.3 Rota desconhecida → landing | Dev_Server apenas | **Divergência D3**: 404 no Live_Server |
| 2.4 Arquivo + `Content-Type` | Tabela `TIPOS` (Dev) + extensão (Live) | Já verificado hoje |
| 2.5 Rotas espelham `firebase.json` | `rotas-hosting.mjs` + `verificar:config` | Falha no CI se divergir |
| 3.1 Arquivo interno inacessível | `root` (Live) + `caminhoSeguro` (Dev) | `mount` só expõe `app.html` e `auth.html`, ambos já públicos |
| 3.2 Travessia → 403 | `caminhoSeguro` (Dev) | Já implementado |
| 3.3 Servível restrito a `public/` | `root` (Live) + `RAIZ` (Dev) | — |
| 4.1 HTTP, não `file://` | Ambos os servidores | — |
| 4.2 Host autorizado | `host: "localhost"` + `listen(PORTA, 'localhost')` | Decisão D4 |
| 4.3 Redirect volta ao mesmo host/porta | Porta fixa 5500 / 5000 | Verificação manual |
| 4.4 Docs de URLs e domínios | `README.md` | — |
| 5.1 `settings.json` versionado | `.vscode/settings.json` | Conferir que não está no `.gitignore` |
| 5.2 Clone novo funciona sem edição | `.vscode/settings.json` + `npm run dev` | Nada depende do console |
| 5.3 Só Node + VS Code | Dev_Server usa apenas módulos `node:` | Sem dependência nova |
| 5.4 Sem Live_Server, `npm run dev` serve | `scripts/dev-server.mjs` | — |
| 6.1 Paridade de resolução | `rotas-hosting.mjs` + verificador | Ressalva de 2.3 |
| 6.2 Portas distintas | 5500 vs 5000 | — |
| 6.3 Verificação automatizada | `verificar-frontend.mjs` estendido | `--base`, `--perfil`, `--somente-config` |
| 6.4 Docs: alternativas equivalentes | `README.md` | Com a divergência anotada |
| 7.1 `.kiro/` sem diretórios vazios | Remoção de `.kiro/skills/specs/` | — |
| 7.2 Preservar rastreados | Git não rastreia diretório vazio | Trivial (D8) |

## Correctness Properties

*Uma propriedade é uma característica ou comportamento que deve valer em todas as execuções válidas do sistema — uma afirmação formal sobre o que o sistema deve fazer. Propriedades são a ponte entre especificações legíveis por humanos e garantias de correção verificáveis por máquina.*

### Property 1: Rewrites declarados resolvem para o destino declarado

*Para qualquer* tabela de rotas derivada de `firebase.json` e *para qualquer* par `origem → destino` de rewrite não catch-all dessa tabela, `resolverRota(tabela, origem)` retorna `destino` com motivo `rewrite`, independentemente de existir arquivo no caminho `origem`.

**Validates: Requirements 2.1, 2.2**

### Property 2: Todo caminho não resolvido cai na landing

*Para qualquer* caminho de requisição que não seja origem de rewrite e que não corresponda a um arquivo existente em `public/` — incluindo `/`, caminhos de diretório com e sem barra final, extensões inexistentes e caminhos unicode — a resolução retorna `/index.html` com status 200 e `Content-Type` de HTML, e o corpo servido nunca contém marcadores de listagem de diretório.

**Validates: Requirements 1.1, 1.2, 2.3**

### Property 3: Arquivo existente é servido byte-idêntico com o tipo da extensão

*Para qualquer* arquivo existente em `public/`, o corpo devolvido pelo servidor é idêntico ao conteúdo em disco e o cabeçalho `Content-Type` corresponde à extensão do arquivo na tabela de tipos.

**Validates: Requirements 2.4**

### Property 4: Nenhuma requisição alcança conteúdo fora de `public/`

*Para qualquer* caminho de requisição, incluindo payloads de travessia de qualquer profundidade, com separadores `/` ou `\` e em qualquer combinação de percent-encoding, o arquivo efetivamente lido está dentro de `public/`; se o caminho normalizado escapa da raiz, a resposta é 403 sem corpo de arquivo, e em nenhum caso o corpo da resposta é igual ao conteúdo de um Arquivo_Interno.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 5: As duas configurações declaram o mesmo conjunto de rotas

*Para qualquer* conjunto de rewrites, o conjunto de pares `origem → destino` derivado para o Dev_Server e o conjunto derivado de `liveServer.settings.mount` são iguais, excluída a entrada catch-all `**`; e *para qualquer* rota desse conjunto, os dois perfis resolvem para o mesmo arquivo de `public/`.

**Validates: Requirements 2.5, 6.1**

### Property 6: Todo alvo de `mount` existe dentro de `public/`

*Para qualquer* entrada `[rota, alvo]` de `liveServer.settings.mount`, `alvo` resolve para um arquivo existente contido em `public/`.

**Validates: Requirements 1.3, 2.5**

## Testing Strategy

Ferramentas já no repositório: vitest + fast-check, 58 testes passando. Nada novo a instalar (R5.3).

**Testes de propriedade** — `tests/rotas-hosting.test.js`, mínimo de 100 iterações cada, tag `Feature: config-dev-local, Property {n}: {texto}`. Propriedades 1, 2, 4, 5 e 6 rodam contra as funções puras de `rotas-hosting.mjs`, com `existe` injetado — sem servidor, sem disco. A Propriedade 3 roda contra o Dev_Server em porta efêmera, gerando a lista de arquivos a partir da varredura real de `public/`.

**Testes de exemplo** — `tests/config-dev-local.test.js`: `root === '/public'`, `host === 'localhost'`, porta do Live_Server ≠ porta padrão do Dev_Server, `scripts.dev` presente em `package.json`, README contendo as duas URLs e a nota de Authorized domains, imports do Dev_Server todos com prefixo `node:`.

**Checagens de smoke** — uma execução cada: `.vscode/settings.json` existe e não é ignorado pelo Git; `npm run verificar:config` sai com 0; `.kiro/` sem diretórios vazios; `git status --porcelain` sem deleção de arquivo rastreado após a limpeza.

**Verificação manual documentada** — o que depende de VS Code, navegador e Firebase Auth e não vale automatizar: abrir `http://localhost:5500/` e confirmar a landing no lugar da listagem; concluir `signInWithRedirect` do Google em `/auth` e confirmar o retorno em `localhost:5500`; repetir em `localhost:5000`. Roteiro no README, uma passada por servidor.
