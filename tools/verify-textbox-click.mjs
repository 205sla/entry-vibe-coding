#!/usr/bin/env node
// textBox 클릭 hit-test — 투명 vs 불투명 배경 비교.
//
// 가설: 투명 textBox 는 glyph 픽셀만 클릭 인식. hex bgColor 면 사각 영역 전체.
//
// 방법: PIXI interaction pipeline 을 통해야 진짜 hit-test 가 도는데, 그러려면
// 실제 MouseEvent 를 캔버스 DOM 에 dispatch 해야 함. `Entry.dispatchEvent('entityClick', ...)`
// 는 hit-test 를 우회하므로 이 검증에는 부적합.
//
// 사전 조건: npm start.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import { runFresh, getVar, createReporter } from './lib/verify-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE   = path.resolve(__dirname, '..', 'tests/fixtures/textbox-click.ent');

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

// ── 좌표 변환 헬퍼 (페이지 안에서 실행) ────────
//
// stage (sx, sy) — 무대 좌표 (-240..240, -135..135 기본; (0,0) 중앙)
// → canvas 픽셀 → 페이지 좌표 (DOMRect 적용).
async function clickStagePoint(page, sx, sy) {
    const pos = await page.evaluate(({ sx, sy }) => {
        const canvas = Entry.stage.canvas.canvas;  // PIXI/createjs wrapped canvas
        const rect = canvas.getBoundingClientRect();
        // Entry stage logical size — canvas.width/height 가 logical pixel 임
        const w = canvas.width;
        const h = canvas.height;
        // stage 좌표계: (0,0) 중앙, x 오른쪽+, y 위+. canvas 는 top-down.
        const cx = w / 2 + sx;
        const cy = h / 2 - sy;
        // canvas 픽셀 → 페이지 픽셀 (rect 비율 적용)
        const px = rect.left + cx * (rect.width / w);
        const py = rect.top  + cy * (rect.height / h);
        return { px, py, cx, cy, rectW: rect.width, rectH: rect.height, canvasW: w, canvasH: h };
    }, { sx, sy });

    await page.mouse.click(pos.px, pos.py);
    return pos;
}

// 변수 스냅샷
async function snapshot(page) {
    return {
        transparent: +(await getVar(page, '투명_클릭수')),
        opaque:      +(await getVar(page, '불투명_클릭수')),
    };
}

const t = createReporter();

// ── 시작 — 엔진 실행 (when_object_click 핸들러가 발화하려면 engine.state==='run') ──
console.log('\n=== Setup ===');
await runFresh(page);
await page.waitForTimeout(800);  // engine 안정화

const initial = await snapshot(page);
console.log(`  초기 카운터: 투명=${initial.transparent}, 불투명=${initial.opaque}`);
t.eq(initial, { transparent: 0, opaque: 0 }, '카운터 초기 0');

// 캔버스 정보 한 번 출력 (디버깅용)
const info = await page.evaluate(() => {
    const c = Entry.stage.canvas.canvas;
    return { canvasW: c.width, canvasH: c.height, rectW: c.getBoundingClientRect().width };
});
console.log(`  캔버스 logical=${info.canvasW}x${info.canvasH}, rendered width=${info.rectW.toFixed(0)}`);

// 두 textBox 의 실제 entity 상태 출력
const boxes = await page.evaluate(() => {
    const get = (id) => {
        const o = Entry.container.getAllObjects().find(x => x.id === id);
        if (!o) return null;
        const e = o.entity;
        return {
            x: e.x, y: e.y, width: e.width, height: e.height,
            scaleX: e.scaleX, scaleY: e.scaleY,
            bgColor: e.bgColor,
            text: e.getText(),
            bgAlpha: e.bgObject ? e.bgObject.alpha : null,
        };
    };
    return { transparent: get('transparent_box'), opaque: get('opaque_box') };
});
console.log('  투명 box:',  JSON.stringify(boxes.transparent));
console.log('  불투명 box:', JSON.stringify(boxes.opaque));

// ── Step 1: 5×5 그리드 스캔 — hit 비율로 정량 비교 ─────
// 각 textBox 의 사각 영역 (300×80, 중심 ±150 / ±40) 에 5×5=25 개 점 클릭.
// 투명: 글자 (■■■, 70px) 와 겹치는 일부만 hit. 불투명: 25/25 hit (전체 사각형 hit).
console.log('\n=== Step 1: 5x5 그리드 스캔 — 사각 전체 hit 비율 ===');

const GRID_X = [-120, -60, 0, 60, 120];
const GRID_Y = [-30, -15, 0, 15, 30];

for (const dx of GRID_X) {
    for (const dy of GRID_Y) {
        await clickStagePoint(page, dx, 60 + dy);   // 투명 box 영역
        await clickStagePoint(page, dx, -60 + dy);  // 불투명 box 영역
    }
}
await page.waitForTimeout(400);

const grid = await snapshot(page);
console.log(`  투명 box: 25 회 클릭 중 ${grid.transparent} 회 hit (${(grid.transparent/25*100).toFixed(0)}%)`);
console.log(`  불투명 box: 25 회 클릭 중 ${grid.opaque} 회 hit (${(grid.opaque/25*100).toFixed(0)}%)`);

t.eq(grid.opaque, 25, '불투명 textBox 사각 전체 클릭 가능 (25/25)');
t.ok(grid.transparent < 25, '투명 textBox 사각 전체는 클릭 안 됨 (<25, glyph 위만 hit)');
t.ok(grid.transparent > 0,  '투명 textBox 도 glyph 위 클릭은 잡힘 (>0)');
t.ok(grid.transparent * 2 < grid.opaque, '투명 hit 율 << 불투명 hit 율 (가설 확인)');

// 직접 entityClick — hit-test 우회로 핸들러가 wired 되어 있음을 보강 검증
console.log('\n=== Step 2: entityClick 직접 dispatch (hit-test 우회) ===');
const before = (await snapshot(page)).transparent;
await page.evaluate(() => {
    const o = Entry.container.getAllObjects().find(x => x.id === 'transparent_box');
    Entry.dispatchEvent('entityClick', o.entity);
});
await page.waitForTimeout(200);
const direct = await snapshot(page);
t.eq(direct.transparent, before + 1, 'when_object_click 핸들러는 정상 wired (entityClick 직접 fire)');

// ── 결과 요약 ──────────────
console.log('\n=== 결론 ===');
console.log(`  5×5 그리드 (사각 영역 전체): 투명 ${grid.transparent}/25 (${(grid.transparent/25*100).toFixed(0)}%), 불투명 ${grid.opaque}/25 (100%)`);
console.log('  entityClick 직접 dispatch: 투명도 정상 fire (handler 자체는 wired)');
console.log('');
console.log('  → 투명 textBox 의 클릭 인식 영역 = textObject 의 glyph 알파>1 픽셀만 (pixelPerfect=true)');
console.log('  → 불투명 textBox 의 클릭 인식 영역 = bgObject 의 사각 전체 (alpha=1, full rect)');
console.log('  → 버튼 용도로는 hex bgColor 필수 — 투명은 글자 위만 클릭 가능해 부적합');

// ── 완료 ────────────────────
console.log('\n=== 완료 ===');
t.ok(pageErrors.length === 0, `페이지 에러 없음 (got ${pageErrors.length})`);
if (pageErrors.length) console.log('  errors:', pageErrors.slice(0, 3));

await browser.close();
process.exit(t.summary());
