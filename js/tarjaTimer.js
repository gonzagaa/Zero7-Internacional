/* =====================================================================
   TARJA TIMER — contagem regressiva rotativa até a meia-noite local.

   Comportamento (inalterado):
   - Ao chegar em 00:00:00 o timer reinicia automaticamente e passa a
     contar até a próxima meia-noite. Loop infinito.
   - Só roda se o timer existir dentro de uma tarja ativa (o script inline
     do bloco remove a tarja do DOM se a campanha já expirou).
   - Pausa o setInterval quando a aba fica oculta e retoma quando volta.

   Apresentação:
   - Cada dígito vai numa célula de largura fixa (.ztarja__d) -> o timer
     nunca muda de largura.
   - Os números são aria-hidden; o leitor de tela recebe um aria-label
     com o tempo restante, atualizado a cada MINUTO (nunca por segundo).
   - Carregado com defer; não mexe em layout.
   ===================================================================== */
(function () {
  'use strict';

  const TIMER_SELECTOR = '.ztarja__timer';
  const TARJA_SELECTOR = '.ztarja';

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

  function tr(key, fallback) {
    try {
      const v = window.i18n && window.i18n.t && window.i18n.t(key);
      return v && v !== key ? v : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function rotuloAria(deltaMs) {
    const min = Math.floor(deltaMs / 60000);
    return tr('tarja.timer_aria', 'Tempo restante: {h} h e {m} min')
      .replace('{h}', Math.floor(min / 60))
      .replace('{m}', min % 60);
  }

  function atualizar(timerEl) {
    if (!timerEl.isConnected) { parar(); return; }   // tarja retirada

    const agora = new Date();
    let alvo = proximaMeiaNoite(agora);
    let delta = alvo.getTime() - agora.getTime();

    // Se por algum motivo delta ficou <= 0, avança para a próxima janela
    // de 24h (proteção contra edge case de meia-noite).
    if (delta <= 0) {
      alvo = new Date(alvo.getTime() + 24 * 60 * 60 * 1000);
      delta = alvo.getTime() - agora.getTime();
    }

    // dígitos (HHMMSS) nas células — só troca o que mudou
    const digitos = formatar(delta).replace(/:/g, '');
    const celulas = timerEl.querySelectorAll('.ztarja__d');
    for (let i = 0; i < celulas.length; i++) {
      if (celulas[i].textContent !== digitos[i]) celulas[i].textContent = digitos[i];
    }

    // leitor de tela: por minuto
    const minuto = Math.floor(delta / 60000);
    if (timerEl._minuto !== minuto) {
      timerEl._minuto = minuto;
      timerEl.setAttribute('aria-label', rotuloAria(delta));
    }
  }

  function iniciarTick(timerEl) {
    parar();
    atualizar(timerEl);
    tickInterval = setInterval(() => atualizar(timerEl), 1000);
  }

  function parar() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  function init() {
    const timerEl = document.querySelector(TIMER_SELECTOR);
    if (!timerEl) return;

    const tarja = timerEl.closest(TARJA_SELECTOR);
    if (!tarja || !tarja.isConnected) return;

    iniciarTick(timerEl);

    // Economia de CPU: pausa quando a aba fica em segundo plano.
    document.addEventListener('visibilitychange', () => {
      const el = document.querySelector(TIMER_SELECTOR);
      if (document.hidden || !el) parar();
      else iniciarTick(el);
    });

    // Troca de idioma: refaz o rótulo do leitor de tela no idioma novo.
    document.addEventListener('i18n:change', () => {
      const el = document.querySelector(TIMER_SELECTOR);
      if (el) { el._minuto = null; atualizar(el); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
