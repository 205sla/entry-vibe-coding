const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { extractTarFile } = require('../lib/tar-portable.js');

const metadata = { generator: 'entry-vibe-coding', method: 'vibe-coding', schemaVersion: 1 };
const unpack = buffer => JSON.parse(extractTarFile(zlib.gunzipSync(buffer), 'temp/project.json'));
const sceneBlock = id => ({ type: 'start_scene', params: [id, null] });

test('build output contains fixed metadata and preserves scene references and unrelated values', async () => {
    const { buildProject } = await import('../tools/make-ent.mjs');
    const spec = {
        _entryVibeCoding: { generator: 'custom', method: false, schemaVersion: 0 },
        scenes: [{ id: 'intro', name: 'Intro' }, { id: 'play', name: 'Play' }],
        variables: [{ id: 'value', name: 'value', value: 'play' }],
        functions: [
            { id: 'array', content: [[sceneBlock('intro')]] },
            { id: 'string', content: JSON.stringify([[sceneBlock('play')]]) },
        ],
        objects: [
            { id: 'first', scene: 'Intro', objectType: 'textBox', text: 'play', script: [[
                { type: 'set_variable', params: ['value', 'play', null] },
                { type: 'repeat_basic', params: [1, null], statements: [[sceneBlock({ __field: 'play' })]] },
            ]] },
            { id: 'second', scene: 'play', objectType: 'textBox', script: JSON.stringify([[sceneBlock('intro')]]) },
        ],
    };
    const before = structuredClone(spec);
    const { project, buffer } = await buildProject(spec);
    const [intro, play] = project.scenes.map(scene => scene.id);
    assert.deepEqual(project._entryVibeCoding, metadata);
    assert.deepEqual(unpack(buffer), JSON.parse(JSON.stringify(project)));
    assert.deepEqual(project.scenes.map(scene => scene.name), ['Intro', 'Play']);
    assert.deepEqual(project.objects.map(object => object.scene), [intro, play]);
    assert.ok(project.scenes.every(scene => /^entry_vibe_coding_v1_.+/.test(scene.id)));
    const firstScript = JSON.parse(project.objects[0].script);
    assert.equal(firstScript[0][1].statements[0][0].params[0], play);
    assert.equal(JSON.parse(project.objects[1].script)[0][0].params[0], intro);
    assert.equal(JSON.parse(project.functions[0].content)[0][0].params[0], intro);
    assert.equal(JSON.parse(project.functions[1].content)[0][0].params[0], play);
    assert.equal(project.variables[0].value, 'play');
    assert.equal(project.objects[0].text, 'play');
    assert.equal(firstScript[0][0].params[1].params[0], 'play');
    assert.deepEqual(spec, before);
});

test('generated and existing scene identifiers stay unique across repeated builds', async () => {
    const { buildProject } = await import('../tools/make-ent.mjs');
    const ids = ['a', 'entry_vibe_coding_v1_a', 'entry_vibe_coding_v1_a_2'];
    const spec = {
        scenes: [...ids.map(id => ({ id, name: id })), { name: 'New scene' }],
        objects: ids.map(id => ({ objectType: 'textBox', scene: id, script: [[sceneBlock(id)]] })),
    };
    const { project } = await buildProject(spec);
    assert.equal(new Set(project.scenes.map(scene => scene.id)).size, 4);
    assert.equal(project.scenes[1].id, ids[1]);
    assert.equal(project.scenes[2].id, ids[2]);
    project.objects.forEach((object, index) => {
        assert.equal(object.scene, project.scenes[index].id);
        assert.equal(JSON.parse(object.script)[0][0].params[0], object.scene);
    });
    const repeated = await buildProject({ scenes: project.scenes, objects: [] });
    assert.deepEqual(repeated.project.scenes, project.scenes);
    assert.deepEqual(repeated.project._entryVibeCoding, metadata);
    assert.deepEqual((await buildProject({ objects: [] })).project._entryVibeCoding, metadata);
});

test('file API and both CLI input formats produce complete archives', async t => {
    const { writeEnt } = await import('../tools/make-ent.mjs');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'entry-build-test-'));
    const filenames = ['api.ent', 'input.json', 'input.mjs', 'json.ent', 'mjs.ent'];
    t.after(async () => {
        for (const filename of filenames) await fs.unlink(path.join(directory, filename)).catch(error => {
            if (error.code !== 'ENOENT') throw error;
        });
        await fs.rmdir(directory);
    });
    const spec = { _entryVibeCoding: false, objects: [{ name: 'Example', objectType: 'textBox' }] };
    await writeEnt(spec, path.join(directory, 'api.ent'));
    await fs.writeFile(path.join(directory, 'input.json'), JSON.stringify(spec));
    await fs.writeFile(path.join(directory, 'input.mjs'), 'export default ' + JSON.stringify(spec));
    for (const extension of ['json', 'mjs']) {
        execFileSync(process.execPath, [path.join(__dirname, '../tools/make-ent.mjs'),
            path.join(directory, 'input.' + extension), path.join(directory, extension + '.ent')], { timeout: 15_000 });
    }
    for (const filename of ['api.ent', 'json.ent', 'mjs.ent']) {
        const project = unpack(await fs.readFile(path.join(directory, filename)));
        assert.deepEqual(project._entryVibeCoding, metadata);
        assert.equal(project.objects[0].scene, project.scenes[0].id);
        assert.match(project.scenes[0].id, /^entry_vibe_coding_v1_.+/);
    }
});

test('HTTP export restores generated metadata and preserves ordinary imported projects', async t => {
    const { buildProject } = await import('../tools/make-ent.mjs');
    const { app } = require('../server.js');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const exportProject = async project => {
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/export', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project),
        });
        assert.equal(response.status, 200);
        return unpack(Buffer.from(await response.arrayBuffer()));
    };
    const { project } = await buildProject({ objects: [{ objectType: 'textBox' }] });
    delete project._entryVibeCoding;
    const saved = await exportProject(project);
    assert.deepEqual(saved._entryVibeCoding, metadata);
    assert.deepEqual(saved.scenes, project.scenes);
    assert.deepEqual(saved.objects, JSON.parse(JSON.stringify(project.objects)));
    assert.deepEqual(await exportProject(saved), saved);
    const ordinary = { scenes: [{ id: 'original', name: 'Scene' }], objects: [] };
    assert.deepEqual(await exportProject(ordinary), ordinary);
});
