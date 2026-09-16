# Bugfix Requirements Document

## Introduction

Após um login válido em um notebook conectado à internet, o PlannerDuo recém-publicado pode permanecer na tela de recuperação “Não foi possível iniciar o PlannerDuo. Verifique sua conexão e tente novamente.” em vez de abrir o aplicativo. O defeito ocorre quando atrasos ou falhas de armazenamento do navegador são tratados como falhas terminais de rede/autenticação e quando sinais globais não relacionados assumem o controle do bootstrap. Esta correção deve permitir que inicializações lentas, porém válidas, terminem; distinguir falhas reais de armazenamento; garantir que todo fluxo de loader termine em aplicativo visível, redirecionamento ou recuperação acionável; e preservar a política de sessão e as recuperações legítimas existentes.

## Bug Analysis

### Current Behavior (Defect)

A inicialização transforma limites de tempo e sinais globais genéricos em estados terminais, mesmo sem evidência de que a autenticação ou a conexão tenha falhado.

1.1 WHEN a configuração de persistência de sessão permanece pendente por mais de 3 segundos e depois conclui com sucesso THEN the system sintetiza um timeout terminal, ignora o sucesso tardio, não observa o estado autenticado e exibe a recuperação no lugar do aplicativo

1.2 WHEN o aplicativo é aberto após login com uma sessão estabelecida e a reconfiguração redundante de persistência encontra armazenamento web lento, bloqueado, indisponível ou corrompido THEN the system impede a observação da sessão e apresenta a falha como problema genérico de conexão, sem distinguir atraso recuperável de erro real de armazenamento

1.3 WHEN qualquer rejeição de Promise não tratada ocorre enquanto o bootstrap está pendente, ainda que não pertença a uma operação crítica do bootstrap THEN the system marca toda a inicialização como erro terminal e impede uma conclusão posterior válida

1.4 WHEN as etapas válidas de carregamento de recursos, restauração da autenticação e fallback de dados progridem individualmente, mas o tempo acumulado ultrapassa o watchdog absoluto de 10 segundos THEN the system substitui o loader pela recuperação terminal mesmo que nenhuma etapa crítica tenha falhado

1.5 WHEN o fluxo sem sessão tenta redirecionar para a autenticação e a navegação lança uma exceção ou não retira a página atual depois que o supervisor já foi concluído THEN the system mantém o loader sem poder convertê-lo em uma falha recuperável

### Expected Behavior (Correct)

A inicialização deve separar atraso de falha, reagir apenas a operações críticas que possui e manter uma saída recuperável em todas as transições.

2.1 WHEN a configuração de persistência de sessão ultrapassa 3 segundos e depois conclui com sucesso THEN the system SHALL aceitar a conclusão tardia, observar o estado autenticado e abrir o aplicativo sem exigir recarga

2.2 WHEN o aplicativo é aberto após login com uma sessão estabelecida e o armazenamento web está lento, bloqueado, indisponível ou corrompido THEN the system SHALL resolver o estado autenticado sem exigir uma segunda reconfiguração terminal de persistência e SHALL apresentar orientação específica de armazenamento somente quando a política de sessão realmente não puder ser satisfeita

2.3 WHEN uma rejeição de Promise não tratada não pertence a uma operação crítica registrada pelo bootstrap THEN the system SHALL ignorá-la como decisão de bootstrap, enquanto falhas explícitas de operações críticas SHALL continuar produzindo recuperação acionável

2.4 WHEN cada etapa crítica continua progredindo dentro de seu próprio contrato de tempo THEN the system SHALL manter a inicialização recuperável independentemente do tempo acumulado e SHALL permitir que uma conclusão válida posterior substitua qualquer aviso não terminal de demora

2.5 WHEN um redirecionamento necessário lança uma exceção ou não retira a página atual THEN the system SHALL manter o supervisor apto a exibir recuperação, liberar a trava de navegação quando aplicável e impedir que o loader permaneça indefinidamente ocupado

### Unchanged Behavior (Regression Prevention)

A correção deve ser mínima: preservar a política de sessão, os fluxos de autenticação e as recuperações que correspondem a falhas críticas reais.

3.1 WHEN a persistência SESSION está disponível e conclui normalmente antes do login THEN the system SHALL CONTINUE TO autenticar por e-mail/senha, cadastro e Google usando uma sessão limitada à aba

3.2 WHEN um recurso crítico obrigatório, o SDK de autenticação ou o observador de autenticação falha explicitamente THEN the system SHALL CONTINUE TO mostrar uma recuperação persistente com ações de tentar novamente e ir para o login ou início

3.3 WHEN uma pessoa sem sessão válida abre a rota do aplicativo THEN the system SHALL CONTINUE TO redirecioná-la para a autenticação sem revelar o shell privado

3.4 WHEN a resolução de dados compartilhados falha ou excede seu limite próprio THEN the system SHALL CONTINUE TO usar o identificador seguro de fallback e o cache local para abrir o aplicativo em modo offline-first

3.5 WHEN o estado autenticado e os dados iniciais são resolvidos normalmente THEN the system SHALL CONTINUE TO montar o shell, registrar o listener de dados, renderizar as telas e remover o loader uma única vez

3.6 WHEN uma falha de autenticação ou bootstrap é diagnosticada THEN the system SHALL CONTINUE TO registrar somente metadados permitidos, sem credenciais, tokens, mensagens brutas, identificadores pessoais ou conteúdo de documentos

3.7 WHEN a persistência SESSION não pode ser garantida antes de uma nova autenticação THEN the system SHALL CONTINUE TO impedir fallback silencioso para persistência LOCAL e SHALL manter a pessoa informada sem iniciar uma operação de credencial incompatível com a política de sessão
