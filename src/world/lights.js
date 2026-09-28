import * as THREE from 'three';
import { Flame } from '../fx/flame.js';
import { noise1 } from '../util/rng.js';

/** Flickering fire light: pixel flame + glow halo + (optionally shadowed) point light. */
export class Torch {
  constructor({
    position,
    lightOffset = [0, 0.12, 0],
    preset = 'torch',
    color = 0xff8a3d,
    intensity = 14,
    distance = 11,
    castShadow = true,
    mapSize = 512,
    seed = 1,
  }) {
    this.seed = seed;
    this.object = new THREE.Group();
    this.flame = new Flame(preset, seed * 7.13);
    this.flame.group.position.copy(position);
    this.basePos = position.clone().add(new THREE.Vector3(...lightOffset));
    this.baseIntensity = intensity;
    this.light = new THREE.PointLight(color, intensity, distance, 2);
    this.light.position.copy(this.basePos);
    this.light.castShadow = castShadow;
    if (castShadow) {
      this.light.shadow.mapSize.set(mapSize, mapSize);
      this.light.shadow.camera.near = 0.12;
      this.light.shadow.bias = -0.0015;
      this.light.shadow.normalBias = 0.035;
      this.light.shadow.radius = 2.2;
    }
    this.object.add(this.flame.group, this.light);
  }

  update(t, p) {
    const n = noise1(t * 7.3, this.seed) * 0.6 + noise1(t * 17.9, this.seed + 9) * 0.4;
    const f = 1 + (n - 0.5) * 2 * 0.24 * p.flicker;
    this.light.intensity = this.baseIntensity * p.torchIntensity * f;
    const j = 0.05 * p.flicker;
    this.light.position.set(
      this.basePos.x + (noise1(t * 3.1, this.seed + 1) - 0.5) * j,
      this.basePos.y + (noise1(t * 2.7, this.seed + 2) - 0.5) * j,
      this.basePos.z + (noise1(t * 3.4, this.seed + 3) - 0.5) * j,
    );
    this.flame.setIntensity(f, p.torchIntensity);
  }
}

/** Moonlight + sky/ground ambient. */
export function createAmbientLights() {
  const moon = new THREE.DirectionalLight(0x9fb3ff, 0.85);
  moon.position.set(-13, 24, -15);
  moon.target.position.set(0, 0, 0);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const c = moon.shadow.camera;
  c.left = -21;
  c.right = 21;
  c.top = 19;
  c.bottom = -19;
  c.near = 4;
  c.far = 70;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.03;
  moon.shadow.radius = 1.8;
  const hemi = new THREE.HemisphereLight(0x3a4d85, 0x1c1410, 0.75);
  return { moon, hemi };
}
