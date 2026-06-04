// 좌표 방향 검증용 .ent — 4 개 사분면에 이름이 다른 변수 4 개 배치.
// 사용자가 편집기에서 열어 어느 변수가 어디 나타나는지 보고 Y 방향을 확정.
//
// 가설 (entryjs/src/class/stage.js:46-48 분석 결과):
//   variable.y > 0 → 화면 아래
//   variable.y < 0 → 화면 위
// (사용자 클릭 → 변수 좌표 환산 코드도 같은 방향: variable.js MOVE 핸들러에서
//  evt.stageY * 0.75 - 135 → 캔버스 위쪽 클릭이 음수 y 로 매핑됨.)
//
// 테스트 변수 이름은 "MATH 컨벤션 (양수 y = 위)" 기준으로 붙임. 화면에서 보이는
// 실제 위치와 이름을 대조해 가설을 확인.

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

function nextOutputPath(dir, base) {
    const re = new RegExp(`^${base}_(\\d{3})\\.ent$`);
    const nums = fs.readdirSync(dir)
        .map(f => f.match(re)).filter(Boolean)
        .map(m => parseInt(m[1], 10));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return path.join(dir, `${base}_${String(next).padStart(3, '0')}.ent`);
}
const OUT = nextOutputPath(__dirname, 'coord-test');

const srcBuf = fs.readFileSync(SRC);
const tarBuf = zlib.gunzipSync(srcBuf);
const entries = [];
forEachTarEntry(tarBuf, (e) => entries.push({ name: e.name, type: e.type, data: Buffer.from(e.data) }));
const pjEntry = entries.find(e => e.name === 'temp/project.json' || e.name === './temp/project.json');
const project = JSON.parse(pjEntry.data.toString('utf8'));

// 시스템 변수만 유지
const kept = project.variables.filter(v =>
    v.variableType === 'timer' || v.variableType === 'answer' || v.variableType === 'stt'
);
for (const v of kept) _usedIds.add(v.id);

// 4 사분면 테스트 변수. 이름은 MATH 컨벤션 (양수 y = 위) 기준.
// 가설이 맞으면 (Entry Y 아래로 양수): 실제 화면에서
//   "오른위" (x=+100, y=+100) → 화면 오른쪽 아래
//   "왼위"   (x=-100, y=+100) → 화면 왼쪽 아래
//   "왼아래" (x=-100, y=-100) → 화면 왼쪽 위
//   "오른아래"(x=+100, y=-100) → 화면 오른쪽 위
// 즉 이름의 위/아래가 화면과 반대로 나타나면 양수 y = 아래.
const mkVar = (name, x, y) => ({
    name, id: uniqueId(4),
    visible: true, value: 0,
    variableType: 'variable',
    isCloud: false, isRealTime: false, cloudDate: false,
    object: null,
    x, y,
});
const testVars = [
    mkVar('오른위',  +100, +100),
    mkVar('왼위',    -100, +100),
    mkVar('왼아래',  -100, -100),
    mkVar('오른아래', +100, -100),
];

project.variables = [...testVars, ...kept];
project.objects[0].script = JSON.stringify([]);
project.functions = [];
project.name = '좌표 방향 테스트 (4 사분면)';

pjEntry.data = Buffer.from(JSON.stringify(project));
const tarFiles = entries.map(e => ({ name: e.name, data: e.data, typeflag: e.type || '0' }));
fs.writeFileSync(OUT, zlib.gzipSync(makeTar(tarFiles)));

console.log(`[coord-test] wrote ${OUT}`);
console.log(`  변수 (MATH 컨벤션 이름):`);
for (const v of testVars) console.log(`    ${v.name.padEnd(6)} → (${v.x.toString().padStart(4)}, ${v.y.toString().padStart(4)})`);
console.log(`  가설 (Entry Y 아래로 양수) 검증:`);
console.log(`    "오른위"(+100,+100) 이 실제로 화면 오른쪽 아래에 나타나면 가설 맞음.`);
console.log(`    "왼아래"(-100,-100) 이 실제로 화면 왼쪽 위에 나타나면 가설 맞음.`);
