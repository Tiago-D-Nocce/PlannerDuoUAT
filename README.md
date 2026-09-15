# PlannerDuo1.0

PlannerDuo de Produção — aplicação web privada para casais gerenciarem finanças
compartilhadas, viagens e metas.

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
npm run dev          # http://localhost:5000
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
