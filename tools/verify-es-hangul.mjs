#!/usr/bin/env node
// es-hangul 포팅 함수들의 런타임 검증. 데모 .ent 를 로드하고 ▶ 실행 후
// 결과 변수들을 읽어 기댓값과 대조.
//
// 핵심 가정 확인: index_of_string 이 1-based 위치 + 미발견 시 0 을 반환하는가
// (REF 색인 산술 전체가 여기 의존). 프로브 변수로 함께 단언.
//
// 사전 조건: npm start.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import { runFresh, getVar, waitForVar, createReporter } from './lib/verify-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
// 최신 es-hangul_NNN.ent 자동 선택 (빌드마다 새 번호 — feedback_ent_numbering).
const GAME_DIR = path.resolve(__dirname, '..', 'games/es-hangul');
const latest = fs.readdirSync(GAME_DIR)
    .map(f => f.match(/^es-hangul_(\d{3})\.ent$/)).filter(Boolean)
    .map(m => m[1]).sort().pop();
if (!latest) { console.error('es-hangul_NNN.ent 없음 — 먼저 build.mjs 실행'); process.exit(2); }
const FIXTURE = path.join(GAME_DIR, `es-hangul_${latest}.ent`);
console.log(`fixture: es-hangul_${latest}.ent`);

const { browser, page, pageErrors } = await bootEditor();
try {
    await loadFixture(page, FIXTURE);
} catch (e) {
    console.error('error:', e.message);
    await browser.close();
    process.exit(3);
}

const t = createReporter();

// ▶ 실행 — when_run 스레드가 모든 결과 변수를 채움.
await runFresh(page);
// 함수 내부 repeat (getChoseong) 가 몇 프레임 걸릴 수 있어 폴링.
// 데모는 한 스레드에서 모든 결과를 순차 계산하는데, assemble/convert* 의 top-level 루프가
// 프레임을 양보해 수 초 걸린다. 미설정 변수는 '0' 으로 읽혀(빈→0 강제) 단순 non-empty 폴링이
// 즉시 통과하므로, **마지막 setVar 값('빵')** 이 될 때까지 기다려 스레드 완료를 보장.
await waitForVar(page, '입력_gksrmf2', v => String(v) === '빵', { timeoutMs: 30000 }).catch(() => {});
await page.waitForTimeout(300);

const S = async (name) => String(await getVar(page, name));
const N = async (name) => Number(await getVar(page, name));

console.log('\n=== index_of_string 가정 프로브 ===');
t.eq(await N('프로브_가'), 1, 'index_of(REF, "가") = 1 (1-based 첫 위치)');
t.eq(await N('프로브_힣'), 11172, 'index_of(REF, "힣") = 11172 (마지막)');
t.eq(await N('프로브_없음'), 0, 'index_of("abc", "z") = 0 (미발견)');

console.log('\n=== getChoseong (초성 추출) ===');
t.eq(await S('초성_라면'), 'ㄹㅁ', 'getChoseong("라면")');
t.eq(await S('초성_안녕'), 'ㅇㄴㅎㅅㅇ', 'getChoseong("안녕하세요")');

console.log('\n=== hasBatchim (받침 유무) ===');
t.eq(await N('받침_강'), 1, 'hasBatchim("강") = 1');
t.eq(await N('받침_나'), 0, 'hasBatchim("나") = 0');

console.log('\n=== josa (조사) ===');
t.eq(await S('조사_사과'), '사과를', 'josa("사과","을/를")');
t.eq(await S('조사_책'), '책을', 'josa("책","을/를")');
t.eq(await S('조사_지하철'), '지하철로', 'josa("지하철","으로/로") — ㄹ받침 예외');
t.eq(await S('조사_집'), '집으로', 'josa("집","으로/로")');

console.log('\n=== disassemble / assemble (자모 분해·조합) ===');
t.eq(await S('분해_값'), 'ㄱㅏㅂㅅ', 'disassembleChar("값") — 겹받침 분해');
t.eq(await S('조합_한'), '한', 'assembleChar("ㅎ","ㅏ","ㄴ")');

console.log('\n=== numberToHangul / susa / days (숫자 → 한글) ===');
t.eq(await S('숫자_19834'), '일만 구천팔백삼십사', 'numberToHangul(19834)');
t.eq(await S('숫자_100'), '백', 'numberToHangul(100)');
t.eq(await S('수사_23'), '스물셋', 'susa(23)');
t.eq(await S('날짜_3'), '사흘', 'days(3)');

console.log('\n=== canBe* (자모 유효성) ===');
t.eq(await N('초성가능_ㄱ'), 1, 'canBeChoseong("ㄱ") = 1');
t.eq(await N('초성가능_ㅏ'), 0, 'canBeChoseong("ㅏ") = 0');
t.eq(await N('중성가능_ㅏ'), 1, 'canBeJungseong("ㅏ") = 1');
t.eq(await N('중성가능_ㄱ'), 0, 'canBeJungseong("ㄱ") = 0');
t.eq(await N('중성가능_ㅗㅏ'), 1, 'canBeJungseong("ㅗㅏ") = 1 (분해형 겹모음)');
t.eq(await N('종성가능_ㄳ'), 0, 'canBeJongseong("ㄳ") = 0 (합성형은 미인정 — es-hangul 동일)');
t.eq(await N('종성가능_ㄱㅅ'), 1, 'canBeJongseong("ㄱㅅ") = 1 (분해형 겹받침)');
t.eq(await N('종성가능_ㅃ'), 0, 'canBeJongseong("ㅃ") = 0');

console.log('\n=== combineVowels / disassemble* ===');
t.eq(await S('겹모음_ㅗㅏ'), 'ㅘ', 'combineVowels("ㅗ","ㅏ")');
t.eq(await S('겹모음_ㅗㅛ'), 'ㅗㅛ', 'combineVowels("ㅗ","ㅛ") — 결합 불가');
t.eq(await S('분해문자열_안녕'), 'ㅇㅏㄴㄴㅕㅇ', 'disassemble("안녕")');
t.eq(await S('분해그룹_값이'), 'ㄱㅏㅂㅅ/ㅇㅣ', 'disassembleToGroups("값이")');
t.eq(await S('완성분해_값'), 'ㄱ/ㅏ/ㅄ', 'disassembleCompleteCharacter("값")');
t.eq(await S('완성분해_가'), 'ㄱ/ㅏ/', 'disassembleCompleteCharacter("가") — 받침 없음');

console.log('\n=== removeLastCharacter (자모 단위 백스페이스) ===');
t.eq(await S('지우기_전화'), '전호', 'removeLastCharacter("전화") — 겹모음');
t.eq(await S('지우기_값'), '갑', 'removeLastCharacter("값") — 겹받침');
t.eq(await S('지우기_가'), 'ㄱ', 'removeLastCharacter("가") — 초성만');
t.eq(await S('지우기_신세계'), '신세ㄱ', 'removeLastCharacter("신세계")');

console.log('\n=== numberToHangulMixed / amountToHangul / seosusa ===');
t.eq(await S('혼합_19834'), '1만9,834', 'numberToHangulMixed(19834)');
t.eq(await S('혼합_305'), '305', 'numberToHangulMixed(305)');
t.eq(await S('금액_1234'), '천이백삼십사', 'amountToHangul(1234)');
t.eq(await S('금액_10000'), '일만', 'amountToHangul(10000)');
t.eq(await S('서수_1'), '첫째', 'seosusa(1)');
t.eq(await S('서수_2'), '둘째', 'seosusa(2)');
t.eq(await S('서수_11'), '열한째', 'seosusa(11)');
t.eq(await S('서수_20'), '스무째', 'seosusa(20)');
t.eq(await S('서수_21'), '스물한째', 'seosusa(21)');

console.log('\n=== assemble (자모 조합 IME) ===');
t.eq(await S('조합_안녕'), '안녕', "assemble('ㅇㅏㄴㄴㅕㅇ')");
t.eq(await S('조합_갑자'), '갑자', "assemble('ㄱㅏㅂㅈㅏ')");
t.eq(await S('조합_과'), '과', "assemble('ㄱㅗㅏ') — 겹모음");

console.log('\n=== 키보드 변환 (QWERTY ↔ 한글) ===');
t.eq(await S('자모_gks'), 'ㅎㅏㄴ', "convertQwertyToAlphabet('gks')");
t.eq(await S('자모_Qkr'), 'ㅃㅏㄱ', "convertQwertyToAlphabet('Qkr') — Shift=쌍자음");
t.eq(await S('키_한글'), 'gksrmf', "convertHangulToQwerty('한글')");
t.eq(await S('키_겨노'), 'rush', "convertHangulToQwerty('겨노')");
t.eq(await S('입력_dkssud'), '안녕', "convertQwertyToHangul('dkssud')");
t.eq(await S('입력_gksrmf'), '한글', "convertQwertyToHangul('gksrmf')");
t.eq(await S('입력_gksrmf2'), '빵', "convertQwertyToHangul('Qkd') — 쌍자음+받침");

console.log(`\npageErrors: ${pageErrors.length}`);
if (pageErrors.length) for (const e of pageErrors.slice(0, 5)) console.log(' -', e);

await browser.close();
process.exit(t.summary());
