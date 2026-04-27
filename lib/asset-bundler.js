// Shared tar-asset bundler — used by both tools/make-ent.mjs (spec → .ent)
// and server.js /api/export (loaded project → .ent download).
//
// Layout matches playentry.org's export format exactly
// (C:\Users\young\Downloads\260423_작품.ent):
//     temp/<d1>/<d2>/image/<hash>.png   always PNG, SVGs are rasterized
//     temp/<d1>/<d2>/thumb/<hash>.png   96px (configurable)
//     temp/<d1>/<d2>/sound/<hash>.<ext>
// where d1 = hash[0:2], d2 = hash[2:4] (entryStyleHash is 32-char base36).
//
// CommonJS so server.js can `require()` directly; make-ent.mjs consumes via
// createRequire.
//
// Why a factory instead of top-level functions: each .ent needs its own
// `dirs1/dirs2/dirs3/payloads` accumulators + dedup `seen` set + asset cache
// (same URL used twice → one tar entry). The factory yields a fresh set of
// these for every bundle session.

'use strict';

const sharp = require('sharp');
const { entryStyleHash } = require('./tar-portable.js');

const DEFAULT_THUMB_MAX_PX = 96;

/**
 * Create a fresh asset bundler.
 *
 * @param {object} [options]
 * @param {number} [options.thumbMaxPx=96]  Thumbnail longer side, px.
 * @param {Console} [options.logger=console]  For soft warnings.
 * @returns {{
 *   bundle: (input: {
 *     buf: Buffer,
 *     ext?: string,                        // e.g. 'mp3' — used for sound filename
 *     kind: 'image' | 'sound',
 *     cacheKey?: string | null             // if set, re-calls return the same bundled result
 *   }) => Promise<{
 *     hash: string,
 *     fileurl: string,                     // "temp/.../<hash>.<ext>"
 *     ext: string,
 *     dimension: { width: number, height: number } | null
 *   }>,
 *   getFiles: () => { dirs1: Array, dirs2: Array, dirs3: Array, payloads: Array }
 * }}
 */
function createAssetBundler({
    thumbMaxPx = DEFAULT_THUMB_MAX_PX,
    logger = console,
} = {}) {
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

    async function bundle({ buf, ext = 'bin', kind, cacheKey = null }) {
        if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);

        const hash = entryStyleHash();
        const d1 = hash.slice(0, 2), d2 = hash.slice(2, 4);
        addDir(dirs1, `temp/${d1}/`);
        addDir(dirs2, `temp/${d1}/${d2}/`);
        addDir(dirs3, `temp/${d1}/${d2}/${kind}/`);

        let result;
        if (kind === 'image') {
            // Rasterize to PNG — SVGs in, PNG out. Keep the rasterized bytes
            // around so the thumb fallback can reuse them on resize failure.
            let imageBuf = buf, dimension = null;
            try {
                imageBuf = await sharp(buf).png().toBuffer();
                const m = await sharp(buf).metadata();
                dimension = { width: m.width || 100, height: m.height || 100 };
            } catch (e) {
                logger.warn('[asset-bundler] SVG→PNG rasterize failed —', e.message);
                dimension = { width: 200, height: 240 };
            }
            const fileurl = `temp/${d1}/${d2}/image/${hash}.png`;
            payloads.push({ name: fileurl, data: imageBuf, typeflag: '0' });

            addDir(dirs3, `temp/${d1}/${d2}/thumb/`);
            const thumbPath = `temp/${d1}/${d2}/thumb/${hash}.png`;
            try {
                const thumbBuf = await sharp(buf)
                    .resize(thumbMaxPx, thumbMaxPx, { fit: 'inside' })
                    .png().toBuffer();
                payloads.push({ name: thumbPath, data: thumbBuf, typeflag: '0' });
            } catch (e) {
                logger.warn('[asset-bundler] thumb resize failed, reusing main image —', e.message);
                payloads.push({ name: thumbPath, data: imageBuf, typeflag: '0' });
            }
            result = { hash, fileurl, ext: 'png', dimension };
        } else {
            // Sounds / other: keep original bytes + caller-supplied extension.
            const fileurl = `temp/${d1}/${d2}/${kind}/${hash}.${ext}`;
            payloads.push({ name: fileurl, data: buf, typeflag: '0' });
            result = { hash, fileurl, ext, dimension: null };
        }

        if (cacheKey) cache.set(cacheKey, result);
        return result;
    }

    return {
        bundle,
        getFiles: () => ({ dirs1, dirs2, dirs3, payloads }),
    };
}

module.exports = { createAssetBundler, DEFAULT_THUMB_MAX_PX };
