const revealElements = document.querySelectorAll('.reveal');
document.body.classList.add('js-enabled');

if (revealElements.length > 0) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('show');
          revealObserver.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.16,
      rootMargin: '0px 0px -40px 0px',
    }
  );

  revealElements.forEach((el) => revealObserver.observe(el));
}

const reelsFeed = document.querySelector('[data-reels-feed]');

if (reelsFeed) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cooldownMs = 650;
  const wheelThreshold = 18;
  const touchThreshold = 45;

  const slides = Array.from(reelsFeed.querySelectorAll('.reel-slide'));
  const videos = slides.map((slide) => slide.querySelector('.reel-video'));

  let activeIndex = 0;
  let isCooldown = false;
  let touchStartY = null;

  const clampIndex = (index) => Math.max(0, Math.min(index, slides.length - 1));

  // Keep network usage light by prioritizing current and next video only.
  const updatePreload = () => {
    videos.forEach((video, index) => {
      if (!video) return;
      video.preload = index === activeIndex || index === activeIndex + 1 ? 'auto' : 'metadata';
    });
  };

  const syncPlayback = () => {
    videos.forEach((video, index) => {
      if (!video) return;
      if (index === activeIndex) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  };

  const goToIndex = (nextIndex, fromUserInput = false) => {
    const targetIndex = clampIndex(nextIndex);
    if (targetIndex === activeIndex && fromUserInput) return;

    activeIndex = targetIndex;
    reelsFeed.scrollTo({
      top: activeIndex * window.innerHeight,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });

    updatePreload();

    if (fromUserInput) {
      isCooldown = true;
      window.setTimeout(() => {
        isCooldown = false;
      }, cooldownMs);
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      let bestVisible = null;

      entries.forEach((entry) => {
        if (entry.intersectionRatio >= 0.6) {
          if (!bestVisible || entry.intersectionRatio > bestVisible.intersectionRatio) {
            bestVisible = entry;
          }
        }
      });

      if (bestVisible) {
        const newIndex = Number(bestVisible.target.dataset.index || 0);
        if (newIndex !== activeIndex) {
          activeIndex = newIndex;
          updatePreload();
        }
        syncPlayback();
      } else {
        videos.forEach((video) => video && video.pause());
      }
    },
    {
      root: reelsFeed,
      threshold: [0.25, 0.6, 0.85],
    }
  );

  slides.forEach((slide) => observer.observe(slide));

  reelsFeed.addEventListener(
    'wheel',
    (event) => {
      if (Math.abs(event.deltaY) < wheelThreshold) return;
      event.preventDefault();
      if (isCooldown) return;

      goToIndex(activeIndex + (event.deltaY > 0 ? 1 : -1), true);
    },
    { passive: false }
  );

  reelsFeed.addEventListener('touchstart', (event) => {
    touchStartY = event.changedTouches[0].clientY;
  });

  reelsFeed.addEventListener('touchend', (event) => {
    if (touchStartY === null || isCooldown) return;

    const deltaY = touchStartY - event.changedTouches[0].clientY;
    if (Math.abs(deltaY) < touchThreshold) {
      touchStartY = null;
      return;
    }

    goToIndex(activeIndex + (deltaY > 0 ? 1 : -1), true);
    touchStartY = null;
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      if (!isCooldown) goToIndex(activeIndex + 1, true);
    }

    if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      if (!isCooldown) goToIndex(activeIndex - 1, true);
    }
  });

  window.addEventListener('resize', () => {
    reelsFeed.scrollTo({ top: activeIndex * window.innerHeight, behavior: 'auto' });
  });

  // Ensure deterministic initial state.
  goToIndex(0, false);
  syncPlayback();
}
