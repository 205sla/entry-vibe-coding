// es-hangul 데모 검증 — 라이브 IME 회귀 + 자동완성 검색 + 장면 전환.
//   node tools/verify-es-hangul-demo.mjs   (npm start 필요 / run-all-verify 가 자동 기동)
import fs from 'node:fs';
import path from 'node:path';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import { runFresh, getVar, clickObject, waitForVar, createReporter } from './lib/verify-harness.mjs';

// 최신 es-hangul-demo_NNN.ent 자동 선택.
const demoDir = path.resolve('games/es-hangul');
const latest = fs.readdirSync(demoDir)
    .filter(f => /^es-hangul-demo_\d{3}\.ent$/.test(f))
    .sort().at(-1);
if (!latest) throw new Error('es-hangul-demo_*.ent 없음 — 먼저 build-demo.mjs 실행');
console.log('fixture:', latest);

const { browser, page, pageErrors } = await bootEditor();
await loadFixture(page, path.join(demoDir, latest));
const t = createReporter();

// 키 입력 — event.code 디스패치 (Entry 는 document + event.code 로 수신).
async function tap(code) {
    await page.evaluate((c) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        document.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    }, code);
    await page.waitForTimeout(90);
}
// Shift 를 핸들러 틱 동안 hold (즉시 keyup 하면 pressedKeys 에서 빠져 감지 실패).
async function shiftTap(code) {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' })));
    await page.waitForTimeout(30);
    await page.evaluate((c) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        document.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    }, code);
    await page.waitForTimeout(120);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' })));
    await page.waitForTimeout(40);
}
const read = async () => ({
    left: String(await getVar(page, 'left')), comp: String(await getVar(page, 'comp')),
    right: String(await getVar(page, 'right')), mode: String(await getVar(page, 'mode')),
});
const full = async () => { const r = await read(); return r.left + r.comp + r.right; };
const sug = async () => String(await getVar(page, 'sug'));
const reset = async () => { await runFresh(page); await page.waitForTimeout(300); };

// ── 라이브 IME 회귀 (search 가 첫 장면) ──
console.log('\n=== ① 기본 조합 ===');
await reset();
await tap('KeyR'); await tap('KeyK'); await tap('KeyS');
console.log('  ', JSON.stringify(await read()));
t.eq(await full(), '간', '기본 조합 r,k,s → 간');

console.log('\n=== ② Shift 쌍자음 ===');
await reset();
await shiftTap('KeyR'); await tap('KeyK');
console.log('  ', JSON.stringify(await read()));
t.eq(await full(), '까', 'Shift+r,k → 까');

console.log('\n=== ③ Backspace ===');
await reset();
await tap('KeyR'); await tap('KeyK');
await tap('Backspace');
t.eq(await full(), 'ㄱ', 'Backspace 가 → ㄱ');

// ── 자동완성 검색 (신규 핵심) ──
console.log('\n=== ④ 자동완성: 삭 → 사과 ===');
await reset();
await tap('KeyT'); await tap('KeyK'); await tap('KeyR');   // ㅅ ㅏ ㄱ = 삭
console.log('  full:', await full(), '| q:', String(await getVar(page, 'q')), '| sug:', JSON.stringify(await sug()));
t.eq(await full(), '삭', '입력 t,k,r → 삭');
t.eq(String(await getVar(page, 'q')), 'ㅅㅏㄱ', '입력 자모 q = ㅅㅏㄱ');
await waitForVar(page, 'sug', v => String(v).includes('사과'), { timeoutMs: 5000, label: '삭→사과' }).catch(() => {});
t.ok((await sug()).includes('사과'), '삭(ㅅㅏㄱ) → 추천에 사과');

console.log('\n=== ⑤ 자동완성: ㅅㅏ → 사* 다수 ===');
await reset();
await tap('KeyT'); await tap('KeyK');   // 사
{ const s = await sug(); console.log('  sug:', JSON.stringify(s));
  t.ok(s.includes('사과') && s.includes('사람'), 'ㅅㅏ → 사과·사람 등 다수'); }

console.log('\n=== ⑥ 영문 모드: tkrhk → 사과 ===');
await reset();
await tap('AltLeft');   // 한 → 영
t.eq(String(await getVar(page, 'mode')), '0', 'Alt → 영문 모드(mode=0)');
await tap('KeyT'); await tap('KeyK'); await tap('KeyR'); await tap('KeyH'); await tap('KeyK');
{ const r = await read(); const s = await sug();
  console.log('  left:', r.left, '| q:', String(await getVar(page, 'q')), '| sug:', JSON.stringify(s));
  t.eq(r.left, 'tkrhk', '영문 입력 그대로 tkrhk');
  t.ok(s.includes('사과'), '영문 tkrhk(→ㅅㅏㄱㅗㅏ) → 추천에 사과'); }

console.log('\n=== ⑦ 빈 입력 → 추천 비움 ===');
await reset();
await page.waitForTimeout(200);
t.eq(await sug(), '', '입력 없으면 sug 빈 문자열');

// ── 장면 전환 (search → home → 기능 장면) ──
console.log('\n=== ⑧ 장면 전환: search→home→jamo ===');
await reset();
await clickObject(page, 'go_home');
await page.waitForTimeout(300);
await clickObject(page, 'btn_jamo');
// 조합_한 은 자동예시 스크립트의 마지막 set(assemble — 느린 루프) → 이게 끝나면 앞 것도 끝.
await waitForVar(page, '조합_한', v => String(v) === '안녕', { timeoutMs: 8000, label: 'jamo 자동예시' }).catch(() => {});
t.eq(String(await getVar(page, '초성_라면')), 'ㄹㅁ', 'jamo: 초성(라면)=ㄹㅁ');
t.eq(String(await getVar(page, '조합_한')), '안녕', 'jamo: assemble(ㅇㅏㄴㄴㅕㅇ)=안녕');

console.log('\n=== ⑨ 장면 전환: search→home→num ===');
await reset();
await clickObject(page, 'go_home');
await page.waitForTimeout(300);
await clickObject(page, 'btn_num');
await waitForVar(page, '숫자_19834', v => String(v) === '일만 구천팔백삼십사', { timeoutMs: 8000, label: 'num 자동예시' }).catch(() => {});
t.eq(String(await getVar(page, '숫자_19834')), '일만 구천팔백삼십사', 'num: numberToHangul(19834)');

// ⑩ 긴 문자열 빠른 입력 → si race 없이 무오류 (회귀 가드: scanSug 동기 재귀)
console.log('\n=== ⑩ 긴 문자열 빠른 입력 → 무오류 ===');
await reset();
const errBefore = pageErrors.length;
async function tapFast(code) {
    await page.evaluate((c) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        document.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    }, code);
    await page.waitForTimeout(8);
}
const longKeys = [...'rkskekfkakqktkrkskekfkakqktkrk'].map(c => 'Key' + c.toUpperCase()); // 가나다라마바사… 30자
for (const c of longKeys) await tapFast(c);
await page.waitForTimeout(400);
console.log('  q.len:', String(await getVar(page, 'q')).length, '| new errors:', pageErrors.length - errBefore);
t.eq(pageErrors.length - errBefore, 0, '긴 문자열 30자 빠른 입력 — "can not insert value to array" race 없음');

// ⑪ 영어 단어 매칭 (영문 모드, 원문 q2 prefix)
console.log('\n=== ⑪ 영문 app → apple ===');
await reset();
await tap('AltLeft');   // 영문
await tap('KeyA'); await tap('KeyP'); await tap('KeyP');
{ const s = await sug(); console.log('  q2:', String(await getVar(page, 'q2')), '| sug:', JSON.stringify(s));
  t.ok(s.includes('apple'), '영문 app → 추천에 apple'); }

console.log('\n=== ⑫ 영문 ca → cat/car ===');
await reset();
await tap('AltLeft');
await tap('KeyC'); await tap('KeyA');
{ const s = await sug(); console.log('  sug:', JSON.stringify(s));
  t.ok(s.includes('cat') || s.includes('car'), '영문 ca → 추천에 cat/car'); }

// ⑬ 추가된 한국어 단어 매칭
console.log('\n=== ⑬ 한글 버 → 버스 (추가 200단어) ===');
await reset();
await tap('KeyQ'); await tap('KeyJ');   // ㅂ ㅓ = 버
{ const s = await sug(); console.log('  sug:', JSON.stringify(s));
  t.ok(s.includes('버스'), '한글 버 → 추천에 버스'); }

// ⑭ 붓 배경이 스테이지를 채우는지 (어두운 픽셀 점유율)
console.log('\n=== ⑭ 붓 배경 채움 ===');
await reset();
await page.waitForTimeout(600);
const darkPct = await page.evaluate(() => {
    const c = Entry.stage.canvas.canvas; const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    let dark = 0; for (let i = 0; i < img.length; i += 4) if (img[i] < 90 && img[i + 1] < 90 && img[i + 2] < 110 && img[i + 3] > 100) dark++;
    return Math.round(dark / (c.width * c.height) * 100);
});
console.log('  어두운 배경 점유율:', darkPct + '%');
t.ok(darkPct > 60, '붓 배경이 스테이지 60% 이상 채움');

console.log('\npageErrors:', pageErrors.length);
for (const e of pageErrors.slice(0, 6)) console.log(' -', e);
await browser.close();
process.exit(t.summary());
