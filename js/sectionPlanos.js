(() => {
  const SECTION_SELECTOR = '#plan';
  const JSON_PATH = './data/planos.json';

  const LINHAS = [
    { key: 'contratos',    label: 'Contratos',        fonte: 'capital' },
    { key: 'minimoDias',   label: 'Mínimo de dias',   fonte: 'fixa' },
    { key: 'maximoDias',   label: 'Máximo de dias',   fonte: 'fixa' },
    { key: 'metaLucro',    label: 'Meta de lucro',    fonte: 'capital' },
    { key: 'drawdown',     label: 'Drawdown',         fonte: 'fixa' },
    { key: 'perdaTotal',   label: 'Perda total',      fonte: 'capital' },
    { key: 'taxaAtivacao', label: 'Taxa de ativação', fonte: 'capital' },
    { key: 'recompensa',   label: 'Recompensa',       fonte: 'fixa' },
  ];

  const EASE_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';
  const ROW_STAGGER_MS = 40;

  const state = {
    dados: null,
    capital: '25k',
    modo: 'com_ativacao',
    minimizado: false,
  };

  const refs = {};
  const anims = { tabela: null, valor: null, label: null, badge: null };
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
      ? 'Desafio com taxa de ativação'
      : 'Desafio sem taxa de ativação';
  }

  function precoTexto() {
    const { precos } = state.dados.capitais[state.capital];
    return state.modo === 'com_ativacao' ? precos.comAtivacao : precos.semAtivacao;
  }

  function badgeTexto() {
    return `Plano ${state.capital}`;
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

  async function fadeScaleSwap(el, novoTexto, animKey, opts = {}) {
    if (!el) return;
    if (el.textContent === novoTexto) return;

    const outDur = opts.outDur ?? 150;
    const inDur = opts.inDur ?? 180;
    const scale = opts.scale ?? 0.94;

    safeCancel(anims[animKey]);
    anims[animKey] = null;

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
    anims[animKey] = out;

    try { await out.finished; } catch (_) { return; }

    el.textContent = novoTexto;

    const inAnim = el.animate(
      [
        { opacity: 0, transform: `scale(${scale})` },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: inDur, easing: EASE_OUT, fill: 'forwards' }
    );
    anims[animKey] = inAnim;

    try {
      await inAnim.finished;
      try { inAnim.commitStyles(); } catch (_) {}
      inAnim.cancel();
    } catch (_) { return; }

    if (anims[animKey] === inAnim) anims[animKey] = null;
  }

  /* ============================================================
     Tabela
     ============================================================ */
  function isCurrency(v) {
    return typeof v === 'string' && v.trim().startsWith('$');
  }

  function tdAttrs(extra) {
    return extra ? ` class="${extra}"` : '';
  }

  function montarLinhas() {
    const tbody = refs.tbody;
    tbody.innerHTML = '';
    LINHAS.forEach(({ key, label, fonte }, i) => {
      const dados = obterCelula(key, fonte);
      const tr = document.createElement('tr');
      tr.style.setProperty('--row-index', i);
      const cDesafio = isCurrency(dados.desafio) ? 'cell--currency' : '';
      const cIncubadora = isCurrency(dados.incubadora) ? 'cell--currency' : '';
      tr.innerHTML = `
        <td data-label="Condição"><span class="cell-label">${label}</span></td>
        <td data-label="Desafio"${tdAttrs(cDesafio)}>${dados.desafio}</td>
        <td data-label="Incubadora"${tdAttrs(cIncubadora)}>${dados.incubadora}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function renderTabela({ animar = true } = {}) {
    const wrapper = refs.tableWrapper;
    if (!wrapper || !refs.tbody) return;

    if (!animar || prefersReducedMotion) {
      safeCancel(anims.tabela);
      anims.tabela = null;
      montarLinhas();
      wrapper.dataset.capital = state.capital;
      return;
    }

    safeCancel(anims.tabela);
    anims.tabela = null;

    const out = wrapper.animate(
      [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(8px)' },
      ],
      { duration: 200, easing: EASE_OUT, fill: 'forwards' }
    );
    anims.tabela = out;

    try { await out.finished; } catch (_) { return; }

    montarLinhas();
    wrapper.dataset.capital = state.capital;

    Array.from(refs.tbody.children).forEach((tr, i) => {
      tr.animate(
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        {
          duration: 350,
          delay: i * ROW_STAGGER_MS,
          easing: EASE_OUT,
          fill: 'backwards',
        }
      );
    });

    try { out.commitStyles(); } catch (_) {}
    out.cancel();

    const inWrapper = wrapper.animate(
      [
        { opacity: 0, transform: 'translateY(0)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 220, easing: EASE_OUT, fill: 'forwards' }
    );
    anims.tabela = inWrapper;

    try {
      await inWrapper.finished;
      try { inWrapper.commitStyles(); } catch (_) {}
      inWrapper.cancel();
    } catch (_) { return; }

    if (anims.tabela === inWrapper) anims.tabela = null;
  }

  /* ============================================================
     Price bar — atualizações dinâmicas
     ============================================================ */
  function renderPreco({ animar = true } = {}) {
    if (!refs.precoValor) return;
    if (animar) fadeScaleSwap(refs.precoValor, precoTexto(), 'valor', { scale: 0.95 });
    else refs.precoValor.textContent = precoTexto();
  }

  function renderLabel({ animar = true } = {}) {
    if (!refs.precoLabel) return;
    if (animar) fadeScaleSwap(refs.precoLabel, modoLabelTexto(), 'label', { outDur: 100, inDur: 120, scale: 0.98 });
    else refs.precoLabel.textContent = modoLabelTexto();
  }

  function renderBadge({ animar = true } = {}) {
    if (!refs.precoBadge) return;
    if (animar) fadeScaleSwap(refs.precoBadge, badgeTexto(), 'badge', { outDur: 100, inDur: 120, scale: 0.98 });
    else refs.precoBadge.textContent = badgeTexto();
  }

  /* ============================================================
     Price bar — visibilidade via IntersectionObserver
     ============================================================ */
  function setupBarVisibility(secao) {
    if (!refs.priceBar || !secao) return;
    if (typeof IntersectionObserver === 'undefined') {
      refs.priceBar.classList.add('price-bar--visible');
      document.body.classList.add('price-bar-visible');
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const visivel = entry.isIntersecting;
          refs.priceBar.classList.toggle('price-bar--visible', visivel);
          document.body.classList.toggle('price-bar-visible', visivel);
        });
      },
      { threshold: 0, rootMargin: '0px' }
    );
    observer.observe(secao);
  }

  /* ============================================================
     Price bar — minimizar (mobile)
     ============================================================ */
  function aplicarEstadoMinimizado() {
    refs.priceBar.classList.toggle('price-bar--minimized', state.minimizado);
    document.body.classList.toggle('price-bar-minimized', state.minimizado);
    if (refs.minimizeBtn) {
      refs.minimizeBtn.setAttribute(
        'aria-label',
        state.minimizado ? 'Expandir barra de preço' : 'Minimizar barra de preço'
      );
      refs.minimizeBtn.setAttribute('aria-expanded', state.minimizado ? 'false' : 'true');
    }
  }

  function setupMinimize() {
    if (!refs.priceBar) return;

    if (refs.minimizeBtn) {
      refs.minimizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.minimizado = !state.minimizado;
        aplicarEstadoMinimizado();
      });
    }

    refs.priceBar.addEventListener('click', (e) => {
      if (!state.minimizado) return;
      if (e.target.closest('.price-bar__minimize')) return;
      if (e.target.closest('.price-bar__cta')) return;
      state.minimizado = false;
      aplicarEstadoMinimizado();
    });
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
      renderPreco();
      renderLabel();
    }, 'is-active');

    bindSeg(refs.segCapital, refs.botoesCapital, 'capital', (capital) => {
      state.capital = capital;
      renderTabela();
      renderPreco();
      renderBadge();
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
    refs.tableWrapper = $('.table-wrapper', secao);
    refs.tbody = $('.pricing-table tbody', secao);

    refs.priceBar = $('#priceBar');
    refs.precoLabel = $('.price-bar__mode');
    refs.precoValor = $('.price-bar__price');
    refs.precoBadge = $('.price-bar__badge');
    refs.minimizeBtn = $('.price-bar__minimize');
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
    if (!refs.tbody || !refs.priceBar) return;

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

    renderTabela({ animar: false });
    renderPreco({ animar: false });
    renderLabel({ animar: false });
    renderBadge({ animar: false });

    ativarSeg(refs.segMode);
    ativarSeg(refs.segCapital);

    setupBarVisibility(secao);
    setupMinimize();
    bindEventos();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
