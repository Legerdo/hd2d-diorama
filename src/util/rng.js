// Deterministic random + tileable noise helpers used by the procedural pixel-art generators.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = 1) {
    this.next = mulberry32(seed);
  }
  float(a = 0, b = 1) {
    return a + (b - a) * this.next();
  }
  /** Integer in [a, b] (inclusive). */
  int(a, b) {
    return Math.floor(this.float(a, b + 1 - 1e-9));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
}

/** Integer lattice hash -> [0, 1). */
export function hash2(ix, iy, seed = 0) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul((seed | 0) + 1013, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const wrap = (n, p) => ((n % p) + p) % p;

/**
 * Smooth value noise, periodic with integer periods (px, py) so textures tile seamlessly.
 */
export function tileNoise(x, y, px, py = px, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const a = hash2(wrap(x0, px), wrap(y0, py), seed);
  const b = hash2(wrap(x0 + 1, px), wrap(y0, py), seed);
  const c = hash2(wrap(x0, px), wrap(y0 + 1, py), seed);
  const d = hash2(wrap(x0 + 1, px), wrap(y0 + 1, py), seed);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function tileFbm(x, y, px, py = px, octaves = 3, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * tileNoise(x * f, y * f, px * f, py * f, seed + o * 31);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/**
 * Tileable Voronoi. Returns nearest (f1) / second nearest (f2) distances, the wrapped cell id
 * and the (unwrapped) feature point of the nearest cell.
 */
export function tileVoronoi(x, y, period, seed = 0, jitter = 0.85) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 1e9;
  let f2 = 1e9;
  let id = 0;
  let cx = 0;
  let cy = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = xi + i;
      const gy = yi + j;
      const wx = wrap(gx, period);
      const wy = wrap(gy, period);
      const rx = gx + 0.5 + (hash2(wx, wy, seed) - 0.5) * jitter;
      const ry = gy + 0.5 + (hash2(wx, wy, seed + 101) - 0.5) * jitter;
      const dx = rx - x;
      const dy = ry - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = wx + wy * period;
        cx = rx;
        cy = ry;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, f2, id, cx, cy };
}

/** 1D smooth noise over time, used for torch flicker. */
export function noise1(t, seed = 0) {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash2(i, 0, seed);
  const b = hash2(i + 1, 0, seed);
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
