/* =====================================================================
   TARJA TOPO — comportamento. Carregado com defer; NÃO mexe em layout.

   - Altura reservada: CSS (.ztarja-espaco + --altura-tarja), desde o
     primeiro frame.
   - Fim da campanha: atributo data-fim do <aside class="ztarja">, em hora
     local. Se já expirou no carregamento, o script inline do próprio bloco
     remove a tarja e o espaço ANTES do primeiro paint.
   - Aqui ficam só: copiar o cupom e retirar a tarja se a campanha expirar
     com a página aberta (tarja e espaço saem juntos, no mesmo frame).
   - Copy: lang/{pt,en,es}.json -> "tarja". Visual: css/tarjaTopo.css.
   ===================================================================== */
(function () {
  'use strict';

  const SELECTOR = '.ztarja';
  const COPIADO_MS = 1500;

  function tr(key, fallback) {
    try {
      const v = window.i18n && window.i18n.t && window.i18n.t(key);
      return v && v !== key ? v : fallback;
    } catch (_) {
      return fallback;
    }
  }

  /* ---------------------------------------------------------------
     Cupom: o ticket inteiro copia o código e mostra "Copiado!" por 1,5s
     --------------------------------------------------------------- */
  function copiaFallback(texto) {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    return ok;
  }

  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto).then(
        () => true,
        () => copiaFallback(texto)
      );
    }
    return Promise.resolve(copiaFallback(texto));
  }

  function bindCupom(tarja) {
    const btn = tarja.querySelector('.ztarja__cupom');
    if (!btn) return;
    const sr = tarja.querySelector('.ztarja__sr');

    btn.addEventListener('click', () => {
      const codeEl = btn.querySelector('.ztarja__cupom-main b');
      const code = codeEl ? codeEl.textContent.trim() : '';
      if (!code) return;

      copiar(code).then((ok) => {
        if (!ok) return;
        btn.classList.add('is-copied');
        if (sr) sr.textContent = tr('tarja.copiado', 'Copiado!');
        clearTimeout(btn._copiadoTimer);
        btn._copiadoTimer = setTimeout(() => {
          btn.classList.remove('is-copied');
          if (sr) sr.textContent = '';
        }, COPIADO_MS);
      });
    });
  }

  /* ---------------------------------------------------------------
     Expiração com a página aberta: tarja e espaço reservado saem juntos.
     (Se o usuário estiver rolado, o scroll anchoring do navegador mantém
     o conteúdo visível parado.)
     --------------------------------------------------------------- */
  function retirar(tarja) {
    const espaco = tarja.nextElementSibling;
    requestAnimationFrame(() => {
      tarja.remove();
      if (espaco && espaco.classList.contains('ztarja-espaco')) espaco.remove();
    });
  }

  function agendarExpiracao(tarja) {
    const fim = Date.parse(tarja.getAttribute('data-fim') || '');
    if (!fim) return;

    const restante = fim - Date.now();
    if (restante <= 0) {
      retirar(tarja);
      return;
    }

    // setTimeout máx ~24.8 dias; trabalha em blocos de até 2h
    const MAX = 2 * 60 * 60 * 1000;
    setTimeout(() => agendarExpiracao(tarja), Math.min(restante, MAX));
  }

  function init() {
    const tarja = document.querySelector(SELECTOR);
    if (!tarja) return;
    bindCupom(tarja);
    agendarExpiracao(tarja);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
