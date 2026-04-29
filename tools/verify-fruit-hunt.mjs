#!/usr/bin/env node
// 과일 사냥 검증.
//
// Step 1: 초기 — 9 클론 + 목표 2 개 + 비목표 7 개
// Step 2: 정답 클릭 시뮬 → score 증가, combo +1, targets_remaining -1, 클론 -1
// Step 3: 목표 2 개 모두 클릭 → 새 스테이지, level +1, 클론 9 재생성
// Step 4: 오답 클릭 → combo 0, penalty +2
// Step 5: time_left → 0 강제 → game_state=1 + GAME OVER 표시
//
// 사전 조건: npm start.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import { runFresh, getVar, setVar, waitFor, createReporter } from './lib/verify-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE   = path.resolve(__dirname, '..', 'tests/fixtures/fruit-hunt.ent');

const { browser, page, pageErrors } = await bootEditor({
    viewport: { width: 1400, height: 900 },
});
try {
    await loadFixture(page, FIXTURE);
} catch (e) {
    console.error('load error:', e.message);
    await browser.close();
    process.exit(3);
}

// 클론 카운트
const cloneCount = () => page.evaluate(() => {
    const t = Entry.container.getAllObjects().find(o => o.id === 'fruit_template');
    return t.clonedEntities ? t.clonedEntities.length : 0;
});

// 클론 list (각 클론의 x, y, picture id)
const cloneInfo = () => page.evaluate(() => {
    const t = Entry.container.getAllObjects().find(o => o.id === 'fruit_template');
    return (t.clonedEntities || []).map(e => ({
        x: e.x, y: e.y,
        pic: e.picture && e.picture.id,
    }));
});

// 특정 클론에 대해 entityClick 직접 dispatch (hit-test 우회)
async function clickClone(predicate) {
    return page.evaluate((predSrc) => {
        const t = Entry.container.getAllObjects().find(o => o.id === 'fruit_template');
        const fn = new Function('e', 'return (' + predSrc + ')(e)');
        const target = (t.clonedEntities || []).find(fn);
        if (!target) return false;
        Entry.dispatchEvent('entityClick', target);
        return true;
    }, predicate.toString());
}

const t = createReporter();

// ── Step 1: 초기 9 클론 + target 2 개 ──
console.log('\n=== Step 1: 초기 spawn ===');
await runFresh(page);
await page.waitForTimeout(800);

const c0 = await cloneCount();
console.log(`  클론 수: ${c0}`);
t.eq(c0, 9, '9 클론 spawn');

const targetIdx = +(await getVar(page, '목표'));
const pos1 = +(await getVar(page, 'pos1'));
const pos2 = +(await getVar(page, 'pos2'));
console.log(`  target_idx=${targetIdx}, pos1=${pos1}, pos2=${pos2}`);
t.ok(pos1 !== pos2, 'target 두 위치는 서로 다름');
t.between(targetIdx, 1, 5, 'target_idx ∈ [1, 5]');

// 9 클론 중 정확히 2 개가 target picture id 인지
const fruitPicIds = ['pic_apple', 'pic_banana', 'pic_grape', 'pic_orange', 'pic_watermelon'];
const fruitNames  = ['사과', '바나나', '포도', '귤', '수박'];
const targetPicId = fruitPicIds[targetIdx - 1];
const targetName  = fruitNames[targetIdx - 1];
const clones = await cloneInfo();
const targetClones = clones.filter(c => c.pic === targetPicId);
console.log(`  target picture id: ${targetPicId}, target 클론 수: ${targetClones.length}`);
t.eq(targetClones.length, 2, '클론 중 정확히 2 개가 target picture');

// race condition 회귀 가드: title 의 텍스트가 target_idx 와 일치해야 함.
// 이전 버그: target_idx 가 message handler 안에서 setVar 되어 title 이 stale 값을 읽음.
const titleText = await page.evaluate(() =>
    Entry.container.getAllObjects().find(o => o.id === 'title').entity.getText()
);
console.log(`  title: "${titleText}", expected name: "${targetName}"`);
t.ok(titleText.includes(targetName), `title 의 과일 이름 "${targetName}" 이 target_idx 와 일치 (race 회귀 가드)`);

// ── Step 2: 정답 클릭 → score, combo, targets_remaining ──
console.log('\n=== Step 2: 첫 정답 클릭 ===');
const score0 = +(await getVar(page, '점수'));
const combo0 = +(await getVar(page, '콤보'));

// target 클론 1 개 클릭
const clicked1 = await clickClone(`(e) => e.picture && e.picture.id === '${targetPicId}'`);
t.ok(clicked1, '첫 target 클론 entityClick fire');
await page.waitForTimeout(300);

const score1 = +(await getVar(page, '점수'));
const combo1 = +(await getVar(page, '콤보'));
const remaining1 = +(await getVar(page, '남은목표'));
const c1 = await cloneCount();
console.log(`  score: ${score0} → ${score1}, combo: ${combo0} → ${combo1}, 남은: ${remaining1}, 클론: ${c1}`);
t.ok(score1 > score0,    '점수 증가');
t.ok(combo1 > combo0,    '콤보 +1');
t.eq(remaining1, 1,      '남은목표 1');
t.eq(c1, 8,              '클론 1 개 deleteClone');

// ── Step 3: 두 번째 target → 스테이지 클리어 + 새 라운드 ──
console.log('\n=== Step 3: 두 번째 target → 스테이지 클리어 ===');
const level0 = +(await getVar(page, '레벨'));
// 동일 picture id 의 남은 1 개 target 클릭
const clicked2 = await clickClone(`(e) => e.picture && e.picture.id === '${targetPicId}'`);
t.ok(clicked2, '두 번째 target 클론 entityClick fire');
await page.waitForTimeout(800);  // new_stage 처리 + 9 새 클론 spawn

const level1 = +(await getVar(page, '레벨'));
const c2 = await cloneCount();
const newTargetIdx = +(await getVar(page, '목표'));
console.log(`  레벨: ${level0} → ${level1}, 클론: ${c2}, 새 target: ${newTargetIdx}`);
t.eq(level1, level0 + 1,   '레벨 +1');
t.eq(c2, 9,                '새 9 클론 spawn');

// ── Step 4: 오답 클릭 → combo 0, penalty +2 ──
console.log('\n=== Step 4: 오답 클릭 ===');
const newTargetPic = fruitPicIds[newTargetIdx - 1];
const beforePenalty = +(await getVar(page, '페널티'));
const beforeCombo   = +(await getVar(page, '콤보'));

// non-target 클론 1 개 클릭
const wrongClicked = await clickClone(`(e) => e.picture && e.picture.id !== '${newTargetPic}'`);
t.ok(wrongClicked, '오답 클론 entityClick fire');
await page.waitForTimeout(300);

const afterPenalty = +(await getVar(page, '페널티'));
const afterCombo   = +(await getVar(page, '콤보'));
console.log(`  페널티: ${beforePenalty} → ${afterPenalty}, 콤보: ${beforeCombo} → ${afterCombo}`);
t.ok(afterPenalty >= beforePenalty + 2, '페널티 +2');
t.eq(afterCombo, 0,                     '콤보 리셋');

// ── Step 5: time_up → 게임 오버 ──
console.log('\n=== Step 5: 페널티로 시간 종료 강제 ===');
await setVar(page, '페널티', 100);  // 큰 값 → time_left 즉시 음수
const finalState = await waitFor(page,
    p => p.evaluate(() => {
        const o = Entry.container.getAllObjects().find(x => x.id === 'gameover_msg');
        const v = Entry.variableContainer.variables_.find(v => v.name_ === '상태').getValue();
        return { state: +v, visible: o.entity.visible, text: o.entity.getText() };
    }),
    v => v.visible === true && v.text === 'GAME OVER',
    { timeoutMs: 4000, intervalMs: 200, label: 'GAME OVER 표시' }
).catch(e => { console.error('  ' + e.message); return null; });

console.log(`  finalState: ${JSON.stringify(finalState)}`);
t.ok(finalState && finalState.text === 'GAME OVER', 'GAME OVER 표시');
t.eq(finalState && finalState.state, 1, 'game_state == 1');

// ── 완료 ───────────────────────────
console.log('\n=== 완료 ===');
t.ok(pageErrors.length === 0, `페이지 에러 없음 (got ${pageErrors.length})`);
if (pageErrors.length) console.log('  errors:', pageErrors.slice(0, 3));

await browser.close();
process.exit(t.summary());
