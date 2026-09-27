import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { arrivalModifier, arrivalProgress } from './arrival.js?v=8';

const $ = id => document.getElementById(id);
const viewport = $('viewport');
const state = { ready: false, playing: false, selected: 'all', time: 0, speed: 1, loop: true, dragging: false };
const actors = new Map(), props = [];
const arrivalMeshes = [];
let arrivalActive = false, arrivalTime = 0, loadFraction = 0, loadedParts = 0;
const arrivalDuration = 2.6;
let config, renderer, scene, camera, controls, spark, frameId;
const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion();
const followPrevious = new THREE.Vector3();
const cameraMotion = { active: false, eye: new THREE.Vector3(), target: new THREE.Vector3(), eyeVelocity: new THREE.Vector3(), targetVelocity: new THREE.Vector3() };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function reportLoad() { $('load-progress').value = 5 + loadFraction * 70 + loadedParts * 2; }
function attachArrival(mesh) {
  mesh.worldModifier = arrivalModifier(); mesh.updateGenerator(); arrivalMeshes.push(mesh);
}
function finishArrival() {
  arrivalActive = false; arrivalProgress.value = 1;
  for (const mesh of arrivalMeshes) mesh.updateVersion();
  for (const actor of actors.values()) {
    actor.mesh.visible = true;
    for (const material of actor.mesh.material) { material.opacity = 1; material.transparent = false; material.depthWrite = true; material.needsUpdate = true; }
  }
  $('teaser').className = 'teaser is-ready'; $('teaser').setAttribute('aria-busy', 'false');
  $('load-status').textContent = '3D scene ready';
  $('teaser').querySelectorAll('button[disabled], input[disabled], select[disabled]').forEach(el => el.disabled = false);
  state.ready = true; progress(); play(!reducedMotion.matches);
}

function formatTime(t) {
  const minutes = Math.floor(t / 60);
  return `${minutes}:${(t % 60).toFixed(1).padStart(4, '0')}`;
}
function duration() { return state.selected === 'all' ? config.duration : actors.get(state.selected).duration; }
function progress() {
  const end = duration();
  $('timeline').max = end;
  $('timeline').value = state.time;
  $('timeline').style.setProperty('--progress', `${Math.min(100, 100 * state.time / end)}%`);
  $('timeline').parentElement.style.setProperty('--fraction', Math.min(1, state.time / end));
  $('timeline').setAttribute('aria-valuetext', `${formatTime(state.time)} of ${formatTime(end)}`);
  $('current-time').textContent = formatTime(state.time);
  $('duration').textContent = formatTime(end);
}
function play(playing) {
  state.playing = playing;
  $('play').setAttribute('aria-label', playing ? 'Pause animation' : 'Play animation');
}
function setTime(time) {
  state.time = THREE.MathUtils.clamp(time, 0, duration());
  for (const [id, actor] of actors) {
    if (state.selected === 'all' || id === state.selected) actor.time = Math.min(state.time, actor.duration);
  }
  updatePoses();
  progress();
}

async function asset(name, onProgress) {
  const revision = name.endsWith('-motion.bin.gz') ? 6 : 2;
  const response = await fetch(new URL(`assets/${name}?v=${revision}`, import.meta.url));
  if (!response.ok) throw new Error(`Unable to load ${name} (${response.status})`);
  let bytes;
  if (onProgress && response.body) {
    const reader = response.body.getReader();
    const size = Number(response.headers.get('Content-Length')) || 28000000;
    let loaded = 0; const parts = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); loaded += value.byteLength; onProgress(Math.min(1, loaded / size));
    }
    bytes = new Uint8Array(loaded); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  } else bytes = new Uint8Array(await response.arrayBuffer());
  // Works whether the host serves gzip files as raw bytes or with Content-Encoding.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes;
}
async function loadActor(track) {
  const [geometryBytes, poseBytes] = await Promise.all([asset(track.geometry), asset(track.motion)]);
  const data = JSON.parse(new TextDecoder().decode(geometryBytes));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions.flat(), 3));
  const boneIndices = new Uint16Array(data.joints.length * 4);
  const weights = new Float32Array(data.joints.length * 4);
  data.joints.forEach((j, i) => { boneIndices[i * 4] = j; weights[i * 4] = 1; });
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(boneIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const smooth = [], flat = [];
  data.faces.forEach((face, i) => (data.box[i] ? flat : smooth).push(...face));
  geometry.setIndex([...smooth, ...flat]);
  geometry.addGroup(0, smooth.length, 0);
  geometry.addGroup(smooth.length, flat.length, 1);
  geometry.computeVertexNormals();
  const color = new THREE.Color().setRGB(...track.linearColor, THREE.LinearSRGBColorSpace);
  const base = { color, roughness: .58, metalness: .08 };
  const mesh = new THREE.SkinnedMesh(geometry, [new THREE.MeshStandardMaterial(base), new THREE.MeshStandardMaterial({ ...base, flatShading: true })]);
  mesh.frustumCulled = false;
  mesh.visible = false;
  for (const material of mesh.material) { material.transparent = true; material.opacity = 0; material.depthWrite = false; }
  const bones = Array.from({ length: 55 }, () => new THREE.Bone());
  bones.forEach(bone => mesh.add(bone));
  mesh.bind(new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
  scene.add(mesh);
  const poses = new Float32Array(poseBytes.buffer, poseBytes.byteOffset, poseBytes.byteLength / 4);
  if (poses.length !== track.frames * 55 * 7) throw new Error(`Invalid animation length: ${track.id}`);
  actors.set(track.id, { ...track, mesh, bones, poses, time: 0 });
  loadedParts++; reportLoad();
}
async function loadProp(prop) {
  const [bytes, motionBytes] = await Promise.all([asset(prop.file), asset(prop.motion)]);
  const mesh = new SplatMesh({ fileBytes: bytes, fileName: `${prop.id}.splat`, lod: false });
  await mesh.initialized;
  attachArrival(mesh);
  scene.add(mesh);
  props.push({ ...prop, mesh, poses: new Float32Array(motionBytes.buffer, motionBytes.byteOffset, motionBytes.byteLength / 4) });
  loadedParts++; reportLoad();
}
function interpolate(target, poses, offsetA, offsetB, alpha) {
  target.position.set(
    THREE.MathUtils.lerp(poses[offsetA], poses[offsetB], alpha),
    THREE.MathUtils.lerp(poses[offsetA + 1], poses[offsetB + 1], alpha),
    THREE.MathUtils.lerp(poses[offsetA + 2], poses[offsetB + 2], alpha));
  q0.fromArray(poses, offsetA + 3); q1.fromArray(poses, offsetB + 3);
  target.quaternion.slerpQuaternions(q0, q1, alpha);
}
function updatePoses() {
  for (const actor of actors.values()) {
    const frame = Math.min(actor.frames - 1, actor.time * actor.fps);
    const a = Math.floor(frame), b = Math.min(a + 1, actor.frames - 1), alpha = frame - a;
    for (let joint = 0; joint < 55; joint++) interpolate(actor.bones[joint], actor.poses, (a * 55 + joint) * 7, (b * 55 + joint) * 7, alpha);
    actor.mesh.updateMatrixWorld(true);
  }
  for (const prop of props) {
    const actor = actors.get(prop.track);
    const frame = Math.min(prop.frames - 1, actor.time * actor.fps);
    const a = Math.floor(frame), b = Math.min(a + 1, prop.frames - 1);
    interpolate(prop.mesh, prop.poses, a * 7, b * 7, frame - a);
  }
  if (state.selected !== 'all') {
    const current = actors.get(state.selected).bones[0].position;
    const delta = current.clone().sub(followPrevious);
    camera.position.add(delta); controls.target.add(delta); followPrevious.copy(current);
    if (cameraMotion.active) { cameraMotion.eye.add(delta); cameraMotion.target.add(delta); }
  }
}
function moveCamera(eye, target, animate) {
  cameraMotion.eye.copy(eye); cameraMotion.target.copy(target);
  cameraMotion.active = Boolean(animate && state.ready && !reducedMotion.matches);
  if (cameraMotion.active) return;
  cameraMotion.eyeVelocity.set(0, 0, 0); cameraMotion.targetVelocity.set(0, 0, 0);
  camera.position.copy(eye); controls.target.copy(target);
  controls.update();
}
function springCamera(dt) {
  if (!cameraMotion.active) return;
  // Exact critically damped spring: stable at variable frame rates and interruptible.
  const omega = 19, decay = Math.exp(-omega * dt);
  for (const [value, goal, velocity] of [[camera.position, cameraMotion.eye, cameraMotion.eyeVelocity], [controls.target, cameraMotion.target, cameraMotion.targetVelocity]]) {
    for (const axis of ['x', 'y', 'z']) {
      const offset = value[axis] - goal[axis], impulse = velocity[axis] + omega * offset;
      value[axis] = goal[axis] + (offset + impulse * dt) * decay;
      velocity[axis] = (velocity[axis] - omega * impulse * dt) * decay;
    }
  }
  if (camera.position.distanceToSquared(cameraMotion.eye) + controls.target.distanceToSquared(cameraMotion.target) < 1e-7) moveCamera(cameraMotion.eye, cameraMotion.target, false);
}
function home(animate = false) {
  moveCamera(new THREE.Vector3().fromArray(config.camera.eye), new THREE.Vector3().fromArray(config.camera.target), animate);
}
function select(id, animate = true) {
  state.selected = id;
  document.querySelectorAll('[data-track]').forEach(button => {
    const active = button.dataset.track === id;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  if (id === 'all') {
    state.time = 0;
    home(animate);
    $('action-caption').textContent = ''; $('action-caption').hidden = true;
  } else {
    const actor = actors.get(id);
    state.time = actor.time;
    followPrevious.copy(actor.bones[0].position);
    const target = followPrevious.clone().add(new THREE.Vector3(0, 0, .15));
    const direction = new THREE.Vector3().fromArray(config.camera.eye).sub(new THREE.Vector3().fromArray(config.camera.target)).normalize();
    moveCamera(target.clone().addScaledVector(direction, 3.8), target, animate);
    $('action-caption').textContent = actor.description;
    $('action-caption').hidden = false;
  }
  setTime(state.time);
}
function resize() {
  const { width, height } = viewport.getBoundingClientRect();
  renderer.setSize(width, height);
  camera.aspect = width / height;
  // Maintain the original overview's vertical coverage on wide screens.
  camera.fov = Math.max(53, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(68 / 2)) / camera.aspect)));
  camera.updateProjectionMatrix();
}
function error(message) {
  play(false); state.ready = false; arrivalActive = false; cancelAnimationFrame(frameId);
  $('teaser').className = 'teaser has-error'; $('teaser').setAttribute('aria-busy', 'false');
  $('loading').hidden = false; $('load-progress').hidden = true;
  $('load-status').textContent = message;
  $('teaser').querySelectorAll('.playback button, .playback input, .playback select, .actions button').forEach(el => el.disabled = true);
}
async function init() {
  const response = await fetch('./assets/scene.json?v=3');
  if (!response.ok) throw new Error('Scene configuration is unavailable. Please reload the page.');
  config = await response.json();
  arrivalProgress.value = reducedMotion.matches ? 1 : 0;
  reportLoad();
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0xffffff, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  viewport.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(53, 1, .025, 100);
  camera.up.set(0, 0, 1);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = .1;
  controls.minDistance = 1.3; controls.maxDistance = 30;
  controls.maxPolarAngle = Math.PI / 2 - .04;
  controls.screenSpacePanning = true;
  controls.addEventListener('start', () => {
    cameraMotion.active = false;
    cameraMotion.eyeVelocity.set(0, 0, 0); cameraMotion.targetVelocity.set(0, 0, 0);
  });
  home(); resize(); new ResizeObserver(resize).observe(viewport);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xadb4c2, 2.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.7); key.position.set(6, 0, 10); scene.add(key);
  const fill = new THREE.DirectionalLight(0xdbe8ff, .6); fill.position.set(12, 10, 7); scene.add(fill);
  spark = new SparkRenderer({ renderer, maxStdDev: Math.sqrt(8), minSortIntervalMs: 35 });
  scene.add(spark);
  const envPromise = asset(config.environment, fraction => {
    loadFraction = fraction; reportLoad();
  }).then(async bytes => {
    const environment = new SplatMesh({ fileBytes: bytes, fileName: 'environment.splat', lod: false });
    await environment.initialized;
    attachArrival(environment);
    scene.add(environment);
    return environment;
  });
  await Promise.all([envPromise, ...config.tracks.map(loadActor), ...config.objects.map(loadProp)]);
  // Report completion only once all six true motion streams and synchronized props are ready.
  $('load-status').textContent = 'Preparing 3D scene'; $('load-progress').value = 95;
  updatePoses();
  await spark.update({ scene, camera });
  for (const track of config.tracks) document.querySelector(`[data-track="${track.id}"]`).style.setProperty('--track-color', track.color);
  $('actions').addEventListener('click', event => { const button = event.target.closest('[data-track]'); if (button) select(button.dataset.track, event.detail !== 0); });
  $('actions').addEventListener('interactionselect', event => {
    if (event.detail.id !== state.selected && (event.detail.id === 'all' || actors.has(event.detail.id))) select(event.detail.id, true);
  });
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); error('Your browser paused the 3D renderer. Reload to continue.'); });
  progress(); $('load-progress').value = 100;
  renderer.render(scene, camera);
  $('loading').hidden = true;
  $('teaser').className = 'teaser is-assembling';
  arrivalActive = !reducedMotion.matches;
  if (!arrivalActive) finishArrival();
  let previous = performance.now();
  function animate(now) {
    const dt = Math.max(0, Math.min((now - previous) / 1000, .1)); previous = now;
    if (arrivalActive && !document.hidden) {
      arrivalTime += dt;
      arrivalProgress.value = reducedMotion.matches ? 1 : Math.min(1, arrivalTime / arrivalDuration);
      for (const mesh of arrivalMeshes) mesh.updateVersion();
      const opacity = THREE.MathUtils.smoothstep(arrivalProgress.value, .74, 1);
      for (const actor of actors.values()) {
        actor.mesh.visible = opacity > 0;
        for (const material of actor.mesh.material) material.opacity = opacity;
      }
      if (arrivalProgress.value === 1) finishArrival();
    }
    if (!document.hidden && state.playing && !state.dragging) {
      let time = state.time + dt * state.speed;
      if (time > duration()) {
        if (state.loop) time %= duration();
        else { time = duration(); play(false); }
      }
      setTime(time);
    }
    springCamera(dt); controls.update(); renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  }
  frameId = requestAnimationFrame(animate);
  // Read-only diagnostics for browser QA: no account details or source paths.
  window.viewerState = () => ({ ready: state.ready, assembling: arrivalActive, arrival: arrivalProgress.value, playing: state.playing, selected: state.selected, time: state.time, duration: duration(), actorCount: actors.size, propCount: props.length, camera: camera.position.toArray(), actors: [...actors.values()].map(a => ({ id:a.id,time:a.time,root:a.bones[0].position.toArray() })) });
}
$('play').addEventListener('click', () => { if (state.time >= duration()) setTime(0); play(!state.playing); });
$('replay').addEventListener('click', () => { setTime(0); play(true); });
$('timeline').addEventListener('input', event => setTime(Number(event.target.value)));
$('timeline').addEventListener('pointerdown', () => state.dragging = true);
window.addEventListener('pointerup', () => state.dragging = false);
window.addEventListener('pointercancel', () => state.dragging = false);
$('speed').addEventListener('change', event => state.speed = Number(event.target.value));
$('loop').addEventListener('click', () => { state.loop = !state.loop; $('loop').setAttribute('aria-pressed', String(state.loop)); });
$('reset-camera').addEventListener('click', event => { if (state.selected === 'all') home(event.detail !== 0); else select(state.selected, event.detail !== 0); });
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('viewer-shell').requestFullscreen(); }
  catch { $('viewer-hint').textContent = 'Fullscreen is not available in this browser. Drag to rotate; scroll to zoom.'; }
});
document.addEventListener('fullscreenchange', () => $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'));
document.addEventListener('keydown', event => {
  if (!state.ready || /INPUT|SELECT|BUTTON|TEXTAREA/.test(event.target.tagName)) return;
  if (event.code === 'Space') { event.preventDefault(); play(!state.playing); }
});
init().catch(err => { console.error(err); error('Please try a recent browser with WebGL2 enabled, or reload if the connection was interrupted.'); });
