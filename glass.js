// A small, static edge-displacement field. No page capture or second WebGL loop.
// Only the backdrop bends; labels, icons and hit targets remain untouched.
const host = document.querySelector('.teaser .playback');
if (host && CSS.supports('backdrop-filter', 'url("#glass-rim")')) {
  const ns = 'http://www.w3.org/2000/svg';
  const element = (name, attrs = {}) => {
    const node = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const svg = element('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' });
  svg.style.cssText = 'position:absolute;pointer-events:none';
  const defs = element('defs');
  const filter = element('filter', { id: 'glass-rim', filterUnits: 'userSpaceOnUse', x: 0, y: 0, 'color-interpolation-filters': 'sRGB' });
  const field = element('feImage', { result: 'rim', preserveAspectRatio: 'none' });
  const displacement = element('feDisplacementMap', { in: 'SourceGraphic', in2: 'rim', scale: 18, xChannelSelector: 'R', yChannelSelector: 'G' });
  filter.append(field, displacement); defs.append(filter); svg.append(defs); document.body.append(svg);
  let dimensions = '', frame = 0;
  function update() {
    frame = 0;
    const w = Math.ceil(host.offsetWidth), h = Math.ceil(host.offsetHeight);
    const r = Math.min(parseFloat(getComputedStyle(host).borderRadius), h / 2, w / 2);
    const key = `${w},${h},${r}`;
    if (!w || !h || dimensions === key) return;
    dimensions = key;
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(w, h), rimWidth = Math.min(12, r * .6);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = x + .5 - w / 2, py = y + .5 - h / 2;
      const qx = Math.abs(px) - w / 2 + r, qy = Math.abs(py) - h / 2 + r;
      const ax = Math.max(qx, 0), ay = Math.max(qy, 0), length = Math.hypot(ax, ay);
      const depth = r - length - Math.min(Math.max(qx, qy), 0);
      const strength = depth > 0 && depth < rimWidth ? Math.sin(Math.PI * depth / rimWidth) : 0;
      const nx = length ? ax / length * Math.sign(px) : qx > qy ? Math.sign(px) : 0;
      const ny = length ? ay / length * Math.sign(py) : qy >= qx ? Math.sign(py) : 0;
      const i = (y * w + x) * 4;
      pixels.data[i] = 128 + nx * strength * 127;
      pixels.data[i + 1] = 128 + ny * strength * 127;
      pixels.data[i + 2] = 128; pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    filter.setAttribute('width', w); filter.setAttribute('height', h);
    field.setAttribute('width', w); field.setAttribute('height', h);
    field.setAttribute('href', canvas.toDataURL());
    host.style.setProperty('--rim-filter', 'blur(1px) url("#glass-rim")');
  }
  new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(update); }).observe(host);
}
