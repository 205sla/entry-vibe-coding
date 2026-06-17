#!/usr/bin/env node
// 캐주얼 전환 버전(online-match-casual) — 슬라이드 와이프 전환 캡처 + 플로우/에러 검증.
//
// 진행 로직은 _006 과 동일(이미 검증). 여기선 (1) 전환 와이프가 보이는지 연속 프레임으로
// 포착하고 (2) 핵심 플로우(start→match→game→mid→result)가 0 에러로 도는지만 확인한다.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from '../../tools/lib/editor-harness.mjs';
import {
    runFresh, getVar, clickObject, tapKey, waitFor, createReporter,
} from '../../tools/lib/verify-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE   = path.resolve(__dirname, 'online-match-casual_001.ent');

const readScene = (page) =>
    page.evaluate(() => { try { return Entry.scene.selectedScene.id; } catch { return null; } });

async function clipBox(page) {
    return page.evaluate(() => {
        const el = document.querySelector('#entryCanvas');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
}
async function shot(page, name) {
    const box = await clipBox(page);
    await page.screenshot(box ? { path: path.join(__dirname, name), clip: box }
                              : { path: path.join(__dirname, name) });
    console.log('  📸', name);
}
const seeScene = (page, id, ms, label) =>
    waitFor(page, readScene, s => s === id, { timeoutMs: ms, label }).catch(e => console.error('  ' + e.message));

const { browser, page, pageErrors } = await bootEditor({ viewport: { width: 1200, height: 820 } });
try {
    await loadFixture(page, FIXTURE);
} catch (e) {
    console.error('load error:', e.message);
    await browser.close();
    process.exit(3);
}
const t = createReporter();

await runFresh(page);
await page.waitForTimeout(900);
t.ok((await readScene(page)) === 'start', 'start 장면에서 시작');
await shot(page, 'casual_1_start.png');

// 시작 공 클릭 → start→match 전환 와이프를 연속 프레임으로 포착
await clickObject(page, 'start_ball');
const box = await clipBox(page);
for (let i = 0; i < 9; i++) {
    await page.screenshot({ path: path.join(__dirname, `casual_wipe_${i}.png`), clip: box });
    await page.waitForTimeout(70);
}
await seeScene(page, 'match', 4000, 'match');
t.ok((await readScene(page)) === 'match', 'match 장면 진입(전환 동작)');

// Q → game
await page.waitForTimeout(600);
await tapKey(page, 'Q');
await seeScene(page, 'game', 8000, 'game');
await page.waitForTimeout(1500);
t.ok((await readScene(page)) === 'game', 'game 장면 진입');
await shot(page, 'casual_2_game.png');

// 한 라운드 승 → mid → game 복귀 → 승 → result
await clickObject(page, 'btn_win');
await seeScene(page, 'mid', 4000, 'mid');
t.ok((await readScene(page)) === 'mid', '라운드 승 → 중간결과');
await shot(page, 'casual_3_mid.png');
await seeScene(page, 'game', 7000, 'game(복귀)');
await page.waitForTimeout(1500);
await clickObject(page, 'btn_win');
await seeScene(page, 'result', 7000, 'result');
t.ok((await getVar(page, '결과')) == 1, '2승 → 최종 승리');
await page.waitForTimeout(1100);
await shot(page, 'casual_4_result_win.png');

t.ok(pageErrors.length === 0, `페이지 에러 없음 (got ${pageErrors.length})`);
if (pageErrors.length) console.log('  errors:', pageErrors.slice(0, 4));

await browser.close();
process.exit(t.summary());
