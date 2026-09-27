import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

const $ = id => document.getElementById(id);
const viewport = $('viewport');
const state = { ready: false, playing: false, selected: 'all', time: 0, speed: 1, loop: true, dragging: false };
const actors = new Map(), props = [];
let config, renderer, scene, camera, controls, spark, frameId;
const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion();
const followPrevious = new THREE.Vector3();
const allCaption = 'Navigate, interact, and continue — all within a reconstructed 3D world.';
const playPath = 'm9 5 11 7-11 7z';
const pausePath = 'M6 5h4v14H6zm8 0h4v14h-4z';

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
  $('timeline').setAttribute('aria-valuetext', `${formatTime(state.time)} of ${formatTime(end)}`);
  $('current-time').textContent = formatTime(state.time);
  $('duration').textContent = formatTime(end);
}
function play(playing) {
  state.playing = playing;
  $('play-icon').firstElementChild.setAttribute('d', playing ? pausePath : playPath);
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
  const response = await fetch(new URL(`assets/${name}`, import.meta.url));
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
  const bones = Array.from({ length: 55 }, () => new THREE.Bone());
  bones.forEach(bone => mesh.add(bone));
  mesh.bind(new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
  scene.add(mesh);
  const poses = new Float32Array(poseBytes.buffer, poseBytes.byteOffset, poseBytes.byteLength / 4);
  if (poses.length !== track.frames * 55 * 7) throw new Error(`Invalid animation length: ${track.id}`);
  actors.set(track.id, { ...track, mesh, bones, poses, time: 0 });
}
async function loadProp(prop) {
  const [bytes, motionBytes] = await Promise.all([asset(prop.file), asset(prop.motion)]);
  const mesh = new SplatMesh({ fileBytes: bytes, fileName: `${prop.id}.splat`, lod: false });
  await mesh.initialized;
  scene.add(mesh);
  props.push({ ...prop, mesh, poses: new Float32Array(motionBytes.buffer, motionBytes.byteOffset, motionBytes.byteLength / 4) });
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
  }
}
function home() {
  camera.position.fromArray(config.camera.eye);
  controls.target.fromArray(config.camera.target);
  controls.update();
}
function select(id) {
  state.selected = id;
  document.querySelectorAll('[data-track]').forEach(button => {
    const active = button.dataset.track === id;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  if (id === 'all') {
    state.time = 0;
    home();
    $('action-caption').textContent = allCaption;
    $('selection-note').textContent = 'One scene. Six stories.';
  } else {
    const actor = actors.get(id);
    state.time = actor.time;
    followPrevious.copy(actor.bones[0].position);
    controls.target.copy(followPrevious).add(new THREE.Vector3(0, 0, .15));
    const direction = new THREE.Vector3().fromArray(config.camera.eye).sub(new THREE.Vector3().fromArray(config.camera.target)).normalize();
    camera.position.copy(controls.target).addScaledVector(direction, 3.8);
    controls.update();
    $('action-caption').textContent = actor.description;
    $('selection-note').textContent = 'Individual playback';
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
  play(false);
  $('loading').hidden = false;
  $('loading-text').textContent = 'The 3D scene could not be opened';
  $('loading-detail').textContent = message;
  document.querySelector('.spinner').hidden = true;
  $('load-progress').hidden = true; $('retry').hidden = false;
}
async function init() {
  const response = await fetch('./assets/scene.json');
  if (!response.ok) throw new Error('Scene configuration is unavailable. Please reload the page.');
  config = await response.json();
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
  home(); resize(); new ResizeObserver(resize).observe(viewport);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xadb4c2, 2.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.7); key.position.set(6, 0, 10); scene.add(key);
  const fill = new THREE.DirectionalLight(0xdbe8ff, .6); fill.position.set(12, 10, 7); scene.add(fill);
  spark = new SparkRenderer({ renderer, maxStdDev: Math.sqrt(8), minSortIntervalMs: 35 });
  scene.add(spark);
  const envPromise = asset(config.environment, fraction => {
    $('load-progress').value = fraction * 80;
    $('loading-detail').textContent = `Loading the reconstructed home · ${Math.round(fraction * 100)}%`;
  }).then(async bytes => {
    const environment = new SplatMesh({ fileBytes: bytes, fileName: 'environment.splat', lod: false });
    await environment.initialized;
    scene.add(environment);
    return environment;
  });
  await Promise.all([envPromise, ...config.tracks.map(loadActor), ...config.objects.map(loadProp)]);
  // Report completion only once all six true motion streams and synchronized props are ready.
  $('loading-text').textContent = 'Preparing the first view'; $('load-progress').value = 95;
  updatePoses();
  await spark.update({ scene, camera });
  for (const track of config.tracks) {
    const button = document.createElement('button'); button.className = 'action'; button.dataset.track = track.id;
    button.setAttribute('aria-pressed', 'false'); button.style.setProperty('--track-color', track.color);
    const dot = document.createElement('span'); dot.className = 'dot'; dot.setAttribute('aria-hidden', 'true');
    button.append(dot, document.createTextNode(track.title)); $('actions').appendChild(button);
  }
  $('actions').addEventListener('click', event => { const button = event.target.closest('[data-track]'); if (button) select(button.dataset.track); });
  document.querySelectorAll('button[disabled], input[disabled]').forEach(el => el.disabled = false);
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); error('Your browser paused the 3D renderer. Reload to continue.'); });
  state.ready = true; progress();
  renderer.render(scene, camera);
  $('loading').hidden = true;
  let previous = performance.now();
  function animate(now) {
    const dt = Math.min((now - previous) / 1000, .1); previous = now;
    if (!document.hidden && state.playing && !state.dragging) {
      let time = state.time + dt * state.speed;
      if (time > duration()) {
        if (state.loop) time %= duration();
        else { time = duration(); play(false); }
      }
      setTime(time);
    }
    controls.update(); renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  }
  frameId = requestAnimationFrame(animate);
  play(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Read-only diagnostics for browser QA: no account details or source paths.
  window.viewerState = () => ({ ready: state.ready, playing: state.playing, selected: state.selected, time: state.time, duration: duration(), actorCount: actors.size, propCount: props.length, camera: camera.position.toArray(), actors: [...actors.values()].map(a => ({ id:a.id,time:a.time,root:a.bones[0].position.toArray() })) });
}
$('play').addEventListener('click', () => { if (state.time >= duration()) setTime(0); play(!state.playing); });
$('replay').addEventListener('click', () => { setTime(0); play(true); });
$('timeline').addEventListener('input', event => setTime(Number(event.target.value)));
$('timeline').addEventListener('pointerdown', () => state.dragging = true);
window.addEventListener('pointerup', () => state.dragging = false);
window.addEventListener('pointercancel', () => state.dragging = false);
$('speed').addEventListener('change', event => state.speed = Number(event.target.value));
$('loop').addEventListener('click', () => { state.loop = !state.loop; $('loop').setAttribute('aria-pressed', String(state.loop)); });
$('reset-camera').addEventListener('click', () => { if (state.selected === 'all') home(); else select(state.selected); });
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('viewer-shell').requestFullscreen(); }
  catch { $('viewer-hint').textContent = 'Fullscreen is not available in this browser. Drag to rotate; scroll to zoom.'; }
});
document.addEventListener('fullscreenchange', () => $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'));
$('retry').addEventListener('click', () => window.location.reload());
document.addEventListener('keydown', event => {
  if (!state.ready || /INPUT|SELECT|BUTTON|TEXTAREA/.test(event.target.tagName)) return;
  if (event.code === 'Space') { event.preventDefault(); play(!state.playing); }
});
init().catch(err => { console.error(err); error('Please try a recent browser with WebGL2 enabled, or reload if the connection was interrupted.'); });
