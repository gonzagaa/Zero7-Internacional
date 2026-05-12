(function () {
  'use strict';

  function init() {
    const modal = document.getElementById('modalDepoimentos');
    const videoContainer = document.getElementById('video-container-geral');
    const closeBtn = document.querySelector('.close-depoimento-geral');
    const cards = document.querySelectorAll('.depoimento[data-video]');

    console.log('[depoimentosModal] init:', {
      modalExiste: !!modal,
      videoContainerExiste: !!videoContainer,
      closeBtnExiste: !!closeBtn,
      cardsEncontrados: cards.length
    });

    if (!modal || !videoContainer) {
      console.warn('[depoimentosModal] Modal não encontrado no DOM');
      return;
    }

    if (cards.length === 0) {
      console.warn('[depoimentosModal] Nenhum card .depoimento[data-video] encontrado');
      return;
    }

    function openModal(videoUrl) {
      if (!videoUrl) return;

      modal.style.display = 'flex';
      videoContainer.innerHTML =
        '<iframe src="' + videoUrl + '?autoplay=1&rel=0" ' +
        'title="Depoimento" frameborder="0" ' +
        'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ' +
        'allowfullscreen></iframe>';

      if (window.lenis && typeof window.lenis.stop === 'function') {
        window.lenis.stop();
      }
      document.body.style.overflow = 'hidden';
    }

    function closeModal() {
      modal.style.display = 'none';
      videoContainer.innerHTML = '';

      if (window.lenis && typeof window.lenis.start === 'function') {
        window.lenis.start();
      }
      document.body.style.overflow = '';
    }

    cards.forEach(function (card) {
      card.addEventListener('click', function (e) {
        e.preventDefault();
        const videoUrl = card.getAttribute('data-video');
        openModal(videoUrl);
      });
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }

    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        closeModal();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
        closeModal();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
