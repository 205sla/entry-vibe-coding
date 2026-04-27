#!/usr/bin/env node
// Runtime verification for the "repeat 블록 = 60fps 틱" 가설.
//
// 가설: repeat_basic/repeat_inf 안의 statements가 모두 끝난 뒤 한 틱(1/60초)
// 뒤에 다음 반복이 시작된다. 따라서 `wait_second` 없이 180번 반복하면
// 180 / 60 ≈ 3초가 걸려야 한다.
//
// 절차:
//   1. repeat-timing.ent 로드
//   2. toggleRun → 스크립트 실행
//   3. '완료' 변수가 1이 될 때까지 폴링
//   4. '경과시간' 변수(정지한 시점의 projectTimer 값)를 출력
//   5. 이론값과 비교
//
// 필요 사전 조건: `npm start` 로 http://localhost:3000 편집기 기동.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const argName   = process.argv[2] || 'repeat-timing';
const FIXTURE   = path.join(ROOT, 'tests/fixtures', argName.endsWith('.ent') ? argName : argName + '.ent');

const REPEAT_N  = 180;
const EXPECTED  = REPEAT_N / 60; // 3.00s at 60fps (baseline only)

let browser, page, errs;
try {
    ({ browser, page, pageErrors: errs } = await bootEditor());
} catch (e) {
    console.error('error:', e.message);
    process.exit(2);
}

try {
    await loadFixture(page, FIXTURE);
} catch (e) {
    console.error('error:', e.message);
    await browser.close();
    process.exit(3);
}

// 스크립트 실행
const startMs = Date.now();
await page.evaluate(() => { Entry.engine.toggleRun(); });

// '완료' 변수가 1이 될 때까지 폴링. 10초 넘으면 타임아웃.
const TIMEOUT_MS = 10_000;
let done = false;
let elapsedVar = null;
let timerVal = null;
while (Date.now() - startMs < TIMEOUT_MS) {
    const s = await page.evaluate(() => {
        const vs = Entry.variableContainer.variables_;
        const byName = (n) => vs.find(v => v.name_ === n);
        const doneV = byName('완료');
        const elapsedV = byName('경과시간');
        const timer = Entry.engine && Entry.engine.projectTimer;
        return {
            done: doneV ? +doneV.getValue() : 0,
            elapsed: elapsedV ? +elapsedV.getValue() : null,
            timerNow: timer ? +(+timer.getValue()).toFixed(4) : null,
        };
    });
    timerVal = s.timerNow;
    elapsedVar = s.elapsed;
    if (s.done === 1) { done = true; break; }
    await page.waitForTimeout(50);
}
const wallMs = Date.now() - startMs;

if (!done) {
    console.error(`✗ 타임아웃 (${TIMEOUT_MS}ms) — '완료' 변수가 1로 세팅되지 않음`);
    console.error(`  마지막 timer 값: ${timerVal}s, 마지막 elapsed: ${elapsedVar}`);
    console.error('  pageErrors:', errs.slice(0, 3));
    await browser.close();
    process.exit(4);
}

// 결과 출력
console.log(`\n=== ${argName} — repeat_basic × ${REPEAT_N} ===`);
console.log(`  wall-clock (toggleRun → done=1)  : ${wallMs} ms`);
console.log(`  projectTimer (START→STOP 기록)   : ${elapsedVar} s`);
console.log(`  이론값 (60fps, 1틱 = 1/60s)      : ${EXPECTED.toFixed(3)} s`);
console.log(`  차이                              : ${((elapsedVar - EXPECTED) * 1000).toFixed(1)} ms`);

const lo = EXPECTED * 0.85;
const hi = EXPECTED * 1.30;
if (elapsedVar >= lo && elapsedVar <= hi) {
    console.log(`✓ 경과시간이 [${lo.toFixed(2)}, ${hi.toFixed(2)}]s 범위 내 — 60fps 가설과 일치`);
} else {
    console.log(`✗ 경과시간이 예상 범위 [${lo.toFixed(2)}, ${hi.toFixed(2)}]s 를 벗어남`);
}

if (errs.length) {
    console.log('\npageErrors:');
    for (const e of errs.slice(0, 5)) console.log(' -', e);
}

await browser.close();
process.exit(elapsedVar >= lo && elapsedVar <= hi ? 0 : 5);
