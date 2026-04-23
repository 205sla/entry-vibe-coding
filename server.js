// MYentry-game server — serves the editor and handles .ent load/export.
// No external network calls; everything under /lib/ is served from public/.

const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const sharp = require('sharp');
const multer = require('multer');

const THUMB_MAX_PX = 96;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public'), {
    // Allow long-cached chunks; editor itself is no-store so code changes are seen.
    setHeaders: (res, p) => {
        if (/\.html$/.test(p)) res.setHeader('Cache-Control', 'no-store');
    }
}));

// ========== Tar helpers (ported from MYentry/server.js) ==========

function extractTarFile(buffer, targetName) {
    let offset = 0;
    while (offset < buffer.length - 512) {
        if (buffer[offset] === 0) break;
        const name = buffer.toString('utf8', offset, offset + 100).replace(/\0.*/, '');
        const sizeStr = buffer.toString('ascii', offset + 124, offset + 136).replace(/\0.*/, '').trim();
        const size = parseInt(sizeStr, 8) || 0;
        const dataStart = offset + 512;
        if (name === targetName || name === './' + targetName) {
            return buffer.slice(dataStart, dataStart + size);
        }
        offset = dataStart + Math.ceil(size / 512) * 512;
    }
    return null;
}

// Iterate every entry in a tar buffer. cb receives { name, type, data }.
function forEachTarEntry(buffer, cb) {
    let offset = 0;
    while (offset < buffer.length - 512) {
        if (buffer[offset] === 0) break;
        const name = buffer.toString('utf8', offset, offset + 100).replace(/\0.*/, '');
        const sizeStr = buffer.toString('ascii', offset + 124, offset + 136).replace(/\0.*/, '').trim();
        const typeflag = buffer.toString('ascii', offset + 156, offset + 157);
        const size = parseInt(sizeStr, 8) || 0;
        const dataStart = offset + 512;
        cb({ name, type: typeflag, data: buffer.slice(dataStart, dataStart + size) });
        offset = dataStart + Math.ceil(size / 512) * 512;
    }
}

// Build a ustar tar header matching npm `tar` portable output. See MYentry/server.js:178 for rationale.
function tarHeader(name, size, typeflag) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8');
    const isDir = (typeflag === '5');
    h.write(isDir ? '000755 \0' : '000644 \0', 100, 8, 'ascii');
    h.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    if (!isDir) {
        h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0',
                136, 12, 'ascii');
    }
    h.write('        ', 148, 8, 'ascii');
    h.write(typeflag, 156, 1, 'ascii');
    h.write('ustar\0', 257, 6, 'ascii');
    h.write('00', 263, 2, 'ascii');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += h[i];
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    return h;
}

function makeTar(files) {
    const parts = [];
    for (const f of files) {
        parts.push(tarHeader(f.name, f.data.length, f.typeflag || '0'));
        if (f.data.length > 0) {
            parts.push(f.data);
            const pad = (512 - (f.data.length % 512)) % 512;
            if (pad) parts.push(Buffer.alloc(pad));
        }
    }
    parts.push(Buffer.alloc(1024));
    return Buffer.concat(parts);
}

function entryStyleHash() {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    const bytes = crypto.randomBytes(32);
    let out = '';
    for (let i = 0; i < 32; i++) out += chars[bytes[i] % 36];
    return out;
}

// ========== Session cache for loaded .ent (so /api/ent-asset/... can stream from tar) ==========

const __sessionCache = new Map(); // sid → { tarBuf, createdAt }
const SESSION_TTL_MS = 30 * 60 * 1000;

function gcSessions() {
    const now = Date.now();
    for (const [sid, rec] of __sessionCache.entries()) {
        if (now - rec.createdAt > SESSION_TTL_MS) __sessionCache.delete(sid);
    }
}
setInterval(gcSessions, 5 * 60 * 1000).unref?.();

const MIME_BY_EXT = {
    '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg',    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',     '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',     '.m4a': 'audio/mp4'
};
function mimeByExt(p) {
    return MIME_BY_EXT[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

// Rewrite a fileurl/thumbUrl from a loaded project.json so the browser can fetch it.
//   temp/XX/YY/… → /api/ent-asset/<sid>/temp/XX/YY/…  (served from session-cached tar)
//   lib/…        → /lib/…                             (served from public/)
//   http(s):, data:, absolute /  → passthrough
function rewriteAssetUrl(url, sid) {
    if (typeof url !== 'string' || !url) return url;
    if (/^(https?:|data:|\/)/.test(url)) return url;
    const clean = url.replace(/^\.\//, '');
    if (/^temp\//.test(clean)) return '/api/ent-asset/' + sid + '/' + clean;
    if (/^lib\//.test(clean)) return '/' + clean;
    return url;
}

// ========== Endpoints ==========

// POST /api/load — receive an uploaded .ent, unzip + untar, return the project.json
// with fileurl/thumbUrl rewritten to /api/ent-asset/<sid>/...
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.post('/api/load', upload.single('ent'), (req, res) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ error: 'missing .ent file' });
        }
        let tarBuf;
        try {
            tarBuf = zlib.gunzipSync(req.file.buffer);
        } catch (e) {
            return res.status(400).json({ error: 'gunzip failed: ' + e.message });
        }
        const jsonBuf = extractTarFile(tarBuf, 'temp/project.json');
        if (!jsonBuf) return res.status(400).json({ error: 'temp/project.json not found in .ent' });

        const sid = entryStyleHash().slice(0, 16);
        __sessionCache.set(sid, { tarBuf, createdAt: Date.now() });

        let project;
        try {
            const jsonStr = jsonBuf.toString('utf8')
                .replace(/\.\/bower_components\/entry-js\//g, 'lib/entry-js/')
                .replace(/\.\/node_modules\/@entrylabs\/entry\//g, 'lib/entry-js/');
            project = JSON.parse(jsonStr);
        } catch (e) {
            return res.status(400).json({ error: 'project.json parse error: ' + e.message });
        }

        (project.objects || []).forEach(o => {
            if (!o || !o.sprite) return;
            (o.sprite.pictures || []).forEach(p => {
                if (p.fileurl)  p.fileurl  = rewriteAssetUrl(p.fileurl,  sid);
                if (p.thumbUrl) p.thumbUrl = rewriteAssetUrl(p.thumbUrl, sid);
            });
            (o.sprite.sounds || []).forEach(s => {
                if (s.fileurl)  s.fileurl  = rewriteAssetUrl(s.fileurl, sid);
            });
        });

        project.__sid = sid;
        res.json(project);
    } catch (e) {
        console.error('[api/load] error:', e);
        res.status(500).json({ error: String(e.message || e) });
    }
});

// GET /api/ent-asset/:sid/*  — stream a file embedded in the session's loaded tar.
app.get('/api/ent-asset/:sid/*', (req, res) => {
    const sid = req.params.sid;
    const subpath = req.params[0] || '';
    if (!/^temp\//.test(subpath) || /(^|\/)\.\.(\/|$)/.test(subpath)) {
        return res.status(400).end();
    }
    const rec = __sessionCache.get(sid);
    if (!rec) return res.status(404).end();
    const buf = extractTarFile(rec.tarBuf, subpath);
    if (!buf) return res.status(404).end();
    res.setHeader('Content-Type', mimeByExt(subpath));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
});

// Resolve a URL from the browser's project JSON into raw bytes + ext for export.
//   /api/ent-asset/<sid>/temp/…  → pulled from that session's tar
//   /<any-media-file>            → read from public/ (path-traversal-safe)
const MEDIA_EXT_RE = /\.(svg|png|jpg|jpeg|gif|webp|mp3|wav|ogg|m4a)$/i;
function resolveAsset(url) {
    if (typeof url !== 'string' || !url) return null;
    const m = /^\/api\/ent-asset\/([^/]+)\/(.+)$/.exec(url);
    if (m) {
        const rec = __sessionCache.get(m[1]);
        if (!rec) return null;
        const buf = extractTarFile(rec.tarBuf, m[2]);
        if (!buf) return null;
        const ext = (path.extname(m[2]).slice(1) || 'bin').toLowerCase();
        return { buf, ext };
    }
    if (!url.startsWith('/') || url.startsWith('/api/')) return null;
    if (!MEDIA_EXT_RE.test(url)) return null;
    const publicDir = path.resolve(__dirname, 'public');
    const fsPath = path.resolve(publicDir, url.slice(1));
    if (!fsPath.startsWith(publicDir + path.sep) && fsPath !== publicDir) return null;
    if (!fs.existsSync(fsPath)) return null;
    const buf = fs.readFileSync(fsPath);
    const ext = (path.extname(url).slice(1) || 'bin').toLowerCase();
    return { buf, ext };
}

// POST /api/export — project JSON → .ent (tar.gz) download.
// Logic mirrors MYentry/server.js:413-556: bundle assets as temp/aa/bb/{image,thumb,sound}/<hash>.<ext>,
// rasterize SVGs, 96px thumbnails, ustar headers with 0755 dirs / 0644 files, gzip memLevel 6.
app.post('/api/export', express.json({ limit: '25mb' }), async (req, res) => {
    try {
        const project = req.body;
        if (!project || typeof project !== 'object' || !Array.isArray(project.objects)) {
            return res.status(400).json({ error: 'invalid project JSON' });
        }
        // Remove internal session marker before packaging.
        if ('__sid' in project) delete project.__sid;

        const dirs1 = [];     // temp/XX/
        const dirs2 = [];     // temp/XX/YY/
        const dirs3 = [];     // temp/XX/YY/{image,thumb,sound}/
        const payloads = [];
        const seen = new Set();
        const cache = new Map();

        const addDir = (bucket, p) => {
            if (seen.has(p)) return;
            seen.add(p);
            bucket.push({ name: p, data: Buffer.alloc(0), typeflag: '5' });
        };

        // Match playentry.org's export (see Downloads/260423_작품.ent):
        //   image/<hash>.png  ← always PNG, SVGs get rasterized
        //   thumb/<hash>.png  ← 96px PNG thumb with the same hash
        //   sound/<hash>.<ext>
        // Picture objects carry { id, dimension, filename, name, imageType,
        // fileurl } — no thumbUrl. Entry's updateThumbnailView falls back to
        // fileurl when thumbUrl is absent.
        const bundleAsset = async (url, kind) => {
            if (!url) return null;
            if (cache.has(url)) return cache.get(url);
            if (/^(\.\/)?temp\//.test(url) || /^(https?:|data:)/.test(url)) {
                const r = { fileurl: url, filename: null, ext: null };
                cache.set(url, r);
                return r;
            }
            const asset = resolveAsset(url);
            if (!asset) {
                const r = { fileurl: url, filename: null, ext: null };
                cache.set(url, r);
                return r;
            }
            const hash = entryStyleHash();
            const d1 = hash.slice(0, 2), d2 = hash.slice(2, 4);
            addDir(dirs1, `temp/${d1}/`);
            addDir(dirs2, `temp/${d1}/${d2}/`);
            addDir(dirs3, `temp/${d1}/${d2}/${kind}/`);

            if (kind === 'image') {
                let imageBuf = asset.buf;
                try { imageBuf = await sharp(asset.buf).png().toBuffer(); }
                catch (e) { console.warn('SVG→PNG rasterize failed for', url, '—', e.message); }
                const fileurl = `temp/${d1}/${d2}/image/${hash}.png`;
                payloads.push({ name: fileurl, data: imageBuf, typeflag: '0' });
                addDir(dirs3, `temp/${d1}/${d2}/thumb/`);
                const thumbPath = `temp/${d1}/${d2}/thumb/${hash}.png`;
                try {
                    const thumbBuf = await sharp(asset.buf)
                        .resize(THUMB_MAX_PX, THUMB_MAX_PX, { fit: 'inside' })
                        .png().toBuffer();
                    payloads.push({ name: thumbPath, data: thumbBuf, typeflag: '0' });
                } catch (e) {
                    console.warn('thumb rasterize failed for', url, '—', e.message);
                    payloads.push({ name: thumbPath, data: imageBuf, typeflag: '0' });
                }
                const r = { fileurl, filename: hash, ext: 'png' };
                cache.set(url, r);
                return r;
            }

            const fileurl = `temp/${d1}/${d2}/${kind}/${hash}.${asset.ext}`;
            payloads.push({ name: fileurl, data: asset.buf, typeflag: '0' });
            const r = { fileurl, filename: hash, ext: asset.ext };
            cache.set(url, r);
            return r;
        };

        for (const obj of project.objects) {
            if (!obj || !obj.sprite) continue;
            for (const p of (obj.sprite.pictures || [])) {
                if (!p.fileurl) continue;
                const r = await bundleAsset(p.fileurl, 'image');
                if (!r) continue;
                p.fileurl = r.fileurl;
                if (r.filename) p.filename = r.filename;
                if (r.ext) p.imageType = r.ext;
                // Drop thumbUrl — playentry.org's exports omit it (see
                // Downloads/260423_작품.ent). Entry's updateThumbnailView
                // falls back to fileurl; and fileurl is now a PNG, which
                // CSS backgroundImage renders fine.
                delete p.thumbUrl;
            }
            for (const sn of (obj.sprite.sounds || [])) {
                if (!sn.fileurl) continue;
                const r = await bundleAsset(sn.fileurl, 'sound');
                if (!r) continue;
                sn.fileurl = r.fileurl;
                if (r.filename) sn.filename = r.filename;
            }
        }

        const projectJson = {
            name: 'temp/project.json',
            data: Buffer.from(JSON.stringify(project), 'utf8'),
            typeflag: '0'
        };

        const files = [
            { name: 'temp/', data: Buffer.alloc(0), typeflag: '5' },
            ...dirs1,
            projectJson,
            ...dirs2,
            ...dirs3,
            ...payloads
        ];

        const gz = zlib.gzipSync(makeTar(files), { memLevel: 6 });
        const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
        res.setHeader('Content-Type', 'application/x-gzip');
        res.setHeader('Content-Disposition', `attachment; filename="myentry-game-${ts}.ent"`);
        res.setHeader('Content-Length', gz.length);
        res.send(gz);
    } catch (e) {
        console.error('[api/export] error:', e);
        res.status(500).json({ error: String(e.message || e) });
    }
});

// Expose helpers for smoke tests (loaded via require()).
module.exports = {
    app, extractTarFile, forEachTarEntry,
    tarHeader, makeTar, entryStyleHash
};

if (require.main === module) {
    app.listen(PORT, () => {
        console.log('MYentry-game running at http://localhost:' + PORT);
    });
}
