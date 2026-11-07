document.addEventListener('click', event => {
  const target = event.target.closest('[data-confirm]');
  if (!target) {
    return;
  }

  const message = target.getAttribute('data-confirm');
  if (message && !window.confirm(message)) {
    event.preventDefault();
  }
});

document.addEventListener('submit', event => {
  const form = event.target.closest('[data-prevent-double-submit]');
  if (!form) return;
  if (form.dataset.submitting === 'true') {
    event.preventDefault();
    return;
  }
  form.dataset.submitting = 'true';
  form.querySelectorAll('button[type="submit"]').forEach(button => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  });
});

document.addEventListener('change', event => {
  const input = event.target;
  if (!input.matches('input[type="file"][data-max-bytes]')) return;
  const tooLarge = input.files.length && input.files[0].size > Number(input.dataset.maxBytes);
  input.setCustomValidity(tooLarge ? 'El adjunto supera el máximo de 10 MB.' : '');
  if (tooLarge) input.reportValidity();
});

window.addEventListener('pageshow', () => {
  document.querySelectorAll('[data-prevent-double-submit]').forEach(form => {
    delete form.dataset.submitting;
    form.querySelectorAll('button[type="submit"]').forEach(button => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    });
  });
});

document.querySelectorAll('[data-carousel]').forEach(carousel => {
  const slides = [...carousel.querySelectorAll('[data-carousel-slide]')];
  if (slides.length < 2) return;
  const viewport = carousel.querySelector('[data-carousel-slides]');
  const counter = carousel.querySelector('[data-carousel-counter]');
  const toggle = carousel.querySelector('[data-carousel-toggle]');
  const toggleIcon = toggle.querySelector('[data-carousel-toggle-icon]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;
  let playing = !reducedMotion.matches;
  let hovering = false;
  let timer;
  let touchStart;

  const schedule = () => {
    clearTimeout(timer);
    const label = playing ? 'Pausar carrusel' : 'Reanudar carrusel';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    toggleIcon.textContent = playing ? '\u2161' : '\u25b6';
    viewport.setAttribute('aria-live', playing ? 'off' : 'polite');
    if (playing && !hovering && !document.hidden) {
      timer = setTimeout(() => show(index + 1), 3000);
    }
  };
  const show = next => {
    slides[index].hidden = true;
    slides[index].classList.remove('active');
    index = (next + slides.length) % slides.length;
    slides[index].hidden = false;
    slides[index].classList.add('active');
    counter.textContent = `${index + 1} / ${slides.length}`;
    schedule();
  };
  const move = direction => {
    playing = false;
    show(index + direction);
  };
  carousel.querySelector('[data-carousel-prev]').addEventListener('click', () => move(-1));
  carousel.querySelector('[data-carousel-next]').addEventListener('click', () => move(1));
  toggle.addEventListener('click', () => {
    playing = !playing;
    schedule();
  });
  carousel.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    move(event.key === 'ArrowLeft' ? -1 : 1);
  });
  carousel.addEventListener('focusin', () => {
    playing = false;
    schedule();
  });
  carousel.addEventListener('mouseenter', () => { hovering = true; schedule(); });
  carousel.addEventListener('mouseleave', () => { hovering = false; schedule(); });
  viewport.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    touchStart = { x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointerup', event => {
    if (!touchStart) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    touchStart = undefined;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
  });
  viewport.addEventListener('pointercancel', () => { touchStart = undefined; });
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) playing = false;
    schedule();
  });
  carousel.querySelector('[data-carousel-controls]').hidden = false;
  carousel.querySelector('[data-carousel-prev]').hidden = false;
  carousel.querySelector('[data-carousel-next]').hidden = false;
  schedule();
});