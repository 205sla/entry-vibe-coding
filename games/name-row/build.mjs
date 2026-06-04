// "변수 이름" 행 — 동일 이름 변수 다수를 y=-70 줄에 x 3px 간격으로 배치.
// '정하기' 변수의 값과 일치하는 x 위치의 변수만 보이게 하는 함수 + 일괄 대입 함수.
//
// === 구성 ===
// 변수 "변수 이름" × 240  — y=-70, x ∈ {-239, -237, ..., -3, -1, 1, 3, ..., +237, +239}
//                          (모든 홀수, step 2; x=0 은 자연스럽게 제외되어 Entry quirk 안전)
//                          전부 초기 hide (함수가 한 개만 show).
// 변수 "정하기"            — 위치 선택자. 값이 어떤 변수의 x 와 같으면 그 변수가 보임.
//                          초기값 0 → 어떤 x 와도 안 맞으므로 전부 hidden.
//
// === 함수 ===
// applyX     (위치 보이기) — 160 if_else: 정하기 == v.x 면 show, 아니면 hide.
// setAll (v) (모두 정하기) — 160 set_variable: 모든 "변수 이름" 변수를 v 로 설정.
//
// === 동일 이름 변수에 대해 ===
// Entry 의 setVariables() 는 중복 이름 검사 없이 push (variable_container.js:1167).
// UI 에서 새로 생성할 때만 중복 체크함 (line 1726). 따라서 project.json 으로 load 하면
// 모두 별개 ID 로 공존. 드롭다운에서는 동일 이름이 160 번 나오므로 사용자가
// 개별 선택은 어렵지만, 함수가 ID 로 접근하므로 동작은 정상.
//
// 출력: ./name-row_001.ent (덮어쓰지 않고 자동 넘버링)

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeTar, forEachTarEntry } = require('../../lib/tar-portable.js');
const { uid } = require('uid');

// uid(4) ≈ 168 만 개 공간 → 160+ ID 충돌 회피.
const _usedIds = new Set();
function uniqueId(n = 4) {
    let id;
    do { id = uid(n); } while (_usedIds.has(id));
    _usedIds.add(id);
    return id;
}

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = 'C:/Users/young/Downloads/260517_205님 작품.ent';

const VAR_NAME = '변수 이름';
const Y_ROW    = -70;
const X_STEP   = 2;
const X_MIN    = -239;   // 홀수
const X_MAX    = +239;   // 홀수

// x 값 생성: 홀수 -239..+239 step 2. (홀수만 사용 → x=0 자연 제외.)
const xValues = [];
for (let x = X_MIN; x <= X_MAX; x += X_STEP) {
    xValues.push(x);
}

// 출력 파일명 자동 넘버링.
function nextOutputPath(dir, base) {
    const re = new RegExp(`^${base}_(\\d{3})\\.ent$`);
    const nums = fs.readdirSync(dir)
        .map(f => f.match(re))
        .filter(Boolean)
        .map(m => parseInt(m[1], 10));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return path.join(dir, `${base}_${String(next).padStart(3, '0')}.ent`);
}
const OUT = nextOutputPath(__dirname, 'name-row');

// 1) 원본 .ent 풀기
const srcBuf = fs.readFileSync(SRC);
const tarBuf = zlib.gunzipSync(srcBuf);

const entries = [];
forEachTarEntry(tarBuf, (e) => {
    entries.push({ name: e.name, type: e.type, data: Buffer.from(e.data) });
});

const pjEntry = entries.find(e => e.name === 'temp/project.json' || e.name === './temp/project.json');
if (!pjEntry) throw new Error('temp/project.json not found in source .ent');
const project = JSON.parse(pjEntry.data.toString('utf8'));

// 2) 깨끗한 새 시작 — timer/answer/stt 등 진짜 시스템 변수만 유지, 나머지 모두 제거.
const kept = project.variables.filter(v =>
    v.variableType === 'timer' || v.variableType === 'answer' || v.variableType === 'stt'
);
for (const v of kept) _usedIds.add(v.id);

// 3) "변수 이름" 변수 160 개 생성
const nameRowVars = xValues.map(x => ({
    name: VAR_NAME,
    id: uniqueId(4),
    visible: false,
    value: 0,
    variableType: 'variable',
    isCloud: false,
    isRealTime: false,
    cloudDate: false,
    object: null,
    x,
    y: Y_ROW,
}));

// "정하기" 선택자 변수
const selectorVar = {
    name: '정하기',
    id: uniqueId(4),
    visible: true,
    value: 0,
    variableType: 'variable',
    isCloud: false,
    isRealTime: false,
    cloudDate: false,
    object: null,
    x: -200,
    y: 110,
};

project.variables = [...nameRowVars, selectorVar, ...kept];

// 방어: x=0 또는 y=0 변수 없는지.
for (const v of [...nameRowVars, selectorVar]) {
    if (v.x === 0 || v.y === 0) {
        throw new Error(`variable "${v.name}" 위치 (${v.x}, ${v.y}) — Entry quirk (x=0 또는 y=0).`);
    }
}

// 방어: ID 중복 없는지.
const allIds = project.variables.map(v => v.id);
const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
if (dupes.length) throw new Error(`중복 ID: ${[...new Set(dupes)].join(', ')}`);

// 4) 함수 정의
function makeFunction(id, displayName, body) {
    return {
        id, type: 'normal', localVariables: [], useLocalVariables: false,
        content: JSON.stringify([[{
            type: 'function_create',
            params: [
                { type: 'function_field_label', params: [displayName, null] },
                null,
            ],
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

// applyX body — 정하기 == v.x 면 show, 아니면 hide.
const applyXBody = nameRowVars.map(v => ({
    type: 'if_else',
    params: [
        {
            type: 'boolean_basic_operator',
            params: [
                { type: 'get_variable', params: [selectorVar.id, null] },
                'EQUAL',
                { type: 'number', params: [String(v.x)] },
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
const setAllBody = nameRowVars.map(v => ({
    type: 'set_variable',
    params: [v.id, { type: 'stringParam_v', params: [] }, null],
}));

const fnApplyX = makeFunction ('applyX', '위치 보이기',     applyXBody);
const fnSetAll = makeFunction1('setAll', '모두 정하기', 'v', setAllBody);
project.functions = [fnApplyX, fnSetAll];

// 5) 오브젝트 스크립트 — 트리거 미연결 (사용자가 wire-up).
project.objects[0].script = JSON.stringify([]);

// 6) 프로젝트 이름
project.name = '변수 이름 행 (x 3간격)';

// 7) tar.gz 패키징
pjEntry.data = Buffer.from(JSON.stringify(project));
const tarFiles = entries.map(e => ({ name: e.name, data: e.data, typeflag: e.type || '0' }));
fs.writeFileSync(OUT, zlib.gzipSync(makeTar(tarFiles)));

console.log(`[name-row] wrote ${OUT}`);
console.log(`  variables: ${nameRowVars.length} × "${VAR_NAME}" (y=${Y_ROW}, x step ${X_STEP}) + 정하기 + 시스템 ${kept.length} = ${project.variables.length}`);
console.log(`  x range: ${xValues[0]}..${xValues[xValues.length-1]} (홀수만)`);
console.log(`  functions:`);
console.log(`    "${fnApplyX.id}"    (${applyXBody.length} if_else)        — 정하기 == v.x 면 show`);
console.log(`    "${fnSetAll.id}" (v)    (${setAllBody.length} set_variable)     — 모든 "${VAR_NAME}" 변수에 v 대입`);
console.log(`  오브젝트 스크립트: 비어 있음 (트리거 미연결)`);
