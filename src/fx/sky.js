import * as THREE from 'three';
import { globalUniforms } from '../gfx/materials.js';

/**
 * Night void around the floating diorama: gradient dome + twinkling stars.
 * Drawn at the far plane without depth writes, so the DOF treats it as
 * "infinitely far" and turns stars into soft bokeh.
 */
export function createSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: globalUniforms.uTime,
      uTop: { value: new THREE.Color(0x070b1c) },
      uHorizon: { value: new THREE.Color(0x141a36) },
      uBottom: { value: new THREE.Color(0x03040a) },
      uMoonDir: { value: new THREE.Vector3(-0.45, 0.55, -0.7).normalize() },
      uStars: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        gl_Position = vec4( p.xy, p.w * 0.99999, p.w );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uBottom;
      uniform vec3 uMoonDir;
      uniform float uStars;
      varying vec3 vDir;
      float h13( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
      void main() {
        vec3 d = normalize( vDir );
        float h = d.y;
        vec3 col = h > 0.0 ? mix( uHorizon, uTop, pow( h, 0.55 ) ) : mix( uHorizon, uBottom, pow( - h, 0.5 ) );
        float m = max( dot( d, uMoonDir ), 0.0 );
        col += vec3( 0.25, 0.32, 0.55 ) * pow( m, 12.0 ) * 0.25 + vec3( 0.9, 0.95, 1.0 ) * smoothstep( 0.9993, 0.9996, m ) * 3.0;
        vec3 sp = d * 240.0;
        vec3 cell = floor( sp );
        float r = h13( cell );
        if ( r > 0.9962 ) {
          vec3 f = fract( sp ) - 0.5;
          float tw = 0.55 + 0.45 * sin( uTime * ( 1.0 + r * 6.0 ) + r * 300.0 );
          float b = ( r - 0.9962 ) / 0.0038;
          col += vec3( 0.75, 0.82, 1.0 ) * smoothstep( 0.32, 0.0, length( f ) ) * tw * ( 0.6 + b * 2.4 ) * uStars;
        }
        gl_FragColor = vec4( col, 1.0 );
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
