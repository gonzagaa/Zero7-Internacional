(function () {
  'use strict';

  const ZENDESK_BASE = 'https://help.zero7trading.com/api/v2/help_center';
  const ZENDESK_LOCALES = { pt: 'pt-br', en: 'en-001', es: 'es-419' };
  const ZENDESK_HELP_URLS = {
    pt: 'https://help.zero7trading.com/hc/pt-br',
    en: 'https://help.zero7trading.com/hc/en-001',
    es: 'https://help.zero7trading.com/hc/es-419'
  };

  function getCurrentLang() {
    return (window.i18n && window.i18n.getLang && window.i18n.getLang()) || 'pt';
  }
  function getZendeskLocale() {
    return ZENDESK_LOCALES[getCurrentLang()] || 'pt-br';
  }
  function getZendeskHelpUrl() {
    return ZENDESK_HELP_URLS[getCurrentLang()] || ZENDESK_HELP_URLS.pt;
  }
  function tr(key) {
    return (window.i18n && window.i18n.t) ? window.i18n.t(key) : key;
  }

  const PER_PAGE = 100;
  const SEARCH_DEBOUNCE_MS = 350;
  const SEARCH_MIN_CHARS = 2;
  const CATEGORIES_PER_PAGE = 6;

  const state = {
    categories: [],
    allCategories: [],
    sections: [],
    articles: [],
    sectionsByCategory: new Map(),
    articlesBySection: new Map(),
    articleCountByCategory: new Map(),
    currentPage: 1,
    activeCategoryId: null,
    searchAbort: null,
    searchTimer: null,
    lastFocused: null,
  };

  const el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function init() {
    el.section = document.getElementById('faq');
    el.categories = $('faqCategories');
    el.results = $('faqResults');
    el.resultsList = $('faqResultsList');
    el.resultsCount = $('faqResultsCount');
    el.searchInput = $('faqSearch');
    el.searchLoading = document.querySelector('.faq__search-loading');
    el.clearBtn = $('faqClearSearch');
    el.modal = $('faqModal');
    el.modalTitle = $('faqModalTitle');
    el.modalBody = $('faqModalBody');
    el.modalBreadcrumb = $('faqModalBreadcrumb');
    el.modalSource = $('faqModalSource');
    el.modalPanel = el.modal ? el.modal.querySelector('.faq__modal-panel') : null;
    if (el.modalPanel) el.modalPanel.setAttribute('data-lenis-prevent', '');
    el.pagination = $('faqPagination');
    el.pageCurrent = $('faqPageCurrent');
    el.pageTotal = $('faqPageTotal');
    el.prevBtn = $('faqPrev');
    el.nextBtn = $('faqNext');

    if (!el.categories || !el.searchInput) return;

    el.centralLink = $('faqCentralLink');

    bindEvents();
    updateCentralLink();

    document.addEventListener('i18n:change', onLangChange);

    if (getCurrentLang() && window.i18n && window.i18n.getLang && window.i18n.getLang()) {
      loadHelpCenter();
    }
  }

  function updateCentralLink() {
    const link = el.centralLink || document.getElementById('faqCentralLink');
    if (link) link.setAttribute('href', getZendeskHelpUrl());
  }

  async function onLangChange() {
    if (state.searchAbort) {
      state.searchAbort.abort();
      state.searchAbort = null;
    }
    if (state.searchTimer) {
      clearTimeout(state.searchTimer);
      state.searchTimer = null;
    }
    if (el.searchInput) el.searchInput.value = '';
    if (el.results) el.results.hidden = true;
    if (el.resultsList) el.resultsList.innerHTML = '';
    if (el.categories) el.categories.hidden = false;
    hideSpinner();

    state.categories = [];
    state.allCategories = [];
    state.sections = [];
    state.articles = [];
    state.sectionsByCategory = new Map();
    state.articlesBySection = new Map();
    state.articleCountByCategory = new Map();
    state.currentPage = 1;
    state.activeCategoryId = null;

    closeExpandedPanel();
    updateCentralLink();

    if (el.categories) {
      el.categories.innerHTML =
        '<div class="faq__skeleton-grid">' +
          '<div class="faq__skeleton-card"></div>' +
          '<div class="faq__skeleton-card"></div>' +
          '<div class="faq__skeleton-card"></div>' +
          '<div class="faq__skeleton-card"></div>' +
        '</div>';
    }

    await loadHelpCenter();
  }

  function getCategoriesPerPage() {
    return CATEGORIES_PER_PAGE;
  }

  function getScrollbarWidth() {
    return Math.max(0, window.innerWidth - document.documentElement.clientWidth);
  }

  function bindEvents() {
    el.searchInput.addEventListener('input', onSearchInput);

    el.clearBtn.addEventListener('click', function () {
      el.searchInput.value = '';
      el.searchInput.focus();
      cancelSearchRequest();
      hideSpinner();
      state.currentPage = 1;
      resetToCategories();
      renderCategoriesPage();
    });

    el.modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-faq-close]')) {
        closeModal();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.modal.classList.contains('is-open')) {
        closeModal();
      }
    });

    if (el.prevBtn) {
      el.prevBtn.addEventListener('click', function () { goToPage(state.currentPage - 1); });
    }
    if (el.nextBtn) {
      el.nextBtn.addEventListener('click', function () { goToPage(state.currentPage + 1); });
    }
  }

  async function fetchJson(url, signal) {
    const res = await fetch(url, {
      signal: signal,
      cache: 'no-cache',
    });
    if (!res.ok) {
      throw new Error('Zendesk request failed: ' + res.status + ' ' + url);
    }
    return res.json();
  }

  async function loadHelpCenter() {
    try {
      const locale = getZendeskLocale();
      const [catRes, secRes, artRes] = await Promise.all([
        fetchJson(ZENDESK_BASE + '/' + locale + '/categories.json?page[size]=' + PER_PAGE),
        fetchJson(ZENDESK_BASE + '/' + locale + '/sections.json?page[size]=' + PER_PAGE),
        fetchJson(ZENDESK_BASE + '/' + locale + '/articles.json?page[size]=' + PER_PAGE),
      ]);

      state.categories = Array.isArray(catRes.categories) ? catRes.categories : [];
      state.sections = Array.isArray(secRes.sections) ? secRes.sections : [];
      state.articles = Array.isArray(artRes.articles) ? artRes.articles : [];

      indexData();
      state.allCategories = state.categories.map(function (c) {
        return Object.assign({}, c, {
          _articleCount: state.articleCountByCategory.get(c.id) || 0
        });
      });
      state.currentPage = 1;
      renderCategoriesPage();
    } catch (err) {
      console.warn('[faq] Falha ao carregar Central de Ajuda do Zendesk:', err);
      renderFallback();
    }
  }

  function indexData() {
    state.sectionsByCategory.clear();
    state.articlesBySection.clear();
    state.articleCountByCategory.clear();

    state.sections.forEach(function (sec) {
      if (!state.sectionsByCategory.has(sec.category_id)) {
        state.sectionsByCategory.set(sec.category_id, []);
      }
      state.sectionsByCategory.get(sec.category_id).push(sec);
    });

    state.articles.forEach(function (art) {
      if (!state.articlesBySection.has(art.section_id)) {
        state.articlesBySection.set(art.section_id, []);
      }
      state.articlesBySection.get(art.section_id).push(art);
    });

    state.categories.forEach(function (cat) {
      const secs = state.sectionsByCategory.get(cat.id) || [];
      let count = 0;
      secs.forEach(function (s) {
        const arts = state.articlesBySection.get(s.id) || [];
        count += arts.length;
      });
      state.articleCountByCategory.set(cat.id, count);
    });
  }

  function pluralizeArticles(n) {
    const key = n === 1 ? 'faq.js.artigo_um' : 'faq.js.artigo_muitos';
    return tr(key).replace('{n}', n);
  }

  function pluralizeResults(n) {
    const key = n === 1 ? 'faq.js.resultado_um' : 'faq.js.resultado_muitos';
    return tr(key).replace('{n}', n);
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function truncate(str, max) {
    if (!str) return '';
    if (str.length <= max) return str;
    return str.slice(0, max).trim() + '…';
  }

  /* ========== GRID + PAGINAÇÃO ========== */

  function renderCategoriesPage() {
    if (!state.allCategories.length) {
      renderFallback();
      renderPagination(0);
      return;
    }

    const perPage = getCategoriesPerPage();
    const totalPages = Math.max(1, Math.ceil(state.allCategories.length / perPage));
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;

    const start = (state.currentPage - 1) * perPage;
    const pageCategories = state.allCategories.slice(start, start + perPage);

    renderCategoryCards(pageCategories);
    renderPagination(totalPages);
  }

  function renderCategoryCards(pageCategories) {
    el.categories.innerHTML = '';
    const frag = document.createDocumentFragment();

    pageCategories.forEach(function (cat) {
      const count = state.articleCountByCategory.get(cat.id) || 0;
      const card = document.createElement('div');
      card.className = 'faq__category-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-expanded', 'false');
      card.dataset.categoryId = String(cat.id);

      if (state.activeCategoryId === cat.id) {
        card.classList.add('is-active');
        card.setAttribute('aria-expanded', 'true');
      }

      const descRaw = (cat.description || '').trim();
      const desc = descRaw ? stripHtml(descRaw) : pluralizeArticles(count);

      card.innerHTML =
        '<div class="faq__category-head">' +
          '<div class="faq__category-info">' +
            '<span class="faq__category-name">' + escapeHtml(cat.name) + '</span>' +
            '<span class="faq__category-desc">' + escapeHtml(truncate(desc, 120)) + '</span>' +
          '</div>' +
          '<span class="faq__category-count">' + pluralizeArticles(count) + '</span>' +
          '<ion-icon class="faq__category-chevron" name="chevron-down-outline"></ion-icon>' +
        '</div>';

      const activate = function () { toggleExpandedPanel(cat.id); };

      card.addEventListener('click', activate);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });

      frag.appendChild(card);
    });

    el.categories.appendChild(frag);
  }

  function renderPagination(totalPages) {
    if (!el.pagination) return;
    if (totalPages <= 1) {
      el.pagination.hidden = true;
      return;
    }
    el.pagination.hidden = false;
    if (el.pageCurrent) el.pageCurrent.textContent = String(state.currentPage);
    if (el.pageTotal) el.pageTotal.textContent = String(totalPages);
    if (el.prevBtn) el.prevBtn.disabled = state.currentPage <= 1;
    if (el.nextBtn) el.nextBtn.disabled = state.currentPage >= totalPages;
  }

  function goToPage(target) {
    const perPage = getCategoriesPerPage();
    const totalPages = Math.max(1, Math.ceil(state.allCategories.length / perPage));
    const next = Math.min(totalPages, Math.max(1, target));
    if (next === state.currentPage) return;
    state.currentPage = next;
    closeExpandedPanel();
    renderCategoriesPage();
    scrollToSectionTop();
  }

  function scrollToSectionTop() {
    if (!el.section) return;
    try {
      el.section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      el.section.scrollIntoView();
    }
  }

  function getStickyOffset() {
    let total = 0;
    const tarja = document.querySelector('.tarja-topo');
    if (tarja) total += tarja.getBoundingClientRect().height;
    const nav = document.getElementById('navigation');
    if (nav) {
      const cs = window.getComputedStyle(nav);
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        total += nav.getBoundingClientRect().height;
      }
    }
    // pequena folga estética
    return total + 16;
  }

  function smoothScrollTo(target, extraOffset) {
    if (!target) return;
    const extra = typeof extraOffset === 'number' ? extraOffset : 0;
    const off = -getStickyOffset() + extra;
    if (window.lenis && typeof window.lenis.scrollTo === 'function') {
      try {
        window.lenis.scrollTo(target, { offset: off, duration: 1.1 });
        return;
      } catch (e) { /* fallback abaixo */ }
    }
    try {
      const rect = target.getBoundingClientRect();
      const top = rect.top + window.pageYOffset + off;
      window.scrollTo({ top: top, behavior: 'smooth' });
    } catch (e) {
      target.scrollIntoView();
    }
  }

  /* ========== PAINEL DE EXPANSÃO ========== */

  function ensureExpandedPanel() {
    let panel = $('faqExpandedPanel');
    if (panel) {
      el.expandedPanel = panel;
      el.expandedEyebrow = panel.querySelector('.faq__expanded-eyebrow');
      el.expandedTitle = panel.querySelector('.faq__expanded-title');
      el.expandedContent = panel.querySelector('.faq__expanded-content');
      return panel;
    }

    panel = document.createElement('div');
    panel.className = 'faq__expanded-panel';
    panel.id = 'faqExpandedPanel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="faq__expanded-header">' +
        '<h3 class="faq__expanded-title"></h3>' +
        '<button type="button" class="faq__expanded-close" aria-label="' + escapeHtml(tr('faq.js.fechar')) + '">' +
          '<ion-icon name="close-outline"></ion-icon>' +
        '</button>' +
      '</div>' +
      '<div class="faq__expanded-content"></div>';

    // Inserir logo após .faq__pagination, ou após .faq__categories se pagination não existir
    const anchor = el.pagination || el.categories;
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    }

    el.expandedPanel = panel;
    el.expandedEyebrow = panel.querySelector('.faq__expanded-eyebrow');
    el.expandedTitle = panel.querySelector('.faq__expanded-title');
    el.expandedContent = panel.querySelector('.faq__expanded-content');

    panel.querySelector('.faq__expanded-close').addEventListener('click', function () {
      closeExpandedPanel({ scrollBack: true });
    });

    return panel;
  }

  function buildExpandedContent(categoryId) {
    const wrapper = document.createDocumentFragment();
    const secs = (state.sectionsByCategory.get(categoryId) || []).slice();
    secs.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });

    let hasContent = false;

    secs.forEach(function (sec) {
      const arts = (state.articlesBySection.get(sec.id) || []).slice();
      if (!arts.length) return;
      arts.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
      hasContent = true;

      const group = document.createElement('div');
      group.className = 'faq__expanded-section';

      const title = document.createElement('span');
      title.className = 'faq__expanded-section-name';
      title.textContent = sec.name || '';
      group.appendChild(title);

      const ul = document.createElement('ul');
      ul.className = 'faq__expanded-articles';

      arts.forEach(function (art) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'faq__expanded-article';
        btn.dataset.articleId = String(art.id);
        btn.innerHTML =
          '<span class="faq__expanded-article-title">' + escapeHtml(art.title) + '</span>' +
          '<ion-icon name="chevron-forward-outline"></ion-icon>';
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          openArticleById(art.id);
        });
        li.appendChild(btn);
        ul.appendChild(li);
      });

      group.appendChild(ul);
      wrapper.appendChild(group);
    });

    if (!hasContent) {
      const empty = document.createElement('p');
      empty.className = 'faq__results-empty';
      empty.textContent = tr('faq.js.nenhum_artigo');
      wrapper.appendChild(empty);
    }

    return wrapper;
  }

  function setActiveCard(categoryId) {
    if (!el.categories) return;
    el.categories.querySelectorAll('.faq__category-card').forEach(function (c) {
      const id = Number(c.dataset.categoryId);
      const active = id === categoryId;
      c.classList.toggle('is-active', active);
      c.setAttribute('aria-expanded', active ? 'true' : 'false');
    });
  }

  function toggleExpandedPanel(categoryId) {
    if (state.activeCategoryId === categoryId) {
      closeExpandedPanel({ scrollBack: true });
      return;
    }
    openExpandedPanel(categoryId);
  }

  function openExpandedPanel(categoryId) {
    const cat = state.allCategories.find(function (c) { return c.id === categoryId; });
    if (!cat) return;

    const panel = ensureExpandedPanel();
    const isOpenAlready = panel.classList.contains('is-open');

    state.activeCategoryId = categoryId;
    setActiveCard(categoryId);

    const writeContent = function () {
      el.expandedTitle.textContent = cat.name || '';
      el.expandedContent.innerHTML = '';
      el.expandedContent.appendChild(buildExpandedContent(categoryId));
    };

    if (!isOpenAlready) {
      writeContent();
      panel.hidden = false;
      // forçar reflow pra a transição funcionar
      void panel.offsetHeight;
      panel.classList.add('is-open');
      requestAnimationFrame(function () {
        smoothScrollTo(panel);
      });
    } else {
      // swap suave: fade-out via .is-swapping → troca → fade-in
      el.expandedContent.classList.add('is-swapping');
      setTimeout(function () {
        writeContent();
        el.expandedContent.classList.remove('is-swapping');
        smoothScrollTo(panel);
      }, 180);
    }
  }

  function closeExpandedPanel(opts) {
    const scrollBack = !!(opts && opts.scrollBack);
    const panel = el.expandedPanel;
    const wasOpen = !!(panel && panel.classList.contains('is-open'));

    state.activeCategoryId = null;
    setActiveCard(null);

    if (!panel) {
      if (scrollBack && wasOpen) smoothScrollTo(el.section);
      return;
    }
    if (!panel.classList.contains('is-open') && panel.hidden) {
      if (scrollBack && wasOpen) smoothScrollTo(el.section);
      return;
    }

    panel.classList.remove('is-open');
    setTimeout(function () {
      if (!panel.classList.contains('is-open')) {
        panel.hidden = true;
        if (el.expandedContent) el.expandedContent.innerHTML = '';
      }
    }, 320);

    if (scrollBack && wasOpen) {
      smoothScrollTo(el.section);
    }
  }

  function renderFallback() {
    el.categories.innerHTML =
      '<div class="faq__fallback">' +
        '<p>' + escapeHtml(tr('faq.js.erro_carregar')) + '</p>' +
        '<a href="' + getZendeskHelpUrl() + '" target="_blank" rel="noopener">' +
          escapeHtml(tr('faq.js.acesse_central')) +
          ' <ion-icon name="arrow-forward-outline"></ion-icon>' +
        '</a>' +
      '</div>';
    if (el.pagination) el.pagination.hidden = true;
  }

  /* ========== BUSCA ========== */

  function onSearchInput() {
    if (state.searchTimer) {
      clearTimeout(state.searchTimer);
      state.searchTimer = null;
    }

    const raw = el.searchInput.value || '';
    const q = raw.trim();

    if (!q) {
      cancelSearchRequest();
      hideSpinner();
      state.currentPage = 1;
      resetToCategories();
      renderCategoriesPage();
      return;
    }

    if (q.length < SEARCH_MIN_CHARS) {
      hideSpinner();
      return;
    }

    state.searchTimer = setTimeout(function () {
      runSearch(q);
    }, SEARCH_DEBOUNCE_MS);
  }

  function cancelSearchRequest() {
    if (state.searchAbort) {
      state.searchAbort.abort();
      state.searchAbort = null;
    }
  }

  function showSpinner() {
    if (el.searchLoading) el.searchLoading.hidden = false;
  }

  function hideSpinner() {
    if (el.searchLoading) el.searchLoading.hidden = true;
  }

  function resetToCategories() {
    el.results.hidden = true;
    el.categories.hidden = false;
    el.resultsList.innerHTML = '';
    if (el.pagination) {
      const perPage = getCategoriesPerPage();
      const totalPages = Math.max(1, Math.ceil(state.allCategories.length / perPage));
      el.pagination.hidden = totalPages <= 1;
    }
  }

  async function runSearch(query) {
    cancelSearchRequest();
    const ctrl = new AbortController();
    state.searchAbort = ctrl;

    closeExpandedPanel();
    showSpinner();
    el.categories.hidden = true;
    el.results.hidden = false;
    if (el.pagination) el.pagination.hidden = true;

    const url = ZENDESK_BASE +
      '/articles/search.json?query=' + encodeURIComponent(query) +
      '&locale=' + getZendeskLocale() +
      '&per_page=20';

    try {
      const data = await fetchJson(url, ctrl.signal);
      if (ctrl.signal.aborted) return;

      const results = Array.isArray(data.results) ? data.results : [];
      renderResults(results, query);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.warn('[faq] Falha na busca:', err);
      renderSearchError(query);
    } finally {
      if (state.searchAbort === ctrl) {
        state.searchAbort = null;
      }
      hideSpinner();
    }
  }

  function renderResults(results, query) {
    el.resultsList.innerHTML = '';

    if (!results.length) {
      el.resultsCount.textContent = tr('faq.js.nenhum_resultado').replace('{query}', query);
      const li = document.createElement('li');
      li.className = 'faq__results-empty';
      li.textContent = tr('faq.js.tente_outras');
      el.resultsList.appendChild(li);
      return;
    }

    el.resultsCount.textContent = pluralizeResults(results.length);

    const frag = document.createDocumentFragment();
    results.forEach(function (r) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'faq__result-item';

      let snippet = (r.snippet || '').replace(/<[^>]+>/g, '').trim();
      if (!snippet) snippet = truncate(stripHtml(r.body || ''), 160);

      btn.innerHTML =
        '<span class="faq__result-title">' + escapeHtml(r.title || '') + '</span>' +
        (snippet ? '<span class="faq__result-snippet">' + escapeHtml(snippet) + '</span>' : '');

      btn.addEventListener('click', function () {
        openArticleFromSearch(r);
      });

      li.appendChild(btn);
      frag.appendChild(li);
    });
    el.resultsList.appendChild(frag);
  }

  function renderSearchError(query) {
    el.resultsList.innerHTML = '';
    el.resultsCount.textContent = tr('faq.js.erro_buscar');
    const li = document.createElement('li');
    li.className = 'faq__results-empty';
    const link = '<a href="' + getZendeskHelpUrl() + '?query=' + encodeURIComponent(query) +
      '" target="_blank" rel="noopener" style="color:#ffffff;text-decoration:underline">' +
      escapeHtml(tr('faq.js.pesquise_direto')) + '</a>';
    li.innerHTML = tr('faq.js.tente_novamente.html').replace('{link}', link);
    el.resultsList.appendChild(li);
  }

  /* ========== MODAL ========== */

  function openArticleById(articleId) {
    const art = state.articles.find(function (a) { return a.id === articleId; });
    if (art) {
      showModal(art);
    } else {
      fetchArticleById(articleId);
    }
  }

  async function fetchArticleById(articleId) {
    try {
      const data = await fetchJson(ZENDESK_BASE + '/' + getZendeskLocale() + '/articles/' + articleId + '.json');
      if (data && data.article) {
        showModal(data.article);
      }
    } catch (err) {
      console.warn('[faq] Falha ao carregar artigo:', err);
    }
  }

  function openArticleFromSearch(searchResult) {
    const cached = state.articles.find(function (a) { return a.id === searchResult.id; });
    if (cached) {
      showModal(cached);
      return;
    }
    showModal({
      id: searchResult.id,
      title: searchResult.title,
      body: searchResult.body || '',
      html_url: searchResult.html_url,
      section_id: searchResult.section_id,
    });
    if (!searchResult.body) {
      fetchArticleById(searchResult.id);
    }
  }

  function buildBreadcrumb(article) {
    const sec = state.sections.find(function (s) { return s.id === article.section_id; });
    if (!sec) return '';
    const cat = state.categories.find(function (c) { return c.id === sec.category_id; });
    const catName = cat ? cat.name : '';
    return [catName, sec.name].filter(Boolean).join(' › ');
  }

  function lockBodyScroll() {
    // Lenis ignora wheel/touch dentro de [data-lenis-prevent] no modal panel.
    // Não pausar o Lenis aqui — fazer isso bloqueia o scroll interno do modal.
    const sbw = getScrollbarWidth();
    document.body.style.overflow = 'hidden';
    if (sbw > 0) document.body.style.paddingRight = sbw + 'px';
  }

  function unlockBodyScroll() {
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  }

  function showModal(article) {
    state.lastFocused = document.activeElement;

    el.modalTitle.textContent = article.title || '';
    el.modalBreadcrumb.textContent = buildBreadcrumb(article);
    el.modalBody.innerHTML = article.body || '';
    el.modalSource.href = article.html_url || getZendeskHelpUrl();

    const links = el.modalBody.querySelectorAll('a');
    links.forEach(function (a) {
      const href = a.getAttribute('href') || '';
      if (/^https?:/i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });

    el.modal.hidden = false;
    el.modal.setAttribute('aria-hidden', 'false');
    // force reflow pra a transição funcionar
    void el.modal.offsetHeight;
    el.modal.classList.add('is-open');

    lockBodyScroll();

    const panel = el.modal.querySelector('.faq__modal-panel');
    if (panel) panel.scrollTop = 0;

    const closeBtn = el.modal.querySelector('.faq__modal-close');
    if (closeBtn) closeBtn.focus();
  }

  function closeModal() {
    el.modal.classList.remove('is-open');
    el.modal.setAttribute('aria-hidden', 'true');
    unlockBodyScroll();

    setTimeout(function () {
      el.modal.hidden = true;
      el.modalBody.innerHTML = '';
    }, 200);

    if (state.lastFocused && typeof state.lastFocused.focus === 'function') {
      try { state.lastFocused.focus(); } catch (e) { /* noop */ }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
