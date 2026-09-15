# Implementation Plan

## Overview

Configuração de ambiente local, em JavaScript (Node.js + ESM), sobre o que já existe no repositório: `scripts/dev-server.mjs`, `scripts/verificar-frontend.mjs`, vitest + fast-check. Nenhuma dependência nova (R5.3).

A Tarefa 1 é autocontida e resolve o sintoma relatado (`http://127.0.0.1:5500/` mostrando a listagem do repositório) sem depender de nenhuma outra tarefa. As demais tratam de fonte única de rotas, paridade verificável, documentação e limpeza, em ordem de valor decrescente.

## Tasks

- [x] 1. Criar `.vscode/settings.json` com a configuração do Live_Server
  - Criar o arquivo `.vscode/settings.json` (o diretório `.vscode/` já existe; o arquivo não)
  - Declarar exatamente as quatro chaves do design: `liveServer.settings.root: "/public"`, `liveServer.settings.host: "localhost"`, `liveServer.settings.port: 5500` e `liveServer.settings.mount: [["/app", "./public/app.html"], ["/auth", "./public/auth.html"]]`
  - Incluir comentário no próprio arquivo registrando a pegadinha do `mount`: `root` é relativo à raiz do workspace e redefine o que é `/`, mas os alvos de `mount` continuam relativos à raiz do **workspace**, não à raiz servida — daí `./public/app.html` e não `./app.html`, que resultaria em 404 em `/app`
  - Verificar ao final: o arquivo é JSON com comentários válido (formato JSONC aceito pelo VS Code), os quatro caminhos citados existem em disco (`public/index.html`, `public/app.html`, `public/auth.html`), e `git check-ignore .vscode/settings.json` não retorna correspondência (R5.1)
  - _Requirements: 1.2, 1.3, 2.1, 2.2, 4.2, 5.1, 5.2, 6.2_

- [ ] 2. Extrair as rotas do Hosting para um módulo puro
  - [ ] 2.1 Criar `scripts/rotas-hosting.mjs`
    - Implementar `lerRotasHosting(firebaseJson)` devolvendo `{ raiz, rewrites, fallback }`, com `fallback` derivado do rewrite `**` e `null` quando ausente
    - Implementar `resolverRota(tabela, rota, existe)` na ordem do Hosting (rewrite → `/` → arquivo existente → travessia → fallback), devolvendo `{ arquivo, motivo }` com `motivo` em `'rewrite' | 'arquivo' | 'fallback' | 'proibido'`; `existe` é injetado, sem tocar o disco
    - Implementar `rotasDeSettings(settingsJson)` devolvendo os pares `origem → destino` declarados em `liveServer.settings.mount`, tolerando comentários no JSONC
    - Verificar ao final: `node --check scripts/rotas-hosting.mjs` passa e o módulo importa apenas de `node:*` (ou de nada)
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 3.3, 6.1_

  - [ ]* 2.2 Teste de propriedade: rewrites resolvem para o destino declarado
    - Criar `tests/rotas-hosting.test.js` com fast-check, mínimo de 100 iterações (`{ numRuns: 100 }`)
    - Tag do teste: `Feature: config-dev-local, Property 1: Rewrites declarados resolvem para o destino declarado`
    - Gerar tabelas de rotas arbitrárias e conferir que toda origem não catch-all resolve para seu destino com `motivo === 'rewrite'`, inclusive quando `existe` devolve `true` para o próprio caminho de origem
    - Verificar ao final: `npm test -- tests/rotas-hosting.test.js` passa
    - _Properties: 1_
    - _Requirements: 2.1, 2.2_

  - [ ]* 2.3 Teste de propriedade: caminho não resolvido cai na landing
    - Adicionar bloco em `tests/rotas-hosting.test.js`, mínimo de 100 iterações
    - Tag do teste: `Feature: config-dev-local, Property 2: Todo caminho não resolvido cai na landing`
    - Gerar caminhos que não são origem de rewrite e para os quais `existe` devolve `false` — incluir `/`, caminhos de diretório com e sem barra final, extensões inexistentes e segmentos unicode — e conferir `arquivo === '/index.html'` com `motivo === 'fallback'`
    - Verificar ao final: `npm test -- tests/rotas-hosting.test.js` passa
    - _Properties: 2_
    - _Requirements: 1.1, 1.2, 2.3_

  - [ ]* 2.4 Teste de propriedade: nada resolve para fora de `public/`
    - Adicionar bloco em `tests/rotas-hosting.test.js`, mínimo de 100 iterações
    - Tag do teste: `Feature: config-dev-local, Property 4: Nenhuma requisição alcança conteúdo fora de public/`
    - Gerar payloads de travessia de profundidade arbitrária, com separadores `/` e `\` e em combinações de percent-encoding (`%2e%2e%2f`, duplo encoding), e conferir que o resultado é `motivo === 'proibido'` com `arquivo === null`, ou um `arquivo` contido na raiz — nunca um caminho que escape dela
    - Verificar ao final: `npm test -- tests/rotas-hosting.test.js` passa
    - _Properties: 4_
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 3. Ajustar o Dev_Server
  - [ ] 3.1 Derivar rotas de `firebase.json` e fixar o host em `scripts/dev-server.mjs`
    - Substituir a constante `REWRITES` embutida por `lerRotasHosting` aplicado ao `firebase.json` lido do disco, mantendo a tabela atual como valor de reserva e avisando no stderr quando o arquivo estiver ausente ou malformado — o servidor sobe em qualquer caso
    - Trocar `servidor.listen(PORTA, ...)` por `servidor.listen(PORTA, HOST, ...)` com `HOST` padrão `'localhost'`
    - Não alterar `caminhoSeguro` nem a tabela `TIPOS`
    - Verificar ao final: `node --check scripts/dev-server.mjs` passa; com o servidor em porta efêmera, `/`, `/app`, `/auth` respondem 200 com o corpo do arquivo esperado e `/../package.json` responde 403
    - _Requirements: 2.5, 4.2, 5.3, 5.4_

  - [ ]* 3.2 Teste de propriedade: arquivo existente servido byte-idêntico
    - Criar `tests/dev-server.test.js` subindo o Dev_Server em porta efêmera, mínimo de 100 iterações
    - Tag do teste: `Feature: config-dev-local, Property 3: Arquivo existente é servido byte-idêntico com o tipo da extensão`
    - Gerar as rotas a partir da varredura real de `public/` e comparar o corpo servido com o conteúdo em disco, além do `Content-Type` correspondente à extensão na tabela `TIPOS`
    - Verificar ao final: `npm test -- tests/dev-server.test.js` passa e o servidor é encerrado no teardown
    - _Properties: 3_
    - _Requirements: 2.4_

- [ ] 4. Checkpoint — garantir que a suíte está verde
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Estender o verificador de paridade
  - [ ] 5.1 Adicionar `--base`, `--perfil` e `--somente-config` a `scripts/verificar-frontend.mjs`
    - Aceitar `--base http://localhost:5500` mantendo `--port` por compatibilidade
    - Gerar a tabela `ESPERADO` de `lerRotasHosting(firebase.json)` mais a varredura de `public/`, em vez de manter o objeto hard-coded
    - Aceitar `--perfil dev-server|live-server`; no perfil `live-server`, contabilizar 404 em rota desconhecida como divergência conhecida (não falha), e no perfil `dev-server` exigir 200 com o corpo de `index.html`
    - Aceitar `--somente-config`: sem subir servidor, comparar `rotasDeSettings('.vscode/settings.json')` com os rewrites não catch-all de `firebase.json` e conferir que cada alvo de `mount` existe em `public/`, saindo com código 1 e mensagem nomeando o par ou o arquivo divergente
    - Verificar ao final: `node scripts/verificar-frontend.mjs --somente-config` sai com código 0
    - _Requirements: 2.5, 6.1, 6.3_

  - [ ] 5.2 Registrar os scripts npm em `package.json`
    - Adicionar `"verificar:config": "node scripts/verificar-frontend.mjs --somente-config"` e `"verificar:live": "node scripts/verificar-frontend.mjs --base http://localhost:5500 --perfil live-server"`, preservando `dev`, `verificar`, `test` e `test:watch`
    - Verificar ao final: `npm run verificar:config` sai com código 0
    - _Requirements: 6.3_

  - [ ]* 5.3 Teste de propriedade: as duas configurações declaram as mesmas rotas
    - Adicionar bloco em `tests/rotas-hosting.test.js`, mínimo de 100 iterações
    - Tag do teste: `Feature: config-dev-local, Property 5: As duas configurações declaram o mesmo conjunto de rotas`
    - Gerar conjuntos de rewrites, derivar deles o `mount` esperado e conferir a igualdade dos conjuntos de pares `origem → destino` excluída a entrada `**`; conferir também que cada rota do conjunto resolve para o mesmo arquivo nos dois perfis
    - Verificar ao final: `npm test -- tests/rotas-hosting.test.js` passa
    - _Properties: 5_
    - _Requirements: 2.5, 6.1_

  - [ ]* 5.4 Teste de propriedade: todo alvo de `mount` existe em `public/`
    - Adicionar bloco em `tests/rotas-hosting.test.js`, mínimo de 100 iterações
    - Tag do teste: `Feature: config-dev-local, Property 6: Todo alvo de mount existe dentro de public/`
    - Rodar contra o `mount` real de `.vscode/settings.json` e contra `mount`s gerados, conferindo que cada alvo resolve para um arquivo contido em `public/` e que alvos escritos sem o prefixo `./public/` são reprovados
    - Verificar ao final: `npm test -- tests/rotas-hosting.test.js` passa
    - _Properties: 6_
    - _Requirements: 1.3, 2.5_

  - [ ]* 5.5 Testes de exemplo da configuração
    - Criar `tests/config-dev-local.test.js` conferindo: `liveServer.settings.root === '/public'`, `liveServer.settings.host === 'localhost'`, porta do Live_Server diferente da porta padrão do Dev_Server, `scripts.dev`, `scripts["verificar:config"]` e `scripts["verificar:live"]` presentes em `package.json`, `README.md` contendo as duas URLs e a nota de Authorized domains, e todos os imports de `scripts/dev-server.mjs` com prefixo `node:`
    - Verificar ao final: `npm test -- tests/config-dev-local.test.js` passa
    - _Requirements: 4.4, 5.1, 5.3, 6.2_

- [ ] 6. Documentação e limpeza
  - [ ] 6.1 Adicionar a seção de desenvolvimento local ao `README.md`
    - Registrar as duas URLs: `http://localhost:5500` (Live_Server, via `.vscode/settings.json`) e `http://localhost:5000` (`npm run dev`)
    - Declarar os dois caminhos como alternativas equivalentes, anotando a divergência do catch-all: no Live_Server uma rota desconhecida devolve 404 onde o Hosting devolveria a landing, então validação de paridade antes do deploy usa `npm run dev`
    - Registrar que `localhost` já consta como domínio autorizado no Firebase Auth enquanto `127.0.0.1` normalmente não, e que usar `127.0.0.1` quebra o `signInWithRedirect` com `auth/unauthorized-domain`
    - Registrar a saída para porta ocupada: `npm run dev -- --port <outra>` e `--base` no verificador
    - Verificar ao final: o README contém as strings `http://localhost:5500`, `http://localhost:5000` e `Authorized domains`
    - _Requirements: 4.4, 6.4_

  - [ ] 6.2 Remover o diretório vazio `.kiro/skills/specs/`
    - Remover `.kiro/skills/specs/` e, se `.kiro/skills/` ficar vazio, removê-lo também
    - Verificar ao final: `git status --porcelain` não mostra nenhuma deleção de arquivo rastreado e nenhum diretório vazio permanece sob `.kiro/`
    - _Requirements: 7.1, 7.2_

- [ ] 7. Checkpoint final
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- A Tarefa 1 é independente das demais: executá-la sozinha já substitui a listagem de arquivos pela landing em `http://localhost:5500/`
- Ferramentas de teste já estão no repositório (vitest + fast-check); nenhuma instalação nova é necessária
- Testes de propriedade rodam com no mínimo 100 iterações e carregam a tag `Feature: config-dev-local, Property {n}: {texto}`

## Fora do escopo executável

Itens que dependem de navegador, VS Code ou do console do Firebase e não são executáveis por um agente de codificação. Ficam registrados como roteiro de conferência humana, sem numeração e sem checkbox:

- Abrir `http://localhost:5500/` com o Live_Server ativo e confirmar a landing no lugar da listagem de arquivos.
- Concluir o `signInWithRedirect` do Google em `/auth` e confirmar o retorno no mesmo host e porta (R4.3), uma passada em `localhost:5500` e outra em `localhost:5000`.
- Conferir, no console do Firebase, que `localhost` consta em Authentication → Authorized domains. Nenhuma tarefa desta spec depende de alteração no console (Decisão D4).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["2.3", "5.1"] },
    { "id": 4, "tasks": ["2.4", "5.2", "6.1", "6.2"] },
    { "id": 5, "tasks": ["3.2", "5.3"] },
    { "id": 6, "tasks": ["5.4", "5.5"] }
  ]
}
```
