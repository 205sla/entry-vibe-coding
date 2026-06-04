// 애니메이션 검증 — 시작 버튼 누르고 일정 시간 후 보이기 리스트 상태 확인.
// 정상: 시간이 지나면 첫번째 증가, 단계가 점점 작아지며 N 증가.

import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import { runFresh, getVar, getList } from './lib/verify-harness.mjs';

const FIXTURE  = 'games/name-circle/name-circle_008.ent';
const SHOTPATH = 'games/name-circle/name-circle_anim_verify.png';

const { browser, page, pageErrors } = await bootEditor();
try {
    await loadFixture(page, FIXTURE);
    await runFresh(page);   // start the project

    // Sample state at intervals
    const samples = [0.2, 1.0, 3.0, 7.0];   // seconds
    let prev = 0;
    for (const t of samples) {
        const wait = (t - prev) * 1000;
        await page.waitForTimeout(wait);
        prev = t;
        const first = await getVar(page, '첫번째');
        const step  = await getVar(page, '단계');
        const list  = await getList(page, '보이기');
        console.log(`t=${t}s | 첫번째=${first}, 단계=${step}, N=${list.length}, 보이기=[${list.slice(0, 10).join(', ')}${list.length > 10 ? `, ...(${list.length})` : ''}]`);
    }

    // canvas screenshot
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
