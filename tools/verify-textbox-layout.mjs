#!/usr/bin/env node
// 글상자 레이아웃 회귀 가드 — knowledge/07 의 네 주장을 실제 엔진에서 확인한다.
//
//   ① entity 를 비워두면 fontSize 가 NaN
//      → knowledge/07 §글상자 entity 를 비워두면 fontSize 가 NaN
//   ② lineBreak:true 는 width 에서 접고 height 를 넘는 줄을 버린다
//      → knowledge/07 §lineBreak:true 는 height 를 넘는 줄을 그리지 않고 버린다
//   ③ `묻기` 입력칸이 무대 아래를 덮고, 말풍선은 x:500 으로 밀어낼 수 있다
//      → knowledge/07 §묻고 대답 기다리기
//   ④ 장면을 왕복해도 실행기가 쌓이지 않는다
//      → knowledge/07 §장면을 다시 들어가도 실행기는 쌓이지 않는다
//
// 사전 조건: npm start.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import { createReporter } from './lib/verify-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '..', 'tests/fixtures/textbox-layout.ent');

// 문서가 주장하는 상수. 여기가 틀리면 knowledge/07 도 함께 고쳐야 한다.
const INPUT_TOP = -71;      // 135 − 275×0.75
const INPUT_BOTTOM = -112;  // 135 − 329×0.75
const STAGE_HALF_W = 240;

const t = createReporter();
const { browser, page, pageErrors } = await bootEditor();
try {
    await loadFixture(page, FIXTURE);

    // ── ① entity 를 비워두면 fontSize 가 NaN ────────────────────────────────
    const fonts = await page.evaluate(() => {
        const out = {};
        for (const o of Entry.container.objects_) {
            out[o.name] = {
                fontSize: o.entity.getFontSize(),
                font: o.entity.getFont ? o.entity.getFont() : null,
                lineBreak: o.entity.getLineBreak(),
                width: o.entity.getWidth(), height: o.entity.getHeight(),
                scaleX: o.entity.getScaleX(),
            };
        }
        return out;
    });
    console.log('\n① entity 기본값 함정');
    t.ok(Number.isNaN(fonts['기본entity'].fontSize),
        'entity 를 {x,y} 만 주면 fontSize 가 NaN '
        + `(got ${fonts['기본entity'].fontSize}) — 이게 깨지면 make-ent 가 고쳐진 것이니 `
        + 'knowledge/07·03 을 함께 갱신할 것');
    t.eq(fonts['전체entity'].fontSize, 16, 'entity 를 전부 명시하면 fontSize 가 그대로');
    t.eq(fonts['전체entity'].scaleX, 1, '명시한 scaleX 가 유지됨 (기본값 1.2 로 안 덮임)');

    // ── ② lineBreak — 접기 폭 · 세로 클리핑 ─────────────────────────────────
    console.log('\n② lineBreak 접기와 세로 클리핑');
    const wrap = await page.evaluate(() => {
        const e = Entry.container.objects_.find((o) => o.name === '전체entity').entity;
        const tx = e.textObject;
        const lineH = tx.style ? tx.style.lineHeight : tx.lineHeight;
        const prev = e.getText();
        e.setText('한 줄');
        const oneH = tx.getMeasuredHeight();
        e.setText(prev);
        return {
            renderer: tx.style ? 'PIXI' : 'CreateJS',
            lineH, oneH, fullH: tx.getMeasuredHeight(),
            wrapWidth: tx.lineWidth ?? (tx.style ? tx.style.wordWrapWidth : null),
            maxHeight: tx.style ? tx.style.maxHeight : tx.maxHeight,
            boxW: e.getWidth(), boxH: e.getHeight(),
            textLen: e.getText().length,
        };
    });
    const lines = Math.round(wrap.fullH / wrap.lineH);
    const drawable = Math.floor(wrap.boxH / wrap.lineH);
    console.log(`     렌더러 ${wrap.renderer} · lineHeight ${wrap.lineH}`
        + ` · 접기폭 ${wrap.wrapWidth} · 높이 ${Math.round(wrap.oneH)}→${Math.round(wrap.fullH)}`);
    t.eq(wrap.wrapWidth, wrap.boxW, '접기 폭 = entity.width (내용 길이로 안 덮임)');
    t.ok(lines > 1, `${wrap.textLen}자가 ${lines}줄로 접힘`);
    t.eq(wrap.maxHeight, wrap.boxH, 'maxHeight = entity.height — 초과분은 그려지지 않는다');
    t.ok(lines > drawable,
        `${lines}줄 중 ${drawable}줄만 그려진다 (height ${wrap.boxH} / lineHeight ${wrap.lineH})`
        + ' — 잘려도 entity.getText() 에는 전문이 남는다');
    t.eq(wrap.lineH, fonts['전체entity'].fontSize + 2, 'lineHeight = fontSize + 2');

    // ── ③ 묻기 — 입력칸 자리 · 말풍선 위치 ──────────────────────────────────
    console.log('\n③ 묻기 입력칸과 말풍선');
    await page.evaluate(() => Entry.engine.toggleRun());
    await page.waitForTimeout(900);

    const ask = await page.evaluate((halfW) => {
        const asker = Entry.container.objects_.find((o) => o.name === '묻기');
        const f = Entry.stage.inputField;
        const d = asker.entity.dialog;
        // CanvasInput / PIXICanvasInput 둘 다 캔버스 좌표를 `_y` 에 둔다.
        // 시각 높이 = _height + padding×2 + borderWidth×2.
        const toEntryY = (canvasY) => 135 - canvasY * 0.75;
        const visualH = f
            ? (f._height ?? 0) + (f._padding ?? 0) * 2 + (f._borderWidth ?? 0) * 2
            : null;
        return {
            hasField: !!(f && !f._isHidden),
            fieldTop: f && typeof f._y === 'number' ? toEntryY(f._y) : null,
            fieldBottom: f && typeof f._y === 'number' ? toEntryY(f._y + visualH) : null,
            fieldH: visualH,
            hasDialog: !!d,
            dialogX: d && d.object ? d.object.x : null,
            dialogVisible: d && d.object ? d.object.visible : null,
            askerX: asker.entity.getX(),
            askerVisible: asker.entity.getVisible(),
            offStage: d && d.object ? Math.abs(d.object.x) > halfW : null,
        };
    }, STAGE_HALF_W);

    t.ok(ask.hasField, '`묻기` 가 입력칸을 띄웠다');
    if (ask.fieldTop !== null) {
        t.between(ask.fieldTop, INPUT_TOP - 2, INPUT_TOP + 2,
            `입력칸 윗변이 엔트리 y ${INPUT_TOP} (실제 ${ask.fieldTop.toFixed(1)})`);
        t.between(ask.fieldBottom, INPUT_BOTTOM - 3, INPUT_BOTTOM + 3,
            `입력칸 아랫변이 엔트리 y ${INPUT_BOTTOM} (실제 ${ask.fieldBottom.toFixed(1)})`
            + ` — 세로 ${ask.fieldH}px 를 덮는다. 이 아래에 글상자를 두면 안 보인다`);
    } else {
        t.ok(false, `입력칸 좌표를 못 읽음 — 문서값 ${INPUT_TOP}~${INPUT_BOTTOM} 재확인 필요`);
    }
    t.eq(ask.askerX, 500, '묻는 오브젝트가 무대 밖 x=500');
    t.ok(ask.askerVisible === false, '묻는 오브젝트는 숨김 상태');
    if (ask.hasDialog) {
        t.ok(ask.dialogVisible !== false,
            '말풍선은 hide() 를 해도 visible 이다 (syncDialogVisible 은 setVisible 때만 돈다)');
        t.ok(ask.offStage,
            `말풍선이 무대(±${STAGE_HALF_W}) 밖 — x=${Math.round(ask.dialogX)}. `
            + 'dialog.ts 의 w 가지에 위쪽 clamp 가 없어서 성립한다');
    } else {
        t.ok(true, '말풍선 객체 없음 — 이 렌더러에서는 확인 생략');
    }

    // ── ④ 장면 왕복 — 실행기가 쌓이지 않는다 ────────────────────────────────
    console.log('\n④ 장면 재진입');
    const execOf = (name) => page.evaluate((n) => {
        const o = Entry.container.objects_.find((x) => x.name === n);
        return o ? o.script.executors.length : -1;
    }, name);

    const before = await execOf('루프');
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
            Entry.scene.selectScene(Entry.scene.scenes_.find((s) => s.name === '딴곳'));
            Entry.engine.fireEvent('when_scene_start');
        });
        await page.waitForTimeout(250);
        await page.evaluate(() => {
            Entry.scene.selectScene(Entry.scene.scenes_.find((s) => s.name === '본'));
            Entry.engine.fireEvent('when_scene_start');
        });
        await page.waitForTimeout(250);
    }
    const after = await execOf('루프');
    t.eq(after, before, `장면 3회 왕복 후에도 실행기 ${before}개 그대로 `
        + '(selectScene → resetSceneDuringRun → clearRunningStateOnScene)');
    t.ok(after === 1, '무한 루프 스레드는 정확히 1개 — 가드 블록이 필요 없다');

    // entity.reset() 이 좌표를 되돌린다 — 위 왕복을 거친 뒤 확인
    const movedBack = await page.evaluate(() => {
        const e = Entry.container.objects_.find((o) => o.name === '전체entity').entity;
        const spec = { x: 0, y: 0 };
        e.setX(123); e.setY(45);
        Entry.scene.selectScene(Entry.scene.scenes_.find((s) => s.name === '딴곳'));
        Entry.engine.fireEvent('when_scene_start');
        Entry.scene.selectScene(Entry.scene.scenes_.find((s) => s.name === '본'));
        Entry.engine.fireEvent('when_scene_start');
        return { x: e.getX(), y: e.getY(), spec };
    });
    t.eq({ x: movedBack.x, y: movedBack.y }, movedBack.spec,
        'entity.reset() 이 런타임에 옮긴 좌표를 spec 값으로 되돌린다 '
        + '→ 좌표 연출은 장면 진입 때마다 다시 잡아야 한다');

    t.ok(pageErrors.length === 0, `page error 0 (${pageErrors.join(' | ')})`);
} finally {
    await browser.close();
}
process.exit(t.summary());
