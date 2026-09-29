// Run the renderer prototype: fps (frames var), median script ms per tick, screenshots.
// usage: node proto-run.mjs <ent> [positions csv]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootEditor, loadFixture } from '../../../tools/lib/editor-harness.mjs';
import { stopEngine, setVar, getVar } from '../../../tools/lib/verify-harness.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ent = path.resolve(process.argv[2] || path.join(dir, 'proto.ent'));
const positions = (process.argv[3] || '0').split(',').map(Number);
const tag = process.env.TAG || 'proto';

const { browser, page, pageErrors } = await bootEditor();
try {
  await loadFixture(page, ent);
  for (const p of positions) {
    await stopEngine(page);
    await setVar(page, 'pos', p);
    const r = await page.evaluate(async () => {
      const c = Entry.container, orig = c.mapObjectOnScene, d = [];
      c.mapObjectOnScene = function (f, ...rest) {
        if (f !== Entry.engine.computeFunction) return orig.call(this, f, ...rest);
        const t = performance.now(); const res = orig.call(this, f, ...rest); d.push(performance.now() - t); return res;
      };
      Entry.engine.toggleRun();
      await new Promise((r) => setTimeout(r, 1000));
      const f0 = Entry.variableContainer.variables_.find((x) => x.name_ === 'frames').getValue();
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 2500));
      const f1 = Entry.variableContainer.variables_.find((x) => x.name_ === 'frames').getValue();
      const fps = (f1 - f0) / ((performance.now() - t0) / 1000);
      c.mapObjectOnScene = orig;
      const s = d.slice(10).sort((a, b) => a - b);
      return { fps, med: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)] };
    });
    const shot = path.join(dir, `${tag}-${p}.png`);
    await page.locator('#entryCanvas, canvas').first().screenshot({ path: shot }).catch(async () => page.screenshot({ path: shot }));
    console.log(JSON.stringify({ pos: p, fps: +r.fps.toFixed(1), scriptMs: +r.med.toFixed(2), p90: +r.p90.toFixed(2), pos_now: await getVar(page, 'pos'), shot: path.basename(shot) }));
  }
  console.log('pageErrors', pageErrors.length, pageErrors.slice(0, 3));
} finally {
  await browser.close();
}
