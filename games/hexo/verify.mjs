#!/usr/bin/env node
// 육각형 육목 — 런타임 검증 (무한 판 + 로컬 대국 + 온라인 경로)
//
// 시나리오
//   1. 로비 — 확장이 없으므로($확장프로그램=0) 온라인 버튼이 "(잠김)" 상태
//   2. [로컬 플레이] → 대국 장면, 오프닝대로 중앙(0,0)에 노랑 1개
//   3. 커서 이동 — ←→ 는 q ±1, ↑↓ 는 화면상 곧게 위아래(축좌표에선 홀짝 지그재그)
//   4. **무한 스크롤** — 화면 끝까지 가면 뷰가 따라오고 돌이 반대로 밀린다.
//      더 가면 중앙 돌이 화면 밖으로 나가고, 돌아오면 다시 나타난다.
//   5. E 축 6목 승리 → 결과
//   6. 재시작 + r 축 6목 (다른 축도 같은 규칙으로 판정되는지)
//   7. 온라인 경로 — 확장 예약 값만 흉내내 슬롯 분기·후공 대기·상대 착수 렌더·이탈,
//      그리고 **상대가 이겼을 때 내 화면도 결과로 넘어가는지**
//
// 여기서 확인할 수 없는 것: 확장의 실제 후킹과 WebSocket 왕복 → 실사이트에서만.
//
// 사전 조건: npm start (또는 run-all-verify 가 서버 자동 기동).

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from '../../tools/lib/editor-harness.mjs';
import {
    runFresh, waitFor, waitForVar, createReporter,
    getVar, setVar, getList, clickObject, tapKey,
} from '../../tools/lib/verify-harness.mjs';
import { hexLayout, hexBoard } from '../../tools/lib/sprite-gen.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, 'hexo_009.ent');

// spec 과 같은 기하 — 런타임 블록이 만든 좌표를 여기서 다시 계산해 대조한다.
const VIEW_COLS = 13, VIEW_ROWS = 11, SIZE = 13, BOARD_Y = -5;
const L = hexLayout(VIEW_COLS, VIEW_ROWS, SIZE);
const PIC = hexBoard(VIEW_COLS, VIEW_ROWS, SIZE);
const ORIGIN_X = -PIC.dimension.width / 2 + L.cx((VIEW_ROWS + 1) / 2, (VIEW_COLS + 1) / 2);
const ORIGIN_Y = BOARD_Y + PIC.dimension.height / 2 - L.cy((VIEW_ROWS + 1) / 2);
const screenOf = (q, r, vq, vr) => [
    ORIGIN_X + L.W * ((q - vq) + (r - vr) / 2),
    ORIGIN_Y - L.RH * (r - vr),
];

// 착수 기록 인코딩 (spec 과 동일)
const KOFF = 512, KSPAN = 1024;
const encode = (q, r, col) => ((q + KOFF) * KSPAN + (r + KOFF)) * 10 + col;

const { browser, page, pageErrors } = await bootEditor({ viewport: { width: 1200, height: 800 } });
try {
    await loadFixture(page, FIXTURE);
} catch (e) {
    console.error('load error:', e.message);
    await browser.close();
    process.exit(3);
}

const t = createReporter();

const sceneId = () => page.evaluate(() => Entry.scene.selectedScene && Entry.scene.selectedScene.id);
const textOf = (id) => page.evaluate((oid) => {
    const o = Entry.container.getAllObjects().find(x => x.id === oid);
    return o && o.entity ? o.entity.getText() : null;
}, id);
const visibleOf = (id) => page.evaluate((oid) => {
    const o = Entry.container.getAllObjects().find(x => x.id === oid);
    return o && o.entity ? !!o.entity.getVisible() : null;
}, id);
const stoneClones = () => page.evaluate(() => {
    const o = Entry.container.getAllObjects().find(x => x.id === 'stone');
    return o ? o.getClonedEntities().map(e => ({ x: +e.getX().toFixed(2), y: +e.getY().toFixed(2) })) : [];
});
const cursorPos = () => page.evaluate(() => {
    const o = Entry.container.getAllObjects().find(x => x.id === 'cursor');
    return { x: +o.entity.getX().toFixed(2), y: +o.entity.getY().toFixed(2) };
});
const moves = () => getList(page, '$수');
const setList = (name, arr) => page.evaluate(({ n, a }) => {
    const l = Entry.variableContainer.lists_.find(x => x.name_ === n);
    l.array_ = a.map(v => ({ data: v }));
}, { n: name, a: arr });

async function shot(name) {
    const box = await page.evaluate(() => {
        const el = document.querySelector('#entryCanvas');
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
    });
    await page.screenshot(box
        ? { path: path.join(__dirname, name), clip: box }
        : { path: path.join(__dirname, name) });
    console.log('  📸', name);
}

// 착수는 스페이스를 **누른 순간 1회**만 먹는다(연타 방지). 기록이 늘어난 시점에는 아직
// 키를 누르고 있어, 곧바로 다음 탭을 보내면 그 수가 통째로 무시된다.
async function releaseSpace() {
    await waitForVar(page, '누름유지', v => +v === 0, {
        timeoutMs: 3000, intervalMs: 30, label: '스페이스 해제 대기',
    });
}

async function play(q, r, expectCount) {
    await releaseSpace();
    await setVar(page, '커서q', q);
    await setVar(page, '커서r', r);
    await tapKey(page, '32');
    await waitFor(page, () => moves().then(m => m.length), v => v === expectCount, {
        timeoutMs: 3000, intervalMs: 40, label: `(${q},${r}) 착수 → 기록 ${expectCount}`,
    });
}

// 방향키 탭. 이동 뒤 0.11초 대기가 걸려 있어 그 사이 들어온 짧은 탭은 씹힌다.
async function tapMove(code) {
    await page.waitForTimeout(200);
    await tapKey(page, code);
}

// ── 1. 로비 ──────────────────────────────────────────────────────
console.log('\n=== 1. 로비 ===');
await runFresh(page);

t.ok(await sceneId() === 'lobby', '시작 장면은 로비');
await waitFor(page, () => visibleOf('btnonlocked'), v => v === true,
    { timeoutMs: 4000, intervalMs: 100, label: '잠김 버튼 노출' }
).catch(e => console.error('  ' + e.message));
t.ok(await visibleOf('btnonlocked') === true, '확장이 없으면 잠김 버튼이 보인다');
t.ok(await visibleOf('btnonline') === false, '확장이 없으면 열림 버튼은 숨겨진다');

// ── 2. 로컬 대국 시작 ────────────────────────────────────────────
console.log('\n=== 2. 로컬 대국 시작 ===');
await clickObject(page, 'btnlocal');
await waitFor(page, sceneId, v => v === 'game', { timeoutMs: 4000, label: '대국 장면 진입' })
    .catch(e => console.error('  ' + e.message));
await waitForVar(page, '상태', v => +v === 1, { timeoutMs: 4000, label: '대국 준비' })
    .catch(e => console.error('  ' + e.message));

const m0 = await moves();
t.ok(m0.length === 1, '오프닝 — 기록된 돌은 중앙 1개뿐');
t.ok(m0[0] === encode(0, 0, 1), '중앙(0,0)이 노랑으로 기록됨');
t.ok(+(await getVar(page, '$턴')) === 2, '중앙 착수 후 차례는 파랑(후공)');

const c0 = await stoneClones();
t.ok(c0.length === 1, '중앙 돌 클론 1개');
if (c0.length) {
    const [ex, ey] = screenOf(0, 0, 0, 0);
    const d = Math.hypot(c0[0].x - ex, c0[0].y - ey);
    console.log(`  중앙 돌 ${JSON.stringify(c0[0])} vs 계산 (${ex.toFixed(2)}, ${ey.toFixed(2)})`);
    t.ok(d < 0.6, '돌이 계산한 칸 좌표에 정확히 앉는다');
}
await shot('shot_2_board.png');

// ── 3. 커서 이동 (축좌표 지그재그) ───────────────────────────────
console.log('\n=== 3. 커서 이동 ===');
await setVar(page, '커서q', 0);
await setVar(page, '커서r', 0);

await tapMove('39');
await waitForVar(page, '커서q', v => +v === 1, { timeoutMs: 2000, label: '→' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '커서q')) === 1, '오른쪽 = q +1');

await tapMove('37');
await waitForVar(page, '커서q', v => +v === 0, { timeoutMs: 2000, label: '←' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '커서q')) === 0, '왼쪽 = q -1');

// r 이 짝수면 ↑ 는 NE(q+1, r-1) — 화면에서는 반 칸 오른쪽 위
const beforeUp = await cursorPos();
await tapMove('38');
await waitForVar(page, '커서r', v => +v === -1, { timeoutMs: 2000, label: '↑' })
    .catch(e => console.error('  ' + e.message));
await page.waitForTimeout(250);
const afterUp = await cursorPos();
t.ok(+(await getVar(page, '커서q')) === 1 && +(await getVar(page, '커서r')) === -1,
    '위쪽 = 짝수 행에서 NE (q+1, r-1)');
t.ok(afterUp.y > beforeUp.y, '↑ 는 화면에서 실제로 위로 간다');

// 다시 ↓ 하면 제자리 — 홀짝 지그재그가 왕복해야 커서가 곧게 오르내린다
await tapMove('40');
await waitForVar(page, '커서r', v => +v === 0, { timeoutMs: 2000, label: '↓' })
    .catch(e => console.error('  ' + e.message));
await page.waitForTimeout(250);
const backDown = await cursorPos();
t.ok(+(await getVar(page, '커서q')) === 0 && +(await getVar(page, '커서r')) === 0,
    '아래쪽으로 되돌리면 정확히 제자리 (지그재그 왕복)');
t.ok(Math.hypot(backDown.x - beforeUp.x, backDown.y - beforeUp.y) < 0.6,
    '왕복 후 커서 화면 위치도 원래대로');

// ── 4. 무한 스크롤 ───────────────────────────────────────────────
console.log('\n=== 4. 무한 스크롤 ===');
t.ok(+(await getVar(page, '뷰q')) === 0 && +(await getVar(page, '뷰r')) === 0, '시작 뷰는 원점');

const centreBefore = (await stoneClones())[0];
for (let i = 0; i < 5; i++) await tapMove('39');
await page.waitForTimeout(300);
const vq5 = +(await getVar(page, '뷰q'));
const centreAfter = (await stoneClones())[0];
console.log(`  → 5칸: 커서q=${await getVar(page, '커서q')} 뷰q=${vq5} 중앙돌 x ${centreBefore.x} → ${centreAfter ? centreAfter.x : '(화면 밖)'}`);
t.ok(vq5 >= 1, '화면 끝에 닿으면 뷰가 따라온다 (뷰q 증가)');
t.ok(centreAfter && centreAfter.x < centreBefore.x - 20, '이미 놓인 돌이 반대 방향으로 밀린다');

// 더 가면 중앙 돌이 화면 밖으로 — 판이 유한하지 않다는 증거
for (let i = 0; i < 12; i++) await tapMove('39');
await page.waitForTimeout(400);
const farVq = +(await getVar(page, '뷰q'));
const farClones = await stoneClones();
const farCursor = await cursorPos();
console.log(`  → 17칸: 커서q=${await getVar(page, '커서q')} 뷰q=${farVq} 클론=${farClones.length} 커서=${JSON.stringify(farCursor)}`);
t.ok(farVq > vq5, '계속 가면 뷰도 계속 따라온다 (막히지 않는다)');
t.ok(farClones.length === 0, '멀리 가면 중앙 돌은 화면 밖으로 나가 그려지지 않는다');
t.ok(Math.abs(farCursor.x) < 150 && Math.abs(farCursor.y - BOARD_Y) < 115,
    '커서는 아무리 가도 판 안에 머문다');
await shot('shot_3_scrolled.png');

// 돌아오면 다시 보인다
for (let i = 0; i < 17; i++) await tapMove('37');
await page.waitForTimeout(400);
t.ok(+(await getVar(page, '커서q')) === 0, '왼쪽으로 같은 횟수만큼 돌아오면 커서 q=0');
t.ok((await stoneClones()).length === 1, '돌아오면 중앙 돌이 다시 그려진다');

// ── 5. E 축 6목 ──────────────────────────────────────────────────
console.log('\n=== 5. E 축 6목 ===');
// 파랑은 승부와 무관한 자리에 2칸 간격으로 흩어 둔다(파랑이 먼저 6목을 만들면 안 된다).
const GAME1 = [
    [0, -3, 2], [2, -3, 3],       // 파랑
    [1, 0, 4], [2, 0, 5],         // 노랑
    [0, 3, 6], [2, 3, 7],         // 파랑
    [-1, 0, 8], [-2, 0, 9],       // 노랑
    [4, -3, 10], [4, 3, 11],      // 파랑
    [-3, 0, 12],                  // 노랑 — 승리수
];
try {
    for (const [q, r, n] of GAME1) await play(q, r, n);
} catch (e) {
    console.error('  ' + e.message);
}

await waitForVar(page, '$승자', v => +v === 1, { timeoutMs: 3000, label: 'E 축 승리 판정' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '$승자')) === 1, 'E 축 6연속 → 노랑 승리');

const mEnd = await moves();
const line1 = [-3, -2, -1, 0, 1, 2].map(q => mEnd.includes(encode(q, 0, 1)));
console.log('  E 축 (-3..2, r=0):', JSON.stringify(line1));
t.ok(line1.every(Boolean), 'E 축 6칸이 모두 노랑으로 기록됨');
await shot('shot_4_win_e.png');

await waitFor(page, sceneId, v => v === 'result', { timeoutMs: 5000, label: '결과 전환' })
    .catch(e => console.error('  ' + e.message));
t.ok(await sceneId() === 'result', '승부 후 결과 장면');
t.ok(String(await textOf('resulttext')).includes('노랑 승리'), '결과 문구 = 노랑 승리');

// ── 6. 재시작 + r 축 6목 ─────────────────────────────────────────
console.log('\n=== 6. 재시작 + r 축 6목 ===');
await clickObject(page, 'btnagain');
await waitFor(page, sceneId, v => v === 'lobby', { timeoutMs: 4000, label: '로비 복귀' })
    .catch(e => console.error('  ' + e.message));
await clickObject(page, 'btnlocal');
await waitFor(page, sceneId, v => v === 'game', { timeoutMs: 4000, label: '재대국' })
    .catch(e => console.error('  ' + e.message));
await waitFor(page, () => moves().then(m => m.length), v => v === 1,
    { timeoutMs: 4000, intervalMs: 60, label: '기록 초기화' })
    .catch(e => console.error('  ' + e.message));

t.ok((await moves()).length === 1, '재시작 시 착수 기록이 비워지고 중앙 1개만 남음');
t.ok((await stoneClones()).length === 1, '재시작 시 이전 대국의 돌 클론이 지워짐');
t.ok(+(await getVar(page, '뷰q')) === 0 && +(await getVar(page, '뷰r')) === 0, '재시작 시 뷰도 원점');

// 회귀 가드 — 지난 판의 `$승자`/`상태` 를 물려받아 결과 장면으로 튀면 안 된다(1.3초 지연).
await page.waitForTimeout(2200);
t.ok(await sceneId() === 'game', '재진입 후 2.2초가 지나도 대국 장면에 머문다');

const GAME2 = [
    [-4, -2, 2], [-4, 0, 3],      // 파랑
    [0, -2, 4], [0, -1, 5],       // 노랑 (r 축)
    [-4, 2, 6], [4, -2, 7],       // 파랑
    [0, 1, 8], [0, 2, 9],         // 노랑
    [4, 0, 10], [4, 2, 11],       // 파랑
    [0, 3, 12],                   // 노랑 — 승리수
];
try {
    for (const [q, r, n] of GAME2) await play(q, r, n);
} catch (e) {
    console.error('  ' + e.message);
}

await waitForVar(page, '$승자', v => +v === 1, { timeoutMs: 3000, label: 'r 축 승리 판정' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '$승자')) === 1, 'r 축 6연속 → 노랑 승리 (다른 축도 동일 규칙)');
const m2 = await moves();
t.ok([-2, -1, 0, 1, 2, 3].every(r => m2.includes(encode(0, r, 1))), 'r 축 6칸이 모두 노랑');
await shot('shot_5_win_r.png');

// ── 7. 온라인 경로 (확장 예약 값만 흉내) ─────────────────────────
console.log('');
console.log('=== 7. 온라인 경로 ===');

async function backToLobby() {
    await waitFor(page, sceneId, v => v === 'result', { timeoutMs: 6000, label: '결과 장면 대기' })
        .catch(e => console.error('  ' + e.message));
    await clickObject(page, 'btnagain');
    await waitFor(page, sceneId, v => v === 'lobby', { timeoutMs: 4000, label: '로비 복귀' })
        .catch(e => console.error('  ' + e.message));
}
await backToLobby();

await setVar(page, '$확장프로그램', 1);
await waitFor(page, () => visibleOf('btnonline'), v => v === true,
    { timeoutMs: 3000, intervalMs: 60, label: '열림 버튼' })
    .catch(e => console.error('  ' + e.message));
t.ok(await visibleOf('btnonline') === true, '$확장프로그램 ≠ 0 이면 온라인 버튼이 열린다');

// 취소 = 무한 대기 탈출구
await clickObject(page, 'btnonline');
await waitFor(page, sceneId, v => v === 'waiting', { timeoutMs: 4000, label: '대기 장면' })
    .catch(e => console.error('  ' + e.message));
t.ok(await sceneId() === 'waiting', '[온라인 플레이] → 대기 장면');
await clickObject(page, 'btncancel');
await waitFor(page, sceneId, v => v === 'lobby', { timeoutMs: 4000, label: '취소' })
    .catch(e => console.error('  ' + e.message));
t.ok(await sceneId() === 'lobby', '취소하면 로비로 돌아온다');

// 후공(슬롯 2) — 판을 세우지 않고 상대가 세운 판을 받아 그린다
await setVar(page, '$유저번호', 0);
await setList('$수', []);
await clickObject(page, 'btnonline');
await waitFor(page, sceneId, v => v === 'waiting', { timeoutMs: 4000, label: '대기' })
    .catch(e => console.error('  ' + e.message));
await setVar(page, '$유저번호', 2);
await waitFor(page, sceneId, v => v === 'game', { timeoutMs: 4000, label: '슬롯2 → 대국' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '내슬롯')) === 2, '$유저번호 2 → 내슬롯 2 (후공)');

await page.waitForTimeout(700);
t.ok(+(await getVar(page, '상태')) === 0, '후공은 선공이 판을 세울 때까지 시작하지 않는다');
t.ok((await moves()).length === 0, '후공은 착수 기록을 건드리지 않는다');

// 선공이 중앙에 둔 것을 흉내
await setList('$수', [encode(0, 0, 1)]);
await setVar(page, '$턴', 2);
await setVar(page, '$남은돌', 2);
await waitForVar(page, '상태', v => +v === 1, { timeoutMs: 4000, label: '후공 시작' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '상태')) === 1, '선공의 판이 도착하면 후공이 시작된다');
t.ok((await stoneClones()).length === 1, '상대가 놓은 돌이 후공 화면에 그려진다');

// 상대가 한 턴에 2개를 둔 것을 흉내 — 한 프레임에 만든 클론이 겹치면 안 된다
await setList('$수', [encode(0, 0, 1), encode(2, -1, 1), encode(-2, 2, 1)]);
await waitFor(page, () => stoneClones().then(a => a.length), v => v === 3,
    { timeoutMs: 3000, intervalMs: 60, label: '상대 착수 렌더' })
    .catch(e => console.error('  ' + e.message));
const three = await stoneClones();
const spots = new Set(three.map(c => `${c.x},${c.y}`));
console.log('  클론 좌표:', JSON.stringify([...spots]));
t.ok(three.length === 3, '상대가 놓은 돌이 모두 그려진다');
t.ok(spots.size === 3, '한 번에 도착한 돌들이 각자 제 칸에 (겹침 없음)');
await shot('shot_6_online_guest.png');

// ★ 상대가 이겼을 때 — 내 화면도 결과로 넘어가야 한다
console.log('  상대(슬롯1) 승리 시뮬레이션');
await setVar(page, '$승자', 1);
await waitForVar(page, '상태', v => +v === 2, { timeoutMs: 3000, label: '패자 입력 잠금' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '상태')) === 2, '상대가 이기면 내 쪽 입력도 잠긴다');
await waitFor(page, sceneId, v => v === 'result', { timeoutMs: 6000, label: '패자 결과 전환' })
    .catch(e => console.error('  ' + e.message));
t.ok(await sceneId() === 'result', '상대가 이겨도 결과 장면으로 넘어간다');
const lostLabel = await waitFor(page, () => textOf('resulttext'),
    v => typeof v === 'string' && v.trim().length > 1,
    { timeoutMs: 3000, intervalMs: 80, label: '패배 문구' }).catch(() => '');
console.log('  결과 문구:', JSON.stringify(lostLabel));
t.ok(String(lostLabel).includes('패배'), '내 슬롯 기준으로 "패배" 표시');
await shot('shot_7_online_lose.png');

// 이탈 부전승
await backToLobby();
await setVar(page, '$확장프로그램', 1);
await setVar(page, '$유저번호', 0);
await setList('$수', []);
await clickObject(page, 'btnonline');
await waitFor(page, sceneId, v => v === 'waiting', { timeoutMs: 4000, label: '대기' })
    .catch(e => console.error('  ' + e.message));
await setVar(page, '$유저번호', 2);
await waitFor(page, sceneId, v => v === 'game', { timeoutMs: 4000, label: '대국' })
    .catch(e => console.error('  ' + e.message));
await setList('$수', [encode(0, 0, 1)]);
await waitForVar(page, '상태', v => +v === 1, { timeoutMs: 4000, label: '시작' })
    .catch(e => console.error('  ' + e.message));

await setList('$유저연결상태', ['끊김', '연결']);   // 슬롯1(상대) 끊김
await waitForVar(page, '$승자', v => +v === 2, { timeoutMs: 4000, label: '이탈 감지' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '$승자')) === 2, '상대 슬롯이 "끊김" 이면 내가 승리');
t.ok(+(await getVar(page, '이탈승')) === 1, '이탈승으로 표시');

// ── 8. 페이지 에러 ───────────────────────────────────────────────
t.ok(pageErrors.length === 0, `페이지 에러 없음 (got ${pageErrors.length})`);
if (pageErrors.length) console.log('  errors:', pageErrors.slice(0, 5));

await browser.close();
process.exit(t.summary());
