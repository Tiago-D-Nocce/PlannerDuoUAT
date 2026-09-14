# Auditoria completa — PlannerDuo

Auditoria estática de `public/app.js`, `public/app.html`, `public/auth.html`, `public/core.js`, `public/index.html`, `public/style.css` e `firestore.rules`. Nenhum arquivo foi modificado. Cada item traz localização, severidade e correção recomendada.

Legenda de severidade: **CRÍTICO** (quebra função central), **MÉDIO** (comportamento errado em cenário comum), **BAIXO** (cosmético / edge case raro).

---

## 1. CRÍTICO — Responsável (`fin-resp` / `edit-fin-resp`) grava o texto errado

**Local:** `app.html` (modais `modal-financa` e `modal-editar-financa`) + `app.js` `Controladores.adicionarFinanca` / `salvarEdicaoFinanca` / `UI.atualizarNomes`.

No HTML os `<option>` de responsável **não têm atributo `value`**, só `id`:

```html
<select id="fin-resp">
  <option id="fin-resp-p1">Pessoa 1</option>
  <option id="fin-resp-p2">Pessoa 2</option>
</select>
```

`UI.atualizarNomes()` seta apenas o `textContent` dessas options (`el.textContent = p1`). Quando não há `value`, o navegador usa o texto como value — então funciona *por acaso* **depois** que os nomes carregam. Mas há dois problemas reais:

1. **Antes dos nomes carregarem** (`Estado.nome1/nome2 === null`), `atualizarNomes` escreve a string `"null"` no `textContent`. O select passa a ter value `"null"`, e uma despesa registrada nesse intervalo grava `resp: "null"`. Depois, quando o nome real chega, essa transação **nunca mais casa** com `Estado.nome1`/`nome2` no acerto de contas, gráficos por responsável e relatórios — fica invisível nos totais por pessoa.
2. Como o `value` depende do texto renderizado, qualquer divergência de acento/espaço entre o que foi gravado e `Estado.nome1` quebra o `f.resp === Estado.nome1` em todo o app.

**Correção:** dar `value` estável às options (ex.: `value="p1"`/`value="p2"`) e mapear para o nome na hora de gravar/ler, **ou** desabilitar o botão "Salvar Transação" enquanto `Estado.nome1`/`nome2` forem `null`. Em `atualizarNomes`, não escrever quando o nome for `null` (usar fallback tipo "Pessoa 1").

---

## 2. CRÍTICO — `Render.financas` quebra quando `f.resp` é null/undefined

**Local:** `app.js` `Render.financas`:

```js
if (busca) lista = lista.filter(f => f.desc.toLowerCase().includes(busca) || f.resp.toLowerCase().includes(busca));
```

Se qualquer transação tiver `resp` ausente (dado legado, ou o cenário do item 1 antes de definir value), `f.resp.toLowerCase()` lança `TypeError` e a tabela inteira de finanças para de renderizar enquanto houver texto na busca. O mesmo risco vale para `f.desc` se algum registro vier sem descrição.

**Correção:** proteger com `(f.resp || '')` e `(f.desc || '')`.

---

## 3. CRÍTICO — Variável CSS inexistente `var(--text)` no detalhe da viagem

**Local:** `app.js` `Controladores.abrirDetalheViagem` (linha ~793):

```js
<strong style="color:${acima ? 'var(--brand-rose)' : 'var(--text)'}">
```

O design system define `--text-primary`, `--text-secondary`, `--text-muted` — **não existe `--text`**. O valor do gasto real no modal de detalhe fica com `color` inválido (herda a cor padrão; em dark mode pode ficar com contraste ruim).

**Correção:** trocar por `var(--text-primary)`.

---

## 4. MÉDIO — Botão "Salvar Transação" não fecha modal nem valida quando `resp` vira "null"

Relacionado ao item 1: `adicionarFinanca` só valida `!desc || !valor || !data`. Não valida `resp`, nem `parseFloat` NaN de forma robusta. `parseFloat('')` → `NaN`, e `!valor` pega NaN (ok), mas `valor` negativo? O input tem `min="0.01"` mas isso só é validado no submit de `<form>` — e aqui o clique é num `<button>` fora de submit (`onclick="Controladores.adicionarFinanca()"`), então `min`/`required`/`type=url` do HTML **não são aplicados**. Um valor `0` ou negativo digitado manualmente passa a checagem `!valor` só quando é 0; negativos passam.

**Local:** `app.js` `adicionarFinanca`, `adicionarViagem`, `adicionarMeta`, etc.

**Correção:** validar explicitamente `valor > 0` no JS; não depender dos atributos HTML de validação porque nenhum modal usa submit real.

---

## 5. MÉDIO — Edição de finança apaga `recorrente`, `parcela`, `viagemId`(parcial), `obs`, `geradaDe`

**Local:** `app.js` `Controladores.salvarEdicaoFinanca`:

```js
Estado.financas[idx] = {
    ...Estado.financas[idx],
    tipo, resp, desc, valor, data, cat, viagemId
};
```

Usa spread, então preserva os campos. **OK para `recorrente`/`parcela`/`geradaDe`/`obs`.** Porém o modal de edição **não expõe** `recorrente` nem `parcelas`, então o usuário não consegue corrigir uma recorrência/parcelamento pela tela de edição. Além disso, editar o valor de **uma** parcela não reajusta as demais do grupo (`parcela.grupoId`), gerando soma inconsistente com a compra original.

**Severidade:** médio (não corrompe, mas confunde). **Correção:** ou bloquear edição de itens parcelados/recorrentes, ou tratar o grupo inteiro.

---

## 6. MÉDIO — `Controladores._depositoInline` é (re)definido dentro de `Render.metas`

**Local:** `app.js` fim de `Render.metas`:

```js
Controladores._depositoInline = (id) => { ... };
```

O método só passa a existir **depois** da primeira renderização de metas. Os cards já contêm `onclick="Controladores._depositoInline('...')"`. Como o método é atribuído no mesmo `Render.metas` que gera o HTML, funciona — mas é frágil: qualquer caminho que renderize o botão sem passar por esse trecho (não há hoje, mas é um anti-padrão) resultaria em `Controladores._depositoInline is not a function`. Também recria a closure a cada render.

**Correção:** mover `_depositoInline` para a definição estática de `Controladores`.

---

## 7. MÉDIO — Depósito inline em meta usa modal escondido e pode falhar silenciosamente

**Local:** `app.js` `_depositoInline` → chama `Controladores.depositarMeta()`, que lê `document.getElementById('deposito-valor').value`. O código seta `deposito-valor.value = val` antes, então funciona. Mas `depositarMeta` fecha `modal-meta-deposito` (que não está aberto) — inofensivo. O ponto de atenção: se o input inline tiver vírgula decimal (`100,50`), `parseFloat('100,50')` → `100`, perdendo os centavos. Vale para **todos** os inputs numéricos do app (pt-BR usa vírgula).

**Correção:** normalizar vírgula→ponto antes de `parseFloat`, ou orientar ponto decimal.

---

## 8. MÉDIO — `processarRecorrentes` roda antes de os dados da nuvem chegarem

**Local:** `app.js` `Auth._entrarNoApp`:

```js
DB.carregarCache();
Controladores.processarRecorrentes();   // (A)
...
DB.ouvirNuvem();                          // (B)
```

`processarRecorrentes` roda sobre o **cache local** (A) e chama `DB.salvar('financas')`, gravando na nuvem. Se o cache estiver desatualizado/vazio (primeiro acesso em outro dispositivo), pode: (a) não gerar as recorrentes esperadas, ou (b) logo em seguida o `onSnapshot` (B) sobrescreve `Estado.financas` com a nuvem, e as cópias recém-geradas em memória podem ser perdidas se a gravação (A) ainda não confirmou — condição de corrida. Também não há chamada de `processarRecorrentes` após o primeiro snapshot, então recorrências só são processadas no load inicial.

**Correção:** processar recorrentes **após** o primeiro `onSnapshot` confirmar dados, com deduplicação idempotente (o campo `geradaDe` já ajuda).

---

## 9. MÉDIO — Regras Firestore: qualquer autenticado lê/deleta qualquer convite

**Local:** `firestore.rules`:

```
match /convites/{codigo} {
  allow get, create, delete: if autenticado();
}
```

Qualquer usuário logado pode: ler um convite (obtendo o `casalId` de outro casal) e **deletar convites alheios** (`delete` liberado para todos). Não há `list` (bom), mas o código é adivinhável apenas por força bruta (8 chars, 36^8). Mais grave: com o `casalId` de um convite, o atacante tenta o `allow update` de `casais` para se auto-inserir em `membros`.

**Local relacionado:** `allow update` de `casais` valida `request.auth.token.email in request.resource.data.membros` e `< 2 membros`, mas **não valida que o e-mail adicionado é o do próprio requisitante** de forma isolada — um usuário pode escrever `membros` contendo o próprio e-mail em **qualquer** doc com <2 membros, mesmo sem convite válido, entrando em espaços alheios.

**Severidade:** CRÍTICO de segurança, listado aqui como médio-alto. **Correção:** restringir `delete`/`get` de convite ao criador; na regra de `update` de `casais`, exigir que a diferença de `membros` seja exatamente o e-mail do requisitante e validar contra um convite. Ver também o steering "Segurança de Dados".

---

## 10. MÉDIO — `data-tip` de projeção usa `--surface`/tooltip que pode não existir

**Local:** `app.js` `Render.dashboard`:

```js
elDep.setAttribute('data-tip', `Projeção...`);
```

Só funciona se houver CSS `[data-tip]:hover::after`. Não confirmei essa regra no CSS (há `data-tip` em botões da sidebar). Se não existir tooltip para `.stat-value[data-tip]`, a projeção fica invisível — mas há também `stat-despesas-delta` mostrando a projeção, então é redundante. **Baixo/médio.**

---

## 11. BAIXO — Divisão e projeção com `diaAtual`: ok, mas projeção infla no dia 1

**Local:** `app.js` `Render.dashboard`:

```js
const projecao = diaAtual > 0 ? (dep / diaAtual) * diasNoMes : 0;
```

`diaAtual` nunca é 0 (dias vão de 1–31), então o guard é inócuo mas inofensivo. No dia 1 a projeção multiplica o gasto do dia por 30 (pode assustar). Comportamento aceitável, apenas observação.

---

## 12. MÉDIO — Gráfico "por responsável" quebra quando nomes são null

**Local:** `app.js` `Charts.responsavel` e `Render.dashboard` (acerto de contas):

`f.resp === Estado.nome1` com `Estado.nome1 === null` compara contra `null`. No load inicial (antes da nuvem), `nome1/nome2` são null e os labels do gráfico ficam `[null, null]`. Cosmético, mas o gráfico renderiza rótulos vazios até o snapshot chegar. Após carregar corrige. **Baixo/médio.**

---

## 13. BAIXO — `Utils.diasAte` com data inválida retorna `NaN`

**Local:** `app.js` `Utils.diasAte`:

```js
const alvo = new Date(dateStr + 'T12:00:00');
return Math.ceil((alvo - hoje) / 86400000);
```

Se `dateStr` for `''`/inválido, `alvo` é `Invalid Date` e o retorno é `NaN`. Chamadores como `dashViagensPreview`/`viagens` fazem `dias <= 0`/`dias > 0` — comparações com `NaN` são sempre `false`, caindo no branch "Em andamento". Viagens sem `ida` válida ficam rotuladas de forma estranha, não quebram. **Baixo.**

**Correção:** validar data antes de calcular.

---

## 14. BAIXO — `Utils.inicial` quebra com nome vazio de string

**Local:** `app.js`:

```js
inicial: (nome) => (nome || '?')[0].toUpperCase(),
```

Se `nome` for `''` (string vazia, não falsy? `''` é falsy → vira `'?'`, ok). Se for `'   '` (espaços), pega `' '`. Inofensivo. **Baixo.**

---

## 15. MÉDIO — `popularSelectMes` e filtros dependem de `f.data` sempre presente e formato `YYYY-MM-DD`

**Local:** `app.js` `Render.popularSelectMes`:

```js
const meses = new Set(Estado.financas.map(f => f.data.slice(0,7)));
```

Se algum `f.data` for `undefined`, `.slice` lança `TypeError` e o select de mês não popula. Também `Render.financas` faz `f.data.startsWith(mesFiltro)`. **Correção:** filtrar registros sem `data` válida.

---

## 16. MÉDIO — `Exportacao.gerarCSV` não escapa vírgulas/aspas em `desc`

**Local:** `app.js` `Exportacao.gerarCSV`:

```js
.map(f => `${f.data},"${f.desc}",${f.resp},${f.tipo},${f.cat || ''},${f.valor}`)
```

`desc` é envolto em aspas (bom), mas se `desc` contiver aspas duplas, o CSV quebra colunas. `resp` **não** é escapado — se um nome tiver vírgula, desalinha. **Correção:** escapar `"` → `""` e envolver todos os campos texto em aspas.

---

## 17. BAIXO — `resp` no CSV pode sair como `null`

Consequência do item 1: transações com `resp: "null"`/ausente aparecem no CSV como `null`/vazio.

---

## 18. MÉDIO — Selects de responsável nos relatórios usam `Estado.nome1/2` mas options têm value fixo `p1/p2`

**Local:** `app.html` (`rel-pessoa`) + `app.js` `Relatorios.atualizar`:

O select `rel-pessoa` tem options `value="todos|p1|p2"` (corretos, com value). `filtrarF` compara `f.resp !== Estado.nome1`. Isso é **consistente** desde que `f.resp` seja o nome (item 1). Ou seja, este ponto funciona só se o item 1 estiver correto. Sem correção do item 1, o filtro por pessoa nos relatórios falha para transações com `resp` divergente. **Médio, dependente do item 1.**

---

## 19. BAIXO — `navegarPara('relatorios')` chama `Relatorios.atualizar`, mas `Render.tudo` também; dupla renderização

**Local:** `app.js` `navegarPara` + `Render.tudo`. Não causa erro, só recomputa gráficos duas vezes ao trocar de aba logo após load. Performance mínima. **Baixo.**

---

## 20. MÉDIO — `DB.ouvirNuvem` sobrescreve `Estado` inteiro a cada snapshot, incluindo dados otimistas locais

**Local:** `app.js` `DB.ouvirNuvem`. Toda escrita local faz `DB.salvar(campo)` (merge por campo) e o snapshot volta e substitui `Estado.viagens/financas/...`. Como as escritas são "last write wins" por campo e os dois usuários editam o **mesmo array** (`financas`), há risco de **perda de dados** em edição concorrente: se A adiciona uma despesa e B adiciona outra quase ao mesmo tempo, o `set({financas: [...]}, {merge:true})` substitui o array inteiro — o array do último a gravar vence e some a inserção do outro.

**Severidade:** MÉDIO/ALTO para uso simultâneo real do casal. **Correção:** usar `arrayUnion`/transações, ou subcoleções por item em vez de arrays gigantes num único doc.

---

## 21. BAIXO — Timeout do loader (8s) só mostra link, não força logout

**Local:** `app.html` `<script>` final. O comentário fala em "redireciona para login" mas o código só injeta um link. Divergência comentário↔código. Inofensivo. **Baixo.**

---

## 22. BAIXO — `auth.html`: `onclick="auth.signOut()"` em "Trocar conta" recarrega estado mas não limpa `pd-casalId`

**Local:** `auth.html` link "Trocar conta". Faz `signOut` mas não remove `localStorage['pd-casalId']` nem `pd-cache:*`. Ao logar outra conta que ainda não resolveu casalId, o fallback `localStorage.getItem('pd-casalId')` pode apontar para o casal do usuário **anterior**, exibindo brevemente dados de outro casal (cache) antes do snapshot. **Médio de privacidade, baixo de frequência.**

**Correção:** limpar `pd-casalId` e cache no signOut da tela de auth também.

---

## 23. BAIXO — `Auth.resolverCasalId` fallback para `user.uid` pode divergir do cadastro

**Local:** `app.js` `Auth.resolverCasalId` cria doc se `!snap.exists`. Mas `auth.html` no cadastro já cria `casais/{uid}`. Ordem de corrida entre cadastro (auth.html) e primeiro `resolverCasalId` (app.js) — ambos fazem `set`. O `resolverCasalId` só cria se não existir, então ok. Porém no cadastro grava `nome2: nomeP2 || 'Parceiro(a)'`, enquanto `resolverCasalId`/`criarEspacoCasal` gravam `nome2: null`. Se o doc for criado pelo caminho do app (não pelo cadastro), `nome2` fica `null` e o segundo responsável aparece vazio até um convite. Coerente com o design, mas o select de responsável 2 fica `null` (ver item 1). **Baixo/médio.**

---

## 24. BAIXO — `_bloquear` e `_esconderLoader` duplicam lógica; `_bloquear` nunca é chamado

**Local:** `app.js` `Auth._bloquear` — método definido mas sem nenhuma referência. Código morto. **Baixo.**

---

## 25. BAIXO — `UI.fecharModal` faz `form.reset()` mas modais de detalhe/depósito não têm `<form>`

**Local:** `app.js` `UI.fecharModal`. `querySelector('#id form')` retorna null para `modal-viagem-detalhe`, `modal-meta-deposito`, `modal-viagem-cofrinho`, `modal-orcamento`, `modal-checklist-item`, `modal-convite-*` (usam `<form>`? checklist não tem form). O `?.reset()` protege. Consequência: campos como `orc-valor`, `cofrinho-valor` **não são limpos** ao fechar sem submeter (o JS limpa manualmente em alguns `abrir*`). Cosmético. **Baixo.**

---

## 26. MÉDIO — Parcelamento com `recorrente` selecionado ignora a recorrência

**Local:** `app.js` `adicionarFinanca`. Quando `parcelas > 1`, o código força `recorrente: ''` em cada parcela e retorna cedo — ou seja, se o usuário marcar "Mensal" **e** parcelas>1, a recorrência é silenciosamente descartada sem avisar. **Correção:** desabilitar um campo quando o outro é usado, ou avisar.

---

## 27. BAIXO — `v-orcamento`/`meta-alvo` com `parseFloat` vírgula

Mesma questão do item 7: `parseFloat('5.000,00')` → `5`. Valores grandes digitados no formato pt-BR são truncados. **Médio na prática para orçamentos altos.**

---

## 28. BAIXO — `Charts._ultimos6Meses` label `year: '2-digit'` vs Relatorios `year:'numeric'`

Inconsistência estética entre o gráfico do dashboard e o de relatórios. **Baixo.**

---

## 29. BAIXO — Metas: `pct` divide por `m.alvo` sem proteção

**Local:** `app.js` `Render.metas`:

```js
const pct = Math.min(100, Math.round((m.atual||0) / m.alvo * 100));
```

Se `m.alvo` for `0` (o modal exige `min="1"`, mas via JS não é validado no submit — só `!alvo` bloqueia, e `0` é falsy → bloqueia). Então alvo 0 é impedido. Mas alvo `NaN` (campo vazio → `parseFloat` NaN → `!alvo` true → bloqueia). OK. Observação apenas. **Baixo.**

---

## 30. BAIXO — `Render.dashViagensPreview` filtra por `volta >= hoje` mas ordena por `ida`; título diz "Planejadas"

Viagens em andamento (ida passada, volta futura) aparecem no preview — coerente. Sem bug. Observação de nomenclatura.

---

## Itens verificados SEM problema (confirmações positivas)

- **IDs de elementos:** todos os `getElementById` mapeados têm elemento correspondente no `app.html` (stat-*, split-*, chart-*, rel-*, orcamentos-container, panorama-container, dash-viagens-preview, tbody-financas, trip-grid, goals-grid, checklist-wrap, modais e seus campos, convite-*). Não encontrei ID órfão.
- **onclick → método:** todos os `onclick` do HTML referenciam objetos/métodos existentes (`Controladores`, `UI`, `Convites`, `Orcamentos`, `ServicoBusca`, `Checklist`, `Exportacao`, `navegarPara`, `toggleTema`, `abrirSidebar`, `fecharSidebar`, `Auth.logout`, `Relatorios.atualizar`).
- **Classes CSS:** `badge-viagem`, `badge-alerta`, `badge-receita`, `badge-despesa`, `badge-success`, `cat-pill`, `progress-wrap`, `progress-bar`, `empty-state`, `stat-delta`, `split-result` (`.quite`/`.deve`), `trip-status-badge` (`.futura`/`.andamento`/`.concluida`), `balance-value` (`.saldo`/`.negativo`), `savings-row`, `goal-deadline`, `goal-atrasado`, `text-success`, `text-danger`, `fw-600`, `fw-bold`, `filter-tab`, `tab-btn`, `btn-icon.danger` — **todas existem** no `style.css`. **Única variável CSS ausente: `--text` (item 3).**
- **Gradientes/vars:** `--grad-brand/warm/cool/success`, `--brand-*` todos definidos.
- **Ordem de carregamento:** `core.js` é carregado antes de `app.js` no `app.html`; `PlannerCore` está disponível quando `app.js` executa. ✔
- **`Render.panorama`:** existe, é chamado no fim de `Render.dashboard`, e `#panorama-container` existe. ✔
- **`popularSelectViagens`/`orcamentos`:** existem e são chamados no fluxo de init e após CRUD. ✔
- **Event listeners no DOMContentLoaded:** `.filter-tab`, `#fin-busca`, `#fin-mes`, `[data-filtro-viagem]`, `#viagem-busca`, `[data-check-cat]`, `#fin-data` — todos os alvos existem no HTML. ✔
- **core.js:** funções puras coerentes; export duplo Node/browser correto.

---

## Resumo por prioridade

| # | Severidade | Item |
|---|-----------|------|
| 1 | CRÍTICO | Options de responsável sem `value` → grava `resp` errado/"null" |
| 2 | CRÍTICO | `Render.financas` quebra com `f.resp`/`f.desc` null na busca |
| 3 | CRÍTICO(visual) | `var(--text)` inexistente no detalhe da viagem |
| 9 | CRÍTICO(segurança) | Regras de `convites`/`update casais` permitem entrar em espaço alheio |
| 20 | MÉDIO/ALTO | Escrita concorrente sobrescreve arrays inteiros (perda de dados) |
| 4,5,7,8,15,16,18,22,26,27 | MÉDIO | Validações, vírgula decimal, recorrência, cache no signOut, edição parcelas |
| 6,10,12,13,14,17,19,21,23,24,25,28,29,30 | BAIXO | Robustez/cosmético |

### Correções mais impactantes (ordem recomendada)
1. Item 1 (value dos responsáveis) — destrava consistência de finanças/relatórios/gráficos.
2. Item 2 e 15 (guards de null em `resp`/`desc`/`data`).
3. Item 9 (endurecer `firestore.rules`).
4. Item 20 (estratégia de escrita concorrente).
5. Item 3 (`--text` → `--text-primary`).
6. Itens 7/27 (parse de vírgula decimal pt-BR).
