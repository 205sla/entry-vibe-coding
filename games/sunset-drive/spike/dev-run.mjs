// Dev driver: title → countdown → bot-driven race. Screenshots + fps + state dumps.
// usage: node dev-run.mjs <ent> [raceSeconds] [tag]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootEditor, loadFixture } from '../../../tools/lib/editor-harness.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ent = path.resolve(process.argv[2] || path.join(dir, 'dev.ent'));
const raceSec = Number(process.argv[3] || 12);
const tag = process.argv[4] || 'dev';

const { browser, page, pageErrors } = await bootEditor();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
const vars = (names) => page.evaluate((ns) => Object.fromEntries(ns.map((n) => {
  const x = Entry.variableContainer.variables_.find((v) => v.name_ === n);
  return [n, x ? +(+x.getValue()).toFixed(3) : null];
})), names);
const shot = async (name) => {
  const file = path.join(dir, `${tag}-${name}.png`);
  await page.locator('canvas').first().screenshot({ path: file });
  return path.basename(file);
};
const W = ['state', 'speed', 'px', 'pD', 'lap', 'place', 'raceT', 'crash', 'offroad', 'curveP', 'frames', 'cd', 'bestLap'];
try {
  await loadFixture(page, ent);
  // timing hook
  await page.evaluate(() => {
    const c = Entry.container, orig = c.mapObjectOnScene;
    window.__tick = [];
    c.mapObjectOnScene = function (f, ...rest) {
      if (f !== Entry.engine.computeFunction) return orig.call(this, f, ...rest);
      const t = performance.now(); const r = orig.call(this, f, ...rest); window.__tick.push(performance.now() - t); return r;
    };
    Entry.engine.toggleRun();
  });
  await page.waitForTimeout(3000);
  console.log('title', JSON.stringify(await vars(W)), await shot('title'));
  const fps = async (ms) => {
    const f0 = (await vars(['frames'])).frames; const t0 = Date.now();
    await page.waitForTimeout(ms);
    const f1 = (await vars(['frames'])).frames;
    const ticks = await page.evaluate(() => { const s = window.__tick.slice(-120).sort((a, b) => a - b); window.__tick = []; return { med: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)] }; });
    return { fps: +((f1 - f0) / ((Date.now() - t0) / 1000)).toFixed(1), scriptMs: +(ticks.med || 0).toFixed(2), p90: +(ticks.p90 || 0).toFixed(2) };
  };
  console.log('title perf', await fps(2000));
  // start: Space
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
    setTimeout(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' })), 80);
  });
  await page.waitForTimeout(1200);
  console.log('countdown', JSON.stringify(await vars(W)), await shot('countdown'));
  await page.waitForTimeout(2600);
  // bot: hold up; steer toward the lane with a P controller, reading only game variables
  await page.evaluate(() => {
    const get = (n) => +Entry.variableContainer.variables_.find((v) => v.name_ === n).getValue();
    const down = (code) => document.dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));
    const up = (code) => document.dispatchEvent(new KeyboardEvent('keyup', { code, key: code }));
    down('ArrowUp');
    let steer = 0;
    window.__bot = setInterval(() => {
      const px = get('px'), curve = get('curveP');
      const target = Math.max(-0.5, Math.min(0.5, curve * 0.03));
      const e = px - target;
      const want = e > 0.06 ? -1 : e < -0.06 ? 1 : 0;
      if (want !== steer) {
        if (steer === -1) up('ArrowLeft');
        if (steer === 1) up('ArrowRight');
        if (want === -1) down('ArrowLeft');
        if (want === 1) down('ArrowRight');
        steer = want;
      }
    }, 16);
  });
  const STEP = Number(process.env.STEP || 3);
  for (let t = 0; t < raceSec; t += STEP) {
    const p = await fps(STEP * 1000);
    console.log(`race t+${t + STEP}`, JSON.stringify(p), JSON.stringify(await vars(W)), await shot(`race${t + STEP}`));
  }
  await page.evaluate(() => clearInterval(window.__bot));
  console.log('pageErrors', pageErrors.length, pageErrors.slice(0, 5));
  console.log('consoleErrors', consoleErrors.length, consoleErrors.slice(0, 5));
} finally {
  await browser.close();
}
