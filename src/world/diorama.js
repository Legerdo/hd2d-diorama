import * as THREE from 'three';
import { RNG, clamp, smoothstep } from '../util/rng.js';
import { envMaterial } from '../gfx/materials.js';
import { BILLBOARD_QUAD, createSpriteMaterial, createBillboardMesh, createBlobShadow } from '../gfx/billboard.js';
import { createWaterMaterial, createWaterfall } from '../fx/water.js';
import { BatchSet, MeshBuilder } from './meshBuilder.js';
import { MAP_W, MAP_D, X0, Z0, TERRACE_H, WATER_LEVEL, WATER_BED, BASE_Y, BRIDGE_Y, STAIRS } from './map.js';

const T = TERRACE_H;
const TILE = 4;

// ---------------------------------------------------------------------------
// Builds every static piece of the diorama from the WorldMap, registers
// colliders, and returns placement data for lights / particles / sprites.
// ---------------------------------------------------------------------------

export function buildDiorama({ map, tex, sprites }) {
  const rng = new RNG(1234);
  const root = new THREE.Group();
  root.name = 'diorama';

  const metal = new THREE.MeshStandardMaterial({ color: 0x2c2c33, roughness: 0.4, metalness: 0.75, vertexColors: true });
  const glass = new THREE.MeshStandardMaterial({ color: 0xffd79a, emissive: 0xff9a40, emissiveIntensity: 5, roughness: 0.3, vertexColors: true });
  const coals = new THREE.MeshStandardMaterial({ color: 0x1a0c08, emissive: 0xff4a12, emissiveIntensity: 2.2, roughness: 0.9, vertexColors: true });
  const wood = envMaterial(tex.wood, { roughness: 0.8 });
  const woodDark = envMaterial(tex.wood, { roughness: 0.82, color: 0x75655a });
  const M = {
    grass: envMaterial(tex.grass, { roughness: 0.95 }),
    cobble: envMaterial(tex.cobble, { roughness: 0.6 }),
    brick: envMaterial(tex.brick, { roughness: 0.82 }),
    plaster: envMaterial(tex.plaster, { roughness: 0.93 }),
    wood,
    woodDark,
    woodGreen: envMaterial(tex.wood, { roughness: 0.8, color: 0x86a58e }),
    roof: envMaterial(tex.roof, { roughness: 0.68 }),
    roofDark: envMaterial(tex.roof, { roughness: 0.75, color: 0x8a7676 }),
    soil: envMaterial(tex.soil, { roughness: 0.98 }),
    grassSide: envMaterial(tex.grassSide, { roughness: 0.95 }),
    cobbleSide: envMaterial(tex.cobbleSide, { roughness: 0.9 }),
    sand: envMaterial(tex.sand, { roughness: 0.85 }),
    dirt: envMaterial(tex.dirt, { roughness: 0.96 }),
    door: envMaterial(tex.door, { roughness: 0.8 }),
    window: envMaterial(tex.window, { roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 2.4 }),
    sign: envMaterial(tex.sign, { roughness: 0.8 }),
    plinth: envMaterial(tex.wood, { roughness: 0.5, color: 0x4a362c }),
    metal,
    glass,
    coals,
    // same materials, but in batches that don't cast shadows (torch holders)
    metalNS: metal,
    woodNS: woodDark,
  };
  const B = new BatchSet(M);

  // --------------------------------------------------------------- AO field
  const aoBoxes = [];
  const rectDist = (x, z, r) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
  const addAO = (x0, z0, x1, z1, y0, y1, k = 0.45, f = 3.2) => aoBoxes.push({ x0, z0, x1, z1, y0, y1, k, f });

  function aoTop(x, y, z) {
    let d1 = 0;
    let d2 = 0;
    const push = (d) => {
      if (d > d1) {
        d2 = d1;
        d1 = d;
      } else if (d > d2) d2 = d;
    };
    const ci = Math.floor(x - X0);
    const cj = Math.floor(z - Z0);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const c = map.cell(ci + di, cj + dj);
        if (!c) continue;
        const ch = c.type.stairs ? 0.7 : c.h;
        if (ch <= y + 0.3) continue;
        push(0.42 * Math.exp(-rectDist(x, z, map.cellRect(ci + di, cj + dj)) * 3.0));
      }
    }
    for (const b of aoBoxes) {
      if (b.y1 <= y + 0.05 || b.y0 > y + 0.3) continue;
      const d = rectDist(x, z, b);
      if (d > 2.5) continue;
      push(b.k * Math.exp(-d * b.f));
    }
    return clamp(1 - d1 - 0.45 * d2, 0.32, 1);
  }
  const aoWall = (floorY) => (x, y, z, n) => (Math.abs(n[1]) < 0.5 ? 1 - 0.42 * Math.exp(-Math.max(0, y - floorY) * 2.4) : 1);
  const aoOuter = (y) => 0.3 + 0.7 * smoothstep(BASE_Y, 0.2, y);

  // ------------------------------------------------------------ helpers
  const box = (key, x0, y0, z0, x1, y1, z1, opts = {}) =>
    B.get(key).box(x0, y0, z0, x1, y1, z1, { tile: TILE, ao: opts.ao ?? aoWall(y0), ...opts });
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const rbox = (key, cx, cy, cz, sx, sy, sz, rx = 0, ry = 0, rz = 0, floorY = null) => {
    _m.compose(new THREE.Vector3(cx, cy, cz), _q.setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    B.get(key).addGeometry(new THREE.BoxGeometry(sx, sy, sz), _m, { uvMode: 'world', tile: TILE, ao: floorY === null ? null : aoWall(floorY) });
  };
  const cyl = (key, cx, cy, cz, rTop, rBot, h, seg = 12, floorY = null) => {
    _m.makeTranslation(cx, cy + h / 2, cz);
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, false);
    B.get(key).addGeometry(g, _m, { uvScale: [(Math.PI * 2 * Math.max(rTop, rBot)) / TILE, h / TILE], ao: floorY === null ? null : aoWall(floorY) });
  };
  const quad = (key, p0, p1, p2, p3, n, uv = [[0, 0], [1, 0], [1, 1], [0, 1]], ao = null) => B.get(key).quad(p0, p1, p2, p3, n, uv[0], uv[1], uv[2], uv[3], ao);

  // Register AO occluders for the big structures before the terrain is built.
  const HX0 = -4.5;
  const HX1 = 4.5;
  const HZ0 = -9.2;
  const HZ1 = -5.8;
  addAO(HX0, HZ0, HX1, HZ1, T, T + 6, 0.5, 2.6);
  addAO(STAIRS.x0 - 0.3, STAIRS.zTop, STAIRS.x0, STAIRS.zBottom, 0, 1.8, 0.35);
  addAO(STAIRS.x1, STAIRS.zTop, STAIRS.x1 + 0.3, STAIRS.zBottom, 0, 1.8, 0.35);
  addAO(-14, -3.3, STAIRS.x0 - 0.3, -3.0, T, T + 0.55, 0.38);
  addAO(STAIRS.x1 + 0.3, -3.3, 14, -3.0, T, T + 0.55, 0.38);

  // Props that also darken the ground (registered with their geometry below).
  const props = [];
  const prop = (fn, aoRect, collider) => {
    props.push(fn);
    if (aoRect) addAO(...aoRect);
    if (collider) {
      if (collider.r) map.addCircle(collider.x, collider.z, collider.r);
      else map.addBox(collider.x0, collider.z0, collider.x1, collider.z1);
    }
  };

  // --------------------------------------------------------------- terrain
  const DIRS = [
    ['N', 0, -1],
    ['S', 0, 1],
    ['E', 1, 0],
    ['W', -1, 0],
  ];
  function sideQuad(key, r, dir, ya, yb, uvV, ao) {
    const { x0, x1, z0, z1 } = r;
    let pts;
    let n;
    let s;
    if (dir === 'S') {
      pts = [[x0, ya, z1], [x1, ya, z1], [x1, yb, z1], [x0, yb, z1]];
      n = [0, 0, 1];
      s = (p) => p[0];
    } else if (dir === 'N') {
      pts = [[x1, ya, z0], [x0, ya, z0], [x0, yb, z0], [x1, yb, z0]];
      n = [0, 0, -1];
      s = (p) => -p[0];
    } else if (dir === 'E') {
      pts = [[x1, ya, z1], [x1, ya, z0], [x1, yb, z0], [x1, yb, z1]];
      n = [1, 0, 0];
      s = (p) => -p[2];
    } else {
      pts = [[x0, ya, z0], [x0, ya, z1], [x0, yb, z1], [x0, yb, z0]];
      n = [-1, 0, 0];
      s = (p) => p[2];
    }
    const uvs = pts.map((p) => [s(p) / TILE, uvV(p[1])]);
    B.get(key).quad(pts[0], pts[1], pts[2], pts[3], n, uvs[0], uvs[1], uvs[2], uvs[3], pts.map((p) => ao(p[1])));
  }
  /** Emit [ya, yb] split into <= 1 unit rows so vertex AO has enough resolution. */
  function sideRange(key, r, dir, ya, yb, uvV, ao) {
    if (yb - ya < 1e-4) return;
    let y = ya;
    while (y < yb - 1e-4) {
      const ny = Math.min(yb, Math.floor(y + 1 + 1e-4));
      sideQuad(key, r, dir, y, Math.max(ny, y + 1e-3) > yb ? yb : Math.max(ny, y + 1e-3), uvV, ao);
      y = ny > y ? ny : yb;
    }
  }
  const worldV = (y) => y / TILE;

  function emitSides(c, r, dir, y0, y1, outer) {
    const style = c.type.side;
    const ao = outer ? aoOuter : (y) => 1 - 0.42 * Math.exp(-Math.max(0, y - y0) * 2.4);
    const band = (key) => {
      const bTop = y1;
      const bBot = Math.max(y0, y1 - 1);
      sideRange(key, r, dir, bBot, bTop, (y) => y - (y1 - 1), ao);
      if (bBot > y0) sideRange('soil', r, dir, y0, bBot, worldV, ao);
    };
    if (outer) {
      if (style === 'terraceStone') {
        sideRange('brick', r, dir, 0, y1, worldV, ao);
        sideRange('soil', r, dir, y0, 0, worldV, ao);
      } else if (style === 'cobble') band('cobbleSide');
      else if (style === 'soil') sideRange('soil', r, dir, y0, y1, worldV, ao);
      else band('grassSide');
    } else if (style === 'grass') band('grassSide');
    else if (style === 'soil') sideRange('soil', r, dir, y0, y1, worldV, ao);
    else sideRange('brick', r, dir, y0, y1, worldV, ao);
  }

  // Props must register AO occluders before tops are emitted -> define props first (below), then terrain.
  definePropsAndStructures();

  for (let j = 0; j < MAP_D; j++) {
    for (let i = 0; i < MAP_W; i++) {
      const c = map.cell(i, j);
      const r = map.cellRect(i, j);
      if (!c.type.stairs) {
        const key = c.type.top;
        const y = c.h;
        for (let sz = 0; sz < 2; sz++) {
          for (let sx = 0; sx < 2; sx++) {
            const xa = r.x0 + sx * 0.5;
            const xb = xa + 0.5;
            const za = r.z0 + sz * 0.5;
            const zb = za + 0.5;
            const pts = [[xa, y, zb], [xb, y, zb], [xb, y, za], [xa, y, za]];
            B.get(key).quad(pts[0], pts[1], pts[2], pts[3], [0, 1, 0], ...pts.map((p) => [p[0] / TILE, -p[2] / TILE]), pts.map((p) => aoTop(p[0], y, p[2])));
          }
        }
      }
      const h = c.type.stairs ? 0 : c.h;
      for (const [dir, di, dj] of DIRS) {
        const n = map.cell(i + di, j + dj);
        const outer = !n;
        const hn = outer ? BASE_Y : n.type.stairs ? 0 : n.h;
        if (hn >= h - 1e-4) continue;
        emitSides(c, r, dir, hn, h, outer);
      }
    }
  }
  // slab underside + display plinth
  box('soil', X0, BASE_Y - 0.02, Z0, X0 + MAP_W, BASE_Y, Z0 + MAP_D, { skip: { py: 1, px: 1, nx: 1, pz: 1, nz: 1 }, ao: () => 0.3 });
  box('plinth', X0 - 0.35, BASE_Y - 0.6, Z0 - 0.35, X0 + MAP_W + 0.35, BASE_Y, Z0 + MAP_D + 0.35, { ao: (x, y) => 0.55 + 0.45 * smoothstep(BASE_Y - 0.6, BASE_Y, y) });
  box('plinth', X0 - 0.2, BASE_Y - 0.9, Z0 - 0.2, X0 + MAP_W + 0.2, BASE_Y - 0.6, Z0 + MAP_D + 0.2, { skip: { py: 1 }, ao: () => 0.45 });

  for (const fn of props) fn();

  // ------------------------------------------------------------ water
  const water = new MeshBuilder();
  const wx0 = -11;
  const wx1 = -8;
  const wz0 = -3;
  const wz1 = 10;
  const wy = WATER_LEVEL;
  const wp = [[wx0, wy, wz1], [wx1, wy, wz1], [wx1, wy, wz0], [wx0, wy, wz0]];
  water.quad(...wp, [0, 1, 0], ...wp.map((p) => [p[0] / TILE, -p[2] / TILE]));
  const ws = [[wx0, WATER_BED, wz1], [wx1, WATER_BED, wz1], [wx1, wy, wz1], [wx0, wy, wz1]];
  water.quad(...ws, [0, 0, 1], ...ws.map((p) => [p[0] / TILE, p[1] / TILE]));
  const waterMesh = new THREE.Mesh(water.build(), createWaterMaterial(tex.waterNormal));
  waterMesh.receiveShadow = true;
  waterMesh.renderOrder = 1;
  root.add(waterMesh);

  const fall = createWaterfall(3, 7.5, { speed: 2.6, fadeStart: 0.6 });
  fall.position.set((wx0 + wx1) / 2, wy + 0.01, wz1 + 0.03);
  root.add(fall);
  const spout = createWaterfall(0.36, 0.95, { speed: 3.2, fadeStart: 0.05 });
  spout.position.set(-9.5, 0.62, -2.52);
  root.add(spout);

  // ------------------------------------------------------------ meshes
  for (const m of B.toMeshes({ noShadowKeys: ['metalNS', 'woodNS', 'glass', 'coals', 'window', 'door'] })) root.add(m);

  // ------------------------------------------------------------ vegetation sprites
  const billboards = [];
  const treeDefs = [
    { kind: 'oak', x: -12.0, z: -7.7, y: T },
    { kind: 'pine', x: 11.9, z: -8.1, y: T },
    { kind: 'pine', x: -12.7, z: -1.4, y: 0 },
    { kind: 'oak2', x: 11.7, z: 1.9, y: 0 },
    { kind: 'pine', x: 12.7, z: 7.2, y: 0 },
    { kind: 'oak', x: -6.9, z: 8.7, y: 0 },
    { kind: 'oak2', x: -8.8, z: -7.9, y: T },
  ];
  const treeMats = {};
  for (const t of treeDefs) {
    const art = sprites.trees[t.kind];
    const w = art.pb.w / 16;
    const h = art.pb.h / 16;
    treeMats[t.kind] ??= createSpriteMaterial({ map: art.map, rim: 0.9, wrap: 0.55, sway: 0.018, shadowPull: 0.3, normalUp: 0.55 });
    const mesh = createBillboardMesh(treeMats[t.kind], w, h);
    mesh.position.set(t.x, t.y - 0.05, t.z);
    root.add(mesh);
    billboards.push(mesh);
    map.addCircle(t.x, t.z, 0.45);
    const blob = createBlobShadow(tex.blob, w * 0.55, w * 0.3, 0.45);
    blob.position.set(t.x, t.y + 0.015, t.z);
    root.add(blob);
  }
  const bushDefs = [
    { kind: 'berry', x: -13.1, z: 3.9, y: 0 },
    { kind: 'plain', x: -12.9, z: 8.4, y: 0 },
    { kind: 'flower', x: 9.7, z: -2.2, y: 0 },
    { kind: 'plain', x: 13.1, z: 4.3, y: 0 },
    { kind: 'berry', x: 6.4, z: 9.1, y: 0 },
    { kind: 'flower', x: -6.4, z: -4.3, y: T },
    { kind: 'plain', x: 6.6, z: -4.4, y: T },
    { kind: 'plain', x: -3.2, z: 7.6, y: 0 },
    { kind: 'flower', x: -13.0, z: -5.2, y: T },
    { kind: 'berry', x: 10.2, z: 5.4, y: 0 },
  ];
  const bushMats = {};
  for (const b of bushDefs) {
    const art = sprites.bushes[b.kind];
    const w = art.pb.w / 16;
    const h = art.pb.h / 16;
    bushMats[b.kind] ??= createSpriteMaterial({ map: art.map, rim: 1.0, wrap: 0.6, sway: 0.03, shadowPull: 0.2, normalUp: 0.6 });
    const mesh = createBillboardMesh(bushMats[b.kind], w, h);
    mesh.position.set(b.x, b.y - 0.03, b.z);
    root.add(mesh);
    billboards.push(mesh);
    map.addCircle(b.x, b.z, 0.55);
    const blob = createBlobShadow(tex.blob, w * 0.75, w * 0.35, 0.4);
    blob.position.set(b.x, b.y + 0.015, b.z);
    root.add(blob);
  }

  // ------------------------------------------------------------ grass tufts (instanced)
  const tufts = [];
  const addTuft = (x, y, z, variant, s) => tufts.push({ x, y, z, variant, s });
  for (let j = 0; j < MAP_D; j++) {
    for (let i = 0; i < MAP_W; i++) {
      const c = map.cell(i, j);
      const r = map.cellRect(i, j);
      const isGrass = c.type.top === 'grass';
      const isEdge = !isGrass && (c.ch === 'd' || c.ch === 'p');
      const n = isGrass ? rng.int(2, 4) : isEdge ? 1 : 0;
      for (let k = 0; k < n; k++) {
        const x = rng.float(r.x0 + 0.08, r.x1 - 0.08);
        const z = rng.float(r.z0 + 0.08, r.z1 - 0.08);
        if (map.blockedByColliders(x, z, 0.12)) continue;
        if (x > HX0 - 0.3 && x < HX1 + 0.3 && z > HZ0 - 0.3 && z < HZ1 + 0.2) continue;
        if (!isGrass) {
          // only near grass neighbours, to soften the tile borders
          const nearGrass = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => map.cell(i + di, j + dj)?.type.top === 'grass');
          if (!nearGrass || rng.chance(0.5)) continue;
        }
        const roll = rng.next();
        const variant = roll < 0.66 ? rng.int(0, 3) : roll < 0.74 ? 4 : rng.int(5, 7);
        addTuft(x, c.h, z, variant, rng.float(0.55, 0.9));
      }
    }
  }
  // canal-bank reeds
  for (let z = -2.5; z < 9.8; z += rng.float(0.5, 1.1)) {
    if (z > 1.8 && z < 4.2) continue;
    addTuft(-11.12 + rng.float(-0.05, 0.1), 0, z, 4, rng.float(0.7, 1.0));
    if (rng.chance(0.5)) addTuft(-7.9 + rng.float(-0.1, 0.05), 0, z + 0.3, 4, rng.float(0.6, 0.9));
  }
  // window flower boxes
  for (const cx of [-3.25, 3.25]) {
    for (let k = 0; k < 4; k++) addTuft(cx - 0.36 + k * 0.24, T + 1.17, -5.62, 5 + ((k + (cx > 0 ? 1 : 0)) % 3), 0.42);
  }
  const grassGeo = BILLBOARD_QUAD.clone();
  const aVariant = new Float32Array(tufts.length);
  const grassMat = createSpriteMaterial({ map: sprites.grass.map, atlas: sprites.grass.count, rim: 0.8, wrap: 0.75, sway: 0.1, centerlineShadow: false, normalUp: 0.85 });
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, tufts.length);
  const mtx = new THREE.Matrix4();
  tufts.forEach((t, i) => {
    mtx.makeScale(t.s, t.s, t.s).setPosition(t.x, t.y - 0.02, t.z);
    grass.setMatrixAt(i, mtx);
    aVariant[i] = t.variant;
  });
  grassGeo.setAttribute('aVariant', new THREE.InstancedBufferAttribute(aVariant, 1));
  grass.instanceMatrix.needsUpdate = true;
  grass.computeBoundingSphere();
  grass.castShadow = false;
  grass.receiveShadow = true;
  root.add(grass);

  // ------------------------------------------------------------ placement data
  const torchDefs = [
    { position: new THREE.Vector3(-1.3, T + 2.47, -5.6), lightOffset: [0, 0.12, 0.2], preset: 'torch', intensity: 11, distance: 10, seed: 1 },
    { position: new THREE.Vector3(1.3, T + 2.47, -5.6), lightOffset: [0, 0.12, 0.2], preset: 'torch', intensity: 11, distance: 10, seed: 2 },
    { position: new THREE.Vector3(0, 0.16, 2.5), lightOffset: [0, 0.75, 0], preset: 'campfire', color: 0xff7a2e, intensity: 30, distance: 15, seed: 3, mapSize: 1024 },
    { position: new THREE.Vector3(-12.3, 1.0, 1.4), lightOffset: [0, 0.3, 0], preset: 'torch', intensity: 12, distance: 10, seed: 4 },
    { position: new THREE.Vector3(7.2, 2.16, -2.2), lightOffset: [0, 0.12, 0], preset: 'lamp', color: 0xffb060, intensity: 9, distance: 10, seed: 5 },
  ];
  const windowLights = [
    { position: new THREE.Vector3(-3.25, T + 1.9, -5.25), color: 0xffa050, intensity: 2.6, distance: 5 },
    { position: new THREE.Vector3(3.25, T + 1.9, -5.25), color: 0xffa050, intensity: 2.6, distance: 5 },
    { position: new THREE.Vector3(4.95, T + 1.9, -7.5), color: 0xffa050, intensity: 2.0, distance: 4.5 },
  ];
  const emberEmitters = [
    { position: new THREE.Vector3(0, 0.45, 2.5), count: 80, spread: 0.55, rise: 2.4, life: 2.2 },
    { position: new THREE.Vector3(-1.3, T + 2.65, -5.6), count: 14, spread: 0.18, rise: 1.1, life: 1.4 },
    { position: new THREE.Vector3(1.3, T + 2.65, -5.6), count: 14, spread: 0.18, rise: 1.1, life: 1.4 },
    { position: new THREE.Vector3(-12.3, 1.2, 1.4), count: 24, spread: 0.25, rise: 1.4, life: 1.6 },
  ];
  const fireflyAnchors = [
    { position: new THREE.Vector3(-12.6, 0, 6.2), count: 7, radius: 1.8 },
    { position: new THREE.Vector3(11.4, 0, 4.0), count: 7, radius: 2.0 },
    { position: new THREE.Vector3(-6.0, 0, 8.3), count: 6, radius: 1.6 },
    { position: new THREE.Vector3(11.8, T, -6.2), count: 6, radius: 1.8 },
    { position: new THREE.Vector3(-11.2, T, -5.8), count: 6, radius: 1.8 },
    { position: new THREE.Vector3(-9.5, -0.1, 6.5), count: 6, radius: 1.2 },
  ];
  const smokeOrigin = new THREE.Vector3(2.8, T + 6.15, -8.3);

  return { root, billboards, torchDefs, windowLights, emberEmitters, fireflyAnchors, smokeOrigin, materials: M };

  // =================================================================== props
  function definePropsAndStructures() {
    // ---------------- stairs + cheek walls
    prop(() => {
      const S = STAIRS;
      const stepD = (S.zBottom - S.zTop) / S.steps;
      const stepH = T / S.steps;
      for (let k = 0; k < S.steps; k++) {
        const zf = S.zBottom - k * stepD;
        const zb = zf - stepD;
        const top = (k + 1) * stepH;
        const tread = [[S.x0, top, zf], [S.x1, top, zf], [S.x1, top, zb], [S.x0, top, zb]];
        B.get('brick').quad(...tread, [0, 1, 0], ...tread.map((p) => [p[0] / TILE, -p[2] / TILE]), [1, 1, 0.72, 0.72]);
        const riser = [[S.x0, k * stepH, zf], [S.x1, k * stepH, zf], [S.x1, top, zf], [S.x0, top, zf]];
        B.get('brick').quad(...riser, [0, 0, 1], ...riser.map((p) => [p[0] / TILE, p[1] / TILE]), [0.7, 0.7, 1, 1]);
        box('brick', S.x0 - 0.3, 0, zb, S.x0, top + 0.35, zf, { skip: { ny: 1 } });
        box('brick', S.x1, 0, zb, S.x1 + 0.3, top + 0.35, zf, { skip: { ny: 1 } });
      }
    }, null, null);
    map.addBox(STAIRS.x0 - 0.32, STAIRS.zTop - 0.05, STAIRS.x0 + 0.02, STAIRS.zBottom + 0.02);
    map.addBox(STAIRS.x1 - 0.02, STAIRS.zTop - 0.05, STAIRS.x1 + 0.32, STAIRS.zBottom + 0.02);

    // ---------------- terrace parapet
    prop(() => {
      for (const [a, b] of [[-14, STAIRS.x0 - 0.3], [STAIRS.x1 + 0.3, 14]]) {
        box('brick', a, T, -3.3, b, T + 0.45, -3.0, { skip: { ny: 1 } });
        box('brick', a, T + 0.45, -3.36, b, T + 0.56, -2.94, { ao: () => 1 });
      }
    });
    map.addBox(-14, -3.4, STAIRS.x0 - 0.3, -2.9);
    map.addBox(STAIRS.x1 + 0.3, -3.4, 14, -2.9);

    // ---------------- canal spout in the retaining wall
    prop(() => {
      box('brick', -9.82, 0.5, -3.0, -9.18, 0.78, -2.5, { ao: () => 0.9 });
      box('metalNS', -9.62, 0.55, -2.6, -9.38, 0.62, -2.49, { ao: () => 1 });
    });

    // ---------------- house
    prop(() => {
      const W = HZ1 - 0.1; // plaster front plane
      box('brick', HX0, T, HZ0, HX1, T + 0.9, HZ1, { skip: { ny: 1 } });
      box('plaster', HX0 + 0.1, T + 0.9, HZ0 + 0.1, HX1 - 0.1, T + 3.5, HZ1 - 0.1, { skip: { ny: 1, py: 1 }, ao: () => 1 });
      const beamF = (x0, y0, x1, y1) => box('woodDark', x0, y0, W - 0.02, x1, y1, W + 0.07, { ao: () => 1 });
      for (const x of [HX0 + 0.1, -2.1, -0.95, 0.95, 2.1, HX1 - 0.1]) beamF(x - 0.11, T + 0.9, x + 0.11, T + 3.5);
      beamF(HX0 - 0.01, T + 0.9, HX1 + 0.01, T + 1.08);
      beamF(HX0 - 0.01, T + 3.32, HX1 + 0.01, T + 3.5);
      // side walls: posts + beams + braces
      for (const sx of [HX0 + 0.1, HX1 - 0.1]) {
        const o = sx < 0 ? -1 : 1;
        const bx0 = o < 0 ? sx - 0.07 : sx - 0.02;
        const bx1 = o < 0 ? sx + 0.02 : sx + 0.07;
        for (const z of [HZ0 + 0.1, -7.5, HZ1 - 0.1]) box('woodDark', bx0, T + 0.9, z - 0.11, bx1, T + 3.5, z + 0.11, { ao: () => 1 });
        box('woodDark', bx0, T + 0.9, HZ0, bx1, T + 1.08, HZ1, { ao: () => 1 });
        box('woodDark', bx0, T + 3.32, HZ0, bx1, T + 3.5, HZ1, { ao: () => 1 });
        if (o < 0) {
          for (const [za, zb] of [[HZ0 + 0.2, -7.6], [HZ1 - 0.2, -7.4]]) {
            const dy = 2.2;
            const dz = zb - za;
            const len = Math.hypot(dy, dz);
            rbox('woodDark', sx - 0.035, T + 1.08 + dy / 2, (za + zb) / 2, 0.07, len, 0.16, Math.atan2(dz, dy), 0, 0);
          }
        }
      }
      // door + frame + step
      const zd = HZ1 + 0.012;
      quad('door', [-0.75, T, zd], [0.75, T, zd], [0.75, T + 2.25, zd], [-0.75, T + 2.25, zd], [0, 0, 1]);
      box('woodDark', -0.92, T, HZ1 - 0.1, -0.75, T + 2.42, HZ1 + 0.1);
      box('woodDark', 0.75, T, HZ1 - 0.1, 0.92, T + 2.42, HZ1 + 0.1);
      box('woodDark', -0.95, T + 2.25, HZ1 - 0.1, 0.95, T + 2.45, HZ1 + 0.12, { ao: () => 1 });
      box('brick', -1.05, T, HZ1, 1.05, T + 0.12, HZ1 + 0.45);
      // front windows with sills, flower boxes and shutters
      for (const cx of [-3.25, 3.25]) {
        const zf = W + 0.012;
        quad('window', [cx - 0.5, T + 1.3, zf], [cx + 0.5, T + 1.3, zf], [cx + 0.5, T + 2.8, zf], [cx - 0.5, T + 2.8, zf], [0, 0, 1]);
        box('woodDark', cx - 0.6, T + 1.2, W - 0.02, cx + 0.6, T + 1.3, W + 0.16, { ao: () => 1 });
        box('woodDark', cx - 0.6, T + 2.8, W - 0.02, cx + 0.6, T + 2.9, W + 0.1, { ao: () => 1 });
        box('wood', cx - 0.52, T + 0.98, W, cx + 0.52, T + 1.17, W + 0.34, { ao: () => 0.9 });
        box('woodGreen', cx - 0.9, T + 1.3, W, cx - 0.56, T + 2.8, W + 0.05, { ao: () => 1 });
        box('woodGreen', cx + 0.56, T + 1.3, W, cx + 0.9, T + 2.8, W + 0.05, { ao: () => 1 });
      }
      // east side window
      {
        const xw = HX1 - 0.1 + 0.075;
        quad('window', [xw, T + 1.3, -7.0], [xw, T + 1.3, -8.0], [xw, T + 2.8, -8.0], [xw, T + 2.8, -7.0], [1, 0, 0]);
        box('woodDark', HX1 - 0.1, T + 1.2, -8.1, HX1 + 0.08, T + 1.3, -6.9, { ao: () => 1 });
      }
      // roof (45-ish degrees, passes over the wall top)
      const slope = 1.05;
      const zw = HZ1 - 0.1;
      const zbw = HZ0 + 0.1;
      const zc = (HZ0 + HZ1) / 2;
      const yW = T + 3.55;
      const over = 0.45;
      const zF = zw + over;
      const zB = zbw - over;
      const yE = yW - over * slope;
      const yR = yW + (zw - zc) * slope;
      const rx0 = HX0 - 0.45;
      const rx1 = HX1 + 0.45;
      const sl = Math.hypot(zF - zc, yR - yE);
      const nF = new THREE.Vector3(0, zF - zc, yR - yE).normalize().toArray();
      const nB = new THREE.Vector3(0, zc - zB, -(yR - yE)).normalize().toArray();
      quad('roof', [rx0, yE, zF], [rx1, yE, zF], [rx1, yR, zc], [rx0, yR, zc], nF, [[rx0 / TILE, 0], [rx1 / TILE, 0], [rx1 / TILE, sl / TILE], [rx0 / TILE, sl / TILE]]);
      quad('roof', [rx1, yE, zB], [rx0, yE, zB], [rx0, yR, zc], [rx1, yR, zc], nB, [[-rx1 / TILE, 0], [-rx0 / TILE, 0], [-rx0 / TILE, sl / TILE], [-rx1 / TILE, sl / TILE]]);
      // undersides
      quad('woodDark', [rx0, yE - 0.02, zF], [rx0, yR - 0.02, zc], [rx1, yR - 0.02, zc], [rx1, yE - 0.02, zF], nF.map((v) => -v), [[0, 0], [0, 1], [1, 1], [1, 0]], [0.5, 0.35, 0.35, 0.5]);
      quad('woodDark', [rx1, yE - 0.02, zB], [rx1, yR - 0.02, zc], [rx0, yR - 0.02, zc], [rx0, yE - 0.02, zB], nB.map((v) => -v), [[0, 0], [0, 1], [1, 1], [1, 0]], [0.5, 0.35, 0.35, 0.5]);
      // fascia + barge boards + ridge cap
      box('woodDark', rx0, yE - 0.2, zF - 0.02, rx1, yE + 0.02, zF + 0.07, { ao: () => 1 });
      box('woodDark', rx0, yE - 0.2, zB - 0.07, rx1, yE + 0.02, zB + 0.02, { ao: () => 1 });
      const angF = Math.atan2(yR - yE, zc - zF);
      for (const bx of [rx0 - 0.04, rx1 + 0.04]) {
        rbox('woodDark', bx, (yE + yR) / 2 + 0.02, (zF + zc) / 2, 0.08, 0.2, sl + 0.1, -angF, 0, 0);
        rbox('woodDark', bx, (yE + yR) / 2 + 0.02, (zB + zc) / 2, 0.08, 0.2, sl + 0.1, angF, 0, 0);
      }
      box('roofDark', rx0 - 0.08, yR - 0.1, zc - 0.16, rx1 + 0.08, yR + 0.12, zc + 0.16, { ao: () => 1 });
      // gables
      for (const gx of [HX0 + 0.1, HX1 - 0.1]) {
        const o = gx < 0 ? -1 : 1;
        const p0 = [gx, T + 3.45, o < 0 ? zbw - 0.04 : zw + 0.04];
        const p1 = [gx, T + 3.45, o < 0 ? zw + 0.04 : zbw - 0.04];
        const p2 = [gx, yR + 0.02, zc];
        const uv = (p) => [(o < 0 ? p[2] : -p[2]) / TILE, p[1] / TILE];
        B.get('plaster').tri(p0, p1, p2, [o, 0, 0], uv(p0), uv(p1), uv(p2));
        box('woodDark', o < 0 ? gx - 0.07 : gx - 0.02, T + 3.5, zc - 0.11, o < 0 ? gx + 0.02 : gx + 0.07, yR - 0.1, zc + 0.11, { ao: () => 1 });
      }
      // chimney
      box('brick', 2.45, T + 3.9, -8.65, 3.15, T + 6.0, -7.95, { ao: (x, y) => 0.75 + 0.25 * smoothstep(T + 4.2, T + 5.2, y) });
      box('brick', 2.36, T + 6.0, -8.74, 3.24, T + 6.14, -7.86, { ao: () => 1 });
      // barrel + crates on the terrace
      barrel(3.95, T, -5.3);
      crate(-4.25, T, -5.45, 0.7, 0.7);
    }, null, { x0: HX0 - 0.1, z0: HZ0 - 0.1, x1: HX1 + 0.1, z1: HZ1 + 0.05 });
    map.addBox(-1.1, HZ1, 1.1, HZ1 + 0.5); // door step
    map.addCircle(3.95, -5.3, 0.45);
    map.addBox(-4.65, -5.85, -3.85, -5.05);
    addAO(3.6, -5.65, 4.3, -4.95, T, T + 1, 0.4);
    addAO(-4.6, -5.8, -3.9, -5.1, T, T + 0.7, 0.4);

    // wall torch holders
    prop(() => {
      for (const x of [-1.3, 1.3]) {
        const W = HZ1 - 0.1;
        box('metalNS', x - 0.04, T + 1.96, W, x + 0.04, T + 2.04, W + 0.34, { ao: () => 1 });
        box('woodNS', x - 0.045, T + 1.85, -5.645, x + 0.045, T + 2.36, -5.555, { ao: () => 1 });
        box('metalNS', x - 0.09, T + 2.3, -5.69, x + 0.09, T + 2.42, -5.51, { ao: () => 1 });
      }
    });

    // hanging tavern sign on a post (terrace, left of the stairs)
    prop(() => {
      box('woodDark', -3.46, T, -4.06, -3.34, T + 2.3, -3.94);
      box('woodDark', -3.46, T + 2.14, -4.04, -2.3, T + 2.24, -3.96, { ao: () => 1 });
      for (const cx of [-3.25, -2.45]) box('metalNS', cx - 0.012, T + 1.98, -4.01, cx + 0.012, T + 2.14, -3.99, { ao: () => 1 });
      quad('sign', [-3.35, T + 1.3, -3.955], [-2.35, T + 1.3, -3.955], [-2.35, T + 2.0, -3.955], [-3.35, T + 2.0, -3.955], [0, 0, 1]);
      quad('woodDark', [-2.35, T + 1.3, -4.045], [-3.35, T + 1.3, -4.045], [-3.35, T + 2.0, -4.045], [-2.35, T + 2.0, -4.045], [0, 0, -1]);
      box('woodDark', -3.35, T + 1.3, -4.04, -2.35, T + 1.34, -3.96, { ao: () => 1 });
    }, null, { x: -3.4, z: -4.0, r: 0.2 });

    // ---------------- campfire
    prop(() => {
      const cx = 0;
      const cz = 2.5;
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + 0.2;
        const rr = 0.62 + (k % 2) * 0.05;
        rbox('brick', cx + Math.cos(a) * rr, 0.1, cz + Math.sin(a) * rr, 0.3, 0.22 + (k % 3) * 0.04, 0.24, 0, -a, 0, 0);
      }
      cyl('coals', cx, 0.0, cz, 0.42, 0.46, 0.08, 10);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI + 0.4;
        rbox('woodDark', cx + Math.cos(a) * 0.05, 0.2, cz + Math.sin(a) * 0.05, 0.9, 0.14, 0.14, 0, -a, 0.35 * (k % 2 ? 1 : -1));
      }
    }, [-0.8, 1.7, 0.8, 3.3, 0, 0.35, 0.3, 3.0], { x: 0, z: 2.5, r: 0.85 });

    // benches around the fire
    for (const [bx0, bx1] of [[-3.0, -1.6], [1.6, 3.0]]) {
      prop(() => {
        box('wood', bx0, 0.36, 3.95, bx1, 0.48, 4.35, { ao: () => 1, rotTop: true });
        for (const lx of [bx0 + 0.12, bx1 - 0.22]) box('woodDark', lx, 0, 4.0, lx + 0.1, 0.36, 4.3);
      }, [bx0, 3.95, bx1, 4.35, 0, 0.48, 0.3, 4], { x0: bx0, z0: 3.9, x1: bx1, z1: 4.4 });
    }

    // ---------------- well
    prop(() => {
      const cx = 5.5;
      const cz = 0.9;
      const n = 10;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        rbox('brick', cx + Math.cos(a) * 0.72, 0.42, cz + Math.sin(a) * 0.72, 0.5, 0.84, 0.26, 0, -a + Math.PI / 2, 0, 0);
      }
      cyl('brick', cx, 0.84, cz, 0.9, 0.9, 0.08, 14);
      const wv = new THREE.MeshStandardMaterial({ color: 0x0b1820, roughness: 0.05, metalness: 0 });
      M.wellWater = wv;
      B.materials.wellWater = wv;
      cyl('wellWater', cx, 0.58, cz, 0.58, 0.58, 0.02, 14);
      for (const ox of [-0.82, 0.82]) box('woodDark', cx + ox - 0.07, 0.8, cz - 0.07, cx + ox + 0.07, 2.2, cz + 0.07, { ao: () => 1 });
      rbox('woodDark', cx, 1.75, cz, 1.8, 0.1, 0.1, 0, 0, 0);
      for (const s of [-1, 1]) rbox('roof', cx, 2.35, cz + s * 0.36, 2.1, 0.06, 0.95, s * 0.72, 0, 0);
      box('roofDark', cx - 1.08, 2.58, cz - 0.07, cx + 1.08, 2.7, cz + 0.07, { ao: () => 1 });
      box('woodDark', cx - 0.14, 1.28, cz - 0.12, cx + 0.14, 1.56, cz + 0.12, { ao: () => 1 });
      box('metalNS', cx - 0.01, 1.56, cz - 0.01, cx + 0.01, 1.75, cz + 0.01, { ao: () => 1 });
    }, [4.5, -0.1, 6.5, 1.9, 0, 1, 0.45, 2.6], { x: 5.5, z: 0.9, r: 1.0 });

    // ---------------- crates / barrels / sacks by the retaining wall
    prop(() => {
      crate(-7.6, 0, -2.95, 0.8, 0.8);
      crate(-7.5, 0.8, -2.85, 0.6, 0.6);
      crate(-6.55, 0, -2.95, 0.7, 0.65);
      barrel(-5.35, 0, -2.55);
      barrel(-4.6, 0, -2.6);
      barrel(-4.95, 0, -1.95);
    }, [-7.7, -3.0, -4.2, -1.55, 0, 1.4, 0.45, 2.8], null);
    map.addBox(-7.7, -3.0, -6.8, -2.1);
    map.addBox(-6.6, -3.0, -5.8, -2.25);
    map.addCircle(-5.35, -2.55, 0.42);
    map.addCircle(-4.6, -2.6, 0.42);
    map.addCircle(-4.95, -1.95, 0.42);

    // ---------------- lamp post (east plaza)
    prop(() => {
      const x = 7.2;
      const z = -2.2;
      box('brick', x - 0.22, 0, z - 0.22, x + 0.22, 0.28, z + 0.22);
      box('metal', x - 0.06, 0.28, z - 0.06, x + 0.06, 1.98, z + 0.06, { ao: () => 1 });
      box('metalNS', x - 0.16, 1.98, z - 0.16, x + 0.16, 2.04, z + 0.16, { ao: () => 1 });
      for (const [ox, oz] of [[-0.14, -0.14], [0.14, -0.14], [0.14, 0.14], [-0.14, 0.14]]) box('metalNS', x + ox - 0.02, 2.04, z + oz - 0.02, x + ox + 0.02, 2.44, z + oz + 0.02, { ao: () => 1 });
      box('metalNS', x - 0.2, 2.44, z - 0.2, x + 0.2, 2.5, z + 0.2, { ao: () => 1 });
      box('metalNS', x - 0.1, 2.5, z - 0.1, x + 0.1, 2.6, z + 0.1, { ao: () => 1 });
    }, [6.9, -2.5, 7.5, -1.9, 0, 0.3, 0.35], { x: 7.2, z: -2.2, r: 0.28 });

    // ---------------- brazier by the bridge
    prop(() => {
      const x = -12.3;
      const z = 1.4;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.3;
        rbox('metal', x + Math.cos(a) * 0.2, 0.42, z + Math.sin(a) * 0.2, 0.06, 0.9, 0.06, Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      }
      cyl('metal', x, 0.78, z, 0.38, 0.2, 0.2, 10);
      cyl('coals', x, 0.93, z, 0.32, 0.32, 0.05, 10);
    }, [-12.7, 1.0, -11.9, 1.8, 0, 1, 0.3], { x: -12.3, z: 1.4, r: 0.45 });

    // ---------------- bridge
    prop(() => {
      box('wood', -11.35, BRIDGE_Y - 0.16, 2.15, -7.65, BRIDGE_Y, 3.85, { rotTop: true, ao: () => 1 });
      for (const pz of [2.3, 3.7]) for (const px of [-10.6, -8.4]) box('woodDark', px - 0.09, WATER_BED, pz - 0.09, px + 0.09, BRIDGE_Y - 0.16, pz + 0.09, { ao: () => 0.8 });
      for (const rz of [2.22, 3.78]) {
        for (const px of [-11.25, -9.5, -7.75]) box('woodDark', px - 0.06, BRIDGE_Y, rz - 0.06, px + 0.06, BRIDGE_Y + 0.62, rz + 0.06, { ao: () => 1 });
        box('wood', -11.3, BRIDGE_Y + 0.52, rz - 0.05, -7.7, BRIDGE_Y + 0.6, rz + 0.05, { ao: () => 1 });
      }
    });
    map.addBox(-11.3, 2.1, -7.7, 2.32);
    map.addBox(-11.3, 3.68, -7.7, 3.9);

    // ---------------- fence (east garden)
    prop(() => {
      for (const [z0, z1] of [[-2.8, 0.4], [2.8, 5.0]]) {
        for (let z = z0; z <= z1 + 1e-3; z += (z1 - z0) / Math.round((z1 - z0) / 0.8)) box('woodDark', 8.4, 0, z - 0.06, 8.52, 0.78, z + 0.06, { ao: aoWall(0) });
        for (const y of [0.3, 0.6]) box('wood', 8.42, y, z0, 8.5, y + 0.08, z1, { ao: () => 1 });
      }
    });
    map.addBox(8.3, -2.85, 8.62, 0.45);
    map.addBox(8.3, 2.75, 8.62, 5.05);

    // ---------------- signpost (south path)
    prop(() => {
      box('woodDark', 2.84, 0, 6.34, 2.96, 1.3, 6.46);
      rbox('wood', 3.2, 1.06, 6.4, 0.9, 0.28, 0.07, 0, 0, 0.06);
      rbox('wood', 2.62, 0.72, 6.4, 0.75, 0.24, 0.07, 0, 0, -0.08);
    }, null, { x: 2.9, z: 6.4, r: 0.18 });
  }

  // ----------------------------------------------------------------- small props
  function crate(x0, y0, z0, w, h) {
    box('wood', x0, y0, z0, x0 + w, y0 + h, z0 + w, { ao: aoWall(0) });
    const e = 0.06;
    for (const [a, b] of [[x0 - 0.01, x0 + e], [x0 + w - e, x0 + w + 0.01]]) {
      box('woodDark', a, y0, z0 - 0.01, b, y0 + h, z0 + w + 0.01, { ao: () => 1 });
    }
    box('woodDark', x0 - 0.01, y0 + h - e, z0 - 0.01, x0 + w + 0.01, y0 + h + 0.005, z0 + w + 0.01, { ao: () => 1 });
  }
  function barrel(x, y, z) {
    cyl('wood', x, y, z, 0.34, 0.34, 0.92, 12, y);
    for (const by of [0.14, 0.72]) cyl('metal', x, y + by, z, 0.36, 0.36, 0.07, 12);
    cyl('woodDark', x, y + 0.92, z, 0.3, 0.3, 0.01, 12);
  }
}
