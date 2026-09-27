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
