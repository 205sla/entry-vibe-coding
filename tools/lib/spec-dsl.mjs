// Spec authoring DSL — fluent helpers that produce the JSON shapes make-ent.mjs
// expects. Replaces 8-level nested JSON with readable JS.
//
// Authoring style:
//   import { setVar, getVar, calc, if_, repeat, fn, call, fnParam, when, scene, obj, picture } from './lib/spec-dsl.mjs';
//
//   const spec = {
//     name: '예시',
//     variables: [{ id: 'hp', name: '체력', value: '3' }],
//     objects: [
//       obj('player', '플레이어', {
//         picture: '/images/mascot/bot205-idle.svg',
//         script: [
//           when.run(),
//           setVar('hp', 3),
//           repeat.inf([
//             if_(get('press', 'ArrowRight'), [ moveX(4) ]),
//           ]),
//         ],
//       }),
//     ],
//   };
//
// The DSL output is plain JSON — passes straight to make-ent's normalizeBlock,
// which fills in paramCount/statementCount/field-vs-block from the registry.
//
// `__field` sentinel: most field slots are auto-detected by registry slot type
// (Dropdown / DropdownDynamic / Keyboard / TextInput) — bare strings just work.
// Use `field('PLUS')` only when you need to force a synthetic-id slot or when
// the registry doesn't have shape info (rare — synthesized func/stringParam types).

// ── Primitives ───────────────────────────────────────────────────

export const num   = (n) => ({ type: 'number', params: [String(n)] });
export const txt   = (s) => ({ type: 'text',   params: [String(s)] });
export const bool  = (b) => ({ type: b ? 'True' : 'False', params: [] });
export const color = (hex) => ({ type: 'color', params: [hex] });

// Force a value to be unwrapped as a bare-string field (sentinel for cases
// where registry slot info is missing — e.g. function param synthesized types).
export const field = (s) => ({ __field: String(s) });

// ── Variables / lists ────────────────────────────────────────────

// Read a variable. `get_variable` is a primitive — its first param is the
// variable id (bare string), not a wrapped block.
export const getVar = (id) => ({ type: 'get_variable', params: [id, null] });
export const getList = (id) => ({ type: 'get_list', params: [id, null] });
// Canvas input value (e.g. ask_and_wait result). No params.
export const getInput = () => ({ type: 'get_canvas_input_value', params: [] });

// Set / change a variable. Slot 0 (VARIABLE) is a DropdownDynamic field —
// make-ent auto-passes bare strings through (no need for `field()`).
export const setVar    = (id, value) => ({ type: 'set_variable',    params: [id, _val(value), null] });
export const changeVar = (id, delta) => ({ type: 'change_variable', params: [id, _val(delta), null] });

// ── 함수 지역 변수 (function local variables) ─────────────────────
// playentry.org 포맷: 함수의 localVariables[{name,value,id}] (id=`<funcId>_<name>`),
// useLocalVariables:true. 블록은 get_func_variable / set_func_variable 로 참조 —
// VARIABLE 슬롯(DropdownDynamic)에 지역변수 id 를 bare string 으로.
// **change_func_variable 블록은 엔트리에 없음** → 증감은 set + calc(get,+,delta) 합성.
// 보통 직접 쓰기보다 fn.value/fn.normal 의 `locals` 인자 + L 접근자를 쓴다 (아래).
export const getFuncVar    = (lid)        => ({ type: 'get_func_variable', params: [lid, null] });
export const setFuncVar    = (lid, value) => ({ type: 'set_func_variable', params: [lid, _val(value), null] });
export const changeFuncVar = (lid, delta) => ({ type: 'set_func_variable', params: [lid,
    { type: 'calc_basic', params: [{ type: 'get_func_variable', params: [lid, null] }, 'PLUS', _val(delta)] }, null] });

// List ops.
export const addToList    = (value, listId) => ({ type: 'add_value_to_list',     params: [_val(value), listId, null] });
export const removeFromList = (index, listId) => ({ type: 'remove_value_from_list', params: [_val(index), listId, null] });
export const lengthOfList = (listId) => ({ type: 'length_of_list', params: [null, listId, null] });
// 리스트에 값이 포함됐는지 (boolean). is_included_in_list: LIST=1, VALUE=3.
export const isInList = (listId, value) => ({ type: 'is_included_in_list', params: [null, listId, null, _val(value), null] });
export const valueAt      = (listId, index) => ({ type: 'value_of_index_from_list', params: [null, listId, null, _val(index), null] });
export const insertAt     = (value, listId, index) => ({ type: 'insert_value_to_list', params: [_val(value), listId, _val(index), null] });
// 리스트의 N 번째 항목을 X 로 바꾸기 — 클론별 상태를 인덱스 N 슬롯에 broadcast 할 때 핵심.
//   change_value_list_index paramsKeyMap: LIST=0, INDEX=1, DATA=2.
export const setListAt    = (listId, index, value) => ({ type: 'change_value_list_index', params: [listId, _val(index), _val(value), null] });

// String concat — `combine_something` has paramsKeyMap {VALUE1:1, VALUE2:3} with
// Text slots at 0/2/4 (UI labels, leave null). Caller writes `combine(a, b)`.
export const combine = (a, b) => ({ type: 'combine_something', params: [null, _val(a), null, _val(b), null] });

// ── String ops (block_calc.js calc_string 계열) ───────────────────
// 한글 처리(es-hangul 포팅)의 핵심 빌딩블록. Text 슬롯(짝수 인덱스)은 UI 라벨이라
// null, Block 슬롯(홀수)에 값. 인덱스는 모두 1-based (char_at/substring).
//   charAt(s, i)        → s 의 i 번째 글자          (char_at:       LEFTHAND=1, RIGHTHAND=3)
//   substr(s, a, b)     → s 의 a~b 번째까지 부분문자열 (substring:   STRING=1, START=3, END=5)
//   indexOf(s, sub)     → s 에서 sub 의 시작 위치(1-based, 없으면 0) (index_of_string: LEFTHAND=1, RIGHTHAND=3)
//   strLen(s)           → s 의 글자 수              (length_of_string: STRING=1)
//   replaceStr(s, o, n) → s 의 o 를 n 으로 바꾼 문자열 (replace_string: STRING=1, OLD=3, NEW=5)
export const charAt     = (s, i)    => ({ type: 'char_at',          params: [null, _val(s), null, _val(i), null] });
export const substr     = (s, a, b) => ({ type: 'substring',        params: [null, _val(s), null, _val(a), null, _val(b), null] });
export const indexOf    = (s, sub)  => ({ type: 'index_of_string',  params: [null, _val(s), null, _val(sub), null] });
export const strLen     = (s)       => ({ type: 'length_of_string', params: [null, _val(s), null] });
export const replaceStr = (s, o, n) => ({ type: 'replace_string',   params: [null, _val(s), null, _val(o), null, _val(n), null] });

// ── Math ─────────────────────────────────────────────────────────

const OPS = { '+': 'PLUS', '-': 'MINUS', '*': 'MULTI', '/': 'DIVIDE' };

// Binary calc. Operator can be the symbol (+,-,*,/) or the keyword (PLUS,...).
//   calc(a, '+', b)
export const calc = (left, op, right) => ({
    type: 'calc_basic',
    params: [_val(left), OPS[op] || op, _val(right)]
});

// Random integer between min/max.
export const rand = (min, max) => ({
    type: 'calc_rand',
    params: [null, _val(min), null, _val(max), null]
});

// 정수 나머지 / 몫. quotient_and_mod 의 paramsKeyMap: LH=1, RH=3, OPERATOR=5.
//   mod(a, b)      → a % b
//   quotient(a, b) → floor(a / b)
export const mod      = (a, b) => ({ type: 'quotient_and_mod', params: [null, _val(a), null, _val(b), null, 'MOD'] });
export const quotient = (a, b) => ({ type: 'quotient_and_mod', params: [null, _val(a), null, _val(b), null, 'QUOTIENT'] });

// ── Boolean ──────────────────────────────────────────────────────

const CMPS = {
    '==': 'EQUAL', '<': 'LESS', '<=': 'LESS_OR_EQUAL',
    '>':  'GREATER', '>=': 'GREATER_OR_EQUAL', '!=': 'NOT_EQUAL',
};

// Comparison expression. Operator can be the symbol or the keyword.
//   cmp(getVar('hp'), '<=', 0)
export const cmp = (left, op, right) => ({
    type: 'boolean_basic_operator',
    params: [_val(left), CMPS[op] || op, _val(right)]
});

export const and_ = (a, b) => ({ type: 'boolean_and_or', params: [_val(a), 'AND', _val(b)] });
export const or_  = (a, b) => ({ type: 'boolean_and_or', params: [_val(a), 'OR',  _val(b)] });
export const not_ = (a)    => ({ type: 'boolean_not', params: [null, _val(a), null] });

// is_press_some_key — slot 0 is Keyboard (field), accepts bare key code string.
export const isPressed = (keyCode) => ({ type: 'is_press_some_key', params: [String(keyCode), null] });

// reach_something — params [Text, DropdownDynamic('collision'), Text]; VALUE at idx 1.
// 0/2 are UI labels, leave null. Target = sprite id or 'mouse'/'wall'/edge/...
export const reach = (target) => ({ type: 'reach_something', params: [null, target, null] });

// ── Movement / drawing ───────────────────────────────────────────

export const move      = (n)    => ({ type: 'move_direction', params: [_val(n), null] });
export const moveX     = (n)    => ({ type: 'move_x',         params: [_val(n), null] });
export const moveY     = (n)    => ({ type: 'move_y',         params: [_val(n), null] });
export const locateXY  = (x, y) => ({ type: 'locate_xy',      params: [_val(x), _val(y), null] });
// N 초 동안 (x,y) 로 부드럽게 이동 — locate_xy_time. 블로킹 (다른 스크립트는 병렬 실행).
//   paramsKeyMap: VALUE1=seconds(0), VALUE2=x(1), VALUE3=y(2).
export const glideTo   = (sec, x, y) => ({ type: 'locate_xy_time', params: [_val(sec), _val(x), _val(y), null] });
export const turnRel   = (deg)  => ({ type: 'direction_relative', params: [_val(deg), null] });
export const turnAbs   = (deg)  => ({ type: 'direction_absolute', params: [_val(deg), null] });
export const rotateRel = (deg)  => ({ type: 'rotate_relative', params: [_val(deg), null] });
export const bounceWall = ()    => ({ type: 'bounce_wall', params: [null] });

// Set sprite direction to face another object (target = object id or 'mouse').
export const seeAngle = (target) => ({ type: 'see_angle_object', params: [target, null] });

// Coordinate / property of an object (or 'self').
//   coord('self', 'x'), coord('self', 'y'), coord('player', 'x')
export const coord = (target, axis) => ({
    type: 'coordinate_object',
    params: [null, target, null, axis]
});

// Brush.
export const startDraw = () => ({ type: 'start_drawing', params: [null] });
export const stopDraw  = () => ({ type: 'stop_drawing',  params: [null] });
export const eraseAll  = () => ({ type: 'brush_erase_all', params: [null] });
export const setColor  = (hex) => ({ type: 'set_color', params: [color(hex), null] });
export const setThickness = (n) => ({ type: 'set_thickness', params: [_val(n), null] });

// Looks (생김새 카테고리). 17 블록 전부 커버.
export const show = () => ({ type: 'show', params: [null] });
export const hide = () => ({ type: 'hide', params: [null] });

// 효과 (color/brightness/transparency). add 는 누적, set 은 교체.
export const addEffect = (effect, amount) => ({ type: 'add_effect_amount',    params: [effect, _val(amount), null] });
export const setEffect = (effect, amount) => ({ type: 'change_effect_amount', params: [effect, _val(amount), null] });
export const clearEffects = () => ({ type: 'erase_all_effects', params: [null] });

// 크기. change 는 누적, set 은 교체. stretch 는 'WIDTH'/'HEIGHT' 한 축만.
export const changeSize = (delta) => ({ type: 'change_scale_size', params: [_val(delta), null] });
export const setSize    = (size)  => ({ type: 'set_scale_size',    params: [_val(size),  null] });
export const stretch    = (dim, amount) => ({ type: 'stretch_scale_size', params: [dim, _val(amount), null] });
export const resetSize  = ()      => ({ type: 'reset_scale_size',  params: [null] });

// 모양 (picture). next/prev 또는 picture id 명시.
export const nextShape  = ()        => ({ type: 'change_to_next_shape', params: ['next', null] });
export const prevShape  = ()        => ({ type: 'change_to_next_shape', params: ['prev', null] });
export const changeShape = (pictureId) => ({ type: 'change_to_some_shape', params: [pictureId, null] });

// 회전 (좌우/상하 뒤집기).
export const flipX = () => ({ type: 'flip_x', params: [null] });
export const flipY = () => ({ type: 'flip_y', params: [null] });

// z-order: 'FRONT'/'FORWARD'/'BACKWARD'/'BACK'.
export const zOrder = (where) => ({ type: 'change_object_index', params: [where, null] });

// 말풍선 제거.
export const removeDialog = () => ({ type: 'remove_dialog', params: [null] });

// ── Flow ─────────────────────────────────────────────────────────

// `repeat.basic(n, [body])`     → fixed N iterations
// `repeat.inf([body])`          → forever
// `repeat.until(cond, [body])`  → while-not (Entry's repeat_while_true with WAIT op)
export const repeat = {
    basic: (n, body) => ({ type: 'repeat_basic', params: [_val(n), null], statements: [body] }),
    inf:   (body)    => ({ type: 'repeat_inf',   params: [null, null],    statements: [body] }),
};

// `if_(cond, [then])` or `if_(cond, [then], [else_])`.
// _if paramCount=2 [Block, Indicator]; if_else paramCount=3 [Block, Indicator, LineBreak].
export function if_(cond, then_, else_) {
    if (else_ === undefined) {
        return { type: '_if', params: [_val(cond), null], statements: [then_] };
    }
    return { type: 'if_else', params: [_val(cond), null, null], statements: [then_, else_] };
}

export const stopRepeat = () => ({ type: 'stop_repeat', params: [null] });
export const wait = (sec) => ({ type: 'wait_second', params: [_val(sec), null] });

// Clones.
export const createClone = (target = 'self') => ({ type: 'create_clone', params: [target, null] });
export const deleteClone = () => ({ type: 'delete_clone', params: [null] });
export const removeAllClones = () => ({ type: 'remove_all_clones', params: [null] });

// ── Triggers ─────────────────────────────────────────────────────

export const when = {
    run:           () => ({ type: 'when_run_button_click', params: [null] }),
    sceneStart:    () => ({ type: 'when_scene_start',      params: [null] }),
    cloneStart:    () => ({ type: 'when_clone_start',      params: [null] }),
    objectClick:   () => ({ type: 'when_object_click',     params: [null] }),
    message:       (id) => ({ type: 'when_message_cast',   params: [null, id] }),
    keyPressed:    (keyCode) => ({ type: 'when_some_key_pressed', params: [null, String(keyCode)] }),
};

// ── Scene / message control ──────────────────────────────────────

export const startScene = (sceneId) => ({ type: 'start_scene', params: [sceneId, null] });
export const sendMessage = (id) => ({ type: 'message_cast', params: [id, null] });
export const sendMessageWait = (id) => ({ type: 'message_cast_wait', params: [id, null] });

// ── Project timer ────────────────────────────────────────────────

export const timer = {
    start: () => ({ type: 'choose_project_timer_action', params: [null, 'START', null, null] }),
    stop:  () => ({ type: 'choose_project_timer_action', params: [null, 'STOP',  null, null] }),
    reset: () => ({ type: 'choose_project_timer_action', params: [null, 'RESET', null, null] }),
    value: () => ({ type: 'get_project_timer_value', params: [null] }),
};

// ── Dialog / input ───────────────────────────────────────────────

// dialog accepts only static strings — passing numeric values causes
// `_text.replace is not a function` crash. See knowledge/lessons.md.
export const say = (textStr) => ({ type: 'dialog', params: [String(textStr), 'speak', null] });
export const sayFor = (textStr, sec) => ({ type: 'dialog_time', params: [String(textStr), _val(sec), 'speak', null] });
export const askWait = (prompt) => ({ type: 'ask_and_wait', params: [String(prompt), null] });

// ── User-defined functions ───────────────────────────────────────

// Define a function. `params` is an array of parameter ids (each becomes a
// `stringParam_<id>` synthesized slot type). Body is the function body
// statements; `returnExpr` is required for value-returning functions.
//
//   fn.value('fib', ['n'], (n) => [...body], (n) => calc(n, '+', 1))
//   fn.normal('greet', ['who'], (who) => [say(who)])
//
// The body/return are functions that receive parameter access objects:
//   (n) => calc(n, '+', 1)        // n is { type: 'stringParam_n', params: [] }
//
// This avoids manual `function_field_label` / `function_field_string` chains.
//
// **Function-local variables**: pass a `locals` array (names). They become the
// function's `localVariables` (playentry.org format) and an accessor `L` is
// passed as the LAST arg to body/return:
//   L.get(name)         → read  (get_func_variable)
//   L.set(name, v)      → write (set_func_variable)
//   L.change(name, d)   → += d  (set + calc(get,+,d); no change_func_variable block)
//   L.id(name)          → the raw `<funcId>_<name>` id
//
//   fn.value('dbl', ['n'],
//       (n, L) => [ L.set('tmp', calc(n, '*', 2)) ],
//       (n, L) => calc(L.get('tmp'), '+', 1),
//       ['tmp'])                    // ← locals
export const fn = {
    value: (id, paramIds, bodyFn, returnFn, locals = []) =>
        _defineFunction(id, 'value', paramIds, bodyFn, returnFn, locals),
    normal: (id, paramIds, bodyFn, locals = []) =>
        _defineFunction(id, 'normal', paramIds, bodyFn, null, locals),
};

function _defineFunction(id, type, paramIds, bodyFn, returnFn, locals = []) {
    // Each param id becomes a stringParam_<id> synthesized type.
    const paramRefs = paramIds.map(pid => ({ type: `stringParam_${pid}`, params: [] }));

    // Function-local variables — id is `<funcId>_<name>` so a given name maps to
    // a distinct variable per function (no cross-function clobbering). `L` gives
    // body/return blocks convenient get/set/change.
    // 초기값은 **빈 문자열**: 숫자 0 으로 두면 엔트리가 변수를 숫자형으로 취급해
    // set('') 가 '' → 0 으로 강제됨 (문자열 누적이 깨짐). 숫자 지역변수는 읽기 전에
    // 항상 set 하므로 '' 초기값이 무해.
    const localVariables = locals.map(name => ({ name, value: '', id: `${id}_${name}` }));
    const L = {
        get: (name) => getFuncVar(`${id}_${name}`),
        set: (name, val) => setFuncVar(`${id}_${name}`, val),
        change: (name, delta) => changeFuncVar(`${id}_${name}`, delta),
        id: (name) => `${id}_${name}`,
    };

    // Build the function_field_label → function_field_string chain for the
    // function definition's parameter declaration.
    const labelChain = _buildFieldChain(id, paramIds);

    const body = bodyFn ? bodyFn(...paramRefs, L) : [];
    const returnExpr = returnFn ? returnFn(...paramRefs, L) : null;

    const createBlock = type === 'value' ? 'function_create_value' : 'function_create';
    const defParams = type === 'value'
        ? [labelChain, null, null, returnExpr]
        : [labelChain, null];

    return {
        id,
        type,
        localVariables,
        useLocalVariables: localVariables.length > 0,
        content: [[
            {
                id: `${id}_def`,
                x: 50, y: 30,
                type: createBlock,
                params: defParams,
                statements: [body],
            }
        ]],
    };
}

function _buildFieldChain(funcId, paramIds) {
    // Innermost: the last param's function_field_string with null next.
    // Build from right-to-left.
    let chain = null;
    for (let i = paramIds.length - 1; i >= 0; i--) {
        const pid = paramIds[i];
        chain = {
            id: `${funcId}_fs_${pid}`,
            x: 0, y: 0,
            type: 'function_field_string',
            params: [
                { id: `${funcId}_p_${pid}`, x: 0, y: 0, type: `stringParam_${pid}`, params: [] },
                chain,
            ],
        };
    }
    // Wrap with function_field_label (literal name + chain).
    return {
        id: `${funcId}_lbl`,
        x: 0, y: 0,
        type: 'function_field_label',
        params: [{ __field: funcId }, chain],
    };
}

// Call a user-defined function. `id` matches the function's `id` field;
// internal type becomes `func_<id>`.
//   call('fib', n)
//   call('greet', txt('world'))
export function call(id, ...args) {
    return {
        type: `func_${id}`,
        params: args.map(_val),
    };
}

// Inside a function body, reference a parameter by id.
//   fnParam('n')
export const fnParam = (id) => ({ type: `stringParam_${id}`, params: [] });

// ── Object / picture / scene helpers ─────────────────────────────

// Build a picture entry from a public-relative path.
//   picture('/images/mascot/bot205-idle.svg')
//   picture('/images/mascot/bot205-idle.svg', { name: '봇' })
export function picture(path, opts = {}) {
    return {
        id: opts.id,
        name: opts.name,
        fileurl: path,
        imageType: opts.imageType || 'svg',
        dimension: opts.dimension || { width: 200, height: 240 },
    };
}

// Convert a sprite-gen output ({svgString, dimension, imageType}) into a picture
// entry. Used internally by obj() — also exported so callers can wrap manually.
export function pictureFromGen(gen, opts = {}) {
    return {
        id: opts.id,
        name: opts.name || 'generated',
        svgString: gen.svgString,
        dimension: opts.dimension || gen.dimension,
        imageType: gen.imageType || 'svg',
    };
}

// Build a sprite object spec.
//   obj('player', '플레이어', { picture: '/path/to.svg', scene, entity, script: [...] })
//   obj('ball',   '공',       { picture: gen.circle(15, '#3b82f6'), script })
//   obj('display','글상자',   { objectType: 'textBox', text: '안녕', entity: { font: '20px NanumGothic' }, script })
//
// `picture` can be:
//   - string (public-relative path, auto-bundled)
//   - sprite-gen output ({ svgString, dimension }) — auto-wrapped via pictureFromGen
//   - explicit picture object ({ id, fileurl, dimension, ... } or { svgString, ... })
export function obj(id, name, opts = {}) {
    let pic = null;
    if (opts.picture) {
        if (typeof opts.picture === 'string') {
            pic = picture(opts.picture);
        } else if (opts.picture.svgString && !opts.picture.imageType) {
            // Bare gen output without explicit imageType — wrap.
            pic = pictureFromGen(opts.picture);
        } else {
            pic = opts.picture;
        }
    }
    const out = {
        id,
        name,
        objectType: opts.objectType || 'sprite',
        scene: opts.scene,
        pictures: pic ? [pic] : (opts.pictures || []),
        entity: opts.entity || { x: 0, y: 0, scaleX: 0.4, scaleY: 0.4, direction: 90 },
        script: opts.script ? [opts.script] : (opts.threads || [[]]),
    };
    if (opts.text !== undefined) out.text = opts.text;
    return out;
}

// textBox helpers — only run on objectType:'textBox' (engine isNotFor:['sprite']).
export const writeText  = (value) => ({ type: 'text_write',  params: [_val(value), null] });
export const appendText = (value) => ({ type: 'text_append', params: [_val(value), null] });
export const flushText  = ()      => ({ type: 'text_flush',  params: [null] });

// Build a scene entry.
export const scene = (id, name) => ({ id, name });

// ── Internal: coerce a JS value into the "slot value" shape make-ent expects ──

// make-ent's wrapParam handles:
//   number → number block, string → ... (depends on slot shape), {type:...} → block
// So we don't need to wrap most things here. But we DO want to wrap "raw" values
// the user passes when they're not already block objects, to make composition
// clean. This is essentially identity for already-shaped values.
function _val(v) {
    if (v == null) return null;
    if (typeof v === 'object' && (v.type || '__field' in v)) return v;
    return v;  // make-ent's wrapParam takes care of primitives + slot context
}
