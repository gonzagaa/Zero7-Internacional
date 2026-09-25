/* =====================================================================
   TARJA TIMER — contagem regressiva rotativa até a meia-noite local.

   Comportamento:
   - Ao chegar em 00:00:00 o timer reinicia automaticamente e passa a
     contar até a próxima meia-noite. Loop infinito.
   - Só roda se o elemento .tarja-timer existir e a tarja-topo pai
     estiver visível (js/tarjaTopo.js pode ter removido a tarja do DOM
     se a data limite expirou).
   - Pausa o setInterval quando a aba fica oculta e retoma quando volta.
   ===================================================================== */
(function () {
  'use strict';

  const CLOCK_SELECTOR = '.tarja-timer__clock';
  const TARJA_SELECTOR = '.tarja-topo';

  let tickInterval = null;

  function proximaMeiaNoite(agora) {
    // Meia-noite LOCAL do dia seguinte — o timer chega em 00:00:00 e reseta.
    const alvo = new Date(agora);
    alvo.setHours(24, 0, 0, 0);
    return alvo;
  }

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function formatar(deltaMs) {
    if (deltaMs < 0) deltaMs = 0;
    const totalSeg = Math.floor(deltaMs / 1000);
    const h = Math.floor(totalSeg / 3600);
    const m = Math.floor((totalSeg % 3600) / 60);
    const s = totalSeg % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function atualizar(clockEl) {
    const agora = new Date();
    let alvo = proximaMeiaNoite(agora);
    let delta = alvo.getTime() - agora.getTime();

    // Se por algum motivo delta ficou <= 0, avança para a próxima janela
    // de 24h (proteção contra edge case de meia-noite).
    if (delta <= 0) {
      alvo = new Date(alvo.getTime() + 24 * 60 * 60 * 1000);
      delta = alvo.getTime() - agora.getTime();
    }

    clockEl.textContent = formatar(delta);
  }

  function iniciarTick(clockEl) {
    parar();
    atualizar(clockEl);
    tickInterval = setInterval(() => atualizar(clockEl), 1000);
  }

  function parar() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  function init() {
    const clockEl = document.querySelector(CLOCK_SELECTOR);
    if (!clockEl) return;

    // Se a tarja-topo pai foi removida (ex.: deadline expirado em
    // tarjaTopo.js), o timer não deve rodar sozinho.
    const tarja = clockEl.closest(TARJA_SELECTOR);
    if (!tarja || !tarja.isConnected) return;

    iniciarTick(clockEl);

    // Economia de CPU: pausa quando a aba fica em segundo plano.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        parar();
      } else if (document.querySelector(CLOCK_SELECTOR)) {
        iniciarTick(document.querySelector(CLOCK_SELECTOR));
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
