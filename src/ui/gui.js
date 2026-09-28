import GUI from 'lil-gui';

export const LIGHT_PRESETS = {
  Night: {
    moonColor: 0xa8bbff, moonIntensity: 2.8, moonPos: [-13, 24, -15],
    ambient: 2.4, hemiSky: 0x5a6fb0, hemiGround: 0x2a2018,
    skyTop: 0x070b1c, skyHorizon: 0x141a36, skyBottom: 0x03040a, stars: 1,
    torch: 1, exposure: 1.4, split: 0.04, fall: 0.45,
  },
  'Deep Night': {
    moonColor: 0x8a9ef0, moonIntensity: 1.1, moonPos: [-10, 22, -18],
    ambient: 1.2, hemiSky: 0x3a4c86, hemiGround: 0x18110c,
    skyTop: 0x04060f, skyHorizon: 0x0a0e20, skyBottom: 0x020306, stars: 1.3,
    torch: 1.2, exposure: 1.5, split: 0.05, fall: 0.3,
  },
  Dusk: {
    moonColor: 0xffa46a, moonIntensity: 5.0, moonPos: [-22, 10, -8],
    ambient: 3.0, hemiSky: 0x8a86c8, hemiGround: 0x4a3020,
    skyTop: 0x2a2a58, skyHorizon: 0x9a5a5a, skyBottom: 0x1a1020, stars: 0.2,
    torch: 0.8, exposure: 1.1, split: 0.03, fall: 0.9,
  },
};

/** lil-gui panel wired to the pipeline + scene settings. */
export function createGui({ post, settings, renderer, scene, applyPreset, spriteMats }) {
  const P = post.params;
  const gui = new GUI({ title: 'HD-2D Diorama' });

  gui.add(settings, 'preset', Object.keys(LIGHT_PRESETS)).name('Lighting preset').onChange(applyPreset);

  const dof = gui.addFolder('Tilt-shift DOF');
  dof.add(P.dof, 'enabled');
  dof.add(P.dof, 'autoFocus').name('auto focus (hero)');
  dof.add(P.dof, 'focusDistance', 5, 70, 0.1).name('focus distance').listen();
  dof.add(P.dof, 'focusRange', 0, 8, 0.05).name('sharp depth range');
  dof.add(P.dof, 'nearRamp', 0.5, 20, 0.1).name('near falloff');
  dof.add(P.dof, 'farRamp', 0.5, 30, 0.1).name('far falloff');
  dof.add(P.dof, 'maxBlur', 0, 0.05, 0.001).name('max blur (screen)');
  dof.add(P.dof, 'tiltMix', 0, 1, 0.01).name('depth ↔ tilt-shift');
  dof.add(P.dof, 'autoTiltCenter').name('tilt band on hero');
  dof.add(P.dof, 'tiltCenter', 0, 1, 0.01).name('tilt band center').listen();
  dof.add(P.dof, 'tiltWidth', 0, 0.5, 0.005).name('tilt band width');
  dof.add(P.dof, 'tiltSoft', 0.01, 0.8, 0.01).name('tilt softness');
  dof.add(P.dof, 'quality', 0, 1, 0.05).name('bokeh quality');

  const bloom = gui.addFolder('Bloom');
  bloom.add(P.bloom, 'enabled');
  bloom.add(P.bloom, 'threshold', 0, 4, 0.01);
  bloom.add(P.bloom, 'knee', 0, 2, 0.01);
  bloom.add(P.bloom, 'strength', 0, 3, 0.01);
  bloom.add(P.bloom, 'radius', 0.3, 2.5, 0.01);

  const light = gui.addFolder('Lighting');
  light.add(settings, 'torchIntensity', 0, 3, 0.01).name('torch intensity').listen();
  light.add(settings, 'flicker', 0, 2, 0.01).name('torch flicker');
  light.add(settings, 'moonIntensity', 0, 3, 0.01).name('moonlight').listen();
  light.add(settings, 'ambient', 0, 2, 0.01).name('ambient').listen();
  light.add(settings, 'rim', 0, 3, 0.01).name('sprite rim light').onChange((v) => {
    for (const m of spriteMats) m.userData.spriteUniforms.uRim.value = m.userData.baseRim * v;
  });
  light.add(settings, 'shadows').onChange((v) => {
    renderer.shadowMap.enabled = v;
    scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
    });
  });

  const grade = gui.addFolder('Tone & grade');
  grade.add(P.grade, 'exposure', 0.2, 3, 0.01).listen();
  grade.add(P.grade, 'toneMapper', { ACES: 0, AgX: 1, Neutral: 2 }).name('tone mapper');
  grade.add(P.grade, 'contrast', 0.7, 1.5, 0.01);
  grade.add(P.grade, 'saturation', 0, 2, 0.01);
  grade.add(P.grade, 'split', 0, 0.2, 0.005).name('split toning').listen();
  grade.add(P.grade, 'vignette', 0, 1, 0.01);
  grade.add(P.grade, 'grain', 0, 0.08, 0.001);

  const cam = gui.addFolder('Camera & render');
  cam.add(settings, 'followHero').name('follow hero (F)').listen();
  cam.add(settings, 'fov', 12, 50, 0.5).onChange(() => settings.onResize());
  cam.add(settings, 'renderScale', 0.5, 2, 0.05).name('render scale').onChange(() => settings.onResize());
  cam.add(settings, 'timeScale', 0, 2, 0.01).name('time scale');
  cam.add(settings, 'paused');
  cam.add(P, 'debugView', { Final: 0, 'CoC (DOF map)': 1, 'Bloom only': 2, 'No post FX': 3 }).name('debug view');

  bloom.close();
  grade.close();
  cam.close();
  return gui;
}
