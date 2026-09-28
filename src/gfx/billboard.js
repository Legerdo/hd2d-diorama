import * as THREE from 'three';
import { patchPixelArtFragment, globalUniforms } from './materials.js';

// ---------------------------------------------------------------------------
// HD-2D billboard sprites.
//
//  Main pass   : cylindrical billboard aligned with the camera's view plane
//                (all sprites stay parallel, like paper cut-outs).
//  Shadow pass : the same quad is re-oriented to face each light (directional
//                -> light direction, point light -> light position), so the
//                cast shadow is always a full silhouette instead of collapsing
//                into a line when the light is off to the side.
//  Receiving   : shadow lookups are done on the sprite's vertical centre line
//                (pulled slightly toward the light). The caster plane passes
//                through that line, so the sprite never self-shadows, yet it
//                still darkens when a wall/tree/other sprite blocks the light.
//  Lighting    : wrapped Lambert + a per-light rim term on silhouette edges that
//                face the light (torches behind a character outline it).
//
//  Meshes must not be rotated; size comes from mesh.scale = (w, h, w).
// ---------------------------------------------------------------------------

/** Unit quad, pivot at bottom centre: x in [-0.5, 0.5], y in [0, 1]. */
export const BILLBOARD_QUAD = (() => {
  const g = new THREE.PlaneGeometry(1, 1);
  g.translate(0, 0.5, 0);
  return g;
})();

const VERT_PARS = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uSway;
uniform float uLean;
uniform float uShadowPull;
uniform float uNormalUp;
#ifdef SPRITE_ATLAS
attribute float aVariant;
#endif

vec3 sprCenterWorld() {
	vec4 c = vec4( 0.0, 0.0, 0.0, 1.0 );
	#ifdef USE_INSTANCING
		c = instanceMatrix * c;
	#endif
	return ( modelMatrix * c ).xyz;
}

vec3 sprSway( vec3 center, float h ) {
	float ph = dot( center.xz, vec2( 0.73, 0.41 ) );
	float s = sin( uTime * 1.7 + ph ) * 0.65 + sin( uTime * 3.1 + ph * 1.9 ) * 0.35;
	return vec3( uWind.x, 0.0, uWind.y ) * ( s * uSway * h * h );
}
`;

const MAIN_BEGINNORMAL = /* glsl */ `
vec3 sprCenter = sprCenterWorld();
vec3 sprRight = normalize( vec3( viewMatrix[ 0 ][ 0 ], 0.0, viewMatrix[ 2 ][ 0 ] ) );
vec3 sprN = vec3( - sprRight.z, 0.0, sprRight.x );
// lighting normal leans toward +Y so sprites pick up moon/sky light like the ground they stand on
vec3 objectNormal = normalize( mix( sprN, vec3( 0.0, 1.0, 0.0 ), uNormalUp ) );
#ifdef USE_TANGENT
	vec3 objectTangent = sprRight;
#endif
`;

const MAIN_BEGIN = /* glsl */ `
vec3 transformed = sprRight * position.x + vec3( 0.0, position.y, 0.0 ) + sprN * ( position.y * uLean );
transformed += sprSway( sprCenter, position.y );
#ifdef USE_ALPHAHASH
	vPosition = transformed;
#endif
`;

const MAIN_SHADOW_CENTERLINE = /* glsl */ `
#if defined( USE_SHADOWMAP ) && defined( SPRITE_CENTERLINE_SHADOW )
{
	vec3 sprSP = vec3( sprCenter.x, worldPosition.y, sprCenter.z );
	#if NUM_DIR_LIGHT_SHADOWS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		{
			vec3 sprG = vec3( directionalShadowMatrix[ i ][ 0 ][ 2 ], directionalShadowMatrix[ i ][ 1 ][ 2 ], directionalShadowMatrix[ i ][ 2 ][ 2 ] );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * vec4( sprSP - normalize( sprG ) * uShadowPull, 1.0 );
		}
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		{
			vec4 sprLP = pointShadowMatrix[ i ] * vec4( sprSP, 1.0 );
			sprLP.xyz -= normalize( sprLP.xyz ) * uShadowPull;
			vPointShadowCoord[ i ] = sprLP;
		}
	}
	#pragma unroll_loop_end
	#endif
}
#endif
`;

const ATLAS_UV = /* glsl */ `
#include <uv_vertex>
#if defined( SPRITE_ATLAS ) && defined( USE_MAP )
	vMapUv = ( mapTransform * vec3( ( uv.x + aVariant ) / SPRITE_ATLAS, uv.y, 1.0 ) ).xy;
#endif
`;

const SHADOW_BEGIN = /* glsl */ `
vec3 sprCenter = sprCenterWorld();
vec3 sprToL;
if ( isPerspectiveMatrix( projectionMatrix ) ) {
	sprToL = cameraPosition - sprCenter; // point / spot light: face the light position
} else {
	sprToL = vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] ); // directional: face the light direction
}
sprToL.y = 0.0;
float sprLen = length( sprToL );
vec3 sprN = sprLen > 1e-4 ? sprToL / sprLen : vec3( 0.0, 0.0, 1.0 );
vec3 sprRight = vec3( sprN.z, 0.0, - sprN.x );
vec3 transformed = sprRight * position.x + vec3( 0.0, position.y, 0.0 );
transformed += sprSway( sprCenter, position.y );
`;

const FRAG_PARS = /* glsl */ `
uniform float uRim;
uniform float uWrap;
vec4 sprEdge = vec4( 0.0 );
`;

const FRAG_EDGES = /* glsl */ `
#include <map_fragment>
#ifdef USE_MAP
{
	vec2 ts = 1.0 / vec2( textureSize( map, 0 ) );
	vec2 c = ( floor( vMapUv / ts ) + 0.5 ) * ts;
	float sx = dFdx( vMapUv.x ) < 0.0 ? - 1.0 : 1.0;
	float sy = dFdy( vMapUv.y ) < 0.0 ? - 1.0 : 1.0;
	vec2 dx = vec2( ts.x * sx, 0.0 );
	vec2 dy = vec2( 0.0, ts.y * sy );
	vec4 e1 = 1.0 - vec4( texture2D( map, c - dx ).a, texture2D( map, c + dx ).a, texture2D( map, c + dy ).a, texture2D( map, c - dy ).a );
	vec4 e2 = 1.0 - vec4( texture2D( map, c - 2.0 * dx ).a, texture2D( map, c + 2.0 * dx ).a, texture2D( map, c + 2.0 * dy ).a, texture2D( map, c - 2.0 * dy ).a );
	sprEdge = max( e1, e2 * 0.55 );
}
#endif
`;

const FRAG_LAMBERT = /* glsl */ `
varying vec3 vViewPosition;

struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};

void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float ndl = dot( geometryNormal, directLight.direction );
	float wrapped = saturate( ( ndl + uWrap ) / ( 1.0 + uWrap ) );
	reflectedLight.directDiffuse += wrapped * directLight.color * BRDF_Lambert( material.diffuseColor );
	vec3 L = directLight.direction;
	float edge = sprEdge.x * saturate( - L.x ) + sprEdge.y * saturate( L.x ) + sprEdge.z * saturate( L.y ) + sprEdge.w * saturate( - L.y ) * 0.25;
	float back = saturate( 0.3 - ndl );
	reflectedLight.directDiffuse += directLight.color * ( edge * back * uRim ) * RECIPROCAL_PI * ( 0.3 + material.diffuseColor );
}

void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}

#define RE_Direct RE_Direct_Lambert
#define RE_IndirectDiffuse RE_IndirectDiffuse_Lambert
`;

function patchMainVertex(vs) {
  return vs
    .replace('#include <common>', '#include <common>\n' + VERT_PARS)
    .replace('#include <uv_vertex>', ATLAS_UV)
    .replace('#include <beginnormal_vertex>', MAIN_BEGINNORMAL)
    .replace('#include <begin_vertex>', MAIN_BEGIN)
    .replace('#include <shadowmap_vertex>', '#include <shadowmap_vertex>\n' + MAIN_SHADOW_CENTERLINE);
}

function patchMainFragment(fs) {
  fs = fs.replace('#include <common>', '#include <common>\n' + FRAG_PARS);
  fs = fs.replace('#include <lights_lambert_pars_fragment>', FRAG_LAMBERT);
  fs = fs.replace('#include <map_fragment>', FRAG_EDGES);
  return patchPixelArtFragment(fs);
}

function patchShadowVertex(vs) {
  return vs
    .replace('#include <common>', '#include <common>\n' + VERT_PARS)
    .replace('#include <uv_vertex>', ATLAS_UV)
    .replace('#include <begin_vertex>', SHADOW_BEGIN);
}

/**
 * @param {object} o
 * @param {THREE.Texture} o.map sprite texture (alpha-tested)
 * @param {THREE.Texture} [o.emissiveMap]
 * @param {number} [o.rim]   rim light strength
 * @param {number} [o.wrap]  wrap-lighting amount (0 = plain Lambert)
 * @param {number} [o.sway]  wind sway amplitude (object units at the top)
 * @param {number} [o.atlas] number of horizontal atlas cells (uses aVariant attribute)
 */
export function createSpriteMaterial({
  map,
  emissiveMap = null,
  emissive = 0x000000,
  emissiveIntensity = 1,
  rim = 1.4,
  wrap = 0.6,
  lean = 0,
  sway = 0,
  shadowPull = 0.14,
  centerlineShadow = true,
  atlas = 0,
  color = 0xffffff,
  normalUp = 0.3,
}) {
  const uniforms = {
    uRim: { value: rim },
    uWrap: { value: wrap },
    uLean: { value: lean },
    uSway: { value: sway },
    uShadowPull: { value: shadowPull },
    uNormalUp: { value: normalUp },
  };
  const mat = new THREE.MeshLambertMaterial({
    map,
    color,
    alphaTest: 0.5,
    emissiveMap,
    emissive: new THREE.Color(emissiveMap ? emissive : 0x000000),
    emissiveIntensity,
  });
  mat.shadowSide = THREE.DoubleSide;
  mat.defines = {};
  if (centerlineShadow) mat.defines.SPRITE_CENTERLINE_SHADOW = '';
  if (atlas) mat.defines.SPRITE_ATLAS = atlas.toFixed(1);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uTime: globalUniforms.uTime, uWind: globalUniforms.uWind });
    shader.vertexShader = patchMainVertex(shader.vertexShader);
    shader.fragmentShader = patchMainFragment(shader.fragmentShader);
  };
  mat.customProgramCacheKey = () => 'hd2d-sprite';
  mat.userData.spriteUniforms = uniforms;
  return mat;
}

/** Light-facing depth (directional/spot) + distance (point) materials for a sprite material. */
export function createSpriteShadowMaterials(spriteMat) {
  const u = spriteMat.userData.spriteUniforms;
  const defines = { ...spriteMat.defines };
  delete defines.SPRITE_CENTERLINE_SHADOW;
  const patch = (shader) => {
    Object.assign(shader.uniforms, {
      uSway: u.uSway,
      uLean: u.uLean,
      uShadowPull: u.uShadowPull,
      uTime: globalUniforms.uTime,
      uWind: globalUniforms.uWind,
    });
    shader.vertexShader = patchShadowVertex(shader.vertexShader);
  };
  const depth = new THREE.MeshDepthMaterial();
  depth.defines = { ...defines };
  depth.onBeforeCompile = patch;
  depth.customProgramCacheKey = () => 'hd2d-sprite-depth';
  const dist = new THREE.MeshDistanceMaterial();
  dist.defines = { ...defines };
  dist.onBeforeCompile = patch;
  dist.customProgramCacheKey = () => 'hd2d-sprite-dist';
  return { depth, dist };
}

/** A billboard mesh with light-facing shadow casters attached. */
export function createBillboardMesh(material, width, height, { castShadow = true, receiveShadow = true } = {}) {
  const mesh = new THREE.Mesh(BILLBOARD_QUAD, material);
  mesh.scale.set(width, height, width);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  if (castShadow) {
    const { depth, dist } = createSpriteShadowMaterials(material);
    mesh.customDepthMaterial = depth;
    mesh.customDistanceMaterial = dist;
  }
  return mesh;
}

let blobGeo = null;

/** Soft contact shadow decal (keeps sprites grounded even when real shadows point away). */
export function createBlobShadow(alphaTex, width, depth, opacity = 0.5) {
  if (!blobGeo) {
    blobGeo = new THREE.PlaneGeometry(1, 1);
    blobGeo.rotateX(-Math.PI / 2);
  }
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: alphaTex,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const m = new THREE.Mesh(blobGeo, mat);
  m.scale.set(width, 1, depth);
  m.renderOrder = 1;
  return m;
}
