import * as THREE from 'three';
import { PIXEL_ART_GLSL, globalUniforms } from '../gfx/materials.js';

/**
 * Canal surface: MeshStandardMaterial (so torches and the moon produce real
 * specular glints) with two scrolling pixel-art normal layers.
 */
export function createWaterMaterial(normalMap) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a4a63,
    roughness: 0.1,
    metalness: 0.0,
    transparent: true,
    opacity: 0.78,
    normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    depthWrite: true,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec2 vFlowUv2;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vFlowUv2 = vNormalMapUv * vec2( 1.6, 1.25 ) + vec2( uTime * 0.018, uTime * 0.17 );
        vNormalMapUv += vec2( - uTime * 0.011, uTime * 0.105 );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFlowUv2;\n' + PIXEL_ART_GLSL)
      .replace(
        '#include <normal_fragment_maps>',
        `vec3 mapN = normalize( ( pixelArtSample( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0 ) + ( pixelArtSample( normalMap, vFlowUv2 ).xyz * 2.0 - 1.0 ) );
        mapN.xy *= normalScale;
        normal = normalize( tbn * mapN );`,
      );
  };
  mat.customProgramCacheKey = () => 'hd2d-water';
  return mat;
}

const FALL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const FALL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uPixels;
uniform float uSpeed;
uniform float uFadeStart;
uniform float uBright;
varying vec2 vUv;
float wHash( vec2 p ) { return fract( sin( dot( p, vec2( 41.3, 289.1 ) ) ) * 45758.5453 ); }
float wNoise( vec2 p ) {
	vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( wHash( i ), wHash( i + vec2( 1, 0 ) ), u.x ), mix( wHash( i + vec2( 0, 1 ) ), wHash( i + vec2( 1, 1 ) ), u.x ), u.y );
}
void main() {
	vec2 px = ( floor( vUv * uPixels ) + 0.5 ) / uPixels;
	float s = wNoise( vec2( px.x * uPixels.x * 0.45, px.y * 6.0 + uTime * uSpeed ) ) * 0.6
	        + wNoise( vec2( px.x * uPixels.x * 1.1 + 3.0, px.y * 14.0 + uTime * uSpeed * 1.6 ) ) * 0.4;
	vec3 deep = vec3( 0.03, 0.1, 0.16 );
	vec3 mid = vec3( 0.1, 0.26, 0.38 );
	vec3 foam = vec3( 0.55, 0.7, 0.82 );
	vec3 col = s > 0.7 ? foam : s > 0.5 ? mid : deep;
	float lip = smoothstep( 0.965, 1.0, px.y );
	col = mix( col, foam * 1.2, lip );
	float fade = smoothstep( 0.0, uFadeStart, px.y );
	gl_FragColor = vec4( col * uBright, 0.9 * fade );
}
`;

/** Pixel-art falling water sheet (unlit, alpha blended, fades out at the bottom). */
export const waterfallUniforms = { uBright: { value: 0.45 } };

export function createWaterfall(width, height, { pxPerUnit = 16, speed = 2.4, fadeStart = 0.55 } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uBright: waterfallUniforms.uBright,
      uTime: globalUniforms.uTime,
      uPixels: { value: new THREE.Vector2(Math.round(width * pxPerUnit), Math.round(height * pxPerUnit)) },
      uSpeed: { value: speed },
      uFadeStart: { value: fadeStart },
    },
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const geo = new THREE.PlaneGeometry(width, height);
  geo.translate(0, -height / 2, 0); // top edge at the origin
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}
