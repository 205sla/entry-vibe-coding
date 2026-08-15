#!/usr/bin/env node
// 육각형 육목 — 런타임 검증 (로컬 대국 + 온라인 경로)
//
// 시나리오
//   1. 로비 — 확장이 없으므로($확장프로그램=0) 온라인 버튼이 "(잠김)" 상태
//   2. [로컬 플레이] 클릭 → 대국 장면, 오프닝 규칙대로 중앙에 노랑 1개 자동 착수
//   3. 방향키로 커서가 한 칸씩 움직이고 판 가장자리에서 멈춘다
//   4. 가로축 6목으로 승부 (착수는 커서 세팅 + 스페이스 탭 = 실제 입력 경로 그대로)
//   5. 결과 장면 "노랑 승리!"
//   6. 재시작 → **대각축(SE) 6목** — odd-r 패리티 보정은 여기서만 검증된다
//   7. 온라인 경로 — 확장이 쓰는 예약 값($확장프로그램·$유저번호·$유저연결상태)만 흉내내
//      슬롯 분기 · 후공 대기 · **상대 착수 렌더** · 이탈 부전승까지 서버 없이 확인
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

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, 'hexo_007.ent');

const COLS = 13, ROWS = 11, CELLS = COLS * ROWS;
const IDX = (r, c) => (r - 1) * COLS + c;
const CENTER = IDX(6, 7);   // 72

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
const stoneClones = () => page.evaluate(() => {
    const o = Entry.container.getAllObjects().find(x => x.id === 'stone');
    return o ? o.getClonedEntities().map(e => ({ x: +e.getX().toFixed(2), y: +e.getY().toFixed(2) })) : [];
});

// 무대(캔버스)만 잘라 저장 — 사람 눈으로 확인할 근거.
async function shot(name) {
    const box = await page.evaluate(() => {
        const el = document.querySelector('#entryCanvas');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    await page.screenshot(box
        ? { path: path.join(__dirname, name), clip: box }
        : { path: path.join(__dirname, name) });
    console.log('  📸', name);
}

// 게임의 실제 입력 경로로 한 수 둔다 — 커서를 옮기고 스페이스를 탭한다.
// (방향키를 세는 대신 커서 변수를 직접 놓는 이유: 이동은 3번에서 따로 검증했고,
//  여기서 검증하려는 건 착수·턴·승리 규칙이다.)
//
// ⚠️ 착수는 스페이스 **누른 순간 1회**만 먹는다(연타 방지 에지 검출). `놓인수` 는 아직
// 스페이스를 누르고 있는 도중에 올라가므로, 곧바로 다음 탭을 보내면 `누름유지` 가 1 이라
// 그 수가 통째로 무시된다. 사람 손가락은 이 간격이 자연히 벌어지지만 자동 검증은
// 플래그가 풀릴 때까지 명시적으로 기다려야 한다.
async function releaseSpace() {
    await waitForVar(page, '누름유지', v => +v === 0, {
        timeoutMs: 3000, intervalMs: 30, label: '스페이스 해제 대기',
    });
}

async function play(r, c, expectPlaced) {
    await releaseSpace();
    await setVar(page, '커서행', r);
    await setVar(page, '커서열', c);
    await tapKey(page, '32');
    await waitForVar(page, '놓인수', v => +v === expectPlaced, {
        timeoutMs: 3000, label: `(${r},${c}) 착수 → 놓인수 ${expectPlaced}`,
    });
}

// 방향키 탭. 이동 뒤 0.11초 대기가 걸려 있어 그 사이 들어온 짧은 탭은 씹힌다 —
// 대기가 끝나도록 여유를 두고 누른다.
async function tapMove(code) {
    await page.waitForTimeout(200);
    await tapKey(page, code);
}

// ── 1. 로비 ──────────────────────────────────────────────────────
console.log('\n=== 1. 로비 ===');
await runFresh(page);

t.ok(await sceneId() === 'lobby', '시작 장면은 로비');

// 잠김/열림은 버튼 오브젝트 2개의 show/hide 로 표현한다(글상자에 효과 블록을 쓸 수 없다).
const visibleOf = (id) => page.evaluate((oid) => {
    const o = Entry.container.getAllObjects().find(x => x.id === oid);
    return o && o.entity ? !!o.entity.getVisible() : null;
}, id);

await waitFor(page, () => visibleOf('btnonlocked'), v => v === true,
    { timeoutMs: 4000, intervalMs: 100, label: '잠김 버튼 노출' }
).catch(e => console.error('  ' + e.message));

const lockedLabel = await textOf('btnonlocked');
console.log('  노출 중인 온라인 버튼:', JSON.stringify(lockedLabel),
    '| 열림 버튼 보임 =', await visibleOf('btnonline'));
t.ok(await visibleOf('btnonlocked') === true, '확장이 없으면 잠김 버튼이 보인다');
t.ok(await visibleOf('btnonline') === false, '확장이 없으면 열림 버튼은 숨겨진다');
t.ok(String(lockedLabel).includes('잠김'), '잠김 버튼 라벨에 "잠김" 표시');
await shot('shot_1_lobby.png');
t.ok(+(await getVar(page, '$확장프로그램')) === 0, '$확장프로그램 = 0 (확장 미설치)');

// ── 2. 로컬 대국 시작 ────────────────────────────────────────────
console.log('\n=== 2. 로컬 대국 시작 ===');
await clickObject(page, 'btnlocal');
await waitFor(page, sceneId, v => v === 'game', { timeoutMs: 4000, label: '대국 장면 진입' })
    .catch(e => console.error('  ' + e.message));
t.ok(await sceneId() === 'game', '[로컬 플레이] → 대국 장면');

await waitForVar(page, '상태', v => +v === 1, { timeoutMs: 4000, label: '대국 준비 완료' })
    .catch(e => console.error('  ' + e.message));

const board0 = await getList(page, '$보드');
t.ok(Array.isArray(board0) && board0.length === CELLS, `$보드 = ${CELLS}칸`);
t.ok(board0[CENTER - 1] === 1, '오프닝 — 중앙(6,7)에 노랑 1개 자동 착수');
t.ok(board0.filter(v => v !== 0).length === 1, '시작 시 판 위의 돌은 중앙 1개뿐');
t.ok(+(await getVar(page, '$턴')) === 2, '중앙 착수 후 차례는 파랑(후공)');
t.ok(+(await getVar(page, '$남은돌')) === 2, '후공부터 매 턴 2개');

const clones0 = await stoneClones();
t.ok(clones0.length === 1, '중앙 돌 클론 1개 생성');
if (clones0.length) {
    // 판 기하 확인 — (6,7) 은 짝수 행이라 반 칸 왼쪽. 칸X/칸Y 표와 일치해야 한다.
    const px = (await getList(page, '칸X'))[CENTER - 1];
    const py = (await getList(page, '칸Y'))[CENTER - 1];
    const d = Math.hypot(clones0[0].x - px, clones0[0].y - py);
    console.log(`  중앙 돌 위치 ${JSON.stringify(clones0[0])} vs 표 (${px}, ${py})`);
    t.ok(d < 0.6, '돌이 칸 좌표표와 같은 자리에 놓임');
}

// HUD 는 0.1초마다 갱신된다 — 초기값(노랑/1)이 아니라 오프닝 뒤 상태를 보여줘야 한다.
const hud0 = await waitFor(page, () => textOf('hudturn'),
    v => typeof v === 'string' && v.includes('파랑'),
    { timeoutMs: 3000, intervalMs: 60, label: 'HUD 갱신' }
).catch(e => { console.error('  ' + e.message); return ''; });
console.log('  HUD:', JSON.stringify(hud0));
t.ok(hud0.includes('파랑 차례'), 'HUD 가 파랑 차례를 표시');
t.ok(hud0.includes('남은 돌 2'), 'HUD 가 남은 돌 2를 표시');

await shot('shot_2_board.png');

// ── 3. 커서 이동 ─────────────────────────────────────────────────
console.log('\n=== 3. 커서 이동 ===');
await setVar(page, '커서행', 6);
await setVar(page, '커서열', 7);

await tapMove('39');
await waitForVar(page, '커서열', v => +v === 8, { timeoutMs: 2000, label: '→ 한 칸' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '커서열')) === 8, '오른쪽 방향키 = 열 +1');

await tapMove('38');
await waitForVar(page, '커서행', v => +v === 5, { timeoutMs: 2000, label: '↑ 한 칸' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '커서행')) === 5, '위쪽 방향키 = 행 -1');

await tapMove('40');
await waitForVar(page, '커서행', v => +v === 6, { timeoutMs: 2000, label: '↓ 한 칸' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '커서행')) === 6, '아래쪽 방향키 = 행 +1');

await tapMove('37');
await waitForVar(page, '커서열', v => +v === 7, { timeoutMs: 2000, label: '← 한 칸' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '커서열')) === 7, '왼쪽 방향키 = 열 -1');

// 가장자리 클램프 — 판 밖으로 나가면 안 된다(리스트 범위 밖 접근 = 런타임 에러).
await setVar(page, '커서열', COLS);
await tapMove('39');
await page.waitForTimeout(300);
t.ok(+(await getVar(page, '커서열')) === COLS, `오른쪽 끝(${COLS}열)에서 멈춤`);

await setVar(page, '커서행', 1);
await tapMove('38');
await page.waitForTimeout(300);
t.ok(+(await getVar(page, '커서행')) === 1, '맨 윗행에서 멈춤');

await setVar(page, '커서행', ROWS);
await tapMove('40');
await page.waitForTimeout(300);
t.ok(+(await getVar(page, '커서행')) === ROWS, `맨 아랫행(${ROWS}행)에서 멈춤`);

// ── 4. 대국 — 노랑이 6행 가로로 6개 ──────────────────────────────
console.log('\n=== 4. 대국 진행 ===');
// 파랑은 승부와 무관한 자리에 흩어 둔다(파랑이 먼저 6목을 만들면 안 되므로 2칸 간격).
const MOVES = [
    [1, 1, 2], [1, 3, 3],        // 파랑
    [6, 8, 4], [6, 9, 5],        // 노랑
    [1, 5, 6], [11, 1, 7],       // 파랑
    [6, 10, 8], [6, 11, 9],      // 노랑
    [11, 3, 10], [11, 5, 11],    // 파랑
];
try {
    for (const [r, c, n] of MOVES) await play(r, c, n);
} catch (e) {
    console.error('  ' + e.message);
}

t.ok(+(await getVar(page, '$턴')) === 1, '여섯 수가 오간 뒤 차례는 노랑');
t.ok(+(await getVar(page, '$승자')) === 0, '아직 승부 안 남 (5개 연속까지는 승리 아님)');

// 승리수 — (6,12) 로 중앙 포함 가로 6연속 완성
console.log('  승리수 (6,12)');
try {
    await play(6, 12, 12);
} catch (e) {
    console.error('  ' + e.message);
}

await waitForVar(page, '$승자', v => +v === 1, { timeoutMs: 3000, label: '노랑 승리 판정' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '$승자')) === 1, '가로 6연속 → 노랑 승리');
t.ok(+(await getVar(page, '상태')) === 2, '승리와 함께 대국 종료 상태');

const boardEnd = await getList(page, '$보드');
const line = [7, 8, 9, 10, 11, 12].map(c => boardEnd[IDX(6, c) - 1]);
console.log('  6행 7~12열:', JSON.stringify(line));
t.ok(line.every(v => v === 1), '6행 7~12열이 모두 노랑');

await shot('shot_3_win.png');

const clonesEnd = await stoneClones();
t.ok(clonesEnd.length === +(await getVar(page, '놓인수')),
    `돌 클론 수 = 놓인수 (${clonesEnd.length})`);

// 승리 순간 나머지 한 수는 놓이지 않아야 한다 (턴 즉시 종료)
await releaseSpace().catch(() => {});
await setVar(page, '커서행', 3);
await setVar(page, '커서열', 3);
await tapKey(page, '32');
await page.waitForTimeout(400);
t.ok(+(await getVar(page, '놓인수')) === 12, '승부가 난 뒤에는 더 놓이지 않음');

// ── 5. 결과 장면 ─────────────────────────────────────────────────
console.log('\n=== 5. 결과 ===');
await waitFor(page, sceneId, v => v === 'result', { timeoutMs: 5000, label: '결과 장면 전환' })
    .catch(e => console.error('  ' + e.message));
t.ok(await sceneId() === 'result', '승부 후 결과 장면으로 전환');

const resultLabel = await waitFor(page, () => textOf('resulttext'),
    v => typeof v === 'string' && v.includes('승'),
    { timeoutMs: 3000, intervalMs: 100, label: '결과 문구' }
).catch(e => { console.error('  ' + e.message); return ''; });
console.log('  결과 문구:', JSON.stringify(resultLabel));
await shot('shot_4_result.png');
t.ok(resultLabel.includes('노랑 승리'), '결과 문구 = 노랑 승리');

// ── 6. 재시작 + 대각축 승리 ──────────────────────────────────────
// 가로축(E/W)은 행이 안 바뀌어 패리티 보정을 전혀 타지 않는다. odd-r 오프셋의
// 진짜 위험 구간은 SE/NW·SW/NE 라 대각축을 따로 확인한다.
// 중앙에서 SE 로 이어지는 줄: (6,7)→(7,7)→(8,8)→(9,8)→(10,9)→(11,9)
console.log('\n=== 6. 재시작 + 대각축(SE) 승리 ===');
await clickObject(page, 'btnagain');
await waitFor(page, sceneId, v => v === 'lobby', { timeoutMs: 4000, label: '로비 복귀' })
    .catch(e => console.error('  ' + e.message));
t.ok(await sceneId() === 'lobby', '[다시 하기] → 로비');

await clickObject(page, 'btnlocal');
await waitFor(page, sceneId, v => v === 'game', { timeoutMs: 4000, label: '재대국 진입' })
    .catch(e => console.error('  ' + e.message));
await waitForVar(page, '놓인수', v => +v === 1, { timeoutMs: 4000, label: '판 초기화' })
    .catch(e => console.error('  ' + e.message));

const board2 = await getList(page, '$보드');
t.ok(board2.filter(v => v !== 0).length === 1, '재시작 시 판이 비워지고 중앙 1개만 남음');
t.ok(+(await getVar(page, '$승자')) === 0, '재시작 시 승자 초기화');
t.ok((await stoneClones()).length === 1, '재시작 시 이전 대국의 돌 클론이 지워짐');

// 회귀 가드 — 재진입 직후 지난 판의 `$승자`/`상태` 를 물려받아 결과 장면으로 튀면 안 된다.
// (1.3초 뒤 전환이라 짧은 대국은 우연히 통과한다 → 넉넉히 기다려 확인한다.)
await page.waitForTimeout(2200);
t.ok(await sceneId() === 'game', '재진입 후 2.2초가 지나도 대국 장면에 머문다');
t.ok(+(await getVar(page, '$승자')) === 0, '재진입 후에도 승자는 0');

const DIAG = [
    [1, 1, 2], [1, 3, 3],        // 파랑
    [7, 7, 4], [8, 8, 5],        // 노랑 (SE 축)
    [1, 5, 6], [1, 7, 7],        // 파랑
    [9, 8, 8], [10, 9, 9],       // 노랑
    [1, 9, 10], [1, 11, 11],     // 파랑
    [11, 9, 12],                 // 노랑 — 승리수
];
try {
    for (const [r, c, n] of DIAG) await play(r, c, n);
} catch (e) {
    console.error('  ' + e.message);
}

await waitForVar(page, '$승자', v => +v === 1, { timeoutMs: 3000, label: '대각축 승리 판정' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '$승자')) === 1, 'SE 대각 6연속 → 노랑 승리 (패리티 보정 정상)');

const boardDiag = await getList(page, '$보드');
const diagLine = [[6, 7], [7, 7], [8, 8], [9, 8], [10, 9], [11, 9]]
    .map(([r, c]) => boardDiag[IDX(r, c) - 1]);
console.log('  SE 축 6칸:', JSON.stringify(diagLine));
await shot('shot_5_diagonal.png');
t.ok(diagLine.every(v => v === 1), 'SE 축 6칸이 모두 노랑');

// ── 7. 온라인 경로 (확장·서버 없이 예약 값만 흉내) ────────────────
// 확장은 `$확장프로그램`·`$유저번호`·`$유저연결상태` 를 작품에 써 주는 게 전부다.
// 그 값을 직접 넣으면 서버 없이도 슬롯 분기·후공 대기·상대 착수 렌더·이탈 처리를
// 그대로 검증할 수 있다. (실제 후킹과 WebSocket 왕복은 실사이트에서만 확인 가능.)
console.log('');
console.log('=== 7. 온라인 경로 (확장 값 시뮬레이션) ===');

const setList = (name, arr) => page.evaluate(({ n, a }) => {
    const l = Entry.variableContainer.lists_.find(x => x.name_ === n);
    l.array_ = a.map(v => ({ data: v }));
}, { n: name, a: arr });

// 결과 → 로비. 결과 장면이 **실제로 뜬 뒤에** 눌러야 한다 —
// 먼저 누르면 핸들러는 돌지만 1.3초 뒤 도착하는 startScene(결과)가 덮어쓴다.
async function backToLobby() {
    await waitFor(page, sceneId, v => v === 'result', { timeoutMs: 6000, label: '결과 장면 대기' })
        .catch(e => console.error('  ' + e.message));
    await clickObject(page, 'btnagain');
    await waitFor(page, sceneId, v => v === 'lobby', { timeoutMs: 4000, label: '로비 복귀' })
        .catch(e => console.error('  ' + e.message));
}
await backToLobby();

// 7a. 확장이 로드된 상태를 흉내 → 온라인 버튼이 열린다
await setVar(page, '$확장프로그램', 1);
await waitFor(page, () => visibleOf('btnonline'), v => v === true,
    { timeoutMs: 3000, intervalMs: 60, label: '열림 버튼 노출' })
    .catch(e => console.error('  ' + e.message));
t.ok(await visibleOf('btnonline') === true, '$확장프로그램 ≠ 0 이면 온라인 버튼이 열린다');
t.ok(await visibleOf('btnonlocked') === false, '열리면 잠김 버튼은 숨는다');

// 7b. 온라인 → 대기 장면, 그리고 취소로 되돌아오기
await clickObject(page, 'btnonline');
await waitFor(page, sceneId, v => v === 'waiting', { timeoutMs: 4000, label: '대기 장면' })
    .catch(e => console.error('  ' + e.message));
t.ok(await sceneId() === 'waiting', '[온라인 플레이] → 대기 장면');
t.ok(+(await getVar(page, '모드')) === 1, '온라인 모드로 전환');

await clickObject(page, 'btncancel');
await waitFor(page, sceneId, v => v === 'lobby', { timeoutMs: 4000, label: '취소 → 로비' })
    .catch(e => console.error('  ' + e.message));
t.ok(await sceneId() === 'lobby', '취소하면 로비로 돌아온다 (무한 대기 탈출구)');
t.ok(+(await getVar(page, '모드')) === 0, '취소 시 로컬 모드로 복귀');

// 7c. 선공(슬롯 1) 배정 — 판을 세우는 쪽
await clickObject(page, 'btnonline');
await waitFor(page, sceneId, v => v === 'waiting', { timeoutMs: 4000, label: '대기 재진입' })
    .catch(e => console.error('  ' + e.message));
await setVar(page, '$유저번호', 1);
await waitFor(page, sceneId, v => v === 'game', { timeoutMs: 4000, label: '슬롯1 → 대국' })
    .catch(e => console.error('  ' + e.message));
await waitForVar(page, '상태', v => +v === 1, { timeoutMs: 4000, label: '선공 준비' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '내슬롯')) === 1, '$유저번호 1 → 내슬롯 1 (선공)');
const bHost = await getList(page, '$보드');
t.ok(bHost[CENTER - 1] === 1 && bHost.filter(v => v !== 0).length === 1,
    '선공은 판을 세운다 — 중앙 1개');
t.ok(+(await getVar(page, '$턴')) === 2, '선공 착수 뒤 차례는 후공');
await shot('shot_6_online_host.png');

// 7d. 후공(슬롯 2) — 판을 세우지 않고 상대가 세운 판을 받아 그린다
await setVar(page, '상태', 2);           // 대국을 끝내 결과 → 로비로
await backToLobby();

await setVar(page, '$확장프로그램', 1);
await setVar(page, '$유저번호', 0);
await setList('$보드', Array(CELLS).fill(0));   // 새 방 = 빈 판
await clickObject(page, 'btnonline');
await waitFor(page, sceneId, v => v === 'waiting', { timeoutMs: 4000, label: '대기' })
    .catch(e => console.error('  ' + e.message));
await setVar(page, '$유저번호', 2);
await waitFor(page, sceneId, v => v === 'game', { timeoutMs: 4000, label: '슬롯2 → 대국' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '내슬롯')) === 2, '$유저번호 2 → 내슬롯 2 (후공)');

await page.waitForTimeout(700);
t.ok(+(await getVar(page, '상태')) === 0, '후공은 선공이 판을 세울 때까지 시작하지 않는다');
t.ok((await getList(page, '$보드')).every(v => v === 0), '후공은 판을 건드리지 않는다');

// 선공이 중앙에 둔 것을 흉내 → 후공 화면에 그려져야 한다
await setList('$보드', Array.from({ length: CELLS }, (_, i) => (i === CENTER - 1 ? 1 : 0)));
await setVar(page, '$턴', 2);
await setVar(page, '$남은돌', 2);
await waitForVar(page, '상태', v => +v === 1, { timeoutMs: 4000, label: '후공 시작' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '상태')) === 1, '선공의 판이 도착하면 후공이 시작된다');
t.ok((await stoneClones()).length === 1, '상대가 놓은 중앙 돌이 후공 화면에 그려진다');

// 상대가 더 둔 것을 흉내 → 렌더러가 따라 그린다
const remote = Array.from({ length: CELLS }, (_, i) => (i === CENTER - 1 ? 1 : 0));
for (const [r, c] of [[3, 3], [4, 4], [5, 5]]) remote[IDX(r, c) - 1] = 1;
await setList('$보드', remote);
await waitFor(page, () => stoneClones().then(a => a.length), v => v === 4,
    { timeoutMs: 3000, intervalMs: 80, label: '상대 착수 3개 렌더' })
    .catch(e => console.error('  ' + e.message));
const four = await stoneClones();
t.ok(four.length === 4, '상대가 놓은 돌 3개가 추가로 그려진다 (동기화 렌더)');
// 회귀 가드 — 한 프레임에 여러 클론을 만들 때 전역을 읽으면 전부 같은 자리에 겹친다.
const spots = new Set(four.map(c => `${c.x},${c.y}`));
console.log('  클론 좌표:', JSON.stringify([...spots]));
t.ok(spots.size === 4, '한 번에 도착한 돌들이 각자 제 칸에 그려진다 (겹침 없음)');
await shot('shot_7_online_guest.png');

// 7e. 상대 이탈 = 부전승
await setList('$유저연결상태', ['끊김', '연결']);   // 슬롯1(상대) 끊김, 슬롯2(나) 연결
await waitForVar(page, '$승자', v => +v === 2, { timeoutMs: 4000, label: '이탈 감지' })
    .catch(e => console.error('  ' + e.message));
t.ok(+(await getVar(page, '$승자')) === 2, '상대 슬롯이 "끊김" 이면 내가 승리');
t.ok(+(await getVar(page, '이탈승')) === 1, '이탈승으로 표시');
t.ok(+(await getVar(page, '상태')) === 2, '이탈 시 대국 종료');

await waitFor(page, sceneId, v => v === 'result', { timeoutMs: 6000, label: '이탈 후 결과' })
    .catch(e => console.error('  ' + e.message));
const onlineResult = await waitFor(page, () => textOf('resulttext'),
    v => typeof v === 'string' && v.length > 1,
    { timeoutMs: 3000, intervalMs: 80, label: '온라인 결과 문구' }
).catch(() => '');
console.log('  온라인 결과:', JSON.stringify(onlineResult), '|', JSON.stringify(await textOf('resultsub')));
t.ok(String(onlineResult).includes('승리'), '온라인 결과는 내 기준 승/패로 표시');

// ── 8. 페이지 에러 ───────────────────────────────────────────────
t.ok(pageErrors.length === 0, `페이지 에러 없음 (got ${pageErrors.length})`);
if (pageErrors.length) console.log('  errors:', pageErrors.slice(0, 5));

await browser.close();
process.exit(t.summary());
