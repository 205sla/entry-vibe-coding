const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('links reject existing sibling files, encoded traversal, absolute paths and external junctions', async () => {
    const { checkLink } = await import('../tools/check-knowledge-links.mjs');
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'entry-links-'));
    const root = path.join(temp, 'repo'), sibling = path.join(temp, 'sibling');
    try {
        await fs.mkdir(root); await fs.mkdir(sibling);
        await fs.writeFile(path.join(sibling, 'source.md'), '# Outside');
        await fs.writeFile(path.join(root, '한 글.md'), '# Inside');
        const check = target => checkLink({ file: path.join(root, 'README.md'), url: target, line: 1 }, {}, root);
        assert.equal(check(encodeURIComponent('한 글.md')), null);
        assert.equal(check('https://example.com/reference'), null);
        for (const target of ['../sibling/source.md', '%2e%2e/sibling/source.md', '..\\sibling\\source.md']) {
            assert.match(check(target).reason, /escapes repository/);
        }
        assert.match(check('C:/Users/someone/source.md').reason, /absolute/);
        assert.match(check('/tmp/source.md').reason, /absolute/);
        assert.match(check('%GG').reason, /percent encoding/);
        await fs.symlink(sibling, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
        assert.match(check('linked/source.md').reason, /symlink/);
    } finally {
        // Only the temporary test tree is removed; directory symlinks are not followed.
        await fs.rm(temp, { recursive: true, force: true });
    }
});
