// UI feedback runs independently of the WebGL render loop.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const actions = document.getElementById('actions');
const indicator = document.createElement('span');
indicator.className = 'selection-indicator';
indicator.setAttribute('aria-hidden', 'true');
actions.append(indicator);
let selectionAnimation, positioned = false, pointerSelection = false;
let gesture = null, suppressClickUntil = 0;
function positionSelection(animate = false) {
  if (gesture?.dragging) return;
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
actions.addEventListener('click', event => {
  if (event.detail > 0 && performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  pointerSelection = event.detail > 0;
}, true);
new MutationObserver(() => positionSelection(pointerSelection)).observe(actions, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
new ResizeObserver(() => positionSelection(false)).observe(actions);
document.fonts.ready.then(() => positionSelection(false));
positionSelection(false);

const actionButtons = [...actions.querySelectorAll('[data-track]')];
function chooseDuringDrag(button) {
  pointerSelection = true;
  actions.dispatchEvent(new CustomEvent('interactionselect', { detail: { id: button.dataset.track } }));
}
actions.addEventListener('pointerdown', event => {
  const button = event.target.closest('[data-track]');
  if (!button || button.disabled || event.button !== 0) return;
  const rect = actions.getBoundingClientRect();
  const active = actions.querySelector('.active');
  gesture = { pointerId: event.pointerId, startX: event.clientX, dragging: false, startId: active.dataset.track,
    offset: button === active ? event.clientX - (rect.x + active.offsetLeft + active.offsetWidth / 2) : 0 };
});
actions.addEventListener('pointermove', event => {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  if (!gesture.dragging && Math.abs(event.clientX - gesture.startX) < 4) return;
  if (!gesture.dragging) {
    gesture.dragging = true; selectionAnimation?.cancel();
    actions.setPointerCapture(event.pointerId); actions.classList.add('is-scrubbing');
    actionButtons.forEach(button => button.classList.remove('is-pressed'));
  }
  const rect = actions.getBoundingClientRect();
  const centers = actionButtons.map(button => button.offsetLeft + button.offsetWidth / 2);
  const x = Math.max(centers[0], Math.min(centers.at(-1), event.clientX - rect.x - gesture.offset));
  const nearest = centers.reduce((best, center, i) => Math.abs(center - x) < Math.abs(centers[best] - x) ? i : best, 0);
  const button = actionButtons[nearest];
  indicator.style.left = `${x - button.offsetWidth / 2}px`;
  indicator.style.top = `${button.offsetTop}px`;
  indicator.style.width = `${button.offsetWidth}px`;
  indicator.style.height = `${button.offsetHeight}px`;
  chooseDuringDrag(button);
});
function finishActionDrag(event, cancel = false) {
  if (!gesture || (event.pointerId !== undefined && gesture.pointerId !== event.pointerId)) return;
  const finished = gesture; gesture = null;
  if (actions.hasPointerCapture(finished.pointerId)) actions.releasePointerCapture(finished.pointerId);
  actions.classList.remove('is-scrubbing');
  if (finished.dragging) {
    suppressClickUntil = performance.now() + 350;
    if (cancel) chooseDuringDrag(actionButtons.find(button => button.dataset.track === finished.startId));
    positionSelection(true);
  }
}
window.addEventListener('pointerup', event => finishActionDrag(event));
window.addEventListener('pointercancel', event => finishActionDrag(event, true));
window.addEventListener('blur', event => finishActionDrag(event, true));
actions.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const current = actionButtons.indexOf(document.activeElement);
  if (current < 0) return;
  event.preventDefault();
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? actionButtons.length - 1 : Math.max(0, Math.min(actionButtons.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)));
  actionButtons[index].focus(); actionButtons[index].click();
});

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
document.querySelectorAll('#replay, #reset-camera, #loop, #fullscreen').forEach(button => {
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
const timelineControl = timeline.parentElement;
const timeTip = document.createElement('output');
timeTip.className = 'scrub-time'; timeTip.setAttribute('aria-hidden', 'true');
timeline.parentElement.append(timeTip);
function updateTimeTip() {
  const t = Number(timeline.value), fraction = t / Number(timeline.max);
  timeTip.textContent = `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  timeTip.style.left = `${9 + (timeline.offsetWidth - 18) * fraction}px`;
  timeTip.style.top = `${timeline.offsetTop - 30}px`;
}
timeline.addEventListener('pointerenter', () => { updateTimeTip(); timeTip.classList.add('visible'); });
timeline.addEventListener('pointerleave', () => { if (!timelineControl.classList.contains('is-dragging')) timeTip.classList.remove('visible'); });
timeline.addEventListener('input', updateTimeTip);
timeline.addEventListener('pointerdown', () => { timelineControl.classList.add('is-dragging'); updateTimeTip(); timeTip.classList.add('visible'); });
function releaseTimeline() {
  timelineControl.classList.remove('is-dragging');
  if (!timeline.matches(':hover')) timeTip.classList.remove('visible');
}
window.addEventListener('pointerup', releaseTimeline);
window.addEventListener('pointercancel', releaseTimeline);
window.addEventListener('blur', releaseTimeline);

// Two matching polygons morph continuously between the triangle and pause bars.
// Retarget from the live shape and velocity, including during rapid reversals.
const playButton = document.getElementById('play');
const paths = document.querySelectorAll('#play-icon path');
const playPoints = [[7,4,13,7.5,13,16.5,7,20], [13,7.5,20,12,20,12,13,16.5]];
const pausePoints = [[6,5,10,5,10,19,6,19], [14,5,18,5,18,19,14,19]];
let iconPhase = 0, iconTarget = 0, iconVelocity = 0, iconFrame = 0, iconPrevious = 0, keyboardInput = false;
document.addEventListener('keydown', () => keyboardInput = true, true);
document.addEventListener('pointerdown', () => keyboardInput = false, true);
function paintIcon() {
  paths.forEach((path, index) => {
    const points = playPoints[index].map((p, i) => p + (pausePoints[index][i] - p) * iconPhase);
    path.setAttribute('d', `M${points[0]} ${points[1]}L${points[2]} ${points[3]}L${points[4]} ${points[5]}L${points[6]} ${points[7]}Z`);
  });
}
function animateIcon(now) {
  // A queued RAF timestamp can precede an event's performance.now() on a busy frame.
  const dt = Math.max(0, Math.min((now - iconPrevious) / 1000, .04)); iconPrevious = now;
  const omega = 30, decay = Math.exp(-omega * dt), offset = iconPhase - iconTarget, impulse = iconVelocity + omega * offset;
  iconPhase = iconTarget + (offset + impulse * dt) * decay;
  iconVelocity = (iconVelocity - omega * impulse * dt) * decay;
  paintIcon();
  if (Math.abs(iconPhase - iconTarget) + Math.abs(iconVelocity) > .002) iconFrame = requestAnimationFrame(animateIcon);
  else { iconPhase = iconTarget; iconVelocity = 0; paintIcon(); iconFrame = 0; }
}
function updateIcon() {
  iconTarget = playButton.getAttribute('aria-label') === 'Pause animation' ? 1 : 0;
  if (reducedMotion.matches || keyboardInput) {
    cancelAnimationFrame(iconFrame); iconFrame = 0; iconPhase = iconTarget; iconVelocity = 0; paintIcon();
  } else if (!iconFrame) { iconPrevious = performance.now(); iconFrame = requestAnimationFrame(animateIcon); }
}
new MutationObserver(updateIcon).observe(playButton, { attributes: true, attributeFilter: ['aria-label'] });
reducedMotion.addEventListener('change', updateIcon);

// Pointer-driven specular light, critically damped and idle when settled.
// This decorates the material only: slider values remain one-to-one with input.
document.querySelectorAll('.view-tools').forEach(host => {
  const surface = host === actions ? indicator : host;
  let x = .5, y = .15, tx = .5, ty = .15, vx = 0, vy = 0, raf = 0, previous = 0;
  function tick(now) {
    const dt = Math.max(0, Math.min((now - previous) / 1000, .04)); previous = now;
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
