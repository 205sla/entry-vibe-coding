// 배드애플 변수 그리드 생성기
//
// C:/Users/young/Downloads/260517_205님 작품.ent 를 베이스로,
// 기존 11 개 숫자 변수(00~10) 를 가로 26 × 세로 11 = 286 개 그리드로 교체.
// 시스템 변수(초시계, 대답) 와 오브젝트/씬은 그대로 유지.
//
// 변수 이름: "000" ~ "285" (3 자리 0 패딩).
// 매핑: index = row * 26 + col. row 0 = 화면 위, col 0 = 화면 왼쪽.
//
// === 추가 (오브젝트 스크립트 2 thread) ===
// thread 1 — 장면 시작 시 보이기 멤버십으로 show/hide:
//   장면이 시작되었을 때
//     for each 변수 ("285" → "000"):
//       만일 (리스트 "보이기" 에 "<name>" 이 포함되어 있는가) (이)라면
//         변수 <name> 보이기
//       아니면
//         변수 <name> 숨기기
//   리스트 "보이기" 는 빈 상태로 생성됨 → 모든 변수가 처음에 숨겨짐.
//
// thread 2 — 시작 버튼 클릭 시 "변수 정하기" 리스트 각 줄에서 글자 추출:
//   시작하기 버튼을 클릭했을 때
//     for each idx (0..285):
//       row = idx / 26, col = idx % 26 (둘 다 0-indexed → +1)
//       변수 "<idx>" 를 (리스트 "변수 정하기" 의 (row+1)번째 항목 의 (col+1)번째 글자) 로 정하기
//   리스트 "변수 정하기" 는 빈 상태로 생성됨 — 사용자가 11 줄 × 26 글자 프레임 데이터를 채워야 함.
//
// === 가시성 (변수 박스 겹침) ===
// 변수 디스플레이는 nameWidth + valueWidth + 35 폭 (≈ 64px), 파란 박스는 이름 우측 22px.
// 렌더 순서 = 배열 순서, 늦은 게 위. 가로 26 칸을 480 폭에 안 욱여넣으면 반드시 겹침.
// 절충 1: 가로 간격 22px (480 보다 살짝 넓어 좌우 67px 무대 밖).
// 절충 2: 그리드 배열을 285→000 역순으로 저장 → 낮은 이름이 위에 옴
//          → 각 변수의 우측 이웃은 뒤로 가서 파란 박스를 가리지 않음.
//          → 좌측 이웃이 6px (≈ 27%) 정도 파란 박스 좌단을 가리지만 숫자 자체는 안 가려짐.
//
// === 출력 ===
// 덮어쓰지 않고 ./bad-apple_001.ent, _002.ent ... 순으로 자동 넘버링.

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeTar, forEachTarEntry } = require('../../lib/tar-portable.js');
const { uid } = require('uid');

// uid(4) 는 36^4 ≈ 168 만 개 ID 공간 → 변수 288 개 생성 시 충돌 확률 ≈ 2.4%.
// 실제로 변수 284 와 133 이 같은 ID 가 되는 사고가 발생함. 중복 회피를 위한 wrapper.
const _usedIds = new Set();
function uniqueId(n = 4) {
    let id;
    do { id = uid(n); } while (_usedIds.has(id));
    _usedIds.add(id);
    return id;
}

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = 'C:/Users/young/Downloads/260517_205님 작품.ent';

const COLS = 26;
const ROWS = 11;
const X_STEP = 22;                            // 22px 가로 간격 (절충)
const Y_STEP = 24;                            // 24px 세로 간격 (디스플레이 높이 = 행 간격)
const W = 64;                                 // 변수 디스플레이 가로 폭 추정치 (이름 3 자리 + 값 1 자리)

// 그리드 시각 영역을 화면 중앙에 맞춤
// 시각 영역: [X_LEFT, X_LEFT + (COLS-1)*X_STEP + W]
// 중앙: X_LEFT + ((COLS-1)*X_STEP + W) / 2 = 0
// →  X_LEFT = -((COLS-1)*X_STEP + W) / 2
const X_LEFT = -((COLS - 1) * X_STEP + W) / 2;    // = -307
//
// === Y_OFFSET = 1: Entry quirk 회피 ===
// entryjs/src/class/variable/variable.js:127 에서
//   if (this.getX() && this.getY()) { ... 저장된 좌표 사용 ... }
//   else                            { ... bin-packer 폴백 위치 사용 ... }
// JavaScript truthy check 때문에 x=0 또는 y=0 이면 폴백 발동.
// ROWS=11, Y_STEP=24, 중앙=0 이면 row 5 가 정확히 y=0 → 그 행만 흩어짐.
// Y_OFFSET 1 만큼 위로 살짝 밀어서 row 5 가 y=1 이 되도록 함.
const Y_OFFSET = 1;
const Y_TOP    = ((ROWS - 1) * Y_STEP) / 2 + Y_OFFSET;   // = +121

// 출력 파일명: bad-apple_NNN.ent 패턴 중 최대 번호 + 1.
function nextOutputPath(dir, base) {
    const re = new RegExp(`^${base}_(\\d{3})\\.ent$`);
    const nums = fs.readdirSync(dir)
        .map(f => f.match(re))
        .filter(Boolean)
        .map(m => parseInt(m[1], 10));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return path.join(dir, `${base}_${String(next).padStart(3, '0')}.ent`);
}
const OUT = nextOutputPath(__dirname, 'bad-apple');

// 1) 원본 .ent 읽고 풀기
const srcBuf = fs.readFileSync(SRC);
const tarBuf = zlib.gunzipSync(srcBuf);

const entries = [];
forEachTarEntry(tarBuf, (e) => {
    entries.push({ name: e.name, type: e.type, data: Buffer.from(e.data) });
});

// 2) project.json 찾아 변수/스크립트 교체
const pjEntry = entries.find(e => e.name === 'temp/project.json' || e.name === './temp/project.json');
if (!pjEntry) throw new Error('temp/project.json not found in source .ent');

const project = JSON.parse(pjEntry.data.toString('utf8'));

// 기존 변수/리스트 중 빌드 결과물 (그리드 + 우리 리스트) 만 제거. 시스템 변수는 유지.
const OUR_LISTS = ['보이기', '변수 정하기', '보이기2'];
const isOurOwn = (v) => {
    if (v.variableType === 'list') return OUR_LISTS.includes(v.name);
    if (v.variableType === 'variable') return /^\d+$/.test(v.name);
    return false;
};
const kept = project.variables.filter(v => !isOurOwn(v));

// 기존 시스템 변수 ID 도 충돌 회피 집합에 시드.
for (const v of kept) _usedIds.add(v.id);

// 286 개 새 변수 생성 — gridByIdx[i] 는 변수 "iii" 의 객체 (인덱스 = 이름 숫자).
// 스크립트에서 인덱스로 빠르게 참조하기 위해 배열로 보관.
const gridByIdx = [];
for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const name = String(idx).padStart(3, '0');
        gridByIdx.push({
            name,
            id: uniqueId(4),
            visible: true,
            value: 0,
            variableType: 'variable',
            isCloud: false,
            isRealTime: false,
            cloudDate: false,
            object: null,
            x: X_LEFT + c * X_STEP,
            y: Y_TOP  - r * Y_STEP,
        });
    }
}

// project.variables 에는 285→000 역순으로 저장 → 렌더 시 낮은 이름이 위.
// gridByIdx 자체는 0..285 순서를 유지 (스크립트 생성에서 그대로 인덱싱).
const gridReversed = gridByIdx.slice().reverse();

// 방어: x=0 또는 y=0 이면 Entry quirk 발동 → 폴백 위치로 흩어짐.
for (const v of gridByIdx) {
    if (v.x === 0 || v.y === 0) {
        throw new Error(
            `variable "${v.name}" 위치 (${v.x}, ${v.y}) — Entry quirk 발동 (x=0 또는 y=0). ` +
            `Y_OFFSET 또는 X_LEFT 조정 필요.`
        );
    }
}

// 3) 리스트 생성
// "보이기"     — show/hide 멤버십 체크용 (빈 리스트)
// "변수 정하기" — 프레임 데이터 소스 (11 줄 × 26 글자 가정, 빈 리스트로 시작)
const mkList = (name, x, y) => ({
    name,
    id: uniqueId(4),
    visible: false,
    value: '0',
    variableType: 'list',
    isCloud: false,
    isRealTime: false,
    cloudDate: false,
    object: null,
    x, y,
    width: 100,
    height: 120,
    array: [],
});
const visibleList  = mkList('보이기',      200, 100);
const dataList     = mkList('변수 정하기', 200, -40);
const matrixList   = mkList('보이기2',      80, 100);

project.variables = [...gridReversed, visibleList, dataList, matrixList, ...kept];

// 방어: 최종 변수/리스트 ID 가 모두 unique 한지 어서션.
const allIds = project.variables.map(v => v.id);
const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
if (dupes.length) {
    throw new Error(`중복 ID 발견: ${[...new Set(dupes)].join(', ')}. uniqueId() 로직 점검 필요.`);
}

// 4) 사용자 정의 함수 2 개 + 오브젝트 스크립트 (각 트리거 → 함수 호출)
//
// 블록 정규형 메모:
//   when_scene_start          params=[null]
//   when_run_button_click     params=[null]
//   if_else                   params=[BOOL, null, null]    statements=[[then],[else]]
//   is_included_in_list       params=[null, listId, null, {type:'text', params:[val]}, null]
//   show_variable / hide_variable  params=[variableId, null]
//   set_variable              params=[variableId, valueBlock, null]
//   char_at                   params=[null, sourceBlock, null, indexBlock, null]
//   value_of_index_from_list  params=[null, listId, null, indexBlock, null]
//   number / text             params=[stringValue]  (primitive — 재귀 안 함)
//
// 함수 정규형:
//   project.functions[].content = JSON.stringify([[ function_create_block ]])
//   function_create.params = [function_field_label{name, null}, null]
//   function_create.statements = [bodyBlocks]
//   호출: { type: `func_<id>`, params: [...args] }   (인자 없으면 빈 배열)

// 함수 1 body — 보이기 멤버십 → show/hide. 285→000 역순.
// 비교값은 leading zero 제거한 형태 ("000"→"0", "025"→"25"). Entry 가 리스트에
// push 된 숫자를 leading zero 없는 형태로 저장하기 때문.
const showHideBody = gridReversed.map(v => ({
    type: 'if_else',
    params: [
        {
            type: 'is_included_in_list',
            params: [
                null,
                visibleList.id,
                null,
                { type: 'text', params: [String(Number(v.name))] },
                null,
            ],
        },
        null,
        null,
    ],
    statements: [
        [{ type: 'show_variable', params: [v.id, null] }],
        [{ type: 'hide_variable', params: [v.id, null] }],
    ],
}));

// 함수 2 body — "변수 정하기" 리스트 (row+1) 번째 항목 (col+1) 번째 글자 → 변수에 대입.
// 변수 인덱스 i 에 대해 row = i / 26, col = i % 26 (0-indexed → 블록 인자는 +1).
const setVarsBody = gridByIdx.map((v, i) => {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    return {
        type: 'set_variable',
        params: [
            v.id,
            {
                type: 'char_at',
                params: [
                    null,
                    {
                        type: 'value_of_index_from_list',
                        params: [
                            null,
                            dataList.id,
                            null,
                            { type: 'number', params: [String(row + 1)] },
                            null,
                        ],
                    },
                    null,
                    { type: 'number', params: [String(col + 1)] },
                    null,
                ],
            },
            null,
        ],
    };
});

// 무인자 함수 정의
function makeFunction(id, displayName, body) {
    return {
        id,
        type: 'normal',
        localVariables: [],
        useLocalVariables: false,
        content: JSON.stringify([[
            {
                type: 'function_create',
                params: [
                    {
                        type: 'function_field_label',
                        params: [displayName, null],
                    },
                    null,
                ],
                statements: [body],
            },
        ]]),
    };
}

// 1 인자 함수 정의 — paramId 는 함수 본문에서 stringParam_<paramId> 로 참조.
// 호출 시: { type: `func_<id>`, params: [valueBlock] }.
function makeFunction1(id, displayName, paramId, body) {
    return {
        id,
        type: 'normal',
        localVariables: [],
        useLocalVariables: false,
        content: JSON.stringify([[
            {
                type: 'function_create',
                params: [
                    {
                        type: 'function_field_label',
                        params: [
                            displayName,
                            {
                                type: 'function_field_string',
                                params: [
                                    { type: `stringParam_${paramId}`, params: [] },
                                    null,
                                ],
                            },
                        ],
                    },
                    null,
                ],
                statements: [body],
            },
        ]]),
    };
}

// 함수 3 body — "보이기2" 리스트 (row+1) 번째 항목 (col+1) 번째 글자:
//   글자 = 1 → show, 나머지 → hide.
// 데이터가 항상 1 아니면 2 이므로 단일 if_else 로 처리.
const applyMatrixBody = gridByIdx.map((v, i) => {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    return {
        type: 'if_else',
        params: [
            {
                type: 'boolean_basic_operator',
                params: [
                    {
                        type: 'char_at',
                        params: [
                            null,
                            {
                                type: 'value_of_index_from_list',
                                params: [
                                    null,
                                    matrixList.id,
                                    null,
                                    { type: 'number', params: [String(row + 1)] },
                                    null,
                                ],
                            },
                            null,
                            { type: 'number', params: [String(col + 1)] },
                            null,
                        ],
                    },
                    'EQUAL',
                    { type: 'number', params: ['1'] },
                ],
            },
            null,
            null,
        ],
        statements: [
            [{ type: 'show_variable', params: [v.id, null] }],
            [{ type: 'hide_variable', params: [v.id, null] }],
        ],
    };
});

// 함수 4 body — 인자 v 로 모든 286 변수를 일괄 설정.
// 본문에서 인자 참조는 stringParam_v 블록. paramId = 'v'.
const setAllBody = gridByIdx.map(v => ({
    type: 'set_variable',
    params: [
        v.id,
        { type: 'stringParam_v', params: [] },
        null,
    ],
}));

const fn1 = makeFunction ('updateVisibility', '보이기 갱신',  showHideBody);
const fn2 = makeFunction ('loadFrameVars',    '변수 채우기',  setVarsBody);
const fn3 = makeFunction ('applyMatrix',      '보이기2 적용', applyMatrixBody);
const fn4 = makeFunction1('setAll',           '모두 정하기', 'v', setAllBody);
project.functions = [fn1, fn2, fn3, fn4];

// 오브젝트 스크립트 — 각 트리거가 해당 함수 호출.
const thread1 = [
    { type: 'when_scene_start',     params: [null] },
    { type: `func_${fn1.id}`,       params: [] },
];
const thread2 = [
    { type: 'when_run_button_click', params: [null] },
    { type: `func_${fn2.id}`,        params: [] },
];
project.objects[0].script = JSON.stringify([thread1, thread2]);

// 5) 프로젝트 이름
project.name = '배드애플 26x11 그리드';

// 6) 다시 tar.gz 로 패키징
pjEntry.data = Buffer.from(JSON.stringify(project));

const tarFiles = entries.map(e => ({
    name: e.name,
    data: e.data,
    typeflag: e.type || '0',
}));
const newTar = makeTar(tarFiles);
const newEnt = zlib.gzipSync(newTar);

fs.writeFileSync(OUT, newEnt);

const visualLeft  = X_LEFT;
const visualRight = X_LEFT + (COLS - 1) * X_STEP + W;
console.log(`[bad-apple] wrote ${OUT}`);
console.log(`  variables: ${gridByIdx.length} 그리드 + 리스트 3 (보이기, 변수 정하기, 보이기2) + 시스템 ${kept.length} = ${project.variables.length}`);
console.log(`  grid: ${COLS} cols × ${ROWS} rows, x ${X_LEFT}..${X_LEFT + (COLS-1)*X_STEP} (step ${X_STEP}), y ${Y_TOP}..${Y_TOP - (ROWS-1)*Y_STEP} (step ${-Y_STEP})`);
console.log(`  visual extent (가로 폭 ${W}px 가정): ${visualLeft}..${visualRight} (stage 좌우 ${-240 - visualLeft}px/${visualRight - 240}px 바깥)`);
console.log(`  array order: REVERSED (285→000) → 낮은 이름이 위`);
console.log(`  functions:`);
console.log(`    "${fn1.id}"    (${showHideBody.length} if_else)        — 보이기 멤버십`);
console.log(`    "${fn2.id}"      (${setVarsBody.length} set_variable)     — 매트릭스 글자 → 변수 값`);
console.log(`    "${fn3.id}"        (${applyMatrixBody.length} if_else)        — char=1 → show, 그 외 hide`);
console.log(`    "${fn4.id}" (v)        (${setAllBody.length} set_variable)     — 모든 변수에 v 대입`);
console.log(`  script thread 1: 장면 시작 → call ${fn1.id}`);
console.log(`  script thread 2: 시작 클릭 → call ${fn2.id}`);
console.log(`  ${fn3.id}, ${fn4.id} 은 정의만 됨 — 트리거 미연결, 사용자가 wire-up 필요`);
console.log(`  매핑: 변수 "000"=좌상, "025"=우상, "260"=좌하, "285"=우하 (row-major)`);
