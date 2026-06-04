// name-circle 중심 검증 — ALL_VISIBLE=1 로 빌드한 .ent 의 변수 디스플레이 시각 중심들이
// 캔버스 중심에 모이는지 측정.
// 1) 모든 변수의 _nameWidth, _valueWidth 읽어 실측 W 계산.
// 2) 각 변수의 anchor.x + W/2, anchor.y - 2 → 시각 중심 (stage 좌표).
// 3) 시각 중심들의 평균 (centroid) 이 (0, 0) 인지 확인.
// 4) 캔버스 픽셀 좌표로도 변환 (canvas 중심 ≈ (320, 180)).
// 5) screenshot 저장.

import fs from 'node:fs';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';

const FIXTURE  = 'games/name-circle/name-circle_006.ent';
const SHOTPATH = 'games/name-circle/name-circle_verify.png';

const { browser, page, pageErrors } = await bootEditor();
try {
    await loadFixture(page, FIXTURE);

    // 모든 변수가 visible 한 상태에서 updateView 가 한 번 돌아야 _nameWidth/_valueWidth 가 채워짐.
    // (load 시 visible=true 면 자동으로 updateView 됨, 한 박자 더 기다림)
    await page.waitForTimeout(500);

    const data = await page.evaluate(() => {
        const vc = Entry.variableContainer;
        const canvasEl = document.querySelector('#entryCanvas');
        const cw = canvasEl?.width  || 0;
        const ch = canvasEl?.height || 0;
        const vars = vc.variables_.filter(v => v.name_ === '변수');
        const widths = [];
        const centers = [];
        for (const v of vars) {
            const nw = v._nameWidth;
            const vw = v._valueWidth;
            // anchor → 시각 중심 (stage 좌표 기준)
            const cx_stage = v.x_ + (nw + vw + 35) / 2;
            const cy_stage = v.y_ + (-14 + 10) / 2;   // rect y=-14, h=24 → 중심 y_offset = -2
            widths.push({ nw, vw, W: nw + vw + 35 });
            centers.push({ angle: vars.indexOf(v), stage_x: v.x_, stage_y: v.y_, cx_stage, cy_stage });
        }
        // 픽셀 좌표는 localToGlobal 로
        const pixelCenters = vars.map(v => {
            const p = v.view_.localToGlobal((v._nameWidth + v._valueWidth + 35)/2, -2);
            return { px: p.x, py: p.y };
        });
        return { canvas: { w: cw, h: ch }, widths, centers, pixelCenters };
    });

    // 통계
    const W = data.widths[0].W;
    const allSameW = data.widths.every(w => w.W === W);
    console.log(`canvas: ${data.canvas.w} × ${data.canvas.h}`);
    console.log(`첫 변수 nameWidth=${data.widths[0].nw}, valueWidth=${data.widths[0].vw}, W=${W}`);
    console.log(`모든 W 동일? ${allSameW}`);
    if (!allSameW) {
        const Ws = new Set(data.widths.map(w => w.W));
        console.log(`  W 분포:`, [...Ws]);
    }

    // Stage 좌표 centroid
    const sumCx = data.centers.reduce((s, c) => s + c.cx_stage, 0);
    const sumCy = data.centers.reduce((s, c) => s + c.cy_stage, 0);
    const meanCx = sumCx / data.centers.length;
    const meanCy = sumCy / data.centers.length;
    console.log();
    console.log(`Stage 좌표 시각 중심 centroid: (${meanCx.toFixed(3)}, ${meanCy.toFixed(3)})`);
    console.log(`  ↑ (0, 0) 에 가까울수록 좋음. 벗어나면 그 만큼 build 의 HALF_W/Y_VCENTER_OFFSET 조정 필요.`);

    // 픽셀 좌표 centroid
    const sumPx = data.pixelCenters.reduce((s, p) => s + p.px, 0);
    const sumPy = data.pixelCenters.reduce((s, p) => s + p.py, 0);
    const meanPx = sumPx / data.pixelCenters.length;
    const meanPy = sumPy / data.pixelCenters.length;
    const cwHalf = data.canvas.w / 2;
    const chHalf = data.canvas.h / 2;
    console.log();
    console.log(`Canvas 픽셀 시각 중심 centroid: (${meanPx.toFixed(1)}, ${meanPy.toFixed(1)})`);
    console.log(`Canvas 중심: (${cwHalf}, ${chHalf})`);
    console.log(`  Δ = (${(meanPx - cwHalf).toFixed(1)}, ${(meanPy - chHalf).toFixed(1)})`);

    // 권장 조정값
    console.log();
    console.log(`권장 build 조정:`);
    console.log(`  DISPLAY_W = ${W}      (현재값과 다르면 빌드 다시)`);
    console.log(`  (각 변수의 x 에 (현재 HALF_W - W/2) 만큼 더하면 centroid 0 으로 맞음)`);

    // 캔버스만 잘라서 스크린샷
    const canvasBox = await page.evaluate(() => {
        const el = document.querySelector('#entryCanvas');
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    await page.screenshot({ path: SHOTPATH, clip: canvasBox });
    console.log();
    console.log(`screenshot (canvas only): ${SHOTPATH}, clip=${JSON.stringify(canvasBox)}`);
} finally {
    if (pageErrors.length) console.log('page errors:', pageErrors);
    await browser.close();
}
