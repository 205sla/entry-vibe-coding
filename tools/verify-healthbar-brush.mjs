#!/usr/bin/env node
// 붓으로 그리는 체력바 런타임 검증.
//
// 절차:
//   1. healthbar-brush.ent 로드
//   2. toggleRun → repeat_inf 시작 (매 프레임 erase + draw)
//   3. hp 변수(slide, 0~100)를 3가지 값으로 설정하고 각각 스크린샷
//   4. stage 캔버스 픽셀을 샘플링해서 초록/빨강 픽셀 개수가 hp에 비례하는지 확인
//
// 사전 조건: npm start 로 http://localhost:3000 편집기 기동.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const FIXTURE   = path.join(ROOT, 'tests/fixtures/healthbar-brush.ent');

const TEST_HP_VALUES = [100, 50, 10, 0];

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

// slide 변수 상태 확인
const varInfo = await page.evaluate(() => {
    const v = Entry.variableContainer.variables_.find(x => x.name_ === '체력');
    return v ? {
        type: v.type, value: v.getValue(),
        min: v.minValue_, max: v.maxValue_, visible: v.isVisible(),
    } : null;
});
console.log('\n체력 변수:', JSON.stringify(varInfo));
if (!varInfo || varInfo.type !== 'slide') {
    console.error('✗ 체력 변수가 slide 타입이 아님');
    await browser.close();
    process.exit(4);
}

// 스크립트 실행
await page.evaluate(() => { Entry.engine.toggleRun(); });
await page.waitForTimeout(500);

// Entry의 stage canvas 찾기
const canvasInfo = await page.evaluate(() => {
    // EaselJS 스테이지 캔버스는 보통 id='entryCanvas' 또는 첫 canvas.
    const cs = Array.from(document.querySelectorAll('canvas'));
    return cs.map(c => ({ id: c.id, w: c.width, h: c.height, cls: c.className }));
});
console.log('캔버스들:', JSON.stringify(canvasInfo, null, 2));

// 픽셀 샘플링 함수: 캔버스에서 녹색/빨간색 픽셀 수를 카운트
async function sampleBar(hp) {
    // hp 설정
    await page.evaluate((h) => {
        const v = Entry.variableContainer.variables_.find(x => x.name_ === '체력');
        v.setValue(h);
    }, hp);
    // 최소 한 프레임 반영 대기
    await page.waitForTimeout(250);

    // 스크린샷 (디버깅용)
    const shot = path.join(__dirname, `verify-healthbar-hp${hp}.png`);
    await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 1400, height: 900 } });

    // Entry의 stage 캔버스에서 y=100 근처 라인 스캔
    //   Entry stage 좌표 (0,0) 가운데, y+ 위쪽
    //   기본 stage 480x270 (canvasWidth=640 편집기에서는 자동 스케일),
    //   바: x=-100~100, y=100 (즉 위쪽), 두께=20
    //   캔버스 픽셀 좌표로 변환: 중앙 기준 → 캔버스 가로/세로 * (x+240)/480, (135-y)/270
    const result = await page.evaluate(() => {
        // Entry 스테이지 DOM 요소 탐색: entry canvas로 추정되는 것을 찾는다
        const candidates = Array.from(document.querySelectorAll('canvas'))
            .filter(c => c.width >= 400 && c.height >= 200);
        if (candidates.length === 0) return { err: 'no stage canvas' };
        const c = candidates[0];
        const ctx = c.getContext('2d');

        // 스테이지 좌표 (x, 100) 을 캔버스 픽셀로 — stage 기본 480×270
        // y=100 → (135 - 100) / 270 * c.height
        const py = Math.round((135 - 100) / 270 * c.height);

        // 픽셀 라인 스캔 (y에서 두께 20만큼 5픽셀 샘플)
        const sampleYs = [py - 8, py - 4, py, py + 4, py + 8];
        let green = 0, red = 0, other = 0;
        for (const sy of sampleYs) {
            const img = ctx.getImageData(0, sy, c.width, 1);
            for (let x = 0; x < c.width; x++) {
                const r = img.data[x * 4], g = img.data[x * 4 + 1], b = img.data[x * 4 + 2], a = img.data[x * 4 + 3];
                if (a < 100) continue;
                if (g > 120 && r < 120 && b < 120) green++;
                else if (r > 120 && g < 120 && b < 120) red++;
                else if (a > 200) other++;
            }
        }
        return { canvasW: c.width, canvasH: c.height, green, red, other };
    });
    return { hp, shot, ...result };
}

// 각 hp 값에 대해 샘플
console.log('\n=== 체력바 렌더링 검증 ===');
const rows = [];
for (const hp of TEST_HP_VALUES) {
    const r = await sampleBar(hp);
    rows.push(r);
    console.log(
        `  hp=${String(hp).padStart(3)}  →  green px=${String(r.green).padStart(5)}  ` +
        `red px=${String(r.red).padStart(5)}  ratio(g/(g+r))=${
            (r.green + r.red > 0 ? (r.green / (r.green + r.red)).toFixed(2) : 'n/a')
        }`
    );
}

// 판정: green px가 hp에 단조 증가해야 하고, red는 단조 감소해야 함
let pass = true;
for (let i = 1; i < rows.length; i++) {
    // TEST_HP_VALUES 는 감소순이므로 green 도 감소해야
    if (rows[i].green > rows[i - 1].green) {
        console.log(`  ✗ 단조성 위반: hp ${rows[i - 1].hp}→${rows[i].hp} 에서 green 증가`);
        pass = false;
    }
    if (rows[i].red < rows[i - 1].red) {
        console.log(`  ✗ 단조성 위반: hp ${rows[i - 1].hp}→${rows[i].hp} 에서 red 감소`);
        pass = false;
    }
}

// hp=100 에서는 녹색 > 0, 빨간색 ~ 0
// hp=0 에서는 녹색 ~ 0, 빨간색 > 0
const hp100 = rows.find(r => r.hp === 100);
const hp0   = rows.find(r => r.hp === 0);
if (hp100 && (hp100.green < 100 || hp100.red > 50)) {
    console.log(`  ✗ hp=100 인데 green=${hp100.green}, red=${hp100.red}`);
    pass = false;
}
if (hp0 && (hp0.red < 100 || hp0.green > 50)) {
    console.log(`  ✗ hp=0 인데 green=${hp0.green}, red=${hp0.red}`);
    pass = false;
}

if (pass) console.log('\n✓ 체력바 렌더링 통과 — hp에 따라 녹↔빨 정상 단조 변화');
else      console.log('\n✗ 체력바 렌더링 실패');

if (errs.length) {
    console.log('\npageErrors:');
    for (const e of errs.slice(0, 5)) console.log(' -', e);
}

console.log('\n스크린샷:');
for (const r of rows) console.log('  ' + path.relative(ROOT, r.shot));

await browser.close();
process.exit(pass ? 0 : 5);
