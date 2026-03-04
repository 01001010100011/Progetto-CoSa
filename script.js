const revealElements = document.querySelectorAll('.reveal');
document.body.classList.add('js-enabled');

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('show');
        observer.unobserve(entry.target);
      }
    });
  },
  {
    threshold: 0.16,
    rootMargin: '0px 0px -40px 0px',
  }
);

revealElements.forEach((el) => observer.observe(el));

const reelVideos = document.querySelectorAll('.reel-video');

if (reelVideos.length > 0) {
  const playVisibleVideo = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.7) {
          reelVideos.forEach((other) => {
            if (other !== video) other.pause();
          });
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    },
    {
      threshold: [0.3, 0.7, 1],
    }
  );

  reelVideos.forEach((video) => playVisibleVideo.observe(video));
}
