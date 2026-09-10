#!/usr/bin/env node
// Recheck case-study claims against a user-supplied .ent without extracting assets.
// Supports the ustar entries used by the documented samples, not a general tar importer.
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_TAR_BYTES = 4 * 1024 * 1024 * 1024;

export async function readProject(sourcePath) {
    const hash = createHash('sha256');
    let header = Buffer.alloc(512), headerBytes = 0;
    let remaining = 0, padding = 0, capture = false, ended = false;
    let projectBytes = 0, expandedBytes = 0, projectEntries = 0;
    const parts = [];
    const digestStream = new Transform({
        transform(chunk, encoding, done) { hash.update(chunk); done(null, chunk); },
    });
    const sink = new Writable({
        write(chunk, encoding, done) {
            try {
                expandedBytes += chunk.length;
                if (expandedBytes > MAX_TAR_BYTES) throw new Error('expanded tar exceeds 4 GiB limit');
                let offset = 0;
                while (offset < chunk.length) {
                    if (ended) break;
                    if (remaining) {
                        const count = Math.min(remaining, chunk.length - offset);
                        if (capture) parts.push(Buffer.from(chunk.subarray(offset, offset + count)));
                        remaining -= count;
                        offset += count;
                        continue;
                    }
                    if (padding) {
                        const count = Math.min(padding, chunk.length - offset);
                        padding -= count;
                        offset += count;
                        continue;
                    }
                    const count = Math.min(512 - headerBytes, chunk.length - offset);
                    chunk.copy(header, headerBytes, offset, offset + count);
                    headerBytes += count;
                    offset += count;
                    if (headerBytes < 512) continue;
                    headerBytes = 0;
                    if (header.every(byte => byte === 0)) { ended = true; continue; }
                    const text = (start, end) => header.toString('utf8', start, end).replace(/\0.*/, '');
                    const number = (start, end) => {
                        const value = text(start, end).trim();
                        if (!/^[0-7]+$/.test(value)) throw new Error('unsupported tar numeric field');
                        return parseInt(value, 8);
                    };
                    const expectedChecksum = number(148, 156);
                    let checksum = 0;
                    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i];
                    if (checksum !== expectedChecksum) throw new Error('tar checksum mismatch');
                    if (!text(257, 263).startsWith('ustar')) throw new Error('expected ustar header');
                    const prefix = text(345, 500);
                    const name = (prefix ? prefix + '/' : '') + text(0, 100);
                    const type = text(156, 157);
                    if (['x', 'g', 'L', 'K'].includes(type)) throw new Error('extended tar metadata is not supported');
                    const size = number(124, 136);
                    if (!Number.isSafeInteger(size) || size < 0) throw new Error('invalid tar size');
                    capture = name.replace(/^\.\//, '') === 'temp/project.json';
                    if (capture) {
                        if (!['', '0'].includes(type)) throw new Error('project.json must be a regular file');
                        if (++projectEntries !== 1) throw new Error('duplicate project.json');
                        if (size > MAX_JSON_BYTES) throw new Error('project.json exceeds 64 MiB limit');
                        projectBytes = size;
                    }
                    remaining = size;
                    padding = (512 - size % 512) % 512;
                }
                done();
            } catch (error) { done(error); }
        },
    });
    await pipeline(createReadStream(sourcePath), digestStream, createGunzip(), sink);
    if (remaining || padding || headerBytes || !ended) throw new Error('truncated tar archive');
    if (projectEntries !== 1) throw new Error('temp/project.json not found');
    const buffer = Buffer.concat(parts);
    if (buffer.length !== projectBytes) throw new Error('truncated project.json');
    const project = JSON.parse(buffer.toString('utf8'));
    for (const object of project.objects || []) {
        if (typeof object.script === 'string') object.script = JSON.parse(object.script);
    }
    for (const fn of project.functions || []) {
        if (typeof fn.content === 'string') fn.content = JSON.parse(fn.content);
    }
    return { project, sha256: hash.digest('hex'), projectBytes };
}

export function resolvePointer(project, pointer) {
    if (pointer === '') return project;
    if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw new Error('invalid JSON pointer');
    return pointer.slice(1).split('/').reduce((value, part) => {
        if (/~(?![01])/.test(part)) throw new Error('invalid JSON pointer escape');
        const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
        if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
            throw new Error('JSON pointer does not resolve: ' + pointer);
        }
        return value[key];
    }, project);
}

export async function verifyEvidence(sourcePath, evidencePath) {
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    if (!/^[a-f0-9]{64}$/i.test(evidence.source?.sha256 || '')) throw new Error('missing source SHA-256');
    if (!Array.isArray(evidence.assertions) || !evidence.assertions.length) throw new Error('no evidence assertions');
    const { project, sha256 } = await readProject(sourcePath);
    if (sha256 !== evidence.source.sha256.toLowerCase()) throw new Error('source SHA-256 mismatch');
    for (const assertion of evidence.assertions) {
        if (!Object.hasOwn(assertion, 'expected')) throw new Error('assertion requires expected value');
        const value = resolvePointer(project, assertion.path);
        if (!isDeepStrictEqual(value, assertion.expected)) {
            throw new Error('evidence mismatch: ' + (assertion.label || assertion.path));
        }
    }
    return { source: path.basename(sourcePath), sha256, assertions: evidence.assertions.length };
}

const isCLI = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCLI) {
    try {
        const args = process.argv.slice(2);
        const sourceIndex = args.indexOf('--source'), evidenceIndex = args.indexOf('--evidence');
        if (sourceIndex < 0 || evidenceIndex < 0 || !args[sourceIndex + 1] || !args[evidenceIndex + 1]) {
            throw new Error('usage: node tools/verify-case-study-evidence.mjs --source <file.ent> --evidence <evidence.json>');
        }
        const result = await verifyEvidence(args[sourceIndex + 1], args[evidenceIndex + 1]);
        console.log('[evidence] OK ' + JSON.stringify(result));
    } catch (error) {
        console.error('[evidence] FAIL ' + error.message);
        process.exitCode = 1;
    }
}
