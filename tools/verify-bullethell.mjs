#!/usr/bin/env node
// Runtime 검증: 탄막 피하기 3 장면 게임.
//
// 시나리오:
//   1. bullethell.ent 로드 → menu 장면 활성
//   2. start_btn 클릭 → play 장면으로 전환 (체력=3, 타이머 시작)
//   3. hp=0 으로 강제 세팅 → 플레이어 check 스레드가 result 장면으로 전환
//   4. restart_btn 클릭 → menu 장면으로 복귀
//
// 사전 조건: npm start.

import path from 'node:path';
import url from 'node:url';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE   = path.resolve(__dirname, '..', 'tests/fixtures/bullethell.ent');

let browser, page, errs;
try {
    ({ browser, page, pageErrors: errs } = await bootEditor({
        viewport: { width: 1400, height: 900 },
    }));
} catch (e) {
    console.error('error:', e.message);
    process.exit(2);
}

try {
    await loadFixture(page, FIXTURE);
} catch (e) {
    console.error('error:', e.message);
    await browser.close();
    process.exit(3);
}

async function currentScene() {
    return page.evaluate(() => ({
        id: Entry.scene.selectedScene && Entry.scene.selectedScene.id,
        name: Entry.scene.selectedScene && Entry.scene.selectedScene.name,
        objectsInScene: Entry.container.getAllObjects()
            .filter(o => o.scene.id === (Entry.scene.selectedScene && Entry.scene.selectedScene.id))
            .map(o => o.id),
    }));
}

async function getHP() {
    return page.evaluate(() => {
        const v = Entry.variableContainer.variables_.find(x => x.name_ === '체력');
        return v ? +v.getValue() : null;
    });
}
async function getSurvive() {
    return page.evaluate(() => {
        const v = Entry.variableContainer.variables_.find(x => x.name_ === '생존시간');
        return v ? +v.getValue() : null;
    });
}

async function setHP(n) {
    return page.evaluate((n) => {
        const v = Entry.variableContainer.variables_.find(x => x.name_ === '체력');
        v.setValue(n);
    }, n);
}

async function clickObject(objectId) {
    return page.evaluate((id) => {
        const obj = Entry.container.getAllObjects().find(o => o.id === id);
        if (!obj) throw new Error('object not found: ' + id);
        Entry.dispatchEvent('entityClick', obj.entity);
    }, objectId);
}

let pass = true;
const log = (ok, msg) => { console.log(ok ? '  ✓' : '  ✗', msg); if (!ok) pass = false; };

console.log('\n=== Step 1: 로드 직후 menu 장면 ===');
let s = await currentScene();
console.log('  scene:', s.id, '|', s.name);
console.log('  objects:', s.objectsInScene);
log(s.id === 'menu', "현재 장면 'menu' 이다");
log(s.objectsInScene.includes('start_btn'), 'start_btn 이 menu 장면에 있다');

console.log('\n=== Step 2: toggleRun 후 start_btn 클릭 → play ===');
await page.evaluate(() => { try { Entry.engine.toggleRun(); } catch {} });
await page.waitForTimeout(500);
await clickObject('start_btn');
await page.waitForTimeout(1200);

s = await currentScene();
console.log('  scene:', s.id, '|', s.name);
log(s.id === 'play', "start_btn 클릭 후 'play' 장면으로 전환");
log(s.objectsInScene.includes('player'), 'player 가 play 장면에 있다');
log(s.objectsInScene.includes('bullet'), 'bullet 이 play 장면에 있다');

const hpInitial = await getHP();
console.log('  hp:', hpInitial);
log(hpInitial === 3, 'play 장면 시작 시 hp=3 으로 리셋');

console.log('\n=== Step 3: 몇 초 생존 후 hp=0 으로 강제 → result ===');
await page.waitForTimeout(2000);  // 실제로 2초 생존

await setHP(0);
await page.waitForTimeout(800);  // player의 check 스레드가 scene 전환하도록

s = await currentScene();
console.log('  scene:', s.id, '|', s.name);
log(s.id === 'result', 'hp=0 이후 result 장면으로 자동 전환');
log(s.objectsInScene.includes('restart_btn'), 'restart_btn 이 result 장면에 있다');

const survive = await getSurvive();
console.log('  survive:', survive, '초');
log(survive > 1 && survive < 10, '생존시간 변수에 기록됨 (1~10s 범위 내)');

console.log('\n=== Step 4: restart_btn 클릭 → menu 복귀 ===');
await clickObject('restart_btn');
await page.waitForTimeout(1000);

s = await currentScene();
console.log('  scene:', s.id, '|', s.name);
log(s.id === 'menu', "restart_btn 클릭 후 'menu' 장면으로 복귀");

console.log('\n=== 종합 ===');
console.log(`pageErrors: ${errs.length}`);
if (errs.length) for (const e of errs.slice(0, 5)) console.log(' -', e);

console.log(pass ? '\n✓ 3 장면 게임 전체 플로우 통과' : '\n✗ 일부 검증 실패');

await browser.close();
process.exit(pass ? 0 : 4);
