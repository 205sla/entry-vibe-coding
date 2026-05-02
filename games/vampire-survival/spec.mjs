// 뱀서라이크 MVP 3 분 슬림 — Vampire Survivors 류 탑다운 서바이벌.
//
// 게임 흐름:
//   menu 씬 → 무기 1 종 선택 (오라/지팡이) → play 씬 (3 분 생존) → result 씬
//   레벨업 시 게임 일시정지 + 카드 3 장 → 클릭으로 강화/패시브 적용
//
// 핵심 패턴:
//   - 적 클론 슬롯 (MAX=25): direction = slot id 1..25 (rotateMethod='none').
//     enemy_active / enemy_hp / enemy_x / enemy_y 4 리스트로 슬롯별 상태 관리.
//   - 거리² 충돌 (sqrt 회피): (dx² + dy²) < r².
//   - 일시정지: game_state 변수 (0=play, 1=paused, 2=lose, 3=win). 모든 루프 게이트.
//   - 무기:
//     · 오라 — aura_tick 매니저가 0.5 초마다 enemy_active 슬롯 순회, aura_radius² 안 적 데미지.
//     · 지팡이 — bullet 클론. 발사 시 (dir_x, dir_y) → 8 방향 turnAbs. 매 틱 enemy slot 순회해
//       BULLET_HIT_SQ 안 가장 가까운 slot 데미지 + 클론 삭제.
//   - 마지막 이동 방향 추적: dir_x/dir_y 매 프레임 키 입력으로 갱신, 둘 다 0 이면 유지.
//   - 경험치/레벨업: kill 마다 exp+1. exp >= next_exp 시 manager 가 game_state=1 + level_up 메시지.
//     카드 3 장 (textBox) 메시지 받고 종류 randomize + show. 클릭 → 강화 + cards_hide + game_state=0.
//
// 화면: 480x270 기준 ±220 × ±130 플레이 영역.
//
// 도구: spec-dsl + sprite-gen (단순 도형 + 색 구분).

import {
    when, repeat, if_, cmp, calc, getVar, setVar, changeVar, wait,
    locateXY, move, moveX, moveY, coord, turnAbs, flipX,
    setSize, setEffect,
    show, hide, changeShape,
    createClone, deleteClone, removeAllClones,
    valueAt, setListAt,
    sendMessage, startScene, stopRepeat,
    askWait, getInput, lengthOfList, insertAt,
    writeText, combine,
    scene as makeScene,
    rand, mod,
    timer,
    startDraw, stopDraw, eraseAll, setColor, setThickness,
    isPressed,
    or_, and_,
    obj,
    pictureFromGen,
    fn, call,
} from '../../tools/lib/spec-dsl.mjs';
import { circle, star, ring, rect } from '../../tools/lib/sprite-gen.mjs';

// ── 사운드 helper (DSL 미지원, raw block) ──────────────────────────
// Entry 내장 사운드 사용 — 오프라인 편집기에서 재생 안 될 수 있고, 온라인 (playentry.org)
// 업로드 시 정상 동작. fileurl 은 placeholder. 사용 시 사용자가 적절한 sound URL 로 swap.
const playSound = (id) => ({ type: 'sound_something_with_block', params: [id, null] });

// ── 변수/리스트 visibility helper (DSL 미지원, raw block) ──────────
const showVariable = (id) => ({ type: 'show_variable', params: [id, null] });
const hideVariable = (id) => ({ type: 'hide_variable', params: [id, null] });
const showList     = (id) => ({ type: 'show_list',     params: [id, null] });
const hideList     = (id) => ({ type: 'hide_list',     params: [id, null] });

// ── 게임 상수 ──────────────────────────────────────────────────────
const MAX_ENEMIES   = 25;
const PLAY_TIME     = 180;       // 3 분
const PLAY_AREA_X   = 220;
const PLAY_AREA_Y   = 130;

const PLAYER_SPEED  = 2.5;
const PLAYER_R      = 10;
const PLAYER_HP_MAX = 100;
const IFRAME_TICKS  = 25;        // ~0.4 초

const ENEMY_R       = 8;
const ENEMY_HP      = 18;     // 좀비 기본 HP (호환)
const ENEMY_DMG     = 8;
const HIT_R_SQ      = 324;       // (10+8)² 플레이어+적 충돌
const ENEMY_SP1     = 0.7;
const ENEMY_SP2     = 0.85;
const ENEMY_SP3     = 1.0;

// 적 타입별 stat (인덱스 1=좀비, 2=박쥐, 3=골렘)
// picture 자연 크기로 시각 차별 (좀비 r=8, 박쥐 r=7, 골렘 r=13). setSize 안 씀.
const ENEMY_HP_T    = ['18', '10', '60'];
const ENEMY_SPEED_T = ['1.0', '1.5', '0.45'];   // cur_enemy_sp 에 곱하는 배수
const TYPE_BAT_FROM = 60;
const TYPE_GOLEM_FROM = 120;

const BULLET_R      = 4;
const BULLET_SPEED  = 4;
const BULLET_HIT_SQ = 144;       // (12)²
const BULLET_LIFE   = 80;        // 프레임 (~1.3 초)

const GEM_R         = 5;
const PICKUP_R_SQ   = 144;       // (12)²
const MAGNET_R_SQ   = 2500;      // (50)²
const GEM_GLIDE     = 3.5;

// 무기 stat — 인덱스 1..5 = Lv1..Lv5
const AURA_DMG_T    = ['5', '7', '9', '12', '16'];
const AURA_RSQ_T    = ['1225', '1600', '2025', '2500', '3025'];  // 35² ~ 55²
const AURA_SIZE_T   = ['70', '80', '90', '100', '110'];          // setSize 픽셀 (지름)
const WAND_DMG_T    = ['10', '13', '16', '20', '25'];
const WAND_CD_T     = ['1.4', '1.2', '1.0', '0.8', '0.6'];

// 채찍 — 좌우 번갈아 근접 가로 공격 (단일 매니저 thread)
const WHIP_DMG_T    = ['8', '11', '14', '18', '22'];
const WHIP_CD_T     = ['1.6', '1.4', '1.2', '1.0', '0.8'];
const WHIP_W        = 40;        // 가로
const WHIP_H        = 10;        // 세로
const WHIP_OFFSET   = 30;        // 플레이어 중심에서 좌/우 offset
const WHIP_HALF_W   = 25;        // 충돌 box (offset ± half_w)
const WHIP_HALF_H   = 12;        // 충돌 box (cy ± half_h)
const WHIP_VISIBLE  = 0.15;      // 보이는 시간 (초)

const MAX_WPN_LVL   = 5;

const SPAWN_INT_1   = 1.4;       // 0..60s
const SPAWN_INT_2   = 1.0;       // 60..120s
const SPAWN_INT_3   = 0.65;      // 120..180s

// 보스
const BOSS_SPAWN_TIME = 120;     // 120s 시점 등장
const BOSS_R          = 30;
const BOSS_HP         = 500;
const BOSS_SPEED      = 0.4;
const BOSS_ATK_TICKS  = 180;     // 3 초마다 공격 (60 fps)
const BOSS_HIT_R_SQ   = 1600;    // (10+30)² 플레이어 vs 보스 충돌
const BOSS_DMG        = 12;      // 보스 직접 접촉 데미지

// 보스 bullet
const MAX_BB          = 20;
const BB_SPEED        = 2;
const BB_LIFE         = 200;     // 프레임
const BB_HIT_R_SQ     = 256;     // (10+6)² 플레이어 vs bullet 충돌
const BB_DMG          = 5;
const BOSS_ANGLES_T   = ['0', '45', '90', '135', '180', '225', '270', '315'];

// 보물상자
const TREASURE_PICKS  = 5;

// ── 사용자 정의 함수 ───────────────────────────────────────────────
// findBulletHit (재귀) — 슬롯 idx..MAX 에서 (x,y) 와 BULLET_HIT_SQ 안인 첫 번째 적을 찾음.
// 못 찾으면 0 반환. 재귀로 하나의 동기 호출 안에 처리되어 다중 bullet 클론 race 회피.
//   call('fbh', x, y, 1) → slot id (1..25) or 0
const fnFindBulletHit = fn.value('fbh', ['x', 'y', 'idx'],
    (x, y, idx) => [
        if_(cmp(idx, '>', MAX_ENEMIES), [
            setVar('fbh_ret', 0),
        ], [
            setVar('fbh_dx', calc(valueAt('enemy_x', idx), '-', x)),
            setVar('fbh_dy', calc(valueAt('enemy_y', idx), '-', y)),
            setVar('fbh_dsq', calc(
                calc(getVar('fbh_dx'), '*', getVar('fbh_dx')),
                '+',
                calc(getVar('fbh_dy'), '*', getVar('fbh_dy')),
            )),
            if_(and_(
                cmp(valueAt('enemy_active', idx), '==', 1),
                cmp(getVar('fbh_dsq'), '<', BULLET_HIT_SQ),
            ), [
                setVar('fbh_ret', idx),
            ], [
                setVar('fbh_ret', call('fbh', x, y, calc(idx, '+', 1))),
            ]),
        ]),
    ],
    () => getVar('fbh_ret'),
);

// fnHitsBoss — bullet 위치 (x, y) 가 보스 안인지 체크. 다중 bullet 클론 race 회피.
//   call('fhb', x, y) → 1 (hit) or 0
const fnHitsBoss = fn.value('fhb', ['x', 'y'],
    (x, y) => [
        if_(cmp(getVar('boss_active'), '==', 0), [
            setVar('fhb_ret', 0),
        ], [
            setVar('fhb_dx', calc(getVar('boss_x'), '-', x)),
            setVar('fhb_dy', calc(getVar('boss_y'), '-', y)),
            setVar('fhb_dsq', calc(
                calc(getVar('fhb_dx'), '*', getVar('fhb_dx')),
                '+',
                calc(getVar('fhb_dy'), '*', getVar('fhb_dy')),
            )),
            if_(cmp(getVar('fhb_dsq'), '<',
                // (BOSS_R + BULLET_R)² ≈ (30+4)² = 1156
                1156,
            ), [
                setVar('fhb_ret', 1),
            ], [
                setVar('fhb_ret', 0),
            ]),
        ]),
    ],
    () => getVar('fhb_ret'),
);

// fnHitsPlayer — boss bullet 위치 (x, y) 가 플레이어 안인지 체크. 다중 bb 클론 race 회피.
//   call('fhp', x, y) → 1 or 0
const fnHitsPlayer = fn.value('fhp', ['x', 'y'],
    (x, y) => [
        setVar('fhp_dx', calc(getVar('cx'), '-', x)),
        setVar('fhp_dy', calc(getVar('cy'), '-', y)),
        setVar('fhp_dsq', calc(
            calc(getVar('fhp_dx'), '*', getVar('fhp_dx')),
            '+',
            calc(getVar('fhp_dy'), '*', getVar('fhp_dy')),
        )),
        if_(cmp(getVar('fhp_dsq'), '<', BB_HIT_R_SQ), [
            setVar('fhp_ret', 1),
        ], [
            setVar('fhp_ret', 0),
        ]),
    ],
    () => getVar('fhp_ret'),
);

// ── Pictures ──────────────────────────────────────────────────────
const playerPic  = pictureFromGen(circle(PLAYER_R, '#2563eb'),       { id: 'pic_player' });
const zombiePic  = pictureFromGen(circle(ENEMY_R,  '#16a34a'),       { id: 'pic_zombie' });
const batPic     = pictureFromGen(circle(7,        '#7c3aed'),       { id: 'pic_bat' });
const golemPic   = pictureFromGen(circle(13,       '#6b7280'),       { id: 'pic_golem' });
const bulletPic  = pictureFromGen(circle(BULLET_R, '#a855f7'),       { id: 'pic_bullet' });
const gemPic     = pictureFromGen(star(GEM_R + 2, GEM_R - 2, 5, '#facc15'), { id: 'pic_gem' });
const auraPic    = pictureFromGen(circle(35, '#dc2626'),             { id: 'pic_aura' });
const particlePic = pictureFromGen(circle(2, '#fef3c7'),             { id: 'pic_particle' });
const whipPic    = pictureFromGen(rect(WHIP_W, WHIP_H, '#fbbf24', { rx: 3 }), { id: 'pic_whip' });
const bossPic    = pictureFromGen(circle(BOSS_R, '#ef4444'),         { id: 'pic_boss' });
const bbPic      = pictureFromGen(circle(6, '#f97316'),              { id: 'pic_bb' });
const chestPic   = pictureFromGen(star(15, 7, 6, '#fbbf24'),         { id: 'pic_chest' });

// 사망 파티클 — 클론마다 random angle (다중 enemy 동시 사망 race 회피)
const PARTICLE_LIFE     = 15;
const PARTICLE_SPEED    = 2.5;

// ──────────────────────────────────────────────────────────────────
// MENU 장면
// ──────────────────────────────────────────────────────────────────

const menuTitle = obj('menu_title', '제목', {
    scene: 'menu',
    objectType: 'textBox',
    text: '뱀서라이크 MVP',
    entity: {
        x: 0, y: 80, regX: 0, regY: 0,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: 320, height: 40,
        font: '26px NanumGothic',
        colour: '#1e3a8a', bgColor: '#dbeafe',
        lineBreak: false, textAlign: 1, visible: true,
    },
    script: [
        when.sceneStart(),
        hideList('score_display_t'),  // 메뉴에선 랭킹 숨김
        hideVariable('boss_hp'),       // 메뉴에선 보스 HP 숨김
    ],
});

const menuDesc = obj('menu_desc', '안내', {
    scene: 'menu',
    objectType: 'textBox',
    text: '방향키로 이동, 자동 공격.\n3 분 동안 살아남으세요.\n\n시작 무기를 선택하세요:',
    entity: {
        x: 0, y: 10, regX: 0, regY: 0,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: 360, height: 90,
        font: '14px NanumGothic',
        colour: '#1f2937', bgColor: '#f9fafb',
        lineBreak: true, textAlign: 1, visible: true,
    },
    script: [ when.sceneStart() ],
});

const menuAuraBtn = obj('menu_aura_btn', '오라 시작', {
    scene: 'menu',
    objectType: 'textBox',
    text: '오라\n(지속 광역)',
    entity: {
        x: -110, y: -80, regX: 0, regY: 0,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: 110, height: 50,
        font: '13px NanumGothic',
        colour: '#ffffff', bgColor: '#dc2626',
        lineBreak: true, textAlign: 1, visible: true,
    },
    threads: [
        [ when.sceneStart() ],
        [
            when.objectClick(),
            setVar('aura_lvl', 1),
            setVar('wand_lvl', 0),
            setVar('whip_lvl', 0),
            startScene('play'),
        ],
    ],
});

const menuWandBtn = obj('menu_wand_btn', '지팡이 시작', {
    scene: 'menu',
    objectType: 'textBox',
    text: '마법 지팡이\n(직선 발사)',
    entity: {
        x: 0, y: -80, regX: 0, regY: 0,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: 110, height: 50,
        font: '13px NanumGothic',
        colour: '#ffffff', bgColor: '#a855f7',
        lineBreak: true, textAlign: 1, visible: true,
    },
    threads: [
        [ when.sceneStart() ],
        [
            when.objectClick(),
            setVar('aura_lvl', 0),
            setVar('wand_lvl', 1),
            setVar('whip_lvl', 0),
            startScene('play'),
        ],
    ],
});

const menuWhipBtn = obj('menu_whip_btn', '채찍 시작', {
    scene: 'menu',
    objectType: 'textBox',
    text: '채찍\n(좌우 근접)',
    entity: {
        x: 110, y: -80, regX: 0, regY: 0,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: 110, height: 50,
        font: '13px NanumGothic',
        colour: '#1f2937', bgColor: '#fbbf24',
        lineBreak: true, textAlign: 1, visible: true,
    },
    threads: [
        [ when.sceneStart() ],
        [
            when.objectClick(),
            setVar('aura_lvl', 0),
            setVar('wand_lvl', 0),
            setVar('whip_lvl', 1),
            startScene('play'),
        ],
    ],
});

// ──────────────────────────────────────────────────────────────────
// PLAY 장면 — 플레이어
// ──────────────────────────────────────────────────────────────────

// 플레이어 — 위치(cx,cy), 키 입력, iframes, 적 충돌 판정.
const player = obj('player', '플레이어', {
    scene: 'play',
    picture: playerPic,
    entity: {
        x: 0, y: 0,
        regX: PLAYER_R + 2, regY: PLAYER_R + 2,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: (PLAYER_R + 2) * 2, height: (PLAYER_R + 2) * 2,
        visible: true,
        rotateMethod: 'none',
    },
    threads: [
        // ── 1) 시작 — 게임 변수 리셋 + 슬롯 리스트 reset ──
        [
            when.sceneStart(),
            removeAllClones(),
            setVar('init_done', 0),  // 초기화 시작 — 다른 루프 게이트 OFF
            hideVariable('boss_hp'),  // 보스 등장 전엔 HP UI 숨김
            hideList('score_display_t'),  // play 씬에선 랭킹 숨김
            setVar('cx', 0),
            setVar('cy', 0),
            setVar('dir_x', 1),
            setVar('dir_y', 0),
            setVar('hp', PLAYER_HP_MAX),
            setVar('max_hp', PLAYER_HP_MAX),
            setVar('iframes', 0),
            setVar('exp', 0),
            setVar('next_exp', 4),
            setVar('level', 1),
            setVar('survival_time', 0),
            setVar('time_left', PLAY_TIME),
            setVar('game_state', 0),
            setVar('player_speed', PLAYER_SPEED),
            setVar('next_id', 0),
            setVar('enemy_count', 0),
            setVar('kills', 0),
            setVar('final_score', 0),
            // 보스 / 보물상자 / boss bullet 초기화
            setVar('boss_active', 0),
            setVar('boss_killed', 0),
            setVar('boss_hp', 0),
            setVar('boss_max_hp', BOSS_HP),
            setVar('boss_atk_cd', 0),
            setVar('boss_x', -300),
            setVar('boss_y', -300),
            setVar('treasure_picks_left', 0),
            setVar('chest_active', 0),
            // bb slot reset
            setVar('init_bb', 0),
            repeat.basic(MAX_BB, [
                changeVar('init_bb', 1),
                setListAt('bb_active', getVar('init_bb'), 0),
                setListAt('bb_x',      getVar('init_bb'), 0),
                setListAt('bb_y',      getVar('init_bb'), 0),
            ]),
            // 슬롯 리스트 초기화 — init_i (이 스레드 전용)
            setVar('init_i', 0),
            repeat.basic(MAX_ENEMIES, [
                changeVar('init_i', 1),
                setListAt('enemy_active', getVar('init_i'), 0),
                setListAt('enemy_hp',     getVar('init_i'), 0),
                setListAt('enemy_x',      getVar('init_i'), 0),
                setListAt('enemy_y',      getVar('init_i'), 0),
                setListAt('enemy_type',   getVar('init_i'), 1),
                setListAt('enemy_last_hp', getVar('init_i'), 0),
            ]),
            setVar('init_done', 1),
            timer.reset(),
            timer.start(),
            locateXY(0, 0),
            setEffect('transparency', 0),
            show(),
        ],

        // ── 2) 메인 이동 + iframes 플리커 ──
        [
            when.sceneStart(),
            repeat.inf([
                if_(cmp(getVar('game_state'), '==', 0), [
                    // 키 → moved_x/moved_y 결정
                    setVar('moved_x', 0),
                    setVar('moved_y', 0),
                    if_(isPressed('39'), [ setVar('moved_x', 1) ]),
                    if_(isPressed('37'), [ setVar('moved_x', -1) ]),
                    if_(isPressed('38'), [ setVar('moved_y', 1) ]),
                    if_(isPressed('40'), [ setVar('moved_y', -1) ]),
                    // 적용 (경계 클램프) — speed_p 변수 사용
                    if_(cmp(getVar('moved_x'), '>', 0), [
                        if_(cmp(getVar('cx'), '<', PLAY_AREA_X), [
                            changeVar('cx', getVar('player_speed')),
                        ]),
                    ]),
                    if_(cmp(getVar('moved_x'), '<', 0), [
                        if_(cmp(getVar('cx'), '>', -PLAY_AREA_X), [
                            changeVar('cx', calc(0, '-', getVar('player_speed'))),
                        ]),
                    ]),
                    if_(cmp(getVar('moved_y'), '>', 0), [
                        if_(cmp(getVar('cy'), '<', PLAY_AREA_Y), [
                            changeVar('cy', getVar('player_speed')),
                        ]),
                    ]),
                    if_(cmp(getVar('moved_y'), '<', 0), [
                        if_(cmp(getVar('cy'), '>', -PLAY_AREA_Y), [
                            changeVar('cy', calc(0, '-', getVar('player_speed'))),
                        ]),
                    ]),
                    // dir 갱신 (둘 중 하나라도 nonzero 시)
                    if_(or_(
                        cmp(getVar('moved_x'), '!=', 0),
                        cmp(getVar('moved_y'), '!=', 0),
                    ), [
                        setVar('dir_x', getVar('moved_x')),
                        setVar('dir_y', getVar('moved_y')),
                    ]),
                    locateXY(getVar('cx'), getVar('cy')),
                    // iframes — 매 프레임 1 감소 + 짝/홀로 플리커
                    if_(cmp(getVar('iframes'), '>', 0), [
                        changeVar('iframes', -1),
                        if_(cmp(mod(getVar('iframes'), 4), '<', 2),
                            [ setEffect('transparency', 60) ],
                            [ setEffect('transparency', 0) ],
                        ),
                    ], [
                        setEffect('transparency', 0),
                    ]),
                ]),
            ]),
        ],

        // ── 3) 적/보스/bb 충돌 — 매 프레임 단일 thread 순회 ──
        // init_done 게이트로 슬롯 리스트 초기화 끝난 뒤 시작 (race 회피)
        [
            when.sceneStart(),
            repeat.inf([
                if_(and_(
                    cmp(getVar('game_state'), '==', 0),
                    cmp(getVar('init_done'), '==', 1),
                ), [
                    if_(cmp(getVar('iframes'), '<=', 0), [
                        setVar('col_hit', 0),
                        setVar('col_dmg', 0),
                        // (a) 적 슬롯 순회
                        setVar('col_i', 0),
                        repeat.basic(MAX_ENEMIES, [
                            changeVar('col_i', 1),
                            if_(cmp(getVar('col_hit'), '==', 0), [
                                if_(cmp(valueAt('enemy_active', getVar('col_i')), '==', 1), [
                                    setVar('col_dx', calc(valueAt('enemy_x', getVar('col_i')), '-', getVar('cx'))),
                                    setVar('col_dy', calc(valueAt('enemy_y', getVar('col_i')), '-', getVar('cy'))),
                                    setVar('col_dsq', calc(
                                        calc(getVar('col_dx'), '*', getVar('col_dx')),
                                        '+',
                                        calc(getVar('col_dy'), '*', getVar('col_dy')),
                                    )),
                                    if_(cmp(getVar('col_dsq'), '<', HIT_R_SQ), [
                                        setVar('col_hit', 1),
                                        setVar('col_dmg', ENEMY_DMG),
                                    ]),
                                ]),
                            ]),
                        ]),
                        // (b) 보스 직접 접촉
                        if_(and_(
                            cmp(getVar('col_hit'), '==', 0),
                            cmp(getVar('boss_active'), '==', 1),
                        ), [
                            setVar('col_dx', calc(getVar('boss_x'), '-', getVar('cx'))),
                            setVar('col_dy', calc(getVar('boss_y'), '-', getVar('cy'))),
                            setVar('col_dsq', calc(
                                calc(getVar('col_dx'), '*', getVar('col_dx')),
                                '+',
                                calc(getVar('col_dy'), '*', getVar('col_dy')),
                            )),
                            if_(cmp(getVar('col_dsq'), '<', BOSS_HIT_R_SQ), [
                                setVar('col_hit', 1),
                                setVar('col_dmg', BOSS_DMG),
                            ]),
                        ]),
                        // (c) boss bullet 슬롯 순회
                        setVar('col_i', 0),
                        repeat.basic(MAX_BB, [
                            changeVar('col_i', 1),
                            if_(cmp(getVar('col_hit'), '==', 0), [
                                if_(cmp(valueAt('bb_active', getVar('col_i')), '==', 1), [
                                    setVar('col_dx', calc(valueAt('bb_x', getVar('col_i')), '-', getVar('cx'))),
                                    setVar('col_dy', calc(valueAt('bb_y', getVar('col_i')), '-', getVar('cy'))),
                                    setVar('col_dsq', calc(
                                        calc(getVar('col_dx'), '*', getVar('col_dx')),
                                        '+',
                                        calc(getVar('col_dy'), '*', getVar('col_dy')),
                                    )),
                                    if_(cmp(getVar('col_dsq'), '<', BB_HIT_R_SQ), [
                                        setVar('col_hit', 1),
                                        setVar('col_dmg', BB_DMG),
                                    ]),
                                ]),
                            ]),
                        ]),
                        if_(cmp(getVar('col_hit'), '==', 1), [
                            changeVar('hp', calc(0, '-', getVar('col_dmg'))),
                            setVar('iframes', IFRAME_TICKS),
                        ]),
                    ]),
                ]),
            ]),
        ],
    ],
});

// ──────────────────────────────────────────────────────────────────
// 오라 visual — 플레이어를 따라가는 반투명 빨간 원
// ──────────────────────────────────────────────────────────────────
const auraVisual = obj('aura_visual', '오라', {
    scene: 'play',
    picture: auraPic,
    entity: {
        x: 0, y: 0,
        regX: 37, regY: 37,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: 74, height: 74,
        visible: false,
        rotateMethod: 'none',
    },
    threads: [
        [
            when.sceneStart(),
            // aura_lvl > 0 이면 visible. lvl 별 size 갱신.
            repeat.inf([
                if_(cmp(getVar('aura_lvl'), '>=', 1), [
                    show(),
                    setEffect('transparency', 65),
                    setSize(valueAt('aura_size_t', getVar('aura_lvl'))),
                    locateXY(getVar('cx'), getVar('cy')),
                ], [
                    hide(),
                ]),
            ]),
        ],
    ],
});

// ──────────────────────────────────────────────────────────────────
// 오라 데미지 매니저 — 0.5 초마다 슬롯 순회해 aura_radius² 안 적에게 데미지
// ──────────────────────────────────────────────────────────────────
const auraTick = obj('aura_tick', '오라매니저', {
    scene: 'play',
    picture: pictureFromGen(circle(2, '#ffffff'), { id: 'pic_aura_tick' }),
    entity: {
        x: -300, y: -300,
        regX: 4, regY: 4,
        scaleX: 0.01, scaleY: 0.01, rotation: 0, direction: 90,
        width: 8, height: 8,
        visible: false,
        rotateMethod: 'none',
    },
    threads: [
        [
            when.sceneStart(),
            hide(),
            repeat.inf([
                if_(and_(
                    cmp(getVar('game_state'), '==', 0),
                    and_(
                        cmp(getVar('aura_lvl'), '>=', 1),
                        cmp(getVar('init_done'), '==', 1),
                    ),
                ), [
                    setVar('aura_dmg_now', valueAt('aura_dmg_t', getVar('aura_lvl'))),
                    setVar('aura_rsq_now', valueAt('aura_rsq_t', getVar('aura_lvl'))),
                    setVar('aura_i', 0),
                    repeat.basic(MAX_ENEMIES, [
                        changeVar('aura_i', 1),
                        if_(cmp(valueAt('enemy_active', getVar('aura_i')), '==', 1), [
                            setVar('aura_dx', calc(valueAt('enemy_x', getVar('aura_i')), '-', getVar('cx'))),
                            setVar('aura_dy', calc(valueAt('enemy_y', getVar('aura_i')), '-', getVar('cy'))),
                            setVar('aura_dsq', calc(
                                calc(getVar('aura_dx'), '*', getVar('aura_dx')),
                                '+',
                                calc(getVar('aura_dy'), '*', getVar('aura_dy')),
                            )),
                            if_(cmp(getVar('aura_dsq'), '<', getVar('aura_rsq_now')), [
                                setListAt('enemy_hp', getVar('aura_i'),
                                    calc(valueAt('enemy_hp', getVar('aura_i')), '-', getVar('aura_dmg_now'))),
                            ]),
                        ]),
                    ]),
                    // 보스도 오라 안이면 데미지 (단일 thread, race 없음)
                    if_(cmp(getVar('boss_active'), '==', 1), [
                        setVar('aura_dx', calc(getVar('boss_x'), '-', getVar('cx'))),
                        setVar('aura_dy', calc(getVar('boss_y'), '-', getVar('cy'))),
                        setVar('aura_dsq', calc(
                            calc(getVar('aura_dx'), '*', getVar('aura_dx')),
                            '+',
                            calc(getVar('aura_dy'), '*', getVar('aura_dy')),
                        )),
                        if_(cmp(getVar('aura_dsq'), '<', getVar('aura_rsq_now')), [
                            changeVar('boss_hp', calc(0, '-', getVar('aura_dmg_now'))),
                        ]),
                    ]),
                ]),
                wait(0.5),
            ]),
        ],
    ],
});

// ──────────────────────────────────────────────────────────────────
// 마법 지팡이 — 발사 타이머 + bullet 클론 발사
// ──────────────────────────────────────────────────────────────────
const wandTemplate = obj('wand_template', '지팡이불릿', {
    scene: 'play',
    picture: bulletPic,
    entity: {
        x: -300, y: -300,
        regX: BULLET_R + 2, regY: BULLET_R + 2,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: (BULLET_R + 2) * 2, height: (BULLET_R + 2) * 2,
        visible: false,
        rotateMethod: 'free',  // 발사 각도 시각 회전 OK
    },
    threads: [
        // ── 1) 발사 타이머 (템플릿 자신이 처리) ──
        [
            when.sceneStart(),
            hide(),
            wait(0.5),  // 시작 후 짧은 유예
            repeat.inf([
                if_(and_(
                    cmp(getVar('game_state'), '==', 0),
                    and_(
                        cmp(getVar('wand_lvl'), '>=', 1),
                        cmp(getVar('init_done'), '==', 1),
                    ),
                ), [
                    createClone('self'),
                    wait(valueAt('wand_cd_t', getVar('wand_lvl'))),
                ], [
                    wait(0.2),
                ]),
            ]),
        ],

        // ── 2) 클론 — 발사 + 매 틱 enemy slot 검사 ──
        [
            when.cloneStart(),
            // 발사 시점의 dir_x, dir_y → 8 방향 angle
            // Entry direction: 0=상, 90=우, 180=하, 270=좌
            // (dx,dy)→angle: (0,1)=0, (1,1)=45, (1,0)=90, (1,-1)=135,
            //               (0,-1)=180, (-1,-1)=225, (-1,0)=270, (-1,1)=315
            setVar('tmp_angle', 90),  // default 우
            if_(and_(cmp(getVar('dir_x'), '==', 0), cmp(getVar('dir_y'), '==', 1)), [
                setVar('tmp_angle', 0),
            ]),
            if_(and_(cmp(getVar('dir_x'), '==', 1), cmp(getVar('dir_y'), '==', 1)), [
                setVar('tmp_angle', 45),
            ]),
            if_(and_(cmp(getVar('dir_x'), '==', 1), cmp(getVar('dir_y'), '==', 0)), [
                setVar('tmp_angle', 90),
            ]),
            if_(and_(cmp(getVar('dir_x'), '==', 1), cmp(getVar('dir_y'), '==', -1)), [
                setVar('tmp_angle', 135),
            ]),
            if_(and_(cmp(getVar('dir_x'), '==', 0), cmp(getVar('dir_y'), '==', -1)), [
                setVar('tmp_angle', 180),
            ]),
            if_(and_(cmp(getVar('dir_x'), '==', -1), cmp(getVar('dir_y'), '==', -1)), [
                setVar('tmp_angle', 225),
            ]),
            if_(and_(cmp(getVar('dir_x'), '==', -1), cmp(getVar('dir_y'), '==', 0)), [
                setVar('tmp_angle', 270),
            ]),
            if_(and_(cmp(getVar('dir_x'), '==', -1), cmp(getVar('dir_y'), '==', 1)), [
                setVar('tmp_angle', 315),
            ]),
            locateXY(getVar('cx'), getVar('cy')),
            turnAbs(getVar('tmp_angle')),
            show(),
            setVar('bul_life', BULLET_LIFE),
            setVar('bul_dmg', valueAt('wand_dmg_t', getVar('wand_lvl'))),
            // 매 프레임 이동 + slot 검사
            repeat.inf([
                if_(cmp(getVar('game_state'), '==', 0), [
                    move(BULLET_SPEED),
                    changeVar('bul_life', -1),
                    // 화면 밖 / 수명 만료 → 삭제
                    if_(or_(
                        cmp(getVar('bul_life'), '<=', 0),
                        or_(
                            or_(
                                cmp(coord('self', 'x'), '<', -260),
                                cmp(coord('self', 'x'), '>',  260),
                            ),
                            or_(
                                cmp(coord('self', 'y'), '<', -160),
                                cmp(coord('self', 'y'), '>',  160),
                            ),
                        ),
                    ), [
                        deleteClone(),
                    ]),
                    // 명중 검사 — 재귀 함수 호출 (동기 실행, 다중 bullet 클론 race 회피)
                    setVar('bul_hit', call('fbh', coord('self', 'x'), coord('self', 'y'), 1)),
                    if_(cmp(getVar('bul_hit'), '>', 0), [
                        setListAt('enemy_hp', getVar('bul_hit'),
                            calc(valueAt('enemy_hp', getVar('bul_hit')), '-', getVar('bul_dmg'))),
                        deleteClone(),
                    ]),
                    // 보스 명중 — 별도 fn.value (race 회피)
                    if_(cmp(call('fhb', coord('self', 'x'), coord('self', 'y')), '==', 1), [
                        changeVar('boss_hp', calc(0, '-', getVar('bul_dmg'))),
                        deleteClone(),
                    ]),
                ]),
            ]),
        ],
    ],
});

// ──────────────────────────────────────────────────────────────────
// 채찍 — 좌우 번갈아 가로 공격. 단일 매니저 thread 라 race 없음.
// ──────────────────────────────────────────────────────────────────
const whipTemplate = obj('whip_template', '채찍', {
    scene: 'play',
    picture: whipPic,
    entity: {
        x: -300, y: -300,
        regX: WHIP_W / 2 + 2, regY: WHIP_H / 2 + 2,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: WHIP_W + 4, height: WHIP_H + 4,
        visible: false,
        rotateMethod: 'none',
    },
    threads: [
        [
            when.sceneStart(),
            hide(),
            wait(0.5),  // 시작 유예
            repeat.inf([
                if_(and_(
                    cmp(getVar('game_state'), '==', 0),
                    and_(
                        cmp(getVar('whip_lvl'), '>=', 1),
                        cmp(getVar('init_done'), '==', 1),
                    ),
                ), [
                    // ── 우측 공격 ──
                    setVar('whip_side', 1),  // 1 = 우, -1 = 좌
                    locateXY(calc(getVar('cx'), '+', WHIP_OFFSET), getVar('cy')),
                    show(),
                    // 우측 box 안 적 슬롯 데미지 (단일 thread → race 없음)
                    setVar('whip_dmg_now', valueAt('whip_dmg_t', getVar('whip_lvl'))),
                    setVar('whip_i', 0),
                    repeat.basic(MAX_ENEMIES, [
                        changeVar('whip_i', 1),
                        if_(cmp(valueAt('enemy_active', getVar('whip_i')), '==', 1), [
                            setVar('whip_dx', calc(
                                valueAt('enemy_x', getVar('whip_i')),
                                '-',
                                calc(getVar('cx'), '+', WHIP_OFFSET),
                            )),
                            setVar('whip_dy', calc(
                                valueAt('enemy_y', getVar('whip_i')),
                                '-',
                                getVar('cy'),
                            )),
                            // |dx| < HALF_W AND |dy| < HALF_H 박스 검사
                            if_(and_(
                                and_(
                                    cmp(getVar('whip_dx'), '<',  WHIP_HALF_W),
                                    cmp(getVar('whip_dx'), '>', -WHIP_HALF_W),
                                ),
                                and_(
                                    cmp(getVar('whip_dy'), '<',  WHIP_HALF_H),
                                    cmp(getVar('whip_dy'), '>', -WHIP_HALF_H),
                                ),
                            ), [
                                setListAt('enemy_hp', getVar('whip_i'),
                                    calc(valueAt('enemy_hp', getVar('whip_i')), '-', getVar('whip_dmg_now'))),
                            ]),
                        ]),
                    ]),
                    // 보스가 우측 box 안이면 데미지
                    if_(cmp(getVar('boss_active'), '==', 1), [
                        setVar('whip_dx', calc(getVar('boss_x'), '-', calc(getVar('cx'), '+', WHIP_OFFSET))),
                        setVar('whip_dy', calc(getVar('boss_y'), '-', getVar('cy'))),
                        if_(and_(
                            and_(
                                cmp(getVar('whip_dx'), '<',  WHIP_HALF_W + BOSS_R),
                                cmp(getVar('whip_dx'), '>', -(WHIP_HALF_W + BOSS_R)),
                            ),
                            and_(
                                cmp(getVar('whip_dy'), '<',  WHIP_HALF_H + BOSS_R),
                                cmp(getVar('whip_dy'), '>', -(WHIP_HALF_H + BOSS_R)),
                            ),
                        ), [
                            changeVar('boss_hp', calc(0, '-', getVar('whip_dmg_now'))),
                        ]),
                    ]),
                    wait(WHIP_VISIBLE),
                    hide(),
                    // 절반 cd 만큼 대기 (좌측 공격 사이 간격)
                    wait(calc(
                        calc(valueAt('whip_cd_t', getVar('whip_lvl')), '/', 2),
                        '-',
                        WHIP_VISIBLE,
                    )),
                    // ── 좌측 공격 ──
                    setVar('whip_side', -1),
                    locateXY(calc(getVar('cx'), '-', WHIP_OFFSET), getVar('cy')),
                    show(),
                    setVar('whip_i', 0),
                    repeat.basic(MAX_ENEMIES, [
                        changeVar('whip_i', 1),
                        if_(cmp(valueAt('enemy_active', getVar('whip_i')), '==', 1), [
                            setVar('whip_dx', calc(
                                valueAt('enemy_x', getVar('whip_i')),
                                '-',
                                calc(getVar('cx'), '-', WHIP_OFFSET),
                            )),
                            setVar('whip_dy', calc(
                                valueAt('enemy_y', getVar('whip_i')),
                                '-',
                                getVar('cy'),
                            )),
                            if_(and_(
                                and_(
                                    cmp(getVar('whip_dx'), '<',  WHIP_HALF_W),
                                    cmp(getVar('whip_dx'), '>', -WHIP_HALF_W),
                                ),
                                and_(
                                    cmp(getVar('whip_dy'), '<',  WHIP_HALF_H),
                                    cmp(getVar('whip_dy'), '>', -WHIP_HALF_H),
                                ),
                            ), [
                                setListAt('enemy_hp', getVar('whip_i'),
                                    calc(valueAt('enemy_hp', getVar('whip_i')), '-', getVar('whip_dmg_now'))),
                            ]),
                        ]),
                    ]),
                    // 보스가 좌측 box 안이면 데미지
                    if_(cmp(getVar('boss_active'), '==', 1), [
                        setVar('whip_dx', calc(getVar('boss_x'), '-', calc(getVar('cx'), '-', WHIP_OFFSET))),
                        setVar('whip_dy', calc(getVar('boss_y'), '-', getVar('cy'))),
                        if_(and_(
                            and_(
                                cmp(getVar('whip_dx'), '<',  WHIP_HALF_W + BOSS_R),
                                cmp(getVar('whip_dx'), '>', -(WHIP_HALF_W + BOSS_R)),
                            ),
                            and_(
                                cmp(getVar('whip_dy'), '<',  WHIP_HALF_H + BOSS_R),
                                cmp(getVar('whip_dy'), '>', -(WHIP_HALF_H + BOSS_R)),
                            ),
                        ), [
                            changeVar('boss_hp', calc(0, '-', getVar('whip_dmg_now'))),
                        ]),
                    ]),
                    wait(WHIP_VISIBLE),
                    hide(),
                    wait(calc(
                        calc(valueAt('whip_cd_t', getVar('whip_lvl')), '/', 2),
                        '-',
                        WHIP_VISIBLE,
                    )),
                ], [
                    wait(0.2),
                ]),
            ]),
        ],
    ],
});

// ──────────────────────────────────────────────────────────────────
// 적 (좀비/박쥐/골렘) — 클론 슬롯 시스템
// ──────────────────────────────────────────────────────────────────
const enemyTemplate = {
    id: 'enemy_template',
    name: '적',
    scene: 'play',
    objectType: 'sprite',
    pictures: [zombiePic, batPic, golemPic],
    selectedPictureId: 'pic_zombie',
    entity: {
        x: -300, y: -300,
        regX: ENEMY_R + 2, regY: ENEMY_R + 2,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: (ENEMY_R + 2) * 2, height: (ENEMY_R + 2) * 2,
        visible: false,
        rotateMethod: 'none',  // direction = slot id (1..MAX_ENEMIES)
    },
    script: [
        // ── 1) 시작 — 템플릿 hide ──
        [
            when.sceneStart(),
            hide(),
        ],

        // ── 2) 스폰 매니저 (템플릿 자신) — spawn_interval 마다 슬롯 찾고 spawn ──
        [
            when.sceneStart(),
            wait(1.0),  // 시작 유예
            repeat.inf([
                if_(and_(
                    cmp(getVar('game_state'), '==', 0),
                    cmp(getVar('init_done'), '==', 1),
                ), [
                    // 시간대별 스폰 간격 + 적 속도 결정
                    if_(cmp(getVar('survival_time'), '<', 60), [
                        setVar('cur_spawn_int', SPAWN_INT_1),
                        setVar('cur_enemy_sp', ENEMY_SP1),
                    ]),
                    if_(and_(
                        cmp(getVar('survival_time'), '>=', 60),
                        cmp(getVar('survival_time'), '<', 120),
                    ), [
                        setVar('cur_spawn_int', SPAWN_INT_2),
                        setVar('cur_enemy_sp', ENEMY_SP2),
                    ]),
                    if_(cmp(getVar('survival_time'), '>=', 120), [
                        setVar('cur_spawn_int', SPAWN_INT_3),
                        setVar('cur_enemy_sp', ENEMY_SP3),
                    ]),
                    // 빈 슬롯 찾기 — 스포너 전용 sp_i / sp_found
                    setVar('sp_i', 0),
                    setVar('sp_found', 0),
                    repeat.basic(MAX_ENEMIES, [
                        changeVar('sp_i', 1),
                        if_(cmp(getVar('sp_found'), '==', 0), [
                            if_(cmp(valueAt('enemy_active', getVar('sp_i')), '==', 0), [
                                setVar('sp_found', getVar('sp_i')),
                            ]),
                        ]),
                    ]),
                    if_(cmp(getVar('sp_found'), '>', 0), [
                        // 가장자리 4 곳 중 random
                        setVar('edge', rand(1, 4)),
                        setVar('spawn_x', 0),
                        setVar('spawn_y', 0),
                        if_(cmp(getVar('edge'), '==', 1), [
                            setVar('spawn_x', rand(-220, 220)),
                            setVar('spawn_y', 145),
                        ]),
                        if_(cmp(getVar('edge'), '==', 2), [
                            setVar('spawn_x', rand(-220, 220)),
                            setVar('spawn_y', -145),
                        ]),
                        if_(cmp(getVar('edge'), '==', 3), [
                            setVar('spawn_x', -250),
                            setVar('spawn_y', rand(-130, 130)),
                        ]),
                        if_(cmp(getVar('edge'), '==', 4), [
                            setVar('spawn_x', 250),
                            setVar('spawn_y', rand(-130, 130)),
                        ]),
                        // 적 타입 결정 — 시간대별 풀에서 random
                        // <60: 좀비만(1), 60..120: 좀비/박쥐(1,2), 120+: 좀비/박쥐/골렘(1,2,3)
                        setVar('next_type', 1),
                        if_(cmp(getVar('survival_time'), '>=', TYPE_BAT_FROM), [
                            setVar('next_type', rand(1, 2)),
                        ]),
                        if_(cmp(getVar('survival_time'), '>=', TYPE_GOLEM_FROM), [
                            setVar('next_type', rand(1, 3)),
                        ]),
                        // 슬롯 점유 + 데이터 기록 (HP 는 타입별 lookup)
                        setListAt('enemy_active', getVar('sp_found'), 1),
                        setListAt('enemy_type',   getVar('sp_found'), getVar('next_type')),
                        setListAt('enemy_hp',     getVar('sp_found'),
                            valueAt('enemy_hp_t', getVar('next_type'))),
                        setListAt('enemy_x',      getVar('sp_found'), getVar('spawn_x')),
                        setListAt('enemy_y',      getVar('sp_found'), getVar('spawn_y')),
                        setVar('next_id', getVar('sp_found')),
                        createClone('self'),
                        wait(0.05),  // 클론이 next_id 캡처할 시간
                    ]),
                    wait(getVar('cur_spawn_int')),
                ], [
                    wait(0.2),
                ]),
            ]),
        ],

        // ── 3) 클론 — 적 행동 (타입별 picture/속도, 8 방향 추격, hp 모니터) ──
        // 글로벌 race 회피로 me/mx_sign/my_sign/move_factor 모두 inline.
        [
            when.cloneStart(),
            turnAbs(getVar('next_id')),  // direction = my slot id
            // 타입별 picture (1=좀비, 2=박쥐, 3=골렘)
            changeShape(valueAt('enemy_type', getVar('next_id'))),
            // 데미지 플래시용 last_hp 초기화
            setListAt('enemy_last_hp', getVar('next_id'),
                valueAt('enemy_hp', getVar('next_id'))),
            locateXY(valueAt('enemy_x', getVar('next_id')), valueAt('enemy_y', getVar('next_id'))),
            show(),
            repeat.inf([
                if_(cmp(getVar('game_state'), '==', 0), [
                    // 데미지 플래시 — hp < last_hp 면 brightness 펄스
                    if_(cmp(
                        valueAt('enemy_hp', coord('self', 'direction')),
                        '<',
                        valueAt('enemy_last_hp', coord('self', 'direction')),
                    ), [
                        setEffect('brightness', 60),
                        wait(0.05),
                        setEffect('brightness', 0),
                    ]),
                    setListAt('enemy_last_hp', coord('self', 'direction'),
                        valueAt('enemy_hp', coord('self', 'direction'))),
                    // hp 0 이하 — 죽음 + 보석 + 파티클 spawn + 점수 카운트
                    if_(cmp(valueAt('enemy_hp', coord('self', 'direction')), '<=', 0), [
                        setListAt('enemy_active', coord('self', 'direction'), 0),
                        changeVar('kills', 1),
                        setVar('gem_spawn_x', coord('self', 'x')),
                        setVar('gem_spawn_y', coord('self', 'y')),
                        createClone('gem_template'),
                        // 사망 파티클 — 6 클론, 각자 random angle (다중 enemy 동시 사망 race 회피)
                        setVar('particle_x', coord('self', 'x')),
                        setVar('particle_y', coord('self', 'y')),
                        repeat.basic(6, [
                            createClone('particle_template'),
                        ]),
                        deleteClone(),
                    ]),
                    // 8 방향 추격 — 타입별 속도 배수 inline 적용 (eff_sp = cur_enemy_sp * type_speed)
                    // 자식 표현으로 inline (글로벌 race 회피)
                    //   eff_sp = cur_enemy_sp * enemy_speed_t[type]
                    //   diag = eff_sp * 0.7
                    if_(cmp(coord('self', 'x'), '<', getVar('cx')), [
                        if_(cmp(coord('self', 'y'), '<', getVar('cy')), [
                            // ↗
                            moveX(calc(calc(getVar('cur_enemy_sp'), '*',
                                valueAt('enemy_speed_t', valueAt('enemy_type', coord('self','direction')))), '*', 0.7)),
                            moveY(calc(calc(getVar('cur_enemy_sp'), '*',
                                valueAt('enemy_speed_t', valueAt('enemy_type', coord('self','direction')))), '*', 0.7)),
                        ], [
                            if_(cmp(coord('self', 'y'), '>', getVar('cy')), [
                                // ↘
                                moveX(calc(calc(getVar('cur_enemy_sp'), '*',
                                    valueAt('enemy_speed_t', valueAt('enemy_type', coord('self','direction')))), '*', 0.7)),
                                moveY(calc(0, '-', calc(calc(getVar('cur_enemy_sp'), '*',
                                    valueAt('enemy_speed_t', valueAt('enemy_type', coord('self','direction')))), '*', 0.7))),
                            ], [
                                // →
                                moveX(calc(getVar('cur_enemy_sp'), '*',
                                    valueAt('enemy_speed_t', valueAt('enemy_type', coord('self','direction'))))),
                            ]),
                        ]),
                    ], [
                        if_(cmp(coord('self', 'x'), '>', getVar('cx')), [
                            if_(cmp(coord('self', 'y'), '<', getVar('cy')), [
                                // ↖
                                moveX(calc(0, '-', calc(calc(getVar('cur_enemy_sp'), '*',
                                    valueAt('enemy_speed_t', valueAt('enemy_type', coord('self','direction')))), '*', 0.7))),
                                moveY(calc(calc(getVar('cur_enemy_sp'), '*',
                                    valueAt('enemy_speed_t', valueAt('enemy_type', coord('self','direction')))), '*', 0.7)),
                            ], [
                                if_(cmp(coord('self', 'y'), '>', getVar('cy')), [
                                    // ↙
                                    moveX(calc(0, '-', calc(calc(getVar('cur_enemy_sp'), '*',
                                        valueAt('enemy_speed_t', valueAt('enemy_type', coord('self','direction')))), '*', 0.7))),
                                    moveY(calc(0, '-', calc(calc(getVar('cur_enemy_sp'), '*',
                                        valueAt('enemy_speed_t', valueAt('enemy_type', coord('self','direction')))), '*', 0.7))),
                                ], [
                                    // ←
                                    moveX(calc(0, '-', calc(getVar('cur_enemy_sp'), '*',
                                        valueAt('enemy_speed_t', valueAt('enemy_type', coord('self','direction')))))),
                                ]),
                            ]),
                        ], [
                            // x 같음 — 수직만
                            if_(cmp(coord('self', 'y'), '<', getVar('cy')), [
                                moveY(calc(getVar('cur_enemy_sp'), '*',
                                    valueAt('enemy_speed_t', valueAt('enemy_type', coord('self','direction'))))),
                            ]),
                            if_(cmp(coord('self', 'y'), '>', getVar('cy')), [
                                moveY(calc(0, '-', calc(getVar('cur_enemy_sp'), '*',
                                    valueAt('enemy_speed_t', valueAt('enemy_type', coord('self','direction')))))),
                            ]),
                        ]),
                    ]),
                    // 슬롯 좌표 갱신
                    setListAt('enemy_x', coord('self', 'direction'), coord('self', 'x')),
                    setListAt('enemy_y', coord('self', 'direction'), coord('self', 'y')),
                ]),
            ]),
        ],
    ],
};

// ──────────────────────────────────────────────────────────────────
// 보스 — 단일 인스턴스, 4 스레드 (spawn / movement / attack / death)
// ──────────────────────────────────────────────────────────────────
const boss = obj('boss', '보스', {
    scene: 'play',
    picture: bossPic,
    entity: {
        x: -300, y: -300,
        regX: BOSS_R + 2, regY: BOSS_R + 2,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: (BOSS_R + 2) * 2, height: (BOSS_R + 2) * 2,
        visible: false,
        rotateMethod: 'none',
    },
    threads: [
        // ── 1) Spawn watcher — 120s 시점 active 전환 ──
        [
            when.sceneStart(),
            hide(),
            repeat.inf([
                if_(and_(
                    cmp(getVar('game_state'), '==', 0),
                    and_(
                        cmp(getVar('boss_active'), '==', 0),
                        and_(
                            cmp(getVar('boss_killed'), '==', 0),
                            cmp(getVar('survival_time'), '>=', BOSS_SPAWN_TIME),
                        ),
                    ),
                ), [
                    setVar('boss_active', 1),
                    setVar('boss_hp', BOSS_HP),
                    setVar('boss_atk_cd', 0),
                    setVar('boss_x', 0),
                    setVar('boss_y', 80),
                    locateXY(0, 80),
                    show(),
                    showVariable('boss_hp'),  // 보스 HP UI 표시
                ]),
                wait(0.3),
            ]),
        ],

        // ── 2) Movement — 플레이어 향해 천천히 이동 (8 방향 sign) ──
        [
            when.sceneStart(),
            repeat.inf([
                if_(and_(
                    cmp(getVar('boss_active'), '==', 1),
                    cmp(getVar('game_state'), '==', 0),
                ), [
                    if_(cmp(coord('self', 'x'), '<', getVar('cx')), [
                        moveX(BOSS_SPEED),
                    ]),
                    if_(cmp(coord('self', 'x'), '>', getVar('cx')), [
                        moveX(calc(0, '-', BOSS_SPEED)),
                    ]),
                    if_(cmp(coord('self', 'y'), '<', getVar('cy')), [
                        moveY(BOSS_SPEED),
                    ]),
                    if_(cmp(coord('self', 'y'), '>', getVar('cy')), [
                        moveY(calc(0, '-', BOSS_SPEED)),
                    ]),
                    setVar('boss_x', coord('self', 'x')),
                    setVar('boss_y', coord('self', 'y')),
                ]),
            ]),
        ],

        // ── 3) Attack — BOSS_ATK_TICKS 마다 8 발 라디얼 발사 ──
        [
            when.sceneStart(),
            repeat.inf([
                if_(and_(
                    cmp(getVar('boss_active'), '==', 1),
                    cmp(getVar('game_state'), '==', 0),
                ), [
                    changeVar('boss_atk_cd', 1),
                    if_(cmp(getVar('boss_atk_cd'), '>=', BOSS_ATK_TICKS), [
                        setVar('boss_atk_cd', 0),
                        // 8 발 spawn — 단일 thread, race 없음
                        setVar('boss_fire_idx', 0),
                        repeat.basic(8, [
                            changeVar('boss_fire_idx', 1),
                            setVar('bb_spawn_angle', valueAt('boss_angles_t', getVar('boss_fire_idx'))),
                            // 빈 bb 슬롯 찾기
                            setVar('bb_sp_i', 0),
                            setVar('bb_sp_found', 0),
                            repeat.basic(MAX_BB, [
                                changeVar('bb_sp_i', 1),
                                if_(cmp(getVar('bb_sp_found'), '==', 0), [
                                    if_(cmp(valueAt('bb_active', getVar('bb_sp_i')), '==', 0), [
                                        setVar('bb_sp_found', getVar('bb_sp_i')),
                                    ]),
                                ]),
                            ]),
                            if_(cmp(getVar('bb_sp_found'), '>', 0), [
                                setListAt('bb_active', getVar('bb_sp_found'), 1),
                                setListAt('bb_x',      getVar('bb_sp_found'), getVar('boss_x')),
                                setListAt('bb_y',      getVar('bb_sp_found'), getVar('boss_y')),
                                setVar('next_bb_id', getVar('bb_sp_found')),
                                createClone('boss_bullet_template'),
                                wait(0.02),  // 클론 next_bb_id 캡처 시간
                            ]),
                        ]),
                    ]),
                ]),
            ]),
        ],

        // ── 4) Death detection — boss_hp <= 0 ──
        [
            when.sceneStart(),
            repeat.inf([
                if_(and_(
                    cmp(getVar('boss_active'), '==', 1),
                    cmp(getVar('boss_hp'), '<=', 0),
                ), [
                    setVar('boss_active', 0),
                    setVar('boss_killed', 1),
                    hide(),
                    hideVariable('boss_hp'),  // 보스 HP UI 숨김
                    setVar('chest_spawn_x', getVar('boss_x')),
                    setVar('chest_spawn_y', getVar('boss_y')),
                    sendMessage('chest_appear'),
                ]),
                wait(0.1),
            ]),
        ],
    ],
});

// ──────────────────────────────────────────────────────────────────
// 보스 bullet — 라디얼 발사 클론, MAX_BB 슬롯 시스템
// ──────────────────────────────────────────────────────────────────
const bossBulletTemplate = obj('boss_bullet_template', '보스불릿', {
    scene: 'play',
    picture: bbPic,
    entity: {
        x: -300, y: -300,
        regX: 8, regY: 8,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: 16, height: 16,
        visible: false,
        rotateMethod: 'none',  // direction = bb slot id
    },
    threads: [
        [ when.sceneStart(), hide() ],
        [
            when.cloneStart(),
            turnAbs(getVar('next_bb_id')),  // direction = my bb slot id
            locateXY(valueAt('bb_x', getVar('next_bb_id')), valueAt('bb_y', getVar('next_bb_id'))),
            show(),
            // 발사 angle 적용 — turnAbs 으로 direction 덮어쓰면 slot id 잃음
            // 해법: direction 은 slot id 유지, 이동은 angle 기반 수동 계산.
            // 8 방향 (0,45,...,315) 별 dx/dy lookup
            setVar('bb_my_angle', valueAt('boss_angles_t', getVar('next_bb_id'))),
            // 위 미스. boss_angles_t 의 인덱스는 1..8 인데 next_bb_id 는 1..MAX_BB(20).
            // 따라서 bb_spawn_angle (전역) 을 cloneStart 에서 캡처 — 다중 동시 spawn 시 race 가능.
            // 보스 attack thread 는 8 발 사이에 wait(0.02) 두니 race 거의 안 일어남.
            setVar('bb_my_angle', getVar('bb_spawn_angle')),
            setVar('bb_life', BB_LIFE),
            repeat.inf([
                if_(cmp(getVar('game_state'), '==', 0), [
                    // 8 방향 angle → moveX/moveY (sin/cos 없이 lookup)
                    // 0=상(0,+), 45=우상(+,+), 90=우(+,0), 135=우하(+,-), 180=하(0,-), 225=좌하(-,-), 270=좌(-,0), 315=좌상(-,+)
                    if_(cmp(getVar('bb_my_angle'), '==', 0), [
                        moveY(BB_SPEED),
                    ]),
                    if_(cmp(getVar('bb_my_angle'), '==', 45), [
                        moveX(calc(BB_SPEED, '*', 0.7)),
                        moveY(calc(BB_SPEED, '*', 0.7)),
                    ]),
                    if_(cmp(getVar('bb_my_angle'), '==', 90), [
                        moveX(BB_SPEED),
                    ]),
                    if_(cmp(getVar('bb_my_angle'), '==', 135), [
                        moveX(calc(BB_SPEED, '*', 0.7)),
                        moveY(calc(0, '-', calc(BB_SPEED, '*', 0.7))),
                    ]),
                    if_(cmp(getVar('bb_my_angle'), '==', 180), [
                        moveY(calc(0, '-', BB_SPEED)),
                    ]),
                    if_(cmp(getVar('bb_my_angle'), '==', 225), [
                        moveX(calc(0, '-', calc(BB_SPEED, '*', 0.7))),
                        moveY(calc(0, '-', calc(BB_SPEED, '*', 0.7))),
                    ]),
                    if_(cmp(getVar('bb_my_angle'), '==', 270), [
                        moveX(calc(0, '-', BB_SPEED)),
                    ]),
                    if_(cmp(getVar('bb_my_angle'), '==', 315), [
                        moveX(calc(0, '-', calc(BB_SPEED, '*', 0.7))),
                        moveY(calc(BB_SPEED, '*', 0.7)),
                    ]),
                    // 슬롯 좌표 갱신
                    setListAt('bb_x', coord('self', 'direction'), coord('self', 'x')),
                    setListAt('bb_y', coord('self', 'direction'), coord('self', 'y')),
                    changeVar('bb_life', -1),
                    // 화면 밖 / 수명 만료 → 슬롯 비우고 삭제
                    if_(or_(
                        cmp(getVar('bb_life'), '<=', 0),
                        or_(
                            or_(
                                cmp(coord('self', 'x'), '<', -260),
                                cmp(coord('self', 'x'), '>',  260),
                            ),
                            or_(
                                cmp(coord('self', 'y'), '<', -160),
                                cmp(coord('self', 'y'), '>',  160),
                            ),
                        ),
                    ), [
                        setListAt('bb_active', coord('self', 'direction'), 0),
                        deleteClone(),
                    ]),
                    // 플레이어 명중 — fn.value 로 race-free
                    if_(cmp(call('fhp', coord('self', 'x'), coord('self', 'y')), '==', 1), [
                        setListAt('bb_active', coord('self', 'direction'), 0),
                        deleteClone(),
                    ]),
                ]),
            ]),
        ],
    ],
});

// ──────────────────────────────────────────────────────────────────
// 보물상자 — 보스 처치 시 등장, 클릭 시 카드 5 회 연속
// ──────────────────────────────────────────────────────────────────
const treasureChest = obj('treasure_chest', '보물상자', {
    scene: 'play',
    picture: chestPic,
    entity: {
        x: -300, y: -300,
        regX: 17, regY: 17,
        scaleX: 1.5, scaleY: 1.5, rotation: 0, direction: 90,
        width: 34, height: 34,
        visible: false,  // chest_appear 시 show
        rotateMethod: 'none',
    },
    threads: [
        [ when.sceneStart(), hide() ],
        [
            when.message('chest_appear'),
            locateXY(getVar('chest_spawn_x'), getVar('chest_spawn_y')),
            setVar('chest_active', 1),
            show(),
        ],
        [
            when.objectClick(),
            if_(and_(
                cmp(getVar('chest_active'), '==', 1),
                cmp(getVar('game_state'), '==', 0),
            ), [
                setVar('chest_active', 0),
                hide(),
                setVar('treasure_picks_left', TREASURE_PICKS),
                setVar('game_state', 1),
                sendMessage('level_up'),  // 첫 카드 표시
            ]),
        ],
    ],
});

// ──────────────────────────────────────────────────────────────────
// 보석 — 적 사망 시 spawn, 자석 / 픽업
// ──────────────────────────────────────────────────────────────────
const gemTemplate = obj('gem_template', '보석', {
    scene: 'play',
    picture: gemPic,
    entity: {
        x: -300, y: -300,
        regX: GEM_R + 2, regY: GEM_R + 2,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: (GEM_R + 2) * 2, height: (GEM_R + 2) * 2,
        visible: false,
        rotateMethod: 'none',
    },
    threads: [
        [ when.sceneStart(), hide() ],
        [
            when.cloneStart(),
            locateXY(getVar('gem_spawn_x'), getVar('gem_spawn_y')),
            show(),
            // gem 전용 scratch — 다중 gem 클론 race 허용 (MVP 수준 jank)
            repeat.inf([
                if_(cmp(getVar('game_state'), '==', 0), [
                    setVar('gem_dx', calc(getVar('cx'), '-', coord('self', 'x'))),
                    setVar('gem_dy', calc(getVar('cy'), '-', coord('self', 'y'))),
                    setVar('gem_dsq', calc(
                        calc(getVar('gem_dx'), '*', getVar('gem_dx')),
                        '+',
                        calc(getVar('gem_dy'), '*', getVar('gem_dy')),
                    )),
                    // 픽업 반경 — exp + 삭제
                    if_(cmp(getVar('gem_dsq'), '<', PICKUP_R_SQ), [
                        changeVar('exp', 1),
                        deleteClone(),
                    ]),
                    // 자석 반경 — 플레이어 방향으로 glide
                    if_(cmp(getVar('gem_dsq'), '<', MAGNET_R_SQ), [
                        // 8 방향 sign 으로 이동
                        if_(cmp(coord('self', 'x'), '<', getVar('cx')), [
                            moveX(GEM_GLIDE),
                        ]),
                        if_(cmp(coord('self', 'x'), '>', getVar('cx')), [
                            moveX(calc(0, '-', GEM_GLIDE)),
                        ]),
                        if_(cmp(coord('self', 'y'), '<', getVar('cy')), [
                            moveY(GEM_GLIDE),
                        ]),
                        if_(cmp(coord('self', 'y'), '>', getVar('cy')), [
                            moveY(calc(0, '-', GEM_GLIDE)),
                        ]),
                    ]),
                ]),
            ]),
        ],
    ],
});

// ──────────────────────────────────────────────────────────────────
// 사망 파티클 — 적 사망 시 6 방향 spawn, 짧은 수명
// ──────────────────────────────────────────────────────────────────
const particleTemplate = obj('particle_template', '파티클', {
    scene: 'play',
    picture: particlePic,
    entity: {
        x: -300, y: -300,
        regX: 4, regY: 4,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: 8, height: 8,
        visible: false,
        rotateMethod: 'none',  // direction = 발사 angle
    },
    threads: [
        [ when.sceneStart(), hide() ],
        [
            when.cloneStart(),
            // 클론마다 자체 random angle — 글로벌 race 없음
            turnAbs(rand(0, 359)),
            locateXY(getVar('particle_x'), getVar('particle_y')),
            show(),
            setVar('p_life', PARTICLE_LIFE),
            // life 카운트다운 + 직선 이동. list 접근 없음, race 무관.
            repeat.inf([
                move(PARTICLE_SPEED),
                changeVar('p_life', -1),
                if_(cmp(getVar('p_life'), '<=', 0), [
                    deleteClone(),
                ]),
            ]),
        ],
    ],
});

// ──────────────────────────────────────────────────────────────────
// HUD — HP 바 + EXP 바 (브러시), 변수 디스플레이는 visible:true 로 자동 표시
// ──────────────────────────────────────────────────────────────────
const hpBar = obj('hp_bar', '체력바', {
    scene: 'play',
    picture: pictureFromGen(circle(2, '#ffffff'), { id: 'pic_hpbar' }),
    entity: {
        x: 0, y: 0,
        regX: 4, regY: 4,
        scaleX: 0.01, scaleY: 0.01, rotation: 0, direction: 90,
        width: 8, height: 8,
        visible: false,
        rotateMethod: 'none',
    },
    threads: [
        [
            when.sceneStart(),
            hide(),
            setThickness(8),
            repeat.inf([
                eraseAll(),
                // 배경 막대 (회색)
                setColor('#9ca3af'),
                locateXY(-100, -120),
                startDraw(),
                locateXY(100, -120),
                stopDraw(),
                // HP 막대 (빨강) — width = hp/max_hp * 200
                if_(cmp(getVar('hp'), '>', 0), [
                    setColor('#dc2626'),
                    locateXY(-100, -120),
                    startDraw(),
                    locateXY(
                        calc(-100, '+', calc(
                            calc(getVar('hp'), '/', getVar('max_hp')),
                            '*', 200,
                        )),
                        -120,
                    ),
                    stopDraw(),
                ]),
                wait(0.1),
            ]),
        ],
    ],
});

const expBar = obj('exp_bar', '경험치바', {
    scene: 'play',
    picture: pictureFromGen(circle(2, '#ffffff'), { id: 'pic_expbar' }),
    entity: {
        x: 0, y: 0,
        regX: 4, regY: 4,
        scaleX: 0.01, scaleY: 0.01, rotation: 0, direction: 90,
        width: 8, height: 8,
        visible: false,
        rotateMethod: 'none',
    },
    threads: [
        [
            when.sceneStart(),
            hide(),
            setThickness(5),
            repeat.inf([
                eraseAll(),
                setColor('#3b82f6'),
                locateXY(-220, 130),
                startDraw(),
                if_(cmp(getVar('next_exp'), '>', 0), [
                    locateXY(
                        calc(-220, '+', calc(
                            calc(getVar('exp'), '/', getVar('next_exp')),
                            '*', 440,
                        )),
                        130,
                    ),
                ]),
                stopDraw(),
                wait(0.1),
            ]),
        ],
    ],
});

// ──────────────────────────────────────────────────────────────────
// 매니저 — 시간/HP 모니터, 레벨업 트리거, 결과 씬 전환
// ──────────────────────────────────────────────────────────────────
const manager = obj('manager', '매니저', {
    scene: 'play',
    picture: pictureFromGen(circle(2, '#ffffff'), { id: 'pic_mgr' }),
    entity: {
        x: -300, y: -300,
        regX: 4, regY: 4,
        scaleX: 0.01, scaleY: 0.01, rotation: 0, direction: 90,
        width: 8, height: 8,
        visible: false,
        rotateMethod: 'none',
    },
    threads: [
        // ── 1) 시간 + 상태 모니터 ──
        [
            when.sceneStart(),
            hide(),
            repeat.inf([
                if_(cmp(getVar('game_state'), '==', 0), [
                    setVar('survival_time', timer.value()),
                    setVar('time_left', calc(PLAY_TIME, '-', getVar('survival_time'))),
                    // 패배 — HP 0 이하
                    if_(cmp(getVar('hp'), '<=', 0), [
                        setVar('game_state', 2),
                        // 점수 계산 — kills*10 + level*50 + survival_time + (boss_killed ? 500 : 0)
                        setVar('final_score', calc(
                            calc(
                                calc(calc(getVar('kills'), '*', 10), '+', calc(getVar('level'), '*', 50)),
                                '+', getVar('survival_time'),
                            ),
                            '+', calc(getVar('boss_killed'), '*', 500),
                        )),
                        wait(0.8),
                        startScene('result'),
                    ]),
                    // 승리 — 시간 종료
                    if_(cmp(getVar('survival_time'), '>=', PLAY_TIME), [
                        setVar('game_state', 3),
                        setVar('final_score', calc(
                            calc(
                                calc(calc(getVar('kills'), '*', 10), '+', calc(getVar('level'), '*', 50)),
                                '+', getVar('survival_time'),
                            ),
                            '+', calc(getVar('boss_killed'), '*', 500),
                        )),
                        wait(0.8),
                        startScene('result'),
                    ]),
                ]),
                wait(0.1),
            ]),
        ],
        // ── 2) 레벨업 모니터 ──
        [
            when.sceneStart(),
            repeat.inf([
                if_(cmp(getVar('game_state'), '==', 0), [
                    if_(cmp(getVar('exp'), '>=', getVar('next_exp')), [
                        setVar('game_state', 1),
                        changeVar('level', 1),
                        setVar('exp', calc(getVar('exp'), '-', getVar('next_exp'))),
                        changeVar('next_exp', 3),
                        sendMessage('level_up'),
                    ]),
                ]),
                wait(0.1),
            ]),
        ],
    ],
});

// ──────────────────────────────────────────────────────────────────
// 카드 (3 장) — 레벨업 시 등장. 1=오라+, 2=지팡이+, 3=최대HP+, 4=이속+
// ──────────────────────────────────────────────────────────────────
function makeCard(id, name, varName, x) {
    return obj(id, name, {
        scene: 'play',
        objectType: 'textBox',
        text: '카드',
        entity: {
            x, y: 0, regX: 0, regY: 0,
            scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
            width: 130, height: 80,
            font: '14px NanumGothic',
            colour: '#1f2937', bgColor: '#fde68a',
            lineBreak: true, textAlign: 1, visible: true,
        },
        threads: [
            [ when.sceneStart(), hide() ],
            [
                when.message('level_up'),
                setVar(varName, rand(1, 5)),
                if_(cmp(getVar(varName), '==', 1), [ writeText('🌀\n오라 강화\n(데미지+범위)') ]),
                if_(cmp(getVar(varName), '==', 2), [ writeText('✨\n지팡이 강화\n(데미지+쿨)') ]),
                if_(cmp(getVar(varName), '==', 3), [ writeText('🪢\n채찍 강화\n(데미지+쿨)') ]),
                if_(cmp(getVar(varName), '==', 4), [ writeText('❤\n최대 HP +20') ]),
                if_(cmp(getVar(varName), '==', 5), [ writeText('👟\n이동 속도 +0.4') ]),
                show(),
            ],
            [ when.message('cards_hide'), hide() ],
            [
                when.objectClick(),
                if_(cmp(getVar('game_state'), '==', 1), [
                    // 카드 종류별 적용
                    if_(cmp(getVar(varName), '==', 1), [
                        if_(cmp(getVar('aura_lvl'), '<', MAX_WPN_LVL), [
                            changeVar('aura_lvl', 1),
                        ]),
                    ]),
                    if_(cmp(getVar(varName), '==', 2), [
                        if_(cmp(getVar('wand_lvl'), '<', MAX_WPN_LVL), [
                            changeVar('wand_lvl', 1),
                        ]),
                    ]),
                    if_(cmp(getVar(varName), '==', 3), [
                        if_(cmp(getVar('whip_lvl'), '<', MAX_WPN_LVL), [
                            changeVar('whip_lvl', 1),
                        ]),
                    ]),
                    if_(cmp(getVar(varName), '==', 4), [
                        changeVar('max_hp', 20),
                        changeVar('hp', 20),
                    ]),
                    if_(cmp(getVar(varName), '==', 5), [
                        changeVar('player_speed', 0.4),
                    ]),
                    // 보물상자 5 회 연속 분기
                    if_(cmp(getVar('treasure_picks_left'), '>', 0), [
                        changeVar('treasure_picks_left', -1),
                        if_(cmp(getVar('treasure_picks_left'), '>', 0), [
                            // 다음 카드 — 잠시 hide 후 재표시
                            sendMessage('cards_hide'),
                            wait(0.3),
                            sendMessage('level_up'),
                        ], [
                            // 마지막 카드 처리 끝 — 정상 재개
                            setVar('game_state', 0),
                            sendMessage('cards_hide'),
                        ]),
                    ], [
                        setVar('game_state', 0),
                        sendMessage('cards_hide'),
                    ]),
                ]),
            ],
        ],
    });
}

const card1 = makeCard('card_1', '카드1', 'card1_kind', -150);
const card2 = makeCard('card_2', '카드2', 'card2_kind', 0);
const card3 = makeCard('card_3', '카드3', 'card3_kind', 150);

// ──────────────────────────────────────────────────────────────────
// RESULT 장면
// ──────────────────────────────────────────────────────────────────

const resultText = obj('result_text', '결과', {
    scene: 'result',
    objectType: 'textBox',
    text: '결과',
    entity: {
        x: 0, y: 90, regX: 0, regY: 0,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: 380, height: 36,
        font: '20px NanumGothic',
        colour: '#1f2937', bgColor: '#f9fafb',
        lineBreak: false, textAlign: 1, visible: true,
    },
    threads: [
        [
            when.sceneStart(),
            showList('score_display_t'),  // 결과 씬 진입 시 랭킹 표시
            if_(cmp(getVar('game_state'), '==', 3), [
                writeText('🎉 승리!'),
            ], [
                writeText('💀 패배'),
            ]),
        ],
    ],
});

const resultStats = obj('result_stats', '결과스탯', {
    scene: 'result',
    objectType: 'textBox',
    text: '...',
    entity: {
        x: 0, y: 40, regX: 0, regY: 0,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: 360, height: 36,
        font: '14px NanumGothic',
        colour: '#1f2937', bgColor: '#fef3c7',
        lineBreak: false, textAlign: 1, visible: true,
    },
    threads: [
        [
            when.sceneStart(),
            writeText(combine(
                combine('점수 ', combine(getVar('final_score'), ' · ')),
                combine(
                    combine('Lv', combine(getVar('level'), ' · ')),
                    combine(
                        combine(getVar('kills'), '킬 · '),
                        combine(getVar('survival_time'), '초'),
                    ),
                ),
            )),
        ],
    ],
});

const saveBtn = obj('save_btn', '랭킹등록', {
    scene: 'result',
    objectType: 'textBox',
    text: '🏆 기록 등록',
    entity: {
        x: -80, y: -10, regX: 0, regY: 0,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: 130, height: 36,
        font: '14px NanumGothic',
        colour: '#ffffff', bgColor: '#2563eb',
        lineBreak: false, textAlign: 1, visible: true,
    },
    threads: [
        [ when.sceneStart() ],
        [
            when.objectClick(),
            askWait('이름을 입력하세요'),
            setVar('nickname', getInput()),
            // insertion sort — 점수 내림차순. final_score 가 들어갈 위치 찾기.
            setVar('sort_pos', 1),
            repeat.inf([
                if_(cmp(getVar('sort_pos'), '>', lengthOfList('score_t')), [
                    stopRepeat(),
                ]),
                if_(cmp(valueAt('score_t', getVar('sort_pos')), '<', getVar('final_score')), [
                    stopRepeat(),
                ]),
                changeVar('sort_pos', 1),
            ]),
            insertAt(getVar('final_score'), 'score_t', getVar('sort_pos')),
            insertAt(
                combine(
                    combine(getVar('final_score'), ' · '),
                    getVar('nickname'),
                ),
                'score_display_t',
                getVar('sort_pos'),
            ),
            writeText('✓ 등록 완료'),
        ],
    ],
});

const restartBtn = obj('restart_btn', '재시작', {
    scene: 'result',
    objectType: 'textBox',
    text: '↩ 메뉴로',
    entity: {
        x: 80, y: -10, regX: 0, regY: 0,
        scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
        width: 130, height: 36,
        font: '14px NanumGothic',
        colour: '#ffffff', bgColor: '#16a34a',
        lineBreak: false, textAlign: 1, visible: true,
    },
    threads: [
        [ when.sceneStart() ],
        [ when.objectClick(), startScene('menu') ],
    ],
});

// ──────────────────────────────────────────────────────────────────
// SPEC EXPORT
// ──────────────────────────────────────────────────────────────────
export default {
    name: '뱀서라이크 MVP',
    scenes: [
        makeScene('menu',   '시작 화면'),
        makeScene('play',   '게임 화면'),
        makeScene('result', '결과 화면'),
    ],
    messages: [
        { id: 'level_up',    name: '레벨업' },
        { id: 'cards_hide',  name: '카드숨김' },
        { id: 'chest_appear', name: '보물상자등장' },
    ],
    functions: [fnFindBulletHit, fnHitsBoss, fnHitsPlayer],
    variables: [
        // 플레이어 상태
        { id: 'cx',           name: 'cx',         value: '0',   visible: false },
        { id: 'cy',           name: 'cy',         value: '0',   visible: false },
        { id: 'dir_x',        name: 'dx',         value: '1',   visible: false },
        { id: 'dir_y',        name: 'dy',         value: '0',   visible: false },
        { id: 'hp',           name: 'hp',         value: '100', visible: false },
        { id: 'max_hp',       name: 'maxhp',      value: '100', visible: false },
        { id: 'iframes',      name: 'iframes',    value: '0',   visible: false },
        { id: 'player_speed', name: 'speed',      value: '2.5', visible: false },
        { id: 'moved_x',      name: 'mx',         value: '0',   visible: false },
        { id: 'moved_y',      name: 'my',         value: '0',   visible: false },

        // 진행
        { id: 'exp',           name: '경험치',     value: '0',  visible: false },
        { id: 'next_exp',      name: '다음경험치', value: '4',  visible: false },
        { id: 'level',         name: '레벨',       value: '1',  visible: true,  x: -220, y: 110 },
        { id: 'survival_time', name: '시간',       value: '0',  visible: false },
        { id: 'time_left',     name: '남은시간',   value: '180', visible: true,  x: -220, y: 80 },
        { id: 'game_state',    name: 'state',      value: '0',  visible: false },
        { id: 'init_done',     name: 'idn',        value: '0',  visible: false },

        // 무기
        { id: 'aura_lvl',     name: '오라Lv',     value: '0',  visible: true,  x: 110, y: 110 },
        { id: 'wand_lvl',     name: '지팡이Lv',   value: '0',  visible: true,  x: 110, y: 80 },
        { id: 'whip_lvl',     name: '채찍Lv',     value: '0',  visible: true,  x: 110, y: 50 },
        { id: 'aura_dmg_now', name: 'adn',        value: '0',  visible: false },
        { id: 'aura_rsq_now', name: 'arn',        value: '0',  visible: false },

        // 스폰 / 클론
        { id: 'next_id',      name: 'nid',        value: '0',  visible: false },
        { id: 'next_type',    name: 'ntype',      value: '1',  visible: false },
        { id: 'enemy_count',  name: 'ec',         value: '0',  visible: false },
        { id: 'edge',         name: 'edge',       value: '0',  visible: false },
        { id: 'spawn_x',      name: 'sx',         value: '0',  visible: false },
        { id: 'spawn_y',      name: 'sy',         value: '0',  visible: false },
        { id: 'cur_spawn_int', name: 'csi',       value: '1.4', visible: false },
        { id: 'cur_enemy_sp', name: 'ces',        value: '0.7', visible: false },

        // 보석 spawn 좌표
        { id: 'gem_spawn_x',  name: 'gsx',        value: '0',  visible: false },
        { id: 'gem_spawn_y',  name: 'gsy',        value: '0',  visible: false },

        // 파티클 spawn (적 사망 시 6 방향, 클론별 random angle)
        { id: 'particle_x',   name: 'px',         value: '0',  visible: false },
        { id: 'particle_y',   name: 'py',         value: '0',  visible: false },
        { id: 'p_life',       name: 'plife',      value: '0',  visible: false },

        // 채찍 매니저 scratch (단일 thread)
        { id: 'whip_side',    name: 'wsd',        value: '0',  visible: false },
        { id: 'whip_dmg_now', name: 'wdn',        value: '0',  visible: false },
        { id: 'whip_i',       name: 'wpi',        value: '0',  visible: false },
        { id: 'whip_dx',      name: 'wdx',        value: '0',  visible: false },
        { id: 'whip_dy',      name: 'wdy',        value: '0',  visible: false },

        // 보스 스테이트
        { id: 'boss_active',  name: 'bact',       value: '0',  visible: false },
        { id: 'boss_killed',  name: 'bk',         value: '0',  visible: false },
        { id: 'boss_hp',      name: '보스HP',     value: '0',  visible: false, x: -100, y: 130 },
        { id: 'boss_max_hp',  name: 'bmh',        value: '500', visible: false },
        { id: 'boss_atk_cd',  name: 'bcd',        value: '0',  visible: false },
        { id: 'boss_x',       name: 'bx',         value: '0',  visible: false },
        { id: 'boss_y',       name: 'by',         value: '0',  visible: false },
        { id: 'boss_fire_idx', name: 'bfi',       value: '0',  visible: false },
        // 보스 collision 검사 함수 ret
        { id: 'fhb_ret',      name: 'fhbR',       value: '0',  visible: false },
        { id: 'fhb_dx',       name: 'fhbdx',      value: '0',  visible: false },
        { id: 'fhb_dy',       name: 'fhbdy',      value: '0',  visible: false },
        { id: 'fhb_dsq',      name: 'fhbdq',      value: '0',  visible: false },
        // 플레이어 명중 (boss bullet 용)
        { id: 'fhp_ret',      name: 'fhpR',       value: '0',  visible: false },
        { id: 'fhp_dx',       name: 'fhpdx',      value: '0',  visible: false },
        { id: 'fhp_dy',       name: 'fhpdy',      value: '0',  visible: false },
        { id: 'fhp_dsq',      name: 'fhpdq',      value: '0',  visible: false },
        // boss bullet 클론
        { id: 'bb_spawn_angle', name: 'bba',      value: '0',  visible: false },
        { id: 'next_bb_id',   name: 'nbb',        value: '0',  visible: false },
        { id: 'bb_sp_i',      name: 'bbsi',       value: '0',  visible: false },
        { id: 'bb_sp_found',  name: 'bbsf',       value: '0',  visible: false },
        { id: 'bb_my_angle',  name: 'bbma',       value: '0',  visible: false },
        { id: 'bb_life',      name: 'bbl',        value: '0',  visible: false },
        { id: 'init_bb',      name: 'ibb',        value: '0',  visible: false },
        // 플레이어 collision 추가 dmg 변수
        { id: 'col_dmg',      name: 'cdm2',       value: '0',  visible: false },
        // 보물상자
        { id: 'chest_spawn_x', name: 'csx',       value: '0',  visible: false },
        { id: 'chest_spawn_y', name: 'csy',       value: '0',  visible: false },
        { id: 'chest_active', name: 'cact',       value: '0',  visible: false },
        { id: 'treasure_picks_left', name: 'tpl', value: '0',  visible: false },

        // 불릿 발사 시 angle 계산용 (single-cloneStart 로 race 적음)
        { id: 'tmp_angle',    name: 'tang',       value: '0',  visible: false },

        // 스레드별 unique scratch (race 회피)
        // - 플레이어 init: init_i
        { id: 'init_i',       name: 'iI',         value: '0',  visible: false },
        // - 플레이어 collision: col_*
        { id: 'col_i',        name: 'cI',         value: '0',  visible: false },
        { id: 'col_hit',      name: 'cH',         value: '0',  visible: false },
        { id: 'col_dx',       name: 'cdx',        value: '0',  visible: false },
        { id: 'col_dy',       name: 'cdy',        value: '0',  visible: false },
        { id: 'col_dsq',      name: 'cdq',        value: '0',  visible: false },
        // - 오라 tick: aura_*
        { id: 'aura_i',       name: 'aI',         value: '0',  visible: false },
        { id: 'aura_dx',      name: 'adx',        value: '0',  visible: false },
        { id: 'aura_dy',      name: 'ady',        value: '0',  visible: false },
        { id: 'aura_dsq',     name: 'adq',        value: '0',  visible: false },
        // - 스포너: sp_*
        { id: 'sp_i',         name: 'sI',         value: '0',  visible: false },
        { id: 'sp_found',     name: 'sF',         value: '0',  visible: false },
        // - 불릿 클론: bul_* (slot 순회는 fbh 재귀 함수에 위임 — bul_i/bul_dx/dy/dsq 불필요)
        { id: 'bul_hit',      name: 'bH',         value: '0',  visible: false },
        { id: 'bul_life',     name: 'blife',      value: '0',  visible: false },
        { id: 'bul_dmg',      name: 'bdmg',       value: '0',  visible: false },
        // - fbh 재귀 함수 내부 globals (동기 호출 → race 없음)
        { id: 'fbh_ret',      name: 'fR',         value: '0',  visible: false },
        { id: 'fbh_dx',       name: 'fdx',        value: '0',  visible: false },
        { id: 'fbh_dy',       name: 'fdy',        value: '0',  visible: false },
        { id: 'fbh_dsq',      name: 'fdq',        value: '0',  visible: false },
        // - 보석 클론: gem_* (다중 클론 race 허용)
        { id: 'gem_dx',       name: 'gdx',        value: '0',  visible: false },
        { id: 'gem_dy',       name: 'gdy',        value: '0',  visible: false },
        { id: 'gem_dsq',      name: 'gdq',        value: '0',  visible: false },

        // 카드
        { id: 'card1_kind',   name: 'c1k',        value: '1',  visible: false },
        { id: 'card2_kind',   name: 'c2k',        value: '1',  visible: false },
        { id: 'card3_kind',   name: 'c3k',        value: '1',  visible: false },

        // 점수 / 랭킹
        { id: 'kills',        name: '킬',         value: '0',  visible: false },
        { id: 'final_score',  name: '점수',       value: '0',  visible: false },
        { id: 'nickname',     name: 'nick',       value: '익명', visible: false },
        { id: 'sort_pos',     name: 'spos',       value: '1',  visible: false },
        // ask_and_wait 결과 변수 (Entry 표준 — '대답' 1 개)
        { id: '__answer__',   name: '대답',       value: '0',  visible: false,
          variableType: 'answer' },
    ],
    lists: [
        { id: 'enemy_active', name: 'ea', visible: false, array: Array(MAX_ENEMIES).fill('0') },
        { id: 'enemy_hp',     name: 'eh', visible: false, array: Array(MAX_ENEMIES).fill('0') },
        { id: 'enemy_x',      name: 'ex', visible: false, array: Array(MAX_ENEMIES).fill('0') },
        { id: 'enemy_y',      name: 'ey', visible: false, array: Array(MAX_ENEMIES).fill('0') },
        { id: 'enemy_type',   name: 'et', visible: false, array: Array(MAX_ENEMIES).fill('1') },
        { id: 'enemy_last_hp', name: 'elh', visible: false, array: Array(MAX_ENEMIES).fill('0') },
        { id: 'aura_dmg_t',   name: 'adt', visible: false, array: AURA_DMG_T },
        { id: 'aura_rsq_t',   name: 'art', visible: false, array: AURA_RSQ_T },
        { id: 'aura_size_t',  name: 'ast', visible: false, array: AURA_SIZE_T },
        { id: 'wand_dmg_t',   name: 'wdt', visible: false, array: WAND_DMG_T },
        { id: 'wand_cd_t',    name: 'wct', visible: false, array: WAND_CD_T },
        { id: 'whip_dmg_t',   name: 'wpdt', visible: false, array: WHIP_DMG_T },
        { id: 'whip_cd_t',    name: 'wpct', visible: false, array: WHIP_CD_T },
        { id: 'enemy_hp_t',   name: 'eht', visible: false, array: ENEMY_HP_T },
        { id: 'enemy_speed_t', name: 'est', visible: false, array: ENEMY_SPEED_T },
        // 보스 bullet 슬롯 시스템 (MAX_BB)
        { id: 'bb_active',    name: 'bba_l', visible: false, array: Array(MAX_BB).fill('0') },
        { id: 'bb_x',         name: 'bbx', visible: false, array: Array(MAX_BB).fill('0') },
        { id: 'bb_y',         name: 'bby', visible: false, array: Array(MAX_BB).fill('0') },
        { id: 'boss_angles_t', name: 'bat', visible: false, array: BOSS_ANGLES_T },
        // 랭킹 (세션 전용 — cloud 도 오프라인에선 영구 X). result 씬에서만 show_list.
        { id: 'score_t',      name: '점수기록', visible: false, array: [] },
        { id: 'score_display_t', name: '🏆 랭킹', visible: false,
          x: 90, y: 30, width: 140, height: 200, array: [] },
    ],
    objects: [
        // MENU — objects[0] 이 가장 앞 (entry 의 setChildIndex 역순회)
        // 클릭 가능한 버튼이 위로
        menuAuraBtn, menuWandBtn, menuWhipBtn,
        menuTitle, menuDesc,
        // PLAY — z-order: 위 = 앞 (클릭 우선순위, 시각 가림)
        // (1) 클릭 우선 — 카드, 보물상자
        card1, card2, card3,
        treasureChest,
        // (2) HUD — 게임 위에 항상 보이게
        hpBar, expBar,
        // (3) 액션 / invisible 매니저
        auraTick, manager,
        // (4) 플레이어 + 무기 (적보다 앞)
        player,
        whipTemplate, wandTemplate,
        // (5) 적 / 보스 / 탄
        bossBulletTemplate, boss,
        enemyTemplate,
        // (6) 효과 / 픽업 / 배경 비주얼
        particleTemplate,
        gemTemplate,
        auraVisual,
        // RESULT — 클릭 가능 버튼이 위로
        saveBtn, restartBtn,
        resultStats, resultText,
    ],
    interface: {
        canvasWidth: 480,
        menuWidth: 280,
        object: 'menu_aura_btn',
    },
};
