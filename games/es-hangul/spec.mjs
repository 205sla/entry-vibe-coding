// es-hangul 핵심 기능을 엔트리 사용자 정의 함수로 포팅.
// (toss/es-hangul: https://github.com/toss/es-hangul)
//
// 엔트리에는 유니코드/문자코드 블록이 없다. 대신 "음절 색인표(REF) + index_of +
// 몫·나머지 산술"로 한글 음절을 분해/조합한다.
//
//   음절 코드 = 0xAC00 + 초성*588 + 중성*28 + 종성
//   offset = index_of_string(REF, 음절) - 1   (REF = 가..힣 11,172자, 1-based)
//   초성idx = offset / 588,  중성idx = (offset % 588) / 28,  종성idx = offset % 28
//   역방향 음절 = char_at(REF, 초성idx*588 + 중성idx*28 + 종성idx + 1)
//
// 함수 21개: getChoseong·hasBatchim·josa·disassembleChar·assembleChar·
//   numberToHangul(+grp)·susa·days·canBe{Choseong,Jungseong,Jongseong}·
//   combineVowels·disassemble·disassembleToGroups·disassembleCompleteCharacter·
//   removeLastCharacter·numberToHangulMixed(+mixGroup)·amountToHangul·seosusa.
//
// 함수 전용 임시값은 **함수 지역 변수**(fn.value 의 locals + L 접근자)로 둔다.
// 공유 데이터(REF/자모표/룩업 리스트)와 결과 변수만 전역.
// 지역변수 포맷·블록은 knowledge/04-script-and-blocks.md "함수 지역 변수" 참고.
//
// Build:  node games/es-hangul/build.mjs
// Check:  node tools/make-ent.mjs --check games/es-hangul/spec.mjs

import {
    num, txt, getVar, setVar,
    calc, mod, quotient, cmp, or_, and_,
    if_, repeat, fn, call,
    combine, charAt, substr, indexOf, strLen, valueAt, replaceStr, isInList,
    when, obj, writeText,
} from '../../tools/lib/spec-dsl.mjs';

// ── 데이터 (authoring 시 JS 로 생성, 전역 — 여러 함수가 공유) ──────

// 11,172 음절 색인표.
const REF = Array.from({ length: 11172 }, (_, i) => String.fromCharCode(0xAC00 + i)).join('');

// 자모 표 (호환 자모).
const CHO   = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';                 // 초성 19
const JUNG_LIST = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ']; // 중성 21
const JONG_LIST = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']; // 종성 28 (idx0='')

const JUNG  = JUNG_LIST.join('');
const JONGX = JONG_LIST.slice(1).join('');   // assembleChar 용 — placeholder 없는 27 종성

// 겹모음/겹받침 분해표 — disassemble 가 es-hangul 처럼 자모를 끝까지 쪼개도록.
const JUNG_DECOMP = { 'ㅘ':'ㅗㅏ','ㅙ':'ㅗㅐ','ㅚ':'ㅗㅣ','ㅝ':'ㅜㅓ','ㅞ':'ㅜㅔ','ㅟ':'ㅜㅣ','ㅢ':'ㅡㅣ' };
const JONG_DECOMP = { 'ㄳ':'ㄱㅅ','ㄵ':'ㄴㅈ','ㄶ':'ㄴㅎ','ㄺ':'ㄹㄱ','ㄻ':'ㄹㅁ','ㄼ':'ㄹㅂ','ㄽ':'ㄹㅅ','ㄾ':'ㄹㅌ','ㄿ':'ㄹㅍ','ㅀ':'ㄹㅎ','ㅄ':'ㅂㅅ' };
const JUNGD = JUNG_LIST.map(j => JUNG_DECOMP[j] || j);            // 21
const JONGD = JONG_LIST.map(j => JONG_DECOMP[j] || j);            // 28, [0]=''

// 숫자/수사/날짜 표.
const DIGITS  = '일이삼사오육칠팔구';                              // 1-based: charAt(DIGITS, d)
const SUTENS  = ['열','스물','서른','마흔','쉰','예순','일흔','여든','아흔'];        // 10..90
const SUUNITS = ['하나','둘','셋','넷','다섯','여섯','일곱','여덟','아홉'];          // 1..9
const DAYS    = ['하루','이틀','사흘','나흘','닷새','엿새','이레','여드레','아흐레','열흘',
                 '열하루','열이틀','열사흘','열나흘','열닷새','열엿새','열이레','열여드레','열아흐레','스무날',
                 '스무하루','스무이틀','스무사흘','스무나흘','스무닷새','스무엿새','스무이레','스무여드레','스무아흐레','서른날']; // 1..30

// 겹모음 결합표 — combineVowels. PAIR 의 (2k-1, 2k) 두 글자 = COMB[k].
const VPAIR = 'ㅗㅏㅗㅐㅗㅣㅜㅓㅜㅔㅜㅣㅡㅣ';   // 결합 가능한 7쌍 (각 2글자)
const VCOMB = 'ㅘㅙㅚㅝㅞㅟㅢ';                  // 결합 결과 7개

// 서수사 — SEOSUSA_MAP/SPECIAL (1=첫·2=둘·20=스무 는 특수). ones 는 관형사형(한/두/셋…).
const SEO_TENS = ['열','스물','서른','마흔','쉰','예순','일흔','여든','아흔'];  // 10..90
const SEO_ONES = ['한','두','셋','넷','다섯','여섯','일곱','여덟','아홉'];      // 1..9

// 겹받침 결합표 — combineJong (assembleChar 의 2자모 종성 입력 합성). PAIR (2k-1,2k)=COMB[k].
// 순서 = JONG_DECOMP (ㄳ=ㄱㅅ … ㅄ=ㅂㅅ).
const JPAIR = 'ㄱㅅㄴㅈㄴㅎㄹㄱㄹㅁㄹㅂㄹㅅㄹㅌㄹㅍㄹㅎㅂㅅ';  // 11쌍
const JCOMB = 'ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ';                          // 11 겹받침

// QWERTY(두벌식) → 자모. 키(대소문자 모두) 평행문자열 + 대응 자모. 미매핑은 passthrough.
// 대문자=Shift: Q→ㅃ W→ㅉ E→ㄸ R→ㄲ T→ㅆ O→ㅒ P→ㅖ, 나머지는 소문자와 동일.
const QKEYS = 'qQwWeErRtTyYuUiIoOpPaAsSdDfFgGhHjJkKlLzZxXcCvVbBnNmM';
const QJAMO = 'ㅂㅃㅈㅉㄷㄸㄱㄲㅅㅆㅛㅛㅕㅕㅑㅑㅐㅒㅔㅖㅁㅁㄴㄴㅇㅇㄹㄹㅎㅎㅗㅗㅓㅓㅏㅏㅣㅣㅋㅋㅌㅌㅊㅊㅍㅍㅠㅠㅜㅜㅡㅡ';

// 한글 자모 → QWERTY 키 (convertHangulToQwerty). disassemble 출력(기본 자모)만 매핑.
const HJAMO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎㅏㅐㅑㅒㅓㅔㅕㅖㅗㅛㅜㅠㅡㅣ';
const HKEYS = 'rRseEfaqQtTdwWczxvgkoiOjpuPhynbml';

// ── 전역 변수 id 상수 (블록에서 참조) ─────────────────────────────

const REF_ID = 'ref0', CHO_ID = 'cho0', JUNG_ID = 'jung0', JONGX_ID = 'jngx';
const JUNGD_ID = 'jngd', JONGD_ID = 'jond', SUTENS_ID = 'sut0', SUUNITS_ID = 'suu0', DAYS_ID = 'day0';
const VPAIR_ID = 'vpr0', VCOMB_ID = 'vcm0', SEOTENS_ID = 'set0', SEOONES_ID = 'seo0';
const JPAIR_ID = 'jpr0', JCOMB_ID = 'jcm0', QKEYS_ID = 'qky0', QJAMO_ID = 'qjm0', HJAMO_ID = 'hjm0', HKEYS_ID = 'hky0';

// 결과 변수 (verify 가 이름으로 read). 숨김 — 표시는 textBox 가 담당.
const RESULTS = [
    ['r_cho1', '초성_라면'], ['r_cho2', '초성_안녕'],
    ['r_bat1', '받침_강'], ['r_bat2', '받침_나'],
    ['r_josa1', '조사_사과'], ['r_josa2', '조사_책'], ['r_josa3', '조사_지하철'], ['r_josa4', '조사_집'],
    ['r_dis', '분해_값'], ['r_asm', '조합_한'],
    ['r_num1', '숫자_19834'], ['r_num2', '숫자_100'],
    ['r_susa', '수사_23'], ['r_days', '날짜_3'],
    ['p_ga', '프로브_가'], ['p_hih', '프로브_힣'], ['p_miss', '프로브_없음'],
    // 쉬움 그룹
    ['cb_cho', '초성가능_ㄱ'], ['cb_chox', '초성가능_ㅏ'],
    ['cb_jung', '중성가능_ㅏ'], ['cb_jungx', '중성가능_ㄱ'],
    ['cb_jong', '종성가능_ㄳ'], ['cb_jongx', '종성가능_ㅃ'],
    ['r_cv1', '겹모음_ㅗㅏ'], ['r_cv2', '겹모음_ㅗㅛ'],
    ['r_dsm', '분해문자열_안녕'], ['r_dgr', '분해그룹_값이'],
    ['r_dcc', '완성분해_값'], ['r_dcc2', '완성분해_가'],
    ['r_rl1', '지우기_전화'], ['r_rl2', '지우기_값'], ['r_rl3', '지우기_가'], ['r_rl4', '지우기_신세계'],
    ['r_mx1', '혼합_19834'], ['r_mx2', '혼합_305'],
    ['r_am1', '금액_1234'], ['r_am2', '금액_10000'],
    ['r_se1', '서수_1'], ['r_se2', '서수_2'], ['r_se3', '서수_11'], ['r_se4', '서수_20'], ['r_se5', '서수_21'],
    // 1~4번 (자판/조합)
    ['cb_jung2', '중성가능_ㅗㅏ'], ['cb_jong2', '종성가능_ㄱㅅ'],
    ['r_asm1', '조합_안녕'], ['r_asm2', '조합_갑자'], ['r_asm3', '조합_과'],
    ['r_q2a1', '자모_gks'], ['r_q2a2', '자모_Qkr'],
    ['r_h2q1', '키_한글'], ['r_h2q2', '키_겨노'],
    ['r_q2h1', '입력_dkssud'], ['r_q2h2', '입력_gksrmf'], ['r_q2h3', '입력_gksrmf2'],
];

// ── 빌드 헬퍼 ─────────────────────────────────────────────────────

// 여러 문자열 이어붙이기 (combine 폴드).
const cat = (...parts) => parts.reduce((a, b) => combine(a, b));

// **센티넬 시드** — 엔트리 함수 지역변수는 빈 문자열을 저장 못 함 (set_func_variable('')
// → 읽으면 0). 그래서 문자열 누산기 'out' 은 빈 문자열 대신 SEED(PUA 문자, 데이터에 없음)
// 로 시작하고, 반환 직전 flush 로 제거 → 지역변수가 한 번도 비지 않음.
// (knowledge/04-script-and-blocks.md "함수 지역 변수" 의 빈 문자열 함정 참고.)
const SEED = '';
const seedOut = (L) => L.set('out', txt(SEED));
const flush = (L) => replaceStr(L.get('out'), txt(SEED), txt(''));   // 반환값: SEED 제거한 문자열

// numberToHangul: 그룹 사이 공백 — 지역변수 out 에 (SEED 외) 내용이 있을 때만 (strLen > 1).
const addSep = (L) => if_(cmp(strLen(L.get('out')), '>', 1), [L.set('out', cat(L.get('out'), txt(' ')))]);

// grp: 자릿수 한 자리 처리 (천/백/십). 선행 1 은 생략 (천, not 일천). digit 은 지역변수 이름.
const placeBlock = (L, digit, placeChar) =>
    if_(cmp(L.get(digit), '>', 0),
        [if_(cmp(L.get(digit), '==', 1),
            [L.set('out', cat(L.get('out'), txt(placeChar)))],
            [L.set('out', cat(L.get('out'), charAt(txt(DIGITS), L.get(digit)), txt(placeChar)))]
        )]
    );

// ── 함수 정의 (스크래치는 전부 함수 지역 변수 — fn.value 의 locals + L) ──

const functions = [
    // grp(g): 0..9999 한 그룹 → 한글 (천백십일). numberToHangul/amountToHangul 보조.
    fn.value('grp', ['g'], (g, L) => [
        seedOut(L),
        L.set('th', quotient(g, 1000)),
        L.set('hu', mod(quotient(g, 100), 10)),
        L.set('te', mod(quotient(g, 10), 10)),
        L.set('on', mod(g, 10)),
        placeBlock(L, 'th', '천'),
        placeBlock(L, 'hu', '백'),
        placeBlock(L, 'te', '십'),
        if_(cmp(L.get('on'), '>', 0), [L.set('out', cat(L.get('out'), charAt(txt(DIGITS), L.get('on'))))]),
    ], (g, L) => flush(L), ['out', 'th', 'hu', 'te', 'on']),

    // numberToHangul(n): 0..(10^12-1) 까지 억/만/일 그룹. 예: 19834 → '일만 구천팔백삼십사'
    fn.value('numberToHangul', ['n'], (n, L) => [
        seedOut(L),
        if_(cmp(n, '==', 0),
            [L.set('out', txt('영'))],
            [
                L.set('eok', quotient(n, 100000000)),
                L.set('rem', mod(n, 100000000)),
                L.set('man', quotient(L.get('rem'), 10000)),
                L.set('one', mod(L.get('rem'), 10000)),
                if_(cmp(L.get('eok'), '>', 0), [L.set('out', cat(L.get('out'), call('grp', L.get('eok')), txt('억')))]),
                if_(cmp(L.get('man'), '>', 0), [addSep(L), L.set('out', cat(L.get('out'), call('grp', L.get('man')), txt('만')))]),
                if_(cmp(L.get('one'), '>', 0), [addSep(L), L.set('out', cat(L.get('out'), call('grp', L.get('one'))))]),
            ]
        ),
    ], (n, L) => flush(L), ['out', 'eok', 'rem', 'man', 'one']),

    // getChoseong(s): 각 글자의 초성을 이어붙임. 비한글은 그대로. 예: '라면' → 'ㄹㅁ'
    fn.value('getChoseong', ['s'], (s, L) => [
        seedOut(L),
        L.set('i', num(0)),
        repeat.basic(strLen(s), [
            L.change('i', 1),
            L.set('ch', charAt(s, L.get('i'))),
            L.set('pos', indexOf(getVar(REF_ID), L.get('ch'))),
            if_(cmp(L.get('pos'), '>', 0),
                [
                    L.set('off', calc(L.get('pos'), '-', 1)),
                    L.set('cho', quotient(L.get('off'), 588)),
                    L.set('out', cat(L.get('out'), charAt(getVar(CHO_ID), calc(L.get('cho'), '+', 1)))),
                ],
                [L.set('out', cat(L.get('out'), L.get('ch')))]
            ),
        ]),
    ], (s, L) => flush(L), ['out', 'i', 'ch', 'pos', 'off', 'cho']),

    // hasBatchim(s): 마지막 글자에 받침이 있으면 1, 없으면 0.
    fn.value('hasBatchim', ['s'], (s, L) => [
        L.set('last', charAt(s, strLen(s))),
        L.set('pos', indexOf(getVar(REF_ID), L.get('last'))),
        if_(cmp(L.get('pos'), '>', 0),
            [if_(cmp(mod(calc(L.get('pos'), '-', 1), 28), '!=', 0), [L.set('out', num(1))], [L.set('out', num(0))])],
            [L.set('out', num(0))]
        ),
    ], (s, L) => flush(L), ['last', 'pos', 'out']),

    // josa(word, pair): 받침에 맞는 조사 붙이기. pair 예: '을/를'. 으로/로 ㄹ 예외 처리.
    fn.value('josa', ['word', 'pair'], (word, pair, L) => [
        L.set('last', charAt(word, strLen(word))),
        L.set('pos', indexOf(getVar(REF_ID), L.get('last'))),
        L.set('jong', num(0)),
        if_(cmp(L.get('pos'), '>', 0), [L.set('jong', mod(calc(L.get('pos'), '-', 1), 28))]),
        L.set('slash', indexOf(pair, txt('/'))),
        L.set('first', substr(pair, num(1), calc(L.get('slash'), '-', 1))),
        L.set('second', substr(pair, calc(L.get('slash'), '+', 1), strLen(pair))),
        if_(cmp(L.get('second'), '==', txt('로')),
            // 으로/로: 받침 없음(0) 또는 ㄹ받침(8) → 로(second), else 으로(first)
            [if_(or_(cmp(L.get('jong'), '==', 0), cmp(L.get('jong'), '==', 8)), [L.set('part', L.get('second'))], [L.set('part', L.get('first'))])],
            // 일반: 받침 있으면 first, 없으면 second
            [if_(cmp(L.get('jong'), '!=', 0), [L.set('part', L.get('first'))], [L.set('part', L.get('second'))])]
        ),
        L.set('out', cat(word, L.get('part'))),
    ], (word, pair, L) => flush(L), ['last', 'pos', 'jong', 'slash', 'first', 'second', 'part', 'out']),

    // disassembleChar(c): 한 글자 → 자모 분해 (겹받침/겹모음까지). 예: '값' → 'ㄱㅏㅂㅅ'.
    // 완성형 음절이 아니면, 단독 합성 자모(ㅘ→ㅗㅏ, ㄳ→ㄱㅅ)도 분해. 단순 자모/비한글은 그대로.
    fn.value('disassembleChar', ['c'], (c, L) => [
        L.set('pos', indexOf(getVar(REF_ID), c)),
        if_(cmp(L.get('pos'), '>', 0),
            [
                L.set('off', calc(L.get('pos'), '-', 1)),
                L.set('cho', quotient(L.get('off'), 588)),
                L.set('jung', quotient(mod(L.get('off'), 588), 28)),
                L.set('jong', mod(L.get('off'), 28)),
                L.set('out', cat(
                    charAt(getVar(CHO_ID), calc(L.get('cho'), '+', 1)),
                    valueAt(JUNGD_ID, calc(L.get('jung'), '+', 1)),
                    valueAt(JONGD_ID, calc(L.get('jong'), '+', 1))
                )),
            ],
            [
                L.set('vp', indexOf(getVar(VCOMB_ID), c)),   // 겹모음 위치
                L.set('jp', indexOf(getVar(JCOMB_ID), c)),   // 겹받침 위치
                if_(cmp(L.get('vp'), '>', 0),
                    [L.set('out', substr(getVar(VPAIR_ID), calc(calc(calc(L.get('vp'), '-', 1), '*', 2), '+', 1), calc(L.get('vp'), '*', 2)))],
                    [if_(cmp(L.get('jp'), '>', 0),
                        [L.set('out', substr(getVar(JPAIR_ID), calc(calc(calc(L.get('jp'), '-', 1), '*', 2), '+', 1), calc(L.get('jp'), '*', 2)))],
                        [L.set('out', c)]
                    )]
                ),
            ]
        ),
    ], (c, L) => flush(L), ['pos', 'off', 'cho', 'jung', 'jong', 'vp', 'jp', 'out']),

    // assembleChar(cho, jung, jong) = es-hangul combineCharacter. 초/중/종성 자모 → 음절.
    // jung 은 단일('ㅏ') 또는 2자모 겹모음('ㅗㅏ'), jong 은 ''·단일('ㄱ')·2자모 겹받침('ㄱㅅ').
    fn.value('assembleChar', ['cho', 'jung', 'jong'], (cho, jung, jong, L) => [
        // 2자모 겹모음/겹받침이면 단일 합성 자모로 먼저 결합
        L.set('jv', jung),
        if_(cmp(strLen(jung), '==', 2), [L.set('jv', call('combineVowels', charAt(jung, num(1)), charAt(jung, num(2))))]),
        L.set('kv', jong),
        if_(cmp(strLen(jong), '==', 2), [L.set('kv', call('combineJong', charAt(jong, num(1)), charAt(jong, num(2))))]),
        L.set('ci', calc(indexOf(getVar(CHO_ID), cho), '-', 1)),
        L.set('ji', calc(indexOf(getVar(JUNG_ID), L.get('jv')), '-', 1)),
        L.set('ki', num(0)),
        if_(cmp(strLen(L.get('kv')), '>', 0), [L.set('ki', indexOf(getVar(JONGX_ID), L.get('kv')))]),
        L.set('out', charAt(getVar(REF_ID),
            calc(calc(calc(L.get('ci'), '*', 588), '+', calc(L.get('ji'), '*', 28)), '+', calc(L.get('ki'), '+', 1))
        )),
    ], (cho, jung, jong, L) => flush(L), ['jv', 'kv', 'ci', 'ji', 'ki', 'out']),

    // susa(n): 1..99 순우리말 수사. 예: 23 → '스물셋'
    fn.value('susa', ['n'], (n, L) => [
        seedOut(L),
        L.set('te', quotient(n, 10)),
        L.set('on', mod(n, 10)),
        if_(cmp(L.get('te'), '>', 0), [L.set('out', cat(L.get('out'), valueAt(SUTENS_ID, L.get('te'))))]),
        if_(cmp(L.get('on'), '>', 0), [L.set('out', cat(L.get('out'), valueAt(SUUNITS_ID, L.get('on'))))]),
    ], (n, L) => flush(L), ['out', 'te', 'on']),

    // days(n): 1..30 순우리말 날짜. 예: 3 → '사흘' (지역변수 불필요)
    fn.value('days', ['n'], () => [], (n) => valueAt(DAYS_ID, n)),

    // ── 쉬움 그룹 (같은 트릭 재사용) ──────────────────────────────

    // canBeChoseong/Jungseong/Jongseong(c): 해당 자모로 쓸 수 있으면 1, 아니면 0.
    fn.value('canBeChoseong', ['c'], (c, L) => [
        if_(cmp(indexOf(getVar(CHO_ID), c), '>', 0), [L.set('out', num(1))], [L.set('out', num(0))]),
    ], (c, L) => L.get('out'), ['out']),
    // 중성/종성 유효성 — es-hangul JUNGSEONGS/JONGSEONGS(=분해형 JUNGD/JONGD) 멤버십.
    // 그래서 canBeJungseong('ㅗㅏ')=1, canBeJongseong('ㄱㅅ')=1 이지만 합성형 'ㅘ'/'ㄳ'=0 (es-hangul 동일).
    fn.value('canBeJungseong', ['c'], (c, L) => [
        if_(isInList(JUNGD_ID, c), [L.set('out', num(1))], [L.set('out', num(0))]),
    ], (c, L) => L.get('out'), ['out']),
    fn.value('canBeJongseong', ['c'], (c, L) => [
        if_(isInList(JONGD_ID, c), [L.set('out', num(1))], [L.set('out', num(0))]),
    ], (c, L) => L.get('out'), ['out']),

    // combineVowels(v1, v2): 두 모음 → 겹모음. 결합 불가면 단순 연결. 예: ㅗ+ㅏ → ㅘ
    fn.value('combineVowels', ['v1', 'v2'], (v1, v2, L) => [
        L.set('key', cat(v1, v2)),
        L.set('pos', indexOf(getVar(VPAIR_ID), L.get('key'))),
        if_(and_(cmp(L.get('pos'), '>', 0), cmp(mod(L.get('pos'), 2), '==', 1)),
            [L.set('out', charAt(getVar(VCOMB_ID), calc(quotient(L.get('pos'), 2), '+', 1)))],
            [L.set('out', L.get('key'))]
        ),
    ], (v1, v2, L) => flush(L), ['key', 'pos', 'out']),

    // combineJong(a, b): 두 받침 자모 → 겹받침. assembleChar 보조. 예: ㄱ+ㅅ → ㄳ
    fn.value('combineJong', ['a', 'b'], (a, b, L) => [
        L.set('key', cat(a, b)),
        L.set('pos', indexOf(getVar(JPAIR_ID), L.get('key'))),
        if_(and_(cmp(L.get('pos'), '>', 0), cmp(mod(L.get('pos'), 2), '==', 1)),
            [L.set('out', charAt(getVar(JCOMB_ID), calc(quotient(L.get('pos'), 2), '+', 1)))],
            [L.set('out', L.get('key'))]
        ),
    ], (a, b, L) => flush(L), ['key', 'pos', 'out']),

    // disassemble(s): 문자열 전체를 자모로 분해. 예: '안녕' → 'ㅇㅏㄴㄴㅕㅇ'
    fn.value('disassemble', ['s'], (s, L) => [
        seedOut(L),
        L.set('i', num(0)),
        repeat.basic(strLen(s), [
            L.change('i', 1),
            L.set('out', cat(L.get('out'), call('disassembleChar', charAt(s, L.get('i'))))),
        ]),
    ], (s, L) => flush(L), ['out', 'i']),

    // disassembleToGroups(s): 글자별 자모 그룹을 '/' 로 구분. 예: '값이' → 'ㄱㅏㅂㅅ/ㅇㅣ'
    fn.value('disassembleToGroups', ['s'], (s, L) => [
        seedOut(L),
        L.set('i', num(0)),
        repeat.basic(strLen(s), [
            L.change('i', 1),
            if_(cmp(L.get('i'), '>', 1), [L.set('out', cat(L.get('out'), txt('/')))]),
            L.set('out', cat(L.get('out'), call('disassembleChar', charAt(s, L.get('i'))))),
        ]),
    ], (s, L) => flush(L), ['out', 'i']),

    // disassembleCompleteCharacter(c): 완성형 한 글자 → 초/중/종성(겹자모 유지) '/' 구분.
    // 예: '값' → 'ㄱ/ㅏ/ㅄ', '가' → 'ㄱ/ㅏ/'
    fn.value('disassembleCompleteCharacter', ['c'], (c, L) => [
        L.set('pos', indexOf(getVar(REF_ID), c)),
        if_(cmp(L.get('pos'), '>', 0),
            [
                L.set('off', calc(L.get('pos'), '-', 1)),
                L.set('cho', quotient(L.get('off'), 588)),
                L.set('jung', quotient(mod(L.get('off'), 588), 28)),
                L.set('jong', mod(L.get('off'), 28)),
                L.set('out', cat(
                    charAt(getVar(CHO_ID), calc(L.get('cho'), '+', 1)), txt('/'),
                    charAt(getVar(JUNG_ID), calc(L.get('jung'), '+', 1)), txt('/')
                )),
                if_(cmp(L.get('jong'), '>', 0), [L.set('out', cat(L.get('out'), charAt(getVar(JONGX_ID), L.get('jong'))))]),
            ],
            [L.set('out', c)]
        ),
    ], (c, L) => flush(L), ['pos', 'off', 'cho', 'jung', 'jong', 'out']),

    // removeLastCharacter(s): 마지막 자모 하나 제거(받침→중성→초성 단계). 예: '전화'→'전호', '값'→'갑', '가'→'ㄱ'
    fn.value('removeLastCharacter', ['s'], (s, L) => [
        L.set('prefix', txt(SEED)),   // SEED 시드 — 단일글자 입력 시 prefix 빈 문자열 회피
        if_(cmp(strLen(s), '>', 1), [L.set('prefix', cat(txt(SEED), substr(s, num(1), calc(strLen(s), '-', 1))))]),
        L.set('last', charAt(s, strLen(s))),
        L.set('pos', indexOf(getVar(REF_ID), L.get('last'))),
        if_(cmp(L.get('pos'), '==', 0),
            [L.set('out', L.get('prefix'))],   // 완성형 아님 → 그냥 한 글자 제거
            [
                L.set('off', calc(L.get('pos'), '-', 1)),
                L.set('cho', quotient(L.get('off'), 588)),
                L.set('jung', quotient(mod(L.get('off'), 588), 28)),
                L.set('jong', mod(L.get('off'), 28)),
                L.set('cc', charAt(getVar(CHO_ID), calc(L.get('cho'), '+', 1))),   // 초성 글자
                L.set('jc', charAt(getVar(JUNG_ID), calc(L.get('jung'), '+', 1))), // 중성 글자
                if_(cmp(L.get('jong'), '>', 0),
                    [
                        L.set('sub', valueAt(JONGD_ID, calc(L.get('jong'), '+', 1))),  // 종성 분해 ('ㅂㅅ' or 'ㄱ')
                        if_(cmp(strLen(L.get('sub')), '==', 2),
                            [L.set('out', cat(L.get('prefix'), call('assembleChar', L.get('cc'), L.get('jc'), charAt(L.get('sub'), num(1)))))],
                            [L.set('out', cat(L.get('prefix'), call('assembleChar', L.get('cc'), L.get('jc'), txt(''))))]
                        ),
                    ],
                    [
                        L.set('sub', valueAt(JUNGD_ID, calc(L.get('jung'), '+', 1))),  // 중성 분해 ('ㅗㅏ' or 'ㅏ')
                        if_(cmp(strLen(L.get('sub')), '==', 2),
                            [L.set('out', cat(L.get('prefix'), call('assembleChar', L.get('cc'), charAt(L.get('sub'), num(1)), txt(''))))],
                            [L.set('out', cat(L.get('prefix'), L.get('cc')))]   // 초성만 남음
                        ),
                    ]
                ),
            ]
        ),
    ], (s, L) => flush(L), ['prefix', 'last', 'pos', 'off', 'cho', 'jung', 'jong', 'cc', 'jc', 'sub', 'out']),

    // mixGroup(v): 0..9999 한 그룹을 toLocaleString 처럼 천단위 콤마 표기. numberToHangulMixed 보조.
    fn.value('mixGroup', ['v'], (v, L) => [
        if_(cmp(v, '<', 1000),
            [L.set('out', v)],
            [
                L.set('r', mod(v, 1000)),
                if_(cmp(L.get('r'), '<', 10),
                    [L.set('p', cat(txt('00'), L.get('r')))],
                    [if_(cmp(L.get('r'), '<', 100), [L.set('p', cat(txt('0'), L.get('r')))], [L.set('p', L.get('r'))])]
                ),
                L.set('out', cat(quotient(v, 1000), txt(','), L.get('p'))),
            ]
        ),
    ], (v, L) => flush(L), ['out', 'r', 'p']),

    // numberToHangulMixed(n): 4자리 그룹은 아라비아 숫자, 만/억만 한글. 예: 19834 → '1만9,834'
    fn.value('numberToHangulMixed', ['n'], (n, L) => [
        seedOut(L),
        if_(cmp(n, '==', 0), [L.set('out', txt('0'))], [
            L.set('eok', quotient(n, 100000000)),
            L.set('man', mod(quotient(n, 10000), 10000)),
            L.set('one', mod(n, 10000)),
            if_(cmp(L.get('eok'), '>', 0), [L.set('out', cat(L.get('out'), call('mixGroup', L.get('eok')), txt('억')))]),
            if_(cmp(L.get('man'), '>', 0), [L.set('out', cat(L.get('out'), call('mixGroup', L.get('man')), txt('만')))]),
            if_(cmp(L.get('one'), '>', 0), [L.set('out', cat(L.get('out'), call('mixGroup', L.get('one'))))]),
        ]),
    ], (n, L) => flush(L), ['out', 'eok', 'man', 'one']),

    // amountToHangul(n): 금액 표기 — numberToHangul 과 같되 그룹 사이 공백 없음(정수부). 예: 1234 → '천이백삼십사', 10000 → '일만'
    fn.value('amountToHangul', ['n'], (n, L) => [
        seedOut(L),
        if_(cmp(n, '==', 0), [L.set('out', txt('영'))], [
            L.set('eok', quotient(n, 100000000)),
            L.set('man', mod(quotient(n, 10000), 10000)),
            L.set('one', mod(n, 10000)),
            if_(cmp(L.get('eok'), '>', 0), [L.set('out', cat(L.get('out'), call('grp', L.get('eok')), txt('억')))]),
            if_(cmp(L.get('man'), '>', 0), [L.set('out', cat(L.get('out'), call('grp', L.get('man')), txt('만')))]),
            if_(cmp(L.get('one'), '>', 0), [L.set('out', cat(L.get('out'), call('grp', L.get('one'))))]),
        ]),
    ], (n, L) => flush(L), ['out', 'eok', 'man', 'one']),

    // seosusa(n): 서수사. 1=첫째·2=둘째·20=스무째 특수, 그 외 10단위+1단위(관형사형)+째. 100↑은 numberToHangul+째.
    fn.value('seosusa', ['n'], (n, L) => [
        if_(cmp(n, '==', 1), [L.set('out', txt('첫째'))],
            [if_(cmp(n, '==', 2), [L.set('out', txt('둘째'))],
                [if_(cmp(n, '==', 20), [L.set('out', txt('스무째'))],
                    [if_(cmp(n, '<=', 99),
                        [
                            L.set('te', quotient(n, 10)),
                            L.set('on', mod(n, 10)),
                            seedOut(L),
                            if_(cmp(L.get('te'), '>', 0), [L.set('out', cat(L.get('out'), valueAt(SEOTENS_ID, L.get('te'))))]),
                            if_(cmp(L.get('on'), '>', 0), [L.set('out', cat(L.get('out'), valueAt(SEOONES_ID, L.get('on'))))]),
                            L.set('out', cat(L.get('out'), txt('째'))),
                        ],
                        [L.set('out', cat(call('numberToHangul', n), txt('째')))]
                    )]
                )]
            )]
        ),
    ], (n, L) => flush(L), ['out', 'te', 'on']),

    // ── assemble (자모 조합 IME) — es-hangul _internal/hangul.ts 포팅 ────

    // binAlpha(src, next): 단일 자모 두 개 결합. (binaryAssembleAlphabets)
    fn.value('binAlpha', ['src', 'next'], (src, next, L) => [
        if_(isInList(JUNGD_ID, cat(src, next)),
            [L.set('out', call('combineVowels', src, next))],                       // 두 모음 → 겹모음
            [if_(and_(cmp(call('canBeChoseong', src), '==', 1), cmp(call('canBeJungseong', next), '==', 1)),
                [L.set('out', call('assembleChar', src, next, txt('')))],           // 자음+모음 → 음절
                [L.set('out', cat(src, next))]                                      // 결합 불가 → 연결
            )]
        ),
    ], (src, next, L) => flush(L), ['out']),

    // linkHangul(src, next): 연음 — src 의 받침을 떼어 next 와 새 음절. (linkHangulCharacters)
    fn.value('linkHangul', ['src', 'next'], (src, next, L) => [
        L.set('ds', call('disassembleChar', src)),
        L.set('last', charAt(L.get('ds'), strLen(L.get('ds')))),
        L.set('out', cat(call('removeLastCharacter', src), call('assembleChar', L.get('last'), next, txt('')))),
    ], (src, next, L) => flush(L), ['ds', 'last', 'out']),

    // binChars(src, next): 한 글자(src)에 자모(next) 하나 결합. (binaryAssembleCharacters)
    fn.value('binChars', ['src', 'next'], (src, next, L) => [
        L.set('ds', call('disassembleChar', src)),
        L.set('len', strLen(L.get('ds'))),
        if_(cmp(L.get('len'), '==', 1),
            [L.set('out', call('binAlpha', src, next))],
            [
                L.set('last', charAt(L.get('ds'), L.get('len'))),
                L.set('sec', charAt(L.get('ds'), calc(L.get('len'), '-', 1))),
                L.set('j1', charAt(L.get('ds'), num(1))),
                if_(and_(cmp(call('canBeChoseong', L.get('last')), '==', 1), cmp(call('canBeJungseong', next), '==', 1)),
                    [L.set('out', call('linkHangul', src, next))],                                  // 연음
                    [if_(isInList(JUNGD_ID, cat(L.get('last'), next)),
                        [L.set('out', call('assembleChar', L.get('j1'), cat(L.get('last'), next), txt('')))],   // 끝모음+모음=겹모음
                        [if_(and_(isInList(JUNGD_ID, cat(L.get('sec'), L.get('last'))), cmp(call('canBeJongseong', next), '==', 1)),
                            [L.set('out', call('assembleChar', L.get('j1'), cat(L.get('sec'), L.get('last')), next))], // 겹모음+받침
                            [if_(and_(isInList(JUNGD_ID, L.get('last')), cmp(call('canBeJongseong', next), '==', 1)),
                                [L.set('out', call('assembleChar', L.get('j1'), L.get('last'), next))],           // 모음+받침
                                [
                                    // case 6: 단일받침 + (받침+next 가 겹받침) → 겹받침
                                    L.set('jv', charAt(L.get('ds'), num(2))),
                                    if_(cmp(L.get('len'), '>=', 4),
                                        [if_(isInList(JUNGD_ID, cat(charAt(L.get('ds'), num(2)), charAt(L.get('ds'), num(3)))),
                                            [L.set('jv', cat(charAt(L.get('ds'), num(2)), charAt(L.get('ds'), num(3))))])]),
                                    L.set('hb', num(0)),
                                    L.set('sp', indexOf(getVar(REF_ID), src)),
                                    if_(cmp(L.get('sp'), '>', 0), [
                                        L.set('jo', mod(calc(L.get('sp'), '-', 1), 28)),
                                        if_(and_(cmp(L.get('jo'), '>', 0), cmp(strLen(valueAt(JONGD_ID, calc(L.get('jo'), '+', 1))), '==', 1)),
                                            [L.set('hb', num(1))]),
                                    ]),
                                    if_(and_(cmp(L.get('hb'), '==', 1), cmp(call('canBeJongseong', cat(L.get('last'), next)), '==', 1)),
                                        [L.set('out', call('assembleChar', L.get('j1'), L.get('jv'), cat(L.get('last'), next)))],
                                        [L.set('out', cat(src, next))]                              // joinString
                                    ),
                                ]
                            )]
                        )]
                    )]
                ),
            ]
        ),
    ], (src, next, L) => flush(L), ['ds', 'len', 'last', 'sec', 'j1', 'jv', 'hb', 'sp', 'jo', 'out']),

    // binAssemble(acc, next): 누적 문자열의 마지막 글자에 next 결합. (binaryAssemble)
    // SEED 보존 위해 flush 안 함 (assemble 이 최종 flush).
    fn.value('binAssemble', ['acc', 'next'], (acc, next, L) => [
        L.set('len', strLen(acc)),
        L.set('last', charAt(acc, L.get('len'))),
        // comb = 마지막 글자에 next 결합 (공백이면 단순 연결). 항상 비어있지 않음.
        if_(or_(cmp(L.get('last'), '==', txt(' ')), cmp(next, '==', txt(' '))),
            [L.set('comb', cat(L.get('last'), next))],
            [L.set('comb', call('binChars', L.get('last'), next))]
        ),
        // 앞부분 + comb. len==1 이면 앞부분 없음 (빈 문자열 set → '0' 함정 회피).
        if_(cmp(L.get('len'), '>', 1),
            [L.set('out', cat(substr(acc, num(1), calc(L.get('len'), '-', 1)), L.get('comb')))],
            [L.set('out', L.get('comb'))]
        ),
    ], (acc, next, L) => L.get('out'), ['len', 'last', 'comb', 'out']),

    // assemble(s): 문자열을 분해 후 자모를 순서대로 결합. 예: 'ㅇㅏㄴㄴㅕㅇ' → '안녕'
    // ⚠️ disassemble(루프 함수)를 중첩 호출하면 조기 반환 → 분해를 **인라인**
    // (루프 없는 disassembleChar/binAssemble 만 중첩). jamo 는 SEED 로 시작, reduce 는 2번째 글자부터.
    fn.value('assemble', ['s'], (s, L) => [
        L.set('jamo', txt(SEED)),
        L.set('k', num(0)),
        repeat.basic(strLen(s), [
            L.change('k', 1),
            L.set('jamo', cat(L.get('jamo'), call('disassembleChar', charAt(s, L.get('k'))))),
        ]),
        seedOut(L),                                  // acc = SEED
        L.set('i', num(1)),
        repeat.basic(calc(strLen(L.get('jamo')), '-', 1), [
            L.change('i', 1),
            L.set('out', call('binAssemble', L.get('out'), charAt(L.get('jamo'), L.get('i')))),
        ]),
    ], (s, L) => flush(L), ['jamo', 'k', 'i', 'out']),

    // ── 키보드 변환 ──────────────────────────────────────────────

    // convertQwertyToAlphabet(s): QWERTY 키 → 자모 (조합 안 함). 미매핑은 그대로. 예: 'gks'→'ㅎㅏㄴ'
    fn.value('convertQwertyToAlphabet', ['s'], (s, L) => [
        seedOut(L),
        L.set('i', num(0)),
        repeat.basic(strLen(s), [
            L.change('i', 1),
            L.set('c', charAt(s, L.get('i'))),
            L.set('pos', indexOf(getVar(QKEYS_ID), L.get('c'))),
            if_(cmp(L.get('pos'), '>', 0),
                [L.set('out', cat(L.get('out'), charAt(getVar(QJAMO_ID), L.get('pos'))))],
                [L.set('out', cat(L.get('out'), L.get('c')))]
            ),
        ]),
    ], (s, L) => flush(L), ['i', 'c', 'pos', 'out']),

    // convertHangulToQwerty(s): 한글 → QWERTY 키. 분해 인라인 후 자모별 키 룩업. 예: '한글'→'gksrmf'
    fn.value('convertHangulToQwerty', ['s'], (s, L) => [
        L.set('jamo', txt(SEED)),
        L.set('k', num(0)),
        repeat.basic(strLen(s), [
            L.change('k', 1),
            L.set('jamo', cat(L.get('jamo'), call('disassembleChar', charAt(s, L.get('k'))))),
        ]),
        seedOut(L),
        L.set('i', num(1)),
        repeat.basic(calc(strLen(L.get('jamo')), '-', 1), [
            L.change('i', 1),
            L.set('c', charAt(L.get('jamo'), L.get('i'))),
            L.set('pos', indexOf(getVar(HJAMO_ID), L.get('c'))),
            if_(cmp(L.get('pos'), '>', 0),
                [L.set('out', cat(L.get('out'), charAt(getVar(HKEYS_ID), L.get('pos'))))],
                [L.set('out', cat(L.get('out'), L.get('c')))]
            ),
        ]),
    ], (s, L) => flush(L), ['jamo', 'k', 'i', 'c', 'pos', 'out']),

    // convertQwertyToHangul(s): QWERTY 입력 → 한글. 자모 매핑 + assemble 둘 다 인라인
    // (assemble·convertQwertyToAlphabet 은 루프 함수라 중첩 호출 불가 → binAssemble 만 중첩).
    fn.value('convertQwertyToHangul', ['s'], (s, L) => [
        L.set('jamo', txt(SEED)),
        L.set('k', num(0)),
        repeat.basic(strLen(s), [
            L.change('k', 1),
            L.set('c', charAt(s, L.get('k'))),
            L.set('pos', indexOf(getVar(QKEYS_ID), L.get('c'))),
            if_(cmp(L.get('pos'), '>', 0),
                [L.set('jamo', cat(L.get('jamo'), charAt(getVar(QJAMO_ID), L.get('pos'))))],
                [L.set('jamo', cat(L.get('jamo'), L.get('c')))]
            ),
        ]),
        seedOut(L),
        L.set('i', num(1)),
        repeat.basic(calc(strLen(L.get('jamo')), '-', 1), [
            L.change('i', 1),
            L.set('out', call('binAssemble', L.get('out'), charAt(L.get('jamo'), L.get('i')))),
        ]),
    ], (s, L) => flush(L), ['jamo', 'k', 'c', 'pos', 'i', 'out']),
];

// ── 변수 / 리스트 (전역만 — 스크래치는 함수 지역으로 이동) ────────

const dataVars = [
    { id: REF_ID, name: 'REF', value: REF, visible: false },
    { id: CHO_ID, name: 'CHO', value: CHO, visible: false },
    { id: JUNG_ID, name: 'JUNG', value: JUNG, visible: false },
    { id: JONGX_ID, name: 'JONGX', value: JONGX, visible: false },
    { id: VPAIR_ID, name: 'VPAIR', value: VPAIR, visible: false },
    { id: VCOMB_ID, name: 'VCOMB', value: VCOMB, visible: false },
    { id: JPAIR_ID, name: 'JPAIR', value: JPAIR, visible: false },
    { id: JCOMB_ID, name: 'JCOMB', value: JCOMB, visible: false },
    { id: QKEYS_ID, name: 'QKEYS', value: QKEYS, visible: false },
    { id: QJAMO_ID, name: 'QJAMO', value: QJAMO, visible: false },
    { id: HJAMO_ID, name: 'HJAMO', value: HJAMO, visible: false },
    { id: HKEYS_ID, name: 'HKEYS', value: HKEYS, visible: false },
];
const resultVars = RESULTS.map(([id, name]) => ({ id, name, value: '', visible: false }));

const lists = [
    { id: JUNGD_ID, name: 'JUNGD', array: JUNGD, visible: false },
    { id: JONGD_ID, name: 'JONGD', array: JONGD, visible: false },
    { id: SUTENS_ID, name: 'SUTENS', array: SUTENS, visible: false },
    { id: SUUNITS_ID, name: 'SUUNITS', array: SUUNITS, visible: false },
    { id: DAYS_ID, name: 'DAYS', array: DAYS, visible: false },
    { id: SEOTENS_ID, name: 'SEOTENS', array: SEO_TENS, visible: false },
    { id: SEOONES_ID, name: 'SEOONES', array: SEO_ONES, visible: false },
];

// ── 데모 오브젝트 (textBox 가 계산 + 표시) ────────────────────────

const board = obj('board', '결과판', {
    objectType: 'textBox',
    text: '실행(▶) 을 누르면 es-hangul 함수 결과가 표시됩니다',
    entity: {
        x: -150, y: 0, regX: 0, regY: 0, scaleX: 1, scaleY: 1,
        width: 320, height: 360, font: '16px NanumGothic',
        bgColor: '#0f172a', colour: '#e2e8f0', visible: true,
    },
    script: [
        when.run(),
        // 계산 — 각 함수를 샘플 입력으로 호출.
        setVar('r_cho1', call('getChoseong', txt('라면'))),
        setVar('r_cho2', call('getChoseong', txt('안녕하세요'))),
        setVar('r_bat1', call('hasBatchim', txt('강'))),
        setVar('r_bat2', call('hasBatchim', txt('나'))),
        setVar('r_josa1', call('josa', txt('사과'), txt('을/를'))),
        setVar('r_josa2', call('josa', txt('책'), txt('을/를'))),
        setVar('r_josa3', call('josa', txt('지하철'), txt('으로/로'))),
        setVar('r_josa4', call('josa', txt('집'), txt('으로/로'))),
        setVar('r_dis', call('disassembleChar', txt('값'))),
        setVar('r_asm', call('assembleChar', txt('ㅎ'), txt('ㅏ'), txt('ㄴ'))),
        setVar('r_num1', call('numberToHangul', num(19834))),
        setVar('r_num2', call('numberToHangul', num(100))),
        setVar('r_susa', call('susa', num(23))),
        setVar('r_days', call('days', num(3))),
        // index_of_string 가정 프로브 (1-based / 미발견 0).
        setVar('p_ga', indexOf(getVar(REF_ID), txt('가'))),
        setVar('p_hih', indexOf(getVar(REF_ID), txt('힣'))),
        setVar('p_miss', indexOf(txt('abc'), txt('z'))),
        // 쉬움 그룹.
        setVar('cb_cho', call('canBeChoseong', txt('ㄱ'))),
        setVar('cb_chox', call('canBeChoseong', txt('ㅏ'))),
        setVar('cb_jung', call('canBeJungseong', txt('ㅏ'))),
        setVar('cb_jungx', call('canBeJungseong', txt('ㄱ'))),
        setVar('cb_jong', call('canBeJongseong', txt('ㄳ'))),
        setVar('cb_jongx', call('canBeJongseong', txt('ㅃ'))),
        setVar('r_cv1', call('combineVowels', txt('ㅗ'), txt('ㅏ'))),
        setVar('r_cv2', call('combineVowels', txt('ㅗ'), txt('ㅛ'))),
        setVar('r_dsm', call('disassemble', txt('안녕'))),
        setVar('r_dgr', call('disassembleToGroups', txt('값이'))),
        setVar('r_dcc', call('disassembleCompleteCharacter', txt('값'))),
        setVar('r_dcc2', call('disassembleCompleteCharacter', txt('가'))),
        setVar('r_rl1', call('removeLastCharacter', txt('전화'))),
        setVar('r_rl2', call('removeLastCharacter', txt('값'))),
        setVar('r_rl3', call('removeLastCharacter', txt('가'))),
        setVar('r_rl4', call('removeLastCharacter', txt('신세계'))),
        setVar('r_mx1', call('numberToHangulMixed', num(19834))),
        setVar('r_mx2', call('numberToHangulMixed', num(305))),
        setVar('r_am1', call('amountToHangul', num(1234))),
        setVar('r_am2', call('amountToHangul', num(10000))),
        setVar('r_se1', call('seosusa', num(1))),
        setVar('r_se2', call('seosusa', num(2))),
        setVar('r_se3', call('seosusa', num(11))),
        setVar('r_se4', call('seosusa', num(20))),
        setVar('r_se5', call('seosusa', num(21))),
        // 1~4번: 자모 유효성(겹) · assemble · 키보드 변환.
        setVar('cb_jung2', call('canBeJungseong', txt('ㅗㅏ'))),
        setVar('cb_jong2', call('canBeJongseong', txt('ㄱㅅ'))),
        setVar('r_asm1', call('assemble', txt('ㅇㅏㄴㄴㅕㅇ'))),
        setVar('r_asm2', call('assemble', txt('ㄱㅏㅂㅈㅏ'))),
        setVar('r_asm3', call('assemble', txt('ㄱㅗㅏ'))),
        setVar('r_q2a1', call('convertQwertyToAlphabet', txt('gks'))),
        setVar('r_q2a2', call('convertQwertyToAlphabet', txt('Qkr'))),
        setVar('r_h2q1', call('convertHangulToQwerty', txt('한글'))),
        setVar('r_h2q2', call('convertHangulToQwerty', txt('겨노'))),
        setVar('r_q2h1', call('convertQwertyToHangul', txt('dkssud'))),
        setVar('r_q2h2', call('convertQwertyToHangul', txt('gksrmf'))),
        setVar('r_q2h3', call('convertQwertyToHangul', txt('Qkd'))),
        // 표시.
        writeText(cat(
            txt('초성(라면)='), getVar('r_cho1'), txt('\n'),
            txt('조사(사과/을를)='), getVar('r_josa1'), txt('\n'),
            txt('조사(지하철/으로)='), getVar('r_josa3'), txt('\n'),
            txt('분해(값)='), getVar('r_dis'), txt('\n'),
            txt('조합(ㅎㅏㄴ)='), getVar('r_asm'), txt('\n'),
            txt('숫자(19834)='), getVar('r_num1'), txt('\n'),
            txt('수사(23)='), getVar('r_susa'), txt('  날짜(3)='), getVar('r_days')
        )),
    ],
});

export default {
    name: 'es-hangul 한글 함수 라이브러리',
    variables: [...dataVars, ...resultVars],
    lists,
    functions,
    objects: [board],
    interface: { canvasWidth: 640, menuWidth: 280, object: 'board' },
};
