# Requirements Document

## Introduction

Este documento define os requisitos para o rebranding e a reorientação arquitetural do PlannerDuo na variante UAT. A iniciativa tem dois eixos complementares:

1. **Reorientação arquitetural (conectado):** transformar o PlannerDuo de uma aplicação estritamente offline ("100% local, sem servidor") em uma aplicação verdadeiramente conectada, com back-end Node.js + Express, API REST, camada de persistência remota (SQLite ou JSON em arquivo), autenticação por usuário/e-mail de rede com sessão de servidor, migração única dos dados existentes do navegador para a API e aposentadoria completa do cofre local (PBKDF2/AES-GCM e fluxo de senha de cofre).

2. **Rebranding visual e narrativo:** aplicar um novo tema azul + laranja, substituir toda a narrativa de isolamento local por uma narrativa de ambiente conectado e online, preservando rotas, serviços de IA, módulos da barra lateral e a persistência de dados sem quebrar o estado global ou o cache de inicialização durante a transição.

3. **Migração de identidade (Git/ambiente):** reescrever a identidade do repositório e dos ambientes, removendo todas as referências às identidades antigas (Tiago-Nocce e PlannerDuo1.0) e adotando as novas identidades de ambiente (PRD = Tiago-NoccePRD, UAT = PlannerDuoUAT), com os caminhos correspondentes em `/Dev`.

### Premissa arquitetural (tensão documentada)

A spec existente `multi-agent-code-architecture` exige explicitamente uma operação offline sem servidor e proíbe a terminologia de cofre ("vault") na interface. A nova direção conectada **supersede intencionalmente** a premissa offline daquela spec. Esta decisão é registrada como premissa (ver Requisito 9) para que a contradição seja conhecida e deliberada, não acidental.

## Glossary

- **PlannerDuo**: aplicação web de planejamento de finanças, viagens, metas, checklists e decisões, objeto deste rebranding.
- **API_PlannerDuo**: serviço de back-end Node.js + Express que expõe a API REST, a autenticação de sessão e a persistência remota.
- **Camada_de_Persistencia**: componente da API_PlannerDuo responsável por armazenar e recuperar dados de forma remota, implementado sobre SQLite ou arquivo JSON.
- **Autenticacao_de_Rede**: mecanismo de autenticação por usuário/e-mail com sessão de servidor, que substitui o fluxo de senha de cofre local.
- **Sessao_de_Servidor**: sessão autenticada mantida pela API_PlannerDuo, associada a um usuário de rede.
- **Cofre_Local**: mecanismo legado de criptografia local (PBKDF2-SHA-256 + AES-GCM 256 bits) e fluxo de senha de cofre, a ser aposentado.
- **Migracao_de_Dados**: processo único que transfere os dados existentes no navegador para a Camada_de_Persistencia via API_PlannerDuo.
- **Front_End**: aplicação cliente em JavaScript vanilla servida a partir de `public/` (index.html, auth.html, app.html, app.js, core.js, auth.js, local.js, travel.js, style.css e módulos em `modules/`).
- **Tema_Visual**: conjunto de tokens de cor, tipografia, raio de borda, sombras e brilhos que definem a identidade visual azul + laranja.
- **Barra_Lateral**: região de navegação principal da aplicação autenticada (`app.html`), que contém a identidade do ambiente e os módulos de navegação.
- **Narrativa_de_Isolamento**: conjunto de textos e rótulos que comunicam operação exclusivamente local ("Espaço Local", "Workspace Local", "100% LOCAL · SEM SERVIDOR", "Tudo no seu navegador", "Cofre", "Modo Isolado", aviso de não recuperação por e-mail, "E-mail local").
- **Identidade_de_Ambiente**: nome e metadados que identificam o ambiente de execução; PRD corresponde a `Tiago-NoccePRD` e UAT corresponde a `PlannerDuoUAT`.
- **Configuracao_Git**: arquivo `.git/config` do repositório, contendo origem remota e dados de usuário.
- **Estado_Global**: estado em memória compartilhado pelo Front_End durante a execução, incluindo o cache de inicialização.

## Requirements

### Requirement 1: Back-end conectado e API REST

**User Story:** Como pessoa usuária do PlannerDuo, quero que a aplicação se conecte a um back-end real, para que meus dados fiquem persistidos remotamente e acessíveis além de um único navegador.

#### Acceptance Criteria

1. THE API_PlannerDuo SHALL expor uma API REST sobre Node.js + Express que ofereça as operações de criação, leitura, atualização e exclusão para cada um dos domínios finanças, viagens, metas, checklists e decisões.
2. THE API_PlannerDuo SHALL persistir os dados por meio da Camada_de_Persistencia implementada sobre SQLite ou arquivo JSON, de modo que os dados gravados permaneçam disponíveis após o reinício do processo da API_PlannerDuo.
3. WHEN o Front_End realiza uma operação de criação, atualização ou exclusão associada a uma Sessao_de_Servidor válida, THE API_PlannerDuo SHALL registrar o resultado na Camada_de_Persistencia e retornar o estado resultante em até 2 segundos.
4. WHEN o Front_End realiza uma operação de leitura associada a uma Sessao_de_Servidor válida, THE API_PlannerDuo SHALL retornar os dados solicitados a partir da Camada_de_Persistencia em até 2 segundos.
5. IF uma operação de dados falhar na Camada_de_Persistencia, THEN THE API_PlannerDuo SHALL retornar uma indicação de erro, preservar o estado anterior inalterado e não retornar uma indicação de sucesso.
6. WHERE a Autenticacao_de_Rede estiver ativa, THE API_PlannerDuo SHALL associar cada operação de dados a uma Sessao_de_Servidor válida antes de executar a operação.
7. IF o Front_End envia uma requisição a um recurso protegido sem uma Sessao_de_Servidor válida ou com uma Sessao_de_Servidor expirada, THEN THE API_PlannerDuo SHALL responder com um código de erro de autenticação e não retornar dados do usuário.

### Requirement 2: Autenticação de rede e sessão de servidor

**User Story:** Como pessoa usuária, quero autenticar com usuário/e-mail de rede e uma sessão de servidor, para que o acesso aos meus dados seja controlado pelo back-end em vez de uma senha de cofre local.

#### Acceptance Criteria

1. WHEN a pessoa usuária submete um identificador de usuário/e-mail de rede com 1 a 254 caracteres e uma credencial com 8 a 128 caracteres, THE API_PlannerDuo SHALL validar as credenciais e retornar o resultado da validação em até 5 segundos.
2. WHEN as credenciais de rede forem validadas com sucesso, THE API_PlannerDuo SHALL estabelecer uma Sessao_de_Servidor para a pessoa usuária com validade de 60 minutos a partir do último acesso.
3. IF as credenciais de rede forem inválidas, THEN THE API_PlannerDuo SHALL recusar o acesso, retornar uma mensagem de falha de autenticação e preservar o estado dos dados remotos inalterado.
4. IF a pessoa usuária acumular 5 tentativas consecutivas de autenticação inválidas, THEN THE API_PlannerDuo SHALL bloquear novas tentativas para esse identificador durante 15 minutos.
5. WHEN a pessoa usuária solicita encerrar a sessão, THE API_PlannerDuo SHALL invalidar a Sessao_de_Servidor correspondente em até 5 segundos.
6. WHILE uma Sessao_de_Servidor estiver ativa e não expirada, THE Front_End SHALL acessar os dados remotos sem solicitar a senha de cofre local.
7. IF a pessoa usuária tentar acessar dados remotos com uma Sessao_de_Servidor expirada ou invalidada, THEN THE Front_End SHALL exigir nova Autenticacao_de_Rede antes de conceder acesso.

### Requirement 3: Aposentadoria do cofre local

**User Story:** Como responsável pelo PlannerDuo, quero aposentar completamente o cofre local, para que a aplicação dependa apenas da autenticação de rede e da persistência remota.

#### Acceptance Criteria

1. WHEN o usuário inicia o processo de autenticação, THE Front_End SHALL executar exclusivamente o fluxo de Autenticacao_de_Rede, sem apresentar nenhum campo, prompt ou etapa de senha de cofre local.
2. THE Front_End SHALL remover a derivação de chave PBKDF2-SHA-256 e a criptografia AES-GCM do Cofre_Local, de modo que nenhum caminho de código executável invoque essas rotinas durante a autenticação ou a persistência de dados.
3. WHEN o usuário solicita acesso à aplicação, THE Front_End SHALL substituir os fluxos anteriores de desbloqueio, criação e recuperação destrutiva do Cofre_Local pelo fluxo de Autenticacao_de_Rede, resultando em um único caminho de autenticação ativo.
4. IF a Autenticacao_de_Rede falhar, THEN THE Front_End SHALL negar o acesso, exibir uma indicação de erro informando que a autenticação não foi concluída e preservar o estado anterior sem criar, desbloquear ou recuperar qualquer Cofre_Local.
5. WHERE existir código remanescente do Cofre_Local após a transição, THE Front_End SHALL mantê-lo inativo no caminho de autenticação em produção, garantindo que nenhuma entrada do usuário ou evento de autenticação acione sua execução.

### Requirement 4: Migração única de dados do navegador

**User Story:** Como pessoa usuária com dados já salvos no navegador, quero que meus dados existentes sejam migrados para a API, para que eu não perca finanças, viagens, metas, checklists e decisões ao migrar para o modo conectado.

#### Acceptance Criteria

1. WHEN a pessoa usuária acessa a aplicação pela primeira vez após a transição e existem dados locais, THE Migracao_de_Dados SHALL transferir os dados existentes do navegador das categorias finanças, viagens, metas, checklists e decisões para a Camada_de_Persistencia via API_PlannerDuo em uma única execução.
2. WHILE a Migracao_de_Dados estiver em andamento, THE Front_End SHALL exibir uma indicação de progresso e impedir a execução concorrente ou duplicada de outra Migracao_de_Dados.
3. WHEN todos os registros das categorias finanças, viagens, metas, checklists e decisões forem transferidos para a Camada_de_Persistencia em até 30 segundos, THE Migracao_de_Dados SHALL registrar um marcador de conclusão na Camada_de_Persistencia.
4. WHEN a Migracao_de_Dados conclui com sucesso, THE Front_End SHALL passar a ler e gravar os dados por meio da API_PlannerDuo.
5. IF a Migracao_de_Dados falhar de forma parcial ou exceder 30 segundos, THEN THE Front_End SHALL preservar os dados locais existentes, reverter as gravações parciais na Camada_de_Persistencia, não registrar o marcador de conclusão e exibir uma indicação de erro.
6. WHERE o marcador de conclusão da Migracao_de_Dados existir para a pessoa usuária, THE Front_End SHALL omitir a repetição da transferência em acessos seguintes.

### Requirement 5: Política de segurança de conteúdo para rede real

**User Story:** Como responsável pela infraestrutura, quero afrouxar a política de segurança de conteúdo para permitir rede real, para que o Front_End possa comunicar-se com a API_PlannerDuo.

#### Acceptance Criteria

1. WHEN uma página do Front_End for carregada, THE Front_End SHALL aplicar um cabeçalho de política de segurança de conteúdo (CSP) cuja diretiva `connect-src` inclua o esquema e a autoridade (esquema, host e porta) do endpoint da API_PlannerDuo, permitindo requisições de rede para esse endpoint.
2. WHEN o Front_End emitir uma requisição de rede para uma origem não listada na diretiva `connect-src`, THE Front_End SHALL bloquear a requisição e registrar uma violação de CSP indicando a origem bloqueada.
3. WHEN a API_PlannerDuo servir qualquer página do Front_End, THE API_PlannerDuo SHALL incluir na resposta o cabeçalho de CSP com a diretiva `connect-src` contendo a origem da própria API_PlannerDuo.
4. WHERE a CSP for aplicada, THE Front_End SHALL restringir as diretivas `script-src`, `object-src` e `base-uri` de modo que `object-src` não permita nenhuma origem (`'none'`) e `script-src` e `base-uri` permitam exclusivamente a própria origem do Front_End (`'self'`) e as origens explicitamente listadas na CSP.
5. IF o cabeçalho de CSP estiver ausente ou não contiver a origem da API_PlannerDuo na diretiva `connect-src` ao servir uma página, THEN THE API_PlannerDuo SHALL recusar o atendimento da página e retornar uma resposta de erro indicando configuração de CSP inválida, sem servir conteúdo com política incompleta.

### Requirement 6: Identidade visual azul + laranja

**User Story:** Como pessoa usuária, quero ver uma identidade visual azul + laranja consistente, para que a aplicação reflita a nova marca do PlannerDuo.

#### Acceptance Criteria

1. THE Tema_Visual SHALL definir a cor primária como um valor hexadecimal no intervalo fechado de `#0066FF` a `#2563EB`.
2. THE Tema_Visual SHALL definir a cor de destaque como um valor hexadecimal no intervalo fechado de `#FF7700` a `#FF8C00`.
3. THE Tema_Visual SHALL definir o fundo base como um valor hexadecimal no intervalo fechado de `#0B0F19` a `#0F172A`.
4. THE Tema_Visual SHALL aplicar a tipografia Inter, em estilo arredondado, a todos os elementos de texto do Front_End.
5. THE Tema_Visual SHALL aplicar aos componentes de superfície um raio de borda no intervalo fechado de 12 a 16 pixels.
6. THE Tema_Visual SHALL aplicar sombras suaves e brilhos cujas cores correspondam à cor primária definida no critério 1 e à cor de destaque definida no critério 2.
7. THE Front_End SHALL exibir o botão de envio do chat com gradiente da cor de destaque (critério 2) para a cor primária (critério 1).
8. THE Front_End SHALL exibir o logo PlannerDuo como ícone com gradiente que combina a cor primária (critério 1) e a cor de destaque (critério 2).
9. THE Front_End SHALL exibir os chips de sugestão rápida com contornos em gradiente combinando a cor primária (critério 1) e a cor de destaque (critério 2).
10. WHILE o ponteiro estiver sobre um chip de sugestão rápida, THE Front_End SHALL apresentar um estado de hover com feedback visual interativo nesse chip.
11. IF a tipografia Inter não puder ser carregada, THEN THE Front_End SHALL aplicar uma fonte de fallback aos elementos de texto.

### Requirement 7: Narrativa de ambiente conectado

**User Story:** Como pessoa usuária, quero que a interface comunique um ambiente conectado em vez de isolamento local, para que a narrativa corresponda ao modo conectado da aplicação.

#### Acceptance Criteria

1. THE Front_End SHALL garantir que nenhuma das páginas da aplicação exiba os termos da Narrativa_de_Isolamento, definidos como o conjunto exato: "Espaço Local", "Workspace Local", "100% LOCAL · SEM SERVIDOR", "Tudo no seu navegador", "Cofre", "Modo Isolado" e "E-mail local".
2. WHEN qualquer tela de autenticação é renderizada, THE Front_End SHALL assegurar que nenhum texto informando ausência de recuperação de conta por e-mail esteja presente na tela.
3. WHEN a Barra_Lateral é renderizada, THE Barra_Lateral SHALL exibir no topo, de forma simultânea, o rótulo "Ambiente conectado", a tag "Tiago-NoccePRD" e o indicador de status com o texto "Online".
4. WHEN a Barra_Lateral é renderizada, THE Barra_Lateral SHALL exibir exatamente os 7 módulos a seguir, na ordem indicada: Assistente, Visão geral, Finanças, Viagens, Metas, Checklist e Decisões.
5. WHEN a Barra_Lateral é renderizada, THE Barra_Lateral SHALL exibir cada um dos 7 módulos com um ícone associado e com indicador de notificação na cor laranja.
6. IF um módulo não possuir notificações pendentes (contagem igual a 0), THEN THE Barra_Lateral SHALL ocultar o indicador de notificação laranja desse módulo.

### Requirement 8: Preservação de rotas, serviços de IA e estado

**User Story:** Como pessoa usuária existente, quero que rotas, serviços de IA e dados continuem funcionando durante a transição, para que o rebranding não interrompa o uso da aplicação.

#### Acceptance Criteria

1. WHEN uma rota existente antes da transição é acessada durante ou após a transição, THE Front_End SHALL resolver essa rota para o mesmo destino funcional que resolvia antes da transição, sem introduzir falhas de navegação (ex.: rota não encontrada) para o conjunto de rotas existentes.
2. WHEN uma requisição é enviada a um serviço de IA existente durante ou após a transição, THE Front_End SHALL manter o mesmo contrato de requisição e resposta e o mesmo comportamento observável que apresentava antes da transição.
3. WHILE a transição estiver em andamento, THE Front_End SHALL preservar o Estado_Global e o cache de inicialização de forma que uma leitura subsequente retorne os mesmos dados gravados antes da transição, sem alteração de conteúdo nem perda de registros.
4. WHEN a aplicação é reinicializada após a transição, THE Front_End SHALL recuperar o Estado_Global de forma que seu conteúdo seja idêntico ao último estado confirmado na persistência remota.
5. IF uma rota existente antes da transição não puder ser resolvida durante ou após a transição, THEN THE Front_End SHALL apresentar uma indicação de erro informando a falha de navegação e preservar o Estado_Global sem alterá-lo.
6. IF a recuperação do Estado_Global após a transição divergir do último estado confirmado na persistência remota ou detectar corrupção do cache de inicialização, THEN THE Front_End SHALL sinalizar a inconsistência e preservar os dados da persistência remota sem sobrescrevê-los com dados corrompidos.

### Requirement 9: Registro da tensão arquitetural

**User Story:** Como responsável pela arquitetura, quero registrar a tensão com a spec `multi-agent-code-architecture`, para que a mudança da premissa offline para conectada seja uma decisão documentada e rastreável.

#### Acceptance Criteria

1. THE Front_End SHALL adotar a direção conectada que supersede intencionalmente a premissa offline da spec `multi-agent-code-architecture`, registrando a decisão em um artefato de documentação versionado contendo: identificador da spec substituída, data da decisão (formato ISO 8601), premissa anterior (offline) e premissa adotada (conectada).
2. WHEN a interface for renderizada em qualquer tela ou componente visível ao usuário, THE Front_End SHALL exibir zero ocorrências dos termos "Cofre" e "vault" (comparação sem distinção entre maiúsculas e minúsculas) em textos, rótulos, títulos e mensagens.
3. WHERE houver conflito entre a premissa offline da spec `multi-agent-code-architecture` e a direção conectada desta spec, THE Front_End SHALL aplicar a direção conectada desta spec como decisão prevalecente e registrar a resolução do conflito no mesmo artefato de documentação versionado referido no critério 1.
4. IF o artefato de documentação versionado da decisão de superseção não existir ou não contiver todos os campos obrigatórios (identificador da spec substituída, data da decisão, premissa anterior e premissa adotada), THEN THE Front_End SHALL ser considerado em não conformidade com esta spec, indicando a ausência do registro rastreável.

### Requirement 10: Migração de identidade Git e de ambiente

**User Story:** Como mantenedor do repositório, quero migrar a identidade de Git e de ambiente para as novas identidades, para que as referências antigas sejam removidas e os ambientes PRD e UAT fiquem corretamente identificados.

#### Acceptance Criteria

1. WHEN o mantenedor executar a migração de identidade, THE Configuracao_Git SHALL definir a origem remota (`remote origin`), o nome de usuário (`user.name`) e o e-mail (`user.email`) correspondentes à Identidade_de_Ambiente de destino.
2. WHEN a migração de identidade for concluída, THE Configuracao_Git SHALL conter zero referências às identidades `Tiago-Nocce` e `PlannerDuo1.0` na origem remota, no `user.name` e no `user.email`.
3. IF restar qualquer referência às identidades `Tiago-Nocce` ou `PlannerDuo1.0` após a migração, THEN THE Configuracao_Git SHALL interromper a conclusão da migração e apresentar uma indicação de erro listando cada referência remanescente, preservando a configuração original sem alterações parciais.
4. THE API_PlannerDuo SHALL definir a Identidade_de_Ambiente de produção como exatamente `Tiago-NoccePRD` e a Identidade_de_Ambiente de UAT como exatamente `PlannerDuoUAT`.
5. THE repositório SHALL utilizar exatamente o caminho `Dev/PlannerDuoUAT` para o ambiente UAT e exatamente o caminho `Dev/Tiago-NoccePRD` para o ambiente de produção.
6. WHEN a migração de identidade for executada, THE repositório SHALL gerar ou ajustar os arquivos de ambiente (`.env`), de implantação e de CI/CD de modo que cada arquivo referencie exclusivamente a Identidade_de_Ambiente de destino e contenha zero referências às identidades `Tiago-Nocce` e `PlannerDuo1.0`.
