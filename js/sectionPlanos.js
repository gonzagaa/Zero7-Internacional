(() => {
  const SECTION_SELECTOR = '#plan';
  // Resolve relativo ao proprio script, para funcionar em paginas de subpastas (ex: /v2)
  const JSON_PATH = (document.currentScript && document.currentScript.src)
    ? new URL('../data/planos.json', document.currentScript.src).href
    : './data/planos.json';

  // Tópicos do card — cada linha lê os DOIS valores (.desafio e .incubadora).
  // Desafio e Conta Remunerada exibem exatamente os mesmos 8 tópicos, na mesma ordem.
  const LINHAS = [
    { key: 'contratos',    i18nKey: 'plan.linha_contratos',      fonte: 'capital' },
    { key: 'minimoDias',   i18nKey: 'plan.linha_minimo_dias',    fonte: 'fixa' },
    { key: 'maximoDias',   i18nKey: 'plan.linha_maximo_dias',    fonte: 'fixa' },
    { key: 'metaLucro',    i18nKey: 'plan.linha_meta_lucro',     fonte: 'capital' },
    { key: 'drawdown',     i18nKey: 'plan.linha_drawdown',       fonte: 'fixa' },
    { key: 'perdaTotal',   i18nKey: 'plan.linha_perda_total',    fonte: 'capital' },
    { key: 'taxaAtivacao', i18nKey: 'plan.linha_taxa_ativacao',  fonte: 'capital' },
    { key: 'recompensa',   i18nKey: 'plan.linha_recompensa',     fonte: 'fixa' },
  ];

  // Valores de placeholder no JSON que nunca devem aparecer crus
  const PLACEHOLDERS = new Set(['---', '—', '']);

  function getCurrentLang() {
    return (window.i18n && window.i18n.getLang && window.i18n.getLang()) || 'pt';
  }
  function tr(key) {
    return (window.i18n && window.i18n.t) ? window.i18n.t(key) : key;
  }
  function pick(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      const lang = getCurrentLang();
      return value[lang] || value.pt || value.en || value.es || '';
    }
    return String(value);
  }

  const EASE_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';
  const ROW_STAGGER_MS = 40;

  const state = {
    dados: null,
    capital: '25k',
    modo: 'com_ativacao',
  };

  const refs = {};
  const swapAnims = new WeakMap();
  let cardAnim = null;
  let prefersReducedMotion = false;
  let resizeRaf = null;

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  async function carregarDados() {
    const resp = await fetch(JSON_PATH, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`Falha ao carregar planos.json (${resp.status})`);
    return resp.json();
  }

  function obterCelula(key, fonte) {
    if (fonte === 'fixa') return state.dados.condicoesFixas[key];
    return state.dados.capitais[state.capital][key];
  }

  function modoLabelTexto() {
    return state.modo === 'com_ativacao'
      ? tr('plan.modo_label_com')
      : tr('plan.modo_label_sem');
  }

  function precoTexto() {
    const { precos } = state.dados.capitais[state.capital];
    return state.modo === 'com_ativacao' ? precos.comAtivacao : precos.semAtivacao;
  }

  function precoOriginalTexto() {
    const { precos } = state.dados.capitais[state.capital];
    return state.modo === 'com_ativacao' ? precos.comAtivacaoDe : precos.semAtivacaoDe;
  }

  function badgeTexto() {
    return tr('plan.badge').replace('{capital}', state.capital);
  }

  function checkoutHref() {
    const capital = state.dados?.capitais?.[state.capital];
    if (!capital?.checkout) return null;
    return state.modo === 'com_ativacao' ? capital.checkout.comAtivacao : capital.checkout.semAtivacao;
  }

  /* ============================================================
     Desconto dinâmico (pill) — parse de valores BR "$1.497,00"
     ============================================================ */
  function parseBRL(str) {
    if (typeof str !== 'string') return NaN;
    const limpo = str.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
    return parseFloat(limpo);
  }

  function descontoPct() {
    const de = parseBRL(precoOriginalTexto());
    const por = parseBRL(precoTexto());
    if (!isFinite(de) || !isFinite(por) || de <= 0 || por <= 0 || por >= de) return null;
    return Math.round((1 - por / de) * 100);
  }

  /* ============================================================
     Segmented control — blob deslizante
     ============================================================ */
  function posicionarBlob(seg) {
    if (!seg) return;
    const blob = $('.seg__blob', seg);
    const ativo = $('.seg__option.selecionado', seg);
    if (!blob || !ativo) return;
    const x = ativo.offsetLeft;
    const w = ativo.offsetWidth;
    blob.style.transform = `translate3d(${x}px, 0, 0)`;
    blob.style.width = `${w}px`;
  }

  function ativarSeg(seg) {
    if (!seg) return;
    posicionarBlob(seg);
    requestAnimationFrame(() => {
      seg.dataset.ready = 'true';
    });
  }

  function atualizarSelecionado(opcoes, alvo, classeAtiva = 'selecionado') {
    opcoes.forEach((opt) => {
      const ativo = opt === alvo;
      opt.classList.toggle(classeAtiva, ativo);
      opt.setAttribute('aria-checked', ativo ? 'true' : 'false');
      opt.tabIndex = ativo ? 0 : -1;
    });
  }

  /* ============================================================
     Animações utilitárias
     ============================================================ */
  function safeCancel(animation) {
    if (!animation) return;
    try { animation.commitStyles(); } catch (_) {}
    try { animation.cancel(); } catch (_) {}
  }

  async function fadeScaleSwap(el, novoTexto, opts = {}) {
    if (!el) return;
    if (el.textContent === novoTexto) return;

    const outDur = opts.outDur ?? 150;
    const inDur = opts.inDur ?? 180;
    const scale = opts.scale ?? 0.94;

    safeCancel(swapAnims.get(el));
    swapAnims.delete(el);

    if (prefersReducedMotion) {
      el.textContent = novoTexto;
      return;
    }

    const out = el.animate(
      [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: `scale(${scale})` },
      ],
      { duration: outDur, easing: EASE_OUT, fill: 'forwards' }
    );
    swapAnims.set(el, out);

    try { await out.finished; } catch (_) { return; }

    el.textContent = novoTexto;

    const inAnim = el.animate(
      [
        { opacity: 0, transform: `scale(${scale})` },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: inDur, easing: EASE_OUT, fill: 'forwards' }
    );
    swapAnims.set(el, inAnim);

    try {
      await inAnim.finished;
      try { inAnim.commitStyles(); } catch (_) {}
      inAnim.cancel();
    } catch (_) { return; }

    if (swapAnims.get(el) === inAnim) swapAnims.delete(el);
  }

  /* ============================================================
     Card — valores por tópico + montagem (desktop e mobile)
     ============================================================ */
  function valorMonetario(v) {
    return typeof v === 'string' && v.trim().startsWith('$');
  }

  // Resolve texto/tratamento de uma célula (por tópico e coluna).
  // Sem esconder linha — a paridade dos 8 tópicos é obrigatória.
  function valorCelula(key, cel, coluna) {
    let valor = pick(cel[coluna]);
    let highlight = false;
    let sublabel = '';

    if (coluna === 'desafio') {
      // Modo "sem taxa de ativação": a taxa do Desafio vira "—"
      if (key === 'taxaAtivacao' && state.modo === 'sem_ativacao') valor = '—';
    } else {
      // Coluna Incubadora — nunca mostrar "---" cru
      if (key === 'maximoDias' && PLACEHOLDERS.has(String(valor).trim())) {
        valor = tr('plan.valor_sem_limite');          // "Sem limite de dias"
        highlight = true;
      } else if (key === 'taxaAtivacao' && PLACEHOLDERS.has(String(valor).trim())) {
        valor = '—';                                   // conta remunerada não tem taxa
      } else if (key === 'recompensa') {
        highlight = true;                              // 90% em destaque verde (só o número)
      }
    }

    return { valor, highlight, sublabel, currency: valorMonetario(valor) };
  }

  // ---- Mobile: dois painéis, cada um com seus próprios rótulos ----
  function montarLista(ul, coluna) {
    if (!ul) return;
    ul.innerHTML = '';

    LINHAS.forEach(({ key, i18nKey, fonte }, i) => {
      const cel = obterCelula(key, fonte);
      const { valor, highlight, sublabel, currency } = valorCelula(key, cel, coluna);

      const li = document.createElement('li');
      li.className = 'plan-card__item' + (highlight ? ' plan-card__item--highlight' : '');
      li.style.setProperty('--row-index', i);

      const labelEl = document.createElement('span');
      labelEl.className = 'plan-card__item-label';
      labelEl.textContent = tr(i18nKey);

      const valueEl = document.createElement('span');
      valueEl.className = 'plan-card__item-value' + (currency ? ' plan-card__item-value--currency' : '');
      valueEl.append(valor);
      if (sublabel) {
        const sub = document.createElement('small');
        sub.className = 'plan-card__item-sub';
        sub.textContent = sublabel;
        valueEl.appendChild(sub);
      }

      li.appendChild(labelEl);
      li.appendChild(valueEl);
      ul.appendChild(li);
    });
  }

  // ---- Desktop: comparação de 3 colunas [Desafio · rótulo · Incubadora] ----
  function compareRotulo(texto) {
    const el = document.createElement('span');
    el.className = 'plan-card__clabel';
    el.textContent = texto;
    return el;
  }

  function compareValor(side, data) {
    // Valores longos ganham fonte menor p/ caber em UMA linha no box de largura fixa
    const longo = String(data.valor).length > 14;
    const el = document.createElement('span');
    el.className = `plan-card__cval plan-card__cval--${side}`
      + (data.highlight ? ' plan-card__cval--highlight' : '')
      + (data.currency ? ' plan-card__cval--currency' : '')
      + (longo ? ' plan-card__cval--long' : '');
    el.textContent = data.valor;
    return el;
  }

  function compareCabecalho(cls, texto, decorativo) {
    const el = document.createElement('span');
    el.className = 'plan-card__chead ' + cls;
    if (decorativo) el.setAttribute('aria-hidden', 'true');
    el.textContent = texto;
    return el;
  }

  function montarCompare() {
    const grid = refs.compareGrid;
    if (!grid) return;
    grid.innerHTML = '';

    // Cabeçalhos sobre as colunas de valor + seta ao centro
    grid.appendChild(compareCabecalho('plan-card__chead--challenge', tr('plan.card_desafio_titulo')));
    grid.appendChild(compareCabecalho('plan-card__chead--flow', '→', true));
    grid.appendChild(compareCabecalho('plan-card__chead--reward', tr('plan.card_incubadora_titulo')));

    LINHAS.forEach(({ key, i18nKey, fonte }) => {
      const cel = obterCelula(key, fonte);
      grid.appendChild(compareValor('challenge', valorCelula(key, cel, 'desafio')));
      grid.appendChild(compareRotulo(tr(i18nKey)));
      grid.appendChild(compareValor('reward', valorCelula(key, cel, 'incubadora')));
    });
  }

  async function renderCard({ animar = true } = {}) {
    const rebuild = () => {
      montarCompare();
      montarLista(refs.listaDesafio, 'desafio');
      montarLista(refs.listaIncubadora, 'incubadora');
      if (refs.card) {
        refs.card.dataset.capital = state.capital;
        refs.card.dataset.mode = state.modo;
      }
    };

    const wrapper = refs.comparison;

    if (!animar || prefersReducedMotion || !wrapper) {
      safeCancel(cardAnim);
      cardAnim = null;
      rebuild();
      return;
    }

    safeCancel(cardAnim);
    cardAnim = null;

    const out = wrapper.animate(
      [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(8px)' },
      ],
      { duration: 200, easing: EASE_OUT, fill: 'forwards' }
    );
    cardAnim = out;

    try { await out.finished; } catch (_) { return; }

    rebuild();

    try { out.commitStyles(); } catch (_) {}
    out.cancel();

    const inWrapper = wrapper.animate(
      [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 240, easing: EASE_OUT, fill: 'forwards' }
    );
    cardAnim = inWrapper;

    try {
      await inWrapper.finished;
      try { inWrapper.commitStyles(); } catch (_) {}
      inWrapper.cancel();
    } catch (_) { return; }

    if (cardAnim === inWrapper) cardAnim = null;
  }

  /* ============================================================
     Render do card
     ============================================================ */
  function renderPreco({ animar = true } = {}) {
    if (!refs.cardPrice) return;
    const texto = precoTexto();
    if (animar) fadeScaleSwap(refs.cardPrice, texto, { scale: 0.95 });
    else refs.cardPrice.textContent = texto;
  }

  function renderLabel({ animar = true } = {}) {
    if (!refs.cardMode) return;
    const texto = modoLabelTexto();
    if (animar) fadeScaleSwap(refs.cardMode, texto, { outDur: 100, inDur: 120, scale: 0.98 });
    else refs.cardMode.textContent = texto;
  }

  function renderPrecoOriginal({ animar = true } = {}) {
    if (!refs.cardPriceFrom) return;
    const texto = precoOriginalTexto();
    if (!texto) {
      // Sem preço "de": esconde riscado + pill (a linha inteira some)
      refs.cardPriceFrom.textContent = '';
      refs.cardPriceFrom.hidden = true;
      if (refs.cardPriceLine) refs.cardPriceLine.hidden = true;
      return;
    }
    if (refs.cardPriceLine) refs.cardPriceLine.hidden = false;
    refs.cardPriceFrom.hidden = false;
    if (animar) fadeScaleSwap(refs.cardPriceFrom, texto, { outDur: 130, inDur: 160, scale: 0.96 });
    else refs.cardPriceFrom.textContent = texto;
  }

  function renderBadge({ animar = true } = {}) {
    if (!refs.cardBadge) return;
    const texto = badgeTexto();
    if (animar) fadeScaleSwap(refs.cardBadge, texto, { outDur: 100, inDur: 120, scale: 0.98 });
    else refs.cardBadge.textContent = texto;
  }

  function renderDiscount() {
    if (!refs.cardDiscount) return;
    const pct = descontoPct();
    if (pct == null) {
      refs.cardDiscount.hidden = true;
      refs.cardDiscount.textContent = '';
      return;
    }
    refs.cardDiscount.hidden = false;
    refs.cardDiscount.textContent = tr('plan.card_desconto').replace('{pct}', pct);
  }

  function renderCheckoutHref() {
    if (!refs.cardCta) return;
    const href = checkoutHref();
    if (href) refs.cardCta.setAttribute('href', href);
  }

  function renderTudo({ animar = true } = {}) {
    renderCard({ animar });
    renderPreco({ animar });
    renderPrecoOriginal({ animar });
    renderLabel({ animar });
    renderBadge({ animar });
    renderDiscount();
    renderCheckoutHref();
  }

  /* ============================================================
     Eventos dos segmented controls
     ============================================================ */
  function bindSeg(seg, opcoes, dataKey, onChange, classeAtiva = 'selecionado') {
    if (!seg) return;
    opcoes.forEach((opt, idx) => {
      opt.addEventListener('click', () => {
        const valor = opt.dataset[dataKey];
        if (!valor || opt.classList.contains(classeAtiva)) return;
        atualizarSelecionado(opcoes, opt, classeAtiva);
        posicionarBlob(seg);
        onChange(valor);
      });

      opt.addEventListener('keydown', (e) => {
        const isNext = e.key === 'ArrowRight' || e.key === 'ArrowDown';
        const isPrev = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
        if (!isNext && !isPrev) return;
        e.preventDefault();
        const next = isNext
          ? opcoes[(idx + 1) % opcoes.length]
          : opcoes[(idx - 1 + opcoes.length) % opcoes.length];
        next.focus();
        next.click();
      });
    });
  }

  function bindEventos() {
    bindSeg(refs.segMode, refs.botoesModo, 'mode', (modo) => {
      state.modo = modo;
      renderTudo({ animar: true });
    }, 'is-active');

    bindSeg(refs.segCapital, refs.botoesCapital, 'capital', (capital) => {
      state.capital = capital;
      renderTudo({ animar: true });
    });

    window.addEventListener('resize', () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        const prev = refs.segMode?.dataset.ready;
        const prev2 = refs.segCapital?.dataset.ready;
        if (refs.segMode) refs.segMode.dataset.ready = 'false';
        if (refs.segCapital) refs.segCapital.dataset.ready = 'false';
        posicionarBlob(refs.segMode);
        posicionarBlob(refs.segCapital);
        requestAnimationFrame(() => {
          if (refs.segMode && prev) refs.segMode.dataset.ready = prev;
          if (refs.segCapital && prev2) refs.segCapital.dataset.ready = prev2;
        });
      });
    });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        posicionarBlob(refs.segMode);
        posicionarBlob(refs.segCapital);
      });
    }
  }

  /* ============================================================
     Init
     ============================================================ */
  function inicializarRefs(secao) {
    refs.segMode = $('.mode-toggle', secao);
    refs.segCapital = $('.seg--capital', secao);
    refs.botoesModo = $$('.mode-toggle .mode-toggle__btn[data-mode]', secao);
    refs.botoesCapital = $$('.seg--capital .seg__option[data-capital]', secao);

    refs.card = $('.plan-card', secao);
    refs.comparison = $('.plan-card__comparison', secao);
    refs.compareGrid = $('.plan-card__compare', secao);
    refs.cardBadge = $('.plan-card__badge', secao);
    refs.cardDiscount = $('.plan-card__discount', secao);
    refs.cardPriceLine = $('.plan-card__price-line', secao);
    refs.cardPriceFrom = $('.plan-card__price-from', secao);
    refs.cardPrice = $('.plan-card__price', secao);
    refs.cardMode = $('.plan-card__mode', secao);
    refs.cardCta = $('.plan-card__cta', secao);
    refs.listaDesafio = $('.plan-card__list[data-block="desafio"]', secao);
    refs.listaIncubadora = $('.plan-card__list[data-block="incubadora"]', secao);
  }

  function sincronizarEstadoComDOM() {
    const modoAtivo = refs.botoesModo.find((b) => b.classList.contains('is-active'));
    if (modoAtivo?.dataset.mode) state.modo = modoAtivo.dataset.mode;
    const capitalAtivo = refs.botoesCapital.find((b) => b.classList.contains('selecionado'));
    if (capitalAtivo?.dataset.capital) state.capital = capitalAtivo.dataset.capital;
  }

  function definirAriaInicial() {
    refs.botoesModo.forEach((btn) => {
      const ativo = btn.classList.contains('is-active');
      btn.setAttribute('aria-checked', ativo ? 'true' : 'false');
      btn.tabIndex = ativo ? 0 : -1;
    });
    refs.botoesCapital.forEach((btn) => {
      const ativo = btn.classList.contains('selecionado');
      btn.setAttribute('aria-checked', ativo ? 'true' : 'false');
      btn.tabIndex = ativo ? 0 : -1;
    });
  }

  async function init() {
    const secao = $(SECTION_SELECTOR);
    if (!secao) return;

    inicializarRefs(secao);
    if (!refs.card) return;

    prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.addEventListener) {
      mq.addEventListener('change', (e) => { prefersReducedMotion = e.matches; });
    }

    sincronizarEstadoComDOM();
    definirAriaInicial();

    try {
      state.dados = await carregarDados();
    } catch (err) {
      console.error('[sectionPlanos]', err);
      return;
    }

    if (!state.dados.capitais[state.capital]) {
      state.capital = Object.keys(state.dados.capitais)[0];
    }

    renderTudo({ animar: false });

    ativarSeg(refs.segMode);
    ativarSeg(refs.segCapital);

    bindEventos();

    document.addEventListener('i18n:change', () => {
      if (!state.dados) return;
      renderTudo({ animar: false });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
