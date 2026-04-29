#!/usr/bin/env node
// 탄막-원-게임 종합 검증.
//
// 시나리오:
//   1. 로드 → menu 장면
//   2. start_btn 클릭 → play 장면 + 플레이어 파란 원 그려짐 (픽셀 검증)
//   3. 잠시 진행하면서 빨간 원(적)들이 나타남 (픽셀 검증)
//   4. 충돌 시뮬레이션 — alive=0 강제 → result 장면 자동 전환
//   5. result에서 nickname 입력 → 랭킹 리스트에 (점수, 이름) 저장
//   6. restart_btn 클릭 → menu 복귀
//
// 사전 조건: npm start.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import {
    getVar, getList,
    clickObject, findColoredPixels,
    createReporter,
} from './lib/verify-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE   = path.resolve(__dirname, '..', 'tests/fixtures/bullet-circle.ent');

const { browser, page, pageErrors } = await bootEditor({
    viewport: { width: 1400, height: 900 },
});
try {
    await loadFixture(page, FIXTURE);
} catch (e) {
    console.error('error:', e.message);
    await browser.close();
    process.exit(3);
}

const t = createReporter();

// ── Step 1: 로드 후 menu 장면 ───────────────────
console.log('\n=== Step 1: menu 장면 ===');
const initialScene = await page.evaluate(() => Entry.scene.selectedScene && Entry.scene.selectedScene.id);
t.eq(initialScene, 'menu', '시작 시 menu 장면');

// ── Step 2: 시작 버튼 클릭 → play, 파란 원 + 주황 배경 ──
console.log('\n=== Step 2: start_btn 클릭 → play ===');
await page.evaluate(() => { try { Entry.engine.toggleRun(); } catch {} });
await page.waitForTimeout(800);
await clickObject(page, 'start_btn');
await page.waitForTimeout(1500);  // bg draws + player draws

const playScene = await page.evaluate(() => Entry.scene.selectedScene && Entry.scene.selectedScene.id);
t.eq(playScene, 'play', 'play 장면 활성');

// 파란 원 = 플레이어
const bluePixels = await findColoredPixels(page, 'blue');
console.log(`  파란 (플레이어) 픽셀: ${bluePixels.count}`);
t.ok(bluePixels.count > 50, '플레이어 파란 원 그려짐 (>50 픽셀)');

// 주황 배경
const orangePixels = await findColoredPixels(page, '#fb923c');
console.log(`  주황 (배경) 픽셀: ${orangePixels.count}`);
t.ok(orangePixels.count > 200, '주황 배경 그려짐 (>200 픽셀)');

// ── Step 3: 적 spawn 확인 (빨간 원) ──────────────
console.log('\n=== Step 3: 적 spawn (빨간 원) ===');
await page.waitForTimeout(2500);  // 1초 유예 + 0.45초 spawn 간격 × 3

const redPixels = await findColoredPixels(page, 'red');
console.log(`  빨간 (적) 픽셀: ${redPixels.count}`);
t.ok(redPixels.count > 30, '빨간 적 원 1개 이상 그려짐 (>30 픽셀)');

const survivalNow = +(await getVar(page, '생존 시간'));
console.log(`  생존 시간: ${survivalNow.toFixed(2)}s`);
t.ok(survivalNow > 1, '생존 시간 누적 중 (>1s)');

// ── Step 4: 충돌 시뮬레이션 — alive=0 강제 → result 장면 ──
console.log('\n=== Step 4: alive=0 강제 → result 장면 ===');
// 'hit' 메시지 발화 (실제 충돌과 동일 효과)
await page.evaluate(() => { Entry.engine.raiseMessage('hit'); });
await page.waitForTimeout(1500);  // wait(0.5) + scene transition

const afterHitScene = await page.evaluate(() => Entry.scene.selectedScene && Entry.scene.selectedScene.id);
t.eq(afterHitScene, 'result', 'hit 후 result 장면 자동 전환');

const finalScore = +(await getVar(page, '최종 점수'));
console.log(`  최종 점수: ${finalScore.toFixed(2)}s`);
t.ok(finalScore > 0, '최종 점수 기록됨');

// ── Step 5: 랭킹 등록 ───────────────────────────
console.log('\n=== Step 5: 랭킹 등록 ===');
// save_btn 클릭 → ask_and_wait 활성화 → 답변 주입
await clickObject(page, 'save_btn');
await page.waitForTimeout(800);

// ask_and_wait 완료 — inputField 에 값을 넣고 'canvasInputComplete' 이벤트 dispatch.
// Entry.stage 의 'canvasInputComplete' 핸들러가 inputField.value() 를 읽고
// Entry.container.inputValue 를 세팅 + complete=true 처리.
// 출처: entryjs/src/class/stage.js:133-144.
await page.evaluate(() => {
    if (Entry.stage.inputField) {
        Entry.stage.inputField.value('테스터');
    }
    Entry.dispatchEvent('canvasInputComplete');
});
await page.waitForTimeout(1500);

const rankingDisplay = await getList(page, '🏆 랭킹', { coerceNumeric: false });
console.log(`  랭킹 리스트: ${JSON.stringify(rankingDisplay)}`);
t.ok(rankingDisplay && rankingDisplay.length > 0, '랭킹 리스트에 항목 1개 이상');

// ── Step 6: restart_btn → menu ──────────────
console.log('\n=== Step 6: restart_btn → menu ===');
await clickObject(page, 'restart_btn');
await page.waitForTimeout(800);

const finalScene = await page.evaluate(() => Entry.scene.selectedScene && Entry.scene.selectedScene.id);
t.eq(finalScene, 'menu', 'restart 후 menu 복귀');

// ── 종합 ─────────────────────────────
console.log(`\npageErrors: ${pageErrors.length}`);
if (pageErrors.length) for (const e of pageErrors.slice(0, 5)) console.log(' -', e);

// 스크린샷 저장
await clickObject(page, 'start_btn').catch(() => {});  // 다시 시작해서 inProgress shot
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(__dirname, 'verify-bullet-circle.png'), fullPage: false });
console.log(`\n스크린샷: ${path.relative(path.resolve(__dirname, '..'), path.join(__dirname, 'verify-bullet-circle.png'))}`);

await browser.close();
process.exit(t.summary());
