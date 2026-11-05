/* =====================================================================
   CAMPANHA — tarja + faixa dos planos (defer). Lê window.Z7_CAMPANHA
   (js/campanha.js). Sem campanha ativa, não faz nada.

   - Timers (tarja e faixa): contam até a meia-noite local e reiniciam
     (comportamento de sempre). Só o dígito que muda entra de baixo
     (translateY 40% -> 0 + opacidade, 250ms). Última hora: âmbar.
     Leitor de tela recebe o tempo por MINUTO, nunca por segundo.
   - "87" conta de 0 a 87 uma vez (largura travada: nada se mexe).
   - Cupom: copia o código e mostra "Copiado!".
   - Animações pausam com a aba oculta e quando a tarja/faixa sai da tela.
   - CTA da tarja: garante o 50k selecionado ao chegar em #plan.
   - O fim da campanha durante a visita não remove nada (sem salto de
     layout); na próxima carga, js/campanha.js já não liga a campanha.
   ===================================================================== */
(function () {
  'use strict';
  var C = window.Z7_CAMPANHA;
  if (!C || !C.ativa) return;

  var reduz = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function tr(key, fb) {
    try { var v = window.i18n && window.i18n.t && window.i18n.t(key); return v && v !== key ? v : fb; }
    catch (_) { return fb; }
  }

  /* ---------- números e código vindos do objeto da campanha ---------- */
  function sincronizar() {
    $$('[data-camp-num]').forEach(function (el) {
      if (el._contando) return;
      var v = C.pct[el.getAttribute('data-camp-num')];
      if (v != null && el.textContent !== String(v)) el.textContent = v;
    });
    $$('[data-camp-code]').forEach(function (el) {
      if (el.textContent !== C.cupom) el.innerHTML = String(C.cupom).replace(/0/g, '<span class="z0">0</span>');
    });
  }

  /* ---------- timers ---------- */
  var timers = [], tick = null;
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function restante() {
    var agora = new Date(), alvo = new Date(agora);
    alvo.setHours(24, 0, 0, 0);
    return Math.max(0, alvo - agora);
  }
  function pintar(el, d, animar) {
    var s = Math.floor(d / 1000);
    var txt = pad(Math.floor(s / 3600)) + pad(Math.floor(s % 3600 / 60)) + pad(s % 60);
    var cel = el._cel || (el._cel = $$('.zbk__d', el));
    for (var i = 0; i < cel.length; i++) {
      var atual = cel[i].firstElementChild;
      if (atual && atual.textContent === txt[i]) continue;
      var novo = document.createElement('i');
      novo.textContent = txt[i];
      cel[i].replaceChildren(novo);
      if (animar && !reduz && novo.animate) {
        novo.animate([{ transform: 'translateY(40%)', opacity: 0 }, { transform: 'none', opacity: 1 }],
          { duration: 250, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      }
    }
    el.classList.toggle('is-final', d < 3600000);
    el.classList.add('is-pronto');
    var min = Math.floor(d / 60000);
    if (el._min !== min) {
      el._min = min;
      el.setAttribute('aria-label', tr('camp.timer_aria', 'Tempo restante: {h} h e {m} min')
        .replace('{h}', Math.floor(min / 60)).replace('{m}', min % 60));
    }
  }
  function rodar(primeira) { var d = restante(); timers.forEach(function (el) { pintar(el, d, !primeira); }); }
  function ligar() { desligar(); rodar(true); tick = setInterval(function () { rodar(false); }, 1000); }
  function desligar() { if (tick) { clearInterval(tick); tick = null; } }

  /* ---------- 87: conta de 0 a 87 uma vez ---------- */
  function contar() {
    var els = $$('.zbk .zbk__count');               // o número + a cópia do brilho
    if (!els.length || reduz) return;
    var alvo = C.pct.ate;
    var w = els.map(function (el) { return el.getBoundingClientRect().width; });
    els.forEach(function (el, i) { el.style.minWidth = w[i] + 'px'; el._contando = true; });
    var t0 = performance.now(), dur = 900;
    (function passo(t) {
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3), v = Math.round(alvo * e);
      els.forEach(function (el) { el.textContent = v; if (p >= 1) el._contando = false; });
      if (p < 1) requestAnimationFrame(passo);
    })(t0);
  }

  /* ---------- cupom ---------- */
  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto).then(function () { return true; }, function () { return copiarAntigo(texto); });
    }
    return Promise.resolve(copiarAntigo(texto));
  }
  function copiarAntigo(texto) {
    var ta = document.createElement('textarea');
    ta.value = texto; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta); return ok;
  }
  function ligarCupom() {
    $$('[data-camp-cupom]').forEach(function (btn) {
      var sr = btn.parentNode.querySelector('.zbk__sr'), t = null;
      btn.addEventListener('click', function () {
        copiar(C.cupom).then(function (ok) {
          if (!ok) return;
          btn.classList.add('is-copied');
          if (sr) sr.textContent = tr('camp.copiado_sr', 'Cupom ' + C.cupom + ' copiado');
          clearTimeout(t);
          t = setTimeout(function () { btn.classList.remove('is-copied'); if (sr) sr.textContent = ''; }, 1800);
        });
      });
    });
  }

  /* ---------- pausas ---------- */
  function ligarPausas() {
    document.addEventListener('visibilitychange', function () {
      document.documentElement.classList.toggle('camp-pausa', document.hidden);
      if (document.hidden) desligar(); else ligar();
    });
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.target.classList.toggle('is-fora', !e.isIntersecting); });
    });
    $$('.zbk, .zbk-faixa').forEach(function (el) { io.observe(el); });
  }

  /* ---------- eclipse: centralizado sob o número por transform (não é layout -> sem CLS) ---------- */
  var ecRaf = null;
  function posicionarEclipses() {
    $$('.zbk__eclipse').forEach(function (ec) {
      var box = ec.parentElement, num = box && box.querySelector('.zbk__pct, .zbk-faixa__gold');
      if (!num || !num.getClientRects().length) return;
      var r = num.getBoundingClientRect(), c = box.getBoundingClientRect();
      ec.style.setProperty('--ecl-x', Math.round(r.left + r.width / 2 - (c.left + c.width / 2)) + 'px');
      ec.style.setProperty('--ecl-y', Math.round(r.bottom - c.top) + 'px');
      ec.classList.add('is-pos');
    });
  }
  function reposicionar() { if (ecRaf) cancelAnimationFrame(ecRaf); ecRaf = requestAnimationFrame(posicionarEclipses); }

  /* ---------- CTA da tarja: chega em #plan já no 50k ---------- */
  function ligarCta() {
    $$('[data-camp-ir]').forEach(function (a) {
      a.addEventListener('click', function () {
        var b = $('#plan .seg--capital [data-capital="' + C.destaque.capital + '"]');
        if (b && !b.disabled && !b.classList.contains('selecionado')) b.click();
      });
    });
  }

  function init() {
    sincronizar();
    timers = $$('.zbk__timer');
    ligar();
    posicionarEclipses();
    var liberado = false;
    function liberar() {                                   // fontes prontas (ou 1,5s): mostra a oferta
      if (liberado) return; liberado = true;
      $$('.zbk').forEach(function (z) { z.classList.add('is-fontes'); });
      contar(); reposicionar();
    }
    // pede explicitamente as faces da tarja (fonts.ready resolve antes de o 800 ser pedido)
    var faces = ['800 40px "Zalando Sans Expanded"', '700 13px "Zalando Sans Expanded"', '600 15px "TT Fors Trial"', '700 11px "TT Fors Trial"'];
    if (document.fonts && document.fonts.load) {
      Promise.all(faces.map(function (f) { return document.fonts.load(f).catch(function () {}); }))
        .then(function () { return document.fonts.ready; }).then(liberar, liberar);
    } else liberar();
    setTimeout(liberar, 2500);
    window.addEventListener('resize', reposicionar);
    ligarCupom();
    ligarPausas();
    ligarCta();
    document.addEventListener('i18n:change', function () {
      sincronizar();
      timers.forEach(function (el) { el._min = null; });
      rodar(true);
      reposicionar();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
