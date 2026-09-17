// Brick Kingdom — L4 런타임 검증.
//
// 원칙: **게임 변수를 정답 값으로 강제하지 않는다.** 모든 시나리오는
// 키 입력(document keydown/keyup)만으로 진행하고, 변수는 읽기 전용으로 관찰한다.
// 예외는 `time_left` 하나뿐인데, 400 초를 실제로 기다릴 수 없어 "남은 시간"을
// 줄이는 것만 한다 — 타임아웃 **처리 로직**(death_cause/state 전이)은 건드리지 않고
// 게임이 스스로 판정하게 둔다.
//
// 사용:
//   npm start &                                   # 편집기 서버 (3000)
//   node games/brick-kingdom/verify.mjs           # 최신 .ent
//   node games/brick-kingdom/verify.mjs --ent games/brick-kingdom/_wip.ent
//
// 시나리오는 각각 **새 브라우저**에서 돈다. 한 브라우저 안에서 about:blank 로
// 넘어가면 편집기 하네스의 상대경로 fetch 가 깨진다(실측).

import { bootEditor, loadFixture } from '../../tools/lib/editor-harness.mjs';
import { runFresh, holdKey, createReporter } from '../../tools/lib/verify-harness.mjs';

import { TILE, GROUND, ROWS, STAGES } from './levels.mjs';
import { PHYS } from './physics.mjs';
import { exerciseShell } from './enemy-check.mjs';

const argEnt = process.argv.indexOf('--ent');
const FIXTURE = argEnt >= 0 ? process.argv[argEnt + 1]
    : 'games/brick-kingdom/brick-kingdom_002.ent';

// TILE·GROUND 는 levels.mjs 에서 가져온다 — 여기서 복제하면 타일 스케일을 바꿀 때
// 검증만 옛 격자를 기준으로 판정해서 조용히 어긋난다 (Phase 2-1 에서 실제로 걸렸다).
const ST = { TITLE: 0, READY: 1, PLAYING: 2, PAUSED: 3, DYING: 4, CLEAR: 5, OVER: 6 };
const DEATH = { FALL: 1, ENEMY: 2, HAZARD: 3, TIMEOUT: 4 };

const t = createReporter();
let totalErrors = [];

// ── 관찰 (읽기 전용) ────────────────────────────────────────────

const VARS = [
    'state', 'lives', 'score', 'coins', 'time_left', 'death_cause',
    'px', 'py', 'vx', 'vy', 'grounded', 'power', 'face', 'invuln', 'star',
    'ducking', 'combo', 'chain', 'cam_x', 'checkpoint_col',
    'dbg_tiles', 'dbg_deaths', 'dbg_stomps', 'dbg_bricks_broken',
    'dbg_rewards_used', 'dbg_coins_got', 'dbg_clear', 'dbg_shots',
    'dbg_kicks', 'dbg_chain_kills', 'dbg_shot_kills', 'dbg_items_got',
    'dbg_active_enemies', 'dbg_hurts', 'dbg_restarts', 'dbg_checkpoint',
];

function snap(page) {
    return page.evaluate((names) => {
        const out = {};
        for (const n of names) {
            const v = Entry.variableContainer.variables_.find(x => x.name_ === n);
            out[n] = v === undefined ? undefined : Number(v.getValue());
        }
        return out;
    }, VARS);
}

const L = (page, name) => page.evaluate((n) => {
    const l = Entry.variableContainer.lists_.find(x => x.name_ === n);
    return l ? l.array_.map(o => o.data) : null;
}, name);

// 타일 문자 읽기 — 게임이 lvl 리스트를 수정하므로 파괴/사용 상태를 여기서 관찰한다.
const tileAt = (page, col, row) => page.evaluate(({ c, r }) => {
    const l = Entry.variableContainer.lists_.find(x => x.name_ === 'lvl');
    return String(l.array_[r].data)[c] || '.';
}, { c: col, r: row });

// **행 번호를 리터럴로 쓰지 않는다.** 스테이지 데이터에서 찾아 쓴다.
// Phase 2-1 에서 ROWS 9→12·GROUND 7→10 이 되자 모든 지형이 3 칸 내려갔는데,
// 검증만 옛 행(3)을 봐서 벽돌·보상 블록 단정 6 건이 `got "."` 로 실패했다.
// 격자는 정상인데 검증이 엉뚱한 칸을 본 것이다 — TILE 만 상수화하고 행은
// 놓친 결과다. 열은 구간 배치가 정하는 값이라 그대로 쓰되, 행은 항상 찾는다.
const STAGE = STAGES[0];

/** 이 열에서 문자 `ch` 가 있는 행. 없으면 -1. */
function rowOf(col, ch) {
    for (let r = 0; r < STAGE.tiles.length; r++) {
        if (STAGE.tiles[r][col] === ch) return r;
    }
    return -1;
}

/** 이 열의 지형 표면 행 (가장 위의 비어있지 않은 칸). */
function surfaceRow(col) {
    for (let r = 0; r < STAGE.tiles.length; r++) {
        if (STAGE.tiles[r][col] !== '.') return r;
    }
    return STAGE.tiles.length;
}

// ── 조작 (키 입력만) ────────────────────────────────────────────

const down = (page, code) => page.evaluate((c) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c })), code);
const up = (page, code) => page.evaluate((c) =>
    document.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c })), code);

async function release(page) {
    for (const c of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyX', 'KeyZ']) {
        await up(page, c);
    }
}

// 이동 보조용 **한 번의 evaluate** 센서: 위치·상태·앞쪽 지형·앞쪽 적을 함께 읽는다.
// 나눠서 읽으면 안 된다 — page.evaluate 한 번이 10~15ms 라 항목마다 왕복하면
// 한 루프가 300ms 를 넘고, 달리기 속도(5px/frame)에서는 그 사이 플레이어가
// 90px 을 지나가 적을 감지하기 전에 부딪힌다 (실측: 28 열 적에게 3 연속 사망).
// 격자 상수는 **인자로 넘긴다** — evaluate 안은 별 컨텍스트라 import 가 안 보인다.
async function sense(page, { forwardOnly = false } = {}) {
    return page.evaluate(([TILE, ROWS, forwardOnly]) => {
        const SOLID = '#=B?uPp';
        const V = (n) => Number(Entry.variableContainer.variables_.find(x => x.name_ === n).getValue());
        const LST = (n) => Entry.variableContainer.lists_.find(x => x.name_ === n).array_.map(o => o.data);
        const rows = LST('lvl').map(String);
        const px = V('px'), py = V('py');
        const pc = Math.floor(px / TILE), pr = Math.floor(py / TILE);
        // 앞쪽 1..6 칸: 바닥 없는 첫 칸(구멍), 그리고 눈높이 벽
        let gap = null, wall = null;
        for (let d = 1; d <= 6; d++) {
            let floor = false;
            for (let r = pr; r < ROWS; r++) {
                if (SOLID.indexOf((rows[r] || '')[pc + d] || '.') >= 0) { floor = true; break; }
            }
            if (!floor && gap === null) gap = d;
            if (wall === null && SOLID.indexOf((rows[pr - 1] || '')[pc + d] || '.') >= 0) wall = d;
        }
        // **바로 앞 칸의 단차**. wall 로는 계단을 못 본다: pr 은 발밑 행이라
        // rows[pr-1] 은 몸통이 있는 행이고, 발밑 높이의 한 칸짜리 턱은 거기
        // 안 걸린다. 그래서 337~343 열 계단에서 봇이 339 열에 멈춰 골(350)에
        // 도달하지 못했다. 앞 칸의 표면 행을 직접 비교해 올라야 할 높이를 준다.
        const surf = (c) => {
            for (let r = 0; r < ROWS; r++) if (SOLID.indexOf((rows[r] || '')[c] || '.') >= 0) return r;
            return ROWS;
        };
        const step = surf(pc) - surf(pc + 1);   // >0 이면 앞이 더 높다 (올라가야 함)
        // 앞쪽 적까지의 거리
        const ex = LST('en_x').map(Number), est = LST('en_state').map(Number);
        const ek = LST('en_kind').map(String);
        let en = null, enKind = null, enState = null;
        for (let i = 0; i < ex.length; i++) {
            if (est[i] >= 3) continue;
            const d = ex[i] - px;
            // 뒤쪽 -10px 에서 끊으면 안 된다: 왼쪽으로 걸어오는 적이 플레이어를
            // 스쳐 지나가면 en=null 이 되어 "적이 처리됐다" 로 오인한다 (실측:
            // 28 열 walker 가 est 그대로인데 en=null, stomps=0).
            if ((forwardOnly ? d >= 0 : d > -60) && d < 320 && (en === null || d < en)) {
                en = d; enKind = ek[i]; enState = est[i];
            }
        }
        return { px, py, state: V('state'), grounded: V('grounded'), vx: V('vx'),
                 lives: V('lives'), gap, wall, step, en, enKind, enState };
    }, [TILE, ROWS, forwardOnly]);
}

// 앞쪽 적 한 마리를 **밟는다**. 타이밍은 실측으로 정했다 (_diag6b.mjs):
//   - 발동 거리 120~150px, 점프 유지 160ms → 3/3 밟기 성공
//   - 발동 거리 45~95px  → 착지가 적 뒤가 되어 밟지 못함 (LANDED-NO-STOMP)
//   - 유지 250ms → 5 칸 높이 아치가 되어 적이 밑을 지나가고, 착지 때 측면 피격
// 밟은 **직후** 셸 상태(state=1, vx=0)를 함께 잡아 돌려준다: 계속 뛰면 방금
// 만든 셸을 그대로 차서(1→2) "셸 정지" 를 관측할 창이 사라진다.
// `onStomp` 는 밟힘을 **감지한 프레임에** 호출된다. 차기 방향을 통제하려면
// 이 창을 놓치면 안 된다: 차기 금지 잠금은 10 프레임(≈167ms) 뿐이고, 감지 후
// 리스트를 따로 읽으면 왕복 4 회 ≈ 60ms 를 잡아먹어 그 사이 플레이어가 셸
// 중심을 넘어가 방향이 뒤집힌다 (실측: 매 라운드 vx=-6). 그래서 관측값은
// **한 번의 evaluate** 로 모으고, 키 입력을 그보다 먼저 걸 수 있게 한다.
async function stompNext(page, { tries = 6, onStomp = null, forwardOnly = false } = {}) {
    let stomped = false, shellAtStomp = -1, shellVxAtStomp = null;
    let exAtStomp = null, estAtStomp = null;
    const base = Number((await snap(page)).dbg_stomps);
    for (let attempt = 0; attempt < tries && !stomped; attempt++) {
        // 발동 거리까지 걸어서 접근한다. 멈춰서 기다리면 안 된다 — 적은 활성
        // 범위(±64px) 밖에서 정지해 있어 카메라가 밀리지 않으면 오지 않는다.
        let bailGap = false;
        for (let i = 0; i < 80; i++) {
            const s = await sense(page, { forwardOnly });
            if (s.state !== ST.PLAYING) break;
            // 발동 거리 120px. **마주 걸어오는 적**을 기준으로 실측해 정했다
            // (`_diagrow2.mjs` 로 266·271 열 3 연속 walker 구간에서 스윕):
            //   165 → 표본 시점 157px 에서 뛰어 d=32 에 착지, **측면 피격 사망**
            //   120 → 실제 108px 에서 발동, 3 연속 구간에서 2 회 밟기 성공
            //   100 → 실제 93px, 적 뒤에 착지 (LANDED-NO-STOMP) 3/3
            // 넓히면 일찍 뛰어 적 앞에 떨어지고, 좁히면 늦게 뛰어 적 뒤에
            // 떨어진다. 창이 좁은 건 게임 결함이 아니라 원작과 같은 정밀도다.
            if (s.en !== null && s.en < 120) break;
            // 구멍 앞에서는 접근을 멈춘다. 걷기 속도로 계속 밀면 그대로 빠진다
            // (실측: 61~62 열 구멍에서 목숨 3 개 소진 → runTo 가 112 열에 못 감).
            if (s.gap !== null && s.gap <= 2 && s.grounded === 1) { bailGap = true; break; }
            await down(page, 'ArrowRight');
            await page.waitForTimeout(40);
        }
        await up(page, 'ArrowRight');
        if (bailGap) break;
        const s0 = await sense(page, { forwardOnly });
        if (s0.state !== ST.PLAYING) break;
        if (s0.grounded !== 1) { await page.waitForTimeout(200); continue; }
        await down(page, 'ArrowUp');
        await page.waitForTimeout(160);
        await up(page, 'ArrowUp');
        for (let i = 0; i < 30; i++) {
            // 밟힘 여부와 적 배열을 **한 번에** 읽는다 (위 주석의 60ms 문제).
            const d = await page.evaluate(() => {
                const V = (n) => Number(Entry.variableContainer.variables_.find(x => x.name_ === n).getValue());
                const LST = (n) => Entry.variableContainer.lists_.find(x => x.name_ === n).array_.map(o => Number(o.data));
                return { stomps: V('dbg_stomps'), state: V('state'), grounded: V('grounded'),
                         es: LST('en_state'), ev: LST('en_vx'), ex: LST('en_x') };
            });
            if (d.stomps > base) {
                stomped = true;
                if (onStomp) await onStomp();          // 잠금 창 안에 키를 건다
                shellAtStomp = d.es.findIndex(v => v === 1);
                if (shellAtStomp >= 0) shellVxAtStomp = d.ev[shellAtStomp];
                exAtStomp = d.ex;
                estAtStomp = d.es;
                break;
            }
            if (d.state !== ST.PLAYING) break;
            if (d.grounded === 1 && i > 3) break;       // 착지했는데 못 밟았다 — 재시도
            await page.waitForTimeout(50);
        }
    }
    return { stomped, shellAtStomp, shellVxAtStomp, exAtStomp, estAtStomp };
}

// 목표 열까지 오른쪽으로 이동한다.
// - 벽/계단에 걸리면 점프한다.
// - **앞의 적은 뛰어 넘거나 밟는다.** 이걸 안 하면 이동 도중 매번 죽어서
//   지형·블록 시나리오가 시작 지점으로 되돌아간다 (실측: 벽 충돌 검사가
//   28 열 적에게 죽어 px=146 에서 끝났다).
// - 그래도 죽으면 부활 후 계속 시도한다. 도착하면 true.
// 예산은 **벽시계 시간**으로 준다. tick 수로 주면 안 된다 — 적 조우 한 번이
// 브레이크+대기+밟기로 3~5 초를 쓰는데 그게 tick 1 개라, 같은 maxTicks 가
// 상황에 따라 20 초일 수도 120 초일 수도 있다. 그래서 tick 예산으로는 원거리
// 이동이 **간헐적으로** 실패했다.
async function runTo(page, col, { run = true, budgetMs = 150_000, jump = true, trace = false } = {}) {
    // A handled shell behind the player must not trap forward navigation in
    // repeated in-place jumps. Keep the backward-aware sensor for other probes.
    const target = col * TILE;
    const deadline = Date.now() + budgetMs;
    let stuck = 0, prev = -1;
    const tr = (...a) => { if (trace) console.log('    runTo:', ...a); };
    const press = async () => {
        if (run) await down(page, 'KeyX');
        await down(page, 'ArrowRight');
    };
    await press();
    while (Date.now() < deadline) {
        const s = await sense(page, { forwardOnly: true });
        if (s.px >= target) { await release(page); return true; }
        if (s.state !== ST.PLAYING) {
            // 사망 연출 / READY — 키를 놓고 기다린 뒤 다시 진행한다.
            // GAME_OVER 까지 갔으면 Enter 로 처음부터 다시 시작한다. 목숨 3 개로
            // 180 열을 한 번에 통과하는 건 봇에게 불안정해서, 여기서 포기하면
            // 원거리 시나리오가 **간헐적으로** 실패한다 (게임 결함이 아니라
            // 조작 정밀도 문제). 사람이 재도전하는 것과 같은 절차다.
            await release(page);
            tr('not playing: state=', s.state, 'col=', Math.floor(s.px / TILE), 'lives=', s.lives);
            if (s.state === ST.OVER) {
                for (let k = 0; k < 60; k++) {
                    await page.waitForTimeout(150);
                    if ((await sense(page, { forwardOnly: true })).state === ST.TITLE) break;
                }
                await holdKey(page, 'Enter', 150);
                await page.waitForTimeout(1200);
            } else {
                await page.waitForTimeout(300);
            }
            prev = -1; stuck = 0;
            if ((await sense(page, { forwardOnly: true })).state === ST.PLAYING) await press();
            continue;
        }
        // ① 앞에 적 — **걷기 속도로 전진하며 계속 뛴다**(포고 워크).
        //
        // 여기까지 세 가지 정책이 실패했다:
        //   (a) 달리며 한 번 크게 뛰어 넘기 → 착지 지점이 적의 측면이라 피격.
        //   (b) 멈춰서 적이 오길 기다리기 → 적은 활성 범위(±64px) 밖에서 정지해
        //       있어서 영원히 오지 않는다. 카메라가 밀려야 움직인다.
        //   (c) 제동 후 탭으로 접근 → 제동(왼쪽 키)이 반복 호출돼 순이동이 음수가
        //       되어 오히려 뒤로 밀렸다 (실측: 120 초에 7 열까지 후퇴).
        // 남는 답은 **전진을 멈추지 않으면서 체공 시간을 최대로 하는 것**이다.
        // 달리기(KeyX)를 끄면 최고 속도가 3.1px/f 로 떨어져 조우 속도가 느려지고,
        // 접지 순간마다 즉시 다시 뛰면 지상에 있는 프레임이 몇 개 안 된다.
        // 밟기 판정은 하강 중이면 성립하므로, 접근하다 만나면 자연히 밟게 된다.
        // **지형이 적보다 먼저다.** 앞 칸이 더 높으면(계단·언덕) 적 처리를 건너뛴다.
        // 언덕 위(100 열, 행 3)의 적은 91 열 아래에서 닿을 수 없는데, 적 분기가
        // 먼저 걸리면 "접근" 을 하려고 언덕 벽에 계속 걸어붙어 진행이 멈춘다
        // (실측: col=91.7 로 고정, 적은 활성 범위 밖이라 얼어붙어 영원히 대기).
        const blockedByTerrain = s.grounded === 1 && s.step > 0;
        if (jump && !blockedByTerrain && s.en !== null && s.en < 220) {
            const kind = s.enKind, st0 = s.enState;
            tr('enemy', kind, 'st=', st0, 'd=', s.en.toFixed(0),
               'col=', Math.floor(s.px / TILE), 'lives=', s.lives);
            await up(page, 'KeyX');                     // 걷기로 전환
            const unsafe = kind === 's' || st0 === 2;   // 밟을 수 없는 적 / 움직이는 셸
            // A. 접근 — 걷기로만. 접근 중에는 뛰지 않는다. 걸으면서 뛰면 착지
            //    지점이 적의 옆이 되어 착지 프레임에 측면 피격된다 (실측: 82 열).
            for (let k = 0; k < 60; k++) {
                const w = await sense(page, { forwardOnly: true });
                if (w.state !== ST.PLAYING) break;
                if (w.en === null || w.en < 80) break;
                if (w.px >= target) break;
                if (w.gap !== null && w.gap <= 2 && w.grounded === 1) break;
                await down(page, 'ArrowRight');
                await page.waitForTimeout(40);
            }
            // B. 사정거리 — 밟을 수 있으면 실측 타이밍(stompNext)으로 밟고,
            //    밟을 수 없는 적(스파이크샤드 · 이동 중 셸)은 크게 뛰어 넘는다.
            await up(page, 'ArrowRight');
            if (!unsafe) {
                const rs = await stompNext(page, { tries: 3, forwardOnly: true });
                // C. **줄지어 선 적** 대응. 266·271·276 열은 5 칸 간격이라 세 마리가
                //    활성 범위(±64px) 안에 함께 들어오고, 한 마리를 밟아 셸로 만든
                //    자리에 서 있으면 다음 마리에 측면 피격된다 (실측: 267~271 열에서
                //    목숨 3 개 소진 → 골 도달 실패).
                //
                //    셸을 **앞으로 차서** 치우는 방법은 시도했다가 되돌렸다: 차기
                //    방향을 통제하려면 셸 왼쪽으로 돌아가야 하는데 그 왕복 중에
                //    다음 적과 접촉하고, 잘못 차면 이동 중 셸(몸통 접촉 = 사망)이
                //    길을 막는다 (실측: 178~181 열에서 오히려 더 일찍 전멸).
                //
                //    남는 안전한 답은 **다음 적과 거리가 벌어질 때까지 물러나는 것**이다.
                //    고정 시간(360ms)으로는 부족했다 — 밟은 뒤 다음 마리가 이미
                //    80px 안에 있어서, 물러나는 동안에도 걸어와 그대로 접촉했다
                //    (실측: BIG 등급으로도 268 열에서 전멸). 거리를 보며 물러난다.
                if (rs.stomped) {
                    for (let k = 0; k < 30; k++) {
                        const w = await sense(page, { forwardOnly: true });
                        if (w.state !== ST.PLAYING) break;
                        // 다음 표적이 밟기 발동 거리(135px) 밖으로 나가면 충분하다.
                        if (w.en === null || w.en > 150) break;
                        // 뒤에 구멍이 있으면 더 물러날 수 없다 — 거기서 멈춘다.
                        if (w.gap !== null && w.gap <= 1) break;
                        await down(page, 'ArrowLeft');
                        await page.waitForTimeout(60);
                        await up(page, 'ArrowLeft');
                        await page.waitForTimeout(30);
                    }
                    await release(page);
                    await page.waitForTimeout(120);
                }
            } else {
                for (let hop = 0; hop < 12; hop++) {
                    const w = await sense(page, { forwardOnly: true });
                    if (w.state !== ST.PLAYING) break;
                    if (w.en === null || w.en > 260) break;
                    await down(page, 'ArrowRight');
                    if (w.grounded === 1) {
                        await down(page, 'ArrowUp');
                        await page.waitForTimeout(300);
                        await up(page, 'ArrowUp');
                    } else {
                        await page.waitForTimeout(45);
                    }
                }
            }
            if ((await sense(page, { forwardOnly: true })).state === ST.PLAYING) await press();
            stuck = 0; prev = -1;
            continue;
        }
        if (jump && s.grounded === 1) {
            // ② 구멍 — **바로 앞 칸(1~2)일 때만** 뛴다.
            // 속도에 비례한 넉넉한 거리에서 뛰면 안 된다: 달리기(vx=5)에서 그 거리가
            // 170px = 5 칸이 되어 구멍 여섯 칸 앞에서 뛰고, 착지 후 남은 거리를
            // 걸어가 그대로 구멍에 빠진다 (실측: 61~62 열 구멍에서 매번 사망).
            // 구멍은 폭 2 칸이라 가장자리에서 뛰면 달리기로 넉넉히 넘는다.
            if (s.gap !== null && s.gap <= 2) {
                tr('gap jump col=', Math.floor(s.px / TILE), 'gap=', s.gap);
                await down(page, 'ArrowUp');
                await page.waitForTimeout(340);
                await up(page, 'ArrowUp');
                await page.waitForTimeout(200);
                stuck = 0; prev = s.px;
                continue;
            }
            // ③ 계단 — 바로 앞 칸이 더 높으면 올라간다. 오른쪽을 누른 채 뛰어야
            //    한 칸 전진하면서 올라간다 (수직 점프는 같은 자리에 떨어진다).
            if (s.step > 0) {
                tr('step up col=', Math.floor(s.px / TILE), 'step=', s.step);
                await down(page, 'ArrowRight');
                await down(page, 'ArrowUp');
                await page.waitForTimeout(300);
                await up(page, 'ArrowUp');
                await page.waitForTimeout(220);
                stuck = 0; prev = s.px;
                continue;
            }
            // ④ 벽 — 여기는 일찍 뛰어도 손해가 없다(막히면 제자리).
            if (s.wall !== null && s.wall * TILE < 1.4 * TILE + Math.abs(s.vx) * 20) {
                tr('wall jump col=', Math.floor(s.px / TILE), 'wall=', s.wall);
                await down(page, 'ArrowUp');
                await page.waitForTimeout(320);
                await up(page, 'ArrowUp');
                stuck = 0; prev = s.px;
                continue;
            }
        }
        if (Math.abs(s.px - prev) < 4) stuck++; else stuck = 0;
        prev = s.px;
        if (jump && stuck >= 2) {
            await down(page, 'ArrowUp');
            await page.waitForTimeout(260);
            await up(page, 'ArrowUp');
            stuck = 0;
        }
        await page.waitForTimeout(30);
    }
    await release(page);
    return false;
}

// 플레이 시작 상태까지 진행 (TITLE → READY → PLAYING)
async function start(page) {
    await runFresh(page);
    await page.waitForTimeout(500);
    await holdKey(page, 'Enter', 150);
    // READY 연출이 끝나 PLAYING 이 될 때까지 기다린다
    for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(100);
        if ((await snap(page)).state === ST.PLAYING) return true;
    }
    return false;
}

// 시나리오 러너 — 시나리오마다 새 브라우저.
async function trial(label, fn) {
    const { browser, page, pageErrors } = await bootEditor();
    console.log(`\n── ${label}`);
    try {
        await loadFixture(page, FIXTURE);
        await fn(page);
        if (pageErrors.length) {
            totalErrors.push(...pageErrors.map(e => `[${label}] ${e}`));
        }
        t.ok(pageErrors.length === 0, `${label}: console error 0` +
            (pageErrors.length ? ` — ${pageErrors.slice(0, 2).join(' | ')}` : ''));
    } catch (e) {
        t.ok(false, `${label}: 예외 — ${e.message}`);
    } finally {
        await browser.close();
    }
}

// 절대 좌표로 **걸어서** 접근 (달리지 않는다 — 블록 아래 미세 조정용).
// 멀면 키를 누른 채로, 가까우면 탭으로. 전부 탭으로 하면 실효 속도가 절반이라
// 100px 도 못 가고 maxTicks 를 소진한다 (실측: 벽돌 파괴 검사가 엉뚱한 위치에서
// 점프해 실패했다).
async function goTo(page, x, { tol = 12, maxTicks = 80 } = {}) {
    for (let i = 0; i < maxTicks; i++) {
        const s = await snap(page);
        if (s.state !== ST.PLAYING) { await release(page); return false; }
        const dx = x - s.px;
        if (Math.abs(dx) <= tol) { await release(page); return true; }
        const dir = dx > 0 ? 'ArrowRight' : 'ArrowLeft';
        await down(page, dir);
        await page.waitForTimeout(Math.abs(dx) > 60 ? 150 : 55);
        await up(page, dir);
        await page.waitForTimeout(70);          // 관성이 죽을 시간
    }
    await release(page);
    return false;
}

// 42 열 보상 블록의 성장 아이템을 먹어 BIG 등급이 된다.
// 원거리 이동(골 도달·계단 벽 검사)에서 쓴다: 266·271·276 열의 walker 3 연속
// 구간을 BASE 로 통과하려면 실수 한 번이 즉사라 목숨 3 개가 늘 부족했다
// (실측: 세 번 도전 모두 267~271 열에서 전멸). BIG 이면 한 번 맞아도 BASE 로
// 떨어지며 90 프레임 무적이 붙어 그 구간을 빠져나갈 수 있다.
// 시퀀스 자체는 시나리오 [4]에서 이미 검증된 것을 재사용한다.
async function grabGrow(page) {
    if (!await runTo(page, 38, { run: false, budgetMs: 60_000 })) return false;
    // 41 열을 경유한다 — 38 → 42 를 goTo 한 번으로 가면 탭 이동 4 칸이 80 tick
    // 예산에 안 들어와 실패한다 (시나리오 [4] 와 같은 경유 순서).
    await goTo(page, 41 * TILE + TILE / 2);
    if (!await goTo(page, 42 * TILE + TILE / 2)) return false;
    await jumpAndMeasure(page, 400);
    await page.waitForTimeout(300);
    // 블록이 실제로 열렸는지 확인한다. 안 열렸으면 한 칸 조정해 다시 친다.
    if (Number((await snap(page)).dbg_rewards_used) === 0) {
        await goTo(page, 42 * TILE + TILE / 2);
        await jumpAndMeasure(page, 400);
        await page.waitForTimeout(300);
    }
    // 아이템은 솟아오른 뒤 걸어간다 — 키를 **누른 채** 추격한다 (탭은 못 따라잡는다).
    for (let i = 0; i < 50; i++) {
        const s = await snap(page);
        if (s.state !== ST.PLAYING) break;
        if (Number(s.power) > 0) { await release(page); return true; }
        const its = await page.evaluate(() => {
            const LST = (n) => Entry.variableContainer.lists_.find(x => x.name_ === n).array_.map(o => Number(o.data));
            return { al: LST('it_alive'), x: LST('it_x') };
        });
        const j = its.al.findIndex(v => v > 0);
        if (j < 0) break;
        // 방향을 바꿀 때는 **반대 키를 먼저 놓아야 한다.** 누른 채로 반대 키를
        // 추가하면 먼저 누른 쪽이 계속 이겨서, 왼쪽으로 가라는 지시에도 오른쪽으로
        // 계속 갔다 (실측: col 44 → 60 까지 우측 이동하다 62 열 구멍에 추락사).
        const dir = its.x[j] > s.px ? 'ArrowRight' : 'ArrowLeft';
        await down(page, dir);
        await page.waitForTimeout(120);
        await release(page);          // 다음 반복에서 방향이 바뀔 수 있으니 매번 놓는다
    }
    await release(page);
    return Number((await snap(page)).power) > 0;
}

// 제자리 점프 후 최고 상승량과 착지 여부를 돌려준다.
async function jumpAndMeasure(page, holdMs) {
    const s0 = await snap(page);
    await down(page, 'ArrowUp');
    await page.waitForTimeout(holdMs);
    await up(page, 'ArrowUp');
    let peak = s0.py;
    for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(50);
        const s = await snap(page);
        if (s.py < peak) peak = s.py;
        if (s.grounded === 1 && i > 4) break;
    }
    return { rise: s0.py - peak, start: s0.py, after: (await snap(page)) };
}

// ── 시나리오 ────────────────────────────────────────────────────

async function scBoot(page) {
    await runFresh(page);
    await page.waitForTimeout(600);
    const s0 = await snap(page);
    t.eq(s0.state, ST.TITLE, '부팅 직후 TITLE');
    t.eq(s0.lives, 3, '목숨 3');
    t.eq(s0.score, 0, '점수 0');
    t.ok(await start(page), 'Enter → READY → PLAYING 전이');
    const s1 = await snap(page);
    t.between(s1.px, 3 * TILE, 4 * TILE, `시작 위치 spawnCol 3 (px=${s1.px})`);
    t.eq(s1.grounded, 1, '시작 시 바닥 접지');
    t.ok(s1.dbg_tiles > 10, `타일 렌더링 동작 (stamps=${s1.dbg_tiles})`);
    t.ok(s1.dbg_tiles < 250, `렌더 예산 이내 (stamps=${s1.dbg_tiles} < 250)`);
    const lvl = await L(page, 'lvl');
    t.eq(lvl.length, ROWS, `lvl 행 ${ROWS}`);
    t.eq(String(lvl[0]).length, 356, 'lvl 열 356');
}

async function scMove(page) {
    t.ok(await start(page), 'PLAYING 진입');
    // 걷기 1 초
    const a0 = await snap(page);
    await down(page, 'ArrowRight');
    await page.waitForTimeout(1000);
    const a1 = await snap(page);
    await release(page);
    await page.waitForTimeout(400);
    const walk = a1.px - a0.px;
    // 1 초 걷기 이동량. 가속 구간(WALK_MAX 까지 ~42 프레임)이 섞이므로 상한 근처가
    // 아니라 **하한만** 본다. 기준은 TILE 비례 — 옛 32px 기준 60px 을 그대로 두면
    // 24px 격자에서는 도달 불가능한 값이 된다 (실측 45.5px).
    t.ok(walk > 1.6 * TILE, `오른쪽 걷기 이동 (Δpx=${walk.toFixed(1)})`);
    // 상한은 PHYS 에서 가져온다 — 숫자를 박아두면 타일 배율을 바꿀 때
    // 단정이 헐거워져서 통과만 한다 (Phase 2-1).
    t.between(a1.vx, PHYS.WALK_MAX - 0.13, PHYS.WALK_MAX + 0.08,
        `걷기 최고 속도 = WALK_MAX(${PHYS.WALK_MAX}) (vx=${a1.vx.toFixed(3)})`);
    t.eq(a1.face, 1, '오른쪽 이동 시 face=1');

    // 달리기 1 초
    const b0 = await snap(page);
    await down(page, 'KeyX');
    await down(page, 'ArrowRight');
    await page.waitForTimeout(1000);
    const b1 = await snap(page);
    await release(page);
    await page.waitForTimeout(400);
    const run = b1.px - b0.px;
    t.ok(run > walk * 1.25, `달리기가 걷기보다 빠름 (walk=${walk.toFixed(0)} run=${run.toFixed(0)})`);
    // 상한만 본다. 1 초 뒤 값이 정확히 RUN_MAX 라고 보면 안 된다 — 가속이
    // ACCEL/frame 이라 걷기 속도에서 RUN_MAX 까지 오르는 데 수십 프레임이 더 걸리고,
    // 샘플 시점의 왕복 지연에 따라 그 아래 값이 나온다.
    t.ok(b1.vx > PHYS.WALK_MAX + 0.1 && b1.vx <= PHYS.RUN_MAX + 0.01,
        `달리기 속도가 걷기 상한을 넘고 RUN_MAX(${PHYS.RUN_MAX}) 이내 (vx=${b1.vx.toFixed(3)})`);

    // 반대 방향 — 관성(스키드)으로 즉시 반전하지 않는다
    await down(page, 'ArrowLeft');
    await page.waitForTimeout(100);
    const c1 = await snap(page);
    t.ok(c1.vx > 0, `반전 직후에도 관성 유지 (vx=${c1.vx.toFixed(2)} > 0)`);
    await page.waitForTimeout(700);
    const c2 = await snap(page);
    await release(page);
    t.ok(c2.vx < 0, `계속 누르면 방향 반전 (vx=${c2.vx.toFixed(2)})`);
    t.eq(c2.face, -1, '왼쪽 이동 시 face=-1');
}

async function scJump(page) {
    t.ok(await start(page), 'PLAYING 진입');
    await page.waitForTimeout(300);
    const short = await jumpAndMeasure(page, 60);
    t.ok(short.after.grounded === 1, '짧은 점프 후 착지');
    await page.waitForTimeout(300);
    const long = await jumpAndMeasure(page, 400);
    t.ok(long.after.grounded === 1, '긴 점프 후 착지');
    t.ok(long.rise > short.rise + 15,
        `누른 시간에 따라 점프 높이 가변 (짧=${short.rise.toFixed(0)}px 길=${long.rise.toFixed(0)}px)`);
    t.between(long.rise, 60, 200, `긴 점프 상승량 (${long.rise.toFixed(0)}px)`);
    // 착지 좌표가 격자 위 — 바닥 관통 없음
    const s = await snap(page);
    t.eq(s.py, GROUND * TILE, `착지 py 가 바닥 표면(${GROUND * TILE})에 정확히 (py=${s.py})`);
}

async function scWalls(page) {
    t.ok(await start(page), 'PLAYING 진입');
    // 언덕(92~107 열 계단)까지 간 뒤 그 왼쪽 면에 부딪힌다.
    const near = await runTo(page, 88, { run: true, budgetMs: 120_000 });
    t.ok(near, '언덕 앞(88 열) 도달');

    // 벽 판정은 **절대 열**이 아니라 "막혔는가"로 본다: 봇이 어디서 멈추든
    // 앞에 solid 가 있는데 오른쪽을 계속 눌러도 전진하지 않으면 벽 충돌이다.
    await down(page, 'ArrowRight');
    await page.waitForTimeout(2500);
    const a1 = await sense(page);
    await page.waitForTimeout(1200);
    const a2 = await sense(page);
    await release(page);
    t.ok(a2.px - a1.px < 3,
        `오른쪽 벽에 막혀 전진 정지 (px ${a1.px.toFixed(0)} → ${a2.px.toFixed(0)})`);
    t.ok(a2.wall !== null || a2.px >= 91 * TILE,
        `막힌 지점 바로 앞이 벽 (wall=${a2.wall}, col=${Math.floor(a2.px / TILE)})`);
    t.eq(a2.grounded, 1, '벽에 막혀도 접지 유지');
    t.ok(Math.abs(a2.vx) < 0.6, `벽 충돌 시 수평 속도 소멸 (vx=${a2.vx.toFixed(2)})`);

    // **왼쪽** 벽 충돌 — 골 앞 계단(337~343 열)의 오른쪽 면이다. 계단은
    // 343 열에서 행 1 까지 6 칸 높이로 끊기므로 344 열에서 왼쪽으로 걸으면 막힌다.
    //
    // 후보 두 곳을 실측으로 탈락시켰다:
    //  - **언덕(92~107 열)**: 오른쪽 면이 벽이 아니라 **내려가는 계단**이다
    //    (행 4/5/6 이 105/106/107 열에서 끝난다). 왼쪽으로 걸으면 한 칸씩 그냥
    //    올라가 시작 지점까지 되돌아갔다 (실측: px 3766 → 107 = 3 열).
    //  - **파이프(190·191 열)**: 진짜 2 칸 벽이지만 오른쪽에서 접근할 수 없다.
    //    197 열 스파이크샤드(밟을 수 없는 적)가 되돌아오는 길목에 있어 도착 전에
    //    죽는다 (실측: 198 열에서 state=4).
    const over = await runTo(page, 346, { run: true, budgetMs: 300_000 });
    t.ok(over, '골 앞 계단 통과 (346 열)');
    if (over) {
        await down(page, 'ArrowLeft');
        await page.waitForTimeout(2500);
        const b1 = await sense(page);
        await page.waitForTimeout(1200);
        const b2 = await sense(page);
        await release(page);
        t.ok(b1.px - b2.px < 3,
            `왼쪽 벽에 막혀 후진 정지 (px ${b1.px.toFixed(0)} → ${b2.px.toFixed(0)})`);
        t.ok(b2.px > 343 * TILE,
            `계단 오른쪽 면(344 열)에서 막힘 (col=${Math.floor(b2.px / TILE)})`);
        t.eq(b2.grounded, 1, '왼쪽 벽에 막혀도 접지 유지');
    }
}

async function scCeilingAndBlocks(page) {
    // 벽돌 줄과 보상 블록의 **행은 데이터에서 찾는다** (rowOf). 리터럴로 두면
    // 타일 스케일이 바뀔 때 검증만 옛 행을 봐서 조용히 어긋난다.
    const BRICK_ROW = rowOf(41, 'B');
    const REWARD_ROW = rowOf(42, '?');
    t.ok(BRICK_ROW >= 0 && REWARD_ROW >= 0,
        `벽돌 줄(행 ${BRICK_ROW})·보상 블록(행 ${REWARD_ROW}) 위치 확인`);
    t.ok(await start(page), 'PLAYING 진입');
    await runTo(page, 38, { run: false, budgetMs: 60_000 });
    // ① BASE 상태에서 벽돌(41 열) 머리박기 → 부서지지 않는다
    await goTo(page, 41 * TILE + TILE / 2);
    const before = await snap(page);
    t.eq(before.power, 0, 'BASE 파워로 시작');
    await jumpAndMeasure(page, 400);
    const afterBump = await snap(page);
    t.eq(await tileAt(page, 41, BRICK_ROW), 'B', 'BASE 상태에서는 벽돌이 부서지지 않는다');
    t.eq(afterBump.dbg_bricks_broken, 0, '벽돌 파괴 카운터 0 유지');
    t.ok(afterBump.py === GROUND * TILE, '천장 머리박기 후 정상 착지');

    // ② 보상 블록(42 열) 아래에서 머리박기 → 사용됨 상태 + 아이템 등장
    await goTo(page, 42 * TILE + TILE / 2);
    await jumpAndMeasure(page, 400);
    await page.waitForTimeout(300);
    t.eq(await tileAt(page, 42, REWARD_ROW), 'u', '보상 블록이 사용됨(u) 상태로 전환');
    const s2 = await snap(page);
    t.eq(s2.dbg_rewards_used, 1, '보상 블록 사용 카운터 1');
    const alive = (await L(page, 'it_alive')).filter(v => Number(v) > 0).length;
    t.ok(alive >= 1, `아이템이 블록에서 등장 (활성 슬롯 ${alive})`);

    // ③ 같은 블록을 다시 쳐도 재사용되지 않는다
    await goTo(page, 42 * TILE + TILE / 2);
    await jumpAndMeasure(page, 400);
    t.eq((await snap(page)).dbg_rewards_used, 1, '사용된 블록은 재사용 불가 (카운터 그대로 1)');

    // ④ 아이템 획득 → 파워업 상태 변화
    // 아이템은 솟아오른 뒤 1px/frame 으로 걸어간다. 탭 방식(goTo)으로는
    // 실효 속도가 절반이라 따라잡지 못한다 → 키를 **누른 채로** 추격한다.
    let got = false;
    for (let i = 0; i < 50 && !got; i++) {
        const s = await snap(page);
        const al = await L(page, 'it_alive');
        const idx = al.findIndex(v => Number(v) > 0);
        if (idx < 0) break;
        const ix = Number((await L(page, 'it_x'))[idx]);
        const dir = s.px < ix ? 'ArrowRight' : 'ArrowLeft';
        await down(page, dir);
        await page.waitForTimeout(120);
        await release(page);
        got = Number((await snap(page)).dbg_items_got) > 0;
    }
    const s3 = await snap(page);
    t.ok(s3.dbg_items_got >= 1, `성장 아이템 획득 (items_got=${s3.dbg_items_got})`);
    t.eq(s3.power, 1, '획득 후 파워 등급 BIG(1)');

    // ⑤ BIG 상태에서 벽돌 머리박기 → 파괴.
    // 벽돌은 40·41·43·44 열에 있다. 아이템을 쫓다 위치가 밀렸을 수 있으니
    // 파괴될 때까지 각 열을 시도하고, **실제로 친 열**(hit_c)로 타일을 확인한다
    // (41 열로 고정해서 보면 44 열을 깼을 때 오판정한다).
    let broke = false, brokeCol = null;
    for (const col of [41, 40, 43, 44]) {
        if (!await goTo(page, col * TILE + TILE / 2)) continue;
        await jumpAndMeasure(page, 400);
        await page.waitForTimeout(200);
        if (Number((await snap(page)).dbg_bricks_broken) >= 1) {
            broke = true;
            brokeCol = Number(await page.evaluate(() =>
                Number(Entry.variableContainer.variables_.find(v => v.name_ === 'hit_c').getValue())));
            break;
        }
    }
    const s4 = await snap(page);
    t.ok(broke, `BIG 상태에서 벽돌 파괴 (broken=${s4.dbg_bricks_broken})`);
    if (broke) {
        t.ok(await tileAt(page, brokeCol, BRICK_ROW) !== 'B',
            `파괴된 벽돌 타일이 사라짐 (${brokeCol} 열)`);
    }
}

async function scCamera(page) {
    t.ok(await start(page), 'PLAYING 진입');
    const s0 = await snap(page);
    t.eq(s0.cam_x, 0, '시작 시 카메라 0');
    let prevCam = 0, monotone = true;
    await down(page, 'KeyX');
    await down(page, 'ArrowRight');
    for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(120);
        const s = await snap(page);
        if (s.cam_x < prevCam - 0.01) monotone = false;
        prevCam = s.cam_x;
    }
    await release(page);
    const s1 = await snap(page);
    t.ok(s1.cam_x > 100, `전진 시 카메라 스크롤 (cam_x=${s1.cam_x.toFixed(0)})`);
    t.ok(monotone, '전진 중 카메라가 뒤로 스크롤하지 않는다');
    t.ok(s1.px > s1.cam_x, `월드 좌표와 카메라 좌표 분리 (px=${s1.px.toFixed(0)} cam=${s1.cam_x.toFixed(0)})`);
    // 뒤로 걸어도 카메라는 되돌지 않는다
    const camBefore = s1.cam_x;
    await down(page, 'ArrowLeft');
    await page.waitForTimeout(1500);
    await release(page);
    const s2 = await snap(page);
    t.ok(s2.cam_x >= camBefore - 0.01,
        `되돌아 걸어도 카메라 후퇴 없음 (${camBefore.toFixed(0)} → ${s2.cam_x.toFixed(0)})`);
}

async function scEnemy(page) {
    t.ok(await start(page), 'PLAYING 진입');
    // The old 120px/160ms bot mixed the 32px tile calibration with the current
    // 24px game. Read every game frame in-page so a short shell state is captured
    // before the next Node/browser round trip. Assertions still inspect the game.
    const r = await exerciseShell(page, TILE);
    if (r.error) {
        t.ok(false, r.error + ' — ' + JSON.stringify(r));
        return;
    }
    const { initial, approach, stomp, kick, travel, index } = r;
    t.ok(approach.active > 0, '적 활성화 범위 동작');
    t.eq(stomp.kinds[index], 'r', '관측 대상은 셸로 변하는 롤스톤');
    t.eq(stomp.stomps - initial.stomps, 1, '한 번 밟으면 한 번만 판정 (중복 없음)');
    t.ok(stomp.score - approach.score >= 100, '밟기 점수 획득');
    t.eq(stomp.states[index], 1, '밟힌 적이 셸 정지 상태(1)');
    t.eq(stomp.vxs[index], 0, '정지한 셸의 속도 0');
    t.eq(kick.kicks - initial.kicks, 1, '정지한 셸 차기');
    t.eq(travel.deaths, initial.deaths, '셸 차기는 피격이 아니다');
    t.eq(kick.states[index], 2, '차인 셸이 이동 상태(2)');
    t.ok(Math.abs(kick.vxs[index]) > 0, '차인 셸의 속도');
    t.ok(Math.abs(travel.xs[index] - kick.xs[index]) > TILE * 2.5, '차인 셸이 실제로 날아간다');
}

async function scHurt(page) {
    t.ok(await start(page), 'PLAYING 진입');
    // 정면으로 달려들어 측면 접촉 피격 → 사망 (BASE 상태)
    await down(page, 'KeyX');
    await down(page, 'ArrowRight');
    let died = false;
    for (let i = 0; i < 90 && !died; i++) {
        await page.waitForTimeout(100);
        const s = await snap(page);
        if (s.state === ST.DYING || s.dbg_deaths > 0) died = true;
    }
    await release(page);
    const s1 = await snap(page);
    t.ok(died, `측면 접촉으로 피격·사망 (deaths=${s1.dbg_deaths})`);
    t.eq(s1.death_cause, DEATH.ENEMY, '사망 원인 = 적 접촉(2)');
    // 사망 연출 → 재시작. 목숨은 **연출이 끝나는 시점**에 줄어든다 (원작과 같은
    // 순서) — DYING 중에 읽으면 아직 3 이다.
    let back = false;
    for (let i = 0; i < 80 && !back; i++) {
        await page.waitForTimeout(100);
        if ((await snap(page)).state === ST.PLAYING) back = true;
    }
    const s2 = await snap(page);
    t.ok(back, '사망 후 자동 재시작 → PLAYING 복귀');
    t.eq(s2.lives, 2, '사망으로 목숨 1 감소 (연출 종료 시점)');
    t.eq(s2.power, 0, '재시작 시 파워 초기화');
    t.ok(s2.invuln > 0 || s2.dbg_restarts >= 1, '재시작 카운터 증가');
}

async function scFallDeath(page) {
    t.ok(await start(page), 'PLAYING 진입');
    // 61~62 열 구멍까지 간다. 도중의 적은 뛰어 넘고(jump 허용), 구멍 **직전**에서
    // 멈춘 다음 걸어서 떨어진다. jump:false 로 가면 28 열 적에게 먼저 죽어
    // death_cause 가 추락이 아니라 적 접촉이 된다 (실측).
    const arrived = await runTo(page, 58, { run: false, budgetMs: 90_000 });
    t.ok(arrived, '구멍 앞(58 열) 도달');
    await release(page);
    await page.waitForTimeout(300);
    await down(page, 'ArrowRight');
    let fell = false;
    for (let i = 0; i < 90 && !fell; i++) {
        await page.waitForTimeout(100);
        const s = await snap(page);
        if (s.death_cause === DEATH.FALL) fell = true;
        if (s.state === ST.DYING && s.death_cause !== DEATH.FALL) break;
    }
    await release(page);
    const s1 = await snap(page);
    t.ok(fell, `구멍으로 추락 (cause=${s1.death_cause})`);
    t.eq(s1.death_cause, DEATH.FALL, '사망 원인 = 추락(1)');
    t.ok(s1.py < 20000, `사망 연출 중 좌표 폭주 없음 (py=${s1.py.toFixed(0)})`);
}

async function scFastFall(page) {
    t.ok(await start(page), 'PLAYING 진입');
    // 134~138 열의 대(臺)에서 떨어뜨린다. 여기가 스테이지에서 가장 높은 발판이라
    // 낙하 속도를 가장 크게 만든다. 언덕(96 열)에서는 높이가 3 칸뿐이라 maxVy 가
    // MAX_FALL 에 못 미쳐 클램프를 실제로 시험하지 못했다.
    // **행은 데이터에서 찾는다.** 리터럴(행 2)로 두면 스케일이 바뀔 때 도달 불가한
    // 임계값이 되어 봇이 발판에 못 오르고 그대로 구멍까지 흘러간다 (Phase 2-1 실측).
    const PLAT_ROW = surfaceRow(136);
    const ok = await runTo(page, 136, { run: true, budgetMs: 180_000 });
    t.ok(ok, `최고 발판(136 열, 행 ${PLAT_ROW}) 도달`);
    // 발판 위로 올라선다 — 아래에서 도착했을 수 있다.
    // 발판 표면 위에 서면 py = PLAT_ROW*TILE 이다. 한 칸 여유를 준다.
    for (let k = 0; k < 20; k++) {
        const s = await snap(page);
        if (s.py <= (PLAT_ROW + 1) * TILE) break;
        await down(page, 'ArrowUp');
        await page.waitForTimeout(300);
        await up(page, 'ArrowUp');
        await down(page, 'ArrowRight');
        await page.waitForTimeout(120);
        await up(page, 'ArrowRight');
        await page.waitForTimeout(300);
    }
    // 높이를 확보하려고 크게 뛴 뒤 자유낙하시킨다 — 최대 낙하 속도를 만든다.
    // 발판 오른쪽 끝(138 열)에서 걸어 나가 자유낙하시킨다. 139 열은 행 7 지면이라
    // 구멍이 아니고 안전하게 착지한다. 낙하가 시작되면 **키를 놓는다** — 계속
    // 오른쪽으로 밀면 뒤쪽 구멍까지 흘러가 추락사하고, 그때 py 가 DYING 클램프
    // (ROWS+4)*TILE=416 이 되어 착지 좌표 검사가 엉뚱한 값을 본다 (실측: floor=null).
    await down(page, 'ArrowRight');
    for (let k = 0; k < 40; k++) {
        await page.waitForTimeout(50);
        if ((await snap(page)).grounded === 0) break;
    }
    await release(page);
    let maxVy = 0, tunneled = false;
    for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(60);
        const s = await snap(page);
        if (s.state !== ST.PLAYING) break;
        if (s.vy > maxVy) maxVy = s.vy;
        // 바닥 2 줄은 통짜다. 마지막 행 아래로 내려가면 관통이다.
        if (s.py > (ROWS - 1) * TILE + 8) tunneled = true;
        if (s.grounded === 1 && i > 6) break;              // 착지 완료
    }
    await release(page);
    await page.waitForTimeout(400);
    t.eq((await snap(page)).state, ST.PLAYING, '낙하 도중 사망하지 않음 (제자리 낙하)');
    const s2 = await snap(page);
    t.ok(maxVy > PHYS.MAX_FALL * 0.33, `충분히 빠른 낙하 발생 (maxVy=${maxVy.toFixed(1)})`);
    t.ok(maxVy <= PHYS.MAX_FALL + 0.01,
        `낙하 속도 MAX_FALL(${PHYS.MAX_FALL}) 로 제한 (maxVy=${maxVy.toFixed(2)})`);
    t.ok(!tunneled, '빠른 낙하에서도 바닥 관통 없음');
    // 착지 좌표는 **그 자리의 바닥**과 일치해야 한다. 평지 값으로 고정해서 보면
    // 언덕 위에 착지했을 때 오판정한다 — 확인할 성질은 "관통 없이
    // 타일 표면에 정확히 멈췄는가"다.
    const floorY = await page.evaluate(([TILE, ROWS]) => {
        const SOLID = '#=B?uPp';
        const rows = Entry.variableContainer.lists_.find(v => v.name_ === 'lvl')
            .array_.map(o => String(o.data));
        const V = (n) => Number(Entry.variableContainer.variables_.find(x => x.name_ === n).getValue());
        // py 는 **발밑** 좌표다. 언덕 위에 있으면 py/TILE 이 행 범위를 벗어나
        // 스캔이 한 번도 돌지 않는다 → floor=null. 발밑 바로 아래 행부터,
        // 행 인덱스로 정규화해서 찾는다.
        const pc = Math.floor(V('px') / TILE);
        const feetRow = Math.min(ROWS - 1, Math.round(V('py') / TILE));
        for (let r = feetRow; r < ROWS; r++) {
            if (SOLID.indexOf((rows[r] || '')[pc] || '.') >= 0) return r * TILE;
        }
        return null;
    }, [TILE, ROWS]);
    t.eq(s2.grounded, 1, '낙하 후 접지');
    t.eq(s2.py, floorY, `착지 좌표가 그 자리 타일 표면과 일치 (py=${s2.py}, floor=${floorY})`);
}

async function scCheckpoint(page) {
    t.ok(await start(page), 'PLAYING 진입');
    const ok = await runTo(page, 182, { run: true, budgetMs: 200_000 });
    const s1 = await snap(page);
    t.ok(ok, `체크포인트 열(178) 통과 (px=${s1.px.toFixed(0)})`);
    t.eq(s1.dbg_checkpoint, 1, '체크포인트 활성화');
    t.ok(s1.checkpoint_col > 3, `재시작 지점 이동 (checkpoint_col=${s1.checkpoint_col})`);
    // 197 열의 파괴 불가 적에게 정면 접촉 → 사망 후 체크포인트에서 부활
    await down(page, 'ArrowRight');
    let died = false;
    for (let i = 0; i < 90 && !died; i++) {
        await page.waitForTimeout(100);
        if ((await snap(page)).state === ST.DYING) died = true;
    }
    await release(page);
    t.ok(died, '체크포인트 이후 사망 발생');
    let back = false;
    for (let i = 0; i < 90 && !back; i++) {
        await page.waitForTimeout(100);
        if ((await snap(page)).state === ST.PLAYING) back = true;
    }
    const s3 = await snap(page);
    t.ok(back, '사망 후 재시작');
    t.ok(s3.px > 170 * TILE,
        `체크포인트 위치에서 부활 (px=${s3.px.toFixed(0)} > ${170 * TILE})`);
}

async function scTimeout(page) {
    t.ok(await start(page), 'PLAYING 진입');
    // 400 초를 실제로 기다릴 수 없다. **남은 시간만** 줄이고 타임아웃 판정은
    // 게임 로직이 스스로 하게 둔다 (death_cause 를 강제로 넣지 않는다).
    await page.evaluate(() => {
        const v = Entry.variableContainer.variables_.find(x => x.name_ === 'time_left');
        v.setValue(2);
    });
    let timed = false;
    for (let i = 0; i < 60 && !timed; i++) {
        await page.waitForTimeout(200);
        const s = await snap(page);
        if (s.death_cause === DEATH.TIMEOUT) timed = true;
    }
    const s1 = await snap(page);
    t.ok(timed, `시간 초과 판정 (death_cause=${s1.death_cause})`);
    t.eq(s1.time_left, 0, '남은 시간 0');
    t.ok(s1.state === ST.DYING || s1.state === ST.READY || s1.state === ST.PLAYING,
        `시간 초과 후 사망 흐름 진입 (state=${s1.state})`);
}

async function scRestartHygiene(page) {
    t.ok(await start(page), 'PLAYING 진입');
    const lens0 = await page.evaluate(() =>
        Entry.variableContainer.lists_.map(l => [l.name_, l.array_.length]));
    const clones0 = await page.evaluate(() => Entry.container.getAllObjects().length);
    for (let k = 0; k < 3; k++) {
        await runFresh(page);
        await page.waitForTimeout(400);
        await holdKey(page, 'Enter', 150);
        await page.waitForTimeout(1200);
        await down(page, 'ArrowRight');
        await page.waitForTimeout(600);
        await release(page);
    }
    const lens1 = await page.evaluate(() =>
        Entry.variableContainer.lists_.map(l => [l.name_, l.array_.length]));
    const clones1 = await page.evaluate(() => Entry.container.getAllObjects().length);
    t.eq(lens1, lens0, '3 회 재시작 후 리스트 길이 변화 없음 (슬롯 덮어쓰기 구조)');
    t.eq(clones1, clones0, `3 회 재시작 후 오브젝트/복제 증가 없음 (${clones0})`);
    const s = await snap(page);
    t.eq(s.lives, 3, '재시작 후 목숨 초기화');
    t.eq(s.score, 0, '재시작 후 점수 초기화');
    t.ok(s.state === ST.PLAYING, '재시작 후 정상 플레이 상태');
}

// ── [13] 셸 연쇄 처치 ───────────────────────────────────────────
// 116·122 열의 walker 두 마리가 8 칸 간격이라 한 화면에 함께 들어온다.
// 앞의 것을 밟아 셸로 만든 뒤 오른쪽으로 차면 뒤의 것을 맞힌다
// (요구사항 F: 이동 중인 셸이 다른 적을 연쇄 처치).
//
// 봇 조작에서 어려운 지점 두 가지 — 둘 다 실측으로 확인한 것이다:
//  ① **차기 방향을 통제해야 한다.** spec 은 접촉 프레임에서 `px < en_x` 면
//     오른쪽(+SHELL_KICK), 아니면 왼쪽으로 찬다. 밟은 직후 플레이어는 셸과
//     같은 열(±2px)이라 어느 쪽이 될지 모른다. 왼쪽으로 차이면 그 방향의
//     적(104 열)이 화면 활성 범위(±64px) 밖으로 나가 셸이 얼어붙고 연쇄가
//     일어나지 않는다 (실측: chain=0).
//  ② **찬 뒤 즉시 물러나야 한다.** 이동 중인 셸은 몸통 접촉이 피격이라,
//     14px 거리에서 차면 다음 프레임에 죽는다 (실측: 차자마자 state=4).
// 그래서 밟기 → 왼쪽으로 충분히 이동(≈70px) → 걸어 들어가 차기 → 방향에 따라
// 반대쪽으로 대피 순서로 진행한다. 한 번에 못 되면 다시 밟아 재시도한다.
async function scChainKill(page) {
    t.ok(await start(page), 'PLAYING 진입');
    // 108 열까지만 간다. 112 를 목표로 하면 runTo 가 이동 중에 116·122 열 적을
    // 이미 밟아 셸로 만들어 버려(실측: 도착 시 slot5 가 s1) 연쇄용 두 마리가
    // 남지 않는다.
    t.ok(await runTo(page, 108, { run: true, budgetMs: 90_000 }), '116·122 열 적 앞(108) 도달');

    let chain = 0, everStomped = false, sawShell = false, sawTarget = false;
    let kvx = null, moved = false;

    // 전략은 **차기 방향을 게임에 맞춘다.** 실측으로 확정된 사실 두 가지:
    //  ① 차기 방향은 접촉 프레임의 `px < en_x` 로 정해지고, 밟기 직후 플레이어는
    //     항상 셸의 **오른쪽**에 있다 (왼쪽에서 접근하고 적이 왼쪽으로 걸어오니
    //     접촉이 그렇게 끝난다) → 차기는 **언제나 왼쪽**이다. 밟힌 프레임에 즉시
    //     왼쪽 키를 걸어도 가속이 0.074/frame 이라 잠금 10 프레임 안에 접촉 폭
    //     26px 을 못 넘는다 (실측: onStomp 로 눌러도 vx=-6).
    //  ② `sc` 연쇄 함수의 표적 조건은 `en_state < 3` — **정지한 셸도 표적**이다.
    // 그래서 왼쪽에 표적을 만든다: 앞의 적(116 열)을 밟아 셸로 세워 두고, 그
    // 셸을 넘어가 뒤의 적(122 열)을 밟은 뒤 왼쪽으로 차면 먼저 세운 셸에 맞는다.
    for (let round = 0; round < 2 && chain === 0; round++) {
        if (Number((await snap(page)).state) !== ST.PLAYING) break;

        // 1) 첫 번째 적을 밟아 **왼쪽 표적용 셸**로 세운다.
        const r1 = await stompNext(page, { tries: 4 });
        await release(page);
        if (r1.stomped) everStomped = true;
        if (r1.shellAtStomp < 0) continue;
        sawShell = true;
        const anchor = r1.shellAtStomp;

        // 2) 그 셸을 **넘어간다.** 걸어 들어가면 차 버려서 표적이 날아간다.
        //    오른쪽을 누른 채 뛰어 셸 위를 지나간다 — 착지 때 다시 밟으면
        //    셸이 그대로 멈춘 상태를 유지하므로(밟기 → state 1) 해가 없다.
        for (let hop = 0; hop < 8; hop++) {
            const d = await page.evaluate(() => {
                const V = (n) => Number(Entry.variableContainer.variables_.find(x => x.name_ === n).getValue());
                const LST = (n) => Entry.variableContainer.lists_.find(x => x.name_ === n).array_.map(o => Number(o.data));
                return { px: V('px'), state: V('state'), es: LST('en_state'), ex: LST('en_x') };
            });
            if (d.state !== ST.PLAYING) break;
            if (d.es[anchor] !== 1) break;              // 차였거나 부활했다
            if (d.px > d.ex[anchor] + 48) break;        // 넘어갔다
            await down(page, 'ArrowRight');
            await down(page, 'ArrowUp');
            await page.waitForTimeout(220);
            await up(page, 'ArrowUp');
            await page.waitForTimeout(260);
        }
        await release(page);
        const passed = await page.evaluate((a) => {
            const V = (n) => Number(Entry.variableContainer.variables_.find(x => x.name_ === n).getValue());
            const LST = (n) => Entry.variableContainer.lists_.find(x => x.name_ === n).array_.map(o => Number(o.data));
            return V('px') > LST('en_x')[a] && LST('en_state')[a] === 1;
        }, anchor);
        if (!passed) continue;

        // 3) 두 번째 적(122 열)을 밟아 셸로 만든다 — 이게 **차서 날릴** 셸이다.
        const r2 = await stompNext(page, { tries: 4 });
        await release(page);
        // 방금 밟은 셸은 anchor 가 아닌 다른 슬롯이어야 한다. findIndex 는 앞의
        // 슬롯(anchor)을 먼저 찾으므로 명시적으로 제외해서 고른다.
        const shellIdx = r2.estAtStomp
            ? r2.estAtStomp.findIndex((v, i) => v === 1 && i !== anchor)
            : -1;
        if (shellIdx < 0) continue;
        const shx0 = r2.exAtStomp[shellIdx];

        // 4) 차기 **전에** 왼쪽 표적이 화면 안(10 칸)에 살아 있는지 확인한다.
        //    차고 나서 보면 이미 연쇄로 죽어(state 3) 못 찾는다. 셸(state 1)도
        //    표적이므로 `< 3` 으로 본다 (sc 함수와 같은 조건).
        const hasLeftTarget = r2.exAtStomp.some((x, i) =>
            i !== shellIdx && r2.estAtStomp[i] < 3 && x < shx0 && shx0 - x < 10 * TILE);
        if (hasLeftTarget) sawTarget = true;

        // 5) 걸어 들어가 찬다. 차인 **순간**의 속도·좌표를 한 번의 evaluate 로
        //    잡는다 — 나중에 읽으면 표적과 충돌한 뒤라 vx 가 0 으로 정리돼 있다.
        //    걷는 방향은 **셸의 상대 위치로** 정한다. 오른쪽으로 고정하면 안 된다:
        //    밟기 반동으로 플레이어가 셸을 지나쳐 오른쪽에 서는 경우가 있어
        //    (실측: px=3856, 셸 3831) 오른쪽 탭이 셸에서 **멀어져** 40 회를
        //    소진하고 149 열까지 흘러갔다 (kicks=0).
        const before = await snap(page);
        let kicked = false;
        for (let i = 0; i < 40 && !kicked; i++) {
            const pre = await page.evaluate((si) => {
                const V = (n) => Number(Entry.variableContainer.variables_.find(x => x.name_ === n).getValue());
                const LST = (n) => Entry.variableContainer.lists_.find(x => x.name_ === n).array_.map(o => Number(o.data));
                return { px: V('px'), sx: LST('en_x')[si] };
            }, shellIdx);
            const toward = pre.px < pre.sx ? 'ArrowRight' : 'ArrowLeft';
            await down(page, toward); await page.waitForTimeout(60); await up(page, toward);
            const d = await page.evaluate((si) => {
                const V = (n) => Number(Entry.variableContainer.variables_.find(x => x.name_ === n).getValue());
                const LST = (n) => Entry.variableContainer.lists_.find(x => x.name_ === n).array_.map(o => Number(o.data));
                return { state: V('state'), kicks: V('dbg_kicks'),
                         est: LST('en_state')[si], vx: LST('en_vx')[si], x: LST('en_x')[si] };
            }, shellIdx);
            if (d.state !== ST.PLAYING) break;
            if (d.kicks > before.dbg_kicks) {
                kicked = true;
                kvx = d.vx;
                if (Math.abs(d.x - shx0) > 4) moved = true;
                break;
            }
            if (d.est !== 1) break;                     // 부활했다
            await page.waitForTimeout(30);
        }
        if (!kicked) continue;

        // 6) 셸이 간 방향의 **반대쪽으로** 대피한다 (이동 중 셸 = 몸통 접촉 사망).
        const away = kvx !== null && kvx < 0 ? 'ArrowRight' : 'ArrowLeft';
        await down(page, away);
        await page.waitForTimeout(400);
        await up(page, away);

        // 7) 셸이 표적을 맞힐 때까지 기다린다. 셸 속도 6px/f 로 10 칸이면
        //    50 프레임(≈0.9 초) 안에 닿는다 — 넉넉히 본다.
        for (let i = 0; i < 60; i++) {
            await page.waitForTimeout(100);
            const s = await snap(page);
            chain = Number(s.dbg_chain_kills);
            if (chain > 0 || s.state !== ST.PLAYING) break;
            if (Math.abs(kvx) > 0 && !moved) {
                const nx = Number((await L(page, 'en_x'))[shellIdx]);
                if (Math.abs(nx - shx0) > 4) moved = true;
            }
        }
    }

    t.ok(everStomped, '적 밟기 성공');
    t.ok(sawShell, '밟은 적이 셸이 됐다');
    t.ok(sawTarget, '차기 방향(왼쪽) 10 칸 안에 표적 적 존재');
    t.ok(kvx !== null && Math.abs(kvx) > 2,
        `차인 셸이 확실한 속도로 튀어나간다 (vx=${kvx === null ? '-' : kvx.toFixed(1)})`);
    t.ok(moved, '차인 셸이 실제로 이동했다');
    t.ok(chain > 0, `이동 중인 셸이 다른 적을 연쇄 처치 (chain_kills=${chain})`);
    // 연쇄 점수는 밟기(100) 보다 커야 한다 (요구사항 F: 연속 처치 점수 상승)
    const sEnd = await snap(page);
    t.ok(Number(sEnd.score) >= 300, `연쇄 점수 상승 (score=${sEnd.score})`);
}

// ── [15] 발사체(빔) 능력 ────────────────────────────────────────
// 136 열 보상 블록의 beam 아이템을 먹고 X 로 발사 → 적 처치.
// 스파이크샤드(197 열)는 발사체로 죽지 않는다는 구분까지 확인한다.
async function scBeam(page) {
    t.ok(await start(page), 'PLAYING 진입');
    t.ok(await runTo(page, 130, { run: true, budgetMs: 120_000 }), '빔 블록 앞(130) 도달');

    // 136 열 / 2 행 보상 블록을 아래에서 머리로 친다.
    const used0 = Number((await snap(page)).dbg_rewards_used);
    let got = false;
    for (const col of [136, 135, 137, 134]) {
        await goTo(page, col * TILE + TILE / 2, { tol: 14, maxTicks: 60 });
        await down(page, 'ArrowUp');
        await page.waitForTimeout(320);
        await up(page, 'ArrowUp');
        await page.waitForTimeout(500);
        if (Number((await snap(page)).dbg_rewards_used) > used0) { got = true; break; }
    }
    t.ok(got, '빔 보상 블록 타격');

    // 솟아오른 아이템을 쫓아가 먹는다 — 살아있는 슬롯을 찾아 그 방향으로 이동.
    let power = Number((await snap(page)).power);
    for (let i = 0; i < 80 && power < 2; i++) {
        const s = await snap(page);
        if (s.state !== ST.PLAYING) break;
        const alive = (await L(page, 'it_alive')).map(Number);
        const idx = alive.findIndex(v => v === 1);
        if (idx < 0) { await page.waitForTimeout(100); power = Number((await snap(page)).power); continue; }
        const ix = Number((await L(page, 'it_x'))[idx]);
        const dir = s.px < ix ? 'ArrowRight' : 'ArrowLeft';
        await down(page, dir);
        await page.waitForTimeout(140);
        await up(page, dir);
        power = Number((await snap(page)).power);
    }
    t.eq(power, 2, `빔 등급 획득 (power=${power})`);

    // X 로 발사한다.
    const b0 = await snap(page);
    for (let i = 0; i < 6; i++) {
        await holdKey(page, 'KeyX', 90);
        await page.waitForTimeout(180);
    }
    const b1 = await snap(page);
    t.ok(Number(b1.dbg_shots) > Number(b0.dbg_shots),
        `X 로 발사체 생성 (shots=${b1.dbg_shots})`);

    // 다음 적(180 열)을 향해 이동하며 계속 쏘아 처치를 확인한다.
    let kills = Number(b1.dbg_shot_kills);
    for (let i = 0; i < 120 && kills === 0; i++) {
        const s = await sense(page);
        if (s.state !== ST.PLAYING) break;
        if (s.en !== null && s.en < 260) {
            await release(page);
            for (let k = 0; k < 4; k++) {
                await holdKey(page, 'KeyX', 80);
                await page.waitForTimeout(150);
            }
        } else {
            await down(page, 'ArrowRight');
            await page.waitForTimeout(110);
            await up(page, 'ArrowRight');
        }
        kills = Number((await snap(page)).dbg_shot_kills);
    }
    await release(page);
    t.ok(kills > 0, `발사체로 적 처치 (shot_kills=${kills})`);
}

// ── [16] 골 도달 → 클리어 → 다음 흐름 ───────────────────────────
async function scGoal(page) {
    t.ok(await start(page), 'PLAYING 진입');
    // 먼저 42 열 성장 아이템을 먹는다 — 266·271·276 열 walker 3 연속 구간을
    // BASE 등급으로는 통과하지 못했다 (grabGrow 주석의 실측 근거).
    const big = await grabGrow(page);
    t.ok(big, `성장 아이템 획득 후 출발 (power=${(await snap(page)).power})`);
    // 시간 여유를 위해 목표까지 달린다 (350 열). 도중 사망하면 runTo 가 재시도한다.
    const arrived = await runTo(page, 350, { run: true, budgetMs: 300_000 });
    const s1 = await snap(page);
    t.ok(arrived, `골(350 열) 도달 (px=${s1.px.toFixed(0)})`);
    if (!arrived) return;

    let cleared = false;
    for (let i = 0; i < 60 && !cleared; i++) {
        await page.waitForTimeout(150);
        const s = await snap(page);
        if (s.state === ST.CLEAR || Number(s.dbg_clear) > 0) cleared = true;
    }
    const s2 = await snap(page);
    t.ok(cleared, `STAGE_CLEAR 진입 (state=${s2.state}, dbg_clear=${s2.dbg_clear})`);

    // 클리어 연출 뒤 ENDING → TITLE 로 이어지는 끊김 없는 순환 (요구사항 A)
    let next = null;
    for (let i = 0; i < 120; i++) {
        await page.waitForTimeout(150);
        const st = Number((await snap(page)).state);
        if (st === 7 || st === ST.TITLE) { next = st; break; }
    }
    t.ok(next !== null, `클리어 후 다음 상태로 전이 (state=${next})`);

    // 타이틀에서 Enter 로 다시 시작할 수 있어야 한다 (순환 확인)
    for (let i = 0; i < 80; i++) {
        await page.waitForTimeout(150);
        if (Number((await snap(page)).state) === ST.TITLE) break;
    }
    await holdKey(page, 'Enter', 150);
    let replay = false;
    for (let i = 0; i < 40 && !replay; i++) {
        await page.waitForTimeout(150);
        if (Number((await snap(page)).state) === ST.PLAYING) replay = true;
    }
    t.ok(replay, '클리어 후 타이틀 → Enter → 재플레이 가능 (끊김 없는 순환)');
}

// ── 진입점 ──────────────────────────────────────────────────────

// 진단용 — 임시 스크립트가 이동 헬퍼를 재사용할 수 있게 내보낸다.
export { runTo, sense as senseFor, start as startGame };

export const SCENARIOS = [
    ['부팅·타이틀·HUD', scBoot],
    ['좌우 이동·걷기/달리기·관성', scMove],
    ['가변 점프 높이', scJump],
    ['좌우 벽 충돌', scWalls],
    ['천장 머리박기·보상 블록·벽돌 조건부 파괴·파워업', scCeilingAndBlocks],
    ['카메라 스크롤·월드 좌표', scCamera],
    ['적 밟기·셸 정지·차기', scEnemy],
    ['측면 접촉 피격·사망·재시작', scHurt],
    ['추락 사망', scFallDeath],
    ['고속 낙하 바닥 관통 방지', scFastFall],
    ['체크포인트·부활 위치', scCheckpoint],
    ['시간 초과', scTimeout],
    ['반복 재시작 위생 (복제/리스트 증가 없음)', scRestartHygiene],
    ['셸 연쇄 처치', scChainKill],
    ['발사체(빔) 획득·발사·적 처치', scBeam],
    ['골 도달·클리어·순환', scGoal],
];

export async function runSelected(indices) {
    console.log(`Brick Kingdom L4 런타임 검증 — ${FIXTURE}`);
    for (const i of indices) {
        const sc = SCENARIOS[i];
        if (!sc) continue;
        await trial(`[${i}] ${sc[0]}`, sc[1]);
    }
    if (totalErrors.length) {
        console.log('\n페이지 에러:');
        totalErrors.slice(0, 10).forEach(e => console.log('  ', e));
    }
    return t.summary();
}

// ── 전체 실행: 시나리오마다 **자식 프로세스** ────────────────────
//
// 한 프로세스 안에서 13 개를 연달아 돌리면 뒤쪽 시나리오가 무너진다: 10 번째
// 브라우저쯤부터 키 이벤트가 게임에 도달하지 않아 플레이어가 스폰 지점
// (px=112) 에서 한 칸도 못 움직인다. 같은 시나리오를 단독 실행하면 통과한다
// → **게임 결함이 아니라 하네스 누적 문제**다. 그래서 시나리오를 프로세스로
// 격리한다. 부수 효과로 하나가 hang 해도 나머지가 진행된다.
async function runAllIsolated() {
    const { spawn } = await import('node:child_process');
    const here = process.argv[1];
    let pass = 0, fail = 0;
    console.log(`Brick Kingdom L4 런타임 검증 — ${FIXTURE}`);
    console.log(`시나리오 ${SCENARIOS.length} 개를 각각 새 프로세스에서 실행한다.\n`);
    for (let i = 0; i < SCENARIOS.length; i++) {
        const code = await new Promise((resolve) => {
            const args = [here, '--only', String(i)];
            if (argEnt >= 0) args.push('--ent', FIXTURE);
            const ch = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let buf = '';
            const tap = (d) => {
                buf += d.toString();
                const lines = buf.split('\n');
                buf = lines.pop();
                for (const ln of lines) {
                    if (/^\s*[✓✗]/.test(ln)) {
                        console.log(ln);
                        if (ln.includes('✓')) pass++; else fail++;
                    } else if (ln.startsWith('──')) {
                        console.log('\n' + ln);
                    }
                }
            };
            ch.stdout.on('data', tap);
            ch.stderr.on('data', (d) => process.stderr.write(d));
            ch.on('close', resolve);
        });
        if (code !== 0 && code !== 4) {
            console.log(`  ✗ [${i}] ${SCENARIOS[i][0]}: 프로세스 비정상 종료 (code=${code})`);
            fail++;
        }
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    return fail === 0 ? 0 : 4;
}

// 직접 실행 시: --only N 이면 그 시나리오 하나만, 없으면 전체를 격리 실행.
if (process.argv[1] && process.argv[1].endsWith('verify.mjs')) {
    const onlyIdx = process.argv.indexOf('--only');
    if (onlyIdx >= 0) {
        process.exit(await runSelected([Number(process.argv[onlyIdx + 1])]));
    } else {
        process.exit(await runAllIsolated());
    }
}
