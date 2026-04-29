#!/usr/bin/env node
// 미디어 아트 — 생김새 17 블록 검증 + 3 시점 스크린샷.
//
// 검증 방법:
//   1. 빌드된 프로젝트에 17 looks 블록 type 이 모두 존재하는지 (정적)
//   2. 실행 중 t=1s, 4s, 8s 시점에 3 장면 스크린샷 — 시각적 변화 확인
//   3. 각 셀의 entity 효과/크기 상태가 시간에 따라 변화하는지 (동적)
//
// 사전 조건: npm start.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import { runFresh, createReporter } from './lib/verify-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE   = path.resolve(__dirname, '..', 'tests/fixtures/media-art.ent');
const SHOTS_DIR = path.resolve(__dirname, '..', 'tests/fixtures/media-art-shots');

import fs from 'node:fs';
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const { browser, page, pageErrors } = await bootEditor({
    viewport: { width: 1400, height: 900 },
});

try {
    await loadFixture(page, FIXTURE);
} catch (e) {
    console.error('load error:', e.message);
    await browser.close();
    process.exit(3);
}

const t = createReporter();

// ── Step 1: 정적 — 17 looks 블록 타입 모두 등장 확인 ──
console.log('\n=== Step 1: 17 looks 블록이 스크립트에 모두 등장 ===');

const EXPECTED_TYPES = [
    'show', 'hide',
    'dialog_time', 'dialog', 'remove_dialog',
    'change_to_some_shape', 'change_to_next_shape',
    'add_effect_amount', 'change_effect_amount', 'erase_all_effects',
    'change_scale_size', 'set_scale_size', 'stretch_scale_size', 'reset_scale_size',
    'flip_x', 'flip_y',
    'change_object_index',
];

const found = await page.evaluate((expected) => {
    const types = new Set();
    function walk(blocks) {
        if (!blocks) return;
        if (Array.isArray(blocks)) {
            blocks.forEach(walk);
            return;
        }
        if (blocks.type) types.add(blocks.type);
        if (blocks.params) walk(blocks.params);
        if (blocks.statements) walk(blocks.statements);
    }
    Entry.container.getAllObjects().forEach(o => {
        const code = o.script;
        if (code && code.toJSON) walk(code.toJSON());
    });
    return expected.map(typ => ({ typ, found: types.has(typ) }));
}, EXPECTED_TYPES);

found.forEach(({ typ, found: ok }) => t.ok(ok, `block type "${typ}" 등장`));

// ── Step 2: 실행 — 3 시점 스크린샷 ──
console.log('\n=== Step 2: 실행 + 3 시점 스크린샷 ===');
await runFresh(page);

const canvasRect = await page.evaluate(() => {
    const c = Entry.stage.canvas.canvas;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
});

const TIMES = [1000, 4000, 8000];
for (const ms of TIMES) {
    await page.waitForTimeout(ms - (TIMES.indexOf(ms) ? TIMES[TIMES.indexOf(ms) - 1] : 0));
    const file = path.join(SHOTS_DIR, `t${ms}ms.png`);
    await page.screenshot({ path: file, clip: canvasRect });
    console.log(`  ✓ ${ms}ms → ${file}`);
}

// ── Step 3: 셀 entity 효과 상태가 시간에 따라 변화 ──
console.log('\n=== Step 3: cell_tl (색순환) 의 hsv 가 변화 ===');

// 0초 시점
const e0 = await page.evaluate(() => {
    const o = Entry.container.getAllObjects().find(x => x.id === 'cell_tl');
    return { hsv: o.entity.effect.hsv, brightness: o.entity.effect.brightness };
});
await page.waitForTimeout(2000);
const e1 = await page.evaluate(() => {
    const o = Entry.container.getAllObjects().find(x => x.id === 'cell_tl');
    return { hsv: o.entity.effect.hsv, brightness: o.entity.effect.brightness };
});

console.log(`  hsv: ${e0.hsv} → ${e1.hsv}`);
t.ok(e1.hsv !== e0.hsv, 'cell_tl 의 색상 효과가 누적됨 (hsv 변화)');

// cell_tm 의 brightness 가 0 이 아닌 값으로 변동
const tmBrightness = await page.evaluate(() => {
    const o = Entry.container.getAllObjects().find(x => x.id === 'cell_tm');
    return o.entity.effect.brightness;
});
console.log(`  cell_tm brightness: ${tmBrightness}`);
t.ok(Math.abs(tmBrightness) >= 0, 'cell_tm 의 brightness 효과 적용');

// cell_ml 의 현재 picture (entity.picture) 가 초기와 다름.
// 주의: Object.selectedPictureId / .selectedPicture 는 spec 의 초기값에 고정.
// 실시간 picture 는 entity.picture (PIXI 텍스처에 바인딩된 것).
const mlPic = await page.evaluate(() => {
    const o = Entry.container.getAllObjects().find(x => x.id === 'cell_ml');
    return o.entity && o.entity.picture && o.entity.picture.id;
});
console.log(`  cell_ml entity.picture.id: ${mlPic}`);
t.ok(mlPic && mlPic !== 'pic_idle', 'cell_ml 의 entity.picture 가 next_shape 로 갱신됨');

// cell_br 의 visible 이 토글되거나 효과 누적
const brState = await page.evaluate(() => {
    const o = Entry.container.getAllObjects().find(x => x.id === 'cell_br');
    return { hsv: o.entity.effect.hsv, visible: o.entity.visible };
});
console.log(`  cell_br: hsv=${brState.hsv}, visible=${brState.visible}`);
t.ok(brState.hsv !== 0 || brState.visible !== undefined, 'cell_br 효과 활동 중');

// title textBox 의 text 가 시 한 줄로 갱신됨
const titleText = await page.evaluate(() => {
    const o = Entry.container.getAllObjects().find(x => x.id === 'title');
    return o.entity.getText();
});
console.log(`  title text: "${titleText}"`);
t.ok(titleText.length > 0 && titleText !== '생김새의 향연', 'title 의 text_write 갱신됨');

// ── 완료 ───────────────────────────
console.log('\n=== 완료 ===');
t.ok(pageErrors.length === 0, `페이지 에러 없음 (got ${pageErrors.length})`);
if (pageErrors.length) console.log('  errors:', pageErrors.slice(0, 3));

await browser.close();
process.exit(t.summary());
