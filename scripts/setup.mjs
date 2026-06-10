#!/usr/bin/env node
// One-shot setup: populate `public/lib/` and `public/images/` with everything
// the offline Entry editor needs to boot. Safe to re-run (idempotent).
//
// Designed to work on a PURE EXTERNAL CLONE (no sibling repos, no entrylabs
// account). Nothing is ever compiled — entryjs dist comes prebuilt from npm.
//
// Source priority for each asset:
//   1. Sibling clone (../entryjs with dist/, ../MYentry) — dev machine, zero network
//   2. npm registry — @entrylabs/entry ships prebuilt dist/ + extern/ + images/
//   3. GitHub dist branches (entrylabs/entry-tool, entrylabs/legacy-video)
//   4. Static file download (entry-paint / entry-lms / sound-editor — no public
//      repo, but the built files are served by playentry.org / code.205.kr)
//
// Usage:
//   npm run setup                        # full setup
//   npm run setup -- --skip-vendor       # skip vendor npm install (faster re-run)
//   npm run setup -- --with-entryjs-src  # also clone entryjs SOURCE to ../entryjs
//                                        # (only needed for build:registry / source ground-truth)
//   npm run setup -- --entry-version=4.0.20   # override pinned @entrylabs/entry version

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

// Pinned @entrylabs/entry npm version. The npm package ships the SAME prebuilt
// dist/ + extern/ + images/ that playentry.org runs — no webpack build needed,
// ever. Bump deliberately; after bumping run `npm run build:registry` if block
// APIs changed (needs --with-entryjs-src) and re-run `npm run verify`.
const ENTRY_NPM_VERSION_DEFAULT = '4.0.20';

// Static-file fallbacks for entrylabs packages that have no public repo/npm.
// These exact files are what public/editor.html loads; playentry.org serves
// them statically (and code.205.kr mirrors them, incl. sound-editor which
// playentry does not expose at this path).
const PLAYENTRY = 'https://playentry.org/lib/';
const CODE205   = 'https://code.205.kr/lib/';
const FILE_FALLBACKS = {
    'entry-paint':  [
        { rel: 'dist/static/js/entry-paint.js', sources: [PLAYENTRY, CODE205] },
    ],
    'entry-lms': [
        { rel: 'dist/assets/app.js',  sources: [PLAYENTRY, CODE205] },
        { rel: 'dist/assets/app.css', sources: [PLAYENTRY, CODE205] },
    ],
    'sound-editor': [
        { rel: 'sound-editor.js', sources: [CODE205, PLAYENTRY] },
    ],
    // Normally cloned from GitHub dist branches; files listed as last-resort.
    'entry-tool': [
        { rel: 'dist/entry-tool.js',  sources: [PLAYENTRY, CODE205] },
        { rel: 'dist/entry-tool.css', sources: [PLAYENTRY, CODE205] },
    ],
    'legacy-video': [
        { rel: 'index.js', sources: [CODE205] },
    ],
};

const ARGS  = process.argv.slice(2);
const FLAGS = new Set(ARGS.filter(a => !a.includes('=')));
const OPTS  = Object.fromEntries(ARGS.filter(a => a.includes('=')).map(a => {
    const [k, v] = a.split('=');
    return [k.replace(/^--/, ''), v];
}));
const ENTRY_NPM_VERSION = OPTS['entry-version'] || ENTRY_NPM_VERSION_DEFAULT;
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

// ---------- network ----------

async function downloadFile(urlStr, dest) {
    const res = await fetch(urlStr, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${urlStr}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return buf.length;
}

async function downloadWithFallback(relUnderLib, sources, dest) {
    let lastErr;
    for (const base of sources) {
        try {
            const n = await downloadFile(base + relUnderLib, dest);
            return { url: base + relUnderLib, bytes: n };
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('no sources for ' + relUnderLib);
}

// ---------- sibling vs GitHub vs npm ----------

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

// Fetch the prebuilt @entrylabs/entry npm tarball (dist/ + extern/ + images/),
// extract into .setup-cache/entry-npm/package. NO compilation involved.
function ensureEntryNpmArtifact() {
    const pkgDir = path.join(CACHE, 'entry-npm', 'package');
    if (fs.existsSync(path.join(pkgDir, 'dist', 'entry.min.js'))) return pkgDir;

    fs.mkdirSync(path.join(CACHE, 'entry-npm'), { recursive: true });
    const tgz = path.join(CACHE, `entrylabs-entry-${ENTRY_NPM_VERSION}.tgz`);
    if (!fs.existsSync(tgz)) {
        // ~87 MB download; npm uses its local cache when possible.
        execFileSync('npm', ['pack', `@entrylabs/entry@${ENTRY_NPM_VERSION}`,
            '--pack-destination', CACHE, '--loglevel=error'],
        { stdio: ['ignore', 'ignore', 'inherit'], shell: IS_WIN });
    }
    // tar ships with Windows 10+, macOS, Linux.
    execFileSync('tar', ['-xzf', tgz, '-C', path.join(CACHE, 'entry-npm')],
        { stdio: ['ignore', 'ignore', 'inherit'] });
    if (!fs.existsSync(path.join(pkgDir, 'dist', 'entry.min.js'))) {
        throw new Error('npm artifact extracted but dist/entry.min.js missing');
    }
    return pkgDir;
}

// Where do entryjs dist/extern/images come from?
//   1. sibling ../entryjs IF it actually has a built dist (dev machines)
//   2. npm @entrylabs/entry prebuilt artifact (everyone else)
// A source-only ../entryjs (no dist/) is NOT an error and does NOT mean you
// should build it — the npm artifact is used instead.
function resolveEntryAssetSource() {
    if (fs.existsSync(path.join(ENTRYJS, 'dist', 'entry.min.js'))) {
        return { dir: ENTRYJS, note: 'sibling ' + ENTRYJS };
    }
    const pkgDir = ensureEntryNpmArtifact();
    return { dir: pkgDir, note: `npm @entrylabs/entry@${ENTRY_NPM_VERSION} (prebuilt)` };
}

// Optional: entryjs SOURCE tree at ../entryjs. Only build:registry and the
// knowledge docs' source citations need it — the editor does not.
async function ensureEntryjsSrc() {
    if (fs.existsSync(path.join(ENTRYJS, 'src'))) return { note: 'sibling ' + ENTRYJS };
    fs.mkdirSync(CACHE, { recursive: true });
    const cached = path.join(CACHE, 'entryjs');
    if (!fs.existsSync(cached)) {
        gitClone('https://github.com/entrylabs/entryjs.git', cached);
    }
    if (!fs.existsSync(ENTRYJS)) fs.symlinkSync(cached, ENTRYJS, 'junction');
    return { note: 'cloned to cache (source only — never build it; dist comes from npm)' };
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

async function copyEntryAssets() {
    const src = resolveEntryAssetSource();
    await cpDir(path.join(src.dir, 'dist'),   path.join(ROOT, 'public/lib/entry-js/dist'));
    await cpDir(path.join(src.dir, 'extern'), path.join(ROOT, 'public/lib/entry-js/extern'));
    // Entry references both /images/ and /lib/entry-js/images/ at runtime.
    await cpDir(path.join(src.dir, 'images'), path.join(ROOT, 'public/lib/entry-js/images'));
    await cpDirMerge(path.join(src.dir, 'images'), path.join(ROOT, 'public/images'));
    return { note: src.note };
}

async function linkExternalModules() {
    const modules = ['entry-tool', 'entry-paint', 'entry-lms', 'sound-editor', 'legacy-video'];
    const notes = [];
    const failed = [];
    for (const m of modules) {
        const dst = path.join(ROOT, 'public/lib', m);
        if (fs.existsSync(dst)) { notes.push(`${m}: present`); continue; }

        // 1. Sibling MYentry copy (dev machines) — junction, zero network.
        if (fs.existsSync(MYENTRY)) {
            const siblingSrc = path.join(MYENTRY, 'public/lib', m);
            if (fs.existsSync(siblingSrc)) {
                ensureSymlinkDir(siblingSrc, dst);
                notes.push(`${m}: sibling`);
                continue;
            }
        }
        // 2. Public GitHub dist branches.
        try {
            if (m === 'entry-tool')   { await fetchEntryTool(dst);  notes.push(`${m}: github`); continue; }
            if (m === 'legacy-video') { await fetchLegacyVideo(dst); notes.push(`${m}: github`); continue; }
        } catch (e) {
            // fall through to static-file download
        }
        // 3. Static-file download (playentry.org / code.205.kr serve the builds).
        const files = FILE_FALLBACKS[m] || [];
        try {
            for (const f of files) {
                await downloadWithFallback(`${m}/${f.rel}`, f.sources, path.join(dst, f.rel));
            }
            notes.push(`${m}: downloaded`);
        } catch (e) {
            failed.push(`${m} (${e.message})`);
        }
    }
    if (failed.length) {
        throw new Error(
            'Could not obtain: ' + failed.join(', ') +
            '\n    Check network access to playentry.org / code.205.kr, then re-run `npm run setup`.'
        );
    }
    return { note: notes.join(', ') };
}

async function copyMYentryAssets() {
    if (!fs.existsSync(MYENTRY)) return { note: 'no sibling — repo-bundled mascot/cursor used' };
    const mascot = path.join(MYENTRY, 'public/images/mascot');
    if (fs.existsSync(mascot)) {
        await cpDir(mascot, path.join(ROOT, 'public/images/mascot'));
    }
    const media = path.join(MYENTRY, 'public/media');
    if (fs.existsSync(media)) {
        await cpDir(media, path.join(ROOT, 'public/media'));
    }
    return { note: 'mascot + media refreshed from sibling' };
}

// Final gate: every file editor.html <script>/<link> needs, plus key assets.
// If this passes, `npm start` + headless verify WILL boot.
async function verifyBootFiles() {
    const required = [
        'public/lib/entry-js/dist/entry.min.js',
        'public/lib/entry-js/dist/entry.min.css',
        'public/lib/entry-js/extern/lang/ko.js',
        'public/lib/entry-js/extern/util/static.js',
        'public/lib/entry-tool/dist/entry-tool.js',
        'public/lib/entry-tool/dist/entry-tool.css',
        'public/lib/entry-paint/dist/static/js/entry-paint.js',
        'public/lib/entry-lms/dist/assets/app.js',
        'public/lib/entry-lms/dist/assets/app.css',
        'public/lib/sound-editor/sound-editor.js',
        'public/lib/legacy-video/index.js',
        'public/lib/vendor/jquery.min.js',
        'public/lib/vendor/preloadjs-0.6.0.min.js',
        'public/images/mascot/bot205-idle.svg',
    ];
    const missing = required.filter(r => !fs.existsSync(path.join(ROOT, r)));
    if (missing.length) {
        throw new Error('boot files missing:\n      - ' + missing.join('\n      - '));
    }
    return { note: `${required.length} boot files present` };
}

// ---------- main ----------

async function main() {
    log('\n[MYentry-game] setup starting' +
        (FLAGS.has('--with-entryjs-src') ? ' (+entryjs src)' : '') + '\n');

    if (!which('git')) {
        console.error(errMark('git command not found on PATH — required for fetching entry-tool/legacy-video.'));
        process.exit(1);
    }

    await step('entryjs dist + extern + images',          copyEntryAssets);
    if (FLAGS.has('--with-entryjs-src')) {
        await step('entryjs source tree (../entryjs)',    ensureEntryjsSrc);
    }
    await step('external modules (tool/paint/lms/…)',     linkExternalModules);
    await step('refresh mascot + cursor from sibling',    copyMYentryAssets);

    if (!FLAGS.has('--skip-vendor')) {
        await step('npm install vendor libs',             installVendor);
        await step('copy vendor lib dist files',          copyVendorFiles);
        await step('patch preload-js (module.exports)',   patchPreloadjs);
    } else {
        log('  (--skip-vendor): vendor install skipped');
    }

    await step('verify editor boot files',                verifyBootFiles);

    log('\n' + okMark('setup complete.'));
    log('    npm start                → editor at http://localhost:3000');
    log('    npx playwright install chromium   (once, for headless verify)');
    log('    npm run verify           → smoke + links + e2e + runtime\n');
}

main().catch(() => {
    console.error('\n' + errMark('setup failed — fix the issue above and re-run `npm run setup` (idempotent).'));
    process.exit(1);
});
