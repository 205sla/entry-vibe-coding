// Runtime verification for platformer.ent (reach_something collision variant).
// Drives the world scroll to position each block under the player, jumps, and
// confirms player snaps to the right landing_y via collision detection.
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';

let b, page, errs;
try {
    ({ browser: b, page, pageErrors: errs } = await bootEditor({
        viewport: { width: 1600, height: 1000 },
    }));
} catch (e) {
    console.error('error:', e.message);
    process.exit(2);
}

await loadFixture(page, 'tests/fixtures/platformer.ent');
await page.evaluate(async () => {
    try { Entry.engine.toggleRun(); } catch {}
    await new Promise(r => setTimeout(r, 400));
});

const snap = () => page.evaluate(() => {
    const byId = {};
    for (const o of Entry.container.getAllObjects()) byId[o.id] = o;
    const get = id => byId[id] ? { x: +byId[id].entity.x.toFixed(1), y: +byId[id].entity.y.toFixed(1) } : null;
    return {
        offset: +Entry.variableContainer.getVariable('offset').getValue(),
        vy: +Entry.variableContainer.getVariable('vy').getValue(),
        on_ground: +Entry.variableContainer.getVariable('on_ground').getValue(),
        landed: +Entry.variableContainer.getVariable('landed').getValue(),
        player: get('player'),
        block_a: get('block_a'),
        block_b: get('block_b'),
        block_c: get('block_c'),
    };
});

async function tap(code, ms = 40) {
    await page.evaluate(c => document.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c })), code);
    await page.waitForTimeout(ms);
    await page.evaluate(c => document.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c })), code);
}

console.log('initial:', JSON.stringify(await snap()));

// Engine tick rate in headless is inconsistent; set offset directly to position
// block_a under the player (world x 150 → screen x -100 requires offset = -250).
async function setOffset(v) {
    await page.evaluate(val => {
        Entry.variableContainer.getVariable('offset').setValue(val);
    }, v);
    await page.waitForTimeout(200);  // let each block's repeat_inf apply the new offset
}

console.log('\n=== test 1: jump onto block_a (offset = -250 → block_a at screen x = -100) ===');
await setOffset(-250);
let s = await snap();
console.log('positioned:', 'block_a.x=' + s.block_a.x, 'player.y=' + s.player.y);

await tap('ArrowUp');
await page.waitForTimeout(1500);  // enough time for full jump arc + settle
s = await snap();
console.log('post-jump:', 'player.y=' + s.player.y, 'vy=' + s.vy, 'on_ground=' + s.on_ground);
const landedOnA = Math.abs(s.player.y - 48) < 4;
console.log(landedOnA ? '  ✓ landed on block_a at y≈48' : `  ✗ expected y≈48, got ${s.player.y}`);

console.log('\n=== test 2: block_b slides under player (offset = -500) ===');
// Scrolling the world is enough — player is airborne after leaving block_a's
// range, block_b enters the collision zone, collision detection snaps player
// onto block_b without needing a separate jump.
await setOffset(-500);
await page.waitForTimeout(800);  // settle: gravity + collision
s = await snap();
console.log('after offset shift:', 'player.y=' + s.player.y, 'vy=' + s.vy,
            'on_ground=' + s.on_ground, 'block_b.x=' + s.block_b.x);
const landedOnB = Math.abs(s.player.y - 78) < 4;
console.log(landedOnB ? '  ✓ landed on block_b at y≈78' : `  ✗ expected y≈78, got ${s.player.y}`);

console.log('\n=== test 3: block_c slides under player (offset = -800) ===');
await setOffset(-800);
await page.waitForTimeout(800);
s = await snap();
console.log('after offset shift:', 'player.y=' + s.player.y, 'vy=' + s.vy,
            'on_ground=' + s.on_ground, 'block_c.x=' + s.block_c.x);
const landedOnC = Math.abs(s.player.y - 108) < 4;
console.log(landedOnC ? '  ✓ landed on block_c at y≈108' : `  ✗ expected y≈108, got ${s.player.y}`);

console.log('\n=== test 4: walk off block → fall to ground (offset = 0) ===');
await setOffset(0);  // all blocks back to original positions, none under player
await page.waitForTimeout(1500);  // gravity pulls player down
s = await snap();
console.log('after offset reset:', 'player.y=' + s.player.y, 'vy=' + s.vy, 'on_ground=' + s.on_ground);
const fellToGround = Math.abs(s.player.y - (-40)) < 4;
console.log(fellToGround ? '  ✓ fell back to ground y=-40' : `  ✗ expected y≈-40, got ${s.player.y}`);

console.log('\npageErrors:', errs.length);
if (errs.length) for (const e of errs.slice(0, 5)) console.log(' -', e);

await b.close();
