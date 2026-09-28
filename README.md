# PlannerDuo

Aplicação web local para organizar finanças, viagens, metas, checklists e decisões de um grupo livre de participantes.

## Estado atual

- funciona integralmente em `localhost`, sem conta, login ou backend;
- começa com um banco vazio e não importa automaticamente dados de versões anteriores;
- permite zero, um ou vários participantes, todos com identificadores estáveis;
- divide despesas somente entre os participantes escolhidos em cada lançamento;
- mantém os dados no `localStorage` do navegador e serializa alterações entre abas com Web Locks;
- oferece backup/restauração JSON, exportação financeira CSV e reset completo;
- pesquisa viagens em 12 provedores: comparadores, companhias aéreas, hospedagens, ônibus e rotas;
- não carrega SDKs, fontes, ícones, gráficos ou folhas de estilo externos.

> Os dados pertencem à combinação navegador + perfil + origem (`localhost:porta`). Faça backups antes de limpar dados do site, trocar de navegador ou mudar a porta usada no dia a dia.

## Busca de viagens

Na aba **Viagens**, informe origem, destino, datas e quantidade de viajantes. Google Voos, Airbnb, Booking.com e Rome2Rio recebem os dados disponíveis; KAYAK e Skyscanner também recebem a rota quando origem e destino usam códigos IATA, como `CNF` ou `GRU`, **e uma data de ida foi informada**. Sem esses três dados, eles abrem a página inicial de busca. GOL, Azul, LATAM, Decolar, Buser e ClickBus abrem suas páginas oficiais porque esses fluxos não possuem um deep link público estável mantido pelo PlannerDuo.

Nenhum provedor é acessado durante a inicialização. A navegação HTTPS acontece somente depois de um clique do usuário, em nova aba com `noopener` e `noreferrer`. O formulário permanece local; para páginas sem preenchimento automático, o resumo pode ser copiado para a área de transferência.

## Executar

```bash
npm install
npm run dev
```

Abra `http://localhost:5500/` ou diretamente `http://localhost:5500/app.html`.

No VS Code, também é possível pressionar **F5** e escolher **PlannerDuo (local)**.

## Estrutura

```text
public/
  index.html   # apresentação e entrada direta
  auth.html    # redirecionamento de compatibilidade para o app
  app.html     # shell acessível da aplicação
  app.js       # interações, CRUD, busca de viagens, relatórios e renderização
  core.js      # schema, normalização, votos e acerto de despesas
  local.js     # persistência, backup, importação e sincronização entre abas
  style.css    # design system responsivo, sem assets externos
scripts/
  dev-server.mjs          # servidor HTTP local
  verificar-frontend.mjs  # sintaxe, referências, política local e smoke HTTP
```

## Dados locais

O banco atual usa a chave `plannerduo:workspace:v1`. Na primeira execução desta versão, chaves conhecidas do sistema antigo são removidas para garantir um início limpo. O tema visual fica separado em `plannerduo:theme`.

Participantes referenciados por transações ou votos são arquivados em vez de apagados, preservando o significado do histórico. Participantes sem referências podem ser removidos de forma permanente.

## Verificação

```bash
npm run verificar
```

O verificador executa primeiro a suíte Vitest e depois inicia um servidor temporário para checar sintaxe JavaScript, referências locais, CSS, ausência de assets remotos e os principais caminhos HTTP; ele encerra o servidor ao terminar.

A suíte Vitest cobre schema vazio, normalização, valores monetários, divisão entre grupos, votos, participantes, limpeza legada, persistência, backup, reset, sincronização entre abas, entrada direta e a allowlist dos destinos de viagem.
