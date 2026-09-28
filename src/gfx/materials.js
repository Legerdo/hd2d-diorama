import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shared shader helpers + environment material factory.
//
// "Sharp bilinear" pixel-art sampling: texels stay perfectly crisp when
// magnified, but their edges are anti-aliased over ~1 screen pixel, so the
// pixel-art textures don't shimmer as the camera moves. When a texture is
// minified the function degrades to plain trilinear/anisotropic sampling.
// ---------------------------------------------------------------------------

export const PIXEL_ART_GLSL = /* glsl */ `
vec4 pixelArtSample( sampler2D tex, vec2 uv ) {
	vec2 size = vec2( textureSize( tex, 0 ) );
	vec2 p = uv * size;
	vec2 w = max( fwidth( p ), vec2( 1e-5 ) );
	vec2 seam = floor( p + 0.5 );
	vec2 q = seam + clamp( ( p - seam ) / min( w, vec2( 1.0 ) ), -0.5, 0.5 );
	return textureGrad( tex, q / size, dFdx( uv ), dFdy( uv ) );
}
`;

/** Replace the texture2D() calls of the common map chunks with pixelArtSample(). */
export function patchPixelArtFragment(fs) {
  const C = THREE.ShaderChunk;
  return fs
    .replace('#include <common>', '#include <common>\n' + PIXEL_ART_GLSL)
    .replace('#include <map_fragment>', C.map_fragment.replace('texture2D( map, vMapUv )', 'pixelArtSample( map, vMapUv )'))
    .replace(
      '#include <normal_fragment_maps>',
      C.normal_fragment_maps.replace(/texture2D\( normalMap, vNormalMapUv \)/g, 'pixelArtSample( normalMap, vNormalMapUv )'),
    )
    .replace(
      '#include <emissivemap_fragment>',
      C.emissivemap_fragment.replace('texture2D( emissiveMap, vEmissiveMapUv )', 'pixelArtSample( emissiveMap, vEmissiveMapUv )'),
    );
}

/** Global uniforms shared by animated materials. */
export const globalUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(1, 0.3) },
};

/**
 * Environment material: MeshStandardMaterial + pixel-art sampling, vertex AO
 * (stored in the colour attribute) and optional emissive.
 */
export function envMaterial(tex, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
    roughness: opts.roughness ?? 0.88,
    metalness: opts.metalness ?? 0,
    color: opts.color ?? 0xffffff,
    vertexColors: opts.vertexColors ?? true,
    emissiveMap: tex.emissiveMap ?? null,
    emissive: tex.emissiveMap ? new THREE.Color(opts.emissive ?? 0xffffff) : new THREE.Color(0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = patchPixelArtFragment(shader.fragmentShader);
  };
  mat.customProgramCacheKey = () => 'hd2d-env';
  return mat;
}
