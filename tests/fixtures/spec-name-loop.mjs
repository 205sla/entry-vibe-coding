// 이름을 반복해서 묻고 글상자에 출력 — askWait + text_write 데모.
//
// 흐름:
//   1. 글상자가 '이름을 알려주세요' 라고 묻고 답을 기다림
//   2. 사용자가 답하면 글상자가 그 답을 자기 자신에 표시 (text_write)
//   3. 다시 묻기 — 무한 반복
//
// 핵심:
//   - text_write 는 textBox 전용 (sprite 에서 호출하면 무시됨)
//   - ask_and_wait 결과는 get_canvas_input_value() 로 읽음
//   - 'answer' 타입 변수 (`대답`) 1 개 필요 — Entry 는 이름 무관하게 첫 answer 변수만 인식

import {
    when, repeat, askWait, getInput, writeText, obj
} from '../../tools/lib/spec-dsl.mjs';

export default {
    name: '이름 묻고 답하기',
    variables: [
        {
            id: 'answer', name: '대답',
            variableType: 'answer', value: '0',
            visible: false,
        },
    ],
    objects: [
        obj('display', '이름표시', {
            objectType: 'textBox',
            text: '...',
            entity: {
                x: 0, y: 0,
                regX: 0, regY: 0,
                scaleX: 1, scaleY: 1,
                rotation: 0, direction: 90,
                width: 200, height: 40,
                font: '24px NanumGothic',
                visible: true,
            },
            script: [
                when.run(),
                repeat.inf([
                    askWait('이름을 알려주세요'),
                    writeText(getInput()),
                ]),
            ],
        }),
    ],
};
