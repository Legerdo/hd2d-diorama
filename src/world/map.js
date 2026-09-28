import { clamp } from '../util/rng.js';

// ---------------------------------------------------------------------------
// Diorama layout: a 28 x 20 cell grid (1 cell = 1 world unit). North (row 0)
// is away from the default camera. Heights, walkability and colliders live
// here so actors and the geometry builder share one source of truth.
// ---------------------------------------------------------------------------

export const MAP_W = 28;
export const MAP_D = 20;
export const X0 = -14; // world x of column 0's west edge
export const Z0 = -10; // world z of row 0's north edge
export const TERRACE_H = 1.5;
export const WATER_BED = -1.0;
export const WATER_LEVEL = -0.32;
export const BASE_Y = -3.0;
export const BRIDGE_Y = 0.3;
export const STAIRS = { x0: -2, x1: 2, zTop: -3, zBottom: 0, steps: 6 };

// G grass terrace, P cobble terrace, g grass, p cobble plaza, d dirt path,
// w canal (water), B bridge over canal, S stairs.
const ROWS = [
  'GGGGGGGPPPPPPPPPPPPPPGGGGGGG',
  'GGGGGGGPPPPPPPPPPPPPPGGGGGGG',
  'GGGGGGGPPPPPPPPPPPPPPGGGGGGG',
  'GGGGGGGPPPPPPPPPPPPPPGGGGGGG',
  'GGGGGGGPPPPPPPPPPPPPPGGGGGGG',
  'GGGGGGGPPPPPPPPPPPPPPGGGGGGG',
  'GGGGGGGPPPPPPPPPPPPPPGGGGGGG',
  'gggwwwppppppSSSSppppppgggggg',
  'gggwwwppppppSSSSppppppgggggg',
  'gggwwwppppppSSSSppppppgggggg',
  'gggwwwppppppppppppppppgggggg',
  'gggwwwppppppppppppppppgggggg',
  'gggBBBppppppppppppppppgggggg',
  'gggBBBppppppppppppppppgggggg',
  'gggwwwppppppppppppppppgggggg',
  'gggwwwggggggddddgggggggggggg',
  'gggwwwggggggddddgggggggggggg',
  'gggwwwgggggggddddggggggggggg',
  'gggwwwgggggggddddggggggggggg',
  'gggwwwggggggggddddgggggggggg',
];

export const CELL_TYPES = {
  G: { h: TERRACE_H, top: 'grass', side: 'terraceGrass', walk: true },
  P: { h: TERRACE_H, top: 'cobble', side: 'terraceStone', walk: true },
  g: { h: 0, top: 'grass', side: 'grass', walk: true },
  p: { h: 0, top: 'cobble', side: 'cobble', walk: true },
  d: { h: 0, top: 'dirt', side: 'grass', walk: true },
  w: { h: WATER_BED, top: 'sand', side: 'soil', walk: false, water: true },
  B: { h: WATER_BED, top: 'sand', side: 'soil', walk: true, water: true, bridge: true },
  S: { h: 0, top: null, side: 'brick', walk: true, stairs: true },
};

export class WorldMap {
  constructor() {
    this.cells = ROWS.map((row, j) => {
      if (row.length !== MAP_W) throw new Error(`map row ${j} has ${row.length} columns`);
      return [...row].map((ch, i) => ({ i, j, ch, type: CELL_TYPES[ch], h: CELL_TYPES[ch].h }));
    });
    /** @type {{x:number,z:number,r:number}[]} */
    this.circles = [];
    /** @type {{x0:number,z0:number,x1:number,z1:number}[]} */
    this.boxes = [];
  }

  cell(i, j) {
    if (i < 0 || j < 0 || i >= MAP_W || j >= MAP_D) return null;
    return this.cells[j][i];
  }

  cellAt(x, z) {
    return this.cell(Math.floor(x - X0), Math.floor(z - Z0));
  }

  cellRect(i, j) {
    return { x0: X0 + i, x1: X0 + i + 1, z0: Z0 + j, z1: Z0 + j + 1 };
  }

  addCircle(x, z, r) {
    this.circles.push({ x, z, r });
  }

  addBox(x0, z0, x1, z1) {
    this.boxes.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });
  }

  /** Walkable ground height at (x, z), or null outside the map. */
  groundHeight(x, z) {
    const c = this.cellAt(x, z);
    if (!c) return null;
    if (c.type.stairs) {
      const t = clamp((STAIRS.zBottom - z) / (STAIRS.zBottom - STAIRS.zTop), 0, 1);
      return t * TERRACE_H;
    }
    if (c.type.bridge) return BRIDGE_Y;
    return c.h;
  }

  blockedByColliders(x, z, r) {
    for (const c of this.circles) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < (c.r + r) * (c.r + r)) return true;
    }
    for (const b of this.boxes) {
      if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) return true;
    }
    return false;
  }

  /** Can an actor of radius r stand at (x, z) coming from height fromY? */
  canStand(x, z, fromY, r = 0.22) {
    const probes = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
    for (const [ox, oz] of probes) {
      const c = this.cellAt(x + ox, z + oz);
      if (!c || !c.type.walk) return false;
      const h = this.groundHeight(x + ox, z + oz);
      if (Math.abs(h - fromY) > 0.55) return false;
    }
    return !this.blockedByColliders(x, z, r);
  }

  /** A random walkable point inside a rectangle (for wandering NPCs). */
  randomPoint(rng, rect, fromY, tries = 30) {
    for (let k = 0; k < tries; k++) {
      const x = rng.float(rect.x0, rect.x1);
      const z = rng.float(rect.z0, rect.z1);
      const h = this.groundHeight(x, z);
      if (h === null || Math.abs(h - fromY) > 0.1) continue;
      if (this.canStand(x, z, h, 0.35)) return { x, z };
    }
    return null;
  }
}
