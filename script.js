const revealItems = document.querySelectorAll(
  ".hero-copy > *, .hero-panel > *, .section-title, .missione-grid article, .azioni-cards .card, .rete-item, .numero, .footer-inner > *"
);

revealItems.forEach((item, index) => {
  item.classList.add("reveal");
  const delay = index % 4;
  item.classList.add(`delay-${delay}`);
});
