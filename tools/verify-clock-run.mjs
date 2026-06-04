// clock 실제 동작 검증 — 시작 클릭 후 3 hand 변수의 픽셀 위치 확인.

import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import { runFresh } from './lib/verify-harness.mjs';

const FIXTURE = 'games/clock/clock_005.ent';
const SHOTPATH = 'games/clock/clock_run_verify.png';

const { browser, page, pageErrors } = await bootEditor();
try {
    await loadFixture(page, FIXTURE);
    await runFresh(page);
    await page.waitForTimeout(1500);   // 시계 tick 실행

    const data = await page.evaluate(() => {
        const vc = Entry.variableContainer;
        const canvasEl = document.querySelector('#entryCanvas');
        const visible = vc.variables_.filter(v => v.name_ === '시계' && v.view_?.visible);
        const info = visible.map(v => {
            const p = v.view_.localToGlobal((v._nameWidth + v._valueWidth + 35) / 2, -2);
            return {
                value: v.value_,
                stage_x: v.x_, stage_y: v.y_,
                pixel_cx: p.x, pixel_cy: p.y,
            };
        });
        return {
            canvas: { w: canvasEl.width, h: canvasEl.height },
            visible: info,
            getDate: { h: new Date().getHours(), m: new Date().getMinutes(), s: new Date().getSeconds() },
        };
    });

    console.log(`현재 시각: ${data.getDate.h}:${data.getDate.m}:${data.getDate.s}`);
    console.log(`visible "시계" 변수: ${data.visible.length} 개`);
    for (const v of data.visible) {
        const dxFromCenter = v.pixel_cx - data.canvas.w / 2;
        const dyFromCenter = v.pixel_cy - data.canvas.h / 2;
        const r = Math.sqrt(dxFromCenter ** 2 + dyFromCenter ** 2);
        const ang = Math.round((Math.atan2(dxFromCenter, -dyFromCenter) * 180 / Math.PI + 360) % 360);
        console.log(`  값="${v.value}" | stage(${v.stage_x}, ${v.stage_y}) | pixel center (${v.pixel_cx.toFixed(1)}, ${v.pixel_cy.toFixed(1)}) | r=${r.toFixed(1)}, 각도≈${ang}°`);
    }

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
