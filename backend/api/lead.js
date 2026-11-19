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

   Meta (API de Conversões): CompleteRegistration com o event_id da página
   (o Pixel dispara o mesmo evento no obrigado; a Meta desduplica).
   - O lead nunca depende da Meta: a resposta é decidida só pela RD.
   - A Meta roda em paralelo com a RD, com tempo-limite próprio de 3 s.
   - Token, hashes e dados da pessoa nunca vão para log.
   ===================================================================== */

import crypto from 'node:crypto';

const RD_URL = 'https://api.rd.services/platform/conversions';
const CONVERSAO = 'black-zero7-trading-2026';
const LIMITE_CORPO = 4096;        // bytes
const TEMPO_LIMITE_RD = 8000;     // ms
const TEMPO_LIMITE_RD_REENVIO = 5000; // ms (só no reenvio sem telefone; o total fica abaixo dos 15 s da página)

const META_GRAPH_URL = 'https://graph.facebook.com/v26.0';
const TEMPO_LIMITE_META = 3000;   // ms
const META_EVENTO = 'CompleteRegistration';
const META_URL_PAGINA = 'https://zero7trading.com/black-2026/';
const META_CONTEUDO = 'LP Black Zero7 Trading 2026';

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
  if (n.length < 1 || n.length > 120) return null;

  if (typeof email !== 'string') return null;
  const e = email.trim();
  if (e.length > 254 || !RE_EMAIL.test(e)) return null;

  if (typeof telefone !== 'string') return null;
  const t = telefone.trim();
  const digitos = t.replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 15) return null;
  const tel = (t.startsWith('+') ? '+' : '') + digitos;

  // UTMs: opcionais. Não recusam o lead: tipo diferente de string é ignorado
  // e texto acima de 200 caracteres é cortado em 200.
  const utm = {};
  for (const campo of UTMS) {
    const v = body[campo];
    if (typeof v !== 'string') continue;
    const limpo = v.trim().slice(0, 200).trim();
    if (limpo) utm[campo] = limpo;
  }

  return { nome: n, email: e, telefone: tel, utm };
}

// A RD recusa (400) telefone sem código do país. Formato que ela aceita: "+" e só dígitos (E.164).
// Sem "+": 10 ou 11 dígitos são DDD + número do Brasil (ganham +55); 12 ou 13 começando com 55 já trazem o país.
function telefoneRd(telefone) {
  if (telefone.startsWith('+')) return telefone;
  const d = telefone.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) return '+55' + d;
  return '+' + d;
}

function montarEvento({ nome, email, telefone, utm }, { semTelefone = false } = {}) {
  const payload = {
    conversion_identifier: CONVERSAO,
    name: nome,
    email,
  };
  if (!semTelefone) {
    // o mesmo número nos dois campos da RD ("Celular" e "Telefone")
    const tel = telefoneRd(telefone);
    payload.mobile_phone = tel;
    payload.phone = tel;
  }
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
   Meta: CompleteRegistration pela API de Conversões
   ----------------------------------------------------------------------- */

// Campos de rastreio opcionais. Inválido ou ausente: ignorado, nunca recusa o lead.
function camposMeta(body) {
  const pegar = (nome, max) => {
    const v = body[nome];
    if (typeof v !== 'string') return null;
    const limpo = v.trim();
    return limpo && limpo.length <= max ? limpo : null;
  };
  return {
    eventId: pegar('event_id', 100),
    fbp: pegar('fbp', 500),
    fbc: pegar('fbc', 500),
    externalId: pegar('external_id', 200),
  };
}

const sha256 = (texto) => crypto.createHash('sha256').update(texto, 'utf8').digest('hex');

// Normalização da Meta ("Customer Information Parameters"):
// e-mail aparado e em minúsculas; telefone só com dígitos, sem zeros à esquerda e com
// código do país (55 quando o número veio sem DDI); primeiro nome em minúsculas, sem
// pontuação (acentos ficam, em UTF-8); external_id como no capi.js (trim + minúsculas).
function telefoneMeta(telefone) {
  const comDdi = telefone.startsWith('+');
  let d = telefone.replace(/\D/g, '').replace(/^0+/, '');
  if (!comDdi && (d.length === 10 || d.length === 11)) d = '55' + d;
  return d;
}

function primeiroNome(nome) {
  const primeiro = nome.normalize('NFC').trim().split(/\s+/)[0] || '';
  return primeiro.toLowerCase().replace(/[^\p{L}\p{M}]/gu, '');
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (!xff) return null;
  const list = Array.isArray(xff) ? xff.join(',') : String(xff);
  const first = list.split(',')[0].trim();
  return first || null;
}

function montarEventoMeta(lead, meta, req) {
  const userData = {};
  const em = lead.email.trim().toLowerCase();
  const ph = telefoneMeta(lead.telefone);
  const fn = primeiroNome(lead.nome);
  if (em) userData.em = [sha256(em)];
  if (ph) userData.ph = [sha256(ph)];
  if (fn) userData.fn = [sha256(fn)];
  if (meta.externalId) userData.external_id = [sha256(meta.externalId.toLowerCase())];
  if (meta.fbp) userData.fbp = meta.fbp;                 // sem hash
  if (meta.fbc) userData.fbc = meta.fbc;                 // sem hash
  const ip = getClientIp(req);                            // sempre dos headers, nunca do corpo
  const ua = req.headers['user-agent'];
  if (ip) userData.client_ip_address = ip;
  if (ua) userData.client_user_agent = String(ua);

  const corpo = {
    data: [{
      event_name: META_EVENTO,
      event_time: Math.floor(Date.now() / 1000),
      event_id: meta.eventId,
      action_source: 'website',
      event_source_url: META_URL_PAGINA,
      user_data: userData,
      custom_data: { content_name: META_CONTEUDO },
    }],
  };
  // Mesma regra do capi.js: só com conteúdo real (vazio ou espaços = ausente).
  const testCode = (process.env.META_TEST_EVENT_CODE || '').trim();
  if (testCode) corpo.test_event_code = testCode;
  return corpo;
}

// Nunca rejeita e nunca passa de TEMPO_LIMITE_META. Loga só status, duração ou código.
async function enviarMeta(lead, meta, req) {
  if (!meta.eventId) return;
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_ACCESS_TOKEN;
  if (!pixelId || !token) {
    console.warn('[lead] meta sem configuração; evento não enviado');
    return;
  }
  const inicio = Date.now();
  try {
    const url = `${META_GRAPH_URL}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(montarEventoMeta(lead, meta, req)),
      signal: AbortSignal.timeout(TEMPO_LIMITE_META),
    });
    const ms = Date.now() - inicio;
    try { await resp.body?.cancel(); } catch (_) { /* nada */ }
    if (resp.ok) console.log('[lead] meta ok', { status: resp.status, ms });
    else console.error('[lead] meta erro', { status: resp.status, ms });
  } catch (err) {
    const codigo = err && err.name === 'TimeoutError' ? 'timeout' : 'fetch_failed';
    console.error('[lead] meta erro', { codigo, ms: Date.now() - inicio });
  }
}

/* -----------------------------------------------------------------------
   RD: devolve true/false; loga só status, duração ou código
   ----------------------------------------------------------------------- */

// Um POST à RD. Devolve o status HTTP, ou o código do erro de rede. Nunca lê nem loga o corpo da resposta.
async function postRd(evento, chave, tempoLimite) {
  try {
    const rd = await fetch(`${RD_URL}?api_key=${encodeURIComponent(chave)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evento),
      signal: AbortSignal.timeout(tempoLimite),
    });
    // Descarta o corpo da RD sem ler nem logar (pode ecoar dados do contato).
    try { await rd.body?.cancel(); } catch (_) { /* nada */ }
    return { status: rd.status, ok: rd.ok };
  } catch (err) {
    return { codigo: err && err.name === 'TimeoutError' ? 'timeout' : 'fetch_failed', ok: false };
  }
}

async function enviarRd(lead, chave) {
  const inicio = Date.now();
  const r = await postRd(montarEvento(lead), chave, TEMPO_LIMITE_RD);
  if (r.ok) {
    console.log('[lead] rd ok', { status: r.status, ms: Date.now() - inicio });
    return true;
  }
  if (r.codigo) {
    console.error('[lead] rd falhou', { codigo: r.codigo, ms: Date.now() - inicio });
    return false;
  }
  console.error('[lead] rd erro', { status: r.status, ms: Date.now() - inicio });

  // 400 = a RD recusou algum campo. O lead não pode se perder: reenvia uma vez sem telefone
  // (nome, e-mail e UTMs ficam; o telefone continua no CRM da 4Selet).
  if (r.status !== 400) return false;
  const inicio2 = Date.now();
  const r2 = await postRd(montarEvento(lead, { semTelefone: true }), chave, TEMPO_LIMITE_RD_REENVIO);
  if (r2.ok) {
    console.warn('[lead] rd ok sem telefone', { status: r2.status, ms: Date.now() - inicio2 });
    return true;
  }
  console.error('[lead] rd erro sem telefone', r2.codigo ? { codigo: r2.codigo, ms: Date.now() - inicio2 } : { status: r2.status, ms: Date.now() - inicio2 });
  return false;
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

  const body = await readJsonBody(req);
  const lead = validar(body);
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

  // RD e Meta em paralelo. A resposta é só a da RD; a Meta nunca rejeita e acaba em até 3 s.
  // Espera as duas antes de responder: depois da resposta a Vercel pode congelar a função.
  const [rdOk] = await Promise.all([
    enviarRd(lead, chave),
    enviarMeta(lead, camposMeta(body), req).catch(() => {}),
  ]);

  if (!rdOk) {
    res.status(502).json({ error: 'upstream error' });
    return;
  }
  res.status(200).json({ success: true });
}
