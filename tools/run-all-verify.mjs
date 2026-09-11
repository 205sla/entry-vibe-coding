#!/usr/bin/env node
// Discover tools/verify-*.mjs and games/**/verify*.mjs before starting a server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFile } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const activeChildren = new Set();
const EXCLUSIONS = new Map([
    ['tools/verify-case-study-evidence.mjs', 'requires --source and --evidence; see knowledge/evidence/README.md'],
    ['tools/verify-audio-offline.mjs', 'requires an installed official Entry app and --entry-exe; see knowledge/15-audio-verification.md'],
]);

export function discoverScripts(root = ROOT) {
    const scripts = [], excluded = [];
    function scan(directory, recursive) {
        if (!fs.existsSync(path.join(root, directory))) return;
        for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
            const relative = directory + '/' + entry.name;
            if (entry.isDirectory() && recursive && !['node_modules', '.git', 'test-results'].includes(entry.name)) scan(relative, true);
            if (!entry.isFile() || !/^verify(?:-.+)?\.mjs$/.test(entry.name)) continue;
            if (EXCLUSIONS.has(relative)) excluded.push({ script: relative, reason: EXCLUSIONS.get(relative) });
            else scripts.push(relative);
        }
    }
    scan('tools', false);
    scan('games', true);
    return { scripts: scripts.sort(), excluded };
}

async function stopChild(proc) {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    if (proc.connected) {
        proc.send({ type: 'shutdown' });
        await new Promise(resolve => {
            const timer = setTimeout(resolve, 2000);
            proc.once('exit', () => { clearTimeout(timer); resolve(); });
        });
        if (proc.exitCode !== null) return;
    }
    if (process.platform === 'win32') {
        await new Promise(resolve => execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, error => {
            if (error) proc.kill('SIGKILL');
            resolve();
        }));
    } else proc.kill('SIGKILL');
}

export function runScript(script, { root = ROOT, timeoutMs = 600_000 } = {}) {
    return new Promise(resolve => {
        const started = Date.now();
        const proc = spawn(process.execPath, [script], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        activeChildren.add(proc);
        let out = '', timedOut = false;
        const append = data => { out = (out + data).slice(-256_000); };
        proc.stdout.on('data', append);
        proc.stderr.on('data', append);
        const timer = setTimeout(() => { timedOut = true; void stopChild(proc); }, timeoutMs);
        proc.once('error', error => { append(error.message); });
        proc.once('close', code => {
            activeChildren.delete(proc);
            clearTimeout(timer);
            resolve({ script, code: timedOut ? 124 : (code ?? 1), ms: Date.now() - started, out, timedOut });
        });
    });
}

export async function main(args = process.argv.slice(2)) {
    const option = name => {
        const index = args.indexOf(name);
        if (index < 0) return null;
        if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(name + ' requires a value');
        return args[index + 1];
    };
    const filter = option('--filter');
    const timeoutMs = Number(option('--timeout-ms') || 600_000);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('invalid --timeout-ms');
    const found = discoverScripts();
    const scripts = found.scripts.filter(script => !filter || script.includes(filter));
    if (!scripts.length) throw new Error('no verify scripts matched: ' + (filter || 'none'));
    for (const item of found.excluded) console.log('[runner] excluded ' + item.script + ': ' + item.reason);
    if (args.includes('--list')) {
        console.log(scripts.join('\n') + '\n[runner] total: ' + scripts.length);
        return 0;
    }
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    await browser.close();
    const baseURL = process.env.BASE_URL || 'http://localhost:3000';
    async function isUp() {
        try { return (await fetch(baseURL + '/editor.html', { signal: AbortSignal.timeout(2000) })).ok; }
        catch { return false; }
    }
    let server, serverError, serverReady = false;
    const interrupted = () => { void Promise.all([...activeChildren, server].map(stopChild)).finally(() => process.exit(130)); };
    process.once('SIGINT', interrupted);
    process.once('SIGTERM', interrupted);
    try {
        if (!await isUp()) {
            const address = new URL(baseURL);
            if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)) throw new Error('remote editor unavailable: ' + baseURL);
            server = spawn(process.execPath, ['server.js'], {
                cwd: ROOT, env: { ...process.env, PORT: address.port || '80' }, windowsHide: true,
                stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
            });
            server.on('error', error => { serverError = error; });
            server.stderr.on('data', () => {});
            for (let attempt = 0; attempt < 40; attempt++) {
                if (serverError) throw serverError;
                if (await isUp()) break;
                if (server.exitCode !== null) throw new Error('editor server exited: ' + server.exitCode);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            if (!await isUp()) throw new Error('editor server did not start');
            serverReady = true;
        }
        const results = [];
        for (const script of scripts) {
            const result = await runScript(script, { timeoutMs });
            results.push(result);
            console.log((result.code === 0 ? 'PASS ' : 'FAIL ') + script + ' (' + (result.ms / 1000).toFixed(1) + 's)');
            if (result.code !== 0) console.log((result.timedOut ? 'Timed out\n' : '') + result.out.split('\n').slice(-30).join('\n'));
        }
        const failed = results.filter(result => result.code !== 0).length;
        console.log('[runner] passed: ' + (results.length - failed) + ', failed: ' + failed);
        return failed ? 1 : 0;
    } finally {
        process.removeListener('SIGINT', interrupted);
        process.removeListener('SIGTERM', interrupted);
        if (!args.includes('--keep-server') || !serverReady) await stopChild(server);
        else if (server) { server.stderr.destroy(); server.disconnect(); server.unref(); }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().then(code => { process.exitCode = code; }).catch(error => {
        console.error('[runner] ' + error.message);
        process.exitCode = 1;
    });
}
