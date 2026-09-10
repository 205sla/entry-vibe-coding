// Import finished PNGs without modifying pixels; generation/background removal
// belongs to the agent's image tool. Keep assets inside the portable project.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function assetPaths(name, root) {
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
        throw new Error('name must use lowercase letters, digits, underscores or hyphens');
    }
    const directory = path.join(root, 'public/images/game/generated');
    return { directory, image: path.join(directory, name + '.png'), record: path.join(directory, name + '.json') };
}

export function generatedPicture(name, { root = ROOT } = {}) {
    const files = assetPaths(name, root);
    const record = JSON.parse(fs.readFileSync(files.record, 'utf8'));
    return { ...record.picture, dimension: { ...record.picture.dimension } };
}

export async function importImageAsset({ source, name, kind = 'sprite', prompt = '', root = ROOT }) {
    const files = assetPaths(name, root);
    if (!['sprite', 'background'].includes(kind)) throw new Error('kind must be sprite or background');
    const bytes = fs.readFileSync(source);
    const metadata = await sharp(bytes).metadata();
    if (metadata.format !== 'png' || (metadata.pages || 1) > 1) throw new Error('Use a single-frame PNG image');
    // Decode only for inspection. The original PNG bytes are copied unchanged.
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels = info.width * info.height;
    let transparent = 0, translucent = 0, visible = 0;
    for (let i = info.channels - 1; i < data.length; i += info.channels) {
        const alpha = data[i];
        if (alpha === 0) transparent++;
        else { visible++; if (alpha < 255) translucent++; }
    }
    if (!visible) throw new Error('Image is fully transparent; no visible object');
    if (kind === 'sprite' && !transparent) {
        throw new Error('Sprite needs actual transparent pixels. Generate a transparent PNG or remove the background with the image editing tool, then import again.');
    }
    const record = {
        kind,
        picture: {
            name, fileurl: '/images/game/generated/' + name + '.png', imageType: 'png',
            dimension: { width: info.width, height: info.height },
        },
        alpha: { transparent, translucent, visible, pixels },
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        prompt,
    };
    fs.mkdirSync(files.directory, { recursive: true });
    // Never replace an asset used by an existing spec. Use e.g. hero-v2 instead.
    fs.writeFileSync(files.image, bytes, { flag: 'wx' });
    try { fs.writeFileSync(files.record, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' }); }
    catch (error) { fs.unlinkSync(files.image); throw error; }
    return { imagePath: files.image, recordPath: files.record, ...record };
}
