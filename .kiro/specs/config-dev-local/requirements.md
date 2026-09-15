# Requirements Document

## Introduction

Após a migração de repositório, os assets do front-end do PlannerDuo foram achatados para a raiz do projeto e depois restaurados para `public/`, que é o diretório publicado pelo Firebase Hosting conforme `firebase.json`. Como consequência, a raiz do workspace deixou de conter `index.html`, e a extensão Live Server do VS Code — que serve a raiz do workspace — passou a exibir a listagem de arquivos do repositório em vez da landing do PlannerDuo.

Esta spec cobre a configuração do ambiente de desenvolvimento local para que o app abra diretamente e se comporte como o Firebase Hosting: mesma raiz de arquivos, mesmas rotas sem extensão, mesmo fallback, sem expor arquivos internos do repositório e sobre HTTP compatível com o Firebase Auth. O escopo é exclusivamente configuração de ambiente local; nenhuma alteração de comportamento de produto, UI ou regra de negócio faz parte desta spec.

## Glossary

- **Ambiente_Dev_Local**: conjunto de configurações e ferramentas versionadas no repositório que servem o PlannerDuo em uma máquina de desenvolvimento. Abrange os dois caminhos suportados: Live_Server e Dev_Server.
- **Live_Server**: extensão `ritwickdey.LiveServer` do VS Code, configurada por `.vscode/settings.json`, que serve o projeto em `http://127.0.0.1:5500` por padrão.
- **Dev_Server**: servidor estático Node.js do repositório, em `scripts/dev-server.mjs`, executado por `npm run dev`, porta padrão 5000.
- **Diretorio_Publico**: diretório `public/`, declarado como `hosting.public` em `firebase.json`, contendo `index.html`, `auth.html`, `app.html`, `app.js`, `core.js` e `style.css`.
- **Rotas_Hosting**: conjunto de rewrites declarado em `firebase.json`, na ordem: `/app` → `/app.html`, `/auth` → `/auth.html`, `**` → `/index.html`.
- **Arquivo_Interno**: qualquer arquivo ou diretório do repositório fora do Diretorio_Publico, incluindo `package.json`, `package-lock.json`, `AUDITORIA.md`, `README.md`, `firebase.json`, `firestore.rules`, `.firebaserc`, `scripts/`, `tests/`, `node_modules/`, `.git/` e `.kiro/`.
- **Dominio_Autorizado**: host listado em Authentication → Authorized domains no console do Firebase, requisito para o fluxo `signInWithRedirect` do Firebase Auth.

## Requirements

### Requisito 1 — Abertura direta da landing

**User Story:** Como desenvolvedor do PlannerDuo, quero que o servidor local abra a landing do app na URL raiz, para começar a trabalhar sem navegar por listagens de arquivos.

#### Critérios de Aceitação

1. WHEN o Ambiente_Dev_Local recebe uma requisição para `/`, THE Ambiente_Dev_Local SHALL responder com o conteúdo de `public/index.html` e status HTTP 200.
2. WHEN o Ambiente_Dev_Local recebe uma requisição para um caminho que corresponde a um diretório, THE Ambiente_Dev_Local SHALL responder com o conteúdo de `public/index.html` em vez de uma listagem de arquivos.
3. WHEN o desenvolvedor inicia o Live_Server a partir do workspace, THE Live_Server SHALL usar o Diretorio_Publico como raiz de servimento.

### Requisito 2 — Paridade de rotas com o Firebase Hosting

**User Story:** Como desenvolvedor do PlannerDuo, quero que as rotas sem extensão resolvam localmente igual ao Firebase Hosting, para que links e navegação testados em desenvolvimento se comportem do mesmo modo em produção.

#### Critérios de Aceitação

1. WHEN o Ambiente_Dev_Local recebe uma requisição para `/app`, THE Ambiente_Dev_Local SHALL responder com o conteúdo de `public/app.html` e status HTTP 200.
2. WHEN o Ambiente_Dev_Local recebe uma requisição para `/auth`, THE Ambiente_Dev_Local SHALL responder com o conteúdo de `public/auth.html` e status HTTP 200.
3. WHEN o Ambiente_Dev_Local recebe uma requisição para um caminho que não corresponde a nenhum arquivo do Diretorio_Publico nem às rotas `/app` e `/auth`, THE Ambiente_Dev_Local SHALL responder com o conteúdo de `public/index.html`.
4. WHEN o Ambiente_Dev_Local recebe uma requisição para um arquivo existente no Diretorio_Publico, THE Ambiente_Dev_Local SHALL responder com o conteúdo desse arquivo e com o cabeçalho `Content-Type` correspondente à extensão do arquivo.
5. WHEN as Rotas_Hosting em `firebase.json` são alteradas, THE Ambiente_Dev_Local SHALL declarar as mesmas rotas em sua configuração versionada.

### Requisito 3 — Isolamento dos arquivos internos do repositório

**User Story:** Como desenvolvedor do PlannerDuo, quero que o servidor local exponha apenas o Diretorio_Publico, para que arquivos de configuração, testes e dependências não fiquem acessíveis via HTTP.

#### Critérios de Aceitação

1. WHEN o Ambiente_Dev_Local recebe uma requisição cujo caminho resolve para um Arquivo_Interno, THE Ambiente_Dev_Local SHALL responder sem o conteúdo desse arquivo, usando status HTTP 403 ou o fallback de `public/index.html`.
2. WHEN o Ambiente_Dev_Local recebe uma requisição contendo segmentos de travessia de diretório, tais como `/../package.json` ou variantes codificadas em percent-encoding, THE Ambiente_Dev_Local SHALL responder com status HTTP 403.
3. THE Ambiente_Dev_Local SHALL restringir o conjunto de arquivos servíveis ao Diretorio_Publico e a seus subdiretórios.

### Requisito 4 — Compatibilidade com o Firebase Auth

**User Story:** Como desenvolvedor do PlannerDuo, quero autenticar com Google e e-mail/senha durante o desenvolvimento, para validar os fluxos de login, cadastro e redefinição de senha antes do deploy.

#### Critérios de Aceitação

1. THE Ambiente_Dev_Local SHALL servir o PlannerDuo sobre o protocolo HTTP, sem uso de URLs `file://`.
2. THE Ambiente_Dev_Local SHALL servir o PlannerDuo em um host que conste como Dominio_Autorizado no projeto Firebase.
3. WHEN o desenvolvedor acessa `/auth` pelo Ambiente_Dev_Local e conclui o fluxo `signInWithRedirect` do Google, THE Ambiente_Dev_Local SHALL receber o redirecionamento de retorno no mesmo host e porta de origem.
4. THE documentação do repositório SHALL registrar as URLs de acesso do Live_Server e do Dev_Server e os hosts que precisam constar como Dominio_Autorizado.

### Requisito 5 — Configuração versionada e reprodutível

**User Story:** Como desenvolvedor do PlannerDuo, quero que a configuração de desenvolvimento local esteja versionada no repositório, para que um clone novo em outra máquina funcione sem ajustes manuais.

#### Critérios de Aceitação

1. THE repositório SHALL conter a configuração do Live_Server em `.vscode/settings.json`, rastreada pelo controle de versão.
2. WHEN um desenvolvedor clona o repositório e abre o workspace no VS Code, THE Ambiente_Dev_Local SHALL atender aos Requisitos 1, 2 e 3 sem edição manual de arquivos de configuração.
3. THE Ambiente_Dev_Local SHALL operar sem dependências de runtime além do Node.js e do próprio VS Code com a extensão Live_Server.
4. IF a extensão Live_Server não está instalada na máquina do desenvolvedor, THEN THE Ambiente_Dev_Local SHALL permanecer utilizável por meio do comando `npm run dev`.

### Requisito 6 — Coexistência dos dois caminhos de desenvolvimento

**User Story:** Como desenvolvedor do PlannerDuo, quero que Live_Server e `npm run dev` produzam o mesmo comportamento de roteamento, para escolher a ferramenta por conveniência e não por diferença de resultado.

#### Critérios de Aceitação

1. WHEN a mesma rota é requisitada ao Live_Server e ao Dev_Server, THE Ambiente_Dev_Local SHALL resolver essa rota para o mesmo arquivo do Diretorio_Publico em ambos os caminhos, para `/`, `/app`, `/auth`, arquivos existentes e rotas desconhecidas.
2. THE Live_Server e THE Dev_Server SHALL usar portas distintas, permitindo execução simultânea.
3. THE repositório SHALL conter uma verificação automatizada que confirme a paridade das rotas de Live_Server e Dev_Server em relação às Rotas_Hosting declaradas em `firebase.json`.
4. WHERE a documentação do repositório descreve o fluxo de desenvolvimento, THE documentação SHALL indicar Live_Server e Dev_Server como alternativas equivalentes.

### Requisito 7 — Limpeza de resíduos da migração

**User Story:** Como desenvolvedor do PlannerDuo, quero remover diretórios vazios deixados pela migração, para que a estrutura do repositório reflita apenas o que está em uso.

#### Critérios de Aceitação

1. THE repositório SHALL manter em `.kiro/` apenas diretórios que contenham arquivos rastreados pelo controle de versão.
2. WHEN a limpeza de diretórios vazios é aplicada, THE repositório SHALL preservar todos os arquivos rastreados existentes.
