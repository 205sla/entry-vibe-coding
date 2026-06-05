// IME 테스트 검증 — 키 이벤트 디스패치(event.code) 후 left/comp/right/mode/cur 확인.
import path from 'node:path';
import { bootEditor, loadFixture } from '../../tools/lib/editor-harness.mjs';
import { runFresh, getVar, createReporter } from '../../tools/lib/verify-harness.mjs';

const { browser, page, pageErrors } = await bootEditor();
await loadFixture(page, path.resolve('games/es-hangul/_imetest.ent'));
const t = createReporter();

async function tap(code) {
    await page.evaluate((c) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        document.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    }, code);
    await page.waitForTimeout(100);
}
async function shiftTap(code) {
    // Shift 를 keydown 으로 유지한 채 글자키 입력 → 핸들러가 isPressed(16) 체크할 때까지 hold → keyup.
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' })));
    await page.waitForTimeout(30);
    await page.evaluate((c) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        document.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    }, code);
    await page.waitForTimeout(120);   // 핸들러가 Shift 눌린 동안 실행되도록 대기
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' })));
    await page.waitForTimeout(40);
}
const read = async () => ({
    left: String(await getVar(page, 'left')), comp: String(await getVar(page, 'comp')),
    right: String(await getVar(page, 'right')), mode: String(await getVar(page, 'mode')),
});
const full = async () => { const r = await read(); return r.left + r.comp + r.right; };
const reset = async () => { await runFresh(page); await page.waitForTimeout(250); };

console.log('\n=== ① 기본 조합 ===');
await reset();
await tap('KeyR'); await tap('KeyK'); await tap('KeyS');
console.log('  read:', JSON.stringify(await read()));
t.eq(await full(), '간', '기본 조합 r,k,s → 간');

console.log('\n=== ② Shift → 쌍자음 ===');
await reset();
await shiftTap('KeyR'); await tap('KeyK');
console.log('  read:', JSON.stringify(await read()));
t.eq(await full(), '까', 'Shift+r,k → 까');

console.log('\n=== ③ Alt → 한/영 전환 ===');
await reset();
await tap('AltLeft');
let r = await read();
console.log('  alt 후:', JSON.stringify(r));
t.eq(r.mode, '0', 'Alt → 영문(mode=0)');
await tap('KeyR');
t.eq(await full(), 'r', '영문 모드: r → "r"');

console.log('\n=== ④ Backspace ===');
await reset();
await tap('KeyR'); await tap('KeyK');
console.log('  가 입력 후:', JSON.stringify(await read()));
await tap('Backspace');
console.log('  backspace 후:', JSON.stringify(await read()));
t.eq(await full(), 'ㄱ', 'Backspace: 가 → ㄱ');

console.log('\n=== ⑤ | 커서 깜빡임 ===');
await reset();
const curs = [];
for (let i = 0; i < 10; i++) { curs.push(String(await getVar(page, 'cur'))); await page.waitForTimeout(130); }
console.log('  cur 관측:', JSON.stringify(curs));
t.ok(curs.includes('|') && curs.some(c => c !== '|'), '커서 |↔공백 깜빡임');

console.log('\n=== ⑥ 방향키 커서 이동 ===');
await reset();
await tap('AltLeft');  // 영문
await tap('KeyA'); await tap('KeyB'); await tap('KeyC');
console.log('  abc 입력:', JSON.stringify(await read()));
await tap('ArrowLeft');
console.log('  ← 후:', JSON.stringify(await read()));
await tap('KeyX');
r = await read();
console.log('  x 삽입 후:', JSON.stringify(r));
t.eq(r.left + '/' + r.right, 'abx/c', '커서 이동 후 삽입: abc →←→x→ left=abx,right=c');

console.log('\npageErrors:', pageErrors.length);
for (const e of pageErrors.slice(0, 5)) console.log(' -', e);
await browser.close();
process.exit(t.summary());
