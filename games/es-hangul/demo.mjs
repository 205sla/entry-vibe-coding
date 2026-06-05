// es-hangul 데모 — 라이브 한글 IME 검색(랜딩) + 멀티 장면 기능 쇼케이스.
//
//   ① search : 라이브 IME 검색창 + 자동완성 추천(샘플 300단어: 한국어 200 + 영어 100).
//              "다른 기능 보러가기" → ② home → ③~⑥ 기능 장면.
//   ② home   : 메뉴(버튼 4개 + 검색으로 돌아가기)
//   ③ jamo · ④ josa · ⑤ num · ⑥ qwerty
//
// 자동완성 이중 매칭: q1=자모(한글 disassemble / 영문 convertQwertyToAlphabet) → 한국어 단어,
//   q2=원문 버퍼 → 영어 단어. 각 단어 키(한=자모, 영=소문자)에 q1 또는 q2 가 prefix 면 추천.
//
// ⚠️ 순회는 동기 재귀 값함수 scanSug (repeat 프레임양보+전역 si 공유 race 회피, knowledge/07).
// ⚠️ 루프 값함수(disassemble/convertQwertyToAlphabet)는 키 핸들러 **스레드 최상위에서만** 호출.
// ⚠️ textBox 가운데정렬: regX 강제0이라 x=좌측가장자리 · 가운데는 textAlign:0(1=왼쪽) · 고정폭은 lineBreak:true.
//    canvasWidth:640 오프셋 탓에 가운데 x = 160 - width/2 (픽셀 centroid 측정 확인). knowledge/07.
// 배경: 버튼 외 글상자는 투명, 붓으로 어두운 네이비 단색을 깔고 색이 아주 느리게 순환(루프).
//
// Build:  node games/es-hangul/build-demo.mjs   → es-hangul-demo_NNN.ent

import esHangul from './spec.mjs';
import {
    num, txt, getVar, setVar, changeVar, calc, cmp, or_,
    if_, repeat, fn, call,
    combine, charAt, substr, indexOf, strLen, replaceStr, valueAt, isPressed,
    when, obj, writeText, wait, scene, startScene, askWait, getInput,
    move, turnAbs, locateXY, startDraw, stopDraw, eraseAll, setThickness, hide, zOrder,
} from '../../tools/lib/spec-dsl.mjs';

const cat = (...p) => p.reduce((a, b) => combine(a, b));
// 빈 문자열 센티넬 — 함수 지역변수는 ''를 저장 못 함(→0). SEED 로 시드 후 반환 직전 제거.
const SEED = String.fromCharCode(0xE000);
// 랜딩(search) 오브젝트: when.run(시작)+when.sceneStart(재진입) 이중 트리거. 비랜딩은 sceneStart만.
const dualStart = (body) => [[when.run(), ...body], [when.sceneStart(), ...body]];
// 가운데 정렬 글상자 폭/좌표 (textBox regX 강제0 → x=좌측가장자리; canvasWidth:640 오프셋 보정).
const BOX_W = 440, BOX_X = 160 - BOX_W / 2;   // = -60 (픽셀 centroid 측정으로 확인)

// es-hangul 데이터 변수 id (spec.mjs 와 동일) + 데모 리스트 id.
const QKEYS_ID = 'qky0', QJAMO_ID = 'qjm0';
const WORDS_ID = 'wrd0', WORDSKEY_ID = 'wjm0', PALETTE_ID = 'pal0';

// ── 자모 분해 (Entry disassemble 동일 알고리즘 — 한국어 단어 매칭키 사전계산용) ──
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG_LIST = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONG_LIST = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNG_DECOMP = { 'ㅘ':'ㅗㅏ','ㅙ':'ㅗㅐ','ㅚ':'ㅗㅣ','ㅝ':'ㅜㅓ','ㅞ':'ㅜㅔ','ㅟ':'ㅜㅣ','ㅢ':'ㅡㅣ' };
const JONG_DECOMP = { 'ㄳ':'ㄱㅅ','ㄵ':'ㄴㅈ','ㄶ':'ㄴㅎ','ㄺ':'ㄹㄱ','ㄻ':'ㄹㅁ','ㄼ':'ㄹㅂ','ㄽ':'ㄹㅅ','ㄾ':'ㄹㅌ','ㄿ':'ㄹㅍ','ㅀ':'ㄹㅎ','ㅄ':'ㅂㅅ' };
const JUNGD = JUNG_LIST.map(j => JUNG_DECOMP[j] || j);
const JONGD = JONG_LIST.map(j => JONG_DECOMP[j] || j);
function jsDisChar(c) {
    const code = c.charCodeAt(0) - 0xAC00;
    if (code < 0 || code > 11171) return c;
    return CHO[Math.floor(code / 588)] + JUNGD[Math.floor((code % 588) / 28)] + JONGD[code % 28];
}
const jsDisassemble = (s) => Array.from(s).map(jsDisChar).join('');

// ── 샘플 검색어 300개: 한국어 200 + 영어 100 ──────────────────────
const KO_WORDS = [
    // (1) 사~ 클러스터 + 과일
    '사과','사자','사람','사랑','사진','사슴','사전','사막','사실','사이다',
    '바나나','포도','딸기','수박','참외','복숭아','자두','오렌지','레몬','망고',
    '강아지','고양이','토끼','호랑이','코끼리','기린','원숭이','펭귄','거북이','다람쥐',
    '서울','부산','대구','인천','광주','대전','울산','제주','경주','전주',
    '학교','학생','선생님','친구','가족','부모님','형제','자매','이웃','손님',
    '컴퓨터','노트북','휴대폰','텔레비전','냉장고','세탁기','청소기','선풍기','에어컨','자판기',
    '축구','야구','농구','배구','수영','달리기','등산','자전거','스키','태권도',
    '김치','비빔밥','불고기','떡볶이','김밥','라면','만두','치킨','피자','햄버거',
    '바다','산','강','호수','하늘','구름','바람','비','눈','무지개',
    '책','연필','공책','지우개','가방','시계','안경','우산','지갑','열쇠',
    // (2) 추가 100
    '의사','간호사','경찰','소방관','요리사','화가','가수','배우','운동선수','과학자',
    '된장','고추장','간장','참기름','설탕','소금','후추','식초','마늘','양파',
    '장미','튤립','해바라기','국화','벚꽃','진달래','개나리','코스모스','민들레','제비꽃',
    '사슴벌레','잠자리','나비','꿀벌','개미','거미','달팽이','지렁이','메뚜기','무당벌레',
    '머리','어깨','무릎','발가락','손가락','눈썹','입술','이마','턱','팔꿈치',
    '빨강','주황','노랑','초록','파랑','남색','보라','분홍','갈색','회색',
    '기쁨','슬픔','행복','분노','놀람','두려움','설렘','그리움','외로움','즐거움',
    '버스','지하철','택시','기차','비행기','자동차','오토바이','트럭','여객선','헬리콥터',
    '병원','은행','우체국','도서관','박물관','경찰서','소방서','시장','공원','놀이터',
    '공룡','상어','고래','문어','오징어','새우','꽃게','조개','해파리','불가사리',
];
const EN_WORDS = [
    'app','apple','application','apply','approach','april','apartment','appointment','appreciate','approve',
    'banana','ball','book','box','bird','blue','bread','bridge','brother','business',
    'cat','car','cake','city','cloud','color','computer','country','culture','cup',
    'dog','day','door','dream','desk','doctor','dance','dark','data','design',
    'egg','ear','earth','east','easy','eat','energy','engine','english','evening',
    'fish','fire','food','foot','friend','family','farm','fast','flower','future',
    'game','garden','gift','girl','glass','gold','good','grass','green','group',
    'house','hand','happy','heart','history','home','horse','hospital','hotel','hour',
    'music','money','market','mind','moon','morning','mother','mountain','mouse','movie',
    'sun','school','sea','song','star','story','street','summer','system','science',
];
const WORDS = [...KO_WORDS, ...EN_WORDS];                       // 300
const isKorean = (w) => /[가-힣]/.test(w);
const WORDS_KEY = WORDS.map(w => isKorean(w) ? jsDisassemble(w) : w.toLowerCase());

// ── 배경 색 팔레트 — 어두운 네이비 톤 유지하며 색상(hue)만 아주 느리게 순환(루프) ──
function hslToHex(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
        const k = (n + h / 30) % 12;
        const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
}
const PALETTE_N = 60;
const PALETTE = Array.from({ length: PALETTE_N }, (_, i) => {
    const h = 215 + 45 * Math.sin((i / PALETTE_N) * 2 * Math.PI);  // 170~260° (청록~남보라), 매끄럽게 루프
    return hslToHex(h, 0.38, 0.12);                               // 어둡고(L12%) 차분한 톤
});

// ── IME / 검색 / 배경 전역 변수 ──────────────────────────────────
const imeVarIds = ['left','comp','right','mode','cur','modelbl','ktmp','kpos','kjamo','kres','q','q2','sug','bgci','din','dr1','dr2','dr3','dr4'];
const imeVars = [
    ...imeVarIds.map(id => ({ id, name: id, value: '', visible: false })),
    { id: '__answer__', name: '대답', value: '0', visible: false, variableType: 'answer' },
];

// ── 붓 배경 그리기 (버튼 외 글상자 뒤, 색 느리게 순환) ─────────────
const setColorDyn = (v) => ({ type: 'set_color', params: [v, null] });   // set_color 는 string 블록 허용
const bgDrawerBody = [
    hide(), zOrder('BACK'), eraseAll(), setThickness(500),
    setVar('bgci', num(0)),
    repeat.inf([
        setColorDyn(valueAt(PALETTE_ID, calc(getVar('bgci'), '+', 1))),
        locateXY(-400, 0), turnAbs(90), startDraw(), move(1400), stopDraw(),  // 화면 전체 덮는 두꺼운 띠
        changeVar('bgci', 1),
        if_(cmp(getVar('bgci'), '>=', num(PALETTE.length)), [setVar('bgci', num(0))]),
        wait(0.45),                                                          // 아주 느리게 (60색 × 0.45s ≈ 27s 한 바퀴)
    ]),
];
const bgDrawer = (sceneId, id, landing) => obj(id, '배경', {
    scene: sceneId,
    entity: { x: 0, y: 0, scaleX: 0.01, scaleY: 0.01, direction: 90, visible: false },
    threads: landing ? dualStart(bgDrawerBody) : [[when.sceneStart(), ...bgDrawerBody]],
});

// ── IME 헬퍼 함수 ────────────────────────────────────────────────
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
                    setVar('comp', charAt(getVar('kres'), strLen(getVar('kres')))),
                    if_(cmp(strLen(getVar('kres')), '>', 1),
                        [setVar('left', cat(getVar('left'), substr(getVar('kres'), num(1), calc(strLen(getVar('kres')), '-', 1))))]),
                ],
                [setVar('left', cat(getVar('left'), getVar('comp'), c)), setVar('comp', txt(''))]
            ),
        ],
        [setVar('left', cat(getVar('left'), getVar('comp'), c)), setVar('comp', txt(''))]
    ),
    call('redraw'),
]);
const commit = fn.normal('commit', [], () => [
    setVar('left', cat(getVar('left'), getVar('comp'))), setVar('comp', txt('')),
]);
const redraw = fn.normal('redraw', [], () => [
    writeText(cat(getVar('modelbl'), getVar('left'), getVar('comp'), getVar('cur'), getVar('right'))),
]);

// scanSug(idx, cnt): WORDS_KEY[idx..] 중 q1(자모) 또는 q2(원문)로 시작하는 단어를 최대 6개 모아 연결.
//   동기 재귀 → 키 입력마다 한 프레임 완료(전역 si race 없음). 빈 base 는 SEED, 최상위가 flush.
const scanSug = fn.value('scanSug', ['idx', 'cnt'],
    (idx, cnt, L) => [
        if_(or_(cmp(idx, '>', num(WORDS.length)), cmp(cnt, '>=', num(6))),
            [L.set('ret', txt(SEED))],
            [if_(or_(
                    cmp(indexOf(valueAt(WORDSKEY_ID, idx), getVar('q')), '==', 1),
                    cmp(indexOf(valueAt(WORDSKEY_ID, idx), getVar('q2')), '==', 1)
                ),
                [L.set('ret', cat(txt(SEED), valueAt(WORDS_ID, idx), txt('\n'), call('scanSug', calc(idx, '+', 1), calc(cnt, '+', 1))))],
                [L.set('ret', cat(txt(SEED), call('scanSug', calc(idx, '+', 1), cnt)))]
            )]
        ),
    ],
    (idx, cnt, L) => replaceStr(L.get('ret'), txt(SEED), txt('')),
    ['ret']);

const updateSuggestions = fn.normal('updateSuggestions', [], () => [
    if_(cmp(strLen(getVar('q2')), '>', 0),
        [setVar('sug', call('scanSug', num(1), num(0)))],
        [setVar('sug', txt(''))]
    ),
]);

// ── 키 핸들러 공통 꼬리 — q1(자모)·q2(원문) 계산 + 추천 갱신 ─────────
const searchTail = [
    if_(cmp(getVar('mode'), '==', 1),
        [setVar('q', call('disassemble', cat(getVar('left'), getVar('comp'), getVar('right'))))],
        [setVar('q', call('convertQwertyToAlphabet', cat(getVar('left'), getVar('comp'), getVar('right'))))]
    ),
    setVar('q2', cat(getVar('left'), getVar('comp'), getVar('right'))),   // 원문(영어 단어 매칭)
    call('updateSuggestions'),
];

// ── ① search 장면 ────────────────────────────────────────────────
const letters = 'abcdefghijklmnopqrstuvwxyz';
const letterThreads = [...letters].map(lower => [
    when.keyPressed(String(lower.charCodeAt(0) - 32)),
    setVar('ktmp', txt(lower)),
    if_(isPressed('16'), [setVar('ktmp', txt(lower.toUpperCase()))]),
    call('imeType', getVar('ktmp')),
    ...searchTail,
]);

const imeInitBody = [
    setVar('left', txt('')), setVar('comp', txt('')), setVar('right', txt('')),
    setVar('mode', num(1)), setVar('modelbl', txt('[한] ')), setVar('cur', txt('|')),
    setVar('q', txt('')), setVar('q2', txt('')), setVar('sug', txt('')),
    call('redraw'),
    repeat.inf([
        if_(cmp(getVar('cur'), '==', txt('|')), [setVar('cur', txt(' '))], [setVar('cur', txt('|'))]),
        call('redraw'),
        wait(0.45),
    ]),
];

const backspace = [
    when.keyPressed('8'),
    if_(cmp(strLen(getVar('comp')), '>', 0),
        [setVar('comp', call('removeLastCharacter', getVar('comp')))],
        [if_(cmp(strLen(getVar('left')), '>', 0),
            [setVar('left', call('removeLastCharacter', getVar('left')))])]
    ),
    call('redraw'),
    ...searchTail,
];
const space = [
    when.keyPressed('32'), call('commit'),
    setVar('left', cat(getVar('left'), txt(' '))), call('redraw'), ...searchTail,
];
const altKey = [
    when.keyPressed('18'), call('commit'),
    if_(cmp(getVar('mode'), '==', 1),
        [setVar('mode', num(0)), setVar('modelbl', txt('[영] '))],
        [setVar('mode', num(1)), setVar('modelbl', txt('[한] '))]
    ),
    call('redraw'), ...searchTail,
];
const arrowLeft = [
    when.keyPressed('37'), call('commit'),
    if_(cmp(strLen(getVar('left')), '>', 0), [
        setVar('right', cat(charAt(getVar('left'), strLen(getVar('left'))), getVar('right'))),
        if_(cmp(strLen(getVar('left')), '>', 1),
            [setVar('left', substr(getVar('left'), num(1), calc(strLen(getVar('left')), '-', 1)))],
            [setVar('left', txt(''))]
        ),
    ]),
    call('redraw'),
];
const arrowRight = [
    when.keyPressed('39'), call('commit'),
    if_(cmp(strLen(getVar('right')), '>', 0), [
        setVar('left', cat(getVar('left'), charAt(getVar('right'), num(1)))),
        if_(cmp(strLen(getVar('right')), '>', 1),
            [setVar('right', substr(getVar('right'), num(2), strLen(getVar('right'))))],
            [setVar('right', txt(''))]
        ),
    ]),
    call('redraw'),
];

const TITLE = '🔎 한글 검색 — 영문키 두벌식  (Alt 한/영 · Shift 쌍자음)';
const searchTitle = obj('search_title', '검색 제목', {
    scene: 'search', objectType: 'textBox', text: TITLE,
    entity: { x: BOX_X, y: 120, regX: 0, regY: 0, scaleX: 1, scaleY: 1, textAlign: 0, lineBreak: true, width: BOX_W, height: 26, font: '16px NanumGothic', bgColor: 'transparent', colour: '#93c5fd', visible: true },
    threads: dualStart([writeText(txt(TITLE))]),
});
const imeObj = obj('ime', '입력창', {
    scene: 'search', objectType: 'textBox', text: '영문키 두벌식으로 입력 (예: tkrhk → 사과)',
    entity: { x: BOX_X, y: 72, regX: 0, regY: 0, scaleX: 1, scaleY: 1, textAlign: 0, lineBreak: true, width: BOX_W, height: 56, font: '24px NanumGothic', bgColor: 'transparent', colour: '#e2e8f0', visible: true },
    threads: [...dualStart(imeInitBody), ...letterThreads, backspace, space, altKey, arrowLeft, arrowRight],
});
const suggestObj = obj('suggest', '추천', {
    scene: 'search', objectType: 'textBox', text: '추천 검색어',
    entity: { x: BOX_X, y: -28, regX: 0, regY: 0, scaleX: 1, scaleY: 1, textAlign: 0, lineBreak: true, width: BOX_W, height: 116, font: '18px NanumGothic', bgColor: 'transparent', colour: '#fbbf24', visible: true },
    threads: dualStart([repeat.inf([writeText(cat(txt('🔎 추천 검색어\n'), getVar('sug'))), wait(0.1)])]),
});
const goHomeBtn = obj('go_home', '다른 기능', {
    scene: 'search', objectType: 'textBox', text: '다른 기능 보러가기 ▶',
    entity: { x: BOX_X, y: -118, regX: 0, regY: 0, scaleX: 1, scaleY: 1, textAlign: 0, lineBreak: true, width: BOX_W, height: 28, font: '18px NanumGothic', bgColor: '#334155', colour: '#ffffff', visible: true },
    threads: [
        ...dualStart([writeText(txt('다른 기능 보러가기 ▶'))]),
        [when.objectClick(), startScene('home')],
    ],
});

// ── ② home 장면 ──────────────────────────────────────────────────
const navButton = (id, label, target, y) => obj(id, label, {
    scene: 'home', objectType: 'textBox', text: label,
    entity: { x: BOX_X, y, regX: 0, regY: 0, scaleX: 1, scaleY: 1, textAlign: 0, lineBreak: true, width: BOX_W, height: 32, font: '20px NanumGothic', bgColor: '#1e3a8a', colour: '#ffffff', visible: true },
    threads: [
        [when.sceneStart(), writeText(txt(label))],
        [when.objectClick(), startScene(target)],
    ],
});
const homeObjects = [
    obj('home_title', '제목', {
        scene: 'home', objectType: 'textBox', text: 'es-hangul 데모',
        entity: { x: BOX_X, y: 115, regX: 0, regY: 0, scaleX: 1, scaleY: 1, textAlign: 0, lineBreak: true, width: BOX_W, height: 36, font: '24px NanumGothic', bgColor: 'transparent', colour: '#e2e8f0', visible: true },
        script: [when.sceneStart(), writeText(txt('es-hangul 한글 처리 데모\n아래에서 기능을 골라보세요'))],
    }),
    navButton('btn_jamo', '① 자모 분해·조합', 'jamo', 65),
    navButton('btn_josa', '② 조사 자동', 'josa', 25),
    navButton('btn_num', '③ 숫자·금액·날짜', 'num', -15),
    navButton('btn_qwerty', '④ 자판 변환', 'qwerty', -55),
    navButton('btn_back_search', '← 검색으로', 'search', -115),
];

// ── ③~⑥ 기능 장면 (자동 예시 + 클릭 직접입력) ───────────────────
const featureBoard = (id, sceneId, autoBody, clickBody) => obj(id, id, {
    scene: sceneId, objectType: 'textBox', text: '실행 중…',
    entity: { x: BOX_X, y: 18, regX: 0, regY: 0, scaleX: 1, scaleY: 1, textAlign: 0, lineBreak: true, width: BOX_W, height: 184, font: '16px NanumGothic', bgColor: 'transparent', colour: '#e2e8f0', visible: true },
    threads: [[when.sceneStart(), ...autoBody], [when.objectClick(), ...clickBody]],
});
const backHome = (sceneId, id) => obj(id, '홈으로', {
    scene: sceneId, objectType: 'textBox', text: '← 홈',
    entity: { x: BOX_X, y: -120, regX: 0, regY: 0, scaleX: 1, scaleY: 1, textAlign: 0, lineBreak: true, width: BOX_W, height: 26, font: '16px NanumGothic', bgColor: '#334155', colour: '#ffffff', visible: true },
    threads: [[when.sceneStart(), writeText(txt('← 홈'))], [when.objectClick(), startScene('home')]],
});

const jamoBoard = featureBoard('jamo_board', 'jamo',
    [
        setVar('r_cho1', call('getChoseong', txt('라면'))),
        setVar('r_dis', call('disassemble', txt('안녕'))),
        setVar('r_asm', call('assemble', txt('ㅇㅏㄴㄴㅕㅇ'))),
        setVar('r_bat1', call('hasBatchim', txt('강'))),
        setVar('r_bat2', call('hasBatchim', txt('나'))),
        writeText(cat(
            txt('[자모 분해·조합]\n'),
            txt('초성(라면) = '), getVar('r_cho1'), txt('\n'),
            txt('분해(안녕) = '), getVar('r_dis'), txt('\n'),
            txt('조합(ㅇㅏㄴㄴㅕㅇ) = '), getVar('r_asm'), txt('\n'),
            txt('받침(강)='), getVar('r_bat1'), txt('  받침(나)='), getVar('r_bat2'), txt('\n'),
            txt('\n(박스를 클릭하면 직접 입력)'),
        )),
    ],
    [
        askWait('단어를 입력하세요 (예: 라면)'),
        setVar('din', getInput()),
        setVar('dr1', call('getChoseong', getVar('din'))),
        setVar('dr2', call('disassemble', getVar('din'))),
        setVar('dr3', call('hasBatchim', getVar('din'))),
        writeText(cat(
            txt('[직접 입력] '), getVar('din'), txt('\n'),
            txt('초성 = '), getVar('dr1'), txt('\n'),
            txt('분해 = '), getVar('dr2'), txt('\n'),
            txt('받침 = '), getVar('dr3'),
        )),
    ]);

const josaBoard = featureBoard('josa_board', 'josa',
    [
        setVar('r_josa1', call('josa', txt('사과'), txt('을/를'))),
        setVar('r_josa2', call('josa', txt('책'), txt('은/는'))),
        setVar('r_josa3', call('josa', txt('지하철'), txt('으로/로'))),
        writeText(cat(
            txt('[조사 자동]\n'),
            txt('사과 + 을/를 = '), getVar('r_josa1'), txt('\n'),
            txt('책 + 은/는 = '), getVar('r_josa2'), txt('\n'),
            txt('지하철 + 으로/로 = '), getVar('r_josa3'), txt('\n'),
            txt('\n(박스를 클릭하면 직접 입력)'),
        )),
    ],
    [
        askWait('단어를 입력하세요 (예: 학교)'),
        setVar('din', getInput()),
        setVar('dr1', call('josa', getVar('din'), txt('은/는'))),
        setVar('dr2', call('josa', getVar('din'), txt('이/가'))),
        setVar('dr3', call('josa', getVar('din'), txt('을/를'))),
        setVar('dr4', call('josa', getVar('din'), txt('으로/로'))),
        writeText(cat(
            txt('[직접 입력]\n'),
            getVar('dr1'), txt('\n'), getVar('dr2'), txt('\n'),
            getVar('dr3'), txt('\n'), getVar('dr4'),
        )),
    ]);

const numBoard = featureBoard('num_board', 'num',
    [
        setVar('r_num1', call('numberToHangul', num(19834))),
        setVar('r_mx1', call('numberToHangulMixed', num(19834))),
        setVar('r_am1', call('amountToHangul', num(1234))),
        setVar('r_susa', call('susa', num(23))),
        setVar('r_days', call('days', num(3))),
        writeText(cat(
            txt('[숫자·금액·날짜]\n'),
            txt('한글수(19834) = '), getVar('r_num1'), txt('\n'),
            txt('혼합(19834) = '), getVar('r_mx1'), txt('\n'),
            txt('금액(1234) = '), getVar('r_am1'), txt('\n'),
            txt('수사(23)='), getVar('r_susa'), txt('  날짜(3)='), getVar('r_days'), txt('\n'),
            txt('\n(박스를 클릭하면 숫자 직접 입력)'),
        )),
    ],
    [
        askWait('숫자를 입력하세요 (예: 5400)'),
        setVar('din', getInput()),
        setVar('dr1', call('numberToHangul', getVar('din'))),
        setVar('dr2', call('numberToHangulMixed', getVar('din'))),
        setVar('dr3', call('amountToHangul', getVar('din'))),
        writeText(cat(
            txt('[직접 입력] '), getVar('din'), txt('\n'),
            txt('한글 = '), getVar('dr1'), txt('\n'),
            txt('혼합 = '), getVar('dr2'), txt('\n'),
            txt('금액 = '), getVar('dr3'),
        )),
    ]);

const qwertyBoard = featureBoard('qwerty_board', 'qwerty',
    [
        setVar('r_q2h2', call('convertQwertyToHangul', txt('gksrmf'))),
        setVar('r_q2a1', call('convertQwertyToAlphabet', txt('gks'))),
        setVar('r_h2q1', call('convertHangulToQwerty', txt('한글'))),
        writeText(cat(
            txt('[자판 변환]\n'),
            txt('gksrmf → '), getVar('r_q2h2'), txt('\n'),
            txt('gks → '), getVar('r_q2a1'), txt('  (자모)\n'),
            txt('한글 → '), getVar('r_h2q1'), txt('\n'),
            txt('\n(박스를 클릭하면 직접 입력)'),
        )),
    ],
    [
        askWait('영문키 또는 한글 입력 (예: dkssud)'),
        setVar('din', getInput()),
        setVar('dr1', call('convertQwertyToHangul', getVar('din'))),
        setVar('dr2', call('convertHangulToQwerty', getVar('din'))),
        writeText(cat(
            txt('[직접 입력] '), getVar('din'), txt('\n'),
            txt('→ 한글 = '), getVar('dr1'), txt('\n'),
            txt('→ 영문키 = '), getVar('dr2'),
        )),
    ]);

// ── 최종 spec ────────────────────────────────────────────────────
export default {
    name: 'es-hangul 데모 (검색 IME + 기능 장면)',
    scenes: [
        scene('search', '검색'), scene('home', '홈'),
        scene('jamo', '자모'), scene('josa', '조사'), scene('num', '숫자'), scene('qwerty', '자판'),
    ],
    variables: [...esHangul.variables, ...imeVars],
    lists: [
        ...esHangul.lists,
        { id: WORDS_ID, name: 'WORDS', array: WORDS, visible: false },
        { id: WORDSKEY_ID, name: 'WORDS_KEY', array: WORDS_KEY, visible: false },
        { id: PALETTE_ID, name: 'PALETTE', array: PALETTE, visible: false },
    ],
    functions: [...esHangul.functions, imeType, commit, redraw, scanSug, updateSuggestions],
    objects: [
        // 붓 배경(각 장면, 맨 뒤). zOrder('BACK') 으로 글상자 뒤에.
        bgDrawer('search', 'bg_search', true),
        bgDrawer('home', 'bg_home', false),
        bgDrawer('jamo', 'bg_jamo', false),
        bgDrawer('josa', 'bg_josa', false),
        bgDrawer('num', 'bg_num', false),
        bgDrawer('qwerty', 'bg_qwerty', false),
        searchTitle, imeObj, suggestObj, goHomeBtn,
        ...homeObjects,
        jamoBoard, backHome('jamo', 'jamo_back'),
        josaBoard, backHome('josa', 'josa_back'),
        numBoard, backHome('num', 'num_back'),
        qwertyBoard, backHome('qwerty', 'qwerty_back'),
    ],
    interface: { canvasWidth: 640, menuWidth: 280, object: 'ime' },
};
