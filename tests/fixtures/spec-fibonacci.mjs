// Fibonacci with iterative function — DSL version of spec-fibonacci.json.
// Demonstrates the spec-DSL (tools/lib/spec-dsl.mjs) compared to the JSON
// equivalent. Same .ent output, half the LOC, far more readable.
//
// Build:  node tools/make-ent.mjs tests/fixtures/spec-fibonacci.mjs tests/fixtures/fibonacci.ent

import {
    num, getVar, setVar, calc,
    addToList, removeFromList, lengthOfList,
    when, repeat,
    fn, call,
    obj, picture,
} from '../../tools/lib/spec-dsl.mjs';

export default {
    name: '함수로 만든 피보나치 수열',
    variables: [
        { id: 'n_input',  name: '입력 n', value: '10',
          variableType: 'slide', minValue: 0, maxValue: 30,
          visible: true, x: -220, y: 120 },
        { id: 'result',   name: '결과', value: '0',  visible: true,  x: -220, y:  90 },
        { id: 'fib_a',    name: 'fib_a', value: '0', visible: false },
        { id: 'fib_b',    name: 'fib_b', value: '1', visible: false },
        { id: 'fib_temp', name: 'fib_temp', value: '0', visible: false },
    ],
    lists: [
        { id: 'fib_seq', name: '수열', isCloud: false, visible: true,
          x: 90, y: 30, width: 120, height: 200, array: [] },
    ],
    functions: [
        // 피보나치 함수 — value-returning. 매개변수 n 한 개.
        // 함수 본문에서 fib_a/fib_b/fib_temp를 갱신하고, 반환값으로 fib_a를 돌려줌.
        fn.value('fib', ['n'],
            // body
            (n) => [
                setVar('fib_a', num(0)),
                setVar('fib_b', num(1)),
                repeat.basic(n, [
                    setVar('fib_temp', calc(getVar('fib_a'), '+', getVar('fib_b'))),
                    setVar('fib_a',    getVar('fib_b')),
                    setVar('fib_b',    getVar('fib_temp')),
                ]),
            ],
            // return value
            () => getVar('fib_a')
        ),
    ],
    objects: [
        obj('runner', '실행기', {
            picture: picture('/images/mascot/bot205-hello.svg'),
            entity: { x: -50, y: -40, scaleX: 0.4, scaleY: 0.4, direction: 90 },
            script: [
                when.run(),

                // 수열 리스트 비우기 (현재 길이만큼 인덱스 1을 반복 제거)
                repeat.basic(lengthOfList('fib_seq'), [
                    removeFromList(num(1), 'fib_seq'),
                ]),

                // 함수 호출: result = fib(n_input)
                setVar('result', call('fib', getVar('n_input'))),

                // 시각화용 — 첫 n개 피보나치 수를 리스트에 채움
                setVar('fib_a', num(0)),
                setVar('fib_b', num(1)),
                repeat.basic(getVar('n_input'), [
                    addToList(getVar('fib_a'), 'fib_seq'),
                    setVar('fib_temp', calc(getVar('fib_a'), '+', getVar('fib_b'))),
                    setVar('fib_a',    getVar('fib_b')),
                    setVar('fib_b',    getVar('fib_temp')),
                ]),
            ],
        }),
    ],
    interface: { canvasWidth: 640, menuWidth: 280, object: 'runner' },
};
