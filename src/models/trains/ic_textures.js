// Canvas texture helpers for intercity.js.
// Body atlas: rows of side strips (one per car variant) + a swatch band of solid colours.
// Front texture: planar front-view projection (z,y) + a swatch band.
import * as THREE from 'three';

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

export function toTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

// Painter in metric coordinates: (a, b) -> px where a is horizontal metres and b is vertical metres (up).
class Painter {
  constructor(ctx, px0, py0, sx, sy, a0, b1) {
    Object.assign(this, { ctx, px0, py0, sx, sy, a0, b1 });
  }
  X(a) { return this.px0 + (a - this.a0) * this.sx; }
  Y(b) { return this.py0 + (this.b1 - b) * this.sy; }
  rect(a0, a1, b0, b1, fill) {
    const c = this.ctx;
    c.fillStyle = fill;
    c.fillRect(this.X(Math.min(a0, a1)), this.Y(Math.max(b0, b1)), Math.abs(a1 - a0) * this.sx, Math.abs(b1 - b0) * this.sy);
  }
  rrect(a0, a1, b0, b1, r, fill, stroke, lw = 0.02) {
    const c = this.ctx;
    const x = this.X(a0), y = this.Y(b1), w = (a1 - a0) * this.sx, h = (b1 - b0) * this.sy;
    c.beginPath();
    c.roundRect(x, y, w, h, Math.min(r * this.sx, w / 2, h / 2));
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw * this.sx; c.stroke(); }
  }
  poly(pts, fill) {
    const c = this.ctx;
    c.beginPath();
    pts.forEach(([a, b], i) => (i ? c.lineTo(this.X(a), this.Y(b)) : c.moveTo(this.X(a), this.Y(b))));
    c.closePath();
    c.fillStyle = fill;
    c.fill();
  }
  line(a0, b0, a1, b1, stroke, lw = 0.02) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(this.X(a0), this.Y(b0));
    c.lineTo(this.X(a1), this.Y(b1));
    c.strokeStyle = stroke;
    c.lineWidth = lw * this.sx;
    c.stroke();
  }
  // text centred at (a,b), height h metres
  text(str, a, b, h, fill, weight = 'bold', font = 'Arial, Helvetica, sans-serif', maxW) {
    const c = this.ctx;
    c.save();
    c.fillStyle = fill;
    c.font = `${weight} ${Math.round(h * this.sy)}px ${font}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (maxW) c.fillText(str, this.X(a), this.Y(b), maxW * this.sx);
    else c.fillText(str, this.X(a), this.Y(b));
    c.restore();
  }
  // vertical gradient fill
  vgrad(a0, a1, b0, b1, stops) {
    const c = this.ctx;
    const g = c.createLinearGradient(0, this.Y(b1), 0, this.Y(b0));
    stops.forEach(([t, col]) => g.addColorStop(t, col));
    c.fillStyle = g;
    c.fillRect(this.X(a0), this.Y(b1), (a1 - a0) * this.sx, (b1 - b0) * this.sy);
  }
  // fine horizontal lines (stainless fluting / brushed texture)
  hlines(a0, a1, b0, b1, pitch, col, lw = 0.006) {
    for (let b = b0; b <= b1; b += pitch) this.line(a0, b, a1, b, col, lw);
  }
  clip(a0, a1, b0, b1, fn) {
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.rect(this.X(a0), this.Y(b1), (a1 - a0) * this.sx, (b1 - b0) * this.sy);
    c.clip();
    fn();
    c.restore();
  }
}

const SW = 64; // swatch size in px

// Atlas: W x H px, `rows` side strips of rowH px at the top, swatch band below.
export class BodyAtlas {
  constructor({ w = 2048, rows = 3, rowH = 512, VMAX = 5.6 }) {
    this.w = w; this.rows = rows; this.rowH = rowH; this.VMAX = VMAX;
    this.h = rows * rowH + 128;
    this.canvas = makeCanvas(w, this.h);
    this.ctx = this.canvas.getContext('2d');
    this.pad = 6;
    this.swatches = [];
  }
  // Painter for row r covering x in [-L/2, L/2]
  row(r, L) {
    const sx = (this.w - 2) / L;
    const sy = (this.rowH - 2 * this.pad) / this.VMAX;
    return new Painter(this.ctx, 1, r * this.rowH + this.pad, sx, sy, -L / 2, this.VMAX);
  }
  uvFn(r, L) {
    const { w, h, rowH, VMAX, pad } = this;
    return (x, vLen) => {
      const px = 1 + (x + L / 2) * ((w - 2) / L);
      const vv = Math.min(VMAX, Math.max(0, vLen));
      const py = r * rowH + pad + (VMAX - vv) * ((rowH - 2 * pad) / VMAX);
      return [px / w, 1 - py / h];
    };
  }
  // Fill a solid swatch and return its uv centre.
  swatch(color) {
    const i = this.swatches.length;
    const perRow = Math.floor(this.w / SW);
    const x = (i % perRow) * SW, y = this.rows * this.rowH + Math.floor(i / perRow) * SW;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, SW, SW);
    this.swatches.push(color);
    return [(x + SW / 2) / this.w, 1 - (y + SW / 2) / this.h];
  }
}

// Front texture: covers zv in [-Wt/2, Wt/2] (viewer's left -> right), y in [0, Ht].
export class FrontAtlas {
  constructor({ size = 1024, Wt, Ht }) {
    this.size = size; this.Wt = Wt; this.Ht = Ht;
    this.fh = size - 128; // front area height
    this.canvas = makeCanvas(size, size);
    this.ctx = this.canvas.getContext('2d');
    this.swatches = 0;
  }
  painter() {
    const sx = this.size / this.Wt, sy = this.fh / this.Ht;
    return new Painter(this.ctx, 0, 0, sx, sy, -this.Wt / 2, this.Ht);
  }
  // uv for a model-space point (y, z). Viewer's right (zv>0) is model -z.
  uvFn() {
    const { Wt, Ht, fh, size } = this;
    return (y, z) => {
      const zv = -z;
      const px = (zv + Wt / 2) / Wt * size;
      const py = (Ht - Math.min(Ht, Math.max(0, y))) / Ht * fh;
      return [px / size, 1 - py / size];
    };
  }
  swatch(color) {
    const i = this.swatches++;
    const x = (i % 16) * SW, y = this.fh + Math.floor(i / 16) * SW;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, SW, SW);
    return [(x + SW / 2) / this.size, 1 - (y + SW / 2) / this.size];
  }
}

// Very light brushed-metal noise over a region (deterministic).
export function brushed(p, a0, a1, b0, b1, alpha = 0.05) {
  let seed = 1234;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let b = b0; b < b1; b += 0.02) {
    const v = rnd();
    p.line(a0, b, a1, b, v > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha * 0.8})`, 0.01);
  }
}
