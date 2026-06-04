// 60 변수 시계 — 모두 "시계" 이름. 각 위치에 시·분·초 중 우선순위 높은 값 표시.
//
// === 구성 ===
// 변수 "시계" × 60   — 반지름 120 원, 1 분(=6°) 간격. 위치 0..59. 모두 초기 hide.
// 임시 변수 4 개     — 시위치/분위치/초위치/이전초 (계산용, 숨김).
//
// === 좌표 ===
// 위치 i (0..59) 의 각도 θ = i * 6° (시계방향, 0 = 위).
//   x = 0.5 + 120 * sin(θ)
//   y = 0.5 - 120 * cos(θ)     ← cos 앞 마이너스. Entry variable y > 0 = 화면 아래 (07-runtime-quirks).
// 중심 0.5px 오프셋 — i=0/15/30/45 의 카디널 좌표가 정확히 0 되는 quirk 회피.
//
// === 시계 매핑 ===
// 시위치 = (HOUR mod 12) * 5       // 12 시간 → 60 위치
// 분위치 = MINUTE                   // 0..59
// 초위치 = SECOND                   // 0..59
//
// === 우선순위 (시 > 분 > 초) ===
// 각 위치 i 에 대해 nested if_else:
//   if (i == 시위치)   → 값 = 시,   show
//   elif (i == 분위치) → 값 = "분", show
//   elif (i == 초위치) → 값 = "초", show
//   else               → hide
// 위에서부터 매치되므로 자연스럽게 시 > 분 > 초 우선. 동일 위치 충돌 시 우선 순위 높은 것만.
// 표시값은 시간 숫자가 아닌 핸드 종류 라벨 텍스트 "시"/"분"/"초".
//
// === 함수 ===
// setPos (p, v) (위치 정하기) — 60 _if. 위치 p 의 변수에 v 대입.
// tick           (시계 갱신)  — 초 변경 시 위치 계산 + 우선순위 적용.
//
// === 트리거 ===
// 시작 클릭 → 이전초=-1 → 무한 반복 [tick]
//
// 출력: ./clock_001.ent (자동 넘버링)

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

const VAR_NAME = '시계';
const N        = 60;
const RADIUS   = 120;

// W 실측 (verify-clock.mjs): nameWidth("시계")=25.06, valueWidth("시")=11.28, W=71.34.
// 표시 상태 (값=Korean 1 글자) 기준 중심 정렬. 초기 빈 값 / 0 일 때는 약간 어긋남.
const DISPLAY_W = 71.34;
const HALF_W    = DISPLAY_W / 2;
const Y_VCENTER_OFFSET = 2;         // rect y=-14, h=24 → 시각 중심 y_offset = -2 (anchor 기준 위로 -2)

const ALL_VISIBLE_FOR_VERIFY = process.env.ALL_VISIBLE === '1';

// 60 위치 좌표 — Entry direction (0=위, 시계방향), variable y 부호 반전.
// 좌측 anchor 기준이라 시각 중심이 원 위에 오도록 x 에 -HALF_W, y 에 +Y_VCENTER_OFFSET 적용.
const positions = [];
for (let i = 0; i < N; i++) {
    const theta = i * 6 * Math.PI / 180;
    const x = Math.round((RADIUS * Math.sin(theta) - HALF_W) * 100) / 100;
    const y = Math.round((-RADIUS * Math.cos(theta) + Y_VCENTER_OFFSET) * 100) / 100;
    if (x === 0 || y === 0) {
        throw new Error(`position ${i}: 좌표 (${x}, ${y}) — Entry quirk. DISPLAY_W 조정 필요.`);
    }
    positions.push({ index: i, x, y });
}

function nextOutputPath(dir, base) {
    const re = new RegExp(`^${base}_(\\d{3})\\.ent$`);
    const nums = fs.readdirSync(dir)
        .map(f => f.match(re)).filter(Boolean)
        .map(m => parseInt(m[1], 10));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return path.join(dir, `${base}_${String(next).padStart(3, '0')}.ent`);
}
const OUT = nextOutputPath(__dirname, 'clock');

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

// 3) "시계" 변수 60 개
// ALL_VISIBLE 모드: 모두 visible + 값을 "시" 로 설정 → 표시 상태 시각 중심 검증용.
const clockVars = positions.map(({ index, x, y }) => ({
    name: VAR_NAME,
    id: uniqueId(4),
    visible: ALL_VISIBLE_FOR_VERIFY,
    value: ALL_VISIBLE_FOR_VERIFY ? '시' : 0,
    variableType: 'variable',
    isCloud: false, isRealTime: false, cloudDate: false,
    object: null,
    x, y,
    _pos: index,
}));

// 임시 변수 4 개 (전부 hidden, 화면 밖 측면 배치)
const mkTemp = (name, y) => ({
    name, id: uniqueId(4),
    visible: false, value: 0,
    variableType: 'variable',
    isCloud: false, isRealTime: false, cloudDate: false,
    object: null,
    x: 180, y,
});
const tHourPos = mkTemp('시위치',  80);
const tMinPos  = mkTemp('분위치',  60);
const tSecPos  = mkTemp('초위치',  40);
const tPrevSec = mkTemp('이전초',  20);

const cleanClockVars = clockVars.map(({ _pos, ...rest }) => rest);
const tempVars = [tHourPos, tMinPos, tSecPos, tPrevSec];
project.variables = [...cleanClockVars, ...tempVars, ...kept];

// 방어
for (const v of [...cleanClockVars, ...tempVars]) {
    if (v.x === 0 || v.y === 0) {
        throw new Error(`variable "${v.name}" 위치 (${v.x}, ${v.y}) — Entry quirk`);
    }
}
const allIds = project.variables.map(v => v.id);
const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
if (dupes.length) throw new Error(`중복 ID: ${[...new Set(dupes)].join(', ')}`);

// 4) 함수 정의 헬퍼
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
function makeFunction2(id, displayName, [p1, p2], body) {
    return {
        id, type: 'normal', localVariables: [], useLocalVariables: false,
        content: JSON.stringify([[{
            type: 'function_create',
            params: [
                {
                    type: 'function_field_label',
                    params: [displayName, {
                        type: 'function_field_string',
                        params: [
                            { type: `stringParam_${p1}`, params: [] },
                            {
                                type: 'function_field_string',
                                params: [{ type: `stringParam_${p2}`, params: [] }, null],
                            },
                        ],
                    }],
                },
                null,
            ],
            statements: [body],
        }]]),
    };
}

// 블록 헬퍼
const num     = (n) => ({ type: 'number', params: [String(n)] });
const getDate = (k) => ({ type: 'get_date', params: [null, k, null] });
const getVar  = (id) => ({ type: 'get_variable', params: [id, null] });
const setVar  = (id, val) => ({ type: 'set_variable', params: [id, val, null] });
const calc    = (l, op, r) => ({ type: 'calc_basic', params: [l, op, r] });
const modOp   = (l, r) => ({ type: 'quotient_and_mod', params: [null, l, null, r, null, 'MOD'] });
const eq      = (l, r) => ({ type: 'boolean_basic_operator', params: [l, 'EQUAL', r] });
const neq     = (l, r) => ({ type: 'boolean_basic_operator', params: [l, 'NOT_EQUAL', r] });
const if_     = (cond, body) => ({ type: '_if', params: [cond, null], statements: [body] });
const ifElse  = (cond, then_, else_) => ({ type: 'if_else', params: [cond, null, null], statements: [then_, else_] });
const showVar = (id) => ({ type: 'show_variable', params: [id, null] });
const hideVar = (id) => ({ type: 'hide_variable', params: [id, null] });
const stringP = (id) => ({ type: `stringParam_${id}`, params: [] });
const callFn  = (id, ...args) => ({ type: `func_${id}`, params: args });
const repeatInf = (body) => ({ type: 'repeat_inf', params: [null, null], statements: [body] });

// setPos(p, v) — 위치 p 의 변수에 v 대입. 60 _if.
const setPosBody = clockVars.map(v =>
    if_(eq(stringP('p'), num(v._pos)),
        [setVar(v.id, stringP('v'))])
);

// tick body — 초 변경 시 위치 계산 + 우선순위 적용.
//
// 위치 i 에 대한 우선순위 nested if_else:
//   if (i == 시위치): 시 표시 + show
//   else if (i == 분위치): 분 표시 + show
//   else if (i == 초위치): 초 표시 + show
//   else: hide
// 위에서부터 매치되므로 시 > 분 > 초 자연 우선순위.

// 핸드별 표시 텍스트 ("시"/"분"/"초"). 시간 숫자가 아니라 라벨.
const txt = (s) => ({ type: 'text', params: [s] });
const HOUR_LABEL = txt('시');
const MIN_LABEL  = txt('분');
const SEC_LABEL  = txt('초');

const perPositionBlock = (v) => {
    return ifElse(
        eq(num(v._pos), getVar(tHourPos.id)),
        [setVar(v.id, HOUR_LABEL), showVar(v.id)],
        [
            ifElse(
                eq(num(v._pos), getVar(tMinPos.id)),
                [setVar(v.id, MIN_LABEL), showVar(v.id)],
                [
                    ifElse(
                        eq(num(v._pos), getVar(tSecPos.id)),
                        [setVar(v.id, SEC_LABEL), showVar(v.id)],
                        [hideVar(v.id)]
                    )
                ]
            )
        ]
    );
};

const tickBody = [
    if_(
        neq(getDate('SECOND'), getVar(tPrevSec.id)),
        [
            setVar(tPrevSec.id, getDate('SECOND')),

            // 위치 계산
            setVar(tHourPos.id, calc(modOp(getDate('HOUR'), num(12)), 'MULTI', num(5))),
            setVar(tMinPos.id,  getDate('MINUTE')),
            setVar(tSecPos.id,  getDate('SECOND')),

            // 60 위치에 대해 우선순위 적용
            ...clockVars.map(perPositionBlock),
        ]
    )
];

const fnSetPos = makeFunction2('setPos', '위치 정하기', ['p', 'v'], setPosBody);
const fnTick   = makeFunction ('tick',   '시계 갱신', tickBody);
project.functions = [fnSetPos, fnTick];

// 5) 오브젝트 스크립트
// ALL_VISIBLE 모드에서는 tick 비활성 (모두 visible 유지하고 중심 검증).
project.objects[0].script = ALL_VISIBLE_FOR_VERIFY
    ? JSON.stringify([])
    : JSON.stringify([
        [
            { type: 'when_run_button_click', params: [null] },
            setVar(tPrevSec.id, num(-1)),       // 초기 갱신 강제 (초는 0..59 라 -1 매치 안 됨)
            repeatInf([
                callFn('tick'),
            ]),
        ],
    ]);

// 6) 프로젝트 이름
project.name = '60 변수 시계';

// 7) tar.gz 패키징
pjEntry.data = Buffer.from(JSON.stringify(project));
const tarFiles = entries.map(e => ({ name: e.name, data: e.data, typeflag: e.type || '0' }));
fs.writeFileSync(OUT, zlib.gzipSync(makeTar(tarFiles)));

console.log(`[clock] wrote ${OUT}`);
console.log(`  variables: ${clockVars.length} × "${VAR_NAME}" + 임시 ${tempVars.length} (시위치/분위치/초위치/이전초) + 시스템 ${kept.length} = ${project.variables.length}`);
console.log(`  ALL_VISIBLE_FOR_VERIFY=${ALL_VISIBLE_FOR_VERIFY} | DISPLAY_W=${DISPLAY_W} → HALF_W=${HALF_W}`);
console.log(`  코너 샘플 (anchor):`);
console.log(`    위치 0  (12시) → (${clockVars[0].x}, ${clockVars[0].y})`);
console.log(`    위치 15 (3시)  → (${clockVars[15].x}, ${clockVars[15].y})`);
console.log(`    위치 30 (6시)  → (${clockVars[30].x}, ${clockVars[30].y})`);
console.log(`    위치 45 (9시)  → (${clockVars[45].x}, ${clockVars[45].y})`);
console.log(`  functions:`);
console.log(`    "${fnSetPos.id}" (p, v)  (${setPosBody.length} _if)    — 위치 p 변수에 v 대입`);
console.log(`    "${fnTick.id}"          (${tickBody.length} block top) — 초 변경 시 우선순위 갱신 (시 > 분 > 초)`);
console.log(`  매핑: 시위치=(HOUR%12)*5, 분위치=MINUTE, 초위치=SECOND. 표시값=텍스트 "시"/"분"/"초".`);
console.log(`  트리거: 시작 클릭 → 이전초=-1 → 무한 반복 [tick]`);
