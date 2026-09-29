// Profile per-function script time by wrapping Entry.block.func_<id>.func (synchronous calls).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootEditor, loadFixture } from '../../../tools/lib/editor-harness.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ent = path.resolve(process.argv[2] || path.join(dir, 'dev.ent'));
const { browser, page } = await bootEditor();
try {
  await loadFixture(page, ent);
  await page.evaluate(() => {
    const top = ['render', 'physics', 'ai', 'slots', 'avoid', 'clock', 'num', 'dots'];
    window.__prof = {};
    window.__depth = {};
    for (const id of top) {
      const b = Entry.block['func_' + id];
      if (!b) continue;
      const orig = b.func;
      window.__prof[id] = { ms: 0, calls: 0 };
      window.__depth[id] = 0;
      b.func = function (...a) {
        const outer = window.__depth[id] === 0;
        window.__depth[id]++;
        const t = performance.now();
        try { return orig.apply(this, a); } finally {
          window.__depth[id]--;
          if (outer) { window.__prof[id].ms += performance.now() - t; window.__prof[id].calls++; }
        }
      };
    }
    // per-object tick time
    window.__obj = {};
    const c = Entry.container, orig = c.mapObjectOnScene;
    c.mapObjectOnScene = function (f, ...rest) {
      if (f !== Entry.engine.computeFunction) return orig.call(this, f, ...rest);
      return orig.call(this, (o, ...r) => { const t = performance.now(); const res = f(o, ...r); const k = o.name; window.__obj[k] = (window.__obj[k] || 0) + performance.now() - t; return res; }, ...rest);
    };
    Entry.engine.toggleRun();
  });
  const measure = async (label, ms) => {
    await page.evaluate(() => { for (const k in window.__prof) window.__prof[k] = { ms: 0, calls: 0 }; window.__obj = {}; window.__f0 = +Entry.variableContainer.variables_.find((v) => v.name_ === 'frames').getValue(); });
    await page.waitForTimeout(ms);
    const r = await page.evaluate(() => {
      const frames = +Entry.variableContainer.variables_.find((v) => v.name_ === 'frames').getValue() - window.__f0;
      const per = (x) => +(x / frames).toFixed(3);
      return { frames, fn: Object.fromEntries(Object.entries(window.__prof).map(([k, v]) => [k, per(v.ms)])), obj: Object.fromEntries(Object.entries(window.__obj).map(([k, v]) => [k, per(v)])) };
    });
    console.log(label, JSON.stringify(r));
  };
  await page.waitForTimeout(2500);
  await measure('title(ms/frame)', 3000);
  await page.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' })); setTimeout(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' })), 80); });
  await page.waitForTimeout(1200);
  await measure('grid(ms/frame)', 2000);
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp' })));
  await measure('race(ms/frame)', 4000);
} finally {
  await browser.close();
}
