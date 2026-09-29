# PlannerDuo

Aplicação web local para organizar finanças, viagens, metas, checklists e decisões em um cofre criptografado por senha.

## Segurança local

- todo acesso ao painel passa por `auth.html`;
- o conteúdo do workspace é cifrado com AES-GCM de 256 bits;
- a chave é derivada de e-mail + senha usando PBKDF2-SHA-256, 600.000 iterações e salt aleatório;
- cada gravação usa um IV aleatório novo e metadados autenticados;
- a chave derivada permanece somente no `sessionStorage` da aba desbloqueada;
- bloquear ou fechar a aba remove a sessão; 30 minutos sem atividade bloqueiam automaticamente;
- troca de senha recriptografa o banco e invalida outras sessões;
- alterações entre abas são serializadas com Web Locks;
- o backup padrão contém o envelope criptografado, nunca o workspace legível.

No primeiro acesso, se existir um workspace da versão sem login, ele é criptografado e verificado antes da remoção da cópia legível. Se a gravação ou a verificação falhar, os dados antigos são preservados.

> O e-mail é apenas um identificador local e não é verificado. O nome e o e-mail da conta ficam visíveis no cabeçalho do cofre; o conteúdo do workspace fica cifrado. A chave derivada permanece no `sessionStorage` durante a sessão, portanto uma extensão maliciosa, XSS ou script comprometido da mesma origem poderia lê-la enquanto a aba estiver desbloqueada. Não existe servidor nem recuperação de senha. Esquecer a senha torna o cofre irrecuperável. A proteção cobre dados em repouso e abas bloqueadas; não substitui a senha do Windows e não protege alguém que já controla o computador ou a sessão aberta.

## Busca de viagens

A aba **Viagens** reúne 26 opções em quatro grupos:

- voos: Google Voos, KAYAK, Skyscanner, momondo, Kiwi.com, Expedia, Decolar, LATAM, GOL e Azul;
- hospedagem: Airbnb, Booking.com, Expedia Hotéis, Hoteis.com, Hostelworld, Vrbo, Agoda e trivago;
- ônibus e rotas: ClickBus, Buser, Rome2Rio, Omio, FlixBus e Busbud;
- carros: Localiza e Booking Cars.

Cada cartão mostra uma das modalidades:

- **Datas na busca:** a ida/volta são colocadas nos campos ou no caminho estruturado do provedor;
- **Datas com requisitos:** exige condições como códigos IATA (`CNF`, `GRU`) ou ida e volta;
- **Busca assistida:** os dados entram em uma consulta, mas devem ser confirmados no site;
- **Preencher no site:** o provedor não oferece um deep link público estável; o PlannerDuo abre a página oficial e copia o resumo quando permitido.

Nenhum provedor é acessado durante a inicialização. A navegação ocorre somente após clique explícito, por HTTPS e em nova aba com `noopener`/`noreferrer`. Ícones são SVGs internos; não há logos, scripts ou imagens baixados em segundo plano.

## Executar

```bash
npm install
npm run dev
```

Abra `http://localhost:5500/`. No primeiro acesso, escolha **Criar cofre**; nos seguintes, use o e-mail local e a senha definida.

No VS Code, também é possível pressionar **F5** e escolher **PlannerDuo (local)**.

## Arquivos principais

```text
public/
  index.html   # apresentação e entrada pelo login
  auth.html    # cadastro, desbloqueio e recuperação destrutiva
  auth.js      # fluxo da conta e da sessão local
  app.html     # shell autenticado da aplicação
  app.js       # CRUD, relatórios, bloqueio e integração da busca
  travel.js    # registry, SVGs, validação e builders dos 26 provedores
  core.js      # schema, normalização, votos e acerto de despesas
  local.js     # criptografia, cofre, sessão, migração e concorrência
  style.css    # design system responsivo sem assets externos
scripts/
  dev-server.mjs          # servidor HTTP local
  verificar-frontend.mjs  # testes, sintaxe, referências e smoke HTTP
```

## Backup e restauração

Em **Configurações → Backup e restauração**, o download padrão é o envelope cifrado. Um backup atual pode ser restaurado diretamente enquanto a mesma chave estiver ativa; backups feitos antes de uma troca de senha solicitam a senha antiga em um campo protegido. O importador também aceita o JSON legível da versão anterior, valida seu schema e o recriptografa imediatamente.

**Apagar dados locais** zera o conteúdo, mas mantém conta e senha. **Esqueci a senha → Apagar cofre** elimina conta, ciphertext e conteúdo de forma definitiva.

## Verificação

```bash
npm run verificar
```

O gate executa Vitest e depois inicia um servidor temporário. Ele valida criptografia/migração/senha/sessão/concorrência/backup, os builders de datas e hosts permitidos, os SVGs, sintaxe JavaScript, CSP, referências locais, ausência de assets remotos e os principais caminhos HTTP.
