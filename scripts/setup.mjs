#!/usr/bin/env node
// One-shot setup: populate `public/lib/` and `public/images/` with everything
// the offline Entry editor needs to boot. Safe to re-run (idempotent).
//
// Source priority for each asset:
//   1. Sibling clone (../entryjs, ../MYentry) — preferred, zero network
//   2. GitHub fetch (for entrylabs/entryjs, entrylabs/entry-tool, entrylabs/legacy-video)
//   3. Clear error with instructions (for entrylabs/entry-paint, entry-lms, sound-editor —
//      these packages are not publicly mirrored on GitHub; needs a local MYentry copy)
//
// Usage:
//   npm run setup                    # full setup
//   npm run setup -- --skip-vendor   # skip vendor npm install (faster re-run)

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const CACHE     = path.join(ROOT, '.setup-cache');
const ENTRYJS   = path.resolve(ROOT, '..', 'entryjs');
const MYENTRY   = path.resolve(ROOT, '..', 'MYentry');

const FLAGS = new Set(process.argv.slice(2));
const IS_WIN = process.platform === 'win32';

function log(msg) { console.log(msg); }
function okMark(s) { return '\x1b[32m✓\x1b[0m ' + s; }
function errMark(s) { return '\x1b[31m✗\x1b[0m ' + s; }

async function step(label, fn) {
    process.stdout.write('  ' + label.padEnd(48) + '… ');
    try {
        const r = await fn();
        process.stdout.write('\x1b[32mOK\x1b[0m');
        if (r && r.note) process.stdout.write('  \x1b[90m(' + r.note + ')\x1b[0m');
        process.stdout.write('\n');
    } catch (e) {
        process.stdout.write('\x1b[31mFAIL\x1b[0m\n');
        console.log('    ' + errMark(e.message));
        throw e;
    }
}

// ---------- file ops ----------

async function cpDir(src, dst) {
    await fsp.cp(src, dst, { recursive: true, force: true });
}

async function cpDirMerge(src, dst) {
    // Node's cp with recursive + force merges (doesn't remove dst items not in src)
    await fsp.cp(src, dst, { recursive: true, force: true });
}

function ensureSymlinkDir(src, dst) {
    if (fs.existsSync(dst)) {
        const st = fs.lstatSync(dst);
        if (st.isSymbolicLink() || st.isDirectory()) return 'already present';
        fs.rmSync(dst, { recursive: true, force: true });
    }
    try {
        // Node's 'junction' type creates a Windows directory junction when on Windows,
        // a regular symlink on POSIX — zero admin rights needed.
        fs.symlinkSync(src, dst, 'junction');
        return 'junction';
    } catch {
        // Fallback: hard copy (last resort; wastes disk)
        fsCpSync(src, dst);
        return 'copied';
    }
}

function fsCpSync(src, dst) {
    fs.cpSync(src, dst, { recursive: true, force: true });
}

// ---------- sibling vs GitHub ----------

function which(cmd) {
    const r = spawnSync(IS_WIN ? 'where' : 'which', [cmd], { encoding: 'utf8' });
    return r.status === 0;
}

function gitClone(url, dest, { branch, depth = 1 } = {}) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const args = ['clone', '--depth', String(depth)];
    if (branch) args.push('--branch', branch);
    args.push(url, dest);
    execFileSync('git', args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

async function ensureEntryjs() {
    if (fs.existsSync(ENTRYJS)) return { note: 'sibling ' + ENTRYJS };
    fs.mkdirSync(CACHE, { recursive: true });
    const cached = path.join(CACHE, 'entryjs');
    if (!fs.existsSync(cached)) {
        gitClone('https://github.com/entrylabs/entryjs.git', cached);
    }
    // Make the sibling path usable
    fs.symlinkSync(cached, ENTRYJS, 'junction');
    return { note: 'cloned to cache' };
}

async function fetchEntryTool(dst) {
    const cached = path.join(CACHE, 'entry-tool');
    if (!fs.existsSync(cached)) {
        gitClone('https://github.com/entrylabs/entry-tool.git', cached, { branch: 'dist/develop' });
    }
    ensureSymlinkDir(cached, dst);
}

async function fetchLegacyVideo(dst) {
    const cached = path.join(CACHE, 'legacy-video');
    if (!fs.existsSync(cached)) {
        gitClone('https://github.com/entrylabs/legacy-video.git', cached);
    }
    ensureSymlinkDir(cached, dst);
}

// ---------- vendor libs ----------

const VENDOR_PKG = {
    name: 'vendor-install',
    version: '1.0.0',
    private: true,
    dependencies: {
        'jquery': '3.7.1',
        'jquery-ui-dist': '1.13.3',
        'lodash': '4.17.21',
        'underscore': '1.8.3',
        'preload-js': '0.6.3',
        'easeljs': '1.0.2',
        'soundjs': '1.0.1',
        'velocity-animate': '1.5.2',
        'codemirror': '5.12.0',
        'fuzzy': '0.1.3',
        'react': '18.3.1',
        'react-dom': '18.3.1',
        'socket.io-client': '2.5.0',
    },
};

async function installVendor() {
    const vi = path.join(ROOT, 'vendor-install');
    fs.mkdirSync(vi, { recursive: true });
    fs.writeFileSync(path.join(vi, 'package.json'), JSON.stringify(VENDOR_PKG, null, 2));
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'],
        { cwd: vi, stdio: 'inherit', shell: IS_WIN });
}

async function copyVendorFiles() {
    const VD = path.join(ROOT, 'public/lib/vendor');
    const NM = path.join(ROOT, 'vendor-install/node_modules');
    fs.mkdirSync(path.join(VD, 'codemirror/lib'), { recursive: true });
    fs.mkdirSync(path.join(VD, 'codemirror/addon/hint'), { recursive: true });
    fs.mkdirSync(path.join(VD, 'codemirror/addon/lint'), { recursive: true });
    fs.mkdirSync(path.join(VD, 'codemirror/addon/selection'), { recursive: true });
    fs.mkdirSync(path.join(VD, 'codemirror/mode/javascript'), { recursive: true });

    const pairs = [
        ['jquery/dist/jquery.min.js',                           'jquery.min.js'],
        ['jquery-ui-dist/jquery-ui.min.js',                     'jquery-ui.min.js'],
        ['jquery-ui-dist/jquery-ui.min.css',                    'jquery-ui.min.css'],
        ['lodash/lodash.min.js',                                'lodash.min.js'],
        ['underscore/underscore-min.js',                        'underscore-min.js'],
        ['preload-js/index.js',                                 'preloadjs-0.6.0.min.js'],
        ['easeljs/lib/easeljs.min.js',                          'easeljs-0.8.0.min.js'],
        ['soundjs/lib/soundjs.min.js',                          'soundjs-0.6.0.min.js'],
        ['soundjs/lib/flashaudioplugin.min.js',                 'flashaudioplugin-0.6.0.min.js'],
        ['velocity-animate/velocity.min.js',                    'velocity.min.js'],
        ['codemirror/lib/codemirror.js',                        'codemirror/lib/codemirror.js'],
        ['codemirror/lib/codemirror.css',                       'codemirror/lib/codemirror.css'],
        ['codemirror/addon/hint/show-hint.js',                  'codemirror/addon/hint/show-hint.js'],
        ['codemirror/addon/hint/show-hint.css',                 'codemirror/addon/hint/show-hint.css'],
        ['codemirror/addon/hint/javascript-hint.js',            'codemirror/addon/hint/javascript-hint.js'],
        ['codemirror/addon/lint/lint.js',                       'codemirror/addon/lint/lint.js'],
        ['codemirror/addon/lint/lint.css',                      'codemirror/addon/lint/lint.css'],
        ['codemirror/addon/selection/active-line.js',           'codemirror/addon/selection/active-line.js'],
        ['codemirror/mode/javascript/javascript.js',            'codemirror/mode/javascript/javascript.js'],
        ['fuzzy/lib/fuzzy.js',                                  'fuzzy.js'],
        ['react/umd/react.production.min.js',                   'react.production.min.js'],
        ['react-dom/umd/react-dom.production.min.js',           'react-dom.production.min.js'],
        ['socket.io-client/dist/socket.io.js',                  'socket.io.js'],
    ];
    for (const [src, dst] of pairs) {
        const s = path.join(NM, src);
        const d = path.join(VD, dst);
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(s, d);
    }
}

async function patchPreloadjs() {
    // npm `preload-js@0.6.3` ends with `;module.exports=window.createjs;` which
    // throws `ReferenceError: module is not defined` in the browser.
    // Strip the suffix once, idempotent.
    const p = path.join(ROOT, 'public/lib/vendor/preloadjs-0.6.0.min.js');
    let src = fs.readFileSync(p, 'utf8');
    if (!/module\.exports/.test(src)) return { note: 'already patched' };
    src = src.replace(/;module\.exports=[^;]*;\s*$/, ';');
    fs.writeFileSync(p, src);
    return {};
}

// ---------- steps ----------

async function copyEntryjsAssets() {
    await cpDir(path.join(ENTRYJS, 'dist'),   path.join(ROOT, 'public/lib/entry-js/dist'));
    await cpDir(path.join(ENTRYJS, 'extern'), path.join(ROOT, 'public/lib/entry-js/extern'));
    // Entry references both /images/ and /lib/entry-js/images/ at runtime.
    await cpDir(path.join(ENTRYJS, 'images'), path.join(ROOT, 'public/lib/entry-js/images'));
    await cpDirMerge(path.join(ENTRYJS, 'images'), path.join(ROOT, 'public/images'));
}

async function linkExternalModules() {
    const modules = ['entry-tool', 'entry-paint', 'entry-lms', 'sound-editor', 'legacy-video'];
    const missing = [];
    for (const m of modules) {
        const dst = path.join(ROOT, 'public/lib', m);
        if (fs.existsSync(dst)) continue;

        if (fs.existsSync(MYENTRY)) {
            const siblingSrc = path.join(MYENTRY, 'public/lib', m);
            if (fs.existsSync(siblingSrc)) {
                ensureSymlinkDir(siblingSrc, dst);
                continue;
            }
        }
        // Try public GitHub mirrors for modules that have them.
        if (m === 'entry-tool') { await fetchEntryTool(dst); continue; }
        if (m === 'legacy-video') { await fetchLegacyVideo(dst); continue; }
        missing.push(m);
    }
    if (missing.length) {
        throw new Error(
            'Missing modules with no public mirror: ' + missing.join(', ') +
            '\n    These are entrylabs internal packages. Obtain a local copy (e.g. sibling `../MYentry/public/lib/`) then re-run setup.'
        );
    }
}

async function copyMYentryAssets() {
    if (!fs.existsSync(MYENTRY)) return { note: 'MYentry sibling missing — skipped' };
    const mascot = path.join(MYENTRY, 'public/images/mascot');
    if (fs.existsSync(mascot)) {
        await cpDir(mascot, path.join(ROOT, 'public/images/mascot'));
    }
    const media = path.join(MYENTRY, 'public/media');
    if (fs.existsSync(media)) {
        await cpDir(media, path.join(ROOT, 'public/media'));
    }
    return { note: 'mascot + media copied' };
}

// ---------- main ----------

async function main() {
    log('\n[MYentry-game] setup starting\n');

    if (!which('git')) {
        console.error(errMark('git command not found on PATH — required for fetching entryjs.'));
        process.exit(1);
    }

    await step('ensure entryjs (sibling or clone)',  ensureEntryjs);
    await step('copy entryjs dist + extern + images', copyEntryjsAssets);
    await step('link external modules',               linkExternalModules);
    await step('copy MYentry mascot + cursor media',  copyMYentryAssets);

    if (!FLAGS.has('--skip-vendor')) {
        await step('npm install vendor libs',         installVendor);
        await step('copy vendor lib dist files',      copyVendorFiles);
        await step('patch preload-js (module.exports)', patchPreloadjs);
    } else {
        log('  (--skip-vendor): vendor install skipped');
    }

    log('\n' + okMark('setup complete. `npm start` to launch http://localhost:3000') + '\n');
}

main().catch(() => {
    console.error('\n' + errMark('setup failed'));
    process.exit(1);
});
