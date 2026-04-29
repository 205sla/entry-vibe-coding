#!/usr/bin/env node
// 바운스 볼 게임 검증.
//
// Step 1: 로드 직후 21 오브젝트 (paddle + ball + 18 bricks + status_msg) 확인
// Step 2: 실행 → 공이 움직임 (위치 변화)
// Step 3: 좌/우 화살표 → 패들 이동
// Step 4: 벽돌 파괴 시뮬 — ball 을 벽돌 위치로 강제 이동 후 충돌 → score/bricks_left 변화
// Step 5: 게임 오버 시뮬 — lives=0 강제 → status_msg 'GAME OVER' 표시

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import {
    runFresh, getVar, setVar, holdKey, waitFor, createReporter,
} from './lib/verify-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE   = path.resolve(__dirname, '..', 'tests/fixtures/bounce-ball.ent');

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

const t = createReporter();

async function ballPos() {
    return page.evaluate(() => {
        const o = Entry.container.getAllObjects().find(x => x.id === 'ball');
        return { x: o.entity.x, y: o.entity.y };
    });
}
async function paddleX() {
    return page.evaluate(() => {
        const o = Entry.container.getAllObjects().find(x => x.id === 'paddle');
        return o.entity.x;
    });
}

// ── Step 1: 오브젝트 4 개 (paddle + ball + brick_template + status_msg) ──
// 벽돌은 brick_template 의 clone 18 개로 런타임 생성됨.
console.log('\n=== Step 1: 오브젝트 구성 ===');
const objIds = await page.evaluate(() =>
    Entry.container.getAllObjects().map(o => o.id)
);
console.log(`  총 오브젝트: ${objIds.length}`);
t.eq(objIds.length, 4, '4 오브젝트 (paddle + ball + brick_template + status_msg)');
t.ok(objIds.includes('paddle'), 'paddle 존재');
t.ok(objIds.includes('ball'),   'ball 존재');
t.ok(objIds.includes('brick_template'), 'brick_template 존재 (벽돌은 클론)');

// ── Step 2: 실행 → 18 클론 spawn + 공 이동 ─────────────
console.log('\n=== Step 2: 클론 18 + 공 이동 ===');
// 공을 안전한 곳 (벽돌 영역 밖) 으로 강제 후 실행 — 클론 카운트 확인
await runFresh(page);
await page.evaluate(() => {
    const ball = Entry.container.getAllObjects().find(o => o.id === 'ball');
    ball.entity.setX(0);
    ball.entity.setY(-50);
});
await page.waitForTimeout(300);

const cloneCount = await page.evaluate(() => {
    const tplt = Entry.container.getAllObjects().find(o => o.id === 'brick_template');
    return tplt.clonedEntities ? tplt.clonedEntities.length : -1;
});
console.log(`  brick clones spawned: ${cloneCount}`);
t.eq(cloneCount, 18, '18 클론 spawn');

const p1 = await ballPos();
await page.waitForTimeout(600);
const p2 = await ballPos();
console.log(`  ball: (${p1.x.toFixed(1)}, ${p1.y.toFixed(1)}) → (${p2.x.toFixed(1)}, ${p2.y.toFixed(1)})`);
t.ok(p1.x !== p2.x || p1.y !== p2.y, '공 위치 변경 (이동 중)');

// ── Step 3: 좌/우 키 → 패들 이동 ───────────────────────
console.log('\n=== Step 3: 패들 이동 ===');
const px0 = await paddleX();
console.log(`  초기 paddle.x: ${px0.toFixed(1)}`);

await holdKey(page, '39', 200);  // → 키 0.2 초 유지
await page.waitForTimeout(200);
const pxR = await paddleX();
console.log(`  → 키 후 paddle.x: ${pxR.toFixed(1)}`);
t.ok(pxR > px0, '오른쪽 키 → paddle.x 증가');

await holdKey(page, '37', 200);
await page.waitForTimeout(200);
const pxL = await paddleX();
console.log(`  ← 키 후 paddle.x: ${pxL.toFixed(1)}`);
t.ok(pxL < pxR, '왼쪽 키 → paddle.x 감소');

// ── Step 4: 벽돌 파괴 — ball 을 벽돌 영역으로 텔레포트 ─────
console.log('\n=== Step 4: 벽돌 파괴 → 클론 deleteClone ===');
const score0   = +(await getVar(page, '점수'));
const bricks0  = +(await getVar(page, '남은벽돌'));
const clones0  = await page.evaluate(() => {
    const t = Entry.container.getAllObjects().find(o => o.id === 'brick_template');
    return t.clonedEntities.length;
});
console.log(`  before: 점수=${score0}, 남은벽돌=${bricks0}, 클론=${clones0}`);

// ball 을 벽돌 행 0 의 col 2 위치 (-30, 120) 로 텔레포트
await page.evaluate(() => {
    const ball = Entry.container.getAllObjects().find(x => x.id === 'ball');
    ball.entity.setX(-30);
    ball.entity.setY(120);
});
await page.waitForTimeout(500);

const score1  = +(await getVar(page, '점수'));
const bricks1 = +(await getVar(page, '남은벽돌'));
const clones1 = await page.evaluate(() => {
    const t = Entry.container.getAllObjects().find(o => o.id === 'brick_template');
    return t.clonedEntities.length;
});
console.log(`  after:  점수=${score1}, 남은벽돌=${bricks1}, 클론=${clones1}`);
t.ok(score1 > score0,    '벽돌 파괴 → 점수 증가');
t.ok(bricks1 < bricks0,  '벽돌 파괴 → 남은벽돌 감소');
t.ok(clones1 < clones0,  '벽돌 파괴 → 클론 deleteClone 으로 감소');

// ── Step 5: 패들 hit 메시지 — ball dy 양수 강제 ──────
console.log('\n=== Step 5: 패들 hit → ball dy 양수 ===');
// dy 를 음수로 강제 (떨어지는 상태)
await setVar(page, 'dy', -3);
// ball 을 패들 근처 (paddle.x, -110) 로 이동
const pxNow = await paddleX();
await page.evaluate((px) => {
    const ball = Entry.container.getAllObjects().find(x => x.id === 'ball');
    ball.entity.setX(px);
    ball.entity.setY(-105);
}, pxNow);
await page.waitForTimeout(400);

const dyAfter = +(await getVar(page, 'dy'));
console.log(`  dy after paddle hit: ${dyAfter}`);
t.ok(dyAfter > 0, '패들 충돌 → dy 양수 (위로 튀어 오름)');

// ── Step 6: 게임 오버 — lives=0 강제 → 'GAME OVER' 표시 ────
console.log('\n=== Step 6: 게임 오버 ===');
await setVar(page, '목숨', 0);
const finalState = await waitFor(page,
    p => p.evaluate(() => {
        const o = Entry.container.getAllObjects().find(x => x.id === 'status_msg');
        return { state: Entry.variableContainer.variables_.find(v => v.name_ === '상태').getValue(),
                 visible: o.entity.visible,
                 text: o.entity.getText() };
    }),
    v => v.visible === true && v.text === 'GAME OVER',
    { timeoutMs: 4000, intervalMs: 200, label: 'GAME OVER 메시지' }
).catch(e => { console.error('  ' + e.message); return null; });

console.log(`  finalState: ${JSON.stringify(finalState)}`);
t.ok(finalState && finalState.text === 'GAME OVER', 'GAME OVER 메시지 표시');
t.ok(finalState && +finalState.state === 1, 'game_state == 1');

// ── 완료 ───────────────────────
console.log('\n=== 완료 ===');
t.ok(pageErrors.length === 0, `페이지 에러 없음 (got ${pageErrors.length})`);
if (pageErrors.length) console.log('  errors:', pageErrors.slice(0, 3));

await browser.close();
process.exit(t.summary());
