#!/usr/bin/env node
// 함수(function_create_value)로 정의된 피보나치 계산을 런타임에 검증.
// Tier-1 데모: editor-harness + verify-harness 의 공유 헬퍼만 사용.
//
// 시나리오: n ∈ {0, 1, 2, 5, 10, 15} 각 값에 대해 toggleRun → fib(n) 결과 +
// 수열 리스트가 정확한지 확인.
//
// 사전 조건: npm start.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import {
    runFresh, getVar, getList,
    waitForVar, createReporter,
} from './lib/verify-harness.mjs';

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

const { browser, page, pageErrors } = await bootEditor();
try {
    await loadFixture(page, FIXTURE);
} catch (e) {
    console.error('error:', e.message);
    await browser.close();
    process.exit(3);
}

const t = createReporter();
console.log('\n=== 함수 호출 결과 검증 ===');

for (const n of [0, 1, 2, 5, 10, 15]) {
    // runFresh: stopEngine(스냅샷 복원 await) → setVar(새 값) → runEngine(새 스냅샷).
    // 이 순서가 중요 — 토글스톱이 비동기로 변수를 복원하므로 set은 stop 이후, run 이전에.
    await runFresh(page, { '입력 n': n });
    // 폴링 두 단계: (1) result 변수 도달, (2) 시각화 리스트가 길이 n 도달.
    // n=0이면 result는 시작값 0과 같아 폴링이 즉시 통과 → 짧은 대기로 대체.
    if (n === 0) {
        await page.waitForTimeout(500);
    } else {
        await waitForVar(page, '결과', v => +v === fib(n), {
            timeoutMs: 3000 + n * 100,
        }).catch(() => {});
        // 두 번째 repeat_basic 이 list 를 채우는 데 60fps × n 프레임이 더 걸림
        // (반복하기는 1 프레임/iter — knowledge/07-runtime-quirks.md 참조)
        await page.waitForTimeout(200 + n * 30);
    }

    const got = +(await getVar(page, '결과'));
    const seq = await getList(page, '수열');

    console.log(`\n  n=${n}`);
    t.eq(got, fib(n),         `func_fib(${n})`);
    t.eq(seq, fibSeq(n),      `수열[0..${n})`);
}

console.log(`\npageErrors: ${pageErrors.length}`);
if (pageErrors.length) for (const e of pageErrors.slice(0, 5)) console.log(' -', e);

await browser.close();
process.exit(t.summary());
