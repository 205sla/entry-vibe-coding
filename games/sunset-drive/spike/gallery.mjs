// Visual inspection only (not verification): jump the car to set-piece positions and screenshot.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootEditor, loadFixture } from '../../../tools/lib/editor-harness.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ent = path.resolve(process.argv[2]);
const spots = (process.argv[3] || '250,262,340,352,436,452,540,552,566,660').split(',').map(Number);
const { browser, page } = await bootEditor();
try {
  await loadFixture(page, ent);
  await page.evaluate(() => Entry.engine.toggleRun());
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' })); setTimeout(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' })), 80); });
  await page.waitForTimeout(4200);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp' })));
  await page.waitForTimeout(3000);
  for (const band of spots) {
    await page.evaluate((b) => {
      const set = (n, x) => Entry.variableContainer.variables_.find((v) => v.name_ === n).setValue(x);
      set('pD', b * 500 + 1400); set('px', 0);
    }, band);
    await page.waitForTimeout(700);
    await page.locator('#entryCanvas').screenshot({ path: path.join(dir, `gallery-${band}.png`) });
  }
} finally {
  await browser.close();
}
