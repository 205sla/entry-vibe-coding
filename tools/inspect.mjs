#!/usr/bin/env node
// Unified inspector for `.ent` fixtures — replaces 14 ad-hoc scratch scripts.
// Loads a fixture into a headless browser with the offline Entry editor, then
// runs any of: state dump, screenshot, block-tree dump, click/key simulation,
// entity-position sampling.
//
// Usage:
//   node tools/inspect.mjs <fixture>              # default: state + [object Object] check
//   node tools/inspect.mjs <fixture> --screenshot
//   node tools/inspect.mjs <fixture> --blocks
//   node tools/inspect.mjs <fixture> --click N
//   node tools/inspect.mjs <fixture> --key CODE N
//   node tools/inspect.mjs <fixture> --watch N    # sample entity positions every 300ms × N
//
// Multiple flags combine. Server must be running (`npm start` or node tools/inspect.mjs --server).

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const BASE_URL  = process.env.BASE_URL || 'http://localhost:3000';

// ---------- CLI parsing ----------

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(`
inspect.mjs — load an .ent fixture and inspect runtime state

  node tools/inspect.mjs <fixture> [flags]

Fixture can be a name (e.g. "chase-hp") or full path.

Flags:
  --screenshot             save tools/inspect-<fixture>.png
  --blocks                 dump block tree for each object
  --click N                after load, dispatch entityClick N times (default: 10)
  --key CODE N             simulate N key press+release cycles.
                           CODE accepts W3C code ('ArrowRight', 'Space', 'KeyA')
                           or numeric keycode shorthand (37 ↔ ArrowLeft,
                           38 ↔ ArrowUp, 39 ↔ ArrowRight, 40 ↔ ArrowDown)
  --watch N                sample entity[0] x/y/direction every 300ms, N times
  --base-url URL           override http://localhost:3000
  --no-check-objobj        skip [object Object] check in SVG text
`);
    process.exit(0);
}

function takeArg(flag, n = 1) {
    const i = argv.indexOf(flag);
    if (i < 0) return null;
    const args = argv.slice(i + 1, i + 1 + n);
    argv.splice(i, 1 + n);
    return n === 1 ? args[0] : args;
}

const SHOT       = argv.includes('--screenshot');
const DUMP_BLOCKS = argv.includes('--blocks');
const NO_OBJOBJ  = argv.includes('--no-check-objobj');
const CLICK_N    = (() => { const v = takeArg('--click'); return v == null ? 0 : (+v || 10); })();
const KEY_ARGS   = (() => { const v = takeArg('--key', 2); return v == null ? null : { code: v[0], n: +v[1] || 1 }; })();
const WATCH_N    = (() => { const v = takeArg('--watch'); return v == null ? 0 : (+v || 5); })();
const BASE       = takeArg('--base-url') || BASE_URL;

// Fixture argument — last remaining positional
const positional = argv.filter(a => !a.startsWith('-'));
if (positional.length !== 1) {
    console.error('error: exactly one fixture argument required. use --help for usage.');
    process.exit(1);
}
let fixturePath = positional[0];
if (!fs.existsSync(fixturePath)) {
    // try tests/fixtures/<name>.ent
    const candidate = path.join(ROOT, 'tests/fixtures', fixturePath.endsWith('.ent') ? fixturePath : fixturePath + '.ent');
    if (fs.existsSync(candidate)) fixturePath = candidate;
    else { console.error(`error: fixture not found: ${fixturePath}`); process.exit(1); }
}
const fixtureName = path.basename(fixturePath, '.ent');

// ---------- Run ----------

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

try {
    await page.goto(`${BASE}/editor.html`);
    await page.waitForFunction(() => typeof Entry !== 'undefined', null, { timeout: 15_000 });
    await page.waitForTimeout(2500);
} catch {
    console.error('error: could not reach editor. is the server running at ' + BASE + '?');
    console.error('  start with: npm start  (or set BASE_URL env var)');
    await browser.close();
    process.exit(2);
}

// Load fixture
const bytes = Array.from(fs.readFileSync(fixturePath));
const loaded = await page.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)]);
    const fd = new FormData(); fd.append('ent', blob, 'x.ent');
    const res = await fetch('/api/load', { method: 'POST', body: fd });
    if (!res.ok) return { ok: false, status: res.status };
    const project = await res.json();
    Entry.clearProject();
    Entry.loadProject(project);
    await new Promise(r => setTimeout(r, 1500));
    return { ok: true };
}, bytes);
if (!loaded.ok) {
    console.error('error: /api/load failed', loaded);
    await browser.close();
    process.exit(3);
}

// ---------- Section: state dump ----------

const state = await page.evaluate(() => ({
    variables: Entry.variableContainer.variables_.map(v => ({
        name: v.name_, type: v.type, value: v.getValue(), visible: v.isVisible(),
    })),
    lists: Entry.variableContainer.lists_.map(l => ({
        name: l.name_, visible: l.isVisible(), isCloud: l.isCloud_,
        length: (l.array_ || []).length,
    })),
    messages: Entry.variableContainer.messages_.map(m => ({ id: m.id, name: m.name })),
    objects: Entry.container.getAllObjects().map(o => ({
        id: o.id, name: o.name, objectType: o.objectType,
        entity: { x: +o.entity.x.toFixed(2), y: +o.entity.y.toFixed(2),
                  direction: +o.entity.direction.toFixed(1), visible: o.entity.visible },
        threadCount: o.script.getThreads().length,
    })),
}));

console.log(`\n=== ${fixtureName}.ent — state ===`);
console.log(JSON.stringify(state, null, 2));

// ---------- Section: block dump ----------

if (DUMP_BLOCKS) {
    const blocks = await page.evaluate(() => {
        const out = [];
        for (const o of Entry.container.getAllObjects()) {
            const threads = o.script.getThreads().map(t => t.getBlocks().map(b => b.type));
            out.push({ id: o.id, threads });
        }
        return out;
    });
    console.log('\n=== block types per thread ===');
    console.log(JSON.stringify(blocks, null, 2));
}

// ---------- Section: toggleRun (for event simulation) ----------

if (CLICK_N > 0 || KEY_ARGS || WATCH_N > 0) {
    const runErr = await page.evaluate(() => {
        try { Entry.engine.toggleRun(); return null; }
        catch (e) { return e.message; }
    });
    if (runErr) console.log(`\n(toggleRun note: ${runErr} — event dispatch still works)`);
    await page.waitForTimeout(300);
}

// ---------- Section: click simulation ----------

if (CLICK_N > 0) {
    console.log(`\n=== simulating ${CLICK_N} clicks on object[0] ===`);
    for (let i = 1; i <= CLICK_N; i++) {
        // Dispatch first, then wait for the engine to run the resulting thread,
        // THEN read position. Reading synchronously after dispatch shows stale
        // state because the block scheduler runs on the next tick.
        await page.evaluate(() => {
            const entity = Entry.container.getAllObjects()[0].entity;
            Entry.dispatchEvent('entityClick', entity);
        });
        await page.waitForTimeout(100);
        const s = await page.evaluate(() => {
            const e = Entry.container.getAllObjects()[0].entity;
            return { x: +e.x.toFixed(2), y: +e.y.toFixed(2) };
        });
        console.log(`  click ${String(i).padStart(2)}  → x=${s.x}, y=${s.y}`);
    }
}

// ---------- Section: key simulation ----------

if (KEY_ARGS) {
    // Entry listens on `document` (not window) and reads `event.code` ('ArrowRight'
    // etc.), not `event.keyCode` (see entryjs/src/util/utils.js:860 inputToKeycode).
    // Map numeric keycodes to W3C code strings for common keys.
    const CODE_MAP = {
        '37': 'ArrowLeft', '38': 'ArrowUp', '39': 'ArrowRight', '40': 'ArrowDown',
        '32': 'Space', '13': 'Enter', '27': 'Escape',
    };
    const resolveCode = (raw) => CODE_MAP[raw] || (/^[A-Z]$/.test(raw) ? 'Key' + raw
        : /^[0-9]$/.test(raw) ? 'Digit' + raw : raw);
    const wsCode = resolveCode(String(KEY_ARGS.code));
    console.log(`\n=== simulating ${KEY_ARGS.n}× key '${wsCode}' ===`);
    for (let i = 1; i <= KEY_ARGS.n; i++) {
        await page.evaluate((code) => {
            document.dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));
            document.dispatchEvent(new KeyboardEvent('keyup',   { code, key: code }));
        }, wsCode);
        await page.waitForTimeout(100);
    }
}

// ---------- Section: position watch ----------

if (WATCH_N > 0) {
    console.log(`\n=== watching entity[0] position × ${WATCH_N} (300ms intervals) ===`);
    for (let i = 0; i < WATCH_N; i++) {
        const s = await page.evaluate(() => {
            const e = Entry.container.getAllObjects()[0].entity;
            return { x: +e.x.toFixed(2), y: +e.y.toFixed(2), dir: +e.direction.toFixed(1) };
        });
        console.log(`  t=${String(i * 300).padStart(5)}ms  x=${s.x}  y=${s.y}  dir=${s.dir}`);
        await page.waitForTimeout(300);
    }
}

// ---------- Section: [object Object] check ----------

if (!NO_OBJOBJ) {
    const bad = await page.$$eval('svg text', els =>
        els.map(e => e.textContent).filter(t => t.includes('[object Object]'))
    );
    console.log(`\n[object Object] count in workspace SVG: ${bad.length}`);
    if (bad.length) console.log('  samples:', bad.slice(0, 3));
}

// ---------- Section: pageErrors ----------

console.log(`\npageErrors: ${pageErrors.length}`);
if (pageErrors.length) for (const e of pageErrors.slice(0, 5)) console.log(' -', e);

// ---------- Section: screenshot ----------

if (SHOT) {
    const shotPath = path.join(__dirname, `inspect-${fixtureName}.png`);
    await page.screenshot({ path: shotPath });
    console.log(`\nscreenshot → ${path.relative(ROOT, shotPath)}`);
}

await browser.close();
