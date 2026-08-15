// 육각형 육목 (HeXO 엔트리판) — 무한 판 + 로컬/온라인 대전
//
// 기획: 기획/설계.md · 원본: https://hexo.did.science/ (규칙만 차용, 구현은 엔트리 최적화)
//
// 규칙
//   · 무한 육각 판. 육각 3축 중 하나에 자기 돌 6개 연속이면 승리.
//   · 오프닝 균형: 선공(노랑)은 중앙에 1개만 자동 착수 → 이후 양쪽 매 턴 2개씩.
//
// 좌표계 — **축좌표(axial) q, r**
//   오프셋(행·열)에서는 이웃 계산에 행 홀짝 보정이 붙는데, 무한 판에서는 좌표가 음수로
//   내려가면서 그 보정이 틀리기 쉽다. 축좌표는 6방향이 **상수 오프셋**이라 보정이 없다.
//     E(+1,0) W(-1,0) · SE(0,+1) NW(0,-1) · NE(+1,-1) SW(-1,+1)
//   승리 3축 = 위 세 쌍. 화면 좌표는 x = W·(q + r/2), y = -RH·r.
//
// 저장 — **착수 기록(sparse)**, 격자 배열이 아니다
//   무한 판은 배열로 담을 수 없다. `$수` 리스트에 놓인 돌만 `키*10 + 색` 으로 쌓는다.
//   키 = (q+512)*1024 + (r+512) → 항상 0 이상이라 나눗셈·나머지가 단순해진다.
//   빈 칸 조회는 리스트 훑기(꼬리재귀)지만 돌이 수십 개라 격자 전체 스캔보다 싸다.
//   ⚠️ 리스트 append 는 여럿이 동시에 하면 유실된다 — **턴제라서** 안전하다(knowledge/08 §2).
//
// 엔트리 최적화
//   1. 판은 **배경 이미지 1장**이고 **움직이지 않는다**. 화면 좌표를 뷰 기준 상대값으로
//      계산하므로 어느 칸이 가운데로 와도 같은 격자 위에 떨어진다 — 스크롤은 돌이
//      움직이는 것으로 표현된다.
//   2. 순회는 전부 `fn.value` 꼬리재귀. `repeat` 는 1회에 1프레임이라 쓸 수 없다.
//   3. 다시 그리는 건 **뷰나 착수 수가 바뀔 때만**. 매 프레임 재배치하지 않는다.
//
// 온라인은 "지금 내가 놓을 수 있나"(`$턴 == 내슬롯`) 한 줄만 다르다 → knowledge/08.

import {
    when, repeat, if_, cmp, calc, or_, quotient, mod, getVar, setVar, changeVar,
    wait, waitUntil, stopRepeat,
    valueAt, addToList, removeFromList, lengthOfList, show, hide, locateXY, changeShape,
    combine, txt, strLen, getNickname, isPressed, createClone, removeAllClones,
    startScene, writeText, fn, call,
    obj, scene as makeScene, pictureFromGen,
} from '../../tools/lib/spec-dsl.mjs';
import { hexBoard, hexLayout, hexagon, hexOutline } from '../../tools/lib/sprite-gen.mjs';

// ══════════════════════════════════════════════════════════════════
//  ⚠️  온라인 대전을 켜려면 이 한 줄만 바꾸면 된다.
//
//  online.205.kr 에 이 작품을 등록한 **Entry Online 계정 ID**.
//  형식: 영소문자·숫자·밑줄 3~20자 (확장의 normalizeOwnerId 규칙).
//  값이 비어 있거나 형식이 틀리면 확장이 INVALID_OWNER_ID 로 입장을 거부하고,
//  대기 화면이 그대로 멈춘다.
//
//  .ent 를 다시 만들지 않고 고치려면: 엔트리 편집기에서 `대기` 장면의
//  `안내` 오브젝트 → `$입장( ... )` 블록 안의 글자를 바꾸면 된다.
// ══════════════════════════════════════════════════════════════════
const EO_OWNER_ID = 'change_me';

// ── 화면에 깔리는 격자 (판 이미지) ────────────────────────────────

const VIEW_COLS = 13, VIEW_ROWS = 11, SIZE = 13;
const L = hexLayout(VIEW_COLS, VIEW_ROWS, SIZE);
const W = L.W, RH = L.RH;

const BOARD_PIC = hexBoard(VIEW_COLS, VIEW_ROWS, SIZE, {
    fill: '#26324a', stroke: '#3c4b66', strokeWidth: 1.1,
    bg: '#161d2c', bgRadius: 12,
});
const BW = BOARD_PIC.dimension.width, BH = BOARD_PIC.dimension.height;
const BOARD_Y = -5;

// 뷰 원점 칸(= 화면 한가운데 칸)이 놓이는 stage 좌표.
// 판 이미지의 가운데 육각형과 정확히 맞아야 돌이 칸 위에 앉는다.
const CENTRE_ROW = (VIEW_ROWS + 1) / 2, CENTRE_COL = (VIEW_COLS + 1) / 2;
const ORIGIN_X = -BW / 2 + L.cx(CENTRE_ROW, CENTRE_COL);
const ORIGIN_Y = BOARD_Y + BH / 2 - L.cy(CENTRE_ROW);

// 커서가 이 밖으로 나가려 하면 뷰가 한 칸 따라간다(= 무한 스크롤).
const LIMX = 112, LIMY = 78;
// 판 이미지를 벗어난 돌은 그리지 않는다.
const CLIPX = 140, CLIPY = 100;

// 착수 기록 인코딩 — 키를 0 이상으로 유지해 quotient/mod 를 단순하게 쓴다.
const KOFF = 512, KSPAN = 1024;
const MAX_MOVES = 1000;   // 동기화 리스트 상한(1024)에 닿기 전에 무승부 처리

// ── 빌드 타임 검산 — 격자·화면 대응이 어긋나면 여기서 잡는다 ──────
{
    const rel = (q, r) => [W * (q + r / 2), -RH * r];
    // 6 방향 이웃은 모두 셀 폭만큼 떨어져 있어야 한다.
    for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]) {
        const [x, y] = rel(dq, dr);
        const d = Math.hypot(x, y);
        if (Math.abs(d - W) > 0.01) {
            throw new Error(`축좌표 이웃 오류: (${dq},${dr}) 거리 ${d.toFixed(3)} ≠ ${W.toFixed(3)}`);
        }
    }
    // ↑↓ 지그재그가 실제로 제자리로 돌아오는지 (홀짝 번갈아 NE/NW)
    const up = (q, r) => (((r % 2) + 2) % 2 === 0 ? [q + 1, r - 1] : [q, r - 1]);
    const down = (q, r) => (((r % 2) + 2) % 2 === 0 ? [q, r + 1] : [q - 1, r + 1]);
    for (let r = -4; r <= 4; r++) {
        const [uq, ur] = up(0, r);
        const [bq, br] = down(uq, ur);
        if (bq !== 0 || br !== r) throw new Error(`↑↓ 왕복 불일치: r=${r}`);
        const [x] = rel(uq - 0, ur - r);
        if (Math.abs(Math.abs(x) - W / 2) > 0.01) throw new Error(`↑ 가로 이동량 이상: r=${r}`);
    }
    // 스크롤 한계 안의 커서는 항상 판 안에 있어야 한다.
    if (ORIGIN_X + LIMX > BW / 2 || ORIGIN_X - LIMX < -BW / 2) throw new Error('LIMX 가 판 밖');
    if (LIMY + Math.abs(ORIGIN_Y - BOARD_Y) > BH / 2) throw new Error('LIMY 가 판 밖');
    if (CLIPX <= LIMX || CLIPY <= LIMY) throw new Error('그리기 범위가 스크롤 한계보다 좁다');
}

// ── 색·글꼴 ──────────────────────────────────────────────────────

const YELLOW = '#f2c14e', BLUE = '#4a9bf5';
const INK = '#e8eef8', MUTED = '#8ea0bd';
const STONE_R = 9.6, CURSOR_R = 12;

const PAGE_BG = {
    svgString:
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270" width="480" height="270">` +
        `<defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="#0d1220"/><stop offset="1" stop-color="#18213a"/>` +
        `</linearGradient></defs><rect width="480" height="270" fill="url(#pg)"/></svg>`,
    dimension: { width: 480, height: 270 },
    imageType: 'svg',
};

// 글상자 엔티티. x=0 + lineBreak:true + textAlign:0 이 가운데 정렬의 정답이다
// (regX 는 textBox 에서 강제 0, textAlign 은 0 이 가운데 — knowledge/07).
const tbox = (x, y, w, h, fontPx, colour, opts = {}) => ({
    x, y, regX: 0, regY: 0, scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
    width: w, height: h, font: `${fontPx}px NanumGothic`, colour,
    textAlign: 0, lineBreak: true, visible: opts.visible !== false,
    ...(opts.bgColor ? { bgColor: opts.bgColor } : {}),
});

// 시작 장면(로비)은 실행 시 when_scene_start 가 발화하지 않는다 — when_run 과 이중으로 건다
// (knowledge/07 §when_scene_start 는 시작 시 첫 장면에서 발화 안 함).
const dualStart = (makeBody) => [
    [when.run(), ...makeBody()],
    [when.sceneStart(), ...makeBody()],
];

// 대국을 시작하기 **직전**(아직 다른 장면일 때) 지난 판의 종료 표시를 지운다.
//
// 대국 장면 안에서 지우면 안 된다 — 같은 프레임에 깨어나는 다른 오브젝트가 지난 판의
// `$승자`/`상태` 를 먼저 읽어 곧바로 결과 장면으로 튄다. 오브젝트 간 실행 순서는
// 보장되지 않으므로 "장면이 바뀌기 전에 끝내 두는" 방식만 확실하다.
const resetGame = () => [
    setVar('winner', 0),
    setVar('state', 0),
    setVar('walk', 0),
];

// ── 변수 ─────────────────────────────────────────────────────────
// `$` = Entry Online 동기화 대상. 그 외는 각자 로컬 — 실수로 `$` 를 붙이면
// 8Hz 로 상대에게 방송된다.

const variables = [
    // 동기화되는 대국 상태 — 지금 턴인 쪽만 쓴다 (knowledge/08 §2 쓰기 소유권)
    { id: 'turn',   name: '$턴',      value: '1', visible: false, x: 10, y: 10 },
    { id: 'left',   name: '$남은돌',   value: '1', visible: false, x: 10, y: 34 },
    { id: 'last1',  name: '$최근수1',  value: '0', visible: false, x: 10, y: 58 },
    { id: 'last2',  name: '$최근수2',  value: '0', visible: false, x: 10, y: 82 },
    { id: 'winner', name: '$승자',     value: '0', visible: false, x: 10, y: 106 },
    { id: 'ply',    name: '$수순',     value: '0', visible: false, x: 10, y: 130 },
    { id: 'nick1',  name: '$닉네임1',  value: ' ', visible: false, x: 10, y: 154 },
    { id: 'nick2',  name: '$닉네임2',  value: ' ', visible: false, x: 10, y: 178 },

    // 확장이 값을 써 주는 예약 이름. 이름·종류가 정확해야 하며 확장은 없으면 만들지 않는다.
    { id: 'ext',   name: '$확장프로그램', value: '0', visible: false, x: 150, y: 10 },
    { id: 'slot',  name: '$유저번호',     value: '0', visible: false, x: 150, y: 34 },
    { id: 'roomn', name: '$방인원수',     value: '0', visible: false, x: 150, y: 58 },

    // 로컬 전용 (동기화 안 함)
    { id: 'cq',     name: '커서q',   value: '0', visible: false, x: 300, y: 10 },
    { id: 'cr',     name: '커서r',   value: '0', visible: false, x: 300, y: 34 },
    { id: 'vq',     name: '뷰q',     value: '0', visible: false, x: 300, y: 58 },
    { id: 'vr',     name: '뷰r',     value: '0', visible: false, x: 300, y: 82 },
    { id: 'myslot', name: '내슬롯',   value: '1', visible: false, x: 300, y: 106 },
    { id: 'mode',   name: '모드',     value: '0', visible: false, x: 300, y: 130 },
    { id: 'state',  name: '상태',     value: '0', visible: false, x: 300, y: 154 },
    { id: 'held',   name: '누름유지', value: '0', visible: false, x: 300, y: 178 },
    { id: 'sink',   name: '버림',     value: '0', visible: false, x: 300, y: 202 },
    { id: 'hint',   name: '안내',     value: '0', visible: false, x: 420, y: 10 },
    { id: 'walk',   name: '이탈승',   value: '0', visible: false, x: 420, y: 34 },
    { id: 'stones', name: '돌수',     value: '0', visible: false, x: 420, y: 58 },
    // 마지막으로 화면에 그린 상태 — 이 셋이 그대로면 다시 그릴 이유가 없다.
    { id: 'dvq', name: '그린뷰q',  value: '999999', visible: false, x: 420, y: 82 },
    { id: 'dvr', name: '그린뷰r',  value: '999999', visible: false, x: 420, y: 106 },
    { id: 'dn',  name: '그린돌수', value: '-1',     visible: false, x: 420, y: 130 },
];

const lists = [
    // 착수 기록 — 항목 하나가 돌 하나(`키*10 + 색`). 무한 판이라 격자를 담지 않는다.
    { id: 'moves', name: '$수', array: [], visible: false, x: 10, y: 10 },
    // 확장 예약 리스트(방 모드에서 슬롯별 "연결"/"끊김")
    { id: 'conn', name: '$유저연결상태', array: [], visible: false, x: 120, y: 10 },
];

// ── 좌표 헬퍼 (빌드 타임에 블록 트리를 만든다) ────────────────────
// 같은 트리를 두 슬롯에 재사용하면 안 되므로 매번 새로 만든다.

const keyOf = (q, r) => calc(calc(calc(q, '+', KOFF), '*', KSPAN), '+', calc(r, '+', KOFF));
const dqExpr = () => calc(getVar('cq'), '-', getVar('vq'));
const drExpr = () => calc(getVar('cr'), '-', getVar('vr'));
// 뷰 원점 기준 상대 화면 좌표
const relX = (dq, dr) => calc(W, '*', calc(dq, '+', calc(dr, '/', 2)));
const relY = (dr) => calc(-RH, '*', dr);
const curX = () => relX(dqExpr(), drExpr());
const curY = () => relY(drExpr());

// ── 함수 ─────────────────────────────────────────────────────────

// (q,r) 칸의 색. 없으면 0. 착수 기록을 훑는다 — 놓인 돌 수만큼만 돈다.
const fnCellAt = fn.value('cellat', ['q', 'r', 'i'],
    (q, r, i, V) => [
        V.set('o', 0),
        if_(cmp(i, '<=', lengthOfList('moves')), [
            V.set('v', valueAt('moves', i)),
            if_(cmp(quotient(V.get('v'), 10), '==', keyOf(q, r)), [
                V.set('o', mod(V.get('v'), 10)),
            ], [
                V.set('o', call('cellat', q, r, calc(i, '+', 1))),
            ]),
        ]),
    ],
    (q, r, i, V) => V.get('o'),
    ['o', 'v']);

// (q,r) 에서 (dq,dr) 방향으로 이어지는 같은 색 돌 수(자기 자신 제외, 최대 5).
// 축좌표라 방향이 상수 오프셋이다 — 행 홀짝 보정이 없다.
const fnRun = fn.value('runlen', ['q', 'r', 'dq', 'dr', 'col', 'n'],
    (q, r, dq, dr, col, n, V) => [
        V.set('o', n),
        if_(cmp(n, '<', 5), [
            V.set('nq', calc(q, '+', dq)),
            V.set('nr', calc(r, '+', dr)),
            if_(cmp(call('cellat', V.get('nq'), V.get('nr'), 1), '==', col), [
                V.set('o', call('runlen', V.get('nq'), V.get('nr'), dq, dr, col, calc(n, '+', 1))),
            ]),
        ]),
    ],
    (q, r, dq, dr, col, n, V) => V.get('o'),
    ['o', 'nq', 'nr']);

// (q,r) 을 지나는 3축 중 하나라도 6연속이면 1. 자기 자신(1) + 양방향 합 ≥ 5.
const fnWin = fn.value('winat', ['q', 'r', 'col'],
    (q, r, col, V) => [
        V.set('o', 0),
        V.set('a', calc(call('runlen', q, r, 1, 0, col, 0), '+', call('runlen', q, r, -1, 0, col, 0))),
        if_(cmp(V.get('a'), '>=', 5), [V.set('o', 1)]),
        V.set('a', calc(call('runlen', q, r, 0, 1, col, 0), '+', call('runlen', q, r, 0, -1, col, 0))),
        if_(cmp(V.get('a'), '>=', 5), [V.set('o', 1)]),
        V.set('a', calc(call('runlen', q, r, 1, -1, col, 0), '+', call('runlen', q, r, -1, 1, col, 0))),
        if_(cmp(V.get('a'), '>=', 5), [V.set('o', 1)]),
    ],
    (q, r, col, V) => V.get('o'),
    ['o', 'a']);

// 착수 기록 비우기(새 대국). 리스트를 통째로 지우는 블록이 없어 앞에서부터 걷어낸다.
const fnClearMoves = fn.value('clrmv', ['x'],
    (x, V) => [
        V.set('o', 0),
        if_(cmp(lengthOfList('moves'), '>', 0), [
            removeFromList(1, 'moves'),
            V.set('o', call('clrmv', 0)),
        ]),
    ],
    (x, V) => V.get('o'),
    ['o']);

// 돌 놓기 — **기록만** 한다. 화면에 올리는 일은 렌더러 하나만 한다.
// 내 돌과 상대 돌이 같은 경로로 그려져 "내 화면에만 보이는 돌"이 생기지 않는다.
const fnPlace = fn.normal('place', ['q', 'r', 'col'],
    (q, r, col) => [
        addToList(calc(calc(keyOf(q, r), '*', 10), '+', col), 'moves'),
        setVar('last2', getVar('last1')),
        setVar('last1', keyOf(q, r)),
    ]);

// 착수 시도 — 대국 규칙 전부가 여기 모인다.
const fnTry = fn.normal('tryp', ['q', 'r'],
    (q, r) => [
        if_(cmp(getVar('state'), '==', 1), [
            // 온라인은 `$턴 == 내슬롯`, 로컬은 매 턴 내슬롯을 $턴에 맞춰 두므로 항상 참.
            if_(cmp(getVar('turn'), '==', getVar('myslot')), [
                if_(cmp(call('cellat', q, r, 1), '==', 0), [
                    call('place', q, r, getVar('turn')),
                    if_(cmp(call('winat', q, r, getVar('turn')), '==', 1), [
                        setVar('winner', getVar('turn')),
                        setVar('state', 2),
                    ], [
                        changeVar('left', -1),
                        if_(cmp(getVar('left'), '<=', 0), [
                            setVar('turn', calc(3, '-', getVar('turn'))),
                            setVar('left', 2),
                            changeVar('ply', 1),
                            if_(cmp(getVar('mode'), '==', 0), [
                                setVar('myslot', getVar('turn')),
                            ]),
                        ]),
                        // 무한 판이라 판이 찰 일은 없지만 동기화 리스트 상한은 있다.
                        if_(cmp(lengthOfList('moves'), '>=', MAX_MOVES), [
                            setVar('winner', 3),
                            setVar('state', 2),
                        ]),
                    ]),
                ]),
            ]),
        ]),
    ]);

// 커서가 화면 끝에 닿으면 뷰가 한 칸 따라간다 = 무한 스크롤.
// 세로를 먼저 맞추고 가로를 다시 계산한다 — 뷰 r 이 바뀌면 가로 위치도 반 칸 움직인다.
//
// 마지막에 커서를 **바로** 옮긴다. 이동 분기 뒤에는 키 반복을 막는 0.11초 대기가 있어서,
// 위치 갱신을 루프 끝에 두면 눌렀을 때 커서가 그만큼 늦게 따라온다.
// ⚠️ 커서 오브젝트의 스레드에서만 부를 것 — 블록은 실행 중인 오브젝트에 작용한다.
const fnFitView = fn.normal('fitview', [],
    () => [
        if_(cmp(curY(), '>', LIMY), [changeVar('vr', -1)]),
        if_(cmp(curY(), '<', -LIMY), [changeVar('vr', 1)]),
        if_(cmp(curX(), '>', LIMX), [changeVar('vq', 1)]),
        if_(cmp(curX(), '<', -LIMX), [changeVar('vq', -1)]),
        locateXY(calc(ORIGIN_X, '+', curX()), calc(ORIGIN_Y, '+', curY())),
    ]);

// 렌더러 — 착수 기록을 훑어 **화면 안에 드는 돌만** 그린다.
// ⚠️ 돌 오브젝트의 스레드에서만 부를 것: 블록은 실행 중인 오브젝트에 작용하므로
// 다른 오브젝트가 부르면 그 오브젝트가 움직이고 복제된다.
const fnDraw = fn.value('draw', ['i'],
    (i, V) => [
        V.set('o', 0),
        if_(cmp(i, '<=', lengthOfList('moves')), [
            V.set('v', valueAt('moves', i)),
            V.set('k', quotient(V.get('v'), 10)),
            V.set('dq', calc(quotient(V.get('k'), KSPAN), '-', calc(KOFF, '+', getVar('vq')))),
            V.set('dr', calc(mod(V.get('k'), KSPAN), '-', calc(KOFF, '+', getVar('vr')))),
            V.set('x', relX(V.get('dq'), V.get('dr'))),
            V.set('y', relY(V.get('dr'))),
            // 판 밖은 그리지 않는다. and_ 는 단락 평가가 없어 중첩 if_ 로 쌓는다.
            if_(cmp(V.get('x'), '>=', -CLIPX), [if_(cmp(V.get('x'), '<=', CLIPX), [
                if_(cmp(V.get('y'), '>=', -CLIPY), [if_(cmp(V.get('y'), '<=', CLIPY), [
                    // 템플릿을 목표 모양·자리로 맞춘 뒤 복제 — 클론이 그 상태를 물려받는다.
                    // 전역에 담아 when_clone_start 에서 읽으면 한 프레임에 만든 것들이 겹친다.
                    changeShape(mod(V.get('v'), 10)),
                    locateXY(calc(ORIGIN_X, '+', V.get('x')), calc(ORIGIN_Y, '+', V.get('y'))),
                    createClone('self'),
                ])]),
            ])]),
            V.set('o', call('draw', calc(i, '+', 1))),
        ]),
    ],
    (i, V) => V.get('o'),
    ['o', 'v', 'k', 'dq', 'dr', 'x', 'y']);

// Entry Online 확장 후킹 지점 — 본문은 비어 있어야 한다. 확장이 이 함수의 호출을
// 가로채 방에 입장/퇴장한다. 표시명에 `$` 가 들어가야 하므로 id 와 label 을 분리한다.
const fnJoin = fn.normal('eojoin', ['eoid'], () => [], [], { label: '$입장' });
const fnLeave = fn.normal('eoleave', [], () => [], [], { label: '$나가기' });

// ── 로비 ─────────────────────────────────────────────────────────

const SC_LOBBY = 'lobby', SC_WAIT = 'waiting', SC_GAME = 'game', SC_RESULT = 'result';

const lobbyBg = obj('lobbybg', '로비배경', {
    scene: SC_LOBBY, picture: PAGE_BG,
    entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, direction: 90, visible: true },
    threads: [[]],
});

const logo = obj('logo', 'HEXO', {
    scene: SC_LOBBY, objectType: 'textBox', text: 'HEXO',
    entity: tbox(0, 78, 300, 60, 54, INK),
    threads: [[]],
});

const subtitle = obj('subtitle', '부제', {
    scene: SC_LOBBY, objectType: 'textBox', text: '육각형 육목  ·  6개를 먼저 잇는 쪽이 승리',
    entity: tbox(0, 36, 420, 24, 15, MUTED),
    threads: [[]],
});

const btnLocal = obj('btnlocal', '로컬 플레이', {
    scene: SC_LOBBY, objectType: 'textBox', text: '로컬 플레이',
    entity: tbox(0, -12, 210, 38, 19, '#0d1220', { bgColor: '#f2c14e' }),
    threads: [
        [when.objectClick(),
            setVar('mode', 0),
            ...resetGame(),
            startScene(SC_GAME)],
    ],
});

// 온라인 버튼은 확장이 로드돼 `$확장프로그램` 이 0 이 아닐 때만 열린다.
// 확장이 125ms 마다 이 값을 다시 쓰므로 계속 폴링하면 설치 후 새로고침에서 저절로 풀린다.
//
// ⚠️ 잠금 표현에 투명도 효과를 쓸 수 없다 — 엔트리는 `entity.effect` 를 **sprite 에만**
// 초기화해서(entity.js:42-48) 글상자에 효과 블록을 걸면 스레드가 죽는다.
// 그래서 잠김/열림을 **버튼 오브젝트 2개**의 show/hide 로 표현한다.
const btnOnline = obj('btnonline', '온라인 플레이', {
    scene: SC_LOBBY, objectType: 'textBox', text: '온라인 플레이',
    entity: tbox(0, -62, 210, 38, 19, '#0d1220', { bgColor: '#4a9bf5', visible: false }),
    threads: [
        ...dualStart(() => [
            repeat.inf([
                if_(cmp(getVar('ext'), '!=', 0), [show()], [hide()]),
                wait(0.2),
            ]),
        ]),
        [when.objectClick(),
            setVar('mode', 1),
            startScene(SC_WAIT)],
    ],
});

const btnOnlineLocked = obj('btnonlocked', '온라인 플레이 (잠김)', {
    scene: SC_LOBBY, objectType: 'textBox', text: '온라인 플레이 (잠김)',
    entity: tbox(0, -62, 210, 38, 19, '#8ea0bd', { bgColor: '#333d52' }),
    threads: [
        ...dualStart(() => [
            repeat.inf([
                if_(cmp(getVar('ext'), '!=', 0), [hide()], [show()]),
                wait(0.2),
            ]),
        ]),
        [when.objectClick(), setVar('hint', 1)],
    ],
});

const lobbyHint = obj('lobbyhint', '안내문', {
    scene: SC_LOBBY, objectType: 'textBox', text: ' ',
    entity: tbox(0, -106, 460, 40, 13, MUTED),
    threads: [
        ...dualStart(() => [
            setVar('hint', 0),
            repeat.inf([
                if_(cmp(getVar('hint'), '==', 1), [
                    writeText(txt('온라인 대전에는 Entry Online 확장 프로그램이 필요합니다. 작품 설명란을 참고하세요.')),
                ], [
                    if_(cmp(getVar('hint'), '==', 2), [
                        writeText(txt('상대가 나가서 대국이 끝났습니다.')),
                    ], [
                        writeText(txt('방향키로 칸 이동  ·  스페이스로 착수  ·  판은 끝없이 이어집니다')),
                    ]),
                ]),
                wait(0.2),
            ]),
        ]),
    ],
});

// ── 대기 장면 (온라인 전용) ──────────────────────────────────────

const waitBg = obj('waitbg', '대기배경', {
    scene: SC_WAIT, picture: PAGE_BG,
    entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, direction: 90, visible: true },
    threads: [[]],
});

const waitTitle = obj('waittitle', '대기제목', {
    scene: SC_WAIT, objectType: 'textBox', text: '상대를 찾는 중',
    entity: tbox(0, 52, 420, 40, 28, INK),
    threads: [[]],
});

// 입장 → 슬롯 배정 대기 → 대국. 취소는 `모드` 를 0 으로 돌려 이 루프를 깬다.
// 정원(2)이 찰 때까지 방은 잠기지 않고 `$유저번호` 도 0 이다 — 상대가 영영 안 오면
// 영원히 기다리므로 **취소 버튼이 반드시 있어야 한다**(참조 샘플이 빠뜨린 부분).
const waitStatus = obj('waitstatus', '안내', {
    scene: SC_WAIT, objectType: 'textBox', text: ' ',
    entity: tbox(0, 6, 440, 26, 14, MUTED),
    threads: [
        [when.sceneStart(),
            setVar('myslot', 0),
            setVar('walk', 0),
            call('eojoin', txt(EO_OWNER_ID)),
            repeat.inf([
                if_(cmp(getVar('mode'), '!=', 1), [stopRepeat()]),
                if_(cmp(getVar('slot'), '!=', 0), [stopRepeat()]),
                wait(0.1),
            ]),
            if_(cmp(getVar('mode'), '==', 1), [
                if_(cmp(getVar('slot'), '!=', 0), [
                    setVar('myslot', getVar('slot')),
                    // 닉네임은 각자 자기 칸에만 쓴다(리스트 한 칸씩 나눠 쓰면 통째 덮어쓰기로 유실).
                    if_(cmp(strLen(getNickname()), '>', 0), [
                        if_(cmp(getVar('myslot'), '==', 1), [
                            setVar('nick1', getNickname()),
                        ], [
                            setVar('nick2', getNickname()),
                        ]),
                    ]),
                    ...resetGame(),
                    startScene(SC_GAME),
                ]),
            ])],

        [when.sceneStart(),
            repeat.inf([
                if_(cmp(getVar('ext'), '==', 0), [
                    writeText(txt('확장 프로그램을 찾을 수 없습니다.')),
                ], [
                    writeText(combine(txt('접속 인원 '), combine(getVar('roomn'), txt(' / 2   ·   상대가 들어오면 시작합니다')))),
                ]),
                wait(0.2),
            ])],
    ],
});

const btnCancel = obj('btncancel', '취소', {
    scene: SC_WAIT, objectType: 'textBox', text: '취소',
    entity: tbox(0, -58, 150, 34, 17, '#e8eef8', { bgColor: '#333d52' }),
    threads: [
        [when.objectClick(),
            setVar('mode', 0),
            call('eoleave'),
            setVar('hint', 0),
            startScene(SC_LOBBY)],
    ],
});

// ── 게임 장면 ────────────────────────────────────────────────────

const gameBg = obj('gamebg', '게임배경', {
    scene: SC_GAME, picture: PAGE_BG,
    entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, direction: 90, visible: true },
    threads: [[]],
});

// 판 이미지는 **움직이지 않는다**. 화면 좌표를 뷰 기준 상대값으로 계산하므로 어느 칸이
// 가운데로 와도 격자 위에 정확히 떨어진다 — 스크롤은 돌이 움직이는 것으로 표현된다.
const boardObj = obj('board_img', '판', {
    scene: SC_GAME, picture: BOARD_PIC,
    entity: { x: 0, y: BOARD_Y, scaleX: 1, scaleY: 1, direction: 90, visible: true },
    threads: [[]],
});

// 돌 — 템플릿은 숨겨 두고 클론만 화면에 나온다.
// 대국 초기화도 이 오브젝트가 맡는다. removeAllClones 는 **자기 클론만** 지우므로
// (block_flow.js) 돌 오브젝트가 직접 불러야 한다.
const stone = obj('stone', '돌', {
    scene: SC_GAME,
    pictures: [
        pictureFromGen(hexagon(STONE_R, YELLOW), { id: 'pc_y', name: '노랑돌' }),
        pictureFromGen(hexagon(STONE_R, BLUE), { id: 'pc_b', name: '파랑돌' }),
    ],
    entity: { x: 0, y: -400, scaleX: 1, scaleY: 1, direction: 90, visible: false },
    threads: [
        // 초기화와 렌더러를 **한 스레드**에 순서대로 둔다. 별도 스레드로 두면
        // removeAllClones 가 방금 놓은 돌을 지우는 순서 사고가 난다.
        [when.sceneStart(),
            setVar('state', 0),
            removeAllClones(),
            setVar('cq', 0), setVar('cr', 0),
            setVar('vq', 0), setVar('vr', 0),
            setVar('held', 0),
            // 그린 상태를 무효화해 첫 패스에서 반드시 다시 그리게 한다.
            setVar('dvq', 999999), setVar('dvr', 999999), setVar('dn', -1),

            // 판을 세우는 쪽은 하나뿐이다 — 로컬이면 나, 온라인이면 선공(슬롯 1).
            // 후공까지 초기화하면 상대가 세운 판을 지워 버린다.
            if_(cmp(getVar('mode'), '==', 0), [setVar('myslot', 1)]),
            if_(cmp(getVar('myslot'), '==', 1), [
                setVar('sink', call('clrmv', 0)),
                setVar('winner', 0),
                setVar('last1', 0),
                setVar('last2', 0),
                // 오프닝: 선공(노랑)은 중앙(0,0)에 1개만. 이후 후공부터 매 턴 2개.
                call('place', 0, 0, 1),
                setVar('turn', 2),
                setVar('left', 2),
                setVar('ply', 1),
            ], [
                // 후공은 **선공이 세운 판이 실제로 도착할 때까지** 기다린다.
                // 수순 같은 카운터로 판단하면 지난 대국의 값이 남아 있어 앞질러 시작한다 —
                // "기록된 돌이 정확히 1개" 는 눈에 보이는 사실이라 흔들리지 않는다.
                repeat.inf([
                    if_(cmp(lengthOfList('moves'), '==', 1), [stopRepeat()]),
                    wait(0.1),
                ]),
            ]),
            // 로컬은 핫싯 — 차례가 넘어갈 때마다 내가 그 차례가 된다.
            if_(cmp(getVar('mode'), '==', 0), [setVar('myslot', getVar('turn'))]),
            setVar('state', 1),

            // 렌더러 — 상대가 놓은 돌이 화면에 나타나는 유일한 경로이자,
            // 뷰가 움직였을 때 판 전체를 다시 앉히는 경로다.
            repeat.inf([
                setVar('stones', lengthOfList('moves')),
                if_(or_(or_(
                    cmp(getVar('vq'), '!=', getVar('dvq')),
                    cmp(getVar('vr'), '!=', getVar('dvr'))),
                    cmp(getVar('stones'), '!=', getVar('dn'))), [
                    removeAllClones(),
                    setVar('sink', call('draw', 1)),
                    setVar('dvq', getVar('vq')),
                    setVar('dvr', getVar('vr')),
                    setVar('dn', getVar('stones')),
                ]),
                wait(0.06),
            ])],

        // 자리와 모양은 복제될 때 이미 물려받았다 — 여기서 전역을 읽으면 race 가 난다.
        [when.cloneStart(),
            show()],
    ],
});

// 커서 — 방향키 이동과 스페이스 착수. 두 스레드로 나눠 이동 대기(wait)가
// 착수 입력을 막지 않게 한다.
//
// ↑↓ 를 축좌표에서 한 방향으로 고정하면 계속 한쪽으로 밀린다. 행 홀짝에 따라
// NE/NW 를 번갈아 밟으면 화면에서는 **곧게 위아래로** 움직이는 것처럼 보인다.
// 엔트리의 나머지 연산은 floor 기반(`left - right*floor(left/right)`)이라
// 음수 r 에서도 홀짝이 정확하다.
const cursor = obj('cursor', '커서', {
    scene: SC_GAME, picture: hexOutline(CURSOR_R, '#ffffff', 2.4),
    entity: { x: 0, y: BOARD_Y, scaleX: 1, scaleY: 1, direction: 90, visible: true },
    threads: [
        [when.sceneStart(),
            show(),
            repeat.inf([
                if_(cmp(getVar('state'), '==', 1), [
                    if_(isPressed(37), [
                        changeVar('cq', -1),
                        call('fitview'),
                        wait(0.11),
                    ]),
                    if_(isPressed(39), [
                        changeVar('cq', 1),
                        call('fitview'),
                        wait(0.11),
                    ]),
                    if_(isPressed(38), [
                        if_(cmp(mod(getVar('cr'), 2), '==', 0), [changeVar('cq', 1)]),
                        changeVar('cr', -1),
                        call('fitview'),
                        wait(0.11),
                    ]),
                    if_(isPressed(40), [
                        if_(cmp(mod(getVar('cr'), 2), '!=', 0), [changeVar('cq', -1)]),
                        changeVar('cr', 1),
                        call('fitview'),
                        wait(0.11),
                    ]),
                ]),
                locateXY(calc(ORIGIN_X, '+', curX()), calc(ORIGIN_Y, '+', curY())),
            ])],

        // 스페이스는 눌린 순간 한 번만 — 키 반복으로 두 점이 연달아 놓이면 안 된다.
        [when.sceneStart(),
            repeat.inf([
                if_(isPressed(32), [
                    if_(cmp(getVar('held'), '==', 0), [
                        setVar('held', 1),
                        call('tryp', getVar('cq'), getVar('cr')),
                    ]),
                ], [
                    setVar('held', 0),
                ]),
            ])],
    ],
});

const hudTurn = obj('hudturn', '차례', {
    scene: SC_GAME, objectType: 'textBox', text: ' ',
    entity: tbox(0, 120, 460, 22, 15, INK),
    threads: [
        [when.sceneStart(),
            repeat.inf([
                if_(cmp(getVar('winner'), '==', 0), [
                    if_(cmp(getVar('turn'), '==', 1), [
                        writeText(combine(txt('● 노랑 차례   ·   남은 돌 '), getVar('left'))),
                    ], [
                        writeText(combine(txt('● 파랑 차례   ·   남은 돌 '), getVar('left'))),
                    ]),
                ], [
                    writeText(txt('대국 종료')),
                ]),
                wait(0.1),
            ])],
    ],
});

const hudHelp = obj('hudhelp', '조작안내', {
    scene: SC_GAME, objectType: 'textBox', text: '방향키 이동  ·  스페이스 착수  ·  한 축에 6개를 먼저 이으면 승리',
    entity: tbox(0, -127, 470, 14, 10, MUTED),
    threads: [
        [when.sceneStart(),
            repeat.inf([
                if_(cmp(getVar('mode'), '==', 1), [
                    if_(cmp(getVar('myslot'), '==', 1), [
                        writeText(txt('나 = 노랑(선공)   ·   끝까지 가면 판이 따라 움직입니다')),
                    ], [
                        writeText(txt('나 = 파랑(후공)   ·   끝까지 가면 판이 따라 움직입니다')),
                    ]),
                ], [
                    writeText(txt('방향키 이동  ·  스페이스 착수  ·  한 축에 6개를 먼저 이으면 승리')),
                ]),
                wait(0.4),
            ])],
    ],
});

// 승부가 나면 결과 장면으로. 온라인이면 상대 이탈도 감시한다.
const gameFlow = obj('gameflow', '진행', {
    scene: SC_GAME, objectType: 'textBox', text: ' ',
    entity: tbox(-460, -260, 20, 20, 10, MUTED, { visible: false }),
    threads: [
        // `$승자` 를 본다 — **진 쪽에서도** 결과 장면으로 넘어가야 하기 때문이다.
        // 로컬 변수인 `상태` 는 이긴 쪽에서만 2 가 되므로 그것만 보면 패자는 대국 화면에
        // 남는다. 여기서 `상태` 를 2 로 올려 패자의 입력도 함께 잠근다.
        [when.sceneStart(),
            waitUntil(cmp(getVar('winner'), '!=', 0)),
            setVar('state', 2),
            wait(1.3),
            startScene(SC_RESULT)],

        // 상대 이탈 = 부전승. `$유저연결상태` 는 슬롯 순서대로 "연결"/"끊김" 이고
        // 방이 잠기기 전에는 비어 있으므로 길이를 먼저 확인한다 —
        // and_ 는 단락 평가가 없어 한 줄로 묶으면 범위 밖 접근이 먼저 터진다.
        [when.sceneStart(),
            repeat.inf([
                if_(cmp(getVar('mode'), '==', 1), [
                    if_(cmp(getVar('state'), '==', 1), [
                        if_(cmp(lengthOfList('conn'), '>=', 2), [
                            if_(cmp(valueAt('conn', calc(3, '-', getVar('myslot'))), '==', txt('끊김')), [
                                setVar('walk', 1),
                                setVar('winner', getVar('myslot')),
                                setVar('state', 2),
                            ]),
                        ]),
                    ]),
                ]),
                wait(0.3),
            ])],
    ],
});

// ── 결과 장면 ────────────────────────────────────────────────────

const resultBg = obj('resultbg', '결과배경', {
    scene: SC_RESULT, picture: PAGE_BG,
    entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, direction: 90, visible: true },
    threads: [[]],
});

const resultText = obj('resulttext', '결과', {
    scene: SC_RESULT, objectType: 'textBox', text: ' ',
    entity: tbox(0, 40, 440, 60, 40, INK),
    threads: [
        [when.sceneStart(),
            repeat.inf([
                if_(cmp(getVar('mode'), '==', 1), [
                    // 온라인은 내 슬롯 기준으로 승/패를 말한다.
                    if_(cmp(getVar('winner'), '==', 3), [
                        writeText(txt('무승부')),
                    ], [
                        if_(cmp(getVar('winner'), '==', getVar('myslot')), [
                            writeText(txt('승리!')),
                        ], [
                            writeText(txt('패배')),
                        ]),
                    ]),
                ], [
                    if_(cmp(getVar('winner'), '==', 1), [
                        writeText(txt('노랑 승리!')),
                    ], [
                        if_(cmp(getVar('winner'), '==', 2), [
                            writeText(txt('파랑 승리!')),
                        ], [
                            writeText(txt('무승부')),
                        ]),
                    ]),
                ]),
                wait(0.3),
            ])],
    ],
});

const resultSub = obj('resultsub', '결과부제', {
    scene: SC_RESULT, objectType: 'textBox', text: ' ',
    entity: tbox(0, -8, 440, 24, 14, MUTED),
    threads: [
        [when.sceneStart(),
            if_(cmp(getVar('walk'), '==', 1), [
                writeText(txt('상대가 나가서 대국이 끝났습니다')),
            ], [
                writeText(combine(txt('총 '), combine(getVar('ply'), txt(' 수만에 끝났습니다')))),
            ])],
    ],
});

const btnAgain = obj('btnagain', '다시 하기', {
    scene: SC_RESULT, objectType: 'textBox', text: '다시 하기',
    entity: tbox(0, -62, 190, 38, 18, '#0d1220', { bgColor: '#f2c14e' }),
    threads: [
        [when.objectClick(),
            // 온라인 대국이었으면 방을 정리하고 로비로. 같은 방을 재사용하지 않는다.
            if_(cmp(getVar('mode'), '==', 1), [call('eoleave')]),
            setVar('mode', 0),
            setVar('walk', 0),
            setVar('hint', 0),
            startScene(SC_LOBBY)],
    ],
});

// ── spec ─────────────────────────────────────────────────────────

export default {
    name: '육각형 육목',
    scenes: [
        makeScene(SC_LOBBY, '로비'),
        makeScene(SC_WAIT, '대기'),
        makeScene(SC_GAME, '대국'),
        makeScene(SC_RESULT, '결과'),
    ],
    variables,
    lists,
    functions: [
        fnCellAt, fnRun, fnWin, fnClearMoves, fnPlace, fnTry, fnFitView, fnDraw,
        fnJoin, fnLeave,
    ],
    objects: [
        // 리스트 순서 = z-order (앞이 위). 배경이 마지막.
        logo, subtitle, btnLocal, btnOnline, btnOnlineLocked, lobbyHint, lobbyBg,
        waitTitle, waitStatus, btnCancel, waitBg,
        hudTurn, hudHelp, gameFlow, cursor, stone, boardObj, gameBg,
        resultText, resultSub, btnAgain, resultBg,
    ],
};
