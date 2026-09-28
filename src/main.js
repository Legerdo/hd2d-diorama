import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEnvironmentTextures } from './gfx/textures.js';
import { createSpriteArt } from './gfx/spriteArt.js';
import { globalUniforms } from './gfx/materials.js';
import { WorldMap } from './world/map.js';
import { buildDiorama } from './world/diorama.js';
import { Torch, createAmbientLights } from './world/lights.js';
import { Actor, Wanderer, Patrol, Follower } from './world/actors.js';
import { createSky } from './fx/sky.js';
import { waterfallUniforms } from './fx/water.js';
import { createEmbers, createFireflies, createSmoke, particleUniforms } from './fx/particles.js';
import { PostPipeline } from './post/pipeline.js';
import { createGui, LIGHT_PRESETS } from './ui/gui.js';
import { showSpriteDebug } from './ui/spriteDebug.js';
import { RNG } from './util/rng.js';

const query = new URLSearchParams(location.search);
const SHOT = query.has('shot');

window.__hd2d = { ready: false, frames: 0, errors: [] };
window.addEventListener('error', (e) => window.__hd2d.errors.push(String(e.message || e)));

if (query.get('debug') === 'sprites') {
  showSpriteDebug(createSpriteArt(), createEnvironmentTextures());
} else {
  start();
}

function start() {
  const canvas = document.getElementById('app');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // MSAA happens in the HDR scene target
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: SHOT,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, window.innerWidth / window.innerHeight, 0.5, 220);

  // ------------------------------------------------------------ world
  const map = new WorldMap();
  const tex = createEnvironmentTextures();
  const sprites = createSpriteArt();
  const world = buildDiorama({ map, tex, sprites });
  scene.add(world.root);

  const { moon, hemi } = createAmbientLights();
  scene.add(moon, moon.target, hemi);
  const torches = world.torchDefs.map((d) => new Torch(d));
  for (const t of torches) scene.add(t.object);
  const windowLights = world.windowLights.map((w) => {
    const l = new THREE.PointLight(w.color, w.intensity, w.distance, 2);
    l.position.copy(w.position);
    l.userData.base = w.intensity;
    scene.add(l);
    return l;
  });

  const sky = createSky();
  scene.add(sky);
  const rng = new RNG(99);
  scene.add(createEmbers(world.emberEmitters, rng));
  scene.add(createFireflies(world.fireflyAnchors, rng));
  scene.add(createSmoke(world.smokeOrigin, 36, rng));

  // ------------------------------------------------------------ actors
  const C = sprites.characters;
  const blobTex = tex.blob;
  const hero = new Actor(map, C.hero, { name: 'hero', x: -1.7, z: 5.3, speed: 2.2, blobTex });
  const mage = new Actor(map, C.mage, { name: 'mage', x: 3.6, z: 2.9, blobTex, emissiveIntensity: 3.5 });
  const guard = new Actor(map, C.guard, { name: 'guard', x: -5.5, z: -4.6, blobTex });
  const villager = new Actor(map, C.villager, { name: 'villager', x: 4.3, z: 2.7, blobTex, emissiveIntensity: 4 });
  const cat = new Actor(map, C.cat, { name: 'cat', x: -0.7, z: 5.9, blobTex, blobSize: [0.7, 0.3], emissiveIntensity: 2 });
  const actors = [hero, mage, guard, villager, cat];
  for (const a of actors) scene.add(a.group);

  const brains = [
    new Wanderer(mage, { x0: -6.5, z0: 0.6, x1: 6.8, z1: 4.8 }, 11, { speed: 1.05, pause: [2, 5] }),
    new Patrol(guard, [{ x: -5.5, z: -4.6 }, { x: 5.5, z: -4.6 }], { speed: 1.25, pause: 2.8 }),
    new Patrol(
      villager,
      [
        { x: 4.3, z: 2.65, pause: 3.5 },
        { x: 3.4, z: 4.8 },
        { x: -2.2, z: 4.8 },
        { x: -6.8, z: 3.0 },
        { x: -12.2, z: 3.0 },
        { x: -12.4, z: 5.6, pause: 3.5 },
        { x: -12.2, z: 3.0 },
        { x: -6.8, z: 3.0 },
        { x: -2.2, z: 4.8 },
        { x: 3.4, z: 4.8 },
      ],
      { speed: 0.95, pause: 0.05, faceOnPause: null },
    ),
    new Follower(cat, hero),
  ];
  const lantern = new THREE.PointLight(0xffb060, 3.2, 5.5, 2);
  scene.add(lantern);

  // ------------------------------------------------------------ camera rig
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 12;
  controls.maxDistance = 52;
  controls.minPolarAngle = 0.5;
  controls.maxPolarAngle = 1.22;
  controls.minAzimuthAngle = -0.9;
  controls.maxAzimuthAngle = 0.9;
  const heroFocus = () => new THREE.Vector3(hero.x, hero.y + 0.85, hero.z);
  controls.target.copy(heroFocus()).add(new THREE.Vector3(0, 0, -2.6)).lerp(new THREE.Vector3(0, 0.5, 0), 0.15);
  const elev = THREE.MathUtils.degToRad(35);
  camera.position.copy(controls.target).add(new THREE.Vector3(Math.sin(-0.12) * Math.cos(elev), Math.sin(elev), Math.cos(-0.12) * Math.cos(elev)).multiplyScalar(26));
  controls.update();

  // ------------------------------------------------------------ post + settings
  const post = new PostPipeline(renderer, { samples: 4 });
  const settings = {
    followHero: true,
    fov: 26,
    renderScale: Math.min(window.devicePixelRatio, 1.5),
    torchIntensity: 1,
    flicker: 1,
    moonIntensity: moon.intensity,
    ambient: hemi.intensity,
    shadows: true,
    rim: 1,
    preset: 'Night',
    timeScale: 1,
    paused: false,
  };

  const spriteMats = new Set();
  scene.traverse((o) => {
    if (o.material?.userData?.spriteUniforms) spriteMats.add(o.material);
  });
  for (const m of spriteMats) m.userData.baseRim = m.userData.spriteUniforms.uRim.value;

  function applyPreset(name) {
    const p = LIGHT_PRESETS[name];
    if (!p) return;
    moon.color.set(p.moonColor);
    moon.position.set(...p.moonPos);
    settings.moonIntensity = p.moonIntensity;
    settings.ambient = p.ambient;
    hemi.color.set(p.hemiSky);
    hemi.groundColor.set(p.hemiGround);
    sky.material.uniforms.uTop.value.set(p.skyTop);
    sky.material.uniforms.uHorizon.value.set(p.skyHorizon);
    sky.material.uniforms.uBottom.value.set(p.skyBottom);
    sky.material.uniforms.uStars.value = p.stars;
    settings.torchIntensity = p.torch;
    post.params.grade.exposure = p.exposure;
    post.params.grade.split = p.split;
    waterfallUniforms.uBright.value = p.fall;
    gui?.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  const gui = SHOT && query.get('ui') === '0' ? null : createGui({ post, settings, renderer, scene, applyPreset, spriteMats });
  applyPreset(settings.preset);
  if (query.get('view')) post.params.debugView = { coc: 1, bloom: 2, raw: 3 }[query.get('view')] ?? 0;
  if (query.get('ui') === '0') document.body.classList.add('no-ui');

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(settings.renderScale);
    renderer.setSize(w, h);
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
    post.setSize(buf.x, buf.y);
    camera.aspect = w / h;
    camera.fov = settings.fov;
    camera.updateProjectionMatrix();
    particleUniforms.uScale.value = buf.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
  settings.onResize = resize;
  window.addEventListener('resize', resize);
  resize();

  // ------------------------------------------------------------ input
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    keys.add(e.code);
    if (e.code === 'Space') {
      hero.jump();
      e.preventDefault();
    }
    if (e.code === 'KeyH') document.body.classList.toggle('no-ui');
    if (e.code === 'KeyF') settings.followHero = !settings.followHero;
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // ------------------------------------------------------------ loop
  const timer = new THREE.Timer();
  let time = SHOT ? 6.0 : 0;
  const camRight = new THREE.Vector3();
  const camFwd = new THREE.Vector3();
  const fpsEl = document.getElementById('fps');
  let fpsAcc = 0;
  let fpsN = 0;
  const center = new THREE.Vector3(0, 0.5, 0);
  const tmp = new THREE.Vector3();

  renderer.info.autoReset = false;
  renderer.setAnimationLoop(() => {
    renderer.info.reset();
    timer.update();
    const rawDt = Math.min(timer.getDelta(), 1 / 20);
    const dt = settings.paused ? 0 : rawDt * settings.timeScale;
    time += dt;
    globalUniforms.uTime.value = time;
    globalUniforms.uWind.value.set(Math.cos(time * 0.05) * 0.9, 0.35);

    // camera basis on the ground plane
    camera.getWorldDirection(camFwd);
    camFwd.y = 0;
    camFwd.normalize();
    camRight.set(-camFwd.z, 0, camFwd.x);

    // hero input
    const ix = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const iy = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    let dir = null;
    if (ix || iy) {
      dir = new THREE.Vector2(camRight.x * ix + camFwd.x * iy, camRight.z * ix + camFwd.z * iy).normalize();
    }
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (dt > 0) {
      hero.step(dt, dir, run ? 4.0 : hero.speed, camRight, camFwd);
      for (const b of brains) b.update(dt, camRight, camFwd);
    }
    lantern.position.set(villager.x + (villager.dir === 'right' ? -0.28 : villager.dir === 'left' ? 0.28 : 0.3), villager.y + 0.75, villager.z + 0.1);

    // lights
    moon.intensity = settings.moonIntensity;
    hemi.intensity = settings.ambient;
    for (const t of torches) t.update(time, settings);
    for (const l of windowLights) l.intensity = l.userData.base * (0.92 + 0.08 * Math.sin(time * 3.1 + l.position.x)) * settings.torchIntensity;
    lantern.intensity = 3.2 * settings.torchIntensity * (0.9 + 0.1 * Math.sin(time * 9.0));

    // camera follow (keeps the orbit offset, moves the pivot)
    if (settings.followHero) {
      // frame the hero in the lower third, looking slightly "up-screen" into the scene
      const desired = heroFocus().addScaledVector(camFwd, 2.6).lerp(center, 0.15);
      tmp.subVectors(desired, controls.target).multiplyScalar(1 - Math.exp(-rawDt * 3.2));
      controls.target.add(tmp);
      camera.position.add(tmp);
    }
    controls.update();
    sky.position.copy(camera.position);

    // autofocus + tilt band on the hero
    const D = post.params.dof;
    if (D.autoFocus) {
      const target = camera.position.distanceTo(heroFocus());
      D.focusDistance += (target - D.focusDistance) * (1 - Math.exp(-rawDt * 6));
    }
    if (D.autoTiltCenter) {
      const ndc = heroFocus().project(camera);
      const c = THREE.MathUtils.clamp(ndc.y * 0.5 + 0.5, 0.2, 0.8);
      D.tiltCenter += (c - D.tiltCenter) * (1 - Math.exp(-rawDt * 6));
    }

    post.render(scene, camera, time);

    const st = window.__hd2d;
    st.frames++;
    if (st.frames === 3) document.getElementById('loading')?.classList.add('hidden');
    if (st.frames > 40) st.ready = true;
    fpsAcc += rawDt;
    fpsN++;
    if (fpsAcc > 0.5 && fpsEl) {
      fpsEl.textContent = `${Math.round(fpsN / fpsAcc)} fps · ${renderer.info.render.calls} draws`;
      fpsAcc = 0;
      fpsN = 0;
    }
  });

  window.__hd2d.api = { scene, camera, renderer, post, hero, settings, controls, map };
}
