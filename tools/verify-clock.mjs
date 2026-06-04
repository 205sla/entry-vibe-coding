// clock 중심 검증 — ALL_VISIBLE=1 로 빌드한 .ent. 60 개 "시계" 변수의 시각 중심이
// 캔버스 중심에 모이는지 측정.

import { bootEditor, loadFixture } from './lib/editor-harness.mjs';

const FIXTURE  = process.argv[2] || 'games/clock/clock_003.ent';
const SHOTPATH = 'games/clock/clock_verify.png';

const { browser, page, pageErrors } = await bootEditor();
try {
    await loadFixture(page, FIXTURE);
    await page.waitForTimeout(500);

    const data = await page.evaluate(() => {
        const vc = Entry.variableContainer;
        const canvasEl = document.querySelector('#entryCanvas');
        const vars = vc.variables_.filter(v => v.name_ === '시계');
        const widths = vars.map(v => ({ nw: v._nameWidth, vw: v._valueWidth, W: v._nameWidth + v._valueWidth + 35 }));
        const stageCenters = vars.map(v => ({
            cx_stage: v.x_ + (v._nameWidth + v._valueWidth + 35) / 2,
            cy_stage: v.y_ - 2,
        }));
        const pixelCenters = vars.map(v => {
            const p = v.view_.localToGlobal((v._nameWidth + v._valueWidth + 35) / 2, -2);
            return { px: p.x, py: p.y };
        });
        return {
            canvas: { w: canvasEl.width, h: canvasEl.height },
            widths, stageCenters, pixelCenters,
        };
    });

    const W = data.widths[0].W;
    const allSame = data.widths.every(w => Math.abs(w.W - W) < 0.01);
    console.log(`canvas: ${data.canvas.w} × ${data.canvas.h}`);
    console.log(`첫 변수 nameWidth=${data.widths[0].nw}, valueWidth=${data.widths[0].vw}, W=${W}`);
    console.log(`모든 W 동일? ${allSame}`);

    const meanCx = data.stageCenters.reduce((s, c) => s + c.cx_stage, 0) / data.stageCenters.length;
    const meanCy = data.stageCenters.reduce((s, c) => s + c.cy_stage, 0) / data.stageCenters.length;
    console.log();
    console.log(`Stage 좌표 시각 중심 centroid: (${meanCx.toFixed(3)}, ${meanCy.toFixed(3)})`);

    const meanPx = data.pixelCenters.reduce((s, p) => s + p.px, 0) / data.pixelCenters.length;
    const meanPy = data.pixelCenters.reduce((s, p) => s + p.py, 0) / data.pixelCenters.length;
    const cwHalf = data.canvas.w / 2;
    const chHalf = data.canvas.h / 2;
    console.log(`Canvas 픽셀 centroid: (${meanPx.toFixed(1)}, ${meanPy.toFixed(1)}) | 중심: (${cwHalf}, ${chHalf}) | Δ = (${(meanPx - cwHalf).toFixed(1)}, ${(meanPy - chHalf).toFixed(1)})`);

    console.log();
    console.log(`권장 DISPLAY_W = ${W}`);

    const box = await page.evaluate(() => {
        const el = document.querySelector('#entryCanvas');
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    await page.screenshot({ path: SHOTPATH, clip: box });
    console.log(`screenshot: ${SHOTPATH}`);
} finally {
    if (pageErrors.length) console.log('page errors:', pageErrors);
    await browser.close();
}
