// Brick Kingdom — 원본 픽셀아트 자산.
//
// 전부 이 파일에서 문자 그리드로 직접 그린 자작 도트다 (외부 자산 0, 라이선스 이슈 0).
//
// 디자인 방침 — 참조 작품(1985 배관공)과 실루엣·복장·색을 겹치지 않게:
//   주인공  = **탐사 오토마톤 "코퍼"**. 구리색 몸체 + 청록 고글 바이저 + 머리 안테나.
//     모자·콧수염·멜빵바지·장갑 없음. 머리보다 몸통이 길고 어깨가 각진 로봇 실루엣.
//   적      = 생물체가 아닌 **광석·기계 계열**. 버섯/거북 실루엣을 피한다.
//   아이템  = 기하학 결정체. 꽃/버섯 형태를 쓰지 않는다.
//
// 팔레트는 NES 감성의 좁은 색폭(캐릭터당 4~5 색)으로 제한.

import { px, mirror } from './pixel-art.mjs';

// ── 공통 팔레트 ────────────────────────────────────────────────
const P = {
    // 주인공 코퍼
    c: '#c87137',   // 구리 본체
    d: '#8c4a1e',   // 구리 음영
    t: '#2ec4b6',   // 청록 바이저
    T: '#14746f',   // 청록 음영
    k: '#221a14',   // 외곽선/관절
    w: '#f2e9dc',   // 하이라이트
    // 지형
    g: '#7a5230',   // 흙
    G: '#5c3a20',   // 흙 음영
    s: '#9d7a4f',   // 흙 상단 하이라이트
    b: '#c9762b',   // 벽돌
    B: '#8f4f16',   // 벽돌 음영
    m: '#d9d2c5',   // 석재
    M: '#a39a89',   // 석재 음영
    y: '#f4c430',   // 보상 금색
    Y: '#b8860b',   // 보상 음영
    // 적
    r: '#b5453c',   // 광석 적색
    R: '#7d2b25',
    v: '#6d4c9f',   // 자수정
    V: '#452f6b',
    n: '#5a6472',   // 기계 회색
    N: '#39414c',
    // 아이템
    e: '#43d17a',   // 성장 결정 녹색
    E: '#1f8f4a',
    o: '#ff8c42',   // 원거리 결정 주황
    O: '#c25a12',
    i: '#7fd8ff',   // 무적 결정 하늘
    I: '#2e8bb8',
};

// ── 주인공 코퍼 (12w × 16h 도트) ───────────────────────────────
// 각진 어깨 + 안테나 + 가로 바이저. 실루엣이 배관공과 겹치지 않게 머리를 작게, 몸통을 길게.
const COPPER_IDLE = [
    '....kkkk....',
    '...kcccck...',
    '..kctttttk..',
    '..kcTtttTk..',
    '..kcccccck..',
    '...kkcckk...',
    '..kcccccck..',
    '.kcwccccwck.',
    'kdccccccccdk',
    'kdcckcckccdk',
    '.kcckcckcck.',
    '..kckkkkck..',
    '..kck..kck..',
    '..kck..kck..',
    '.kddk..kddk.',
    '.kkkk..kkkk.',
];

// 걷기 A — 왼발 앞
const COPPER_WALK_A = [
    '....kkkk....',
    '...kcccck...',
    '..kctttttk..',
    '..kcTtttTk..',
    '..kcccccck..',
    '...kkcckk...',
    '..kcccccck..',
    '.kcwccccwck.',
    'kdccccccccdk',
    '.kcckcckccdk',
    '..kckcckcck.',
    '..kckkkkck..',
    '.kckk..kck..',
    '.kck....kck.',
    'kddk....kddk',
    'kkkk....kkkk',
];

// 달리기 — 몸을 앞으로 기울임
const COPPER_RUN = [
    '.....kkkk...',
    '....kcccck..',
    '...kctttttk.',
    '...kcTtttTk.',
    '...kcccccck.',
    '..kkkcckk...',
    '.kcccccck...',
    'kcwccccwck..',
    'kdcccccccdk.',
    '.kcckcckcdk.',
    '..kckcckck..',
    '.kckkkkck...',
    'kckk...kck..',
    'kck.....kck.',
    'ddk.....kddk',
    'kk.......kkk',
];

// 점프 — 팔 올리고 다리 모음
const COPPER_JUMP = [
    'k..kkkk....k',
    'kk.kccck..kk',
    'kdkctttttkdk',
    '.kdcTtttTdk.',
    '..kcccccck..',
    '...kkcckk...',
    '..kcccccck..',
    '.kcccccccck.',
    'kdccccccccdk',
    'kdcckcckccdk',
    '.kcckcckcck.',
    '..kckkkkck..',
    '..kckccckk..',
    '..kck..kck..',
    '.kddk..kddk.',
    '..kk....kk..',
];

// 스키드 — 급정지 (몸 뒤로, 발 앞으로)
const COPPER_SKID = [
    '...kkkk.....',
    '..kcccck....',
    '.kctttttk...',
    '.kcTtttTk...',
    '.kcccccck...',
    '..kkcckk....',
    '.kcccccck...',
    'kcwccccwck..',
    'kdcccccccdk.',
    'kdcckcckcdk.',
    '.kcckcckck..',
    '..kckkkkck..',
    '..kck.kckk..',
    '.kck..kckk..',
    'kddk.kddk...',
    'kkk..kkk....',
];

// 웅크리기 — 높이 절반
const COPPER_CROUCH = [
    '............',
    '............',
    '............',
    '............',
    '....kkkk....',
    '...kcccck...',
    '..kctttttk..',
    '..kcTtttTk..',
    '..kcccccck..',
    '.kcwccccwck.',
    'kdccccccccdk',
    'kdcckcckccdk',
    '.kcckcckcck.',
    '..kckkkkck..',
    '.kddk..kddk.',
    '.kkkk..kkkk.',
];

// 피격/사망 — 바이저 꺼지고 팔 벌어짐
const COPPER_HURT = [
    '....kkkk....',
    '...kcccck...',
    '..kckkkkkk..',
    '..kckNNNkk..',
    '..kcccccck..',
    '...kkcckk...',
    'k.kcccccck.k',
    'kkkcwccwckkk',
    '.kdcccccccdk',
    '..kckcckck..',
    '..kckcckck..',
    '..kckkkkck..',
    '..kck..kck..',
    '.kck....kck.',
    'kddk....kddk',
    'kkk......kkk',
];

// 강화 상태 — 몸집 커진 코퍼 (12×16 유지, 어깨/가슴 강화 + 흉부 코어)
const COPPER_POWER = [
    '....kkkk....',
    '...kcccck...',
    '..kctttttk..',
    '..kcTtttTk..',
    '..kcccccck..',
    '..kkkcckkk..',
    '.kcccccccck.',
    'kcwciiiicwck',
    'kdcciIIiccdk',
    'kdccccccccdk',
    'kdcckcckccdk',
    '.kcckcckcck.',
    '..kckkkkck..',
    '..kck..kck..',
    '.kddk..kddk.',
    'kkkk....kkkk',
];

// ── 적 1: 굴러가는 광석 "롤스톤" (12×12) ──────────────────────
// 벽에서 방향 전환. 밟으면 껍질(셸) 상태가 된다.
const ROLLSTONE = [
    '...rrrrrr...',
    '..rRrrrrRr..',
    '.rrrkrrkrrr.',
    'rrrkkrrkkrrr',
    'rRrrrrrrrrRr',
    'rrrrwwwwrrrr',
    'rrrrwwwwrrrr',
    'rRrrrrrrrrRr',
    'rrrRrrrrRrrr',
    '.rrrRRRRrrr.',
    '..rRRrrRRr..',
    '...RRRRRR...',
];

// 롤스톤 셸 — 밟히면 납작한 원반. 차면 굴러간다.
const ROLLSTONE_SHELL = [
    '............',
    '............',
    '............',
    '............',
    '..RRRRRRRR..',
    '.RrrrrrrrrR.',
    'RrrwwwwwwrrR',
    'RrrwwwwwwrrR',
    '.RrrrrrrrrR.',
    '..RRRRRRRR..',
    '............',
    '............',
];

// ── 적 2: 절벽에서 안 떨어지는 기계 보행체 "코그워커" (12×12) ─
const COGWALKER = [
    '..nnnnnnnn..',
    '.nNnnnnnnNn.',
    'nnnkknnkknnn',
    'nnkwwnnwwknn',
    'nnnkknnkknnn',
    'nNnnnnnnnnNn',
    'nnnnnnnnnnnn',
    '.nnNNNNNNnn.',
    '.nnnnnnnnnn.',
    '..nknnnnkn..',
    '..knn..nnk..',
    '.kkn....nkk.',
];

// ── 적 3: 파이프에서 솟는 결정체 "스파이크샤드" (12×12) ───────
const SPIKESHARD = [
    '.....vv.....',
    '....vVVv....',
    '....vVVv....',
    '...vVvvVv...',
    '...vVvvVv...',
    '..vVvwwvVv..',
    '..vVvwwvVv..',
    '.vVvvvvvvVv.',
    '.vVvvvvvvVv.',
    'vVVvvvvvvVVv',
    'vVvvvvvvvvVv',
    'VVVVVVVVVVVV',
];

// ── 적 4: 공중 비행체 "글라이드핀" (12×12) ─────────────────────
const GLIDEFIN = [
    '............',
    'i..........i',
    'iI........Ii',
    '.iIvvvvvvIi.',
    '..ivVVVVvi..',
    '.vvVwwwwVvv.',
    'vVVVwwwwVVVv',
    '.vvVVVVVVvv.',
    '..vvVVVVvv..',
    '...vvvvvv...',
    '....v..v....',
    '............',
];

// ── 지형 타일 (12×12 도트) ─────────────────────────────────────
// 2026-07-31 Phase 2-1: TILE 32→24. 정수배 확대만 선명하므로 16 도트 × 1.5 가 아니라
// **12 도트 × scale 2** 로 다시 그렸다 (근거: pixel-art.mjs 상단 주석).
//
// 흙 — 상단 밝은 띠 + 아래로 어두워지는 결
const T_GROUND = [
    'ssssssssssss',
    'gsggsgggsggs',
    'gggggggggggg',
    'ggGgggggGggg',
    'gggggggggggg',
    'gGggggGggggg',
    'ggggggggGggg',
    'GggggGgggggG',
    'gggGgggggGgg',
    'ggggggGggggg',
    'GGgGGgGGgGGg',
    'GGGGGGGGGGGG',
];

// 벽돌 — 강화 상태에서만 파괴 가능
const T_BRICK = [
    'BBBBBBBBBBBB',
    'BbbbbBbbbbbB',
    'BbbbbBbbbbbB',
    'BBBBBBBBBBBB',
    'BbbBbbbbBbbB',
    'BbbBbbbbBbbB',
    'BBBBBBBBBBBB',
    'BbbbbbBbbbbB',
    'BbbbbbBbbbbB',
    'BBBBBBBBBBBB',
    'BbbBbbbbBbbB',
    'BBBBBBBBBBBB',
];

// 석재 — 절대 파괴 불가
const T_STONE = [
    'MMMMMMMMMMMM',
    'MmmmmmmmmmmM',
    'MmMMMMMMMMmM',
    'MmMmmmmmmMmM',
    'MmMmMMMMmMmM',
    'MmMmMmmMmMmM',
    'MmMmMmmMmMmM',
    'MmMmMMMMmMmM',
    'MmMmmmmmmMmM',
    'MmMMMMMMMMmM',
    'MmmmmmmmmmmM',
    'MMMMMMMMMMMM',
];

// 보상 블록 — 물음표 대신 **다이아 각인** (원작과 다른 표식)
const T_REWARD = [
    'YYYYYYYYYYYY',
    'YyyyyyyyyyyY',
    'YyyyywyyyyyY',
    'YyyywwwyyyyY',
    'YyywwYwwyyyY',
    'YyywwYwwyyyY',
    'YyyywwwyyyyY',
    'YyyyywyyyyyY',
    'YyyyyyyyyyyY',
    'YyYyyyyyyYyY',
    'YyyyyyyyyyyY',
    'YYYYYYYYYYYY',
];

// 사용 완료 블록 — 텅 빈 석재
const T_USED = [
    'MMMMMMMMMMMM',
    'MNNNNNNNNNNM',
    'MNnnnnnnnnNM',
    'MNnnnnnnnnNM',
    'MNnnnnnnnnNM',
    'MNnnnnnnnnNM',
    'MNnnnnnnnnNM',
    'MNnnnnnnnnNM',
    'MNnnnnnnnnNM',
    'MNnnnnnnnnNM',
    'MNNNNNNNNNNM',
    'MMMMMMMMMMMM',
];

// 파이프 — 상단 입구 / 몸통
const T_PIPE_TOP = [
    'EEEEEEEEEEEE',
    'EeeeeeeeeeeE',
    'EeEEEEEEEEeE',
    'EeEeeeeeeEeE',
    'EeEeeeeeeEeE',
    'EeEEEEEEEEeE',
    'EEEEEEEEEEEE',
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
];

const T_PIPE_BODY = [
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
    '.EeEeeeeEeE.',
];

// 지하 벽 타일
const T_CAVE = [
    'NNNNNNNNNNNN',
    'NnnnnnnnnnnN',
    'NnNnnnNnnnnN',
    'NnnnnnnnnNnN',
    'NnnNnnnnnnnN',
    'NnnnnnnNnnnN',
    'NnNnnnnnnnnN',
    'NnnnnNnnnnnN',
    'NnnnnnnnnNnN',
    'NnnNnnnnnnnN',
    'NnnnnnnnnnnN',
    'NNNNNNNNNNNN',
];

// ── 아이템 (12×12) ────────────────────────────────────────────
// 성장 결정 — 육각 결정체 (버섯 아님)
const I_GROW = [
    '....eeee....',
    '...eEEEEe...',
    '..eEwwwwEe..',
    '.eEwwEEwwEe.',
    'eEwwEeeEwwEe',
    'eEwEeeeeEwEe',
    'eEwEeeeeEwEe',
    'eEwwEeeEwwEe',
    '.eEwwEEwwEe.',
    '..eEwwwwEe..',
    '...eEEEEe...',
    '....eeee....',
];

// 원거리 결정 — 삼각 프리즘
const I_BEAM = [
    '.....oo.....',
    '....oOOo....',
    '....oOOo....',
    '...oOwwOo...',
    '...oOwwOo...',
    '..oOwoowOo..',
    '..oOwoowOo..',
    '.oOwoooowOo.',
    '.oOwoooowOo.',
    'oOOoooooooOO',
    'oooooooooooo',
    'OOOOOOOOOOOO',
];

// 무적 결정 — 팔각 별 결정
const I_STAR = [
    '.....ii.....',
    '....iIIi....',
    '..i.iIIi.i..',
    '.iIiIwwIiIi.',
    '..iIwwwwIi..',
    'iiIwwwwwwIii',
    'iiIwwwwwwIii',
    '..iIwwwwIi..',
    '.iIiIwwIiIi.',
    '..i.iIIi.i..',
    '....iIIi....',
    '.....ii.....',
];

// 여분 생명 — 하트 아닌 **코퍼 코어**
const I_LIFE = [
    '....tttt....',
    '..ttTTTTtt..',
    '.tTTwwwwTTt.',
    '.tTwwccwwTt.',
    'tTwwccccwwTt',
    'tTwccccccwTt',
    'tTwccccccwTt',
    'tTwwccccwwTt',
    '.tTwwccwwTt.',
    '.tTTwwwwTTt.',
    '..ttTTTTtt..',
    '....tttt....',
];

// 동전 — 육각 코인
const I_COIN = [
    '...yyyy...',
    '..yYYYYy..',
    '.yYwwwwYy.',
    'yYwwYYwwYy',
    'yYwYyyYwYy',
    'yYwYyyYwYy',
    'yYwwYYwwYy',
    '.yYwwwwYy.',
    '..yYYYYy..',
    '...yyyy...',
];

// 발사체 — 코퍼의 원거리 빔 탄
const I_SHOT = [
    '..oo..',
    '.oOOo.',
    'oOwwOo',
    'oOwwOo',
    '.oOOo.',
    '..oo..',
];

// 깃대 / 목표 — 결정 깃발
const G_FLAG = [
    '..k.........',
    '..kiiiii....',
    '..kiIIIii...',
    '..kiIwwIi...',
    '..kiIwwIi...',
    '..kiIIIii...',
    '..kiiiii....',
    '..k.........',
    '..k.........',
    '..k.........',
    '..k.........',
    '..k.........',
];

// ── export: 각 항목은 make-ent 가 바로 먹는 picture 객체 ────────
//
// **모든 scale 을 명시한다.** px() 기본값(3)에 의존하면 타일 스케일을 바꿀 때
// 캐릭터만 옛 크기로 남는다 — Phase 2-1(TILE 32→24)에서 실제로 걸린 지점이다.
// TILE=24 기준 액터는 scale 2: 주인공 12×16 도트 → 24×32px (히트박스 15×33 과 맞음).
// scale 3 이면 48px = 2 칸 높이가 되어 24px 격자에 안 맞는다.
const A = 2;   // 액터(캐릭터/적/아이템) 확대율 — 타일과 같은 정수배

export const SPRITES = {
    // 주인공
    hero_idle:    () => px(COPPER_IDLE,   P, { scale: A }),
    hero_walk:    () => px(COPPER_WALK_A, P, { scale: A }),
    hero_run:     () => px(COPPER_RUN,    P, { scale: A }),
    hero_jump:    () => px(COPPER_JUMP,   P, { scale: A }),
    hero_skid:    () => px(COPPER_SKID,   P, { scale: A }),
    hero_crouch:  () => px(COPPER_CROUCH, P, { scale: A }),
    hero_hurt:    () => px(COPPER_HURT,   P, { scale: A }),
    hero_power:   () => px(COPPER_POWER,  P, { scale: A }),
    // 좌향 (stamp 는 flipX 가 안 통하므로 별 모양으로 준비)
    hero_idle_l:   () => px(mirror(COPPER_IDLE),   P, { scale: A }),
    hero_walk_l:   () => px(mirror(COPPER_WALK_A), P, { scale: A }),
    hero_run_l:    () => px(mirror(COPPER_RUN),    P, { scale: A }),
    hero_jump_l:   () => px(mirror(COPPER_JUMP),   P, { scale: A }),
    hero_skid_l:   () => px(mirror(COPPER_SKID),   P, { scale: A }),
    hero_power_l:  () => px(mirror(COPPER_POWER),  P, { scale: A }),
    // 적
    rollstone:       () => px(ROLLSTONE,       P, { scale: A }),
    rollstone_shell: () => px(ROLLSTONE_SHELL, P, { scale: A }),
    cogwalker:       () => px(COGWALKER,       P, { scale: A }),
    spikeshard:      () => px(SPIKESHARD,      P, { scale: A }),
    glidefin:        () => px(GLIDEFIN,        P, { scale: A }),
    // 타일 — **scale 2 고정**. 타일은 12 도트이고 게임 격자는 TILE=24px 이므로
    // 12×2 = 24 로 격자와 정확히 일치해야 한다. 기본 scale 3(36px)으로 두면
    // 한 칸마다 12px 씩 넘쳐 이웃 칸을 덮어 지형이 뭉개진다.
    // (도트 수를 16 으로 두고 scale 1.5 로 맞추면 정수배가 아니라 도트가 흐려진다 —
    //  pixel-art.mjs 상단 주석. 그래서 아트 자체를 12 도트로 다시 그렸다.)
    t_ground:   () => px(T_GROUND,    P, { scale: 2 }),
    t_brick:    () => px(T_BRICK,     P, { scale: 2 }),
    t_stone:    () => px(T_STONE,     P, { scale: 2 }),
    t_reward:   () => px(T_REWARD,    P, { scale: 2 }),
    t_used:     () => px(T_USED,      P, { scale: 2 }),
    t_pipe_top: () => px(T_PIPE_TOP,  P, { scale: 2 }),
    t_pipe:     () => px(T_PIPE_BODY, P, { scale: 2 }),
    t_cave:     () => px(T_CAVE,      P, { scale: 2 }),
    // 아이템 (12 도트 → 24px = 한 칸)
    i_grow: () => px(I_GROW, P, { scale: A }),
    i_beam: () => px(I_BEAM, P, { scale: A }),
    i_star: () => px(I_STAR, P, { scale: A }),
    i_life: () => px(I_LIFE, P, { scale: A }),
    // 동전은 타일 격자에 stamp 되므로 타일과 같은 scale 2 (10 도트 → 20px, 한 칸 안).
    i_coin: () => px(I_COIN, P, { scale: A }),
    i_shot: () => px(I_SHOT, P, { scale: A }),
    // 목표 — 타일 격자에 stamp 되므로 타일과 같은 scale 2 (12 도트 → 24px = 한 칸 정확히).
    g_flag: () => px(G_FLAG, P, { scale: A }),
};

export { P as PALETTE };
