// 1 : 1 온라인 게임 매칭 UI — 부드러운 애니메이션 + 화면 전환 효과 데모.
//
// 첨부 레퍼런스("Bouncy Ball") 의 톤 = 하늘색 그라데이션 + 둥근 도형 + 통통 튀는 공.
// 실제 매칭/네트워크는 동작하지 않는다 — "매칭되는 느낌" 의 연출(애니메이션)만 구현.
//
// 장면 구성 (scenes 배열 순서 = 실행 순서)
//   1) start  — 기본 오브젝트(통통 튀는 공) 하나. 클릭하면 페이드 전환 → match.
//   2) match  — 장면 시작 시 "매칭 중…" → Q 키 누르면 "방에 들어가는 중…" →
//               잠시 후 "매칭 완료!" → 페이드 전환 → game.
//   3) game   — 3판 2선승. [나의 승리]/[상대 승리] 로 점수 누적, 누군가 2승 → 결과로 전환.
//               [상대가 떠남] = 다른 코드 잠금(locked) + 반투명 막으로 뒤 흐리게 → 안내 → 부전승 결과.
//   4) result — 승리/패배 + 점수 표시. 승리 시 컨페티 배경 효과. [다시 하기] → start 로 복귀(루프).
//
// 재시작 루프 때문에 start 장면은 **dualStart**(when_run + when_scene_start) — ▶ 와 재진입 양쪽 대응.
//
// 화면 전환 효과 — ★ 캐주얼 게임 스타일 "슬라이드 와이프" 버전 ★
//   (기본 흰색 페이드 버전은 spec.mjs / online-match_007.ent 로 따로 보존)
//   컬러풀한 패널(주황→핑크 + 물방울)이 오른쪽에서 탄성 있게 들어와 화면을 덮고(cover),
//   다음 장면에서 왼쪽으로 쓸려 나가며 드러낸다(reveal) → 전체적으로 좌측으로 넘기는 "페이지 전환".
//   glideTo(locate_xy_time) 는 프레임 보간이라 움직임이 매끄럽고, cover 끝에 살짝 오버슈트로 탄성을 준다.
//
// 상태 머신 — match 장면은 변수 `phase` 로 단계 구동
//   phase 0 = 매칭 중(검색) · 1 = 방 입장 중 · 2 = 완료
//   Q 키 핸들러가 0→1 로 올리고, 상태 매니저(status) 가 적절한 시점에 1→2 로 올린 뒤 전환.

import {
    when, repeat, if_, cmp, calc, getVar, setVar, changeVar, wait, stopRepeat,
    show, hide, zOrder, setEffect, addEffect,
    setSize, changeSize, moveY, moveX, locateXY, glideTo, rotateRel, coord, changeShape,
    say, writeText, combine, rand,
    createClone, deleteClone, removeAllClones,
    startScene, sendMessage,
    obj, scene as makeScene,
} from '../../tools/lib/spec-dsl.mjs';
import { circle, ring, rect, shadedBall } from '../../tools/lib/sprite-gen.mjs';


// ── 풀스크린 배경 그림(커스텀 그라데이션 SVG) ─────────────────────
// gen 출력과 같은 모양 { svgString, dimension, imageType } → make-ent 가 그대로 번들.
const bgPic = (svgString) => ({
    svgString, dimension: { width: 480, height: 270 }, imageType: 'svg',
});

// 하늘색 그라데이션 + 부드러운 흰 구름 (start / match 공용 무드)
const SKY = bgPic(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270" width="480" height="270">` +
    `<defs>` +
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#8fd4ff"/>` +
    `<stop offset="0.55" stop-color="#c6ecff"/>` +
    `<stop offset="1" stop-color="#edfaff"/>` +
    `</linearGradient>` +
    `<radialGradient id="glow" cx="0.5" cy="0.30" r="0.7">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/>` +
    `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="480" height="270" fill="url(#sky)"/>` +
    `<rect width="480" height="270" fill="url(#glow)"/>` +
    `<g fill="#ffffff" opacity="0.65">` +
    `<ellipse cx="92" cy="214" rx="62" ry="22"/>` +
    `<ellipse cx="150" cy="230" rx="74" ry="24"/>` +
    `<ellipse cx="384" cy="56" rx="54" ry="19"/>` +
    `<ellipse cx="422" cy="70" rx="44" ry="17"/>` +
    `</g>` +
    `</svg>`
);

// 1 : 1 대전 "경기장" — 중앙선 + 센터서클 (game 장면, 하늘색과 확실히 다른 톤)
const ARENA = bgPic(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270" width="480" height="270">` +
    `<defs>` +
    `<linearGradient id="fld" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#b9f0d6"/>` +
    `<stop offset="1" stop-color="#93e3c4"/>` +
    `</linearGradient>` +
    `</defs>` +
    `<rect width="480" height="270" fill="url(#fld)"/>` +
    `<rect x="236" y="0" width="8" height="270" fill="#ffffff" opacity="0.5"/>` +
    `<circle cx="240" cy="135" r="48" fill="none" stroke="#ffffff" stroke-width="6" opacity="0.5"/>` +
    `<circle cx="240" cy="135" r="7" fill="#ffffff" opacity="0.7"/>` +
    `</svg>`
);

// 결과 배경 — 따뜻한 축하 무드(가운데 밝은 골드 방사형). 패배 시 lose_tint 로 차갑게 덮음.
const RESULT_BG = bgPic(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270" width="480" height="270">` +
    `<defs>` +
    `<radialGradient id="rg" cx="0.5" cy="0.4" r="0.78">` +
    `<stop offset="0" stop-color="#fffdf4"/>` +
    `<stop offset="0.55" stop-color="#fff0c9"/>` +
    `<stop offset="1" stop-color="#ffdf9e"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="480" height="270" fill="url(#rg)"/>` +
    `</svg>`
);

// 페이드용 풀스크린 흰색 사각형 (현재 캐주얼 버전에선 미사용 — 페이드 버전 spec.mjs 와 공유 구조)
const WHITE = rect(480, 270, '#ffffff');

// 캐주얼 전환 패널 — 화면(480×270)보다 크게(500×280) 만들어 슬라이드 도중 빈틈이 없게.
// 주황→핑크 그라데이션 + 반투명 물방울(Bouncy Ball 톤).
const PANEL = {
    svgString:
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 280" width="500" height="280">` +
        `<defs><linearGradient id="pnl" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="#ff9e57"/>` +
        `<stop offset="1" stop-color="#ff5e8a"/>` +
        `</linearGradient></defs>` +
        `<rect width="500" height="280" fill="url(#pnl)"/>` +
        `<g fill="#ffffff" opacity="0.16">` +
        `<circle cx="86" cy="70" r="46"/><circle cx="420" cy="214" r="62"/>` +
        `<circle cx="250" cy="150" r="30"/><circle cx="150" cy="232" r="26"/>` +
        `<circle cx="436" cy="58" r="22"/></g></svg>`,
    dimension: { width: 500, height: 280 }, imageType: 'svg',
};

// 컨페티 한 조각 — 색별 picture(id 로 changeShape 선택).
const cfPic = (hex, id) => ({ ...rect(11, 7, hex, { rx: 2 }), id, name: id });


// ── 헬퍼 ──────────────────────────────────────────────────────────

// 풀스크린 배경(scaleX/Y=1 이어야 480px 폭 그대로 렌더). 항상 맨 뒤로.
// onStarts: 트리거 팩토리 배열. 초기 장면은 [when.run, when.sceneStart](dualStart),
// startScene 으로 진입하는 장면은 [when.sceneStart].
const background = (id, scene, pic, onStarts = [when.sceneStart]) => obj(id, '배경', {
    scene, picture: pic,
    entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, direction: 90 },
    threads: onStarts.map((trig) => [ trig(), zOrder('BACK') ]),
});

// textBox 엔티티 — (x,y) 가 텍스트 '중심'.
// ⚠️ 엔진 상수: TEXT_ALIGN_CENTER=0 / LEFT=1 / RIGHT=2 (직관과 반대 — 0 이 가운데!).
//    center 정렬은 textObject.x=0(엔티티 로컬 원점에 중앙배치) → regX:0 이면 stage x 에 중앙정렬.
//    lineBreak:true 로 width 자동축소를 막아 안정적인 박스를 유지한다.
const tbox = (x, y, w, h, fontPx, colour, align = 0) => ({
    x, y, regX: 0, regY: 0, scaleX: 1, scaleY: 1, rotation: 0, direction: 90,
    width: w, height: h, font: `${fontPx}px NanumGothic`, colour, textAlign: align,
    lineBreak: true, visible: true,
});

// 슬라이드 와이프 전환 오버레이(캐주얼).
//   reveal: 패널이 화면을 덮은 채(x=0) → 왼쪽(x=-520)으로 쓸려 나가며 드러냄 → 숨김
//   cover : leaveMsg 수신 시 오른쪽 밖(x=520) → 화면(x=0)으로 탄성 있게 덮고 → nextScene 이동
// ★ z-order 는 코드가 아니라 리스트 순서로: export 의 faderFirst() 가 페이더를 맨 앞(인덱스 0)에 두고,
//   초기 entity visible:true + x:0(덮은 위치) → 진입 첫 프레임부터 덮인 상태(깜빡임 제거). reveal 은 zOrder 불필요.
//   cover 는 opp_left 로 앞에 온 막 위를 덮어야 하므로 zOrder('FRONT') 유지.
// leaves: [[message, nextScene], ...] — 한 장면이 여러 목적지로 나갈 수 있다(예: game→mid/result).
const fader = (id, scene, leaves = [], onStarts = [when.sceneStart]) => {
    const threads = onStarts.map((trig) => [
        trig(),
        show(),                          // 맨 앞은 리스트 순서로 보장 → zOrder 불필요
        locateXY(0, 0),                  // 화면 덮은 상태에서 시작
        glideTo(0.32, -520, 0),          // 왼쪽으로 쓸려 나가며 새 장면 드러냄
        hide(),                          // 클릭 막지 않도록 숨김
    ]);
    for (const [leaveMsg, nextScene] of leaves) {
        threads.push([
            when.message(leaveMsg),
            show(), zOrder('FRONT'),     // 떠날 때만: 런타임에 앞으로 온 막 위로 덮기
            locateXY(520, 0),            // 오른쪽 화면 밖에서
            glideTo(0.26, -12, 0),       // 살짝 지나치게 덮고(탄성 오버슈트)
            glideTo(0.08, 0, 0),         // 정확히 정착 → 전환
            startScene(nextScene),
        ]);
    }
    return obj(id, '전환', {
        scene, picture: PANEL,
        // visible:true + x:0 → 진입 첫 프레임부터 덮은 상태(초기값으로 맨 앞·보임).
        entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, direction: 90, visible: true },
        threads,
    });
};

// 각 장면의 마지막 요소(=페이더)를 맨 앞으로 → 리스트 순서만으로 화면 최상단(코드 없이 초기값).
const faderFirst = (arr) => [arr[arr.length - 1], ...arr.slice(0, -1)];
// 결과 장면: 페이더는 맨 앞, lose_tint(인덱스 1)는 맨 뒤(=다시하기 버튼 뒤)로 보내 클릭 가림 해소.
const reorderResult = (arr) => [arr[arr.length - 1], arr[0], ...arr.slice(2, -1), arr[1]];

// 초기 장면용 이중 트리거 — ▶(when_run) 과 재진입(when_scene_start) 양쪽에서 깨운다.
// 같은 활성화엔 둘 중 하나만 발화(초기=run, 재진입=scene_start)하므로 중복 실행 없음.
const dualStart = (makeBody) => [
    [ when.run(), ...makeBody() ],
    [ when.sceneStart(), ...makeBody() ],
];

// bgColor 글상자 버튼 — 사각 전체가 클릭 영역(투명 글리프 hit 문제 없음). 한 오브젝트로 라벨+클릭.
// 등장: 아래에서 슬라이드 인(delay 스태거). 위치 애니메이션만 써서 글상자에 안전.
const button = (scene, id, label, x, y, w, h, bg, fg, delay, onClick) => obj(id, label, {
    scene, objectType: 'textBox', text: label,
    entity: { ...tbox(x, y, w, h, 19, fg, 0), bgColor: bg },
    threads: [
        [ when.sceneStart(), hide(), locateXY(x, y - 300), wait(delay), show(), glideTo(0.32, x, y) ],
        [ when.objectClick(), ...onClick ],
    ],
});

// 점수 문자열 "나      X      :      Y      상대"
const scoreText = () => combine(
    combine(combine(combine('나      ', getVar('my_score')), '      :      '), getVar('opp_score')),
    '      상대');


// ════════════════════════════════════════════════════════════════
// 1) START 장면 — 기본 오브젝트 하나(통통 튀는 공) + 클릭 → 전환
// ════════════════════════════════════════════════════════════════

const startObjects = [
    // ⚠️ 초기 장면 = ▶(when_run) 로 시작하지만, 결과창 [다시 하기] 로 startScene 재진입도 되므로
    //    dualStart(run + scene_start) 로 양쪽 대응. (when_scene_start 단독은 ▶ 첫 장면에서 안 깸)
    background('start_bg', 'start', SKY, [when.run, when.sceneStart]),

    obj('start_ball', '시작 공', {
        scene: 'start',
        picture: shadedBall(34, '#ffd23f'),                     // 노란 통통 공
        entity: { x: 0, y: 8, scaleX: 1.25, scaleY: 1.25, direction: 90 },
        threads: [
            // 안내 말풍선 (계속 표시)
            ...dualStart(() => [ say('클릭하면 1 : 1 대전 시작!') ]),
            // 통통 튀는 바운스 — glide 로 부드럽게 위/아래
            ...dualStart(() => [
                repeat.inf([
                    glideTo(0.5, 0, -16),   // 낙하
                    glideTo(0.4, 0, 30),    // 튀어오름
                ]),
            ]),
            // 클릭 → 매칭 장면으로 페이드 전환 요청
            [ when.objectClick(), sendMessage('to_match') ],
        ],
    }),

    fader('start_fader', 'start', [['to_match', 'match']], [when.run, when.sceneStart]),
];


// ════════════════════════════════════════════════════════════════
// 2) MATCH 장면 — 매칭 중 → (Q) 방 입장 중 → 완료 → 전환
// ════════════════════════════════════════════════════════════════

const PX = -112, OPX = 112, BY = 8;   // 좌(나) / 우(상대) 공 위치, 공통 y

const matchObjects = [
    background('match_bg', 'match', SKY),

    // 제목
    obj('match_title', '제목', {
        scene: 'match', objectType: 'textBox',
        text: '1 : 1 온라인 대전',
        entity: tbox(0, 112, 380, 38, 26, '#15507f'),
        script: [ when.sceneStart() ],
    }),

    // 내 공 (왼쪽) — 매칭되는 동안 잔잔히 호흡(pulse), 완료 시 환호 점프
    obj('player_ball', '나', {
        scene: 'match',
        picture: shadedBall(32, '#ffd23f'),
        entity: { x: PX, y: BY, scaleX: 1.2, scaleY: 1.2, direction: 90 },
        threads: [
            [
                when.sceneStart(),
                repeat.inf([
                    if_(cmp(getVar('phase'), '>=', 2), [ stopRepeat() ]),  // 완료되면 호흡 종료
                    repeat.basic(12, [ changeSize(0.7),  wait(0.012) ]),   // 살짝 커짐
                    repeat.basic(12, [ changeSize(-0.7), wait(0.012) ]),   // 원래대로
                ]),
                // phase 2 — 환호 더블 점프
                repeat.basic(2, [
                    repeat.basic(9, [ moveY(3),  wait(0.008) ]),
                    repeat.basic(9, [ moveY(-3), wait(0.008) ]),
                ]),
            ],
        ],
    }),
    obj('player_label', '나 라벨', {
        scene: 'match', objectType: 'textBox',
        text: '나',
        entity: tbox(PX, -54, 120, 28, 18, '#2b3a55'),
        script: [ when.sceneStart() ],
    }),

    // 상대 슬롯 "?" — 검색 중 표시(상대 미정). phase≥1 에 숨김.
    // ⚠️ 글상자는 투명도 효과 불가(엔진이 alpha undefined 로 정지) → 색/show·hide 로만 연출.
    obj('opp_q', '상대 물음표', {
        scene: 'match', objectType: 'textBox',
        text: '?',
        entity: tbox(OPX, 6, 100, 64, 56, '#9bb0bf'),
        threads: [
            [
                when.sceneStart(),
                show(),
                repeat.inf([
                    if_(cmp(getVar('phase'), '>=', 1), [ hide(), stopRepeat() ]),
                    wait(0.1),
                ]),
            ],
        ],
    }),

    // 검색 레이더 — 상대 슬롯에서 퍼져나가며 사라지는 링(매칭 중 느낌의 핵심)
    obj('search_ring', '레이더', {
        scene: 'match',
        picture: ring(26, 21, '#ffffff'),
        entity: { x: OPX, y: BY, scaleX: 1, scaleY: 1, direction: 90 },
        threads: [
            [
                when.sceneStart(),
                repeat.inf([
                    if_(cmp(getVar('phase'), '>=', 1), [ hide(), stopRepeat() ]),
                    show(), locateXY(OPX, BY),
                    setSize(34), setEffect('transparency', 10),
                    // 커지면서 점점 투명 → 퍼져나가는 파동
                    repeat.basic(20, [ changeSize(4.5), addEffect('transparency', 4.5), wait(0.012) ]),
                ]),
            ],
        ],
    }),

    // 상대 공 (오른쪽) — phase≥1 에 오른쪽에서 슬라이드 인 + 착지 바운스, 완료 시 점프
    obj('opp_ball', '상대', {
        scene: 'match',
        picture: shadedBall(32, '#4dabf7'),                    // 파란 공
        entity: { x: 300, y: BY, scaleX: 1.2, scaleY: 1.2, direction: 90 },
        threads: [
            [
                when.sceneStart(),
                hide(),
                locateXY(300, BY),                              // 화면 밖 오른쪽
                // phase 1 대기
                repeat.inf([ if_(cmp(getVar('phase'), '>=', 1), [ stopRepeat() ]) ]),
                show(),
                setEffect('transparency', 0),
                glideTo(0.4, OPX, BY + 18),                     // 슬라이드 인(살짝 위로)
                glideTo(0.12, OPX, BY),                         // 착지
                glideTo(0.09, OPX, BY + 9),                     // 작은 반동
                glideTo(0.09, OPX, BY),                         // 정착
                // phase 2 — 환호 점프
                repeat.inf([ if_(cmp(getVar('phase'), '>=', 2), [ stopRepeat() ]) ]),
                repeat.basic(2, [
                    repeat.basic(9, [ moveY(3),  wait(0.008) ]),
                    repeat.basic(9, [ moveY(-3), wait(0.008) ]),
                ]),
            ],
        ],
    }),
    obj('opp_label', '상대 라벨', {
        scene: 'match', objectType: 'textBox',
        text: '상대',
        entity: tbox(OPX, -54, 120, 28, 18, '#2b3a55'),
        script: [ when.sceneStart() ],
    }),

    // VS 뱃지 — phase≥1 에 가운데서 팝(overshoot) 으로 등장
    obj('vs_badge', 'VS 뱃지', {
        scene: 'match',
        picture: circle(26, '#ff922b', { stroke: '#ffffff', strokeWidth: 4 }),
        entity: { x: 0, y: BY, scaleX: 1, scaleY: 1, direction: 90 },
        threads: [
            [
                when.sceneStart(),
                hide(),
                repeat.inf([ if_(cmp(getVar('phase'), '>=', 1), [ stopRepeat() ]) ]),
                setSize(8), show(), zOrder('FRONT'),
                repeat.basic(11, [ changeSize(6),  wait(0.012) ]),   // 팝
                repeat.basic(5,  [ changeSize(-3), wait(0.012) ]),   // overshoot 정착
            ],
        ],
    }),
    obj('vs_text', 'VS 글자', {
        scene: 'match', objectType: 'textBox',
        text: 'VS',
        entity: tbox(0, BY, 64, 28, 20, '#ffffff'),
        threads: [
            [
                when.sceneStart(),
                hide(),
                repeat.inf([ if_(cmp(getVar('phase'), '>=', 1), [ stopRepeat() ]) ]),
                show(), zOrder('FRONT'),
            ],
        ],
    }),

    // 로딩 점 3개 (레퍼런스의 노랑/연두 공) — 검색 중 순차 바운스, phase≥1 에 숨김
    ...[
        { id: 'dot1', x: -26, c: '#ffd23f', d: 0.0  },
        { id: 'dot2', x: 0,   c: '#b2e36b', d: 0.13 },
        { id: 'dot3', x: 26,  c: '#d7e8a8', d: 0.26 },
    ].map(({ id, x, c, d }) => obj(id, '점', {
        scene: 'match',
        picture: shadedBall(7, c),
        entity: { x, y: -56, scaleX: 1, scaleY: 1, direction: 90 },
        threads: [
            [
                when.sceneStart(),
                locateXY(x, -56),
                wait(d),                                        // 스태거(시간차)
                repeat.inf([
                    if_(cmp(getVar('phase'), '>=', 1), [ hide(), stopRepeat() ]),
                    repeat.basic(7, [ moveY(2),  wait(0.008) ]),
                    repeat.basic(7, [ moveY(-2), wait(0.008) ]),
                    wait(0.12),
                ]),
            ],
        ],
    })),

    // Q 안내 — 검색 중에만 깜빡(아케이드 PRESS START 식), phase≥1 에 숨김
    // ⚠️ 글상자는 투명도 효과 불가 → show/hide 로 깜빡임 연출.
    obj('hint', 'Q 안내', {
        scene: 'match', objectType: 'textBox',
        text: 'Q 키를 누르면 방에 입장합니다',
        entity: tbox(0, -120, 420, 26, 15, '#5a7a99'),
        threads: [
            [
                when.sceneStart(),
                repeat.inf([
                    if_(cmp(getVar('phase'), '>=', 1), [ hide(), stopRepeat() ]),
                    show(), wait(0.55),
                    hide(), wait(0.4),
                ]),
            ],
        ],
    }),

    // 상태 매니저(글상자) — 문구 시퀀스 + phase 진행 + 전환 송신 + Q 핸들러
    obj('status', '상태', {
        scene: 'match', objectType: 'textBox',
        text: '매칭 중...',
        entity: tbox(0, -100, 460, 34, 22, '#16324f'),
        threads: [
            [
                when.sceneStart(),
                setVar('phase', 0),
                // 새 경기 시작 — 점수/상태 초기화(여기서만; game 재진입 땐 점수 보존)
                setVar('my_score', 0), setVar('opp_score', 0),
                setVar('locked', 0), setVar('result', 0), setVar('forfeit', 0),
                // phase 0 — "매칭 중" 점 애니메이션 (Q 누를 때까지)
                repeat.inf([
                    if_(cmp(getVar('phase'), '>', 0), [ stopRepeat() ]),
                    writeText('매칭 중'),       wait(0.3),
                    if_(cmp(getVar('phase'), '>', 0), [ stopRepeat() ]),
                    writeText('매칭 중 .'),     wait(0.3),
                    if_(cmp(getVar('phase'), '>', 0), [ stopRepeat() ]),
                    writeText('매칭 중 . .'),   wait(0.3),
                    if_(cmp(getVar('phase'), '>', 0), [ stopRepeat() ]),
                    writeText('매칭 중 . . .'), wait(0.3),
                ]),
                // phase 1 — 상대 발견 + 방 입장 중
                writeText('상대를 찾았어요!'), wait(0.7),
                repeat.basic(3, [
                    writeText('방에 들어가는 중 .'),     wait(0.22),
                    writeText('방에 들어가는 중 . .'),   wait(0.22),
                    writeText('방에 들어가는 중 . . .'), wait(0.22),
                ]),
                // phase 2 — 완료 → 게임 장면으로 전환
                setVar('phase', 2),
                writeText('매칭 완료!'),
                wait(1.1),
                sendMessage('to_game'),
            ],
            // Q 키 — 매칭 중일 때만 0→1
            [
                when.keyPressed('81'),
                if_(cmp(getVar('phase'), '==', 0), [ setVar('phase', 1) ]),
            ],
        ],
    }),

    fader('match_fader', 'match', [['to_game', 'game']]),
];


// ════════════════════════════════════════════════════════════════
// 3) GAME 장면 — 3판 2선승. 승부 버튼 3개 + 상대 이탈(반투명 막) 처리.
// ════════════════════════════════════════════════════════════════

const gameObjects = [
    background('game_bg', 'game', ARENA),

    // 배경 효과 — 점수 뒤 부드럽게 호흡하는 후광(스프라이트라 투명도/크기 안전).
    obj('game_glow', '후광', {
        scene: 'game', picture: ring(76, 60, '#ffffff'),
        entity: { x: 0, y: 50, scaleX: 1, scaleY: 1, direction: 90 },
        threads: [[
            when.sceneStart(),
            setEffect('transparency', 74),
            repeat.inf([
                repeat.basic(22, [ changeSize(0.7),  wait(0.02) ]),
                repeat.basic(22, [ changeSize(-0.7), wait(0.02) ]),
            ]),
        ]],
    }),

    // 상단 안내 — "게임 시작!" 잠깐 → 규칙 안내로 전환
    obj('game_title', '안내', {
        scene: 'game', objectType: 'textBox',
        text: '게임 시작!',
        entity: tbox(0, 112, 460, 34, 22, '#1f6d4f'),
        threads: [[
            when.sceneStart(),
            writeText('게임 시작!'), wait(1.0),
            writeText('3판 2선승 · 승부를 선택하세요'),
        ]],
    }),

    // 점수판 — 점수는 보존(라운드 누적), 진입 시 버튼만 재활성(locked=0) + 매 프레임 갱신
    obj('game_score', '점수', {
        scene: 'game', objectType: 'textBox',
        text: '나      0      :      0      상대',
        entity: tbox(0, 56, 470, 42, 30, '#16324f'),
        threads: [[
            when.sceneStart(),
            setVar('locked', 0),
            repeat.inf([ writeText(scoreText()), wait(0.1) ]),
        ]],
    }),

    // ── 승부 버튼 3개 (locked 면 무시 = "다른 모든 코드 비활성화") ──
    // 라운드 승패 → 점수 +1 후 중간결과창으로. 2승 여부 판정은 중간결과창(mid)이 담당.
    button('game', 'btn_win', '나의 승리', 0, 6, 220, 38, '#e7fbef', '#1e7d4f', 0.45, [
        if_(cmp(getVar('locked'), '==', 0), [
            setVar('locked', 1), setVar('last_winner', 1),
            changeVar('my_score', 1),
            sendMessage('to_mid'),
        ]),
    ]),
    button('game', 'btn_lose', '상대 승리', 0, -42, 220, 38, '#eef3ff', '#2f5fa8', 0.58, [
        if_(cmp(getVar('locked'), '==', 0), [
            setVar('locked', 1), setVar('last_winner', 2),
            changeVar('opp_score', 1),
            sendMessage('to_mid'),
        ]),
    ]),
    button('game', 'btn_leave', '상대가 떠남', 0, -90, 220, 38, '#ffeded', '#c0392b', 0.71, [
        if_(cmp(getVar('locked'), '==', 0), [
            setVar('locked', 1), setVar('result', 1), setVar('forfeit', 1),  // 부전승
            sendMessage('opp_left'),
        ]),
    ]),

    // 반투명 막 — 상대 이탈 시 뒤를 흐리게(반투명) 덮어 모든 조작 차단.
    obj('game_veil', '막', {
        scene: 'game', picture: rect(480, 270, '#0e1b2e'),
        entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, direction: 90 },
        threads: [
            [ when.sceneStart(), hide() ],
            [ when.message('opp_left'),
              show(), zOrder('FRONT'),
              setEffect('transparency', 100),                                    // 투명에서
              repeat.basic(18, [ addEffect('transparency', -3.1), wait(0.014) ]), // →~44% (뒤가 흐리게 비침)
            ],
        ],
    }),

    // 이탈 안내 — 막 위로 슬라이드 인 → 잠시 후 결과(승리)로 전환
    obj('game_leave_text', '이탈 안내', {
        scene: 'game', objectType: 'textBox',
        text: '상대가 떠났습니다',
        entity: tbox(0, 10, 440, 52, 30, '#ffffff'),
        threads: [
            [ when.sceneStart(), hide() ],
            [ when.message('opp_left'),
              wait(0.35),                                       // 막이 먼저 깔린 뒤
              show(), zOrder('FRONT'),
              locateXY(0, 64), glideTo(0.3, 0, 12), glideTo(0.12, 0, 20), glideTo(0.1, 0, 12),
              wait(1.3),
              sendMessage('to_result'),
            ],
        ],
    }),

    fader('game_fader', 'game', [['to_mid', 'mid'], ['to_result', 'result']]),
];


// ════════════════════════════════════════════════════════════════
// 3-b) MID 장면 — 라운드 중간 결과: 점수 +1(숫자 틱 + 블럭 쌓임) → 게임/최종결과
// ════════════════════════════════════════════════════════════════

const MX = -86, OPMX = 86;   // 좌(나)/우(상대) 칼럼 x

// 스택 블럭 한 칸 — k 번째(아래 1, 위 2). score≥k 면 보임, 이번에 새로 쌓인 칸은 위에서 떨어짐.
// 점수는 game 버튼이 이미 증가시킨 뒤 진입하므로, score(승자측) == 새 블럭의 index.
const midBlock = (id, side, k, x, y, fill) => {
    const sideId = side === 'my' ? 1 : 2;
    const scoreVar = side === 'my' ? 'my_score' : 'opp_score';
    return obj(id, '블럭', {
        scene: 'mid', picture: rect(72, 24, fill, { rx: 6 }),
        entity: { x, y, scaleX: 1, scaleY: 1, direction: 90 },
        threads: [[
            when.sceneStart(),
            hide(),
            if_(cmp(getVar(scoreVar), '>=', k), [
                show(), locateXY(x, y),                          // 이미 쌓인 칸 = 제자리
                if_(cmp(getVar('last_winner'), '==', sideId), [
                    if_(cmp(getVar(scoreVar), '==', k), [        // 이번에 새로 쌓인 칸 = 낙하 + 바운스
                        locateXY(x, 150),
                        glideTo(0.3, x, y + 9),
                        glideTo(0.1, x, y - 4),
                        glideTo(0.08, x, y),
                    ]),
                ]),
            ]),
        ]],
    });
};

const midObjects = [
    background('mid_bg', 'mid', SKY),

    obj('mid_title', '라운드 결과', {
        scene: 'mid', objectType: 'textBox', text: '라운드 결과',
        entity: tbox(0, 116, 460, 34, 24, '#15507f'),
        threads: [[
            when.sceneStart(),
            if_(cmp(getVar('last_winner'), '==', 1),
                [ writeText('나의 라운드 승리!') ],
                [ writeText('상대의 라운드 승리!') ]),
        ]],
    }),

    obj('mid_my_label', '나 라벨', {
        scene: 'mid', objectType: 'textBox', text: '나',
        entity: tbox(MX, 94, 120, 26, 18, '#1e7d4f'),
        script: [ when.sceneStart() ],
    }),
    obj('mid_opp_label', '상대 라벨', {
        scene: 'mid', objectType: 'textBox', text: '상대',
        entity: tbox(OPMX, 94, 120, 26, 18, '#2f5fa8'),
        script: [ when.sceneStart() ],
    }),

    // 숫자 — 승자 쪽은 (점수-1)→점수 로 틱 + 살짝 튕김
    obj('mid_my_num', '내 점수', {
        scene: 'mid', objectType: 'textBox', text: '0',
        entity: tbox(MX, 46, 120, 56, 44, '#1e7d4f'),
        threads: [[
            when.sceneStart(),
            writeText(getVar('my_score')),
            if_(cmp(getVar('last_winner'), '==', 1), [
                writeText(calc(getVar('my_score'), '-', 1)),
                wait(0.42),                                       // 블럭 떨어지는 동안
                writeText(getVar('my_score')),                    // +1 틱
                glideTo(0.07, MX, 51), glideTo(0.07, MX, 46),
            ]),
        ]],
    }),
    obj('mid_opp_num', '상대 점수', {
        scene: 'mid', objectType: 'textBox', text: '0',
        entity: tbox(OPMX, 46, 120, 56, 44, '#2f5fa8'),
        threads: [[
            when.sceneStart(),
            writeText(getVar('opp_score')),
            if_(cmp(getVar('last_winner'), '==', 2), [
                writeText(calc(getVar('opp_score'), '-', 1)),
                wait(0.42),
                writeText(getVar('opp_score')),
                glideTo(0.07, OPMX, 51), glideTo(0.07, OPMX, 46),
            ]),
        ]],
    }),

    // 블럭 스택 (최대 2칸)
    midBlock('mid_my_b1',  'my',  1, MX,   -30, '#5bd07d'),
    midBlock('mid_my_b2',  'my',  2, MX,    -2, '#5bd07d'),
    midBlock('mid_opp_b1', 'opp', 1, OPMX, -30, '#5d9cec'),
    midBlock('mid_opp_b2', 'opp', 2, OPMX,  -2, '#5d9cec'),

    obj('mid_hint', '안내', {
        scene: 'mid', objectType: 'textBox', text: '잠시 후 다음 라운드…',
        entity: tbox(0, -84, 460, 26, 17, '#5a7a99'),
        threads: [[
            when.sceneStart(),
            writeText('잠시 후 다음 라운드…'),
            if_(cmp(getVar('my_score'),  '>=', 2), [ writeText('경기 종료!') ]),
            if_(cmp(getVar('opp_score'), '>=', 2), [ writeText('경기 종료!') ]),
        ]],
    }),

    // 진행 매니저 — 애니메이션 시간 확보 후 2승이면 최종결과로, 아니면 게임으로 복귀
    obj('mid_manager', '진행', {
        scene: 'mid', picture: rect(4, 4, '#ffffff'),
        entity: { x: 0, y: 200, scaleX: 0.5, scaleY: 0.5, direction: 90 },
        threads: [[
            when.sceneStart(),
            hide(),
            wait(1.9),
            if_(cmp(getVar('my_score'), '>=', 2),
                [ setVar('result', 1), sendMessage('mid_to_result') ],
                [ if_(cmp(getVar('opp_score'), '>=', 2),
                    [ setVar('result', 0), sendMessage('mid_to_result') ],
                    [ sendMessage('mid_to_game') ]) ]),
        ]],
    }),

    fader('mid_fader', 'mid', [['mid_to_game', 'game'], ['mid_to_result', 'result']]),
];


// ════════════════════════════════════════════════════════════════
// 4) RESULT 장면 — 승리/패배 + 점수. 승리 시 컨페티 배경 효과. [다시 하기] → start.
// ════════════════════════════════════════════════════════════════

const resultObjects = [
    background('result_bg', 'result', RESULT_BG),

    // 패배 시 차가운 막으로 무드 다운(스프라이트 → 투명도 안전)
    obj('lose_tint', '패배 틴트', {
        scene: 'result', picture: rect(480, 270, '#3a4a63'),
        entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, direction: 90 },
        threads: [[
            when.sceneStart(),
            hide(),
            if_(cmp(getVar('result'), '==', 0), [ show(), setEffect('transparency', 48) ]),
        ]],
    }),

    // 컨페티 발사기 — 승리일 때만 클론 분사(배경 효과)
    obj('confetti_emitter', '컨페티 발사', {
        scene: 'result', picture: rect(4, 4, '#ffffff'),
        entity: { x: 0, y: 200, scaleX: 0.5, scaleY: 0.5, direction: 90 },
        threads: [[
            when.sceneStart(),
            hide(),
            if_(cmp(getVar('result'), '==', 1), [
                wait(0.3),
                repeat.basic(24, [ createClone('confetti'), wait(0.09) ]),
            ]),
        ]],
    }),

    // 컨페티 한 조각 — 클론마다 랜덤 색/회전으로 위에서 낙하 → 화면 밖 삭제
    obj('confetti', '컨페티', {
        scene: 'result',
        pictures: [ cfPic('#ffd23f', 'cf_a'), cfPic('#ff6b9d', 'cf_b'),
                    cfPic('#4dabf7', 'cf_c'), cfPic('#51cf66', 'cf_d') ],
        entity: { x: 0, y: 200, scaleX: 1.3, scaleY: 1.3, direction: 90 },
        threads: [
            [ when.sceneStart(), hide(), removeAllClones() ],
            [ when.cloneStart(),
              show(),
              locateXY(rand(-230, 230), 150),
              rotateRel(rand(0, 359)),
              setVar('cf', rand(1, 4)),                         // 동기 블록이라 클론별 atomic
              if_(cmp(getVar('cf'), '==', 1), [ changeShape('cf_a') ]),
              if_(cmp(getVar('cf'), '==', 2), [ changeShape('cf_b') ]),
              if_(cmp(getVar('cf'), '==', 3), [ changeShape('cf_c') ]),
              if_(cmp(getVar('cf'), '==', 4), [ changeShape('cf_d') ]),
              repeat.inf([
                  moveY(-3.3),
                  moveX(rand(-1, 1)),
                  rotateRel(12),
                  if_(cmp(coord('self', 'y'), '<', -150), [ deleteClone() ]),
              ]),
            ],
        ],
    }),

    // 승리 제목 (골드) — 위에서 슬라이드 인 + 바운스. result==1 일 때만.
    obj('result_win_title', '승리', {
        scene: 'result', objectType: 'textBox',
        text: '승리!',
        entity: tbox(0, 56, 420, 72, 56, '#ff8c00'),
        threads: [[
            when.sceneStart(), hide(),
            if_(cmp(getVar('result'), '==', 1), [
                show(),
                locateXY(0, 150), glideTo(0.32, 0, 50), glideTo(0.12, 0, 64), glideTo(0.1, 0, 56),
            ]),
        ]],
    }),

    // 패배 제목 (블루그레이)
    obj('result_lose_title', '패배', {
        scene: 'result', objectType: 'textBox',
        text: '패배',
        entity: tbox(0, 56, 420, 72, 56, '#5b7fa6'),
        threads: [[
            when.sceneStart(), hide(),
            if_(cmp(getVar('result'), '==', 0), [
                show(),
                locateXY(0, 150), glideTo(0.32, 0, 50), glideTo(0.12, 0, 64), glideTo(0.1, 0, 56),
            ]),
        ]],
    }),

    // 부제 — 부전승/일반승/패배 구분
    obj('result_sub', '부제', {
        scene: 'result', objectType: 'textBox',
        text: '',
        entity: tbox(0, 2, 460, 30, 18, '#6b7a88'),
        threads: [[
            when.sceneStart(),
            if_(cmp(getVar('forfeit'), '==', 1),
                [ writeText('상대가 경기를 떠나 승리했습니다') ],
                [ if_(cmp(getVar('result'), '==', 1),
                    [ writeText('축하합니다! 먼저 2승 달성') ],
                    [ writeText('아쉽네요. 다음 기회에!') ]) ]),
        ]],
    }),

    // 최종 점수
    obj('result_score', '결과 점수', {
        scene: 'result', objectType: 'textBox',
        text: '나      0      :      0      상대',
        entity: tbox(0, -48, 470, 40, 28, '#2b3a55'),
        threads: [[ when.sceneStart(), writeText(scoreText()) ]],
    }),

    // 다시 하기 → 처음(start) 으로 복귀
    button('result', 'replay_btn', '다시 하기', 0, -102, 200, 40, '#ffffff', '#2f5fa8', 0.5, [
        sendMessage('to_start'),
    ]),

    fader('result_fader', 'result', [['to_start', 'start']]),
];


// ── 최종 spec ─────────────────────────────────────────────────────

export default {
    name: '1 : 1 온라인 매칭 UI — 캐주얼 전환',
    scenes: [
        makeScene('start',  '시작'),
        makeScene('match',  '매칭'),
        makeScene('game',   '게임'),
        makeScene('mid',    '중간결과'),
        makeScene('result', '결과'),
    ],
    variables: [
        { id: 'phase',       name: '단계',     value: '0', visible: false },
        { id: 'my_score',    name: '내점수',   value: '0', visible: false },
        { id: 'opp_score',   name: '상대점수', value: '0', visible: false },
        { id: 'last_winner', name: '직전승자', value: '0', visible: false },
        { id: 'result',      name: '결과',     value: '0', visible: false },
        { id: 'locked',      name: '잠금',     value: '0', visible: false },
        { id: 'forfeit',     name: '부전승',   value: '0', visible: false },
        { id: 'cf',          name: 'cf',       value: '0', visible: false },
    ],
    messages: [
        { id: 'to_match',      name: '매칭으로' },
        { id: 'to_game',       name: '게임으로' },
        { id: 'to_mid',        name: '중간결과로' },
        { id: 'mid_to_game',   name: '다음라운드' },
        { id: 'mid_to_result', name: '경기종료' },
        { id: 'to_result',     name: '결과로' },
        { id: 'to_start',      name: '처음으로' },
        { id: 'opp_left',      name: '상대이탈' },
    ],
    objects: [
        // 페이더를 각 장면 맨 앞(화면 최상단)으로 — 리스트 순서로 z 결정(코드 없이).
        ...faderFirst(startObjects),
        ...faderFirst(matchObjects),
        ...faderFirst(gameObjects),
        ...faderFirst(midObjects),
        ...reorderResult(resultObjects),    // + lose_tint 를 버튼 뒤로
    ],
    interface: {
        canvasWidth: 640,
        menuWidth: 280,
        object: 'start_ball',
    },
};
