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
            params[i] = wrapParam(spec.params[i]);
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

// Wrap a param value into Entry's nested block-or-literal shape.
//   null                     → null (empty slot)
//   number                   → { type: 'number', params: [String(n)] }
//   string                   → { type: 'text',   params: [s] }
//   boolean-ish              → { type: 'True'|'False', params: [] }
//   { type }                 → pass through (Entry block)
//   { __field: "mouse" }     → bare string "mouse" (Dropdown/DropdownDynamic
//                              field value — must NOT be wrapped as a text
//                              block, e.g. see_angle_object's target slot
//                              or set_variable's VARIABLE slot which takes
//                              a variable id like "abcd", not a text block)
function wrapParam(v) {
    if (v == null) return null;
    if (typeof v === 'number') return { type: 'number', params: [String(v)] };
    if (typeof v === 'string') return { type: 'text', params: [v] };
    if (typeof v === 'boolean') return { type: v ? 'True' : 'False', params: [] };
    if (typeof v === 'object' && '__field' in v) return v.__field;
    if (typeof v === 'object' && v.type) return normalizeBlock(v);
    return v;
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
        const r = await bundler.bundle({ buf, ext, kind });
        return { hash: r.hash, fileurl: r.fileurl, ext: r.ext, dimension: r.dimension };
    };
    return { bundleOne, getFiles: () => bundler.getFiles() };
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
            // Bundle into the tar whenever we can resolve the reference to a
            // file under public/ (or an explicit `path`). The result is a
            // self-contained .ent that works in any Entry editor — not just
            // against this repo's server.
            const localPath = resolveLocalPath(p);
            const bundled = localPath ? await assets.bundleOne(localPath, 'image') : null;
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

// CLI: `node tools/make-ent.mjs <spec.json> <out.ent>`
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1] && process.argv[1].endsWith('make-ent.mjs')) {
    const [specPath, outPath] = process.argv.slice(2);
    if (!specPath || !outPath) {
        console.error('usage: node tools/make-ent.mjs <spec.json> <out.ent>');
        process.exit(1);
    }
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const r = await writeEnt(spec, outPath);
    console.log('[make-ent] wrote', r.outPath, r.size, 'bytes,', r.objectCount, 'objects');
}
