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
  const scrollAnimDurationMs = 300;
  const wheelStepThreshold = 64;
  const touchThreshold = 75;
  const scrollHintVisibleMs = 2500;
  const scrollHintExitMs = 240;

  const slides = Array.from(reelsFeed.querySelectorAll('.reel-slide'));
  const videos = slides.map((slide) => slide.querySelector('.reel-video'));
  const feedbackOverlays = slides.map((slide) => slide.querySelector('[data-playback-feedback]'));
  const metaBlocks = slides.map((slide) => ({
    src: slide.dataset.metaSrc,
    titleEl: slide.querySelector('[data-video-title]'),
    descEl: slide.querySelector('[data-video-description]'),
    toggleEl: slide.querySelector('[data-video-toggle]'),
  }));
  const desktopMetaEls = {
    title: document.querySelector('[data-desktop-video-title]'),
    description: document.querySelector('[data-desktop-video-description]'),
    shotBy: document.querySelector('[data-desktop-video-shotby]'),
    editedBy: document.querySelector('[data-desktop-video-editedby]'),
  };
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
  const expandedDescriptions = new Array(slides.length).fill(false);
  const metadataLoaded = new Array(slides.length).fill(false);
  const metadataState = slides.map(() => ({
    title: 'Video',
    description: '',
    shotBy: 'In aggiornamento',
    editedBy: 'In aggiornamento',
  }));

  const clampIndex = (index) => Math.max(0, Math.min(index, slides.length - 1));

  // Keep network usage light by prioritizing only current and next video.
  const updatePreload = () => {
    videos.forEach((video, index) => {
      if (!video) return;
      video.preload = index === activeIndex || index === activeIndex + 1 ? 'auto' : 'metadata';
    });
  };

  const parseVideoMetadata = (rawText) => {
    const matchField = (name) =>
      rawText.match(new RegExp(`^\\s*${name}:\\s*"([\\s\\S]*?)"\\s*$`, 'im'));

    const titleMatch = matchField('title');
    const descriptionMatch = matchField('description');
    const shotByMatch = matchField('shot_by');
    const editedByMatch = matchField('edited_by');

    if (titleMatch || descriptionMatch || shotByMatch || editedByMatch) {
      return {
        title: (titleMatch?.[1] || 'Video').trim(),
        description: (descriptionMatch?.[1] || '').trim(),
        shotBy: (shotByMatch?.[1] || 'In aggiornamento').trim(),
        editedBy: (editedByMatch?.[1] || 'In aggiornamento').trim(),
      };
    }

    const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      return {
        title: 'Video',
        description: '',
        shotBy: 'In aggiornamento',
        editedBy: 'In aggiornamento',
      };
    }

    const first = lines[0];
    const title = first.startsWith('#') ? first.replace(/^#+\s*/, '') : first;
    const description = lines.slice(1).join(' ').trim();
    return {
      title,
      description,
      shotBy: 'In aggiornamento',
      editedBy: 'In aggiornamento',
    };
  };

  const renderDesktopMetadata = (index) => {
    const meta = metadataState[index];
    if (!meta) return;

    if (desktopMetaEls.title) {
      desktopMetaEls.title.textContent = meta.title || 'Video';
    }

    if (desktopMetaEls.description) {
      desktopMetaEls.description.textContent =
        meta.description || 'Nessuna descrizione disponibile per questo contenuto.';
    }

    if (desktopMetaEls.shotBy) {
      desktopMetaEls.shotBy.textContent = meta.shotBy || 'In aggiornamento';
    }

    if (desktopMetaEls.editedBy) {
      desktopMetaEls.editedBy.textContent = meta.editedBy || 'In aggiornamento';
    }
  };

  const updateMetaToggleVisibility = (index) => {
    const meta = metaBlocks[index];
    if (!meta || !meta.descEl || !meta.toggleEl) return;

    const wasExpanded = expandedDescriptions[index];
    meta.descEl.classList.add('is-clamped');
    meta.descEl.classList.remove('is-expanded');
    const hasOverflow = meta.descEl.scrollHeight > meta.descEl.clientHeight + 1;

    if (!hasOverflow) {
      expandedDescriptions[index] = false;
      meta.descEl.classList.remove('is-clamped', 'is-expanded');
      meta.toggleEl.hidden = true;
      return;
    }

    meta.toggleEl.hidden = false;
    if (wasExpanded) {
      meta.descEl.classList.remove('is-clamped');
      meta.descEl.classList.add('is-expanded');
      meta.toggleEl.textContent = 'MOSTRA MENO';
      meta.toggleEl.setAttribute('aria-label', 'Mostra meno descrizione');
    } else {
      meta.descEl.classList.add('is-clamped');
      meta.descEl.classList.remove('is-expanded');
      meta.toggleEl.textContent = 'MOSTRA ALTRO';
      meta.toggleEl.setAttribute('aria-label', 'Mostra descrizione completa');
    }
  };

  const collapseDescription = (index) => {
    const meta = metaBlocks[index];
    if (!meta || !meta.descEl || !meta.toggleEl) return;
    expandedDescriptions[index] = false;
    meta.descEl.classList.add('is-clamped');
    meta.descEl.classList.remove('is-expanded');
    updateMetaToggleVisibility(index);
  };

  const collapseDescriptionsExcept = (index) => {
    expandedDescriptions.forEach((isOpen, i) => {
      if (i !== index && isOpen) collapseDescription(i);
    });
  };

  const loadMetadataForSlide = async (index) => {
    if (metadataLoaded[index]) return;

    const meta = metaBlocks[index];
    if (!meta || !meta.src || !meta.titleEl || !meta.descEl || !meta.toggleEl) return;

    try {
      const res = await fetch(meta.src, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Metadata HTTP ${res.status}`);
      const raw = await res.text();
      const parsed = parseVideoMetadata(raw);
      metadataState[index] = parsed;
      meta.titleEl.textContent = parsed.title || 'Video';
      meta.descEl.textContent = parsed.description || '';
      metadataLoaded[index] = true;
      requestAnimationFrame(() => {
        updateMetaToggleVisibility(index);
        if (index === activeIndex) renderDesktopMetadata(index);
      });
    } catch (_error) {
      metadataState[index] = {
        title: 'Video',
        description: '',
        shotBy: 'In aggiornamento',
        editedBy: 'In aggiornamento',
      };
      meta.titleEl.textContent = 'Video';
      meta.descEl.textContent = '';
      meta.toggleEl.hidden = true;
      metadataLoaded[index] = true;
      if (index === activeIndex) renderDesktopMetadata(index);
    }
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

  const ensureActiveVideoPlays = () => {
    const activeVideo = videos[activeIndex];
    if (!activeVideo) return;
    applyAudioState();
    videos.forEach((video, index) => {
      if (!video) return;
      if (index !== activeIndex) video.pause();
    });
    activeVideo.play().catch(() => {
      // Keep UI responsive even when autoplay policies block playback.
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

  const hideScrollHint = () => {
    if (!scrollHint) return;
    if (hintShowTimer) window.clearTimeout(hintShowTimer);
    if (hintHideTimer) window.clearTimeout(hintHideTimer);
    if (!scrollHint.classList.contains('is-visible')) return;

    scrollHint.classList.remove('is-visible');
    scrollHint.classList.add('is-hiding');
    hintHideTimer = window.setTimeout(() => {
      scrollHint.classList.remove('is-hiding');
    }, scrollHintExitMs);
  };

  const maybeShowScrollHint = () => {
    if (!scrollHint || hasUserStepped || activeIndex !== 0 || reduceMotion) return;
    if (hintShowTimer) window.clearTimeout(hintShowTimer);
    if (hintHideTimer) window.clearTimeout(hintHideTimer);

    hintShowTimer = window.setTimeout(() => {
      scrollHint.classList.remove('is-hiding');
      scrollHint.classList.add('is-visible');
      hintHideTimer = window.setTimeout(() => {
        hideScrollHint();
      }, scrollHintVisibleMs);
    }, 300);
  };

  const setSnapEnabled = (enabled) => {
    reelsFeed.style.scrollSnapType = enabled ? 'y mandatory' : 'none';
  };

  const cancelAnimation = () => {
    if (scrollAnimRafId !== null) {
      window.cancelAnimationFrame(scrollAnimRafId);
      scrollAnimRafId = null;
    }
    isAnimating = false;
    setSnapEnabled(true);
  };

  // App-like curve: immediate start and soft settle.
  const easeOutAppLike = (t) => 1 - Math.pow(1 - t, 3);

  const animateScrollTo = (targetTop, durationMs) => {
    cancelAnimation();

    const startTop = reelsFeed.scrollTop;
    const distance = targetTop - startTop;
    if (Math.abs(distance) < 1) {
      reelsFeed.scrollTop = targetTop;
      ensureActiveVideoPlays();
      return;
    }

    const startTime = performance.now();
    isAnimating = true;
    setSnapEnabled(false);

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
      setSnapEnabled(true);
      ensureActiveVideoPlays();
    };

    scrollAnimRafId = window.requestAnimationFrame(tick);
  };

  const goToIndex = (nextIndex, animated = true) => {
    activeIndex = clampIndex(nextIndex);
    const targetTop = activeIndex * viewportHeight;

    if (reduceMotion || !animated) {
      cancelAnimation();
      reelsFeed.scrollTop = targetTop;
      ensureActiveVideoPlays();
    } else {
      animateScrollTo(targetTop, scrollAnimDurationMs);
    }

    updatePreload();
    collapseDescriptionsExcept(activeIndex);
    renderDesktopMetadata(activeIndex);
  };

  const stepTo = (step) => {
    if (isAnimating || isCooldown) return;
    const targetIndex = clampIndex(activeIndex + step);
    if (targetIndex === activeIndex) return;
    hasUserStepped = true;
    hideScrollHint();
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

      if (activeIndex > 0) hideScrollHint();
      else maybeShowScrollHint();

      collapseDescriptionsExcept(activeIndex);
      renderDesktopMetadata(activeIndex);
      syncPlayback();
    },
    {
      root: reelsFeed,
      threshold: [0.25, 0.6, 0.85],
    }
  );

  slides.forEach((slide) => observer.observe(slide));

  const handleWheelStep = (event) => {
    if (event.target instanceof Element && event.target.closest('.video-meta-description.is-expanded')) {
      return;
    }

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
    if (
      event.target instanceof Element &&
      event.target.closest('.video-meta-description.is-expanded')
    ) {
      touchStartY = null;
      return;
    }
    touchStartY = event.changedTouches[0].clientY;
  });

  reelsFeed.addEventListener(
    'touchmove',
    (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.video-meta-description.is-expanded')
      ) {
        return;
      }
      if (!isAnimating) event.preventDefault();
    },
    { passive: false }
  );

  reelsFeed.addEventListener('touchend', (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('.video-meta-description.is-expanded')
    ) {
      touchStartY = null;
      return;
    }

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
    metaBlocks.forEach((_meta, index) => {
      if (metadataLoaded[index]) updateMetaToggleVisibility(index);
    });
    goToIndex(activeIndex, false);
  });

  metaBlocks.forEach((meta, index) => {
    if (!meta || !meta.toggleEl || !meta.descEl) return;

    loadMetadataForSlide(index);

    meta.toggleEl.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const willExpand = !expandedDescriptions[index];
      expandedDescriptions[index] = willExpand;
      if (willExpand) {
        meta.descEl.classList.remove('is-clamped');
        meta.descEl.classList.add('is-expanded');
        meta.toggleEl.textContent = 'MOSTRA MENO';
        meta.toggleEl.setAttribute('aria-label', 'Mostra meno descrizione');
      } else {
        collapseDescription(index);
      }
      updateMetaToggleVisibility(index);
    });

    meta.descEl.addEventListener(
      'wheel',
      (event) => {
        if (!expandedDescriptions[index]) return;
        event.stopPropagation();
      },
      { passive: true }
    );
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
  renderDesktopMetadata(activeIndex);
  ensureActiveVideoPlays();
}
