#!/usr/bin/env node
// 1:1 온라인 매칭 UI — 부팅 + 로드 + 전체 플로우(중간결과 포함) 런타임 검증.
//
// 시나리오:
//   공통: 로드 → ▶ → 시작 공 클릭(→match) → Q(→입장) → 완료(→game)
//   매 라운드: [승리/패배] → 중간결과(점수 +1 + 블럭 쌓임) → 게임 복귀(2승이면 최종결과)
//   A 승리: 나의 승리 ×2 (각 라운드 mid 경유) → 최종 승리 + 컨페티
//   B 이탈: [상대가 떠남] → 반투명 막 → 부전승(승리)  (mid 우회, 바로 결과)
//   C 패배: 상대 승리 ×2 → 최종 패배
//   각 결과 후 [다시 하기] → start.
//
// 사전 조건: node server.js (또는 npm start) 로 http://localhost:3000 기동.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from '../../tools/lib/editor-harness.mjs';
import {
    runFresh, getVar, clickObject, tapKey, waitFor, waitForVar, createReporter,
} from '../../tools/lib/verify-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE   = path.resolve(__dirname, 'online-match_006.ent');

const readScene = (page) =>
    page.evaluate(() => { try { return Entry.scene.selectedScene.id; } catch { return null; } });

async function shot(page, name) {
    const box = await page.evaluate(() => {
        const el = document.querySelector('#entryCanvas');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    await page.screenshot(box ? { path: path.join(__dirname, name), clip: box }
                              : { path: path.join(__dirname, name) });
    console.log('  📸', name);
}

const seeScene = (page, id, ms, label) =>
    waitFor(page, readScene, s => s === id, { timeoutMs: ms, label }).catch(e => console.error('  ' + e.message));

// start → game (시작 공 클릭 → match → Q → game) + 버튼 정착 대기
async function gotoGame(page) {
    await clickObject(page, 'start_ball');
    await seeScene(page, 'match', 4000, 'match');
    await page.waitForTimeout(500);
    await tapKey(page, 'Q');
    await seeScene(page, 'game', 8000, 'game');
    await page.waitForTimeout(1500);
}

const { browser, page, pageErrors } = await bootEditor({ viewport: { width: 1200, height: 820 } });
try {
    await loadFixture(page, FIXTURE);
} catch (e) {
    console.error('load error:', e.message);
    await browser.close();
    process.exit(3);
}
const t = createReporter();

// ── 공통 진입: start → game ────────────────────────────────
await runFresh(page);
await page.waitForTimeout(800);
t.ok((await readScene(page)) === 'start', 'start 장면에서 시작');
await shot(page, 'verify_1_start.png');
await clickObject(page, 'start_ball');
await seeScene(page, 'match', 4000, 'match');
await page.waitForTimeout(800);
await shot(page, 'verify_2_searching.png');
await tapKey(page, 'Q');
await waitForVar(page, '단계', v => v >= 1, { timeoutMs: 4000 }).catch(e => console.error('  ' + e.message));
await page.waitForTimeout(700);
await shot(page, 'verify_3_entering.png');
await seeScene(page, 'game', 8000, 'game');
await page.waitForTimeout(1500);
t.ok((await readScene(page)) === 'game', 'game 장면 진입(버튼 노출)');
await shot(page, 'verify_4_game.png');

// ── A) 승리: 나의 승리 ×2, 각 라운드 mid 경유 ──────────────
await clickObject(page, 'btn_win');
await seeScene(page, 'mid', 4000, 'mid(라운드1)');
t.ok((await readScene(page)) === 'mid', '1라운드 승 → 중간결과 진입');
t.ok((await getVar(page, '내점수')) == 1, '중간결과: 내점수 1');
await page.waitForTimeout(800);     // 숫자 틱 + 블럭 낙하
await shot(page, 'verify_5_mid_round1.png');
await seeScene(page, 'game', 7000, 'game(복귀)');
t.ok((await readScene(page)) === 'game', '중간결과 → 게임 복귀');
await page.waitForTimeout(1500);

await clickObject(page, 'btn_win');
await seeScene(page, 'mid', 4000, 'mid(라운드2)');
t.ok((await getVar(page, '내점수')) == 2, '중간결과: 내점수 2(경기 종료)');
await page.waitForTimeout(900);
await shot(page, 'verify_6_mid_round2.png');
await seeScene(page, 'result', 6000, 'result(win)');
t.ok((await getVar(page, '결과')) == 1, '2승 → 최종 결과=승리');
await page.waitForTimeout(1100);
await shot(page, 'verify_7_result_win.png');
await clickObject(page, 'replay_btn');
await seeScene(page, 'start', 4000, 'start(replay)');
t.ok((await readScene(page)) === 'start', '다시 하기 → 시작 복귀');
await page.waitForTimeout(400);

// ── B) 상대 이탈 (mid 우회) ────────────────────────────────
await gotoGame(page);
await clickObject(page, 'btn_leave');
await page.waitForTimeout(450);
t.ok((await getVar(page, '잠금')) == 1, '상대 이탈 → 잠금=1(조작 차단)');
await shot(page, 'verify_8_opponent_left.png');
await seeScene(page, 'result', 6000, 'result(forfeit)');
t.ok((await getVar(page, '결과')) == 1 && (await getVar(page, '부전승')) == 1, '상대 이탈 → 부전승=승리');
await page.waitForTimeout(900);
await shot(page, 'verify_9_result_forfeit.png');
await clickObject(page, 'replay_btn');
await seeScene(page, 'start', 4000, 'start');
await page.waitForTimeout(400);

// ── C) 패배: 상대 승리 ×2 ──────────────────────────────────
await gotoGame(page);
await clickObject(page, 'btn_lose');
await seeScene(page, 'mid', 4000, 'mid(상대1)');
t.ok((await getVar(page, '상대점수')) == 1, '상대 1라운드 승 → 상대점수 1');
await seeScene(page, 'game', 7000, 'game(복귀)');
await page.waitForTimeout(1500);
await clickObject(page, 'btn_lose');
await seeScene(page, 'mid', 4000, 'mid(상대2)');
t.ok((await getVar(page, '상대점수')) == 2, '상대점수 2(경기 종료)');
await seeScene(page, 'result', 6000, 'result(lose)');
t.ok((await getVar(page, '결과')) == 0, '상대 2승 → 최종 결과=패배');
await page.waitForTimeout(1000);
await shot(page, 'verify_10_result_lose.png');

// ── 페이지 에러 0 ──────────────────────────────────────────
t.ok(pageErrors.length === 0, `페이지 에러 없음 (got ${pageErrors.length})`);
if (pageErrors.length) console.log('  errors:', pageErrors.slice(0, 4));

await browser.close();
process.exit(t.summary());
