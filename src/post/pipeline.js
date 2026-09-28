import * as THREE from 'three';
import { FS_VERT, PREFILTER_FRAG, DOF_FRAG, BLOOM_DOWN_FRAG, BLOOM_UP_FRAG, COMPOSITE_FRAG } from './shaders.js';

// ---------------------------------------------------------------------------
// Post pipeline
//   scene  -> MSAA HDR target (HalfFloat colour + float depth texture)
//   DOF    -> half-res prefilter (colour + signed CoC) -> bokeh gather
//   bloom  -> 13-tap mip chain down / tent up (from the DOF result, so
//             out-of-focus highlights bloom like real lens bokeh)
//   final  -> DOF composite, bloom, tone map, split-tone grade, vignette
// ---------------------------------------------------------------------------

const BLOOM_LEVELS = 6;
const DOF_MAX_HEIGHT = 720;

function makeTarget() {
  return new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
}

function passMaterial(fragmentShader, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    ...extra,
  });
}

function cocUniforms() {
  return {
    uNear: { value: 0.5 },
    uFar: { value: 200 },
    uFocus: { value: 30 },
    uFocusRange: { value: 2 },
    uNearRamp: { value: 6 },
    uFarRamp: { value: 10 },
    uTiltMix: { value: 0.35 },
    uTiltCenter: { value: 0.5 },
    uTiltWidth: { value: 0.1 },
    uTiltSoft: { value: 0.3 },
  };
}

export class PostPipeline {
  constructor(renderer, { samples = 4 } = {}) {
    this.renderer = renderer;
    this.params = {
      dof: {
        enabled: true,
        autoFocus: true,
        focusDistance: 30,
        focusRange: 2.2,
        nearRamp: 7,
        farRamp: 11,
        maxBlur: 0.019, // fraction of screen height
        tiltMix: 0.3,
        tiltCenter: 0.5,
        autoTiltCenter: true,
        tiltWidth: 0.12,
        tiltSoft: 0.4,
        quality: 0.7,
      },
      bloom: { enabled: true, threshold: 0.9, knee: 0.7, strength: 0.55, radius: 1.0 },
      grade: {
        exposure: 1.15,
        toneMapper: 0,
        contrast: 1.07,
        saturation: 1.12,
        split: 0.05,
        vignette: 0.45,
        grain: 0.02,
      },
      debugView: 0,
    };

    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.sceneRT.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.cocRT = makeTarget();
    this.dofRT = makeTarget();
    this.bloomRTs = Array.from({ length: BLOOM_LEVELS }, makeTarget);

    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.fsQuad = new THREE.Mesh(tri);
    this.fsQuad.frustumCulled = false;
    this.fsScene = new THREE.Scene();
    this.fsScene.add(this.fsQuad);
    this.fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.prefilterMat = passMaterial(PREFILTER_FRAG, {
      tColor: { value: this.sceneRT.texture },
      tDepth: { value: this.sceneRT.depthTexture },
      uSrcTexel: { value: new THREE.Vector2() },
      ...cocUniforms(),
    });
    this.dofMat = passMaterial(DOF_FRAG, {
      tInput: { value: this.cocRT.texture },
      uTexel: { value: new THREE.Vector2() },
      uMaxCoC: { value: 10 },
      uRadScale: { value: 0.7 },
    });
    this.downMat = passMaterial(BLOOM_DOWN_FRAG, {
      tInput: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uPrefilter: { value: 0 },
      uThreshold: { value: 1 },
      uKnee: { value: 0.5 },
    });
    this.upMat = passMaterial(
      BLOOM_UP_FRAG,
      { tInput: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 }, uWeight: { value: 1 } },
      { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true },
    );
    this.compositeMat = passMaterial(COMPOSITE_FRAG, {
      tScene: { value: this.sceneRT.texture },
      tDepth: { value: this.sceneRT.depthTexture },
      tDof: { value: this.dofRT.texture },
      tBloom: { value: this.bloomRTs[0].texture },
      toneMappingExposure: { value: 1 },
      uDofOn: { value: 1 },
      uBloomOn: { value: 1 },
      uBloomStrength: { value: 0.5 },
      uMaxCoC: { value: 10 },
      uExposure: { value: 1 },
      uContrast: { value: 1 },
      uSaturation: { value: 1 },
      uVignette: { value: 0.4 },
      uGrain: { value: 0.02 },
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uSplit: { value: 0.05 },
      uShadowTint: { value: new THREE.Vector3(-0.35, -0.1, 0.55) },
      uHighlightTint: { value: new THREE.Vector3(0.5, 0.18, -0.35) },
      uToneMapper: { value: 0 },
      uDebug: { value: 0 },
      ...cocUniforms(),
    });

    this.width = 1;
    this.height = 1;
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    this.sceneRT.setSize(w, h);
    const dofScale = Math.min(0.5, DOF_MAX_HEIGHT / h);
    const dw = Math.max(1, Math.round(w * dofScale));
    const dh = Math.max(1, Math.round(h * dofScale));
    this.cocRT.setSize(dw, dh);
    this.dofRT.setSize(dw, dh);
    let bw = dw;
    let bh = dh;
    for (const rt of this.bloomRTs) {
      bw = Math.max(1, Math.round(bw / 2));
      bh = Math.max(1, Math.round(bh / 2));
      rt.setSize(bw, bh);
    }
  }

  pass(material, target, clear = true) {
    this.fsQuad.material = material;
    this.renderer.setRenderTarget(target);
    if (clear) this.renderer.clear(true, false, false);
    this.renderer.render(this.fsScene, this.fsCamera);
  }

  /** Copy the DOF/tilt params into a uniform set. */
  applyCoc(u, camera) {
    const d = this.params.dof;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uFocus.value = d.focusDistance;
    u.uFocusRange.value = d.focusRange;
    u.uNearRamp.value = d.nearRamp;
    u.uFarRamp.value = d.farRamp;
    u.uTiltMix.value = d.tiltMix;
    u.uTiltCenter.value = d.tiltCenter;
    u.uTiltWidth.value = d.tiltWidth;
    u.uTiltSoft.value = d.tiltSoft;
  }

  render(scene, camera, time) {
    const r = this.renderer;
    const P = this.params;
    const autoClear = r.autoClear;
    r.autoClear = false;

    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.render(scene, camera);

    const dofH = this.cocRT.height;
    const maxCoC = Math.max(1, P.dof.maxBlur * dofH);
    const dofOn = P.dof.enabled && P.debugView !== 3;
    if (dofOn) {
      const u = this.prefilterMat.uniforms;
      this.applyCoc(u, camera);
      u.uSrcTexel.value.set(1 / this.width, 1 / this.height);
      this.pass(this.prefilterMat, this.cocRT);
      const du = this.dofMat.uniforms;
      du.uTexel.value.set(1 / this.cocRT.width, 1 / this.cocRT.height);
      du.uMaxCoC.value = maxCoC;
      du.uRadScale.value = THREE.MathUtils.lerp(1.3, 0.5, P.dof.quality);
      this.pass(this.dofMat, this.dofRT);
    }

    const bloomOn = P.bloom.enabled && P.debugView !== 3;
    if (bloomOn) {
      const dm = this.downMat.uniforms;
      let src = dofOn ? this.dofRT : this.sceneRT;
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        dm.tInput.value = src.texture;
        dm.uTexel.value.set(1 / src.width, 1 / src.height);
        dm.uPrefilter.value = i === 0 ? 1 : 0;
        dm.uThreshold.value = P.bloom.threshold;
        dm.uKnee.value = Math.max(1e-3, P.bloom.knee);
        this.pass(this.downMat, this.bloomRTs[i]);
        src = this.bloomRTs[i];
      }
      const um = this.upMat.uniforms;
      for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
        const s = this.bloomRTs[i + 1];
        um.tInput.value = s.texture;
        um.uTexel.value.set(1 / s.width, 1 / s.height);
        um.uRadius.value = P.bloom.radius;
        um.uWeight.value = 1;
        this.pass(this.upMat, this.bloomRTs[i], false);
      }
    }

    const cu = this.compositeMat.uniforms;
    this.applyCoc(cu, camera);
    cu.uDofOn.value = dofOn ? 1 : 0;
    cu.uBloomOn.value = bloomOn ? 1 : 0;
    cu.uBloomStrength.value = P.bloom.strength / BLOOM_LEVELS;
    cu.uMaxCoC.value = maxCoC;
    cu.uExposure.value = P.grade.exposure;
    cu.uContrast.value = P.grade.contrast;
    cu.uSaturation.value = P.grade.saturation;
    cu.uSplit.value = P.grade.split;
    cu.uVignette.value = P.grade.vignette;
    cu.uGrain.value = P.grade.grain;
    cu.uToneMapper.value = P.grade.toneMapper;
    cu.uDebug.value = P.debugView === 3 ? 0 : P.debugView;
    cu.uTime.value = time;
    cu.uAspect.value = this.width / this.height;
    this.pass(this.compositeMat, null);

    r.autoClear = autoClear;
  }

  dispose() {
    for (const rt of [this.sceneRT, this.cocRT, this.dofRT, ...this.bloomRTs]) rt.dispose();
  }
}
