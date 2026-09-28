import * as THREE from 'three';
import { BILLBOARD_QUAD } from '../gfx/billboard.js';
import { globalUniforms } from '../gfx/materials.js';

// Pixelated procedural flame on a camera-aligned quad. Emits HDR colours
// (additive) so the bloom pass turns it into a glowing light source.

const NOISE_GLSL = /* glsl */ `
float fHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float fNoise( vec2 p ) {
	vec2 i = floor( p ); vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( fHash( i ), fHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( fHash( i + vec2( 0.0, 1.0 ) ), fHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
`;

const VERT = /* glsl */ `
uniform vec2 uSize;
varying vec2 vUv;
void main() {
	vec3 center = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
	vec3 right = normalize( vec3( viewMatrix[ 0 ][ 0 ], 0.0, viewMatrix[ 2 ][ 0 ] ) );
	vec3 wp = center + right * ( position.x * uSize.x ) + vec3( 0.0, position.y * uSize.y, 0.0 );
	// nudge toward the camera so the flame never z-fights with its holder
	vec3 toCam = normalize( cameraPosition - center );
	wp += toCam * 0.05;
	vUv = uv;
	gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}
`;

const FLAME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
uniform vec2 uPixels;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uOuter;
uniform vec3 uEdge;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
	vec2 uv = ( floor( vUv * uPixels ) + 0.5 ) / uPixels;
	float t = uTime;
	float n = fNoise( vec2( uv.x * 5.0 + uSeed, uv.y * 4.0 - t * 4.3 ) ) * 0.6
	        + fNoise( vec2( uv.x * 11.0 - uSeed, uv.y * 9.0 - t * 7.5 ) ) * 0.4;
	float y = uv.y;
	float x = ( uv.x - 0.5 ) * 2.0;
	x += ( fNoise( vec2( y * 2.5 - t * 2.2, uSeed * 3.0 ) ) - 0.5 ) * 0.7 * y;
	float width = ( 1.0 - pow( y, 1.3 ) ) * ( 0.6 + 0.4 * ( 1.0 - y ) );
	float heat = ( width - abs( x ) ) * 1.7 + ( n - 0.5 ) * 0.95 - y * 0.35;
	heat *= uIntensity;
	if ( heat < 0.1 ) discard;
	vec3 col = heat > 0.78 ? uCore : heat > 0.52 ? uMid : heat > 0.3 ? uOuter : uEdge;
	gl_FragColor = vec4( col, 1.0 );
}
`;

const GLOW_FRAG = /* glsl */ `
uniform float uIntensity;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
	vec2 d = ( vUv - vec2( 0.5, 0.45 ) ) * vec2( 2.0, 2.0 );
	float r2 = dot( d, d );
	float g = exp( - r2 * 3.2 ) * ( 1.0 - smoothstep( 0.6, 1.0, r2 ) );
	gl_FragColor = vec4( uColor * g * uIntensity, 1.0 );
}
`;

export const FLAME_PRESETS = {
  torch: {
    size: [0.42, 0.62], pixels: [7, 11],
    core: [7.5, 6.0, 3.2], mid: [5.5, 2.6, 0.7], outer: [3.2, 0.95, 0.18], edge: [1.2, 0.24, 0.05],
    glow: [1.0, 0.45, 0.15], glowSize: [2.4, 2.4], glowIntensity: 0.22,
  },
  campfire: {
    size: [0.95, 1.25], pixels: [12, 16],
    core: [8.0, 6.4, 3.4], mid: [6.0, 2.8, 0.75], outer: [3.5, 1.0, 0.2], edge: [1.4, 0.28, 0.06],
    glow: [1.0, 0.42, 0.12], glowSize: [4.6, 4.2], glowIntensity: 0.26,
  },
  lamp: {
    size: [0.22, 0.3], pixels: [4, 6],
    core: [9.0, 7.5, 4.2], mid: [6.5, 3.4, 1.0], outer: [3.5, 1.3, 0.3], edge: [1.4, 0.4, 0.1],
    glow: [1.0, 0.55, 0.22], glowSize: [2.2, 2.2], glowIntensity: 0.2,
  },
};

export class Flame {
  constructor(preset = 'torch', seed = Math.random() * 100) {
    const P = FLAME_PRESETS[preset];
    this.group = new THREE.Group();
    this.baseSize = new THREE.Vector2(...P.size);
    this.flameMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: globalUniforms.uTime,
        uSeed: { value: seed },
        uIntensity: { value: 1 },
        uPixels: { value: new THREE.Vector2(...P.pixels) },
        uSize: { value: this.baseSize.clone() },
        uCore: { value: new THREE.Vector3(...P.core) },
        uMid: { value: new THREE.Vector3(...P.mid) },
        uOuter: { value: new THREE.Vector3(...P.outer) },
        uEdge: { value: new THREE.Vector3(...P.edge) },
      },
      vertexShader: VERT,
      fragmentShader: FLAME_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.flame = new THREE.Mesh(BILLBOARD_QUAD, this.flameMat);
    this.flame.frustumCulled = false;
    this.flame.renderOrder = 3;

    this.glowMat = new THREE.ShaderMaterial({
      uniforms: {
        uIntensity: { value: P.glowIntensity },
        uColor: { value: new THREE.Vector3(...P.glow) },
        uSize: { value: new THREE.Vector2(...P.glowSize) },
      },
      vertexShader: VERT,
      fragmentShader: GLOW_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.glowBase = P.glowIntensity;
    this.glow = new THREE.Mesh(BILLBOARD_QUAD, this.glowMat);
    this.glow.position.y = -P.glowSize[1] * 0.4;
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 2;
    this.group.add(this.glow, this.flame);
  }

  /** f ~ 1 +/- flicker */
  setIntensity(f, glowScale = 1) {
    this.flameMat.uniforms.uIntensity.value = 0.85 + 0.25 * f;
    this.flameMat.uniforms.uSize.value.set(this.baseSize.x * (0.92 + 0.08 * f), this.baseSize.y * (0.85 + 0.2 * f));
    this.glowMat.uniforms.uIntensity.value = this.glowBase * f * glowScale;
  }
}
