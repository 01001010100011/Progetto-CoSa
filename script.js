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
  const cooldownMs = 700;
  const wheelThreshold = 18;
  const touchThreshold = 60;

  const slides = Array.from(reelsFeed.querySelectorAll('.reel-slide'));
  const videos = slides.map((slide) => slide.querySelector('.reel-video'));
  const feedback = document.querySelector('[data-playback-feedback]');

  let activeIndex = 0;
  let isInputLocked = false;
  let touchStartY = null;
  let tapStartPoint = null;
  let scrollEndTimer = null;
  let feedbackTimer = null;

  const clampIndex = (index) => Math.max(0, Math.min(index, slides.length - 1));
  const viewportHeight = () => reelsFeed.clientHeight || window.innerHeight;

  // Keep network usage light by prioritizing only current and next video.
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

  const showPlaybackFeedback = (mode) => {
    if (!feedback) return;

    feedback.classList.remove('play', 'pause', 'show');
    // Force reflow so the animation restarts on every tap.
    void feedback.offsetWidth;
    feedback.classList.add(mode, 'show');

    if (feedbackTimer) window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => {
      feedback.classList.remove('show');
    }, 720);
  };

  const lockInput = () => {
    isInputLocked = true;
    window.setTimeout(() => {
      isInputLocked = false;
    }, cooldownMs);
  };

  const scrollToIndex = (index, smooth = true, shouldLock = false) => {
    activeIndex = clampIndex(index);
    reelsFeed.scrollTo({
      top: activeIndex * viewportHeight(),
      behavior: reduceMotion || !smooth ? 'auto' : 'smooth',
    });

    updatePreload();

    if (shouldLock) lockInput();
  };

  const snapToNearest = (smooth = true) => {
    const nearest = clampIndex(Math.round(reelsFeed.scrollTop / viewportHeight()));
    if (nearest !== activeIndex) {
      activeIndex = nearest;
      updatePreload();
    }
    scrollToIndex(nearest, smooth, false);
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

      if (!bestVisible) {
        videos.forEach((video) => video && video.pause());
        return;
      }

      const nextActiveIndex = Number(bestVisible.target.dataset.index || 0);
      if (nextActiveIndex !== activeIndex) {
        activeIndex = nextActiveIndex;
        updatePreload();
      }

      syncPlayback();
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
      if (isInputLocked) return;

      const step = event.deltaY > 0 ? 1 : -1;
      scrollToIndex(activeIndex + step, true, true);
    },
    { passive: false }
  );

  reelsFeed.addEventListener('touchstart', (event) => {
    touchStartY = event.changedTouches[0].clientY;
  });

  reelsFeed.addEventListener('touchend', (event) => {
    if (touchStartY === null || isInputLocked) {
      touchStartY = null;
      return;
    }

    const deltaY = touchStartY - event.changedTouches[0].clientY;
    touchStartY = null;

    if (Math.abs(deltaY) < touchThreshold) {
      snapToNearest(false);
      return;
    }

    const step = deltaY > 0 ? 1 : -1;
    scrollToIndex(activeIndex + step, true, true);
  });

  slides.forEach((slide, index) => {
    slide.addEventListener('pointerdown', (event) => {
      tapStartPoint = { x: event.clientX, y: event.clientY, index };
    });

    slide.addEventListener('pointerup', (event) => {
      if (!tapStartPoint) return;

      const deltaX = Math.abs(event.clientX - tapStartPoint.x);
      const deltaY = Math.abs(event.clientY - tapStartPoint.y);
      const isTap = deltaX < 10 && deltaY < 10;

      if (!isTap || tapStartPoint.index !== activeIndex) {
        tapStartPoint = null;
        return;
      }

      const video = videos[activeIndex];
      if (!video) {
        tapStartPoint = null;
        return;
      }

      if (video.paused) {
        video.play().catch(() => {});
        showPlaybackFeedback('pause');
      } else {
        video.pause();
        showPlaybackFeedback('play');
      }

      tapStartPoint = null;
    });

    slide.addEventListener('pointercancel', () => {
      tapStartPoint = null;
    });
  });

  reelsFeed.addEventListener('scroll', () => {
    if (scrollEndTimer) window.clearTimeout(scrollEndTimer);

    // Force final alignment to one slide so user can't stop between videos.
    scrollEndTimer = window.setTimeout(() => {
      snapToNearest(true);
    }, 120);
  });

  window.addEventListener('keydown', (event) => {
    if (isInputLocked) return;

    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      scrollToIndex(activeIndex + 1, true, true);
    }

    if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      scrollToIndex(activeIndex - 1, true, true);
    }
  });

  window.addEventListener('resize', () => {
    scrollToIndex(activeIndex, false, false);
  });

  scrollToIndex(0, false, false);
  syncPlayback();
}
