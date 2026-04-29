#!/usr/bin/env node
// Generic .ent (tar.gz) generator. Input: a plain JS spec. Output: Buffer
// compatible with MYentry-game /api/load AND playentry.org upload.
//
// Spec shape:
//   {
//     name: "Tetris",
//     scenes?: [{ name, id? }],                 // default: one "장면 1"
//     variables?: [{ name, value?, variableType? /*=variable|list|timer|answer*/, visible?, array? }],
//     lists?: [{ name, array?, visible? }],
//     objects: [
//       {
//         name,
//         objectType?: 'sprite' | 'textBox',     // default: sprite
//         pictures?: [{ path: <abs fs path>, name?, dimension? }],
//         sounds?:   [{ path: <abs fs path>, name?, duration? }],
//         script?: [[ { type, params?, statements? }, ... ], ...],
//         entity?: { x, y, regX, regY, scaleX, scaleY, direction, rotation, width, height },
//         scene?:  <scene name or id>            // default: first scene
//       }
//     ],
//     speed?: 60
//   }
//
// All picture paths are hashed (32-char lowercase alnum) and bundled as
// temp/aa/bb/image/<hash>.<ext>. SVG sources get a PNG sibling + 96px thumb.
// Block `params` may be primitive literals (number/string) or nested block objects.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { uid } from 'uid';

// tar/hash/bundler helpers shared with server.js — single source in lib/.
const require = createRequire(import.meta.url);
const { makeTar } = require('../lib/tar-portable.js');
const { createAssetBundler } = require('../lib/asset-bundler.js');

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(__dirname, 'block-registry.json');
const PUBLIC_DIR    = path.resolve(__dirname, '..', 'public');

// Resolve a spec picture/sound reference to a bundlable absolute path.
//   { path: "C:/…" }                  → absolute path (explicit)
//   { fileurl: "/images/foo.svg" }    → <PUBLIC_DIR>/images/foo.svg (auto-bundle)
//   { fileurl: "http[s]:..." | "data:..." | "temp/..." } → null (leave as-is)
// Returns null when the reference is external or not found on disk.
function resolveLocalPath(ref) {
    if (!ref) return null;
    if (typeof ref.path === 'string' && ref.path) {
        return fs.existsSync(ref.path) ? ref.path : null;
    }
    const url = typeof ref.fileurl === 'string' ? ref.fileurl : null;
    if (!url) return null;
    if (/^(https?:|data:|temp\/)/.test(url)) return null;
    if (!url.startsWith('/')) return null;
    const abs = path.resolve(PUBLIC_DIR, url.slice(1));
    if (!abs.startsWith(PUBLIC_DIR + path.sep) && abs !== PUBLIC_DIR) return null;
    return fs.existsSync(abs) ? abs : null;
}

let __registry = null;
function loadRegistry() {
    if (__registry) return __registry;
    if (!fs.existsSync(REGISTRY_PATH)) {
        console.warn('[make-ent] block-registry.json missing; run build-block-registry first. Skipping block validation.');
        __registry = { blocks: {} };
        return __registry;
    }
    __registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    return __registry;
}

// -------- ID helpers ----------

// Short 4-char id for scenes / objects / pictures (not file hashes).
function shortId(n = 4) { return uid(n); }

// -------- Block script normalization ----------

// Primitive / literal value-wrapper block types whose params are ALREADY the
// raw stringified value (not sub-blocks). Treat them as leaves — don't recurse
// into params, don't consult the block registry for paramCount. If we naively
// normalized `{type:'text', params:['hello']}`, wrapParam would re-wrap the
// inner "hello" as another text block, yielding `[object Object]` at runtime
// when Entry renders the literal.
const PRIMITIVE_BLOCK_TYPES = new Set([
    'number', 'text', 'angle', 'color', 'color_hex',
    'True', 'False',
    'get_variable', 'get_list', 'get_canvas_input_value',
    'get_boolean_value'
]);

// Convert a spec block (possibly with `params: ['hello', 3]` primitives) into
// the nested Entry JSON shape (params become [{type:'number', params:['3']}, null]).
// If `statements` is present, recurse.
function normalizeBlock(spec) {
    if (!spec || typeof spec !== 'object') return spec;

    // Leaf: value-wrapper blocks carry literal params as-is.
    // `get_variable` is special — its param is a variable id (bare string),
    // which is fine to pass through verbatim.
    if (PRIMITIVE_BLOCK_TYPES.has(spec.type)) {
        return {
            type: spec.type,
            params: Array.isArray(spec.params)
                ? spec.params.map(p => (p && typeof p === 'object' && '__field' in p) ? p.__field : p)
                : []
        };
    }

    const reg = loadRegistry().blocks[spec.type];
    const out = { type: spec.type };

    const paramCount = reg ? reg.paramCount : (Array.isArray(spec.params) ? spec.params.length : 0);
    const params = new Array(paramCount).fill(null);
    if (Array.isArray(spec.params)) {
        for (let i = 0; i < Math.min(paramCount || spec.params.length, spec.params.length); i++) {
            // Pass slot shape to wrapParam so field slots (Dropdown / DropdownDynamic /
            // Keyboard / TextInput) can pass bare strings through verbatim, while
            // block slots (Block / Output) wrap bare strings as text blocks.
            const slotShape = reg && reg.params ? reg.params[i] : null;
            params[i] = wrapParam(spec.params[i], slotShape);
        }
    }
    out.params = params;

    const stCount = reg ? reg.statementCount : (Array.isArray(spec.statements) ? spec.statements.length : 0);
    if (stCount > 0 || Array.isArray(spec.statements)) {
        out.statements = [];
        for (let i = 0; i < Math.max(stCount, (spec.statements || []).length); i++) {
            const thread = (spec.statements && spec.statements[i]) || [];
            out.statements.push(thread.map(normalizeBlock));
        }
    }
    if (spec.x !== undefined) out.x = spec.x;
    if (spec.y !== undefined) out.y = spec.y;
    return out;
}

// Field-like slot types — these accept a bare string (the dropdown value /
// keyboard code / literal label) and DO NOT wrap it as a text block.
// Source: extracted from entryjs param descriptors in block-registry.json.
const FIELD_SLOT_TYPES = new Set([
    'Dropdown',         // static options, e.g. choose_project_timer_action[1]
    'DropdownDynamic',  // dynamic menu (variables/lists/messages/scenes/...)
    'Keyboard',         // keycode, e.g. is_press_some_key[0]
    'TextInput',        // free-form literal label, e.g. function_field_label[0]
]);

// Wrap a param value into Entry's nested block-or-literal shape.
//
// `slotShape` is the registry-extracted slot descriptor (null if unknown),
// shape `{ type: 'Block'|'Dropdown'|... , accept?, menu?, defaultType? }`.
// When the slot is field-like, bare strings pass through verbatim.
// When the slot is block-like (or unknown), bare strings wrap as text blocks
// (so callers can write `params: [10]` to mean a literal-10 number block).
//
// The `{ "__field": "..." }` sentinel still works in any slot — explicit
// unwrap, useful when registry info is missing or for synthesized types
// like `stringParam_<id>` that aren't in the registry.
//
//   null                     → null (empty slot)
//   number                   → { type: 'number', params: [String(n)] }
//   string + Block slot      → { type: 'text',   params: [s] }
//   string + field slot      → bare string "s" (Dropdown value / key code / label)
//   boolean-ish              → { type: 'True'|'False', params: [] }
//   { __field: "mouse" }     → bare string "mouse" (always unwraps)
//   { type: ... }            → pass through (Entry block, recursed via normalizeBlock)
function wrapParam(v, slotShape = null) {
    if (v == null) return null;
    if (typeof v === 'object' && '__field' in v) return v.__field;
    const isFieldSlot = slotShape && FIELD_SLOT_TYPES.has(slotShape.type);
    if (typeof v === 'string') {
        return isFieldSlot ? v : { type: 'text', params: [v] };
    }
    if (typeof v === 'number') return { type: 'number', params: [String(v)] };
    if (typeof v === 'boolean') return { type: v ? 'True' : 'False', params: [] };
    if (typeof v === 'object' && v.type) return normalizeBlock(v);
    return v;
}

// -------- Spec validation (--check) ----------

// Walk the spec's blocks (objects[*].script + functions[*].content) and report
// issues without building. Faster feedback loop than smoke (which requires a
// built .ent), and surfaces problems closer to where they're written.
//
// Returns an array of { severity: 'error' | 'warning', path, msg }.
export function validateSpec(spec) {
    const issues = [];
    const blocks = loadRegistry().blocks;

    // Synthesized at runtime by Entry.Func — not in our registry, but valid.
    const isUserFuncType = (t) =>
        /^func_[a-z0-9]+$/i.test(t) ||
        /^stringParam_[a-z0-9]+$/i.test(t) ||
        /^booleanParam_[a-z0-9]+$/i.test(t);

    const FIELD_SLOTS = new Set(['Dropdown', 'DropdownDynamic', 'Keyboard', 'TextInput']);

    function walkBlock(block, p) {
        if (!block || typeof block !== 'object' || !block.type) return;

        // Primitive value-wrappers: params are raw scalars, no recursion.
        if (PRIMITIVE_BLOCK_TYPES.has(block.type)) return;

        // User-defined function blocks (synthesized): just recurse into params/statements.
        if (isUserFuncType(block.type)) {
            (block.params || []).forEach((c, i) => {
                if (c && typeof c === 'object' && c.type) walkBlock(c, `${p}.params[${i}]`);
            });
            (block.statements || []).forEach((th, ti) =>
                (th || []).forEach((b, bi) => walkBlock(b, `${p}.statements[${ti}][${bi}]`)));
            return;
        }

        const r = blocks[block.type];
        if (!r) {
            issues.push({ severity: 'error', path: p, msg: `unknown block type: ${block.type}` });
            return;
        }

        // paramCount: spec authors often omit trailing nulls — we pad in normalizeBlock,
        // so under-count is just a warning. Over-count is a real error.
        const got = Array.isArray(block.params) ? block.params.length : 0;
        if (got > r.paramCount) {
            issues.push({ severity: 'error', path: p,
                msg: `${block.type}: too many params (got ${got}, expected ${r.paramCount})` });
        } else if (got < r.paramCount && got > 0) {
            issues.push({ severity: 'warning', path: p,
                msg: `${block.type}: paramCount under expected (got ${got}, expected ${r.paramCount}; will be padded with null)` });
        }

        // Slot-type vs value-type cross-check (the bug class we keep hitting).
        if (r.params && Array.isArray(block.params)) {
            for (let i = 0; i < Math.min(block.params.length, r.params.length); i++) {
                const slot = r.params[i];
                const val = block.params[i];
                if (!slot || val == null) continue;
                if (slot.type === 'Indicator' || slot.type === 'Text') continue;
                if (typeof val === 'object' && '__field' in val) continue;  // explicit OK

                if (FIELD_SLOTS.has(slot.type)) {
                    if (typeof val === 'object' && val.type) {
                        issues.push({ severity: 'warning', path: `${p}.params[${i}]`,
                            msg: `${block.type}: field slot (${slot.type}${slot.menu ? ':' + slot.menu : ''}) got block ${val.type} — expected bare ${slot.menu ? slot.menu + ' id' : 'string'}` });
                    }
                }
                // Block slots: any value works (primitives wrap, blocks recurse).
            }
        }

        // statementCount: over is bad, under is OK (means empty branches).
        const sgot = Array.isArray(block.statements) ? block.statements.length : 0;
        if (sgot > r.statementCount) {
            issues.push({ severity: 'error', path: p,
                msg: `${block.type}: too many statements (got ${sgot}, expected ${r.statementCount})` });
        }

        // Recurse.
        (block.params || []).forEach((c, i) => {
            if (c && typeof c === 'object' && c.type) walkBlock(c, `${p}.params[${i}]`);
        });
        (block.statements || []).forEach((th, ti) =>
            (th || []).forEach((b, bi) => walkBlock(b, `${p}.statements[${ti}][${bi}]`)));
    }

    // Object scripts.
    (spec.objects || []).forEach((o, oi) => {
        const tag = o.id ? `${oi}=${o.id}` : `${oi}`;
        const threads = Array.isArray(o.script) ? o.script : [];
        threads.forEach((th, ti) =>
            (th || []).forEach((b, bi) =>
                walkBlock(b, `objects[${tag}].script[${ti}][${bi}]`)));
    });

    // Function content (skip if already stringified — that path is for
    // pre-built strings the author opted into).
    (spec.functions || []).forEach((f, fi) => {
        if (!Array.isArray(f.content)) return;
        const tag = f.id ? `${fi}=${f.id}` : `${fi}`;
        f.content.forEach((th, ti) =>
            (th || []).forEach((b, bi) =>
                walkBlock(b, `functions[${tag}].content[${ti}][${bi}]`)));
    });

    return issues;
}

// -------- Project assembly ----------

function makeDefaultEntity(firstPicture) {
    const pw = firstPicture?.dimension?.width  || 100;
    const ph = firstPicture?.dimension?.height || 100;
    return {
        x: 0, y: 0,
        // Center the registration point (Entry uses this as the sprite's anchor).
        regX: pw / 2, regY: ph / 2,
        // Fit sprite to stage — ~120px tall feels right for default objects.
        scaleX: pw ? 120 / pw : 1, scaleY: ph ? 120 / pw : 1,
        rotation: 0, direction: 90,
        width: pw, height: ph,
        font: 'undefinedpx ',
        visible: true
    };
}

function buildAssets(_spec) {
    // Thin filesystem adapter over the shared bundler (lib/asset-bundler.js).
    // bundleOne(absPath, kind) reads the file off disk, passes bytes to the
    // bundler, and returns the same shape the legacy function returned so
    // buildProject() keeps working unchanged.
    const bundler = createAssetBundler();
    const bundleOne = async (absPath, kind) => {
        if (!fs.existsSync(absPath)) return null;
        const buf = fs.readFileSync(absPath);
        const ext = (path.extname(absPath).slice(1) || 'bin').toLowerCase();
        // path itself is the cacheKey — same file referenced N times → 1 tar entry.
        const r = await bundler.bundle({ buf, ext, kind, cacheKey: 'path:' + absPath });
        return { hash: r.hash, fileurl: r.fileurl, ext: r.ext, dimension: r.dimension };
    };
    // Bundle a Buffer / string directly. Used for sprite-gen output (svgString).
    // cacheKey is content-addressed (sha1) so duplicate generated svgs dedup.
    const bundleBuf = async (buf, ext, kind) => {
        const cacheKey = ext + ':' + crypto.createHash('sha1').update(buf).digest('hex');
        const r = await bundler.bundle({ buf, ext, kind, cacheKey });
        return { hash: r.hash, fileurl: r.fileurl, ext: r.ext, dimension: r.dimension };
    };
    return { bundleOne, bundleBuf, getFiles: () => bundler.getFiles() };
}

export async function buildProject(spec) {
    // Scene ids are plain 4-char random (same style as objects/pictures).
    // Entry's starter project uses '7dwq' (see entryjs src/class/project.js:82),
    // but that's only an implementation detail of the no-args Entry.loadProject().
    // When loading user .ent files we call Entry.clearProject() first
    // (editor.js:loadEntFile), which resets Entry.scene.scenes_ entirely — so any
    // scene id loads cleanly. Real playentry.org projects also have arbitrary
    // scene ids (users delete the initial scene, add new ones, etc.).
    // Regression guard: tests/fixtures/spec-scene-custom-id.json uses 'zzzz'.
    const specScenes = spec.scenes || [{ name: '장면 1' }];
    const scenes = specScenes.map((s, i) => ({
        name: s.name || `장면 ${i + 1}`,
        id: s.id || shortId()
    }));

    // Variables — supports all variableTypes from entrylabs/docs:
    //   'variable' | 'list' | 'timer' | 'answer' | 'slide'
    // Slide variables require minValue/maxValue. List variables require array + width/height.
    // Optional fields (minValue, maxValue, width, height, isRealTime, cloudDate) pass through
    // when set on the spec.
    const variables = [];
    for (const v of (spec.variables || [])) {
        const vt = v.variableType || 'variable';
        const rec = {
            name: v.name,
            id: v.id || shortId(),
            visible: v.visible !== false,
            value: v.value == null ? '0' : String(v.value),
            variableType: vt,
            x: v.x ?? 10,
            y: v.y ?? 10,
            array: v.array || [],
            object: v.object ?? null,
            isCloud: !!v.isCloud
        };
        if (v.isRealTime !== undefined) rec.isRealTime = !!v.isRealTime;
        if (v.cloudDate !== undefined) rec.cloudDate = v.cloudDate;
        if (vt === 'slide') {
            rec.minValue = v.minValue ?? 0;
            rec.maxValue = v.maxValue ?? 100;
        } else if (v.minValue !== undefined) rec.minValue = v.minValue;
        else if (v.maxValue !== undefined) rec.maxValue = v.maxValue;
        if (vt === 'list' || v.width !== undefined) rec.width = v.width ?? 100;
        if (vt === 'list' || v.height !== undefined) rec.height = v.height ?? 120;
        variables.push(rec);
    }
    // Convenience: `spec.lists` is shorthand for `variables` with variableType='list'.
    // Supports `isCloud: true` for 공유 리스트 (cloud-persisted on playentry.org).
    for (const l of (spec.lists || [])) {
        variables.push({
            name: l.name,
            id: l.id || shortId(),
            visible: l.visible !== false,
            value: '0',
            variableType: 'list',
            x: l.x ?? 110,
            y: l.y ?? 10,
            width: l.width ?? 100,
            height: l.height ?? 120,
            array: (l.array || []).map(x => ({ data: String(x) })),
            object: null,
            isCloud: !!l.isCloud
        });
    }

    const assets = buildAssets(spec);
    const objects = [];
    for (const o of (spec.objects || [])) {
        const pictures = [];
        for (const p of (o.pictures || [])) {
            // Bundle into the tar whenever we can resolve the reference. Three
            // cases (in priority order):
            //   1. svgString — generated SVG (sprite-gen). Bundle bytes directly,
            //      content-hashed → duplicate generated SVGs dedup automatically.
            //   2. path / fileurl resolves under public/ → read file, bundle.
            //   3. external (http/data/temp/...) → leave fileurl as-is.
            // Result is a self-contained .ent that works in any Entry editor.
            let bundled = null;
            if (typeof p.svgString === 'string' && p.svgString.length > 0) {
                bundled = await assets.bundleBuf(Buffer.from(p.svgString, 'utf8'), 'svg', 'image');
            } else {
                const localPath = resolveLocalPath(p);
                if (localPath) bundled = await assets.bundleOne(localPath, 'image');
            }
            const fileurl = bundled ? bundled.fileurl : (p.fileurl || null);
            // Picture object shape matches playentry.org's output
            // (Downloads/260423_작품.ent): id, dimension, filename, name,
            // imageType, fileurl — no thumbUrl. Entry's updateThumbnailView
            // falls back to fileurl when thumbUrl is absent.
            pictures.push({
                id: p.id || shortId(),
                dimension: p.dimension || (bundled && bundled.dimension) || { width: 100, height: 100 },
                filename: bundled ? bundled.hash : (p.filename || null),
                name: p.name || path.basename(p.path || p.fileurl || 'picture'),
                imageType: bundled ? bundled.ext : (p.imageType || 'png'),
                fileurl
            });
        }
        const sounds = [];
        for (const s of (o.sounds || [])) {
            const localPath = resolveLocalPath(s);
            const bundled = localPath ? await assets.bundleOne(localPath, 'sound') : null;
            sounds.push({
                id: s.id || shortId(),
                name: s.name || path.basename(s.path || s.fileurl || 'sound'),
                fileurl: bundled ? bundled.fileurl : (s.fileurl || null),
                filename: bundled ? bundled.hash : null,
                ext: '.' + (bundled ? bundled.ext : 'mp3'),
                duration: s.duration ?? 1
            });
        }
        // If no pictures supplied, Entry requires at least one for sprite objects.
        // Bundle public/images/blank/placeholder.svg into the tar so the .ent
        // is self-contained — an SVG path works reliably through Entry's
        // PreloadJS → EaselJS pipeline (a 1x1 PNG or data URL slips past the
        // sprite-creation fast path and triggers addChildAt(undefined)).
        const objectType = o.objectType || 'sprite';
        // Sprite objects need at least one picture; Entry's PreloadJS → EaselJS
        // pipeline trips addChildAt(undefined) without one. textBox objects
        // use a text rendering path and do NOT need a picture.
        if (objectType === 'sprite' && pictures.length === 0) {
            const blankPath = path.join(PUBLIC_DIR, 'images', 'blank', 'placeholder.svg');
            const bundled = fs.existsSync(blankPath)
                ? await assets.bundleOne(blankPath, 'image')
                : null;
            pictures.push({
                id: shortId(),
                dimension: (bundled && bundled.dimension) || { width: 200, height: 240 },
                filename: bundled ? bundled.hash : null,
                name: 'blank',
                imageType: bundled ? bundled.ext : 'png',
                fileurl: bundled ? bundled.fileurl : '/images/blank/placeholder.svg'
            });
        }
        // Entry expects at least one thread array (even if empty). An empty
        // top-level "[]" triggers addChildAt(undefined) during sprite creation;
        // "[[]]" is the canonical empty-but-valid shape.
        const rawThreads = (o.script && o.script.length) ? o.script : [[]];
        const script = rawThreads.map(thread => (thread || []).map(normalizeBlock));
        const sceneId = resolveSceneId(o.scene, scenes);
        const obj = {
            id: o.id || shortId(),
            name: o.name || 'object',
            script: JSON.stringify(script),
            selectedPictureId: pictures[0] ? pictures[0].id : undefined,
            objectType,
            rotateMethod: o.rotateMethod || 'free',
            scene: sceneId,
            sprite: { pictures, sounds },
            entity: Object.assign(makeDefaultEntity(pictures[0]), o.entity || {}),
            lock: !!o.lock
        };
        // textBox carries a `text` field (per entrylabs/docs object-data typedef).
        if (objectType === 'textBox') obj.text = o.text ?? '';
        objects.push(obj);
    }

    const project = {
        name: spec.name || 'Untitled',
        category: spec.category || 'game',
        scenes,
        variables,
        objects,
        expansionBlocks: spec.expansionBlocks || [],
        aiUtilizeBlocks: spec.aiUtilizeBlocks || [],
        hardwareLiteBlocks: spec.hardwareLiteBlocks || [],
        externalModules: spec.externalModules || [],
        externalModulesLite: spec.externalModulesLite || [],
        // User-defined functions. Each function's `content` is a 2-D block array
        // (same shape as object.script). Entry stores it as a JSON-stringified
        // string at runtime, so we stringify it here. If the spec already passes
        // a string, leave it alone.
        // Type semantics:
        //   - 'normal' for void functions (use function_create / func_<id> in callers)
        //   - 'value'  for value-returning functions (function_create_value / func_<id>)
        // Parameters declared with function_field_string become callable via the
        // synthesized type `stringParam_<param_id>` both inside the body and
        // at call sites' params slots.
        functions: (spec.functions || []).map(fn => {
            const out = {
                id: fn.id || shortId(),
                type: fn.type || 'normal',
                localVariables: fn.localVariables || [],
                useLocalVariables: !!fn.useLocalVariables,
                content: typeof fn.content === 'string'
                    ? fn.content
                    : JSON.stringify((fn.content || []).map(thread =>
                        (thread || []).map(normalizeBlock)))
            };
            return out;
        }),
        messages: spec.messages || [],
        tables: spec.tables || [],
        // Entry uses interface.object as the initially-selected object id during load.
        // Leaving it undefined causes addChildAt(undefined) in the render pipeline.
        // menuWidth is optional per entrylabs/docs interface-state typedef.
        interface: spec.interface || {
            canvasWidth: 640,
            menuWidth: 280,
            object: (objects[0] && objects[0].id) || null
        },
        isPracticalCourse: !!spec.isPracticalCourse,
        speed: spec.speed ?? 60
    };
    // AI Learning model id — optional; pass through when spec provides it.
    // (entrylabs/docs project-data typedef: `learning: ID`.)
    if (spec.learning) project.learning = spec.learning;

    const projectJson = {
        name: 'temp/project.json',
        data: Buffer.from(JSON.stringify(project), 'utf8'),
        typeflag: '0'
    };
    const { dirs1, dirs2, dirs3, payloads } = assets.getFiles();
    const files = [
        { name: 'temp/', data: Buffer.alloc(0), typeflag: '5' },
        ...dirs1,
        projectJson,
        ...dirs2,
        ...dirs3,
        ...payloads
    ];
    const gz = zlib.gzipSync(makeTar(files), { memLevel: 6 });
    return { buffer: gz, project };
}

function resolveSceneId(ref, scenes) {
    if (!ref) return scenes[0].id;
    const byId = scenes.find(s => s.id === ref);
    if (byId) return byId.id;
    const byName = scenes.find(s => s.name === ref);
    if (byName) return byName.id;
    return scenes[0].id;
}

// Convenience: write a .ent file in one call.
export async function writeEnt(spec, outPath) {
    const { buffer, project } = await buildProject(spec);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buffer);
    return { outPath, size: buffer.length, objectCount: project.objects.length };
}

// CLI usage:
//   node tools/make-ent.mjs <spec.{json,mjs}> <out.ent>     build .ent
//   node tools/make-ent.mjs --check <spec.{json,mjs}>       validate without building
//
// Spec source:
//   .json → parsed as JSON literally
//   .mjs / .js → dynamically imported; uses `default` export (or whole module)
//                so authors can use the spec-DSL helpers (tools/lib/spec-dsl.mjs)
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1] && process.argv[1].endsWith('make-ent.mjs')) {
    const args = process.argv.slice(2);
    const checkOnly = args.includes('--check');
    const positional = args.filter(a => !a.startsWith('--'));
    const specPath = positional[0];
    const outPath = positional[1];

    if (!specPath || (!checkOnly && !outPath)) {
        console.error('usage:');
        console.error('  node tools/make-ent.mjs <spec.{json,mjs}> <out.ent>     build .ent');
        console.error('  node tools/make-ent.mjs --check <spec.{json,mjs}>       validate only');
        process.exit(1);
    }

    let spec;
    if (/\.(mjs|js)$/i.test(specPath)) {
        const abs = path.resolve(specPath);
        const mod = await import(url.pathToFileURL(abs).href);
        spec = mod.default || mod.spec || mod;
    } else {
        spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    }

    if (checkOnly) {
        const issues = validateSpec(spec);
        let errors = 0, warnings = 0;
        for (const iss of issues) {
            const tag = iss.severity === 'error' ? '✗ ERR' : '⚠ WARN';
            console.log(`${tag}  ${iss.path}\n      ${iss.msg}`);
            if (iss.severity === 'error') errors++; else warnings++;
        }
        const status = errors > 0 ? 'FAIL' : warnings > 0 ? 'OK with warnings' : 'OK';
        console.log(`\n[make-ent --check] ${specPath}: ${status} — ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`);
        process.exit(errors > 0 ? 1 : 0);
    }

    const r = await writeEnt(spec, outPath);
    console.log('[make-ent] wrote', r.outPath, r.size, 'bytes,', r.objectCount, 'objects');
}
