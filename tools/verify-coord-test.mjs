// 좌표 검증 — coord-test 의 4 변수가 실제 어떤 위치에 렌더되는지 확인.
// Entry 의 변수 view 는 createjs/PIXI display object 라 stage 좌표 + transform 계산.
// 각 변수의 globalToLocal 위치를 캔버스 픽셀 좌표로 읽어 화면 사분면 (1/2/3/4) 추론.

import { bootEditor, loadFixture } from './lib/editor-harness.mjs';

const FIXTURE = 'games/coord-test/coord-test_001.ent';

const { browser, page, pageErrors } = await bootEditor();
try {
    await loadFixture(page, FIXTURE);

    // 각 변수의 view_ 절대 위치를 캔버스 픽셀로 측정.
    const result = await page.evaluate(() => {
        const vc = Entry.variableContainer;
        const canvasEl = document.querySelector('#entryCanvas');
        const canvasW = canvasEl?.width  || 0;
        const canvasH = canvasEl?.height || 0;

        const out = [];
        for (const v of vc.variables_) {
            // view_ 는 PIXI/createjs display object. localToGlobal 로 캔버스 픽셀 좌표.
            const view = v.view_;
            // createjs Container.localToGlobal:
            let absX, absY;
            if (typeof view.localToGlobal === 'function') {
                const p = view.localToGlobal(0, 0);
                absX = p.x; absY = p.y;
            } else {
                // PIXI fallback
                const wt = view.worldTransform || view.transform?.worldTransform;
                absX = wt ? wt.tx : null;
                absY = wt ? wt.ty : null;
            }
            out.push({
                name: v.name_,
                stage_x: v.x_,
                stage_y: v.y_,
                pixel_x: absX,
                pixel_y: absY,
                canvasW, canvasH,
            });
        }
        return out;
    });

    console.log('Canvas 크기:', result[0]?.canvasW, '×', result[0]?.canvasH);
    console.log();
    console.log('변수별 픽셀 위치 (캔버스 좌상단 = (0, 0)):');
    console.log('이름    | stage (x, y) | pixel (x, y)            | 사분면');
    console.log('--------|--------------|-------------------------|--------');
    for (const r of result) {
        if (!/^(오른|왼)/.test(r.name)) continue;
        const cx = r.canvasW / 2;
        const cy = r.canvasH / 2;
        const horiz = r.pixel_x > cx ? '오른쪽' : '왼쪽';
        const vert  = r.pixel_y > cy ? '아래'   : '위';
        const q = `${horiz}-${vert}`;
        console.log(`${r.name.padEnd(7)} | (${r.stage_x.toString().padStart(4)}, ${r.stage_y.toString().padStart(4)}) | (${r.pixel_x.toFixed(1).padStart(6)}, ${r.pixel_y.toFixed(1).padStart(6)}) | ${q}`);
    }

    console.log();
    console.log('결론:');
    const oneWi = result.find(r => r.name === '오른위');     // stage (+100, +100)
    const wnAr = result.find(r => r.name === '왼아래');      // stage (-100, -100)
    if (oneWi && wnAr) {
        const cy = oneWi.canvasH / 2;
        const yPosIsDown = oneWi.pixel_y > cy;
        console.log(`  stage y=+100 ("오른위") 픽셀 y=${oneWi.pixel_y.toFixed(1)} (캔버스 중앙 y=${cy})`);
        console.log(`  → stage y 양수는 화면 ${yPosIsDown ? '아래' : '위'}`);
    }
} finally {
    if (pageErrors.length) {
        console.log();
        console.log('page errors:', pageErrors);
    }
    await browser.close();
}
