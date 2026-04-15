/* ============================================================
   Section #BA — Blackarrow Premium Showcase
   GSAP + ScrollTrigger · mouse tilt + spotlight
   ============================================================ */
(function () {
  'use strict';

  // ── Set initial hidden states (GSAP overrides these on reveal) ──────────────
  gsap.set('.ba-kicker', { opacity: 0, y: 16 });
  gsap.set('#ba .ba-card', { opacity: 0, y: 38, scale: .97 });

  // ── ScrollTrigger entry animations ─────────────────────────────────────────
  const mm = gsap.matchMedia();

  // ---- Desktop (≥ 1080px) ---------------------------------------------------
  mm.add('(min-width: 1080px)', () => {

    // Kicker line
    gsap.to('.ba-kicker', {
      opacity: 1,
      y: 0,
      duration: .9,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: '#ba',
        start: 'top 78%',
        toggleActions: 'play none none reverse',
      },
    });

    // Tall video panels (left + right) — animate as a pair with a tiny stagger
    gsap.to(['.ba-card--video-a', '.ba-card--video-b'], {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 1.3,
      stagger: .09,
      ease: 'expo.out',
      clearProps: 'transform',
      scrollTrigger: {
        trigger: '#ba .ba-bento',
        start: 'top 80%',
        toggleActions: 'play none none reverse',
      },
    });

    // Hero card
    gsap.to('.ba-card--hero', {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 1.4,
      delay: .15,
      ease: 'expo.out',
      clearProps: 'transform',
      scrollTrigger: {
        trigger: '#ba .ba-bento',
        start: 'top 80%',
        toggleActions: 'play none none reverse',
      },
    });

    // Hero inner elements — stagger for layered reveal
    gsap.fromTo(
      [
        '.ba-card__badge',
        '.ba-hero__logo',
        '.ba-hero__title',
        '.ba-cta',
        '.ba-hero__stats',
      ],
      { opacity: 0, y: 24 },
      {
        opacity: 1,
        y: 0,
        stagger: .1,
        duration: .9,
        delay: .55,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: '.ba-card--hero',
          start: 'top 78%',
          toggleActions: 'play none none reverse',
        },
      }
    );

    // Bottom row — stagger left to right
    gsap.to(['.ba-card--img-a', '.ba-card--label', '.ba-card--img-b'], {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: .9,
      stagger: .1,
      ease: 'power3.out',
      clearProps: 'transform',
      scrollTrigger: {
        trigger: '.ba-card--img-a',
        start: 'top 88%',
        toggleActions: 'play none none reverse',
      },
    });

  });

  // ---- Mobile / Tablet (< 1080px) — simple per-card reveals ----------------
  mm.add('(max-width: 1079px)', () => {

    gsap.to('.ba-kicker', {
      opacity: 1,
      y: 0,
      duration: .8,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: '#ba',
        start: 'top 88%',
        toggleActions: 'play none none reverse',
      },
    });

    gsap.utils.toArray('#ba .ba-card').forEach((card, i) => {
      gsap.to(card, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: .85,
        delay: i * .06,
        ease: 'power3.out',
        clearProps: 'transform',
        scrollTrigger: {
          trigger: card,
          start: 'top 90%',
          toggleActions: 'play none none reverse',
        },
      });
    });

  });

  // ── Mouse tilt + spotlight — non-touch devices only ────────────────────────
  if (!window.matchMedia('(hover: none)').matches) {

    document.querySelectorAll('#ba [data-ba-tilt]').forEach(card => {
      const spotlight = card.querySelector('.ba-card__spotlight');
      const MAX_TILT  = 5.5; // degrees

      let rafId    = null;
      let targetX  = 0, targetY  = 0;
      let currentX = 0, currentY = 0;

      // Track cursor position
      card.addEventListener('mousemove', e => {
        const r  = card.getBoundingClientRect();
        // Normalise to -1 → +1
        const nx = ((e.clientX - r.left) / r.width)  * 2 - 1;
        const ny = ((e.clientY - r.top)  / r.height) * 2 - 1;

        targetX = -ny * MAX_TILT;
        targetY =  nx * MAX_TILT;

        // Move spotlight
        if (spotlight) {
          const sx = ((e.clientX - r.left) / r.width)  * 100;
          const sy = ((e.clientY - r.top)  / r.height) * 100;
          spotlight.style.setProperty('--sx', `${sx}%`);
          spotlight.style.setProperty('--sy', `${sy}%`);
        }

        if (!rafId) rafId = requestAnimationFrame(tick);
      });

      // Reset on leave
      card.addEventListener('mouseleave', () => {
        targetX = 0;
        targetY = 0;
        if (!rafId) rafId = requestAnimationFrame(tick);
      });

      // Lerp loop
      function tick() {
        currentX += (targetX - currentX) * .1;
        currentY += (targetY - currentY) * .1;

        const diff = Math.abs(targetX - currentX) + Math.abs(targetY - currentY);

        if (diff > 0.015) {
          card.style.transform =
            `perspective(900px) rotateX(${currentX.toFixed(3)}deg) rotateY(${currentY.toFixed(3)}deg)`;
          rafId = requestAnimationFrame(tick);
        } else {
          // Settle cleanly
          card.style.transform = (targetX === 0 && targetY === 0)
            ? ''
            : `perspective(900px) rotateX(${targetX}deg) rotateY(${targetY}deg)`;
          rafId = null;
        }
      }
    });

  }

})();
