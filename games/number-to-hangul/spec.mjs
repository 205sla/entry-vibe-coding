// numberToHangul — 자기완결 단일 함수 (es-hangul 의 numberToHangul 을 떼어 옮김).
//
// 요구사항: 다른 함수·전역 변수·리스트에 종속되지 않는 **단 하나의 함수**.
//   - 원본 spec 에선 numberToHangul 이 보조 함수 grp(0..9999 한 그룹 → 한글)을
//     call('grp', ...) 로 호출했다. 여기선 그 grp 로직을 **함수 안에 인라인**해
//     런타임 함수 호출 의존성까지 없앴다.
//   - 모든 작업값은 **함수 지역 변수**(fn.value 의 locals + L 접근자)뿐. 전역
//     변수/리스트는 0 개. (프로젝트의 variables/lists 도 비어 있다.)
//   - 결과 표시용 글상자(데모)는 함수를 호출만 할 뿐, 함수가 글상자/변수에
//     의존하지는 않는다.
//
// 변환 규칙(원본과 동일): 0 → '영'. 그 외엔 억(10^8)·만(10^4)·일(1) 3그룹으로 쪼개
//   각 그룹을 천/백/십/일 한글로, 그룹 사이는 공백. 각 그룹 천의 자리 선행 1 은 생략
//   (천, not 일천). 예: 19834 → '일만 구천팔백삼십사'.

import {
    num, txt,
    mod, quotient, cmp,
    if_, fn, call,
    combine, charAt, strLen, replaceStr,
    when, obj, writeText,
} from '../../tools/lib/spec-dsl.mjs';

// ── 빌드 헬퍼 (authoring 시점의 JS — 런타임 함수가 아니다) ─────────

// 1-based 자릿수 한글: charAt(DIGITS, d).
const DIGITS = '일이삼사오육칠팔구';

// 여러 문자열 이어붙이기 (combine 폴드).
const cat = (...parts) => parts.reduce((a, b) => combine(a, b));

// **센티넬 시드** — 엔트리 함수 지역변수는 빈 문자열을 저장 못 함(set_func_variable('')
// → 읽으면 0). 그래서 누산기 'out' 은 빈 문자열 대신 SEED(PUA 문자, 데이터에 없음)로
// 시작하고, 반환 직전 flush 로 제거 → 지역변수가 한 번도 비지 않음.
const SEED    = '';
const seedOut = (L) => L.set('out', txt(SEED));
const flush   = (L) => replaceStr(L.get('out'), txt(SEED), txt(''));  // 반환값: SEED 제거

// 그룹 사이 공백 — out 에 (SEED 외) 내용이 있을 때만 (strLen > 1).
const addSep = (L) =>
    if_(cmp(strLen(L.get('out')), '>', 1), [L.set('out', cat(L.get('out'), txt(' ')))]);

// 자릿수 한 자리(천/백/십) 처리. 선행 1 은 생략(천, not 일천). digit/placeChar 는 JS 값.
const placeBlock = (L, digit, placeChar) =>
    if_(cmp(L.get(digit), '>', 0),
        [if_(cmp(L.get(digit), '==', 1),
            [L.set('out', cat(L.get('out'), txt(placeChar)))],
            [L.set('out', cat(L.get('out'), charAt(txt(DIGITS), L.get(digit)), txt(placeChar)))]
        )]
    );

// 한 그룹(0..9999, 지역변수 gName 에 든 값)을 천백십일 한글로 out 에 직접 누적.
// 원본의 grp 함수 본문을 인라인한 것 — th/hu/te/on 지역변수는 세 그룹이 순차
// 처리라 재사용해도 안전(각 호출 첫머리에서 새로 set).
const emitGroup = (L, gName) => [
    L.set('th', quotient(L.get(gName), 1000)),
    L.set('hu', mod(quotient(L.get(gName), 100), 10)),
    L.set('te', mod(quotient(L.get(gName), 10), 10)),
    L.set('on', mod(L.get(gName), 10)),
    placeBlock(L, 'th', '천'),
    placeBlock(L, 'hu', '백'),
    placeBlock(L, 'te', '십'),
    if_(cmp(L.get('on'), '>', 0),
        [L.set('out', cat(L.get('out'), charAt(txt(DIGITS), L.get('on'))))]),
];

// ── 단일 함수 정의 ───────────────────────────────────────────────

const numberToHangul = fn.value('numberToHangul', ['n'],
    (n, L) => [
        seedOut(L),
        if_(cmp(n, '==', 0),
            [L.set('out', txt('영'))],
            [
                L.set('eok', quotient(n, 100000000)),       // 억 그룹
                L.set('rem', mod(n, 100000000)),
                L.set('man', quotient(L.get('rem'), 10000)), // 만 그룹
                L.set('one', mod(L.get('rem'), 10000)),      // 일 그룹
                if_(cmp(L.get('eok'), '>', 0),
                    [...emitGroup(L, 'eok'), L.set('out', cat(L.get('out'), txt('억')))]),
                if_(cmp(L.get('man'), '>', 0),
                    [addSep(L), ...emitGroup(L, 'man'), L.set('out', cat(L.get('out'), txt('만')))]),
                if_(cmp(L.get('one'), '>', 0),
                    [addSep(L), ...emitGroup(L, 'one')]),
            ]
        ),
    ],
    (n, L) => flush(L),
    ['out', 'eok', 'rem', 'man', 'one', 'th', 'hu', 'te', 'on']);

// ── 데모 글상자 (함수를 샘플 입력으로 호출해 결과만 표시) ─────────
// 전역 변수/리스트 없이, writeText 안에서 함수를 직접 호출해 이어붙인다.

const line = (n) => [txt(n + ' → '), call('numberToHangul', num(n)), txt('\n')];

const board = obj('board', '결과판', {
    objectType: 'textBox',
    text: '실행(▶) 을 누르면 numberToHangul 결과가 표시됩니다',
    entity: {
        x: 0, y: 0, regX: 0, regY: 0, scaleX: 1, scaleY: 1,
        width: 460, height: 340, font: '18px NanumGothic',
        bgColor: '#0f172a', colour: '#e2e8f0',
        lineBreak: true, textAlign: 0, visible: true,
    },
    script: [
        when.run(),
        writeText(cat(
            ...line(0),
            ...line(7),
            ...line(20),
            ...line(100),
            ...line(1000),
            ...line(1234),
            ...line(10000),
            ...line(19834),
            ...line(305),
            ...line(100000000),
            ...line(123456789),
        )),
    ],
});

export default {
    name: 'numberToHangul (단일 함수)',
    variables: [],
    lists: [],
    functions: [numberToHangul],
    objects: [board],
    interface: { canvasWidth: 640, menuWidth: 280, object: 'board' },
};
