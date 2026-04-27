// Shared boot + fixture-load helpers for headless runtime scripts.
//
// Replaces ~30-line boilerplate duplicated across inspect.mjs and verify-*.mjs.
// The editor server (npm start) must be running at BASE_URL before calling
// bootEditor().
//
// Typical usage:
//   import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
//   const { browser, page, pageErrors } = await bootEditor();
//   try {
//       await loadFixture(page, 'tests/fixtures/foo.ent');
//       // ... runtime assertions via page.evaluate ...
//   } finally { await browser.close(); }

import { chromium } from '@playwright/test';
import fs from 'node:fs';

export const DEFAULT_BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Launch a chromium page pointed at the offline Entry editor, collect page
// errors into an array, and wait for the Entry global to be reachable.
//
// Returns { browser, page, pageErrors }. Caller owns browser lifecycle.
// Throws on editor reachability failure with a human-friendly message.
export async function bootEditor({
    baseUrl = DEFAULT_BASE_URL,
    viewport = { width: 1280, height: 800 },
    settleMs = 2500,
} = {}) {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    try {
        await page.goto(`${baseUrl}/editor.html`);
        await page.waitForFunction(() => typeof Entry !== 'undefined', null, { timeout: 15_000 });
        await page.waitForTimeout(settleMs);
    } catch (e) {
        await browser.close();
        throw new Error(
            `editor unreachable at ${baseUrl} — start with \`npm start\` first. ` +
            `(${e.message})`
        );
    }
    return { browser, page, pageErrors };
}

// POST a fixture via /api/load, call Entry.clearProject() + Entry.loadProject(),
// and wait for the stage to settle. Returns the browser-side result object
// (always { ok: true } on success; throws on non-2xx from /api/load).
export async function loadFixture(page, fixturePath, { loadSettleMs = 1500 } = {}) {
    const bytes = Array.from(fs.readFileSync(fixturePath));
    const res = await page.evaluate(async ({ bytes, settleMs }) => {
        const blob = new Blob([new Uint8Array(bytes)]);
        const fd = new FormData();
        fd.append('ent', blob, 'x.ent');
        const r = await fetch('/api/load', { method: 'POST', body: fd });
        if (!r.ok) return { ok: false, status: r.status };
        const project = await r.json();
        Entry.clearProject();
        Entry.loadProject(project);
        await new Promise((res) => setTimeout(res, settleMs));
        return { ok: true };
    }, { bytes, settleMs: loadSettleMs });
    if (!res.ok) {
        throw new Error(`/api/load failed (status ${res.status}) for ${fixturePath}`);
    }
    return res;
}
