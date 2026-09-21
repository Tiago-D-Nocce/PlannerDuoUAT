# Modo Local sem Firebase — Bugfix Design

## Overview

Hoje o PlannerDuo só monta o painel depois que o Firebase Auth confirma uma sessão. Ao abrir `app.html` sem login, `auth.onAuthStateChanged` resolve com `user = null`, `Auth._entrarNoApp` nunca roda, `PlannerBootstrap.concluir()` nunca é chamado e aos 10s o supervisor exibe "A inicialização está demorando mais que o esperado". O app fica inacessível.

A correção introduz um **modo local** ligado por padrão: o app abre direto no painel, sem login e sem rede, persistindo tudo em `localStorage`. Todo o código do Firebase (config, `auth.html`, `core.js`, `firestore.rules`, `.firebaserc`, os SDKs) é preservado. Um **interruptor único** (flag `MODO`) alterna entre `local` e `firebase` num único ponto de configuração, para religar o Firebase depois sem reescrever nada.

A estratégia é mínima e reaproveita ao máximo o que já existe:

- O caminho de montagem do shell (`Auth._entrarNoApp`) é **reutilizado**; o modo local apenas alimenta um usuário/casalId sintético em vez de esperar o Firebase.
- O saneamento (`DB.normalizar`) e a chave de cache (`PlannerCore.chaveCache`) continuam sendo a única fonte de verdade para formato de dados.
- As gravações (`DB.salvar`/`DB.salvarVarios`) passam a delegar a um adaptador de armazenamento que decide, pelo flag, entre Firestore e `localStorage`. O resto do app (`Controladores`, `Render`) não sabe em qual modo está.

O escopo é proporcional a um bugfix de front-end: destravar o uso local preservando o comportamento de produto e a suíte de 72 testes. Sem multiusuário local, sync entre abas ou criptografia.

## Glossary

- **Bug_Condition (C)**: abrir/usar o app em modo local sem sessão Firebase — `C(X) = (X.modo === 'local' AND X.sessao === null)`. Hoje isso deixa o app preso no loader.
- **Property (P)**: comportamento correto para entradas em C — o painel carrega, sem tela de demora, sem depender de rede, e os dados persistem em `localStorage`.
- **Preservation**: entradas fora de C (modo `firebase`) comportam-se de forma idêntica ao app atual — mesmo fluxo de auth, mesmo Firestore, mesmo caminho de montagem.
- **MODO**: o flag/interruptor único. Constante lida no topo do `app.js` com valor `'local'` ou `'firebase'`, sobrescrevível por `window.PLANNERDUO_MODO`.
- **Adaptador de Armazenamento (Store)**: camada com uma superfície comum (`carregar`/`salvarCampos`) usada por `DB`, que resolve para Firestore ou `localStorage` conforme `MODO`.
- **Identidade local**: usuário/casalId sintético (`casalId = 'local'`) e nomes `nome1`/`nome2` guardados em `localStorage`, sem conta nem e-mail.
- **`Auth._entrarNoApp(user)`**: função existente em `public/app.js` que monta o shell, chama `DB.carregarCache()`, `Render.tudo()`, esconde o loader e chama `PlannerBootstrap.concluir()`. Reaproveitada nos dois modos.
- **`DB.normalizar(dados)`**: saneamento existente (datas, tipos, responsáveis, valores). Fonte única de formato, aplicada em ambos os modos.

## Bug Details

### Bug Condition

O bug se manifesta ao abrir o app em **modo local sem uma sessão Firebase**. A inicialização atual (`DOMContentLoaded` → `Auth.iniciarObserver()` → `auth.onAuthStateChanged`) depende de uma sessão que nunca existe sem login, então o shell não é montado e o supervisor cai no aviso de demora. Além disso, `firebase.initializeApp/auth/firestore` executam no topo do `app.js` e assumem que os SDKs já carregaram.

**Formal Specification:**
```
FUNCTION isBugCondition(X)
  INPUT: X = { modo: 'local' | 'firebase', sessao: Session | null }
  OUTPUT: boolean

  // Em modo local não deve haver dependência de sessão nem de rede.
  RETURN X.modo = 'local' AND X.sessao = null
END FUNCTION
```

### Examples

- **Abrir sem login (o caso do usuário)**: acessar `http://localhost:5500/app.html` sem sessão. Esperado: painel abre direto e utilizável. Atual: loader preso em "demorando mais que o esperado".
- **Criar uma transação em modo local**: adicionar uma despesa. Esperado: aparece na tabela e sobrevive ao reload (persistida em `localStorage`). Atual: gravação depende de `db.collection('casais').doc(...).set(...)` e da rede.
- **Recarregar a página em modo local**: F5 após lançar dados. Esperado: dados preservados a partir de `localStorage`. Atual: nem chega a montar o painel.
- **Edge — SDKs Firebase indisponíveis (offline/rede caída)**: em modo local, nenhum recurso de rede deve ser obrigatório; o supervisor conclui normalmente sem exigir os SDKs.

## Expected Behavior

### Preservation Requirements

**Comportamentos que NÃO mudam (flag em `firebase`):**
- O fluxo de autenticação em `auth.html` e a observação da sessão via `auth.onAuthStateChanged` continuam idênticos (Req 3.5).
- A persistência via Firestore (`db.collection('casais').doc(...).set(...)`, `onSnapshot`) continua idêntica (Req 3.5).
- `DB.normalizar` continua sendo a única lógica de saneamento nos dois modos (Req 3.3).
- `Utils.esc` / `Utils.urlSegura` continuam escapando HTML e validando URLs (Req 3.4).
- `auth.html`, `core.js`, `firestore.rules`, `.firebaserc` e a config do Firebase permanecem no projeto, sem remoção nem quebra (Req 3.1).
- A suíte atual (vitest + fast-check, 72 testes) continua passando (Req 3.2).

**Escopo da preservação:**
Toda entrada fora da condição do bug (`modo !== 'local'` ou sessão presente) deve produzir exatamente o comportamento original. Em particular, o caminho de montagem `Auth._entrarNoApp` não muda de forma observável no modo Firebase.

**Nota:** o comportamento correto esperado para as entradas em C (painel carrega, sem demora, sem rede, persiste em `localStorage`) está definido na seção Correctness Properties (Property 1).

## Hypothesized Root Cause

A causa raiz já está confirmada pelo bugfix.md e pela leitura do código. As frentes a corrigir são:

1. **Inicialização acoplada à sessão**: `DOMContentLoaded` chama `Auth.iniciarObserver()`, que depende de `auth.onAuthStateChanged`. Sem sessão, nada monta o shell nem conclui o bootstrap.

2. **Inicialização do Firebase no topo do módulo**: `firebase.initializeApp(...)`, `const auth = firebase.auth()` e `const db = firebase.firestore()` executam ao carregar `app.js`, assumindo que os SDKs já existem. Em modo local isso é uma dependência desnecessária (e frágil se os SDKs não carregarem).

3. **`app.html` trava sem os SDKs**: os 3 SDKs Firebase e `auth-errors.js` estão marcados `data-bootstrap-required="true"`. Se falharem ao carregar, o supervisor chama `falhar('recurso')`. Em modo local, esses recursos não deveriam ser obrigatórios.

4. **Persistência acoplada ao Firestore**: `DB.salvar`/`DB.salvarVarios` e `DB.ouvirNuvem` gravam/leem direto no Firestore. Em modo local precisam de um caminho equivalente sobre `localStorage`, sem `onSnapshot`.

## Correctness Properties

Property 1: Bug Condition — Round-trip de persistência local

_For any_ entrada em que a condição do bug vale (`isBugCondition` retorna true — modo local, sem sessão), o app inicializado SHALL carregar o painel sem tela de demora e sem dependência de rede, e, ao gravar um conjunto de campos e recarregá-los do adaptador local, SHALL devolver os mesmos dados após `DB.normalizar` (round-trip estável: `carregar(salvar(dados)) ≡ normalizar(dados)`).

**Validates: Requirements 2.1, 2.2, 2.3, 2.13**

Property 2: Preservation — Caminho de montagem inalterado no modo Firebase

_For any_ entrada em que a condição do bug NÃO vale (`isBugCondition` retorna false — modo `firebase`), o app SHALL produzir o mesmo comportamento observável do código original, preservando o fluxo de autenticação, a persistência via Firestore e o caminho de montagem `Auth._entrarNoApp`.

**Validates: Requirements 3.1, 3.3, 3.5**

## Architecture

### O interruptor único (flag MODO)

Um único ponto de configuração no topo do `app.js`, versionável e explícito:

```js
// ── Modo de operação ─────────────────────────────────────────
// 'local'  -> app abre sem login, persiste em localStorage (padrão atual)
// 'firebase' -> fluxo de auth + Firestore como no comportamento original
const MODO = (typeof window !== 'undefined' && window.PLANNERDUO_MODO) || 'local';
const ehModoLocal = () => MODO === 'local';
```

Racional da escolha:
- **Uma constante lida no topo, com override por `window.PLANNERDUO_MODO`**: simples, versionável (o padrão vive no código), e permite alternar sem editar o fonte (ex.: um `<script>` no HTML ou o console definem `window.PLANNERDUO_MODO='firebase'` antes de `app.js`). Evita depender de rede/config remota para decidir o modo.
- Default `'local'` cumpre a decisão do usuário (abrir direto no painel).

### Inicialização do Firebase sob demanda

As três linhas de topo do `app.js` deixam de rodar incondicionalmente. Passam para uma função chamada **apenas no caminho Firebase**, de modo que `app.js` carregue sem os SDKs presentes:

```js
let auth = null;
let db   = null;

function iniciarFirebase() {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db   = firebase.firestore();
}
```

`iniciarFirebase()` é chamado só quando `MODO === 'firebase'`, na inicialização. Assim, em modo local, `firebase` nunca é tocado e a ausência dos SDKs não quebra nada. (Nos testes, o stub de `firebase` continua presente, então o modo firebase segue exercitável.)

### app.html: recursos Firebase deixam de ser obrigatórios

**Decisão:** manter os scripts do Firebase e `auth-errors.js` no HTML, mas **remover o atributo `data-bootstrap-required="true"`** deles (carregamento opcional). Justificativa:

- **Não remover os scripts** preserva o modo Firebase sem exigir uma segunda variante de HTML (Req 3.1/3.5) — basta alternar o flag.
- **Remover `data-bootstrap-required`** faz com que, se um SDK não carregar (offline, rede caída), o listener global de `error` do `bootstrap.js` NÃO chame `falhar('recurso')`. Em modo local isso é o comportamento desejado: nenhum recurso de rede é obrigatório e o supervisor conclui normalmente (Req 2.2).
- Como `app.js` só toca `firebase.*` dentro de `iniciarFirebase()` (caminho firebase), a ausência dos SDKs em modo local não gera `ReferenceError` no topo do módulo.

`core.js` e `app.js` continuam `data-bootstrap-required="true"` (são obrigatórios nos dois modos). `bootstrap.js` também permanece obrigatório.

### Fluxo de inicialização (dois modos)

```
DOMContentLoaded
  ├─ MODO === 'local'
  │     Auth._iniciarFase('local', <curto>)
  │     Auth._entrarModoLocal()
  │        ├─ define Estado.casalId = 'local', usuário sintético
  │        ├─ carrega nomes locais (nome1/nome2) do localStorage
  │        ├─ Auth._entrarNoApp(usuarioLocal)   // REUTILIZA o caminho existente
  │        │     (em modo local, DB.ouvirNuvem() é no-op)
  │        ├─ Auth._esconderLoader()
  │        └─ PlannerBootstrap.concluir()
  │
  └─ MODO === 'firebase'  (comportamento atual, inalterado)
        iniciarFirebase()
        Auth._iniciarFase('autenticacao', 10000)
        Auth.iniciarObserver()  → onAuthStateChanged → _entrarNoApp
```

## Components and Interfaces

### Ponto de decisão do flag

`DOMContentLoaded` passa a ramificar por `ehModoLocal()`:

```js
document.addEventListener('DOMContentLoaded', () => {
  if (ehModoLocal()) {
    Auth._entrarModoLocal();
  } else {
    iniciarFirebase();
    Auth._iniciarFase('autenticacao', 10000);
    Auth.iniciarObserver();
  }
  // ... (restante do wiring de UI permanece igual nos dois modos)
});
```

### Adaptador de Armazenamento (Store)

Uma camada fina com superfície comum, consumida por `DB`. Ela esconde de `Controladores`/`Render` se estamos em local ou firebase.

```
Store.carregar()               -> objeto (documento cru do casal) | null
Store.salvarCampos(camposObj)  -> Promise<void>   // merge dos campos informados
```

- Em **modo firebase**, `Store` delega ao Firestore exatamente como hoje (`db.collection('casais').doc(casalId).set(payload, {merge:true})`, e leitura via cache + `onSnapshot`).
- Em **modo local**, `Store` delega ao `Local` (abaixo).

`DB.salvar(campo)` e `DB.salvarVarios(campos)` passam a montar o payload e chamar `Store.salvarCampos(...)`, em vez de falar diretamente com o Firestore. A montagem do payload (`{campo: Estado[campo]}`) não muda.

### Camada de persistência local (`Local`)

Reaproveita a chave `pd-cache:{casalId}` com `casalId = 'local'`, e reaplica `DB.normalizar` na leitura:

```
Local.chave()                    -> PlannerCore.chaveCache('local')  // 'pd-cache:local'
Local.carregar()                 -> objeto | null   // JSON.parse do localStorage
Local.salvarDoc(obj)             -> void            // grava o documento inteiro (merge sobre o atual)
Local.salvarCampo(campo, valor)  -> void            // merge de um campo
```

Comportamento:
- `Local.salvarCampo`/`salvarDoc` leem o doc atual (`carregar()`), aplicam o merge dos campos informados e regravam o documento **inteiro** sob a mesma chave (espelhando a semântica `{merge:true}` do Firestore, mas escrevendo o objeto completo em `localStorage`).
- `DB.carregarCache()` **já** lê de `pd-cache:{casalId}` e aplica `DB._aplicar`/`normalizar` — em modo local isso funciona sem alteração, pois `casalId = 'local'`.
- **Sem `onSnapshot`**: em modo local, `DB.ouvirNuvem()` é um no-op. A "sincronização" é apenas reler o próprio `localStorage` (o estado em memória já reflete as gravações; o reload recarrega via `DB.carregarCache`).

### Entrada no app em modo local (`Auth._entrarModoLocal`)

Nova função que prepara a identidade local e reutiliza o caminho de montagem:

```
Auth._entrarModoLocal():
  Estado.casalId     = 'local'
  Estado.usuarioUid  = 'local'
  Estado.usuarioEmail = null
  carregar nome1/nome2 locais (localStorage) -> Estado.nome1/nome2 (ou padrão)
  usuarioLocal = { uid: 'local', email: '', displayName: Estado.nome1 || 'Pessoa 1' }
  Auth._entrarNoApp(usuarioLocal)   // monta shell, carregarCache, Render.tudo, concluir
```

`Auth._entrarNoApp` já chama `DB.carregarCache()`, `Render.tudo()`, `_esconderLoader()` e `PlannerBootstrap.concluir()`. A única adaptação necessária dentro dele é que `DB.ouvirNuvem()` (chamado lá dentro) seja no-op em modo local — resolvido fazendo `ouvirNuvem` checar `ehModoLocal()` e retornar cedo.

### Identidade local editável (nome1/nome2)

- **Onde**: em `localStorage`, chaves `pd-local-nome1` / `pd-local-nome2` (independentes do documento de dados, para não misturar identidade com payload do casal). Padrões: `"Pessoa 1"` / `"Pessoa 2"`.
- **Como edita (UI mais barata possível)**: reaproveitar o bloco de identidade da sidebar (`#sidebar-user-name`). Adicionar uma ação leve — por exemplo, um pequeno modal "Editar nomes" com dois campos (Pessoa 1 / Pessoa 2), aberto a partir da sidebar. Ao salvar: grava as chaves em `localStorage`, atualiza `Estado.nome1/nome2` e chama `UI.atualizarNomes()` (que já propaga para selects, split e relatórios).
- **Não bloqueante**: os padrões já satisfazem `Utils.nomesCasal()` (que cai em Pessoa 1/Pessoa 2 quando null). A edição é um incremento, não um gate. Nada de sistema de perfis.

### Impacto em logout / "sair para landing" / convites

Esses fluxos dependem de `auth.signOut()` e do Firestore, que não existem em modo local. Comportamento mínimo coerente:

- **`Auth.logout()`**: em modo local, no lugar de `auth.signOut()`, faz um "reset local" — pede confirmação e limpa os dados locais (`localStorage` da chave `pd-cache:local` e nomes), recarregando o painel vazio. Não navega para `auth.html` (não há login).
- **`Auth.sairParaLanding()`**: em modo local, apenas navega para `index.html` sem `signOut`.
- **Convites (`Convites.criar`/`aceitar`)**: dependem inteiramente do Firestore e do conceito multiusuário, que não existe localmente. Em modo local, as ações da sidebar "Convidar parceiro(a)" / "Entrar com código" devem ser **ocultadas** (ou exibir um toast informando que o recurso exige o modo Firebase). Ocultar é o mais coerente com o escopo (sem multiusuário local).

Todos esses ramos são decididos por `ehModoLocal()`; no modo firebase permanecem exatamente como hoje.

## Data Model

O formato persistido em `localStorage` **reaproveita o shape atual** do documento `casais/{id}` do Firestore — a mesma estrutura que `DB.normalizar` já entende:

- **Chave**: `pd-cache:local` (via `PlannerCore.chaveCache('local')`).
- **Valor** (JSON):

```json
{
  "financas":  [ { "id": "...", "tipo": "despesa|receita", "resp": "Pessoa 1", "desc": "...", "valor": 0, "data": "YYYY-MM-DD", "cat": "..." } ],
  "viagens":   [ { "id": "...", "destino": "...", "ida": "YYYY-MM-DD", "volta": "YYYY-MM-DD", "orcamento": 0, "guardado": 0 } ],
  "metas":     [ { "id": "...", "titulo": "...", "alvo": 0, "atual": 0, "prazo": "YYYY-MM-DD" } ],
  "checklist": [ { "id": "...", "texto": "...", "cat": "outros", "feito": false } ],
  "orcamentos": { "alimentacao": 0 },
  "nome1": "Pessoa 1",
  "nome2": "Pessoa 2"
}
```

- Identidade editável fica em chaves separadas: `pd-local-nome1`, `pd-local-nome2` (strings simples). `nome1`/`nome2` também podem coexistir no documento para o `carregarCache` derivar rótulos, mantendo compatibilidade com a lógica existente (`Utils.nome2De`).
- `pd-casalId` e `pd-tema` (já usados hoje) permanecem inalterados.

Como o shape é idêntico ao do Firestore, alternar o flag para firebase no futuro lê/grava o mesmo formato — sem migração.

## Error Handling

- **`localStorage` indisponível/bloqueado**: todas as leituras/gravações locais ficam em `try/catch` (como o código já faz em `carregarCache`, `pd-tema`, `pd-casalId`). Falha de escrita não derruba o app; no pior caso os dados não persistem entre reloads, mas o painel segue utilizável na sessão.
- **JSON corrompido no `localStorage`**: `carregar()` faz `JSON.parse` em `try/catch` e trata parse inválido como "sem dados" (retorna `null`), evitando quebra na montagem.
- **SDKs Firebase ausentes em modo local**: sem `data-bootstrap-required`, o supervisor não falha; `app.js` não toca `firebase.*` fora de `iniciarFirebase()`. Nenhum erro de inicialização.
- **Modo firebase inalterado**: os tratamentos existentes (`_falharBootstrap`, catches de `resolverCasalId`, `ouvirNuvem`, toasts de erro em `salvar`) permanecem como estão.

## Testing Strategy

### Validation Approach

Primeiro observar/confirmar o bug no código atual (exploração), depois verificar que a correção resolve C e preserva ¬C. Reaproveitar a infraestrutura de teste existente (`vitest` + `fast-check`, carregamento de `app.js` em contexto `vm` com stubs — ver `tests/app-saneamento.test.js`).

### Exploratory Bug Condition Checking

**Goal**: evidenciar o bug antes da correção e confirmar a causa raiz.

**Test Plan**: carregar `app.js` num contexto `vm` simulando `MODO === 'local'` sem sessão e observar que, no código atual, o caminho de inicialização depende de `onAuthStateChanged`/`user` e não conclui o bootstrap.

**Test Cases**:
1. **Abrir sem sessão em modo local**: sem `user`, o shell não é montado e `PlannerBootstrap.concluir()` não é chamado (falha no código não corrigido).
2. **Gravação depende do Firestore**: `DB.salvar` chama `db.collection(...).set(...)` (falha/erro sem Firestore no código não corrigido).
3. **Topo do módulo exige SDK**: `app.js` executa `firebase.auth()/firestore()` no topo (quebra sem `firebase` presente).

**Expected Counterexamples**: montagem do shell não ocorre sem sessão; gravação não persiste sem rede; carga do módulo depende dos SDKs.

### Fix Checking

**Goal**: para toda entrada em C (modo local, sem sessão), a versão corrigida produz o comportamento esperado.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := inicializarApp_fixed(input)   // MODO='local'
  ASSERT painel_carregado(result)
     AND NOT tela_demora_visivel(result)
     AND NOT depende_de_rede(result)
     AND dados_persistem_em_localStorage(result)
END FOR
```

### Preservation Checking

**Goal**: para entradas fora de C (modo firebase), a versão corrigida se comporta de forma idêntica à original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT inicializarApp_original(input) = inicializarApp_fixed(input)
END FOR
```

**Testing Approach**: teste baseado em propriedades é recomendado para preservação porque cobre muitas entradas automaticamente. Observar o comportamento no modo firebase (com o stub de `firebase`) e garantir que o caminho de montagem e as gravações permanecem os mesmos.

**Test Cases**:
1. **Firebase intacto**: com `MODO='firebase'`, `iniciarFirebase()` é chamado e `Auth.iniciarObserver()` observa a sessão como hoje.
2. **Persistência firebase inalterada**: `DB.salvar` em modo firebase chama `db.collection('casais').doc(...).set(..., {merge:true})`.
3. **`normalizar` inalterado**: mesmo resultado de saneamento nos dois modos.

### Unit Tests

- **Adaptador `Local`**: `salvarCampo`/`salvarDoc` gravam sob `pd-cache:local`; `carregar` devolve o documento; parse inválido vira `null`; `localStorage` bloqueado não quebra.
- **Round-trip local (Property 1)**: `carregar(salvar(dados)) ≡ normalizar(dados)` para vários shapes gerados (fast-check).
- **Flag/inicialização**: `MODO='local'` → `Auth._entrarModoLocal` monta o shell e conclui o bootstrap sem tocar `firebase`; `MODO='firebase'` → chama `iniciarFirebase()` + `iniciarObserver()`.
- **Identidade local**: padrões Pessoa 1/Pessoa 2; edição persiste e `UI.atualizarNomes()` propaga.
- **Logout/convites em modo local**: `logout` faz reset local (sem `signOut`); convites ocultos/no-op.
- **Regressão**: garantir que os 72 testes atuais continuam passando (o stub de `firebase` mantém o modo firebase exercitável).

### Property-Based Tests

- **Round-trip de persistência local**: gerar documentos de casal aleatórios (financas/viagens/metas/checklist/orcamentos), gravar via `Local` e reler; assert de igualdade após `DB.normalizar`.
- **Preservação do modo firebase**: gerar sequências de gravações e verificar que, com `MODO='firebase'`, as chamadas ao Firestore são idênticas às do código original.

### Integration Tests

- Fluxo local completo: abrir sem login → criar transação/viagem/meta/checklist → recarregar (novo carregamento do `vm`/`localStorage`) → dados preservados.
- Alternância de flag: `local` monta sem rede e conclui bootstrap; `firebase` mantém o caminho de auth.
- Verificar que a mensagem "demorando mais que o esperado" não aparece no fluxo local normal.
