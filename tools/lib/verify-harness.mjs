// Shared verification primitives for tools/verify-*.mjs scripts.
//
// These wrap Entry runtime calls inside `page.evaluate` so verify scripts
// can read/write project state without re-implementing the boilerplate
// (and the gotchas: toggleStop is async, key dispatch needs document + event.code,
// engine state machine has stop/run/pause states, etc).
//
// Pair with `tools/lib/editor-harness.mjs` (boot + loadFixture).
//
// Usage:
//   import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
//   import { setVar, getVar, holdKey, runFresh, expect } from './lib/verify-harness.mjs';
//
//   const { browser, page } = await bootEditor();
//   await loadFixture(page, 'tests/fixtures/foo.ent');
//   await runFresh(page);
//   await setVar(page, 'hp', 3);
//   const hp = await getVar(page, 'hp');
//   ...

// ── Engine state ─────────────────────────────────────────────────

// Stop the engine (if running) and wait for the variable-snapshot restore to
// complete. toggleStop is async (engine.js:715 — `Promise.all` + `loadSnapshot`)
// — calling toggleRun before it resolves restores variables on top of new
// values you set, silently wiping them.
export async function stopEngine(page) {
    await page.evaluate(async () => {
        if (Entry.engine.state !== 'stop') {
            try { await Entry.engine.toggleStop(); } catch {}
        }
    });
    await page.waitForTimeout(100);
}

// Start the engine. Calling toggleRun while already running silently ignores;
// calling without prior stop after a run can fail to fire when_run_button_click.
// Always pair with a preceding stopEngine() if you've run before.
export async function runEngine(page) {
    await page.evaluate(() => {
        try { Entry.engine.toggleRun(); } catch {}
    });
}

// Convenience: stop, set variables, then run. Order matters because toggleStop
// restores variables to their pre-run snapshot, then toggleRun takes a NEW
// snapshot at start. Variables you want for THIS run must be set between.
//
//   await runFresh(page, { '입력 n': 10, '난이도': 3 });
export async function runFresh(page, vars = {}) {
    await stopEngine(page);
    for (const [name, value] of Object.entries(vars)) {
        await setVar(page, name, value);
    }
    await runEngine(page);
}

export async function getEngineState(page) {
    return page.evaluate(() => Entry.engine.state);
}

// ── Variables / lists ────────────────────────────────────────────

// Read a variable by display name (Entry stores names in v.name_).
// Returns the runtime value (Entry coerces; numbers come back as numbers,
// strings as strings).
export async function getVar(page, name) {
    return page.evaluate((n) => {
        const v = Entry.variableContainer.variables_.find(x => x.name_ === n);
        return v ? v.getValue() : undefined;
    }, name);
}

// Set a variable by display name. Useful to drive runtime state from outside
// (e.g. set hp=0 to trigger game-over without playing the game).
export async function setVar(page, name, value) {
    return page.evaluate(({ n, val }) => {
        const v = Entry.variableContainer.variables_.find(x => x.name_ === n);
        if (!v) throw new Error('variable not found: ' + n);
        v.setValue(val);
    }, { n: name, val: value });
}

// Read a list as a plain JS array (each item.data → array element, coerced if numeric).
export async function getList(page, name, { coerceNumeric = true } = {}) {
    return page.evaluate(({ n, coerce }) => {
        const l = Entry.variableContainer.lists_.find(x => x.name_ === n);
        if (!l) return null;
        return (l.array_ || []).map(item => {
            const v = item.data;
            if (coerce && /^-?\d+(\.\d+)?$/.test(String(v))) return +v;
            return v;
        });
    }, { n: name, coerce: coerceNumeric });
}

// ── Events ───────────────────────────────────────────────────────

// Dispatch a click on an object's entity. Bypasses canvas-coordinate math.
// Object can be referenced by id or by display name.
export async function clickObject(page, idOrName) {
    return page.evaluate((ref) => {
        const objs = Entry.container.getAllObjects();
        const obj = objs.find(o => o.id === ref) || objs.find(o => o.name === ref);
        if (!obj) throw new Error('object not found: ' + ref);
        Entry.dispatchEvent('entityClick', obj.entity);
    }, idOrName);
}

// Send a message (signal) by id. Wakes when_message_cast handlers on every entity.
export async function sendMessage(page, messageId) {
    return page.evaluate((id) => {
        Entry.engine.raiseMessage(id);
    }, messageId);
}

// Numeric keycode (Entry's pre-W3C convention) → W3C event.code string.
// Entry's runtime listens on `document` with `event.code`; `event.keyCode` is
// ignored. See knowledge/07-runtime-quirks.md §키 이벤트.
const KEY_CODE_MAP = {
    '37': 'ArrowLeft', '38': 'ArrowUp', '39': 'ArrowRight', '40': 'ArrowDown',
    '32': 'Space',     '13': 'Enter',   '27': 'Escape',
};

function resolveCode(raw) {
    const s = String(raw);
    if (KEY_CODE_MAP[s]) return KEY_CODE_MAP[s];
    if (/^[A-Z]$/.test(s)) return 'Key' + s;
    if (/^[0-9]$/.test(s)) return 'Digit' + s;
    return s;  // already a W3C code like 'ArrowRight'
}

// Press a key, hold for `ms`, release. Use for "tap right arrow" style inputs.
export async function holdKey(page, code, ms = 50) {
    const wsCode = resolveCode(code);
    await page.evaluate((c) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c }));
    }, wsCode);
    await page.waitForTimeout(ms);
    await page.evaluate((c) => {
        document.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c }));
    }, wsCode);
}

// Briefly tap a key (50ms default).
export async function tapKey(page, code) { return holdKey(page, code, 50); }

// ── Polling ──────────────────────────────────────────────────────

// Poll `read(page) → value` until predicate(value) is true or timeout expires.
// Returns the final value (or throws on timeout).
export async function waitFor(page, read, predicate, {
    timeoutMs = 10_000,
    intervalMs = 100,
    label = 'condition',
} = {}) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeoutMs) {
        last = await read(page);
        if (predicate(last)) return last;
        await page.waitForTimeout(intervalMs);
    }
    throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms — last value: ${JSON.stringify(last)}`);
}

// Convenience: wait for a variable to satisfy a predicate.
export async function waitForVar(page, name, predicate, opts = {}) {
    return waitFor(page, p => getVar(p, name), predicate, { label: `var:${name}`, ...opts });
}

// ── Pixel sampling ───────────────────────────────────────────────

// Find pixels matching `predicate(r, g, b, a)` on the largest canvas
// (typically Entry's stage). Returns count + bounding box + centroid.
export async function findPixels(page, predicate) {
    return page.evaluate((predFn) => {
        const fn = new Function('r', 'g', 'b', 'a', 'return (' + predFn + ')(r, g, b, a)');
        const cs = Array.from(document.querySelectorAll('canvas'))
            .filter(c => c.width >= 400 && c.height >= 200);
        if (!cs.length) return null;
        const c = cs[0];
        const ctx = c.getContext('2d');
        const img = ctx.getImageData(0, 0, c.width, c.height);
        let count = 0, sumX = 0, sumY = 0;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
                const i = (y * c.width + x) * 4;
                if (fn(img.data[i], img.data[i+1], img.data[i+2], img.data[i+3])) {
                    count++; sumX += x; sumY += y;
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
            }
        }
        return count === 0
            ? { count: 0, canvasW: c.width, canvasH: c.height }
            : {
                count, avgX: sumX / count, avgY: sumY / count,
                minX, maxX, minY, maxY,
                width: maxX - minX, height: maxY - minY,
                canvasW: c.width, canvasH: c.height,
            };
    }, predicate.toString());
}

// Convenience: count pixels where one channel dominates (e.g. greenish).
//   findColoredPixels(page, 'green') → roughly: g > 120, r/b < 120
//   findColoredPixels(page, 'red')   → r > 120, g/b < 120
//   findColoredPixels(page, 'blue')  → b > 120, r/g < 120
//   findColoredPixels(page, '#3b82f6') → near-match within tolerance 60
//
// Note: predicates use only their (r, g, b, a) args — closure values don't
// survive serialization through page.evaluate, so for hex matching we
// substitute the threshold numbers literally into the function source.
export async function findColoredPixels(page, color) {
    if (color === 'green') return findPixels(page, (r, g, b, a) => a > 100 && g > 120 && r < 120 && b < 120);
    if (color === 'red')   return findPixels(page, (r, g, b, a) => a > 100 && r > 120 && g < 120 && b < 120);
    if (color === 'blue')  return findPixels(page, (r, g, b, a) => a > 100 && b > 150 && r < 120 && g < 120);
    if (typeof color === 'string' && color.startsWith('#')) {
        const tr = parseInt(color.slice(1, 3), 16);
        const tg = parseInt(color.slice(3, 5), 16);
        const tb = parseInt(color.slice(5, 7), 16);
        // Build predicate string with thresholds inlined (closure won't serialize).
        const src = `(r, g, b, a) => a > 100 && Math.abs(r - ${tr}) < 60 && Math.abs(g - ${tg}) < 60 && Math.abs(b - ${tb}) < 60`;
        return findPixelsRaw(page, src);
    }
    throw new Error('findColoredPixels: unknown color spec ' + color);
}

// Variant of findPixels that accepts a predicate as a string (for closure-free
// substitution like hex thresholds). The string must be a valid arrow-function
// expression returning boolean.
async function findPixelsRaw(page, predFnSrc) {
    return page.evaluate((src) => {
        const fn = new Function('return (' + src + ')')();
        const cs = Array.from(document.querySelectorAll('canvas'))
            .filter(c => c.width >= 400 && c.height >= 200);
        if (!cs.length) return null;
        const c = cs[0];
        const ctx = c.getContext('2d');
        const img = ctx.getImageData(0, 0, c.width, c.height);
        let count = 0, sumX = 0, sumY = 0;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
                const i = (y * c.width + x) * 4;
                if (fn(img.data[i], img.data[i+1], img.data[i+2], img.data[i+3])) {
                    count++; sumX += x; sumY += y;
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
            }
        }
        return count === 0
            ? { count: 0, canvasW: c.width, canvasH: c.height }
            : {
                count, avgX: sumX / count, avgY: sumY / count,
                minX, maxX, minY, maxY,
                width: maxX - minX, height: maxY - minY,
                canvasW: c.width, canvasH: c.height,
            };
    }, predFnSrc);
}

// ── Mini-assertion helper ────────────────────────────────────────

// Lightweight expect-style logger that tracks pass/fail state. Saves verify
// scripts from re-implementing the same boilerplate.
//
//   const t = createReporter();
//   t.ok(x === 5, 'x is 5');
//   t.eq(actual, expected, 'fib(10)');
//   ...
//   process.exit(t.summary());
export function createReporter({ verbose = true } = {}) {
    let pass = 0, fail = 0;
    const log = (ok, msg) => {
        if (verbose) console.log(ok ? '  ✓' : '  ✗', msg);
        ok ? pass++ : fail++;
    };
    return {
        ok(cond, msg) { log(!!cond, msg); return cond; },
        eq(actual, expected, msg) {
            const ok = JSON.stringify(actual) === JSON.stringify(expected);
            log(ok, msg + (ok ? '' : ` (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`));
            return ok;
        },
        between(actual, min, max, msg) {
            const ok = actual >= min && actual <= max;
            log(ok, msg + (ok ? '' : ` (got ${actual}, expected [${min}, ${max}])`));
            return ok;
        },
        summary() {
            console.log(`\n${pass} passed, ${fail} failed`);
            return fail === 0 ? 0 : 4;
        },
        get passed() { return pass; },
        get failed() { return fail; },
    };
}
