// ustar portable tar + gzip helpers + Entry file-ID hash.
// CommonJS so server.js (CJS) requires directly; make-ent.mjs consumes via createRequire.
//
// Format is byte-identical to npm `tar.c({portable:true})` output, which is what
// the Entry server-side upload pipeline expects. Details / rationale in
// knowledge/01-binary-format.md.

'use strict';

const { uid } = require('uid');
const Puid = require('puid');
const __puid = new Puid();

// ---- File ID (official algorithm from entrylabs/docs) ------------------
// uid(8) + puid.generate() → 32 chars of [0-9a-z].
// Example output: "e49448cdlyy4s42e0013f820158i7nqj"
function entryStyleHash() {
    return uid(8) + __puid.generate();
}

// ---- tar header / writer ----------------------------------------------

function tarHeader(name, size, typeflag) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8');
    const isDir = (typeflag === '5');
    h.write(isDir ? '000755 \0' : '000644 \0', 100, 8, 'ascii');
    // uid/gid: leave as NUL bytes (portable).
    h.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    if (!isDir) {
        h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0',
                136, 12, 'ascii');
    } // dirs: mtime stays all-NUL
    h.write('        ', 148, 8, 'ascii');   // chksum placeholder (spaces)
    h.write(typeflag, 156, 1, 'ascii');
    h.write('ustar\0', 257, 6, 'ascii');
    h.write('00', 263, 2, 'ascii');
    // uname/gname: leave as NUL (portable).
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
    parts.push(Buffer.alloc(1024));  // end-of-archive marker
    return Buffer.concat(parts);
}

// ---- tar reader -------------------------------------------------------

// Parse every entry in a tar buffer. `cb({name, type, data})` may return
// `false` (strictly) to stop iteration early — used by extractTarFile.
function forEachTarEntry(buffer, cb) {
    let offset = 0;
    while (offset < buffer.length - 512) {
        if (buffer[offset] === 0) break;
        const name = buffer.toString('utf8', offset, offset + 100).replace(/\0.*/, '');
        const sizeStr = buffer.toString('ascii', offset + 124, offset + 136).replace(/\0.*/, '').trim();
        const typeflag = buffer.toString('ascii', offset + 156, offset + 157);
        const size = parseInt(sizeStr, 8) || 0;
        const dataStart = offset + 512;
        const stop = cb({ name, type: typeflag, data: buffer.slice(dataStart, dataStart + size) });
        if (stop === false) return;
        offset = dataStart + Math.ceil(size / 512) * 512;
    }
}

// Fetch a single entry by path. Matches both "name" and "./name".
function extractTarFile(buffer, targetName) {
    let result = null;
    forEachTarEntry(buffer, (e) => {
        if (e.name === targetName || e.name === './' + targetName) {
            result = e.data;
            return false; // early-out
        }
    });
    return result;
}

module.exports = {
    entryStyleHash,
    tarHeader,
    makeTar,
    forEachTarEntry,
    extractTarFile,
};
