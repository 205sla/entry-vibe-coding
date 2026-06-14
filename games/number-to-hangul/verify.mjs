#!/usr/bin/env node
// numberToHangul 단일 함수 런타임 검증.
//
// 시나리오: 로드 → 실행(▶) → 글상자가 11개 샘플 입력의 한글 변환을 표시 →
//   각 'n → 한글' 줄이 기대값과 일치하는지 단언.
//
// 사전 조건: npm start (또는 run-all-verify 가 서버 자동 기동).

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from '../../tools/lib/editor-harness.mjs';
import { runFresh, waitFor, createReporter } from '../../tools/lib/verify-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE   = path.resolve(__dirname, 'number-to-hangul_001.ent');

// 입력 → 기대 한글 (es-hangul numberToHangul 과 동일 규칙).
const CASES = [
    [0, '영'],
    [7, '칠'],
    [20, '이십'],
    [100, '백'],
    [1000, '천'],
    [1234, '천이백삼십사'],
    [10000, '일만'],
    [19834, '일만 구천팔백삼십사'],
    [305, '삼백오'],
    [100000000, '일억'],
    [123456789, '일억 이천삼백사십오만 육천칠백팔십구'],
];

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

async function getBoardText() {
    return page.evaluate(() => {
        const o = Entry.container.getAllObjects().find(o => o.id === 'board');
        return o && o.entity ? o.entity.getText() : null;
    });
}

// ── 실행 → 글상자가 채워질 때까지 대기 ───────────────
console.log('\n=== 실행 후 글상자 ===');
await runFresh(page);
const text = await waitFor(page, getBoardText, v => typeof v === 'string' && v.includes('→'), {
    timeoutMs: 4000, intervalMs: 100, label: '글상자에 결과 표시',
}).catch(e => { console.error('  ' + e.message); return ''; });
console.log(text.split('\n').map(l => '  ' + l).join('\n'));

// ── 각 케이스 단언 ────────────────────────────────
for (const [n, expected] of CASES) {
    t.ok(text.includes(`${n} → ${expected}\n`) || text.trimEnd().endsWith(`${n} → ${expected}`),
        `numberToHangul(${n}) = '${expected}'`);
}

t.ok(pageErrors.length === 0, `페이지 에러 없음 (got ${pageErrors.length})`);
if (pageErrors.length) console.log('  errors:', pageErrors.slice(0, 3));

await browser.close();
process.exit(t.summary());
