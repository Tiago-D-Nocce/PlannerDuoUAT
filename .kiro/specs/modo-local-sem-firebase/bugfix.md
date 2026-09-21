# Bugfix Requirements Document

## Introduction

O usuário não consegue acessar o PlannerDuo. Ao abrir `http://localhost:5500/app.html` sem uma sessão autenticada do Firebase, o loader fica preso na mensagem "A inicialização está demorando mais que o esperado. Você pode aguardar ou tentar novamente." e o painel nunca aparece.

A causa raiz está confirmada em `public/app.js`: no `DOMContentLoaded`, `Auth.iniciarObserver()` chama `auth.onAuthStateChanged(...)` (Firebase Auth compat v12). Sem uma sessão estabelecida — que exigiria passar pelo login em `auth.html` — o callback resolve com `user = null`, `Auth._entrarNoApp` nunca executa, o shell nunca é montado e `PlannerBootstrap.concluir()` nunca é chamado. Aos 10s o supervisor de bootstrap (`public/bootstrap.js`) exibe o aviso de demora, que é exatamente a tela travada observada. Além disso, toda a persistência (`DB.ouvirNuvem`, gravações via `db.collection('casais').doc(...)`) depende do Firestore e da rede.

Decisão do usuário (já confirmada): desligar Firebase (Auth + Firestore) por enquanto e deixar o app 100% funcional localmente, sem login, abrindo direto no painel e persistindo tudo em `localStorage`. O código do Firebase deve ser preservado no projeto (não remover `auth.html`, `core.js`, `firestore.rules`, `.firebaserc`, nem a config do Firebase), com um interruptor único (flag) que alterna entre modo local e modo Firebase para religar depois. O foco atual é front-end + JavaScript; a religação do Firebase fica para outra etapa.

O escopo é proporcional a um bugfix de front-end: destravar o uso local preservando o comportamento de produto existente, sem introduzir requisitos novos (nada de multiusuário local, sincronização entre abas ou criptografia).

## Bug Analysis

### Current Behavior (Defect)

Ao abrir a página do app sem uma sessão Firebase, a inicialização depende de autenticação e de rede que nunca se resolvem, deixando a interface inacessível.

1.1 WHEN a página do app é aberta sem nenhuma sessão autenticada do Firebase THEN the system observa `user = null`, não monta o shell do painel e mantém o loader ativo indefinidamente

1.2 WHEN a inicialização sem sessão não conclui o bootstrap dentro de 10 segundos THEN the system exibe a mensagem "A inicialização está demorando mais que o esperado. Você pode aguardar ou tentar novamente." e permanece nessa tela

1.3 WHEN o usuário tenta usar o app sem login THEN the system exige a passagem pelo fluxo de autenticação em `auth.html` antes de qualquer acesso ao painel

1.4 WHEN qualquer operação de dados (leitura ou gravação de transações, viagens, metas, checklist, orçamentos) é acionada THEN the system depende do Firestore (`db.collection('casais').doc(...)` e `onSnapshot`) e da rede para funcionar

### Expected Behavior (Correct)

O app deve operar em um "modo local" sem login nem rede, com todas as funcionalidades de produto funcionando sobre `localStorage`.

2.1 WHEN a página do app é aberta em modo local sem nenhuma sessão Firebase THEN the system SHALL carregar o painel e deixá-lo utilizável, sem tela de espera indefinida e sem depender de rede

2.2 WHEN o app é inicializado em modo local THEN the system SHALL concluir o bootstrap normalmente, de modo que a mensagem "demorando mais que o esperado" NÃO apareça no fluxo normal

2.3 WHEN dados são lidos ou gravados em modo local THEN the system SHALL persistir e recuperar tudo em `localStorage` (reaproveitando a base `DB.carregarCache`/`DB.normalizar` e a chave `pd-cache:{casalId}`), sem acessar o Firestore

2.4 WHEN o usuário cria, edita ou exclui uma transação em modo local THEN the system SHALL refletir a operação e persisti-la em `localStorage`

2.5 WHEN o usuário opera viagens em modo local, incluindo o cofrinho THEN the system SHALL CONTINUE TO calcular e persistir os valores em `localStorage`

2.6 WHEN o usuário opera metas em modo local, incluindo depósito THEN the system SHALL atualizar e persistir os valores em `localStorage`

2.7 WHEN o usuário usa checklist e templates em modo local THEN the system SHALL criar, marcar e persistir os itens em `localStorage`

2.8 WHEN o usuário define orçamentos por categoria em modo local THEN the system SHALL persistir os limites em `localStorage` e aplicá-los aos relatórios

2.9 WHEN o usuário visualiza relatórios e gráficos em modo local THEN the system SHALL renderizá-los a partir dos dados de `localStorage`

2.10 WHEN o usuário exporta CSV em modo local THEN the system SHALL gerar o arquivo a partir dos dados locais

2.11 WHEN o usuário busca viagens, troca de tema ou navega entre views em modo local THEN the system SHALL executar a ação sem depender de login ou rede

2.12 WHEN o app opera em modo local THEN the system SHALL fornecer uma identidade local padrão para que os rótulos de responsável (Pessoa 1 / Pessoa 2), o acerto de contas e os relatórios por pessoa funcionem sem login

2.13 WHEN a página é recarregada em modo local THEN the system SHALL preservar os dados previamente gravados (a persistência em `localStorage` sobrevive ao reload)

2.14 WHEN o modo de operação precisa ser alternado THEN the system SHALL expor um interruptor único e explícito (um flag) que troca entre modo local e modo Firebase em um único ponto de configuração

### Unchanged Behavior (Regression Prevention)

A correção deve ser mínima e manter o caminho de volta ao Firebase intacto, sem quebrar o comportamento de produto existente nem a suíte de testes.

3.1 WHEN o modo Firebase estiver religado no futuro THEN the system SHALL CONTINUE TO dispor de `auth.html`, `core.js`, `firestore.rules`, `.firebaserc` e da config do Firebase sem remoção ou quebra

3.2 WHEN a suíte de testes existente (vitest + fast-check, 72 testes) é executada THEN the system SHALL CONTINUE TO passar em todos os testes atuais

3.3 WHEN os dados são normalizados para exibição e cálculo THEN the system SHALL CONTINUE TO usar a lógica de `DB.normalizar` (saneamento de datas, tipos, responsáveis e valores) tanto em modo local quanto Firebase

3.4 WHEN o texto vindo do usuário é interpolado na interface THEN the system SHALL CONTINUE TO escapar HTML e validar URLs (`Utils.esc`, `Utils.urlSegura`) como já ocorre hoje

3.5 WHEN o flag estiver configurado para modo Firebase THEN the system SHALL CONTINUE TO realizar o fluxo de autenticação e a persistência via Firestore como no comportamento original

## Bug Condition e Propriedades

### Definições

- **F**: função de inicialização/persistência original (antes da correção) — depende de sessão Firebase e Firestore.
- **F'**: função após a correção — opera em modo local sobre `localStorage` quando o flag indica modo local.
- **C(X)**: condição do bug — entradas que hoje deixam o app inacessível.
- **P(result)**: propriedade — comportamento correto esperado para entradas em C(X).

### Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X = { modo: 'local' | 'firebase', sessao: Session | null }
  OUTPUT: boolean

  // Em modo local não deve existir dependência de sessão nem de rede.
  // O bug se manifesta ao abrir o app em modo local sem sessão Firebase.
  RETURN X.modo = 'local' AND X.sessao = null
END FUNCTION
```

### Property (Fix Checking)

```pascal
// Propriedade: abrir e usar o app em modo local, sem login e sem rede
FOR ALL X WHERE isBugCondition(X) DO
  result <- inicializarApp'(X)
  ASSERT painel_carregado(result)
     AND NOT tela_demora_visivel(result)
     AND NOT depende_de_rede(result)
     AND dados_persistem_em_localStorage(result)
END FOR
```

### Preservation (Preservation Checking)

```pascal
// Propriedade: entradas fora da condição do bug (ex.: modo Firebase)
// comportam-se de forma idêntica à versão original.
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

## Decisões em Aberto

- **D1 — Nomes da identidade local:** se os rótulos Pessoa 1 / Pessoa 2 devem ser fixos ou editáveis pelo usuário em modo local. Tornar os nomes **editáveis** é desejável, mas **não bloqueante** para a correção; um padrão fixo já satisfaz os critérios de aceitação acima.
