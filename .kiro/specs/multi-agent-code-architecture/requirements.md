# Requirements Document

**Feature:** `multi-agent-code-architecture`  
**Workflow:** Design-first  
**Source:** `design.md` revisado (plataforma avançada de operações de viagem e finanças da viagem, assistente de IA real e schema v2) e feedback obrigatório do usuário  
**Status:** Draft para revisão — derivado do design revisado; libera a derivação de `tasks.md` e a implementação incremental nas próximas fases

## Introduction

Este documento deriva requisitos verificáveis do `design.md` revisado para duas partes complementares da feature. A primeira parte especifica uma equipe local de 10 agentes e 21 skills do Kiro, agrupadas nos domínios Viagens, Finanças, IA e Plataforma e governadas por despacho central, menor privilégio, handoffs rastreáveis, limites finitos e gates independentes. A segunda parte especifica a evolução incremental do PlannerDuo para uma plataforma avançada de operações de viagem e finanças da viagem para o viajante pessoal, com busca e deep links, cotações comparadas, reserva externa com confirmação informada pelo usuário, pós-venda, orçamento e razão em várias moedas, parcelamentos, acertos, previsão, relatórios e alertas locais, mantendo a proteção local dos dados sem transformar termos técnicos de armazenamento em identidade visível do produto.

A referência de produto é a [Blis.AI](https://blisai.com/), usada somente como referência conceitual de agentes temáticos que preparam tarefas, jornada contínua, cotações, pós-venda e canal conversacional, adaptada da perspectiva B2B de agência para o viajante B2C. Nenhum requisito autoriza reproduzir marca, logotipo, cores, layout, textos ou trade dress da Blis.AI.

Os requisitos preservam o formato `plannerduo-vault`, a estrutura do envelope, os parâmetros criptográficos, `MAX_AMOUNT`, as fachadas públicas, a allowlist de provedores e a Content Security Policy atuais, com duas exceções controladas: a evolução versionada do workspace do schema v1 para o schema v2, por migração sem perda, idempotente e verificada, e `connect-src 'self'` exclusivamente em `app.html` para o assistente de IA opcional, que acessa a internet somente por um proxy local em loopback, nasce desligado e cuja ausência não altera nenhuma outra funcionalidade. Preços em tempo real, confirmação de reservas pelo sistema, integração com GDS, NDC, OBT ou canais oficiais de mensagens e ações da IA sem confirmação humana permanecem fora do escopo. A derivação de `tasks.md` e a implementação incremental destes requisitos são permitidas nas próximas fases do fluxo design-first.

## Referências iniciais de verificação

A formulação do gate de marca e confiabilidade considerou o catálogo do [Simple Icons](https://simpleicons.org/), o [disclaimer de licenças, marcas e brand guidelines do Simple Icons](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md) e exemplos de domínios oficiais de reserva, incluindo [GOL](https://www.voegol.com.br/) e [LATAM](https://www.latamairlines.com/). Essas referências não qualificam automaticamente nenhum provedor ou asset: cada entrada permanece sujeita à verificação individual, atual e registrada exigida por este documento.

## Glossary

- **Sistema_de_Agentes**: Conjunto versionado no workspace formado pelos Agentes, Skills, regras de governança e registros de evidência.
- **Agente**: Papel especializado com manifesto, gatilhos, capacidades, paths permitidos, paths negados, contrato de entrada e contrato de saída.
- **Equipe_de_Agentes**: Roster composto por exatamente 10 Agentes: `orchestrator`, `architect`, `security-analyst`, `fullstack-developer`, `travel-operations-specialist`, `trip-finance-specialist`, `ai-assistant-engineer`, `ux-accessibility`, `qa-property-testing` e `documentation-release`.
- **Skill**: Procedimento versionado com pré-requisitos, entradas permitidas, saída obrigatória, condições de parada e ações proibidas.
- **Catálogo_de_Skills**: Catálogo composto por exatamente 21 Skills em 4 grupos: Viagens (`travel-search-deep-links`, `travel-journey-lifecycle`, `travel-reissue-simulation` e `travel-stays-seats-baggage`), Finanças (`trip-budget-ledger`, `multi-currency-exchange`, `expense-splitting-settlements`, `installments-forecast` e `travel-finance-reports`), IA (`assistant-proxy-adapters`, `assistant-tool-contracts` e `llm-safety-evaluations`) e Plataforma (`task-routing-governance`, `modular-boundary-design`, `workspace-schema-evolution`, `advanced-design-system`, `web-accessibility-review`, `local-data-protection-review`, `safe-access-diagnostics`, `property-regression-testing` e `release-evidence`).
- **Grupo_de_Skills**: Domínio Viagens, Finanças, IA ou Plataforma ao qual cada Skill do Catálogo_de_Skills pertence com exclusividade.
- **Capacidade**: Operação, ferramenta ou privilégio identificado por ID e explicitamente permitido ou negado no manifesto de um Agente; uma Skill não amplia uma Capacidade.
- **Contrato_de_Entrada**: Schema versionado que enumera todos os campos, tipos, cardinalidades, invariantes, variantes e evidências aceitos por uma invocação de Agente ou Tarefa.
- **Contrato_de_Saída**: Schema versionado que enumera todos os campos, tipos, cardinalidades, invariantes, variantes, resultados, erros e evidências que uma invocação de Agente ou Tarefa pode produzir.
- **Compatibilidade_Total_de_Contratos**: Relação verificável na qual toda saída permitida pelo Contrato_de_Saída do produtor é aceita pelo Contrato_de_Entrada do consumidor e todo campo, tipo, cardinalidade, invariante, versão, variante e evidência obrigatórios para o consumidor são garantidos pelo produtor, sem coerção implícita, campo obrigatório ignorado ou variante não mapeada.
- **Requisito_de_Evidência**: Entrada enumerada de uma Tarefa que identifica tipo, produtor autorizado, formato, checagem de aceitação e condição de validade da evidência necessária.
- **Orquestrador**: Agente `orchestrator`, único papel autorizado a criar e despachar Tarefas filhas.
- **Registro_de_Agentes_e_Skills**: Componente de configuração que valida IDs, versões, referências, Grupos_de_Skills, capacidades, Write Paths, contratos, requisitos de evidência e compatibilidade da Equipe_de_Agentes e do Catálogo_de_Skills.
- **Solicitação_de_Trabalho**: Pedido raiz submetido pelo usuário ao Sistema_de_Agentes.
- **Plano_de_Despacho**: Registro que contém classificação de risco e escopo, Tarefas, dependências, proprietários, Skills, Capacidades, contratos, Requisitos_de_Evidência, Paths, verificações e gates.
- **Tarefa**: Unidade de trabalho com identificador único, objetivo, proprietário, dependências, risco, tentativa, profundidade, Skills, Capacidades, contratos, Requisitos_de_Evidência, Paths e critérios de aceitação.
- **Tarefa_Ativa**: Tarefa nos estados de execução ou revisão que ainda possui proprietário e recursos reservados.
- **Path**: Caminho de arquivo ou diretório incluído no escopo de leitura ou escrita de uma Tarefa.
- **Relação_de_Sobreposição_de_Path**: Relação entre dois Paths canônicos que existe quando os Paths são iguais ou quando um Path é ancestral ou descendente do outro.
- **Write_Path**: Path sobre o qual um Agente possui permissão de escrita; a expressão plural “Write Paths” representa um conjunto desses caminhos.
- **Writer**: Agente com permissão ativa de escrita sobre pelo menos um Write_Path.
- **Path_de_Produção**: Path de código, markup, estilo ou asset executado ou servido pela aplicação ou pelo Proxy_Local, compreendendo `public/**`, `scripts/assistant/**` e `scripts/dev-server.mjs`; `tests/**` e `scripts/verificar-frontend.mjs` não são Paths_de_Produção.
- **Fan-out**: Quantidade de Tarefas independentes selecionadas para execução na mesma Wave.
- **Wave**: Rodada finita de Tarefas independentes despachadas em paralelo pelo Orquestrador.
- **Claim**: Alegação de conclusão ou conformidade submetida à aceitação; a forma plural “claims” possui o mesmo significado.
- **Repositório_de_Workspace**: Único port autoritativo para carregar e atualizar o workspace protegido.
- **Espera_Limitada**: Aquisição de coordenação encerrada por uma deadline finita e positiva, após a qual a tentativa retorna uma falha recuperável sem commit tardio.
- **Grafo_de_Trabalho**: Grafo dirigido acíclico formado pelas Tarefas e respectivas dependências.
- **Handoff**: Solicitação de um Agente especialista ao Orquestrador para criar uma Tarefa filha com papel, motivo, evidências, Paths e contrato de saída definidos.
- **Guardião_de_Governança**: Política executável que verifica ciclos, ownership, sobreposição de escrita, profundidade, fan-out, tentativas, permissões, contratos, evidências e conflitos.
- **Executor_de_Gates**: Componente que seleciona revisores independentes, executa verificações obrigatórias e registra verdicts.
- **Conjunto_de_Gates**: Seleção de gates em que QA é obrigatório para mudança de comportamento, UX/acessibilidade é obrigatório para DOM, CSS ou copy, Segurança é obrigatório para autenticação, storage, criptografia, URL, concorrência, Assistente_de_IA, Proxy_Local, Content Security Policy, `scripts/dev-server.mjs` ou `scripts/verificar-frontend.mjs`, `trip-finance-specialist` é obrigatório para cálculo monetário, `travel-operations-specialist` é obrigatório para jornada, Cotação, Reserva ou Pós-venda, e documentação/release é obrigatório para declaração de prontidão.
- **Corpus_Adversarial**: Conjunto versionado em `tests/fixtures/assistant/prompt-injection/` com casos de prompt injection direta e indireta, exfiltração, ferramentas inexistentes ou proibidas, links enganosos, conteúdo ativo e textos acima dos limites, usado para aprovar código do Assistente_de_IA.
- **Artefato_de_Evidência**: Saída imutável, atribuída a uma Tarefa e a um Agente, que contém resultado, verificações, riscos, verdicts rastreáveis, identificador único e digest do conteúdo exato.
- **Vínculo_de_Gate**: Associação imutável entre um verdict de gate e o identificador, digest, Tarefa, Agente autor e revisão exatos do Artefato_de_Evidência avaliado; qualquer alteração do conteúdo ou dos metadados vinculados invalida o verdict.
- **Conflito_Bloqueante**: Divergência não resolvida sobre confidencialidade, integridade, ação destrutiva, restrição explícita ou preferência de produto que impede merge automático.
- **PlannerDuo**: Aplicação local de operações de viagem e finanças da viagem abrangida pelos Requirements 2 a 5.
- **Área_de_Viagens**: Entrada principal do produto, orientada a buscar passagens e abrir ou criar viagens.
- **Viagem**: Registro persistido com destino, período, orçamento, valor guardado e notas; no Schema_v2, orçamento e valor guardado são armazenados em Unidades_Menores de BRL (`budgetMinor` e `savedMinor`) com a mesma semântica do Schema_v1.
- **Contexto_de_Viagem**: Projeção de uma Viagem com planejamento, links externos, orçamento, gastos relacionados, checklist e decisões.
- **Serviço_de_Contexto_de_Viagem**: Componente que produz Contextos_de_Viagem e classifica registros vinculáveis sem inferir relações ausentes.
- **Despesa**: Registro financeiro de tipo `EXPENSE`; o campo opcional `tripId` determina o vínculo persistido com uma Viagem; no Schema_v2, a Despesa registra moeda do Catálogo_de_Moedas, `amountMinor`, FxSnapshot quando a moeda difere da Moeda_de_Referência, `baseAmountMinor`, taxas aplicadas congeladas e Total_na_Referência.
- **Item_de_Checklist**: Registro de checklist cujo campo opcional `tripId` determina o vínculo persistido com uma Viagem.
- **Item_Sem_Vínculo**: Despesa ou Item_de_Checklist cujo `tripId` é nulo e que permanece recuperável em uma área identificada como “Itens sem viagem vinculada”.
- **Meta_de_Viagem**: Apresentação travel-first de um registro `Goal`; nem o Schema_v1 nem o Schema_v2 contêm vínculo persistido individual entre `Goal` e Viagem.
- **Intenção_de_Reserva**: Estado transitório `PLANNED` ou `OPENED_EXTERNALLY` que registra interesse ou abertura de um provedor a partir de um resultado de busca e mantém `confirmation_claim` igual a falso; a reserva persistida é a Reserva.
- **Cotação**: Registro do Schema_v2 com oferta informada ou observada pelo usuário para voo, hospedagem, transporte terrestre, carro ou outro serviço, contendo provedor do Registro_de_Provedores ou rótulo livre de até 80 caracteres, moeda, total em Unidades_Menores, detalhamento opcional cuja soma é igual ao total, data de observação, validade opcional, regras tarifárias e bagagem informadas e estado `OPEN`, `CHOSEN` ou `DISCARDED`, com `EXPIRED` derivado da validade.
- **Comparação_de_Cotações**: Visão lado a lado de 2 a 4 Cotações de uma Viagem, apresentada como tabela e, abaixo de 600 CSS px de largura, como lista de cards.
- **Reserva**: Registro do Schema_v2 com estado `INTENT`, `OPENED_EXTERNALLY`, `CONFIRMED_BY_USER` ou `CANCELLED_BY_USER`, cuja transação ocorre sempre no site do provedor e cuja confirmação é sempre informada pelo usuário.
- **Confirmação_Informada**: Registro `UserReportedConfirmation` com `source = USER_REPORTED`, localizador opcional de até 32 caracteres tratado como dado sensível, moeda e valor pagos opcionais e data do relato, preenchido pelo usuário e nunca verificado pelo sistema.
- **Pós-venda**: Registros e simulações posteriores à reserva, compreendendo Simulação_de_Remarcação, assento por trecho, franquia e extras de bagagem e abertura e status de check-in.
- **Simulação_de_Remarcação**: Cálculo local de remarcação ou reemissão sobre tarifa original, tarifa nova, multas, taxas, crédito e política de downgrade `FORFEIT_DIFFERENCE` ou `KEEP_AS_CREDIT` informados pelo usuário em uma única moeda.
- **Lembrete**: Registro `Reminder` com tipo, título, prazo, antecedência entre 0 e 43.200 minutos, entidade relacionada opcional e estado `PENDING`, `DONE` ou `DISMISSED`.
- **Unidade_Menor**: Menor unidade inteira de uma moeda segundo o expoente do Catálogo_de_Moedas, como o centavo para BRL e o iene para JPY.
- **Catálogo_de_Moedas**: Catálogo local ISO 4217 composto por BRL, USD, EUR, GBP, ARS, CLP, UYU, PYG, COP, PEN, MXN, CAD, AUD, CHF e JPY, com expoente 0 para CLP, PYG e JPY e expoente 2 para as demais; a ampliação do catálogo exige gate de `trip-finance-specialist`.
- **Moeda_de_Referência**: Moeda `settings.currency`, igual a BRL, usada no orçamento, nos Acertos, nos Parcelamentos e nos relatórios consolidados.
- **Taxa_de_Câmbio_Manual**: Registro `ExchangeRate` informado pelo usuário em que 1 unidade da moeda estrangeira vale `rate` unidades da Moeda_de_Referência, com `rate` decimal positivo de até 12 dígitos significativos e data efetiva única por par.
- **FxSnapshot**: Cópia, congelada no lançamento, da taxa, do par e da data efetiva usados na conversão de uma Despesa, com `source = USER_MANUAL`.
- **Regra_de_Taxa**: Registro `FeeRule` criado pelo usuário, como “IOF cartão”, com percentual entre 0 e 10.000 pontos-base ou valor fixo na Moeda_de_Referência, formas de pagamento aplicáveis, indicação de exclusividade para moeda estrangeira, vigência e estado ativo.
- **Total_na_Referência**: Valor `totalBaseMinor` de uma Despesa, igual a `baseAmountMinor` somado às taxas aplicadas, em Unidades_Menores da Moeda_de_Referência.
- **Parcelamento**: Registro `InstallmentPlan` que distribui o Total_na_Referência de uma única Despesa não recorrente em 1 a 48 parcelas mensais a partir de uma primeira data de vencimento.
- **Previsão_de_Caixa**: Projeção mensal de 1 a 24 meses que soma parcelas não pagas, ocorrências recorrentes virtuais e Despesas sem Parcelamento previstas para cada mês.
- **Acerto**: Transferência positiva entre participantes, calculada por Viagem em Unidades_Menores da Moeda_de_Referência, que zera os saldos da divisão de Despesas.
- **Serviço_Monetário**: Componente puro que interpreta, converte, formata e agrega valores em Unidades_Menores, seleciona Taxas_de_Câmbio_Manuais e aplica Regras_de_Taxa.
- **Serviço_de_Cotações**: Componente que registra, escolhe e compara Cotações.
- **Serviço_de_Reservas**: Componente que cria Reservas a partir de Cotações e registra abertura externa, Confirmação_Informada e cancelamento informado pelo usuário.
- **Serviço_de_Pós-venda**: Componente que calcula Simulações_de_Remarcação e registra assento, bagagem e check-in.
- **Serviço_de_Parcelamento**: Componente que agenda as parcelas de cada Parcelamento e calcula a Previsão_de_Caixa.
- **Serviço_de_Acertos**: Componente que calcula os saldos e os Acertos de uma Viagem.
- **Serviço_de_Relatórios**: Componente que gera relatórios de Viagem por categoria, moeda, pagador e mês e o resumo em texto para copiar ou exportar localmente.
- **Evidência_Oficial_de_Provedor**: Registro datado que referencia uma página institucional, página de termos ou outra fonte controlada pelo próprio provedor e comprova separadamente o nome legal ou comercial, o Domínio_Canônico_Oficial e a Página_Oficial_de_Busca_ou_Reserva.
- **Data_de_Verificação_Válida**: Data no formato `AAAA-MM-DD` que não é futura e cuja diferença para a data corrente está entre 0 e 365 dias inclusive.
- **Domínio_Canônico_Oficial**: Hostname exato, incluindo somente o subdomínio explicitamente registrado quando aplicável, controlado ou designado pela companhia ou plataforma e comprovado por Evidência_Oficial_de_Provedor; correspondência por prefixo, sufixo, substring, wildcard, domínio pai, subdomínio não registrado, redirecionamento ou normalização para hostname divergente não constitui igualdade.
- **Página_Oficial_de_Busca_ou_Reserva**: URL HTTPS pertencente por igualdade exata ao Domínio_Canônico_Oficial na qual a própria companhia ou plataforma oferece busca ou início de reserva para a categoria registrada.
- **Provedor_Confiável**: Companhia ou plataforma de viagem pertencente à lista inicial fechada do critério 2.4, com nome legal ou comercial, Domínio_Canônico_Oficial e Página_Oficial_de_Busca_ou_Reserva comprovados por Evidência_Oficial_de_Provedor, certificado HTTPS válido e Data_de_Verificação_Válida; clones, domínios que imitam a marca por erro tipográfico, redirecionadores, encurtadores, afiliados ou intermediários não declarados e domínios divergentes não satisfazem esta definição.
- **Entrada_de_Busca**: Origem, destino, datas aplicáveis e quantidade de passageiros fornecidos para busca de passagens ou serviços de viagem.
- **Modo_de_Deep_Link**: Nível auditado `exact`, `conditional`, `assisted` ou `manual` que descreve quais campos da Entrada_de_Busca a URL oficial preenche sem inventar suporte.
- **Wordmark_Oficial**: Representação textual gráfica publicada ou aprovada pelo próprio Provedor_Confiável e validada sob os requisitos de origem, licença, integridade e diretrizes de marca aplicáveis.
- **Asset_de_Marca_Oficial**: Ícone, logotipo ou Wordmark_Oficial que corresponde à identidade vigente do Provedor_Confiável, possui origem e termos de uso verificáveis e não é desenho aproximado, template, letra ou monograma genérico, emoji ou marca de terceiro.
- **Área_Visual_de_Marca**: Caixa de layout com a mesma largura e altura computadas para os 26 cartões em uma mesma viewport, na qual o Asset_de_Marca_Oficial é contido sem corte ou distorção, mantém diferença relativa máxima de 1% entre a proporção renderizada e a proporção intrínseca e preserva pelo menos 4 CSS px de espaço interno em cada lado.
- **Fundo_de_Marca_Adequado**: Fundo permitido pelas diretrizes da marca que mantém contraste mínimo de 3:1 com o contorno ou componente visual predominante do Asset_de_Marca_Oficial; quando nenhuma variante oficial atingir esse contraste sem recoloração proibida, a aplicação usa o asset oficial em seu invólucro aprovado e uma borda de cartão com contraste mínimo de 3:1.
- **Evidência_de_Indisponibilidade_Oficial**: Registro com Data_de_Verificação_Válida que enumera o kit de marca e o site oficial consultados, as URLs HTTPS verificadas e o motivo objetivo pelo qual nenhuma variante oficial utilizável satisfaz os requisitos desta feature.
- **Fonte_de_Marca_Auditável**: Kit de marca ou site oficial do Provedor_Confiável ou, somente após Evidência_de_Indisponibilidade_Oficial, entrada da mesma marca no Simple Icons, acompanhada da licença ou dos termos e das diretrizes de marca consultados.
- **Hash_de_Asset**: Digest SHA-256 representado por exatamente 64 caracteres hexadecimais e calculado sobre os bytes exatos do asset local versionado e servido pela aplicação; o digest registrado deve ser igual ao digest recalculado sobre a resposta local servida.
- **Hotlink**: Referência de runtime que carrega um asset diretamente de origem externa em vez de arquivo servido pela própria aplicação.
- **CDN**: Serviço de distribuição externo usado para fornecer asset por request de rede em runtime.
- **SVG**: Asset vetorial no formato Scalable Vector Graphics com arquivo entre 1 e 262.144 bytes inclusive e somente geometria e metadados estáticos sanitizados; toda referência `href` ou `url(...)`, quando presente, deve apontar exclusivamente para fragmento interno iniciado por `#`.
- **Asset_Raster**: Imagem composta por pixels e sujeita a uma allowlist de tipos, limites de bytes e dimensões e verificação de integridade.
- **Política_de_Asset_Raster**: Política que aceita somente Asset_Raster com tipo `image/png`, `image/webp` ou `image/jpeg`, arquivo entre 1 e 1.048.576 bytes inclusive, largura e altura entre 1 e 4.096 pixels inclusive, no máximo 16.777.216 pixels decodificados e Hash_de_Asset correspondente.
- **Sanitizador_de_Assets_de_Marca**: Componente de desenvolvimento que valida tipo, limites, integridade, referências e conteúdo passivo de cada Asset_de_Marca_Oficial antes do versionamento local.
- **Registro_de_Provedores**: Registry imutável e auditável de exatamente 26 Provedores_Confiáveis, composto por exatamente 10 entradas em `flights`, 8 em `stays`, 6 em `ground` e 2 em `cars`; cada entrada contém `providerId`, nome legal ou comercial, Domínio_Canônico_Oficial, categoria, Página_Oficial_de_Busca_ou_Reserva, Evidência_Oficial_de_Provedor, Fonte_de_Marca_Auditável, licença ou termos consultados, Hash_de_Asset, Data_de_Verificação_Válida e Modo_de_Deep_Link.
- **Descritor_de_Resultado**: Resultado local contendo provedor, URL, modo, campos efetivamente preenchidos e limitações, sem preço ou disponibilidade inventados.
- **Mecanismo_de_Busca_de_Viagens**: Componente puro que valida a Entrada_de_Busca e produz Descritores_de_Resultado para provedores selecionados.
- **Adaptador_de_Navegação**: Único componente autorizado a abrir uma URL externa allowlisted após gesto explícito do usuário.
- **Gate_de_Provedor_Confiável**: Validação `TrustedProviderGate` que aceita uma URL somente com HTTPS, hostname igual ao Domínio_Canônico_Oficial de um Provedor_Confiável, zero credenciais ou portas personalizadas e parâmetros allowlisted.
- **Copy_Visível**: Texto renderizado ao usuário em título, heading, label, botão, status, toast, onboarding, marketing, mensagem, instrução ou atributo de acessibilidade.
- **Termos_Visíveis_Aprovados**: Vocabulário de identidade composto por “conta”, “acesso seguro”, “dados protegidos” e “área de viagens”.
- **Termos_Técnicos_Internos**: Tokens `vault`, `cofre`, códigos com prefixo `vault/` e formato `plannerduo-vault`, permitidos somente em nomes internos, contratos técnicos, chaves/formato persistido, testes e documentação explicitamente técnica.
- **Texto_Corrente**: Parágrafos e conteúdo principal de leitura contínua.
- **Texto_Secundário**: Descrição, helper, status, erro, lista, label, controle e botão.
- **Metadado_Não_Crítico**: Tag ou caption cuja remoção não elimina instrução, ação, política, limitação, erro ou recuperação.
- **Texto_Crítico**: Erro, instrução, política, limitação de segurança ou ação de recuperação.
- **Painel**: Área inicial da área principal que apresenta KPIs de próxima Viagem, dias restantes, orçamento usado e pendências, até 3 Alertas e atalhos para buscar, cotar e lançar gasto.
- **Jornada_da_Viagem**: Etapa derivada de uma Viagem entre `IDEA`, `QUOTING`, `DECIDED`, `BOOKING_EXTERNAL`, `CONFIRMED_BY_USER`, `PRE_TRIP`, `IN_TRIP` e `POST_TRIP`, exibida em stepper como “Ideia”, “Cotação”, “Decisão”, “Reserva externa”, “Confirmada por você”, “Pré-viagem”, “Em viagem” e “Pós-viagem”.
- **Linha_do_Tempo**: Lista ordenada dos eventos de trechos, hospedagens, Reservas, Cotações, Lembretes e parcelas de uma Viagem.
- **Paleta_de_Comandos**: Diálogo modal com combobox, aberto por `Ctrl+K`, por `⌘K` no macOS ou pelo botão “Comandos”, que busca localmente e executa comandos registrados.
- **Alerta**: Registro derivado e não persistido com chave `tipo:entidade:instante`, tipo, severidade `INFO`, `WARNING` ou `ERROR`, prazo, Viagem opcional e título seguro.
- **Central_de_Alertas**: Componente local que computa Alertas de validade de Cotação, prazo de cancelamento, abertura de check-in, parcela não paga e Lembrete pendente, com janelas configuráveis de padrão 48 h, 72 h, 24 h e 5 dias, respectivamente, e sem notificação do sistema operacional, service worker, push, som ou rede.
- **Tokens_de_Design**: Conjunto local de cores semânticas para os temas claro e escuro, tipografia com pisos de 16, 14 e 13 CSS px, espaçamento, raios, elevação, movimento, camadas, anel de foco de 2 CSS px e alvo mínimo de 44 CSS px para ação primária; o tema segue `prefers-color-scheme` e aceita `SYSTEM`, `LIGHT` ou `DARK` em `settings.theme`.
- **Componente_Avançado**: Card de KPI, stepper da Jornada_da_Viagem, tabela da Comparação_de_Cotações, Card_de_Proposta, mensagem de chat, toast, estado vazio, skeleton, Paleta_de_Comandos ou item de Alerta.
- **Verificador_de_Capacidades**: Componente que testa Web Crypto, contexto seguro, leitura e escrita de `localStorage`, escrita de `sessionStorage`, Web Locks, `BroadcastChannel` e storage events antes de uma operação protegida.
- **Apresentador_de_Erros_de_Acesso**: Componente que converte erros não confiáveis em mensagens allowlisted e sem conteúdo sensível.
- **Erro_de_Acesso_Conhecido**: Falha classificada de validação, credencial, rate limit, criptografia/contexto, storage, sessão, quota/escrita, conta existente, coordenação, lock/deadline, peer tab, envelope, migração ou backup.
- **Mensagem_Segura_de_Acesso**: Registro com código público, estágio, título, mensagem, ação, alvo de foco, efeito sobre dados, retryability e identificador diagnóstico local quando aplicável.
- **Controlador_de_Formulário_de_Acesso**: Máquina de estados `IDLE`, `SUBMITTING`, `COMPATIBILITY_DECISION`, `FAILED` e `SUCCEEDED` que controla criação e entrada.
- **Coordenador_de_Concorrência**: Componente que negocia e aplica um Modo_de_Coordenação antes de qualquer escrita protegida.
- **Modo_de_Coordenação**: Um dos estados `FULL_WEB_LOCKS`, `COMPATIBILITY_SINGLE_TAB`, `READ_ONLY` ou `UNAVAILABLE`.
- **Disclosure_de_Compatibilidade**: Aviso persistente que informa menor garantia concorrente, uso de uma única aba, pausa diante de peer ou incerteza e alternativa de navegador compatível.
- **Fachada_Pública**: Contrato global existente em `window.PlannerCore`, `window.PlannerLocal`, `window.PlannerTravel` ou `window.PlannerApp`.
- **Contrato_de_Compatibilidade**: Conjunto de invariantes existentes em que normalização repetida é idempotente, referências de participantes, viagens, recorrências e votos permanecem resolvíveis, balances de settlement somam zero centavos, cada participante ocupa no máximo uma opção por decisão aberta, materialização recorrente não duplica ocorrência mensal, texto controlado pelo usuário é renderizado como texto não executável e as Fachadas_Públicas mantêm assinaturas e resultados observáveis, salvo a mudança deliberada de `PlannerCore.SCHEMA_VERSION` para 2 no cutover do Schema_v2, cuja compatibilidade é provada pela Projeção_v1.
- **Schema_v1**: Schema atual `plannerduo-workspace` com `schemaVersion: 1`, valores decimais em reais e moeda fixa BRL.
- **Schema_v2**: Schema `plannerduo-workspace` com `schemaVersion: 2`, valores em Unidades_Menores e coleções de Cotações, Reservas, trechos, hospedagens, Simulações_de_Remarcação, Taxas_de_Câmbio_Manuais, Regras_de_Taxa, Parcelamentos e Lembretes, sem alteração do formato `plannerduo-vault`, do envelope, dos parâmetros criptográficos ou de `MAX_AMOUNT`.
- **Projeção_v1**: Projeção interna `ProjectToV1` que remove campos e coleções exclusivos do Schema_v2 e converte Unidades_Menores de volta a decimais em reais, usada como adaptador das funções legadas e como oráculo de testes.
- **Migrador_de_Workspace**: Componente puro que migra, normaliza e projeta workspaces entre Schema_v1 e Schema_v2 sem gravar dados.
- **Slice_de_Modularização**: Extração pequena e reversível de uma responsabilidade para um módulo coeso, mantendo delegação pela Fachada_Pública.
- **Pipeline_de_Modularização**: Processo de caracterização, extração, delegação, equivalência, validação e rollback de um Slice_de_Modularização.
- **Kernel_de_Segurança**: Limite interno responsável por envelope, criptografia, sessão, migração, backup e persistência protegida.
- **Contrato_de_Proteção**: Contrato existente de envelope `plannerduo-vault` versão 1, PBKDF2-SHA-256 com 600.000 iterações e salt de 16 bytes, AES-GCM 256 com IV de 12 bytes e tag de 128 bits, workspace cifrado em `localStorage`, chave de sessão em `sessionStorage`, metadados autenticados, IV novo por escrita, falha fechada, ausência de plaintext persistente, assets locais, Content Security Policy de meta e de header com `connect-src 'none'` em `index.html` e `auth.html` e com `connect-src 'self'` somente em `app.html`, exclusivamente para `POST /api/assistant`, e diagnóstico redigido limitado a 200 eventos em memória por aba sem transmissão de rede.
- **Suíte_de_Qualidade**: Conjunto de testes unitários, contract tests, property tests, testes de integração, testes browser-level, verificações de acessibilidade, testes do Proxy_Local com Upstream_Falso, avaliação do Corpus_Adversarial e comando final `npm run verificar`.
- **Teste_Browser_Level**: Teste que carrega HTML, CSS e handlers reais por origem local, interage com a interface e observa DOM, estilos computados, foco, navegação, requests e storage em zoom de navegador de 100% e 200%.
- **Property_Test**: Teste de propriedade universal com geração de entradas e mínimo de 100 iterações por propriedade.
- **Slice_de_Implementação**: Menor alteração de comportamento submetida conjuntamente aos gates técnicos e dos Agentes.
- **Assistente_de_IA**: Funcionalidade opcional e desligada por padrão, composta pelo painel do assistente em `app.html`, pelo Proxy_Local e por um Adapter_de_Provedor, que usa um LLM com a chave de API do próprio usuário (BYOK) para gerar texto e Propostas.
- **Proxy_Local**: Rota `POST /api/assistant` no processo de `scripts/dev-server.mjs`, restrita a loopback, única parte do Assistente_de_IA que detém a chave de API e acessa a internet.
- **Adapter_de_Provedor**: Adaptador `openai-compatible` ou `anthropic` do Proxy_Local que monta a requisição upstream e normaliza a resposta; `openai-compatible` também atende servidor de modelo local em loopback.
- **Agente_Temático**: Preset de runtime do Assistente_de_IA (Cotações, Remarcação, Hospedagem, Financeiro ou Roteiro) com allowlist própria de campos de contexto e de ferramentas de Proposta, distinto dos Agentes da Equipe_de_Agentes.
- **Proposta**: Sugestão estruturada e não confiável do modelo que referencia exatamente uma ferramenta do catálogo de Propostas, recebe `proposalId` de uso único após validação e expira 15 minutos após a criação.
- **Card_de_Proposta**: Componente rotulado “Sugestão do Assistente IA — revise antes de aplicar” que exibe resumo, diff campo a campo e avisos de uma Proposta validada, oferece “Aplicar sugestão”, “Editar antes de aplicar” e “Descartar” e assume os estados `READY`, `BLOCKED`, `APPLYING`, `APPLIED`, `CONFLICT`, `EXPIRED` e `DISCARDED`.
- **Prévia_do_Envio**: Exibição, antes de cada envio, do JSON canônico exato da requisição `chat` e da versão das instruções fixas.
- **Consentimento**: Registro `settings.assistant.consent` com adapter, host, modelo, indicação de modelo local, versão e data de aceite, gravado nos dados protegidos após o diálogo “Ativar assistente com {provedor}” e apagado quando o Assistente_de_IA é desligado.
- **Pseudonimização**: Substituição de nomes de participantes por “Participante A”, “Participante B” e seguintes e de IDs internos por referências locais como `T1`, `Q2` e `S3`, com mapa de reversão mantido somente em memória.
- **Construtor_de_Contexto**: Componente do navegador que projeta o contexto mínimo pela allowlist do Agente_Temático, aplica a Pseudonimização e serializa o JSON canônico exibido na Prévia_do_Envio.
- **Validador_de_Propostas**: Componente que valida cada Proposta contra o catálogo e os schemas locais e a executa a seco sobre um clone do workspace.
- **Executor_de_Propostas**: Componente que aplica uma Proposta validada somente após gesto confiável no Card_de_Proposta.
- **Renderizador_Seguro_de_Mensagens**: Componente que converte texto do modelo em DOM inerte por allowlist de elementos e atributos.
- **Upstream_Falso**: Servidor de teste `tests/fakes/fake-llm-upstream.mjs` em `127.0.0.1` com porta aleatória que simula respostas `openai-compatible` e `anthropic`.

## Requirements

### Requirement 1: Equipe de agentes, skills e governança

**User Story:** Como mantenedor do PlannerDuo, quero uma equipe local de agentes e skills com despacho, permissões e aprovação governados, para que cada mudança seja limitada, rastreável, revisada de forma independente e concluída sem ciclos de delegação.

#### Acceptance Criteria

##### 1.1

WHEN uma Solicitação_de_Trabalho for recebida, THE Orquestrador SHALL produzir, antes do primeiro despacho, um Plano_de_Despacho com exatamente uma Tarefa raiz e um Grafo_de_Trabalho acíclico no qual cada Tarefa contenha ID exclusivo no plano, objetivo entre 1 e 2.000 caracteres, risco `LOW`, `MEDIUM` ou `HIGH`, listas explícitas de Paths permitidos e Paths negados, Skills requeridas, Capacidades requeridas, referências de Contratos_de_Entrada, referências de Contratos_de_Saída e Requisitos_de_Evidência, inclusive quando qualquer lista for vazia, exatamente um proprietário ou uma indicação explícita de ausência de proprietário, pelo menos uma checagem de aceitação e somente dependências que referenciem Tarefas existentes no mesmo plano.

##### 1.2

WHEN uma invocação de Agente for preparada, THE Registro_de_Agentes_e_Skills SHALL validar, antes da invocação, exatamente os 10 membros da Equipe_de_Agentes e as 21 entradas do Catálogo_de_Skills, IDs únicos, uma única versão por ID, cada Skill e Capacidade enumerada, cada referência de Contrato_de_Entrada, Contrato_de_Saída e Requisito_de_Evidência resolvível, Compatibilidade_Total_de_Contratos em cada relação produtor-consumidor e compatibilidade de versão de todas as referências, produzindo um resultado atômico que autorize a invocação somente na ausência de falhas ou que, na presença de uma ou mais falhas, liste todas as falhas, autorize zero invocações e preserve o Grafo_de_Trabalho sem mutação.

##### 1.3

WHEN uma Tarefa requerer execução especializada, THE Orquestrador SHALL produzir exatamente um resultado entre atribuir e despachar a Tarefa para um único Agente que satisfaça integralmente todas as Skills, Capacidades, permissões de Path, Contratos_de_Entrada, Contratos_de_Saída, Requisitos_de_Evidência e Compatibilidade_Total_de_Contratos requeridos sem alcançar Skill, Capacidade ou Path negado, ou marcar a Tarefa como `BLOCKED`, listar todas as lacunas de elegibilidade e realizar zero invocações, permanecendo o Orquestrador como único papel autorizado a criar, atribuir e despachar Tarefas filhas.

##### 1.4

WHILE houver Tarefas_Ativas, THE Guardião_de_Governança SHALL considerar um Path solicitado permitido somente quando o Path for igual ou descendente de um Path permitido enumerado, considerar o Path solicitado negado quando existir Relação_de_Sobreposição_de_Path com qualquer Path negado enumerado, aplicar negação com precedência sobre permissão, manter exatamente um proprietário por Tarefa_Ativa, reservar Write Paths relacionados por Relação_de_Sobreposição_de_Path para no máximo um Writer, permitir o próximo Writer somente após a liberação da reserva anterior e rejeitar toda atribuição ou escrita antecipada com zero mutações.

##### 1.5

WHEN um Agente for invocado, THE Orquestrador SHALL fornecer somente o conteúdo dos Paths, Contratos_de_Entrada, Contratos_de_Saída, Requisitos_de_Evidência e Artefatos_de_Evidência enumerados na Tarefa e necessários para o objetivo e as checagens de aceitação da Tarefa, calcular as Capacidades efetivas como a interseção entre as Capacidades requeridas pela Tarefa e as Capacidades permitidas pelo manifesto após subtrair todas as negações, aplicar a Relação_de_Sobreposição_de_Path a cada Path fornecido e fornecer zero conteúdo, evidência ou Capacidade alcançados por Skill, Path ou Capacidade negados.

##### 1.6

IF uma expansão proposta do Grafo_de_Trabalho criar ciclo, atribuir profundidade superior a 4 considerando a raiz na profundidade 0, elevar o Fan-out da Wave acima de 4 ou iniciar a terceira tentativa consecutiva de uma Tarefa sem Artefato_de_Evidência novo desde a tentativa anterior, THEN THE Guardião_de_Governança SHALL bloquear a expansão antes de qualquer alteração, preservar o grafo e os Artefatos_de_Evidência existentes e registrar todos os limites violados pela proposta.

##### 1.7

WHEN uma saída de Agente alterar comportamento, DOM, CSS, Copy_Visível, autenticação, storage, criptografia, URL, concorrência ou prontidão de release, THE Executor_de_Gates SHALL aplicar cumulativamente QA para toda alteração de comportamento, UX e acessibilidade para DOM, CSS ou Copy_Visível, Segurança para autenticação, storage, criptografia, URL ou concorrência e documentação e release para declaração de prontidão, exigir para cada gate obrigatório aprovação de pelo menos um Agente diferente do autor e ausência de veto vigente, registrar um Vínculo_de_Gate com a Tarefa, o Agente autor, o identificador, o digest e a revisão do Artefato_de_Evidência que contenha a saída exata avaliada e invalidar todos os verdicts vinculados quando qualquer byte ou metadado vinculado dessa saída for alterado, mantendo a saída sem aceitação até nova execução dos gates obrigatórios.

##### 1.8

WHEN um Agente emitir um Handoff, THE Orquestrador SHALL validar atomicamente que a Tarefa de origem está ativa e pertence ao Agente emissor, que o papel solicitado está registrado, que o motivo possui entre 1 e 2.000 caracteres, que Skills, Capacidades, Contratos_de_Entrada, Contratos_de_Saída e Requisitos_de_Evidência da Tarefa filha proposta estão enumerados, resolvíveis e integralmente satisfeitos pelo papel solicitado, que existe Compatibilidade_Total_de_Contratos entre a saída da origem, a entrada da filha e o contrato de saída solicitado, que os Artefatos_de_Evidência estão enumerados e vinculados à origem, que cada Path permanece no escopo da origem, é igual ou descendente de Path permitido e não possui Relação_de_Sobreposição_de_Path com Path negado ao papel solicitado, que a profundidade resultante é no máximo 4 considerando a raiz na profundidade 0 e que a expansão permanece acíclica, criando exatamente uma Tarefa filha somente após a aprovação de todas as validações e criando zero Tarefas filhas com todas as lacunas registradas nos demais resultados.

##### 1.9

WHEN uma Tarefa ou um Claim for submetido à aceitação, THE Sistema_de_Agentes SHALL aceitar a submissão somente mediante satisfação de cada Requisito_de_Evidência enumerado e Artefato_de_Evidência imutável vinculado à mesma Tarefa, ao mesmo Agente autor e à saída exata submetida, contendo resultados das checagens, riscos, verdicts dos gates, Vínculos_de_Gate válidos, evidência de independência entre autor e aprovadores e ausência de veto, mantendo a submissão não aceita e listando todas as lacunas quando qualquer elemento estiver ausente, incompatível, inválido ou vinculado a outra revisão da saída.

##### 1.10

IF um Conflito_Bloqueante permanecer sem resolução aceita, THEN THE Orquestrador SHALL marcar a Tarefa como `BLOCKED`, autorizar zero merges e zero continuações dependentes, preservar o estado e os Artefatos_de_Evidência existentes, apresentar ao usuário uma lista finita de pelo menos duas alternativas mutuamente exclusivas com identificador único e respectivas evidências, exigir a seleção explícita e registrada de exatamente uma alternativa e manter zero continuações conflitantes quando nenhuma alternativa ou mais de uma alternativa for selecionada.

##### 1.11

WHEN a configuração da Equipe_de_Agentes ou do Catálogo_de_Skills for carregada ou alterada, THE Registro_de_Agentes_e_Skills SHALL aceitar a configuração somente com exatamente os 10 Agentes da Equipe_de_Agentes e as 21 Skills do Catálogo_de_Skills, sem ID ausente, adicional ou duplicado, com cada Skill pertencente a exatamente um Grupo_de_Skills na distribuição de 4 Skills em Viagens, 5 em Finanças, 3 em IA e 9 em Plataforma, cada Skill carregada por pelo menos um Agente e cada Skill referenciada por manifesto existente no catálogo, rejeitando atomicamente a configuração e listando todas as divergências nos demais casos.

##### 1.12

THE Registro_de_Agentes_e_Skills SHALL conceder Write Paths sobre Paths_de_Produção somente a `fullstack-developer`, em `public/**` exceto `public/modules/assistant/**`, e a `ai-assistant-engineer`, em `scripts/assistant/**`, `public/modules/assistant/**` e `scripts/dev-server.mjs` para a montagem da rota do Proxy_Local, manter disjuntos os conjuntos efetivos de Write Paths desses dois Agentes após a aplicação das negações e conceder zero Write Paths sobre Paths_de_Produção a `orchestrator`, `architect`, `security-analyst`, `travel-operations-specialist`, `trip-finance-specialist`, `ux-accessibility`, `qa-property-testing` e `documentation-release`.

##### 1.13

WHEN uma saída de Agente alterar cálculo monetário, jornada, Cotação, Reserva, Pós-venda, Assistente_de_IA, contexto enviado ao Assistente_de_IA, Proxy_Local, Content Security Policy, `scripts/dev-server.mjs` ou `scripts/verificar-frontend.mjs`, THE Executor_de_Gates SHALL exigir, cumulativamente aos gates de 1.7 e sempre de Agente diferente do autor, verdicts de `trip-finance-specialist` e de `qa-property-testing` para cálculo monetário, verdicts de `travel-operations-specialist` e de `qa-property-testing` para jornada, Cotação, Reserva ou Pós-venda e verdict de `security-analyst` para Assistente_de_IA, contexto enviado ao Assistente_de_IA, Proxy_Local, Content Security Policy, `scripts/dev-server.mjs` ou `scripts/verificar-frontend.mjs`, mantendo a saída sem aceitação enquanto qualquer verdict exigido estiver ausente ou vetado.

##### 1.14

WHEN uma saída de `ai-assistant-engineer` for submetida à aceitação, THE Executor_de_Gates SHALL aceitar como evidência adversarial somente o Corpus_Adversarial cujos casos tenham autoria registrada de Agente diferente de `ai-assistant-engineer` e manter a saída sem aceitação quando qualquer caso usado na aprovação tiver `ai-assistant-engineer` como autor.

### Requirement 2: PlannerDuo travel-first, acesso protegido e evolução incremental

**User Story:** Como viajante, quero buscar e comparar passagens, organizar viagens, intenções de reserva, orçamento, gastos e metas em uma interface legível com acesso local protegido, para que eu planeje cada viagem sem claims falsos, perda de dados ou barreiras de acessibilidade.

#### Acceptance Criteria

##### 2.1

THE PlannerDuo SHALL usar “Área de viagens” como identidade primária na página inicial, no fluxo de acesso e na área principal e posicionar “Buscar passagens” e “Minhas viagens” antes de finanças genéricas e detalhes técnicos de proteção na ordem visual, na ordem do DOM e na ordem de tabulação por teclado.

##### 2.2

WHEN uma Viagem for aberta, THE Serviço_de_Contexto_de_Viagem SHALL produzir um Contexto_de_Viagem que preserve destino, período, orçamento, valor guardado e notas, apresente orçamento, Despesas e valor guardado como valores distintos, inclua somente Despesas e Itens_de_Checklist cujo `tripId` corresponda à Viagem, apresente seções de planejamento, orçamento, despesas, valor guardado, checklist, decisões, Intenções_de_Reserva e Metas_de_Viagem com estado vazio explícito em cada seção sem registros e não afirme vínculo individual de Meta_de_Viagem ausente no schema.

##### 2.3

WHEN uma Despesa ou um Item_de_Checklist for projetado ou tiver o vínculo alterado, THE Serviço_de_Contexto_de_Viagem SHALL classificar o registro exclusivamente por `tripId` em vinculado quando o identificador resolver para uma Viagem existente, Item_Sem_Vínculo quando `tripId` for nulo ou referência não resolvida quando o identificador não nulo não resolver para uma Viagem existente, preservar todos os campos diferentes de `tripId` e realizar zero inferências de vínculo por descrição, data, categoria, participante, valor ou posição.

##### 2.4

WHEN uma Entrada_de_Busca contiver localidades entre 1 e 80 caracteres com pelo menos uma letra ou um algarismo, destino para todo grupo selecionado, origem para os grupos `flights` e `ground`, cada data informada como uma data real no formato `AAAA-MM-DD` entre a data corrente e `9999-12-31` inclusive, data de volta somente acompanhada de data de ida e não anterior à data de ida, data de volta posterior à data de ida para o grupo `stays`, quantidade inteira de passageiros entre 1 e 9 e uma seleção entre 1 e 26 IDs únicos existentes no Registro_de_Provedores, THE Mecanismo_de_Busca_de_Viagens SHALL produzir exatamente um Descritor_de_Resultado para cada ID selecionado consumindo uma versão atômica do Registro_de_Provedores que contenha exclusivamente e sem entradas adicionais exatamente 10 provedores no grupo `flights` — Google Voos, KAYAK, Skyscanner, momondo, Kiwi, Expedia, Decolar, LATAM, GOL e Azul —, exatamente 8 provedores no grupo `stays` — Airbnb, Booking.com, Expedia Hotéis, Hoteis.com, Hostelworld, Vrbo, Agoda e trivago —, exatamente 6 provedores no grupo `ground` — ClickBus, Buser, Rome2Rio, Omio, FlixBus e Busbud — e exatamente 2 provedores no grupo `cars` — Localiza e Booking Cars —, mantenha exatamente 26 entradas completas com `providerId` e nome únicos e associação a exatamente um grupo, qualifique cada entrada como Provedor_Confiável, registre `providerId`, nome legal ou comercial, Domínio_Canônico_Oficial, categoria, Página_Oficial_de_Busca_ou_Reserva, Evidência_Oficial_de_Provedor separada para nome, domínio e página, origem da marca representada por uma Fonte_de_Marca_Auditável, licença ou termos consultados, Hash_de_Asset com exatamente 64 caracteres hexadecimais, Data_de_Verificação_Válida e Modo_de_Deep_Link, associe cada `providerId` a exatamente um Asset_de_Marca_Oficial obtido prioritariamente do kit de marca ou site oficial e somente em fallback de uma entrada correspondente no Simple Icons após Evidência_de_Indisponibilidade_Oficial, documente conformidade com as diretrizes de marca aplicáveis, comprove que o Hash_de_Asset é igual ao SHA-256 dos bytes exatos servidos localmente e produza URLs com HTTPS válido, hostname igual por comparação exata ao Domínio_Canônico_Oficial allowlisted, zero credenciais incorporadas, zero portas personalizadas, zero aceitação por prefixo, sufixo, substring, wildcard, domínio pai ou subdomínio não registrado, zero clones, domínios imitadores, redirecionadores, encurtadores, afiliados ou intermediários não declarados, modo e campos preenchidos coerentes com a URL e indicação explícita de que preço, disponibilidade e confirmação pertencem ao provedor externo.

##### 2.5

IF qualquer condição de localidade, data, passageiros ou seleção de provedores definida em 2.4 for violada, qualquer grupo ou membro da lista fechada de 26 provedores divergir de 2.4, qualquer entrada selecionada não satisfizer integralmente a definição de Provedor_Confiável, Domínio_Canônico_Oficial ou Página_Oficial_de_Busca_ou_Reserva, a Data_de_Verificação_Válida for futura ou possuir mais de 365 dias, a Evidência_Oficial_de_Provedor para nome, domínio ou página estiver ausente, a origem, a licença ou os termos, as diretrizes, a correspondência da marca ou o Hash_de_Asset não puderem ser validados, os bytes servidos divergirem do Hash_de_Asset, ou o fallback do Simple Icons não possuir Evidência_de_Indisponibilidade_Oficial, THEN THE PlannerDuo SHALL rejeitar a operação atomicamente, produzir zero Descritores_de_Resultado, zero navegações, zero contatos externos e zero persistências, associar o erro ao primeiro campo inválido na ordem visual e mover o foco para esse campo ou, quando a falha pertencer a provedor, associar o erro ao primeiro provedor inválido na ordem submetida e mover o foco para o controle de seleção correspondente ou para um resumo de erro com o nome acessível desse provedor quando o controle não estiver renderizado, preservar os valores informados e todos os dados existentes, usar como única alternativa de marca um Wordmark_Oficial validado e registrado sob os mesmos gates, bloquear a inclusão do provedor quando essa alternativa também não estiver disponível, registrar a decisão e produzir zero substituições silenciosas por desenho manual, letra ou monograma genérico, emoji, template ou logotipo de terceiro incorreto.

##### 2.6

THE PlannerDuo SHALL carregar cada Asset_de_Marca_Oficial exclusivamente de arquivo versionado e servido pela própria aplicação cujos bytes produzam o Hash_de_Asset registrado, usar a ativação explícita do usuário sobre um Descritor_de_Resultado validado como único gatilho de contato com o Domínio_Canônico_Oficial por meio do Adaptador_de_Navegação, realizar zero ocorrências de Hotlink, zero dependências de CDN, zero requests externos de asset e zero contatos com provedores durante startup, renderização, foco, hover, validação ou comparação, realizar zero contatos com qualquer origem externa no fluxo de busca antes do gatilho, manter a Content Security Policy de meta e de header com `connect-src 'none'` em `index.html` e `auth.html` e com `connect-src 'self'` somente em `app.html`, exclusivamente para o canal opcional do Assistente_de_IA regido pelo Requirement 5, e, após o gatilho, abrir exatamente uma URL allowlisted com isolamento `noopener` e `noreferrer` e representar a ação como Intenção_de_Reserva transitória no estado `OPENED_EXTERNALLY` com `confirmation_claim` igual a falso.

##### 2.7

THE PlannerDuo SHALL expressar conceitos visíveis de identidade e proteção somente com os Termos_Visíveis_Aprovados e vocabulário orientado a viagens, renderizar zero ocorrências case-insensitive de `vault`, `cofre`, qualquer token iniciado por `vault` ou `plannerduo-vault` na interface ou em nomes, descrições e estados de acessibilidade e confinar os Termos_Técnicos_Internos a símbolos, códigos, chaves, formatos persistidos, testes e documentação explicitamente técnica não renderizados como identidade do produto.

##### 2.8

THE PlannerDuo SHALL renderizar Texto_Corrente com tamanho computado mínimo de 16 CSS px, Texto_Secundário e Texto_Crítico com tamanho computado mínimo de 14 CSS px e somente Metadado_Não_Crítico com tamanho computado mínimo de 13 CSS px, aplicar o maior piso quando um elemento pertencer a mais de uma categoria e manter Texto_Crítico fora de metadados, conteúdo exclusivo de tooltip, truncamento e ícones sem nome acessível.

##### 2.9

THE PlannerDuo SHALL renderizar texto normal e placeholder informativo com contraste mínimo de 4.5:1, texto grande, componentes, bordas significativas e indicadores de foco com contraste mínimo de 3:1, representar cada estado também por texto ou semântica além de cor, fornecer a cada ação primária um alvo computado mínimo de 44 por 44 CSS px e, em cada cartão de provedor, manter diferença relativa máxima de 1% entre a proporção renderizada e a proporção intrínseca do Asset_de_Marca_Oficial, preservar as cores contidas no asset sem recoloração de `fill` ou `stroke`, sem `filter` e sem aplicação de `opacity` diferente de 1 no asset ou em seus ancestrais visuais, enquadrar o asset sem corte na Área_Visual_de_Marca com pelo menos 4 CSS px de espaço interno em cada lado sobre Fundo_de_Marca_Adequado, exibir o nome textual do provedor adjacente ao asset, marcar o asset decorativo com `alt=""` ou `aria-hidden="true"` e manter no botão ou link o nome acessível persistente do provedor.

##### 2.10

WHILE o zoom do navegador estiver em 200% nas viewports de 1440 por 900, 1024 por 576, 768 por 1024, 390 por 844 e 360 por 640 CSS px, THE PlannerDuo SHALL apresentar conteúdo e ações sem sobreposição, corte, perda, truncamento ou overflow horizontal global e limitar scroll horizontal local a conteúdo bidimensional identificado por nome e navegável por teclado.

##### 2.11

WHILE a viewport possuir largura entre 360 e 1440 CSS px e altura entre 576 e 700 CSS px inclusive, THE Controlador_de_Formulário_de_Acesso SHALL apresentar o fluxo de acesso em uma coluna form-first, manter formulário, Mensagem_Segura_de_Acesso, ação e alvo de foco alcançáveis por scroll vertical, reduzir decoração antes de conteúdo funcional e preservar todos os pisos tipográficos.

##### 2.12

WHEN o usuário navegar, submeter um fluxo ou fechar um diálogo por teclado, THE PlannerDuo SHALL incluir cada controle interativo visível e habilitado exatamente uma vez por ciclo de tabulação na ordem visual, manter label e nome acessível persistentes, exibir foco visível e não recortado, mover o foco para o primeiro campo inválido ou para o resumo de erro, devolver o foco ao elemento que abriu o diálogo, usar exatamente uma live region ativa e um anúncio por resultado e manter o erro renderizado até ação explícita do usuário ou nova submissão.

##### 2.13

WHEN uma criação de conta, troca de senha, importação ou escrita protegida for solicitada, THE Verificador_de_Capacidades SHALL produzir, antes de derivação de chave ou escrita, um resultado explícito para Web Crypto, contexto seguro, leitura e escrita de `localStorage`, escrita de `sessionStorage`, Web Locks, `BroadcastChannel` e storage events, executar probes com chaves e valores únicos, remover ou reverter cada alteração do próprio probe, preservar todos os dados preexistentes e impedir persistência parcial quando qualquer capacidade exigida pela operação estiver ausente.

##### 2.14

WHEN uma criação de conta ou entrada produzir erro, THE PlannerDuo SHALL aplicar um mapping total e allowlisted para validação, credencial, rate limit, criptografia, contexto, storage, sessão, quota, escrita, conta existente, coordenação, lock, deadline, peer, envelope, migração e backup, retornar código público, estágio, título, mensagem, ação, alvo de foco, efeito sobre os dados e retryability para cada Erro_de_Acesso_Conhecido, produzir zero ocorrências do fallback “Não foi possível concluir a operação com segurança” para erros conhecidos, rejeitar novas submissões de credenciais por exatamente 10 segundos após a quinta rejeição consecutiva e apresentar para falha desconhecida uma ação de retry, efeito sobre os dados verificado e identificador diagnóstico local opaco sem senha, chave, plaintext técnico, PII, causa bruta ou stack trace.

##### 2.15

WHEN uma tentativa do Controlador_de_Formulário_de_Acesso alcançar resultado terminal, THE Controlador_de_Formulário_de_Acesso SHALL entrar em `SUCCEEDED` somente após persistência verificada e sessão estabelecida ou alcançar `FAILED` ou `IDLE` nos demais resultados, invalidar permissão de commit tardio, reabilitar o botão de submissão e restaurar o label original em até 1.000 ms após o resultado terminal exceto durante o cooldown definido em 2.14, limpar todos os campos de senha, preservar valores não secretos, manter a mensagem ou decisão aplicável renderizada e definir o foco de recuperação.

##### 2.16

WHERE Web Locks estiver disponível, WHILE uma escrita protegida estiver ativa, THE Coordenador_de_Concorrência SHALL selecionar `FULL_WEB_LOCKS`, adquirir exatamente um lock exclusivo com deadline positiva de no máximo 10 segundos, encaminhar toda leitura e escrita pelo único Repositório_de_Workspace autoritativo, manter ordem observacional equivalente a uma execução serial e tratar o vencimento da deadline como falha recuperável com zero commits e invalidação de qualquer conclusão tardia.

##### 2.17

IF Web Locks estiver indisponível, THEN THE PlannerDuo SHALL entrar em `COMPATIBILITY_DECISION` antes de solicitar consentimento para escrita, selecionar `COMPATIBILITY_SINGLE_TAB` somente com Web Crypto em contexto seguro, `localStorage` legível e gravável, `sessionStorage` gravável, `BroadcastChannel`, storage events e consentimento explícito, selecionar `READ_ONLY` quando leitura protegida e autenticação forem possíveis sem todos os requisitos ou o consentimento do modo compatível, selecionar `UNAVAILABLE` nos demais casos, selecionar zero vezes `FULL_WEB_LOCKS`, manter o Disclosure_de_Compatibilidade persistente durante o modo compatível e pausar escrita diante de incerteza de peer, lease, visibility, sequence ou ownership.

##### 2.18

WHEN um Slice_de_Modularização for executado, THE Pipeline_de_Modularização SHALL tratar o Slice_de_Modularização como uma transação, caracterizar cada saída, erro e efeito observável afetado, mover exatamente uma responsabilidade coesa, manter as Fachadas_Públicas observacionalmente equivalentes para todo input anterior válido, salvo Copy_Visível explicitamente revisada e a evolução deliberada para o Schema_v2, cuja compatibilidade é provada pela Projeção_v1 conforme 4.10, preservar o Contrato_de_Compatibilidade e o formato persistido do envelope, alterar o schema do workspace somente pela migração versionada do Requirement 4, executar todos os gates acionados e concluir o slice somente após aprovação integral ou restaurar integralmente o estado anterior com identificação de cada gate que falhou.

##### 2.19

THE PlannerDuo SHALL exigir que o Kernel_de_Segurança preserve exatamente um envelope criptografado autoritativo, incremente revision e sequence exatamente uma vez por escrita aceita com IV novo, preserve o envelope anterior diante de qualquer falha, produza zero mutações para credencial incorreta, revele zero conteúdo protegido sob sessão inválida, falhe fechado diante de adulteração sem substituir dados por workspace vazio, exponha zero plaintext técnico do envelope ou material de chave em persistência, Copy_Visível ou diagnósticos, remova uma origem legível de migração somente após round-trip criptografado verificado, preserve a origem diante de qualquer falha, impeça backup rejeitado de substituir o estado atual, valide e recriptografe backup aceito antes de torná-lo autoritativo e mantenha diagnósticos redigidos, locais, sem transmissão de rede e limitados a no máximo 200 eventos por aba; e exigir que cada Asset_de_Marca_Oficial seja baixado por HTTPS exclusivamente durante o desenvolvimento, primeiro do kit de marca ou site oficial registrado e somente do Simple Icons após Evidência_de_Indisponibilidade_Oficial, passe pelo Sanitizador_de_Assets_de_Marca antes da admissão, seja versionado localmente com Hash_de_Asset de exatamente 64 caracteres hexadecimais igual ao SHA-256 dos bytes servidos pela própria aplicação, que cada SVG possua entre 1 e 262.144 bytes inclusive e seja rejeitado, em qualquer combinação de maiúsculas e minúsculas, quando contiver elemento `script`, `foreignObject`, `iframe`, `object`, `embed`, `audio`, `video`, `canvas` ou `image`, elemento cujo nome comece por `animate`, elemento `set`, atributo cujo nome comece por `on`, declaração de entidade externa, `@import`, `@font-face`, importação ou referência de fonte, conteúdo ativo ou executável, ou referência `href`, `xlink:href`, `src` ou `url(...)` diferente de fragmento interno iniciado por `#`, e que cada Asset_Raster possua tipo `image/png`, `image/webp` ou `image/jpeg`, entre 1 e 1.048.576 bytes inclusive, largura e altura entre 1 e 4.096 pixels inclusive, no máximo 16.777.216 pixels decodificados e Hash_de_Asset correspondente.

##### 2.20

WHEN um Slice_de_Implementação for submetido à aceitação futura, THE Suíte_de_Qualidade SHALL executar casos nominais, de erro e de fronteira direcionados, testes de contrato e equivalência das Fachadas_Públicas, Property_Tests com no mínimo 100 iterações por propriedade e referência à propriedade correspondente do design, Testes_Browser_Level com HTML, CSS e handlers reais para criação de conta, entrada, sucesso e cada classe de erro afetada com assertions de Copy_Visível, foco, botão e efeito no storage, matriz de UX e acessibilidade nas viewports de 1440 por 900, 1024 por 576, 768 por 1024, 390 por 844 e 360 por 640 CSS px tanto em zoom de 100% quanto em zoom de 200%, verificação do Registro_de_Provedores com exatamente os 10 provedores de `flights`, 8 de `stays`, 6 de `ground` e 2 de `cars` enumerados em 2.4 sem entrada adicional, `providerId`, nome e grupo únicos e todos os campos de auditoria preenchidos, Evidência_Oficial_de_Provedor separada e válida para nome, Domínio_Canônico_Oficial e Página_Oficial_de_Busca_ou_Reserva, Data_de_Verificação_Válida não futura e com no máximo 365 dias e Evidência_de_Indisponibilidade_Oficial para todo fallback do Simple Icons, verificação de exatamente 26 Assets_de_Marca_Oficial presentes e versionados localmente com correspondência bijetiva `providerId` → asset, Hash_de_Asset com exatamente 64 caracteres hexadecimais igual ao SHA-256 dos bytes servidos, teste que, para cada um dos 26 Assets_de_Marca_Oficial aceitos, altere exatamente um byte dos bytes servidos e exija falha da verificação de hash, origem, licença ou termos e diretrizes de marca rastreáveis, testes que rejeitem SVG fora do intervalo de 1 a 262.144 bytes ou com `script`, `foreignObject`, `iframe`, `object`, `embed`, `audio`, `video`, `canvas`, `image`, `animate*`, `set`, atributo `on*`, entidade externa, `@import`, fonte ou `href` ou `url(...)` não restrito a `#` interno e Asset_Raster fora da Política_de_Asset_Raster, instrumentação que prove zero requests externos de asset e zero contatos com provedor antes da ativação explícita no runtime, testes de host que aceitem somente igualdade exata com o Domínio_Canônico_Oficial registrado e rejeitem prefixo, sufixo, substring, wildcard, domínio pai, subdomínio não registrado, clone, domínio imitador, redirecionador, encurtador, afiliado, intermediário não declarado e domínio divergente, assertions visuais e de acessibilidade em zoom de 100% e 200% para diferença relativa máxima de 1% da proporção intrínseca, espaço interno mínimo de 4 CSS px em cada lado, ausência de corte, recoloração, `filter` ou `opacity` diferente de 1, Fundo_de_Marca_Adequado, nome textual adjacente, `alt` ou `aria-hidden` decorativo e nome acessível do controle, gates independentes de Segurança, UX e acessibilidade e Agentes correspondentes ao escopo, aprovação explícita e registrada dos Agentes `security-analyst` e `documentation-release` sobre a saída exata e sobre a evidência de nome, domínio, página oficial, origem, licença ou termos, diretrizes, integridade, Data_de_Verificação_Válida e decisão de fallback de cada marca e `npm run verificar` como última verificação executada.

### Requirement 3: Front avançado e design system

**User Story:** Como viajante, quero um Painel, a jornada e a linha do tempo de cada viagem, uma central de alertas, uma paleta de comandos e um design system local nos temas claro e escuro, para que eu acompanhe prazos, pendências e decisões em uma interface consistente, legível e acessível.

#### Acceptance Criteria

##### 3.1

WHEN o Painel for construído para um workspace e uma data corrente, THE Painel SHALL selecionar como próxima Viagem, entre as Viagens não encerradas, a de menor `startDate`, com Viagens sem data por último e desempate por `createdAt` e ID, considerar encerrada a Viagem cujo `endDate`, ou `startDate` na ausência de `endDate`, seja anterior à data corrente, apresentar os dias restantes como `max(0, startDate − data corrente)` em dias de calendário e apresentar o orçamento usado como `floor(gasto × 10000 / orçamento)` pontos-base, com gasto igual à soma do Total_na_Referência das Despesas vinculadas, somente quando o orçamento em Unidades_Menores for positivo, omitindo o indicador nos demais casos.

##### 3.2

THE PlannerDuo SHALL derivar a Jornada_da_Viagem como função determinística das Cotações, das Reservas e das datas da Viagem e da data corrente, oferecer zero controles de edição manual da etapa e produzir `CONFIRMED_BY_USER` ou `PRE_TRIP` somente quando existir pelo menos uma Reserva não cancelada e todas as Reservas não canceladas da Viagem estiverem em `CONFIRMED_BY_USER`, com `PRE_TRIP` restrito aos 7 dias que antecedem `startDate`.

##### 3.3

WHEN a Linha_do_Tempo de uma Viagem for construída, THE PlannerDuo SHALL ordenar os eventos por instante absoluto, ordem de tipo e ID da entidade, calcular o instante de cada evento sem fuso informado pelo deslocamento do dispositivo, exibir “fuso não informado” em cada evento sem fuso informado e produzir a mesma sequência para qualquer permutação das fontes.

##### 3.4

WHEN a Central_de_Alertas computar Alertas para um workspace, um instante corrente e as janelas configuradas, THE Central_de_Alertas SHALL produzir exatamente um Alerta com chave única `tipo:entidade:instante` para cada fonte não resolvida, dentro da janela e sem reconhecimento ou adiamento vigente, produzir zero Alertas para fontes resolvidas, excluídas ou fora da janela, ordenar os Alertas por severidade decrescente, prazo crescente e chave e gerar títulos com zero localizadores, endereços, notas ou dados de conta.

##### 3.5

THE Paleta_de_Comandos SHALL executar cada comando pelo mesmo controller, pelas mesmas validações e pelas mesmas confirmações da ação equivalente na interface, registrar zero comandos destrutivos, de conta, de segurança ou de backup e devolver o foco ao elemento que abriu a Paleta_de_Comandos em todo fechamento.

##### 3.6

THE PlannerDuo SHALL garantir, para todo par de cores de primeiro plano e de fundo dos Tokens_de_Design nos temas claro e escuro e nos estados default, hover, focus, disabled, erro, sucesso e aviso, contraste mínimo de 4.5:1 para texto normal e de 3:1 para texto grande, componentes, bordas significativas, indicadores de foco e segmentos de gráfico.

##### 3.7

WHILE a preferência `prefers-reduced-motion: reduce` estiver ativa, THE PlannerDuo SHALL computar duração de 0 ms para toda transição e animação não essencial, manter o skeleton estático e executar zero rolagens suaves e zero auto-scrolls.

##### 3.8

THE PlannerDuo SHALL carregar Tokens_de_Design, estilos, ícones de interface e scripts exclusivamente de arquivos locais servidos pela aplicação, usar somente a pilha de fontes do sistema e manter zero referências em CSS, HTML ou JavaScript do navegador a fontes, ícones, estilos ou scripts externos.

##### 3.9

THE PlannerDuo SHALL apresentar a Comparação_de_Cotações em tabela e, com largura de viewport inferior a 600 CSS px, em lista de cards com os mesmos valores, avisos e ordem da tabela, e acompanhar cada gráfico de uma tabela textual com os mesmos dados.

##### 3.10

THE PlannerDuo SHALL renderizar cada Componente_Avançado em conformidade com os critérios 2.8, 2.9 e 2.10 nos temas claro e escuro e em zoom de navegador de 100% e 200%.

### Requirement 4: Operações de viagem, finanças da viagem e schema v2

**User Story:** Como viajante, quero registrar cotações, reservas com confirmação informada, pós-venda e finanças da viagem em várias moedas, com taxas configuráveis, parcelamentos, acertos, previsão e relatórios, preservando meus dados atuais na evolução para o schema v2, para que eu controle o custo real de cada viagem sem perda de dados nem valores inventados.

#### Acceptance Criteria

##### 4.1

THE Serviço_Monetário SHALL representar cada valor monetário persistido como inteiro seguro em Unidades_Menores de uma moeda do Catálogo_de_Moedas, entre 0 e `MAX_AMOUNT × 10^expoente` inclusive com `MAX_AMOUNT = 1_000_000_000`, rejeitar moeda fora do catálogo com `finance/currency-unsupported`, rejeitar valor ou conversão fora do intervalo com `finance/amount-out-of-range` e calcular agregados com aritmética inteira verificada que falha com erro explícito em vez de transbordar.

##### 4.2

WHEN uma Despesa for lançada, THE Serviço_Monetário SHALL aplicar conversão identidade sem FxSnapshot quando a moeda for a Moeda_de_Referência e, nas demais moedas, selecionar somente a Taxa_de_Câmbio_Manual do par exato com a data efetiva mais recente não posterior à data da Despesa, sem inversão implícita, converter com arredondamento `HALF_EVEN`, erro máximo de 0,5 Unidade_Menor em relação ao valor racional exato e monotonicidade não decrescente na quantia, congelar a taxa usada em um FxSnapshot inalterado por alteração ou exclusão posterior de taxas e rejeitar a Despesa com `finance/rate-missing` quando nenhuma taxa aplicável existir.

##### 4.3

WHEN taxas forem calculadas para uma Despesa, THE Serviço_Monetário SHALL produzir zero taxas quando a forma de pagamento não for informada ou nenhuma Regra_de_Taxa ativa e vigente se aplicar à forma de pagamento e à moeda da Despesa, derivar cada taxa aplicada de uma Regra_de_Taxa do usuário ou de ajuste manual registrado, calcular percentuais em pontos-base sobre `baseAmountMinor` com `HALF_EVEN` e sem capitalização entre regras, definir o Total_na_Referência como `baseAmountMinor` somado às taxas aplicadas e depender de zero alíquotas de IOF ou de taxa fixadas no código.

##### 4.4

WHEN os Acertos de uma Viagem forem calculados, THE Serviço_de_Acertos SHALL calcular os saldos dos participantes sobre o Total_na_Referência de cada Despesa vinculada, inclusive de Despesas em moedas diferentes da Moeda_de_Referência, produzir soma dos saldos igual a exatamente zero Unidades_Menores da Moeda_de_Referência e produzir somente Acertos com valor inteiro positivo.

##### 4.5

WHEN um Parcelamento for agendado para uma Despesa não recorrente, THE Serviço_de_Parcelamento SHALL aceitar somente de 1 a 48 parcelas e no máximo um Parcelamento por Despesa, produzir exatamente a quantidade solicitada de parcelas com soma exatamente igual ao Total_na_Referência da Despesa, diferença máxima de 1 Unidade_Menor entre quaisquer duas parcelas e resto atribuído às primeiras parcelas, e definir vencimentos estritamente crescentes no mesmo dia do mês da primeira parcela ou no último dia dos meses mais curtos.

##### 4.6

WHEN o orçamento de uma Viagem ou uma Previsão_de_Caixa for calculado, THE PlannerDuo SHALL contar cada Despesa parcelada exatamente uma vez no orçamento da Viagem, pela data da compra, contar na Previsão_de_Caixa somente as parcelas não pagas dessa Despesa e projetar zero ocorrências recorrentes já materializadas.

##### 4.7

WHEN uma Simulação_de_Remarcação for calculada, THE Serviço_de_Pós-venda SHALL usar somente valores informados pelo usuário em uma única moeda, calcular a diferença efetiva como `max(0, tarifa nova − tarifa original)` em `FORFEIT_DIFFERENCE` e como `tarifa nova − tarifa original` em `KEEP_AS_CREDIT`, calcular `netMinor = diferença efetiva + multas + taxas − crédito`, `amountDueMinor = max(0, netMinor)` e `residualCreditMinor = max(0, −netMinor)`, com no máximo um dos dois positivo, e exibir “Simulação — o valor final é definido pela companhia”.

##### 4.8

WHEN uma lista de Cotações for comparada, THE Serviço_de_Cotações SHALL produzir a mesma ordem total para qualquer permutação da lista, ordenando por descarte, expiração, ausência de valor comparável, valor comparável na Moeda_de_Referência, nome normalizado do provedor e ID, atribuir valor comparável a Cotação em outra moeda somente por Taxa_de_Câmbio_Manual explícita, posicionar as Cotações sem taxa aplicável após as comparáveis com o aviso “Sem câmbio para comparar” e rotular o destaque como “Menor total informado”.

##### 4.9

THE Serviço_de_Reservas SHALL atribuir `CONFIRMED_BY_USER` a uma Reserva se, e somente se, uma Confirmação_Informada com `source = USER_REPORTED` for registrada por formulário submetido pelo usuário, realizar zero transições para `CONFIRMED_BY_USER` originadas do Assistente_de_IA, da busca ou de provedor e rotular esse estado exclusivamente como “Confirmada por você”.

##### 4.10

WHEN um workspace Schema_v1 válido for migrado, THE Migrador_de_Workspace SHALL produzir um workspace Schema_v2 cuja Projeção_v1 seja igual ao workspace Schema_v1 normalizado, preservando registros, ordem, IDs e centavos, converter cada valor decimal em reais para Unidades_Menores de BRL por multiplicação exata por 100 e garantir que `calculateSettlements`, `materializeRecurring`, `removeFinance`, `removeParticipant` e `vote` aplicados à Projeção_v1 produzam os mesmos resultados obtidos antes da migração.

##### 4.11

THE Migrador_de_Workspace SHALL produzir resultado idêntico ao migrar novamente um workspace já migrado e ao normalizar novamente um workspace Schema_v2 já normalizado.

##### 4.12

WHEN um backup for importado, THE PlannerDuo SHALL processar backups Schema_v1 e Schema_v2 válidos pela mesma migração verificada do Migrador_de_Workspace e rejeitar com `local/import-version`, sem alterar o estado atual, todo backup de formato desconhecido ou com `schemaVersion` ausente, não inteira, menor que 1 ou maior que 2.

##### 4.13

WHEN a migração para o Schema_v2 ou um commit Schema_v2 for solicitado, THE Kernel_de_Segurança SHALL preservar `format`, `version` e os parâmetros de KDF e de cifra do envelope, alterar somente ciphertext, IV, sequence e `updatedAt`, verificar o round-trip de decriptação antes de declarar sucesso, manter o envelope anterior autoritativo com `local/migration-verification-failed` diante de divergência, gravar zero dados com `local/migration-write-paused` sem permissão de escrita ou em `READ_ONLY` e manter `settings.assistant.enabled` igual a falso após a migração.

##### 4.14

WHEN um workspace Schema_v2 for normalizado, THE Migrador_de_Workspace SHALL manter cada referência a Viagem, Cotação, Reserva, hospedagem, Despesa, Parcelamento ou participante resolvida para entidade existente ou anulada com preservação do registro, realizar zero exclusões em cascata, descartar somente o Parcelamento cujo `financeId` não resolva para Despesa existente e, no import estrito, rejeitar esse caso com `local/import-lossy` sem alterar o estado atual.

##### 4.15

WHEN o relatório de uma Viagem for gerado, THE Serviço_de_Relatórios SHALL produzir totais por categoria, por moeda de origem convertida para a Moeda_de_Referência, por pagador e por mês cuja soma em cada agrupamento seja exatamente igual ao total da razão da Viagem em Unidades_Menores.

##### 4.16

THE PlannerDuo SHALL manter localizadores de Confirmação_Informada e endereços de hospedagem fora de Alertas, diagnósticos, logs, contexto enviado ao Assistente_de_IA e resumo exportado, incluindo esses campos no resumo exportado somente após escolha explícita do usuário para aquele resumo.

### Requirement 5: Assistente de IA real via proxy local

**User Story:** Como viajante, quero um assistente de IA opcional, com a minha própria chave e acessado por um proxy local, que prepare sugestões revisáveis sobre cotações, remarcações, hospedagens, finanças e roteiro, para que eu receba ajuda real sem expor segredos, sem custo descontrolado e sem nenhuma alteração nos meus dados sem confirmação.

#### Acceptance Criteria

##### 5.1

THE Assistente_de_IA SHALL iniciar todo workspace novo ou migrado com `settings.assistant.enabled` igual a falso, enviar zero requisições `chat` antes do aceite do diálogo “Ativar assistente com {provedor}”, que exibe provedor, host, modelo, dados enviados e nunca enviados por Agente_Temático, necessidade de internet para modelo remoto, cobrança na chave do usuário e forma de desligar, enviar zero requisições ao Proxy_Local antes de o usuário abrir o painel do assistente ou esse diálogo e limitar a rede do navegador, com o Assistente_de_IA desligado, a navegações iniciadas pelo usuário.

##### 5.2

THE PlannerDuo SHALL servir `app.html` com Content Security Policy de meta e de header cuja única diferença em relação à política vigente seja `connect-src 'self'` no lugar de `connect-src 'none'`, preservando todas as demais diretivas, inclusive `frame-ancestors 'none'` no header, manter `connect-src 'none'` em `index.html` e `auth.html` e restringir `fetch` no navegador a `public/modules/assistant/assistant-client.js` com o path relativo `/api/assistant`, com zero usos de `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `importScripts` ou `import()` remoto em `public/**`.

##### 5.3

IF uma requisição a `/api/assistant` tiver Host diferente de `localhost`, `127.0.0.1` ou `[::1]` com a porta vinculada, Origin ausente ou diferente de `http://` seguido do Host aceito, `Sec-Fetch-Site` presente e diferente de `same-origin`, header `X-PlannerDuo-Assistant` diferente de `1` ou `Content-Type` diferente de `application/json`, THEN THE Proxy_Local SHALL rejeitar a requisição com HTTP 415 para `Content-Type` inválido ou HTTP 403 `assistant/forbidden` nos demais casos e realizar zero chamadas upstream.

##### 5.4

THE Proxy_Local SHALL registrar a rota `/api/assistant` somente quando o servidor escutar em endereço loopback, responder HTTP 405 a `OPTIONS`, `GET` e todo método diferente de `POST` e emitir zero headers `Access-Control-*` e zero cookies em todas as respostas da rota.

##### 5.5

WHEN o Proxy_Local receber uma requisição `POST` em `/api/assistant`, THE Proxy_Local SHALL rejeitar corpo acima de 64 KiB com HTTP 413 `assistant/request-too-large`, com ou sem `Content-Length`, rejeitar com HTTP 400 `assistant/request-invalid` JSON inválido, chaves `__proto__`, `constructor` ou `prototype`, campos desconhecidos e limites de schema excedidos, abortar resposta upstream acima de 256 KiB ou além do timeout configurado entre 5.000 e 60.000 ms e definir `max_tokens` exclusivamente no servidor com valor menor ou igual ao teto configurado entre 64 e 4.096.

##### 5.6

WHEN o Proxy_Local iniciar, THE Proxy_Local SHALL ativar o Assistente_de_IA somente com base URL `https:` de hostname exatamente igual a `api.openai.com` para `openai-compatible` ou a `api.anthropic.com` para `anthropic`, path fixo do Adapter_de_Provedor e zero credenciais, query, fragmento, porta customizada, IP literal, wildcard ou sufixo, ou, com `PLANNERDUO_AI_ALLOW_LOCAL_MODEL=1`, com base URL `http:` de hostname `127.0.0.1`, `::1` ou `localhost` e porta explícita diferente da porta do servidor, manter o Assistente_de_IA desativado quando `NODE_TLS_REJECT_UNAUTHORIZED=0` estiver definido, enviar toda chamada upstream ao host exato validado com `redirect: "error"` e derivar URL, host, path, modelo e headers upstream exclusivamente da configuração do servidor.

##### 5.7

THE Proxy_Local SHALL ler a chave de API somente de variável de ambiente ou de `.env.local` na raiz do repositório, fora de `public/` e ignorado pelo Git, e manter zero ocorrências da chave em corpos e headers de resposta ao navegador, logs, arquivos de `public/**`, workspace, backups e arquivos versionados, inclusive em todos os caminhos de erro.

##### 5.8

WHEN um contexto for construído para uma requisição `chat`, THE Construtor_de_Contexto SHALL emitir somente campos da allowlist do Agente_Temático selecionado, com no máximo 50 itens por lista e 16 KiB serializados, emitir zero valores de senha, material de chave, envelope, marcadores de sessão, e-mail ou nome da conta, localizadores, endereços de hospedagem, identificadores diagnósticos, nomes reais de participantes e IDs internos, incluir notas livres somente com opt-in explícito na mensagem e truncadas a 1.000 caracteres por item e bloquear o envio com `assistant/context-blocked` quando a verificação final detectar valor proibido.

##### 5.9

WHEN uma mensagem for enviada ao Proxy_Local, THE Assistente_de_IA SHALL serializar a requisição `chat` uma única vez em JSON canônico, exibir essa string e a versão das instruções fixas na Prévia_do_Envio, usar bytes idênticos a essa string como corpo da requisição e gerar nova Prévia_do_Envio sempre que qualquer opção mudar antes do envio.

##### 5.10

THE Construtor_de_Contexto SHALL substituir cada nome real de participante por pseudônimo estável durante a conversa, na forma “Participante A”, “Participante B” e seguintes, substituir IDs de entidades por referências locais como `T1`, `Q2` e `S3` e manter o mapa de reversão exclusivamente em memória, com zero gravações em storage, workspace, backup ou diagnóstico.

##### 5.11

WHEN uma resposta do modelo for recebida, THE Executor_de_Propostas SHALL manter o workspace inalterado até um evento com `isTrusted` verdadeiro no botão “Aplicar sugestão” do próprio Card_de_Proposta, executar cada `proposalId` no máximo uma vez, desabilitar os botões do Card_de_Proposta no estado `APPLYING`, expirar a Proposta 15 minutos após a criação e oferecer zero ações de aplicação em lote.

##### 5.12

THE Validador_de_Propostas SHALL aceitar somente Propostas das ferramentas `trip.create`, `trip.update`, `quote.create`, `quote.compare`, `expense.create`, `reissue.simulate`, `reminder.create`, `checklist.create` e `search.link` permitidas ao Agente_Temático, com no máximo 5 Propostas por resposta, argumentos de até 4 KiB, zero campos extras, valores dentro das faixas do schema e referências locais da conversa corrente, rejeitar as demais com `assistant/tool-not-allowed` ou `assistant/proposal-invalid` e zero efeitos e manter zero ferramentas capazes de excluir, arquivar, exportar, importar ou restaurar dados, alterar conta, sessão, segurança, Consentimento, participantes, Taxas_de_Câmbio_Manuais ou Regras_de_Taxa, abrir URL ou contatar provedor.

##### 5.13

WHEN uma Proposta válida for aplicada, THE Executor_de_Propostas SHALL produzir o mesmo workspace que a ação manual equivalente com as mesmas entradas, pelas mesmas validações do core e pelo mesmo `WorkspaceRepository.update`, recomputar localmente todo total sugerido pelo modelo com aviso de divergência e mover a Proposta para `CONFLICT`, com zero gravações, quando o fingerprint do alvo ou a generation divergir.

##### 5.14

WHEN a saída do modelo contiver uma URL, THE Renderizador_Seguro_de_Mensagens SHALL criar link somente para URL `https://` aceita pelo Gate_de_Provedor_Confiável, exibir o host real como texto do link, abrir o link somente após clique com `noopener`, `noreferrer` e `referrerpolicy="no-referrer"`, exibir a sintaxe `[texto](url)` como “texto (url)”, renderizar toda outra URL como texto inerte e realizar zero navegações, prefetches ou carregamentos de imagem sem clique do usuário.

##### 5.15

THE Renderizador_Seguro_de_Mensagens SHALL construir o DOM de toda saída do modelo somente com `createElement` e `textContent`, limitado aos elementos `p`, `br`, `strong`, `em`, `code`, `ul`, `ol`, `li` e `a` aprovado e aos atributos `href`, `rel`, `target`, `referrerpolicy` e classes de lista fixa, exibir HTML bruto como texto literal, substituir imagem markdown por “[imagem omitida]”, truncar com aviso respostas acima de 8.000 caracteres ou 200 linhas e produzir zero handlers de evento, URLs `javascript:` ou `data:` e scripts executados.

##### 5.16

THE Assistente_de_IA SHALL manter conversas e Cards_de_Proposta somente na memória da aba, com zero gravações em `localStorage`, `sessionStorage`, IndexedDB, workspace, backup ou diagnóstico, e apagar conversas e Cards_de_Proposta em bloqueio, saída, auto-lock por inatividade, expiração da sessão de 8 h, desligamento do assistente, mudança de Consentimento e fechamento da página.

##### 5.17

IF o Proxy_Local estiver ausente, a aplicação estiver offline ou em hospedagem estática, ou `/api/assistant` responder 404, 405, sem `application/json` ou fora do schema, THEN THE PlannerDuo SHALL exibir “Assistente indisponível” com o código `assistant/unavailable`, preservar o texto digitado e produzir, em todas as funcionalidades fora do Assistente_de_IA, o mesmo DOM e o mesmo workspace obtidos com o Assistente_de_IA disponível e ocioso.

##### 5.18

THE Proxy_Local SHALL limitar as requisições `chat` ao teto por minuto configurado entre 1 e 30, com padrão 10, a 1 requisição em voo e aos tetos diários de requisições entre 1 e 10.000, com padrão 100, e de tokens entre 1.000 e 5.000.000, com padrão 200.000, reiniciados à meia-noite local, limitar `max_tokens` por requisição ao teto configurado, responder HTTP 429 com `assistant/local-rate-limited`, `assistant/busy` ou `assistant/daily-cap-reached` e `Retry-After` quando aplicável e realizar zero chamadas upstream acima de qualquer teto.

##### 5.19

IF o upstream responder 401, 403, 404, 408, 413, 429 ou 5xx, exceder o timeout, falhar por DNS, TLS ou conexão, responder com redirect ou devolver JSON inválido ou acima de 256 KiB, THEN THE Proxy_Local SHALL mapear o resultado para exatamente um código allowlisted, sendo `assistant/provider-auth` para 401 e 403, `assistant/model-unavailable` para 404, `assistant/request-too-large` para 413, `assistant/provider-rate-limited` para 429, `assistant/timeout` para 408, 504 e timeout, `assistant/provider-unavailable` para os demais 5xx, `assistant/network` para DNS, TLS ou conexão, `assistant/provider-redirect-blocked` para redirect e `assistant/provider-response-invalid` para JSON inválido ou acima de 256 KiB, e repassar zero bytes do corpo upstream ao navegador.

##### 5.20

THE Proxy_Local SHALL registrar em log somente os campos `timestamp`, `requestId`, `op`, `agent`, `adapterId`, `outcomeCode`, `httpStatus`, `durationBucket`, `requestBytesBucket`, `inputTokens`, `outputTokens` e `proposalCount` e zero trechos de mensagem, contexto, Proposta, resposta upstream, chave, headers ou Host e Origin brutos.

##### 5.21

IF adapter, host ou modelo informados pelo status do Proxy_Local divergirem do Consentimento registrado, THEN THE Assistente_de_IA SHALL pausar o assistente com `assistant/consent-mismatch`, enviar zero requisições `chat` até novo aceite explícito e rejeitar no Proxy_Local, com HTTP 409, toda requisição `chat` cujo campo `consent` divirja da configuração vigente.

##### 5.22

THE Suíte_de_Qualidade SHALL direcionar toda chamada upstream dos testes automatizados ao Upstream_Falso por `fetchImpl` injetado, falhar o teste em qualquer tentativa de conexão a host não loopback e realizar zero contatos com provedores reais de IA.

## Design Traceability

| Correctness property em `design.md` | Critérios validados | Cobertura |
|---|---|---|
| Property 1 — Agent System Properties | Requirements 1.1–1.14 | Itens 1–12 cobrem 1.1–1.10: DAG, registry, despacho central, Skills, Capacidades, contratos e evidências enumerados, Compatibilidade_Total_de_Contratos, ancestralidade e descendência de Path, ownership, menor privilégio, limites, gates independentes sobre a saída exata, handoffs, evidências e conflito resolvido por exatamente uma alternativa. Itens 13–16 correspondem 1:1 a 1.11–1.14: roster e catálogo fechados, separação de autores de produção, gatilhos por domínio e independência adversarial |
| Property 2 — PlannerDuo Properties | Requirements 2.1–2.20 | Produto travel-first, busca de passagens, planejamento, dados vinculados e sem vínculo, terminologia, legibilidade, censo fechado de 26 provedores, evidência oficial vigente, domínios canônicos exatos, assets oficiais locais, proveniência e licença, sanitização, integridade dos bytes servidos, isolamento de requests, fidelidade e acessibilidade dos cartões, recuperação do acesso, negociação de capacidades, concorrência, compatibilidade, segurança, migração, backup, modularização e testes em zoom de 100% e 200%. As emendas dos itens 14, 38 e 45 estão em 2.18 (exceção deliberada do Schema_v2) e 2.6 (contato explícito restrito ao fluxo de busca e CSP por página) |
| Property 3 — Advanced Front-end Properties | Requirements 3.1–3.10 | Item N ↔ 3.N: KPIs do Painel, Jornada_da_Viagem, Linha_do_Tempo, Central_de_Alertas, Paleta_de_Comandos, contraste dos temas, movimento reduzido, design system local, representações equivalentes e pisos dos Componentes_Avançados |
| Property 4 — Travel Operations and Trip Finance Properties | Requirements 4.1–4.16 | Item N ↔ 4.N: dinheiro inteiro, câmbio consistente, taxas configuráveis, conservação dos Acertos, soma das parcelas, ausência de dupla contagem, custo de remarcação, ordenação determinística de Cotações, honestidade da Reserva, migração sem perda com Projeção_v1, idempotência, import versionado, invariância do envelope, integridade referencial do Schema_v2, reconciliação de relatórios e isolamento de campos sensíveis |
| Property 5 — AI Assistant Properties | Requirements 5.1–5.22 | Item N ↔ 5.N: desligado por padrão, egress único do navegador, allowlist de Host e Origin, ausência de CORS, troca limitada, upstream anti-SSRF, confinamento da chave, payload sem segredos, fidelidade da Prévia_do_Envio, Pseudonimização, confirmação humana, allowlist de ferramentas, equivalência com a ação manual, restrição de links, renderização inerte, conversas efêmeras, degradação sem proxy, tetos de custo, mapeamento total de erros, logs redigidos, vínculo do Consentimento e zero chamadas reais em testes |

### Rastreabilidade do feedback de marcas e provedores

| Critérios preservados | Obrigação rastreável incorporada |
|---|---|
| 2.4 | Lista inicial fechada de exatamente 10 provedores em `flights`, 8 em `stays`, 6 em `ground` e 2 em `cars`; evidência oficial separada de nome, domínio e página; data não futura de até 365 dias; domínio por igualdade exata; origem oficial prioritária; Simple Icons somente após evidência datada de indisponibilidade; hash SHA-256 de 64 hex igual aos bytes servidos. |
| 2.5 | Rejeição atômica de entrada, grupo, provedor, domínio, data, evidência, fallback ou integridade inválidos; foco determinístico; Wordmark_Oficial como única alternativa; bloqueio do provedor sem template, desenho, monograma, letra, emoji ou marca fabricada. |
| 2.6 | Assets locais com bytes correspondentes ao hash e zero Hotlink, CDN ou request externo de asset; contato com provedor somente após ativação explícita. |
| 2.9 | Proporção intrínseca com tolerância máxima de 1%, espaço interno de 4 CSS px, cores sem recolor/filter/opacity, área visual, fundo, nome textual e semântica acessível dos cartões. |
| 2.19 | Download HTTPS apenas em desenvolvimento e com prioridade oficial, fallback condicionado, sanitização, versionamento, hash, SVG de 1–262.144 bytes estritamente passivo e Asset_Raster PNG/WEBP/JPEG dentro dos limites de bytes, dimensões e pixels. |
| 2.20 | Evidência dos 26 assets e domínios, mutação de um byte rejeitada pelo hash, testes de segurança/runtime/acessibilidade em zoom 100%/200% e aprovação independente e explícita de `security-analyst` e `documentation-release`. |

### Rastreabilidade do feedback de plataforma avançada, IA real e finanças

| Pedido do usuário | Obrigação rastreável incorporada | Critérios |
|---|---|---|
| Espelhar-se na Plataforma Blis.AI | Referência conceitual de agentes temáticos que preparam tarefas, jornada contínua, cotações, pós-venda e canal conversacional, adaptada ao viajante pessoal, sem marca, copy, cores, layout ou trade dress da Blis.AI. | Introduction, 3.1–3.5, 4.7–4.9, 5.11–5.13 |
| Front avançado e funcional | Painel, Jornada_da_Viagem, Linha_do_Tempo, Central_de_Alertas, Paleta_de_Comandos `Ctrl+K`, Comparação_de_Cotações e design system local nos temas claro e escuro. | 3.1–3.10 |
| Sistema de finanças e viagens avançadas | Cotações, Reservas com Confirmação_Informada, Pós-venda, multimoeda com câmbio manual, Regras_de_Taxa, Parcelamentos, Acertos, Previsão_de_Caixa, relatórios e migração para o Schema_v2. | 4.1–4.16 |
| Organizar as skills | 10 Agentes e 21 Skills em Viagens, Finanças, IA e Plataforma, autores de produção separados, gatilhos por domínio e independência adversarial. | Glossary, 1.2, 1.11–1.14 |
| IA real via API externa (BYOK, proxy local) | Exceção de rede restrita ao Proxy_Local em loopback, CSP por página, Consentimento, Prévia_do_Envio, minimização, Pseudonimização e confirmação humana, com o app integralmente funcional sem o assistente. | 2.6, 5.1–5.22 |
| Seguir para os próximos passos | Remoção das proibições de implementação, de `tasks.md` e de alteração de schema; schema alterado somente pela migração versionada do Schema_v1 para o Schema_v2. | Status, Introduction, 2.18, Slice_de_Implementação |

Os IDs 1.1–1.10 e 2.1–2.20 permanecem inalterados; 1.11–1.14 e os Requirements 3, 4 e 5 são acréscimos desta revisão, e 1.2, 2.6 e 2.18 receberam emendas de coerência com o design revisado. Property 1 é o destino de rastreabilidade de 1.1–1.14, Property 2 de 2.1–2.20, e as Properties 3, 4 e 5 correspondem item a item a 3.1–3.10, 4.1–4.16 e 5.1–5.22. `design.md` não foi alterado nesta fase de requisitos.
