#!/usr/bin/env node
// Print a spec's block tree as ASCII art for review without loading the editor.
//
// Usage:
//   node tools/show-spec.mjs tests/fixtures/spec-fibonacci.mjs
//   node tools/show-spec.mjs tests/fixtures/spec-bullethell.json --object player
//   node tools/show-spec.mjs tests/fixtures/spec-recursion.json --func fibtail
//
// Output: per-thread block tree with indentation, params summarized inline.
// Field-slot params show as `[FIELD: value]`, block-slot params recurse.
//
// Goal: glance at a spec's structure without running it through make-ent +
// editor + chromium. Useful for code review, debugging, sharing in PR.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
show-spec.mjs — print a spec's block tree as ASCII

  node tools/show-spec.mjs <spec.{json,mjs}> [flags]

Flags:
  --object <id-or-name>   only print this object's threads
  --func <id>             only print this function's content
  --max-depth <N>         truncate output below depth N (default: unlimited)
  --no-params             don't inline param values
`);
    process.exit(0);
}

function takeArg(flag) {
    const i = args.indexOf(flag);
    if (i < 0) return null;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
}

const SHOW_PARAMS = !args.includes('--no-params');
const _ = args.includes('--no-params') && args.splice(args.indexOf('--no-params'), 1);
const MAX_DEPTH = +(takeArg('--max-depth') || 99);
const FILTER_OBJECT = takeArg('--object');
const FILTER_FUNC = takeArg('--func');

const specPath = args[0];
if (!specPath) { console.error('error: spec path required'); process.exit(1); }
if (!fs.existsSync(specPath)) { console.error('error: not found:', specPath); process.exit(1); }

// ── Load spec ────────────────────────────────────────────────────

let spec;
if (/\.(mjs|js)$/i.test(specPath)) {
    const abs = path.resolve(specPath);
    const mod = await import(url.pathToFileURL(abs).href);
    spec = mod.default || mod.spec || mod;
} else {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
}

// Load registry for slot-shape annotations.
let registry = {};
try {
    registry = require('./block-registry.json').blocks;
} catch {
    console.warn('[show-spec] registry not found — slot annotations disabled');
}

// ── Block formatting ─────────────────────────────────────────────

const PRIMITIVE = new Set([
    'number', 'text', 'angle', 'color', 'color_hex',
    'True', 'False',
    'get_variable', 'get_list', 'get_canvas_input_value', 'get_boolean_value',
]);

// Render a param value as a compact string (or null marker).
function formatParam(p, slotShape) {
    if (p == null) return '∅';
    if (typeof p === 'object' && '__field' in p) return `«${p.__field}»`;
    if (typeof p === 'string') {
        const isField = slotShape && /Dropdown|DropdownDynamic|Keyboard|TextInput/.test(slotShape.type);
        return isField ? `«${p}»` : `"${p}"`;
    }
    if (typeof p === 'number') return String(p);
    if (typeof p === 'boolean') return p ? 'true' : 'false';
    if (typeof p === 'object' && p.type) {
        if (PRIMITIVE.has(p.type)) {
            const v = p.params && p.params[0];
            return `${p.type}(${formatScalar(v)})`;
        }
        return `<${p.type}…>`;
    }
    return JSON.stringify(p);
}

function formatScalar(v) {
    if (v == null) return '∅';
    if (typeof v === 'string') return JSON.stringify(v);
    return String(v);
}

// Recursively print a block. Field slots inlined; block slots get their own
// child line; statements get their own indented sub-tree.
function renderBlock(block, depth, prefix, isLast) {
    if (depth > MAX_DEPTH) {
        console.log(prefix + (isLast ? '└─ ' : '├─ ') + '…');
        return;
    }
    const connector = isLast ? '└─ ' : '├─ ';
    const childPrefix = prefix + (isLast ? '   ' : '│  ');

    const reg = registry[block.type];
    let head = block.type;

    if (SHOW_PARAMS && Array.isArray(block.params)) {
        const inlineParts = [];
        const blockParams = [];   // (slotIdx, value, slotShape) for child rendering
        for (let i = 0; i < block.params.length; i++) {
            const p = block.params[i];
            const slotShape = reg && reg.params ? reg.params[i] : null;
            if (slotShape && slotShape.type === 'Indicator') continue;
            // Inline scalars + field slots; recurse into block-typed objects
            if (p == null) { inlineParts.push('∅'); continue; }
            if (typeof p === 'object' && p.type && !PRIMITIVE.has(p.type)) {
                blockParams.push({ idx: i, value: p, slot: slotShape });
                inlineParts.push(`<${p.type}>`);
            } else {
                inlineParts.push(formatParam(p, slotShape));
            }
        }
        if (inlineParts.length) head += '(' + inlineParts.join(', ') + ')';

        console.log(prefix + connector + head);

        // Render child blocks (non-primitive params)
        const childItems = [
            ...blockParams.map(b => ({ kind: 'param', ...b })),
        ];
        const stmts = block.statements || [];
        stmts.forEach((thread, ti) => {
            childItems.push({ kind: 'stmt', idx: ti, thread });
        });

        for (let j = 0; j < childItems.length; j++) {
            const item = childItems[j];
            const last = j === childItems.length - 1;
            if (item.kind === 'param') {
                console.log(childPrefix + (last ? '└─ ' : '├─ ') + `param[${item.idx}] →`);
                renderBlock(item.value, depth + 1, childPrefix + (last ? '   ' : '│  '), true);
            } else {
                const stmtConn = (last ? '└─ ' : '├─ ');
                if (item.thread.length === 0) {
                    console.log(childPrefix + stmtConn + `stmt[${item.idx}]: (empty)`);
                } else {
                    console.log(childPrefix + stmtConn + `stmt[${item.idx}]:`);
                    const sp = childPrefix + (last ? '   ' : '│  ');
                    item.thread.forEach((b, bi) => {
                        renderBlock(b, depth + 1, sp, bi === item.thread.length - 1);
                    });
                }
            }
        }
    } else {
        console.log(prefix + connector + head);
    }
}

function renderThread(thread, label) {
    if (!thread || thread.length === 0) {
        console.log(`  ${label}: (empty)`);
        return;
    }
    console.log(`  ${label}:`);
    thread.forEach((b, i) => renderBlock(b, 1, '    ', i === thread.length - 1));
}

// ── Main ────────────────────────────────────────────────────────

console.log(`\n=== ${path.basename(specPath)} — ${spec.name || '(unnamed)'} ===`);

if (!FILTER_FUNC) {
    const objects = spec.objects || [];
    const filtered = FILTER_OBJECT
        ? objects.filter(o => o.id === FILTER_OBJECT || o.name === FILTER_OBJECT)
        : objects;
    if (FILTER_OBJECT && filtered.length === 0) {
        console.error(`error: no object matched "${FILTER_OBJECT}"`);
        process.exit(1);
    }
    for (const obj of filtered) {
        console.log(`\nobject [${obj.id || '?'}] ${obj.name || ''} (${obj.objectType || 'sprite'})`);
        const threads = obj.script || [[]];
        threads.forEach((t, i) => renderThread(t, `thread[${i}]`));
    }
}

if (!FILTER_OBJECT) {
    const funcs = spec.functions || [];
    const filtered = FILTER_FUNC
        ? funcs.filter(f => f.id === FILTER_FUNC)
        : funcs;
    for (const fn of filtered) {
        console.log(`\nfunction [${fn.id}] type=${fn.type}`);
        if (Array.isArray(fn.content)) {
            fn.content.forEach((t, i) => renderThread(t, `content[${i}]`));
        } else {
            console.log('  (content already stringified — re-build spec to inspect)');
        }
    }
}

console.log('');
