#!/usr/bin/env node
// 이름 묻고 답하기 루프 검증.
//
// 시나리오:
//   1. 로드 → 글상자 초기 text === '...'
//   2. 실행 → ask_and_wait 대기 → "앨리스" 주입 → text === '앨리스'
//   3. 다시 ask_and_wait 대기 → "밥" 주입 → text === '밥'
//   4. 한 번 더 — "찰리" 주입 → text === '찰리'
//
// 사전 조건: npm start.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import { runFresh, waitFor, createReporter } from './lib/verify-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE   = path.resolve(__dirname, '..', 'tests/fixtures/name-loop.ent');

const { browser, page, pageErrors } = await bootEditor({
    viewport: { width: 1200, height: 800 },
});
try {
    await loadFixture(page, FIXTURE);
} catch (e) {
    console.error('load error:', e.message);
    await browser.close();
    process.exit(3);
}

const t = createReporter();

async function getDisplayText() {
    return page.evaluate(() => {
        const obj = Entry.container.getAllObjects().find(o => o.id === 'display');
        return obj && obj.entity ? obj.entity.getText() : null;
    });
}

async function isWaitingForInput() {
    return page.evaluate(() => {
        // ask_and_wait sets Entry.stage.inputField visible; complete becomes true
        // once user submits. Container.inputValue is set on complete.
        return !!(Entry.stage.inputField && !Entry.stage.inputField.value()
                  || (Entry.container && Entry.container._inputValue === undefined));
    });
}

async function injectAnswer(value) {
    // ask_and_wait 완료 — inputField 에 값을 넣고 'canvasInputComplete' 이벤트 dispatch.
    // 출처: entryjs/src/class/stage.js:133-144 — handler reads inputField.value()
    // → Entry.container.inputValue 세팅 + complete=true.
    await page.evaluate((v) => {
        if (Entry.stage.inputField) {
            Entry.stage.inputField.value(v);
        }
        Entry.dispatchEvent('canvasInputComplete');
    }, value);
}

// ── Step 1: 초기 text === '...' ─────────────────
console.log('\n=== Step 1: 초기 글상자 text ===');
const t0 = await getDisplayText();
console.log(`  글상자 text: "${t0}"`);
t.eq(t0, '...', '초기 text "..."');

// ── Step 2: 실행 → "앨리스" 주입 → text === '앨리스' ─
console.log('\n=== Step 2: "앨리스" 주입 ===');
await runFresh(page);
await page.waitForTimeout(500);  // ask_and_wait UI 가 켜질 시간

await injectAnswer('앨리스');
const t1 = await waitFor(page, getDisplayText, v => v === '앨리스', {
    timeoutMs: 3000, intervalMs: 100, label: 'text becomes 앨리스',
}).catch(e => { console.error('  ' + e.message); return null; });
t.eq(t1, '앨리스', '주입 후 text "앨리스"');

// ── Step 3: 다음 루프 — "밥" 주입 ────────────────
console.log('\n=== Step 3: "밥" 주입 (다음 루프) ===');
await page.waitForTimeout(500);  // 다음 ask_and_wait 가 켜질 시간

await injectAnswer('밥');
const t2 = await waitFor(page, getDisplayText, v => v === '밥', {
    timeoutMs: 3000, intervalMs: 100, label: 'text becomes 밥',
}).catch(e => { console.error('  ' + e.message); return null; });
t.eq(t2, '밥', '두 번째 주입 후 text "밥"');

// ── Step 4: 또 다른 루프 — "찰리" 주입 ───────────
console.log('\n=== Step 4: "찰리" 주입 (또 다른 루프) ===');
await page.waitForTimeout(500);

await injectAnswer('찰리');
const t3 = await waitFor(page, getDisplayText, v => v === '찰리', {
    timeoutMs: 3000, intervalMs: 100, label: 'text becomes 찰리',
}).catch(e => { console.error('  ' + e.message); return null; });
t.eq(t3, '찰리', '세 번째 주입 후 text "찰리"');

// ── 완료 ────────────────────────────────────
console.log('\n=== 완료 ===');
t.ok(pageErrors.length === 0, `페이지 에러 없음 (got ${pageErrors.length})`);
if (pageErrors.length) console.log('  errors:', pageErrors.slice(0, 3));

await browser.close();
process.exit(t.summary());
