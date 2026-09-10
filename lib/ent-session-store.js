// Evict idle buffers, not an editor's source assets. Disk copies live until
// explicitly released or this server exits (including long/suspended tabs).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function createSessionStore({ now = Date.now, ttl = 30 * 60 * 1000 } = {}) {
    const records = new Map();
    let directory;
    function remove(id) {
        const record = records.get(id);
        if (!record) return;
        fs.rmSync(record.file, { force: true });
        records.delete(id);
    }
    return {
        set(id, tarBuf) {
            if (!/^[a-z0-9]+$/i.test(id)) throw new Error('invalid session id');
            directory ||= fs.mkdtempSync(path.join(os.tmpdir(), 'myentry-ent-'));
            const file = path.join(directory, id + '.tar');
            fs.writeFileSync(file, tarBuf);
            records.set(id, { file, tarBuf, accessedAt: now() });
        },
        get(id) {
            const record = records.get(id);
            if (!record) return null;
            record.accessedAt = now();
            if (!record.tarBuf) {
                try { record.tarBuf = fs.readFileSync(record.file); }
                catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                    records.delete(id);
                    return null;
                }
            }
            return record;
        },
        gc() {
            for (const record of records.values()) {
                if (now() - record.accessedAt > ttl) record.tarBuf = null;
            }
        },
        remove,
        close() {
            for (const id of records.keys()) remove(id);
            if (directory) fs.rmdirSync(directory);
            directory = undefined;
        },
    };
}
module.exports = { createSessionStore };
