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
//   3. GitHub dist branch (entrylabs/entry-tool)
//   4. Static file download (entry-paint / entry-lms / sound-editor / legacy-video —
//      no public build, but the built files are served by playentry.org / code.205.kr)
//
// Usage:
//   npm run setup                              # full setup
//   node scripts/setup.mjs --skip-vendor       # skip vendor npm install (faster re-run)
//   node scripts/setup.mjs --with-entryjs-src  # also clone entryjs SOURCE to ../entryjs
//                                              # (only needed for build:registry / source ground-truth)
//   node scripts/setup.mjs --entry-version=4.0.20  # override pinned @entrylabs/entry version
// (flags via `npm run setup -- --flag` get swallowed by PowerShell — call node directly)

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { installAudioVendors, verifyAudioVendors } from './setup-audio.mjs';
import { extractTar } from './lib/extract-tar.mjs';
import { checkBootFiles } from './lib/boot-files.mjs';

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
    // Normally cloned from the GitHub dist branch; files listed as last-resort.
    'entry-tool': [
        { rel: 'dist/entry-tool.js',  sources: [PLAYENTRY, CODE205] },
        { rel: 'dist/entry-tool.css', sources: [PLAYENTRY, CODE205] },
    ],
    // entrylabs/legacy-video on GitHub is SOURCE-only (no built index.js) —
    // download is the only cold-start path. playentry does not serve it.
    'legacy-video': [
        { rel: 'index.js', sources: [CODE205] },
    ],
};

// Files that prove a module is actually usable — every file editor.html loads
// from it, i.e. each FILE_FALLBACKS list. A git clone, junction or earlier
// half-finished download missing any of them (or leaving one empty) counts as a
// failed acquisition, so a missing app.css is fetched instead of skipped.
function moduleUsable(dir, m) {
    return FILE_FALLBACKS[m].every(f => {
        try { return fs.statSync(path.join(dir, f.rel)).size > 0; }
        catch { return false; }
    });
}

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
// The extracted copy is reused only when its package.json names the requested
// version — `--entry-version` must never be satisfied by another version's files.
function ensureEntryNpmArtifact() {
    const pkgDir = path.join(CACHE, 'entry-npm', 'package');
    const cachedVersion = (() => {
        try { return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version; }
        catch { return null; }
    })();
    if (cachedVersion === ENTRY_NPM_VERSION && fs.existsSync(path.join(pkgDir, 'dist', 'entry.min.js'))) return pkgDir;
    // Another version or a half-extracted copy — tar would merge into it, so start clean.
    fs.rmSync(pkgDir, { recursive: true, force: true });

    fs.mkdirSync(path.join(CACHE, 'entry-npm'), { recursive: true });
    const tgz = path.join(CACHE, `entrylabs-entry-${ENTRY_NPM_VERSION}.tgz`);
    if (!fs.existsSync(tgz)) {
        // ~87 MB download; npm uses its local cache when possible.
        execFileSync('npm', ['pack', `@entrylabs/entry@${ENTRY_NPM_VERSION}`,
            '--pack-destination', '.', '--loglevel=error'],
        { cwd: CACHE, stdio: ['ignore', 'ignore', 'inherit'], shell: IS_WIN });
    }
    extractTar(tgz, path.join(CACHE, 'entry-npm'));
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
        'easeljs': '1.0.2',
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
        ['easeljs/lib/easeljs.min.js',                          'easeljs-0.8.0.min.js'],
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
    const notes = [];
    const failed = [];
    for (const m of Object.keys(FILE_FALLBACKS)) {
        const dst = path.join(ROOT, 'public/lib', m);
        const usable = () => moduleUsable(dst, m);
        if (usable()) { notes.push(`${m}: present`); continue; }

        // dst exists but is unusable (broken junction, source-only clone, …) —
        // clear it so a working source can take its place. rmSync on a junction
        // removes only the link, never the target's contents.
        const dstStat = (() => { try { return fs.lstatSync(dst); } catch { return null; } })();
        if (dstStat) fs.rmSync(dst, { recursive: true, force: true });

        // 1. Sibling MYentry copy (dev machines) — junction, zero network.
        if (fs.existsSync(MYENTRY)) {
            const siblingSrc = path.join(MYENTRY, 'public/lib', m);
            if (fs.existsSync(siblingSrc)) {
                ensureSymlinkDir(siblingSrc, dst);
                if (usable()) { notes.push(`${m}: sibling`); continue; }
                fs.rmSync(dst, { recursive: true, force: true });
            }
        }
        // 2. Public GitHub dist branch (entry-tool only — legacy-video's repo is source-only).
        if (m === 'entry-tool') {
            try {
                await fetchEntryTool(dst);
                if (usable()) { notes.push(`${m}: github`); continue; }
                fs.rmSync(dst, { recursive: true, force: true });
            } catch { /* fall through to download */ }
        }
        // 3. Static-file download (playentry.org / code.205.kr serve the builds).
        try {
            for (const f of FILE_FALLBACKS[m] || []) {
                await downloadWithFallback(`${m}/${f.rel}`, f.sources, path.join(dst, f.rel));
            }
            if (usable()) { notes.push(`${m}: downloaded`); continue; }
            throw new Error('downloaded but required file still missing');
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

// Installed files are a prerequisite; L3 still checks actual browser behavior.
async function verifyBootFiles() {
    const required = checkBootFiles(ROOT);
    await verifyAudioVendors();
    return { note: `${required.length} boot files present; audio hashes verified` };
}

// ---------- main ----------

async function main() {
    log('\n[MYentry-game] setup starting' +
        (FLAGS.has('--with-entryjs-src') ? ' (+entryjs src)' : '') + '\n');

    if (!which('git')) {
        console.error(errMark('git command not found on PATH — required for fetching entry-tool.'));
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
    } else {
        log('  (--skip-vendor): vendor install skipped');
    }

    // --skip-vendor skips npm, but must still repair the incompatible historical audio aliases.
    await step('install verified CreateJS audio 0.6.0',  installAudioVendors);

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
