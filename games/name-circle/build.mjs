// "변수" 원형 — 동일 이름 변수 360 개를 반지름 120 원 둘레에 1° 간격 배치.
// '보이기' 리스트에 각도가 포함된 변수만 show, 나머지는 hide.
//
// === 좌표 ===
// 각도 i (0..359) 에 대해 (Entry direction — 0=위, 시계방향, variable y > 0 = 화면 아래)
//   visual_center_x = RADIUS * sin(i°)
//   visual_center_y = -RADIUS * cos(i°)
// 변수 디스플레이의 anchor 가 좌측이므로 anchor x = visual_center_x - W/2.
// 디스플레이 높이 24 의 anchor 는 위에서 14 (= visual_center_y - (-2) → y_anchor = visual_center_y + 2 in 캔버스 좌표 기준).
// W 는 nameWidth + valueWidth + 35 (variable.js _adjustSingleViewBox).
//   "변수" (2 글자) + 기본값 "0" (1 글자) 라서 W ≈ 60 (실측 후 조정).
//
// Entry quirk (x=0/y=0 → bin-packer 폴백) 회피는 offset 자체가 비정수 좌표 만들기 때문에 자연 해소.
// 검증: 모든 360 점에서 anchor x ≠ 0, anchor y ≠ 0 (W/2 와 2 가 sin/cos*120 과 정수 교차 안 함).
//
// === 함수 ===
// updateVisibility (보이기 갱신)  — 360 if_else. "보이기" 리스트에 v.angle 포함 → show, 아니면 hide.
// setAll (v)        (모두 정하기) — 360 set_variable. 모든 "변수" 변수에 v 대입.
//
// === 트리거 ===
// 장면 시작 → updateVisibility 호출.
//
// 출력: ./name-circle_NNN.ent (자동 넘버링)

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeTar, forEachTarEntry } = require('../../lib/tar-portable.js');
const { uid } = require('uid');

const _usedIds = new Set();
function uniqueId(n = 4) {
    let id;
    do { id = uid(n); } while (_usedIds.has(id));
    _usedIds.add(id);
    return id;
}

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = 'C:/Users/young/Downloads/260517_205님 작품.ent';

const VAR_NAME = '변수';
const N        = 360;
const RADIUS   = 120;
// W 실측 (verify-name-circle.mjs 측정): nameWidth("변수")=25.06, valueWidth("0")=7.27, W=67.33.
// 값이 바뀌면 W 도 바뀌어 중심이 어긋남 — 기본값 "0" 기준으로 중심 맞춤.
const DISPLAY_W = 67.33;
const HALF_W   = DISPLAY_W / 2;
const Y_VCENTER_OFFSET = 2;   // anchor.y → 시각 중심 y 오프셋 (rect 가 y=-14 부터 24 높이 → 중심 -2)

const ALL_VISIBLE_FOR_VERIFY = process.env.ALL_VISIBLE === '1';

// 각도별 좌표 생성. 좌측 anchor 기준이라 visual center 가 원 위에 오도록 x 에 -W/2 보정.
const angleCoords = [];
for (let i = 0; i < N; i++) {
    const theta = i * Math.PI / 180;
    const x = Math.round((RADIUS * Math.sin(theta) - HALF_W) * 100) / 100;
    const y = Math.round((-RADIUS * Math.cos(theta) + Y_VCENTER_OFFSET) * 100) / 100;
    if (x === 0 || y === 0) {
        throw new Error(`angle ${i}: 좌표 (${x}, ${y}) — Entry quirk 발동. DISPLAY_W 조정 필요.`);
    }
    angleCoords.push({ angle: i, x, y });
}

function nextOutputPath(dir, base) {
    const re = new RegExp(`^${base}_(\\d{3})\\.ent$`);
    const nums = fs.readdirSync(dir)
        .map(f => f.match(re)).filter(Boolean)
        .map(m => parseInt(m[1], 10));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return path.join(dir, `${base}_${String(next).padStart(3, '0')}.ent`);
}
const OUT = nextOutputPath(__dirname, 'name-circle');

// 1) 원본 .ent 풀기
const srcBuf = fs.readFileSync(SRC);
const tarBuf = zlib.gunzipSync(srcBuf);
const entries = [];
forEachTarEntry(tarBuf, (e) => entries.push({ name: e.name, type: e.type, data: Buffer.from(e.data) }));
const pjEntry = entries.find(e => e.name === 'temp/project.json' || e.name === './temp/project.json');
const project = JSON.parse(pjEntry.data.toString('utf8'));

// 2) 시스템 변수만 유지.
const kept = project.variables.filter(v =>
    v.variableType === 'timer' || v.variableType === 'answer' || v.variableType === 'stt'
);
for (const v of kept) _usedIds.add(v.id);

// 3) "변수" 변수 360 개
const circleVars = angleCoords.map(({ angle, x, y }) => ({
    name: VAR_NAME,
    id: uniqueId(4),
    visible: ALL_VISIBLE_FOR_VERIFY,    // 기본 false. ENV ALL_VISIBLE=1 빌드 시 true (중심 검증용).
    value: 0,
    variableType: 'variable',
    isCloud: false, isRealTime: false, cloudDate: false,
    object: null,
    x, y,
    _angle: angle,
}));

// 4) "보이기" 리스트 (빈 상태)
const visibleList = {
    name: '보이기',
    id: uniqueId(4),
    visible: false,
    value: '0',
    variableType: 'list',
    isCloud: false, isRealTime: false, cloudDate: false,
    object: null,
    x: 200, y: 100,
    width: 100, height: 120,
    array: [],
};

// 애니메이션 상태 변수
const mkTemp = (name, y) => ({
    name, id: uniqueId(4),
    visible: false, value: 0,
    variableType: 'variable',
    isCloud: false, isRealTime: false, cloudDate: false,
    object: null,
    x: 180, y,
});
const tFirst = mkTemp('첫번째', 80);   // 1 번째 항목의 현재 각도 (0..step-1)
const tStep  = mkTemp('단계',   60);   // 360 / N (항목 간 간격)

const cleanCircleVars = circleVars.map(({ _angle, ...rest }) => rest);
const tempVars = [tFirst, tStep];
project.variables = [...cleanCircleVars, visibleList, ...tempVars, ...kept];

// 방어
for (const v of [...cleanCircleVars]) {
    if (v.x === 0 || v.y === 0) {
        throw new Error(`variable "${v.name}" 위치 (${v.x}, ${v.y}) — Entry quirk`);
    }
}
const allIds = project.variables.map(v => v.id);
const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
if (dupes.length) throw new Error(`중복 ID: ${[...new Set(dupes)].join(', ')}`);

// 5) 함수 정의 헬퍼
function makeFunction(id, displayName, body) {
    return {
        id, type: 'normal', localVariables: [], useLocalVariables: false,
        content: JSON.stringify([[{
            type: 'function_create',
            params: [{ type: 'function_field_label', params: [displayName, null] }, null],
            statements: [body],
        }]]),
    };
}
function makeFunction1(id, displayName, paramId, body) {
    return {
        id, type: 'normal', localVariables: [], useLocalVariables: false,
        content: JSON.stringify([[{
            type: 'function_create',
            params: [
                {
                    type: 'function_field_label',
                    params: [displayName, {
                        type: 'function_field_string',
                        params: [{ type: `stringParam_${paramId}`, params: [] }, null],
                    }],
                },
                null,
            ],
            statements: [body],
        }]]),
    };
}

// 블록 헬퍼 (애니메이션 thread 용)
const num     = (n) => ({ type: 'number', params: [String(n)] });
const getVar  = (id) => ({ type: 'get_variable', params: [id, null] });
const setVar  = (id, val) => ({ type: 'set_variable', params: [id, val, null] });
const calc    = (l, op, r) => ({ type: 'calc_basic', params: [l, op, r] });
const quot    = (l, r) => ({ type: 'quotient_and_mod', params: [null, l, null, r, null, 'QUOTIENT'] });
const modOp   = (l, r) => ({ type: 'quotient_and_mod', params: [null, l, null, r, null, 'MOD'] });
const eq      = (l, r) => ({ type: 'boolean_basic_operator', params: [l, 'EQUAL', r] });
const geq     = (l, r) => ({ type: 'boolean_basic_operator', params: [l, 'GREATER_OR_EQUAL', r] });
const lt      = (l, r) => ({ type: 'boolean_basic_operator', params: [l, 'LESS', r] });
const if_     = (cond, body) => ({ type: '_if', params: [cond, null], statements: [body] });
const ifElse  = (cond, then_, else_) => ({ type: 'if_else', params: [cond, null, null], statements: [then_, else_] });
const stringP = (id) => ({ type: `stringParam_${id}`, params: [] });
const callFn  = (id, ...args) => ({ type: `func_${id}`, params: args });
const repeatInf   = (body) => ({ type: 'repeat_inf',   params: [null, null], statements: [body] });
const repeatBasic = (n, body) => ({ type: 'repeat_basic', params: [n, null], statements: [body] });
const listLen     = (listId) => ({ type: 'length_of_list', params: [null, listId, null] });
const addToList   = (val, listId) => ({ type: 'add_value_to_list', params: [val, listId, null] });
const removeFromList = (idx, listId) => ({ type: 'remove_value_from_list', params: [idx, listId, null] });
const changeList  = (listId, idx, val) => ({ type: 'change_value_list_index', params: [listId, idx, val, null] });

// updateVisibility body — 360 if_else. "보이기" 리스트에 각도 포함 → show, 아니면 hide.
// 비교값은 각도 그대로 ("0", "1", ..., "359"). leading zero 없음.
const updateVisibilityBody = circleVars.map(v => ({
    type: 'if_else',
    params: [
        {
            type: 'is_included_in_list',
            params: [
                null,
                visibleList.id,
                null,
                { type: 'text', params: [String(v._angle)] },
                null,
            ],
        },
        null, null,
    ],
    statements: [
        [{ type: 'show_variable', params: [v.id, null] }],
        [{ type: 'hide_variable', params: [v.id, null] }],
    ],
}));

// setAll(v) body
const setAllBody = circleVars.map(v => ({
    type: 'set_variable',
    params: [v.id, { type: 'stringParam_v', params: [] }, null],
}));

// updateAt(i) — 재귀 함수. 리스트 i 번째 항목을 (첫번째 + (i-1)*단계) mod 360 으로 갱신.
// i 가 length(보이기) 초과하면 종료. 재귀 호출은 repeat 의 60fps 틱을 우회
// (07-runtime-quirks "함수 호출은 반복하기의 60fps 틱을 우회").
const updateAtBody = [
    if_(
        lt(stringP('i'), calc(listLen(visibleList.id), 'PLUS', num(1))),
        [
            // list[i] = (첫번째 + (i-1) * 단계) mod 360
            changeList(
                visibleList.id,
                stringP('i'),
                modOp(
                    calc(
                        getVar(tFirst.id),
                        'PLUS',
                        calc(calc(stringP('i'), 'MINUS', num(1)), 'MULTI', getVar(tStep.id))
                    ),
                    num(360)
                )
            ),
            callFn('updateAt', calc(stringP('i'), 'PLUS', num(1))),
        ]
    ),
];

const fnUpdateVis = makeFunction ('updateVisibility', '보이기 갱신',   updateVisibilityBody);
const fnSetAll    = makeFunction1('setAll',           '모두 정하기',  'v', setAllBody);
const fnUpdateAt  = makeFunction1('updateAt',         'updateAt',     'i', updateAtBody);
project.functions = [fnUpdateVis, fnSetAll, fnUpdateAt];

// 6) 오브젝트 스크립트 — 시작 버튼 클릭 시 애니메이션.
//
// 흐름:
//   초기화: 보이기 리스트 비우고 [0] 으로 시작. 첫번째=0, 단계=360.
//   반복:
//     updateAt(1) 호출 → 리스트 항목을 (첫번째 + (i-1)*단계) mod 360 으로 갱신
//     updateVisibility 호출 → 리스트에 포함된 각도 변수만 show
//     첫번째 += 1
//     만일 첫번째 >= 단계 라면:
//       첫번째 = 0
//       만일 length(보이기) < 360 라면:
//         add 0 to 보이기  (다음 iter 에서 updateAt 이 덮어씀)
//         단계 = 360 / length(보이기)
project.objects[0].script = JSON.stringify([
    [
        { type: 'when_run_button_click', params: [null] },
        // 리스트 비우기 (재실행 대비) — length 만큼 1 번째 항목을 반복 제거
        repeatBasic(listLen(visibleList.id), [removeFromList(num(1), visibleList.id)]),
        // 초기 상태: [0], 첫번째=0, 단계=360
        addToList(num(0), visibleList.id),
        setVar(tFirst.id, num(0)),
        setVar(tStep.id,  num(360)),
        // 메인 루프
        repeatInf([
            callFn('updateAt', num(1)),
            callFn(fnUpdateVis.id),
            setVar(tFirst.id, calc(getVar(tFirst.id), 'PLUS', num(1))),
            if_(
                geq(getVar(tFirst.id), getVar(tStep.id)),
                [
                    setVar(tFirst.id, num(0)),
                    if_(
                        lt(listLen(visibleList.id), num(360)),
                        [
                            addToList(num(0), visibleList.id),
                            setVar(tStep.id, quot(num(360), listLen(visibleList.id))),
                        ]
                    ),
                ]
            ),
        ]),
    ],
]);

// 7) 프로젝트 이름
project.name = '변수 원 (반지름 120, 보이기 리스트 멤버십)';

// 8) tar.gz 패키징
pjEntry.data = Buffer.from(JSON.stringify(project));
const tarFiles = entries.map(e => ({ name: e.name, data: e.data, typeflag: e.type || '0' }));
fs.writeFileSync(OUT, zlib.gzipSync(makeTar(tarFiles)));

console.log(`[name-circle] wrote ${OUT}`);
console.log(`  variables: ${circleVars.length} × "${VAR_NAME}" + 리스트 "보이기" + 시스템 ${kept.length} = ${project.variables.length}`);
console.log(`  ALL_VISIBLE_FOR_VERIFY=${ALL_VISIBLE_FOR_VERIFY} (env ALL_VISIBLE=1 로 활성)`);
console.log(`  DISPLAY_W=${DISPLAY_W} → HALF_W=${HALF_W} (anchor x offset)`);
console.log(`  좌표 샘플 (anchor):`);
console.log(`    0°  (12시) → (${circleVars[0].x}, ${circleVars[0].y})`);
console.log(`    90° (3시)  → (${circleVars[90].x}, ${circleVars[90].y})`);
console.log(`    180°(6시)  → (${circleVars[180].x}, ${circleVars[180].y})`);
console.log(`    270°(9시)  → (${circleVars[270].x}, ${circleVars[270].y})`);
console.log(`  functions:`);
console.log(`    "${fnUpdateVis.id}" (${updateVisibilityBody.length} if_else) — "보이기" 리스트 멤버십 → show/hide`);
console.log(`    "${fnSetAll.id}" (v) (${setAllBody.length} set_variable) — 모든 "${VAR_NAME}" 변수에 v 대입`);
console.log(`    "${fnUpdateAt.id}" (i) — 재귀: list[i] = (첫번째 + (i-1)*단계) mod 360, 그 다음 updateAt(i+1)`);
console.log(`  트리거: 시작 클릭 → 보이기 리스트=[0]+첫번째=0+단계=360 → 무한반복 [updateAt(1), updateVisibility, 첫번째++, 단계 도달 시 확장]`);
console.log(`  애니메이션: [0]→[1]→...→[359] → [0,180]→[1,181]→...→[179,359] → [0,120,240]→... → ... (N=360 까지 확장 후 정지)`);
