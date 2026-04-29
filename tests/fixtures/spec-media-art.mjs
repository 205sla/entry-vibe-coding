// 생김새의 향연 — 17 블록 전부 활용한 미디어 아트.
//
// 3×3 격자에 mascot 봇들을 배치하고, 각 셀이 생김새 블록의 다른 측면을 시연.
// 모든 셀이 동시에 자기 사이클을 돌려서 전체적으로 "호흡하는 조각보" 느낌.
//
// 셀 역할:
//   (TL) 색상 순환                     - addEffect('color')
//   (TM) 밝기 파동 + 좌우 뒤집기        - addEffect('brightness') + flipX
//   (TR) 투명도 파동 + 상하 뒤집기      - setEffect('transparency') + flipY
//   (ML) 모양 순차 + 다음 모양         - nextShape (mascot 4 종 순환)
//   (MC) 종합 — 색·크기·z-order·말풍선  - 모든 블록 + dialog/sayFor/removeDialog
//   (MR) 모양 지정 + 크기 wave         - changeShape(pictureId) + changeSize
//   (BL) 가로 스트레치                  - stretch('WIDTH') + resetSize
//   (BM) 세로 스트레치 + 절대 크기 토글 - stretch('HEIGHT') + setSize / resetSize
//   (BR) 효과 초기화 + 깜빡임           - clearEffects + hide/show
//
// 또한 title (textBox) 가 시 한 줄을 주기적으로 갱신.

import {
    when, repeat, if_, cmp, calc, getVar, setVar, changeVar, wait,
    obj, picture,
    show, hide, addEffect, setEffect, clearEffects,
    changeSize, setSize, stretch, resetSize,
    nextShape, changeShape,
    flipX, flipY, zOrder,
    say, sayFor, removeDialog, writeText,
    rand,
} from '../../tools/lib/spec-dsl.mjs';

const MASCOT = '/images/mascot/bot205-idle.svg';
const HELLO  = '/images/mascot/bot205-hello.svg';
const W1     = '/images/mascot/bot205-walk-1.svg';
const W2     = '/images/mascot/bot205-walk-2.svg';

// mascot 4 종을 가진 picture 배열 — 'next/prev' shape cycling 용.
const allPictures = [
    { id: 'pic_idle',  fileurl: MASCOT, imageType: 'svg', dimension: { width: 200, height: 240 } },
    { id: 'pic_hello', fileurl: HELLO,  imageType: 'svg', dimension: { width: 200, height: 240 } },
    { id: 'pic_w1',    fileurl: W1,     imageType: 'svg', dimension: { width: 200, height: 240 } },
    { id: 'pic_w2',    fileurl: W2,     imageType: 'svg', dimension: { width: 200, height: 240 } },
];

// 모든 셀이 같은 4 모양을 갖도록 함수로 picture 배열 생성.
const makePics = () => allPictures.map(p => ({ ...p }));

// 작은 셀용 entity (3×3 그리드, 셀 크기 ≈ 50×60 px).
const cellEntity = (x, y) => ({
    x, y,
    regX: 100, regY: 120,
    scaleX: 0.25, scaleY: 0.25,
    rotation: 0, direction: 90,
    width: 200, height: 240,
    visible: true,
});

// 셀 헬퍼 — id, name, 위치, 스레드 (1 개 또는 배열) 받아서 obj 생성.
// threads 가 thread 배열 ([[trigger, ...], [trigger, ...]]) 이면 평행 실행.
const cell = (id, name, x, y, threads) => {
    const isMultiThread = Array.isArray(threads[0]) && Array.isArray(threads[0][0]);
    return {
        id, name,
        objectType: 'sprite',
        pictures: makePics(),
        selectedPictureId: 'pic_idle',
        entity: cellEntity(x, y),
        script: isMultiThread ? threads : [threads],
    };
};

export default {
    name: '생김새의 향연 (미디어 아트)',
    variables: [
        // 셀마다 각자의 카운터 — 공유 t 는 race 발생.
        { id: 't_tr', name: 't_투명파동', value: '0', visible: false },
        { id: 't_mc', name: 't_종합',     value: '0', visible: false },
        { id: 't_mr', name: 't_모양지정', value: '0', visible: false },
        { id: 't_bl', name: 't_가로',     value: '0', visible: false },
        { id: 't_bm', name: 't_세로',     value: '0', visible: false },
        { id: 't_br', name: 't_깜빡임',   value: '0', visible: false },
    ],
    objects: [
        // ── 타이틀 (textBox) — text_write 로 시 한 줄을 주기적 갱신 ──────
        {
            id: 'title', name: '제목',
            objectType: 'textBox',
            text: '생김새의 향연',
            entity: {
                x: 0, y: 110,
                regX: 0, regY: 0,
                scaleX: 1, scaleY: 1,
                rotation: 0, direction: 90,
                width: 320, height: 30,
                font: '20px NanumGothic',
                colour: '#1f2937',
                bgColor: '#fef3c7',
                lineBreak: true,
                textAlign: 1,
                visible: true,
            },
            script: [[
                when.run(),
                repeat.inf([
                    writeText('  생김새의 향연  '),
                    wait(2),
                    writeText('  색은 노래하고 모양은 춤춘다  '),
                    wait(2),
                    writeText('  17 가지 표정으로  '),
                    wait(2),
                    writeText('  하나의 그림이 된다  '),
                    wait(2),
                ]),
            ]],
        },

        // ── (TL) 색상 순환 ────────────────────────────────────────────
        cell('cell_tl', '색순환', -130, 60, [
            when.run(),
            repeat.inf([
                addEffect('color', 3),
                wait(0.05),
            ]),
        ]),

        // ── (TM) 밝기 파동 + 주기적 좌우 뒤집기 (두 스레드 평행) ───────
        cell('cell_tm', '밝기파동', 0, 60, [
            // 스레드 #1: 밝기 파동
            [
                when.run(),
                repeat.inf([
                    addEffect('brightness', 2),
                    wait(0.04),
                    addEffect('brightness', -2),
                    wait(0.04),
                ]),
            ],
            // 스레드 #2: 1.5 초마다 flipX
            [
                when.run(),
                repeat.inf([
                    wait(1.5),
                    flipX(),
                ]),
            ],
        ]),

        // ── (TR) 투명도 파동 + 상하 뒤집기 (한 오브젝트에서 두 사이클 평행) ──
        cell('cell_tr', '투명파동', 130, 60, [
            when.run(),
            // 투명도 0~50 사이 톱니파
            setVar('t_tr', 0),
            repeat.inf([
                if_(cmp(getVar('t_tr'), '<', 50), [
                    setEffect('transparency', getVar('t_tr')),
                    changeVar('t_tr', 2),
                ]),
                if_(cmp(getVar('t_tr'), '>=', 50), [
                    setVar('t_tr', 0),
                    flipY(),  // 한 사이클마다 상하 뒤집기
                ]),
                wait(0.05),
            ]),
        ]),

        // ── (ML) 모양 다음 (4 picture 순환) ───────────────────────────
        cell('cell_ml', '모양순환', -130, 0, [
            when.run(),
            repeat.inf([
                wait(0.4),
                nextShape(),
            ]),
        ]),

        // ── (MC) 종합 — 색 + 크기 + z-order + 말풍선 ──────────────────
        cell('cell_mc', '종합', 0, 0, [
            when.run(),
            // 살짝 크게 시작
            setSize(120),
            // 종합 사이클
            repeat.inf([
                addEffect('color', 5),
                changeSize(2),
                wait(0.06),
                addEffect('color', 5),
                changeSize(-2),
                wait(0.06),
                // 30 사이클마다 z-order + 말풍선 + flip
                changeVar('t_mc', 1),
                if_(cmp(getVar('t_mc'), '>=', 30), [
                    setVar('t_mc', 0),
                    zOrder('FRONT'),
                    sayFor('생김새', 1),
                    zOrder('BACK'),
                    sayFor('의 향연', 1),
                    say('17 가지 모습'),
                    wait(1),
                    removeDialog(),
                    flipX(),
                ]),
            ]),
        ]),

        // ── (MR) 모양 지정 + 크기 wave ────────────────────────────────
        cell('cell_mr', '모양지정', 130, 0, [
            when.run(),
            setVar('t_mr', 0),
            repeat.inf([
                changeVar('t_mr', 1),
                if_(cmp(calc(getVar('t_mr'), '%', 4), '==', 0), [ changeShape('pic_idle') ]),
                if_(cmp(calc(getVar('t_mr'), '%', 4), '==', 1), [ changeShape('pic_hello') ]),
                if_(cmp(calc(getVar('t_mr'), '%', 4), '==', 2), [ changeShape('pic_w1') ]),
                if_(cmp(calc(getVar('t_mr'), '%', 4), '==', 3), [ changeShape('pic_w2') ]),
                changeSize(rand(-3, 3)),
                wait(0.4),
            ]),
        ]),

        // ── (BL) 가로 스트레치 ────────────────────────────────────────
        cell('cell_bl', '가로스트레치', -130, -60, [
            when.run(),
            repeat.inf([
                stretch('WIDTH', 3),
                wait(0.05),
                stretch('WIDTH', -3),
                wait(0.05),
                // 30 사이클마다 reset
                changeVar('t_bl', 1),
                if_(cmp(calc(getVar('t_bl'), '%', 30), '==', 0), [
                    resetSize(),
                ]),
            ]),
        ]),

        // ── (BM) 세로 스트레치 + 절대 크기 토글 ───────────────────────
        cell('cell_bm', '세로스트레치', 0, -60, [
            when.run(),
            setVar('t_bm', 0),
            repeat.inf([
                changeVar('t_bm', 1),
                stretch('HEIGHT', 4),
                wait(0.06),
                stretch('HEIGHT', -4),
                wait(0.06),
                // 주기마다 setSize 그리고 resetSize
                if_(cmp(calc(getVar('t_bm'), '%', 40), '==', 0), [ setSize(150) ]),
                if_(cmp(calc(getVar('t_bm'), '%', 40), '==', 20), [ resetSize() ]),
            ]),
        ]),

        // ── (BR) 효과 초기화 + 깜빡임 + prev/next 반대 방향 ──────────
        cell('cell_br', '깜빡임', 130, -60, [
            when.run(),
            // sub-cycle 1: 밝기/색을 점차 늘렸다가 erase_all_effects 로 초기화
            repeat.inf([
                addEffect('color', 7),
                addEffect('brightness', 3),
                wait(0.1),
                changeVar('t_br', 1),
                // 5 사이클마다 깜빡임
                if_(cmp(calc(getVar('t_br'), '%', 10), '==', 5), [
                    hide(),
                    wait(0.15),
                    show(),
                ]),
                // 25 사이클마다 모든 효과 초기화
                if_(cmp(calc(getVar('t_br'), '%', 25), '==', 0), [
                    clearEffects(),
                ]),
            ]),
        ]),
    ],
};
