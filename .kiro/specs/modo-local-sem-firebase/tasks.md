# Implementation Plan

> Metodologia: bugfix por condição de bug. Primeiro escrevemos o teste de exploração
> (Property 1 — Bug Condition) que FALHA no código atual e comprova o defeito, depois o
> teste de preservação (Property 2) que PASSA no código atual, e só então aplicamos a
> correção seguindo exatamente o design. A prioridade de execução é **destravar o uso
> local** o quanto antes: o app deve abrir direto no painel, sem login e sem a tela de
> "demorando mais que o esperado".
>
> Ambiente: Windows/PowerShell. Use `npm.cmd` / `cmd /c`, redirecione a saída dos testes
> para um arquivo temporário e remova o temporário ao final de cada verificação.

## Tarefas

- [ ] 1. Escrever teste de exploração da condição do bug (ANTES da correção)
  - **Property 1: Bug Condition** — Round-trip de persistência local / painel travado sem sessão
  - **IMPORTANTE**: escreva este teste de propriedade ANTES de implementar qualquer correção.
  - **CRÍTICO**: este teste DEVE FALHAR no código atual — a falha confirma que o bug existe. NÃO tente consertar o teste nem o código quando ele falhar aqui.
  - **OBJETIVO**: expor contraexemplos que demonstrem o defeito: em `MODO='local'` sem sessão, o shell não é montado e `PlannerBootstrap.concluir()` nunca é chamado; além disso `DB.salvar` depende do Firestore e o topo do módulo executa `firebase.auth()/firestore()`.
  - Carregar `public/app.js` num contexto `vm` com stubs (espelhando `tests/app-saneamento.test.js` e `tests/firebase-auth-bootstrap-stall.exploration.test.js`), simulando `window.PLANNERDUO_MODO='local'` e nenhuma sessão (`isBugCondition(X) === true`).
  - Encodar a Property 1 do design como propriedade (fast-check): para toda entrada em que `isBugCondition` é verdadeira, após inicializar SHALL ter `painel_carregado`, `NOT tela_demora_visivel`, `NOT depende_de_rede` e `carregar(salvar(dados)) ≡ normalizar(dados)`.
  - Abordagem PBT escopada: gerar documentos de casal aleatórios (financas/viagens/metas/checklist/orcamentos) para o round-trip; o caso determinístico "abrir sem sessão" é fixado (modo local, `sessao=null`).
  - Tag obrigatória no nome do teste: `Feature: modo-local-sem-firebase, Property 1: Round-trip de persistência local e painel carregado sem sessão`.
  - Mínimo de 100 iterações no runner (`{ numRuns: 100 }` no fast-check).
  - Rodar no código NÃO corrigido e documentar os contraexemplos observados (ex.: "concluir() não chamado sem user"; "DB.salvar chamou db.collection(...).set(...)"; "carga do módulo executa firebase.auth() no topo").
  - **RESULTADO ESPERADO**: teste FALHA (isto está correto — comprova o bug).
  - Arquivos tocados: `tests/modo-local-sem-firebase.exploration.test.js` (novo).
  - Verificar ao final: `cmd /c "npm.cmd test -- tests/modo-local-sem-firebase.exploration.test.js > tmp-explore.txt 2>&1"`; confirmar que o teste FALHA e que os contraexemplos estão registrados no teste; depois `cmd /c del tmp-explore.txt`.
  - _Properties: 1_
  - _Requirements: 1.1, 1.2, 1.4_

- [ ] 2. Escrever testes de preservação do modo Firebase (ANTES da correção)
  - **Property 2: Preservation** — Caminho de montagem e persistência inalterados no modo Firebase
  - **IMPORTANTE**: siga a metodologia observação-primeiro. Observe o comportamento no código NÃO corrigido (com o stub de `firebase` presente) e capture-o.
  - Observar no código atual, com `MODO='firebase'`: `Auth.iniciarObserver()` observa a sessão via `onAuthStateChanged`; `DB.salvar` chama `db.collection('casais').doc(...).set(payload, {merge:true})`; `DB.normalizar` produz o mesmo saneamento.
  - Encodar a Property 2 como propriedade (fast-check): para toda entrada em que `isBugCondition` é FALSA (modo firebase), o comportamento observável SHALL ser idêntico ao original — mesmo fluxo de auth, mesma chamada de persistência ao Firestore e mesmo resultado de `DB.normalizar`.
  - Tag obrigatória no nome do teste: `Feature: modo-local-sem-firebase, Property 2: Caminho de montagem e persistência inalterados no modo Firebase`.
  - Mínimo de 100 iterações no runner (`{ numRuns: 100 }`).
  - Rodar no código NÃO corrigido.
  - **RESULTADO ESPERADO**: testes PASSAM (confirmam a linha de base a preservar).
  - Arquivos tocados: `tests/modo-local-sem-firebase.preservation.test.js` (novo).
  - Verificar ao final: `cmd /c "npm.cmd test -- tests/modo-local-sem-firebase.preservation.test.js > tmp-preserve.txt 2>&1"`; confirmar que todos PASSAM no código atual; depois `cmd /c del tmp-preserve.txt`.
  - _Properties: 2_
  - _Requirements: 3.1, 3.3, 3.5_

- [x] 3. Flag MODO + inicialização do Firebase sob demanda em `public/app.js`
  - Introduzir no topo do módulo o interruptor único: `const MODO = (typeof window !== 'undefined' && window.PLANNERDUO_MODO) || 'local';` e `const ehModoLocal = () => MODO === 'local';`.
  - Remover as três linhas de topo que executam incondicionalmente (`firebase.initializeApp(...)`, `const auth = firebase.auth()`, `const db = firebase.firestore()`); substituir por `let auth = null;` / `let db = null;` e uma função `iniciarFirebase()` que faz `if (!firebase.apps.length) firebase.initializeApp(firebaseConfig)`, `auth = firebase.auth()`, `db = firebase.firestore()`.
  - Garantir que `app.js` carregue sem os SDKs presentes: nenhum acesso a `firebase.*` fora de `iniciarFirebase()` no topo do módulo.
  - _Bug_Condition: isBugCondition(X) = X.modo === 'local' AND X.sessao === null_
  - _Expected_Behavior: em modo local o módulo carrega sem tocar `firebase`; `iniciarFirebase()` só roda no caminho firebase (design: "Inicialização do Firebase sob demanda")_
  - Arquivos tocados: `public/app.js`.
  - Verificar ao final: `cmd /c "node --check public/app.js"` retorna sem erro (exit 0).
  - _Requirements: 2.14, 3.1, 3.5_

- [x] 4. `app.html`: tornar os recursos Firebase opcionais
  - Remover o atributo `data-bootstrap-required="true"` dos 3 SDKs do Firebase (app, auth, firestore) e de `auth-errors.js`, mantendo as tags `<script>` no HTML (carregamento opcional, para preservar o modo firebase).
  - Manter `bootstrap.js`, `core.js` e `app.js` com `data-bootstrap-required="true"` (obrigatórios nos dois modos).
  - _Bug_Condition: SDKs Firebase ausentes/atrasados em modo local não devem disparar `falhar('recurso')`_
  - _Expected_Behavior: em modo local o supervisor conclui sem exigir os SDKs (design: "app.html: recursos Firebase deixam de ser obrigatórios")_
  - Arquivos tocados: `public/app.html`.
  - Verificar ao final: `grep`/busca confirmando que os 3 SDKs e `auth-errors.js` NÃO têm mais `data-bootstrap-required`, e que `bootstrap.js`/`core.js`/`app.js` ainda têm; rodar `cmd /c "npm.cmd test -- tests/auth-bootstrap.test.js > tmp-html.txt 2>&1"` e confirmar verde; depois `cmd /c del tmp-html.txt`.
  - _Requirements: 2.2, 3.1_

- [x] 5. Entrada em modo local — DESTRAVA o app (abre direto no painel)
  - **Esta é a tarefa que resolve a tela travada.** Ao concluí-la, o app abre direto no painel sem login e sem a mensagem "demorando mais que o esperado".
  - [x] 5.1 Implementar `Auth._entrarModoLocal()` reutilizando `Auth._entrarNoApp`
    - Definir `Estado.casalId = 'local'`, `Estado.usuarioUid = 'local'`, `Estado.usuarioEmail = null`.
    - Carregar `nome1`/`nome2` locais do `localStorage` (com padrões Pessoa 1 / Pessoa 2) para `Estado.nome1`/`Estado.nome2`.
    - Montar `usuarioLocal = { uid: 'local', email: '', displayName: Estado.nome1 || 'Pessoa 1' }` e chamar `Auth._entrarNoApp(usuarioLocal)` (que já monta o shell, chama `DB.carregarCache()`, `Render.tudo()`, `_esconderLoader()` e `PlannerBootstrap.concluir()`).
    - _Bug_Condition: isBugCondition(X) = X.modo === 'local' AND X.sessao === null_
    - _Expected_Behavior: painel carrega, sem tela de demora, sem depender de rede (design: "Entrada no app em modo local")_
    - _Requirements: 2.1, 2.2, 2.12_
  - [x] 5.2 Ramificar `DOMContentLoaded` por `ehModoLocal()`
    - Se `ehModoLocal()`: chamar `Auth._entrarModoLocal()` (opcionalmente `Auth._iniciarFase('local', <curto>)`).
    - Senão: `iniciarFirebase()`, `Auth._iniciarFase('autenticacao', 10000)`, `Auth.iniciarObserver()` — exatamente como hoje.
    - Manter o restante do wiring de UI igual nos dois modos.
    - _Expected_Behavior: fluxo de inicialização de dois modos (design: "Fluxo de inicialização")_
    - _Requirements: 2.1, 2.11, 3.5_
  - [x] 5.3 Tornar `DB.ouvirNuvem()` no-op em modo local
    - `ouvirNuvem` checa `ehModoLocal()` e retorna cedo (sem `onSnapshot`); em modo firebase permanece idêntico.
    - _Expected_Behavior: em modo local não há dependência de rede; sync é reler o próprio `localStorage` no reload (design: "Camada de persistência local")_
    - _Requirements: 2.1, 3.5_
  - Arquivos tocados: `public/app.js`.
  - Verificar ao final: `cmd /c "node --check public/app.js"` sem erro; `cmd /c "npm.cmd test -- tests/modo-local-sem-firebase.exploration.test.js > tmp-t5.txt 2>&1"` — a parte de "painel carrega sem sessão / sem tela de demora" da Property 1 passa a PASSAR; depois `cmd /c del tmp-t5.txt`.
  - _Requirements: 2.1, 2.2, 2.11, 2.12_

- [ ] 6. Adaptador de armazenamento `Store` + camada `Local`
  - [ ] 6.1 Implementar a camada `Local` sobre `localStorage`
    - `Local.chave()` → `PlannerCore.chaveCache('local')` (`'pd-cache:local'`).
    - `Local.carregar()` → `JSON.parse` do `localStorage` em `try/catch`; parse inválido ou ausente → `null`.
    - `Local.salvarDoc(obj)` → lê o doc atual, faz merge e regrava o documento inteiro sob a chave (em `try/catch`; falha de escrita não derruba o app).
    - `Local.salvarCampo(campo, valor)` → merge de um único campo, regravando o documento inteiro.
    - _Expected_Behavior: espelha a semântica `{merge:true}` do Firestore gravando o objeto completo (design: "Camada de persistência local (Local)")_
    - _Requirements: 2.3, 2.13_
  - [ ] 6.2 Implementar o adaptador `Store` e ligar `DB` a ele
    - `Store.carregar()` e `Store.salvarCampos(camposObj)`: em firebase delega ao Firestore como hoje; em local delega ao `Local`.
    - `DB.salvar(campo)` e `DB.salvarVarios(campos)` montam o payload (`{campo: Estado[campo]}`, inalterado) e chamam `Store.salvarCampos(...)` em vez de falar direto com o Firestore.
    - `DB.carregarCache()` continua lendo de `pd-cache:{casalId}` e aplicando `DB._aplicar`/`normalizar` — funciona sem alteração com `casalId='local'`.
    - _Bug_Condition: gravações em modo local não devem depender do Firestore nem da rede_
    - _Expected_Behavior: round-trip estável `carregar(salvar(dados)) ≡ normalizar(dados)` (design: Property 1 e "Adaptador de Armazenamento")_
    - _Preservation: em modo firebase, `Store` chama `db.collection('casais').doc(casalId).set(payload,{merge:true})` idêntico ao original_
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.3_
  - Arquivos tocados: `public/app.js`.
  - Verificar ao final: `cmd /c "node --check public/app.js"` sem erro; `cmd /c "npm.cmd test > tmp-t6.txt 2>&1"` e confirmar suíte verde; depois `cmd /c del tmp-t6.txt`.
  - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.13_

- [ ] 7. Identidade local editável (nome1 / nome2)
  - Guardar nomes em `localStorage` nas chaves `pd-local-nome1` / `pd-local-nome2` (independentes do documento de dados), com padrões `"Pessoa 1"` / `"Pessoa 2"`.
  - Adicionar uma ação leve na sidebar (a partir de `#sidebar-user-name`): um modal "Editar nomes" com dois campos (Pessoa 1 / Pessoa 2). Ao salvar: grava as chaves em `localStorage`, atualiza `Estado.nome1`/`Estado.nome2` e chama `UI.atualizarNomes()` (que já propaga para selects, split e relatórios).
  - Escapar o texto do usuário com `Utils.esc` ao renderizar os nomes (preserva o comportamento de segurança atual).
  - _Expected_Behavior: identidade local editável e não bloqueante; padrões satisfazem `Utils.nomesCasal()` (design: "Identidade local editável")_
  - Arquivos tocados: `public/app.js`, `public/app.html` (modal/gatilho), possivelmente `public/style.css` (estilo do modal).
  - Verificar ao final: `cmd /c "node --check public/app.js"` sem erro; `cmd /c "npm.cmd test > tmp-t7.txt 2>&1"` verde (incluindo teste de que edição persiste e `UI.atualizarNomes()` propaga); depois `cmd /c del tmp-t7.txt`.
  - _Requirements: 2.12, 3.4_

- [ ] 8. Logout / "sair para landing" / convites em modo local
  - `Auth.logout()`: em modo local, no lugar de `auth.signOut()`, fazer "reset local" — confirmar e limpar `pd-cache:local` e as chaves de nomes, recarregando o painel vazio; não navegar para `auth.html`.
  - `Auth.sairParaLanding()`: em modo local, navegar para `index.html` sem `signOut`.
  - Convites: ocultar as ações da sidebar "Convidar parceiro(a)" / "Entrar com código" em modo local (recurso exige modo Firebase).
  - Todos os ramos decididos por `ehModoLocal()`; em modo firebase permanecem exatamente como hoje.
  - _Bug_Condition: fluxos que dependem de `auth.signOut()`/Firestore não existem em modo local_
  - _Expected_Behavior: comportamento mínimo coerente em local; inalterado em firebase (design: "Impacto em logout / sair para landing / convites")_
  - _Preservation: em modo firebase, logout/sairParaLanding/convites idênticos ao original_
  - Arquivos tocados: `public/app.js`, `public/app.html` (visibilidade das ações de convite).
  - Verificar ao final: `cmd /c "node --check public/app.js"` sem erro; `cmd /c "npm.cmd test > tmp-t8.txt 2>&1"` verde (logout em local não chama `signOut`; convites ocultos); depois `cmd /c del tmp-t8.txt`.
  - _Requirements: 2.11, 3.1, 3.5_

- [ ] 9. Verificar que o teste de exploração (Property 1) agora PASSA
  - **Property 1: Expected Behavior** — Round-trip de persistência local e painel carregado sem sessão
  - **IMPORTANTE**: re-executar o MESMO teste da tarefa 1 — NÃO escrever teste novo. O teste da tarefa 1 encoda o comportamento esperado; ao passar, confirma que o bug foi corrigido.
  - Rodar o teste de exploração da tarefa 1 sobre o código corrigido.
  - **RESULTADO ESPERADO**: teste PASSA (painel carrega, sem tela de demora, sem rede, round-trip `carregar(salvar(dados)) ≡ normalizar(dados)`).
  - Arquivos tocados: nenhum (somente execução).
  - Verificar ao final: `cmd /c "npm.cmd test -- tests/modo-local-sem-firebase.exploration.test.js > tmp-t9.txt 2>&1"` e confirmar PASS com no mínimo 100 iterações; depois `cmd /c del tmp-t9.txt`.
  - _Properties: 1_
  - _Requirements: 2.1, 2.2, 2.3, 2.13_

- [ ] 10. Verificar que os testes de preservação (Property 2) continuam PASSANDO
  - **Property 2: Preservation** — Caminho de montagem e persistência inalterados no modo Firebase
  - **IMPORTANTE**: re-executar os MESMOS testes da tarefa 2 — NÃO escrever testes novos.
  - Rodar os testes de preservação da tarefa 2 sobre o código corrigido.
  - **RESULTADO ESPERADO**: testes PASSAM (sem regressões — fluxo de auth, persistência Firestore e `DB.normalizar` inalterados em modo firebase).
  - Arquivos tocados: nenhum (somente execução).
  - Verificar ao final: `cmd /c "npm.cmd test -- tests/modo-local-sem-firebase.preservation.test.js > tmp-t10.txt 2>&1"` e confirmar PASS com no mínimo 100 iterações; depois `cmd /c del tmp-t10.txt`.
  - _Properties: 2_
  - _Requirements: 3.1, 3.3, 3.5_

- [ ] 11. Checkpoint — garantir toda a suíte verde
  - Rodar a suíte completa: os 72 testes atuais MAIS os novos (exploração/Property 1, preservação/Property 2, unidade do adaptador `Local`, round-trip, identidade local, logout/convites).
  - Se surgirem dúvidas ou falhas inesperadas, pausar e perguntar ao usuário antes de alterar escopo.
  - Arquivos tocados: nenhum (somente execução).
  - Verificar ao final: `cmd /c "npm.cmd test > tmp-final.txt 2>&1"` e confirmar 0 falhas (todos os testes verdes); depois `cmd /c del tmp-final.txt`.
  - _Requirements: 3.2_

## Task Dependency Graph

Ondas de execução (tarefas na mesma onda podem ser paralelizadas; ondas posteriores dependem das anteriores):

- **Wave 0 — Fundação do flag (destrava tudo o mais)**
  - Tarefa 3 — Flag MODO + Firebase sob demanda em `public/app.js`
  - Racional: introduz `MODO`/`ehModoLocal()` e move a inicialização do Firebase para `iniciarFirebase()`; todas as ramificações por `ehModoLocal()` das ondas seguintes dependem disto.

- **Wave 1 — Testes de base + HTML opcional (após Wave 0)**
  - Tarefa 1 — Teste de exploração (Property 1) — deve FALHAR aqui
  - Tarefa 2 — Testes de preservação (Property 2) — devem PASSAR aqui
  - Tarefa 4 — `app.html`: recursos Firebase opcionais
  - Observação: as tarefas 1 e 2 são escritas contra a superfície do flag (Wave 0) e executadas antes da correção de comportamento; a 4 é independente da 1/2.

- **Wave 2 — DESTRAVAMENTO (após Wave 1)**
  - Tarefa 5 — Entrada em modo local (`Auth._entrarModoLocal`, ramificação de `DOMContentLoaded`, `ouvirNuvem` no-op)
  - Racional: esta é a tarefa que resolve a tela travada — o app passa a abrir direto no painel. Vem logo cedo, imediatamente após a fundação e os testes de base.

- **Wave 3 — Persistência local (após Wave 2)**
  - Tarefa 6 — Adaptador `Store` + camada `Local`

- **Wave 4 — Incrementos de produto (após Wave 3)**
  - Tarefa 7 — Identidade local editável
  - Tarefa 8 — Logout / sair para landing / convites em modo local
  - (7 e 8 são independentes entre si; ambas dependem da persistência local e do flag.)

- **Wave 5 — Validação final (após Wave 4)**
  - Tarefa 9 — Property 1 agora PASSA
  - Tarefa 10 — Property 2 continua PASSANDO
  - Tarefa 11 — Checkpoint: suíte completa verde
