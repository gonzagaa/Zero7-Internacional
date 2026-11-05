#!/usr/bin/env node
/* =====================================================================
   Checagem da campanha em /home e /home/v2 (o site não tem build, então
   o HTML existe em duas cópias: index.html e v2/index.html).

   1. Os blocos TARJA e FAIXA são IDÊNTICOS nas duas páginas:
        <!-- TARJA: manter idêntico em /home e /home/v2 --> ... <!-- /TARJA -->
        <!-- FAIXA: manter idêntico em /home e /home/v2 --> ... <!-- /FAIXA -->
   2. O número escrito no HTML (data-camp-num="ate") é o mesmo de
      js/campanha.js (pct.ate) — o 1º paint não pode mostrar outro número.
   3. "ATÉ X% OFF" é verdade: X é o MAIOR desconto real do data/planos.json.

   Uso:   node tools/check-tarja.mjs
   Saída: 0 = tudo certo · 1 = algo diverge (diferença só de CRLF/LF é ignorada)
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGINAS = ['index.html', 'v2/index.html'];
const BLOCOS = ['TARJA', 'FAIXA'];
let falhou = false;
const erro = (m) => { console.error('✗ ' + m); falhou = true; };

function extrair(rel, nome) {
  const linhas = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
  const INICIO = `<!-- ${nome}: manter idêntico em /home e /home/v2 -->`, FIM = `<!-- /${nome} -->`;
  const ini = linhas.findIndex((l) => l.includes(INICIO));
  const fim = linhas.findIndex((l, i) => i > ini && l.includes(FIM));
  const dup = linhas.filter((l) => l.includes(INICIO)).length;
  if (ini < 0 || fim < 0) throw new Error(`${rel}: marcadores ${nome} não encontrados`);
  if (dup > 1) throw new Error(`${rel}: marcador ${nome} aparece ${dup} vezes`);
  return { rel, linha: ini + 1, bloco: linhas.slice(ini, fim + 1) };
}

// 1. blocos idênticos
const html = {};
for (const nome of BLOCOS) {
  try {
    const [a, b] = PAGINAS.map((p) => extrair(p, nome));
    html[nome] = a.bloco.join('\n');
    const n = Math.max(a.bloco.length, b.bloco.length);
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (a.bloco[i] !== b.bloco[i]) {
        erro(`${nome} DIVERGE entre as páginas.\n  ${a.rel}:${a.linha + i}\n    ${a.bloco[i] ?? '(fim do bloco)'}\n  ${b.rel}:${b.linha + i}\n    ${b.bloco[i] ?? '(fim do bloco)'}\n  Edite uma e copie o bloco inteiro para a outra.`);
        ok = false; break;
      }
    }
    if (ok) console.log(`✓ ${nome} idêntica em ${PAGINAS.join(' e ')} (${a.bloco.length} linhas).`);
  } catch (e) { erro(e.message); }
}

// 2. número do HTML = objeto da campanha
const ctx = { window: {}, document: { documentElement: { classList: { add() {} }, style: { setProperty() {} } } }, Date };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/campanha.js'), 'utf8'), ctx);
const C = ctx.window.Z7_CAMPANHA;
const nums = Object.values(html).join('\n').match(/data-camp-num="ate">(\d+)</g) || [];
const diferentes = nums.map((m) => +m.match(/>(\d+)</)[1]).filter((n) => n !== C.pct.ate);
if (!nums.length) erro('nenhum data-camp-num="ate" nos blocos');
else if (diferentes.length) erro(`HTML mostra ${diferentes.join(', ')}% mas js/campanha.js diz pct.ate = ${C.pct.ate}`);
else console.log(`✓ HTML e js/campanha.js dizem o mesmo número: ${C.pct.ate}% (${nums.length} ocorrências).`);

// 3. "ATÉ X%" = maior desconto real do planos.json
const P = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/planos.json'), 'utf8'));
const num = (x) => parseFloat(String(x).replace(/[^0-9,]/g, '').replace(',', '.'));
let max = 0, onde = '';
for (const [cap, c] of Object.entries(P.capitais))
  for (const k of ['comAtivacao', 'semAtivacao', 'fundingPass', 'liberty']) {
    if (!c.precos[k]) continue;
    const p = Math.round((1 - num(c.precos[k]) / num(c.precos[k + 'De'])) * 100);
    if (p > max) { max = p; onde = `${k} ${cap}`; }
  }
if (max !== C.pct.ate) erro(`"ATÉ ${C.pct.ate}% OFF" não bate com o planos.json: o maior desconto real é ${max}% (${onde}).`);
else console.log(`✓ "ATÉ ${C.pct.ate}% OFF" confere: maior desconto real do planos.json = ${max}% (${onde}).`);

const fim = Date.parse(C.fim);
console.log(`  campanha "${C.nome}" até ${new Date(fim).toISOString()} (${C.ativa ? 'no ar' : 'EXPIRADA'})`);
process.exit(falhou ? 1 : 0);
