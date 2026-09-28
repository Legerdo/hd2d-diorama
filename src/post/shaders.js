// Post-processing GLSL. Written GLSL1-style (texture2D / gl_FragColor); three.js
// compiles ShaderMaterials as GLSL ES 3.00, so textureLod etc. are available.

export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = position.xy * 0.5 + 0.5;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

/** Circle-of-confusion model shared by the prefilter and the composite pass. */
export const COC_GLSL = /* glsl */ `
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uFocusRange;
uniform float uNearRamp;
uniform float uFarRamp;
uniform float uTiltMix;
uniform float uTiltCenter;
uniform float uTiltWidth;
uniform float uTiltSoft;

float linearDist( float d ) {
	return ( uNear * uFar ) / ( uFar - d * ( uFar - uNear ) );
}

// signed CoC in [-1, 1]: negative = in front of the focus plane, positive = behind
float cocFor( vec2 uv, float dist ) {
	float df = dist - uFocus;
	float c = df > 0.0
		? smoothstep( uFocusRange, uFocusRange + uFarRamp, df )
		: - smoothstep( uFocusRange, uFocusRange + uNearRamp, - df );
	// tilt-shift: a horizontal band of focus in screen space (miniature look)
	float ty = uv.y - uTiltCenter;
	float t = sign( ty ) * smoothstep( uTiltWidth, uTiltWidth + uTiltSoft, abs( ty ) );
	return clamp( mix( c, t, uTiltMix ), - 1.0, 1.0 );
}
`;

/** Full-res colour + depth -> half-res colour with signed CoC in alpha. */
export const PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uSrcTexel;
varying vec2 vUv;
${COC_GLSL}
void main() {
	vec2 o = uSrcTexel * 0.5;
	float d0 = texture2D( tDepth, vUv + vec2( - o.x, - o.y ) ).r;
	float d1 = texture2D( tDepth, vUv + vec2( o.x, - o.y ) ).r;
	float d2 = texture2D( tDepth, vUv + vec2( - o.x, o.y ) ).r;
	float d3 = texture2D( tDepth, vUv + vec2( o.x, o.y ) ).r;
	float dn = min( min( d0, d1 ), min( d2, d3 ) );
	float coc = cocFor( vUv, linearDist( dn ) );
	vec3 col = texture2D( tColor, vUv ).rgb;
	col = min( col, vec3( 32.0 ) ); // tame HDR fireflies so bokeh stays stable
	gl_FragColor = vec4( col, coc );
}
`;

/**
 * Scatter-as-gather bokeh DOF (after Dennis Gustafsson): golden-angle spiral,
 * each sample contributes if its own CoC reaches the current radius. Background
 * samples may not bleed over sharper foreground. Alpha = how much blurred
 * foreground spills onto this pixel (used by the composite).
 */
export const DOF_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uMaxCoC;
uniform float uRadScale;
varying vec2 vUv;
const float GOLDEN_ANGLE = 2.39996323;
void main() {
	vec4 center = textureLod( tInput, vUv, 0.0 );
	float centerCoC = center.a;
	float centerSize = abs( centerCoC ) * uMaxCoC;
	vec3 color = center.rgb;
	float tot = 1.0;
	float radius = uRadScale;
	float ang = 0.0;
	float fg = 0.0;
	for ( int i = 0; i < 512; i ++ ) {
		if ( radius >= uMaxCoC ) break;
		vec2 tc = vUv + vec2( cos( ang ), sin( ang ) ) * uTexel * radius;
		vec4 s = textureLod( tInput, tc, 0.0 );
		float sampleSize = abs( s.a ) * uMaxCoC;
		if ( s.a > centerCoC ) sampleSize = clamp( sampleSize, 0.0, centerSize * 2.0 );
		float m = smoothstep( radius - 0.5, radius + 0.5, sampleSize );
		color += mix( color / tot, s.rgb, m );
		tot += 1.0;
		if ( s.a < centerCoC - 0.05 ) fg = max( fg, m * smoothstep( 1.0, 3.0, sampleSize ) );
		radius += uRadScale / radius;
		ang += GOLDEN_ANGLE;
	}
	gl_FragColor = vec4( color / tot, fg );
}
`;

/** 13-tap downsample (Jimenez 2014). First level: Karis average + soft threshold. */
export const BLOOM_DOWN_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uPrefilter;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
vec3 tap( vec2 o ) { return textureLod( tInput, vUv + o * uTexel, 0.0 ).rgb; }
float karis( vec3 c ) { return 1.0 / ( 1.0 + dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ); }
vec3 soft( vec3 c ) {
	float br = max( c.r, max( c.g, c.b ) );
	float rq = clamp( br - uThreshold + uKnee, 0.0, 2.0 * uKnee );
	rq = ( rq * rq ) / ( 4.0 * uKnee + 1e-5 );
	return c * ( max( rq, br - uThreshold ) / max( br, 1e-5 ) );
}
void main() {
	vec3 a = tap( vec2( - 2.0, 2.0 ) ), b = tap( vec2( 0.0, 2.0 ) ), c = tap( vec2( 2.0, 2.0 ) );
	vec3 d = tap( vec2( - 2.0, 0.0 ) ), e = tap( vec2( 0.0, 0.0 ) ), f = tap( vec2( 2.0, 0.0 ) );
	vec3 g = tap( vec2( - 2.0, - 2.0 ) ), h = tap( vec2( 0.0, - 2.0 ) ), i = tap( vec2( 2.0, - 2.0 ) );
	vec3 j = tap( vec2( - 1.0, 1.0 ) ), k = tap( vec2( 1.0, 1.0 ) ), l = tap( vec2( - 1.0, - 1.0 ) ), m = tap( vec2( 1.0, - 1.0 ) );
	vec3 col;
	if ( uPrefilter > 0.5 ) {
		vec3 g0 = ( j + k + l + m ) * 0.25;
		vec3 g1 = ( a + b + d + e ) * 0.25;
		vec3 g2 = ( b + c + e + f ) * 0.25;
		vec3 g3 = ( d + e + g + h ) * 0.25;
		vec3 g4 = ( e + f + h + i ) * 0.25;
		float w0 = karis( g0 ) * 0.5, w1 = karis( g1 ) * 0.125, w2 = karis( g2 ) * 0.125, w3 = karis( g3 ) * 0.125, w4 = karis( g4 ) * 0.125;
		col = ( g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4 ) / ( w0 + w1 + w2 + w3 + w4 );
		col = soft( col );
	} else {
		col = e * 0.125 + ( a + c + g + i ) * 0.03125 + ( b + d + f + h ) * 0.0625 + ( j + k + l + m ) * 0.125;
	}
	gl_FragColor = vec4( col, 1.0 );
}
`;

/** 3x3 tent upsample, additively blended onto the next larger mip. */
export const BLOOM_UP_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uWeight;
varying vec2 vUv;
vec3 tap( vec2 o ) { return textureLod( tInput, vUv + o * uTexel * uRadius, 0.0 ).rgb; }
void main() {
	vec3 s = tap( vec2( - 1.0, 1.0 ) ) + tap( vec2( 0.0, 1.0 ) ) * 2.0 + tap( vec2( 1.0, 1.0 ) )
	       + tap( vec2( - 1.0, 0.0 ) ) * 2.0 + tap( vec2( 0.0 ) ) * 4.0 + tap( vec2( 1.0, 0.0 ) ) * 2.0
	       + tap( vec2( - 1.0, - 1.0 ) ) + tap( vec2( 0.0, - 1.0 ) ) * 2.0 + tap( vec2( 1.0, - 1.0 ) );
	gl_FragColor = vec4( s * ( uWeight / 16.0 ), 1.0 );
}
`;

/** DOF composite + bloom + tone mapping + grading + vignette + dithering. */
export const COMPOSITE_FRAG = /* glsl */ `
#include <tonemapping_pars_fragment>
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tDof;
uniform sampler2D tBloom;
uniform float uDofOn;
uniform float uBloomOn;
uniform float uBloomStrength;
uniform float uMaxCoC;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform float uAspect;
uniform float uSplit;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform int uToneMapper;
uniform int uDebug;
varying vec2 vUv;
${COC_GLSL}

float hash12( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}

vec3 tonemap( vec3 c ) {
	if ( uToneMapper == 1 ) return AgXToneMapping( c );
	if ( uToneMapper == 2 ) return NeutralToneMapping( c );
	return ACESFilmicToneMapping( c );
}

void main() {
	vec3 sharp = texture2D( tScene, vUv ).rgb;
	float dist = linearDist( texture2D( tDepth, vUv ).r );
	float coc = cocFor( vUv, dist );
	vec3 col = sharp;
	if ( uDofOn > 0.5 ) {
		vec4 dof = texture2D( tDof, vUv );
		float size = abs( coc ) * uMaxCoC;
		float blend = max( smoothstep( 0.35, 1.3, size ), dof.a );
		col = mix( sharp, dof.rgb, blend );
	}
	vec3 bloom = texture2D( tBloom, vUv ).rgb;
	if ( uBloomOn > 0.5 ) col += bloom * uBloomStrength;
	col *= uExposure;

	if ( uDebug == 1 ) {
		// CoC: orange = near blur, blue = far blur, dark = in focus
		col = coc < 0.0 ? vec3( 1.0, 0.45, 0.1 ) * - coc : vec3( 0.15, 0.45, 1.0 ) * coc;
		col += sharp * 0.08;
		gl_FragColor = vec4( col, 1.0 );
		#include <colorspace_fragment>
		return;
	}
	if ( uDebug == 2 ) col = bloom * uBloomStrength * uExposure;

	col = tonemap( max( col, 0.0 ) );

	// split toning: cool shadows, warm highlights (HD-2D night palette)
	float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
	col += uShadowTint * uSplit * ( 1.0 - smoothstep( 0.0, 0.45, l ) ) + uHighlightTint * uSplit * smoothstep( 0.45, 1.0, l );
	col = mix( vec3( l ), col, uSaturation );
	col = ( col - 0.5 ) * uContrast + 0.5;

	vec2 q = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
	float v = smoothstep( 1.05, 0.25, length( q ) );
	col *= mix( 1.0, v, uVignette );
	col = clamp( col, 0.0, 1.0 );

	gl_FragColor = vec4( col, 1.0 );
	#include <colorspace_fragment>
	float n = hash12( gl_FragCoord.xy + fract( uTime ) * 91.7 ) - 0.5;
	gl_FragColor.rgb += n * ( 1.5 / 255.0 + uGrain );
}
`;
