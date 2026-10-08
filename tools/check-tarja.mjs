#!/usr/bin/env node
/* =====================================================================
   Checagem: a tarja promocional tem que ser IDÊNTICA em /home e /home/v2.

   O site não tem build, então o HTML da tarja existe em duas cópias:
     index.html  e  v2/index.html
   cada uma entre os marcadores:
     <!-- TARJA: manter idêntico em /home e /home/v2 -->
     ...
     <!-- /TARJA -->

   Uso:   node tools/check-tarja.mjs
   Saída: 0 = idênticas · 1 = divergem ou marcador ausente
   (Diferença só de fim de linha CRLF/LF é ignorada.)
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGINAS = ['index.html', 'v2/index.html'];
const INICIO = '<!-- TARJA: manter idêntico em /home e /home/v2 -->';
const FIM = '<!-- /TARJA -->';

function extrair(rel) {
  const linhas = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
  const ini = linhas.findIndex((l) => l.includes(INICIO));
  const fim = linhas.findIndex((l, i) => i > ini && l.includes(FIM));
  const dup = linhas.filter((l) => l.includes(INICIO)).length;
  if (ini < 0 || fim < 0) throw new Error(`${rel}: marcadores da tarja não encontrados`);
  if (dup > 1) throw new Error(`${rel}: marcador de início aparece ${dup} vezes`);
  return { rel, linha: ini + 1, bloco: linhas.slice(ini, fim + 1) };
}

try {
  const [a, b] = PAGINAS.map(extrair);
  const n = Math.max(a.bloco.length, b.bloco.length);
  for (let i = 0; i < n; i++) {
    if (a.bloco[i] !== b.bloco[i]) {
      console.error('✗ A tarja DIVERGE entre as páginas.\n');
      console.error(`  ${a.rel}:${a.linha + i}\n    ${a.bloco[i] ?? '(fim do bloco)'}`);
      console.error(`  ${b.rel}:${b.linha + i}\n    ${b.bloco[i] ?? '(fim do bloco)'}\n`);
      console.error('  Edite uma e copie o bloco inteiro (do marcador TARJA até /TARJA) para a outra.');
      process.exit(1);
    }
  }
  console.log(`✓ Tarja idêntica em ${PAGINAS.join(' e ')} (${a.bloco.length} linhas).`);
} catch (e) {
  console.error('✗ ' + e.message);
  process.exit(1);
}
