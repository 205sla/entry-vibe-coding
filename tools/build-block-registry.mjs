#!/usr/bin/env node
// Scan entryjs/src/playground/blocks/block_*.js and emit a static registry of every
// block type with its params/statements/paramsKeyMap.
//
// Strategy: AST parse the source (not require()) — the block files have
// tangled dependencies (lodash subpath imports, Lang global, GEHelper, ...)
// that can't be resolved outside the webpack pipeline. Static shape extraction
// is all we need: block type names, param count, statement count, and
// paramsKeyMap keys. Actual runtime converters/func bodies are ignored.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '..');
const ENTRYJS  = path.resolve(ROOT, '..', 'entryjs');
const BLOCKS_DIR = path.join(ENTRYJS, 'src', 'playground', 'blocks');
const OUT_FILE   = path.join(ROOT, 'tools', 'block-registry.json');

if (!fs.existsSync(BLOCKS_DIR)) {
    console.error('[registry] entryjs not found at', ENTRYJS);
    process.exit(1);
}

// Given the ObjectExpression that getBlocks() returns, turn each of its
// properties into a {type, meta} pair.
function extractBlocks(objectExpr, file) {
    const out = [];
    for (const prop of objectExpr.properties) {
        if (prop.type !== 'Property') continue;
        const type = prop.key.type === 'Identifier' ? prop.key.name
            : (prop.key.type === 'Literal' ? String(prop.key.value) : null);
        if (!type || !prop.value || prop.value.type !== 'ObjectExpression') continue;
        out.push({ type, meta: summarizeBlockDef(prop.value) });
    }
    return out;
}

function summarizeBlockDef(objExpr) {
    const meta = {
        paramCount: 0,
        statementCount: 0,
        paramsKeyMap: null,
        skeleton: null,
        class: null,
        isPrimitive: false
    };
    for (const p of objExpr.properties) {
        if (p.type !== 'Property') continue;
        const k = p.key.name || (p.key.value && String(p.key.value));
        if (!k) continue;
        if (k === 'params' && p.value.type === 'ArrayExpression') {
            meta.paramCount = p.value.elements.length;
        } else if (k === 'statements' && p.value.type === 'ArrayExpression') {
            meta.statementCount = p.value.elements.length;
        } else if (k === 'paramsKeyMap' && p.value.type === 'ObjectExpression') {
            meta.paramsKeyMap = {};
            for (const kp of p.value.properties) {
                const kk = kp.key.name || (kp.key.value && String(kp.key.value));
                const vv = (kp.value.type === 'Literal') ? kp.value.value : null;
                if (kk != null) meta.paramsKeyMap[kk] = vv;
            }
        } else if (k === 'skeleton' && p.value.type === 'Literal') {
            meta.skeleton = p.value.value;
        } else if (k === 'class' && p.value.type === 'Literal') {
            meta.class = p.value.value;
        } else if (k === 'def' && p.value.type === 'ObjectExpression') {
            // Primitive (draggable-into-workspace) blocks have def.type = <same-as-type>
            meta.hasDef = true;
        }
    }
    return meta;
}

// Find every `return { ... }` within a function whose name hints at block export.
// The top-level pattern is `module.exports = { getBlocks() { return { ... } } }`.
// We recursively collect all top-level ObjectExpressions returned from any
// function called `getBlocks`; this is robust to minor file-to-file variance.
function parseBlockFile(src, file) {
    const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
    const blocks = [];
    walk.simple(ast, {
        Property(node) {
            // Methods like `getBlocks() { ... }`
            const k = node.key.name || (node.key.value && String(node.key.value));
            if (k !== 'getBlocks') return;
            const fn = node.value;
            if (!fn || (fn.type !== 'FunctionExpression' && fn.type !== 'ArrowFunctionExpression')) return;
            // Walk the function body for ReturnStatement → ObjectExpression
            walk.simple(fn.body, {
                ReturnStatement(ret) {
                    if (ret.argument && ret.argument.type === 'ObjectExpression') {
                        blocks.push(...extractBlocks(ret.argument, file));
                    }
                }
            });
        }
    });
    return blocks;
}

const files = fs.readdirSync(BLOCKS_DIR)
    .filter(n => /^block_.*\.js$/.test(n))
    .sort();

const registry = {};
const issues = [];

for (const file of files) {
    const absPath = path.join(BLOCKS_DIR, file);
    let src;
    try { src = fs.readFileSync(absPath, 'utf8'); }
    catch (e) { issues.push({ file, phase: 'read', error: e.message }); continue; }
    let list;
    try { list = parseBlockFile(src, file); }
    catch (e) { issues.push({ file, phase: 'parse', error: e.message }); continue; }
    const category = file.replace(/^block_/, '').replace(/\.js$/, '');
    for (const { type, meta } of list) {
        // Sanity: a few files shadow helper objects whose keys aren't real block types.
        // Real block types are snake_case identifiers, but the block files also
        // include helper objects with arbitrary keys. We keep all of them; the
        // smoke test just uses the registry as a *hint*, not an allowlist.
        registry[type] = { file, category, ...meta };
    }
}

fs.writeFileSync(OUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    entryjsPath: ENTRYJS,
    blockCount: Object.keys(registry).length,
    issues,
    blocks: registry
}, null, 2));

console.log('[registry] wrote', OUT_FILE);
console.log('[registry] blocks:', Object.keys(registry).length, 'issues:', issues.length);
if (issues.length) {
    for (const iss of issues) console.log('  -', iss.file, '(' + iss.phase + '):', iss.error);
}
