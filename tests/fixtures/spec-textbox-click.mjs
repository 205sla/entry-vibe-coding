// textBox 클릭 hit-test 검증 — 투명 배경 vs hex 배경.
//
// 가설 (사용자 보고):
//   - 투명 배경 textBox 는 글자(glyph) 픽셀만 클릭 인식. 사각 영역의 빈 공간 클릭 무반응.
//   - hex 배경 textBox 는 사각 영역 전체에서 클릭 인식.
//
// 두 textBox 를 크게 만들어서 빈 공간 vs glyph 위 클릭을 구분 가능하게 함.
//
// 검증 방법: 각 textBox 클릭 시 자기 카운터 +1. verify-textbox-click.mjs 가 캔버스
// 픽셀 좌표로 실제 MouseEvent 를 dispatch 해서 PIXI interaction pipeline 을 통해
// hit-test 결과를 얻음.

import { when, changeVar, obj } from '../../tools/lib/spec-dsl.mjs';

// 공통 entity 베이스 — 크게 (300×80) 만들기 위해 lineBreak:true 필수.
// lineBreak:false (기본) 면 entity 가 자동으로 width 를 글자 폭에 맞춤 → 빈 공간 클릭 불가능.
// lineBreak:true 면 entity.width/height 를 그대로 유지해 사각 영역 확보.
const baseEntity = {
    regX: 0, regY: 0,
    scaleX: 1, scaleY: 1,
    rotation: 0, direction: 90,
    width: 300, height: 80,
    font: '70px NanumGothic',
    colour: '#000000',
    lineBreak: true,
    textAlign: 1,         // 0=left, 1=center, 2=right
    visible: true,
};

export default {
    name: 'textBox 클릭 hit-test',
    variables: [
        { id: 'transparent_hits', name: '투명_클릭수', value: '0', visible: true, x: -220, y: 120 },
        { id: 'opaque_hits',      name: '불투명_클릭수', value: '0', visible: true, x: -220, y: 90  },
    ],
    objects: [
        obj('transparent_box', '투명 글상자', {
            objectType: 'textBox',
            text: '■■■',  // 채워진 사각형 3 개 — glyph 픽셀 밀도 100%, 70px 폰트로 충분한 hit 영역
            entity: { ...baseEntity, x: 0, y: 60 },
            // bgColor 미지정 → entity.js 가 'transparent' 기본값 사용 → bgObject.alpha=0
            script: [
                when.objectClick(),
                changeVar('transparent_hits', 1),
            ],
        }),
        obj('opaque_box', '불투명 글상자', {
            objectType: 'textBox',
            text: '■■■',  // 채워진 사각형 3 개 — glyph 픽셀 밀도 100%, 70px 폰트로 충분한 hit 영역
            entity: { ...baseEntity, x: 0, y: -60, bgColor: '#3b82f6' },
            script: [
                when.objectClick(),
                changeVar('opaque_hits', 1),
            ],
        }),
    ],
};
