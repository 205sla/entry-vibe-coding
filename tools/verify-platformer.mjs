// One-off verifier for platformer.ent. Not a scratch clone — kept because the
// platformer has specialized physics (fixed x, parallax, gravity) that
// inspect.mjs's generic flags can't exercise in a single call.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));

await page.goto('http://localhost:3000/editor.html');
await page.waitForFunction(() => typeof Entry !== 'undefined');
await page.waitForTimeout(2500);

const bytes = Array.from(fs.readFileSync('tests/fixtures/platformer.ent'));
await page.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)]);
    const fd = new FormData(); fd.append('ent', blob, 'platformer.ent');
    const project = await (await fetch('/api/load', { method: 'POST', body: fd })).json();
    Entry.clearProject();
    Entry.loadProject(project);
    await new Promise(r => setTimeout(r, 1500));
}, bytes);

// Start the engine
await page.evaluate(() => { try { Entry.engine.toggleRun(); } catch {} });
await page.waitForTimeout(400);

const snap = () => page.evaluate(() => {
    const byId = {};
    for (const o of Entry.container.getAllObjects()) byId[o.id] = o;
    const get = id => byId[id] ? { x: +byId[id].entity.x.toFixed(1), y: +byId[id].entity.y.toFixed(1) } : null;
    return {
        offset: +Entry.variableContainer.getVariable('offset').getValue(),
        distance: +Entry.variableContainer.getVariable('distance').getValue(),
        vy: +Entry.variableContainer.getVariable('vy').getValue(),
        on_ground: +Entry.variableContainer.getVariable('on_ground').getValue(),
        player: get('player'),
        block_a: get('block_a'),
        block_b: get('block_b'),
        sky_far: get('sky_far'),
        sky_mid: get('sky_mid'),
    };
});

console.log('initial:', JSON.stringify(await snap(), null, 2));

// Hold right arrow for 1 second by firing keydown repeatedly without keyup
console.log('\n→ holding right arrow for 1s (simulated)...');
const holdEnd = Date.now() + 1000;
while (Date.now() < holdEnd) {
    await page.evaluate(() => {
        // Entry listens on `document` and uses `event.code` (not keyCode);
        // see entryjs/src/util/utils.js:860 Entry.Utils.inputToKeycode.
        const ev = new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight' });
        document.dispatchEvent(ev);
    });
    await page.waitForTimeout(50);
}
// Release
await page.evaluate(() => {
    const ev = new KeyboardEvent('keyup', { code: 'ArrowRight', key: 'ArrowRight' });
    document.dispatchEvent(ev);
});
await page.waitForTimeout(200);
console.log('after right hold:', JSON.stringify(await snap(), null, 2));

// Jump test
console.log('\n↑ jumping...');
await page.evaluate(() => {
    const ev = new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp' });
    document.dispatchEvent(ev);
});
await page.waitForTimeout(30);
await page.evaluate(() => {
    const ev = new KeyboardEvent('keyup', { code: 'ArrowUp', key: 'ArrowUp' });
    document.dispatchEvent(ev);
});
await page.waitForTimeout(150);
const apex = await snap();
console.log('mid-jump:', apex.player, 'vy=' + apex.vy, 'on_ground=' + apex.on_ground);
await page.waitForTimeout(700);
const land = await snap();
console.log('after landing:', land.player, 'vy=' + land.vy, 'on_ground=' + land.on_ground);

console.log('\npageErrors:', errs.length);
if (errs.length) for (const e of errs.slice(0, 5)) console.log(' -', e);

await b.close();
