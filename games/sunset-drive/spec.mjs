// SUNSET DRIVE — an OutRun-style pseudo-3D racer made of ordinary Entry blocks.
// This file is the build-time DSL; the generated .ent runs without it.
//
// Renderer (see knowledge/19-sunset-drive-case-study.md):
//   * the road is a list of 500-unit "bands" with curve (lateral acceleration) and height
//   * every frame a recursive *normal* function walks the visible bands near→far,
//     projects each band edge (scale = 1/z), and fills four quads per band
//     (ground, rumble strip, asphalt, lane dashes) — hills are clipped against the
//     highest edge drawn so far
//   * on the way back up the recursion (far→near) it stamps that band's rival cars and
//     roadside sprites, so the painter's algorithm order comes for free
//   * loop state lives in function parameters, temporaries in function-local variables:
//     a global `set_variable` costs ~5 µs (it re-lays-out the variable monitor) versus ~1 µs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  when, repeat, if_, cmp, and_, or_, calc, mod, quotient, txt,
  getVar as v, setVar as s, changeVar as inc, valueAt as at, setListAt as put,
  fn, call, obj, scene, isPressed, locateXY, eraseAll, stamp, show, hide,
  setSize, startDraw, stopDraw, setThickness, setColor, timer,
} from '../../tools/lib/spec-dsl.mjs';
import { buildTrack, SEG, SPRITE } from './track.mjs';
import * as art from './assets.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));

// ── Constants (build time) ───────────────────────────────────────────────
const { bands, L } = buildTrack();
const TRACK = L * SEG;
const DRAW = 46;              // projected road edges per frame (n = 2..DRAW)
const K = 200;                // focal length in stage px; world values are pre-scaled by K
const RW = 1000, KRW = K * RW;// road half width
const CH = 1000;              // camera height above the road
const HOR = 25;               // horizon (stage y)
const PZ = 1400;              // player car distance in front of the camera
const MAXV = 12000;           // top speed (world units / s) → shown as 290 km/h
const LAPS = 3;
const LINE = 8 * SEG;         // start/finish line (gantry at band 8)
const RIVALS = 7;
const CARSZ = K * 640;        // rival picture canvas = 640 world units wide
const FIRST_CAR_PIC = 16;     // painter pictures: 1 blank, 2..15 scenery, 16.. cars (3 views each)

// ── Tiny DSL helpers ─────────────────────────────────────────────────────
const add = (a, b) => calc(a, '+', b), sub = (a, b) => calc(a, '-', b);
const mul = (a, b) => calc(a, '*', b), div = (a, b) => calc(a, '/', b);
const eq = (a, b) => cmp(a, '==', b), ne = (a, b) => cmp(a, '!=', b);
const lt = (a, b) => cmp(a, '<', b), le = (a, b) => cmp(a, '<=', b);
const gt = (a, b) => cmp(a, '>', b), ge = (a, b) => cmp(a, '>=', b);
const op = (a, f) => ({ type: 'calc_operation', params: [null, a, null, f] });
const abs = (a) => op(a, 'abs'), floor = (a) => op(a, 'floor'), round = (a) => op(a, 'round');
const setFill = (x) => ({ type: 'set_fill_color', params: [x, null] });
const startFill = () => ({ type: 'start_fill', params: [null] });
const stopFill = () => ({ type: 'stop_fill', params: [null] });
const shape = (x) => ({ type: 'change_to_some_shape', params: [x, null] });
const penAlpha = (x) => ({ type: 'set_brush_tranparency', params: [x, null] });
const penColor = (x) => ({ type: 'set_color', params: [x, null] });
const quad = (x1, y1, x2, y2, x3, y3, x4, y4) => [locateXY(x1, y1), startFill(), locateXY(x2, y2), locateXY(x3, y3), locateXY(x4, y4), stopFill()];
const dot = (x, y) => [stopDraw(), locateXY(x, y), startDraw(), locateXY(add(x, 0.4), y), stopDraw()];
const clampSet = (id, lo, hi) => [if_(lt(v(id), lo), [s(id, lo)]), if_(gt(v(id), hi), [s(id, hi)])];
// snap a lateral position to the nearest of the three lanes (-0.62, 0, 0.62)
const snapLane = (x) => mul(round(div(x, 0.62)), 0.62);
const key = { left: 37, up: 38, right: 39, down: 40, space: 32, r: 82, p: 80, m: 77, z: 90, x: 88 };
const anyKey = (...codes) => codes.map(isPressed).reduce((a, b) => or_(a, b));
const play = (name) => ({ type: 'sound_something_with_block', params: [txt(name), null] });
const bgm = (name) => ({ type: 'play_bgm', params: [txt(name), null] });
const stopBgm = () => ({ type: 'stop_bgm', params: [null] });
const silence = () => ({ type: 'sound_silent_all', params: ['all', null] });
const soundRate = (x) => ({ type: 'sound_speed_set', params: [x, null] });
const soundVolume = (x) => ({ type: 'sound_volume_set', params: [x, null] });

// ── Lists: track data (extended so indices never wrap inside a frame) ────
const ext = (f) => [...bands, ...bands.slice(0, DRAW + 6)].map((b, i) => f(b, i % L));
const r2 = (x) => Math.round(x * 100) / 100;
const FOG = '#e39a86';
const mix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map((sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t));
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
};
// palette index = 1 + theme*2 + parity  (theme 3 = start line)  + fog tier offset (0/8/16/24)
const base = {
  g: ['#e0af76', '#d5a36b', '#5a8c3e', '#4f7e36', '#d27c47', '#c67040', '#e0af76', '#d5a36b'],
  r: ['#e8484a', '#f4efe4', '#e8484a', '#f4efe4', '#ffd24a', '#40363a', '#e8484a', '#f4efe4'],
  d: ['#716c7a', '#6a6673', '#65616f', '#5e5b68', '#6e6368', '#675d62', '#f4efe4', '#1c1a22'],
};
const tiers = [0, 0.3, 0.55, 0.8];
const pal = (arr) => tiers.flatMap((t) => arr.map((c) => mix(c, FOG, t)));
const fogTier = (n) => (n < 24 ? 0 : n < 31 ? 8 : n < 38 ? 16 : 24);
const spriteSize = { // canvas width in world units
  [SPRITE.PALM]: 3400, [SPRITE.PALM2]: 3400, [SPRITE.BILLBOARD]: 2600, [SPRITE.SIGN_LEFT]: 1300, [SPRITE.SIGN_RIGHT]: 1300,
  [SPRITE.ROCK]: 1700, [SPRITE.PINE]: 3700, [SPRITE.CACTUS]: 2100, [SPRITE.LAMP]: 2600, [SPRITE.GANTRY]: 3000,
  [SPRITE.BOARD_ENTRY]: 2600, [SPRITE.BOARD_205]: 2600, [SPRITE.HOUSE]: 1500, [SPRITE.BUSH]: 1500,
};
const spriteHit = { // collision half width (road half widths); 0 = drive-through
  [SPRITE.PALM]: 0.1, [SPRITE.PALM2]: 0.1, [SPRITE.BILLBOARD]: 0.5, [SPRITE.SIGN_LEFT]: 0.1, [SPRITE.SIGN_RIGHT]: 0.1,
  [SPRITE.ROCK]: 0.42, [SPRITE.PINE]: 0.25, [SPRITE.CACTUS]: 0.14, [SPRITE.LAMP]: 0.05, [SPRITE.GANTRY]: 0,
  [SPRITE.BOARD_ENTRY]: 0.5, [SPRITE.BOARD_205]: 0.5, [SPRITE.HOUSE]: 0.4, [SPRITE.BUSH]: 0,
};
const types = Object.keys(spriteSize).map(Number).sort((a, b) => a - b);
const listOf = (id, name, array) => ({ id, name, array, visible: false });
const RIVAL_COLORS = ['#2f6bff', '#ffd23a', '#f2f2f2', '#28c46a', '#a45cff', '#ff8a2a', '#30303a'];
const lists = [
  // hot lists first: Entry finds lists by a linear scan
  listOf('ty', '길 높이', ext((b) => r2(b.y * K))),
  listOf('tc', '길 굽기', ext((b) => r2(b.curve * K))),
  listOf('tpal', '길 색 번호', ext((b, i) => (i === 8 ? 7 : 1 + b.theme * 2) + (i % 2))),
  listOf('fog', '안개 단계', Array.from({ length: DRAW + 4 }, (_, n) => fogTier(n))),
  listOf('gcol', '땅 색', pal(base.g)),
  listOf('rcol', '연석 색', pal(base.r)),
  listOf('dcol', '도로 색', pal(base.d)),
  listOf('slot', '구간별 차', Array(DRAW + 4).fill(0)),
  listOf('sp1', '길가 물체1', ext((b) => b.sprites[0]?.[0] ?? 0)),
  listOf('sx1', '길가 위치1', ext((b) => r2(b.sprites[0]?.[1] ?? 0))),
  listOf('sp2', '길가 물체2', ext((b) => b.sprites[1]?.[0] ?? 0)),
  listOf('sx2', '길가 위치2', ext((b) => r2(b.sprites[1]?.[1] ?? 0))),
  listOf('ssz', '물체 크기', types.map((t) => spriteSize[t] * K)),
  listOf('shit', '물체 충돌폭', types.map((t) => spriteHit[t])),
  // rivals (index 1..7)
  listOf('rD', '라이벌 거리', Array(RIVALS).fill(0)),
  listOf('rX', '라이벌 가로', Array(RIVALS).fill(0)),
  listOf('rV', '라이벌 속도', Array(RIVALS).fill(0)),
  listOf('rTop', '라이벌 최고', [0.915, 0.9, 0.885, 0.87, 0.86, 0.85, 0.84]),
  listOf('rLane', '라이벌 차선', Array(RIVALS).fill(0)),
  listOf('rPic', '라이벌 모양', Array.from({ length: RIVALS }, (_, k) => FIRST_CAR_PIC + k * 3)),
  listOf('rZ', '라이벌 화면z', Array(RIVALS).fill(0)),
  listOf('rF', '라이벌 비율', Array(RIVALS).fill(0)),
  listOf('rN', '라이벌 구간', Array(RIVALS).fill(0)),
  listOf('cnext', '같은 구간 다음 차', Array(RIVALS).fill(0)),
  listOf('rCol', '라이벌 색', RIVAL_COLORS),
  listOf('laps', '랩 기록', [0, 0, 0]),
];

// ── Variables (hot ones first) ───────────────────────────────────────────
const init = { state: 0, lap: 1, place: 8, record: 0, bestEver: 0, muted: 0, dts: 1 / 60, aState: -1, seenLap: 1, drawN: DRAW, fogShift: 0 };
const variables = [
  'camX', 'camY', 'drawN', 'fogShift', 'sink', 'dt', 'speed', 'px', 'pD', 'camD', 'pos', 'frac', 'state', 'frames',
  'steer', 'brake', 'offroad', 'crash', 'curveP', 'place', 'lap', 'lapStart', 'raceT', 'bestLap',
  'cd', 'banner', 'bannerT', 'now', 'last', 'dts', 'farX', 'nearX', 'theme', 'autoLane', 'record',
  'bestEver', 'finishT', 'throttle', 'bump', 'resultT', 'muted', 'engine', 'engineT', 'lastCrash', 'titleT',
  'paused', 'shake', 'lapShowT', 'lastLapT', 'newRecord', 'aState', 'seenCrash', 'seenLap', 'musicT', 'crashFrame',
  'skid', 'skidT',
].map((id) => ({ id, name: id, value: String(init[id] ?? 0), visible: false }));

// ── Road renderer ────────────────────────────────────────────────────────
// band(n, i, z, X, dX, M, psx, psw, psy): project edge n (list index i, camera depth z,
// lateral offset X with slope dX, both ×K), draw the band between the previous edge and
// this one if it rises above the clip line M, recurse, then stamp cars and scenery.
const RUMBLE = 1.16;
// lane dashes are brush lines (round caps) — the world's brush layer is created after its fill layer,
// so lines sit on top of the asphalt; half the blocks of a filled quad
const lanes = (psx, psw, psy, sx, sw, sy) => [
  setThickness(mul(sw, 0.055)),
  ...[0.33, -0.33].flatMap((a) => [stopDraw(), locateXY(add(psx, mul(psw, a)), psy), startDraw(), locateXY(add(sx, mul(sw, a)), sy)]),
  stopDraw(),
];
const scenery = (slotT, slotX, g, i) => if_(gt(at(slotT, i), 0), [
  shape(add(at(slotT, i), 1)),
  setSize(mul(at('ssz', at(slotT, i)), g('iz'))),
  locateXY(add(g('sx'), mul(at(slotX, i), g('sw'))), add(g('sy'), mul(at('ssz', at(slotT, i)), mul(g('iz'), 0.5)))),
  stamp(),
]);
const functions = [];
functions.push(fn.normal('band', ['bn', 'bi', 'bz', 'bx', 'bd', 'bm', 'bpx', 'bpw', 'bpy'], (n, i, z, X, dX, M, psx, psw, psy, Lc) => {
  const g = Lc.get;
  const next = (clip, prevY) => call('band', add(n, 1), add(i, 1), add(z, SEG), add(X, dX), add(dX, at('tc', i)), clip, g('sx'), g('sw'), prevY);
  return [
    if_(le(n, v('drawN')), [
      Lc.set('iz', div(1, z)),
      Lc.set('sw', mul(KRW, g('iz'))),
      Lc.set('sx', mul(sub(X, v('camX')), g('iz'))),
      Lc.set('sy', add(HOR, mul(sub(at('ty', i), v('camY')), g('iz')))),
      if_(gt(g('sy'), M), [
        Lc.set('p', add(at('tpal', i), at('fog', add(n, v('fogShift'))))),
        Lc.set('top', add(g('sy'), 0.8)), // overlap one pixel so no seams show between bands
        setFill(at('gcol', g('p'))),
        ...quad(-240, psy, 240, psy, 240, g('top'), -240, g('top')),
        setFill(at('rcol', g('p'))),
        ...quad(sub(psx, mul(psw, RUMBLE)), psy, add(psx, mul(psw, RUMBLE)), psy,
          add(g('sx'), mul(g('sw'), RUMBLE)), g('top'), sub(g('sx'), mul(g('sw'), RUMBLE)), g('top')),
        setFill(at('dcol', g('p'))),
        ...quad(sub(psx, psw), psy, add(psx, psw), psy, add(g('sx'), g('sw')), g('top'), sub(g('sx'), g('sw')), g('top')),
        if_(eq(mod(g('p'), 2), 1), [if_(lt(n, 29), lanes(psx, psw, psy, g('sx'), g('sw'), g('sy')))]),
        next(g('sy'), g('sy')),
        if_(gt(at('slot', n), 0), [call('car', at('slot', n), X, dX, i, g('sy'))]),
        scenery('sp1', 'sx1', g, i),
        scenery('sp2', 'sx2', g, i),
      ], [
        next(M, M),
        if_(gt(at('slot', n), 0), [call('car', at('slot', n), X, dX, i, M)]),
      ]),
    ]),
  ];
}, ['iz', 'sw', 'sx', 'sy', 'p', 'top'], { label: '도로 구간 그리기' }));

// car(k, X, dX, i, clip): stamp rival k (inside the band starting at list index i), then the
// next car sharing the band.
functions.push(fn.normal('car', ['ck', 'cx', 'cdx', 'ci', 'cm'], (k, X, dX, i, clip, Lc) => {
  const g = Lc.get;
  return [
    Lc.set('iz', div(1, at('rZ', k))),
    Lc.set('f', at('rF', k)),
    Lc.set('sx', mul(add(sub(add(X, mul(dX, g('f'))), v('camX')), mul(at('rX', k), KRW)), g('iz'))),
    Lc.set('sy', add(HOR, mul(sub(add(at('ty', i), mul(sub(at('ty', add(i, 1)), at('ty', i)), g('f'))), v('camY')), g('iz')))),
    if_(gt(g('sy'), clip), [
      Lc.set('s', mul(CARSZ, g('iz'))),
      Lc.set('view', 1),
      if_(gt(g('sx'), 30), [Lc.set('view', 0)]),
      if_(lt(g('sx'), -30), [Lc.set('view', 2)]),
      shape(add(at('rPic', k), g('view'))),
      setSize(g('s')),
      locateXY(g('sx'), add(g('sy'), mul(g('s'), 0.5))),
      stamp(),
    ]),
    if_(gt(at('cnext', k), 0), [call('car', at('cnext', k), X, dX, i, clip)]),
  ];
}, ['iz', 'f', 'sx', 'sy', 's', 'view'], { label: '라이벌 차 찍기' }));

// render(): per-frame prologue — camera band, first edge, then the band recursion.
functions.push(fn.normal('render', [], (Lc) => {
  const g = Lc.get;
  return [
    Lc.set('base', quotient(v('pos'), SEG)),
    s('frac', mod(v('pos'), SEG)),
    Lc.set('i0', add(g('base'), 1)),
    Lc.set('d0', div(mul(at('tc', g('i0')), v('frac')), -SEG)),
    Lc.set('d1', add(g('d0'), at('tc', g('i0')))),
    Lc.set('z1', sub(SEG, v('frac'))),
    if_(lt(g('z1'), 300), [Lc.set('z1', 300)]),
    Lc.set('iz', div(1, g('z1'))),
    Lc.set('sx', mul(sub(g('d0'), v('camX')), g('iz'))),
    Lc.set('sw', mul(KRW, g('iz'))),
    Lc.set('sy', add(HOR, mul(sub(at('ty', add(g('i0'), 1)), v('camY')), g('iz')))),
    call('band', 2, add(g('i0'), 2), sub(2 * SEG, v('frac')), add(g('d0'), g('d1')), add(g('d1'), at('tc', add(g('i0'), 1))),
      g('sy'), g('sx'), g('sw'), g('sy')),
    if_(gt(at('slot', 1), 0), [call('car', at('slot', 1), g('d0'), g('d1'), add(g('i0'), 1), -9999)]),
    shape(1),
  ];
}, ['base', 'i0', 'd0', 'd1', 'z1', 'iz', 'sx', 'sw', 'sy'], { label: '화면 그리기' }));

// slots(k): place each visible rival into the band list used by the renderer.
functions.push(fn.normal('slots', ['sk'], (k, Lc) => {
  const g = Lc.get;
  return [
    if_(le(k, RIVALS), [
      if_(gt(at('rN', k), 0), [put('slot', at('rN', k), 0)]),
      put('rN', k, 0),
      Lc.set('z', sub(at('rD', k), v('camD'))),
      if_(gt(g('z'), 300), [if_(lt(g('z'), (DRAW - 2) * SEG), [
        Lc.set('u', div(add(g('z'), v('frac')), SEG)),
        Lc.set('n', floor(g('u'))),
        put('rZ', k, g('z')), put('rF', k, sub(g('u'), g('n'))), put('rN', k, g('n')),
      ])]),
      call('slots', add(k, 1)),
      // link after the recursion so every slot was cleared first
      if_(gt(at('rN', k), 0), [put('cnext', k, at('slot', at('rN', k))), put('slot', at('rN', k), k)]),
    ]),
  ];
}, ['z', 'u', 'n'], { label: '라이벌을 구간에 배치' }));

// ── Player physics ───────────────────────────────────────────────────────
const ACC = MAXV * 0.3, BRAKE = MAXV * 0.95, DECEL = MAXV * 0.2, OFFDEC = MAXV * 0.85, CF = 0.185;
functions.push(fn.normal('physics', [], (Lc) => {
  const g = Lc.get;
  const hitCheck = (slotT, slotX) => if_(gt(at(slotT, g('j')), 0), [
    Lc.set('w', at('shit', at(slotT, g('j')))),
    if_(gt(g('w'), 0), [
      Lc.set('lx', at(slotX, g('j'))),
      if_(lt(abs(sub(v('px'), g('lx'))), add(g('w'), 0.26)), [
        if_(gt(v('speed'), MAXV * 0.12), [s('speed', MAXV * 0.12), s('crash', 0.7), s('lastCrash', v('frames'))]),
        if_(gt(g('lx'), 0), [s('px', sub(g('lx'), add(g('w'), 0.3)))], [s('px', add(g('lx'), add(g('w'), 0.3)))]),
      ]),
    ]),
  ]);
  return [
    Lc.set('spd', div(v('speed'), MAXV)),
    Lc.set('zp', mod(v('pD'), TRACK)),
    Lc.set('pi', add(quotient(g('zp'), SEG), 1)),
    s('curveP', div(at('tc', g('pi')), K)),
    s('brake', 0), s('throttle', 0),
    if_(eq(v('state'), 2), [
      if_(anyKey(key.up, key.z), [
        inc('speed', mul(v('dt'), mul(ACC, sub(1.1, mul(g('spd'), 0.7))))), s('throttle', 1),
      ], [
        if_(anyKey(key.down, key.x), [], [inc('speed', mul(v('dt'), -DECEL))]),
      ]),
      if_(anyKey(key.down, key.x), [inc('speed', mul(v('dt'), -BRAKE)), s('brake', 1)]),
      s('steer', 0),
      if_(isPressed(key.left), [inc('px', mul(v('dt'), mul(-2.3, g('spd')))), s('steer', -1)]),
      if_(isPressed(key.right), [inc('px', mul(v('dt'), mul(2.3, g('spd')))), s('steer', 1)]),
      inc('px', mul(mul(v('dt'), -CF), mul(mul(g('spd'), g('spd')), v('curveP')))),
    ], [
      // autopilot for the title demo and the victory lap
      Lc.set('tv', MAXV * 0.86),
      if_(eq(v('state'), 3), [Lc.set('tv', MAXV * 0.5)]),
      if_(eq(v('state'), 1), [Lc.set('tv', 0), s('speed', 0), if_(anyKey(key.up, key.z), [s('throttle', 1)])]),
      if_(lt(v('speed'), g('tv')), [inc('speed', mul(v('dt'), ACC * 0.7))], [inc('speed', mul(v('dt'), -DECEL))]),
      Lc.set('d', sub(v('autoLane'), v('px'))),
      if_(ne(v('state'), 1), [inc('px', mul(g('d'), mul(v('dt'), 2.2)))]),
      s('steer', 0),
      if_(gt(v('curveP'), 4), [s('steer', 1)]),
      if_(lt(v('curveP'), -4), [s('steer', -1)]),
    ]),
    // cornering hard at speed (steering into a sharp curve) → tyre smoke and screech
    s('skid', 0),
    if_(eq(v('state'), 2), [if_(gt(g('spd'), 0.72), [if_(gt(abs(v('curveP')), 7.5), [
      if_(gt(mul(v('steer'), v('curveP')), 0), [s('skid', 1)]),
    ])])]),
    // off-road: slow down and shake
    s('offroad', 0),
    if_(gt(abs(v('px')), 1.1), [
      s('offroad', 1),
      if_(gt(v('speed'), MAXV * 0.36), [inc('speed', mul(v('dt'), -OFFDEC))]),
    ]),
    ...clampSet('speed', 0, MAXV),
    ...clampSet('px', -2.4, 2.4),
    // roadside collisions (only when off the asphalt)
    if_(gt(abs(v('px')), 1.02), [
      Lc.set('j', add(g('pi'), 1)),
      hitCheck('sp1', 'sx1'),
      hitCheck('sp2', 'sx2'),
    ]),
    inc('pD', mul(v('speed'), v('dt'))),
  ];
}, ['spd', 'zp', 'pi', 'tv', 'd', 'j', 'w', 'lx'], { label: '내 차 움직이기' }));

// ── Rivals ───────────────────────────────────────────────────────────────
// ai(k): speed toward a curve-aware target, lane changes around the player, bumping,
// rubber band, and counting cars ahead for the position.
functions.push(fn.normal('ai', ['ak'], (k, Lc) => {
  const g = Lc.get;
  return [
    if_(le(k, RIVALS), [
      Lc.set('zc', mod(at('rD', k), TRACK)),
      Lc.set('ci', add(quotient(g('zc'), SEG), 1)),
      Lc.set('tv', mul(MAXV, mul(at('rTop', k), sub(1, mul(abs(at('tc', g('ci'))), 0.009 / K))))),
      Lc.set('gap', sub(at('rD', k), v('pD'))),
      if_(gt(g('gap'), 3000), [Lc.set('tv', mul(g('tv'), 0.88))]),
      if_(lt(g('gap'), -5000), [Lc.set('tv', mul(g('tv'), 1.07))]),
      if_(eq(v('state'), 1), [Lc.set('tv', 0)]),
      Lc.set('dv', sub(g('tv'), at('rV', k))),
      if_(gt(g('dv'), mul(v('dt'), MAXV * 0.28)), [Lc.set('dv', mul(v('dt'), MAXV * 0.28))]),
      if_(lt(g('dv'), mul(v('dt'), -MAXV * 0.7)), [Lc.set('dv', mul(v('dt'), -MAXV * 0.7))]),
      put('rV', k, add(at('rV', k), g('dv'))),
      Lc.set('dx', sub(v('px'), at('rX', k))),
      // the player just ahead in our lane and slower → change lanes away from the player
      if_(lt(g('gap'), 0), [if_(gt(g('gap'), -1600), [
        if_(lt(abs(g('dx')), 0.55), [if_(lt(v('speed'), at('rV', k)), [
          if_(gt(g('dx'), 0), [put('rLane', k, snapLane(sub(v('px'), 0.8)))], [put('rLane', k, snapLane(add(v('px'), 0.8)))]),
          if_(gt(at('rLane', k), 0.7), [put('rLane', k, -0.62)]),
          if_(lt(at('rLane', k), -0.7), [put('rLane', k, 0.62)]),
        ])]),
      ])]),
      // autopilot (title / victory lap) swerves around a rival ahead in its lane
      if_(or_(eq(v('state'), 0), eq(v('state'), 3)), [if_(gt(g('gap'), 0), [if_(lt(g('gap'), 2200), [if_(lt(abs(g('dx')), 0.5), [
        if_(gt(at('rX', k), 0), [s('autoLane', -0.5)], [s('autoLane', 0.5)]),
      ])])])]),
      Lc.set('dx', sub(at('rLane', k), at('rX', k))),
      if_(gt(g('dx'), mul(v('dt'), 0.9)), [Lc.set('dx', mul(v('dt'), 0.9))]),
      if_(lt(g('dx'), mul(v('dt'), -0.9)), [Lc.set('dx', mul(v('dt'), -0.9))]),
      put('rX', k, add(at('rX', k), g('dx'))),
      // contact with the player
      if_(lt(abs(sub(v('px'), at('rX', k))), 0.52), [
        if_(gt(g('gap'), 0), [if_(lt(g('gap'), 430), [
          if_(gt(v('speed'), at('rV', k)), [
            s('speed', mul(at('rV', k), 0.8)), s('pD', sub(at('rD', k), 440)),
            s('crash', 0.45), s('lastCrash', v('frames')),
          ]),
        ])]),
        if_(lt(g('gap'), 0), [if_(gt(g('gap'), -440), [
          if_(gt(at('rV', k), v('speed')), [put('rV', k, mul(v('speed'), 0.92)), put('rD', k, sub(v('pD'), 450))]),
        ])]),
      ]),
      put('rD', k, add(at('rD', k), mul(at('rV', k), v('dt')))),
      if_(gt(at('rD', k), v('pD')), [inc('sink', 1)]),
      call('ai', add(k, 1)),
    ]),
  ];
}, ['zc', 'ci', 'tv', 'gap', 'dv', 'dx'], { label: '라이벌 운전' }));

// avoid(j, m): rival j looks for a slower rival m ahead in its lane and swerves.
functions.push(fn.normal('avoid', ['vj', 'vm'], (j, m, Lc) => {
  const g = Lc.get;
  return [
    if_(le(m, RIVALS), [
      if_(ne(m, j), [
        Lc.set('dz', sub(at('rD', m), at('rD', j))),
        if_(gt(g('dz'), 0), [if_(lt(g('dz'), 1500), [
          if_(lt(abs(sub(at('rX', m), at('rX', j))), 0.5), [
            if_(lt(at('rV', m), at('rV', j)), [
              if_(lt(g('dz'), 600), [put('rV', j, at('rV', m))]),
              if_(ge(at('rX', m), 0), [put('rLane', j, snapLane(sub(at('rX', m), 0.62)))], [put('rLane', j, snapLane(add(at('rX', m), 0.62)))]),
              if_(lt(at('rLane', j), -0.7), [put('rLane', j, 0.62)]),
              if_(gt(at('rLane', j), 0.7), [put('rLane', j, -0.62)]),
            ]),
          ]),
        ])]),
      ]),
      call('avoid', j, add(m, 1)),
    ]),
  ];
}, ['dz'], { label: '라이벌 추월 차선' }));

// resetRace(): grid positions, timers, state → countdown.
const GRID_LANES = [-0.62, 0.62, 0, 0.62, -0.62, 0, -0.62]; // lane each grid car settles into after GO
const GRID = [[3700, -0.45], [3700, 0.45], [2900, -0.45], [2900, 0.45], [2100, -0.45], [2100, 0.45], [1400, -0.45]];
functions.push(fn.normal('resetRace', [], () => [
  ...GRID.flatMap(([d, x], k) => [put('rD', k + 1, d), put('rX', k + 1, x), put('rLane', k + 1, GRID_LANES[k]), put('rV', k + 1, 0), put('rN', k + 1, 0)]),
  ...Array.from({ length: DRAW + 4 }, (_, n) => put('slot', n + 1, 0)),
  put('laps', 1, 0), put('laps', 2, 0), put('laps', 3, 0),
  s('pD', 1400), s('px', 0.45), s('speed', 0), s('autoLane', 0.45),
  s('lap', 1), s('lapStart', 0), s('raceT', 0), s('bestLap', 0), s('place', 8), s('crash', 0),
  s('cd', 3.6), s('banner', 0), s('bannerT', 0), s('resultT', 0), s('finishT', 0),
  s('paused', 0), s('lapShowT', 0), s('newRecord', 0), s('shake', 0),
], [], { label: '레이스 준비' }));

// ── Main loop (runs on the road painter) ─────────────────────────────────
const camera = [
  s('camD', sub(v('pD'), PZ)),
  s('pos', mod(v('camD'), TRACK)),
  s('camX', mul(add(v('px'), v('shake')), KRW)),
  // camera height follows the road under the player car (interpolated)
  s('sink', mod(v('pD'), TRACK)),
  s('theme', add(quotient(v('sink'), SEG), 1)),
  s('camY', add(K * CH, add(at('ty', v('theme')), mul(sub(at('ty', add(v('theme'), 1)), at('ty', v('theme'))), div(mod(v('sink'), SEG), SEG))))),
  s('theme', quotient(sub(at('tpal', v('theme')), 1), 2)),
  if_(gt(v('theme'), 2), [s('theme', 0)]),
  // parallax: the background slides against the curve
  inc('farX', mul(mul(v('curveP'), v('speed')), mul(v('dt'), -0.0006))),
  inc('nearX', mul(mul(v('curveP'), v('speed')), mul(v('dt'), -0.0008))),
];
const finishRace = [
  s('lap', LAPS), s('state', 3), s('finishT', v('raceT')), s('banner', 7), s('bannerT', 3), s('resultT', 0),
  s('autoLane', v('px')), s('lapShowT', 0),
  if_(or_(eq(v('record'), 0), lt(v('raceT'), v('record'))), [s('record', v('raceT')), s('newRecord', 1)]),
  if_(or_(eq(v('bestEver'), 0), lt(v('bestLap'), v('bestEver'))), [s('bestEver', v('bestLap'))]),
];
const raceLogic = [
  if_(eq(v('state'), 1), [
    inc('cd', mul(v('dt'), -1)),
    if_(le(v('cd'), 0), [s('state', 2), s('banner', 4), s('bannerT', 1.2), s('lapStart', 0), s('raceT', 0)]),
  ]),
  if_(eq(v('state'), 2), [
    inc('raceT', v('dt')),
    s('sink', add(quotient(sub(v('pD'), LINE), TRACK), 1)),
    if_(gt(v('sink'), v('lap')), [
      s('lastLapT', sub(v('raceT'), v('lapStart'))),
      put('laps', v('lap'), v('lastLapT')),
      if_(or_(eq(v('bestLap'), 0), lt(v('lastLapT'), v('bestLap'))), [s('bestLap', v('lastLapT'))]),
      s('lapStart', v('raceT')),
      s('lap', v('sink')),
      s('lapShowT', 2.6),
      if_(eq(v('lap'), 2), [s('banner', 5), s('bannerT', 2.6)]),
      if_(eq(v('lap'), 3), [s('banner', 6), s('bannerT', 2.6)]),
      if_(gt(v('lap'), LAPS), finishRace),
    ]),
  ]),
  if_(eq(v('state'), 3), [inc('resultT', v('dt'))]),
  if_(gt(v('bannerT'), 0), [inc('bannerT', mul(v('dt'), -1))]),
  if_(gt(v('lapShowT'), 0), [inc('lapShowT', mul(v('dt'), -1))]),
  s('shake', 0),
  if_(gt(v('crash'), 0), [inc('crash', mul(v('dt'), -1)), s('shake', mul(sub(mul(mod(v('frames'), 2), 2), 1), mul(v('crash'), 0.09)))]),
];
const timeStep = [
  s('now', timer.value()),
  s('sink', sub(v('now'), v('last'))),
  s('last', v('now')),
  ...clampSet('sink', 0, 0.066),
  // the project timer ticks on its own interval, so smooth the raw delta
  s('dts', add(mul(v('dts'), 0.85), mul(v('sink'), 0.15))),
  s('dt', v('dts')),
  if_(eq(v('paused'), 1), [s('dt', 0)]),
];
// adaptive detail: shorten the draw distance on slow machines, restore it when there is headroom
const adapt = [
  if_(eq(mod(v('frames'), 60), 30), [
    if_(gt(v('dts'), 0.0205), [if_(gt(v('drawN'), 26), [inc('drawN', -4)])]),
    if_(lt(v('dts'), 0.0175), [if_(lt(v('drawN'), DRAW), [inc('drawN', 2)])]),
    s('fogShift', sub(DRAW, v('drawN'))),
  ]),
];
const mainLoop = [
  ...timeStep,
  ...adapt,
  call('physics'),
  s('sink', 0),
  call('ai', 1),
  if_(eq(v('state'), 2), [s('place', add(v('sink'), 1))]),
  call('avoid', add(mod(v('frames'), RIVALS), 1), 1),
  ...raceLogic,
  ...camera,
  call('slots', 1),
  eraseAll(),
  call('render'),
  inc('frames', 1),
];
const world = obj('world', '월드 · 도로와 차 그리기', {
  scene: 'race',
  pictures: [
    { ...art.blank(), name: '빈 모양' },
    { ...art.palm(0), name: '야자수1' }, { ...art.palm(1), name: '야자수2' }, { ...art.billboard('sunset'), name: '광고판 선셋' },
    { ...art.curveSign(-1), name: '왼쪽 커브' }, { ...art.curveSign(1), name: '오른쪽 커브' }, { ...art.rock(), name: '바위' },
    { ...art.pine(), name: '소나무' }, { ...art.cactus(), name: '선인장' }, { ...art.lamp(), name: '가로등' },
    { ...art.gantry(), name: '출발선' }, { ...art.billboard('entry'), name: '광고판 엔트리' }, { ...art.billboard('205'), name: '광고판 205' },
    { ...art.tower(), name: '구조대 망루' }, { ...art.bush(), name: '덤불' },
    ...RIVAL_COLORS.flatMap((c, k) => [-1, 0, 1].map((view) => ({ ...art.rivalCar(c, view, k % 2), name: `라이벌${k + 1}-${view + 1}` }))),
  ],
  entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true },
  threads: [[
    when.run(),
    timer.reset(), timer.start(), s('last', timer.value()), s('frames', 0), s('dts', 1 / 60),
    // create the fill layer first and the brush (lane lines) second so lines sit above the asphalt
    setFill(txt('#000000')), setColor('#f7f2e2'),
    call('resetRace'), s('state', 0), s('titleT', 0),
    repeat.inf(mainLoop),
  ], [
    when.keyPressed(key.space),
    if_(eq(v('state'), 0), [call('resetRace'), s('state', 1)], [
      if_(eq(v('state'), 3), [if_(gt(v('resultT'), 2.5), [call('resetRace'), s('state', 1)])]),
    ]),
  ], [
    when.keyPressed(key.r),
    if_(ne(v('state'), 0), [call('resetRace'), s('state', 0), s('titleT', 0)]),
  ], [
    when.keyPressed(key.p),
    if_(eq(v('state'), 2), [s('paused', sub(1, v('paused')))]),
  ]],
});

// ── Sound ────────────────────────────────────────────────────────────────
// Music uses the BGM channel (play_bgm), which `sound_speed_set` never touches, so the engine
// can follow the speed with the playback rate while the music stays in tune.
const durFile = path.join(dir, 'audio', 'durations.json');
const DUR = fs.existsSync(durFile) ? JSON.parse(fs.readFileSync(durFile, 'utf8')) : null;
const SOUND_NAMES = ['race', 'title', 'countdown', 'finish', 'engine', 'crash', 'lap', 'skid'];
const audioLoop = [
  // state changes pick the music
  if_(ne(v('state'), v('aState')), [
    s('aState', v('state')), soundRate(1), s('musicT', add(v('now'), 9999)),
    if_(eq(v('muted'), 0), [
      if_(eq(v('state'), 0), [bgm('title'), s('musicT', add(v('now'), (DUR?.title ?? 20) - 0.05))]),
      if_(eq(v('state'), 1), [bgm('countdown'), s('engineT', 0)]),
      if_(eq(v('state'), 2), [s('musicT', add(v('now'), 0.7))]),
      if_(eq(v('state'), 3), [bgm('finish'), s('musicT', add(v('now'), (DUR?.finish ?? 4) - 0.1))]),
    ], [stopBgm()]),
  ]),
  if_(eq(v('muted'), 0), [
    // loop the current music
    if_(gt(v('now'), v('musicT')), [
      if_(eq(v('state'), 2), [bgm('race'), s('musicT', add(v('now'), (DUR?.race ?? 30) - 0.05))],
        [bgm('title'), s('musicT', add(v('now'), (DUR?.title ?? 20) - 0.05))]),
    ]),
    // engine: two gears, pitch follows speed; overlapping 1 s samples cross-fade
    if_(ge(v('state'), 1), [
      s('sink', div(v('speed'), MAXV)),
      if_(lt(v('sink'), 0.5), [s('engine', add(0.55, mul(v('sink'), 1.5)))], [s('engine', add(0.85, mul(sub(v('sink'), 0.5), 2.1)))]),
      if_(and_(eq(v('throttle'), 1), eq(v('state'), 1)), [s('engine', 0.95)]),
      if_(and_(eq(v('throttle'), 0), eq(v('state'), 2)), [inc('engine', -0.06)]),
      if_(eq(v('paused'), 1), [s('engine', 0.5)]),
      soundRate(v('engine')),
      if_(gt(sub(v('now'), v('engineT')), div(0.9, v('engine'))), [play('engine'), s('engineT', v('now'))]),
    ]),
    if_(ne(v('lastCrash'), v('seenCrash')), [
      s('seenCrash', v('lastCrash')),
      if_(gt(sub(v('frames'), v('crashFrame')), 25), [play('crash'), s('crashFrame', v('frames'))]),
    ]),
    if_(ne(v('lap'), v('seenLap')), [s('seenLap', v('lap')), if_(eq(v('state'), 2), [play('lap')])]),
    if_(eq(v('skid'), 1), [if_(gt(sub(v('now'), v('skidT')), 0.55), [play('skid'), s('skidT', v('now'))])]),
  ]),
];
const audio = obj('audio', '소리 · 음악과 엔진', {
  scene: 'race',
  picture: art.blank(),
  entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: false },
  threads: [[
    when.run(), hide(), soundVolume(85), s('aState', -1), s('seenLap', 1), s('engineT', 0), s('crashFrame', -99),
    repeat.inf(audioLoop),
  ], [
    when.keyPressed(key.m),
    s('muted', sub(1, v('muted'))),
    if_(eq(v('muted'), 1), [silence(), stopBgm()], [s('aState', -1)]),
  ]],
});
audio.sounds = DUR ? SOUND_NAMES.map((name) => ({ id: name, name, path: path.join(dir, 'audio', name + '.mp3'), duration: DUR[name] })) : [];
if (!DUR) console.warn('[sunset-drive] audio/durations.json missing — run build.mjs to synthesize the sounds');

// ── Other objects ───────────────────────────────────────────────────────
const LS = art.LAYER.LS;
const layerY = HOR + (art.LAYER.HY - art.LAYER.LH / 2); // put the layer's horizon row on HOR
const player = obj('player', '내 차', {
  scene: 'race',
  pictures: [-1, 0, 1].flatMap((st) => [false, true].map((b) => ({ ...art.playerCar(st, b), name: `내차${st + 1}${b ? '브레이크' : ''}` }))),
  entity: { x: 0, y: -84, scaleX: 0.32, scaleY: 0.32, visible: true },
  threads: [[
    when.run(),
    repeat.inf([
      // picture = steer frame × brake light
      shape(add(add(mul(add(v('steer'), 1), 2), v('brake')), 1)),
      s('bump', 0),
      if_(eq(v('offroad'), 1), [if_(gt(v('speed'), 800), [s('bump', mul(mod(v('frames'), 3), 1.3))])]),
      if_(gt(v('crash'), 0), [s('bump', mul(mod(v('frames'), 4), 1.5))]),
      // rumble strips buzz under the tyres
      if_(gt(abs(v('px')), 0.97), [if_(lt(abs(v('px')), 1.12), [if_(gt(v('speed'), 1500), [s('bump', mul(mod(v('frames'), 2), 0.8))])])]),
      locateXY(mul(v('bump'), 0.6), add(-86, v('bump'))),
    ]),
  ]],
});
const dust = obj('dust', '흙먼지', {
  scene: 'race',
  pictures: [...[0, 1, 2].map((f) => ({ ...art.dust(f), name: `먼지${f + 1}` })), ...[0, 1, 2].map((f) => ({ ...art.smoke(f), name: `타이어연기${f + 1}` }))],
  entity: { x: 0, y: -84, scaleX: 0.32, scaleY: 0.32, visible: false },
  threads: [[
    when.run(), hide(),
    repeat.inf([
      if_(or_(and_(eq(v('offroad'), 1), gt(v('speed'), 1500)), gt(v('crash'), 0.2)), [
        show(), shape(add(mod(quotient(v('frames'), 3), 3), 1)),
      ], [
        if_(eq(v('skid'), 1), [show(), shape(add(mod(quotient(v('frames'), 3), 3), 4))], [hide()]),
      ]),
    ]),
  ]],
});
const sky = obj('sky', '하늘과 해', { scene: 'race', picture: art.sky(), entity: { x: 0, y: 0, scaleX: 0.5, scaleY: 0.5, visible: true }, threads: [[]] });
const far = obj('far', '먼 산', {
  scene: 'race', picture: art.farLayer(),
  entity: { x: 0, y: layerY, scaleX: 1 / LS, scaleY: 1 / LS, visible: true },
  threads: [[when.run(), repeat.inf([locateXY(sub(mod(v('farX'), 960), 480), layerY)])]],
});
const near = obj('near', '가까운 풍경', {
  scene: 'race',
  pictures: [0, 1, 2].map((t) => ({ ...art.nearLayer(t), name: ['바다', '숲', '협곡'][t] })),
  entity: { x: 0, y: layerY, scaleX: 1 / LS, scaleY: 1 / LS, visible: true },
  threads: [[when.run(), repeat.inf([
    shape(add(v('theme'), 1)),
    locateXY(sub(mod(v('nearX'), 960), 480), layerY),
  ])]],
});

// HUD: stamped arcade digits. Pictures 1 blank, 2..11 warm digits, 12 ', 13 ", 14..23 cool digits, 24.. places.
const HUD_WARM = 2, HUD_COOL = 14, HUD_PLACE = 24;
functions.push(fn.normal('num', ['nv', 'nd', 'nx', 'ny', 'ns', 'nb'], (val, d, x, y, sz, b) => [
  if_(gt(d, 0), [
    shape(add(b, mod(val, 10))), setSize(sz),
    locateXY(x, y), stamp(),
    call('num', quotient(val, 10), sub(d, 1), sub(x, mul(sz, 0.5)), y, sz, b),
  ]),
], [], { label: '숫자 찍기' }));
// clock(t, x, y, s, b): m'ss"cc right-aligned at x
functions.push(fn.normal('clock', ['tt', 'tx', 'ty2', 'ts', 'tb'], (t, x, y, sz, b, Lc) => [
  Lc.set('c', floor(mul(t, 100))),
  call('num', mod(Lc.get('c'), 100), 2, x, y, sz, b),
  shape(13), locateXY(sub(x, mul(sz, 0.82)), y), stamp(),
  call('num', mod(quotient(Lc.get('c'), 100), 60), 2, sub(x, mul(sz, 1.2)), y, sz, b),
  shape(12), locateXY(sub(x, mul(sz, 2.02)), y), stamp(),
  call('num', quotient(Lc.get('c'), 6000), 1, sub(x, mul(sz, 2.4)), y, sz, b),
], ['c'], { label: '시간 찍기' }));
const MAPX = -224, MAPW = 150, MAPY = -125;
const mapX = (d) => add(MAPX, mul(div(mod(sub(d, LINE), TRACK), TRACK), MAPW));
functions.push(fn.normal('dots', ['dk'], (k) => [
  if_(le(k, RIVALS), [penColor(at('rCol', k)), ...dot(mapX(at('rD', k)), MAPY), call('dots', add(k, 1))]),
], [], { label: '코스 지도 점' }));
const racing = and_(ge(v('state'), 1), or_(lt(v('state'), 3), lt(v('resultT'), 2.2)));
const hudDraw = [if_(eq(mod(v('frames'), 2), 0), [
  eraseAll(),
  if_(racing, [
    call('clock', sub(v('raceT'), v('lapStart')), -118, 121, 24, HUD_WARM),
    if_(gt(v('bestLap'), 0), [call('clock', v('bestLap'), -142, 95, 16, HUD_COOL)]),
    call('num', v('lap'), 1, 191, 123, 24, HUD_WARM),
    call('num', v('place'), 1, 191, 104, 24, HUD_WARM),
    // speed
    s('sink', round(div(mul(v('speed'), 290), MAXV))),
    call('num', v('sink'), 3, 190, -109, 34, HUD_COOL),
    // rev bar: ten segments
    setThickness(5),
    ...Array.from({ length: 10 }, (_, k) => if_(gt(v('sink'), k * 29), [
      setColor(k < 5 ? '#5dff9a' : k < 8 ? '#ffe45a' : '#ff4a5a'),
      stopDraw(), locateXY(84 + k * 13, -126 + k * 1.2), startDraw(), locateXY(93 + k * 13, -126 + k * 1.2), stopDraw(),
    ])),
    // course map strip with every car
    setThickness(9), setColor('#1a0c2e'), penAlpha(40),
    stopDraw(), locateXY(MAPX - 4, MAPY), startDraw(), locateXY(MAPX + MAPW + 4, MAPY), stopDraw(),
    penAlpha(0), setThickness(3), setColor('#fdf6e3'),
    stopDraw(), locateXY(MAPX, MAPY), startDraw(), locateXY(MAPX + MAPW, MAPY), stopDraw(),
    setThickness(4), setColor('#ff5fa2'), ...dot(MAPX, MAPY),
    setThickness(8),
    call('dots', 1),
    setThickness(12), setColor('#ff2a3a'), ...dot(mapX(v('pD')), MAPY),
    setThickness(6), setColor('#ffffff'), ...dot(mapX(v('pD')), MAPY),
    // last lap time under the LAP banner
    if_(gt(v('lapShowT'), 0), [call('clock', v('lastLapT'), 42, -8, 30, HUD_COOL)]),
  ]),
  // best time on the title screen once a race has been finished
  if_(eq(v('state'), 0), [if_(gt(v('record'), 0), [call('clock', v('record'), 48, -126, 18, HUD_WARM)])]),
  // results
  if_(eq(v('state'), 3), [if_(gt(v('resultT'), 2.2), [
    shape(add(HUD_PLACE - 1, v('place'))), setSize(46), locateXY(118, 35), stamp(),
    call('clock', v('finishT'), 138, -4, 24, HUD_WARM),
    call('clock', v('bestLap'), 138, -34, 24, HUD_COOL),
    call('clock', v('record'), 138, -64, 24, HUD_WARM),
  ])]),
  shape(1),
])];
const hud = obj('hud', '계기판 숫자', {
  scene: 'race',
  pictures: [
    { ...art.blank(), name: '빈 모양' },
    ...Array.from({ length: 10 }, (_, d) => ({ ...art.digit(d), name: `숫자${d}` })),
    { ...art.digitMark("'"), name: '분' }, { ...art.digitMark('"'), name: '초' },
    ...Array.from({ length: 10 }, (_, d) => ({ ...art.digitCool(d), name: `파랑${d}` })),
    ...art.places().map((p, k) => ({ ...p, name: `${k + 1}등` })),
  ],
  entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true },
  threads: [[when.run(), setColor('#ffffff'), setFill(txt('#000000')), repeat.inf(hudDraw)]],
});
const visibleWhen = (cond) => [if_(cond, [show()], [hide()])];
const hudFrame = obj('hudframe', '계기판 글자', {
  scene: 'race', picture: art.hudFrame(), entity: { x: 0, y: 0, scaleX: 0.5, scaleY: 0.5, visible: false },
  threads: [[when.run(), repeat.inf(visibleWhen(racing))]],
});
const bannerObj = obj('banner', '큰 글자', {
  scene: 'race',
  pictures: art.banners().map(([n, p]) => ({ ...p, name: n })),
  entity: { x: 0, y: 40, scaleX: 0.5, scaleY: 0.5, visible: false },
  threads: [[when.run(), hide(), repeat.inf([
    if_(eq(v('state'), 1), [
      if_(lt(v('cd'), 3), [show(), shape(sub(3, floor(v('cd')))), setSize(add(170, mul(mod(v('cd'), 1), 120)))], [hide()]),
    ], [
      if_(eq(v('paused'), 1), [show(), shape(8), setSize(220)], [
        if_(gt(v('bannerT'), 0), [show(), shape(v('banner')), setSize(add(240, mul(v('bannerT'), 12)))], [hide()]),
      ]),
    ]),
  ])]],
});
const title = obj('title', '타이틀', {
  scene: 'race', picture: art.logo(), entity: { x: 0, y: 80, scaleX: 0.36, scaleY: 0.36, visible: true },
  threads: [[when.run(), repeat.inf([
    ...visibleWhen(eq(v('state'), 0)),
    inc('titleT', v('dt')),
    locateXY(0, add(80, mul(op(mul(v('titleT'), 120), 'sin'), 3))),
  ])]],
});
const press = obj('press', '시작 안내', {
  scene: 'race', picture: art.pressStart(), entity: { x: 0, y: -16, scaleX: 0.5, scaleY: 0.5, visible: true },
  threads: [[when.run(), repeat.inf([
    if_(eq(v('state'), 0), [if_(lt(mod(v('titleT'), 1.2), 0.85), [show()], [hide()])], [hide()]),
  ])]],
});
const results = obj('results', '결과판', {
  scene: 'race', pictures: [{ ...art.resultsPanel(false), name: '결과' }, { ...art.resultsPanel(true), name: '신기록' }],
  entity: { x: 0, y: 0, scaleX: 0.5, scaleY: 0.5, visible: false },
  threads: [[when.run(), hide(), repeat.inf([
    shape(add(v('newRecord'), 1)),
    ...visibleWhen(and_(eq(v('state'), 3), gt(v('resultT'), 2.2))),
  ])]],
});

const objects = [hud, results, title, press, bannerObj, hudFrame, dust, player, world, near, far, sky, audio];

export default {
  name: 'SUNSET DRIVE · 선셋 드라이브',
  speed: 60,
  scenes: [scene('race', '레이스')],
  variables,
  lists,
  functions,
  objects,
};
export const CONST = { SEG, L, TRACK, DRAW, K, RW, CH, HOR, PZ, MAXV, LAPS, LINE, RIVALS };
