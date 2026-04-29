// 과일 사냥 — 3×3 격자에서 목표 과일을 시간 안에 클릭.
//
// 핵심 메커니즘:
//   - 과일 5 종 (사과·바나나·포도·귤·수박) 중 1 종이 목표
//   - 3×3 격자 (9 슬롯) 에 9 개 과일 클론 — 정확히 2 개가 목표, 7 개는 비-목표
//   - 붓 타이머: 화면 상단에 목표 과일 색의 막대를 매 프레임 다시 그림 (붓으로 칠함)
//   - 정답 클릭 → 점수 +100×combo, combo +1, 2 개 다 맞히면 다음 스테이지
//   - 오답 클릭 → 시간 -2 초, combo 리셋
//   - 시간 0 → 게임 오버
//
// 클론 정답 판정 (핵심 트릭):
//   클론은 글로벌 변수만 공유 → 클론별 "내가 target 인지" 직접 표시 못 함.
//   대신 클론의 좌표를 target_pos1/2 의 격자 좌표와 비교 — 9 슬롯 좌표는 모두 고유.
//   self.x == grid_x[pos1+1] AND self.y == grid_y[pos1+1] (또는 pos2) 이면 target.

import {
    when, repeat, if_, cmp, calc, getVar, setVar, changeVar, wait,
    locateXY, coord,
    sendMessage, stopRepeat,
    valueAt,
    obj, picture, rand, mod,
    show, hide, setSize, setEffect, addEffect, clearEffects,
    changeShape, createClone, deleteClone, removeAllClones,
    sayFor, removeDialog, writeText,
    startDraw, stopDraw, eraseAll, setColor, setThickness,
    timer,
    combine,
} from '../../tools/lib/spec-dsl.mjs';
import { assets } from '../../tools/lib/game-assets.mjs';

const GRID_X = [-100, 0, 100, -100, 0, 100, -100, 0, 100];
const GRID_Y = [60, 60, 60, 0, 0, 0, -60, -60, -60];
const FRUIT_NAMES = ['사과', '바나나', '포도', '귤', '수박'];
// 주의: changeShape 는 picture index (1-base) 를 직접 받을 수 있어 list 룩업 불필요.
// Entry getPicture priority: id → name → index (entryjs/object.js:342). picture name
// 이 'fruit-apple' (asset 카탈로그 이름) 과 다른 id 'pic_apple' 을 동시에 갖으면
// 편집기 UI 에서 혼란. 인덱스 1-5 를 사용하면 picture 이름·id 와 무관하게 작동.
const MAX_TIME = 10;

// 슬롯 spawn — 한 슬롯에 클론 1 개 생성. spawn_idx 가 어느 위치인지 기준.
const spawnSlot = [
    // shape 결정 — target 위치 두 곳이면 target_idx, 그 외엔 random non-target
    setVar('shape_idx', getVar('target_idx')),  // 기본값 (덮어써질 수도)
    if_(cmp(getVar('spawn_idx'), '!=', getVar('target_pos1')), [
        if_(cmp(getVar('spawn_idx'), '!=', getVar('target_pos2')), [
            // non-target — rand(1,4) 후 target_idx 이상이면 +1 (target 회피)
            setVar('shape_idx', rand(1, 4)),
            if_(cmp(getVar('shape_idx'), '>=', getVar('target_idx')), [
                changeVar('shape_idx', 1),
            ]),
        ]),
    ]),
    // shape_idx (1-5) 를 picture 인덱스로 직접 전달 — Entry getPicture 가 fallback 으로 인덱스 룩업.
    changeShape(getVar('shape_idx')),
    // 격자 위치 (1-base)
    locateXY(
        valueAt('grid_x', calc(getVar('spawn_idx'), '+', 1)),
        valueAt('grid_y', calc(getVar('spawn_idx'), '+', 1)),
    ),
    createClone('self'),
];

export default {
    name: '과일 사냥',
    messages: [
        { id: 'new_stage', name: '새스테이지' },
        { id: 'time_up',   name: '시간종료' },
    ],
    variables: [
        { id: 'score',  name: '점수', value: '0', visible: true, x: -220, y: 120 },
        { id: 'combo',  name: '콤보', value: '0', visible: true, x: -220, y: 90 },
        { id: 'level',  name: '레벨', value: '1', visible: true, x: -220, y: 60 },
        { id: 'target_idx',        name: '목표',     value: '1', visible: false },
        { id: 'targets_remaining', name: '남은목표', value: '2', visible: false },
        { id: 'target_pos1', name: 'pos1', value: '0', visible: false },
        { id: 'target_pos2', name: 'pos2', value: '0', visible: false },
        { id: 'spawn_idx',   name: 'idx',  value: '0', visible: false },
        { id: 'shape_idx',   name: 'shape', value: '0', visible: false },
        { id: 'time_left',     name: 'time',     value: String(MAX_TIME), visible: false },
        { id: 'penalty_total', name: '페널티',    value: '0', visible: false },
        { id: 'game_state', name: '상태', value: '0', visible: false },
        // 클릭 판정용 임시
        { id: 'is_target', name: 'is_t', value: '0', visible: false },
    ],
    lists: [
        { id: 'fruit_names', name: '과일명', visible: false, array: FRUIT_NAMES },
        { id: 'grid_x',      name: 'gx',     visible: false, array: GRID_X.map(String) },
        { id: 'grid_y',      name: 'gy',     visible: false, array: GRID_Y.map(String) },
    ],
    objects: [
        // ── 게임 오버 메시지 ─────────────────────────────────
        {
            id: 'gameover_msg', name: '게임오버',
            objectType: 'textBox',
            text: ' ',
            entity: {
                x: 0, y: 0, regX: 0, regY: 0,
                scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
                width: 320, height: 70,
                font: '28px NanumGothic',
                colour: '#1f2937', bgColor: '#fef3c7',
                lineBreak: true, textAlign: 1, visible: false,
            },
            script: [[
                when.message('time_up'),
                writeText('GAME OVER'),
                show(),
            ]],
        },

        // ── 타이틀 (목표 과일 이름) ─────────────────────────
        {
            id: 'title', name: '목표안내',
            objectType: 'textBox',
            text: '준비',
            entity: {
                x: 0, y: 130, regX: 0, regY: 0,
                scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
                width: 320, height: 22,
                font: '16px NanumGothic',
                colour: '#1f2937', bgColor: '#fef3c7',
                lineBreak: true, textAlign: 1, visible: true,
            },
            script: [[
                when.message('new_stage'),
                writeText(combine('찾아라: ', valueAt('fruit_names', getVar('target_idx')))),
            ]],
        },

        // ── 타이머 + 붓 ────────────────────────────────────
        {
            id: 'timer_brush', name: '타이머붓',
            objectType: 'sprite',
            pictures: [assets('star', { id: 'pic_brush' })],
            selectedPictureId: 'pic_brush',
            entity: {
                x: -200, y: 110, regX: 22, regY: 22,
                scaleX: 0.5, scaleY: 0.5, rotation: 0, direction: 90,
                width: 44, height: 44, visible: true,
            },
            script: [
                // 시간 누적 — projectTimer + penalty_total
                [
                    when.run(),
                    timer.reset(), timer.start(),
                    setVar('penalty_total', 0),
                    setVar('time_left', MAX_TIME),
                    repeat.inf([
                        if_(cmp(getVar('game_state'), '==', 0), [
                            setVar('time_left',
                                calc(calc(MAX_TIME, '-', timer.value()), '-', getVar('penalty_total'))),
                            if_(cmp(getVar('time_left'), '<=', 0), [
                                setVar('time_left', 0),
                                setVar('game_state', 1),
                                sendMessage('time_up'),
                            ]),
                        ]),
                    ]),
                ],
                // 새 스테이지 — 타이머 리셋
                [
                    when.message('new_stage'),
                    timer.reset(), timer.start(),
                    setVar('penalty_total', 0),
                    setVar('time_left', MAX_TIME),
                ],
                // 매 프레임 막대 redraw
                [
                    when.run(),
                    setThickness(8),
                    repeat.inf([
                        eraseAll(),
                        // 색
                        if_(cmp(getVar('time_left'), '<', 5), [ setColor('#dc2626') ]),
                        if_(cmp(getVar('time_left'), '>=', 5), [
                            if_(cmp(getVar('target_idx'), '==', 1), [setColor('#dc2626')]),
                            if_(cmp(getVar('target_idx'), '==', 2), [setColor('#facc15')]),
                            if_(cmp(getVar('target_idx'), '==', 3), [setColor('#9333ea')]),
                            if_(cmp(getVar('target_idx'), '==', 4), [setColor('#fb923c')]),
                            if_(cmp(getVar('target_idx'), '==', 5), [setColor('#16a34a')]),
                        ]),
                        // 좌측 끝으로
                        if_(cmp(getVar('time_left'), '<', 5), [
                            locateXY(-200, calc(110, '+', rand(-3, 3))),
                        ]),
                        if_(cmp(getVar('time_left'), '>=', 5), [
                            locateXY(-200, 110),
                        ]),
                        startDraw(),
                        locateXY(calc(-200, '+', calc(getVar('time_left'), '*', 40)), 110),
                        stopDraw(),
                    ]),
                ],
            ],
        },

        // ── fruit_template (5 picture, 9 클론) ────────────────
        {
            id: 'fruit_template', name: '과일',
            objectType: 'sprite',
            pictures: [
                assets('fruit-apple',      { id: 'pic_apple' }),
                assets('fruit-banana',     { id: 'pic_banana' }),
                assets('fruit-grape',      { id: 'pic_grape' }),
                assets('fruit-orange',     { id: 'pic_orange' }),
                assets('fruit-watermelon', { id: 'pic_watermelon' }),
            ],
            selectedPictureId: 'pic_apple',
            entity: {
                x: 0, y: 0, regX: 24, regY: 24,
                scaleX: 0.7, scaleY: 0.7, rotation: 0, direction: 90,
                width: 48, height: 48, visible: false,
            },
            script: [
                // 시작 — 첫 스테이지: target 변수들을 먼저 설정한 뒤 메시지 발송.
                // 메시지 핸들러 안에서 setVar 하면 다른 리스너 (title 등) 가 OLD 값을 읽는 race 발생.
                [
                    when.run(),
                    hide(),
                    setVar('target_idx', rand(1, 5)),
                    setVar('target_pos1', rand(0, 8)),
                    setVar('target_pos2',
                        mod(calc(getVar('target_pos1'), '+', calc(1, '+', rand(0, 7))), 9)),
                    setVar('targets_remaining', 2),
                    sendMessage('new_stage'),
                ],

                // new_stage — 9 클론 spawn (target 변수는 이미 설정됨)
                [
                    when.message('new_stage'),
                    removeAllClones(),
                    setVar('spawn_idx', 0),
                    repeat.basic(9, [
                        ...spawnSlot,
                        changeVar('spawn_idx', 1),
                    ]),
                ],

                // 클론 시작 — show
                [
                    when.cloneStart(),
                    show(),
                ],

                // 클론 클릭 — target 인지 좌표 비교로 판정
                [
                    when.objectClick(),
                    if_(cmp(getVar('game_state'), '==', 0), [
                        // is_target 플래그 초기화 + 두 target 위치와 비교
                        setVar('is_target', 0),
                        // target_pos1 의 격자 좌표
                        if_(cmp(coord('self', 'x'), '==', valueAt('grid_x', calc(getVar('target_pos1'), '+', 1))), [
                            if_(cmp(coord('self', 'y'), '==', valueAt('grid_y', calc(getVar('target_pos1'), '+', 1))), [
                                setVar('is_target', 1),
                            ]),
                        ]),
                        // target_pos2 의 격자 좌표
                        if_(cmp(coord('self', 'x'), '==', valueAt('grid_x', calc(getVar('target_pos2'), '+', 1))), [
                            if_(cmp(coord('self', 'y'), '==', valueAt('grid_y', calc(getVar('target_pos2'), '+', 1))), [
                                setVar('is_target', 1),
                            ]),
                        ]),
                        // 정답
                        if_(cmp(getVar('is_target'), '==', 1), [
                            changeVar('combo', 1),
                            changeVar('score', calc(100, '*', getVar('combo'))),
                            changeVar('targets_remaining', -1),
                            // 스테이지 클리어 vs 부분 클리어 — if_else 로 분기.
                            // 주의: deleteClone 후 같은 스크립트의 후속 블록은 실행 안 됨 (클론 컨텍스트 소멸).
                            // 따라서 sendMessage 와 deleteClone 을 한 트리거에서 둘 다 호출하면 안 됨 (앞 게 죽음).
                            if_(cmp(getVar('targets_remaining'), '<=', 0),
                                [
                                    // 다음 라운드 — target 변수들 먼저 갱신 후 메시지 발송 (race 회피)
                                    changeVar('level', 1),
                                    setVar('target_idx', rand(1, 5)),
                                    setVar('target_pos1', rand(0, 8)),
                                    setVar('target_pos2',
                                        mod(calc(getVar('target_pos1'), '+', calc(1, '+', rand(0, 7))), 9)),
                                    setVar('targets_remaining', 2),
                                    sendMessage('new_stage'),
                                ],
                                [
                                    deleteClone(),  // 부분 클리어 — 자기만 제거
                                ]
                            ),
                        ]),
                        // 오답
                        if_(cmp(getVar('is_target'), '==', 0), [
                            setVar('combo', 0),
                            changeVar('penalty_total', 2),
                        ]),
                    ]),
                ],
            ],
        },
    ],
};
