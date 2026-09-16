# Firebase Auth Bootstrap Stall Bugfix Design

## Overview

O fluxo publicado inicia um supervisor de 10 segundos, carrega os SDKs do Firebase e, em `app.js`, executa novamente `setPersistence(SESSION)` antes de registrar `onAuthStateChanged`. O helper `limitarOperacaoAuth` rejeita artificialmente após 3 segundos e não cancela a operação original. Se a operação real conclui no milissegundo seguinte, o resultado já foi convertido em `false`, o observer nunca é registrado e o supervisor mostra a tela de recuperação. O mesmo mecanismo transforma erros de armazenamento em uma mensagem genérica de conexão.

A análise de `9ebdd40`, que é o `HEAD` e `origin/main` durante a investigação, e a leitura dos assets públicos `https://plannerduo.web.app/app.js` e `https://plannerduo.web.app/bootstrap.js` confirmam que o gate e o watchdog estão no fluxo publicado. A suíte atual passa com 109 testes, mas contém uma asserção estática de que a persistência deve ser um “gate terminal” e não exercita sucesso após 3 segundos, rejeição global não relacionada, soma de fases acima de 10 segundos ou falha de navegação.

A correção proposta tem cinco partes:

1. manter a escolha de `SESSION` como pré-condição somente antes de uma nova autenticação em `auth.html`, sem converter demora em rejeição definitiva;
2. remover o segundo gate de persistência da página do aplicativo e iniciar o observer de Auth diretamente;
3. tornar o supervisor orientado a operações/fases próprias, sem promover toda `unhandledrejection` global a falha fatal;
4. permitir recuperação de um estado “demorado” quando a operação válida termina e impedir que tempos válidos de fases sequenciais sejam somados contra um único teto fatal;
5. não concluir o supervisor antes de um redirecionamento que ainda pode falhar.

Nenhuma mudança de versão do Firebase, modelo de dados, regra do Firestore ou política para persistência LOCAL faz parte desta correção.

## Glossary

- **Bug_Condition (C)**: cenário em que uma sessão recuperável ou uma inicialização válida é convertida em falha terminal, ou em que uma transição deixa o loader sem saída.
- **Property (P)**: garantia de que um cenário de C termina no app ou em uma recuperação correta, sem falso erro terminal e sem loader infinito.
- **Preservation**: equivalência do comportamento original para entradas fora de C, incluindo sessão por aba, falhas críticas visíveis, redirecionamento sem sessão e fallback offline-first.
- **Persistencia_SESSION**: persistência do Firebase Auth limitada à sessão da aba; deve ser escolhida antes de criar uma nova sessão autenticada.
- **Gate_Terminal_3s**: corrida criada por `PlannerAuthErrors.limitarOperacaoAuth`, que rejeita após 3000 ms e descarta qualquer conclusão posterior.
- **Supervisor_Bootstrap**: máquina de estados de `public/bootstrap.js` que controla loader, ações de recuperação, erros de recursos e tempo de inicialização.
- **Operacao_Critica_Registrada**: Promise ou carregamento explicitamente pertencente ao bootstrap, com tratamento de sucesso/falha ligado ao supervisor.
- **Rejeicao_Nao_Possuida**: evento `unhandledrejection` sem vínculo verificável com uma Operacao_Critica_Registrada.
- **Estado_Demorado**: estado recuperável que pode mostrar orientação/retry sem impedir uma conclusão válida tardia.
- **Resultado_Terminal_Seguro**: exatamente um entre aplicativo visível, navegação iniciada/confirmada ou painel de recuperação acionável com `aria-busy=false`; nunca loader ocupado indefinidamente.
- **Fluxo_Auth**: script inline de `public/auth.html`, responsável por definir a persistência antes de login, cadastro ou redirect do Google.
- **Fluxo_App**: `public/app.js`, responsável por observar a sessão já estabelecida, resolver o espaço compartilhado e montar o shell.

## Bug Details

### Bug Condition

Considere uma entrada `X` do tipo `BootstrapScenario` com página, sessão prévia, resultado/latência da persistência, eventos globais, duração das fases e resultado da navegação. A condição é a união dos cinco ramos abaixo:

- `C_late`: a persistência no app conclui com sucesso após 3000 ms e o restante do bootstrap concluiria normalmente;
- `C_storage`: o app já recebeu uma sessão válida, mas uma segunda configuração de persistência atrasa/rejeita e impede até a observação dessa sessão, ou a falha é rotulada como conexão em vez de armazenamento;
- `C_unowned`: uma rejeição não possuída ocorre antes da conclusão e as operações críticas próprias continuam válidas;
- `C_budget`: cada fase válida satisfaz seu contrato individual, mas a soma desde o início passa de 10000 ms;
- `C_navigation`: um redirecionamento necessário falha depois que o supervisor foi marcado como pronto, eliminando a saída de recuperação.

Em notação de conjuntos:

`C(X) = C_late(X) ∪ C_storage(X) ∪ C_unowned(X) ∪ C_budget(X) ∪ C_navigation(X)`

**Formal Specification:**

```
FUNCTION isBugCondition(X)
  INPUT: X of type BootstrapScenario
  OUTPUT: boolean

  latePersistence :=
    X.page = APP
    AND X.hasEstablishedSession
    AND X.persistence.outcome = SUCCESS
    AND X.persistence.delayMs > 3000
    AND X.criticalOperationsWouldSucceed

  recoverableStorageInterference :=
    X.page = APP
    AND X.hasEstablishedSession
    AND X.persistence.outcome IN [DELAYED, STORAGE_REJECTION]
    AND (X.authObserverWouldSettle OR X.reportedCategory = GENERIC_CONNECTION)

  unrelatedRejection :=
    X.bootstrapPending
    AND X.rejection.owner != BOOTSTRAP
    AND X.criticalOperationsWouldSucceed

  compoundedBudget :=
    EVERY phase IN X.phases SATISFIES phase.contract
    AND SUM(X.phases.durationMs) > 10000

  strandedNavigation :=
    X.redirectRequired
    AND X.supervisorCompletedBeforeNavigation
    AND X.navigation.outcome IN [THROWS, NO_PAGE_EXIT]

  RETURN latePersistence
      OR recoverableStorageInterference
      OR unrelatedRejection
      OR compoundedBudget
      OR strandedNavigation
END FUNCTION
```

O oráculo esperado diferencia atraso, erro real e preservação da política de sessão:

```
FUNCTION expectedBehavior(result, X)
  INPUT: result of type BootstrapResult
  INPUT: X of type BootstrapScenario
  OUTPUT: boolean

  IF X.actualSessionPolicyFailureBeforeNewLogin THEN
    RETURN result.storageSpecificRecoveryVisible
       AND NOT result.credentialOperationStarted
       AND NOT result.localPersistenceUsed
       AND result.isRecoverable
  END IF

  IF X.redirectRequired THEN
    RETURN result.navigationStarted
        OR (result.actionableRecoveryVisible AND NOT result.loaderBusy)
  END IF

  IF X.hasEstablishedSession AND X.criticalOperationsWouldSucceed THEN
    RETURN result.authObserverStarted
       AND result.appVisible
       AND NOT result.falseTerminalFailure
  END IF

  IF X.explicitOwnedCriticalFailure THEN
    RETURN result.actionableRecoveryVisible AND NOT result.loaderBusy
  END IF

  RETURN result.hasSafeTerminalOutcome
END FUNCTION
```

### Examples

| Cenário | Comportamento atual | Comportamento correto |
| --- | --- | --- |
| `setPersistence(SESSION)` no app resolve em 3200 ms | timeout sintético aos 3000 ms, observer não inicia, recuperação permanente | sucesso tardio aceito; observer resolve a sessão e o app abre |
| Sessão válida já criada; acesso a storage lança erro suportado de armazenamento na segunda página | mensagem de conexão e bloqueio antes do observer | não repetir o gate no app; se o estado realmente não puder ser recuperado, mostrar mensagem específica de armazenamento |
| Uma Promise não relacionada rejeita 100 ms antes do callback autenticado | `unhandledrejection` muda o supervisor para `erro`; o callback posterior não pode abrir o app | rejeição não possuída não decide o bootstrap; callback autenticado abre o app |
| SDKs levam 1,4 s, persistência 2,8 s, observer 0,5 s e fallback do Firestore 6 s | soma de 10,7 s aciona o watchdog apesar de cada etapa respeitar seu limite | fases avançam/resetam o aviso; o fallback monta o shell |
| Usuário ausente e `location.replace` lança | supervisor já está `pronto`; o catch não consegue mostrar falha e o loader fica | supervisor continua pendente/demorado e mostra recuperação; trava de navegação é liberada |
| SDK obrigatório não carrega | recuperação visível | recuperação visível, sem regressão |

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- Login por e-mail/senha, cadastro e Google continuam aguardando a seleção real de `SESSION` antes de criar uma nova sessão.
- Não haverá fallback silencioso para `LOCAL`; uma falha real de storage antes do login bloqueia a operação com mensagem segura e específica.
- Acesso ao app sem usuário continua redirecionando para `auth.html` sem exibir conteúdo privado.
- Falhas explícitas de scripts/SDKs obrigatórios, do observer ou da montagem continuam gerando recuperação persistente.
- O timeout de 6 segundos de `resolverCasalId`, o fallback para cache/UID e o listener Firestore best-effort permanecem.
- Cache corrompido ou storage bloqueado nas funções offline-first continua sendo tolerado pelos `try/catch` existentes.
- O shell só fica visível depois da montagem síncrona bem-sucedida; o loader é removido uma única vez.
- Diagnósticos continuam allowlisted e sem erro bruto, e-mail, UID, token, credencial, chave ou payload de documento.
- Logout, troca de conta e limpeza pós-logout mantêm a ordem atual: limpar/navegar somente depois de `signOut` confirmado.

**Scope:**

Entradas fora da Bug_Condition devem manter o resultado observado no código não corrigido. A correção não altera:

- regras ou documentos do Firestore;
- dados locais do casal e formato de cache;
- versão ou configuração pública do SDK Firebase;
- layout e conteúdo funcional das telas;
- semântica de login, cadastro, recuperação de senha, Google redirect ou logout;
- cabeçalhos e rewrites do Firebase Hosting.

## Hypothesized Root Cause

A causa de código é confirmada; o gatilho específico do notebook permanece uma hipótese até existir uma captura local sanitizada de categoria e tempos.

1. **Timeout sintético tratado como fato terminal**: `limitarOperacaoAuth` usa uma corrida de 3000 ms, não cancela a Promise original e fecha a corrida após o primeiro resultado.
   - Uma resolução em 3001 ms é indistinguível de uma operação eternamente pendente para os chamadores.
   - Em `app.js`, a rejeição vira `false`; o callback de `DOMContentLoaded` chama `_falharBootstrap` e nunca registra `onAuthStateChanged`.

2. **Persistência configurada duas vezes no fluxo login → app**: `auth.html` já exige `SESSION` antes do login e a página seguinte repete a operação como pré-condição do observer.
   - A segunda chamada não cria a sessão; apenas introduz outro ponto de serialização/armazenamento antes de ler uma sessão já criada.
   - Navegadores com perfil lento, storage sob contenção, políticas de privacidade, falhas de quota ou estado corrompido tornam esse ponto mais provável.

3. **Erro de storage e erro de rede colapsados no mesmo resultado visual**: o app descarta o erro normalizado após registrar diagnóstico e usa a categoria genérica `autenticacao`; o painel do app sempre mostra a mensagem de conexão.
   - Para storage bloqueado/corrompido, o erro subjacente pode ser real, mas o diagnóstico ao usuário é incorreto e o gate do app não verifica se a sessão já é observável.
   - Portanto: atraso com sucesso tardio é uma falsa falha comprovável; rejeição real de storage é uma falha ambiental real que o fluxo atual transforma em falha genérica e potencialmente mais ampla do que necessário.

4. **Watchdog global sem relação de posse**: `aoRejeicaoGlobal` ignora `evento.promise`, `evento.reason` e a origem da operação; qualquer rejeição durante a janela chama `falhar('inicializacao')`.
   - O estado `erro` é irreversível e `_entrarNoApp` retorna quando o encontra, mesmo que Auth e montagem tenham concluído.
   - Falhas próprias já têm catches explícitos; o listener global acrescenta falsos positivos sem fornecer atribuição segura.

5. **Teto absoluto incompatível com tetos sequenciais**: o supervisor inicia antes dos três SDKs e expira em 10 segundos, enquanto o fluxo ainda permite até 3 segundos de persistência e 6 segundos de Firestore, além de download, inicialização de Auth, callback do observer e renderização.
   - Não é necessário que uma etapa viole seu contrato para que a soma viole 10 segundos.

6. **Conclusão antes da navegação**: `_redirecionar` chama `PlannerBootstrap.concluir()` antes de `location.replace`.
   - Se `replace` lançar, `_processarEstado(...).catch` chama `_falharBootstrap`, mas `falhar` recusa transição a partir de `pronto`.
   - Se a navegação não retirar a página, o watchdog já foi cancelado e o loader não tem outra saída determinística.

7. **Cobertura atual reforça a decisão defeituosa**: `tests/auth-bootstrap.test.js` verifica por texto que o auth tem gate terminal; `tests/auth-errors.test.js` cobre apenas “resolve antes” e “nunca resolve”; o stub de `app-saneamento.test.js` faz `setPersistence` resolver imediatamente como objeto.
   - Nenhum teste representa o intervalo crítico “timeout primeiro, sucesso depois”.

## Correctness Properties

Property 1: Bug Condition - Bootstrap autenticado não produz falso terminal

_For any_ cenário em que `isBugCondition` retorna verdadeiro — persistência válida que conclui depois de 3 segundos, interferência recuperável de storage no app, rejeição não possuída, fases válidas cuja soma passa de 10 segundos ou navegação que falha — o fluxo corrigido SHALL satisfazer `expectedBehavior`: observar a sessão e abrir o app quando as operações críticas forem válidas, ou produzir recuperação específica e acionável sem deixar o loader ocupado.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Preservation - Sessão por aba e falhas críticas permanecem seguras

_For any_ cenário em que `isBugCondition` retorna falso, o fluxo corrigido SHALL produzir o mesmo resultado funcional do fluxo original: exigir SESSION antes de nova autenticação, redirecionar usuário ausente, recuperar falha crítica explícita, aplicar fallback offline-first, montar o shell uma vez e emitir somente diagnóstico sanitizado, sem usar persistência LOCAL.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

**File: `public/app.js` — bootstrap da página autenticada**

1. Remover `persistenciaAuth` como gate e não executar uma segunda `setPersistence(SESSION)` antes do observer.
2. No `DOMContentLoaded`, iniciar `Auth.iniciarObserver()` diretamente e registrar essa espera como fase própria do supervisor.
3. Manter tratamento explícito do callback de erro do observer e do catch de `_processarEstado`.
4. Em `_redirecionar`, não marcar o supervisor como pronto antes da saída da página; envolver a navegação em `try/catch`, liberar `_navegando` e chamar recuperação se a navegação lançar. Se a página não sair, o supervisor continua capaz de sinalizar demora/recuperação.
5. Preservar `resolverCasalId`, fallback local e montagem do shell; somente informar avanço de fase antes/depois dessas etapas.

**File: `public/auth.html` — único proprietário da política SESSION antes do login**

1. Continuar chamando `setPersistence(SESSION)` antes de login, cadastro e Google redirect.
2. Substituir o gate que rejeita aos 3 segundos por uma Promise que mantém o resultado real. Um limiar pode sinalizar `Estado_Demorado`, mas não pode fabricar `auth/timeout` nem descartar sucesso tardio.
3. Em rejeição real, normalizar a categoria; para storage, mostrar mensagem específica, manter credenciais desabilitadas/não iniciadas e nunca cair para LOCAL.
4. Consumir todas as rejeições próprias sem `throw` órfão; login/cadastro/redirect continuam recebendo a mesma rejeição tratada.
5. Permitir que uma conclusão tardia retire o aviso não terminal e habilite o fluxo.

**File: `public/bootstrap.js` — supervisor com posse e progresso**

1. Separar `demorado` de `erro`: `demorado` pode mostrar ações, mas `concluir()` deve poder transicionar de `pendente` ou `demorado` para `pronto` e limpar a UI de demora.
2. Introduzir avanço/reinício de fase (por exemplo, `iniciarFase(nome, timeoutMs)`) para que download, Auth, dados e navegação não compartilhem um teto absoluto incompatível.
3. Remover `unhandledrejection` como causa fatal genérica. Operações críticas devem chamar `falhar` por seus próprios handlers; no máximo, o listener global pode produzir diagnóstico sanitizado sem mudar o estado.
4. Limitar erros de recurso fatais a assets explicitamente obrigatórios. Recursos opcionais não podem decidir o bootstrap.
5. Garantir a invariante de liveness: de todo estado não terminal existe uma transição para `pronto` ou recuperação acionável.

**File: `public/auth-errors.js` — atraso não é rejeição**

1. Remover `limitarOperacaoAuth` dos fluxos de bootstrap ou substituí-lo por helper de observação de demora que não muda o settlement da Promise original.
2. Preservar normalização/diagnóstico seguro e categorias de storage já existentes.
3. Não criar fallback de persistência; a decisão continua no Fluxo_Auth.

**Files: `public/app.html` e `public/auth.html` — recursos críticos explícitos**

1. Ligar falhas dos scripts obrigatórios ao supervisor por handlers explícitos/allowlist, em vez de depender de qualquer erro global.
2. Preservar o carregamento de `bootstrap.js` antes do Firebase e os controles de recuperação sem SDK.
3. Não tornar Font Awesome ou outro recurso visual opcional um bloqueador do app.

**Files: `tests/auth-bootstrap.test.js`, `tests/auth-errors.test.js`, `tests/app-saneamento.test.js` e novo teste de fluxo se necessário**

1. Trocar asserções textuais do gate por testes comportamentais com scheduler, storage, Auth, DOM e navegação falsos.
2. Usar `fast-check`, já instalado, para gerar latências, ordens de eventos e resultados sem rede.
3. Nenhum teste deve importar o SDK remoto, usar credencial real, acessar Firebase Auth/Firestore ou ler/gravar dados de produção.

### Requirements Traceability

| Mudança | Requisitos |
| --- | --- |
| Remover gate redundante do app | 2.1, 2.2, 3.1, 3.3 |
| SESSION real e não terminal no auth | 2.1, 2.2, 3.1, 3.7 |
| Supervisor por fase/estado demorado | 2.1, 2.4, 2.5, 3.2, 3.5 |
| Remover decisão fatal de rejeição não possuída | 2.3, 3.2, 3.6 |
| Redirecionamento sem conclusão prematura | 2.5, 3.3 |
| Preservar fallback e diagnóstico | 3.4, 3.6 |

## Testing Strategy

### Validation Approach

Primeiro serão escritos testes que falham no código não corrigido e registram os contraexemplos. Em seguida serão observados e fixados em testes os comportamentos fora da condição. Só então o código será alterado e os mesmos testes serão repetidos. Toda simulação será local, determinística e sem credenciais, SDK remoto ou dados em nuvem.

### Exploratory Bug Condition Checking

**Goal:** provar a falsa falha antes da correção e distinguir mecanismo de código do gatilho específico do navegador.

**Test Plan:** criar um harness com relógio falso, Promise controlável, Auth falso, DOM mínimo e `location` injetável. Gerar cenários de `BootstrapScenario`, executar o fluxo não corrigido e comparar com `expectedBehavior`.

**Test Cases:**

1. **Sucesso tardio determinístico:** atraso de 3001 ms e depois resolução de SESSION; no código atual, o observer permanece em zero chamadas.
2. **Storage interferente no app:** sessão estabelecida e rejeição `auth/web-storage-unsupported`; demonstrar que o gate bloqueia o observer e a UI do app usa mensagem genérica.
3. **Rejeição não possuída:** disparar `unhandledrejection` não relacionado antes de um callback Auth válido; demonstrar estado `erro` irreversível.
4. **Orçamento composto:** gerar fases válidas com soma acima de 10000 ms; demonstrar timeout global antes da montagem.
5. **Navegação que lança:** usuário ausente e `location.replace` falso que lança; demonstrar supervisor `pronto` com loader ainda ocupado.

**Expected Counterexamples:**

- `delayMs = 3001` é o menor contraexemplo do gate.
- `phases = [1400, 2800, 500, 6000]` é um contraexemplo do teto composto.
- Uma rejeição `{ owner: 'unrelated' }` antes do callback autenticado é suficiente para bloquear a conclusão.
- `replace() -> throw` deixa o estado atual em `pronto` e sem recuperação.

### Fix Checking

**Goal:** verificar todos os ramos de C com os mesmos testes exploratórios.

**Pseudocode:**

```
FOR ALL X WHERE isBugCondition(X) DO
  result := runFixedBootstrap(X)
  ASSERT expectedBehavior(result, X)
END FOR
```

O teste deve ser executado primeiro no código não corrigido e registrado como falha esperada; depois da implementação, a mesma propriedade deve passar sem relaxar geradores ou asserções.

### Preservation Checking

**Goal:** capturar primeiro o comportamento atual de entradas `NOT isBugCondition(X)` e provar equivalência após a correção.

**Pseudocode:**

```
FOR ALL X WHERE NOT isBugCondition(X) DO
  baseline := runOriginalBootstrap(X)
  fixed := runFixedBootstrap(X)
  ASSERT observableResult(baseline) = observableResult(fixed)
END FOR
```

**Test Plan:** observar no código não corrigido: SESSION rápida, usuário ausente, falha de script obrigatório, erro explícito do observer, fallback do Firestore, storage local bloqueado nos caches, montagem bem-sucedida e diagnóstico sanitizado. Codificar esses resultados antes da implementação e confirmar que passam na baseline.

**Test Cases:**

1. SESSION resolve entre 0 e 3000 ms; login e observer seguem uma vez.
2. Usuário ausente; destino continua `auth.html` e shell privado não aparece.
3. Script Firebase obrigatório ou observer falha; painel de recuperação aparece com ações.
4. `resolverCasalId` rejeita/expira; UID/cache é usado e shell abre.
5. Leitura/gravação de cache lança; app permanece offline-first.
6. Erro contém e-mail/token/mensagem bruta; diagnóstico não contém nenhum desses valores.
7. Logout rejeita; sessão/cache permanecem como hoje.

### Unit Tests

- Máquina de estados `pendente → demorado → pronto` e `pendente/demorado → erro`, incluindo limpeza de timers/UI.
- Helper de demora preserva exatamente resolução ou rejeição original e nunca cria `auth/timeout` sintético.
- Classificação de erros reais de storage versus rede.
- `_redirecionar` com sucesso, exceção e página que permanece.
- Allowlist de recursos críticos e rejeição global não possuída.
- Call count: observer, montagem, conclusão e falha no máximo uma vez.

### Property-Based Tests

- Gerar latências de 0 a 30000 ms, com foco nos limites 2999/3000/3001, e provar aceitação de sucesso tardio.
- Gerar sequências e durações de fases que respeitam contratos individuais, inclusive soma acima de 10 segundos.
- Gerar ordens entre rejeição não possuída, callback Auth, fallback e aviso de demora.
- Gerar falhas/valores de storage e provar que nunca selecionam LOCAL e nunca vazam payload.
- Usar no mínimo 100 execuções por propriedade e preservar o seed/contraexemplo em caso de falha.

### Integration Tests

- Executar `auth.html → app.js` em VM/harness com Firebase Auth falso: SESSION real resolve, login falso cria usuário e a segunda página observa a sessão sem novo gate.
- Simular SDK obrigatório ausente e confirmar recuperação sem depender do SDK.
- Simular storage bloqueado/corrompido, tanto antes de novo login quanto com sessão já estabelecida.
- Simular fallback Firestore e montagem completa do shell com DOM falso.
- Executar `npm test` e `npm run verificar`; para `npm run verificar`, iniciar `npm run dev` manualmente em outro terminal e encerrá-lo após a checagem, sem usar watcher.
- Antes de qualquer publicação, validar um canal de preview somente com assets públicos e cenários sem login; publicação em preview/produção exige aprovação humana explícita e não faz parte da implementação automática desta spec.
