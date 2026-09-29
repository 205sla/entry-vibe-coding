// SUNSET DRIVE — L4 runtime verification (real Entry engine, real keyboard events).
//
// Principles
//   * never force game variables: every scenario is driven by document keydown/keyup only;
//     variables and lists are read, never written
//   * each scenario runs in its own browser process (knowledge/07: after ~10 reboots in one
//     process headless key events stop reaching the game)
//   * the race bot looks at the game state the way a player looks at the screen (road curve,
//     cars ahead) and only presses arrow keys
//
// usage:  npm start   (editor server on :3000)
//         node games/sunset-drive/verify.mjs [--ent path] [--only boot|controls|race|audio]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { bootEditor, loadFixture } from '../../tools/lib/editor-harness.mjs';
import { CONST } from './spec.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const latest = () => fs.readdirSync(dir).filter((n) => /^sunset-drive_\d{3}\.ent$/.test(n)).sort().pop();
const ENT = path.resolve(arg('--ent') || path.join(dir, latest() || 'sunset-drive_001.ent'));
const SHOTS = path.join(dir, 'verify-shots');
const REPORT = path.join(dir, 'verification.json');
const SCENARIOS = ['boot', 'controls', 'audio', 'race', 'roundtrip'];

// ── parent: run each scenario in a child process and merge the reports ───
if (!arg('--only')) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const report = {
    date: new Date().toISOString(), file: path.relative(dir, ENT),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(ENT)).digest('hex'), bytes: fs.statSync(ENT).size,
    scenarios: {},
  };
  for (const name of SCENARIOS) {
    const out = path.join(SHOTS, `${name}.json`);
    fs.rmSync(out, { force: true });
    console.log(`\n── ${name} ──`);
    await new Promise((resolve) => {
      const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), '--only', name, '--ent', ENT], { stdio: 'inherit' });
      ch.on('close', resolve);
    });
    report.scenarios[name] = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { passed: false, error: 'scenario crashed' };
  }
  const all = Object.values(report.scenarios).flatMap((s) => s.checks || []);
  report.summary = { checks: all.length, failed: all.filter((c) => !c.ok).map((c) => c.name) };
  report.passed = report.summary.failed.length === 0 && Object.values(report.scenarios).every((s) => s.passed);
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${all.length - report.summary.failed.length}/${all.length} checks passed → ${path.relative(process.cwd(), REPORT)}`);
  if (!report.passed) { console.log('FAILED:', report.summary.failed); process.exitCode = 1; }
  process.exit();
}

// ── child: one scenario ─────────────────────────────────────────────────
const scenario = arg('--only');
const result = { scenario, checks: [], data: {}, shots: [], pageErrors: [], consoleErrors: [] };
const check = (name, ok, detail) => {
  result.checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
  return ok;
};
// Frame-rate floors describe the game on a desktop browser. CI runners draw without
// a GPU on shared CPUs, so there the numbers are recorded, not judged.
const perfCheck = (name, ok, detail) => {
  if (!process.env.CI) return check(name, ok, detail);
  (result.data.perfOnCi ??= []).push({ name, ok: !!ok, detail });
  console.log(`  ℹ ${name}  ${JSON.stringify(detail)}  (CI: recorded, judged on local runs)`);
  return true;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { browser, page, pageErrors } = await bootEditor({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text()); });

const V = (names) => page.evaluate((ns) => Object.fromEntries(ns.map((n) => {
  const x = Entry.variableContainer.variables_.find((v) => v.name_ === n);
  return [n, x ? Number(x.getValue()) : null];
})), names);
const LST = (id) => page.evaluate((i) => (Entry.variableContainer.lists_.find((l) => l.id_ === i) || { array_: [] }).array_.map((o) => Number(o.data)), id);
const key = (code, down) => page.evaluate(({ code, down }) => document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code })), { code, down });
const tap = async (code) => { await key(code, true); await sleep(90); await key(code, false); };
const visible = (id) => page.evaluate((i) => { const o = Entry.container.getObject(i); return !!(o && o.entity.getVisible()); }, id);
const canvasPng = () => page.locator('#entryCanvas').screenshot();
const shot = async (name) => {
  const file = path.join(SHOTS, `${scenario}-${name}.png`);
  fs.writeFileSync(file, await canvasPng());
  result.shots.push(path.relative(dir, file));
};
// pixel statistics of the stage in relative regions (fx0, fy0, fx1, fy1 in 0..1, y down)
const regionStats = async (png, [fx0, fy0, fx1, fy1]) => {
  const img = sharp(png);
  const { width, height } = await img.metadata();
  const x0 = Math.floor(fx0 * width), y0 = Math.floor(fy0 * height), w = Math.max(1, Math.floor((fx1 - fx0) * width)), h = Math.max(1, Math.floor((fy1 - fy0) * height));
  const { data, info } = await img.extract({ left: x0, top: y0, width: w, height: h }).raw().toBuffer({ resolveWithObject: true });
  let gray = 0, dark = 0, n = 0; const colors = new Set();
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (Math.abs(r - g) < 16 && Math.abs(g - b) < 22 && lum > 70 && lum < 150) gray++;
    if (lum < 90) dark++;
    colors.add((r >> 3) << 10 | (g >> 3) << 5 | (b >> 3));
    n++;
  }
  return { gray: gray / n, dark: dark / n, colors: colors.size };
};
// timing hook: script time per tick and tick timestamps (installed before the run starts)
const installProbes = () => page.evaluate(() => {
  const c = Entry.container, orig = c.mapObjectOnScene;
  window.__ticks = []; window.__work = [];
  c.mapObjectOnScene = function (f, ...rest) {
    if (f !== Entry.engine.computeFunction) return orig.call(this, f, ...rest);
    const t = performance.now(); const r = orig.call(this, f, ...rest);
    window.__ticks.push(t); window.__work.push(performance.now() - t); return r;
  };
});
const perf = () => page.evaluate(() => {
  const t = window.__ticks, w = window.__work.slice().sort((a, b) => a - b);
  const gaps = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
  const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  const out = { ticks: t.length, workMed: q(w, 0.5), workP95: q(w, 0.95), gapMed: q(gaps, 0.5), gapP99: q(gaps, 0.99), gapMax: gaps[gaps.length - 1] };
  window.__ticks = []; window.__work = [];
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v]));
});
const fpsOver = async (ms) => {
  const a = await V(['frames']); const t0 = Date.now();
  await sleep(ms);
  const b = await V(['frames']);
  return +((b.frames - a.frames) / ((Date.now() - t0) / 1000)).toFixed(1);
};
const run = async () => {
  await installProbes();
  // a real page click supplies the user gesture that unlocks WebAudio
  await page.locator('#entryCanvas').click({ position: { x: 5, y: 5 }, force: true });
  await page.evaluate(async () => {
    const ctx = window.createjs?.WebAudioPlugin?.context;
    if (ctx && ctx.state === 'suspended') await ctx.resume();
    Entry.engine.toggleRun();
  });
};
// audio probe: native block calls for sounds and BGM, plus the output level after the master gain
const installAudio = () => page.evaluate(() => {
  const plugin = createjs.Sound.activePlugin;
  const analyser = plugin.context.createAnalyser();
  analyser.fftSize = 2048;
  plugin.gainNode.connect(analyser);
  const calls = [];
  const wrap = (name) => {
    const orig = Entry.Utils[name];
    Entry.Utils[name] = function (id, ...rest) {
      const inst = orig.call(this, id, ...rest);
      const snd = Entry.container.getAllObjects().flatMap((o) => o.getSounds ? o.getSounds() : o.sounds || []).find((s) => s.id === id);
      calls.push({ kind: name, id, name: snd ? snd.name : id, state: inst && inst.playState, t: performance.now(), rate: Entry.playbackRateValue });
      return inst;
    };
  };
  wrap('playSound'); wrap('playBGM');
  window.__audio = { analyser, calls };
});
const level = (ms = 400) => page.evaluate(async (ms) => {
  const a = window.__audio.analyser; let peak = 0, sum = 0, n = 0; const end = performance.now() + ms;
  do {
    const buf = new Float32Array(a.fftSize); a.getFloatTimeDomainData(buf);
    for (const v of buf) { peak = Math.max(peak, Math.abs(v)); sum += v * v; n++; }
    await new Promise((r) => setTimeout(r, 25));
  } while (performance.now() < end);
  return { peak: +peak.toFixed(4), rms: +Math.sqrt(sum / n).toFixed(4) };
}, ms);
const audioCalls = () => page.evaluate(() => window.__audio.calls.map((c) => ({ ...c, t: Math.round(c.t) })));

// ── the race bot (keys only) ─────────────────────────────────────────────
const startBot = () => page.evaluate(({ SEG, TRACK, K, MAXV }) => {
  const vars = {}; for (const v of Entry.variableContainer.variables_) vars[v.name_] = v;
  const lists = {}; for (const l of Entry.variableContainer.lists_) lists[l.id_] = l;
  const get = (n) => Number(vars[n].getValue());
  const at = (id, i) => Number(lists[id].array_[i - 1].data);
  const held = {};
  const press = (code, on) => {
    if (!!held[code] === on) return;
    held[code] = on;
    document.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code }));
  };
  let lane = 0.62, laneT = 0;
  const lanes = [-0.62, 0, 0.62];
  window.__botLog = { laneChanges: 0, brakes: 0 };
  window.__bot = setInterval(() => {
    if (get('state') !== 2) { press('ArrowUp', false); press('ArrowDown', false); press('ArrowLeft', false); press('ArrowRight', false); return; }
    const px = get('px'), speed = get('speed'), pD = get('pD'), spd = speed / MAXV;
    const i = Math.floor((pD % TRACK) / SEG) + 1;
    let ahead = 0;
    for (let k = 1; k <= 7; k++) ahead = Math.max(ahead, Math.abs(at('tc', i + k)) / K);
    const curve = at('tc', i) / K;
    // clearance per lane from the cars ahead
    const clear = lanes.map((L) => {
      let gap = 1e9;
      for (let k = 1; k <= 7; k++) {
        const d = at('rD', k) - pD, x = at('rX', k);
        if (d > -300 && d < 4000 && Math.abs(x - L) < 0.56) gap = Math.min(gap, d);
      }
      return gap;
    });
    const cur = lanes.reduce((b, L, k) => (Math.abs(L - lane) < Math.abs(lanes[b] - lane) ? k : b), 0);
    if (clear[cur] < 2600 && performance.now() - laneT > 500) {
      let best = cur;
      for (let k = 0; k < 3; k++) if (clear[k] > clear[best] + 400 && Math.abs(k - cur) <= 1) best = k;
      if (best !== cur) { lane = lanes[best]; laneT = performance.now(); window.__botLog.laneChanges++; }
    }
    const target = Math.max(-0.8, Math.min(0.8, lane + curve * 0.012));
    const e = px - target;
    press('ArrowLeft', e > 0.05);
    press('ArrowRight', e < -0.05);
    // lift for sharp curves, brake when boxed in behind a slower car
    // the car straight ahead of where we actually are (not just our target lane)
    let front = 1e9;
    for (let k = 1; k <= 7; k++) { const d = at('rD', k) - pD; if (d > 0 && d < 1500 && Math.abs(at('rX', k) - px) < 0.56) front = Math.min(front, d); }
    const blocked = clear[cur] < 650 || front < 650;
    const tooFast = (ahead > 14 && spd > 0.8) || (ahead > 10 && spd > 0.93);
    press('ArrowUp', !tooFast && !blocked);
    const brake = blocked && spd > 0.55;
    if (brake && !held.ArrowDown) window.__botLog.brakes++;
    press('ArrowDown', brake);
  }, 16);
}, { SEG: CONST.SEG, TRACK: CONST.TRACK, K: CONST.K, MAXV: CONST.MAXV });
const stopBot = () => page.evaluate(() => { clearInterval(window.__bot); for (const c of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) document.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c })); return window.__botLog; });

try {
  await loadFixture(page, ENT, { loadSettleMs: 2500 });
  const project = await page.evaluate(() => ({
    objects: Entry.container.getAllObjects().length,
    functions: Object.keys(Entry.variableContainer.functions_).length,
    lists: Entry.variableContainer.lists_.length,
    variables: Entry.variableContainer.variables_.length,
    blocks: Entry.container.getAllObjects().reduce((n, o) => n + o.script.getBlockList().length, 0)
      + Object.values(Entry.variableContainer.functions_).reduce((n, f) => n + f.content.getBlockList().length, 0),
  }));
  result.data.project = project;

  if (scenario === 'boot') {
    await run();
    await sleep(3000);
    const a = await V(['state', 'frames', 'pD', 'speed']);
    const r0 = await LST('rD');
    await sleep(2000);
    const b = await V(['state', 'frames', 'pD']);
    const r1 = await LST('rD');
    check('title screen state (0) after start', a.state === 0 && b.state === 0, a.state);
    check('attract mode: demo car drives itself', b.pD > a.pD + 5000, { from: Math.round(a.pD), to: Math.round(b.pD) });
    check('attract mode: all 7 rivals drive', r1.every((d, k) => d > r0[k] + 3000), r1.map((d, k) => Math.round(d - r0[k])));
    check('title logo and PRESS SPACE are shown, race HUD hidden', (await visible('title')) && !(await visible('hudframe')));
    await shot('title');
    const png = await canvasPng();
    const top = await regionStats(png, [0.05, 0.0, 0.95, 0.12]);
    const bottom = await regionStats(png, [0.0, 0.62, 1.0, 1.0]);
    check('sky at the top is dark (sunset sky drawn)', top.dark > 0.6, top);
    check('asphalt pixels in the lower third (road filled)', bottom.gray > 0.08, bottom);
    check('frame has rich detail (>300 distinct colours)', bottom.colors + top.colors > 300, bottom.colors + top.colors);
    result.data.fpsTitle = await fpsOver(3000);
    result.data.perfTitle = await perf();
    perfCheck('title/attract fps ≥ 55', result.data.fpsTitle >= 55, result.data.fpsTitle);
    check('project structure', project.objects === 13 && project.lists >= 20, project);
  }

  if (scenario === 'controls') {
    await run();
    await sleep(1500);
    await tap('Space');
    await sleep(300);
    let s = await V(['state', 'cd', 'pD']);
    check('SPACE starts the countdown (state 1)', s.state === 1, s);
    const t0 = Date.now();
    await key('ArrowUp', true); // revving on the grid must not move the car
    await sleep(1400);
    const mid = await V(['state', 'pD', 'speed', 'cd']);
    await shot('countdown');
    check('car stays on the grid during the countdown', mid.pD === s.pD && mid.speed === 0, mid);
    check('countdown banner visible', await visible('banner'));
    while ((await V(['state'])).state === 1 && Date.now() - t0 < 6000) await sleep(20);
    const goMs = Date.now() - t0 + 300;
    check('GO after ~3.6 s', goMs > 3100 && goMs < 4300, goMs);
    await sleep(3000);
    const acc = await V(['speed', 'throttle', 'pD']);
    check('holding ↑ accelerates (≥ 180 km/h after 3 s)', acc.speed * 290 / CONST.MAXV >= 180, Math.round(acc.speed * 290 / CONST.MAXV));
    await key('ArrowUp', false);
    await sleep(800);
    const coast = await V(['speed']);
    check('releasing ↑ coasts down', coast.speed < acc.speed - 500, { before: Math.round(acc.speed), after: Math.round(coast.speed) });
    await key('ArrowUp', true);
    await sleep(600);
    await key('ArrowDown', true);
    await sleep(120);
    const br = await V(['brake', 'speed']);
    await sleep(500);
    const br2 = await V(['speed']);
    await key('ArrowDown', false);
    check('↓ brakes hard (brake lights on)', br.brake === 1 && br2.speed < br.speed - 3000, { brake: br.brake, from: Math.round(br.speed), to: Math.round(br2.speed) });
    await sleep(1500);
    const p0 = (await V(['px'])).px;
    await key('ArrowLeft', true); await sleep(350);
    const st = await V(['steer', 'px']); await key('ArrowLeft', false);
    check('← steers left', st.steer === -1 && st.px < p0 - 0.15, { from: p0, to: st.px });
    await key('ArrowRight', true); await sleep(700); await key('ArrowRight', false);
    const p2 = (await V(['px'])).px;
    check('→ steers right', p2 > st.px + 0.3, { from: st.px, to: p2 });
    // off-road on the right, where the palms stand
    await key('ArrowRight', true); await sleep(1100); await key('ArrowRight', false);
    const off0 = await V(['offroad', 'px', 'crash', 'lastCrash']);
    await sleep(1800);
    const off1 = await V(['offroad', 'speed', 'px', 'crash', 'lastCrash']);
    await shot('offroad');
    check('leaving the asphalt sets offroad and caps speed (~36%)', off0.offroad === 1 && off1.speed < CONST.MAXV * 0.45, { px: off0.px, speed: Math.round(off1.speed) });
    // keep driving in the scenery until a palm is hit. The crash is sampled inside the
    // page the moment lastCrash changes: polled from Node, a slow runner saw it only
    // when the crash timer had nearly run out and the car had already sped up again.
    await page.evaluate((last0) => {
      const get = (n) => Number(Entry.variableContainer.variables_.find((v) => v.name_ === n).getValue());
      window.__crashSample = null;
      const watch = setInterval(() => {
        if (get('lastCrash') > last0) {
          window.__crashSample = { px: get('px'), crash: get('crash'), speed: get('speed') };
          clearInterval(watch);
        }
      }, 5);
    }, off0.lastCrash);
    let hit = null; const tHit = Date.now();
    while (Date.now() - tHit < 12000) {
      hit = await page.evaluate(() => window.__crashSample);
      if (hit) break;
      const x = await V(['px']);
      await key('ArrowRight', x.px < 1.75); await key('ArrowLeft', x.px > 1.95);
      await sleep(40);
    }
    await key('ArrowRight', false); await key('ArrowLeft', false);
    check('hitting a roadside object crashes the car (crash timer, speed < 20%, pushed toward the road)', hit && hit.crash > 0 && hit.speed < CONST.MAXV * 0.2 && hit.px < 1.75, hit && { speed: Math.round(hit.speed), px: +hit.px.toFixed(2), crash: +hit.crash.toFixed(2) });
    await shot('crash');
    // pause
    await tap('KeyP'); await sleep(200);
    const pz0 = await V(['paused', 'pD', 'raceT']);
    await sleep(1000);
    const pz1 = await V(['paused', 'pD', 'raceT']);
    await shot('pause');
    check('P pauses the race (distance and clock frozen)', pz0.paused === 1 && pz1.pD === pz0.pD && pz1.raceT === pz0.raceT, { pD: [pz0.pD, pz1.pD] });
    await tap('KeyP'); await sleep(600);
    const pz2 = await V(['paused', 'raceT']);
    check('P resumes', pz2.paused === 0 && pz2.raceT > pz1.raceT, pz2);
    await key('ArrowUp', false);
    await tap('KeyR'); await sleep(800);
    check('R returns to the title', (await V(['state'])).state === 0);
  }

  if (scenario === 'audio') {
    await installAudio();
    await run();
    await sleep(2500);
    const sounds = await page.evaluate(() => Entry.container.getAllObjects().flatMap((o) => (o.sounds || []).map((s) => ({
      name: s.name, ext: s.ext, registered: !!createjs.Sound._idHash[s.id], decoded: !!createjs.Sound.activePlugin._audioSources?.[s.path]?.getChannelData,
    }))));
    result.data.sounds = sounds;
    check('8 MP3 sounds registered and decoded', sounds.length === 8 && sounds.every((x) => x.registered && x.decoded && x.ext === '.mp3'), sounds.filter((x) => !x.registered || !x.decoded));
    const titleLevel = await level(600);
    let calls = await audioCalls();
    check('title music plays on the BGM channel', calls.some((c) => c.kind === 'playBGM' && c.name === 'title' && c.state === 'playSucceeded'), calls.map((c) => c.name));
    check('title music is audible (rms > 0.01)', titleLevel.rms > 0.01, titleLevel);
    await tap('Space');
    await sleep(900);
    const cdLevel = await level(500);
    calls = await audioCalls();
    check('countdown beeps start with the countdown', calls.some((c) => c.kind === 'playBGM' && c.name === 'countdown'), cdLevel);
    check('engine idles during the countdown', calls.some((c) => c.kind === 'playSound' && c.name === 'engine'));
    await sleep(3000);
    await key('ArrowUp', true);
    await sleep(1200);
    const low = await page.evaluate(() => Entry.playbackRateValue);
    await sleep(3500);
    const high = await page.evaluate(() => Entry.playbackRateValue);
    const raceLevel = await level(600);
    calls = await audioCalls();
    const engineCalls = calls.filter((c) => c.name === 'engine');
    result.data.engineRates = engineCalls.map((c) => +c.rate.toFixed(2));
    check('race music starts on the BGM channel after GO', calls.some((c) => c.kind === 'playBGM' && c.name === 'race' && c.state === 'playSucceeded'));
    check('engine pitch follows speed (playback rate rises)', high > low + 0.35 && high <= 2, { low, high });
    check('engine sample re-triggers with overlap (≥ 8 starts)', engineCalls.length >= 8, engineCalls.length);
    check('race audio is audible (rms > 0.01)', raceLevel.rms > 0.01, raceLevel);
    const bgmRate = await page.evaluate(() => Entry.bgmInstances.getAllValues().map((i) => i.sourceNode?.playbackRate?.value));
    check('music stays at normal pitch while the engine is pitched', bgmRate.length > 0 && bgmRate.every((r) => r === 1), bgmRate);
    // crash sound: drive into the palms on the right
    await key('ArrowRight', true);
    const tC = Date.now(); let crashCall = null;
    while (Date.now() - tC < 12000 && !crashCall) {
      const x = await V(['px']);
      await key('ArrowRight', x.px < 1.75); await key('ArrowLeft', x.px > 1.95);
      crashCall = (await audioCalls()).find((c) => c.name === 'crash');
      await sleep(50);
    }
    await key('ArrowRight', false); await key('ArrowLeft', false);
    check('crashing plays the crash sound', !!crashCall, crashCall && crashCall.state);
    // mute and unmute
    await tap('KeyM');
    await sleep(700);
    const muted = await level(600);
    check('M mutes all audio (peak ≈ 0)', muted.peak < 0.002, muted);
    await tap('KeyM');
    await sleep(1200);
    const back = await level(600);
    check('M again restores the audio', back.rms > 0.005, back);
    await key('ArrowUp', false);
    result.data.audioCalls = (await audioCalls()).slice(0, 60);
  }

  if (scenario === 'race') {
    await installAudio();
    await run();
    await sleep(1500);
    await tap('Space');
    await sleep(1500);
    await shot('grid');
    while ((await V(['state'])).state === 1) await sleep(30);
    await startBot();
    const timeline = [];
    const seen = { lap2: false, lap3: false, finish: false, lapBanner: [], themes: new Set() };
    const t0 = Date.now();
    const shotAt = { 8: 'beach', 40: 'forest', 70: 'canyon', 100: 'lap3' };
    let lastSec = 0, prevCrash = 0;
    const crashes = [];
    await perf();
    while (Date.now() - t0 < 200000) {
      const s = await V(['state', 'lap', 'place', 'raceT', 'frames', 'speed', 'banner', 'bannerT', 'theme', 'offroad', 'crash', 'pD', 'skid']);
      if (s.skid === 1 && !seen.skidShot) { seen.skidShot = true; await shot('skid'); }
      if (s.skid === 1) seen.skidFrames = (seen.skidFrames || 0) + 1;
      seen.themes.add(s.theme);
      if (s.crash > prevCrash + 0.2) {
        const d = await page.evaluate(() => { const g = (n) => Number(Entry.variableContainer.variables_.find((v) => v.name_ === n).getValue()); const L = (i) => Entry.variableContainer.lists_.find((l) => l.id_ === i).array_.map((o) => Number(o.data)); const pD = g('pD'), px = g('px'); const rD = L('rD'), rX = L('rX'); let best = null; rD.forEach((d, k) => { const gap = d - pD; if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { k: k + 1, gap: Math.round(gap), dx: +(rX[k] - px).toFixed(2) }; }); return { px: +px.toFixed(2), crash: +g('crash').toFixed(2), curve: g('curveP'), nearest: best }; });
        crashes.push({ t: +((Date.now() - t0) / 1000).toFixed(1), ...d });
      }
      prevCrash = s.crash;
      if (s.bannerT > 0 && (s.banner === 5 || s.banner === 6) && !seen.lapBanner.includes(s.banner)) { seen.lapBanner.push(s.banner); await shot(`banner-lap${s.banner === 5 ? 2 : 3}`); }
      const sec = Math.floor((Date.now() - t0) / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        timeline.push({ t: sec, lap: s.lap, place: s.place, kmh: Math.round(s.speed * 290 / CONST.MAXV), frames: s.frames, theme: s.theme, crash: s.crash > 0 ? 1 : 0 });
        if (shotAt[sec]) await shot(shotAt[sec]);
      }
      if (s.state === 3) break;
      await sleep(100);
    }
    const botLog = await stopBot();
    const racePerf = await perf();
    // fps per second from the frame counter timeline
    const fps = timeline.slice(1).map((x, k) => x.frames - timeline[k].frames).filter((x) => x > 0);
    const sorted = fps.slice().sort((a, b) => a - b);
    result.data.race = { crashes, timeline, botLog, perf: racePerf, fpsMedian: sorted[sorted.length >> 1], fpsMin: sorted[0], fpsP5: sorted[Math.floor(sorted.length * 0.05)] };
    const fin = await V(['state', 'place', 'finishT', 'bestLap', 'record', 'newRecord', 'lap', 'raceT']);
    const laps = await LST('laps');
    result.data.result = { ...fin, laps };
    await shot('finish');
    check('the race finishes after 3 laps (state 3)', fin.state === 3 && fin.lap === 3, fin);
    check('three lap times recorded (30–70 s each)', laps.length === 3 && laps.every((x) => x > 30 && x < 70), laps.map((x) => +x.toFixed(2)));
    check('finish time = sum of lap times', Math.abs(laps.reduce((a, b) => a + b, 0) - fin.finishT) < 0.05, { sum: +laps.reduce((a, b) => a + b, 0).toFixed(3), finishT: +fin.finishT.toFixed(3) });
    check('best lap = fastest lap', Math.abs(Math.min(...laps) - fin.bestLap) < 0.001, fin.bestLap);
    check('first finish sets the record (NEW RECORD)', fin.record === fin.finishT && fin.newRecord === 1);
    check('LAP 2 and FINAL LAP banners shown', seen.lapBanner.includes(5) && seen.lapBanner.includes(6), seen.lapBanner);
    check('all three scenery themes visited', [0, 1, 2].every((t) => seen.themes.has(t)), [...seen.themes]);
    check('the keyboard-only bot wins the race (1st)', fin.place === 1, fin.place);
    perfCheck('median frame rate ≥ 58 fps over the whole race', result.data.race.fpsMedian >= 58, result.data.race.fpsMedian);
    perfCheck('no second below 45 fps', result.data.race.fpsMin >= 45, result.data.race.fpsMin);
    await sleep(3000);
    await shot('results');
    check('results panel shown with place and times', (await visible('results')) && (await V(['resultT'])).resultT > 2.2);
    const calls = await audioCalls();
    check('lap chime played at each lap', calls.filter((c) => c.name === 'lap').length >= 2, calls.filter((c) => c.name === 'lap').length);
    check('finish fanfare played', calls.some((c) => c.kind === 'playBGM' && c.name === 'finish'));
    check('hard cornering at speed smokes the tyres and screeches', seen.skidFrames > 0 && calls.some((c) => c.name === 'skid'), { skidSamples: seen.skidFrames, screeches: calls.filter((c) => c.name === 'skid').length });
    await tap('Space');
    await sleep(800);
    const again = await V(['state', 'lap', 'raceT', 'place']);
    check('SPACE on the results starts a new race', again.state === 1 && again.lap === 1 && again.raceT === 0, again);
  }

  if (scenario === 'roundtrip') {
    // save through the editor (Entry.exportProject → /api/export), then open the saved file again
    const bytes = Array.from(fs.readFileSync(ENT));
    const rt = await page.evaluate(async (bytes) => {
      const load = async (u8) => {
        const fd = new FormData(); fd.append('ent', new Blob([new Uint8Array(u8)]), 'x.ent');
        const r = await fetch('/api/load', { method: 'POST', body: fd });
        return r.json();
      };
      const count = () => ({
        pictures: Entry.container.getAllObjects().reduce((n, o) => n + o.pictures.length, 0),
        sounds: Entry.container.getAllObjects().reduce((n, o) => n + o.sounds.length, 0),
        blocks: Entry.container.getAllObjects().reduce((n, o) => n + o.script.getBlockList().length, 0)
          + Object.values(Entry.variableContainer.functions_).reduce((n, f) => n + f.content.getBlockList().length, 0),
        lists: Entry.variableContainer.lists_.reduce((n, l) => n + l.array_.length, 0),
      });
      const p1 = await load(bytes);
      Entry.clearProject(); await Entry.loadProject(p1);
      await new Promise((r) => setTimeout(r, 1500));
      const before = count();
      const exported = Entry.exportProject({}); exported.__sid = p1.__sid;
      const res = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exported) });
      const out = new Uint8Array(await res.arrayBuffer());
      const p2 = await load(Array.from(out));
      Entry.clearProject(); await Entry.loadProject(p2);
      await new Promise((r) => setTimeout(r, 2500));
      return { ok: res.ok, size: out.length, magic: [out[0], out[1]], before, after: count() };
    }, bytes);
    result.data.roundtrip = rt;
    check('editor export produces a gzip .ent', rt.ok && rt.magic[0] === 0x1f && rt.magic[1] === 0x8b, { size: rt.size });
    check('re-imported project keeps every picture, sound, block and list item', JSON.stringify(rt.before) === JSON.stringify(rt.after), rt.after);
    await installAudio();
    await run();
    await sleep(3000);
    const a = await V(['state', 'frames']);
    const snd = await page.evaluate(() => Entry.container.getAllObjects().flatMap((o) => o.sounds.map((s) => !!createjs.Sound._idHash[s.id] && !!createjs.Sound.activePlugin._audioSources?.[s.path]?.getChannelData)));
    check('re-imported game boots to the title and animates', a.state === 0 && a.frames > 120, a);
    check('re-imported sounds register and decode', snd.length === 8 && snd.every(Boolean), snd);
    await tap('Space');
    await sleep(4200);
    check('re-imported game starts a race', (await V(['state'])).state === 2);
    await shot('reimported');
  }

  result.pageErrors = pageErrors.slice();
  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3));
  check('no console errors', result.consoleErrors.length === 0, result.consoleErrors.slice(0, 3));
} catch (e) {
  result.error = e.stack || e.message;
  console.error(e);
} finally {
  result.passed = !result.error && result.checks.every((c) => c.ok);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, `${scenario}.json`), JSON.stringify(result, null, 2) + '\n');
  await browser.close();
}
