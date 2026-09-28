import * as THREE from 'three';
import { clamp } from '../util/rng.js';

// ---------------------------------------------------------------------------
// Tiny pixel-art toolkit: an RGBA + height buffer, colour helpers, ordered
// dithering, height -> normal conversion and DataTexture creation.
// ---------------------------------------------------------------------------

export const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mulc = (a, f) => [a[0] * f, a[1] * f, a[2] * f];

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x, y) => BAYER4[((y & 3) << 2) + (x & 3)];

/** Quantise v in [0,1] to an index in [0, n-1] with 4x4 ordered dithering. */
export function ditherIndex(v, n, x, y, amount = 1) {
  const t = v * n + (bayer(x, y) - 0.5) * amount;
  return clamp(Math.floor(t), 0, n - 1);
}

export class PixelBuffer {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.rgba = new Uint8ClampedArray(w * h * 4);
    this.height = new Float32Array(w * h);
  }
  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  set(x, y, c, a = 255) {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    this.rgba[i] = c[0];
    this.rgba[i + 1] = c[1];
    this.rgba[i + 2] = c[2];
    this.rgba[i + 3] = a;
  }
  setWrap(x, y, c, a = 255) {
    this.set(((x % this.w) + this.w) % this.w, ((y % this.h) + this.h) % this.h, c, a);
  }
  get(x, y) {
    const i = (y * this.w + x) * 4;
    return [this.rgba[i], this.rgba[i + 1], this.rgba[i + 2]];
  }
  alpha(x, y) {
    if (!this.inside(x, y)) return 0;
    return this.rgba[(y * this.w + x) * 4 + 3];
  }
  clearPx(x, y) {
    if (!this.inside(x, y)) return;
    this.rgba[(y * this.w + x) * 4 + 3] = 0;
  }
  setH(x, y, v) {
    if (!this.inside(x, y)) return;
    this.height[y * this.w + x] = v;
  }
  setHWrap(x, y, v) {
    this.setH(((x % this.w) + this.w) % this.w, ((y % this.h) + this.h) % this.h, v);
  }
  getH(x, y) {
    return this.height[y * this.w + x];
  }
  rect(x0, y0, x1, y1, c) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  /** Copy another buffer in at (ox, oy). */
  blit(src, ox, oy) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const i = (y * src.w + x) * 4;
        if (src.rgba[i + 3] === 0) continue;
        this.set(ox + x, oy + y, [src.rgba[i], src.rgba[i + 1], src.rgba[i + 2]], src.rgba[i + 3]);
      }
    }
  }
}

/**
 * Selective outline ("sel-out"): every transparent pixel touching an opaque one
 * (4-neighbourhood) becomes a darkened, slightly blue-shifted copy of its neighbour.
 */
export function outline(pb, x0 = 0, y0 = 0, x1 = pb.w - 1, y1 = pb.h - 1, darkness = 0.32) {
  const marks = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (pb.alpha(x, y) !== 0) continue;
      let best = null;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        if (pb.alpha(nx, ny) > 0) {
          best = pb.get(nx, ny);
          break;
        }
      }
      if (best) marks.push([x, y, best]);
    }
  }
  for (const [x, y, c] of marks) {
    pb.set(x, y, [c[0] * darkness * 0.85 + 6, c[1] * darkness * 0.85 + 5, c[2] * darkness + 14]);
  }
}

/** Sobel height -> tangent-space normal map (OpenGL convention, rows top->bottom). */
export function normalFromHeight(pb, strength = 1, wrap = true) {
  const { w, h } = pb;
  const out = new Uint8ClampedArray(w * h * 4);
  const H = (x, y) => {
    if (wrap) {
      x = (x + w) % w;
      y = (y + h) % h;
    } else {
      x = clamp(x, 0, w - 1);
      y = clamp(y, 0, h - 1);
    }
    return pb.height[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const gy = H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      // image rows run top->bottom while v runs bottom->top, hence +gy.
      let nx = -gx * strength;
      let ny = gy * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Build a DataTexture from top-to-bottom RGBA rows. Rows are flipped so the first
 * image row lands at v = 1 (same convention as image textures with flipY).
 * Magnification is LINEAR on purpose: the shaders do "sharp bilinear" pixel-art
 * sampling, which keeps texels crisp but anti-aliases their edges.
 */
export function makeTexture(rgba, w, h, { srgb = true, wrap = true, mipmaps = true, anisotropy = 8 } = {}) {
  const flipped = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    flipped.set(rgba.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  }
  const tex = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = mipmaps;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/** Convenience: albedo + normal textures from a PixelBuffer. */
export function texturesFrom(pb, { normalStrength = 1, wrap = true, mipmaps = true } = {}) {
  const map = makeTexture(pb.rgba, pb.w, pb.h, { srgb: true, wrap, mipmaps });
  const normalMap = makeTexture(normalFromHeight(pb, normalStrength, wrap), pb.w, pb.h, { srgb: false, wrap, mipmaps });
  return { map, normalMap, pb };
}
