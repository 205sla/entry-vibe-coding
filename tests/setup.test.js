const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { makeTar } = require('../lib/tar-portable.js');

test('boot gate checks scripts and styles declared by editor.html, including empty vendor files', async () => {
    const { checkBootFiles } = await import('../scripts/lib/boot-files.mjs');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entry-boot-test-'));
    try {
        await fs.mkdir(path.join(root, 'public/images/mascot'), { recursive: true });
        await fs.writeFile(path.join(root, 'public/editor.html'), '<link href="style.css" rel="stylesheet"><script src="new-vendor.js"></script>');
        await fs.writeFile(path.join(root, 'public/images/mascot/bot205-idle.svg'), '<svg/>');
        await fs.writeFile(path.join(root, 'public/style.css'), 'body {}');
        assert.throws(() => checkBootFiles(root), /new-vendor.js/);
        await fs.writeFile(path.join(root, 'public/new-vendor.js'), '');
        assert.throws(() => checkBootFiles(root), /new-vendor.js/);
        await fs.writeFile(path.join(root, 'public/new-vendor.js'), 'void 0;');
        assert.equal(checkBootFiles(root).length, 3);
        await fs.unlink(path.join(root, 'public/style.css'));
        assert.throws(() => checkBootFiles(root), /style.css/);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('setup extracts an npm archive using PATH tar from an absolute path containing spaces', async () => {
    const { extractTar } = await import('../scripts/lib/extract-tar.mjs');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'entry setup '));
    const archive = path.join(root, 'entry artifact.tgz');
    const destination = path.join(root, 'extracted files');
    try {
        await fs.mkdir(destination);
        await fs.writeFile(archive, zlib.gzipSync(makeTar([
            { name: 'package/dist/entry.min.js', data: Buffer.from('prebuilt sentinel') },
        ])));
        extractTar(archive, destination);
        assert.equal(await fs.readFile(path.join(destination, 'package/dist/entry.min.js'), 'utf8'), 'prebuilt sentinel');
        extractTar(archive, destination);
        assert.equal(await fs.readFile(path.join(destination, 'package/dist/entry.min.js'), 'utf8'), 'prebuilt sentinel');
    } finally {
        // root is the exact directory allocated by mkdtemp for this test.
        await fs.rm(root, { recursive: true, force: true });
    }
});
