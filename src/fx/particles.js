import * as THREE from 'three';
import { globalUniforms } from '../gfx/materials.js';

// GPU-animated particles (no per-frame CPU work): positions are a pure
// function of time + per-particle seeds.

export const particleUniforms = {
  uScale: { value: 800 }, // drawing-buffer height / (2 tan(fov/2)); set by main on resize
};

function pointsFrom(attrs, count, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  for (const [name, [arr, size]] of Object.entries(attrs)) g.setAttribute(name, new THREE.Float32BufferAttribute(arr, size));
  const pts = new THREE.Points(g, material);
  pts.frustumCulled = false;
  return pts;
}

/** Rising sparks. emitters: [{ position: Vector3, count, spread, rise, life }] */
export function createEmbers(emitters, rng) {
  const total = emitters.reduce((s, e) => s + e.count, 0);
  const aEmitter = new Float32Array(total * 3);
  const aParams = new Float32Array(total * 4);
  let k = 0;
  for (const e of emitters) {
    for (let i = 0; i < e.count; i++, k++) {
      aEmitter.set([e.position.x + rng.float(-0.08, 0.08), e.position.y, e.position.z + rng.float(-0.08, 0.08)], k * 3);
      aParams.set([rng.next(), (e.life ?? 1.8) * rng.float(0.6, 1.3), e.spread ?? 0.35, (e.rise ?? 1.6) * rng.float(0.7, 1.3)], k * 4);
    }
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: globalUniforms.uTime,
      uScale: particleUniforms.uScale,
      uWind: globalUniforms.uWind,
      uColorA: { value: new THREE.Vector3(9.0, 5.2, 1.6) },
      uColorB: { value: new THREE.Vector3(3.0, 0.5, 0.08) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aEmitter;
      attribute vec4 aParams;
      uniform float uTime;
      uniform float uScale;
      uniform vec2 uWind;
      varying float vAge;
      varying float vSeed;
      void main() {
        float seed = aParams.x;
        float age = fract( uTime / aParams.y + seed );
        float s = seed * 91.7;
        vec3 p = aEmitter;
        p.y += age * aParams.w + age * age * 0.25;
        p.x += ( sin( s + age * 7.0 + uTime * 0.7 ) * 0.5 + ( fract( s * 1.37 ) - 0.5 ) ) * aParams.z * age + uWind.x * age * 0.25;
        p.z += ( cos( s * 1.3 + age * 5.0 ) * 0.5 + ( fract( s * 2.11 ) - 0.5 ) ) * aParams.z * age + uWind.y * age * 0.25;
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max( 1.5, mix( 0.075, 0.035, age ) * uScale / - mv.z );
        vAge = age;
        vSeed = seed;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying float vAge;
      varying float vSeed;
      void main() {
        float flick = 0.55 + 0.45 * sin( uTime * 23.0 + vSeed * 60.0 );
        vec3 col = mix( uColorA, uColorB, smoothstep( 0.0, 0.7, vAge ) ) * pow( 1.0 - vAge, 1.5 ) * flick;
        gl_FragColor = vec4( col, 1.0 );
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const pts = pointsFrom({ aEmitter: [aEmitter, 3], aParams: [aParams, 4] }, total, mat);
  pts.renderOrder = 4;
  return pts;
}

/** Slowly wandering, blinking fireflies around anchor points. */
export function createFireflies(anchors, rng) {
  const total = anchors.reduce((s, a) => s + a.count, 0);
  const aAnchor = new Float32Array(total * 3);
  const aParams = new Float32Array(total * 4);
  let k = 0;
  for (const a of anchors) {
    for (let i = 0; i < a.count; i++, k++) {
      aAnchor.set([a.position.x, a.position.y, a.position.z], k * 3);
      aParams.set([rng.next() * 100, a.radius ?? 1.5, rng.float(0.5, 1.4), rng.float(0.6, 1.6)], k * 4);
    }
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: globalUniforms.uTime,
      uScale: particleUniforms.uScale,
      uColor: { value: new THREE.Vector3(2.6, 3.6, 0.9) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aAnchor;
      attribute vec4 aParams;
      uniform float uTime;
      uniform float uScale;
      varying float vBlink;
      void main() {
        float s = aParams.x;
        float r = aParams.y;
        float sp = aParams.z;
        float t = uTime * sp;
        vec3 p = aAnchor + vec3(
          sin( t * 0.31 + s ) * r + sin( t * 0.83 + s * 1.7 ) * 0.3 * r,
          sin( t * 0.47 + s * 2.3 ) * 0.35 + 0.45 + sin( t * 1.3 + s ) * 0.1,
          cos( t * 0.27 + s * 1.1 ) * r * 0.8 + cos( t * 0.71 + s * 0.3 ) * 0.25 * r );
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max( 2.0, 0.11 * uScale / - mv.z );
        vBlink = smoothstep( 0.15, 1.0, sin( uTime * aParams.w + s * 7.0 ) * 0.5 + 0.5 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vBlink;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length( c ) * 2.0;
        float a = smoothstep( 1.0, 0.0, d );
        a *= a;
        gl_FragColor = vec4( uColor * a * vBlink, 1.0 );
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const pts = pointsFrom({ aAnchor: [aAnchor, 3], aParams: [aParams, 4] }, total, mat);
  pts.renderOrder = 4;
  return pts;
}

/** Soft chimney smoke (alpha blended, faintly moonlit). */
export function createSmoke(position, count, rng) {
  const aParams = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) aParams.set([rng.next(), rng.float(5, 7.5), rng.next(), rng.next()], i * 4);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: globalUniforms.uTime,
      uScale: particleUniforms.uScale,
      uWind: globalUniforms.uWind,
      uOrigin: { value: position.clone() },
      uColor: { value: new THREE.Vector3(0.1, 0.11, 0.15) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aParams;
      uniform float uTime;
      uniform float uScale;
      uniform vec2 uWind;
      uniform vec3 uOrigin;
      varying float vAge;
      void main() {
        float age = fract( uTime / aParams.y + aParams.x );
        vec3 p = uOrigin;
        p.y += age * 3.2;
        p.x += uWind.x * age * age * 2.2 + sin( age * 6.0 + aParams.z * 10.0 ) * 0.15 * age;
        p.z += uWind.y * age * age * 2.2 + cos( age * 5.0 + aParams.w * 10.0 ) * 0.15 * age;
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mv;
        gl_PointSize = mix( 0.35, 1.5, age ) * uScale / - mv.z;
        vAge = age;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAge;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length( c ) * 2.0;
        float a = smoothstep( 1.0, 0.2, d ) * smoothstep( 0.0, 0.12, vAge ) * ( 1.0 - vAge ) * 0.32;
        gl_FragColor = vec4( uColor, a );
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const pts = pointsFrom({ aParams: [aParams, 4] }, count, mat);
  pts.renderOrder = 5;
  return pts;
}
