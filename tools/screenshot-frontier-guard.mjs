#!/usr/bin/env node
// 프론티어 가드 — 초기 화면 + 적 spawn 후 시각 확인.
import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import { runFresh } from './lib/verify-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '..', 'tests/fixtures/frontier-guard.ent');
const OUT_DIR = path.resolve(__dirname, '..', 'tests/output');
import fs from 'node:fs';
fs.mkdirSync(OUT_DIR, { recursive: true });

const { browser, page } = await bootEditor({ viewport: { width: 1400, height: 900 } });
try {
    await loadFixture(page, FIXTURE);

    await runFresh(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT_DIR, 'fg-1-intro.png') });
    console.log('1 intro 저장됨');

    // intro → play
    await page.evaluate(() => {
        const btn = Entry.container.getAllObjects().find(o => o.id === 'intro_start_btn');
        Entry.dispatchEvent('entityClick', btn.entity);
    });
    await page.waitForTimeout(1500);  // 슬롯 클론 spawn 완료
    await page.screenshot({ path: path.join(OUT_DIR, 'fg-2-prep-empty.png') });
    console.log('2 prep-empty 저장됨 (4 슬롯 비어있음)');

    // 슬롯 1 클릭 → 빌드 메뉴 열기
    await page.evaluate(() => {
        const tpl = Entry.container.getAllObjects().find(o => o.id === 'slot_template');
        const slot1 = (tpl?.clonedEntities || []).find(e => e.direction === 1);
        if (slot1) Entry.dispatchEvent('entityClick', slot1);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, 'fg-3-build-menu.png') });
    console.log('3 build-menu 저장됨 (슬롯 1 클릭 후 메뉴)');

    // "궁수" 버튼 (menu_btn1) 클릭 — archer 빌드
    await page.evaluate(() => {
        const btn = Entry.container.getAllObjects().find(o => o.id === 'menu_btn1');
        Entry.dispatchEvent('entityClick', btn.entity);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, 'fg-4-archer-built.png') });
    console.log('4 archer-built 저장됨 (슬롯 1에 archer)');

    // 슬롯 3 → cannon
    await page.evaluate(() => {
        const tpl = Entry.container.getAllObjects().find(o => o.id === 'slot_template');
        const slot = (tpl?.clonedEntities || []).find(e => e.direction === 3);
        if (slot) Entry.dispatchEvent('entityClick', slot);
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
        const btn = Entry.container.getAllObjects().find(o => o.id === 'menu_btn2');  // 대포
        Entry.dispatchEvent('entityClick', btn.entity);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, 'fg-5-2-towers-built.png') });
    console.log('5 2-towers 저장됨 (슬롯 1=archer, 3=cannon)');

    // 준비 완료
    await page.evaluate(() => {
        const btn = Entry.container.getAllObjects().find(o => o.id === 'prep_done_btn');
        Entry.dispatchEvent('entityClick', btn.entity);
    });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(OUT_DIR, 'fg-6-wave1.png') });
    console.log('6 wave1 저장됨');

    await page.waitForTimeout(15000);
    await page.screenshot({ path: path.join(OUT_DIR, 'fg-7-mid.png') });
    console.log('7 mid 저장됨');

    await page.waitForTimeout(15000);
    await page.screenshot({ path: path.join(OUT_DIR, 'fg-8-end.png') });
    console.log('8 end 저장됨');

    // 변수/리스트 dump
    const dump = await page.evaluate(() => {
        const v = (n) => Entry.variableContainer.variables_.find(x => x.name_ === n)?.getValue();
        const l = (n) => (Entry.variableContainer.lists_.find(x => x.name_ === n)?.array_ || []).map(i => i.data);
        const slotTpl = Entry.container.getAllObjects().find(o => o.id === 'slot_template');
        const slots = (slotTpl?.clonedEntities || []).map(e => ({
            x: Math.round(e.x), y: Math.round(e.y),
            direction: e.direction,
            picId: e.picture && e.picture.id,
            visible: e.visible,
        }));
        const enemyTpl = Entry.container.getAllObjects().find(o => o.id === 'enemy');
        const enemies = (enemyTpl?.clonedEntities || []).length;
        return {
            sceneId: Entry.scene.selectedScene?.id,
            life: v('체력'), gold: v('골드'), wave: v('웨이브'), done: v('처리수'),
            state: v('상태'), prep_done: v('준비완료'), menu_state: v('ms'), building_slot: v('bs'),
            slot_type: l('st').map(Number),
            slot_level: l('sl').map(Number),
            slots, enemyCount: enemies,
        };
    });
    console.log('dump:', JSON.stringify(dump, null, 2));
} finally {
    await browser.close();
}
