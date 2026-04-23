// Node smoke test — validates every .ent fixture structurally.
// Run via `node --test tests/smoke.test.js`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { extractTarFile, forEachTarEntry } = require('../server.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const REGISTRY_PATH = path.join(__dirname, '..', 'tools', 'block-registry.json');

function loadRegistry() {
    if (!fs.existsSync(REGISTRY_PATH)) return { blocks: {} };
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
}

function collectBlockTypes(threadList, out) {
    for (const thread of threadList || []) {
        for (const block of thread || []) {
            if (!block || typeof block !== 'object') continue;
            if (block.type) out.add(block.type);
            if (Array.isArray(block.params)) {
                for (const p of block.params) {
                    if (p && typeof p === 'object' && p.type) {
                        collectBlockTypes([[p]], out);
                    }
                }
            }
            if (Array.isArray(block.statements)) {
                collectBlockTypes(block.statements, out);
            }
        }
    }
}

function listFixtures() {
    if (!fs.existsSync(FIXTURES_DIR)) return [];
    return fs.readdirSync(FIXTURES_DIR)
        .filter(n => n.endsWith('.ent'))
        .map(n => path.join(FIXTURES_DIR, n));
}

const registry = loadRegistry();
const registryKeys = new Set(Object.keys(registry.blocks || {}));

// Entry's field-primitive blocks live in separate files (fields/*.js) and aren't
// captured by our registry scan; whitelist the ones we emit from make-ent.
const PRIMITIVE_TYPES = new Set([
    'number', 'text', 'angle', 'color', 'color_hex',
    'True', 'False',
    'get_variable', 'get_list', 'get_canvas_input_value',
    'get_boolean_value'
]);

for (const entPath of listFixtures()) {
    const fname = path.basename(entPath);

    test(`${fname} — gunzip + tar parse`, () => {
        const raw = fs.readFileSync(entPath);
        const tarBuf = zlib.gunzipSync(raw);
        assert.ok(tarBuf.length > 0, 'tar buffer empty after gunzip');

        const jsonBuf = extractTarFile(tarBuf, 'temp/project.json');
        assert.ok(jsonBuf, 'temp/project.json missing in tar');

        const project = JSON.parse(jsonBuf.toString('utf8'));

        // Required top-level keys
        for (const key of ['objects', 'scenes', 'variables']) {
            assert.ok(key in project, `project.${key} missing`);
        }
        assert.ok(Array.isArray(project.objects), 'project.objects not an array');
        assert.ok(Array.isArray(project.scenes), 'project.scenes not an array');
        assert.ok(project.scenes.length > 0, 'project.scenes is empty');

        // Collect every file entry in the tar for later cross-checks
        const tarFiles = new Set();
        forEachTarEntry(tarBuf, e => { if (e.type !== '5') tarFiles.add(e.name); });

        const sceneIds = new Set(project.scenes.map(s => s.id));
        const usedBlockTypes = new Set();

        for (const o of project.objects) {
            // script is a JSON string
            assert.equal(typeof o.script, 'string', `object ${o.id}: script must be a string`);
            let threads;
            try { threads = JSON.parse(o.script); }
            catch (e) { assert.fail(`object ${o.id}: script JSON parse failed — ${e.message}`); }
            assert.ok(Array.isArray(threads), `object ${o.id}: script must parse to an array`);
            for (const thread of threads) {
                assert.ok(Array.isArray(thread), `object ${o.id}: every script thread must be an array`);
            }
            collectBlockTypes(threads, usedBlockTypes);

            // Scene reference
            assert.ok(sceneIds.has(o.scene),
                `object ${o.id}: scene "${o.scene}" not found in project.scenes`);

            // Pictures: fileurl must resolve to something real. Valid shapes:
            //   data: / http(s): / "/..." absolute path under public/ /
            //   "temp/..." entry inside the tar (with or without "./" prefix).
            const publicDir = path.join(__dirname, '..', 'public');
            const pictureIds = new Set();
            for (const p of (o.sprite && o.sprite.pictures) || []) {
                pictureIds.add(p.id);
                if (!p.fileurl) continue;
                const url = p.fileurl;
                if (/^(https?:|data:)/.test(url)) continue;
                if (url.startsWith('/')) {
                    const fsPath = path.join(publicDir, url.slice(1));
                    assert.ok(fs.existsSync(fsPath),
                        `object ${o.id}: picture fileurl "${url}" not found under public/`);
                    continue;
                }
                const tarName = url.replace(/^\.\//, '');
                assert.ok(tarFiles.has(tarName),
                    `object ${o.id}: picture fileurl "${url}" not found in tar`);
            }
            if (o.selectedPictureId) {
                assert.ok(pictureIds.has(o.selectedPictureId),
                    `object ${o.id}: selectedPictureId "${o.selectedPictureId}" not among pictures`);
            }
        }

        // Unknown block type check (warn-only if registry missing)
        if (registryKeys.size > 0) {
            const unknown = [...usedBlockTypes]
                .filter(t => !registryKeys.has(t) && !PRIMITIVE_TYPES.has(t));
            assert.deepEqual(unknown, [],
                `unknown block types: ${unknown.join(', ')}`);
        }
    });
}

// At least one fixture should exist
test('fixtures exist', () => {
    assert.ok(listFixtures().length > 0, `no .ent fixtures found in ${FIXTURES_DIR}`);
});
