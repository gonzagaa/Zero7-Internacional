(function () {
  'use strict';

  const SUPPORTED = ['pt', 'en', 'es'];
  const DEFAULT_LANG = 'pt';
  const STORAGE_KEY = 'zero7-lang';
  const QUERY_KEY = 'lang';

  let currentLang = null;
  let dict = {};
  const cache = {};

  function normalize(code) {
    if (!code) return null;
    const base = String(code).toLowerCase().split('-')[0];
    return SUPPORTED.includes(base) ? base : null;
  }

  function detectInitialLang() {
    try {
      const qs = new URLSearchParams(window.location.search);
      const fromQuery = normalize(qs.get(QUERY_KEY));
      if (fromQuery) return fromQuery;
    } catch (_) {}

    try {
      const fromStorage = normalize(localStorage.getItem(STORAGE_KEY));
      if (fromStorage) return fromStorage;
    } catch (_) {}

    try {
      const navLangs = navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language];
      for (const l of navLangs) {
        const n = normalize(l);
        if (n) return n;
      }
    } catch (_) {}

    return DEFAULT_LANG;
  }

  async function loadDict(lang) {
    if (cache[lang]) {
      dict = cache[lang];
      return dict;
    }
    const resp = await fetch('./lang/' + lang + '.json', { cache: 'no-cache' });
    if (!resp.ok) throw new Error('Failed to load lang ' + lang + ' (' + resp.status + ')');
    const data = await resp.json();
    cache[lang] = data;
    dict = data;
    return dict;
  }

  function resolveKey(key) {
    if (!key) return undefined;
    const parts = key.split('.');
    let cur = dict;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in cur) {
        cur = cur[p];
      } else {
        return undefined;
      }
    }
    return cur;
  }

  function t(key) {
    const val = resolveKey(key);
    return (typeof val === 'string') ? val : key;
  }

  function applyTranslations(root) {
    const scope = root || document;

    scope.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const val = resolveKey(key);
      if (typeof val !== 'string') return;
      if (key.endsWith('.html')) {
        el.innerHTML = val;
      } else {
        el.textContent = val;
      }
    });

    scope.querySelectorAll('[data-i18n-attr]').forEach(el => {
      const spec = el.getAttribute('data-i18n-attr');
      if (!spec) return;
      spec.split('|').forEach(pair => {
        const idx = pair.indexOf(':');
        if (idx === -1) return;
        const attr = pair.slice(0, idx).trim();
        const key = pair.slice(idx + 1).trim();
        const val = resolveKey(key);
        if (typeof val === 'string' && attr) {
          el.setAttribute(attr, val);
        }
      });
    });
  }

  function updateDropdown() {
    const meta = (dict && dict._meta) || {};
    document.querySelectorAll('.lang-switch').forEach(sw => {
      sw.setAttribute('data-current', currentLang);
      const btn = sw.querySelector('.lang-current');
      if (btn) {
        const img = btn.querySelector('img.flag');
        const label = btn.querySelector('.label');
        if (img && meta.flag) {
          img.setAttribute('src', meta.flag);
          if (meta.name) img.setAttribute('alt', meta.name);
        }
        if (label && meta.label) {
          label.textContent = meta.label;
        }
      }
      sw.querySelectorAll('.lang-menu .lang-item').forEach(item => {
        const isActive = item.dataset.lang === currentLang;
        item.classList.toggle('is-active', isActive);
        if (isActive) {
          item.setAttribute('aria-current', 'true');
        } else {
          item.removeAttribute('aria-current');
        }
      });
    });
  }

  function updateUrl(lang) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(QUERY_KEY, lang);
      history.replaceState(null, '', url.toString());
    } catch (_) {}
  }

  function bindDropdown() {
    document.querySelectorAll('.lang-switch .lang-item').forEach(item => {
      if (item.__i18nBound) return;
      item.__i18nBound = true;
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const targetLang = normalize(item.getAttribute('data-lang'));
        if (!targetLang) return;

        const sw = item.closest('.lang-switch');
        const btn = sw && sw.querySelector('.lang-current');

        if (targetLang === currentLang) {
          if (btn) { try { btn.focus(); } catch (_) {} }
          return;
        }

        setLang(targetLang).then(() => {
          if (btn) { try { btn.focus(); } catch (_) {} }
        });
      });
    });
  }

  async function setLang(lang) {
    const target = normalize(lang) || DEFAULT_LANG;
    const previous = currentLang;
    const previousDict = dict;
    try {
      await loadDict(target);
    } catch (err) {
      console.error('[i18n] Failed to load dictionary for', target, err);
      dict = previousDict;
      return;
    }
    currentLang = target;
    try { localStorage.setItem(STORAGE_KEY, target); } catch (_) {}
    document.documentElement.setAttribute('lang', target);
    applyTranslations();
    updateDropdown();
    updateUrl(target);
    if (previous !== target) {
      document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: target } }));
    }
  }

  async function init() {
    const initial = detectInitialLang();
    await setLang(initial);
    bindDropdown();
  }

  window.i18n = {
    getLang: () => currentLang,
    setLang,
    t,
    apply: applyTranslations
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
