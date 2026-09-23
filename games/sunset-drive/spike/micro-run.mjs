// Time Entry.engine.update (all script work in one tick) per mode. Fresh browser per case.
// usage: node micro-run.mjs [N] [modes] [ent]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootEditor, loadFixture } from '../../../tools/lib/editor-harness.mjs';
import { stopEngine, setVar } from '../../../tools/lib/verify-harness.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const N = Number(process.argv[2] || 300);
const modes = (process.argv[3] || '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19').split(',').map(Number);
const ent = path.join(dir, process.argv[4] || 'micro.ent');
const names = { 1: 'set literal', 2: 'set+global read', 3: 'add', 4: 'mul', 5: 'div', 6: 'mod(plain)', 7: 'abs(op)', 8: 'locate', 9: 'list read', 10: 'param read', 11: 'local set/get', 12: 'list write', 13: 'add literal', 14: 'fill quad', 15: 'set_fill_color', 16: 'call 6p4l', 17: 'stamp', 18: 'local set(add)', 19: 'call 1p0l', 20: 'changeShape', 21: 'setSize', 22: 'shape+size+locate+stamp' };

const results = {};
for (const mode of modes) {
  const { browser, page } = await bootEditor();
  try {
    await loadFixture(page, ent);
    await stopEngine(page);
    await setVar(page, 'mode', mode);
    await setVar(page, 'N', N);
    const ms = await page.evaluate(async () => {
      const c = Entry.container;
      const orig = c.mapObjectOnScene;
      const d = [];
      c.mapObjectOnScene = function (f, ...rest) {
        if (f !== Entry.engine.computeFunction) return orig.call(this, f, ...rest);
        const t = performance.now(); const r = orig.call(this, f, ...rest); d.push(performance.now() - t); return r;
      };
      Entry.engine.toggleRun();
      await new Promise((r) => setTimeout(r, 2500));
      c.mapObjectOnScene = orig;
      const s = d.slice(20).sort((a, b) => a - b);
      return { median: s[Math.floor(s.length / 2)], n: s.length };
    });
    results[mode] = ms.median;
    console.log(JSON.stringify({ mode, name: names[mode], N, tickMs: +ms.median.toFixed(2), usPerOp: +(ms.median * 1000 / (N * 10)).toFixed(3), ticks: ms.n }));
  } finally {
    await browser.close();
  }
}
