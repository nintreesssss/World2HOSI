// UI feedback runs independently of the WebGL render loop.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const actions = document.getElementById('actions');
const indicator = document.createElement('span');
indicator.className = 'selection-indicator';
indicator.setAttribute('aria-hidden', 'true');
actions.append(indicator);
let selectionAnimation, positioned = false, pointerSelection = false;
function positionSelection(animate = false) {
  const button = actions.querySelector('.active');
  if (!button) return;
  const previous = indicator.getBoundingClientRect();
  selectionAnimation?.cancel();
  indicator.style.left = `${button.offsetLeft}px`;
  indicator.style.top = `${button.offsetTop}px`;
  indicator.style.width = `${button.offsetWidth}px`;
  indicator.style.height = `${button.offsetHeight}px`;
  const next = indicator.getBoundingClientRect();
  if (positioned && animate && !reducedMotion.matches) {
    selectionAnimation = indicator.animate([
      { transform: `translate(${previous.x - next.x}px, ${previous.y - next.y}px) scale(${previous.width / next.width}, ${previous.height / next.height})` },
      { transform: 'translate(0, 0) scale(1)' }
    ], { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' });
  }
  positioned = true;
}
actions.addEventListener('click', event => { pointerSelection = event.detail > 0; }, true);
new MutationObserver(() => positionSelection(pointerSelection)).observe(actions, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
new ResizeObserver(() => positionSelection(false)).observe(actions);
document.fonts.ready.then(() => positionSelection(false));
positionSelection(false);

// Hold the pressed state briefly so even a very quick tap has visible feedback.
const releases = new WeakMap();
document.querySelectorAll('button, select').forEach(control => {
  let started = 0;
  function release() {
    clearTimeout(releases.get(control));
    releases.set(control, setTimeout(() => control.classList.remove('is-pressed'), Math.max(0, 110 - (performance.now() - started))));
  }
  control.addEventListener('pointerdown', event => {
    if (control.disabled || event.button !== 0) return;
    clearTimeout(releases.get(control));
    started = performance.now(); control.classList.add('is-pressed');
    window.addEventListener('pointerup', release, { once: true });
    window.addEventListener('pointercancel', release, { once: true });
  });
  control.addEventListener('blur', release);
});

const iconAnimations = new WeakMap();
document.querySelectorAll('#play, #replay, #reset-camera, #loop, #fullscreen').forEach(button => {
  button.addEventListener('click', event => {
    if (!event.detail || reducedMotion.matches) return;
    const icon = button.querySelector('svg');
    iconAnimations.get(icon)?.cancel();
    const frames = button.id === 'replay' || button.id === 'reset-camera'
      ? [{ transform: 'rotate(-100deg)' }, { transform: 'rotate(0deg)' }]
      : [{ transform: 'scale(.65)', opacity: .45 }, { transform: 'scale(1)', opacity: 1 }];
    iconAnimations.set(icon, icon.animate(frames, { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' }));
  });
});

const timeline = document.getElementById('timeline');
const timeTip = document.createElement('output');
timeTip.className = 'scrub-time'; timeTip.setAttribute('aria-hidden', 'true');
timeline.parentElement.append(timeTip);
function updateTimeTip() {
  const t = Number(timeline.value), fraction = t / Number(timeline.max);
  timeTip.textContent = `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  timeTip.style.left = `${timeline.offsetLeft + 7 + (timeline.offsetWidth - 14) * fraction}px`;
  timeTip.style.top = `${timeline.offsetTop - 30}px`;
}
timeline.addEventListener('pointerenter', () => { updateTimeTip(); timeTip.classList.add('visible'); });
timeline.addEventListener('pointerleave', () => timeTip.classList.remove('visible'));
timeline.addEventListener('input', updateTimeTip);
timeline.addEventListener('pointerdown', () => { updateTimeTip(); timeTip.classList.add('visible'); });
window.addEventListener('pointerup', () => { if (!timeline.matches(':hover')) timeTip.classList.remove('visible'); });

// Pointer-driven specular light, critically damped and idle when settled.
// This decorates the material only: slider values remain one-to-one with input.
document.querySelectorAll('.playback, .view-tools, .actions').forEach(host => {
  const surface = host === actions ? indicator : host;
  let x = .5, y = .15, tx = .5, ty = .15, vx = 0, vy = 0, raf = 0, previous = 0;
  function tick(now) {
    const dt = Math.min((now - previous) / 1000, .04); previous = now;
    const omega = 24, decay = Math.exp(-omega * dt);
    const ix = vx + omega * (x - tx), iy = vy + omega * (y - ty);
    x = tx + (x - tx + ix * dt) * decay; vx = (vx - omega * ix * dt) * decay;
    y = ty + (y - ty + iy * dt) * decay; vy = (vy - omega * iy * dt) * decay;
    surface.style.setProperty('--glass-x', `${x * 100}%`);
    surface.style.setProperty('--glass-y', `${y * 100}%`);
    if (Math.abs(x - tx) + Math.abs(y - ty) + Math.abs(vx) + Math.abs(vy) > .001) raf = requestAnimationFrame(tick);
    else raf = 0;
  }
  function track(event) {
    if (reducedMotion.matches || event.pointerType === 'touch') return;
    const rect = surface.getBoundingClientRect();
    tx = Math.max(0, Math.min(1, (event.clientX - rect.x) / rect.width));
    ty = Math.max(0, Math.min(1, (event.clientY - rect.y) / rect.height));
    if (!raf) { previous = performance.now(); raf = requestAnimationFrame(tick); }
  }
  host.addEventListener('pointerenter', event => { surface.classList.add('glass-hover'); track(event); });
  host.addEventListener('pointermove', track);
  host.addEventListener('pointerleave', () => surface.classList.remove('glass-hover'));
  host.addEventListener('pointerdown', () => surface.classList.add('glass-pressed'));
  const release = () => surface.classList.remove('glass-pressed');
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  reducedMotion.addEventListener('change', () => {
    cancelAnimationFrame(raf); raf = 0; vx = vy = 0;
    surface.style.removeProperty('--glass-x'); surface.style.removeProperty('--glass-y');
  });
});
