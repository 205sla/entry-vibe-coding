// es-hangul 데모 빌드 — demo.mjs → es-hangul-demo_NNN.ent (자동 넘버링).
//
//   node games/es-hangul/build-demo.mjs

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { writeEnt } from '../../tools/make-ent.mjs';
import spec from './demo.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function nextOutputPath(dir, base) {
    const re = new RegExp(`^${base}_(\\d{3})\\.ent$`);
    const nums = fs.readdirSync(dir)
        .map(f => f.match(re)).filter(Boolean)
        .map(m => parseInt(m[1], 10));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return path.join(dir, `${base}_${String(next).padStart(3, '0')}.ent`);
}

const OUT = nextOutputPath(__dirname, 'es-hangul-demo');
const r = await writeEnt(spec, OUT);

console.log(`[es-hangul-demo] wrote ${r.outPath} — ${r.size} bytes, ${r.objectCount} objects`);
console.log(`  scenes: ${spec.scenes.length} | functions: ${spec.functions.length} | variables: ${spec.variables.length} | lists: ${spec.lists.length}`);
