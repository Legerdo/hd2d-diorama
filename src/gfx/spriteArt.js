import { RNG, hash2, tileNoise, clamp, lerp } from '../util/rng.js';
import { PixelBuffer, hex, mulc, mixc, ditherIndex, outline, makeTexture } from './pixel.js';

// ---------------------------------------------------------------------------
// Procedural pixel-art sprites.
//  * Characters: 32x32 frames, sheet = 6 columns (idle0, idle1, walk0..3) x
//    3 rows (down / up / left; right = mirrored left).
//  * Trees / bushes: single frames with sphere-normal shading + dithering.
//  * Grass: 8 tuft variants in a 128x16 atlas.
// Every sprite gets a selective outline, the classic HD-2D/SNES look.
// ---------------------------------------------------------------------------

export const FRAME_PX = 32;
export const SHEET_COLS = 6;
export const SHEET_ROWS = 3;
export const DIR_ROW = { down: 0, up: 1, left: 2, right: 2 };
export const ANIM = { idle: [0, 1], walk: [2, 3, 4, 5] };

const POSES = [
  { bob: 0, stride: 0, lift: [0, 0], arm: 0 }, // idle 0
  { bob: 1, stride: 0, lift: [0, 0], arm: 0 }, // idle 1 (breath)
  { bob: 0, stride: 1, lift: [1, 0], arm: 1 }, // contact A
  { bob: -1, stride: 0, lift: [0, 2], arm: 0 }, // passing
  { bob: 0, stride: -1, lift: [0, 1], arm: -1 }, // contact B
  { bob: -1, stride: 0, lift: [2, 0], arm: 0 }, // passing
];

function tones(h) {
  const c = hex(h);
  return {
    l: [Math.min(255, c[0] * 1.22 + 14), Math.min(255, c[1] * 1.2 + 12), Math.min(255, c[2] * 1.1 + 6)],
    b: c,
    d: [c[0] * 0.68, c[1] * 0.68, c[2] * 0.76 + 8],
    dd: [c[0] * 0.46, c[1] * 0.46, c[2] * 0.56 + 10],
  };
}

class Frame {
  constructor(pb, em, ox, oy, w = FRAME_PX, h = FRAME_PX) {
    this.pb = pb;
    this.em = em;
    this.ox = ox;
    this.oy = oy;
    this.w = w;
    this.h = h;
  }
  p(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.pb.set(this.ox + x, this.oy + y, c);
  }
  r(x0, y0, x1, y1, c) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.p(x, y, c);
  }
  /** Emissive pixel: albedo + glow. */
  e(x, y, c, glow = c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.p(x, y, c);
    if (this.em) this.em.set(this.ox + x, this.oy + y, glow);
  }
}

// --------------------------- humanoids -------------------------------------

const HEAD_FB = [[14, 17], [12, 19], [11, 20], [10, 21], [10, 21], [10, 21], [10, 21], [10, 21], [10, 21], [11, 20], [12, 19]];
const HEAD_SIDE = [[13, 17], [11, 19], [10, 20], [10, 20], [10, 20], [10, 20], [10, 20], [10, 20], [10, 20], [11, 20], [12, 19]];

function drawHat(f, s, hY, view) {
  if (s.hat === 'wizard') {
    const C = s.hatColor;
    const lean = view === 'side' ? 1 : 0;
    const cone = [[11, 20], [12, 19], [13, 18], [14, 18], [15, 18]];
    for (let k = 0; k < cone.length; k++) {
      const y = hY - k;
      const [a, b] = cone[k];
      const sh = k >= 3 ? lean + (view === 'side' ? 1 : 0) : 0;
      f.r(a + sh, y, b + sh, y, C.b);
      f.p(a + sh, y, C.l);
      f.p(b + sh, y, C.d);
    }
    f.p(19 + lean * 2, hY - 4, C.d); // bent tip
    f.r(11, hY + 1, 20, hY + 1, s.hatBand.b);
    f.p(view === 'side' ? 12 : 15, hY + 1, s.hatBand.l);
    f.r(8, hY + 2, 23, hY + 2, C.b);
    f.r(7, hY + 3, 24, hY + 3, C.d);
    f.r(8, hY + 2, 10, hY + 2, C.l);
  } else if (s.hat === 'helmet') {
    const M = s.metal;
    const rows = view === 'side' ? HEAD_SIDE : HEAD_FB;
    for (let r = 0; r <= 5; r++) {
      const [a, b] = rows[r];
      f.r(a, hY + r, b, hY + r, M.b);
      f.p(a, hY + r, M.l);
      if (r < 4) f.p(a + 1, hY + r, M.l);
      f.p(b, hY + r, M.d);
    }
    f.r(9, hY + 5, 22, hY + 5, M.d);
    if (view === 'front') {
      f.r(10, hY + 6, 11, hY + 9, M.b);
      f.r(20, hY + 6, 21, hY + 9, M.d);
      f.r(15, hY + 5, 16, hY + 7, M.d); // nose guard
    } else if (view === 'back') {
      f.r(10, hY + 6, 21, hY + 9, M.b);
      f.r(19, hY + 6, 21, hY + 9, M.d);
    } else {
      f.r(15, hY + 6, 20, hY + 9, M.b);
      f.r(19, hY + 6, 20, hY + 9, M.d);
    }
    // plume
    const P = s.plume;
    f.r(15, hY - 2, 16, hY - 1, P.b);
    f.p(17, hY - 1, P.d);
    f.p(view === 'side' ? 18 : 14, hY - 2, P.l);
    if (view === 'side') f.r(17, hY - 2, 20, hY - 1, P.d);
  }
}

function drawHeadFB(f, s, hY, back) {
  const K = s.skin;
  const H = s.hair;
  for (let r = 0; r < 11; r++) {
    const [a, b] = HEAD_FB[r];
    f.r(a, hY + r, b, hY + r, K.b);
    f.p(b, hY + r, K.d);
    f.p(a, hY + r, K.l);
  }
  const hairRows = back ? 10 : 3;
  for (let r = 0; r <= hairRows; r++) {
    const [a, b] = HEAD_FB[r];
    f.r(a, hY + r, b, hY + r, H.b);
    f.p(b, hY + r, H.d);
    if (r > 0 && r < 4) f.p(b - 1, hY + r, H.d);
  }
  if (back) {
    f.r(14, hY + 10, 17, hY + 10, K.d);
    f.r(13, hY + 1, 15, hY + 2, H.l);
    for (let r = 6; r <= 9; r++) f.p(15 + (r % 2), hY + r, H.d);
  } else {
    // bangs
    const [a, b] = HEAD_FB[4];
    for (let x = a; x <= b; x++) if (!(x === 13 || x === 14 || x === 18)) f.p(x, hY + 4, x > 18 ? H.d : H.b);
    const sideRows = s.hairStyle === 'long' ? 10 : 7;
    for (let r = 4; r <= sideRows; r++) {
      f.p(HEAD_FB[r][0], hY + r, H.b);
      f.p(HEAD_FB[r][1], hY + r, H.d);
      if (s.hairStyle === 'long') {
        f.p(HEAD_FB[r][0] + 1, hY + r, H.b);
        f.p(HEAD_FB[r][1] - 1, hY + r, H.d);
      }
    }
    f.r(13, hY + 1, 15, hY + 1, H.l);
    f.p(12, hY + 2, H.l);
    // face
    const ey = hY + 6;
    f.r(13, ey, 13, ey + 1, s.eye);
    f.r(18, ey, 18, ey + 1, s.eye);
    if (s.blush) {
      f.p(12, ey + 2, s.blush);
      f.p(19, ey + 2, s.blush);
    }
    f.p(16, hY + 9, K.d);
  }
  if (s.hairStyle === 'long') {
    for (let y = hY + 8; y <= hY + 13; y++) {
      f.r(10, y, 11, y, H.b);
      f.r(20, y, 21, y, H.d);
      if (back) f.r(12, y, 19, y, H.b);
    }
  }
  if (s.hairStyle === 'spiky') {
    for (const [x, y, t] of [[13, -1, 'b'], [16, -1, 'b'], [16, -2, 'l'], [19, -1, 'd'], [9, 2, 'b'], [22, 2, 'd'], [11, 0, 'b']]) f.p(x, hY + y, H[t]);
  }
  if (s.hairStyle === 'ponytail') {
    if (back) {
      f.r(15, hY + 4, 16, hY + 13, H.b);
      f.p(16, hY + 12, H.d);
      f.r(14, hY + 4, 17, hY + 4, s.ribbon.b);
    } else {
      f.r(22, hY + 3, 22, hY + 7, H.d);
      f.p(21, hY + 2, s.ribbon.b);
    }
  }
  if (s.headband) {
    f.r(10, hY + 3, 21, hY + 3, s.headband.b);
    f.p(10, hY + 3, s.headband.l);
    if (back) {
      f.r(19, hY + 4, 20, hY + 6, s.headband.d);
    }
  }
  drawHat(f, s, hY, back ? 'back' : 'front');
}

function drawHeadSide(f, s, hY) {
  const K = s.skin;
  const H = s.hair;
  for (let r = 0; r < 11; r++) {
    const [a, b] = HEAD_SIDE[r];
    f.r(a, hY + r, b, hY + r, K.b);
    f.p(a, hY + r, K.l);
  }
  for (let r = 0; r <= 3; r++) {
    const [a, b] = HEAD_SIDE[r];
    f.r(a, hY + r, b, hY + r, H.b);
    f.p(b, hY + r, H.d);
  }
  for (let r = 4; r <= 9; r++) f.r(15, hY + r, HEAD_SIDE[r][1], hY + r, r > 6 ? H.d : H.b);
  f.r(10, hY + 4, 12, hY + 4, H.b);
  f.r(12, hY + 1, 14, hY + 1, H.l);
  f.r(15, hY + 6, 15, hY + 7, K.d); // ear
  f.r(11, hY + 6, 11, hY + 7, s.eye);
  f.p(9, hY + 7, K.b); // nose
  f.r(12, hY + 10, 14, hY + 10, K.d);
  if (s.blush) f.p(12, hY + 8, s.blush);
  if (s.hairStyle === 'spiky') {
    for (const [x, y, t] of [[13, -1, 'b'], [16, -1, 'b'], [17, -2, 'l'], [19, 0, 'b'], [21, 2, 'd'], [21, 4, 'd'], [11, 0, 'b']]) f.p(x, hY + y, H[t]);
  }
  if (s.hairStyle === 'ponytail') {
    f.r(20, hY + 3, 22, hY + 4, H.b);
    f.r(21, hY + 5, 22, hY + 10, H.d);
    f.p(20, hY + 3, s.ribbon.b);
    f.p(20, hY + 4, s.ribbon.d);
  }
  if (s.hairStyle === 'long') {
    for (let y = hY + 8; y <= hY + 13; y++) f.r(16, y, 20, y, y > hY + 11 ? H.d : H.b);
  }
  if (s.headband) {
    f.r(10, hY + 3, 20, hY + 3, s.headband.b);
    f.r(21, hY + 3, 22, hY + 5, s.headband.d);
  }
  drawHat(f, s, hY, 'side');
}

function drawItem(f, s, view, tY0, B, phase) {
  const it = s.item;
  if (!it) return;
  if (it === 'spear') {
    const x = view === 'front' ? 23 : view === 'back' ? 8 : 8;
    f.r(x, 4 + B, x, 30, s.shaft.b);
    f.p(x, 12 + B, s.shaft.l);
    f.r(x - 1, 3 + B, x + 1, 3 + B, s.tip.d);
    f.r(x, 0 + B, x, 2 + B, s.tip.l);
    f.p(x - 1, 2 + B, s.tip.b);
    f.p(x + 1, 2 + B, s.tip.d);
  } else if (it === 'staff') {
    const x = view === 'front' ? 23 : view === 'back' ? 8 : 8;
    f.r(x, tY0 - 8, x, 30, s.shaft.b);
    f.p(x, tY0 - 2, s.shaft.l);
    const oy = tY0 - 11;
    const O = s.orb;
    f.e(x, oy, O.l, O.glowL);
    f.e(x - 1, oy + 1, O.b, O.glow);
    f.e(x, oy + 1, O.l, O.glowL);
    f.e(x + 1, oy + 1, O.b, O.glow);
    f.e(x, oy + 2, O.b, O.glow);
    f.p(x - 1, oy + 3, s.shaft.d);
    f.p(x + 1, oy + 3, s.shaft.d);
  } else if (it === 'lantern') {
    const x = view === 'front' ? 22 : view === 'back' ? 9 : 9;
    const y = tY0 + 7 + (phase & 1);
    const L = s.lantern;
    f.p(x, y, L.frame.l);
    f.r(x - 1, y + 1, x + 1, y + 1, L.frame.b);
    f.e(x - 1, y + 2, L.glass.b, L.glow);
    f.e(x, y + 2, L.glass.l, L.glowL);
    f.e(x + 1, y + 2, L.glass.b, L.glow);
    f.e(x - 1, y + 3, L.glass.b, L.glow);
    f.e(x, y + 3, L.glass.l, L.glowL);
    f.e(x + 1, y + 3, L.glass.d, L.glow);
    f.r(x - 1, y + 4, x + 1, y + 4, L.frame.d);
  } else if (it === 'sword') {
    const M = s.blade;
    const G = s.hilt;
    if (view === 'front') {
      f.r(20, tY0 - 3, 20, tY0 - 1, G.b);
      f.r(19, tY0 - 1, 21, tY0 - 1, G.l);
    } else if (view === 'back') {
      for (let k = 0; k < 10; k++) f.p(19 - Math.round(k * 0.7), tY0 - 2 + k, k < 3 ? G.b : M.b);
      for (let k = 3; k < 10; k++) f.p(20 - Math.round(k * 0.7), tY0 - 2 + k, M.d);
      f.r(18, tY0, 20, tY0, G.l);
    } else {
      for (let k = 0; k < 7; k++) f.p(18 + Math.round(k * 0.6), tY0 + 6 + k, s.scabbard.b);
      f.p(17, tY0 + 5, G.l);
      f.p(18, tY0 + 5, G.b);
    }
  }
}

function drawHumanoidFB(f, s, pose, back, phase) {
  const B = pose.bob;
  const hipY = 24 + B;
  const T = s.top;
  const P = s.pants;
  const K = s.skin;
  const BT = s.boots;
  const tY0 = 16 + B;
  const tY1 = 23 + B;

  if (s.item === 'spear' || (s.item === 'staff' && back)) drawItem(f, s, back ? 'back' : 'front', tY0, B, phase);
  if (s.cape && !back) f.r(10, tY0 + 1, 21, 26 + B, s.cape.dd);

  // legs + boots
  if (!s.robe) {
    const legs = [[12, 14], [17, 19]];
    for (let i = 0; i < 2; i++) {
      const [x0, x1] = legs[i];
      const lift = pose.lift[back ? 1 - i : i];
      const foot = 30 - lift;
      f.r(x0, hipY, x1, foot - 3, P.b);
      f.r(x1, hipY, x1, foot - 3, P.d);
      if (i === 0) f.r(x0, hipY, x0, foot - 3, P.l);
      const bx0 = i === 0 ? 11 : 17;
      f.r(bx0, foot - 2, bx0 + 3, foot, BT.b);
      f.r(bx0, foot, bx0 + 3, foot, BT.d);
      f.p(bx0 + 1, foot - 2, BT.l);
      if (i === 1) f.r(bx0 + 3, foot - 2, bx0 + 3, foot, BT.d);
    }
    f.r(12, hipY, 19, hipY, P.d);
  }

  // torso
  if (s.robe) {
    for (let y = tY0; y <= 29; y++) {
      const spread = Math.floor((y - tY0) / 4);
      const sway = y > 25 ? pose.stride : 0;
      const x0 = 11 - spread + sway;
      const x1 = 20 + spread + sway;
      f.r(x0, y, x1, y, T.b);
      f.r(x0, y, x0 + 1, y, T.l);
      f.r(x1 - 1, y, x1, y, T.d);
      if (y === 29) f.r(x0, y, x1, y, s.trim.b);
      if (y === 28) f.r(x0, y, x1, y, s.trim.d);
    }
    if (pose.lift[0] === 0) f.r(12, 30, 14, 30, BT.b);
    if (pose.lift[1] === 0) f.r(17, 30, 19, 30, BT.d);
    if (!back) f.r(15, tY0 + 2, 16, 27, T.d); // front seam
  } else {
    f.r(11, tY0, 20, tY1, T.b);
    f.r(11, tY0, 12, tY1, T.l);
    f.r(19, tY0, 20, tY1, T.d);
    if (s.dress) {
      for (let y = tY1 - 1; y <= 27; y++) {
        const spread = Math.floor((y - tY1 + 1) / 2);
        const sway = y > 25 ? pose.stride : 0;
        f.r(11 - spread + sway, y, 20 + spread + sway, y, T.b);
        f.p(11 - spread + sway, y, T.l);
        f.p(20 + spread + sway, y, T.d);
        if (y === 27) f.r(11 - spread + sway, y, 20 + spread + sway, y, T.d);
      }
    }
  }
  if (s.belt) {
    f.r(11, tY1 - 1, 20, tY1 - 1, s.belt.b);
    if (!back) {
      f.p(15, tY1 - 1, s.buckle.b);
      f.p(16, tY1 - 1, s.buckle.l);
    }
  }
  if (s.apron && !back) {
    f.r(13, tY0 + 3, 18, 26, s.apron.b);
    f.r(18, tY0 + 3, 18, 26, s.apron.d);
    f.r(13, tY0 + 3, 18, tY0 + 3, s.apron.l);
  }
  if (s.tabard) {
    f.r(14, tY0 + 1, 17, tY1 + 3, s.tabard.b);
    f.r(17, tY0 + 1, 17, tY1 + 3, s.tabard.d);
    if (!back) {
      f.p(15, tY0 + 3, s.tabard.l);
      f.p(16, tY0 + 3, s.tabard.l);
      f.p(15, tY0 + 4, s.tabard.l);
    }
  }
  if (!back && s.neck !== false) {
    f.r(14, tY0, 17, tY0, K.d);
    f.r(15, tY0 + 1, 16, tY0 + 1, K.d);
  }
  if (s.cape) {
    if (back) {
      for (let y = tY0; y <= 26 + B; y++) {
        const w = y > tY0 + 2 ? 1 : 0;
        f.r(10 - w, y, 21 + w, y, s.cape.b);
        f.p(10 - w, y, s.cape.l);
        f.r(20 + w, y, 21 + w, y, s.cape.d);
      }
      for (let x = 9; x <= 22; x += 2) f.p(x, 27 + B, s.cape.d);
    } else {
      f.r(11, tY0, 13, tY0, s.cape.b);
      f.r(18, tY0, 20, tY0, s.cape.d);
      f.p(12, tY0 + 1, s.buckle.l);
    }
  }

  // arms
  const aL = pose.arm > 0 ? -1 : 0;
  const aR = pose.arm < 0 ? -1 : 0;
  const armL = s.armor ? s.metal : T;
  f.r(9, tY0 + aL, 10, tY0 + 4 + aL, armL.l);
  f.p(10, tY0 + 4 + aL, armL.b);
  f.r(9, tY0 + 5 + aL, 10, tY0 + 6 + aL, s.gloves ? s.gloves.b : K.b);
  f.r(21, tY0 + aR, 22, tY0 + 4 + aR, armL.d);
  f.r(21, tY0 + 5 + aR, 22, tY0 + 6 + aR, s.gloves ? s.gloves.d : K.d);

  drawHeadFB(f, s, 5 + B, back);

  if (s.item === 'staff' && !back) drawItem(f, s, 'front', tY0, B, phase);
  if (s.item === 'lantern' || s.item === 'sword') drawItem(f, s, back ? 'back' : 'front', tY0, B, phase);
}

function drawHumanoidSide(f, s, pose, phase) {
  const B = pose.bob;
  const hipY = 24 + B;
  const T = s.top;
  const P = s.pants;
  const K = s.skin;
  const BT = s.boots;
  const tY0 = 16 + B;
  const tY1 = 23 + B;
  const st = pose.stride;

  if (s.cape) {
    const flow = st !== 0 ? 1 : 0;
    for (let y = tY0; y <= 26 + B; y++) {
      const x1 = 20 + (y > tY0 + 3 ? flow + 1 : 0);
      f.r(17, y, x1, y, s.cape.b);
      f.p(x1, y, s.cape.d);
    }
    f.p(21 + flow, 27 + B, s.cape.d);
  }
  if (s.item === 'sword') drawItem(f, s, 'side', tY0, B, phase);

  // far arm (behind torso)
  f.r(17 + st, tY0 + 1, 18 + st, tY0 + 5, (s.armor ? s.metal : T).dd);

  if (!s.robe) {
    const legAt = (x0, x1, near, liftFoot) => {
      const len = 27 - hipY;
      for (let y = hipY; y <= 27 - liftFoot; y++) {
        const t = len > 0 ? (y - hipY) / len : 0;
        const x = Math.round(lerp(x0, x1, t));
        f.r(x, y, x + 2, y, near ? P.b : P.d);
        if (near) f.p(x, y, P.l);
      }
      const bx = Math.round(x1) - 1;
      const by = 28 - liftFoot;
      f.r(bx, by, bx + 3, by + 2, near ? BT.b : BT.d);
      f.r(bx, by + 2, bx + 3, by + 2, near ? BT.d : BT.dd);
      if (near) f.p(bx + 1, by, BT.l);
    };
    if (st === 0) {
      legAt(15, 15, false, 0);
      legAt(13, 13, true, pose.lift[0] + pose.lift[1] > 0 ? 1 : 0);
    } else {
      // near leg forward when stride > 0
      if (st > 0) {
        legAt(16, 18, false, 1);
        legAt(13, 10, true, 0);
      } else {
        legAt(13, 10, false, 0);
        legAt(16, 18, true, 1);
      }
    }
  }

  if (s.robe) {
    for (let y = tY0; y <= 29; y++) {
      const spread = Math.floor((y - tY0) / 5);
      const sway = y > 25 ? -st : 0;
      const x0 = 12 - spread + sway;
      const x1 = 19 + spread + sway;
      f.r(x0, y, x1, y, T.b);
      f.p(x0, y, T.l);
      f.r(x1 - 1, y, x1, y, T.d);
      if (y === 29) f.r(x0, y, x1, y, s.trim.b);
      if (y === 28) f.r(x0, y, x1, y, s.trim.d);
    }
    f.r(10 - (st > 0 ? 1 : 0), 30, 13 - (st > 0 ? 1 : 0), 30, BT.b);
  } else {
    f.r(12, tY0, 19, tY1, T.b);
    f.r(12, tY0, 13, tY1, T.l);
    f.r(19, tY0, 19, tY1, T.d);
    if (s.dress) {
      for (let y = tY1 - 1; y <= 27; y++) {
        const spread = Math.floor((y - tY1 + 1) / 2);
        const sway = y > 25 ? -st : 0;
        f.r(12 - spread + sway, y, 19 + spread + sway, y, T.b);
        f.p(12 - spread + sway, y, T.l);
        f.p(19 + spread + sway, y, T.d);
        if (y === 27) f.r(12 - spread + sway, y, 19 + spread + sway, y, T.d);
      }
    }
  }
  if (s.belt) f.r(12, tY1 - 1, 19, tY1 - 1, s.belt.b);
  if (s.apron) f.r(11, tY0 + 3, 12, 26, s.apron.b);
  if (s.tabard) f.r(12, tY0 + 1, 13, tY1 + 3, s.tabard.b);
  f.r(13, tY0, 14, tY0, K.d);

  // near arm swings with the stride
  const armC = s.armor ? s.metal : T;
  const sw = st;
  for (let k = 0; k <= 4; k++) {
    const x = Math.round(15 - sw * k * 0.5);
    f.r(x, tY0 + k, x + 1, tY0 + k, armC.l);
    f.p(x + 2, tY0 + k, armC.dd);
  }
  const hx = Math.round(15 - sw * 2.5);
  f.r(hx, tY0 + 5, hx + 1, tY0 + 6, s.gloves ? s.gloves.b : K.b);

  drawHeadSide(f, s, 5 + B);
  if (s.item && s.item !== 'sword') drawItem(f, s, 'side', tY0, B, phase);
}

// --------------------------- cat -------------------------------------------

function ellipse(f, cx, cy, rx, ry, cFn) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) f.p(x, y, cFn(dx, dy));
    }
  }
}

function drawCat(f, s, dir, pose) {
  const C = s.fur;
  const B = pose.bob > 0 ? 0 : pose.bob;
  const shadeFn = (dx, dy) => (dy < -0.35 ? C.l : dy > 0.45 ? C.d : C.b);
  const eyeC = s.eye;
  if (dir === 'left') {
    const tail = [[22, 25], [23, 24], [24, 23], [25, 22], [25, 21], [25, 20], [24, 19], [24, 18]];
    const tw = pose.stride !== 0 ? 1 : 0;
    for (const [x, y] of tail) f.p(x + (y < 21 ? tw : 0), y + B, C.b);
    const st = pose.stride;
    const legs = [[11 + st, true], [13 - st, false], [19 - st, true], [21 + st, false]];
    for (const [x, near] of legs) f.r(x, 27 + B, x, 30, near ? C.b : C.dd);
    ellipse(f, 16.5, 25.5 + B, 6.5, 2.8, shadeFn);
    ellipse(f, 10.5, 22 + B, 3.8, 3.4, shadeFn);
    f.p(8, 18 + B, C.b);
    f.p(8, 17 + B, C.l);
    f.p(12, 18 + B, C.b);
    f.p(12, 17 + B, C.b);
    f.e(9, 21 + B, eyeC.b, eyeC.glow);
    f.p(7, 23 + B, s.nose);
  } else if (dir === 'down') {
    const tw = pose.stride !== 0 ? pose.stride : 0;
    for (const [x, y] of [[21, 28], [22, 27], [23, 26], [23, 25], [23, 24], [22, 23]]) f.p(x + (y < 25 ? tw : 0), y + B, C.b);
    ellipse(f, 16, 26.5 + B, 5, 3, shadeFn);
    const lf = pose.lift;
    f.r(14, 28 + B, 14, 30 - lf[0], C.b);
    f.r(18, 28 + B, 18, 30 - lf[1], C.d);
    ellipse(f, 16, 21 + B, 4.4, 3.8, shadeFn);
    for (const [x, y] of [[12, 17], [13, 17], [12, 16], [19, 17], [20, 17], [20, 16]]) f.p(x, y + B, C.b);
    f.e(14, 21 + B, eyeC.b, eyeC.glow);
    f.e(18, 21 + B, eyeC.b, eyeC.glow);
    f.p(16, 23 + B, s.nose);
  } else {
    ellipse(f, 16, 25.5 + B, 5, 3.2, shadeFn);
    const lf = pose.lift;
    f.r(13, 28 + B, 13, 30 - lf[0], C.d);
    f.r(19, 28 + B, 19, 30 - lf[1], C.d);
    ellipse(f, 16, 20.5 + B, 4, 3.4, shadeFn);
    for (const [x, y] of [[12, 17], [13, 17], [12, 16], [19, 17], [20, 17], [20, 16]]) f.p(x, y + B, C.b);
    const sway = pose.stride;
    for (const [x, y] of [[16, 27], [16, 26], [17, 25], [17, 24], [18, 23], [18, 22]]) f.p(x + (y < 25 ? sway : 0), y + B, C.l);
  }
}

// --------------------------- sheets ----------------------------------------

function buildSheet(drawFrame) {
  const W = FRAME_PX * SHEET_COLS;
  const H = FRAME_PX * SHEET_ROWS;
  const pb = new PixelBuffer(W, H);
  const em = new PixelBuffer(W, H);
  const dirs = ['down', 'up', 'left'];
  for (let row = 0; row < SHEET_ROWS; row++) {
    for (let col = 0; col < SHEET_COLS; col++) {
      const f = new Frame(pb, em, col * FRAME_PX, row * FRAME_PX);
      drawFrame(f, dirs[row], POSES[col], col);
      outline(pb, col * FRAME_PX, row * FRAME_PX, col * FRAME_PX + FRAME_PX - 1, row * FRAME_PX + FRAME_PX - 1);
    }
  }
  return { pb, em };
}

function humanoidDrawer(spec) {
  return (f, dir, pose, col) => {
    if (dir === 'left') drawHumanoidSide(f, spec, pose, col);
    else drawHumanoidFB(f, spec, pose, dir === 'up', col);
  };
}

const T = tones;

export const CHARACTER_SPECS = {
  hero: {
    skin: T(0xf0c49a), hair: T(0x6b3b22), hairStyle: 'spiky', eye: hex(0x1c1826), blush: hex(0xe79a86),
    top: T(0x2f5f9e), pants: T(0x3b3a4a), boots: T(0x5a3a22), belt: T(0x4a2e1a), buckle: T(0xe0b050),
    cape: T(0xb4302c), headband: T(0xd8d0bc), item: 'sword', blade: T(0xb8c0cc), hilt: T(0xa27a30), scabbard: T(0x4a2e1a),
  },
  mage: {
    skin: T(0xe8b890), hair: T(0xcfd0e2), hairStyle: 'long', eye: hex(0x1c1826),
    top: T(0x4b2f7a), trim: T(0xd8b04a), robe: true, boots: T(0x2a1f2a), pants: T(0x2a1f2a),
    hat: 'wizard', hatColor: T(0x3d2766), hatBand: T(0xd8b04a), neck: false,
    item: 'staff', shaft: T(0x6a4526),
    orb: { l: hex(0xe8dcff), b: hex(0xa98bff), glow: hex(0x7c52ff), glowL: hex(0xd6c6ff) },
  },
  guard: {
    skin: T(0xd9a883), hair: T(0x2a2220), hairStyle: 'short', eye: hex(0x1c1826),
    metal: T(0x9aa4b0), top: T(0x7f8896), armor: true, tabard: T(0x8e2a2a), pants: T(0x3a3440), boots: T(0x3a2a20),
    belt: T(0x3a2618), buckle: T(0xc8a050), hat: 'helmet', plume: T(0xc03030), gloves: T(0x4a3526),
    item: 'spear', shaft: T(0x5a3a20), tip: T(0xc8d0da), neck: false,
  },
  villager: {
    skin: T(0xf2c9a5), hair: T(0xe0b04a), hairStyle: 'ponytail', ribbon: T(0xd04a5a), eye: hex(0x1c1826), blush: hex(0xeb9a8e),
    top: T(0x3f7a4a), dress: true, apron: T(0xe8e0cc), pants: T(0x6a4a3a), boots: T(0x4a2e1e),
    item: 'lantern',
    lantern: { frame: T(0x3a3a44), glass: T(0xffd070), glow: hex(0xff9a3c), glowL: hex(0xffe0a0) },
  },
};

const CAT_SPEC = { fur: T(0x2c2c3c), eye: { b: hex(0xf7d54a), glow: hex(0xffc830) }, nose: hex(0x8a5a6a) };

function sheetToTextures({ pb, em }) {
  return {
    map: makeTexture(pb.rgba, pb.w, pb.h, { srgb: true, wrap: false, mipmaps: false }),
    emissiveMap: makeTexture(em.rgba, em.w, em.h, { srgb: true, wrap: false, mipmaps: false }),
    pb,
    em,
  };
}

// --------------------------- vegetation ------------------------------------

const LEAF = [0x0f1f10, 0x162c14, 0x1f3d1a, 0x2a5021, 0x37652a, 0x4a7d35, 0x5f9442].map(hex);
const LIGHT_DIR = (() => {
  const l = [-0.55, -0.7, 0.45];
  const n = Math.hypot(...l);
  return l.map((v) => v / n);
})();

function shadeBlobs(pb, blobs, pal, seed, { noiseAmt = 0.34, x0 = 0, y0 = 0 } = {}) {
  for (let y = 0; y < pb.h; y++) {
    for (let x = 0; x < pb.w; x++) {
      let best = null;
      let bestZ = -1e9;
      for (const b of blobs) {
        const dx = x + 0.5 - b.x;
        const dy = y + 0.5 - b.y;
        const ang = Math.atan2(dy, dx);
        const wobble = 0.86 + 0.26 * tileNoise(ang * 2.2 + b.x, b.y * 0.1, 64, 64, seed);
        const r = b.r * wobble;
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        const z = Math.sqrt(r * r - d2) + (b.z || 0);
        if (z > bestZ) {
          bestZ = z;
          best = { nx: dx / r, ny: dy / r, nz: Math.sqrt(Math.max(0, 1 - d2 / (r * r))) };
        }
      }
      if (!best) continue;
      let l = best.nx * LIGHT_DIR[0] + best.ny * LIGHT_DIR[1] + best.nz * LIGHT_DIR[2];
      l = l * 0.5 + 0.5;
      l += (tileNoise((x + x0) / 2.5, (y + y0) / 2.5, 256, 256, seed + 3) - 0.5) * noiseAmt;
      l += (hash2(x, y, seed) - 0.5) * 0.08;
      pb.set(x, y, pal[ditherIndex(clamp(l * 1.05 - 0.05, 0, 1), pal.length, x, y, 1.2)]);
    }
  }
}

function drawOak(seed) {
  const W = 64;
  const H = 80;
  const pb = new PixelBuffer(W, H);
  const rng = new RNG(seed);
  const bark = [0x22160f, 0x33231a, 0x463224, 0x5a412f].map(hex);
  for (let y = 44; y < H; y++) {
    const flare = y > 72 ? Math.round((y - 72) * 0.9) : 0;
    const w = 6 + flare;
    const x0 = 32 - Math.floor(w / 2);
    for (let x = x0; x < x0 + w; x++) {
      const t = (x - x0) / Math.max(1, w - 1);
      let lvl = t < 0.25 ? 3 : t < 0.6 ? 2 : 1;
      if (tileNoise(x / 1.5, y / 5, 64, 64, seed + 9) > 0.68) lvl = Math.max(0, lvl - 1);
      pb.set(x, y, bark[lvl]);
    }
  }
  // a branch
  for (let k = 0; k < 8; k++) pb.set(36 + k, 52 - Math.round(k * 0.7), bark[1]);
  const blobs = [
    { x: 32, y: 30, r: 17, z: 4 },
    { x: 19, y: 36, r: 12, z: 0 },
    { x: 45, y: 36, r: 12, z: 0 },
    { x: 24, y: 20, r: 12, z: 2 },
    { x: 41, y: 21, r: 12, z: 1 },
    { x: 32, y: 12, r: 10, z: 0 },
    { x: 30, y: 42, r: 10, z: 5 },
  ].map((b) => ({ ...b, x: b.x + rng.float(-2, 2), y: b.y + rng.float(-2, 2), r: b.r * rng.float(0.92, 1.08) }));
  const canopy = new PixelBuffer(W, H);
  shadeBlobs(canopy, blobs, LEAF, seed);
  pb.blit(canopy, 0, 0);
  // fruit / blossoms
  for (let i = 0; i < 7; i++) {
    const b = rng.pick(blobs);
    const x = Math.round(b.x + rng.float(-b.r, b.r) * 0.6);
    const y = Math.round(b.y + rng.float(-b.r, b.r) * 0.6);
    if (pb.alpha(x, y)) pb.set(x, y, hex(0xd9c26a));
  }
  outline(pb);
  return pb;
}

function drawPine(seed) {
  const W = 48;
  const H = 88;
  const pb = new PixelBuffer(W, H);
  const rng = new RNG(seed);
  const bark = [0x22160f, 0x33231a, 0x463224].map(hex);
  pb.rect(22, 70, 25, 87, bark[1]);
  pb.rect(22, 70, 22, 87, bark[2]);
  pb.rect(25, 70, 25, 87, bark[0]);
  const pal = [0x0c1a14, 0x11251b, 0x183424, 0x21452e, 0x2d5a39, 0x3b6f45].map(hex);
  const tiers = [
    { top: 2, bottom: 26, half: 10 },
    { top: 14, bottom: 42, half: 15 },
    { top: 28, bottom: 58, half: 19 },
    { top: 42, bottom: 74, half: 23 },
  ];
  for (const t of tiers) {
    for (let y = t.top; y <= t.bottom; y++) {
      const k = (y - t.top) / (t.bottom - t.top);
      const half = Math.round(t.half * Math.pow(k, 0.85)) + 1;
      const jag = y > t.bottom - 3 ? Math.round(Math.sin(y * 3 + t.top) * 2) : 0;
      for (let x = 24 - half - jag; x <= 23 + half + jag; x++) {
        const u = (x - (24 - half)) / (2 * half);
        let l = 1 - u * 0.9 - k * 0.35 + (tileNoise(x / 2, y / 2, 64, 64, seed) - 0.5) * 0.4;
        if (y > t.bottom - 2) l -= 0.25;
        pb.set(x, y, pal[ditherIndex(clamp(l, 0, 1), pal.length, x, y, 1.2)]);
      }
    }
  }
  for (let i = 0; i < 12; i++) {
    const x = rng.int(12, 36);
    const y = rng.int(8, 70);
    if (pb.alpha(x, y)) pb.set(x, y, pal[5]);
  }
  outline(pb);
  return pb;
}

function drawBush(seed, berries = null) {
  const W = 32;
  const H = 22;
  const pb = new PixelBuffer(W, H);
  const rng = new RNG(seed);
  const blobs = [
    { x: 16, y: 12, r: 9, z: 3 },
    { x: 9, y: 14, r: 7, z: 0 },
    { x: 23, y: 14, r: 7, z: 0 },
    { x: 13, y: 8, r: 6, z: 1 },
    { x: 20, y: 8, r: 6, z: 1 },
  ].map((b) => ({ ...b, x: b.x + rng.float(-1, 1), y: b.y + rng.float(-1, 1) }));
  shadeBlobs(pb, blobs, LEAF.slice(0, 6), seed);
  // flatten bottom so it sits on the ground
  for (let y = 20; y < H; y++) for (let x = 0; x < W; x++) pb.clearPx(x, y);
  if (berries) {
    for (let i = 0; i < 9; i++) {
      const x = rng.int(4, 27);
      const y = rng.int(4, 16);
      if (pb.alpha(x, y)) {
        pb.set(x, y, hex(berries));
        pb.set(x + 1, y, mulc(hex(berries), 0.7));
      }
    }
  }
  outline(pb);
  return pb;
}

function drawGrassAtlas(seed = 7) {
  const N = 8;
  const S = 16;
  const pb = new PixelBuffer(S * N, S);
  const rng = new RNG(seed);
  const greens = [0x1c3219, 0x274522, 0x33592b, 0x436f33, 0x578640, 0x6d9c4c].map(hex);
  for (let v = 0; v < N; v++) {
    const ox = v * S;
    const tall = v === 4;
    const blades = tall ? 7 : rng.int(5, 8);
    let tallest = null;
    for (let b = 0; b < blades; b++) {
      const bx = 8 + rng.int(-4, 3);
      const hgt = tall ? rng.int(9, 14) : rng.int(4, 9);
      const lean = rng.float(-0.35, 0.35);
      for (let k = 0; k < hgt; k++) {
        const x = Math.round(bx + lean * k * (1 + k * 0.06));
        const y = 15 - k;
        const c = greens[clamp(Math.floor((k / hgt) * 5.5), 0, 5)];
        if (x >= 1 && x < S - 1) pb.set(ox + x, y, c);
      }
      if (!tallest || hgt > tallest.h) tallest = { x: Math.round(bx + lean * hgt), h: hgt };
    }
    if (tall) {
      pb.rect(ox + tallest.x, 15 - tallest.h, ox + tallest.x, 16 - tallest.h + 2, hex(0x6a4424));
    }
    if (v >= 5) {
      const petal = hex([0xf1d05a, 0xe0708e, 0xe8eef8][v - 5]);
      const center = hex([0xb0602a, 0xf2e070, 0xf0c050][v - 5]);
      const fx = clamp(tallest.x, 3, 12);
      const fy = clamp(15 - tallest.h - 1, 2, 10);
      pb.set(ox + fx, fy - 1, petal);
      pb.set(ox + fx - 1, fy, petal);
      pb.set(ox + fx + 1, fy, petal);
      pb.set(ox + fx, fy + 1, petal);
      pb.set(ox + fx, fy, center);
      if (v !== 7) {
        const fx2 = clamp(fx + rng.int(-5, 5), 2, 13);
        const fy2 = clamp(fy + rng.int(2, 4), 3, 12);
        pb.set(ox + fx2, fy2, petal);
        pb.set(ox + fx2 + 1, fy2, mulc(petal, 0.75));
      }
    }
    outline(pb, ox, 0, ox + S - 1, S - 1, 0.45);
  }
  return pb;
}

// --------------------------- public API ------------------------------------

let spriteCache = null;

export function createSpriteArt() {
  if (spriteCache) return spriteCache;
  const characters = {};
  for (const [name, spec] of Object.entries(CHARACTER_SPECS)) {
    characters[name] = sheetToTextures(buildSheet(humanoidDrawer(spec)));
  }
  characters.cat = sheetToTextures(
    buildSheet((f, dir, pose) => drawCat(f, CAT_SPEC, dir, pose)),
  );
  const tex = (pb) => ({ map: makeTexture(pb.rgba, pb.w, pb.h, { srgb: true, wrap: false, mipmaps: true }), pb });
  spriteCache = {
    characters,
    trees: { oak: tex(drawOak(3)), oak2: tex(drawOak(19)), pine: tex(drawPine(5)) },
    bushes: { plain: tex(drawBush(8)), berry: tex(drawBush(13, 0xc8344a)), flower: tex(drawBush(21, 0xe8e0f0)) },
    grass: { ...tex(drawGrassAtlas()), count: 8 },
  };
  return spriteCache;
}
