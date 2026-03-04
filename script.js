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
  const cooldownMs = 620;
  const scrollAnimDurationMs = 240;
  const wheelStepThreshold = 64;
  const touchThreshold = 75;
  const scrollHintStorageKey = 'videoViewerScrollHintShown';

  const slides = Array.from(reelsFeed.querySelectorAll('.reel-slide'));
  const videos = slides.map((slide) => slide.querySelector('.reel-video'));
  const feedbackOverlays = slides.map((slide) => slide.querySelector('[data-playback-feedback]'));
  const audioToggle = document.querySelector('[data-audio-toggle]');
  const scrollHint = document.querySelector('[data-scroll-hint]');

  let activeIndex = 0;
  let isCooldown = false;
  let isAnimating = false;
  let touchStartY = null;
  let tapStartPoint = null;
  let feedbackTimer = null;
  let scrollAnimRafId = null;
  let wheelDeltaAccumulator = 0;
  let lastWheelTime = 0;
  let viewportHeight = reelsFeed.clientHeight || window.innerHeight;
  let isSoundOn = false;
  let hasUserStepped = false;
  let hintShowTimer = null;
  let hintHideTimer = null;
  let hasShownScrollHint = false;

  try {
    hasShownScrollHint = sessionStorage.getItem(scrollHintStorageKey) === 'true';
  } catch (_error) {
    hasShownScrollHint = false;
  }

  const clampIndex = (index) => Math.max(0, Math.min(index, slides.length - 1));

  // Keep network usage light by prioritizing only current and next video.
  const updatePreload = () => {
    videos.forEach((video, index) => {
      if (!video) return;
      video.preload = index === activeIndex || index === activeIndex + 1 ? 'auto' : 'metadata';
    });
  };

  const applyAudioState = () => {
    videos.forEach((video, index) => {
      if (!video) return;
      // Keep autoplay compatibility: default muted until explicit user gesture.
      const shouldUnmute = isSoundOn && index === activeIndex;
      video.muted = !shouldUnmute;
      if (shouldUnmute) video.volume = 1;
    });
  };

  const updateAudioToggleUi = () => {
    if (!audioToggle) return;
    audioToggle.classList.toggle('is-unmuted', isSoundOn);
    audioToggle.classList.toggle('is-muted', !isSoundOn);
    audioToggle.setAttribute('aria-pressed', String(isSoundOn));
    audioToggle.setAttribute('aria-label', isSoundOn ? 'Disattiva audio' : 'Attiva audio');
  };

  const syncPlayback = () => {
    applyAudioState();
    videos.forEach((video, index) => {
      if (!video) return;
      if (index === activeIndex) {
        video.play().catch(() => {
          // If unmuted play is rejected, keep state and wait for next user gesture.
        });
      } else {
        video.pause();
      }
    });
  };

  const showPlaybackFeedback = (mode, index = activeIndex) => {
    const feedback = feedbackOverlays[index];
    if (!feedback) return;

    feedbackOverlays.forEach((overlay) => {
      if (overlay) overlay.classList.remove('play', 'pause', 'show');
    });

    // Force reflow so the animation restarts on every tap.
    void feedback.offsetWidth;
    feedback.classList.add(mode, 'show');

    if (feedbackTimer) window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => {
      feedback.classList.remove('show');
    }, 720);
  };

  const lockInput = () => {
    isCooldown = true;
    window.setTimeout(() => {
      isCooldown = false;
    }, cooldownMs);
  };

  const hideScrollHint = (markAsShown = false) => {
    if (!scrollHint) return;
    if (hintShowTimer) window.clearTimeout(hintShowTimer);
    if (hintHideTimer) window.clearTimeout(hintHideTimer);
    scrollHint.classList.remove('is-visible');

    if (markAsShown && !hasShownScrollHint) {
      hasShownScrollHint = true;
      try {
        sessionStorage.setItem(scrollHintStorageKey, 'true');
      } catch (_error) {
        // Ignore storage failures.
      }
    }
  };

  const maybeShowScrollHint = () => {
    if (!scrollHint || hasShownScrollHint || hasUserStepped || activeIndex !== 0 || reduceMotion) return;
    if (hintShowTimer) window.clearTimeout(hintShowTimer);
    if (hintHideTimer) window.clearTimeout(hintHideTimer);

    hintShowTimer = window.setTimeout(() => {
      scrollHint.classList.add('is-visible');
      hintHideTimer = window.setTimeout(() => {
        hideScrollHint(true);
      }, 1200);
    }, 300);
  };

  const cancelAnimation = () => {
    if (scrollAnimRafId !== null) {
      window.cancelAnimationFrame(scrollAnimRafId);
      scrollAnimRafId = null;
    }
    isAnimating = false;
  };

  // App-like curve: immediate start and soft settle.
  const easeOutAppLike = (t) => 1 - Math.pow(1 - t, 3);

  const animateScrollTo = (targetTop, durationMs) => {
    cancelAnimation();

    const startTop = reelsFeed.scrollTop;
    const distance = targetTop - startTop;
    if (Math.abs(distance) < 1) {
      reelsFeed.scrollTop = targetTop;
      return;
    }

    const startTime = performance.now();
    isAnimating = true;

    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      reelsFeed.scrollTop = startTop + distance * easeOutAppLike(progress);

      if (progress < 1) {
        scrollAnimRafId = window.requestAnimationFrame(tick);
        return;
      }

      reelsFeed.scrollTop = targetTop;
      scrollAnimRafId = null;
      isAnimating = false;
    };

    scrollAnimRafId = window.requestAnimationFrame(tick);
  };

  const goToIndex = (nextIndex, animated = true) => {
    activeIndex = clampIndex(nextIndex);
    const targetTop = activeIndex * viewportHeight;

    if (reduceMotion || !animated) {
      cancelAnimation();
      reelsFeed.scrollTop = targetTop;
    } else {
      animateScrollTo(targetTop, scrollAnimDurationMs);
    }

    updatePreload();
  };

  const stepTo = (step) => {
    if (isAnimating || isCooldown) return;
    const targetIndex = clampIndex(activeIndex + step);
    if (targetIndex === activeIndex) return;
    hasUserStepped = true;
    hideScrollHint(true);
    goToIndex(targetIndex, true);
    lockInput();
  };

  const observer = new IntersectionObserver(
    (entries) => {
      if (isAnimating) return;

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

      if (activeIndex > 0) hideScrollHint(true);
      else maybeShowScrollHint();

      syncPlayback();
    },
    {
      root: reelsFeed,
      threshold: [0.25, 0.6, 0.85],
    }
  );

  slides.forEach((slide) => observer.observe(slide));

  const handleWheelStep = (event) => {
    const now = performance.now();
    if (now - lastWheelTime > 180) wheelDeltaAccumulator = 0;
    lastWheelTime = now;

    wheelDeltaAccumulator += event.deltaY;

    if (Math.abs(wheelDeltaAccumulator) < wheelStepThreshold) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    const step = wheelDeltaAccumulator > 0 ? 1 : -1;
    wheelDeltaAccumulator = 0;
    stepTo(step);
  };

  // Global wheel listener allows step-scroll even when pointer is on side black areas.
  window.addEventListener('wheel', handleWheelStep, { passive: false });

  reelsFeed.addEventListener('touchstart', (event) => {
    if (isAnimating) return;
    touchStartY = event.changedTouches[0].clientY;
  });

  reelsFeed.addEventListener(
    'touchmove',
    (event) => {
      if (!isAnimating) event.preventDefault();
    },
    { passive: false }
  );

  reelsFeed.addEventListener('touchend', (event) => {
    if (touchStartY === null || isAnimating || isCooldown) {
      touchStartY = null;
      return;
    }

    const deltaY = touchStartY - event.changedTouches[0].clientY;
    touchStartY = null;

    if (Math.abs(deltaY) < touchThreshold) {
      return;
    }

    stepTo(deltaY > 0 ? 1 : -1);
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
        showPlaybackFeedback('pause', activeIndex);
      } else {
        video.pause();
        showPlaybackFeedback('play', activeIndex);
      }

      tapStartPoint = null;
    });

    slide.addEventListener('pointercancel', () => {
      tapStartPoint = null;
    });
  });

  window.addEventListener('keydown', (event) => {
    if (isAnimating || isCooldown) return;

    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      stepTo(1);
    }

    if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      stepTo(-1);
    }
  });

  window.addEventListener('resize', () => {
    viewportHeight = reelsFeed.clientHeight || window.innerHeight;
    goToIndex(activeIndex, false);
  });

  if (audioToggle) {
    audioToggle.addEventListener('click', () => {
      isSoundOn = !isSoundOn;
      updateAudioToggleUi();
      applyAudioState();

      const activeVideo = videos[activeIndex];
      if (activeVideo && isSoundOn) {
        activeVideo.play().catch(() => {});
      }
    });
  }

  updateAudioToggleUi();
  goToIndex(0, false);
  maybeShowScrollHint();
  syncPlayback();
}
