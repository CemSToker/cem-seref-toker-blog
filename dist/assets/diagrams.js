// Keep decorative motion quiet when offscreen or reduced motion is preferred.
const figures = document.querySelectorAll('.science-figure');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const visible = new Set();
const sync = () => figures.forEach(figure => figure.classList.toggle('is-animating', visible.has(figure) && !document.hidden && !reducedMotion.matches));
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    }
    sync();
  }, { threshold: 0.15 });
  figures.forEach(figure => observer.observe(figure));
} else { figures.forEach(figure => visible.add(figure)); sync(); }
document.addEventListener('visibilitychange', sync);
reducedMotion.addEventListener('change', sync);
