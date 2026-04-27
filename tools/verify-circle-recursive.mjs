#!/usr/bin/env node
// 재귀로 그린 원 + 방향키 이동 검증.
//
// 1. fixture 로드, toggleRun 후 원이 화면 중앙(0,0)에 그려지는지 확인 (픽셀 분석)
// 2. 오른쪽 화살표 누른 채 1초 → 원의 중심 변수 cx 가 증가했는지
// 3. 위쪽 화살표 → cy 증가
// 4. 매 프레임 60회 재귀 호출이 단일 프레임 안에 끝나는지 (pageError 없음)
//
// 사전 조건: npm start.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE   = path.resolve(__dirname, '..', 'tests/fixtures/circle-recursive.ent');

let browser, page, errs;
try {
    ({ browser, page, pageErrors: errs } = await bootEditor({
        viewport: { width: 1400, height: 900 },
    }));
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

async function getCenter() {
    return page.evaluate(() => ({
        cx: +Entry.variableContainer.variables_.find(v => v.name_ === '원 중심 X').getValue(),
        cy: +Entry.variableContainer.variables_.find(v => v.name_ === '원 중심 Y').getValue(),
    }));
}

// 캔버스에서 파란색 픽셀(원)의 가로 범위·중심 찾기
async function findCirclePixels() {
    return page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll('canvas'))
            .filter(c => c.width >= 400 && c.height >= 200);
        if (!canvases.length) return null;
        const c = canvases[0];
        const ctx = c.getContext('2d');
        const img = ctx.getImageData(0, 0, c.width, c.height);
        let blueCount = 0, sumX = 0, sumY = 0, minX = Infinity, maxX = -Infinity;
        for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
                const i = (y * c.width + x) * 4;
                const r = img.data[i], g = img.data[i+1], b = img.data[i+2], a = img.data[i+3];
                // 파란색 (#2563eb 근방): b 큼, r/g 작음
                if (a > 100 && b > 150 && r < 120 && g < 120) {
                    blueCount++; sumX += x; sumY += y;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                }
            }
        }
        return blueCount === 0
            ? { count: 0 }
            : { count: blueCount, avgX: sumX / blueCount, avgY: sumY / blueCount,
                minX, maxX, width: maxX - minX, canvasW: c.width, canvasH: c.height };
    });
}

async function holdKey(code, ms) {
    await page.evaluate(c => document.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c })), code);
    await page.waitForTimeout(ms);
    await page.evaluate(c => document.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c })), code);
}

console.log('\n=== Step 1: toggleRun → 원이 (0,0) 에 그려져야 함 ===');
await page.evaluate(() => { try { Entry.engine.toggleRun(); } catch {} });
await page.waitForTimeout(800);

const initialPixels = await findCirclePixels();
const initialCenter = await getCenter();
console.log(`  변수: cx=${initialCenter.cx}, cy=${initialCenter.cy}`);
console.log(`  파란 픽셀: ${initialPixels.count}, 가로 폭=${Math.round(initialPixels.width)}px, 화면 중심 x=${Math.round(initialPixels.avgX)}/${initialPixels.canvasW}`);

log(initialCenter.cx === 0 && initialCenter.cy === 0, '시작 시 cx=0, cy=0');
log(initialPixels.count > 100, `파란 픽셀 100개 이상 (실제: ${initialPixels.count}) — 원이 그려짐`);
// r=57, 화면 비율 (640x360 stage scale)에서 가로 폭이 약 100~140px 정도면 OK
log(initialPixels.width > 60 && initialPixels.width < 200,
    `원 가로 폭이 60~200px 범위 (실제: ${Math.round(initialPixels.width)}px)`);
// 화면 중앙 근처
log(Math.abs(initialPixels.avgX - initialPixels.canvasW / 2) < 50,
    `원 중심이 캔버스 가로 중앙 ±50px 범위 (cx=0 일 때)`);

console.log('\n=== Step 2: 오른쪽 화살표 0.4초 hold → cx 증가 + 화면에서 원 우측 이동 ===');
await holdKey('ArrowRight', 400);
await page.waitForTimeout(300);

const rightCenter = await getCenter();
const rightPixels = await findCirclePixels();
console.log(`  변수: cx=${rightCenter.cx}, cy=${rightCenter.cy}`);
console.log(`  화면 중심: ${Math.round(rightPixels.avgX)}px (시작 ${Math.round(initialPixels.avgX)}px)`);

log(rightCenter.cx > 50, `cx 가 50 보다 커짐 (실제: ${rightCenter.cx})`);
log(rightCenter.cy === 0, `cy 는 변하지 않음`);
log(rightPixels.avgX > initialPixels.avgX + 30,
    `원이 화면에서 오른쪽으로 30px 이상 이동 (Δ=${Math.round(rightPixels.avgX - initialPixels.avgX)}px)`);

console.log('\n=== Step 3: 위쪽 화살표 0.4초 hold → cy 증가 + 화면에서 원 위로 이동 ===');
await holdKey('ArrowUp', 400);
await page.waitForTimeout(300);

const upCenter = await getCenter();
const upPixels = await findCirclePixels();
console.log(`  변수: cx=${upCenter.cx}, cy=${upCenter.cy}`);
console.log(`  화면 Y 중심: ${Math.round(upPixels.avgY)}px (오른쪽 이동 후 ${Math.round(rightPixels.avgY)}px)`);

log(upCenter.cy > 30, `cy 가 30 보다 커짐 (실제: ${upCenter.cy})`);
// Entry y+ 는 위쪽 → 화면 픽셀 y 는 감소
log(upPixels.avgY < rightPixels.avgY - 20,
    `원이 화면에서 위쪽으로 20px 이상 이동 (Δ=${Math.round(rightPixels.avgY - upPixels.avgY)}px)`);

console.log('\n=== Step 4: 60 회 재귀 호출이 매 프레임 정상 완료 (pageError 없음) ===');
log(errs.length === 0, `pageErrors === 0 (실제: ${errs.length})`);
if (errs.length) for (const e of errs.slice(0, 3)) console.log('   - ', e);

// 스크린샷
const shot = path.join(__dirname, 'verify-circle-recursive.png');
await page.screenshot({ path: shot });
console.log(`\n스크린샷: ${path.relative(path.resolve(__dirname, '..'), shot)}`);

console.log(pass ? '\n✓ 재귀 원 그리기 + 방향키 이동 검증 통과' : '\n✗ 일부 검증 실패');

await browser.close();
process.exit(pass ? 0 : 4);
