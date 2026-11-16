/* =====================================================================
   LEAD — RD Station (Vercel, Node runtime)
   -----------------------------------------------------------------------
   Recebe o cadastro da LP Black Zero7 Trading 2026 (zero7trading.com/black-2026/)
   e registra uma conversão na RD Station Marketing pela API de conversões
   (POST https://api.rd.services/platform/conversions?api_key=...).

   Regras que NÃO podem mudar:
   - A chave (RD_API_KEY) dá acesso total à conta da RD: só existe na env
     da Vercel. Nunca aparece na resposta nem em log (nem a URL com ela).
   - Nada de dado pessoal em log: nem o corpo recebido, nem nome, e-mail,
     telefone, nem a resposta da RD. Só status, duração e código de erro.
   - O identificador da conversão é fixo aqui; nunca vem da página.
   ===================================================================== */

const RD_URL = 'https://api.rd.services/platform/conversions';
const CONVERSAO = 'black-zero7-trading-2026';
const LIMITE_CORPO = 4096;        // bytes
const TEMPO_LIMITE_RD = 8000;     // ms

const UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const BASES_LEGAIS = [
  'pre_existent_contract', 'consent', 'legitimate_interest',
  'judicial_process', 'vital_interest', 'public_interest',
];
const RE_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

/* -----------------------------------------------------------------------
   Helpers (mesmo padrão de api/capi.js)
   ----------------------------------------------------------------------- */

function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// Lê o JSON do corpo com limite de tamanho. Devolve null se faltar, passar
// do limite ou não for JSON. Na Vercel, req.body costuma vir já parseado.
async function readJsonBody(req) {
  const declarado = Number(req.headers['content-length'] || 0);
  if (declarado > LIMITE_CORPO) return null;

  if (req.body !== undefined && req.body !== null && req.body !== '') {
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      const texto = String(req.body);
      if (Buffer.byteLength(texto) > LIMITE_CORPO) return null;
      try { return JSON.parse(texto); } catch (_) { return null; }
    }
    if (typeof req.body === 'object') {
      return Buffer.byteLength(JSON.stringify(req.body)) > LIMITE_CORPO ? null : req.body;
    }
    return null;
  }

  return await new Promise((resolve) => {
    let bytes = 0;
    const partes = [];
    let feito = false;
    const fim = (v) => { if (!feito) { feito = true; resolve(v); } };
    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > LIMITE_CORPO) { fim(null); return; }
      partes.push(c);
    });
    req.on('end', () => {
      if (feito) return;
      if (!partes.length) return fim(null);
      try { fim(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch (_) { fim(null); }
    });
    req.on('error', () => fim(null));
  });
}

// Valida e normaliza a entrada. Devolve null em qualquer falha (sem dizer qual).
function validar(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { nome, email, telefone } = body;

  if (typeof nome !== 'string') return null;
  const n = nome.trim();
  if (n.length < 2 || n.length > 120) return null;

  if (typeof email !== 'string') return null;
  const e = email.trim();
  if (e.length > 254 || !RE_EMAIL.test(e)) return null;

  if (typeof telefone !== 'string') return null;
  const t = telefone.trim();
  const digitos = t.replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 15) return null;
  const tel = (t.startsWith('+') ? '+' : '') + digitos;

  const utm = {};
  for (const campo of UTMS) {
    const v = body[campo];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || v.length > 200) return null;
    const limpo = v.trim();
    if (limpo) utm[campo] = limpo;
  }

  return { nome: n, email: e, telefone: tel, utm };
}

function montarEvento({ nome, email, telefone, utm }) {
  const payload = {
    conversion_identifier: CONVERSAO,
    name: nome,
    email,
    // o mesmo número nos dois campos da RD ("Celular" e "Telefone")
    mobile_phone: telefone,
    phone: telefone,
  };
  // UTM vazia não vai. utm_content não tem campo na API de conversões.
  if (utm.utm_source) payload.traffic_source = utm.utm_source;
  if (utm.utm_medium) payload.traffic_medium = utm.utm_medium;
  if (utm.utm_campaign) payload.traffic_campaign = utm.utm_campaign;
  if (utm.utm_term) payload.traffic_value = utm.utm_term;

  // Base legal: só com RD_BASE_LEGAL definida e com um tipo aceito pela RD.
  const base = (process.env.RD_BASE_LEGAL || '').trim();
  if (base) {
    if (BASES_LEGAIS.includes(base)) {
      payload.legal_bases = [{ category: 'communications', type: base, status: 'granted' }];
    } else {
      console.warn('[lead] RD_BASE_LEGAL com valor não aceito; enviado sem base legal');
    }
  }

  return { event_type: 'CONVERSION', event_family: 'CDP', payload };
}

/* -----------------------------------------------------------------------
   Handler
   ----------------------------------------------------------------------- */

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const originOk = getAllowedOrigins().includes(origin);

  // Preflight — só responde OK se a origem estiver liberada.
  if (req.method === 'OPTIONS') {
    if (!originOk) {
      res.status(403).end();
      return;
    }
    for (const [k, v] of Object.entries(corsHeaders(origin))) res.setHeader(k, v);
    res.status(204).end();
    return;
  }

  if (!originOk) {
    res.status(403).json({ error: 'origin not allowed' });
    return;
  }

  for (const [k, v] of Object.entries(corsHeaders(origin))) res.setHeader(k, v);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const lead = validar(await readJsonBody(req));
  if (!lead) {
    res.status(400).json({ error: 'invalid input' });
    return;
  }

  const chave = process.env.RD_API_KEY;
  if (!chave) {
    console.error('[lead] RD_API_KEY ausente');
    res.status(500).json({ error: 'server misconfigured' });
    return;
  }

  const inicio = Date.now();
  try {
    const rd = await fetch(`${RD_URL}?api_key=${encodeURIComponent(chave)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(montarEvento(lead)),
      signal: AbortSignal.timeout(TEMPO_LIMITE_RD),
    });
    const ms = Date.now() - inicio;
    // Descarta o corpo da RD sem ler nem logar (pode ecoar dados do contato).
    try { await rd.body?.cancel(); } catch (_) { /* nada */ }

    if (!rd.ok) {
      console.error('[lead] rd erro', { status: rd.status, ms });
      res.status(502).json({ error: 'upstream error' });
      return;
    }

    console.log('[lead] rd ok', { status: rd.status, ms });
    res.status(200).json({ success: true });
  } catch (err) {
    const codigo = err && err.name === 'TimeoutError' ? 'timeout' : 'fetch_failed';
    console.error('[lead] rd falhou', { codigo, ms: Date.now() - inicio });
    res.status(502).json({ error: 'upstream error' });
  }
}
