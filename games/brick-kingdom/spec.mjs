// Brick Kingdom — NES 시대 감성 사이드스크롤 플랫포머.
//
// ════════════════════════════════════════════════════════════════════════════
// 구조 개요 (요구사항 H: 역할별 분리)
// ════════════════════════════════════════════════════════════════════════════
//
//  데이터            levels.mjs      스테이지 타일/적/보상 (순수 데이터)
//                    physics.mjs     물리 상수 · 상태 코드
//                    assets/         픽셀아트 (문자 그리드 → SVG)
//
//  런타임 오브젝트   world     타일맵 렌더 + 충돌 질의 + 카메라 (stamp 렌더러)
//                    player    입력 → 물리 → 상태 머신
//                    enemies   적 클론 관리 (활성 범위 내에서만 갱신)
//                    items     아이템/발사체 클론
//                    hud       점수·동전·시간·생명 표시
//                    title     타이틀/게임오버/클리어 오버레이
//
// ════════════════════════════════════════════════════════════════════════════
// 왜 이런 구조인가 — 엔트리 런타임 제약에서 나온 설계
// ════════════════════════════════════════════════════════════════════════════
//
// 1) **타일 하나 = 오브젝트 하나로 두지 않는다.** 356×10 = 3,560 칸이므로 불가능.
//    레벨은 "행 = 문자열" 리스트로 두고, world 오브젝트 **하나**가 매 프레임
//    가시창(16×10=160 칸)만 stamp 로 다시 그린다. 실측 62fps
//    (knowledge/07 §brush_stamp 타일 렌더러 — stamp 250 회/프레임이 60fps 경계).
//
// 2) **순회는 반복 블록이 아니라 꼬리재귀 value 함수로 한다.** 반복 블록은
//    1 회 = 1 프레임이라 160 칸이면 2.7 초가 걸린다. 재귀 함수는 한 틱에 동기 완료
//    (knowledge/07 §함수 호출은 반복하기의 60fps 틱을 우회).
//
// 3) **값함수 호출은 반드시 값 슬롯에.** 문장 위치에 두면 .ent 가 아예 로드되지 않는다
//    (knowledge/04 §value 함수 호출을 문장 위치에). 반환값이 필요 없으면 `sink` 변수로 버린다.
//
// 4) **and/or 에 단락 평가가 없다.** 조건 안에서 리스트를 인덱싱하면 다른 쪽 항이
//    범위를 벗어나도 평가되어 터진다 → 순차 if 로 가드한다 (knowledge/07 §boolean_and_or).
//
// 5) **충돌은 타일 질의로 한다.** `reach_something` 은 오브젝트간 판정이라 타일맵에
//    쓸 수 없다. 대신 좌표 → (행,열) → 문자 조회로 판정한다. 서브스텝으로 터널링 방지.
//
// ════════════════════════════════════════════════════════════════════════════

import {
    when, repeat, if_, cmp, and_, not_, calc, mod, quotient,
    getVar, setVar, changeVar, valueAt, setListAt, addToList, lengthOfList,
    charAt, substr, strLen, combine, txt, num,
    locateXY, coord, isPressed, changeShape, show, hide, setEffect, clearEffects,
    eraseAll, stamp, startDraw, stopDraw, setColor, setThickness,
    createClone, deleteClone, removeAllClones,
    sendMessage, stopRepeat, wait, writeText, turnAbs,
    obj, fn, call, scene as makeScene, zOrder,
} from '../../tools/lib/spec-dsl.mjs';

import { STAGES, TILE, ROWS, VIEW_COLS, GROUND } from './levels.mjs';
import { PHYS as P, ST, PW, DEATH } from './physics.mjs';
import { SPRITES } from './assets/sprites.mjs';

// ── 화면 기하 ──────────────────────────────────────────────────
const SCR_W = 480, SCR_H = 270;
const HALF_W = SCR_W / 2, HALF_H = SCR_H / 2;
// 월드 y: 행 0 이 위. 타일 (행 r) 의 상단 월드 y = r*TILE.
// 화면 y = HALF_H - (worldY - camY).  월드 y 아래로 갈수록 커진다.
//
// ROWS*TILE 이 화면(270)보다 살짝 크다. 마지막 행 하단을 화면 하단에 딱 맞추면
// 아래 행들이 전부 보이고 행 0 만 위로 잘린다 (하늘이라 무해).
//   화면 y(행 r 중심) = ROW0_Y - r*TILE
// TILE=24/ROWS=12 → 288px, ROW0_Y = -135 + 12 + 11*24 = 141, 행 0 은 18px 잘림.
// 하드코딩하지 않는다 — 타일 스케일을 바꿀 때 조용히 어긋나는 값이다 (Phase 2-1).
const ROW0_Y = -HALF_H + TILE / 2 + (ROWS - 1) * TILE;
const stage = STAGES[0];
const WORLD_COLS = stage.tiles[0].length;
const WORLD_W = WORLD_COLS * TILE;
const CAM_MAX = WORLD_W - SCR_W;

// ── 적 시드 (빌드 시점에 문자 그리드 → 배열로 뽑는다) ───────────
// 적을 오브젝트/클론으로 만들지 않는다. 상태는 전부 리스트에 두고 **한 오브젝트가
// stamp 로 전부 그린다** (요구사항 F/H: 활성 범위 · 클론별 상태 섞임 원천 차단).
// 클론이 없으므로 "재시작 후 클론 중복" 이 구조적으로 불가능하다.
const enemySeeds = [];
stage.enemies.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch !== '.') enemySeeds.push({ kind: ch, x: c * TILE + TILE / 2, y: (r + 1) * TILE });
    }
});
const EN_N = enemySeeds.length;

// 아이템/발사체 풀 크기 (요구사항 H: 풀링 — 리스트 슬롯을 미리 잡고 재사용)
const MAX_ITEMS = 8;
const MAX_SHOTS = 4;

// 체크포인트 열 — 스테이지 중간. 여기를 지나면 사망 후 여기서 재시작한다.
const CHECKPOINT_COL = 178;

// 하늘 판 — 화면을 덮는 단색. 스테이지의 bg 색을 쓴다.
const SKY_PIC = {
    svgString: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SCR_W} ${SCR_H}" ` +
        `width="${SCR_W}" height="${SCR_H}"><rect width="${SCR_W}" height="${SCR_H}" fill="${stage.bg}"/></svg>`,
    dimension: { width: SCR_W, height: SCR_H },
    imageType: 'svg',
};

// ── 변수 선언 ──────────────────────────────────────────────────
// 이름은 편집기/verify 에서 그대로 읽히므로 의미가 드러나게 둔다.
const V = (id, value = '0') => ({ id, name: id, value: String(value), visible: false });

const variables = [
    // 게임 상태
    V('state', ST.TITLE), V('lives', 3), V('score'), V('coins'),
    V('time_left', stage.timeLimit), V('time_frac'), V('stage_id', 1),
    V('death_cause'), V('state_timer'), V('frames'),
    // 플레이어
    V('px', stage.spawnCol * TILE + TILE / 2), V('py', (GROUND - 1) * TILE),
    // 직전 프레임의 발 위치 — 밟기 판정에 쓴다 (아래 fnEnemyHit 주석 참고)
    V('prev_py', (GROUND - 1) * TILE),
    V('vx'), V('vy'), V('face', 1), V('grounded'), V('power', PW.BASE),
    V('jump_held'), V('jump_frames'), V('want_jump'), V('prev_jump'),
    V('invuln'), V('star'), V('ducking'), V('anim'), V('anim_timer'),
    V('run_held'), V('skidding'), V('spawn_col', stage.spawnCol),
    V('checkpoint_col', stage.spawnCol),
    // 카메라
    V('cam_x'), V('cam_col'), V('cam_frac'),
    // 연속 밟기 / 셸 연쇄 보너스 (요구사항 F: 연속 처치 점수 상승)
    V('combo'), V('chain'),
    // 이번 프레임 피격 요청 (적 판정 함수 → 플레이어 루프)
    V('want_hurt'), V('want_shoot'), V('prev_shoot'),
    // 밟기 중복 방지 잠금 (프레임 카운트) — fnEnemyHit 주석 참고
    V('stomp_lock'),
    // 스크래치 — **용도마다 다른 변수를 쓴다.** 하나를 여러 목적으로 돌려쓰면
    // (a) 같은 프레임의 다음 단계가 값을 덮어쓰고, (b) 다른 오브젝트의 repeat.inf
    // 스레드가 같은 프레임 중간에 써서 race 가 난다. 실제로 world 오브젝트의 카메라
    // 계산이 플레이어의 "최대 속도" 스크래치를 덮어써 걷기가 완전히 멈추는 버그가 났다
    // (knowledge/07-runtime-quirks.md 의 글로벌 scratch race 가 2 오브젝트로 확장된 형태).
    V('sink'),                 // 값함수 반환 버리기 전용 — 절대 읽지 않는다
    V('cam_tmp'),              // world 스레드 전용: 카메라 목표 x
    V('box_h', P.HITBOX_H),    // 현재 히트박스 높이 — fnMoveX/fnMoveY 가 읽는 약속된 슬롯
    V('max_spd'),              // 이번 프레임 목표 최대 수평 속도
    V('accel'),                // 이번 프레임 수평 가속도 (지상/공중)
    V('grav'),                 // 이번 프레임 중력
    V('bumped'),               // 이번 프레임 천장 머리박기 발생 (1/0)
    V('hit_r'), V('hit_c'),    // 머리로 친 칸 (행, 열)
    V('reward'),               // 보상 블록 내용물 종류
    V('tile_ch'),              // 타일 문자 임시
    V('shape'),                // 이번 프레임 모양 이름
    V('blink'),                // 무적 깜빡임 위상
    // 적/아이템 풀 커서
    V('enemy_count'), V('item_count'), V('shot_count'),
    // 디버그/검증용 계측 — verify.mjs 가 읽는다 (게임 로직은 이 값을 읽지 않는다:
    // "테스트를 위해 플레이 로직을 우회" 하지 않기 위해 **쓰기 전용 카운터**로만 둔다)
    V('dbg_tiles'), V('dbg_deaths'), V('dbg_stomps'), V('dbg_bricks_broken'),
    V('dbg_rewards_used'), V('dbg_coins_got'), V('dbg_clear'), V('dbg_shots'),
    V('dbg_kicks'), V('dbg_chain_kills'), V('dbg_shot_kills'), V('dbg_items_got'),
    V('dbg_active_enemies'), V('dbg_hurts'), V('dbg_restarts'), V('dbg_checkpoint'),
];

// ── 리스트 선언 ────────────────────────────────────────────────
// lvl        : 현재 스테이지 타일 (행 = 문자열). 파괴/사용으로 런타임에 변한다.
// lvl_src    : 원본 사본 — 사망/재시작 시 복원용 (요구사항: 재시작 후 클론 중복 없음)
// enemy_*    : 적 상태 배열 (인덱스 = 클론 id)
// item_*     : 아이템 상태 배열
const lists = [
    { id: 'lvl', name: 'lvl', visible: false, array: stage.tiles.slice() },
    { id: 'lvl_src', name: 'lvl_src', visible: false, array: stage.tiles.slice() },
    // 적 — 인덱스 i 가 한 마리. 배열 길이는 스테이지마다 고정(EN_N)이라
    // 런타임에 늘거나 줄지 않는다 → 재시작은 en_home/en_homey 로 되감기만 한다.
    //   en_kind  r=롤스톤 g=코그워커 s=스파이크샤드 f=글라이드핀
    //   en_state 0=정상 1=셸정지 2=셸이동 3=죽음(사라짐)
    { id: 'en_kind', name: 'en_kind', visible: false, array: enemySeeds.map(e => e.kind) },
    { id: 'en_x', name: 'en_x', visible: false, array: enemySeeds.map(e => e.x) },
    { id: 'en_y', name: 'en_y', visible: false, array: enemySeeds.map(e => e.y) },
    { id: 'en_vx', name: 'en_vx', visible: false, array: enemySeeds.map(e => (e.kind === 's' ? 0 : -P.ENEMY_WALK)) },
    { id: 'en_vy', name: 'en_vy', visible: false, array: enemySeeds.map(() => 0) },
    { id: 'en_state', name: 'en_state', visible: false, array: enemySeeds.map(() => 0) },
    { id: 'en_timer', name: 'en_timer', visible: false, array: enemySeeds.map(() => 0) },
    { id: 'en_home', name: 'en_home', visible: false, array: enemySeeds.map(e => e.x) },
    { id: 'en_homey', name: 'en_homey', visible: false, array: enemySeeds.map(e => e.y) },
    // 아이템 풀 — 고정 길이 MAX_ITEMS. it_kind 가 '' 면 빈 슬롯.
    { id: 'it_kind', name: 'it_kind', visible: false, array: Array(MAX_ITEMS).fill('-') },
    { id: 'it_x', name: 'it_x', visible: false, array: Array(MAX_ITEMS).fill(0) },
    { id: 'it_y', name: 'it_y', visible: false, array: Array(MAX_ITEMS).fill(0) },
    { id: 'it_vx', name: 'it_vx', visible: false, array: Array(MAX_ITEMS).fill(0) },
    { id: 'it_vy', name: 'it_vy', visible: false, array: Array(MAX_ITEMS).fill(0) },
    { id: 'it_alive', name: 'it_alive', visible: false, array: Array(MAX_ITEMS).fill(0) },
    { id: 'it_rise', name: 'it_rise', visible: false, array: Array(MAX_ITEMS).fill(0) },
    // 발사체 풀 (요구사항 D/F: 원거리 능력)
    { id: 'sh_x', name: 'sh_x', visible: false, array: Array(MAX_SHOTS).fill(0) },
    { id: 'sh_y', name: 'sh_y', visible: false, array: Array(MAX_SHOTS).fill(0) },
    { id: 'sh_vx', name: 'sh_vx', visible: false, array: Array(MAX_SHOTS).fill(0) },
    { id: 'sh_vy', name: 'sh_vy', visible: false, array: Array(MAX_SHOTS).fill(0) },
    { id: 'sh_life', name: 'sh_life', visible: false, array: Array(MAX_SHOTS).fill(0) },
    // 블록 튀어오름 연출: 행,열,남은프레임
    { id: 'bump_r', name: 'bump_r', visible: false, array: [] },
    { id: 'bump_c', name: 'bump_c', visible: false, array: [] },
    { id: 'bump_t', name: 'bump_t', visible: false, array: [] },
    // 보상 블록 내용물 룩업: "행,열" → 종류
    { id: 'rw_key', name: 'rw_key', visible: false, array: Object.keys(stage.rewards) },
    { id: 'rw_kind', name: 'rw_kind', visible: false, array: Object.values(stage.rewards) },
];

// ════════════════════════════════════════════════════════════════
// 공용 함수 — 타일 질의 / 좌표 변환
// ════════════════════════════════════════════════════════════════

// 타일 문자 읽기: (열 c, 행 r) → 문자. 범위 밖은 '#'(벽) 취급해 화면 밖으로 못 나가게.
// charAt / value_of_index_from_list 는 1-based.
const fnTileAt = fn.value('ta', ['c', 'r'],
    (c, r, L) => [
        L.set('out', txt('#')),
        // 순차 가드 — and_ 는 단락 평가가 없어서 범위 검사에 쓸 수 없다.
        if_(cmp(r, '>=', 0), [
            if_(cmp(r, '<', ROWS), [
                if_(cmp(c, '>=', 0), [
                    if_(cmp(c, '<', WORLD_COLS), [
                        L.set('out', charAt(valueAt('lvl', calc(r, '+', 1)), calc(c, '+', 1))),
                    ]),
                ]),
            ]),
        ]),
        // 행이 그리드 아래면 공기 (추락사 판정용)
        if_(cmp(r, '>=', ROWS), [ L.set('out', txt('.')) ]),
    ],
    (c, r, L) => L.get('out'),
    ['out'],
);

// 문자가 '단단한가' — 통과 불가 타일. 아이템/동전/깃대는 통과.
const fnSolid = fn.value('sd', ['ch'],
    (ch, L) => [
        L.set('s', 0),
        if_(cmp(ch, '==', txt('#')), [L.set('s', 1)]),
        if_(cmp(ch, '==', txt('=')), [L.set('s', 1)]),
        if_(cmp(ch, '==', txt('B')), [L.set('s', 1)]),
        if_(cmp(ch, '==', txt('?')), [L.set('s', 1)]),
        if_(cmp(ch, '==', txt('u')), [L.set('s', 1)]),
        if_(cmp(ch, '==', txt('P')), [L.set('s', 1)]),
        if_(cmp(ch, '==', txt('p')), [L.set('s', 1)]),
    ],
    (ch, L) => L.get('s'),
    ['s'],
);

// 월드 좌표 → 타일 단단함 (1/0). x,y 는 픽셀.
const fnSolidAt = fn.value('sa', ['x', 'y'],
    (x, y, L) => [
        L.set('c', quotient(x, TILE)),
        L.set('r', quotient(y, TILE)),
        L.set('ch', call('ta', L.get('c'), L.get('r'))),
        L.set('res', call('sd', L.get('ch'))),
    ],
    (x, y, L) => L.get('res'),
    ['c', 'r', 'ch', 'res'],
);

// 타일 1 칸만 문자 교체 (replace_string 은 전량 치환이라 못 씀).
// 반환값 없음이지만 value 함수이므로 호출부는 sink 에 넣어야 한다.
const fnSetTile = fn.value('st', ['c', 'r', 'ch'],
    (c, r, ch, L) => [
        L.set('row', valueAt('lvl', calc(r, '+', 1))),
        L.set('left', substr(L.get('row'), 1, c)),
        L.set('right', substr(L.get('row'), calc(c, '+', 2), strLen(L.get('row')))),
        setListAt('lvl', calc(r, '+', 1), combine(combine(L.get('left'), ch), L.get('right'))),
    ],
    () => 1,
    ['row', 'left', 'right'],
);

// AABB 가 단단한 타일과 겹치는가 — 네 모서리 + 변 중앙 샘플.
// 히트박스(20×44)가 타일(32)보다 작으므로 모서리 4 점 + 좌우 변 중앙 2 점이면 충분하다
// (한 변에 타일 경계가 2 개 이상 걸릴 수 없다).
const fnBoxHits = fn.value('bh', ['x', 'y', 'w', 'h'],
    (x, y, w, h, L) => [
        L.set('hit', 0),
        L.set('x0', calc(x, '-', calc(w, '/', 2))),
        L.set('x1', calc(x, '+', calc(w, '/', 2))),
        // y 는 발 위치 = 몸의 **하단 경계(배타적)**. 즉 발이 지면 위에 서 있을 때
        // py 는 지면 타일의 상단 y 와 정확히 같다. 그래서 하단 샘플을 py 로 잡으면
        // quotient(py, TILE) 이 지면 행을 가리켜 "항상 충돌" 이 된다 (걷기가 멈춤).
        // → 하단은 py-1 (발 바로 위) 을 본다. 상단은 py-h.
        L.set('y0', calc(y, '-', h)),
        L.set('y1', calc(y, '-', 1)),
        if_(cmp(call('sa', L.get('x0'), L.get('y0')), '==', 1), [L.set('hit', 1)]),
        if_(cmp(call('sa', L.get('x1'), L.get('y0')), '==', 1), [L.set('hit', 1)]),
        if_(cmp(call('sa', L.get('x0'), L.get('y1')), '==', 1), [L.set('hit', 1)]),
        if_(cmp(call('sa', L.get('x1'), L.get('y1')), '==', 1), [L.set('hit', 1)]),
        L.set('ym', calc(L.get('y0'), '+', calc(h, '/', 2))),
        if_(cmp(call('sa', L.get('x0'), L.get('ym')), '==', 1), [L.set('hit', 1)]),
        if_(cmp(call('sa', L.get('x1'), L.get('ym')), '==', 1), [L.set('hit', 1)]),
    ],
    (x, y, w, h, L) => L.get('hit'),
    ['hit', 'x0', 'x1', 'y0', 'y1', 'ym'],
);

// 보상 블록의 내용물 조회: "행,열" 키로 rw_key 를 선형 탐색 → rw_kind.
// 보상 블록은 스테이지당 한 자리 수이므로 선형 탐색으로 충분하다.
const fnRewardKind = fn.value('rk', ['r', 'c'],
    (r, c, L) => [
        L.set('key', combine(combine(r, txt(',')), c)),
        L.set('res', txt('coin')),
        L.set('i', 1),
        L.set('n', lengthOfList('rw_key')),
        // 꼬리재귀 대신 반복이 필요하지만, 반복 블록은 프레임을 먹는다.
        // → 재귀 헬퍼(rl)로 위임한다.
        L.set('res', call('rl', L.get('key'), 1)),
    ],
    (r, c, L) => L.get('res'),
    ['key', 'res', 'i', 'n'],
);

// rw_key 선형 탐색 재귀 헬퍼
const fnRewardLookup = fn.value('rl', ['key', 'i'],
    (key, i, L) => [
        L.set('out', txt('coin')),
        if_(cmp(i, '<=', lengthOfList('rw_key')), [
            if_(cmp(valueAt('rw_key', i), '==', key), [
                L.set('out', valueAt('rw_kind', i)),
            ], [
                L.set('out', call('rl', key, calc(i, '+', 1))),
            ]),
        ]),
    ],
    (key, i, L) => L.get('out'),
    ['out'],
);

// 두 AABB 가 겹치는가 — (ax,ay)=중심하단 기준 박스 A, (bx,by)=박스 B.
// 적↔플레이어, 발사체↔적 판정에 공용으로 쓴다.
const fnOverlap = fn.value('ov', ['ax', 'ay', 'aw', 'ah', 'bx', 'by', 'bw', 'bh'],
    (ax, ay, aw, ah, bx, by, bw, bh, L) => [
        L.set('o', 0),
        // x 축 겹침 → y 축 겹침 순차 확인 (and_ 는 단락 평가가 없다)
        if_(cmp(calc(ax, '-', calc(aw, '/', 2)), '<', calc(bx, '+', calc(bw, '/', 2))), [
            if_(cmp(calc(ax, '+', calc(aw, '/', 2)), '>', calc(bx, '-', calc(bw, '/', 2))), [
                if_(cmp(calc(ay, '-', ah), '<', by), [
                    if_(cmp(ay, '>', calc(by, '-', bh)), [L.set('o', 1)]),
                ]),
            ]),
        ]),
    ],
    (...a) => a[a.length - 1].get('o'),
    ['o'],
);

// ════════════════════════════════════════════════════════════════
// world — 타일맵 렌더 + 카메라
// ════════════════════════════════════════════════════════════════

// 가시창 타일을 stamp 로 그린다. idx 0..(VIEW_COLS*ROWS-1) 꼬리재귀.
// 화면 x = -HALF_W + TILE/2 + vc*TILE - cam_frac
// 화면 y = HALF_H - TILE/2 - r*TILE   (행 0 이 화면 상단)
const fnDrawTiles = fn.value('dt', ['idx'],
    (idx, L) => [
        if_(cmp(idx, '>=', VIEW_COLS * ROWS), [
            L.set('r', 0),
        ], [
            L.set('vc', mod(idx, VIEW_COLS)),
            L.set('rr', quotient(idx, VIEW_COLS)),
            L.set('wc', calc(getVar('cam_col'), '+', L.get('vc'))),
            L.set('ch', call('ta', L.get('wc'), L.get('rr'))),
            L.set('sx', calc(calc(-HALF_W + TILE / 2, '+', calc(L.get('vc'), '*', TILE)), '-', getVar('cam_frac'))),
            L.set('sy', calc(ROW0_Y, '-', calc(L.get('rr'), '*', TILE))),
            // 문자별 모양 선택 후 stamp. '.' 은 아무것도 안 그린다.
            L.set('drew', 0),
            if_(cmp(L.get('ch'), '==', txt('#')), [changeShape('t_ground'), L.set('drew', 1)]),
            if_(cmp(L.get('ch'), '==', txt('=')), [changeShape('t_stone'), L.set('drew', 1)]),
            if_(cmp(L.get('ch'), '==', txt('B')), [changeShape('t_brick'), L.set('drew', 1)]),
            if_(cmp(L.get('ch'), '==', txt('?')), [changeShape('t_reward'), L.set('drew', 1)]),
            if_(cmp(L.get('ch'), '==', txt('u')), [changeShape('t_used'), L.set('drew', 1)]),
            if_(cmp(L.get('ch'), '==', txt('P')), [changeShape('t_pipe_top'), L.set('drew', 1)]),
            if_(cmp(L.get('ch'), '==', txt('p')), [changeShape('t_pipe'), L.set('drew', 1)]),
            if_(cmp(L.get('ch'), '==', txt('c')), [changeShape('i_coin'), L.set('drew', 1)]),
            if_(cmp(L.get('ch'), '==', txt('F')), [changeShape('g_flag'), L.set('drew', 1)]),
            if_(cmp(L.get('drew'), '==', 1), [
                locateXY(L.get('sx'), L.get('sy')),
                stamp(),
                changeVar('dbg_tiles', 1),
            ]),
            L.set('r', call('dt', calc(idx, '+', 1))),
        ]),
    ],
    (idx, L) => L.get('r'),
    ['vc', 'rr', 'wc', 'ch', 'sx', 'sy', 'drew', 'r'],
);

// 카메라 갱신 — 플레이어를 화면 42% 지점에 두되 뒤로는 스크롤하지 않는다.
const camUpdate = [
    // cam_tmp 는 이 스레드(world)만 쓴다 — 플레이어 스레드의 스크래치와 겹치면 안 된다.
    setVar('cam_tmp', calc(getVar('px'), '-', SCR_W * P.CAM_ANCHOR)),
    if_(cmp(getVar('cam_tmp'), '<', 0), [setVar('cam_tmp', 0)]),
    if_(cmp(getVar('cam_tmp'), '>', CAM_MAX), [setVar('cam_tmp', CAM_MAX)]),
    // 뒤로 스크롤 금지 (요구사항 A) — 목표 지점은 앞으로만
    if_(cmp(getVar('cam_tmp'), '>', getVar('cam_x')), [
        setVar('cam_x', getVar('cam_tmp')),
    ]),
    setVar('cam_col', quotient(getVar('cam_x'), TILE)),
    setVar('cam_frac', mod(getVar('cam_x'), TILE)),
];

// ════════════════════════════════════════════════════════════════
// 적 (요구사항 F) — 리스트 기반, 클론 없음
// ════════════════════════════════════════════════════════════════
//
// 한 마리의 상태는 en_* 리스트의 같은 인덱스에 흩어져 있다. 갱신은 꼬리재귀로
// 인덱스 1..EN_N 을 한 틱에 훑는다. **활성 범위 밖(화면 ±margin)은 물리를 건너뛴다**
// (요구사항 F: 화면 밖 불필요한 실행 금지).
//
// 종별 차이 (요구사항 F: 절벽에서 떨어지는 적 vs 반전하는 적 구분):
//   r 롤스톤   — 벽에서 반전, 절벽에서 **떨어진다**. 밟으면 셸이 된다.
//   g 코그워커 — 벽에서 반전, 절벽에서도 **반전**(안 떨어짐). 밟으면 즉사.
//   s 스파이크샤드 — 제자리 고정. 밟아도 안 죽고 플레이어가 피격된다.
//   f 글라이드핀 — 공중을 사인 궤도로 비행. 중력 무시. 밟으면 즉사.

// 적 히트박스 — 타일보다 좁게. TILE 에서 유도한다 (Phase 2-1: 32→24 로 바뀌었다)
const EN_W = Math.round(TILE * 0.75), EN_H = Math.round(TILE * 0.8);   // 18 × 19

// 글라이드핀 왕복 진폭 = 1.5 칸을 60 프레임에 오르내린다 (TILE 에 비례)
const GLIDE_STEP = (TILE * 1.5) / 60;

// 한 마리 물리 — i 번째. 벽/절벽/중력 처리.
const fnEnemyStep = fn.normal('es', ['i'],
    (i, L) => [
        L.set('k', valueAt('en_kind', i)),
        L.set('st', valueAt('en_state', i)),
        L.set('x', valueAt('en_x', i)),
        L.set('y', valueAt('en_y', i)),
        L.set('vx', valueAt('en_vx', i)),
        L.set('vy', valueAt('en_vy', i)),

        // 셸 정지 상태는 시간이 지나면 다시 깨어난다 (원작의 셸 부활 특성)
        if_(cmp(L.get('st'), '==', 1), [
            setListAt('en_timer', i, calc(valueAt('en_timer', i), '-', 1)),
            if_(cmp(valueAt('en_timer', i), '<=', 0), [
                setListAt('en_state', i, 0),
                setListAt('en_vx', i, calc(0, '-', P.ENEMY_WALK)),
            ]),
        ]),

        // 스파이크샤드(s)와 셸정지(1)는 움직이지 않는다
        L.set('mobile', 1),
        if_(cmp(L.get('k'), '==', txt('s')), [L.set('mobile', 0)]),
        if_(cmp(L.get('st'), '==', 1), [L.set('mobile', 0)]),

        if_(cmp(L.get('mobile'), '==', 1), [
            // ── 수직: 글라이드핀만 중력 무시 (공중 궤도) ──
            if_(cmp(L.get('k'), '==', txt('f')), [
                // 홈 y 기준 ±1.5 칸 왕복 — 프레임 카운터로 삼각 없이 선형 왕복
                setListAt('en_timer', i, calc(valueAt('en_timer', i), '+', 1)),
                L.set('ph', mod(valueAt('en_timer', i), 120)),
                if_(cmp(L.get('ph'), '<', 60), [
                    L.set('y', calc(valueAt('en_homey', i), '-', calc(L.get('ph'), '*', GLIDE_STEP))),
                ], [
                    L.set('y', calc(valueAt('en_homey', i), '-', calc(calc(120, '-', L.get('ph')), '*', GLIDE_STEP))),
                ]),
            ], [
                // 중력 + 착지
                L.set('vy', calc(L.get('vy'), '+', P.ENEMY_GRAVITY)),
                if_(cmp(L.get('vy'), '>', P.MAX_FALL), [L.set('vy', P.MAX_FALL)]),
                L.set('ny', calc(L.get('y'), '+', L.get('vy'))),
                if_(cmp(call('bh', L.get('x'), L.get('ny'), EN_W, EN_H), '==', 1), [
                    // 발을 타일 상단에 스냅
                    L.set('y', calc(quotient(calc(L.get('ny'), '+', 1), TILE), '*', TILE)),
                    L.set('vy', 0),
                ], [
                    L.set('y', L.get('ny')),
                ]),
            ]),

            // ── 수평: 벽에서 반전 ──
            L.set('nx', calc(L.get('x'), '+', L.get('vx'))),
            if_(cmp(call('bh', L.get('nx'), L.get('y'), EN_W, EN_H), '==', 1), [
                L.set('vx', calc(0, '-', L.get('vx'))),
                // 셸이 벽에 부딪히면 방향만 바꿔 계속 간다
            ], [
                // 절벽 검사 — 코그워커(g)는 앞발 밑이 비면 돌아선다
                L.set('turn', 0),
                if_(cmp(L.get('k'), '==', txt('g')), [
                    // 앞발 거리·발밑 여유도 TILE 비례 (32px 시절 12·4 리터럴이었다)
                    L.set('ahead', calc(L.get('nx'), '+', calc(L.get('vx'), '*', Math.round(TILE * 0.375)))),
                    if_(cmp(call('sa', L.get('ahead'), calc(L.get('y'), '+', Math.max(2, Math.round(TILE * 0.125)))), '==', 0), [
                        L.set('turn', 1),
                    ]),
                ]),
                if_(cmp(L.get('turn'), '==', 1), [
                    L.set('vx', calc(0, '-', L.get('vx'))),
                ], [
                    L.set('x', L.get('nx')),
                ]),
            ]),

            // 월드 밖으로 나가면 제거
            if_(cmp(L.get('x'), '<', 0), [setListAt('en_state', i, 3)]),
            if_(cmp(L.get('y'), '>', (ROWS + 2) * TILE), [setListAt('en_state', i, 3)]),
        ]),

        setListAt('en_x', i, L.get('x')),
        setListAt('en_y', i, L.get('y')),
        setListAt('en_vx', i, L.get('vx')),
        setListAt('en_vy', i, L.get('vy')),
    ],
    ['k', 'st', 'x', 'y', 'vx', 'vy', 'nx', 'ny', 'mobile', 'turn', 'ahead', 'ph'],
);

// 이동 중인 셸(state 2)이 다른 적을 치면 연쇄 처치 (요구사항 F).
const fnShellChain = fn.normal('sc', ['i', 'j'],
    (i, j, L) => [
        if_(cmp(j, '<=', EN_N), [
            if_(cmp(j, '!=', i), [
                if_(cmp(valueAt('en_state', j), '<', 3), [
                    if_(cmp(call('ov',
                        valueAt('en_x', i), valueAt('en_y', i), EN_W, EN_H,
                        valueAt('en_x', j), valueAt('en_y', j), EN_W, EN_H), '==', 1), [
                        setListAt('en_state', j, 3),
                        changeVar('chain', 1),
                        // 연쇄 점수 증가 (요구사항 F: 연속 처치 점수 상승)
                        changeVar('score', calc(200, '*', getVar('chain'))),
                        changeVar('dbg_chain_kills', 1),
                    ]),
                ]),
            ]),
            call('sc', i, calc(j, '+', 1)),
        ]),
    ],
    [],
);

// 플레이어 ↔ 적 판정 (요구사항 F: 밟기/측면/발사체/무적 접촉을 다른 판정으로)
const fnEnemyHit = fn.normal('eh', ['i'],
    (i, L) => [
        L.set('k', valueAt('en_kind', i)),
        L.set('st', valueAt('en_state', i)),
        if_(cmp(call('ov',
            getVar('px'), getVar('py'), P.HITBOX_W, getVar('box_h'),
            valueAt('en_x', i), valueAt('en_y', i), EN_W, EN_H), '==', 1), [

            // ① 무적(스타) 접촉 = 즉사시킴
            if_(cmp(getVar('star'), '>', 0), [
                setListAt('en_state', i, 3),
                changeVar('score', 200),
                changeVar('dbg_stomps', 1),
            ], [
                // ② 밟기 판정 — **직전 프레임에 적 머리 위에 있었는가**로 본다.
                //
                // "겹침 깊이가 얕으면 밟기" 로 판정하면 안 된다: 그 창은 EN_H/2=13px
                // 뿐인데 낙하 속도는 최대 12px/frame 이라, 빠르게 떨어지면 한 프레임에
                // 창을 뛰어넘어 **측면 접촉(사망)** 으로 오판정된다 (실측: 제자리 점프로
                // 적 위에 떨어졌는데 사망). 이전 위치를 쓰면 속도와 무관하게 정확하다.
                L.set('stomp', 0),
                if_(cmp(getVar('vy'), '>', 0), [
                    // 직전 발 위치가 적 상단(en_y - EN_H) 보다 위였으면 위에서 내려온 것
                    if_(cmp(getVar('prev_py'), '<=', calc(valueAt('en_y', i), '-', EN_H - 4)), [
                        L.set('stomp', 1),
                    ]),
                ]),

                // 밟기는 **한 번의 접촉에 한 번만** 처리한다. prev_py 조건은 겹침이
                // 유지되는 동안 여러 프레임 참이라, 가드가 없으면 한 번 뛰어 밟았는데
                // 점수가 9 배로 오른다(실측). 반동으로 vy 가 음수가 되면 다음 프레임의
                // `vy > 0` 조건이 거짓이 되어 자연히 한 번만 발동하는데, 셸을 만든 뒤
                // 다시 겹치면 또 걸리므로 **직전에 이미 밟았으면** 건너뛴다.
                if_(cmp(getVar('stomp_lock'), '>', 0), [L.set('stomp', 0)]),

                if_(cmp(L.get('stomp'), '==', 1), [
                    setVar('stomp_lock', 12),
                    // 스파이크샤드는 밟아도 안 죽고 오히려 피격 (요구사항 F: 파괴 불가 적)
                    if_(cmp(L.get('k'), '==', txt('s')), [
                        setVar('want_hurt', 1),
                    ], [
                        // 반동 — 점프 버튼을 누른 채면 더 높이 (요구사항: 밟기 반동)
                        setVar('vy', calc(0, '-', P.STOMP_V)),
                        if_(cmp(getVar('want_jump'), '==', 1), [
                            setVar('vy', calc(0, '-', P.STOMP_V_HELD)),
                        ]),
                        setVar('grounded', 0),
                        changeVar('combo', 1),
                        // 연속 밟기 점수 상승 (요구사항 F)
                        changeVar('score', calc(100, '*', getVar('combo'))),
                        changeVar('dbg_stomps', 1),

                        if_(cmp(L.get('k'), '==', txt('r')), [
                            // 롤스톤 → 셸 정지. 이동 중 셸을 밟으면 다시 멈춘다
                            // (원작의 "굴러가는 셸 밟아 세우기").
                            setListAt('en_state', i, 1),
                            setListAt('en_vx', i, 0),
                            setListAt('en_timer', i, 420),
                        ], [
                            // 코그워커/글라이드핀은 즉사
                            setListAt('en_state', i, 3),
                        ]),
                    ]),
                ], [
                    // ③ 측면 접촉 — 정지한 셸이면 **차기**, 그 외에는 피격.
                    if_(cmp(L.get('st'), '==', 1), [
                        // 방금 밟아 만든 셸을 같은 프레임에 차면 안 된다: 하강 중
                        // 겹침이 남아 있어 "밟자마자 발사" 가 된다. 셸 생성 시
                        // en_timer=420 이므로 앞 10 프레임(>410)은 차기를 막는다.
                        if_(cmp(valueAt('en_timer', i), '<=', 410), [
                            setListAt('en_state', i, 2),
                            setVar('chain', 0),
                            if_(cmp(getVar('px'), '<', valueAt('en_x', i)), [
                                setListAt('en_vx', i, P.SHELL_KICK),
                            ], [
                                setListAt('en_vx', i, calc(0, '-', P.SHELL_KICK)),
                            ]),
                            changeVar('dbg_kicks', 1),
                        ]),
                    ], [
                        // 정상 상태의 적, 그리고 **이동 중인 셸**은 몸통 접촉 = 피격
                        setVar('want_hurt', 1),
                    ]),
                ]),
            ]),
        ]),
    ],
    ['k', 'st', 'stomp'],
);

// 적 전체 갱신 꼬리재귀 — 활성 범위 안만 물리·판정.
const fnEnemyAll = fn.value('ea', ['i'],
    (i, L) => [
        if_(cmp(i, '>', EN_N), [
            L.set('r', 0),
        ], [
            if_(cmp(valueAt('en_state', i), '<', 3), [
                // 활성 범위: 화면 좌우 margin 안 (요구사항 F)
                L.set('sx', calc(valueAt('en_x', i), '-', getVar('cam_x'))),
                if_(cmp(L.get('sx'), '>', calc(0, '-', P.ENEMY_ACTIVE_MARGIN)), [
                    if_(cmp(L.get('sx'), '<', SCR_W + P.ENEMY_ACTIVE_MARGIN), [
                        call('es', i),
                        // 이동 중 셸은 다른 적을 연쇄 처치
                        if_(cmp(valueAt('en_state', i), '==', 2), [
                            call('sc', i, 1),
                        ]),
                        // 플레이어 판정 — PLAYING 중이고 무적 프레임이 아닐 때만
                        if_(cmp(getVar('state'), '==', ST.PLAYING), [
                            call('eh', i),
                        ]),
                        changeVar('dbg_active_enemies', 1),
                    ]),
                ]),
            ]),
            L.set('r', call('ea', calc(i, '+', 1))),
        ]),
    ],
    (i, L) => L.get('r'),
    ['r', 'sx'],
);

// 적 그리기 꼬리재귀 — 화면 안에 있는 살아있는 적만 stamp.
const fnDrawEnemies = fn.value('de', ['i'],
    (i, L) => [
        if_(cmp(i, '>', EN_N), [
            L.set('r', 0),
        ], [
            if_(cmp(valueAt('en_state', i), '<', 3), [
                L.set('sx', calc(calc(valueAt('en_x', i), '-', getVar('cam_x')), '-', HALF_W)),
                if_(cmp(L.get('sx'), '>', -HALF_W - TILE), [
                    if_(cmp(L.get('sx'), '<', HALF_W + TILE), [
                        L.set('k', valueAt('en_kind', i)),
                        L.set('nm', txt('rollstone')),
                        if_(cmp(L.get('k'), '==', txt('g')), [L.set('nm', txt('cogwalker'))]),
                        if_(cmp(L.get('k'), '==', txt('s')), [L.set('nm', txt('spikeshard'))]),
                        if_(cmp(L.get('k'), '==', txt('f')), [L.set('nm', txt('glidefin'))]),
                        // 셸 상태는 전용 모양
                        if_(cmp(valueAt('en_state', i), '>', 0), [L.set('nm', txt('rollstone_shell'))]),
                        changeShape(L.get('nm')),
                        // 월드 y(발 위치) → 화면 y. 스프라이트 중심이 발보다 EN_H/2 위.
                        locateXY(L.get('sx'),
                            calc(calc(ROW0_Y + TILE / 2, '-', valueAt('en_y', i)), '+', 2)),
                        stamp(),
                    ]),
                ]),
            ]),
            L.set('r', call('de', calc(i, '+', 1))),
        ]),
    ],
    (i, L) => L.get('r'),
    ['r', 'sx', 'k', 'nm'],
);

// ════════════════════════════════════════════════════════════════
// 아이템 · 발사체 (요구사항 E/D)
// ════════════════════════════════════════════════════════════════

// 아이템 히트박스. **TILE 에서 유도한다** — 리터럴(22×24)로 두면 타일이 24px 로
// 줄었을 때 아이템이 타일과 같은 크기가 되어 지형 충돌(bh)에 항상 걸리고,
// 블록에서 솟아오른 자리에 갇혀 걸어오지 않는다 (Phase 2-1 실측: items_got=0).
// 적(EN_W/EN_H)과 같은 비율로 타일보다 작게 잡는다.
const IT_W = Math.round(TILE * 0.7), IT_H = Math.round(TILE * 0.75);   // 17 × 18

// 빈 아이템 슬롯 찾기 (없으면 0)
const fnItemSlot = fn.value('is', ['i'],
    (i, L) => [
        L.set('r', 0),
        if_(cmp(i, '<=', MAX_ITEMS), [
            if_(cmp(valueAt('it_alive', i), '==', 0), [
                L.set('r', i),
            ], [
                L.set('r', call('is', calc(i, '+', 1))),
            ]),
        ]),
    ],
    (i, L) => L.get('r'),
    ['r'],
);

// 아이템 스폰 — 보상 블록에서 솟아오른다 (요구사항 E: 솟아오른 뒤 이동 시작)
const fnItemSpawn = fn.normal('isp', ['kind', 'x', 'y'],
    (kind, x, y, L) => [
        L.set('s', call('is', 1)),
        if_(cmp(L.get('s'), '>', 0), [
            setListAt('it_kind', L.get('s'), kind),
            setListAt('it_x', L.get('s'), x),
            setListAt('it_y', L.get('s'), y),
            setListAt('it_vx', L.get('s'), 0),
            setListAt('it_vy', L.get('s'), 0),
            setListAt('it_alive', L.get('s'), 1),
            setListAt('it_rise', L.get('s'), P.ITEM_RISE_FRAMES),
        ]),
    ],
    ['s'],
);

// 아이템 획득 효과 (요구사항 D: 등급 상승 / 무적 / 생명)
const applyItem = (kindLocal) => [
    if_(cmp(kindLocal, '==', txt('grow')), [
        if_(cmp(getVar('power'), '<', PW.BIG), [setVar('power', PW.BIG)]),
        changeVar('score', 1000),
    ]),
    if_(cmp(kindLocal, '==', txt('beam')), [
        setVar('power', PW.BEAM),
        changeVar('score', 1000),
    ]),
    if_(cmp(kindLocal, '==', txt('star')), [
        setVar('star', P.STAR_FRAMES),
        changeVar('score', 1000),
    ]),
    if_(cmp(kindLocal, '==', txt('life')), [
        changeVar('lives', 1),
        changeVar('score', 1000),
    ]),
];

// 아이템 한 개 갱신 + 획득 판정
const fnItemStep = fn.normal('it', ['i'],
    (i, L) => [
        if_(cmp(valueAt('it_alive', i), '==', 1), [
            L.set('x', valueAt('it_x', i)),
            L.set('y', valueAt('it_y', i)),
            if_(cmp(valueAt('it_rise', i), '>', 0), [
                // 솟는 중 — 블록 위로 천천히 올라온다. 이 동안은 이동/판정 없음.
                L.set('y', calc(L.get('y'), '-', TILE / P.ITEM_RISE_FRAMES)),
                setListAt('it_rise', i, calc(valueAt('it_rise', i), '-', 1)),
                // 다 솟으면 이동 시작 (star 는 튀고, 나머지는 걷는다)
                if_(cmp(valueAt('it_rise', i), '==', 0), [
                    setListAt('it_vx', i, P.ENEMY_WALK),
                ]),
            ], [
                // 중력 + 지형
                L.set('vy', calc(valueAt('it_vy', i), '+', P.ENEMY_GRAVITY)),
                if_(cmp(L.get('vy'), '>', P.MAX_FALL), [L.set('vy', P.MAX_FALL)]),
                L.set('ny', calc(L.get('y'), '+', L.get('vy'))),
                if_(cmp(call('bh', L.get('x'), L.get('ny'), IT_W, IT_H), '==', 1), [
                    L.set('y', calc(quotient(calc(L.get('ny'), '+', 1), TILE), '*', TILE)),
                    L.set('vy', 0),
                    // star 는 착지할 때 튄다 (요구사항: 아이템별 궤도 차이)
                    if_(cmp(valueAt('it_kind', i), '==', txt('star')), [L.set('vy', -7)]),
                ], [
                    L.set('y', L.get('ny')),
                ]),
                setListAt('it_vy', i, L.get('vy')),
                // 수평 — 벽에서 반전
                L.set('nx', calc(L.get('x'), '+', valueAt('it_vx', i))),
                if_(cmp(call('bh', L.get('nx'), L.get('y'), IT_W, IT_H), '==', 1), [
                    setListAt('it_vx', i, calc(0, '-', valueAt('it_vx', i))),
                ], [
                    L.set('x', L.get('nx')),
                ]),
                // 획득 판정
                if_(cmp(call('ov',
                    getVar('px'), getVar('py'), P.HITBOX_W, getVar('box_h'),
                    L.get('x'), L.get('y'), IT_W, IT_H), '==', 1), [
                    L.set('k', valueAt('it_kind', i)),
                    ...applyItem(L.get('k')),
                    setListAt('it_alive', i, 0),
                    changeVar('dbg_items_got', 1),
                ]),
                // 화면 밖 아래로 떨어지면 회수
                if_(cmp(L.get('y'), '>', (ROWS + 2) * TILE), [setListAt('it_alive', i, 0)]),
            ]),
            setListAt('it_x', i, L.get('x')),
            setListAt('it_y', i, L.get('y')),
        ]),
    ],
    ['x', 'y', 'vy', 'nx', 'ny', 'k'],
);

// 아이템 전체 순회 + 그리기 (한 번에 — 순회를 두 번 하면 낭비)
const fnItemAll = fn.value('ia', ['i'],
    (i, L) => [
        if_(cmp(i, '>', MAX_ITEMS), [
            L.set('r', 0),
        ], [
            call('it', i),
            if_(cmp(valueAt('it_alive', i), '==', 1), [
                L.set('sx', calc(calc(valueAt('it_x', i), '-', getVar('cam_x')), '-', HALF_W)),
                if_(cmp(L.get('sx'), '>', -HALF_W - TILE), [
                    if_(cmp(L.get('sx'), '<', HALF_W + TILE), [
                        L.set('nm', combine(txt('i_'), valueAt('it_kind', i))),
                        changeShape(L.get('nm')),
                        locateXY(L.get('sx'),
                            calc(calc(ROW0_Y + TILE / 2, '-', valueAt('it_y', i)), '+', 2)),
                        stamp(),
                    ]),
                ]),
            ]),
            L.set('r', call('ia', calc(i, '+', 1))),
        ]),
    ],
    (i, L) => L.get('r'),
    ['r', 'sx', 'nm'],
);

// 발사체 히트박스·중심 오프셋도 TILE 에서 유도한다 (IT_W 와 같은 이유).
const SH_S = Math.round(TILE * 0.5);   // 12px — 타일 절반

// 발사체 — 빔 상태에서 X 키로 발사. 적을 맞히면 처치(스파이크샤드 제외).
const fnShotStep = fn.normal('ss', ['i'],
    (i, L) => [
        if_(cmp(valueAt('sh_life', i), '>', 0), [
            setListAt('sh_life', i, calc(valueAt('sh_life', i), '-', 1)),
            L.set('x', calc(valueAt('sh_x', i), '+', valueAt('sh_vx', i))),
            L.set('y', calc(valueAt('sh_y', i), '+', valueAt('sh_vy', i))),
            // 지형에 맞으면 소멸
            if_(cmp(call('sa', L.get('x'), calc(L.get('y'), '-', SH_S / 2)), '==', 1), [
                setListAt('sh_life', i, 0),
            ]),
            setListAt('sh_x', i, L.get('x')),
            setListAt('sh_y', i, L.get('y')),
            // 적 판정
            call('sht', i, 1),
        ]),
    ],
    ['x', 'y'],
);

// 발사체 i ↔ 적 j 순회
const fnShotHit = fn.normal('sht', ['i', 'j'],
    (i, j, L) => [
        if_(cmp(j, '<=', EN_N), [
            if_(cmp(valueAt('sh_life', i), '>', 0), [
                if_(cmp(valueAt('en_state', j), '<', 3), [
                    if_(cmp(call('ov',
                        valueAt('sh_x', i), valueAt('sh_y', i), SH_S, SH_S,
                        valueAt('en_x', j), valueAt('en_y', j), EN_W, EN_H), '==', 1), [
                        // 스파이크샤드는 발사체로 못 죽인다 (요구사항 F)
                        if_(cmp(valueAt('en_kind', j), '!=', txt('s')), [
                            setListAt('en_state', j, 3),
                            changeVar('score', 200),
                            changeVar('dbg_shot_kills', 1),
                        ]),
                        setListAt('sh_life', i, 0),
                    ]),
                ]),
            ]),
            call('sht', i, calc(j, '+', 1)),
        ]),
    ],
    [],
);

// 빈 발사체 슬롯을 찾아 발사 (없으면 무시 — 풀 크기가 연사 상한이 된다)
const fnShotFire = fn.value('sf', ['i'],
    (i, L) => [
        L.set('r', 0),
        if_(cmp(i, '<=', MAX_SHOTS), [
            if_(cmp(valueAt('sh_life', i), '<=', 0), [
                setListAt('sh_x', i, getVar('px')),
                // 발사 높이 = 가슴 높이. 히트박스 높이에서 유도한다 (32px 시절 20 리터럴).
                setListAt('sh_y', i, calc(getVar('py'), '-', Math.round(P.HITBOX_H * 0.6))),
                setListAt('sh_vx', i, calc(P.SHOT_SPEED, '*', getVar('face'))),
                setListAt('sh_vy', i, 0),
                setListAt('sh_life', i, P.SHOT_LIFE),
                changeVar('dbg_shots', 1),
                L.set('r', i),
            ], [
                L.set('r', call('sf', calc(i, '+', 1))),
            ]),
        ]),
    ],
    (i, L) => L.get('r'),
    ['r'],
);

// 발사체 전체 + 그리기
const fnShotAll = fn.value('sa2', ['i'],
    (i, L) => [
        if_(cmp(i, '>', MAX_SHOTS), [
            L.set('r', 0),
        ], [
            call('ss', i),
            if_(cmp(valueAt('sh_life', i), '>', 0), [
                changeShape('i_shot'),
                locateXY(calc(calc(valueAt('sh_x', i), '-', getVar('cam_x')), '-', HALF_W),
                    calc(ROW0_Y + TILE / 2, '-', valueAt('sh_y', i))),
                stamp(),
            ]),
            L.set('r', call('sa2', calc(i, '+', 1))),
        ]),
    ],
    (i, L) => L.get('r'),
    ['r'],
);

// ════════════════════════════════════════════════════════════════
// player — 입력 → 물리 → 충돌 → 상태
// ════════════════════════════════════════════════════════════════

// 수평 이동 서브스텝 재귀: 남은 거리를 SUBSTEP 씩 나눠 이동, 벽에 닿으면 멈춘다.
const fnMoveX = fn.value('mx', ['remain', 'dir'],
    (remain, dir, L) => [
        L.set('done', 0),
        if_(cmp(remain, '<=', 0), [
            L.set('done', 1),
        ], [
            L.set('step', P.SUBSTEP),
            if_(cmp(remain, '<', P.SUBSTEP), [L.set('step', remain)]),
            L.set('nx', calc(getVar('px'), '+', calc(L.get('step'), '*', dir))),
            L.set('h', call('bh', L.get('nx'), getVar('py'), P.HITBOX_W, getVar('box_h'))),
            if_(cmp(L.get('h'), '==', 1), [
                // 벽 — 속도 0, 중단
                setVar('vx', 0),
                L.set('done', 1),
            ], [
                setVar('px', L.get('nx')),
                L.set('done', call('mx', calc(remain, '-', L.get('step')), dir)),
            ]),
        ]),
    ],
    (remain, dir, L) => L.get('done'),
    ['done', 'step', 'nx', 'h'],
);

// 수직 이동 서브스텝: 아래로는 착지(grounded), 위로는 천장 머리박기 판정.
// 머리박기는 블록 반응(벽돌 파괴/보상)을 일으키므로 bumped/hit_r/hit_c 에 기록한다.
const fnMoveY = fn.value('my', ['remain', 'dir'],
    (remain, dir, L) => [
        L.set('done', 0),
        if_(cmp(remain, '<=', 0), [
            L.set('done', 1),
        ], [
            L.set('step', P.SUBSTEP),
            if_(cmp(remain, '<', P.SUBSTEP), [L.set('step', remain)]),
            // dir = +1 아래로(월드 y 증가), -1 위로
            L.set('ny', calc(getVar('py'), '+', calc(L.get('step'), '*', dir))),
            L.set('h', call('bh', getVar('px'), L.get('ny'), P.HITBOX_W, getVar('box_h'))),
            if_(cmp(L.get('h'), '==', 1), [
                if_(cmp(dir, '>', 0), [
                    // 착지 — 발을 타일 상단에 스냅
                    setVar('grounded', 1),
                    setVar('vy', 0),
                    setVar('py', calc(quotient(calc(L.get('ny'), '+', 1), TILE), '*', TILE)),
                ], [
                    // 천장 머리박기 — 어느 칸을 쳤는지 기록
                    setVar('vy', 0),
                    setVar('bumped', 1),
                    setVar('hit_c', quotient(getVar('px'), TILE)),
                    setVar('hit_r', quotient(calc(L.get('ny'), '-', getVar('box_h')), TILE)),
                ]),
                L.set('done', 1),
            ], [
                setVar('py', L.get('ny')),
                L.set('done', call('my', calc(remain, '-', L.get('step')), dir)),
            ]),
        ]),
    ],
    (remain, dir, L) => L.get('done'),
    ['done', 'step', 'ny', 'h'],
);

// 현재 히트박스 높이를 box_h 에 넣는다 (상태별로 다름 — 요구사항 D).
// box_h 는 fnMoveX/fnMoveY 가 히트박스 높이로 읽는 약속된 슬롯이다.
const setHitboxH = [
    setVar('box_h', P.HITBOX_H),
    if_(cmp(getVar('power'), '>', PW.BASE), [setVar('box_h', P.HITBOX_H_BIG)]),
    if_(cmp(getVar('ducking'), '==', 1), [setVar('box_h', P.HITBOX_H_DUCK)]),
];

// ── 입력 읽기 ──────────────────────────────────────────────────
// 좌우 = 화살표, 점프 = 위 또는 z, 달리기/발사 = x, 시작 = Enter.
// 동시 입력이 서로를 지우지 않아야 한다 (요구사항 B) → 각 키를 독립 변수에 담는다.
const K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, Z: 90, X: 88, ENTER: 13, P: 80 };

const readInput = [
    // 점프 의도: 위 또는 z (둘 중 하나라도)
    setVar('prev_jump', getVar('want_jump')),
    setVar('want_jump', 0),
    if_(isPressed(K.UP), [setVar('want_jump', 1)]),
    if_(isPressed(K.Z), [setVar('want_jump', 1)]),
    // 달리기/발사
    setVar('run_held', 0),
    if_(isPressed(K.X), [setVar('run_held', 1)]),
];

// ── 수평 물리 (요구사항 B: 걷기/달리기 최대속도·가속·감속·턴 관성 구분) ──
const horizontalPhysics = [
    // 목표 최대 속도
    setVar('max_spd', P.WALK_MAX),
    if_(cmp(getVar('run_held'), '==', 1), [setVar('max_spd', P.RUN_MAX)]),
    // 가속도 — 공중에서는 약하게 (요구사항 B: 공중 제어력 감소)
    setVar('accel', P.ACCEL),
    if_(cmp(getVar('grounded'), '==', 0), [setVar('accel', P.AIR_ACCEL)]),

    setVar('skidding', 0),
    if_(isPressed(K.RIGHT), [
        // 왼쪽으로 가던 중 오른쪽 입력 → 스키드(강한 감속). 지상에서만 스키드 표시.
        if_(cmp(getVar('vx'), '<', 0), [
            setVar('vx', calc(getVar('vx'), '+', P.SKID_DECEL)),
            if_(cmp(getVar('grounded'), '==', 1), [setVar('skidding', 1)]),
        ], [
            setVar('vx', calc(getVar('vx'), '+', getVar('accel'))),
            if_(cmp(getVar('vx'), '>', getVar('max_spd')), [setVar('vx', getVar('max_spd'))]),
        ]),
        setVar('face', 1),
    ], [
        if_(isPressed(K.LEFT), [
            if_(cmp(getVar('vx'), '>', 0), [
                setVar('vx', calc(getVar('vx'), '-', P.SKID_DECEL)),
                if_(cmp(getVar('grounded'), '==', 1), [setVar('skidding', 1)]),
            ], [
                setVar('vx', calc(getVar('vx'), '-', getVar('accel'))),
                if_(cmp(getVar('vx'), '<', calc(0, '-', getVar('max_spd'))), [
                    setVar('vx', calc(0, '-', getVar('max_spd'))),
                ]),
            ]),
            setVar('face', -1),
        ], [
            // 입력 없음 → 마찰. 지상에서만 (공중에서는 관성 유지 — 원작 특성)
            if_(cmp(getVar('grounded'), '==', 1), [
                if_(cmp(getVar('vx'), '>', 0), [
                    setVar('vx', calc(getVar('vx'), '-', P.FRICTION)),
                    if_(cmp(getVar('vx'), '<', 0), [setVar('vx', 0)]),
                ]),
                if_(cmp(getVar('vx'), '<', 0), [
                    setVar('vx', calc(getVar('vx'), '+', P.FRICTION)),
                    if_(cmp(getVar('vx'), '>', 0), [setVar('vx', 0)]),
                ]),
            ]),
        ]),
    ]),
    // ⚠️ 여기에 "아주 느리면 0 으로 스냅" (|vx| < MIN_SPEED → 0) 을 두면 안 된다.
    // ACCEL(0.074) < MIN_SPEED(0.10) 이므로 가속 첫 프레임의 vx 가 곧바로 스냅에
    // 걸려 0 이 되고, 다음 프레임도 같은 일이 반복돼 **영원히 움직이지 못한다**.
    // 기어가기 방지는 위 마찰 분기가 이미 처리한다 (부호가 바뀌는 순간 정확히 0).
];

// ── 점프 (요구사항 B: 누른 시간에 따른 가변 높이, 코요테 타임 없음) ──
const jumpPhysics = [
    // 새로 눌린 순간에만 점프 시작 (누르고 있는 동안 반복 점프 금지)
    if_(cmp(getVar('grounded'), '==', 1), [
        if_(cmp(getVar('want_jump'), '==', 1), [
            if_(cmp(getVar('prev_jump'), '==', 0), [
                setVar('vy', calc(0, '-', P.JUMP_V)),
                // 달리는 중이면 더 높게
                if_(cmp(getVar('run_held'), '==', 1), [
                    setVar('vy', calc(0, '-', P.JUMP_V_RUN)),
                ]),
                setVar('grounded', 0),
                setVar('jump_held', 1),
                setVar('jump_frames', 0),
            ]),
        ]),
    ]),
    // 상승 중 버튼을 떼면 즉시 강한 중력으로 전환 → 짧은 점프
    if_(cmp(getVar('want_jump'), '==', 0), [setVar('jump_held', 0)]),
    if_(cmp(getVar('jump_frames'), '>=', P.JUMP_HOLD_MAX), [setVar('jump_held', 0)]),
    // 중력
    setVar('grav', P.GRAVITY_CUT),
    if_(cmp(getVar('jump_held'), '==', 1), [
        if_(cmp(getVar('vy'), '<', 0), [
            setVar('grav', P.GRAVITY_HOLD),
            changeVar('jump_frames', 1),
        ]),
    ]),
    setVar('vy', calc(getVar('vy'), '+', getVar('grav'))),
    if_(cmp(getVar('vy'), '>', P.MAX_FALL), [setVar('vy', P.MAX_FALL)]),
];

// ── 이동 적용 + 충돌 (서브스텝) ────────────────────────────────
const applyMovement = [
    // 이동 **전** 위치를 남긴다. actors 스레드의 밟기 판정이 이 값을 읽어
    // "위에서 내려왔는지" 를 속도와 무관하게 판단한다.
    setVar('prev_py', getVar('py')),
    ...setHitboxH,
    // 수평
    if_(cmp(getVar('vx'), '>', 0), [
        setVar('sink', call('mx', getVar('vx'), 1)),
    ], [
        if_(cmp(getVar('vx'), '<', 0), [
            setVar('sink', call('mx', calc(0, '-', getVar('vx')), -1)),
        ]),
    ]),
    // 월드 경계 — 왼쪽으로 화면 밖 이탈 금지
    if_(cmp(getVar('px'), '<', TILE / 2), [setVar('px', TILE / 2), setVar('vx', 0)]),
    if_(cmp(getVar('px'), '>', WORLD_W - TILE / 2), [
        setVar('px', WORLD_W - TILE / 2), setVar('vx', 0),
    ]),
    // 수직 — 이동 전에 grounded 를 내려두고, 아래 충돌이 발생하면 다시 1 이 된다
    setVar('grounded', 0),
    setVar('bumped', 0),
    if_(cmp(getVar('vy'), '>', 0), [
        setVar('sink', call('my', getVar('vy'), 1)),
    ], [
        if_(cmp(getVar('vy'), '<', 0), [
            setVar('sink', call('my', calc(0, '-', getVar('vy')), -1)),
        ]),
    ]),
    // 발밑 확인 — 속도가 0 이어도 지면 접촉 상태를 유지해야 점프가 가능하다.
    // (요구사항 B: 코요테 타임 없음 → 실제로 발밑에 타일이 있어야만 grounded)
    if_(cmp(getVar('vy'), '>=', 0), [
        if_(cmp(call('sa', calc(getVar('px'), '-', P.HITBOX_W / 2), calc(getVar('py'), '+', 2)), '==', 1), [
            setVar('grounded', 1),
        ]),
        if_(cmp(call('sa', calc(getVar('px'), '+', P.HITBOX_W / 2), calc(getVar('py'), '+', 2)), '==', 1), [
            setVar('grounded', 1),
        ]),
    ]),
];

// ── 블록 반응 (머리로 치기 — 요구사항 E) ──────────────────────
// bumped=1 이면 이번 프레임에 천장을 쳤다. hit_r/hit_c 가 그 칸.
const blockReaction = [
    if_(cmp(getVar('bumped'), '==', 1), [
        setVar('tile_ch', call('ta', getVar('hit_c'), getVar('hit_r'))),
        // 보상 블록 → 내용물 배출 후 'u'(사용 완료)
        if_(cmp(getVar('tile_ch'), '==', txt('?')), [
            setVar('sink', call('st', getVar('hit_c'), getVar('hit_r'), txt('u'))),
            changeVar('dbg_rewards_used', 1),
            // 내용물 종류에 따라 즉시 반영 (아이템 오브젝트는 items 가 처리)
            setVar('reward', call('rk', getVar('hit_r'), getVar('hit_c'))),
            if_(cmp(getVar('reward'), '==', txt('coin')), [
                changeVar('coins', 1), changeVar('score', 200), changeVar('dbg_coins_got', 1),
            ], [
                // 아이템 스폰 — **고정 크기 풀의 빈 슬롯에 덮어쓴다.** 리스트에
                // add 하면 재시작을 반복할 때마다 배열이 자라 "중복"이 생긴다.
                call('isp', getVar('reward'),
                    calc(calc(getVar('hit_c'), '*', TILE), '+', TILE / 2),
                    calc(getVar('hit_r'), '*', TILE)),
            ]),
        ]),
        // 벽돌 → 강화 상태에서만 파괴 (요구사항 E: 조건부 파괴)
        if_(cmp(getVar('tile_ch'), '==', txt('B')), [
            if_(cmp(getVar('power'), '>', PW.BASE), [
                setVar('sink', call('st', getVar('hit_c'), getVar('hit_r'), txt('.'))),
                changeVar('score', 50),
                changeVar('dbg_bricks_broken', 1),
            ]),
        ]),
        setVar('bumped', 0),
    ]),
];

// ── 동전 수집 (겹치는 타일이 'c' 면 먹는다) ────────────────────
const collectCoins = [
    setVar('hit_c', quotient(getVar('px'), TILE)),
    setVar('hit_r', quotient(calc(getVar('py'), '-', 16), TILE)),
    if_(cmp(call('ta', getVar('hit_c'), getVar('hit_r')), '==', txt('c')), [
        setVar('sink', call('st', getVar('hit_c'), getVar('hit_r'), txt('.'))),
        changeVar('coins', 1), changeVar('score', 200), changeVar('dbg_coins_got', 1),
    ]),
];

// ── 발사 (요구사항 D: 원거리 상태) ─────────────────────────────
// X 키는 달리기와 겸용이다. 빔 등급일 때만 발사되고, 새로 눌린 순간에만 1 발.
const shootCheck = [
    setVar('want_shoot', 0),
    if_(isPressed(K.X), [setVar('want_shoot', 1)]),
    if_(cmp(getVar('power'), '==', PW.BEAM), [
        if_(cmp(getVar('want_shoot'), '==', 1), [
            if_(cmp(getVar('prev_shoot'), '==', 0), [
                setVar('sink', call('sf', 1)),
            ]),
        ]),
    ]),
    setVar('prev_shoot', getVar('want_shoot')),
];

// ── 피격 처리 (요구사항 D: 등급 하락 → 무적 / 기본 등급이면 사망) ──
const hurtCheck = [
    if_(cmp(getVar('want_hurt'), '==', 1), [
        setVar('want_hurt', 0),
        // 무적 프레임 중이면 무시
        if_(cmp(getVar('invuln'), '<=', 0), [
            if_(cmp(getVar('power'), '>', PW.BASE), [
                // 한 등급 하락 + 짧은 무적
                changeVar('power', -1),
                setVar('invuln', P.INVULN_FRAMES),
                changeVar('dbg_hurts', 1),
            ], [
                setVar('death_cause', DEATH.ENEMY),
                setVar('state', ST.DYING),
            ]),
        ]),
    ]),
];

// ── 체크포인트 (요구사항 G Phase2) ─────────────────────────────
const checkpointCheck = [
    if_(cmp(quotient(getVar('px'), TILE), '>=', CHECKPOINT_COL), [
        if_(cmp(getVar('checkpoint_col'), '<', CHECKPOINT_COL), [
            setVar('checkpoint_col', CHECKPOINT_COL),
            setVar('dbg_checkpoint', 1),
        ]),
    ]),
];

// ── 사망 판정 (요구사항 C: 원인 구분) ──────────────────────────
const deathChecks = [
    // 추락 — 그리드 아래로 떨어짐
    if_(cmp(getVar('py'), '>', (ROWS + 1) * TILE), [
        setVar('death_cause', DEATH.FALL),
        setVar('state', ST.DYING),
    ]),
    // 시간 초과
    if_(cmp(getVar('time_left'), '<=', 0), [
        setVar('death_cause', DEATH.TIMEOUT),
        setVar('state', ST.DYING),
    ]),
    // 가시 결정 타일 접촉 (요구사항 C: 발사체/위험물 접촉 구분)
    if_(cmp(call('ta', quotient(getVar('px'), TILE),
        quotient(calc(getVar('py'), '-', 8), TILE)), '==', txt('^')), [
        setVar('death_cause', DEATH.HAZARD),
        setVar('want_hurt', 1),
    ]),
];

// ── 목표 도달 ──────────────────────────────────────────────────
const goalCheck = [
    if_(cmp(quotient(getVar('px'), TILE), '>=', stage.goalCol), [
        setVar('state', ST.STAGE_CLEAR),
        setVar('state_timer', P.CLEAR_FRAMES),
        setVar('dbg_clear', 1),
    ]),
];

// ════════════════════════════════════════════════════════════════
// 리셋 (요구사항: 여러 번 재시작 후에도 오브젝트/클론 중복 없음)
// ════════════════════════════════════════════════════════════════
//
// 클론을 쓰지 않으므로 "중복" 은 **리스트 길이 증가**로만 생길 수 있다.
// 그래서 리셋은 새 항목을 추가하지 않고 **기존 슬롯에 덮어쓰기만** 한다
// (setListAt 만 쓰고 add_value_to_list 를 쓰지 않는다).

// 타일 원본 복원 꼬리재귀
const fnResetTiles = fn.value('rt', ['r'],
    (r, L) => [
        if_(cmp(r, '>', ROWS), [
            L.set('o', 0),
        ], [
            setListAt('lvl', r, valueAt('lvl_src', r)),
            L.set('o', call('rt', calc(r, '+', 1))),
        ]),
    ],
    (r, L) => L.get('o'),
    ['o'],
);

// 적 원위치 복원 꼬리재귀
const fnResetEnemies = fn.value('re', ['i'],
    (i, L) => [
        if_(cmp(i, '>', EN_N), [
            L.set('o', 0),
        ], [
            setListAt('en_x', i, valueAt('en_home', i)),
            setListAt('en_y', i, valueAt('en_homey', i)),
            setListAt('en_vy', i, 0),
            setListAt('en_state', i, 0),
            setListAt('en_timer', i, 0),
            // 스파이크샤드는 정지, 나머지는 왼쪽으로 걷기 시작
            if_(cmp(valueAt('en_kind', i), '==', txt('s')), [
                setListAt('en_vx', i, 0),
            ], [
                setListAt('en_vx', i, calc(0, '-', P.ENEMY_WALK)),
            ]),
            L.set('o', call('re', calc(i, '+', 1))),
        ]),
    ],
    (i, L) => L.get('o'),
    ['o'],
);

// 아이템/발사체 풀 비우기 꼬리재귀
const fnResetPools = fn.value('rp', ['i'],
    (i, L) => [
        if_(cmp(i, '>', Math.max(MAX_ITEMS, MAX_SHOTS)), [
            L.set('o', 0),
        ], [
            if_(cmp(i, '<=', MAX_ITEMS), [
                setListAt('it_alive', i, 0),
                setListAt('it_rise', i, 0),
                setListAt('it_kind', i, txt('-')),
            ]),
            if_(cmp(i, '<=', MAX_SHOTS), [
                setListAt('sh_life', i, 0),
            ]),
            L.set('o', call('rp', calc(i, '+', 1))),
        ]),
    ],
    (i, L) => L.get('o'),
    ['o'],
);

// 스테이지(재)시작 — 사망 후 체크포인트에서, 또는 처음부터.
const respawn = [
    setVar('sink', call('rt', 1)),
    setVar('sink', call('re', 1)),
    setVar('sink', call('rp', 1)),
    setVar('px', calc(calc(getVar('checkpoint_col'), '*', TILE), '+', TILE / 2)),
    setVar('py', GROUND * TILE),
    setVar('vx', 0), setVar('vy', 0),
    setVar('power', PW.BASE),
    setVar('invuln', P.INVULN_FRAMES), setVar('star', 0),
    setVar('combo', 0), setVar('chain', 0),
    setVar('ducking', 0), setVar('grounded', 1),
    setVar('jump_held', 0), setVar('want_hurt', 0), setVar('stomp_lock', 0),
    setVar('time_left', stage.timeLimit), setVar('time_frac', 0),
    // 카메라를 부활 지점으로 되감는다 (뒤로 스크롤 금지 규칙의 유일한 예외)
    setVar('cam_x', 0),
    if_(cmp(getVar('px'), '>', SCR_W * P.CAM_ANCHOR), [
        setVar('cam_x', calc(getVar('px'), '-', SCR_W * P.CAM_ANCHOR)),
    ]),
    if_(cmp(getVar('cam_x'), '>', CAM_MAX), [setVar('cam_x', CAM_MAX)]),
    changeVar('dbg_restarts', 1),
];

// ── 애니메이션 모양 선택 (요구사항 D) ──────────────────────────
const animate = [
    setVar('shape', txt('hero_idle')),
    if_(cmp(getVar('power'), '>', PW.BASE), [setVar('shape', txt('hero_power'))]),
    if_(cmp(getVar('ducking'), '==', 1), [setVar('shape', txt('hero_crouch'))]),
    // 이동 중
    if_(cmp(getVar('ducking'), '==', 0), [
        if_(cmp(getVar('grounded'), '==', 1), [
            if_(cmp(getVar('skidding'), '==', 1), [
                setVar('shape', txt('hero_skid')),
            ], [
                if_(cmp(getVar('vx'), '>', 0.3), [
                    setVar('shape', txt('hero_walk')),
                    if_(cmp(getVar('vx'), '>', P.WALK_MAX), [setVar('shape', txt('hero_run'))]),
                ]),
                if_(cmp(getVar('vx'), '<', -0.3), [
                    setVar('shape', txt('hero_walk')),
                    if_(cmp(getVar('vx'), '<', calc(0, '-', P.WALK_MAX)), [setVar('shape', txt('hero_run'))]),
                ]),
            ]),
        ], [
            setVar('shape', txt('hero_jump')),
        ]),
    ]),
    // 피격 연출
    if_(cmp(getVar('state'), '==', ST.DYING), [setVar('shape', txt('hero_hurt'))]),
    // 좌향이면 _l 접미사 (stamp 가 아니라 실제 오브젝트라 flipX 도 되지만,
    // 모양을 따로 두면 도트가 뭉개지지 않는다)
    if_(cmp(getVar('face'), '<', 0), [
        if_(cmp(getVar('shape'), '!=', txt('hero_crouch')), [
            if_(cmp(getVar('shape'), '!=', txt('hero_hurt')), [
                setVar('shape', combine(getVar('shape'), txt('_l'))),
            ]),
        ]),
    ]),
    changeShape(getVar('shape')),
    // 화면 위치로 배치 (월드 → 화면)
    locateXY(
        calc(getVar('px'), '-', calc(getVar('cam_x'), '+', HALF_W)),
        calc(calc(ROW0_Y + TILE / 2, '-', getVar('py')), '+', 22),
    ),
    // 무적 중 깜빡임
    if_(cmp(getVar('invuln'), '>', 0), [
        setVar('blink', mod(getVar('invuln'), 8)),
        if_(cmp(getVar('blink'), '<', 4), [setEffect('transparency', 50)], [setEffect('transparency', 0)]),
    ], [
        setEffect('transparency', 0),
    ]),
];

export default {
    name: 'Brick Kingdom',
    speed: 60,
    scenes: [makeScene('main', '구리 평원')],
    variables,
    lists,
    functions: [
        fnTileAt, fnSolid, fnSolidAt, fnSetTile, fnBoxHits, fnOverlap,
        fnRewardKind, fnRewardLookup,
        fnDrawTiles, fnMoveX, fnMoveY,
        fnEnemyStep, fnShellChain, fnEnemyHit, fnEnemyAll, fnDrawEnemies,
        fnItemSlot, fnItemSpawn, fnItemStep, fnItemAll,
        fnShotStep, fnShotHit, fnShotFire, fnShotAll,
        fnResetTiles, fnResetEnemies, fnResetPools,
    ],
    objects: [
        // ── sky: 배경색 판 ──
        // 엔트리 장면 배경은 흰색이 기본이다. 스테이지 종류별 하늘색을 깔기 위해
        // 화면을 덮는 단색 사각형을 맨 뒤 레이어에 둔다 (요구사항 A: 스테이지 유형별 배경).
        obj('sky', '하늘', {
            scene: 'main',
            picture: { name: 'sky', ...SKY_PIC },
            rotateMethod: 'none',
            entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, direction: 90, visible: true },
            threads: [[
                when.run(),
                zOrder('BACK'),
            ]],
        }),

        // ── player: 입력 → 물리 → 상태 ──
        obj('player', '코퍼', {
            scene: 'main',
            pictures: [
                { name: 'hero_idle', ...SPRITES.hero_idle() },
                { name: 'hero_walk', ...SPRITES.hero_walk() },
                { name: 'hero_run', ...SPRITES.hero_run() },
                { name: 'hero_jump', ...SPRITES.hero_jump() },
                { name: 'hero_skid', ...SPRITES.hero_skid() },
                { name: 'hero_crouch', ...SPRITES.hero_crouch() },
                { name: 'hero_hurt', ...SPRITES.hero_hurt() },
                { name: 'hero_power', ...SPRITES.hero_power() },
                { name: 'hero_idle_l', ...SPRITES.hero_idle_l() },
                { name: 'hero_walk_l', ...SPRITES.hero_walk_l() },
                { name: 'hero_run_l', ...SPRITES.hero_run_l() },
                { name: 'hero_jump_l', ...SPRITES.hero_jump_l() },
                { name: 'hero_skid_l', ...SPRITES.hero_skid_l() },
                { name: 'hero_power_l', ...SPRITES.hero_power_l() },
            ],
            rotateMethod: 'none',
            entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, direction: 90, visible: true },
            threads: [
                // 메인 루프 — 한 프레임에 입력→물리→충돌→반응→렌더 순서로 처리.
                // 상태 머신(요구사항 A)은 이 하나의 루프 안에서 분기한다: 상태별로
                // 스레드를 나누면 전환 순간에 두 스레드가 같은 프레임을 다뤄 꼬인다.
                [
                    when.run(),
                    turnAbs(90),
                    setVar('lives', 3), setVar('score', 0), setVar('coins', 0),
                    setVar('checkpoint_col', stage.spawnCol),
                    setVar('state', ST.TITLE),
                    setVar('px', stage.spawnCol * TILE + TILE / 2),
                    setVar('py', GROUND * TILE),
                    repeat.inf([
                        // ① TITLE — Enter 로 시작 (요구사항 B: Enter = 시작)
                        if_(cmp(getVar('state'), '==', ST.TITLE), [
                            if_(isPressed(K.ENTER), [
                                setVar('lives', 3), setVar('score', 0), setVar('coins', 0),
                                setVar('checkpoint_col', stage.spawnCol),
                                setVar('dbg_restarts', 0),
                                ...respawn,
                                setVar('state', ST.READY),
                                setVar('state_timer', 60),
                            ]),
                        ]),
                        // ② READY — 짧은 대기 후 플레이 (원작의 "스테이지 표시" 구간)
                        if_(cmp(getVar('state'), '==', ST.READY), [
                            changeVar('state_timer', -1),
                            if_(cmp(getVar('state_timer'), '<=', 0), [
                                setVar('state', ST.PLAYING),
                            ]),
                        ]),
                        // ③ PLAYING
                        if_(cmp(getVar('state'), '==', ST.PLAYING), [
                            ...readInput,
                            // 일시정지 (요구사항 A: PAUSED 상태) — P 키
                            if_(isPressed(K.P), [
                                setVar('state', ST.PAUSED),
                                setVar('state_timer', 20),
                            ]),
                            // 웅크리기 — 지상에서 아래키 (요구사항 D)
                            setVar('ducking', 0),
                            if_(cmp(getVar('grounded'), '==', 1), [
                                if_(isPressed(K.DOWN), [setVar('ducking', 1)]),
                            ]),
                            ...horizontalPhysics,
                            ...jumpPhysics,
                            ...applyMovement,
                            ...blockReaction,
                            ...collectCoins,
                            ...shootCheck,
                            ...hurtCheck,
                            ...checkpointCheck,
                            ...deathChecks,
                            ...goalCheck,
                            // 지상에 있으면 연속 밟기 콤보 종료
                            if_(cmp(getVar('grounded'), '==', 1), [setVar('combo', 0)]),
                            if_(cmp(getVar('invuln'), '>', 0), [changeVar('invuln', -1)]),
                            if_(cmp(getVar('star'), '>', 0), [changeVar('star', -1)]),
                            if_(cmp(getVar('stomp_lock'), '>', 0), [changeVar('stomp_lock', -1)]),
                            // DYING 으로 막 바뀌었으면 사망 연출 타이머를 건다
                            if_(cmp(getVar('state'), '==', ST.DYING), [
                                setVar('state_timer', P.DYING_FRAMES),
                                setVar('vy', calc(0, '-', P.JUMP_V)),   // 사망 점프 (요구사항 D)
                                changeVar('dbg_deaths', 1),
                            ]),
                        ]),
                        // ④ PAUSED — P 로 재개 (연타 방지 쿨다운)
                        if_(cmp(getVar('state'), '==', ST.PAUSED), [
                            changeVar('state_timer', -1),
                            if_(cmp(getVar('state_timer'), '<=', 0), [
                                if_(isPressed(K.P), [
                                    setVar('state', ST.PLAYING),
                                    setVar('state_timer', 0),
                                ]),
                            ]),
                        ]),
                        // ⑤ DYING — 사망 점프 연출 후 재시작 또는 게임오버.
                        // 낙하 속도를 MAX_FALL 로 묶고 화면 아래에서 py 를 고정한다.
                        // 안 묶으면 120 프레임 동안 vy 가 132px/f 까지 자라 py 가 5,000 이
                        // 넘고, animate 의 locateXY 가 좌표 범위를 벗어난다.
                        if_(cmp(getVar('state'), '==', ST.DYING), [
                            setVar('vy', calc(getVar('vy'), '+', P.GRAVITY_CUT)),
                            if_(cmp(getVar('vy'), '>', P.MAX_FALL), [setVar('vy', P.MAX_FALL)]),
                            setVar('py', calc(getVar('py'), '+', getVar('vy'))),
                            if_(cmp(getVar('py'), '>', (ROWS + 4) * TILE), [
                                setVar('py', (ROWS + 4) * TILE),
                                setVar('vy', 0),
                            ]),
                            changeVar('state_timer', -1),
                            if_(cmp(getVar('state_timer'), '<=', 0), [
                                changeVar('lives', -1),
                                if_(cmp(getVar('lives'), '<=', 0), [
                                    setVar('state', ST.GAME_OVER),
                                    setVar('state_timer', 180),
                                ], [
                                    ...respawn,
                                    setVar('state', ST.READY),
                                    setVar('state_timer', 45),
                                ]),
                            ]),
                        ]),
                        // ⑥ STAGE_CLEAR — 깃대까지 자동 전진 (요구사항 D: 종료 자동 걷기)
                        if_(cmp(getVar('state'), '==', ST.STAGE_CLEAR), [
                            setVar('vx', P.WALK_MAX),
                            setVar('face', 1),
                            ...setHitboxH,
                            setVar('sink', call('mx', P.WALK_MAX, 1)),
                            changeVar('state_timer', -1),
                            if_(cmp(getVar('state_timer'), '<=', 0), [
                                // 다음 스테이지가 없으면 엔딩 (Phase 1 은 1 스테이지)
                                setVar('state', ST.ENDING),
                                setVar('state_timer', 240),
                            ]),
                        ]),
                        // ⑦ GAME_OVER / ⑧ ENDING — 잠시 후 타이틀로 (끊김 없는 순환)
                        if_(cmp(getVar('state'), '==', ST.GAME_OVER), [
                            changeVar('state_timer', -1),
                            if_(cmp(getVar('state_timer'), '<=', 0), [setVar('state', ST.TITLE)]),
                        ]),
                        if_(cmp(getVar('state'), '==', ST.ENDING), [
                            changeVar('state_timer', -1),
                            if_(cmp(getVar('state_timer'), '<=', 0), [setVar('state', ST.TITLE)]),
                        ]),
                        ...animate,
                    ]),
                ],
                // 시간 카운트다운 — 60 프레임 = 1 초
                [
                    when.run(),
                    repeat.inf([
                        if_(cmp(getVar('state'), '==', ST.PLAYING), [
                            changeVar('time_frac', 1),
                            if_(cmp(getVar('time_frac'), '>=', 60), [
                                setVar('time_frac', 0),
                                changeVar('time_left', -1),
                            ]),
                        ]),
                    ]),
                ],
            ],
        }),

        // ── world: 타일맵 렌더러 ──
        // stamp 는 visible 을 따르므로 visible:true 로 두고, 그리기 후 화면 밖으로 치운다.
        obj('world', '세계', {
            scene: 'main',
            pictures: [
                { name: 't_ground', ...SPRITES.t_ground() },
                { name: 't_brick', ...SPRITES.t_brick() },
                { name: 't_stone', ...SPRITES.t_stone() },
                { name: 't_reward', ...SPRITES.t_reward() },
                { name: 't_used', ...SPRITES.t_used() },
                { name: 't_pipe_top', ...SPRITES.t_pipe_top() },
                { name: 't_pipe', ...SPRITES.t_pipe() },
                { name: 't_cave', ...SPRITES.t_cave() },
                { name: 'i_coin', ...SPRITES.i_coin() },
                { name: 'g_flag', ...SPRITES.g_flag() },
            ],
            rotateMethod: 'none',
            entity: { x: 0, y: -400, scaleX: 1, scaleY: 1, direction: 90, visible: true },
            threads: [[
                when.run(),
                turnAbs(90),
                setVar('cam_x', 0), setVar('frames', 0),
                repeat.inf([
                    // 카메라는 플레이 중에만 따라간다 (사망 연출 중 튀는 것 방지).
                    // respawn 이 cam_x 를 직접 되감으므로 여기서 덮어쓰면 안 된다.
                    if_(cmp(getVar('state'), '==', ST.PLAYING), camUpdate),
                    if_(cmp(getVar('state'), '==', ST.STAGE_CLEAR), camUpdate),
                    setVar('cam_col', quotient(getVar('cam_x'), TILE)),
                    setVar('cam_frac', mod(getVar('cam_x'), TILE)),
                    eraseAll(),
                    setVar('dbg_tiles', 0),
                    setVar('sink', call('dt', 0)),
                    locateXY(0, -400),
                    changeVar('frames', 1),
                ]),
            ]],
        }),

        // ── actors: 적 · 아이템 · 발사체 (요구사항 F/H) ──
        // **클론을 쓰지 않는다.** 상태는 리스트에 있고 이 오브젝트 하나가 전부 stamp 한다.
        // → 클론별 변수 섞임(요구사항 F 마지막 항)과 재시작 후 클론 중복이 구조적으로 불가능.
        // 갱신과 그리기를 같은 꼬리재귀에서 처리해 순회를 한 번만 돈다.
        obj('actors', '적과 아이템', {
            scene: 'main',
            pictures: [
                { name: 'rollstone', ...SPRITES.rollstone() },
                { name: 'rollstone_shell', ...SPRITES.rollstone_shell() },
                { name: 'cogwalker', ...SPRITES.cogwalker() },
                { name: 'spikeshard', ...SPRITES.spikeshard() },
                { name: 'glidefin', ...SPRITES.glidefin() },
                { name: 'i_grow', ...SPRITES.i_grow() },
                { name: 'i_beam', ...SPRITES.i_beam() },
                { name: 'i_star', ...SPRITES.i_star() },
                { name: 'i_life', ...SPRITES.i_life() },
                { name: 'i_shot', ...SPRITES.i_shot() },
            ],
            rotateMethod: 'none',
            entity: { x: 0, y: -400, scaleX: 1, scaleY: 1, direction: 90, visible: true },
            threads: [[
                when.run(),
                turnAbs(90),
                repeat.inf([
                    eraseAll(),
                    setVar('dbg_active_enemies', 0),
                    // PLAYING 중에만 물리·판정을 돈다. 그 외 상태(일시정지·사망 연출·
                    // 클리어)에서는 갱신 없이 마지막 위치로 계속 그린다.
                    if_(cmp(getVar('state'), '==', ST.PLAYING), [
                        setVar('sink', call('ea', 1)),    // 적: 물리 + 플레이어 판정
                        setVar('sink', call('ia', 1)),    // 아이템: 물리 + 획득 + 그리기
                        setVar('sink', call('sa2', 1)),   // 발사체: 물리 + 적 판정 + 그리기
                    ]),
                    setVar('sink', call('de', 1)),        // 적 그리기 (상태 무관)
                    locateXY(0, -400),
                ]),
            ]],
        }),

        // ── hud: 점수 · 동전 · 지역 · 남은 시간 · 생명 (요구사항 A) ──
        obj('hud', 'HUD', {
            scene: 'main', objectType: 'textBox',
            text: '',
            // textBox 는 entity.x 가 **글상자 중심**이다 (regX 는 엔진이 0 으로 강제).
            // → 가운데 두려면 x:0. 폭에 맞춰 x 를 -width/2 로 보정하면 오히려 왼쪽으로 쏠린다
            // (knowledge/07-runtime-quirks.md §textBox 정렬).
            entity: {
                x: 0, y: 118, regX: 0, regY: 0, scaleX: 1, scaleY: 1,
                textAlign: 0, lineBreak: true, width: 460, height: 24,
                font: '15px NanumGothic', bgColor: 'transparent', colour: '#ffffff',
                visible: true,
            },
            threads: [[
                when.run(),
                repeat.inf([
                    writeText(combine(combine(combine(combine(combine(combine(combine(
                        txt('점수 '), getVar('score')),
                        txt('   ◉ ')), getVar('coins')),
                        txt('   구역 1-1   시간 ')), getVar('time_left')),
                        txt('   생명 ')), getVar('lives'))),
                    wait(0.1),
                ]),
            ]],
        }),

        // ── overlay: 타이틀 / 게임오버 / 클리어 안내 (요구사항 A) ──
        obj('overlay', '안내', {
            scene: 'main', objectType: 'textBox',
            text: '',
            entity: {
                x: 0, y: 10, regX: 0, regY: 0, scaleX: 1, scaleY: 1,
                textAlign: 0, lineBreak: true, width: 400, height: 110,
                font: '22px NanumGothic', bgColor: 'transparent', colour: '#ffe066',
                visible: true,
            },
            threads: [[
                when.run(),
                repeat.inf([
                    if_(cmp(getVar('state'), '==', ST.TITLE), [
                        writeText(txt('BRICK KINGDOM\n구리 평원\n\nEnter 로 시작')),
                    ]),
                    if_(cmp(getVar('state'), '==', ST.READY), [
                        writeText(txt('구역 1-1\n준비')),
                    ]),
                    if_(cmp(getVar('state'), '==', ST.PLAYING), [writeText(txt(''))]),
                    if_(cmp(getVar('state'), '==', ST.PAUSED), [writeText(txt('일시정지\nP 로 재개'))]),
                    if_(cmp(getVar('state'), '==', ST.DYING), [writeText(txt(''))]),
                    if_(cmp(getVar('state'), '==', ST.STAGE_CLEAR), [
                        writeText(txt('구역 통과')),
                    ]),
                    if_(cmp(getVar('state'), '==', ST.GAME_OVER), [writeText(txt('게임 오버'))]),
                    if_(cmp(getVar('state'), '==', ST.ENDING), [
                        writeText(txt('구리 평원 정복\n\n고맙습니다')),
                    ]),
                    wait(0.1),
                ]),
            ]],
        }),
    ],
};
