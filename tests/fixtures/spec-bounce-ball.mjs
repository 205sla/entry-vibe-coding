// 바운스 볼 — Breakout 스타일 (이미지 + 복제본 패턴).
//
// 이미지: 공·벽돌·패들 모두 정적 라이브러리 (`public/images/game/`) 의 sprite 사용.
// 복제본: 18 벽돌은 1 개의 `brick_template` 오브젝트의 clone — 같은 역할 반복은 복제본으로.
//
// 구조:
//   - paddle (sprite, paddle-blue): 좌/우 키로 이동, 공 충돌 → 'paddle_hit'
//   - ball   (sprite, ball-blue):   매 프레임 (x+=dx, y+=dy), 벽 반사, 메시지 받으면 dy 처리
//   - brick_template (sprite, 3 picture: brick-red/orange/green):
//       when_run: 행별로 changeShape + locateXY + createClone × 18
//       when_clone_start: show + 충돌 감시 → 'ball_bounce' + deleteClone
//   - status_msg (textBox): GAME OVER / YOU WIN
//
// 메시지:
//   ball_bounce  — 공의 dy 부호 반전 (벽돌과 부딪힘)
//   paddle_hit   — 공의 dy 양수 강제 (패들에서 항상 위로)

import {
    when, repeat, if_, cmp, calc, getVar, setVar, changeVar, wait,
    moveX, moveY, locateXY, coord, reach,
    sendMessage, stopRepeat,
    obj, picture,
    show, hide, setSize, setEffect, clearEffects,
    changeShape, createClone, deleteClone,
    writeText, num,
} from '../../tools/lib/spec-dsl.mjs';
import { assets } from '../../tools/lib/game-assets.mjs';

const COL_X = [-150, -90, -30, 30, 90, 150];
const ROW_Y = [120, 90, 60];
const ROW_PIC = ['pic_r', 'pic_o', 'pic_g'];

// 한 행 (6 클론) 스폰. row 인덱스로 ROW_Y / 미리 changeShape 된 picture 사용.
function spawnRow(rowIdx) {
    const out = [];
    for (const x of COL_X) {
        out.push(locateXY(x, ROW_Y[rowIdx]));
        out.push(createClone('self'));
    }
    return out;
}

export default {
    name: '바운스 볼',
    messages: [
        { id: 'ball_bounce', name: '공반사' },
        { id: 'paddle_hit',  name: '패들충돌' },
    ],
    variables: [
        { id: 'score',       name: '점수', value: '0', visible: true,  x: -220, y: 120 },
        { id: 'lives',       name: '목숨', value: '3', visible: true,  x: -220, y: 90  },
        { id: 'bricks_left', name: '남은벽돌', value: '18', visible: false },
        { id: 'ball_dx', name: 'dx', value: '2', visible: false },
        { id: 'ball_dy', name: 'dy', value: '3', visible: false },
        { id: 'game_state', name: '상태', value: '0', visible: false },
    ],
    objects: [
        // ── 상태 메시지 textBox ─────────────────────────────────
        {
            id: 'status_msg', name: '상태메시지',
            objectType: 'textBox',
            text: ' ',
            entity: {
                x: 0, y: 0,
                regX: 0, regY: 0,
                scaleX: 1, scaleY: 1,
                rotation: 0, direction: 90,
                width: 320, height: 70,
                font: '32px NanumGothic',
                colour: '#1f2937',
                bgColor: '#fef3c7',
                lineBreak: true,
                textAlign: 1,
                visible: false,
            },
            script: [
                [
                    when.run(),
                    hide(),
                    setVar('game_state', 0),
                    setVar('score', 0),
                    setVar('lives', 3),
                    setVar('bricks_left', 18),
                ],
                [
                    when.run(),
                    repeat.inf([
                        if_(cmp(getVar('lives'), '<=', 0), [
                            setVar('game_state', 1),
                            writeText('GAME OVER'),
                            show(),
                            stopRepeat(),
                        ]),
                        if_(cmp(getVar('bricks_left'), '<=', 0), [
                            setVar('game_state', 2),
                            writeText('YOU WIN!'),
                            show(),
                            stopRepeat(),
                        ]),
                        wait(0.2),
                    ]),
                ],
            ],
        },

        // ── 패들 (sprite, paddle-blue.svg) ────────────────────────
        obj('paddle', '패들', {
            picture: assets('paddle-blue'),
            entity: {
                x: 0, y: -115,
                regX: 42, regY: 8,    // assets('paddle-blue').dimension = 84×16
                scaleX: 1, scaleY: 1,
                rotation: 0, direction: 90,
                width: 84, height: 16,
                visible: true,
            },
            threads: [
                // ← 키
                [
                    when.keyPressed('37'),
                    if_(cmp(getVar('game_state'), '==', 0), [
                        if_(cmp(coord('self', 'x'), '>', -190), [ moveX(-12) ]),
                    ]),
                ],
                // → 키
                [
                    when.keyPressed('39'),
                    if_(cmp(getVar('game_state'), '==', 0), [
                        if_(cmp(coord('self', 'x'), '<', 190), [ moveX(12) ]),
                    ]),
                ],
                // 공 충돌 → paddle_hit
                [
                    when.run(),
                    repeat.inf([
                        if_(reach('ball'), [
                            sendMessage('paddle_hit'),
                            wait(0.1),
                        ]),
                    ]),
                ],
            ],
        }),

        // ── 공 (sprite, ball-blue.svg) ────────────────────────────
        obj('ball', '공', {
            picture: assets('ball-blue'),
            entity: {
                x: 0, y: -50,
                regX: 22, regY: 22,    // assets('ball-blue').dimension = 44×44
                scaleX: 0.7, scaleY: 0.7,
                rotation: 0, direction: 90,
                width: 44, height: 44,
                visible: true,
            },
            threads: [
                // 메인 — 매 프레임 이동 + 벽 반사 + 바닥 떨어짐
                [
                    when.run(),
                    setVar('ball_dx', 2),
                    setVar('ball_dy', 3),
                    locateXY(0, -50),
                    repeat.inf([
                        if_(cmp(getVar('game_state'), '==', 0), [
                            moveX(getVar('ball_dx')),
                            moveY(getVar('ball_dy')),
                            if_(cmp(coord('self', 'x'), '>', 230), [
                                setVar('ball_dx', calc(0, '-', getVar('ball_dx'))),
                            ]),
                            if_(cmp(coord('self', 'x'), '<', -230), [
                                setVar('ball_dx', calc(0, '-', getVar('ball_dx'))),
                            ]),
                            if_(cmp(coord('self', 'y'), '>', 130), [
                                setVar('ball_dy', calc(0, '-', getVar('ball_dy'))),
                            ]),
                            if_(cmp(coord('self', 'y'), '<', -130), [
                                changeVar('lives', -1),
                                locateXY(0, -50),
                                setVar('ball_dx', 2),
                                setVar('ball_dy', 3),
                                wait(0.5),
                            ]),
                        ]),
                    ]),
                ],
                [ when.message('ball_bounce'), setVar('ball_dy', calc(0, '-', getVar('ball_dy'))) ],
                [
                    when.message('paddle_hit'),
                    if_(cmp(getVar('ball_dy'), '<', 0), [
                        setVar('ball_dy', calc(0, '-', getVar('ball_dy'))),
                    ]),
                ],
            ],
        }),

        // ── brick_template (sprite, 3 pictures, 18 clones) ──────────
        {
            id: 'brick_template', name: '벽돌',
            objectType: 'sprite',
            pictures: [
                assets('brick-red',    { id: 'pic_r' }),
                assets('brick-orange', { id: 'pic_o' }),
                assets('brick-green',  { id: 'pic_g' }),
            ],
            selectedPictureId: 'pic_r',
            entity: {
                x: 0, y: 0,
                regX: 27, regY: 11,    // beveledBrick(50, 18) → 54×22
                scaleX: 1, scaleY: 1,
                rotation: 0, direction: 90,
                width: 54, height: 22,
                visible: false,
            },
            script: [
                // 스폰: 행별 changeShape + 6 클론 × 3 행
                [
                    when.run(),
                    hide(),
                    // 행 0 빨강
                    changeShape('pic_r'),
                    ...spawnRow(0),
                    // 행 1 주황
                    changeShape('pic_o'),
                    ...spawnRow(1),
                    // 행 2 초록
                    changeShape('pic_g'),
                    ...spawnRow(2),
                ],
                // 클론 — show + ball 충돌 시 score+10, deleteClone
                [
                    when.cloneStart(),
                    show(),
                    repeat.inf([
                        if_(reach('ball'), [
                            changeVar('score', 10),
                            changeVar('bricks_left', -1),
                            sendMessage('ball_bounce'),
                            deleteClone(),
                        ]),
                    ]),
                ],
            ],
        },
    ],
};
