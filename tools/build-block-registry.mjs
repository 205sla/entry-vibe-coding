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

// Blocks also live OUTSIDE blocks/: `block_entry.js` (one level up) defines ~200 of
// them — primitives (number/angle/color), value blocks (get_pictures, get_sounds,
// calc_*, get_x_coordinate), and hardware/UI helpers. Missing these made `--check`
// reject specs that used perfectly valid blocks.
// Order matters and mirrors the engine: block_entry.js:8083 does
//   Entry.block = Object.assign(Entry.block, getBlocks(), blocks.getBlocks())
// so blocks/ wins on the (rare) duplicate. We scan extras first for the same reason.
const EXTRA_FILES = [path.join(ENTRYJS, 'src', 'playground', 'block_entry.js')];

if (!fs.existsSync(BLOCKS_DIR)) {
    console.error('[registry] entryjs source not found at', ENTRYJS);
    console.error('[registry] run `npm run setup -- --with-entryjs-src` first (source clone only — no build needed)');
    process.exit(1);
}

// Given the ObjectExpression that getBlocks() returns, turn each of its
// properties into a {type, meta} pair.
function extractBlocks(objectExpr) {
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

// Extract a single param slot's shape from its ObjectExpression in source.
// We capture only the keys that affect spec authoring/validation:
//   - type: 'Block' | 'Dropdown' | 'DropdownDynamic' | 'Indicator' | 'Text' | ...
//   - accept: 'string' | 'boolean' | 'param' (Block slot value type)
//   - menu / menuName: variables | lists | messages | scenes | ... (DropdownDynamic source)
//   - defaultType: number | text | … (default literal-block when the slot is empty)
// Returns null for non-object literal entries (rare).
function extractParamShape(elem) {
    if (!elem || elem.type !== 'ObjectExpression') return null;
    const shape = {};
    for (const p of elem.properties) {
        if (p.type !== 'Property') continue;
        const k = p.key.name || (p.key.value && String(p.key.value));
        if (!k) continue;
        // Only take literal scalar values — ignore nested objects/expressions
        // (color refs, callbacks etc). All keys we care about are strings.
        if (p.value.type !== 'Literal') continue;
        if (k === 'type')         shape.type = p.value.value;
        else if (k === 'accept')  shape.accept = p.value.value;
        else if (k === 'menuName' || k === 'menu') shape.menu = p.value.value;
        else if (k === 'defaultType') shape.defaultType = p.value.value;
    }
    return Object.keys(shape).length ? shape : null;
}

function summarizeBlockDef(objExpr) {
    const meta = {
        paramCount: 0,
        statementCount: 0,
        params: null,           // [{ type, accept?, menu?, defaultType? } | null]
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
            meta.params = p.value.elements.map(extractParamShape);
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
// Two shapes exist in the source tree:
//   blocks/block_*.js  → `module.exports = { getBlocks() { return { ... } } }`  (Property)
//   block_entry.js     → `function getBlocks() { return { ... } }`             (FunctionDeclaration)
// Handling only the first silently dropped every block in block_entry.js.
function parseBlockFile(src) {
    const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
    const blocks = [];

    // Walk a getBlocks() body for ReturnStatement → ObjectExpression.
    const collectFrom = (fnBody) => {
        walk.simple(fnBody, {
            ReturnStatement(ret) {
                if (ret.argument && ret.argument.type === 'ObjectExpression') {
                    blocks.push(...extractBlocks(ret.argument));
                }
            }
        });
    };

    walk.simple(ast, {
        Property(node) {
            // Methods like `getBlocks() { ... }`
            const k = node.key.name || (node.key.value && String(node.key.value));
            if (k !== 'getBlocks') return;
            const fn = node.value;
            if (!fn || (fn.type !== 'FunctionExpression' && fn.type !== 'ArrowFunctionExpression')) return;
            collectFrom(fn.body);
        },
        FunctionDeclaration(node) {
            // Standalone `function getBlocks() { ... }`
            if (!node.id || node.id.name !== 'getBlocks') return;
            collectFrom(node.body);
        }
    });
    return blocks;
}

// Extras first, blocks/ last — see EXTRA_FILES comment (engine's Object.assign order).
const sources = [
    ...EXTRA_FILES.filter(p => fs.existsSync(p)),
    ...fs.readdirSync(BLOCKS_DIR)
        .filter(n => /^block_.*\.js$/.test(n))
        .sort()
        .map(n => path.join(BLOCKS_DIR, n)),
];

const registry = {};
const issues = [];

for (const absPath of sources) {
    const file = path.basename(absPath);
    let src;
    try { src = fs.readFileSync(absPath, 'utf8'); }
    catch (e) { issues.push({ file, phase: 'read', error: e.message }); continue; }
    let list;
    try { list = parseBlockFile(src); }
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
    // Relative to the repo so the committed registry carries no machine path.
    entryjsPath: path.relative(ROOT, ENTRYJS).split(path.sep).join('/'),
    blockCount: Object.keys(registry).length,
    issues,
    blocks: registry
}, null, 2));

console.log('[registry] wrote', OUT_FILE);
console.log('[registry] blocks:', Object.keys(registry).length, 'issues:', issues.length);
if (issues.length) {
    for (const iss of issues) console.log('  -', iss.file, '(' + iss.phase + '):', iss.error);
}
