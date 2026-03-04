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
  const cooldownMs = 520;
  const scrollAnimDurationMs = 300;
  const wheelThreshold = 18;
  const touchThreshold = 60;

  const slides = Array.from(reelsFeed.querySelectorAll('.reel-slide'));
  const videos = slides.map((slide) => slide.querySelector('.reel-video'));
  const feedbackOverlays = slides.map((slide) => slide.querySelector('[data-playback-feedback]'));
  const audioToggle = document.querySelector('[data-audio-toggle]');

  let activeIndex = 0;
  let isInputLocked = false;
  let touchStartY = null;
  let tapStartPoint = null;
  let scrollEndTimer = null;
  let feedbackTimer = null;
  let scrollAnimRafId = null;
  let isProgrammaticScroll = false;
  let isSoundOn = false;

  const clampIndex = (index) => Math.max(0, Math.min(index, slides.length - 1));
  const viewportHeight = () => reelsFeed.clientHeight || window.innerHeight;

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
    isInputLocked = true;
    window.setTimeout(() => {
      isInputLocked = false;
    }, cooldownMs);
  };

  const cancelProgrammaticAnimation = () => {
    if (scrollAnimRafId !== null) {
      window.cancelAnimationFrame(scrollAnimRafId);
      scrollAnimRafId = null;
    }
    isProgrammaticScroll = false;
  };

  // Easing close to app-like behavior: quick start and gentle settle.
  const easeOutAppLike = (t) => 1 - Math.pow(1 - t, 3);

  const animateScrollTo = (targetTop, durationMs) => {
    cancelProgrammaticAnimation();

    const startTop = reelsFeed.scrollTop;
    const distance = targetTop - startTop;
    if (Math.abs(distance) < 1) {
      reelsFeed.scrollTop = targetTop;
      return;
    }

    const startTime = performance.now();
    isProgrammaticScroll = true;

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
      isProgrammaticScroll = false;
    };

    scrollAnimRafId = window.requestAnimationFrame(tick);
  };

  const scrollToIndex = (index, smooth = true, shouldLock = false) => {
    activeIndex = clampIndex(index);
    const targetTop = activeIndex * viewportHeight();

    if (reduceMotion || !smooth) {
      cancelProgrammaticAnimation();
      reelsFeed.scrollTop = targetTop;
    } else {
      animateScrollTo(targetTop, scrollAnimDurationMs);
    }

    updatePreload();

    if (shouldLock) lockInput();
  };

  const snapToNearest = (smooth = true) => {
    const nearest = clampIndex(Math.round(reelsFeed.scrollTop / viewportHeight()));
    const targetTop = nearest * viewportHeight();
    const isAlreadyAligned = Math.abs(reelsFeed.scrollTop - targetTop) < 1;
    if (nearest !== activeIndex) activeIndex = nearest;
    if (isAlreadyAligned) return;
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

  const handleWheelStep = (event) => {
    if (Math.abs(event.deltaY) < wheelThreshold) return;
    event.preventDefault();
    if (isInputLocked) return;

    const step = event.deltaY > 0 ? 1 : -1;
    scrollToIndex(activeIndex + step, true, true);
  };

  // Global wheel listener allows step-scroll even when pointer is on side black areas.
  window.addEventListener('wheel', handleWheelStep, { passive: false });

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

  reelsFeed.addEventListener('scroll', () => {
    if (isProgrammaticScroll) return;
    if (scrollEndTimer) window.clearTimeout(scrollEndTimer);

    // Force final alignment to one slide so user can't stop between videos.
    scrollEndTimer = window.setTimeout(() => {
      snapToNearest(false);
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
  scrollToIndex(0, false, false);
  syncPlayback();
}
