// 육각형 육목 (HeXO 엔트리판) — Phase 1: 로비 + 로컬 대국 + 결과
//
// 기획: 기획/설계.md · 원본: https://hexo.did.science/ (규칙만 차용, 구현은 엔트리 최적화)
//
// 규칙
//   · 13열 × 11행 벌집 판(고정). 육각 3축 중 하나에 자기 돌 6개 연속이면 승리.
//   · 오프닝 균형: 선공(노랑)은 중앙에 1개만 자동 착수 → 이후 양쪽 매 턴 2개씩.
//   · 원본의 "8칸 근접 제한"은 없앴다 — 유한 판이 같은 역할을 한다.
//
// 엔트리 최적화 3축 (기획 §0)
//   1. 판은 **배경 이미지 1장**. 칸을 오브젝트로 깔지 않는다.
//   2. **기하 계산은 전부 빌드 타임**. 이웃표(nbr)·칸 좌표(posx/posy)를 리스트로 구워
//      런타임 블록에는 나눗셈·나머지·삼각함수가 하나도 없다.
//   3. 승리 판정은 **방금 놓은 돌 주변만** 3축 양방향으로 훑는다(최대 30칸).
//      순회는 `fn.value` 꼬리재귀 — `repeat` 는 1회에 1프레임이라 쓸 수 없다
//      (knowledge/07 §반복하기 블록).
//
// 동기화 준비 (Phase 2~3)
//   `$` 접두 변수·리스트가 Entry Online 확장의 동기화 대상이다. 지금은 방에 입장하지
//   않으므로 전송되지 않고, 로컬 대국이 같은 변수를 그대로 쓴다 → 온라인은 "지금 내가
//   놓을 수 있나"(`$턴 == 내슬롯`) 한 줄만 바뀐다.

import {
    when, repeat, if_, cmp, calc, getVar, setVar, changeVar, wait, waitUntil, stopRepeat,
    valueAt, setListAt, lengthOfList, show, hide, locateXY, changeShape,
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
//  대기 화면이 "입장할 수 없습니다" 로 멈춘다.
//
//  .ent 를 다시 만들지 않고 고치려면: 엔트리 편집기에서 `대기` 장면의
//  `안내` 오브젝트 → `$입장( ... )` 블록 안의 글자를 바꾸면 된다.
// ══════════════════════════════════════════════════════════════════
const EO_OWNER_ID = 'change_me';

// ── 판 기하 (빌드 타임에만 존재) ──────────────────────────────────

const COLS = 13, ROWS = 11, SIZE = 13;
const CELLS = COLS * ROWS;                       // 143
const CENTER_R = (ROWS + 1) / 2, CENTER_C = (COLS + 1) / 2;   // 6, 7
const IDX = (r, c) => (r - 1) * COLS + c;
const CENTER = IDX(CENTER_R, CENTER_C);          // 72

const L = hexLayout(COLS, ROWS, SIZE);
const BOARD_PIC = hexBoard(COLS, ROWS, SIZE, {
    fill: '#26324a', stroke: '#3c4b66', strokeWidth: 1.1,
    bg: '#161d2c', bgRadius: 12,
});
const BW = BOARD_PIC.dimension.width, BH = BOARD_PIC.dimension.height;

const BOARD_Y = -5;                              // 판 중심 y (위 차례표시 / 아래 조작안내 자리 확보)
const X0 = -BW / 2 + L.W / 2;                    // 짝수 행 1열의 stage x
const Y0 = BOARD_Y + BH / 2 - SIZE;              // 1행의 stage y

const posOf = (r, c) => [
    X0 + (c - 1) * L.W + (r % 2) * (L.W / 2),
    Y0 - (r - 1) * L.RH,
];

// 이웃 방향 — 1=E 2=W 3=SE 4=NW 5=SW 6=NE.
// odd-r offset(홀수 행이 반 칸 오른쪽)에서 유도한 식. 부호 하나 틀리면 승리 판정이
// 조용히 어긋나므로 아래 빌드 타임 어서션으로 기하학적으로 검증한다.
const STEP = {
    1: (r, c) => [r, c + 1],
    2: (r, c) => [r, c - 1],
    3: (r, c) => [r + 1, c + (r % 2)],
    4: (r, c) => [r - 1, c - 1 + (r % 2)],
    5: (r, c) => [r + 1, c - 1 + (r % 2)],
    6: (r, c) => [r - 1, c + (r % 2)],
};
const inBoard = (r, c) => r >= 1 && r <= ROWS && c >= 1 && c <= COLS;

const POSX = [], POSY = [];
for (let r = 1; r <= ROWS; r++) {
    for (let c = 1; c <= COLS; c++) {
        const [x, y] = posOf(r, c);
        POSX.push(Number(x.toFixed(3)));
        POSY.push(Number(y.toFixed(3)));
    }
}

// nbr[(dir-1)*CELLS + cell] = 이웃 칸 번호, 판 밖이면 0.
const NBR = [];
for (let dir = 1; dir <= 6; dir++) {
    for (let r = 1; r <= ROWS; r++) {
        for (let c = 1; c <= COLS; c++) {
            const [nr, nc] = STEP[dir](r, c);
            NBR.push(inBoard(nr, nc) ? IDX(nr, nc) : 0);
        }
    }
}

// ── 빌드 타임 어서션 — 이웃표가 진짜 "인접"인지 기하로 확인 ────────
// 이웃이라고 주장하는 두 칸의 중심 거리는 정확히 셀 폭 W 여야 한다.
// 그리고 dir 과 그 반대 방향은 서로를 가리켜야 한다(대칭).
{
    const OPP = { 1: 2, 2: 1, 3: 4, 4: 3, 5: 6, 6: 5 };
    let checked = 0;
    for (let dir = 1; dir <= 6; dir++) {
        for (let cell = 1; cell <= CELLS; cell++) {
            const nx = NBR[(dir - 1) * CELLS + cell - 1];
            if (nx === 0) continue;
            const dx = POSX[nx - 1] - POSX[cell - 1];
            const dy = POSY[nx - 1] - POSY[cell - 1];
            const dist = Math.hypot(dx, dy);
            if (Math.abs(dist - L.W) > 0.02) {
                throw new Error(`이웃표 오류: dir=${dir} cell=${cell} 거리=${dist.toFixed(3)} (기대 ${L.W.toFixed(3)})`);
            }
            if (NBR[(OPP[dir] - 1) * CELLS + nx - 1] !== cell) {
                throw new Error(`이웃표 비대칭: dir=${dir} cell=${cell} → ${nx}`);
            }
            checked++;
        }
    }
    // 각 축이 판을 가로지르는 6연속을 만들 수 있는지 (판이 육목에 충분히 큰지)
    for (const dir of [1, 3, 5]) {
        let best = 0;
        for (let cell = 1; cell <= CELLS; cell++) {
            let n = 1, cur = cell;
            for (;;) {
                const nx = NBR[(dir - 1) * CELLS + cur - 1];
                if (nx === 0) break;
                n++; cur = nx;
            }
            best = Math.max(best, n);
        }
        if (best < 6) throw new Error(`축 ${dir} 최대 길이 ${best} < 6 — 판이 너무 작다`);
    }
    if (checked < CELLS * 3) throw new Error(`이웃 검사 수 이상: ${checked}`);
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
    // 동기화되는 대국 상태 — 지금 턴인 쪽만 쓴다 (기획 §5 쓰기 소유권)
    { id: 'turn',  name: '$턴',      value: '1',  visible: false, x: 10,  y: 10 },
    { id: 'left',  name: '$남은돌',   value: '1',  visible: false, x: 10,  y: 34 },
    { id: 'last1', name: '$최근수1',  value: '0',  visible: false, x: 10,  y: 58 },
    { id: 'last2', name: '$최근수2',  value: '0',  visible: false, x: 10,  y: 82 },
    { id: 'winner', name: '$승자',    value: '0',  visible: false, x: 10,  y: 106 },
    { id: 'ply',   name: '$수순',     value: '0',  visible: false, x: 10,  y: 130 },
    { id: 'nick1', name: '$닉네임1',  value: ' ',  visible: false, x: 10,  y: 154 },
    { id: 'nick2', name: '$닉네임2',  value: ' ',  visible: false, x: 10,  y: 178 },

    // 확장이 값을 써 주는 예약 이름. 이름·종류가 정확해야 하며 확장은 없으면 만들지 않는다.
    { id: 'ext',   name: '$확장프로그램', value: '0', visible: false, x: 150, y: 10 },
    { id: 'slot',  name: '$유저번호',     value: '0', visible: false, x: 150, y: 34 },
    { id: 'roomn', name: '$방인원수',     value: '0', visible: false, x: 150, y: 58 },

    // 로컬 전용 (동기화 안 함)
    { id: 'cr',      name: '커서행',   value: String(CENTER_R), visible: false, x: 300, y: 10 },
    { id: 'cc',      name: '커서열',   value: String(CENTER_C), visible: false, x: 300, y: 34 },
    { id: 'myslot',  name: '내슬롯',   value: '1', visible: false, x: 300, y: 58 },
    { id: 'mode',    name: '모드',     value: '0', visible: false, x: 300, y: 82 },
    { id: 'state',   name: '상태',     value: '0', visible: false, x: 300, y: 106 },
    { id: 'placed',  name: '놓인수',   value: '0', visible: false, x: 300, y: 130 },
    { id: 'held',    name: '누름유지', value: '0', visible: false, x: 300, y: 202 },
    { id: 'sink',    name: '버림',     value: '0', visible: false, x: 300, y: 226 },
    { id: 'hint',    name: '안내',     value: '0', visible: false, x: 420, y: 10 },
    { id: 'cleared', name: '지움감지', value: '0', visible: false, x: 420, y: 34 },
    { id: 'walk',    name: '이탈승',   value: '0', visible: false, x: 420, y: 58 },
];

const lists = [
    // 대국판 — 0=빈칸 1=노랑 2=파랑. 143칸 ≈ 300바이트로 동기화 캡(1024항목·56KB)과 무관.
    { id: 'board', name: '$보드', array: Array(CELLS).fill(0), visible: false, x: 10, y: 10 },
    // 확장 예약 리스트(방 모드에서 슬롯별 "연결"/"끊김")
    { id: 'conn',  name: '$유저연결상태', array: [], visible: false, x: 120, y: 10 },
    // 화면에 **이미 그린** 돌의 사본(로컬 전용). 판과 이 표의 차이가 곧 "새로 그릴 돌"이다.
    // 상대가 놓은 돌은 `$보드` 로만 도착하므로 이 diff 가 유일한 렌더 경로다.
    { id: 'mirror', name: '그린판', array: Array(CELLS).fill(0), visible: false, x: 60, y: 10 },
    // 빌드 타임에 구운 상수표 — 런타임 기하 계산 0
    { id: 'nbr',   name: '이웃표', array: NBR,  visible: false, x: 230, y: 10 },
    { id: 'posx',  name: '칸X',   array: POSX, visible: false, x: 340, y: 10 },
    { id: 'posy',  name: '칸Y',   array: POSY, visible: false, x: 400, y: 10 },
];

// ── 함수 ─────────────────────────────────────────────────────────

// 커서가 가리키는 칸 번호. 매번 새 블록 트리를 만든다(같은 객체를 두 슬롯에 재사용 금지).
const cidx = () => calc(calc(calc(getVar('cr'), '-', 1), '*', COLS), '+', getVar('cc'));

// 판 비우기 — 143칸을 꼬리재귀로. repeat 로 하면 143프레임(≈2.4초) 걸린다.
// 온라인에서는 **선공(슬롯 1)만** 부른다. 후공까지 부르면 상대가 놓은 판을 지운다.
const fnClearBoard = fn.value('clrb', ['i'],
    (i, V) => [
        V.set('o', 0),
        if_(cmp(i, '<=', CELLS), [
            setListAt('board', i, 0),
            V.set('o', call('clrb', calc(i, '+', 1))),
        ]),
    ],
    (i, V) => V.get('o'),
    ['o']);

// 화면 사본 비우기 — 다음 렌더 패스가 판 전체를 다시 그리게 만든다(로컬 전용).
const fnClearMirror = fn.value('clrm', ['i'],
    (i, V) => [
        V.set('o', 0),
        if_(cmp(i, '<=', CELLS), [
            setListAt('mirror', i, 0),
            V.set('o', call('clrm', calc(i, '+', 1))),
        ]),
    ],
    (i, V) => V.get('o'),
    ['o']);

// 렌더러 — `$보드` 와 `그린판` 의 차이만큼 돌 클론을 만들고, 판 위의 돌 개수를 돌려준다.
// 상대가 놓은 돌이 화면에 나타나는 유일한 경로이며, 패치를 한 번 놓쳐도 다음 패스가
// 스스로 메운다(상태 기반이라 자가 치유).
//
// 143칸 순회를 `repeat` 로 하면 143프레임이라 불가능하다 — 값 함수 꼬리재귀는 한 틱에
// 동기 실행된다(knowledge/07). 누산은 재귀 호출 **앞**에서 읽어야 한다: 안쪽 호출이
// 같은 지역변수를 덮어쓰므로 `calc(V.get('n'), '+', call(...))` 의 좌항 평가 순서에 기댄다.
const fnDraw = fn.value('draw', ['i'],
    (i, V) => [
        V.set('n', 0),
        if_(cmp(i, '<=', CELLS), [
            V.set('b', valueAt('board', i)),
            if_(cmp(V.get('b'), '!=', valueAt('mirror', i)), [
                setListAt('mirror', i, V.get('b')),
                if_(cmp(V.get('b'), '!=', 0), [
                    // 템플릿을 목표 칸의 모양·자리로 맞춘 **뒤** 복제한다. 클론은 생성 시점의
                    // 상태를 그대로 물려받으므로, 한 프레임에 여러 개를 만들어도 서로 안 섞인다.
                    // 전역 변수(그릴칸)에 담아 `when_clone_start` 에서 읽으면 마지막 값 하나로
                    // 전부 겹쳐 그려진다 — 실제로 밟은 버그다(knowledge/07 클론 초기화 race).
                    changeShape(V.get('b')),
                    locateXY(valueAt('posx', i), valueAt('posy', i)),
                    createClone('self'),
                ], [
                    // 돌이 사라진 칸 — 클론 하나만 지울 방법이 없으니 전체 재그리기를 예약한다.
                    setVar('cleared', 1),
                ]),
            ]),
            if_(cmp(V.get('b'), '!=', 0), [V.set('n', 1)]),
            V.set('n', calc(V.get('n'), '+', call('draw', calc(i, '+', 1)))),
        ]),
    ],
    (i, V) => V.get('n'),
    ['n', 'b']);

// cell 에서 dir 방향으로 이어지는 같은 색 돌의 개수(자기 자신 제외, 최대 5).
// 이웃표 덕분에 나머지 연산이 없고, 리스트 접근 전에 `nx > 0` 를 **중첩 if_** 로 막는다
// (and_ 는 단락 평가가 없어 한 줄로 묶으면 범위 밖 접근이 먼저 터진다 — knowledge/07).
const fnRun = fn.value('runlen', ['cell', 'col', 'dir', 'n'],
    (cell, col, dir, n, V) => [
        V.set('nx', valueAt('nbr', calc(calc(calc(dir, '-', 1), '*', CELLS), '+', cell))),
        V.set('o', n),
        if_(cmp(n, '<', 5), [
            if_(cmp(V.get('nx'), '>', 0), [
                if_(cmp(valueAt('board', V.get('nx')), '==', col), [
                    V.set('o', call('runlen', V.get('nx'), col, dir, calc(n, '+', 1))),
                ]),
            ]),
        ]),
    ],
    (cell, col, dir, n, V) => V.get('o'),
    ['nx', 'o']);

// cell 을 지나는 3축 중 하나라도 6연속이면 1.
// 자기 자신(1) + 양방향 합 ≥ 5 → 6개.
const fnWin = fn.value('winat', ['cell', 'col'],
    (cell, col, V) => [
        V.set('o', 0),
        V.set('a', calc(call('runlen', cell, col, 1, 0), '+', call('runlen', cell, col, 2, 0))),
        if_(cmp(V.get('a'), '>=', 5), [V.set('o', 1)]),
        V.set('a', calc(call('runlen', cell, col, 3, 0), '+', call('runlen', cell, col, 4, 0))),
        if_(cmp(V.get('a'), '>=', 5), [V.set('o', 1)]),
        V.set('a', calc(call('runlen', cell, col, 5, 0), '+', call('runlen', cell, col, 6, 0))),
        if_(cmp(V.get('a'), '>=', 5), [V.set('o', 1)]),
    ],
    (cell, col, V) => V.get('o'),
    ['o', 'a']);

// 돌 놓기 — 판에 기록하고 클론 하나를 만든다.
// createClone 은 반드시 대상 id('stone')를 명시한다. 'self' 로 두면 이 함수를 부른
// 오브젝트(커서 등)가 복제된다.
// 돌 놓기 — **판에 쓰기만** 한다. 화면에 올리는 일은 렌더러 하나만 한다.
// 내 돌과 상대 돌이 같은 경로로 그려지므로 "내 화면에만 보이는 돌" 같은 어긋남이 없다.
const fnPlace = fn.normal('place', ['cell', 'color'],
    (cell, color) => [
        setListAt('board', cell, color),
        setVar('last2', getVar('last1')),
        setVar('last1', cell),
    ]);

// 착수 시도 — 대국 규칙 전부가 여기 모인다.
const fnTry = fn.normal('tryp', ['cell'],
    (cell) => [
        if_(cmp(getVar('state'), '==', 1), [
            // 온라인은 `$턴 == 내슬롯`, 로컬은 매 턴 내슬롯을 $턴에 맞춰 두므로 항상 참.
            if_(cmp(getVar('turn'), '==', getVar('myslot')), [
                if_(cmp(valueAt('board', cell), '==', 0), [
                    call('place', cell, getVar('turn')),
                    if_(cmp(call('winat', cell, getVar('turn')), '==', 1), [
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
                        if_(cmp(getVar('placed'), '>=', CELLS), [
                            setVar('winner', 3),
                            setVar('state', 2),
                        ]),
                    ]),
                ]),
            ]),
        ]),
    ]);

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
// 초기화해서(entity.js:42-48, textBox 분기엔 setInitialEffectValue 호출이 없다) 글상자에
// 효과 블록을 걸면 `Cannot set properties of undefined (setting 'alpha')` 로 스레드가 죽는다.
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
                        writeText(txt('방향키로 칸 이동  ·  스페이스로 착수')),
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

const boardObj = obj('board_img', '판', {
    scene: SC_GAME, picture: BOARD_PIC,
    entity: { x: 0, y: BOARD_Y, scaleX: 1, scaleY: 1, direction: 90, visible: true },
    threads: [[]],
});

// 돌 — 템플릿은 숨겨 두고 클론만 화면에 나온다.
// 대국 초기화도 이 오브젝트가 맡는다. removeAllClones 는 **자기 클론만** 지우므로
// (block_flow.js) 돌 오브젝트가 직접 불러야 하고, 판 비우기·중앙 착수와 순서가
// 어긋나면 갓 놓은 중앙 돌이 지워진다 → 한 스레드에 순차로 둔다.
const stone = obj('stone', '돌', {
    scene: SC_GAME,
    pictures: [
        pictureFromGen(hexagon(STONE_R, YELLOW), { id: 'pc_y', name: '노랑돌' }),
        pictureFromGen(hexagon(STONE_R, BLUE), { id: 'pc_b', name: '파랑돌' }),
    ],
    entity: { x: 0, y: -400, scaleX: 1, scaleY: 1, direction: 90, visible: false },
    threads: [
        // 초기화와 렌더러를 **한 스레드**에 순서대로 둔다. 별도 스레드로 두면
        // removeAllClones 가 방금 놓은 중앙 돌을 지우는 순서 사고가 난다.
        [when.sceneStart(),
            setVar('state', 0),
            removeAllClones(),
            setVar('sink', call('clrm', 1)),
            setVar('cleared', 0),
            setVar('placed', 0),
            setVar('cr', CENTER_R),
            setVar('cc', CENTER_C),
            setVar('held', 0),

            // 판을 세우는 쪽은 하나뿐이다 — 로컬이면 나, 온라인이면 선공(슬롯 1).
            // 후공까지 초기화하면 상대가 세운 판을 지워 버린다.
            if_(cmp(getVar('mode'), '==', 0), [setVar('myslot', 1)]),
            if_(cmp(getVar('myslot'), '==', 1), [
                setVar('sink', call('clrb', 1)),
                setVar('winner', 0),
                setVar('last1', 0),
                setVar('last2', 0),
                // 오프닝: 선공(노랑)은 중앙에 1개만. 이후 후공부터 매 턴 2개.
                call('place', CENTER, 1),
                setVar('turn', 2),
                setVar('left', 2),
                setVar('ply', 1),
            ], [
                // 후공은 **선공이 세운 판이 실제로 도착할 때까지** 기다린다.
                // 수순 같은 카운터로 판단하면 지난 대국의 값이 남아 있어 앞질러 시작한다 —
                // "판 위의 돌이 정확히 1개" 는 눈에 보이는 사실이라 흔들리지 않는다.
                repeat.inf([
                    setVar('placed', call('draw', 1)),
                    if_(cmp(getVar('placed'), '==', 1), [stopRepeat()]),
                    wait(0.1),
                ]),
            ]),
            // 로컬은 핫싯 — 차례가 넘어갈 때마다 내가 그 차례가 된다.
            if_(cmp(getVar('mode'), '==', 0), [setVar('myslot', getVar('turn'))]),
            setVar('state', 1),

            // 렌더러 — 상대가 놓은 돌이 화면에 나타나는 유일한 경로.
            repeat.inf([
                setVar('placed', call('draw', 1)),
                if_(cmp(getVar('cleared'), '==', 1), [
                    setVar('cleared', 0),
                    removeAllClones(),
                    setVar('sink', call('clrm', 1)),
                ]),
                wait(0.08),
            ])],

        // 자리와 모양은 복제될 때 이미 물려받았다 — 여기서 전역을 읽으면 race 가 난다.
        [when.cloneStart(),
            show()],
    ],
});

// 커서 — 방향키 이동과 스페이스 착수. 두 스레드로 나눠 이동 대기(wait)가
// 착수 입력을 막지 않게 한다.
const cursor = obj('cursor', '커서', {
    scene: SC_GAME, picture: hexOutline(CURSOR_R, '#ffffff', 2.4),
    entity: { x: 0, y: BOARD_Y, scaleX: 1, scaleY: 1, direction: 90, visible: true },
    threads: [
        [when.sceneStart(),
            show(),
            repeat.inf([
                if_(cmp(getVar('state'), '==', 1), [
                    if_(isPressed(37), [
                        if_(cmp(getVar('cc'), '>', 1), [changeVar('cc', -1)]),
                        wait(0.11),
                    ]),
                    if_(isPressed(39), [
                        if_(cmp(getVar('cc'), '<', COLS), [changeVar('cc', 1)]),
                        wait(0.11),
                    ]),
                    if_(isPressed(38), [
                        if_(cmp(getVar('cr'), '>', 1), [changeVar('cr', -1)]),
                        wait(0.11),
                    ]),
                    if_(isPressed(40), [
                        if_(cmp(getVar('cr'), '<', ROWS), [changeVar('cr', 1)]),
                        wait(0.11),
                    ]),
                ]),
                locateXY(valueAt('posx', cidx()), valueAt('posy', cidx())),
            ])],

        // 스페이스는 눌린 순간 한 번만 — 키 반복으로 두 점이 연달아 놓이면 안 된다.
        [when.sceneStart(),
            repeat.inf([
                if_(isPressed(32), [
                    if_(cmp(getVar('held'), '==', 0), [
                        setVar('held', 1),
                        call('tryp', cidx()),
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
                        writeText(txt('나 = 노랑(선공)   ·   방향키 이동   ·   스페이스 착수')),
                    ], [
                        writeText(txt('나 = 파랑(후공)   ·   방향키 이동   ·   스페이스 착수')),
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
        [when.sceneStart(),
            waitUntil(cmp(getVar('state'), '==', 2)),
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
        fnClearBoard, fnClearMirror, fnDraw,
        fnRun, fnWin, fnPlace, fnTry,
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
