import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Minimal geometry accumulator: world-aligned UV boxes/quads + per-vertex AO
// (written to the colour attribute), merged into one BufferGeometry per
// material so the whole diorama is a handful of draw calls (important because
// every shadow-casting point light renders the scene six times).
// ---------------------------------------------------------------------------

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  /** p0..p3 counter-clockwise when seen from the side the normal points to. */
  quad(p0, p1, p2, p3, n, t0, t1, t2, t3, ao = null) {
    const b = this.vertexCount;
    const ps = [p0, p1, p2, p3];
    const ts = [t0, t1, t2, t3];
    for (let i = 0; i < 4; i++) {
      this.pos.push(ps[i][0], ps[i][1], ps[i][2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.uv.push(ts[i][0], ts[i][1]);
      const a = ao ? ao[i] : 1;
      this.col.push(a, a, a);
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  tri(p0, p1, p2, n, t0, t1, t2, ao = null) {
    const b = this.vertexCount;
    const ps = [p0, p1, p2];
    const ts = [t0, t1, t2];
    for (let i = 0; i < 3; i++) {
      this.pos.push(ps[i][0], ps[i][1], ps[i][2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.uv.push(ts[i][0], ts[i][1]);
      const a = ao ? ao[i] : 1;
      this.col.push(a, a, a);
    }
    this.idx.push(b, b + 1, b + 2);
  }

  /**
   * Axis-aligned box with world-aligned UVs.
   * opts.tile: world units per texture repeat; opts.skip: {px,nx,py,ny,pz,nz};
   * opts.ao(x, y, z, n): per-vertex AO; opts.rotTop: run the top texture along Z.
   */
  box(x0, y0, z0, x1, y1, z1, opts = {}) {
    const tile = opts.tile ?? 4;
    const skip = opts.skip ?? {};
    const aoF = opts.ao ?? null;
    const U = (a) => a / tile;
    const ao = (pts, n) => (aoF ? pts.map((p) => aoF(p[0], p[1], p[2], n)) : null);
    const face = (pts, n, uvs) => this.quad(pts[0], pts[1], pts[2], pts[3], n, uvs[0], uvs[1], uvs[2], uvs[3], ao(pts, n));

    if (!skip.py) {
      const pts = [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]];
      const uvs = opts.rotTop
        ? pts.map((p) => [U(-p[2]), U(p[0])])
        : pts.map((p) => [U(p[0]), U(-p[2])]);
      face(pts, [0, 1, 0], uvs);
    }
    if (!skip.ny) {
      const pts = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
      face(pts, [0, -1, 0], pts.map((p) => [U(p[0]), U(p[2])]));
    }
    if (!skip.pz) {
      const pts = [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      face(pts, [0, 0, 1], pts.map((p) => [U(p[0]), U(p[1])]));
    }
    if (!skip.nz) {
      const pts = [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]];
      face(pts, [0, 0, -1], pts.map((p) => [U(-p[0]), U(p[1])]));
    }
    if (!skip.px) {
      const pts = [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]];
      face(pts, [1, 0, 0], pts.map((p) => [U(-p[2]), U(p[1])]));
    }
    if (!skip.nx) {
      const pts = [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]];
      face(pts, [-1, 0, 0], pts.map((p) => [U(p[2]), U(p[1])]));
    }
  }

  /**
   * Merge an arbitrary BufferGeometry transformed by `matrix`.
   * uvMode 'world' re-projects UVs from world position (triplanar-ish, by dominant normal axis).
   */
  addGeometry(geo, matrix, { uvScale = [1, 1], uvMode = 'geometry', tile = 4, ao = null } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const T = g.attributes.uv;
    _nm.getNormalMatrix(matrix);
    const b = this.vertexCount;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      this.pos.push(_v.x, _v.y, _v.z);
      this.nrm.push(_n.x, _n.y, _n.z);
      if (uvMode === 'world') {
        const ax = Math.abs(_n.x);
        const ay = Math.abs(_n.y);
        const az = Math.abs(_n.z);
        if (ay >= ax && ay >= az) this.uv.push(_v.x / tile, -_v.z / tile);
        else if (ax >= az) this.uv.push((-_v.z * Math.sign(_n.x)) / tile, _v.y / tile);
        else this.uv.push((_v.x * Math.sign(_n.z)) / tile, _v.y / tile);
      } else {
        this.uv.push(T.getX(i) * uvScale[0], T.getY(i) * uvScale[1]);
      }
      const a = ao ? ao(_v.x, _v.y, _v.z, [_n.x, _n.y, _n.z]) : 1;
      this.col.push(a, a, a);
      this.idx.push(b + i);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Keeps one MeshBuilder per material key and turns them into meshes. */
export class BatchSet {
  constructor(materials) {
    this.materials = materials;
    this.builders = {};
  }
  get(key) {
    if (!this.materials[key]) throw new Error(`Unknown material "${key}"`);
    return (this.builders[key] ??= new MeshBuilder());
  }
  toMeshes({ castShadow = true, receiveShadow = true, noShadowKeys = [] } = {}) {
    const meshes = [];
    for (const [key, b] of Object.entries(this.builders)) {
      if (b.vertexCount === 0) continue;
      const mesh = new THREE.Mesh(b.build(), this.materials[key]);
      mesh.name = `batch:${key}`;
      mesh.castShadow = castShadow && !noShadowKeys.includes(key);
      mesh.receiveShadow = receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      meshes.push(mesh);
    }
    return meshes;
  }
}
