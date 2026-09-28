import * as THREE from 'three';
import { createSpriteMaterial, createBillboardMesh, createBlobShadow } from '../gfx/billboard.js';
import { SHEET_COLS, SHEET_ROWS, DIR_ROW, ANIM, FRAME_PX } from '../gfx/spriteArt.js';
import { RNG } from '../util/rng.js';

export const SPRITE_PX_PER_UNIT = 18;

/** Animated, shadow-casting billboard character. */
export class Actor {
  constructor(map, art, { name, x, z, speed = 1.9, emissiveIntensity = 2.5, blobTex, blobSize = [0.95, 0.42] }) {
    this.name = name;
    this.map = map;
    this.x = x;
    this.z = z;
    this.y = map.groundHeight(x, z) ?? 0;
    this.jumpY = 0;
    this.vy = 0;
    this.speed = speed;
    this.dir = 'down';
    this.moving = false;
    this.animTime = Math.random() * 3;
    this.vel = new THREE.Vector2();

    this.tex = art.map.clone();
    this.tex.needsUpdate = true;
    this.emTex = art.emissiveMap.clone();
    this.emTex.needsUpdate = true;
    const size = FRAME_PX / SPRITE_PX_PER_UNIT;
    this.material = createSpriteMaterial({
      map: this.tex,
      emissiveMap: this.emTex,
      emissive: 0xffffff,
      emissiveIntensity,
      rim: 1.5,
      wrap: 0.65,
      shadowPull: 0.12,
    });
    this.mesh = createBillboardMesh(this.material, size, size);
    this.mesh.name = `actor:${name}`;
    this.blobSize = blobSize;
    this.blob = createBlobShadow(blobTex, blobSize[0], blobSize[1], 0.55);
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.blob);
    this.setFrame(0, 'down');
    this.sync();
  }

  setFrame(col, dir) {
    const row = DIR_ROW[dir];
    const flip = dir === 'right';
    const fw = 1 / SHEET_COLS;
    const fh = 1 / SHEET_ROWS;
    for (const t of [this.tex, this.emTex]) {
      t.repeat.set(flip ? -fw : fw, fh);
      t.offset.set(flip ? (col + 1) * fw : col * fw, 1 - (row + 1) * fh);
    }
  }

  /** Try to move by (dx, dz) with axis-separated sliding collision. */
  tryMove(dx, dz) {
    let moved = false;
    if (dx !== 0 && this.map.canStand(this.x + dx, this.z, this.y)) {
      this.x += dx;
      moved = true;
    }
    if (dz !== 0 && this.map.canStand(this.x, this.z + dz, this.y)) {
      this.z += dz;
      moved = true;
    }
    return moved;
  }

  /** dirWorld: desired unit direction (x, z) or null; camera basis for choosing the sprite row. */
  step(dt, dirWorld, speed, camRight, camFwd) {
    this.moving = false;
    if (dirWorld && (dirWorld.x !== 0 || dirWorld.y !== 0)) {
      const moved = this.tryMove(dirWorld.x * speed * dt, dirWorld.y * speed * dt);
      this.moving = moved;
      const sx = dirWorld.x * camRight.x + dirWorld.y * camRight.z;
      const sz = dirWorld.x * camFwd.x + dirWorld.y * camFwd.z;
      if (Math.abs(sx) > Math.abs(sz) * 0.9) this.dir = sx < 0 ? 'left' : 'right';
      else this.dir = sz > 0 ? 'up' : 'down';
      this.curSpeed = speed;
    }
    const gy = this.map.groundHeight(this.x, this.z) ?? this.y;
    this.y += (gy - this.y) * Math.min(1, dt * 18);
    if (this.jumpY > 0 || this.vy > 0) {
      this.vy -= 22 * dt;
      this.jumpY = Math.max(0, this.jumpY + this.vy * dt);
      if (this.jumpY === 0) this.vy = 0;
    }
    this.animate(dt);
    this.sync();
  }

  jump() {
    if (this.jumpY === 0) this.vy = 6.2;
  }

  animate(dt) {
    this.animTime += dt;
    let col;
    if (this.jumpY > 0.02) {
      col = ANIM.walk[1];
    } else if (this.moving) {
      const fps = 3.2 * (this.curSpeed ?? this.speed);
      col = ANIM.walk[Math.floor(this.animTime * fps) % ANIM.walk.length];
    } else {
      col = ANIM.idle[Math.floor(this.animTime * 1.6) % ANIM.idle.length];
    }
    this.setFrame(col, this.dir);
  }

  sync() {
    this.mesh.position.set(this.x, this.y + this.jumpY, this.z);
    this.blob.position.set(this.x, this.y + 0.02, this.z);
    const s = 1 / (1 + this.jumpY * 0.6);
    this.blob.scale.set(this.blobSize[0] * s, 1, this.blobSize[1] * s);
    this.blob.material.opacity = 0.55 * s;
  }
}

/** Walks between random points of a region, pausing in between. */
export class Wanderer {
  constructor(actor, region, seed, { speed = 1.4, pause = [1.5, 4] } = {}) {
    this.a = actor;
    this.region = region;
    this.rng = new RNG(seed);
    this.speed = speed;
    this.pause = pause;
    this.wait = this.rng.float(0.5, 2);
    this.target = null;
    this.stuck = 0;
  }
  update(dt, camRight, camFwd) {
    const a = this.a;
    let dir = null;
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) this.target = a.map.randomPoint(this.rng, this.region, a.y);
    } else if (this.target) {
      const dx = this.target.x - a.x;
      const dz = this.target.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) {
        this.target = null;
        this.wait = this.rng.float(...this.pause);
      } else {
        dir = new THREE.Vector2(dx / d, dz / d);
      }
    } else {
      this.wait = this.rng.float(...this.pause);
    }
    const px = a.x;
    const pz = a.z;
    a.step(dt, dir, this.speed, camRight, camFwd);
    if (dir && Math.hypot(a.x - px, a.z - pz) < this.speed * dt * 0.3) {
      this.stuck += dt;
      if (this.stuck > 0.4) {
        this.target = null;
        this.wait = this.rng.float(0.3, 1);
        this.stuck = 0;
      }
    } else this.stuck = 0;
  }
}

/** Loops through waypoints (patrol / errand). */
export class Patrol {
  constructor(actor, points, { speed = 1.3, pause = 2.2, faceOnPause = 'down' } = {}) {
    this.a = actor;
    this.points = points;
    this.i = 0;
    this.speed = speed;
    this.pause = pause;
    this.wait = 1;
    this.faceOnPause = faceOnPause;
  }
  update(dt, camRight, camFwd) {
    const a = this.a;
    let dir = null;
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.faceOnPause) a.dir = this.faceOnPause;
    } else {
      const p = this.points[this.i];
      const dx = p.x - a.x;
      const dz = p.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.12) {
        this.i = (this.i + 1) % this.points.length;
        this.wait = p.pause ?? this.pause;
      } else dir = new THREE.Vector2(dx / d, dz / d);
    }
    a.step(dt, dir, this.speed, camRight, camFwd);
  }
}

/** Keeps a comfortable distance behind a leader (the cat). */
export class Follower {
  constructor(actor, leader, { near = 1.3, far = 3.2, walk = 1.8, run = 3.6 } = {}) {
    Object.assign(this, { a: actor, leader, near, far, walk, run });
  }
  update(dt, camRight, camFwd) {
    const a = this.a;
    const dx = this.leader.x - a.x;
    const dz = this.leader.z - a.z;
    const d = Math.hypot(dx, dz);
    let dir = null;
    let speed = this.walk;
    if (d > this.near) {
      dir = new THREE.Vector2(dx / d, dz / d);
      speed = d > this.far ? this.run : this.walk;
    }
    const px = a.x;
    const pz = a.z;
    a.step(dt, dir, speed, camRight, camFwd);
    // hop around obstacles by trying a perpendicular direction when stuck
    if (dir && Math.hypot(a.x - px, a.z - pz) < speed * dt * 0.2) {
      const perp = new THREE.Vector2(-dir.y, dir.x);
      a.tryMove(perp.x * speed * dt, perp.y * speed * dt);
      a.sync();
    }
  }
}
