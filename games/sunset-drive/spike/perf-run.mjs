// Measure main-loop iterations per second for each (mode, N). Fresh browser per case.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bootEditor, loadFixture } from '../../../tools/lib/editor-harness.mjs';
import { runFresh, getVar, setVar } from '../../../tools/lib/verify-harness.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ent = path.join(dir, process.env.ENT || 'perf.ent');
const cases = (process.argv[2] || '1:100,2:100,3:100,4:40,5:100,6:100')
  .split(',').map((c) => c.split(':').map(Number));

for (const [mode, N] of cases) {
  const { browser, page, pageErrors } = await bootEditor();
  try {
    await loadFixture(page, ent);
    await runFresh(page, { mode, N });
    await page.waitForTimeout(1500);
    const f0 = +(await getVar(page, 'frames'));
    const t0 = Date.now();
    await page.waitForTimeout(3000);
    const f1 = +(await getVar(page, 'frames'));
    const dt = (Date.now() - t0) / 1000;
    const fps = (f1 - f0) / dt;
    let shot = '';
    if (process.env.SHOT) {
      shot = path.join(dir, `perf-${mode}-${N}.png`);
      await page.screenshot({ path: shot });
    }
    console.log(JSON.stringify({ mode, N, fps: +fps.toFixed(1), errors: pageErrors.length, shot }));
  } finally {
    await browser.close();
  }
}
