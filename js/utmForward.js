/* =====================================================================
   REPASSE DE PARÂMETROS DE CAMPANHA (UTMs e afins) → links do app/checkout

   O que faz:
   - Lê os parâmetros da URL de entrada (?utm_source=..., fbclid, gclid, sck...)
   - Guarda em sessionStorage, então continuam valendo ao navegar entre
     páginas do site (v1 → /v2, troca de idioma, etc.)
   - Repassa esses parâmetros para qualquer link que aponte para o app /
     checkout, tanto os fixos do HTML quanto os montados por JS.

   O que NÃO faz (de propósito):
   - Não repassa `lang` (interno do i18n) nem os parâmetros de cupom
     (coupon_code/coupon/cupom/cupon). O cupom de afiliado continua sendo
     tratado — e traduzido por idioma — em js/sectionPlanos.js.
   - Nunca sobrescreve um parâmetro que já exista no link de destino.

   API pública: window.Z7Tracking.decorate(href) → href com os parâmetros.
   ===================================================================== */
(function () {
  'use strict';

  const STORAGE_KEY = 'z7_tracking_params';
  const IGNORED = new Set(['lang', 'coupon_code', 'coupon', 'cupom', 'cupon']);
  const TARGET_HOSTS = new Set([
    'app.zero7trading.com',
    'membros.zero7trading.com',
    'app.zero7.com.br',
    'membros.zero7.com.br',
    'app.4selet.com.br',
    'app.4st.com.br',
  ]);

  let params = null; // [[chave, valor], ...]

  function lerStorage() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : null;
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function gravarStorage(lista) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lista)); }
    catch (_) {}
  }

  // Mescla o que veio na URL atual com o que já estava guardado na sessão.
  // A URL atual tem prioridade (campanha mais recente vence).
  function capturarParams() {
    const mapa = new Map();

    lerStorage().forEach(([k, v]) => {
      if (k && !IGNORED.has(k)) mapa.set(k, v);
    });

    try {
      new URLSearchParams(window.location.search).forEach((valor, chave) => {
        if (!chave || IGNORED.has(chave)) return;
        if (valor === '') return;
        mapa.set(chave, valor);
      });
    } catch (_) {}

    const lista = Array.from(mapa.entries());
    gravarStorage(lista);
    return lista;
  }

  function getParams() {
    if (!params) params = capturarParams();
    return params;
  }

  function isAlvo(url) {
    return TARGET_HOSTS.has(url.hostname) || /\/checkout\//i.test(url.pathname);
  }

  // Idempotente: pode ser chamada quantas vezes for, não duplica parâmetro.
  function decorate(href) {
    const lista = getParams();
    if (!href || !lista.length) return href;

    let url;
    try { url = new URL(href, window.location.href); }
    catch (_) { return href; }

    if (!/^https?:$/.test(url.protocol)) return href;

    lista.forEach(([chave, valor]) => {
      if (!url.searchParams.has(chave)) url.searchParams.set(chave, valor);
    });

    return url.toString();
  }

  function decorarLink(a) {
    if (!a) return;
    const bruto = a.getAttribute('href');
    if (!bruto || bruto.charAt(0) === '#') return;

    let url;
    try { url = new URL(bruto, window.location.href); }
    catch (_) { return; }
    if (!isAlvo(url)) return;

    const novo = decorate(url.href);
    if (novo && novo !== a.href) a.setAttribute('href', novo);
  }

  function decorarTodos() {
    document.querySelectorAll('a[href]').forEach(decorarLink);
  }

  // Passada inicial + rede de segurança para links criados/atualizados por JS:
  // decoramos também no momento da interação (clique, botão do meio, menu de
  // contexto para "copiar endereço do link").
  function iniciar() {
    if (!getParams().length) return;

    decorarTodos();

    const naInteracao = (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (a) decorarLink(a);
    };
    ['pointerdown', 'mousedown', 'click', 'auxclick', 'contextmenu'].forEach((evt) => {
      document.addEventListener(evt, naInteracao, true);
    });

    // Conteúdo assíncrono (cards de plano, modais) entra depois do load.
    window.addEventListener('load', decorarTodos);
    setTimeout(decorarTodos, 1500);
  }

  window.Z7Tracking = { decorate, getParams };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
