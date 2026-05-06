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

  const state = {
    dados: null,
    capital: '25k',
    modo: 'com_ativacao',
  };

  let refs = {};

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function $$(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  async function carregarDados() {
    const resp = await fetch(JSON_PATH, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`Falha ao carregar planos.json (${resp.status})`);
    return resp.json();
  }

  function obterCelula(key, fonte) {
    if (fonte === 'fixa') return state.dados.condicoesFixas[key];
    return state.dados.capitais[state.capital][key];
  }

  function fadeAndSwap(el, swap) {
    el.style.transition = 'opacity 200ms ease';
    el.style.opacity = '0';
    window.setTimeout(() => {
      swap();
      el.style.opacity = '1';
    }, 180);
  }

  function renderTabela() {
    const tbody = refs.tbody;
    if (!tbody) return;

    fadeAndSwap(refs.tableWrapper, () => {
      tbody.innerHTML = '';
      LINHAS.forEach(({ key, label, fonte }) => {
        const dados = obterCelula(key, fonte);
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td data-label="Condição">${label}</td>
          <td data-label="Desafio">${dados.desafio}</td>
          <td data-label="Incubadora">${dados.incubadora}</td>
        `;
        tbody.appendChild(tr);
      });
      refs.tableWrapper.dataset.capital = state.capital;
    });
  }

  function renderPreco() {
    const { precos } = state.dados.capitais[state.capital];
    const valor = state.modo === 'com_ativacao' ? precos.comAtivacao : precos.semAtivacao;
    const modoLabel = state.modo === 'com_ativacao'
      ? 'Desafio com taxa de ativação'
      : 'Desafio sem taxa de ativação';

    fadeAndSwap(refs.precoBloco, () => {
      refs.precoLabel.textContent = `${modoLabel} — ${state.capital}`;
      refs.precoValor.textContent = valor;
    });
  }

  function atualizarSelecionado(botoes, alvo) {
    botoes.forEach(btn => {
      const ativo = btn === alvo;
      btn.classList.toggle('selecionado', ativo);
      btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
  }

  function bindEventos() {
    refs.botoesModo.forEach(btn => {
      btn.addEventListener('click', () => {
        const modo = btn.dataset.mode;
        if (!modo || modo === state.modo) return;
        state.modo = modo;
        atualizarSelecionado(refs.botoesModo, btn);
        renderPreco();
      });
    });

    refs.botoesCapital.forEach(btn => {
      btn.addEventListener('click', () => {
        const capital = btn.dataset.capital;
        if (!capital || capital === state.capital) return;
        state.capital = capital;
        atualizarSelecionado(refs.botoesCapital, btn);
        renderTabela();
        renderPreco();
      });
    });
  }

  function inicializarRefs(secao) {
    refs.botoesModo = $$('.botoes button[data-mode]', secao);
    refs.botoesCapital = $$('.botoesPrice button[data-capital]', secao);
    refs.tableWrapper = $('.table-wrapper', secao);
    refs.tbody = $('.pricing-table tbody', secao);
    refs.precoBloco = $('.plano-preco', secao);
    refs.precoLabel = $('.plano-preco__label', secao);
    refs.precoValor = $('.plano-preco__valor', secao);
  }

  function definirAriaInicial() {
    refs.botoesModo.forEach(btn => {
      btn.setAttribute('aria-pressed', btn.classList.contains('selecionado') ? 'true' : 'false');
    });
    refs.botoesCapital.forEach(btn => {
      btn.setAttribute('aria-pressed', btn.classList.contains('selecionado') ? 'true' : 'false');
    });
  }

  function sincronizarEstadoComDOM() {
    const modoAtivo = refs.botoesModo.find(b => b.classList.contains('selecionado'));
    if (modoAtivo && modoAtivo.dataset.mode) state.modo = modoAtivo.dataset.mode;

    const capitalAtivo = refs.botoesCapital.find(b => b.classList.contains('selecionado'));
    if (capitalAtivo && capitalAtivo.dataset.capital) state.capital = capitalAtivo.dataset.capital;
  }

  async function init() {
    const secao = $(SECTION_SELECTOR);
    if (!secao) return;

    inicializarRefs(secao);
    if (!refs.tbody || !refs.precoBloco) return;

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

    renderTabela();
    renderPreco();
    bindEventos();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
