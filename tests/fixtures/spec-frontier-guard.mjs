// 프론티어 가드 Phase 3 — 풀 빌드 시스템 (슬롯 + 골드 + 업그레이드 + 준비 시간).
//
// Phase 1 (MVP) → Phase 2 (확장) → Phase 2.1 (intro + 데미지 플래시) → Phase 3 추가:
//   - **빌드 슬롯 4 개** — 클론 기반, 초기 비어있음. 클릭 시 빌드/업그레이드 메뉴.
//   - **빌드 메뉴** — 3 textBox 버튼, 슬롯 상태에 따라 동적 텍스트 (build / upgrade).
//   - **골드 시스템** — 적 처치 시 +N (스웜 10 / 탱크 30), 빌드/업그레이드에 -M.
//   - **준비 시간** — 게임 시작 후 첫 웨이브 전, 플레이어가 타워 배치 후 "준비 완료" 클릭.
//   - **Lv2 업그레이드** — Lv1 슬롯 클릭 → 업그레이드 (40G). dmg 1.5×, 시각적으로 brightness 30.
//
// 슬롯 시스템:
//   - 1 슬롯 템플릿 + 4 클론 (direction = slot id 1..4)
//   - 슬롯 상태는 글로벌 리스트:
//       slot_type[id]:  0=empty, 1=archer, 2=cannon
//       slot_level[id]: 0=empty, 1=Lv1, 2=Lv2
//   - rotateMethod: 'none' — direction 값으로 인한 시각 회전 회피
//   - 3 pictures: pic_empty (sprite-gen ring), pic_archer (tile-purple), pic_cannon (tile-cyan)
//
// 메뉴 UX:
//   - 슬롯 클릭 → 메뉴 visible, building_slot 변수에 클릭한 slot id 저장
//   - 빌드 메뉴 (slot_type=0): "궁수 50G", "대포 80G", "취소"
//   - 업그레이드 메뉴 (slot_level=1): "업그레이드 40G", (숨김), "취소"
//   - Lv2 슬롯은 클릭 무시
//   - 메뉴 버튼 클릭 → gold 체크 후 슬롯 상태 변경 + refresh 메시지
//
// 매니저 진행:
//   - sceneStart 시 init + 슬롯 4 spawn + 메뉴 hide
//   - 준비 단계: prep_done == 0 동안 spawn loop 대기 (`repeat.until` 패턴)
//   - "준비 완료" 클릭 → prep_done=1 → 웨이브 spawn 시작
//   - 타워 타겟팅: 매 cd 마다 슬롯 4 개 순회 — 비어있지 않으면 type 별 tick 호출

import {
    when, repeat, if_, cmp, calc, getVar, setVar, changeVar, wait,
    locateXY, moveX, coord, turnAbs, setSize, setEffect,
    createClone, deleteClone,
    valueAt, setListAt,
    show, hide, changeShape,
    sendMessage, startScene, stopRepeat,
    writeText, combine,
    scene as makeScene,
    pictureFromGen,
    startDraw, stopDraw, eraseAll, setColor, setThickness,
} from '../../tools/lib/spec-dsl.mjs';
import { assets } from '../../tools/lib/game-assets.mjs';
import { circle } from '../../tools/lib/sprite-gen.mjs';

// ── 게임 상수 ────────────────────────────────────────────────────
const MAX_ENEMIES   = 10;
const PATH_START_X  = -210;
const PATH_END_X    =  210;
const PATH_Y        = -50;
const SPEED_SWARM   = 1.5;
const SPEED_TANK    = 0.9;
const SPAWN_INTERVAL = 1.5;
const WAVE_BREAK    = 4;

// 웨이브 데이터 — 3 웨이브, 총 10 마리
const WAVE_COUNTS = [3, 3, 4];
const WAVE_TYPES = [
    1, 1, 1,
    1, 1, 2,
    1, 1, 1, 2,
];
const TOTAL_ENEMIES = WAVE_COUNTS.reduce((a, b) => a + b, 0);

// 적 타입별 stat (인덱스 1=swarm, 2=tank)
const TYPE_HP    = [25, 75];
const TYPE_SIZE  = [35, 55];

// 슬롯
const SLOT_COUNT = 4;
const SLOT_X = [-160, -55, 55, 160];
const SLOT_Y = 50;

// 타워 stat — 인덱스 1=Lv1, 2=Lv2 (Entry 1-base 리스트)
const ARCHER_DMG = [8, 12];
const CANNON_DMG = [4, 7];
const ARCHER_RANGE     = 130;
const ARCHER_RANGE_SQ  = ARCHER_RANGE * ARCHER_RANGE;
const CANNON_RANGE     = 150;
const CANNON_RANGE_SQ  = CANNON_RANGE * CANNON_RANGE;
const SPLASH_RADIUS    = 50;
const SPLASH_RADIUS_SQ = SPLASH_RADIUS * SPLASH_RADIUS;
const TOWER_COOLDOWN   = 0.5;

// 경제 상수
const INITIAL_GOLD       = 100;
const SWARM_KILL_REWARD  = 10;
const TANK_KILL_REWARD   = 30;
const ARCHER_BUILD_COST  = 50;
const CANNON_BUILD_COST  = 80;
const UPGRADE_COST       = 40;

// ── 타겟팅 헬퍼 ──────────────────────────────────────────────────

// 가장 가까운 활성 적 찾기. tx/ty 는 변수 (Block) 또는 리터럴 둘 다 가능.
const findNearestEnemy = (tx, ty, range_sq) => [
    setVar('target_id', 0),
    setVar('best_dist', range_sq),
    setVar('i', 0),
    repeat.basic(MAX_ENEMIES, [
        changeVar('i', 1),
        if_(cmp(valueAt('enemy_active', getVar('i')), '==', 1), [
            setVar('dx', calc(valueAt('enemy_x', getVar('i')), '-', tx)),
            setVar('dy', calc(valueAt('enemy_y', getVar('i')), '-', ty)),
            setVar('dist_sq', calc(
                calc(getVar('dx'), '*', getVar('dx')),
                '+',
                calc(getVar('dy'), '*', getVar('dy')),
            )),
            if_(cmp(getVar('dist_sq'), '<', getVar('best_dist')), [
                setVar('best_dist', getVar('dist_sq')),
                setVar('target_id', getVar('i')),
            ]),
        ]),
    ]),
];

// 공격 빔 그리기 — manager 의 sprite 가 brush 로 tower → target 라인 그림.
// 색상: archer 노란 (`#fbbf24`), cannon 주황 (`#f97316`). 굵기는 cannon 이 더 두꺼움.
// manager 의 visible:false 라도 brush 는 sprite 위치 추적해서 그림 (검증됨).
const drawBeam = (txExpr, tyExpr, color, thickness) => [
    setColor(color),
    setThickness(thickness),
    locateXY(txExpr, tyExpr),
    startDraw(),
    locateXY(getVar('target_x'), getVar('target_y')),
    stopDraw(),
];

// Archer 한 발 — dmg 는 변수 (Lv 따라 다름). 빔 시각화 포함.
const archerTick = (txExpr, tyExpr, dmgExpr) => [
    ...findNearestEnemy(txExpr, tyExpr, ARCHER_RANGE_SQ),
    if_(cmp(getVar('target_id'), '>', 0), [
        setVar('target_x', valueAt('enemy_x', getVar('target_id'))),
        setVar('target_y', valueAt('enemy_y', getVar('target_id'))),
        // 빔 (target 좌표 캡처 후 그리기 — damage 적용 전)
        ...drawBeam(txExpr, tyExpr, '#fbbf24', 2),
        // 데미지
        setListAt('enemy_hp', getVar('target_id'),
            calc(valueAt('enemy_hp', getVar('target_id')), '-', dmgExpr)),
    ]),
];

// Cannon — splash AOE + 빔 시각화.
const cannonTick = (txExpr, tyExpr, dmgExpr) => [
    ...findNearestEnemy(txExpr, tyExpr, CANNON_RANGE_SQ),
    if_(cmp(getVar('target_id'), '>', 0), [
        setVar('target_x', valueAt('enemy_x', getVar('target_id'))),
        setVar('target_y', valueAt('enemy_y', getVar('target_id'))),
        // 주황 빔 — archer 보다 굵게
        ...drawBeam(txExpr, tyExpr, '#f97316', 3),
        // splash damage
        setVar('i', 0),
        repeat.basic(MAX_ENEMIES, [
            changeVar('i', 1),
            if_(cmp(valueAt('enemy_active', getVar('i')), '==', 1), [
                setVar('dx', calc(valueAt('enemy_x', getVar('i')), '-', getVar('target_x'))),
                setVar('dy', calc(valueAt('enemy_y', getVar('i')), '-', getVar('target_y'))),
                setVar('dist_sq', calc(
                    calc(getVar('dx'), '*', getVar('dx')),
                    '+',
                    calc(getVar('dy'), '*', getVar('dy')),
                )),
                if_(cmp(getVar('dist_sq'), '<', SPLASH_RADIUS_SQ), [
                    setListAt('enemy_hp', getVar('i'),
                        calc(valueAt('enemy_hp', getVar('i')), '-', dmgExpr)),
                ]),
            ]),
        ]),
    ]),
];

// 슬롯 빈 표시용 — filled circle (ring 으로 하면 가운데 투명 영역이 클릭 안됨,
// 글상자 투명 bg 와 동일한 pixelPerfect 알파 검사 함정. circle 은 전체 면적 클릭 가능).
// transparency 70 효과로 시각적으로 ghosted 처리.
const filledEmpty = circle(20, '#94a3b8');

export default {
    name: '프론티어 가드 P3',
    scenes: [
        makeScene('intro', '시작 화면'),
        makeScene('play',  '게임 화면'),
    ],
    messages: [
        { id: 'win',           name: '승리' },
        { id: 'lose',          name: '패배' },
        { id: 'open_menu',     name: '메뉴열기' },
        { id: 'close_menu',    name: '메뉴닫기' },
        { id: 'refresh_slot',  name: '슬롯갱신' },
    ],
    variables: [
        { id: 'life',         name: '체력', value: '5',  visible: true,  x: -210, y: 50 },
        { id: 'gold',         name: '골드', value: String(INITIAL_GOLD), visible: true,  x: -210, y: 80 },
        { id: 'wave_idx',     name: '웨이브', value: '0', visible: true, x: -210, y: 110 },
        { id: 'enemies_done', name: '처리수', value: '0', visible: false },
        { id: 'next_id',      name: 'id카운터', value: '0', visible: false },
        { id: 'spawn_idx',    name: '스폰idx',  value: '0', visible: false },
        { id: 'current_type', name: '현재타입', value: '0', visible: false },
        { id: 'game_state',   name: '상태',     value: '0', visible: false },
        { id: 'prep_done',    name: '준비완료', value: '0', visible: false },
        // 슬롯 / 메뉴 관련
        { id: 'next_slot_id', name: 'nsi',     value: '0', visible: false },
        { id: 'slot_idx',     name: 'si',      value: '0', visible: false },
        { id: 'building_slot', name: 'bs',     value: '0', visible: false },
        { id: 'menu_state',   name: 'ms',      value: '0', visible: false },
        // 타겟팅 임시
        { id: 'target_id', name: 'tgt', value: '0', visible: false },
        { id: 'best_dist', name: 'd',   value: '0', visible: false },
        { id: 'i',         name: 'i',   value: '0', visible: false },
        { id: 'dx',        name: 'dx',  value: '0', visible: false },
        { id: 'dy',        name: 'dy',  value: '0', visible: false },
        { id: 'dist_sq',   name: 'dq',  value: '0', visible: false },
        { id: 'target_x',  name: 'tx',  value: '0', visible: false },
        { id: 'target_y',  name: 'ty',  value: '0', visible: false },
        // 매니저의 슬롯 순회 임시
        { id: 'cur_tx',   name: 'ctx', value: '0', visible: false },
        { id: 'cur_ty',   name: 'cty', value: '0', visible: false },
        { id: 'cur_type', name: 'ctp', value: '0', visible: false },
        { id: 'cur_dmg',  name: 'cdm', value: '0', visible: false },
        { id: 'hud_last_wave', name: 'hudlw', value: '0', visible: false },
    ],
    lists: [
        // 적 슬롯 (10)
        { id: 'enemy_active',  name: '활성', visible: false, array: Array(MAX_ENEMIES).fill('0') },
        { id: 'enemy_hp',      name: 'hp',   visible: false, array: Array(MAX_ENEMIES).fill('0') },
        { id: 'enemy_x',       name: 'ex',   visible: false, array: Array(MAX_ENEMIES).fill('0') },
        { id: 'enemy_y',       name: 'ey',   visible: false, array: Array(MAX_ENEMIES).fill('0') },
        { id: 'enemy_type',    name: 'type', visible: false, array: Array(MAX_ENEMIES).fill('0') },
        { id: 'enemy_last_hp', name: 'lhp',  visible: false, array: Array(MAX_ENEMIES).fill('0') },
        // 웨이브 데이터
        { id: 'wave_counts',  name: 'wc', visible: false, array: WAVE_COUNTS.map(String) },
        { id: 'wave_types',   name: 'wt', visible: false, array: WAVE_TYPES.map(String) },
        { id: 'type_hp',      name: 'thp', visible: false, array: TYPE_HP.map(String) },
        { id: 'type_size',    name: 'tsz', visible: false, array: TYPE_SIZE.map(String) },
        // 슬롯 시스템 — index 1..4
        { id: 'slot_x',     name: 'sx', visible: false, array: SLOT_X.map(String) },
        { id: 'slot_y',     name: 'sy', visible: false, array: Array(SLOT_COUNT).fill(String(SLOT_Y)) },
        { id: 'slot_type',  name: 'st', visible: false, array: Array(SLOT_COUNT).fill('0') },
        { id: 'slot_level', name: 'sl', visible: false, array: Array(SLOT_COUNT).fill('0') },
        { id: 'archer_dmg', name: 'ad', visible: false, array: ARCHER_DMG.map(String) },
        { id: 'cannon_dmg', name: 'cd', visible: false, array: CANNON_DMG.map(String) },
    ],
    objects: [
        // ═══════════════════════════════════════════════════════
        // INTRO 장면
        // ═══════════════════════════════════════════════════════
        {
            id: 'intro_title', name: '제목',
            scene: 'intro',
            objectType: 'textBox',
            text: '프론티어 가드',
            entity: {
                x: 0, y: 90, regX: 0, regY: 0,
                scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
                width: 320, height: 40,
                font: '32px NanumGothic',
                colour: '#1e3a8a', bgColor: '#dbeafe',
                lineBreak: false, textAlign: 1, visible: true,
            },
            script: [[ when.sceneStart() ]],
        },
        {
            id: 'intro_text', name: '설명',
            scene: 'intro',
            objectType: 'textBox',
            text: '4 슬롯에 타워를 배치 (궁수 50G / 대포 80G).\n적 처치 시 골드 획득 (스웜 10G / 탱크 30G).\n슬롯 클릭으로 업그레이드 (40G, dmg ↑).\n준비 완료 클릭 → 첫 웨이브 시작.',
            entity: {
                x: 0, y: 0, regX: 0, regY: 0,
                scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
                width: 400, height: 110,
                font: '15px NanumGothic',
                colour: '#1f2937', bgColor: '#f9fafb',
                lineBreak: true, textAlign: 1, visible: true,
            },
            script: [[ when.sceneStart() ]],
        },
        {
            id: 'intro_start_btn', name: '시작버튼',
            scene: 'intro',
            objectType: 'textBox',
            text: '▶ 게임 시작',
            entity: {
                x: 0, y: -100, regX: 0, regY: 0,
                scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
                width: 200, height: 40,
                font: '20px NanumGothic',
                colour: '#ffffff', bgColor: '#16a34a',
                lineBreak: false, textAlign: 1, visible: true,
            },
            script: [
                [ when.sceneStart() ],
                [
                    when.objectClick(),
                    startScene('play'),
                ],
            ],
        },

        // ═══════════════════════════════════════════════════════
        // PLAY 장면
        // ═══════════════════════════════════════════════════════

        // ── HUD 상태 표시 ─────────────────────────────────────────
        {
            id: 'hud_status', name: '상태표시',
            scene: 'play',
            objectType: 'textBox',
            text: '준비',
            entity: {
                x: 0, y: 110, regX: 0, regY: 0,
                scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
                width: 380, height: 28,
                font: '18px NanumGothic',
                colour: '#1f2937', bgColor: '#fef3c7',
                lineBreak: true, textAlign: 1, visible: true,
            },
            script: [
                [
                    when.sceneStart(),
                    writeText('타워 배치 후 [준비 완료] 클릭'),
                    setVar('hud_last_wave', 0),
                    repeat.inf([
                        // prep 중 → 메시지 유지
                        if_(cmp(getVar('prep_done'), '==', 1), [
                            // wave_idx 변화 시에만 갱신
                            if_(cmp(getVar('wave_idx'), '!=', getVar('hud_last_wave')), [
                                setVar('hud_last_wave', getVar('wave_idx')),
                                if_(cmp(getVar('wave_idx'), '>', 0), [
                                    writeText(combine(combine('웨이브 ', getVar('wave_idx')), '/3')),
                                ]),
                            ]),
                        ]),
                        wait(0.2),
                    ]),
                ],
                [ when.message('win'),  writeText('YOU WIN!') ],
                [ when.message('lose'), writeText('GAME OVER') ],
            ],
        },

        // ── 베이스 (heart) ───────────────────────────────────────
        {
            id: 'base', name: '기지',
            scene: 'play',
            objectType: 'sprite',
            pictures: [assets('heart', { id: 'pic_base' })],
            selectedPictureId: 'pic_base',
            entity: {
                x: 220, y: -50, regX: 14, regY: 14,
                scaleX: 1.5, scaleY: 1.5, rotation: 0, direction: 90,
                width: 28, height: 28, visible: true,
            },
            script: [[ when.sceneStart(), show() ]],
        },

        // ── 슬롯 템플릿 — 1 template + 4 클론 ─────────────────────
        {
            id: 'slot_template', name: '슬롯',
            scene: 'play',
            objectType: 'sprite',
            pictures: [
                pictureFromGen(filledEmpty, { id: 'pic_empty', name: 'empty' }),  // index 1 (filled)
                assets('tile-purple', { id: 'pic_archer' }),                      // index 2
                assets('tile-cyan',   { id: 'pic_cannon' }),                      // index 3
            ],
            selectedPictureId: 'pic_empty',
            entity: {
                x: -300, y: -300, regX: 22, regY: 22,
                scaleX: 0.6, scaleY: 0.6, rotation: 0, direction: 90,
                width: 44, height: 44, visible: false,
                rotateMethod: 'none',  // direction-as-id 시 시각 회전 회피 (tile = 사각형)
            },
            script: [
                // 1) 시작 — 4 클론 spawn
                [
                    when.sceneStart(),
                    hide(),
                    // slot_type/level 리스트 reset (재시작 대비)
                    setVar('slot_idx', 0),
                    repeat.basic(SLOT_COUNT, [
                        changeVar('slot_idx', 1),
                        setListAt('slot_type', getVar('slot_idx'), 0),
                        setListAt('slot_level', getVar('slot_idx'), 0),
                    ]),
                    // 클론 4 spawn
                    setVar('slot_idx', 0),
                    repeat.basic(SLOT_COUNT, [
                        changeVar('slot_idx', 1),
                        setVar('next_slot_id', getVar('slot_idx')),
                        locateXY(valueAt('slot_x', getVar('slot_idx')), valueAt('slot_y', getVar('slot_idx'))),
                        createClone('self'),
                        wait(0.1),  // 클론 시작이 next_slot_id 캡처할 시간
                    ]),
                    // 템플릿 자체는 화면 밖
                    locateXY(-300, -300),
                ],
                // 2) 클론 시작 — id 캡처 + 초기 visual (empty)
                [
                    when.cloneStart(),
                    turnAbs(getVar('next_slot_id')),  // direction = my slot id 1..4
                    show(),
                    // 초기 모양 = empty
                    changeShape(1),
                    setEffect('transparency', 70),
                ],
                // 3) 슬롯 클릭 — 메뉴 열기 (state 결정)
                [
                    when.cloneStart(),
                    // 클릭 핸들러는 자체 트리거. cloneStart 와 같이 등록되어 클론에 살아있음.
                ],
                [
                    when.objectClick(),
                    // prep 또는 게임 진행 중 모두 빌드/업그레이드 가능 (preparation 강제 X)
                    setVar('building_slot', coord('self', 'direction')),
                    // 메뉴 상태 결정: 0=빈 → build, 1=Lv1 → upgrade, 2=Lv2 → ignore
                    if_(cmp(valueAt('slot_type', coord('self', 'direction')), '==', 0), [
                        setVar('menu_state', 1),
                        sendMessage('open_menu'),
                    ]),
                    if_(cmp(valueAt('slot_level', coord('self', 'direction')), '==', 1), [
                        setVar('menu_state', 2),
                        sendMessage('open_menu'),
                    ]),
                ],
                // 4) refresh_slot — 자기 슬롯 visual 갱신 (모든 클론 + template 이 listen).
                //    template (direction=90) 은 슬롯 1..4 범위 밖이라 valueAt 실패 회피 위해
                //    direction 1..4 가드 필수.
                [
                    when.message('refresh_slot'),
                    // 가드: direction 이 1..4 슬롯 id 범위인 클론만 처리 (template 의 direction=90 제외)
                    if_(cmp(coord('self', 'direction'), '<=', 4), [
                        if_(cmp(valueAt('slot_type', coord('self', 'direction')), '==', 0), [
                            changeShape(1),
                            setEffect('transparency', 70),
                            setEffect('brightness', 0),
                        ]),
                        if_(cmp(valueAt('slot_type', coord('self', 'direction')), '==', 1), [
                            changeShape(2),
                            setEffect('transparency', 0),
                            if_(cmp(valueAt('slot_level', coord('self', 'direction')), '==', 1), [
                                setEffect('brightness', 0),
                            ]),
                            if_(cmp(valueAt('slot_level', coord('self', 'direction')), '==', 2), [
                                setEffect('brightness', 30),
                            ]),
                        ]),
                        if_(cmp(valueAt('slot_type', coord('self', 'direction')), '==', 2), [
                            changeShape(3),
                            setEffect('transparency', 0),
                            if_(cmp(valueAt('slot_level', coord('self', 'direction')), '==', 1), [
                                setEffect('brightness', 0),
                            ]),
                            if_(cmp(valueAt('slot_level', coord('self', 'direction')), '==', 2), [
                                setEffect('brightness', 30),
                            ]),
                        ]),
                    ]),
                ],
            ],
        },

        // ── 빌드/업그레이드 메뉴 — 3 textBox ───────────────────────
        // menu_state=1 (build): btn1=궁수, btn2=대포, btn3=취소
        // menu_state=2 (upgrade): btn1=업그레이드, btn2=숨김, btn3=취소
        {
            id: 'menu_btn1', name: '메뉴버튼1',
            scene: 'play',
            objectType: 'textBox',
            text: '버튼1',
            entity: {
                x: -90, y: -90, regX: 0, regY: 0,
                scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
                width: 140, height: 36,
                font: '15px NanumGothic',
                colour: '#ffffff', bgColor: '#2563eb',
                lineBreak: false, textAlign: 1, visible: true,  // 클릭 등록 위해 visible:true 시작
            },
            script: [
                [ when.sceneStart(), hide() ],
                [
                    when.message('open_menu'),
                    if_(cmp(getVar('menu_state'), '==', 1), [
                        writeText(combine('궁수 ', combine(String(ARCHER_BUILD_COST), 'G'))),
                    ]),
                    if_(cmp(getVar('menu_state'), '==', 2), [
                        writeText(combine('업그레이드 ', combine(String(UPGRADE_COST), 'G'))),
                    ]),
                    show(),
                ],
                [
                    when.message('close_menu'),
                    hide(),
                ],
                [
                    when.objectClick(),
                    // build mode: 궁수
                    if_(cmp(getVar('menu_state'), '==', 1), [
                        if_(cmp(getVar('gold'), '>=', ARCHER_BUILD_COST), [
                            changeVar('gold', -ARCHER_BUILD_COST),
                            setListAt('slot_type',  getVar('building_slot'), 1),
                            setListAt('slot_level', getVar('building_slot'), 1),
                            sendMessage('refresh_slot'),
                            sendMessage('close_menu'),
                        ]),
                    ]),
                    // upgrade mode
                    if_(cmp(getVar('menu_state'), '==', 2), [
                        if_(cmp(getVar('gold'), '>=', UPGRADE_COST), [
                            changeVar('gold', -UPGRADE_COST),
                            setListAt('slot_level', getVar('building_slot'), 2),
                            sendMessage('refresh_slot'),
                            sendMessage('close_menu'),
                        ]),
                    ]),
                ],
            ],
        },
        {
            id: 'menu_btn2', name: '메뉴버튼2',
            scene: 'play',
            objectType: 'textBox',
            text: '버튼2',
            entity: {
                x: 90, y: -90, regX: 0, regY: 0,
                scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
                width: 140, height: 36,
                font: '15px NanumGothic',
                colour: '#ffffff', bgColor: '#0891b2',
                lineBreak: false, textAlign: 1, visible: true,
            },
            script: [
                [ when.sceneStart(), hide() ],
                [
                    when.message('open_menu'),
                    if_(cmp(getVar('menu_state'), '==', 1), [
                        writeText(combine('대포 ', combine(String(CANNON_BUILD_COST), 'G'))),
                        show(),
                    ]),
                    // upgrade mode: btn2 hidden
                    if_(cmp(getVar('menu_state'), '==', 2), [
                        hide(),
                    ]),
                ],
                [
                    when.message('close_menu'),
                    hide(),
                ],
                [
                    when.objectClick(),
                    if_(cmp(getVar('menu_state'), '==', 1), [
                        if_(cmp(getVar('gold'), '>=', CANNON_BUILD_COST), [
                            changeVar('gold', -CANNON_BUILD_COST),
                            setListAt('slot_type',  getVar('building_slot'), 2),  // cannon
                            setListAt('slot_level', getVar('building_slot'), 1),
                            sendMessage('refresh_slot'),
                            sendMessage('close_menu'),
                        ]),
                    ]),
                ],
            ],
        },
        {
            id: 'menu_cancel', name: '취소버튼',
            scene: 'play',
            objectType: 'textBox',
            text: '취소',
            entity: {
                x: 0, y: -125, regX: 0, regY: 0,
                scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
                width: 100, height: 30,
                font: '14px NanumGothic',
                colour: '#ffffff', bgColor: '#6b7280',
                lineBreak: false, textAlign: 1, visible: true,
            },
            script: [
                [ when.sceneStart(), hide() ],
                [ when.message('open_menu'), show() ],
                [ when.message('close_menu'), hide() ],
                [
                    when.objectClick(),
                    sendMessage('close_menu'),
                ],
            ],
        },

        // ── "준비 완료" 버튼 — prep 단계 종료 트리거 ───────────────
        {
            id: 'prep_done_btn', name: '준비완료',
            scene: 'play',
            objectType: 'textBox',
            text: '✓ 준비 완료',
            entity: {
                x: 180, y: 110, regX: 0, regY: 0,
                scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
                width: 110, height: 28,
                font: '14px NanumGothic',
                colour: '#ffffff', bgColor: '#dc2626',
                lineBreak: false, textAlign: 1, visible: true,
            },
            script: [
                [ when.sceneStart(), show() ],
                [
                    when.objectClick(),
                    setVar('prep_done', 1),
                    hide(),  // 클릭 후 사라짐
                ],
            ],
        },

        // ── 적 템플릿 ──────────────────────────────────────────
        {
            id: 'enemy', name: '적',
            scene: 'play',
            objectType: 'sprite',
            pictures: [
                assets('ball-red',    { id: 'pic_swarm' }),
                assets('ball-yellow', { id: 'pic_tank' }),
            ],
            selectedPictureId: 'pic_swarm',
            entity: {
                x: -300, y: -50, regX: 22, regY: 22,
                scaleX: 0.6, scaleY: 0.6, rotation: 0, direction: 90,
                width: 44, height: 44, visible: false,
            },
            script: [
                [
                    when.cloneStart(),
                    turnAbs(getVar('next_id')),
                    setListAt('enemy_type', getVar('next_id'), getVar('current_type')),
                    changeShape(getVar('current_type')),
                    setListAt('enemy_hp', getVar('next_id'), valueAt('type_hp', getVar('current_type'))),
                    setListAt('enemy_last_hp', getVar('next_id'), valueAt('type_hp', getVar('current_type'))),
                    setSize(valueAt('type_size', getVar('current_type'))),
                    locateXY(PATH_START_X, PATH_Y),
                    setEffect('brightness', 0),
                    show(),
                    setListAt('enemy_active', getVar('next_id'), 1),
                    setListAt('enemy_x', getVar('next_id'), PATH_START_X),
                    setListAt('enemy_y', getVar('next_id'), PATH_Y),
                    repeat.inf([
                        if_(cmp(valueAt('enemy_type', coord('self', 'direction')), '==', 2),
                            [ moveX(SPEED_TANK) ],
                            [ moveX(SPEED_SWARM) ],
                        ),
                        setListAt('enemy_x', coord('self', 'direction'), coord('self', 'x')),
                        // 데미지 플래시
                        if_(cmp(valueAt('enemy_hp', coord('self', 'direction')), '<',
                                valueAt('enemy_last_hp', coord('self', 'direction'))), [
                            setEffect('brightness', 60),
                            wait(0.08),
                            setEffect('brightness', 0),
                        ]),
                        setListAt('enemy_last_hp', coord('self', 'direction'),
                                  valueAt('enemy_hp', coord('self', 'direction'))),
                        // hp <= 0 처치 — 골드 보상
                        if_(cmp(valueAt('enemy_hp', coord('self', 'direction')), '<=', 0), [
                            if_(cmp(valueAt('enemy_active', coord('self', 'direction')), '==', 1), [
                                setListAt('enemy_active', coord('self', 'direction'), 0),
                                changeVar('enemies_done', 1),
                                // 골드 보상 — 타입별
                                if_(cmp(valueAt('enemy_type', coord('self', 'direction')), '==', 1), [
                                    changeVar('gold', SWARM_KILL_REWARD),
                                ]),
                                if_(cmp(valueAt('enemy_type', coord('self', 'direction')), '==', 2), [
                                    changeVar('gold', TANK_KILL_REWARD),
                                ]),
                                deleteClone(),
                            ]),
                        ]),
                        // 베이스 도달
                        if_(cmp(coord('self', 'x'), '>=', PATH_END_X), [
                            if_(cmp(valueAt('enemy_active', coord('self', 'direction')), '==', 1), [
                                changeVar('life', -1),
                                changeVar('enemies_done', 1),
                                setListAt('enemy_active', coord('self', 'direction'), 0),
                                deleteClone(),
                            ]),
                        ]),
                        wait(0.02),
                    ]),
                ],
            ],
        },

        // ── 매니저 ──────────────────────────────────────────────
        {
            id: 'manager', name: '매니저',
            scene: 'play',
            objectType: 'sprite',
            pictures: [assets('coin', { id: 'pic_mgr' })],
            selectedPictureId: 'pic_mgr',
            entity: {
                x: -300, y: -300, regX: 16, regY: 16,
                scaleX: 0.1, scaleY: 0.1, rotation: 0, direction: 90,
                width: 32, height: 32, visible: false,
            },
            script: [
                // 1) 시작 — init + prep 대기 + 웨이브 spawn
                [
                    when.sceneStart(),
                    hide(),
                    setVar('life', 5),
                    setVar('gold', INITIAL_GOLD),
                    setVar('next_id', 0),
                    setVar('spawn_idx', 0),
                    setVar('wave_idx', 0),
                    setVar('enemies_done', 0),
                    setVar('game_state', 0),
                    setVar('prep_done', 0),
                    setVar('menu_state', 0),
                    setVar('building_slot', 0),
                    // prep 종료까지 대기 (prep_done == 1 까지) — wait_until 패턴
                    repeat.inf([
                        if_(cmp(getVar('prep_done'), '==', 1), [
                            stopRepeat(),
                        ]),
                        wait(0.1),
                    ]),
                    // 웨이브 spawn 시작
                    repeat.basic(WAVE_COUNTS.length, [
                        changeVar('wave_idx', 1),
                        repeat.basic(valueAt('wave_counts', getVar('wave_idx')), [
                            changeVar('next_id', 1),
                            changeVar('spawn_idx', 1),
                            setVar('current_type', valueAt('wave_types', getVar('spawn_idx'))),
                            createClone('enemy'),
                            wait(SPAWN_INTERVAL),
                        ]),
                        wait(WAVE_BREAK),
                    ]),
                ],
                // 2) 종료 판정
                [
                    when.sceneStart(),
                    repeat.inf([
                        if_(cmp(getVar('game_state'), '==', 0), [
                            if_(cmp(getVar('life'), '<=', 0), [
                                setVar('game_state', 2),
                                sendMessage('lose'),
                            ]),
                            if_(cmp(getVar('enemies_done'), '>=', TOTAL_ENEMIES), [
                                if_(cmp(getVar('life'), '>', 0),
                                    [ setVar('game_state', 1), sendMessage('win') ],
                                    [ setVar('game_state', 2), sendMessage('lose') ],
                                ),
                            ]),
                        ]),
                        wait(0.1),
                    ]),
                ],
                // 3) close_menu 메시지 — menu_state / building_slot 리셋
                //    (메뉴 textBox 들의 hide 와 분리 — 글로벌 상태 정리는 manager 가 담당)
                [
                    when.message('close_menu'),
                    setVar('menu_state', 0),
                    setVar('building_slot', 0),
                ],
                // 4) 타워 타겟팅 — 슬롯 4 개 순회, type 별 분기 + 공격 빔 시각화
                [
                    when.sceneStart(),
                    // 빔 brush 초기 설정
                    setThickness(2),
                    setColor('#fbbf24'),
                    repeat.inf([
                        if_(cmp(getVar('game_state'), '==', 0), [
                            if_(cmp(getVar('prep_done'), '==', 1), [
                                // 매 cycle 시작 시 이전 빔 erase — 새 라인이 0.5 초 visible
                                eraseAll(),
                                setVar('slot_idx', 0),
                                repeat.basic(SLOT_COUNT, [
                                    changeVar('slot_idx', 1),
                                    setVar('cur_type', valueAt('slot_type', getVar('slot_idx'))),
                                    if_(cmp(getVar('cur_type'), '>', 0), [
                                        setVar('cur_tx', valueAt('slot_x', getVar('slot_idx'))),
                                        setVar('cur_ty', valueAt('slot_y', getVar('slot_idx'))),
                                        // archer
                                        if_(cmp(getVar('cur_type'), '==', 1), [
                                            setVar('cur_dmg', valueAt('archer_dmg',
                                                valueAt('slot_level', getVar('slot_idx')))),
                                            ...archerTick(getVar('cur_tx'), getVar('cur_ty'), getVar('cur_dmg')),
                                        ]),
                                        // cannon
                                        if_(cmp(getVar('cur_type'), '==', 2), [
                                            setVar('cur_dmg', valueAt('cannon_dmg',
                                                valueAt('slot_level', getVar('slot_idx')))),
                                            ...cannonTick(getVar('cur_tx'), getVar('cur_ty'), getVar('cur_dmg')),
                                        ]),
                                    ]),
                                ]),
                            ]),
                        ]),
                        wait(TOWER_COOLDOWN),
                    ]),
                ],
                // 5) 게임 종료 시 빔 정리 — win/lose 메시지 들으면 eraseAll
                [
                    when.message('win'),
                    eraseAll(),
                ],
                [
                    when.message('lose'),
                    eraseAll(),
                ],
            ],
        },
    ],
};
