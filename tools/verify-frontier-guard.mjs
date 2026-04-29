#!/usr/bin/env node
// 프론티어 가드 Phase 3 검증.
//
// Step 0: intro 장면 — 시작 버튼 클릭으로 play 진입
// Step 1: 슬롯 4 생성 — direction 1..4 유니크
// Step 2: 빌드 메뉴 — 슬롯 클릭 시 메뉴 textBox 보임 (build mode)
// Step 3: 궁수 빌드 — gold -50, slot_type[1]=1, picture pic_archer
// Step 4: 골드 부족 체크 — 적은 gold 로 비싼 cannon 구매 시도 → 실패
// Step 5: 다른 슬롯 (cannon) 빌드
// Step 6: 업그레이드 — Lv1 클릭 → 메뉴 (upgrade mode), 클릭 → Lv2
// Step 7: 준비 완료 → 웨이브 시작
// Step 8: 적 처치 시 골드 보상 (스웜 +10, 탱크 +30)
// Step 9: WIN — state=1 + life > 0
// Step 10: LOSE — life=0 강제 → state=2

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import { runFresh, getVar, setVar, waitFor, createReporter, findColoredPixels } from './lib/verify-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE   = path.resolve(__dirname, '..', 'tests/fixtures/frontier-guard.ent');

const TOTAL_ENEMIES = 10;

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

const dumpState = () => page.evaluate(() => {
    const v = (n) => Entry.variableContainer.variables_.find(x => x.name_ === n)?.getValue();
    const l = (n) => (Entry.variableContainer.lists_.find(x => x.name_ === n)?.array_ || []).map(i => i.data);
    const slotTpl = Entry.container.getAllObjects().find(o => o.id === 'slot_template');
    const slots = (slotTpl?.clonedEntities || []).map(e => ({
        x: Math.round(e.x), y: Math.round(e.y),
        direction: e.direction,
        picId: e.picture && e.picture.id,
        scale: Math.round(e.scaleX * 100) / 100,
    }));
    const enemyTpl = Entry.container.getAllObjects().find(o => o.id === 'enemy');
    const enemies = enemyTpl?.clonedEntities?.length || 0;
    const hud = Entry.container.getAllObjects().find(o => o.id === 'hud_status');
    const m1 = Entry.container.getAllObjects().find(o => o.id === 'menu_btn1');
    const m2 = Entry.container.getAllObjects().find(o => o.id === 'menu_btn2');
    return {
        sceneId: Entry.scene.selectedScene?.id,
        life: +v('체력'), gold: +v('골드'), wave: +v('웨이브'), done: +v('처리수'),
        state: +v('상태'), prep_done: +v('준비완료'),
        menu_state: +v('ms'), building_slot: +v('bs'),
        slot_type: l('st').map(Number),
        slot_level: l('sl').map(Number),
        slots, enemyCount: enemies,
        hudText: hud?.entity?.getText() || '',
        m1Vis: m1?.entity?.visible, m1Txt: m1?.entity?.getText(),
        m2Vis: m2?.entity?.visible, m2Txt: m2?.entity?.getText(),
    };
});

async function clickById(id) {
    return page.evaluate((targetId) => {
        const obj = Entry.container.getAllObjects().find(o => o.id === targetId);
        if (!obj) throw new Error('object not found: ' + targetId);
        Entry.dispatchEvent('entityClick', obj.entity);
    }, id);
}

// stage 좌표 (-240..240, -135..135) 의 점을 실제 mouse click — pixel hit-test 통과해야 동작.
// stage logical (480x270) 를 canvas (rendered, e.g. 640x360) 픽셀로 환산 후 DOM rect 적용.
async function clickStagePoint(sx, sy) {
    const pos = await page.evaluate(({ sx, sy }) => {
        const canvas = Entry.stage.canvas.canvas;
        const rect = canvas.getBoundingClientRect();
        const w = canvas.width, h = canvas.height;  // 렌더링 픽셀 (예: 640x360)
        // stage logical 은 480x270 (Entry 기본). canvas 는 그 1.333 배 등의 scale.
        const stageW = 480, stageH = 270;
        const scaleX = w / stageW, scaleY = h / stageH;
        const cx = w / 2 + sx * scaleX;
        const cy = h / 2 - sy * scaleY;
        return {
            px: rect.left + cx * (rect.width / w),
            py: rect.top  + cy * (rect.height / h),
        };
    }, { sx, sy });
    await page.mouse.click(pos.px, pos.py);
}

async function clickSlotByDirection(dir) {
    return page.evaluate((d) => {
        const tpl = Entry.container.getAllObjects().find(o => o.id === 'slot_template');
        const clone = (tpl?.clonedEntities || []).find(e => e.direction === d);
        if (!clone) throw new Error('slot direction ' + d + ' not found');
        Entry.dispatchEvent('entityClick', clone);
    }, dir);
}

const t = createReporter();

// ── Step 0: intro → play ──
console.log('\n=== Step 0: intro 장면 + play 진입 ===');
await runFresh(page);
await page.waitForTimeout(500);
let s = await dumpState();
t.eq(s.sceneId, 'intro', '런 직후 sceneId = intro');

await clickById('intro_start_btn');
await page.waitForTimeout(1500);  // 슬롯 spawn 시간
s = await dumpState();
console.log(`  scene=${s.sceneId}, gold=${s.gold}, life=${s.life}, prep=${s.prep_done}`);
t.eq(s.sceneId, 'play', 'play 장면 진입');
t.eq(s.gold, 100, '초기 골드 100');
t.eq(s.life, 5, '초기 체력 5');
t.eq(s.prep_done, 0, '준비 단계 (prep_done=0)');

// ── Step 1: 슬롯 4 생성 ──
console.log('\n=== Step 1: 슬롯 4 spawn ===');
console.log(`  cloneCount=${s.slots.length}, directions=${JSON.stringify(s.slots.map(c => c.direction))}`);
t.eq(s.slots.length, 4, '슬롯 클론 4 개');
const dirs = s.slots.map(c => c.direction).sort((a, b) => a - b);
t.eq(dirs, [1, 2, 3, 4], '슬롯 direction = [1, 2, 3, 4] 유니크');
t.ok(s.slots.every(c => c.picId === 'pic_empty'), '모든 슬롯 picture = pic_empty');

// ── Step 1b: 빈 슬롯 가운데 픽셀 클릭 가능 (filled circle 회귀 가드) ──
//    이전 ring(22, 16) 으로 가운데 16px 영역이 투명 → 클릭 안되는 함정.
//    filled circle 로 변경 후 가운데 클릭 → 메뉴 열림 검증.
console.log('\n=== Step 1b: 빈 슬롯 가운데 픽셀 클릭 가능 (filled circle 회귀) ===');
// stage 좌표 (-160, 50) = slot 1 중심
const slotInfo = await page.evaluate(() => {
    const tpl = Entry.container.getAllObjects().find(o => o.id === 'slot_template');
    const c1 = (tpl?.clonedEntities || []).find(e => e.direction === 1);
    return {
        x: c1?.x, y: c1?.y, scaleX: c1?.scaleX, visible: c1?.visible,
        picW: c1?.picture?.dimension?.width, picH: c1?.picture?.dimension?.height,
        effect: c1?.effect, pictureId: c1?.picture?.id,
    };
});
console.log(`  slot1 entity: ${JSON.stringify(slotInfo)}`);
const canvasInfo = await page.evaluate(() => {
    const c = Entry.stage.canvas.canvas;
    const rect = c.getBoundingClientRect();
    return { w: c.width, h: c.height, rectW: rect.width, rectH: rect.height,
             rectLeft: rect.left, rectTop: rect.top };
});
console.log(`  canvas: ${JSON.stringify(canvasInfo)}`);
await clickStagePoint(-160, 50);
await page.waitForTimeout(400);
let s1b = await dumpState();
console.log(`  픽셀 클릭 후 menu_state=${s1b.menu_state}, building_slot=${s1b.building_slot}`);
t.eq(s1b.menu_state, 1, 'stage(-160,50) 픽셀 클릭으로 build 메뉴 열림');
t.eq(s1b.building_slot, 1, 'building_slot = 1 (slot 가운데도 클릭 영역)');
// 메뉴 닫고 진행
await clickById('menu_cancel');
await page.waitForTimeout(300);

// ── Step 2: 슬롯 1 클릭 → 빌드 메뉴 열림 ──
console.log('\n=== Step 2: 슬롯 1 클릭 → 빌드 메뉴 ===');
await clickSlotByDirection(1);
await page.waitForTimeout(300);
s = await dumpState();
console.log(`  menu_state=${s.menu_state}, building_slot=${s.building_slot}, m1Vis=${s.m1Vis}, m1Txt="${s.m1Txt}"`);
t.eq(s.menu_state, 1, 'menu_state = 1 (build)');
t.eq(s.building_slot, 1, 'building_slot = 1');
t.ok(s.m1Vis, 'menu_btn1 visible');
t.ok(s.m1Txt.includes('궁수'), 'menu_btn1 text contains "궁수"');
t.ok(s.m2Vis, 'menu_btn2 visible');
t.ok(s.m2Txt.includes('대포'), 'menu_btn2 text contains "대포"');

// ── Step 3: 궁수 빌드 ──
console.log('\n=== Step 3: 궁수 빌드 (menu_btn1 클릭) ===');
await clickById('menu_btn1');
await page.waitForTimeout(400);
s = await dumpState();
console.log(`  gold=${s.gold}, slot_type=${JSON.stringify(s.slot_type)}, slot_level=${JSON.stringify(s.slot_level)}`);
t.eq(s.gold, 50, '골드 100 → 50 (-50 archer)');
t.eq(s.slot_type[0], 1, 'slot_type[1] = 1 (archer)');
t.eq(s.slot_level[0], 1, 'slot_level[1] = 1 (Lv1)');
t.eq(s.menu_state, 0, '메뉴 닫힘 (menu_state = 0)');
t.ok(!s.m1Vis, 'menu_btn1 hidden');
const slot1Pic = s.slots.find(c => c.direction === 1)?.picId;
t.eq(slot1Pic, 'pic_archer', 'slot 1 picture = pic_archer');

// ── Step 4: 골드 부족 — cannon (80G) 구매 시도, 50G 만 보유 ──
console.log('\n=== Step 4: 골드 부족 cannon 시도 ===');
await clickSlotByDirection(2);  // 빈 슬롯 2
await page.waitForTimeout(300);
await clickById('menu_btn2');  // cannon 80G 시도
await page.waitForTimeout(400);
s = await dumpState();
console.log(`  gold=${s.gold} (expected 50, no deduction), slot_type=${JSON.stringify(s.slot_type)}`);
t.eq(s.gold, 50, '골드 변화 없음 (구매 실패)');
t.eq(s.slot_type[1], 0, 'slot 2 여전히 empty');
// 메뉴는 여전히 열려있음 (구매 실패 시 close_menu 안 보냄)
// 취소로 닫기
await clickById('menu_cancel');
await page.waitForTimeout(300);

// ── Step 5: 골드 충전 후 cannon 빌드 ──
console.log('\n=== Step 5: 골드 충전 후 cannon 빌드 ===');
await setVar(page, '골드', 200);  // 충전
await page.waitForTimeout(100);
await clickSlotByDirection(3);
await page.waitForTimeout(300);
await clickById('menu_btn2');  // cannon
await page.waitForTimeout(400);
s = await dumpState();
console.log(`  gold=${s.gold}, slot_type=${JSON.stringify(s.slot_type)}`);
t.eq(s.gold, 120, '골드 200 → 120 (-80 cannon)');
t.eq(s.slot_type[2], 2, 'slot 3 = cannon');
const slot3Pic = s.slots.find(c => c.direction === 3)?.picId;
t.eq(slot3Pic, 'pic_cannon', 'slot 3 picture = pic_cannon');

// ── Step 6: 업그레이드 (slot 1 archer Lv1 → Lv2) ──
console.log('\n=== Step 6: 업그레이드 archer Lv1 → Lv2 ===');
await clickSlotByDirection(1);  // 이미 archer Lv1
await page.waitForTimeout(300);
s = await dumpState();
console.log(`  메뉴 state=${s.menu_state} (expect 2 upgrade), m1Txt="${s.m1Txt}"`);
t.eq(s.menu_state, 2, 'menu_state = 2 (upgrade)');
t.ok(s.m1Txt.includes('업그레이드'), 'menu_btn1 = 업그레이드 텍스트');
t.ok(!s.m2Vis, 'menu_btn2 hidden in upgrade mode');

await clickById('menu_btn1');
await page.waitForTimeout(400);
s = await dumpState();
console.log(`  gold=${s.gold}, slot_level=${JSON.stringify(s.slot_level)}`);
t.eq(s.gold, 80, '골드 -40 (upgrade)');
t.eq(s.slot_level[0], 2, 'slot 1 level = 2');

// ── Step 7: 준비 완료 → 웨이브 시작 ──
console.log('\n=== Step 7: 준비 완료 ===');
await clickById('prep_done_btn');
await page.waitForTimeout(500);
s = await dumpState();
console.log(`  prep_done=${s.prep_done}, wave=${s.wave}`);
t.eq(s.prep_done, 1, 'prep_done = 1');

// 웨이브 1 spawn 대기
await page.waitForTimeout(4500);  // wait(2) + 첫 적 spawn (1.5s) + 여유
s = await dumpState();
console.log(`  wave=${s.wave}, next 적 수=${s.enemyCount}`);
t.ok(s.wave >= 1, 'wave_idx >= 1');

// ── Step 8: 적 처치 골드 보상 ──
console.log('\n=== Step 8: 적 처치 골드 보상 ===');
const goldBefore = s.gold;
const doneBefore = s.done;
// 일부 적 처치 대기
await page.waitForTimeout(8000);
s = await dumpState();
const killed = s.done - doneBefore;
console.log(`  done +${killed} (스웜+탱크 mix), gold ${goldBefore} → ${s.gold}`);
t.ok(killed >= 1, '최소 1 적 처치');
t.ok(s.gold > goldBefore, '처치 시 골드 보상 받음');

// ── Step 8b: 공격 빔 시각화 — 노란/주황 픽셀 검출 ──
console.log('\n=== Step 8b: 공격 빔 시각화 (brush 픽셀) ===');
// archer 빔 #fbbf24 (노란), cannon 빔 #f97316 (주황). 활성 적 있을 때 빔 그려짐.
// 빔은 cooldown 0.5s 마다 erase + redraw — 라인 발견 위해 짧은 폴링
let archerBeamSeen = false;
let cannonBeamSeen = false;
for (let i = 0; i < 6; i++) {
    const archerPx = await findColoredPixels(page, '#fbbf24');
    const cannonPx = await findColoredPixels(page, '#f97316');
    if (archerPx?.count > 5) archerBeamSeen = true;
    if (cannonPx?.count > 5) cannonBeamSeen = true;
    if (archerBeamSeen && cannonBeamSeen) break;
    await page.waitForTimeout(200);
}
console.log(`  archer 빔: ${archerBeamSeen}, cannon 빔: ${cannonBeamSeen}`);
t.ok(archerBeamSeen, 'archer 노란 빔 픽셀 검출 (#fbbf24)');
t.ok(cannonBeamSeen, 'cannon 주황 빔 픽셀 검출 (#f97316)');

// ── Step 9: WIN 끝까지 ──
console.log('\n=== Step 9: WIN ===');
const win = await waitFor(page, dumpState,
    s => s.state === 1 || s.state === 2,
    { timeoutMs: 60_000, intervalMs: 500, label: 'game over' }
).catch(e => { console.error('  ' + e.message); return null; });
console.log(`  최종: state=${win?.state}, life=${win?.life}, gold=${win?.gold}, hud="${win?.hudText}"`);
t.ok(win, '게임 종료 도달');
t.eq(win?.state, 1, 'state == 1 (WIN)');
t.eq(win?.done, TOTAL_ENEMIES, `enemies_done == ${TOTAL_ENEMIES}`);
t.ok(win?.life > 0, `life > 0 (${win?.life})`);
t.ok(win?.hudText.includes('WIN'), 'hud "YOU WIN!"');

// ── Step 10: LOSE — life=0 강제 ──
console.log('\n=== Step 10: LOSE — life=0 강제 ===');
await runFresh(page);
await page.waitForTimeout(500);
await clickById('intro_start_btn');
await page.waitForTimeout(1500);
await clickById('prep_done_btn');  // 즉시 시작 (타워 없이 — 적이 다 통과)
await page.waitForTimeout(3000);
await setVar(page, '체력', 0);
const lose = await waitFor(page, dumpState,
    s => s.state === 2,
    { timeoutMs: 5_000, intervalMs: 200, label: 'game lose' }
).catch(e => { console.error('  ' + e.message); return null; });
console.log(`  state=${lose?.state}, hud="${lose?.hudText}"`);
t.eq(lose?.state, 2, 'state == 2 (LOSE)');
t.ok(lose?.hudText.includes('OVER'), 'hud "GAME OVER"');

// ── 완료 ──
console.log('\n=== 완료 ===');
t.ok(pageErrors.length === 0, `페이지 에러 없음 (got ${pageErrors.length})`);
if (pageErrors.length) console.log('  errors:', pageErrors.slice(0, 3));

await browser.close();
process.exit(t.summary());
