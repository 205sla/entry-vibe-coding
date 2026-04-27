#!/usr/bin/env node
// 함수(function_create_value)로 정의된 피보나치 계산을 런타임에 검증.
//
// 시나리오:
//   1. fibonacci.ent 로드
//   2. n_input = 0, 1, 5, 10, 15 각각 세팅 후 toggleRun
//   3. '결과' 변수가 fib(n) 과 일치하는지 확인
//   4. '수열' 리스트가 [fib(0), fib(1), ..., fib(n-1)] 과 일치하는지 확인
//
// 사전 조건: npm start.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE   = path.resolve(__dirname, '..', 'tests/fixtures/fibonacci.ent');

// 기댓값
function fib(n) {
    let a = 0, b = 1;
    for (let i = 0; i < n; i++) [a, b] = [b, a + b];
    return a;
}
function fibSeq(n) {
    const out = [];
    let a = 0, b = 1;
    for (let i = 0; i < n; i++) { out.push(a); [a, b] = [b, a + b]; }
    return out;
}

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

async function setN(n) {
    await page.evaluate((n) => {
        const v = Entry.variableContainer.variables_.find(x => x.name_ === '입력 n');
        v.setValue(n);
    }, n);
}
async function getResult() {
    return page.evaluate(() => {
        const v = Entry.variableContainer.variables_.find(x => x.name_ === '결과');
        return v ? +v.getValue() : null;
    });
}
async function getSeq() {
    return page.evaluate(() => {
        const l = Entry.variableContainer.lists_.find(x => x.name_ === '수열');
        if (!l) return [];
        return (l.array_ || []).map(item => +item.data);
    });
}

let pass = true;
const log = (ok, msg) => { console.log(ok ? '  ✓' : '  ✗', msg); if (!ok) pass = false; };

console.log('\n=== 함수 호출 결과 검증 ===');
const cases = [0, 1, 2, 5, 10, 15];
for (const n of cases) {
    // 1) toggleStop() 은 async — 변수 snapshot 복원이 끝날 때까지 await.
    //    ([entryjs/src/class/engine.js:715] toggleStop → Promise.all + loadSnapshot)
    // 2) snapshot 복원 후 n_input 을 새 값으로 세팅 (이 값이 다음 run 의 snapshot 이 됨)
    // 3) toggleRun() 으로 다시 시작
    await page.evaluate(async () => {
        if (Entry.engine.state !== 'stop') {
            try { await Entry.engine.toggleStop(); } catch {}
        }
    });
    await setN(n);
    await page.evaluate(() => { try { Entry.engine.toggleRun(); } catch {} });
    await page.waitForTimeout(800 + n * 50);

    const got = await getResult();
    const seq = await getSeq();
    const expectedFib = fib(n);
    const expectedSeq = fibSeq(n);

    console.log(`\n  n=${n}`);
    console.log(`    result: got ${got}, expected ${expectedFib}`);
    log(got === expectedFib, `func_fib(${n}) === ${expectedFib}`);

    console.log(`    seq:    got ${JSON.stringify(seq)}`);
    console.log(`            expected ${JSON.stringify(expectedSeq)}`);
    log(JSON.stringify(seq) === JSON.stringify(expectedSeq),
        `수열 리스트가 fib 첫 ${n}개와 일치`);
}

console.log('\n=== 종합 ===');
console.log(`pageErrors: ${errs.length}`);
if (errs.length) for (const e of errs.slice(0, 5)) console.log(' -', e);
console.log(pass ? '\n✓ 함수 정의 + 호출 + 재귀적 계산 모두 통과' : '\n✗ 일부 검증 실패');

await browser.close();
process.exit(pass ? 0 : 4);
