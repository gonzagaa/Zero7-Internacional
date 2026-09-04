/* =====================================================================
   META PIXEL + CONVERSIONS API — disparo do PageView deduplicado.

   O QUE ESTE ARQUIVO FAZ (nesta ordem, propositalmente):
   1) Garante os cookies _fbp e _fbc ANTES de carregar o Pixel, para que
      navegador e servidor usem exatamente os mesmos IDs.
   2) Gera / recupera um external_id anônimo persistente em localStorage.
   3) Gera UM event_id por pageview (crypto.randomUUID) — o MESMO id é
      enviado para o Pixel (browser) e para a CAPI (Vercel), permitindo a
      Meta desduplicar os dois recebimentos.
   4) Carrega o snippet base do Pixel e chama fbq('init') + fbq('track').
   5) Faz POST para o endpoint da Vercel (fetch com keepalive, falha
      silenciosa — se a CAPI cair, o site não pode quebrar).

   Reaproveita a persistência do fbclid feita por js/utmForward.js
   (sessionStorage 'z7_tracking_params'), então se o fbclid chegou em
   uma navegação anterior dentro da mesma aba, ainda conseguimos montar
   o _fbc mesmo que ele não esteja mais na URL atual.
   ===================================================================== */
(function () {
  'use strict';

  // ====================================================================
  // >>> PREENCHER ANTES DE PUBLICAR <<<
  // ID do Pixel Meta
  const PIXEL_ID = '1380055004077990';
  // URL completa do endpoint da Vercel (rota /api/capi do projeto backend)
  const CAPI_ENDPOINT = 'https://zero7-internacional-backend.vercel.app/api/capi';
  // ====================================================================

  const COOKIE_MAX_AGE = 90 * 24 * 60 * 60; // 90 dias em segundos
  const LS_EXT_ID = 'zero7_ext_id';
  const SS_TRACKING = 'z7_tracking_params'; // chave usada por js/utmForward.js

  /* -----------------------------------------------------------------
     Domínio raiz para o cookie
     - Precisa começar com "." pra valer nos subdomínios (checkout,
       painel do trader etc).
     - Trata TLDs compostos comuns (com.br, co.uk, com.mx).
     - Em localhost / IP → deixa sem domínio (cookie fica no host atual).
     ----------------------------------------------------------------- */
  function getRootDomain() {
    const host = window.location.hostname;
    if (!host || host === 'localhost' || /^[\d.]+$/.test(host)) return null;

    const parts = host.split('.');
    if (parts.length <= 2) return '.' + host;

    const tldsCompostos = ['com.br', 'com.mx', 'com.ar', 'co.uk', 'com.au', 'com.co'];
    const last2 = parts.slice(-2).join('.');
    if (tldsCompostos.includes(last2)) {
      return '.' + parts.slice(-3).join('.');
    }
    return '.' + parts.slice(-2).join('.');
  }

  const ROOT_DOMAIN = getRootDomain();

  /* -----------------------------------------------------------------
     Cookies — leitura e escrita
     ----------------------------------------------------------------- */
  function getCookie(name) {
    const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1');
    const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value, maxAgeSec) {
    let cookie = name + '=' + encodeURIComponent(value)
      + '; path=/'
      + '; max-age=' + maxAgeSec
      + '; SameSite=Lax';
    if (ROOT_DOMAIN) cookie += '; domain=' + ROOT_DOMAIN;
    if (window.location.protocol === 'https:') cookie += '; Secure';
    document.cookie = cookie;
  }

  /* -----------------------------------------------------------------
     1) _fbp — cria se não existir, formato fb.1.<ms>.<10 digitos>
     ----------------------------------------------------------------- */
  function ensureFbp() {
    const existente = getCookie('_fbp');
    if (existente) return existente;

    // 10 dígitos aleatórios (1_000_000_000 a 9_999_999_999)
    const rand = Math.floor(1000000000 + Math.random() * 9000000000);
    const fbp = 'fb.1.' + Date.now() + '.' + rand;
    setCookie('_fbp', fbp, COOKIE_MAX_AGE);
    return fbp;
  }

  /* -----------------------------------------------------------------
     Recupera fbclid: prioriza a URL atual e usa como fallback o
     sessionStorage populado por js/utmForward.js — assim não duplicamos
     a lógica de captura de parâmetros de campanha.
     ----------------------------------------------------------------- */
  function getFbclid() {
    // 1) URL atual (landing com ?fbclid=...)
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('fbclid');
      if (fromUrl) return fromUrl;
    } catch (_) {}

    // 2) sessionStorage persistido pelo utmForward.js — formato [[chave, valor], ...]
    try {
      const raw = sessionStorage.getItem(SS_TRACKING);
      if (!raw) return null;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return null;
      const found = arr.find((par) => Array.isArray(par) && par[0] === 'fbclid');
      return found ? found[1] : null;
    } catch (_) {
      return null;
    }
  }

  /* -----------------------------------------------------------------
     2) _fbc — cria a partir do fbclid, se disponível
     Formato: fb.1.<ms>.<fbclid>
     ----------------------------------------------------------------- */
  function ensureFbc() {
    const existente = getCookie('_fbc');
    if (existente) return existente;

    const fbclid = getFbclid();
    if (!fbclid) return null;

    const fbc = 'fb.1.' + Date.now() + '.' + fbclid;
    setCookie('_fbc', fbc, COOKIE_MAX_AGE);
    return fbc;
  }

  /* -----------------------------------------------------------------
     3) external_id — anônimo, criado uma vez e reutilizado
     Enviado em texto puro; o SHA-256 é feito no backend.
     ----------------------------------------------------------------- */
  function ensureExternalId() {
    try {
      let id = localStorage.getItem(LS_EXT_ID);
      if (id) return id;
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : ('ext-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12));
      localStorage.setItem(LS_EXT_ID, id);
      return id;
    } catch (_) {
      return null;
    }
  }

  /* -----------------------------------------------------------------
     4) event_id novo por pageview
     ----------------------------------------------------------------- */
  function newEventId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
  }

  /* -----------------------------------------------------------------
     5) Snippet base do Pixel (fbevents.js)
     Padrão oficial da Meta, mantido idêntico para não quebrar.
     Definir window.fbq acontece SÍNCRONO — dá para chamar fbq() logo
     depois desta função retornar.
     ----------------------------------------------------------------- */
  function loadPixelBase() {
    if (window.fbq) return;
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = !0; n.version = '2.0';
      n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  }

  /* -----------------------------------------------------------------
     6) Envio para a CAPI — falha silenciosa e keepalive:true
     ----------------------------------------------------------------- */
  function sendToCapi(payload) {
    if (!CAPI_ENDPOINT || CAPI_ENDPOINT.indexOf('PREENCHER') !== -1) return;
    try {
      fetch(CAPI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,   // continua mesmo se a página estiver sendo descarregada
        credentials: 'omit',
      }).catch(function () { /* silencioso — CAPI cair não pode quebrar o site */ });
    } catch (_) { /* silencioso */ }
  }

  /* -----------------------------------------------------------------
     Init
     Ordem crítica: fbp/fbc PRIMEIRO → depois carregar Pixel → depois
     init/track. Só assim o snippet oficial reaproveita os cookies que
     acabamos de setar (em vez de gerar novos, o que quebraria a
     deduplicação com o CAPI).
     ----------------------------------------------------------------- */
  function init() {
    const fbp = ensureFbp();
    const fbc = ensureFbc();
    const externalId = ensureExternalId();
    const eventId = newEventId();

    loadPixelBase();

    if (!PIXEL_ID || PIXEL_ID.indexOf('PREENCHER') !== -1) {
      // Ainda não configurado — nada a disparar.
      console.warn('[metaPixel] PIXEL_ID nao configurado');
      return;
    }

    // fbq fica disponível imediatamente após loadPixelBase (é síncrono).
    try {
      window.fbq('init', PIXEL_ID);
      window.fbq('track', 'PageView', {}, { eventID: eventId });
    } catch (e) {
      console.warn('[metaPixel] falha ao chamar fbq:', e && e.message);
    }

    // Envio server-side com o MESMO event_id.
    sendToCapi({
      event_id: eventId,
      event_name: 'PageView',
      event_source_url: window.location.href,
      fbp: fbp || undefined,
      fbc: fbc || undefined,
      external_id: externalId || undefined,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
