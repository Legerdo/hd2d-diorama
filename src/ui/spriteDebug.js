/** ?debug=sprites : shows every generated sprite sheet / texture enlarged (nearest). */
export function showSpriteDebug(sprites, env) {
  document.getElementById('loading')?.remove();
  document.getElementById('app')?.remove();
  document.body.classList.add('debug-page');
  const wrap = document.createElement('div');
  wrap.className = 'sprite-debug';
  document.body.appendChild(wrap);

  const add = (label, pb, scale = 4) => {
    const fig = document.createElement('figure');
    const c = document.createElement('canvas');
    c.width = pb.w;
    c.height = pb.h;
    c.style.width = `${pb.w * scale}px`;
    c.style.height = `${pb.h * scale}px`;
    const ctx = c.getContext('2d');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pb.rgba), pb.w, pb.h), 0, 0);
    const cap = document.createElement('figcaption');
    cap.textContent = label;
    fig.append(c, cap);
    wrap.appendChild(fig);
  };

  for (const [name, s] of Object.entries(sprites.characters)) add(`character: ${name}`, s.pb, 3);
  for (const [name, s] of Object.entries(sprites.trees)) add(`tree: ${name}`, s.pb, 3);
  for (const [name, s] of Object.entries(sprites.bushes)) add(`bush: ${name}`, s.pb, 4);
  add('grass atlas', sprites.grass.pb, 4);
  for (const key of ['grass', 'cobble', 'brick', 'plaster', 'wood', 'roof', 'soil', 'grassSide', 'cobbleSide', 'sand', 'dirt', 'door', 'window', 'sign']) {
    add(`texture: ${key}`, env[key].pb, 3);
  }
  window.__hd2d.ready = true;
}
