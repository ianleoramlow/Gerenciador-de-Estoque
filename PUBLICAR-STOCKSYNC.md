# Publicar o StockSync

O sistema agora tem servidor Node e banco persistente em `data/stocksync-db.json`.

## Rodar no seu notebook

1. Abra a pasta do projeto.
2. Rode:

```bash
npm start
```

3. Acesse:

```text
http://localhost:5500/01-login.html
```

## Publicar para apresentar

O jeito mais rapido e simples e usar Render, Railway ou outro serviço Node.

### Render

1. Crie uma conta em `https://render.com`.
2. Suba esta pasta para um repositorio no GitHub.
3. No Render, clique em `New` > `Web Service`.
4. Selecione o repositorio.
5. Use estas configuracoes:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
```

6. Depois do deploy, o Render vai gerar um link parecido com:

```text
https://stocksync.onrender.com
```

Esse link ja funciona como dominio para apresentar.

## Banco

O backend grava os dados neste arquivo:

```text
data/stocksync-db.json
```

As telas continuam funcionando com `localStorage` como fallback, mas quando abertas pelo servidor novo elas salvam os dados no backend.
