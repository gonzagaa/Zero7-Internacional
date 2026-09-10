/* =====================================================================
   META CONVERSIONS API — endpoint server-side (Vercel, Node runtime)
   -----------------------------------------------------------------------
   Recebe um POST do navegador com { event_id, event_name, event_source_url,
   fbp, fbc, external_id } e reenvia para a Conversions API da Meta usando
   o MESMO event_id do Pixel do browser (deduplicação).

   Regras que NÃO podem mudar:
   - IP e user-agent do visitante SEMPRE vêm dos headers da requisição,
     nunca do corpo (evita spoofing).
   - fbp, fbc, client_ip_address e client_user_agent NÃO são hasheados.
   - Só external_id é hasheado (SHA-256 em hex).
   - Token da Meta nunca aparece na resposta nem em log.
   ===================================================================== */

import crypto from 'node:crypto';

const META_GRAPH_URL = 'https://graph.facebook.com/v26.0';

/* -----------------------------------------------------------------------
   Helpers
   ----------------------------------------------------------------------- */

// Lê a lista de origens permitidas (env), separada por vírgula.
function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// Monta os headers de CORS para uma origem já validada. Nunca usa "*".
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// SHA-256 em hex, com normalização (trim + lowercase) — exigido pela Meta.
function sha256Hex(value) {
  return crypto
    .createHash('sha256')
    .update(String(value).trim().toLowerCase())
    .digest('hex');
}

// Extrai o primeiro IP da lista em x-forwarded-for. Nunca lê do body.
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (!xff) return null;
  const list = Array.isArray(xff) ? xff.join(',') : String(xff);
  const first = list.split(',')[0].trim();
  return first || null;
}

// Lê e faz parse do JSON do corpo. Em runtime Node da Vercel, req.body
// normalmente já vem parseado; o fallback cobre casos em que não vem.
async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return null; }
  }
  return await new Promise((resolve) => {
    let chunks = '';
    req.on('data', (c) => { chunks += c; });
    req.on('end', () => {
      if (!chunks) return resolve(null);
      try { resolve(JSON.parse(chunks)); } catch (_) { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

/* -----------------------------------------------------------------------
   Handler
   ----------------------------------------------------------------------- */

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = getAllowedOrigins();
  const originOk = allowed.includes(origin);

  // Preflight — só responde OK se a origem estiver liberada.
  if (req.method === 'OPTIONS') {
    if (!originOk) {
      res.status(403).end();
      return;
    }
    const headers = corsHeaders(origin);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.status(204).end();
    return;
  }

  // Bloqueio de origem para requisições reais.
  if (!originOk) {
    res.status(403).json({ error: 'origin not allowed' });
    return;
  }

  // Headers de CORS na resposta real.
  const headers = corsHeaders(origin);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);

  // Somente POST.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'invalid body' });
    return;
  }

  const {
    event_id,
    event_name,
    event_source_url,
    fbp,
    fbc,
    external_id,
  } = body;

  // Validação mínima.
  if (!event_id || !event_source_url) {
    res.status(400).json({ error: 'missing event_id or event_source_url' });
    return;
  }

  // IP e user-agent — SEMPRE dos headers, nunca do corpo.
  const clientIp = getClientIp(req);
  const clientUa = req.headers['user-agent'] || null;

  // TODO: remover após validar o IP em produção
  // Log de diagnóstico do IP — só os valores necessários para conferir se o
  // IP que vai no CAPI é o do visitante real (e não da Vercel).
  console.log('[capi][diag-ip]', {
    xff_raw: req.headers['x-forwarded-for'] || null,
    xrealip_raw: req.headers['x-real-ip'] || null,
    client_ip_address: clientIp,
  });

  // user_data: adiciona só o que existe. fbp/fbc/IP/UA em texto puro;
  // external_id em SHA-256 hex.
  const userData = {};
  if (clientIp)   userData.client_ip_address = clientIp;
  if (clientUa)   userData.client_user_agent = clientUa;
  if (fbp)        userData.fbp = String(fbp);            // NÃO hashear
  if (fbc)        userData.fbc = String(fbc);            // NÃO hashear
  if (external_id) userData.external_id = sha256Hex(external_id); // SHA-256 hex

  const payload = {
    data: [
      {
        event_name: event_name || 'PageView',
        event_time: Math.floor(Date.now() / 1000), // unix seconds do servidor
        event_id: String(event_id),
        action_source: 'website',
        event_source_url: String(event_source_url),
        user_data: userData,
      },
    ],
  };

  // test_event_code é opcional. Só entra no payload se a env tiver conteúdo
  // REAL. Env cadastrada vazia ou só com espaços é tratada como ausente —
  // caso contrário os eventos ficariam presos no modo de teste do
  // Events Manager sem erro visível.
  const testCode = (process.env.META_TEST_EVENT_CODE || '').trim();
  if (testCode) {
    payload.test_event_code = testCode;
  }

  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_ACCESS_TOKEN;
  if (!pixelId || !token) {
    console.error('[capi] META_PIXEL_ID ou META_ACCESS_TOKEN ausentes nas envs');
    res.status(502).json({ error: 'upstream configuration' });
    return;
  }

  const url =
    `${META_GRAPH_URL}/${encodeURIComponent(pixelId)}/events` +
    `?access_token=${encodeURIComponent(token)}`;

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      // Loga texto para debug interno; NUNCA devolve detalhes ao cliente.
      const errText = await upstream.text().catch(() => '');
      console.error('[capi] meta respondeu', upstream.status, errText);
      res.status(502).json({ error: 'upstream error' });
      return;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[capi] fetch falhou:', err && err.message);
    res.status(502).json({ error: 'upstream error' });
  }
}
