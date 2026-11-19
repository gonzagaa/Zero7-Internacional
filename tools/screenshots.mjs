#!/usr/bin/env node
/* =====================================================================
   Capturas locais com Playwright + servidor http efêmero.

   O que faz:
   - Sobe um http simples na raiz do projeto (porta livre, só IPv4 local).
   - Abre /home e /home/v2 em 390 e 1280 largura e salva PNGs em
     tools/screenshots-out/.
   - Recortes: tarja do topo, faixa acima das abas, cards de planos
     abrindo em Activation 50k (CTA da tarja clicado).
   - Mede CLS acumulado (PerformanceObserver layout-shift) e coleta
     mensagens do console (errors/warnings).

   Uso:   node tools/screenshots.mjs
   Saída: tools/screenshots-out/{...}.png + resumo em stdout.
   ===================================================================== */
import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools', 'screenshots-out');
await fs.mkdir(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif':  'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.ico':  'image/x-icon',
};

function safeJoin(base, reqPath) {
  const p = path.normalize(path.join(base, decodeURIComponent(reqPath.split('?')[0])));
  if (!p.startsWith(base)) return null;
  return p;
}

const server = createServer(async (req, res) => {
  try {
    let rel = req.url === '/' ? '/index.html' : req.url;
    // trata rotas como /home -> /index.html (a produção usa Apache rewrite)
    if (rel.startsWith('/home/v2')) rel = rel.replace('/home/v2', '/v2');
    if (rel === '/home' || rel.startsWith('/home?')) rel = '/index.html' + rel.slice(5);
    let abs = safeJoin(ROOT, rel);
    if (!abs) { res.statusCode = 403; return res.end('nope'); }
    try {
      const st = await fs.stat(abs);
      if (st.isDirectory()) abs = path.join(abs, 'index.html');
    } catch (_) {
      res.statusCode = 404;
      return res.end('not found');
    }
    const ext = path.extname(abs).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(abs).on('error', () => { res.statusCode = 404; res.end('err'); }).pipe(res);
  } catch (e) {
    res.statusCode = 500;
    res.end('err');
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
console.log('> server em', base);

const PAGES = [
  { slug: 'v1', url: `${base}/index.html?lang=pt` },
  { slug: 'v2', url: `${base}/v2/index.html?lang=pt` },
];
const VIEWS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '768',  width: 768,  height: 1024 },
  { name: '390',  width: 390,  height: 844 },
  { name: '320',  width: 320,  height: 700 },
];

const logs = [];

async function shotEl(page, sel, out, padding = 10) {
  const loc = page.locator(sel).first();
  const count = await loc.count();
  if (!count) return null;
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(250);
  const box = await loc.boundingBox();
  if (!box) return null;
  await loc.screenshot({ path: out, animations: 'disabled' }).catch(async () => {
    // fallback: screenshot via clip
    await page.screenshot({ path: out, clip: {
      x: Math.max(0, box.x - padding),
      y: Math.max(0, box.y - padding),
      width: Math.max(1, box.width + padding * 2),
      height: Math.max(1, box.height + padding * 2),
    } });
  });
  return box;
}

async function capture(page, slug) {
  // Oferta → scroll para a seção #plan e espera estabilizar
  await page.evaluate(() => document.getElementById('plan')?.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(600);
  const faixa = await shotEl(page, '.zbk-faixa', path.join(OUT, `${slug}-faixa.png`), 10);
  if (faixa) console.log(`  ${slug}: faixa altura = ${Math.round(faixa.height)}px, largura = ${Math.round(faixa.width)}px`);

  // Verificação de sobreposição do eclipse: elementFromPoint no centro
  // de cada texto chave — não pode voltar um pedaço do eclipse (zbk__disco/coroa).
  const overlap = await page.evaluate(() => {
    const keys = ['.zbk-faixa__gold', '.zbk-faixa__todos', '.zbk-faixa__clock-label', '.zbk-faixa__cell-num', '.zbk-faixa__selo'];
    const out = [];
    for (const sel of keys) {
      const el = document.querySelector(sel);
      if (!el || !el.getClientRects().length) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const coberto = hit && (hit.classList.contains('zbk__disco') || hit.classList.contains('zbk__coroa'));
      if (coberto) out.push(sel);
    }
    return out;
  });
  if (overlap.length) console.log(`  ${slug}: ⚠ eclipse cobre ${overlap.join(', ')}`);
  else console.log(`  ${slug}: ✓ nenhum texto coberto pelo eclipse`);

  // Volta ao topo para pegar a tarja
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await shotEl(page, '.zbk.tarja-topo', path.join(OUT, `${slug}-tarja.png`), 0);

  // Clica no CTA "Ver planos" da tarja, para reproduzir o fluxo que força o 50k.
  // A seção abre em Activation 50k (por padrão) depois do clique.
  await page.click('.zbk__cta[data-camp-ir]').catch(() => {});
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => {
    const seg = document.querySelector('#plan .seg--capital .selecionado');
    const modo = document.querySelector('#plan .mode-toggle .is-active');
    return { capital: seg?.dataset.capital, modo: modo?.dataset.mode };
  });
  console.log(`  ${slug}: seção abre em modo=${state.modo}, capital=${state.capital}`);

  // Card de Activation (85%) — estado padrão
  await shotEl(page, '#plan .plan-stack, #plan .plan-card', path.join(OUT, `${slug}-planos-activation-50k.png`), 10);
  await shotEl(page, '#plan .camp-card-selo.is-on', path.join(OUT, `${slug}-selo-85.png`), 12);

  // Troca para Funding Pass (80%) e captura o card + o selo equivalente
  await page.click('#plan .mode-toggle [data-mode="funding_pass"]').catch(() => {});
  await page.waitForTimeout(500);
  await shotEl(page, '#plan .plan-stack, #plan .plan-card', path.join(OUT, `${slug}-planos-fundingpass-50k.png`), 10);
  await shotEl(page, '#plan .camp-card-selo.is-on', path.join(OUT, `${slug}-selo-80.png`), 12);

  // Volta para Activation
  await page.click('#plan .mode-toggle [data-mode="com_ativacao"]').catch(() => {});
  await page.waitForTimeout(300);
}

async function measureCLS(page) {
  return await page.evaluate(() => new Promise((ok) => {
    let cls = 0;
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value;
    });
    try { po.observe({ type: 'layout-shift', buffered: true }); } catch (_) { return ok(null); }
    setTimeout(() => { po.disconnect(); ok(cls); }, 2000);
  }));
}

// Em algumas instalações o download oficial do Playwright não baixa tudo.
// Se já existir um chrome.exe de versão compatível no cache do Playwright,
// usa esse caminho direto; caso contrário tenta o launcher padrão.
const PLAYWRIGHT_CACHE = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'ms-playwright')
  : null;
let execPath = null;
if (PLAYWRIGHT_CACHE) {
  try {
    const dirs = (await fs.readdir(PLAYWRIGHT_CACHE))
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort().reverse();
    for (const d of dirs) {
      const p = path.join(PLAYWRIGHT_CACHE, d, 'chrome-win64', 'chrome.exe');
      try { await fs.access(p); execPath = p; break; } catch (_) {}
    }
  } catch (_) {}
}
const browser = await chromium.launch(execPath ? { executablePath: execPath } : { channel: 'chromium' });
try {
  for (const page of PAGES) {
    for (const view of VIEWS) {
      const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: 2 });
      const p = await ctx.newPage();
      const pageLogs = [];
      p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') pageLogs.push(`[${m.type()}] ${m.text()}`); });
      p.on('pageerror', (e) => pageLogs.push(`[pageerror] ${e.message}`));

      console.log(`\n→ ${page.slug} ${view.width}x${view.height}  ${page.url}`);
      await p.goto(page.url, { waitUntil: 'networkidle', timeout: 15000 });
      await p.waitForTimeout(600); // dá tempo da tarja + fontes + i18n
      await capture(p, `${page.slug}-${view.name}`);
      const cls = await measureCLS(p);
      logs.push({ page: page.slug, view: view.name, cls, logs: pageLogs });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log('\n==== RESUMO ====');
for (const r of logs) {
  console.log(`${r.page} @ ${r.view}px — CLS: ${r.cls == null ? 'n/d' : r.cls.toFixed(4)}  console: ${r.logs.length ? r.logs.length + ' avisos' : 'limpo'}`);
  r.logs.slice(0, 6).forEach((l) => console.log('   ' + l));
}
console.log('\nPNGs em', OUT);
