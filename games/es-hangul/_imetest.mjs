// 미니 한글 IME 입력 테스트 — Entry 스테이지에서 직접 타이핑 → 실시간 조합.
// es-hangul 함수(binAssemble/removeLastCharacter)와 데이터(QKEYS/QJAMO)를 재사용.
//
// 테스트 항목: ① Shift→쌍자음 ② Alt→한/영 전환 ③ Backspace 삭제
//             ④ '|' 커서 깜빡임 ⑤ 방향키 커서 이동
//
// 모델: left(커서 앞 확정) + comp(조합 중 1음절) + right(커서 뒤 확정).
//   화면 = modelbl + left + comp + cur + right.  커서 이동/모드전환/스페이스 시 comp 확정.
//
// Build:  node -e "import('./tools/make-ent.mjs').then(m=>m.writeEnt(require... )"  → build.mjs 미사용, 아래 _imebuild.mjs
// (간단히: node games/es-hangul/_imebuild.mjs)

import esHangul from './spec.mjs';
import {
    num, txt, getVar, setVar, calc, cmp,
    if_, repeat, fn, call,
    combine, charAt, substr, indexOf, strLen, isPressed,
    when, obj, writeText, wait,
} from '../../tools/lib/spec-dsl.mjs';

const cat = (...p) => p.reduce((a, b) => combine(a, b));

// es-hangul 데이터 변수 id (spec.mjs 와 동일)
const QKEYS_ID = 'qky0', QJAMO_ID = 'qjm0';

// ── IME 전역 변수 ─────────────────────────────────────────────────
const imeVarIds = ['left', 'comp', 'right', 'mode', 'cur', 'modelbl', 'ktmp', 'kpos', 'kjamo', 'kres'];
const imeVars = imeVarIds.map(id => ({ id, name: id, value: '', visible: false }));

// ── IME 헬퍼 함수 ────────────────────────────────────────────────

// imeType(c): 타이핑된 글자 c 를 현재 모드에 맞게 처리.
//   한(mode=1): QWERTY→자모 룩업 후 binAssemble 로 comp 에 한 자모 합치고, 넘친 음절은 left 로 확정.
//   영(mode=0): comp 확정 후 c 를 그대로 left 에 추가.
const imeType = fn.normal('imeType', ['c'], (c) => [
    if_(cmp(getVar('mode'), '==', 1),
        [
            setVar('kpos', indexOf(getVar(QKEYS_ID), c)),
            if_(cmp(getVar('kpos'), '>', 0),
                [
                    setVar('kjamo', charAt(getVar(QJAMO_ID), getVar('kpos'))),
                    if_(cmp(strLen(getVar('comp')), '==', 0),
                        [setVar('kres', getVar('kjamo'))],
                        [setVar('kres', call('binAssemble', getVar('comp'), getVar('kjamo')))]
                    ),
                    // comp = kres 의 마지막 글자, 나머지는 left 로 확정
                    setVar('comp', charAt(getVar('kres'), strLen(getVar('kres')))),
                    if_(cmp(strLen(getVar('kres')), '>', 1),
                        [setVar('left', cat(getVar('left'), substr(getVar('kres'), num(1), calc(strLen(getVar('kres')), '-', 1))))]),
                ],
                [   // 매핑 안 되는 글자 → 확정 + 그대로
                    setVar('left', cat(getVar('left'), getVar('comp'), c)),
                    setVar('comp', txt('')),
                ]
            ),
        ],
        [   // 영문 모드
            setVar('left', cat(getVar('left'), getVar('comp'), c)),
            setVar('comp', txt('')),
        ]
    ),
    call('redraw'),
]);

// commit(): 조합 중 comp 를 left 로 확정.
const commit = fn.normal('commit', [], () => [
    setVar('left', cat(getVar('left'), getVar('comp'))),
    setVar('comp', txt('')),
]);

// redraw(): 화면 갱신. 모드라벨 + left + comp + 커서 + right.
const redraw = fn.normal('redraw', [], () => [
    writeText(cat(getVar('modelbl'), getVar('left'), getVar('comp'), getVar('cur'), getVar('right'))),
]);

// ── 키 핸들러 스레드 ─────────────────────────────────────────────

// 시작 + 커서 깜빡임 (when_run)
const whenRun = [
    when.run(),
    setVar('left', txt('')), setVar('comp', txt('')), setVar('right', txt('')),
    setVar('mode', num(1)), setVar('modelbl', txt('[한] ')), setVar('cur', txt('|')),
    call('redraw'),
    repeat.inf([
        if_(cmp(getVar('cur'), '==', txt('|')), [setVar('cur', txt(' '))], [setVar('cur', txt('|'))]),
        call('redraw'),
        wait(0.45),
    ]),
];

// 글자키 26개 — keyCode = 'a'(97)-32 = 65 … 'z' = 90. Shift(16) 누름 시 대문자(쌍자음).
const letters = 'abcdefghijklmnopqrstuvwxyz';
const letterThreads = [...letters].map(lower => {
    const upper = lower.toUpperCase();
    const code = String(lower.charCodeAt(0) - 32);
    return [
        when.keyPressed(code),
        setVar('ktmp', txt(lower)),
        if_(isPressed('16'), [setVar('ktmp', txt(upper))]),
        call('imeType', getVar('ktmp')),
    ];
});

// Backspace(8): comp 있으면 comp 에서, 없으면 left 에서 마지막 자모 제거.
const backspace = [
    when.keyPressed('8'),
    if_(cmp(strLen(getVar('comp')), '>', 0),
        [setVar('comp', call('removeLastCharacter', getVar('comp')))],
        [if_(cmp(strLen(getVar('left')), '>', 0),
            [setVar('left', call('removeLastCharacter', getVar('left')))])]
    ),
    call('redraw'),
];

// Space(32)
const space = [
    when.keyPressed('32'),
    call('commit'),
    setVar('left', cat(getVar('left'), txt(' '))),
    call('redraw'),
];

// Alt(18): 한/영 토글 (조합 확정 후)
const alt = [
    when.keyPressed('18'),
    call('commit'),
    if_(cmp(getVar('mode'), '==', 1),
        [setVar('mode', num(0)), setVar('modelbl', txt('[영] '))],
        [setVar('mode', num(1)), setVar('modelbl', txt('[한] '))]
    ),
    call('redraw'),
];

// ←(37): 확정 후 left 의 마지막 글자를 right 앞으로
const arrowLeft = [
    when.keyPressed('37'),
    call('commit'),
    if_(cmp(strLen(getVar('left')), '>', 0),
        [
            setVar('right', cat(charAt(getVar('left'), strLen(getVar('left'))), getVar('right'))),
            if_(cmp(strLen(getVar('left')), '>', 1),
                [setVar('left', substr(getVar('left'), num(1), calc(strLen(getVar('left')), '-', 1)))],
                [setVar('left', txt(''))]
            ),
        ]),
    call('redraw'),
];

// →(39): 확정 후 right 의 첫 글자를 left 끝으로
const arrowRight = [
    when.keyPressed('39'),
    call('commit'),
    if_(cmp(strLen(getVar('right')), '>', 0),
        [
            setVar('left', cat(getVar('left'), charAt(getVar('right'), num(1)))),
            if_(cmp(strLen(getVar('right')), '>', 1),
                [setVar('right', substr(getVar('right'), num(2), strLen(getVar('right'))))],
                [setVar('right', txt(''))]
            ),
        ]),
    call('redraw'),
];

const imeObj = obj('ime', '입력판', {
    objectType: 'textBox',
    text: '영문모드로 두벌식 타이핑 (r k s → 간)',
    entity: {
        x: -200, y: 0, regX: 0, regY: 0, scaleX: 1, scaleY: 1,
        width: 400, height: 80, font: '24px NanumGothic',
        bgColor: '#0f172a', colour: '#e2e8f0', visible: true,
    },
    threads: [whenRun, ...letterThreads, backspace, space, alt, arrowLeft, arrowRight],
});

export default {
    ...esHangul,
    name: 'IME 입력 테스트',
    variables: [...esHangul.variables, ...imeVars],
    functions: [...esHangul.functions, imeType, commit, redraw],
    objects: [imeObj],
    interface: { canvasWidth: 640, menuWidth: 280, object: 'ime' },
};
