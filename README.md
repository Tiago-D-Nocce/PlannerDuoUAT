# PlannerDuo1.0

PlannerDuo de Produção — aplicação web privada para casais gerenciarem finanças
compartilhadas, viagens e metas.

## Como rodar (modo local)

O PlannerDuo está em modo local: abre direto no painel, sem login, salvando no
navegador (localStorage). O Firebase está desligado — para religar, troque
`MODO` para `'firebase'` em `public/app.js`.

- **Recomendado (um clique):** no VS Code, pressione F5 e escolha
  "PlannerDuo (local)". O servidor sobe e o navegador abre em
  `http://localhost:5500/app.html`.
- **Alternativa (terminal):** `npm run dev` e abra `http://localhost:5500/`.
- **Live Server:** se usar a extensão, acesse por `app.html`/`index.html`
  diretamente e **não** configure `mount` para `/app` — o Live Server casa o
  mount por prefixo e captura `/app.js`, servindo-o como HTML e quebrando o app.

## Estrutura

```
public/          # tudo que vai para o Firebase Hosting
  index.html     # landing pública
  auth.html      # login / cadastro / reset (script próprio, não usa app.js)
  app.html       # painel do casal
  app.js         # estado, Firestore, controladores e renderização
  core.js        # lógica pura (Espaço_Casal e Convites), testável sem Firebase
  style.css      # design system + telas
firestore.rules  # regras de acesso
firebase.json    # hosting (serve public/) + rewrites /app e /auth
scripts/         # utilitários de desenvolvimento (sem dependências)
tests/           # vitest + fast-check sobre core.js e os helpers de app.js
```

O diretório servido é `public/`. Manter os assets na raiz faz o
`firebase deploy` publicar um site vazio e expor arquivos do repositório.

## Rodar localmente

```bash
npm install
npm run dev          # http://localhost:5500
```

O Firebase Auth não funciona sob `file://` — é preciso servir por HTTP.
O `scripts/dev-server.mjs` reproduz os rewrites declarados em `firebase.json`
(`/app` → `app.html`, `/auth` → `auth.html`, resto → `index.html`).

## Testes e verificação

```bash
npm test             # vitest --run
npm run verificar    # com o dev-server no ar: checa sintaxe e referências
```

`npm run verificar` confere que `app.js`/`core.js` têm sintaxe válida, que toda
referência local em `href`/`src` existe dentro de `public/` e que cada rota
devolve o arquivo correto — o fallback de SPA responde 200 até para arquivo
inexistente, então a checagem compara o corpo servido com o disco.

## Deploy

```bash
firebase deploy --only hosting,firestore:rules
```

As regras são validadas pelo Firebase no momento do deploy.
