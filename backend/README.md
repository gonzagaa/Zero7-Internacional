# Zero7 Internacional — Backend CAPI

Endpoint serverless (Node, Vercel) para reenviar eventos do Pixel Meta via
Conversions API, deduplicados pelo `event_id` que também é enviado no lado
navegador.

- **Sem dependências npm.** Só Node nativo (fetch + crypto).
- **Runtime**: Node 20.x (fixado em `package.json > engines`).
- **Rota pública**: `POST /api/capi`.

## Estrutura

```
backend/
├── api/
│   └── capi.js       # função serverless (única rota)
├── package.json      # ESM, sem deps
├── vercel.json       # limite de execução
├── .env.example      # nomes das envs (sem valores)
└── README.md
```

## Deploy na Vercel

1. Criar projeto novo na Vercel apontando para este repositório.
2. Em **Settings > General > Root Directory**, definir `backend`.
3. Em **Settings > Environment Variables**, criar as variáveis do
   `.env.example` para os ambientes `Production`, `Preview` e `Development`:
   - `META_PIXEL_ID`
   - `META_ACCESS_TOKEN`
   - `META_TEST_EVENT_CODE` (opcional — deixe vazio em produção)
   - `ALLOWED_ORIGINS` (ex.: `https://zero7trading.com,https://www.zero7trading.com`)
4. Deploy. A URL final será `https://<projeto>.vercel.app/api/capi`.

> **Importante**: se o token da Meta vazar, revogue-o imediatamente no
> Events Manager e cadastre um novo. O endpoint nunca devolve o token no
> corpo da resposta nem loga o valor.

## Como o endpoint funciona

- Aceita apenas `POST`. Qualquer outro método → `405`.
- Trata preflight `OPTIONS` e valida `Origin` contra `ALLOWED_ORIGINS`.
  Origem não listada → `403` (sem usar `*`).
- Corpo esperado (JSON):
  ```json
  {
    "event_id": "uuid-v4",
    "event_name": "PageView",
    "event_source_url": "https://zero7trading.com/",
    "fbp": "fb.1.1712345678901.1234567890",
    "fbc": "fb.1.1712345678901.IwARxxxxx",
    "external_id": "identificador-anonimo-do-visitante"
  }
  ```
- `event_id` e `event_source_url` são obrigatórios. Faltando → `400`.
- IP e user-agent vêm dos headers da requisição (`x-forwarded-for` e
  `user-agent`). Nunca do corpo.
- `fbp`, `fbc`, `client_ip_address` e `client_user_agent` seguem em texto
  puro. Só `external_id` é hasheado (SHA-256 hex).
- Sucesso → `200 { "success": true }`.
- Erro no upstream Meta → `502 { "error": "upstream error" }` (o detalhe
  fica só no log da Vercel).

## Testes rápidos

### Deploy na Vercel — verificação end-to-end

```bash
curl -i -X POST "https://zero7-internacional-backend.vercel.app/api/capi" \
  -H "Origin: https://zero7trading.com" \
  -H "Content-Type: application/json" \
  -H "User-Agent: curl-teste/1.0" \
  -H "X-Forwarded-For: 203.0.113.10" \
  --data '{
    "event_id":"teste-manual-001",
    "event_name":"PageView",
    "event_source_url":"https://zero7trading.com/?utm_source=teste",
    "fbp":"fb.1.1712345678901.1234567890",
    "fbc":"fb.1.1712345678901.IwARxxxxx",
    "external_id":"visitante-anonimo-abc"
  }'
```

Esperado: `HTTP/2 200` e `{"success":true}`. Para ver o evento na aba
**Test Events** do Events Manager, defina `META_TEST_EVENT_CODE` na env
antes.

### Preflight (OPTIONS)

```bash
curl -i -X OPTIONS "https://zero7-internacional-backend.vercel.app/api/capi" \
  -H "Origin: https://zero7trading.com" \
  -H "Access-Control-Request-Method: POST"
```

Esperado: `204 No Content` com header `Access-Control-Allow-Origin:
https://zero7trading.com`.

### Origem inválida

```bash
curl -i -X POST "https://zero7-internacional-backend.vercel.app/api/capi" \
  -H "Origin: https://site-nao-autorizado.com" \
  -H "Content-Type: application/json" \
  --data '{"event_id":"x","event_source_url":"https://x/"}'
```

Esperado: `403`.

## Rodar local (opcional)

```bash
# na pasta backend/
npx vercel dev
```

O endpoint fica em `http://localhost:3000/api/capi`. Lembre-se de incluir
`http://localhost:3000` (ou o host do dev server do site) em
`ALLOWED_ORIGINS`.
