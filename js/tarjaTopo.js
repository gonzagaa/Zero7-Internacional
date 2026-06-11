/* =====================================================================
   TARJA TOPO — lógica de ativação, medição e expiração.
   - Personalize a data/hora e o link no bloco TARJA_CONFIG abaixo.
   - Personalize a copy nos arquivos lang/{pt,en,es}.json -> "tarja".
   - Personalize as cores em css/tarjaTopo.css (CSS vars).
   ===================================================================== */
(function () {
  'use strict';

  const TARJA_CONFIG = {
    deadline: "2026-06-30T23:59:00", // data/hora local em que a tarja some
    link: "#plan" // destino do botão (âncora da section#plan)
  };

  const SELECTOR = '.tarja-topo';
  const BODY_CLASS = 'tarja-ativa';
  const CSS_VAR = '--tarja-h';

  let expireTimer = null;
  let resizeRaf = null;

  function parseDeadline(value) {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function setTarjaHeight(el) {
    if (!el) return;
    const h = Math.ceil(el.getBoundingClientRect().height);
    document.documentElement.style.setProperty(CSS_VAR, h + 'px');
  }

  function clearTarjaHeight() {
    document.documentElement.style.removeProperty(CSS_VAR);
  }

  function ativar(el) {
    if (!el) return;

    // aplica link do botão
    const btn = el.querySelector('.tarja-topo__btn');
    if (btn && TARJA_CONFIG.link) {
      btn.setAttribute('href', TARJA_CONFIG.link);
    }

    // mede antes de ativar (mas com visibilidade pra medir corretamente)
    el.style.visibility = 'visible';
    setTarjaHeight(el);
    el.style.visibility = ''; // volta ao default (CSS controla via classe)

    document.body.classList.add(BODY_CLASS);

    // remede após o próximo frame (fontes/i18n podem ter mudado a altura)
    requestAnimationFrame(() => setTarjaHeight(el));

    // remede de novo após i18n aplicar traduções (chega assíncrono)
    setTimeout(() => setTarjaHeight(el), 400);
    setTimeout(() => setTarjaHeight(el), 1200);
  }

  function desativar(el) {
    document.body.classList.remove(BODY_CLASS);
    // espera transição de slide-up antes de limpar a altura
    setTimeout(clearTarjaHeight, 500);
  }

  function agendarExpiracao(el, deadline) {
    if (expireTimer) {
      clearTimeout(expireTimer);
      expireTimer = null;
    }

    const agora = Date.now();
    const fim = deadline.getTime();
    const restante = fim - agora;

    if (restante <= 0) {
      desativar(el);
      return;
    }

    // setTimeout máx ~24.8 dias; trabalha em chunks pra ser robusto
    const MAX = 2 * 60 * 60 * 1000; // 2h
    const proximoTick = Math.min(restante, MAX);

    expireTimer = setTimeout(() => {
      if (Date.now() >= fim) {
        desativar(el);
      } else {
        agendarExpiracao(el, deadline);
      }
    }, proximoTick);
  }

  function bindResize(el) {
    window.addEventListener('resize', () => {
      if (!document.body.classList.contains(BODY_CLASS)) return;
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => setTarjaHeight(el));
    });

    // refletir mudanças de altura por troca de idioma / fontes
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => {
        if (document.body.classList.contains(BODY_CLASS)) setTarjaHeight(el);
      });
      ro.observe(el);
    }
  }

  function init() {
    const el = document.querySelector(SELECTOR);
    if (!el) return;

    const deadline = parseDeadline(TARJA_CONFIG.deadline);

    // sem deadline válido OU já expirou -> tarja some e nav volta ao padrão
    if (!deadline || Date.now() >= deadline.getTime()) {
      desativar(el);
      // remove do DOM pra não interferir
      if (el.parentNode) el.parentNode.removeChild(el);
      return;
    }

    ativar(el);
    bindResize(el);
    agendarExpiracao(el, deadline);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
