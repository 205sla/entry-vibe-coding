#!/usr/bin/env node
// Run every tools/verify-*.mjs sequentially and aggregate results.
//
// Usage: node tools/run-all-verify.mjs [--keep-server] [--filter <substr>]
//
// Server lifecycle: if http://localhost:3000 isn't reachable, this script
// spawns `node server.js` as a child process and kills it on exit. Pass
// `--keep-server` to leave it running (useful when iterating manually).
//
// Each verify-*.mjs is run in its own node subprocess; their internals (own
// chromium instance, page lifecycle, etc.) are independent. Exit code:
//   0 — all scripts passed
//   1 — one or more failed (failure list printed at end)

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KEEP_SERVER = process.argv.includes('--keep-server');
const FILTER_IDX  = process.argv.indexOf('--filter');
const FILTER = FILTER_IDX >= 0 ? process.argv[FILTER_IDX + 1] : null;

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ── Server lifecycle ─────────────────────────────────────────────

async function isServerUp() {
    try {
        const res = await fetch(BASE_URL + '/editor.html', { signal: AbortSignal.timeout(2000) });
        return res.ok;
    } catch { return false; }
}

async function startServer() {
    const proc = spawn('node', ['server.js'], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });
    proc.stdout.on('data', () => {});  // discard
    proc.stderr.on('data', () => {});
    // Wait for ready (up to 20s)
    for (let i = 0; i < 40; i++) {
        if (await isServerUp()) return proc;
        await new Promise(r => setTimeout(r, 500));
    }
    proc.kill();
    throw new Error('server failed to become ready within 20s');
}

let ownsServer = false;
let serverProc = null;

if (await isServerUp()) {
    console.log(`[runner] using existing server at ${BASE_URL}`);
} else {
    console.log(`[runner] starting server...`);
    serverProc = await startServer();
    ownsServer = true;
    console.log(`[runner] server up at ${BASE_URL}`);
}

// ── Discover verify scripts ──────────────────────────────────────

const allScripts = fs.readdirSync(path.join(ROOT, 'tools'))
    .filter(n => /^verify-.*\.mjs$/.test(n))
    .sort()
    .map(n => path.join('tools', n));

const scripts = FILTER
    ? allScripts.filter(s => s.includes(FILTER))
    : allScripts;

if (scripts.length === 0) {
    console.error(`[runner] no verify scripts matched (filter: ${FILTER || 'none'})`);
    process.exit(1);
}

console.log(`[runner] running ${scripts.length} verify script${scripts.length === 1 ? '' : 's'}\n`);

// ── Run each script ──────────────────────────────────────────────

function runScript(script) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        // Capture stdout/stderr for failure reporting; print short status to runner stdout.
        const proc = spawn('node', [script], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        proc.stdout.on('data', (d) => { out += d.toString(); });
        proc.stderr.on('data', (d) => { out += d.toString(); });
        proc.on('exit', (code) => {
            resolve({ script, code, ms: Date.now() - t0, out });
        });
    });
}

const results = [];
for (const script of scripts) {
    process.stdout.write(`  ${script.padEnd(40)} `);
    const r = await runScript(script);
    const icon = r.code === 0 ? '✓' : '✗';
    console.log(`${icon} ${(r.ms / 1000).toFixed(1)}s (exit ${r.code})`);
    results.push(r);
}

// ── Cleanup server ────────────────────────────────────────────────

if (ownsServer && !KEEP_SERVER && serverProc) {
    serverProc.kill();
}

// ── Summary ──────────────────────────────────────────────────────

console.log('\n=== verify:runtime summary ===');
const passed = results.filter(r => r.code === 0);
const failed = results.filter(r => r.code !== 0);
console.log(`  passed: ${passed.length}`);
console.log(`  failed: ${failed.length}`);
console.log(`  total time: ${(results.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1)}s`);

if (failed.length > 0) {
    console.log('\n=== failure details ===');
    for (const r of failed) {
        console.log(`\n--- ${r.script} (exit ${r.code}) ---`);
        // Last ~30 lines of output where the failure usually is
        const lines = r.out.split('\n');
        const tail = lines.slice(Math.max(0, lines.length - 30)).join('\n');
        console.log(tail);
    }
}

process.exit(failed.length === 0 ? 0 : 1);
