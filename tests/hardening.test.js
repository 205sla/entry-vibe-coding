const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const { createSessionStore } = require('../lib/ent-session-store.js');

test('idle/suspended editor sessions survive memory eviction and release removes the source', () => {
    let now = 0;
    const store = createSessionStore({ now: () => now, ttl: 30 * 60 * 1000 });
    try {
        const data = Buffer.from('source bytes');
        store.set('first', data);
        const rec = store.get('first');
        now = 36 * 60 * 1000;
        store.gc();
        assert.equal(rec.tarBuf, null);
        assert.deepEqual(store.get('first').tarBuf, data);
        store.remove('first');
        assert.equal(store.get('first'), null);
        assert.throws(() => store.set('../bad', data), /invalid session/);
    } finally { store.close(); }
});

test('HTTP export preserves assets after 36 minutes and rejects missing session/local assets', async t => {
    const { app, sessions, extractTarFile } = require('../server.js');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = 'http://127.0.0.1:' + server.address().port;
    const fd = new FormData();
    fd.append('ent', new Blob([await fs.readFile(path.join(__dirname, 'fixtures/move.ent'))]), 'move.ent');
    const load = await fetch(base + '/api/load', { method: 'POST', body: fd });
    assert.equal(load.status, 200);
    const project = await load.json();
    const sid = project.__sid;
    t.after(() => sessions.remove(sid));
    const record = sessions.get(sid);
    record.accessedAt -= 36 * 60 * 1000;
    sessions.gc();
    assert.equal(record.tarBuf, null);
    const exportProject = async value => fetch(base + '/api/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
    });
    const response = await exportProject(project);
    assert.equal(response.status, 200);
    const tar = zlib.gunzipSync(Buffer.from(await response.arrayBuffer()));
    const saved = JSON.parse(extractTarFile(tar, 'temp/project.json'));
    for (const object of saved.objects) {
        for (const media of [...(object.sprite?.pictures || []), ...(object.sprite?.sounds || [])]) {
            assert.match(media.fileurl, /^temp\//);
            assert.ok(extractTarFile(tar, media.fileurl), 'asset must exist in exported archive');
        }
    }
    await fetch(base + '/api/ent-session/' + sid, { method: 'DELETE' });
    const missingSession = await exportProject(project);
    assert.equal(missingSession.status, 409);
    assert.match((await missingSession.json()).error, /에셋/);
    const missingFile = await exportProject({ objects: [{ sprite: { pictures: [{ fileurl: '/images/nonexistent-hardening.png' }] } }] });
    assert.equal(missingFile.status, 409);
    const noURL = await exportProject({ objects: [{ sprite: { pictures: [{}] } }] });
    assert.equal(noURL.status, 422);
});

// Rewrite the size field of the first header (offset 124, 12 bytes) — checksum is not verified.
function tarWithSize(sizeField) {
    const { makeTar } = require('../lib/tar-portable.js');
    const tar = makeTar([{ name: 'temp/project.json', data: Buffer.from('{"objects":[]}') }]);
    tar.fill(0, 124, 136);
    tar.write(sizeField, 124, 12, 'ascii');
    return tar;
}

test('tar reader rejects negative, non-octal and out-of-bounds sizes instead of looping', () => {
    const { forEachTarEntry, extractTarFile } = require('../lib/tar-portable.js');
    for (const field of ['-0000002000', '00000000019', 'garbage', '', '77777777777']) {
        assert.throws(() => forEachTarEntry(tarWithSize(field), () => {}), error => error.code === 'EBADTAR', JSON.stringify(field));
    }
    assert.equal(extractTarFile(tarWithSize('00000000016'), 'temp/project.json').toString(), '{"objects":[]}');
});

test('HTTP load answers 400 for a malformed archive', async t => {
    const { app } = require('../server.js');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const fd = new FormData();
    fd.append('ent', new Blob([zlib.gzipSync(tarWithSize('-0000002000'))]), 'bad.ent');
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/load', { method: 'POST', body: fd });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /invalid .ent archive/);
});

test('server listens on loopback only unless HOST is given', async t => {
    const { startServer } = require('../server.js');
    const servers = await startServer({ port: 0, host: '' });
    t.after(() => Promise.all(servers.map(s => new Promise(resolve => s.close(resolve)))));
    const addresses = servers.map(s => s.address().address);
    assert.equal(addresses[0], '127.0.0.1');
    for (const address of addresses) assert.ok(['127.0.0.1', '::1'].includes(address), address);
    assert.equal(new Set(servers.map(s => s.address().port)).size, 1);
});

test('asset bundler fails on an image it cannot convert instead of storing raw bytes as .png', async () => {
    const { createAssetBundler } = require('../lib/asset-bundler.js');
    const bundler = createAssetBundler();
    await assert.rejects(bundler.bundle({ buf: Buffer.from('not an image'), kind: 'image', cacheKey: 'broken.png' }),
        error => error.status === 422 && /broken\.png/.test(error.message));
    assert.equal(bundler.getFiles().payloads.length, 0);
});

test('semantic validation rejects bad references, duplicate IDs and missing assets before build', async () => {
    const { validateSpec, buildProject } = await import('../tools/make-ent.mjs');
    const script = [[{ type: 'set_variable', params: [{ __field: 'missing' }, 1, null] }, { type: 'func_undefined', params: [] }]];
    const invalid = {
        scenes: [{ id: 's' }, { id: 's' }],
        variables: [{ id: 'duplicate' }], lists: [{ id: 'duplicate' }],
        objects: [{ id: 'o', scene: 'not-a-scene', pictures: [{ path: path.join(__dirname, 'missing.png') }], script }],
    };
    const errors = validateSpec(invalid).filter(issue => issue.severity === 'error');
    for (const expected of ['unknown variables', 'unknown function', 'unknown scene', 'duplicate id', 'asset file not found']) {
        assert.ok(errors.some(issue => issue.msg.includes(expected)), expected);
    }
    await assert.rejects(buildProject(invalid), /Invalid spec/);
    const value = validateSpec({ objects: [{ script: [[{ type: 'get_variable', params: ['ghost'] }]] }] });
    assert.ok(value.some(issue => /unknown variables/.test(issue.msg)));
    assert.ok(validateSpec({ objects: [{ script: 'broken' }] }).some(issue => /invalid script JSON/.test(issue.msg)));
    assert.ok(validateSpec({ objects: [{ script: [[{ type: 'repeat_inf', statements: [null] }]] }] }).length);
});

test('semantic validation accepts declared scopes, sentinels, scene names and stringified functions', async () => {
    const { validateSpec, buildProject } = await import('../tools/make-ent.mjs');
    const spec = {
        scenes: [{ id: 's', name: 'Scene' }],
        variables: [{ id: 'hp', object: 'o' }],
        lists: [{ id: 'items', array: [] }], messages: [{ id: 'go' }],
        functions: [{ id: 'fn_with_underscore', content: '[[]]' }],
        objects: [{ id: 'o', objectType: 'textBox', scene: 'Scene', script: JSON.stringify([[
            { type: 'set_variable', params: [{ __field: 'hp' }, 2, null] },
            { type: 'func_fn_with_underscore', params: [] },
            { type: 'message_cast', params: ['go', null] },
            { type: 'start_scene', params: ['s', null] },
        ]]) }],
    };
    assert.deepEqual(validateSpec(spec).filter(issue => issue.severity === 'error'), []);
    const result = await buildProject(spec);
    assert.equal(result.project.variables[0].object, 'o');
    assert.equal(result.project.objects[0].scene, result.project.scenes[0].id);
    assert.equal(JSON.parse(result.project.objects[0].script)[0].length, 4);
    const badFn = structuredClone(spec);
    badFn.functions[0].content = JSON.stringify([[{ type: 'get_variable', params: ['missing', null] }]]);
    await assert.rejects(buildProject(badFn), /unknown variables/);
});

test('every fixture source builds with automatic validation and embedded local assets', async () => {
    const { buildProject } = await import('../tools/make-ent.mjs');
    const directory = path.join(__dirname, 'fixtures');
    const sources = (await fs.readdir(directory)).filter(name => /^spec-.+\.(json|mjs)$/.test(name));
    assert.ok(sources.length > 0);
    for (const name of sources) {
        const filename = path.join(directory, name);
        const spec = name.endsWith('.json') ? JSON.parse(await fs.readFile(filename, 'utf8')) : (await import(pathToFileURL(filename).href)).default;
        const result = await buildProject(spec);
        assert.ok(result.project.objects.length, name);
        const { forEachTarEntry } = require('../lib/tar-portable.js');
        const entries = new Set();
        forEachTarEntry(zlib.gunzipSync(result.buffer), entry => entries.add(entry.name));
        for (const object of result.project.objects) {
            for (const media of [...object.sprite.pictures, ...object.sprite.sounds]) {
                assert.ok(media.fileurl, name + ': asset URL');
                if (media.fileurl.startsWith('temp/')) assert.ok(entries.has(media.fileurl), name + ': embedded asset');
            }
        }
    }
});

test('runtime discovery includes nested game verifiers, excludes argument-only CLI and propagates failure/timeout', async t => {
    const { discoverScripts, runScript } = await import('../tools/run-all-verify.mjs');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entry-runner-test-'));
    const names = ['tools/verify-a.mjs', 'tools/verify-case-study-evidence.mjs', 'tools/verify-audio-offline.mjs', 'games/demo/verify.mjs', 'games/demo/nested/verify-extra.mjs', 'games/demo/spec.mjs'];
    for (const name of names) {
        await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
        await fs.writeFile(path.join(root, name), name.includes('extra') ? 'process.exitCode = 2;' : 'console.log("ok");');
    }
    t.after(async () => {
        // All targets are files/directories created in this test's mkdtemp root.
        for (const name of names) await fs.unlink(path.join(root, name));
        for (const directory of ['games/demo/nested', 'games/demo', 'games', 'tools']) await fs.rmdir(path.join(root, directory));
        await fs.rmdir(root);
    });
    const found = discoverScripts(root);
    assert.deepEqual(found.scripts, ['games/demo/nested/verify-extra.mjs', 'games/demo/verify.mjs', 'tools/verify-a.mjs']);
    assert.equal(found.excluded.length, 2);
    assert.equal((await runScript('tools/verify-a.mjs', { root })).code, 0);
    assert.equal((await runScript('games/demo/nested/verify-extra.mjs', { root })).code, 2);
    await fs.writeFile(path.join(root, 'tools/verify-a.mjs'), 'setInterval(() => {}, 1000);');
    assert.equal((await runScript('tools/verify-a.mjs', { root, timeoutMs: 200 })).code, 124);
});
