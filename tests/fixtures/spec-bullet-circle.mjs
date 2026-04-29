// 탄막 피하기 + 거리-반지름 충돌 + 시간 점수 랭킹 + 동적 주황 배경.
//
// 핵심 패턴:
//   - 플레이어와 적은 모두 brush 로 매 프레임 erase+redraw 되는 원
//   - 충돌은 거리² < (r1+r2)² 로 검사 (sqrt 회피 — 양변 제곱 비교)
//   - 원 그리기는 꼬리재귀 함수 `drawstep` 으로 단일 프레임 내 완료 (60fps 틱 우회)
//   - 적 클론은 4 모서리 중 랜덤 선택해 spawn, 플레이어 방향으로 직선 비행
//   - spawn_count = 1 + floor(survival/8) 로 시간 따라 동시 spawn 증가
//   - 랭킹: cloud list (`ranking_score` + `ranking_display`) 에 insertion sort
//
// 작성: spec-dsl 사용 (8단 중첩 JSON 회피)

import {
    getVar, setVar, changeVar, calc, cmp,
    lengthOfList, valueAt, insertAt, combine,
    when, repeat, if_, stopRepeat, wait,
    move, locateXY, turnRel, turnAbs, seeAngle, coord,
    startDraw, stopDraw, eraseAll, setColor, setThickness,
    hide, isPressed, sendMessage, startScene,
    rand, timer, askWait, getInput, sayFor,
    createClone, deleteClone, removeAllClones,
    fn, call,
    obj, scene as makeScene,
} from '../../tools/lib/spec-dsl.mjs';


//─── 공용 함수 ───────────────────────────────────────────────────

// 꼬리재귀 원 그리기 — sprite 의 현재 위치/방향에서 시작.
// segLen = 한 변 길이, turnDeg = 한 단계 회전각 (음수면 좌회전 = CCW)
// n × turnDeg = ±360 이면 닫힌 다각형 (≈원).
const drawstep = fn.normal('drawstep', ['n', 'segLen', 'turnDeg'],
    (n, segLen, turnDeg) => [
        if_(cmp(n, '>', 0), [
            move(segLen),
            turnRel(turnDeg),
            call('drawstep', calc(n, '-', 1), segLen, turnDeg),
        ]),
    ]);

// 거리² 계산 (sqrt 회피 → 양변 제곱 비교에 사용).
// 함수 본문에서 `dx`/`dy`/`ret` 글로벌을 활용 (Entry 함수는 동기 실행이라 충돌 없음).
const dsq = fn.value('dsq', ['x1', 'y1', 'x2', 'y2'],
    (x1, y1, x2, y2) => [
        setVar('dx', calc(x1, '-', x2)),
        setVar('dy', calc(y1, '-', y2)),
        setVar('ret', calc(
            calc(getVar('dx'), '*', getVar('dx')),
            '+',
            calc(getVar('dy'), '*', getVar('dy'))
        )),
    ],
    () => getVar('ret'));


//─── Scene 별 오브젝트 ───────────────────────────────────────────

// MENU 장면
const menuObjects = [
    obj('menu_title', '제목', {
        scene: 'menu',
        picture: '/images/mascot/bot205-hello.svg',
        entity: { x: 0, y: 60, scaleX: 0.5, scaleY: 0.5, direction: 90 },
        script: [
            when.sceneStart(),
            sayFor('탄막 피하기! 화살표키로 이동하고 빨간 원을 피하세요. 시작 버튼을 누르세요.', 5),
        ],
    }),
    obj('start_btn', '시작 버튼', {
        scene: 'menu',
        picture: '/images/game/block.svg',
        entity: { x: 0, y: -90, scaleX: 1.6, scaleY: 0.8, direction: 90 },
        threads: [
            [
                when.sceneStart(),
                sayFor('▶ 시작 (클릭)', 5),
            ],
            [
                when.objectClick(),
                setVar('alive', 1),
                setVar('cx', 0),
                setVar('cy', 0),
                setVar('survival_time', 0),
                setVar('final_score', 0),
                startScene('play'),
            ],
        ],
    }),
];

// PLAY 장면

// 배경 — 크고 부드러운 주황 원들을 brush 로 그려 배경 분위기 형성.
// 매 프레임 다시 그리지 않고 scene 시작 시 한 번 그린 뒤, 일부만 천천히 회전 시켜 동적 느낌.
const bg = obj('bg_drawer', '배경 그리기', {
    scene: 'play',
    picture: '/images/blank/placeholder.svg',
    entity: { x: 0, y: 0, scaleX: 0.01, scaleY: 0.01, direction: 90 },
    threads: [
        [
            when.sceneStart(),
            hide(),
            eraseAll(),
            // 원 1: 좌상단 큰 옅은 주황
            setColor('#fed7aa'),  // peach-200
            setThickness(60),
            locateXY(-160, 90),
            turnAbs(0),
            startDraw(),
            call('drawstep', 36, 5, -10),
            stopDraw(),
            // 원 2: 우상단
            setColor('#fdba74'),  // orange-300
            setThickness(50),
            locateXY(180, 60),
            turnAbs(0),
            startDraw(),
            call('drawstep', 36, 4, -10),
            stopDraw(),
            // 원 3: 좌하단
            setColor('#fb923c'),  // orange-400
            setThickness(45),
            locateXY(-200, -90),
            turnAbs(0),
            startDraw(),
            call('drawstep', 36, 4, -10),
            stopDraw(),
            // 원 4: 우하단
            setColor('#fdba74'),
            setThickness(55),
            locateXY(190, -100),
            turnAbs(0),
            startDraw(),
            call('drawstep', 36, 5, -10),
            stopDraw(),
            // 중앙 작은 부드러운 원 — 동적 펄스용
            setColor('#fed7aa'),
            setThickness(30),
            locateXY(0, 20),
            turnAbs(0),
            startDraw(),
            call('drawstep', 36, 3, -10),
            stopDraw(),
        ],
    ],
});

// 플레이어 앵커 — 보이지 않는 sprite, (cx, cy) 추적. 적이 see_angle_object 로 조준할 때 참조.
const playerAnchor = obj('player', '플레이어 중심', {
    scene: 'play',
    picture: '/images/blank/placeholder.svg',
    entity: { x: 0, y: 0, scaleX: 0.01, scaleY: 0.01, direction: 90 },
    threads: [
        [
            when.sceneStart(),
            hide(),
            repeat.inf([
                locateXY(getVar('cx'), getVar('cy')),
            ]),
        ],
    ],
});

// 플레이어 그리기 — 매 프레임 erase + 파란 원 그리기 + 키 입력 처리.
// 또한 survival_time 갱신 + alive==0 감지 시 result 장면 전환.
const playerDrawer = obj('player_drawer', '플레이어 그리기', {
    scene: 'play',
    picture: '/images/blank/placeholder.svg',
    entity: { x: 0, y: 0, scaleX: 0.01, scaleY: 0.01, direction: 90 },
    threads: [
        // Setup
        [
            when.sceneStart(),
            hide(),
            removeAllClones(),
            setColor('#2563eb'),  // blue-600
            setThickness(3),
            timer.reset(),
            timer.start(),
        ],
        // Main loop — 입력 + 그리기 + 시간/상태 갱신
        [
            when.sceneStart(),
            repeat.inf([
                if_(cmp(getVar('alive'), '>', 0), [
                    // 화살표 키 입력 + 화면 경계 클램프
                    if_({ type: 'boolean_and_or', params: [
                        isPressed('39'),
                        'AND',
                        cmp(getVar('cx'), '<', 220),
                    ]}, [ changeVar('cx', 4) ]),
                    if_({ type: 'boolean_and_or', params: [
                        isPressed('37'),
                        'AND',
                        cmp(getVar('cx'), '>', -220),
                    ]}, [ changeVar('cx', -4) ]),
                    if_({ type: 'boolean_and_or', params: [
                        isPressed('38'),
                        'AND',
                        cmp(getVar('cy'), '<', 130),
                    ]}, [ changeVar('cy', 4) ]),
                    if_({ type: 'boolean_and_or', params: [
                        isPressed('40'),
                        'AND',
                        cmp(getVar('cy'), '>', -130),
                    ]}, [ changeVar('cy', -4) ]),

                    // 매 프레임 파란 원 다시 그리기 — 36 세그먼트, 반지름 ≈ 14.3
                    stopDraw(),
                    eraseAll(),
                    locateXY(calc(getVar('cx'), '+', 14), getVar('cy')),
                    turnAbs(0),
                    startDraw(),
                    call('drawstep', 36, 2.5, -10),
                    stopDraw(),

                    // 생존 시간 갱신
                    setVar('survival_time', timer.value()),
                ]),
            ]),
        ],
        // 사망 처리
        [
            when.message('hit'),
            setVar('alive', 0),
            timer.stop(),
            setVar('final_score', getVar('survival_time')),
            wait(0.5),
            startScene('result'),
        ],
    ],
});

// 적 spawner — 보이지 않는 sprite. 일정 간격마다 spawn_count 만큼 적 클론 생성.
// spawn_count = 1 + floor(survival_time / 8) — 8초마다 동시 spawn 1 증가.
const spawner = obj('spawner', '스포너', {
    scene: 'play',
    picture: '/images/blank/placeholder.svg',
    entity: { x: 0, y: 200, scaleX: 0.01, scaleY: 0.01, direction: 90, visible: false },
    threads: [
        [
            when.sceneStart(),
            hide(),
            wait(1),  // 시작 후 1초 유예
            repeat.inf([
                if_(cmp(getVar('alive'), '<', 1), [ stopRepeat() ]),
                // spawn_count = 1 + floor(survival_time / 8) — 함수 없이 직접 계산
                // calc_operation(quotient_and_mod) 까지 안 쓰고 단순 비교 chain 으로:
                setVar('spawn_count', 1),
                if_(cmp(getVar('survival_time'), '>=', 8),  [ setVar('spawn_count', 2) ]),
                if_(cmp(getVar('survival_time'), '>=', 16), [ setVar('spawn_count', 3) ]),
                if_(cmp(getVar('survival_time'), '>=', 24), [ setVar('spawn_count', 4) ]),
                if_(cmp(getVar('survival_time'), '>=', 32), [ setVar('spawn_count', 5) ]),
                if_(cmp(getVar('survival_time'), '>=', 40), [ setVar('spawn_count', 6) ]),
                if_(cmp(getVar('survival_time'), '>=', 50), [ setVar('spawn_count', 8) ]),
                // spawn_count 만큼 클론 생성
                setVar('i', 0),
                repeat.inf([
                    if_(cmp(getVar('i'), '>=', getVar('spawn_count')), [ stopRepeat() ]),
                    createClone('enemy'),
                    changeVar('i', 1),
                ]),
                wait(0.45),  // ~0.45초마다 spawn
            ]),
        ],
    ],
});

// 적 클론 — 4 모서리 중 랜덤 선택 후 spawn → 플레이어 방향으로 직선 이동 → 충돌 검사.
const enemy = obj('enemy', '적', {
    scene: 'play',
    picture: '/images/blank/placeholder.svg',
    entity: { x: 0, y: 300, scaleX: 0.01, scaleY: 0.01, direction: 90, visible: false },
    threads: [
        [
            when.sceneStart(),
            hide(),
        ],
        [
            when.cloneStart(),
            hide(),
            setColor('#dc2626'),  // red-600
            setThickness(3),
            // 4 모서리 중 랜덤 선택 (1=top, 2=bottom, 3=left, 4=right)
            setVar('edge', rand(1, 4)),
            if_(cmp(getVar('edge'), '==', 1), [
                locateXY(rand(-220, 220), 145),
            ]),
            if_(cmp(getVar('edge'), '==', 2), [
                locateXY(rand(-220, 220), -145),
            ]),
            if_(cmp(getVar('edge'), '==', 3), [
                locateXY(-255, rand(-130, 130)),
            ]),
            if_(cmp(getVar('edge'), '==', 4), [
                locateXY(255, rand(-130, 130)),
            ]),
            // 플레이어 앵커를 향해 조준
            seeAngle('player'),
            // 메인 루프 — 매 프레임 이동 + 빨간 원 다시 그리기 + 충돌 검사
            repeat.inf([
                if_(cmp(getVar('alive'), '<', 1), [
                    stopDraw(),
                    eraseAll(),
                    deleteClone(),
                ]),
                // 이동 (자기 방향으로 2.2 픽셀)
                move(2.2),
                // 빨간 원 다시 그리기 — 24 세그먼트, 반지름 ≈ 7.7
                stopDraw(),
                eraseAll(),
                turnRel(90),  // tangent 방향으로 회전 (drawstep 시작 위치 보정)
                move(8),       // 원 시작점으로 이동
                turnRel(-90),  // 회전 복원 (다음 프레임 이동 방향 그대로)
                // 위 "tangent jump" 대신 더 깔끔히: 그냥 현재 위치에서 원만 그리고 복귀
                // ...간단히: stopDraw + 시작점으로 이동 → start → 원 → stop → 복귀
                // 위 두 줄 (turnRel 90/-90 + move 8) 은 sprite 위치를 원 시작점으로 옮김.
                // drawstep 끝나면 다시 시작점으로 돌아옴 (닫힌 원).
                startDraw(),
                call('drawstep', 24, 2.0, -15),
                stopDraw(),
                // 위치 복원: tangent jump 역방향
                turnRel(90),
                move(-8),
                turnRel(-90),

                // 거리² 충돌 검사 — (cx, cy) vs sprite 자기 위치
                if_(cmp(
                    call('dsq', getVar('cx'), getVar('cy'),
                        coord('self', 'x'), coord('self', 'y')),
                    '<',
                    500  // (14 + 8)² 약간 여유 = 484 → 500
                ), [
                    sendMessage('hit'),
                    stopDraw(),
                    eraseAll(),
                    deleteClone(),
                ]),

                // 화면 밖 멀리 가면 자기 정리
                if_({ type: 'boolean_and_or', params: [
                    cmp(coord('self', 'x'), '<', -300),
                    'OR',
                    cmp(coord('self', 'x'), '>', 300),
                ]}, [
                    stopDraw(),
                    eraseAll(),
                    deleteClone(),
                ]),
                if_({ type: 'boolean_and_or', params: [
                    cmp(coord('self', 'y'), '<', -200),
                    'OR',
                    cmp(coord('self', 'y'), '>', 200),
                ]}, [
                    stopDraw(),
                    eraseAll(),
                    deleteClone(),
                ]),
            ]),
        ],
    ],
});

// RESULT 장면 — 게임 오버 + 닉네임 입력 → 랭킹 저장 → 재시작 버튼
const resultObjects = [
    obj('gameover', '결과', {
        scene: 'result',
        picture: '/images/mascot/bot205-idle.svg',
        entity: { x: 0, y: 60, scaleX: 0.45, scaleY: 0.45, direction: 90 },
        script: [
            when.sceneStart(),
            sayFor('게임 오버! 점수는 우측 변수, 랭킹 등록은 아래 버튼을 클릭', 4),
        ],
    }),

    // 닉네임 입력 + 랭킹 등록 버튼
    obj('save_btn', '랭킹 등록', {
        scene: 'result',
        picture: '/images/game/block.svg',
        entity: { x: -100, y: -90, scaleX: 1.4, scaleY: 0.7, direction: 90 },
        threads: [
            [
                when.sceneStart(),
                sayFor('▼ 클릭해서 랭킹 등록', 6),
            ],
            [
                when.objectClick(),
                askWait('이름을 입력하세요'),
                setVar('nickname', getInput()),
                // insertion sort — final_score 가 들어갈 위치를 찾는다.
                // ranking_score 는 내림차순(큰 점수가 앞). final_score 가 첫 항목보다 크면 pos=1, 등.
                setVar('sort_pos', 1),
                repeat.inf([
                    // 1) 끝 도달 → break
                    if_(cmp(getVar('sort_pos'), '>', lengthOfList('ranking_score')), [
                        stopRepeat(),
                    ]),
                    // 2) 현재 위치 점수 < final_score 면 → 여기 삽입
                    if_(cmp(valueAt('ranking_score', getVar('sort_pos')), '<', getVar('final_score')), [
                        stopRepeat(),
                    ]),
                    changeVar('sort_pos', 1),
                ]),
                // 삽입: ranking_score, ranking_display 양쪽에 같은 위치
                insertAt(getVar('final_score'), 'ranking_score', getVar('sort_pos')),
                insertAt(
                    combine(combine(getVar('final_score'), '초 - '), getVar('nickname')),
                    'ranking_display',
                    getVar('sort_pos')
                ),
                sayFor('등록 완료! 다시 하기 버튼을 누르세요.', 3),
            ],
        ],
    }),

    obj('restart_btn', '다시 하기', {
        scene: 'result',
        picture: '/images/game/block.svg',
        entity: { x: 100, y: -90, scaleX: 1.4, scaleY: 0.7, direction: 90 },
        threads: [
            [
                when.sceneStart(),
                sayFor('▼ 다시 하기', 6),
            ],
            [
                when.objectClick(),
                startScene('menu'),
            ],
        ],
    }),
];


//─── 최종 spec ──────────────────────────────────────────────────

export default {
    name: '탄막 피하기 (붓 + 거리 충돌 + 랭킹)',
    scenes: [
        makeScene('menu',   '시작 화면'),
        makeScene('play',   '게임 화면'),
        makeScene('result', '결과 화면'),
    ],
    variables: [
        // 게임 상태
        { id: 'cx',            name: 'cx',         value: '0',  visible: false },
        { id: 'cy',            name: 'cy',         value: '0',  visible: false },
        { id: 'alive',         name: 'alive',      value: '1',  visible: false },
        { id: 'survival_time', name: '생존 시간',  value: '0',  visible: true,  x: -220, y: 130 },
        { id: 'spawn_count',   name: '동시 spawn', value: '1',  visible: true,  x: -220, y: 100 },
        { id: 'final_score',   name: '최종 점수',  value: '0',  visible: true,  x: -220, y:  70 },

        // 함수 helpers (dsq 의 글로벌 임시값)
        { id: 'dx',            name: 'dx',         value: '0',  visible: false },
        { id: 'dy',            name: 'dy',         value: '0',  visible: false },
        { id: 'ret',           name: 'ret',        value: '0',  visible: false },

        // spawner 의 루프 카운터
        { id: 'i',             name: 'i',          value: '0',  visible: false },
        { id: 'edge',          name: 'edge',       value: '0',  visible: false },

        // 랭킹 — nickname 은 일반 variable. ask_and_wait 의 결과는 get_canvas_input_value
        // 로 읽어 setVar 로 저장한다. 'answer' 타입은 Entry 에 하나만 두는 게 안전.
        { id: 'nickname',      name: 'nickname',   value: '익명', visible: false },
        { id: 'sort_pos',      name: 'sort_pos',   value: '1',  visible: false },
        // ask_and_wait 결과를 받기 위한 '대답' answer 변수 (Entry 표준).
        { id: '__answer__',    name: '대답',       value: '0',  visible: false,
          variableType: 'answer' },
    ],
    lists: [
        { id: 'ranking_score',   name: '랭킹 점수',   isCloud: false, visible: false,
          x: 100, y: 30, width: 100, height: 200, array: [] },
        { id: 'ranking_display', name: '🏆 랭킹',    isCloud: false, visible: true,
          x: 90,  y: 20, width: 130, height: 220, array: [] },
    ],
    messages: [
        { id: 'hit', name: '피격' },
    ],
    functions: [drawstep, dsq],
    objects: [
        ...menuObjects,
        bg, playerAnchor, playerDrawer, spawner, enemy,
        ...resultObjects,
    ],
    interface: {
        canvasWidth: 640,
        menuWidth: 280,
        object: 'start_btn',
    },
};
