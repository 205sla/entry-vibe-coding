#!/usr/bin/env node
// Zero-authoring runtime check (L4 minimum) — no verify.mjs needed.
//
//   node tools/play-check.mjs games/<name>/<name>_001.ent
//
// Loads the .ent into the offline editor (starts server.js if nothing answers
// on BASE_URL), presses ▶, and reports what actually happens:
//   - 2 s untouched: how each object moves, which variables/texts/shapes change
//   - shown objects that add no pixel to the stage (covered by a layer above)
//   - every key the first scene listens for (arrows + space when none): held 0.6 s,
//     compared with an untouched run of the same length (Math.random is seeded
//     identically, so random spawns do not count as a key effect)
//   - a stage screenshot for a visual look
// It does not judge game rules — compare the report with what the game should do.
// Exit 1 on load failure, page errors, key fields that are not key codes, shown
// objects that are never drawn, or when no first-scene key changes anything.
import fs from 'node:fs';
import path from 'node:path';
import { bootEditor, loadFixture } from './lib/editor-harness.mjs';
import { runFresh } from './lib/verify-harness.mjs';
import { startEditorServer, stopChild } from './run-all-verify.mjs';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
    console.error('usage: node tools/play-check.mjs <file.ent>');
    process.exit(2);
}
const baseURL = process.env.BASE_URL || 'http://localhost:3000';
const JUMP = 40;  // a move this long between ~10 ms samples is a teleport (respawn, locateXY)
const KEY_LABEL = { 37: '←', 38: '↑', 39: '→', 40: '↓', 32: '스페이스', 13: '엔터', 27: 'Esc' };
const keyLabel = (code) => KEY_LABEL[code] || (code >= 65 && code <= 90 ? String.fromCharCode(code) : '키 ' + code);

function snapshot(page) {
    return page.evaluate(() => {
        const out = { objects: {}, vars: {}, scene: Entry.scene.selectedScene?.name };
        for (const o of Entry.container.getAllObjects()) {
            const e = o.entity;
            out.objects[o.id] = {
                name: o.name, x: e.getX(), y: e.getY(), visible: e.getVisible(),
                shape: e.picture?.name, text: o.objectType === 'textBox' ? e.getText() : undefined,
                clones: (o.clonedEntities || []).length,
            };
        }
        for (const v of Entry.variableContainer.variables_) out.vars[v.name_] = String(v.getValue());
        for (const l of Entry.variableContainer.lists_) out.vars['리스트 ' + l.name_] = (l.array_ || []).length + '칸';
        return out;
    });
}

// Run from ▶ with a fixed random seed, wait `delay` ms, then watch for `ms` ms,
// optionally holding a key. Motion is tracked inside the page every ~10 ms so
// fast movers are not mistaken for jumps.
async function playWindow(page, ms, code = null, delay = 300) {
    await page.evaluate(() => {
        let seed = 20260929;
        Math.random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    });
    await runFresh(page);
    await page.waitForTimeout(delay);
    const first = await snapshot(page);
    await page.evaluate((jump) => {
        const prev = {}, motion = {};
        const read = () => {
            for (const o of Entry.container.getAllObjects()) {
                const x = o.entity.getX(), y = o.entity.getY(), p = prev[o.id];
                if (p) {
                    const m = motion[o.id] ??= { dx: 0, dy: 0, jumps: 0 };
                    if (Math.hypot(x - p.x, y - p.y) > jump) m.jumps++;
                    else { m.dx += x - p.x; m.dy += y - p.y; }
                }
                prev[o.id] = { x, y };
            }
        };
        read();
        window.__playCheck = { motion, read, timer: setInterval(read, 10) };
    }, JUMP);
    if (code) await page.evaluate(c => document.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c })), code);
    await page.waitForTimeout(ms);
    if (code) await page.evaluate(c => document.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c })), code);
    const motion = await page.evaluate(() => {
        clearInterval(window.__playCheck.timer);
        window.__playCheck.read();
        return window.__playCheck.motion;
    });
    return { first, last: await snapshot(page), motion, ms };
}

function direction(dx, dy) {
    const h = dx > 2 ? '오른쪽' : dx < -2 ? '왼쪽' : '';
    const v = dy > 2 ? '위' : dy < -2 ? '아래' : '';
    if (h && v) return `${h} ${v}로`;
    return h ? h + '으로' : v + '로';
}

function describeMotion(name, m, ms) {
    const dist = Math.hypot(m.dx, m.dy);
    const parts = [];
    if (dist > 2) parts.push(`${direction(m.dx, m.dy)} 이동 (초당 약 ${Math.round(dist / (ms / 1000))})`);
    if (m.jumps) parts.push(`순간이동 ${m.jumps}번`);
    return parts.length ? `${name}: ${parts.join(', ')}` : null;
}

// Non-motion differences between two end states.
function stateDiff(a, b, labelA, labelB) {
    const lines = [];
    for (const [id, o] of Object.entries(b.objects)) {
        const p = a.objects[id];
        if (!p) continue;
        if (o.visible !== p.visible) lines.push(`${o.name}: ${labelA} ${p.visible ? '보임' : '숨김'} / ${labelB} ${o.visible ? '보임' : '숨김'}`);
        if (o.shape !== p.shape) lines.push(`${o.name}: 모양 ${p.shape} → ${o.shape}`);
        if (o.text !== p.text) lines.push(`${o.name}: 글 "${p.text}" → "${o.text}"`);
        if (o.clones !== p.clones) lines.push(`${o.name}: 복제본 ${p.clones} → ${o.clones}개`);
    }
    for (const [name, v] of Object.entries(b.vars)) {
        if (a.vars[name] !== v) lines.push(`변수 ${name}: ${a.vars[name]} → ${v}`);
    }
    if (a.scene !== b.scene) lines.push(`장면: ${a.scene} → ${b.scene}`);
    return lines;
}

// What a key run did that the untouched run did not.
function keyEffect(run, base) {
    const lines = [];
    for (const [id, o] of Object.entries(run.last.objects)) {
        const m = run.motion[id] || { dx: 0, dy: 0, jumps: 0 };
        const b = base.motion[id] || { dx: 0, dy: 0, jumps: 0 };
        const gap = Math.hypot(m.dx - b.dx, m.dy - b.dy);
        if (gap > Math.max(4, 0.25 * Math.hypot(b.dx, b.dy))) {
            lines.push(describeMotion(o.name, m, run.ms) || `${o.name}: 가만히 둘 때와 달리 멈춤`);
        }
    }
    return lines.concat(stateDiff(base.last, run.last, '가만히', '키'));
}

// Objects that are shown and on stage but add no pixel to the picture because an
// upper layer covers them: render with and without the object (same task, so no
// tick in between); if nothing changes, hide the upper layers and try again —
// only objects that appear then count (blank stamp sources and the like do not).
// Returns null when the stage canvas has no 2D context (WebGL renderer).
function findCovered(page) {
    return page.evaluate(() => {
        const canvas = Entry.stage.canvas?.canvas;
        const ctx = canvas?.getContext?.('2d');
        if (!ctx) return null;
        const grab = () => { Entry.stage.updateForce(); return ctx.getImageData(0, 0, canvas.width, canvas.height).data; };
        const differs = (a, b) => {
            let diff = 0;
            for (let i = 0; i < a.length && diff < 4; i += 4) {
                if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
            }
            return diff >= 4;
        };
        // Does object `e` change the picture while the objects in `hidden` are hidden?
        const draws = (e, hidden) => {
            hidden.forEach(h => { h.object.visible = false; });
            const shown = grab();
            e.object.visible = false;
            const gone = grab();
            e.object.visible = true;
            hidden.forEach(h => { h.object.visible = true; });
            return differs(shown, gone);
        };
        const objects = Entry.container.getCurrentObjects();  // first = top layer
        const covered = [];
        objects.forEach((o, i) => {
            const e = o.entity;
            if (!e.getVisible() || e.object.alpha < 0.01) return;
            if (Math.abs(e.getX()) > 240 || Math.abs(e.getY()) > 135) return;
            if (draws(e, [])) return;
            const above = objects.slice(0, i).map(a => a.entity).filter(a => a.getVisible());
            // Still nothing with every upper layer hidden: blank/transparent by design.
            if (!above.length || !draws(e, above)) return;
            const by = above.filter(a => draws(e, [a])).map(a => a.parent.name);
            covered.push({ name: o.name, by: by.length ? by : above.map(a => a.parent.name).slice(0, 3) });
        });
        Entry.stage.updateForce();
        return covered;
    });
}

let server, browser, failed = false;
try {
    try {
        const { chromium } = await import('@playwright/test');
        await (await chromium.launch()).close();
    } catch (e) {
        console.error('Chromium 을 띄울 수 없다 — `npx playwright install chromium` 을 먼저 실행한다.\n' + e.message.split('\n')[0]);
        process.exit(2);
    }
    server = await startEditorServer(baseURL);
    let page, pageErrors;
    ({ browser, page, pageErrors } = await bootEditor({ baseUrl: baseURL }));
    await loadFixture(page, path.resolve(file));

    const keys = await page.evaluate(() => {
        const found = new Map();  // raw field value → { held: is_press_some_key, here: first-scene object }
        const first = Entry.scene.selectedScene;
        for (const o of Entry.container.getAllObjects()) {
            for (const b of o.script.getBlockList(false)) {
                const raw = b.type === 'when_some_key_pressed' ? String(b.params[1])
                    : b.type === 'is_press_some_key' ? String(b.params[0]) : null;
                if (raw === null) continue;
                const k = found.get(raw) || { held: false, here: false };
                found.set(raw, { held: k.held || b.type === 'is_press_some_key', here: k.here || o.scene === first });
            }
        }
        const toCode = {};
        for (const [code, k] of Object.entries(Entry.KeyboardCode.codeToKeyCode)) toCode[k] ??= code;
        return [...found].map(([raw, k]) => ({ raw, ...k, key: Number(raw), code: toCode[raw] || null }));
    });

    console.log(`[play-check] ${path.basename(file)}`);
    const idle = await playWindow(page, 2000);
    const idleLines = Object.entries(idle.last.objects)
        .map(([id, o]) => idle.motion[id] && describeMotion(o.name, idle.motion[id], idle.ms))
        .filter(Boolean)
        .concat(stateDiff(idle.first, idle.last, '처음', '2초 뒤'));
    console.log('\n가만히 2초:');
    console.log(idleLines.length ? idleLines.map(s => '  ' + s).join('\n') : '  아무 변화 없음');
    const texts = Object.values(idle.last.objects).filter(o => o.visible && o.text !== undefined && o.text.trim());
    if (texts.length) console.log('  지금 화면의 글: ' + texts.map(o => `${o.name} "${o.text}"`).join(', '));
    for (const c of await findCovered(page) || []) {
        failed = true;
        console.log(`✗ ${c.name}: 보이는 상태인데 ${c.by.join('·')}에 완전히 가려져 화면에 안 나온다 — `
            + 'objects 배열은 앞쪽이 위 레이어다(배경은 맨 뒤에). 일부러 겹쳐 숨긴 것이면 무시한다.');
    }

    const shotDir = path.resolve('test-results/play-check');
    fs.mkdirSync(shotDir, { recursive: true });
    const shot = path.join(shotDir, path.basename(file, '.ent') + '.png');
    const canvas = await page.evaluate(() => {
        const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    await page.screenshot({ path: shot, clip: canvas });

    const badKeys = keys.filter(k => !/^\d+$/.test(k.raw));
    for (const k of badKeys) {
        failed = true;
        console.log(`\n✗ 키 값 "${k.raw}" 는 키 코드가 아니다 — 이 키 블록은 절대 실행되지 않는다. 숫자 코드('37' ←, '39' →, '32' 스페이스)나 DSL isPressed('ArrowLeft') 를 쓴다.`);
    }
    const usable = keys.filter(k => /^\d+$/.test(k.raw) && k.here);
    const later = keys.filter(k => /^\d+$/.test(k.raw) && !k.here);
    if (later.length) console.log(`\n다른 장면에서만 쓰는 키: ${later.map(k => keyLabel(k.key)).join(' ')} (첫 장면에서는 누르지 않는다)`);
    const tested = usable.length ? usable : keys.length ? [] : [37, 39, 38, 40, 32].map(key => ({ key, unused: true }));
    const FALLBACK = { 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 32: 'Space' };
    let deadKeys = 0;
    const stepKeys = [];
    // Press every key after `delay` ms of running; returns the number of dead keys.
    async function pressKeys(delay, title) {
        const baseline = await playWindow(page, 600, null, delay);
        console.log(title);
        let dead = 0;
        for (const k of tested) {
            const code = k.code || FALLBACK[k.key];
            if (!code) { console.log(`  ${keyLabel(k.key)}: 이 키를 누를 방법이 없다 (건너뜀)`); continue; }
            const lines = keyEffect(await playWindow(page, 600, code, delay), baseline);
            if (!lines.length && !k.unused) dead++;
            console.log(`  ${keyLabel(k.key)}: ${lines.length ? lines.join(' / ') : k.unused ? '반응 없음' : '⚠ 반응 없음'}`);
            if (!k.unused && !k.held && lines.some(l => l.includes('이동')) && !stepKeys.includes(keyLabel(k.key))) stepKeys.push(keyLabel(k.key));
        }
        return dead;
    }
    if (tested.length) {
        deadKeys = await pressKeys(300, usable.length ? '\n키를 0.6초 누르고 있을 때 (가만히 둘 때와 다른 점):' : '\n키를 쓰는 블록이 없다 — 방향키·스페이스만 눌러 본다:');
        // Keys may be ignored during an intro, a pattern display and so on — try later once.
        if (usable.length && deadKeys === usable.length) {
            deadKeys = await pressKeys(3000, '\n처음에는 반응이 없어 실행 3초 뒤에 다시 눌러 본다:');
        }
    }

    if (pageErrors.length) {
        failed = true;
        console.log('\n✗ page error ' + pageErrors.length + '건:\n  ' + pageErrors.slice(0, 5).join('\n  '));
    }
    if (usable.length && deadKeys === usable.length) {
        failed = true;
        console.log('\n✗ 이 작품이 쓰는 키를 모두 눌러 봤지만 아무것도 바뀌지 않았다 — 키 블록·조건·좌표를 확인한다. '
            + '안내 화면처럼 3초 넘게 일부러 키를 막는 작품이면 verify.mjs 로 그 상태를 만든 뒤 확인한다.');
    } else if (deadKeys) {
        console.log(`\n⚠ 반응 없는 키 ${deadKeys}개 — 게임 오버 뒤 재시작처럼 특정 상태에서만 쓰는 키가 아니라면 확인한다.`);
    }
    if (stepKeys.length) {
        console.log(`\n참고: ${stepKeys.join(' ')} 이동은 "키를 눌렀을 때" 블록이라 누를 때마다 한 번 움직이고, 누르고 있으면 `
            + 'OS 키 반복 전까지 멈칫한다. 누르고 있는 동안 부드럽게 움직이려면 계속 반복 + isPressed(\'ArrowLeft\') 를 쓴다.');
    }
    console.log(`\n무대 스크린샷: ${path.relative(process.cwd(), shot)}`);
    console.log('좌표: x 는 오른쪽이 +, y 는 위쪽이 + (무대 x -240~240, y -135~135).');
    console.log(failed ? '\n[play-check] FAIL' : '\n[play-check] 완료 — 위 보고가 만들려던 게임과 맞는지 비교한다.');
} catch (e) {
    failed = true;
    console.error('[play-check] ' + e.message);
} finally {
    await browser?.close();
    await stopChild(server);
}
process.exit(failed ? 1 : 0);
