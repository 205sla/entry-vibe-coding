// Emulate a slow device (CDP CPU throttling) and watch fps + adaptive draw distance.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootEditor, loadFixture } from '../../../tools/lib/editor-harness.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ent = path.resolve(process.argv[2] || path.join(dir, 'dev.ent'));
const rate = Number(process.argv[3] || 4);
const { browser, page } = await bootEditor();
try {
  await loadFixture(page, ent);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await page.evaluate(() => Entry.engine.toggleRun());
  const g = (n) => page.evaluate((n) => +Entry.variableContainer.variables_.find((v) => v.name_ === n).getValue(), n);
  await page.waitForTimeout(2000);
  await page.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' })); setTimeout(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' })), 80); });
  await page.waitForTimeout(4500);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp' })));
  for (let k = 0; k < 8; k++) {
    const f0 = await g('frames'), t0 = Date.now(), r0 = await g('raceT');
    await page.waitForTimeout(2000);
    const f1 = await g('frames'), r1 = await g('raceT');
    console.log(JSON.stringify({ throttle: rate, fps: +((f1 - f0) / ((Date.now() - t0) / 1000)).toFixed(1), drawN: await g('drawN'), dts: +(await g('dts')).toFixed(4), raceClockRatio: +((r1 - r0) / ((Date.now() - t0) / 1000)).toFixed(2), kmh: Math.round(await g('speed') * 290 / 12000) }));
  }
  await page.locator('#entryCanvas').screenshot({ path: path.join(dir, `slow-${rate}x.png`) });
} finally {
  await browser.close();
}
