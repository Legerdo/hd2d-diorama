// Headless verification: opens the app in Chrome/Edge, waits for frames, captures
// console errors + a screenshot.
//   node tools/screenshot.mjs --url="http://localhost:5173/?shot=1&ui=0" --out=tools/out/shot.png
//   options: --wait=ms  --w=1600 --h=900  --hold=KeyD:1200  --eval="js expression"
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    return m ? [m[1], m[2]] : [a, true];
  }),
);
const url = args.url || 'http://localhost:5391/?shot=1&ui=0';
const out = args.out || 'tools/out/shot.png';
const wait = Number(args.wait ?? 2500);
const W = Number(args.w ?? 1600);
const H = Number(args.h ?? 900);

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));

mkdirSync(dirname(out), { recursive: true });
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__hd2d?.ready, null, { timeout: 90000 }).catch(() => logs.push('[timeout] app never became ready'));
if (args.eval) await page.evaluate(args.eval);
if (args.hold) {
  for (const step of String(args.hold).split(',')) {
    const [key, ms] = step.split(':');
    await page.keyboard.down(key);
    await page.waitForTimeout(Number(ms || 500));
    await page.keyboard.up(key);
  }
}
await page.waitForTimeout(wait);
await page.screenshot({ path: out });
const info = await page.evaluate(() => {
  const s = window.__hd2d || {};
  let gpu = 'n/a';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'hidden';
  } catch (e) {
    gpu = String(e);
  }
  const h = s.api?.hero;
  const hero = h ? { x: +h.x.toFixed(2), y: +h.y.toFixed(2), z: +h.z.toFixed(2), dir: h.dir } : null;
  return { frames: s.frames, ready: s.ready, errors: s.errors, fps: document.getElementById('fps')?.textContent, gpu, hero };
});
console.log(JSON.stringify(info, null, 1));
if (logs.length) console.log(logs.slice(0, 60).join('\n'));
await browser.close();
