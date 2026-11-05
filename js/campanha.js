/* =====================================================================
   CAMPANHA ATUAL — objeto único. Na próxima promoção, trocar ESTE objeto
   (e as chaves "camp.*" em lang/*.json, se a copy mudar) deve bastar.

   Carregado SÍNCRONO no <head> (arquivo minúsculo): decide antes do 1º
   paint se a campanha está no ar. Se estiver, liga <html class="camp-on">
   e as cores. Todo o CSS da campanha (tarja, faixa dos planos, selos e
   destaque do 50k — css/campanha.css) só existe sob .camp-on.
   Depois do fim: nada aparece, nada é reservado, nada pula.

   Comportamento: js/campanhaTarja.js (tarja/faixa) e js/sectionPlanos.js
   (50k por padrão, selos do card). Conferir: node tools/check-tarja.mjs
   ===================================================================== */
(function () {
  var C = window.Z7_CAMPANHA = {
    id: 'pre-black-2026',
    nome: 'Pré-Black Friday',

    // Fim da campanha, horário de Brasília (-03:00). Depois disso tudo some junto.
    fim: '2027-12-31T23:59:00-03:00',

    cupom: 'BLACK07',                     // um código só (tarja; o card usa PLAN_CUPOM em sectionPlanos.js)

    // número da copy "ATÉ 87% OFF". Os selos do card NÃO usam este número:
    // calculam o desconto real de cada plano a partir do data/planos.json.
    pct: { ate: 87 },

    // onde estão os 87%: selo flutuante, anel, card dourado, CTA da tarja
    destaque: {
      capital: '50k',
      selecionarPorPadrao: true,          // flag de conversão: a seção de planos abre no 50k
    },

    // modos que exibem o selo "PRÉ-BLACK · -XX%" no card
    modos: ['com_ativacao', 'sem_ativacao', 'liberty', 'funding_pass'],

    // cores (viram --camp-* no :root, antes do 1º paint)
    cores: {
      'ouro-1': '#fbeccb',   /* champanhe   */
      'ouro-2': '#f1c36a',   /* âmbar       */
      'ouro-3': '#c99030',   /* ouro escuro (mínimo p/ contraste do 87% sobre o eclipse) */
      'ambar':  '#e9a640',
      'menta':  '#3fe3a6',
      'base':   '#000000',
      'cta-bg': '#f4f1e8',
      'cta-ink':'#0b0f0d',
    },
  };

  var fim = Date.parse(C.fim);
  C.ativa = !(fim && Date.now() >= fim);
  if (!C.ativa) return;

  var h = document.documentElement;
  h.classList.add('camp-on');
  for (var k in C.cores) h.style.setProperty('--camp-' + k, C.cores[k]);
})();
