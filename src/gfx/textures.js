import { RNG, hash2, tileNoise, tileFbm, tileVoronoi, clamp } from '../util/rng.js';
import { PixelBuffer, hex, mulc, mixc, ditherIndex, texturesFrom, makeTexture, normalFromHeight } from './pixel.js';

// ---------------------------------------------------------------------------
// Procedural environment textures. 16 texels per world unit; tiling textures
// are 64x64 (= 4x4 world units). Every generator also writes a height field
// that is turned into a normal map, so torch light rakes across the relief.
// ---------------------------------------------------------------------------

export const TEXELS_PER_UNIT = 16;
export const TILE_WORLD = 4; // 64px tiles cover 4 world units

function genGrass(seed = 11) {
  const S = 64;
  const pb = new PixelBuffer(S, S);
  const rng = new RNG(seed);
  const pal = [0x2d4a27, 0x395f2d, 0x477335, 0x58883d, 0x6b9d46, 0x86b554].map(hex);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n1 = tileFbm(x / 16, y / 16, 4, 4, 3, seed);
      const n2 = tileNoise(x / 4, y / 4, 16, 16, seed + 7);
      const n3 = tileNoise(x / 2, y / 2, 32, 32, seed + 13);
      const v = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;
      const idx = ditherIndex((v - 0.22) / 0.56, pal.length - 1, x, y, 1.1);
      pb.set(x, y, pal[idx]);
      pb.setH(x, y, v * 0.4);
    }
  }
  for (let i = 0; i < 300; i++) {
    const x = rng.int(0, S - 1);
    const y = rng.int(0, S - 1);
    const len = rng.int(1, 3);
    const light = rng.chance(0.55);
    for (let k = 0; k < len; k++) {
      const c = light ? pal[k === len - 1 ? 5 : 4] : pal[1];
      pb.setWrap(x, y - k, c);
      pb.setHWrap(x, y - k, light ? 0.75 + k * 0.1 : 0.15);
    }
  }
  const flowers = [0xf1e7cf, 0xf3cf62, 0xd88bb0, 0xa6bff0].map(hex);
  for (let i = 0; i < 9; i++) {
    const x = rng.int(0, S - 1);
    const y = rng.int(0, S - 1);
    pb.setWrap(x, y, rng.pick(flowers));
    pb.setHWrap(x, y, 1);
  }
  return pb;
}

function genCobble(seed = 21) {
  const S = 64;
  const cell = 8;
  const P = S / cell;
  const pb = new PixelBuffer(S, S);
  const stones = [0x5a5753, 0x67635d, 0x736e66, 0x5f656d, 0x786f62, 0x535c66, 0x6d6a66].map(hex);
  const gap = hex(0x221f1d);
  const moss = hex(0x33472b);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = tileVoronoi((x + 0.5) / cell, (y + 0.5) / cell, P, seed, 0.9);
      const edge = v.f2 - v.f1;
      if (edge < 0.15) {
        const m = tileNoise(x / 4, y / 4, 16, 16, seed + 3) > 0.64;
        pb.set(x, y, m ? moss : gap);
        pb.setH(x, y, 0);
        continue;
      }
      const r = hash2(v.id, 7, seed);
      const base = stones[Math.floor(r * stones.length)];
      const dx = (x + 0.5) / cell - v.cx;
      const dy = (y + 0.5) / cell - v.cy;
      const lit = -(dx + dy) * 1.25;
      let f = 0.93 + lit * 0.38 + (tileNoise(x / 2, y / 2, 32, 32, seed + 11) - 0.5) * 0.14;
      if (edge < 0.23) f -= 0.1;
      const lvl = ditherIndex((f - 0.7) / 0.5, 3, x, y, 0.8);
      pb.set(x, y, mulc(base, [0.8, 0.95, 1.1][lvl]));
      pb.setH(x, y, 0.3 + 0.7 * Math.sqrt(Math.min(1, edge / 0.42)));
    }
  }
  return pb;
}

function genBrick(seed = 31) {
  const S = 64;
  const bw = 16;
  const bh = 8;
  const pb = new PixelBuffer(S, S);
  const cols = [0x7c7466, 0x877e6f, 0x70695f, 0x8f8573, 0x69655f, 0x807664, 0x747a7c].map(hex);
  const mortar = hex(0x36312c);
  const moss = hex(0x3c5230);
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / bh);
    const ly = y % bh;
    const off = (row % 2) * (bw / 2);
    for (let x = 0; x < S; x++) {
      const xx = (x + off) % S;
      const bx = Math.floor(xx / bw);
      const lx = xx % bw;
      if (lx === 0 || ly === 0) {
        const m = tileNoise(x / 8, y / 8, 8, 8, seed + 9) > 0.66;
        pb.set(x, y, m ? moss : mortar);
        pb.setH(x, y, 0);
        continue;
      }
      const r = hash2(bx, row, seed);
      const base = cols[Math.floor(r * cols.length)];
      let f = 1 + (tileNoise(x / 2, y / 2, 32, 32, seed + 5) - 0.5) * 0.18;
      let h = 1;
      if (lx === 1 || ly === 1) {
        f += 0.13;
        h = 0.78;
      }
      if (lx === bw - 1 || ly === bh - 1) {
        f -= 0.17;
        h = 0.7;
      }
      // chipped corners
      if (tileNoise(x / 2, y / 2, 32, 32, seed + 17) > 0.8 && (lx < 3 || lx > bw - 4)) {
        f -= 0.22;
        h = 0.45;
      }
      pb.set(x, y, mulc(base, f));
      pb.setH(x, y, h);
    }
  }
  return pb;
}

function genPlaster(seed = 41) {
  const S = 64;
  const pb = new PixelBuffer(S, S);
  const rng = new RNG(seed);
  const pal = [0xa99a7d, 0xb9ab8d, 0xc6b99a, 0xd2c6a7, 0xddd2b4].map(hex);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = tileFbm(x / 8, y / 8, 8, 8, 3, seed) * 0.8 + tileNoise(x / 2, y / 2, 32, 32, seed + 2) * 0.2;
      pb.set(x, y, pal[ditherIndex((v - 0.25) / 0.5, pal.length, x, y, 1)]);
      pb.setH(x, y, 0.5 + v * 0.3);
    }
  }
  const crack = hex(0x857761);
  for (let c = 0; c < 5; c++) {
    let x = rng.int(0, S - 1);
    let y = rng.int(0, S - 1);
    for (let k = 0; k < rng.int(5, 12); k++) {
      pb.setWrap(x, y, crack);
      pb.setHWrap(x, y, 0.2);
      x += rng.int(-1, 1);
      y += 1;
    }
  }
  return pb;
}

function genWood(seed = 51) {
  const S = 64;
  const ph = 8;
  const pb = new PixelBuffer(S, S);
  const rng = new RNG(seed);
  const pal = [0x3f281b, 0x4f3322, 0x5f3f29, 0x714c31, 0x825a3a].map(hex);
  const gap = hex(0x22150e);
  const seams = [];
  for (let r = 0; r < S / ph; r++) {
    const a = rng.int(0, S - 1);
    seams.push([a, (a + rng.int(22, 42)) % S]);
  }
  for (let y = 0; y < S; y++) {
    const r = Math.floor(y / ph);
    const ly = y % ph;
    const tone = hash2(r, 3, seed);
    for (let x = 0; x < S; x++) {
      if (ly === 0 || x === seams[r][0] || x === seams[r][1]) {
        pb.set(x, y, gap);
        pb.setH(x, y, 0);
        continue;
      }
      const grain = tileNoise(x / 16, y / 1, 4, 64, seed + r) * 0.6 + tileNoise(x / 4, y / 2, 16, 32, seed + 3) * 0.4;
      let v = 0.25 + tone * 0.35 + (grain - 0.5) * 0.7;
      if (ly === 1) v += 0.18;
      if (ly === ph - 1) v -= 0.2;
      pb.set(x, y, pal[ditherIndex(v, pal.length, x, y, 0.9)]);
      pb.setH(x, y, ly === 1 || ly === ph - 1 ? 0.7 : 0.9 + grain * 0.1);
    }
    // nails near the seams
    for (const s of seams[r]) {
      for (const ny of [2, 6]) {
        pb.setWrap(s + 2, r * ph + ny, hex(0x2b2724));
      }
    }
  }
  return pb;
}

function genRoof(seed = 61) {
  const S = 64;
  const rh = 8;
  const tw = 8;
  const pb = new PixelBuffer(S, S);
  const pal = [0x4a1c16, 0x5e241b, 0x742f21, 0x8a3b28, 0xa04a30, 0xb25a38].map(hex);
  const dark = hex(0x220d0b);
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / rh);
    const ly = y % rh;
    const off = (row % 2) * (tw / 2);
    for (let x = 0; x < S; x++) {
      const xx = (x + off) % S;
      const lx = xx % tw;
      const tile = Math.floor(xx / tw);
      const edgeX = lx === 0;
      const roundCorner = ly === rh - 1 && (lx === 1 || lx === tw - 1);
      if (edgeX || roundCorner) {
        pb.set(x, y, dark);
        pb.setH(x, y, 0.05);
        continue;
      }
      const t = hash2(tile, row, seed);
      let v = 0.2 + (ly / (rh - 1)) * 0.55 + t * 0.2 + (tileNoise(x / 2, y / 2, 32, 32, seed) - 0.5) * 0.15;
      if (ly <= 1) v -= 0.3; // shadow of the overlapping row above
      if (lx === 1) v += 0.08;
      if (lx === tw - 1) v -= 0.1;
      pb.set(x, y, pal[ditherIndex(v, pal.length, x, y, 0.8)]);
      pb.setH(x, y, 0.15 + (ly / (rh - 1)) * 0.85);
    }
  }
  return pb;
}

function genSoil(seed = 71, S = 64) {
  const pb = new PixelBuffer(S, S);
  const rng = new RNG(seed);
  const pal = [0x22170f, 0x2e1f15, 0x3b281b, 0x4a3322, 0x5a3f2a].map(hex);
  const stoneCols = [0x514b45, 0x5f5850, 0x6a625a].map(hex);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const strata = tileFbm(x / 16, y / 4, 4, S / 4, 3, seed);
      const fine = tileNoise(x / 2, y / 2, 32, S / 2, seed + 4);
      let v = strata * 0.75 + fine * 0.25;
      const vo = tileVoronoi(x / 8, y / 8, 8, seed + 9, 0.9);
      const isStone = hash2(vo.id, 2, seed) > 0.72 && vo.f1 < 0.3;
      if (isStone) {
        const base = stoneCols[Math.floor(hash2(vo.id, 5, seed) * 3)];
        const lit = -((x / 8 - vo.cx) + (y / 8 - vo.cy)) * 1.6;
        pb.set(x, y, mulc(base, 0.9 + lit * 0.35));
        pb.setH(x, y, 0.6 + (0.3 - vo.f1));
        continue;
      }
      pb.set(x, y, pal[ditherIndex((v - 0.2) / 0.6, pal.length, x, y, 1)]);
      pb.setH(x, y, v * 0.35);
    }
  }
  const root = hex(0x1a120c);
  for (let c = 0; c < 6; c++) {
    let x = rng.int(0, S - 1);
    let y = rng.int(0, S - 1);
    for (let k = 0; k < rng.int(6, 14); k++) {
      pb.setWrap(x, y, root);
      pb.setHWrap(x, y, 0.1);
      x += rng.chance(0.6) ? 1 : 0;
      y += rng.int(0, 1);
    }
  }
  return pb;
}

/** Top band for cliff sides: grass fringe hanging over soil (64x16 = 4x1 units). */
function genGrassSide(seed = 81) {
  const W = 64;
  const H = 16;
  const pb = new PixelBuffer(W, H);
  const soil = genSoil(seed + 1, 64);
  const pal = [0x2d4a27, 0x395f2d, 0x477335, 0x58883d, 0x6b9d46].map(hex);
  for (let x = 0; x < W; x++) {
    const L = 2 + Math.floor(tileNoise(x / 4, 0, 16, 1, seed) * 4) + (hash2(x, 1, seed) > 0.8 ? 2 : 0);
    for (let y = 0; y < H; y++) {
      if (y < L) {
        const shade = y === 0 ? 4 : y >= L - 1 ? 1 : 3 - (y > 2 ? 1 : 0);
        pb.set(x, y, pal[clamp(shade, 0, 4)]);
        pb.setH(x, y, 1 - y * 0.08);
      } else {
        const c = soil.get(x, y + 20);
        pb.set(x, y, y === L ? mulc(c, 0.55) : c);
        pb.setH(x, y, y === L ? 0.1 : soil.getH(x, y + 20));
      }
    }
  }
  return pb;
}

/** Top band for plaza edges: stone kerb over soil. */
function genCobbleSide(seed = 91) {
  const W = 64;
  const H = 16;
  const pb = new PixelBuffer(W, H);
  const soil = genSoil(seed + 1, 64);
  const stone = [0x5a5753, 0x6a655f, 0x7a746b, 0x8a847a].map(hex);
  for (let x = 0; x < W; x++) {
    const blk = Math.floor(x / 12);
    const t = hash2(blk, 0, seed);
    for (let y = 0; y < H; y++) {
      if (y < 4) {
        const edge = x % 12 === 0;
        let lvl = y === 0 ? 3 : y === 3 ? 0 : 2 - (t > 0.5 ? 1 : 0);
        if (edge) lvl = 0;
        pb.set(x, y, stone[lvl]);
        pb.setH(x, y, edge ? 0.2 : 1 - y * 0.12);
      } else {
        const c = soil.get(x, y + 30);
        pb.set(x, y, y === 4 ? mulc(c, 0.5) : c);
        pb.setH(x, y, soil.getH(x, y + 30) * 0.6);
      }
    }
  }
  return pb;
}

function genSand(seed = 101) {
  const S = 64;
  const pb = new PixelBuffer(S, S);
  const pal = [0x2f3326, 0x3b3f2d, 0x4a4b35, 0x5a5940, 0x6a674b].map(hex);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const vo = tileVoronoi(x / 4, y / 4, 16, seed, 0.9);
      const edge = vo.f2 - vo.f1;
      const r = hash2(vo.id, 3, seed);
      let v = 0.2 + r * 0.55 + Math.min(edge, 0.4) * 0.6 - (edge < 0.1 ? 0.3 : 0);
      pb.set(x, y, pal[ditherIndex(v, pal.length, x, y, 0.8)]);
      pb.setH(x, y, Math.min(1, edge * 2.2));
    }
  }
  return pb;
}

function genDirt(seed = 141) {
  const S = 64;
  const pb = new PixelBuffer(S, S);
  const rng = new RNG(seed);
  const pal = [0x3b2a1d, 0x4a3524, 0x5a422c, 0x6a4f35, 0x7a5d3f].map(hex);
  const pebble = [0x6c6258, 0x847a6e, 0x9a9084].map(hex);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = tileFbm(x / 8, y / 8, 8, 8, 3, seed) * 0.7 + tileNoise(x / 2, y / 2, 32, 32, seed + 1) * 0.3;
      pb.set(x, y, pal[ditherIndex((v - 0.2) / 0.6, pal.length, x, y, 1)]);
      pb.setH(x, y, v * 0.4);
    }
  }
  // wheel/foot ruts
  for (let y = 0; y < S; y++) {
    for (const rx of [18, 46]) {
      const x = rx + Math.round(Math.sin(y * 0.2) * 1.5);
      pb.setWrap(x, y, mulc(pb.get(((x % S) + S) % S, y), 0.78));
      pb.setHWrap(x, y, 0.05);
    }
  }
  for (let i = 0; i < 40; i++) {
    const x = rng.int(0, S - 1);
    const y = rng.int(0, S - 1);
    const big = rng.chance(0.3);
    pb.setWrap(x, y, pebble[big ? 2 : 1]);
    pb.setHWrap(x, y, 0.9);
    if (big) {
      pb.setWrap(x + 1, y, pebble[1]);
      pb.setWrap(x, y + 1, pebble[0]);
      pb.setWrap(x + 1, y + 1, pebble[0]);
      pb.setHWrap(x + 1, y, 0.8);
      pb.setHWrap(x, y + 1, 0.7);
    }
  }
  return pb;
}

function genDoor(seed = 111) {
  const W = 32;
  const H = 48;
  const pb = new PixelBuffer(W, H);
  const pal = [0x2e1c12, 0x3d2618, 0x4d311f, 0x5d3c26, 0x6d472d].map(hex);
  const iron = [0x1f1f24, 0x34343b, 0x4c4c55].map(hex);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const plank = Math.floor((x - 1) / 7.5);
      const px = (x - 1) % 7.5;
      const tone = hash2(plank, 0, seed);
      const grain = tileNoise(x / 1, y / 12, 32, 4, seed + plank);
      let v = 0.2 + tone * 0.4 + (grain - 0.5) * 0.5;
      let h = 0.85;
      if (px < 1) {
        v = -1;
        h = 0.05;
      }
      if (x === 0 || x === W - 1 || y === 0) {
        v = -1;
        h = 0;
      }
      if (v < 0) pb.set(x, y, hex(0x1b110b));
      else pb.set(x, y, pal[ditherIndex(v, pal.length, x, y, 0.8)]);
      pb.setH(x, y, h);
    }
  }
  for (const by of [8, 38]) {
    for (let x = 1; x < W - 1; x++) {
      pb.set(x, by, iron[2]);
      pb.set(x, by + 1, iron[1]);
      pb.set(x, by + 2, iron[0]);
      pb.setH(x, by, 1);
      pb.setH(x, by + 1, 1);
      pb.setH(x, by + 2, 0.8);
      if (x % 5 === 2) pb.set(x, by + 1, hex(0x6d6d78));
    }
  }
  // ring handle
  const gold = [0x6d5424, 0xa8853a, 0xd8b45a].map(hex);
  for (const [x, y, c] of [[23, 23, 2], [24, 23, 2], [22, 24, 1], [25, 24, 1], [22, 25, 1], [25, 25, 0], [23, 26, 0], [24, 26, 0]]) {
    pb.set(x, y, gold[c]);
    pb.setH(x, y, 1);
  }
  pb.set(24, 29, hex(0x0c0806));
  return pb;
}

/** Glowing window: albedo + emissive (16x24). */
function genWindow(seed = 121) {
  const W = 16;
  const H = 24;
  const pb = new PixelBuffer(W, H);
  const em = new PixelBuffer(W, H);
  const frame = [0x24160d, 0x3a2515, 0x4e331d].map(hex);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const border = x < 2 || x > W - 3 || y < 2 || y > H - 3;
      const mullion = x === 7 || x === 8 || y === 11 || y === 12;
      if (border || mullion) {
        const c = x === 0 || y === 0 ? frame[2] : x === W - 1 || y === H - 1 ? frame[0] : frame[1];
        pb.set(x, y, c);
        em.set(x, y, [0, 0, 0]);
        pb.setH(x, y, border ? 1 : 0.8);
      } else {
        // warm glass with a curtain silhouette on the left panes
        const g = 1 - y / H;
        const curtain = x < 5 + Math.round(Math.sin(y * 0.9) * 0.6) && y > 2;
        const base = curtain ? mixc(hex(0x9a4a2a), hex(0xc0683a), g) : mixc(hex(0xffc978), hex(0xfff0c4), g * 0.6);
        pb.set(x, y, base);
        const e = curtain ? mulc(hex(0xb85a28), 0.55) : mixc(hex(0xff9c45), hex(0xffe1a0), g * 0.5 + tileNoise(x / 2, y / 3, 8, 8, seed) * 0.2);
        em.set(x, y, e);
        pb.setH(x, y, 0.3);
      }
    }
  }
  return { pb, em };
}

/** Hanging tavern sign (16x12) with a mug icon. */
function genSign() {
  const W = 16;
  const H = 12;
  const pb = new PixelBuffer(W, H);
  const wood = [0x3a2416, 0x55361f, 0x6c472a].map(hex);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      pb.set(x, y, edge ? wood[0] : wood[1 + ((x + y * 3) % 5 === 0 ? 1 : 0)]);
      pb.setH(x, y, edge ? 0.6 : 0.9);
    }
  }
  const foam = hex(0xf2ead6);
  const mug = hex(0xe0a53a);
  const mugD = hex(0xa8712a);
  pb.rect(5, 3, 9, 3, foam);
  pb.rect(5, 4, 9, 8, mug);
  pb.rect(9, 4, 9, 8, mugD);
  pb.rect(10, 5, 11, 5, mugD);
  pb.rect(11, 6, 11, 6, mugD);
  pb.rect(10, 7, 11, 7, mugD);
  return pb;
}

function genWaterNormal(seed = 131) {
  const S = 64;
  const pb = new PixelBuffer(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = tileFbm(x / 16, y / 8, 4, 8, 3, seed);
      const b = tileNoise(x / 8, y / 4, 8, 16, seed + 5);
      const ridge = 1 - Math.abs(a * 2 - 1);
      const v = ridge * 0.7 + b * 0.3;
      pb.setH(x, y, Math.round(v * 6) / 6); // stepped -> pixel-art ripples
      pb.set(x, y, [0, 0, 0]);
    }
  }
  return makeTexture(normalFromHeight(pb, 0.6), S, S, { srgb: false });
}

/** Soft round alpha blob for contact shadows (not pixel art on purpose). */
function genBlob() {
  const S = 64;
  const rgba = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S * 2 - 1;
      const dy = (y + 0.5) / S * 2 - 1;
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = Math.pow(clamp(1 - d, 0, 1), 1.6);
      const i = (y * S + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = a * 255;
      rgba[i + 3] = 255;
    }
  }
  return makeTexture(rgba, S, S, { srgb: false, wrap: false, mipmaps: true });
}

let cache = null;

/** Generate every environment texture once. */
export function createEnvironmentTextures() {
  if (cache) return cache;
  const win = genWindow();
  cache = {
    grass: texturesFrom(genGrass(), { normalStrength: 0.9 }),
    cobble: texturesFrom(genCobble(), { normalStrength: 0.55 }),
    brick: texturesFrom(genBrick(), { normalStrength: 0.5 }),
    plaster: texturesFrom(genPlaster(), { normalStrength: 0.5 }),
    wood: texturesFrom(genWood(), { normalStrength: 0.5 }),
    roof: texturesFrom(genRoof(), { normalStrength: 0.45 }),
    soil: texturesFrom(genSoil(), { normalStrength: 0.8 }),
    grassSide: texturesFrom(genGrassSide(), { normalStrength: 0.7 }),
    cobbleSide: texturesFrom(genCobbleSide(), { normalStrength: 0.6 }),
    sand: texturesFrom(genSand(), { normalStrength: 0.6 }),
    dirt: texturesFrom(genDirt(), { normalStrength: 0.7 }),
    door: texturesFrom(genDoor(), { normalStrength: 0.5, wrap: false }),
    window: {
      ...texturesFrom(win.pb, { normalStrength: 0.4, wrap: false }),
      emissiveMap: makeTexture(win.em.rgba, win.em.w, win.em.h, { srgb: true, wrap: false }),
    },
    sign: texturesFrom(genSign(), { normalStrength: 0.4, wrap: false }),
    waterNormal: genWaterNormal(),
    blob: genBlob(),
  };
  return cache;
}
