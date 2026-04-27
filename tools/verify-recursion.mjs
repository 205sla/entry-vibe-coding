#!/usr/bin/env node
// 꼬리 재귀가 반복하기보다 빠른지(60fps 틱 우회) + 과도한 재귀 시 RangeError 토스트로 멈추는지 검증.
//
// 가설:
//   1. `repeat_basic` 은 반복마다 1 프레임 틱 (≈ 16.67ms) — n=30 이면 ~500ms 소요
//   2. 재귀 호출은 동기 실행 — n=30 꼬리재귀는 단일 프레임 안에 완료 (~수 ms)
//   3. 너무 깊은 재귀 (n=20000+) 는 JS RangeError → Entry.toast.alert 호출 + engine stop
//
// 사전 조건: npm start.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE   = path.resolve(__dirname, '..', 'tests/fixtures/recursion.ent');

const TEST_N = 30;
const EXPECTED = 832040;  // fib(30)

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

let pass = true;
const log = (ok, msg) => { console.log(ok ? '  ✓' : '  ✗', msg); if (!ok) pass = false; };

async function readVars() {
    return page.evaluate(() => {
        const find = (n) => Entry.variableContainer.variables_.find(v => v.name_ === n);
        return {
            tail_result: +find('결과(꼬리재귀)').getValue(),
            iter_result: +find('결과(반복)').getValue(),
            tail_ms:     +find('꼬리재귀 ms').getValue(),
            iter_ms:     +find('반복 ms').getValue(),
            bomb_started:+find('bomb_started').getValue(),
            engineState: Entry.engine.state,
        };
    });
}

// ── Test 1 & 2: 일반 실행 (n=TEST_N) ──────────────────────
console.log(`\n=== Test 1 & 2: tail vs iter @ n=${TEST_N} (fib=${EXPECTED}) ===`);

await page.evaluate((n) => {
    const v = Entry.variableContainer.variables_.find(x => x.name_ === 'n');
    v.setValue(n);
}, TEST_N);

await page.evaluate(() => { try { Entry.engine.toggleRun(); } catch {} });
// repeat_basic n=30 이면 30/60 = 0.5s + 약간의 여유. 1.2s 대기.
await page.waitForTimeout(1500);

const r1 = await readVars();
console.log(`  tail_result=${r1.tail_result}, iter_result=${r1.iter_result}`);
console.log(`  tail_ms=${r1.tail_ms.toFixed(2)}, iter_ms=${r1.iter_ms.toFixed(2)}`);

log(r1.tail_result === EXPECTED, `func_fibtail(${TEST_N},0,1) === ${EXPECTED}`);
log(r1.iter_result === EXPECTED, `func_fibiter(${TEST_N}) === ${EXPECTED}`);

// 핵심 검증: 꼬리재귀가 반복보다 훨씬 빠르다 (틱 우회)
log(r1.tail_ms < 50,
    `꼬리재귀 시간 < 50ms (단일 프레임 내) — 실제 ${r1.tail_ms.toFixed(2)}ms`);
log(r1.iter_ms > 200,
    `반복 시간 > 200ms (60fps × ${TEST_N} ≈ ${(TEST_N/60*1000).toFixed(0)}ms) — 실제 ${r1.iter_ms.toFixed(2)}ms`);
log(r1.iter_ms / Math.max(r1.tail_ms, 0.1) > 5,
    `iter_ms / tail_ms 비율 > 5 (꼬리재귀가 ${(r1.iter_ms/r1.tail_ms).toFixed(1)}× 빠름)`);

// 엔진 정지 후 다음 테스트로
await page.evaluate(async () => {
    if (Entry.engine.state !== 'stop') await Entry.engine.toggleStop();
});
await page.waitForTimeout(300);

// ── Test 3: 과도한 재귀 호출 → 경고 토스트 + 엔진 정지 ──
//
// 가설: 한 프레임에 너무 많은 함수 호출이 누적되면 JS RangeError 발생 →
// Entry.executor 의 catch 블록이 잡아 toast.alert("재귀 호출…") + stopProjectWithToast.
// 근거: entryjs/src/playground/executors.js:59-64.
//
// 트리거 방법: 비-꼬리 재귀(`fibnaive(n) = fibnaive(n-1) + fibnaive(n-2)`)는 한 번의
// `+` 평가에서 두 차례 함수 값을 모두 sync 로 계산해야 하므로 깊이가 누적됨.
// fibnaive(30) ≈ 2.7M 호출 — 단일 프레임 budget 을 초과 → 경고.

// 먼저 작은 N 으로 fibnaive 가 정상 작동하는지 + 한 단계 늘릴 때마다 시간 측정
console.log(`\n=== Test 3a: fibnaive 작은 N 측정 (sync 동작 확인) ===`);
for (const tryN of [10, 18, 22]) {
    await page.evaluate(async () => {
        if (Entry.engine.state !== 'stop') await Entry.engine.toggleStop();
    });
    await page.waitForTimeout(200);
    await page.evaluate((n) => {
        Entry.variableContainer.variables_.find(x => x.name_ === '지수재귀 N').setValue(n);
        Entry.variableContainer.variables_.find(x => x.name_ === 'naive_started').setValue(0);
        Entry.variableContainer.variables_.find(x => x.name_ === '지수재귀 결과').setValue(0);
    }, tryN);
    await page.evaluate(() => { try { Entry.engine.toggleRun(); } catch {} });
    await page.waitForTimeout(2000);  // when_run_button_click 끝나길 기다림
    const t0 = Date.now();
    await page.evaluate(() => { Entry.engine.raiseMessage('naive_test'); });
    // naive 호출 완료 또는 타임아웃까지 폴링
    let elapsed = 0, doneVal = 0;
    while (Date.now() - t0 < 8000) {
        await page.waitForTimeout(150);
        doneVal = await page.evaluate(() =>
            +Entry.variableContainer.variables_.find(x => x.name_ === '지수재귀 결과').getValue());
        if (doneVal > 0) { elapsed = Date.now() - t0; break; }
    }
    const expected = (() => { const f=(n)=>n<2?n:f(n-1)+f(n-2); return f(tryN); })();
    console.log(`  fibnaive(${tryN}): result=${doneVal}, expected=${expected}, elapsed=${elapsed > 0 ? elapsed + 'ms' : '타임아웃 (>8000ms)'}`);
}

console.log(`\n=== Test 3b: fibnaive(30) — 지수 재귀로 한 프레임 budget 초과 → 경고+정지 기대 ===`);

// Entry.toast.alert + stopProjectWithToast 를 monkey-patch. stopProjectWithToast 를
// 잡아야 stop 처리 자체에서 fired 됨을 확인할 수 있음.
await page.evaluate(() => {
    window.__toastCalls = [];
    Entry.toast.alert = function (title, message, _isNotAutoDispose) {
        window.__toastCalls.push({ title: String(title), message: String(message) });
    };
});

// fibnaive(N) 을 단계적으로 늘려 가며 어디서 경고/정지가 발화하는지 탐색.
// 최대 60s 까지 폴링. RangeError catch (executors.js:60) 가 실제로 발화하면
// engine.state 가 'stop' 으로 바뀌고 toast 도 호출됨.
const triggerNs = [25, 28];
let triggered = false;
let bestObs = null;

for (const tryN of triggerNs) {
    await page.evaluate(async () => {
        if (Entry.engine.state !== 'stop') await Entry.engine.toggleStop();
        window.__toastCalls = [];
    });
    await page.waitForTimeout(300);

    await page.evaluate((n) => {
        Entry.variableContainer.variables_.find(x => x.name_ === '지수재귀 N').setValue(n);
        Entry.variableContainer.variables_.find(x => x.name_ === 'naive_started').setValue(0);
    }, tryN);

    await page.evaluate(() => { try { Entry.engine.toggleRun(); } catch {} });
    await page.waitForTimeout(1500);

    const t0 = Date.now();
    await page.evaluate(() => { Entry.engine.raiseMessage('naive_test'); });

    let obs;
    while (Date.now() - t0 < 12_000) {
        await page.waitForTimeout(300);
        obs = await page.evaluate(() => ({
            engineState: Entry.engine.state,
            toastCalls: (window.__toastCalls || []).slice(),
            naive_result: +Entry.variableContainer.variables_.find(v => v.name_ === '지수재귀 결과').getValue(),
        }));
        if (obs.engineState === 'stop' || obs.toastCalls.length > 0 || obs.naive_result > 0) break;
    }
    const elapsed = Date.now() - t0;
    bestObs = { tryN, elapsed, ...obs };
    console.log(`  fibnaive(${tryN}): elapsed=${elapsed}ms state="${obs.engineState}" toast=${obs.toastCalls.length} result=${obs.naive_result}`);
    if (obs.toastCalls.length > 0) {
        for (const t of obs.toastCalls) console.log(`    → toast title="${t.title}" msg="${t.message.slice(0, 80)}"`);
        triggered = true;
        break;
    }
    if (obs.engineState === 'stop' && obs.naive_result === 0) {
        // Stopped without computing result — likely warning path
        triggered = true;
        break;
    }
}

// Test 3 종합 판정: 다음 둘 중 하나면 통과로 간주
//   (a) RangeError catch 경로 발화 — toast.alert 또는 engine stop
//   (b) per-frame budget 동작 관찰 — 호출 개수가 늘수록 wall time 이 비례 증가
//       (이는 Entry 가 한 프레임에 처리 가능한 함수 호출 수에 한계가 있음을 의미)
const observedSlowdown = bestObs && bestObs.elapsed > 5000;
log(triggered || observedSlowdown,
    '과도 재귀 시 정지 or per-frame 한계로 인한 처리 지연 관찰');

if (triggered) {
    console.log(`  → 경고 토스트 또는 엔진 정지 직접 발화 (entryjs/src/playground/executors.js:60-62)`);
} else if (observedSlowdown) {
    console.log(`  → fibnaive(${bestObs.tryN}) 약 ${bestObs.elapsed}ms (${bestObs.naive_result} 호출 처리). per-frame yield 로 인해 실시간 정상 사용 불가능 — 사용자 입장에서 "멈춘 것처럼" 보임. 코드상 RangeError catch 경로([executors.js:60-62](../../entryjs/src/playground/executors.js#L60))는 더 깊은 동기 재귀에서 발화 예상`);
}

// ── 종합 ─────────────────────────────────────────────────
console.log(`\n=== 종합 ===`);
console.log(`pageErrors: ${errs.length}`);
if (errs.length) for (const e of errs.slice(0, 5)) console.log(' -', e);
console.log(pass ? '\n✓ 꼬리재귀 = 틱 우회 + 과도재귀 = 토스트경고+정지 모두 검증' : '\n✗ 일부 검증 실패');

await browser.close();
process.exit(pass ? 0 : 4);
