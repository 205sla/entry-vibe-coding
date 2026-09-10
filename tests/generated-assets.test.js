const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const sharp = require('sharp');
const { extractTarFile } = require('../lib/tar-portable.js');

test('generated PNG import preserves alpha through .ent build and refuses opaque sprites and overwrites', async t => {
    const { importImageAsset, generatedPicture } = await import('../tools/lib/generated-assets.mjs');
    const { buildProject } = await import('../tools/make-ent.mjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-generated-test-'));
    const createdFiles = [];
    t.after(() => {
        for (const file of createdFiles) fs.unlinkSync(file);
        for (const dir of ['public/images/game/generated', 'public/images/game', 'public/images', 'public', '']) {
            const target = path.join(root, dir);
            if (fs.existsSync(target)) fs.rmdirSync(target);
        }
    });
    const source = path.join(root, 'source.png');
    createdFiles.push(source);
    // Tiny deterministic test pixels: empty, translucent edge, solid subject.
    const rgba = Buffer.from([0, 0, 0, 0, 255, 0, 0, 128, 255, 0, 0, 255, 0, 0, 0, 0]);
    const bytes = await sharp(rgba, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
    fs.writeFileSync(source, bytes);
    const imported = await importImageAsset({ source, name: 'hero', root, prompt: 'test sprite' });
    createdFiles.push(imported.imagePath, imported.recordPath);
    assert.deepEqual(fs.readFileSync(imported.imagePath), bytes);
    assert.equal(imported.alpha.transparent, 2);
    assert.equal(imported.alpha.translucent, 1);
    const picture = generatedPicture('hero', { root });
    assert.deepEqual(picture.dimension, { width: 2, height: 2 });
    const built = await buildProject({ objects: [{ pictures: [{ ...picture, path: imported.imagePath }] }] });
    const bundled = extractTarFile(zlib.gunzipSync(built.buffer), built.project.objects[0].sprite.pictures[0].fileurl);
    assert.deepEqual(await sharp(bundled).ensureAlpha().raw().toBuffer(), rgba);
    await assert.rejects(importImageAsset({ source, name: 'hero', root }), /EEXIST/);
    assert.deepEqual(fs.readFileSync(imported.imagePath), bytes);
    await assert.rejects(importImageAsset({ source, name: '../escape', root }), /name must/);

    fs.writeFileSync(source, await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer());
    await assert.rejects(importImageAsset({ source, name: 'opaque', root }), /actual transparent pixels/);
    const background = await importImageAsset({ source, name: 'backdrop', kind: 'background', root });
    createdFiles.push(background.imagePath, background.recordPath);
    assert.equal(background.alpha.transparent, 0);
    fs.writeFileSync(source, await sharp({ create: { width: 2, height: 2, channels: 4, background: '#00000000' } }).png().toBuffer());
    await assert.rejects(importImageAsset({ source, name: 'empty', root }), /fully transparent/);
});
