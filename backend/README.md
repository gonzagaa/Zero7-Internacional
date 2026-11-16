# Zero7 Internacional — Backend CAPI

Endpoint serverless (Node, Vercel) para reenviar eventos do Pixel Meta via
Conversions API, deduplicados pelo `event_id` que também é enviado no lado
navegador.

- **Sem dependências npm.** Só Node nativo (fetch + crypto).
- **Runtime**: Node 20.x (fixado em `package.json > engines`).
- **Rotas públicas**: `POST /api/capi` e `POST /api/lead` (cadastro da LP
  Black Zero7 Trading 2026 na RD Station; ver a seção "Rota /api/lead").

## Estrutura

```
backend/
├── api/
│   ├── capi.js       # Meta Conversions API
│   └── lead.js       # cadastro da LP Black → RD Station (conversão)
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
   - `RD_API_KEY` e `RD_BASE_LEGAL` (opcional), da rota `/api/lead`
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

## Rota /api/lead (RD Station)

Recebe o cadastro da LP Black Zero7 Trading 2026
(`https://zero7trading.com/black-2026/`) e registra a conversão
`black-zero7-trading-2026` na RD Station Marketing
(`POST https://api.rd.services/platform/conversions?api_key=...`).

**Variáveis de ambiente** (ver `.env.example`):
- `RD_API_KEY`: Chave de API da RD. Dá **acesso total** à conta: só o
  responsável cadastra o valor, direto na Vercel (Production e Preview).
  Nunca em arquivo, chat ou log.
- `RD_BASE_LEGAL` (opcional): tipo da base legal (ex.: `legitimate_interest`).
  Vazia, a conversão vai sem `legal_bases`. Valor fora da lista da RD é
  ignorado, com aviso no log.
- `ALLOWED_ORIGINS`: a mesma da rota `/api/capi`. `http://localhost:5503`
  (LP em desenvolvimento) só em Preview/Development, nunca em Production.

**Entrada** (JSON, até 4 KB):
```json
{
  "nome": "Nome do lead",
  "email": "lead@exemplo.com",
  "telefone": "+55 62 99999-0000",
  "utm_source": "", "utm_medium": "", "utm_campaign": "", "utm_term": "", "utm_content": ""
}
```
- `nome`: 2 a 120 caracteres. `email`: até 254. `telefone`: de 10 a 15 dígitos
  (vai para a RD só com os dígitos, com `+` na frente se veio com `+`).
- UTMs opcionais, até 200 caracteres. `utm_source`, `utm_medium`,
  `utm_campaign` e `utm_term` viram `traffic_source`, `traffic_medium`,
  `traffic_campaign` e `traffic_value`; `utm_content` não tem campo na API
  de conversões e não é enviado.
- O identificador da conversão é fixo na função; a página não escolhe.

**Respostas**
- `200 { "success": true }`: a RD aceitou (2xx).
- `400 { "error": "invalid input" }`: qualquer campo inválido (sem dizer qual).
- `403`: origem fora de `ALLOWED_ORIGINS`. `405`: método diferente de POST/OPTIONS.
- `500 { "error": "server misconfigured" }`: falta `RD_API_KEY`.
- `502 { "error": "upstream error" }`: a RD respondeu erro ou passou de 8 s.

**Logs:** só status da RD, duração e código de erro. Nunca o corpo
recebido, nome, e-mail, telefone, a URL com a chave nem a resposta da RD.

### Teste da rota /api/lead

```bash
curl -i -X POST "https://zero7-internacional-backend.vercel.app/api/lead" \
  -H "Origin: https://zero7trading.com" \
  -H "Content-Type: application/json" \
  --data '{"nome":"Lead Teste","email":"<e-mail de teste>","telefone":"+5562999990000","utm_source":"teste"}'
```

Esperado: `200 {"success":true}` e o contato na RD com a conversão
`black-zero7-trading-2026`. Sem a chave: `500 {"error":"server misconfigured"}`.

## Rodar local (opcional)

```bash
# na pasta backend/
npx vercel dev
```

O endpoint fica em `http://localhost:3000/api/capi`. Lembre-se de incluir
`http://localhost:3000` (ou o host do dev server do site) em
`ALLOWED_ORIGINS`.
