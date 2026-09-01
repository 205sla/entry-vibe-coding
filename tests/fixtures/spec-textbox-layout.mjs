// 글상자 레이아웃 회귀 픽스처 — knowledge/07 의 네 가지 주장을 재현한다.
//
//   ① entity 를 비워두면 fontSize 가 NaN 이 된다 (→ 글자가 10px 로 쪼그라듦)
//   ② lineBreak:true 는 width 에서 접고, height 를 넘는 줄은 그리지 않는다
//   ③ `묻고 대답 기다리기` 는 입력칸을 무대 아래에 깔고, 말풍선은 오브젝트에 붙는다
//      → 묻는 오브젝트를 x:500 으로 보내면 말풍선이 무대 밖으로 나간다
//   ④ 장면을 왕복해도 실행기는 쌓이지 않는다 (resetSceneDuringRun)
//
// 검증: tools/verify-textbox-layout.mjs

import { when, num, txt, calc, getVar, setVar, repeat, wait, askWait, obj, scene }
    from '../../tools/lib/spec-dsl.mjs';

// 보이는 글상자가 갖춰야 할 전체 entity. 하나라도 빠지면 make-ent 가
// sprite 기본값으로 메꾼다 — 그게 ① 의 원인이다.
const fullEntity = (extra) => ({
    x: 0, y: 0, regX: 0, regY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, direction: 90,
    textAlign: 1, lineBreak: true,      // 1 = 왼쪽 (0 이 가운데다)
    width: 300, height: 60,
    font: '16px NanumGothic', fontSize: 16,
    colour: '#111111', bgColor: 'transparent',
    visible: true,
    ...extra,
});

// width 300 · fontSize 16 이면 한 줄에 약 18자 → 7 줄쯤 된다.
// height 60 · lineHeight 18 이면 3 줄만 그려지고 나머지는 버려진다.
const LONG = '엔트리는 블록을 조립해서 프로그램을 만드는 도구예요. '
    + '변수와 신호를 쓰면 여러 오브젝트가 서로 값을 주고받게 만들 수 있어요.';

const SC = { main: 'lmai', other: 'loth' };

// 첫 장면 오브젝트는 `시작하기` 로만 발화한다 (`장면이 시작되었을 때` 는 start_scene 전환에서만).
// 재진입 검증을 위해 두 트리거를 모두 건다.
const dual = (body) => [[when.run(), ...body], [when.sceneStart(), ...body]];

export default {
    name: '글상자 레이아웃',
    scenes: [scene(SC.main, '본'), scene(SC.other, '딴곳')],
    variables: [
        { id: 'tick', name: '틱', value: '0', visible: false },
    ],
    objects: [
        // ① 함정 재현 — entity 를 x/y 만 준다. make-ent 가 sprite 기본값을 채운다.
        obj('bare', '기본entity', {
            objectType: 'textBox', scene: SC.main, text: '기본 entity',
            entity: { x: -100, y: 100 },
        }),

        // ② 정상 — entity 를 전부 명시. 긴 글이 접히고, height 를 넘는 줄은 잘린다.
        obj('full', '전체entity', {
            objectType: 'textBox', scene: SC.main, text: LONG,
            entity: fullEntity({ x: 0, y: 0 }),
        }),

        // ③ 묻는 오브젝트를 무대 **오른쪽** 밖으로. dialog.ts 의 'w' 가지에는
        //    위쪽 clamp 가 없어서 말풍선이 ±240 밖으로 나간다. x:-500 은 안 통한다.
        obj('asker', '묻기', {
            objectType: 'textBox', scene: SC.main, text: '묻기',
            entity: fullEntity({ x: 500, y: 0, width: 60, height: 24, visible: false }),
            threads: dual([askWait('질문을 입력하세요')]),
        }),

        // ④ 재진입해도 하나여야 하는 무한 루프.
        obj('looper', '루프', {
            objectType: 'textBox', scene: SC.main, text: '루프',
            entity: fullEntity({ x: -100, y: -100, width: 80, height: 24, visible: false }),
            threads: dual([
                repeat.inf([
                    setVar('tick', calc(getVar('tick'), '+', num(1))),
                    wait(0.1),
                ]),
            ]),
        }),

        obj('otherObj', '딴곳글상자', {
            objectType: 'textBox', scene: SC.other, text: '딴 장면',
            entity: fullEntity({ x: 0, y: 0, width: 200, height: 24 }),
        }),
    ],
};
