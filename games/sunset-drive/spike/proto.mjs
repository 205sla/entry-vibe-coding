// Renderer prototype: pseudo-3D road with curves + hills, auto camera. Measures fps.
import {
  when, repeat, if_, cmp, calc, mod, quotient, txt, getVar as v, setVar as s, changeVar as inc,
  fn, call, obj, scene, locateXY, eraseAll, valueAt as at, timer,
} from '../../../tools/lib/spec-dsl.mjs';
import { buildTrack, SEG } from '../track.mjs';

const DRAW = Number(process.env.DRAW || 44), K = 200, RW = 1000, CH = 1000, HOR = 25, KRW = K * RW;
const add = (a, b) => calc(a, '+', b), sub = (a, b) => calc(a, '-', b), mul = (a, b) => calc(a, '*', b), div = (a, b) => calc(a, '/', b);
const lt = (a, b) => cmp(a, '<', b), le = (a, b) => cmp(a, '<=', b), gt = (a, b) => cmp(a, '>', b), eq = (a, b) => cmp(a, '==', b);
const setFill = (x) => ({ type: 'set_fill_color', params: [x, null] });
const startFill = () => ({ type: 'start_fill', params: [null] });
const stopFill = () => ({ type: 'stop_fill', params: [null] });
const quad = (x1, y1, x2, y2, x3, y3, x4, y4) => [locateXY(x1, y1), startFill(), locateXY(x2, y2), locateXY(x3, y3), locateXY(x4, y4), stopFill()];

const { bands, L } = buildTrack();
const ext = (f) => [...bands, ...bands.slice(0, DRAW + 4)].map(f);
const r2 = (x) => Math.round(x * 100) / 100;
const lists = [
  { id: 'tc', name: '커브', array: ext((b) => r2(b.curve * K)), visible: false },
  { id: 'ty', name: '높이', array: ext((b) => r2(b.y * K)), visible: false },
  { id: 'tpal', name: '색번호', array: ext((b, i) => 1 + b.theme * 2 + ((i % L) % 2)), visible: false },
  { id: 'gcol', name: '땅색', array: ['#dcae70', '#d2a266', '#46803a', '#3d7233', '#c8703f', '#bb6737'], visible: false },
  { id: 'rcol', name: '연석색', array: ['#e8484a', '#f4f0e6', '#e8484a', '#f4f0e6', '#f2d24a', '#40363a'], visible: false },
  { id: 'dcol', name: '도로색', array: ['#6d6a76', '#67646f', '#605e69', '#5a5863', '#6a5f64', '#645a5e'], visible: false },
];
const hot = ['camX', 'camY', 'sink', 'pos', 'speed', 'dt', 'now', 'last', 'frames', 'L'];
const variables = hot.map((id) => ({ id, name: id, value: String({ L, speed: 9000 }[id] ?? 0), visible: false }));

const lanes = (psx, psw, psy, sx, sw, sy) => [0.31, -0.36].map((a) => quad(
  add(psx, mul(psw, a)), psy, add(psx, mul(psw, a + 0.05)), psy, add(sx, mul(sw, a + 0.05)), sy, add(sx, mul(sw, a)), sy)).flat();

const functions = [
  fn.normal('band', ['bn', 'bi', 'bz', 'bx', 'bd', 'bm', 'bpx', 'bpw', 'bpy'], (n, i, zc, X, dX, M, psx, psw, psy, Lc) => {
    const g = Lc.get;
    return [
      if_(le(n, DRAW), [
        Lc.set('iz', div(1, zc)),
        Lc.set('sw', mul(KRW, g('iz'))),
        Lc.set('sx', mul(sub(X, v('camX')), g('iz'))),
        Lc.set('sy', add(HOR, mul(sub(at('ty', i), v('camY')), g('iz')))),
        if_(gt(g('sy'), M), [
          Lc.set('p', at('tpal', i)),
          setFill(at('gcol', g('p'))),
          ...quad(-240, psy, 240, psy, 240, g('sy'), -240, g('sy')),
          setFill(at('rcol', g('p'))),
          ...quad(sub(psx, mul(psw, 1.16)), psy, add(psx, mul(psw, 1.16)), psy, add(g('sx'), mul(g('sw'), 1.16)), g('sy'), sub(g('sx'), mul(g('sw'), 1.16)), g('sy')),
          setFill(at('dcol', g('p'))),
          ...quad(sub(psx, psw), psy, add(psx, psw), psy, add(g('sx'), g('sw')), g('sy'), sub(g('sx'), g('sw')), g('sy')),
          if_(eq(mod(g('p'), 2), 0), [setFill(txt('#f3efe4')), ...lanes(psx, psw, psy, g('sx'), g('sw'), g('sy'))]),
          call('band', add(n, 1), add(i, 1), add(zc, SEG), add(X, dX), add(dX, at('tc', i)), g('sy'), g('sx'), g('sw'), g('sy')),
        ], [
          call('band', add(n, 1), add(i, 1), add(zc, SEG), add(X, dX), add(dX, at('tc', i)), M, g('sx'), g('sw'), M),
        ]),
      ]),
    ];
  }, ['iz', 'sw', 'sx', 'sy', 'p']),
  fn.normal('render', [], (Lc) => {
    const g = Lc.get;
    return [
      Lc.set('base', quotient(v('pos'), SEG)),
      Lc.set('frac', mod(v('pos'), SEG)),
      Lc.set('i0', add(g('base'), 1)),
      Lc.set('d0', div(mul(at('tc', g('i0')), g('frac')), -SEG)),
      Lc.set('z1', sub(SEG, g('frac'))),
      if_(lt(g('z1'), 300), [Lc.set('z1', 300)]),
      Lc.set('iz', div(1, g('z1'))),
      Lc.set('sx', mul(sub(g('d0'), v('camX')), g('iz'))),
      Lc.set('sw', mul(KRW, g('iz'))),
      Lc.set('sy', add(HOR, mul(sub(at('ty', add(g('i0'), 1)), v('camY')), g('iz')))),
      Lc.set('d1', add(g('d0'), at('tc', g('i0')))),
      call('band', 2, add(g('i0'), 2), sub(2 * SEG, g('frac')), add(g('d0'), g('d1')), add(g('d1'), at('tc', add(g('i0'), 1))),
        g('sy'), g('sx'), g('sw'), g('sy')),
    ];
  }, ['base', 'frac', 'i0', 'd0', 'd1', 'z1', 'iz', 'sx', 'sw', 'sy']),
];

const PZ = 1400;
// Road height under the player (interpolated) → camera height.
const playerRoadY = () => {
  const zp = add(v('pos'), PZ);
  const idx = add(quotient(zp, SEG), 1);
  const f = div(mod(zp, SEG), SEG);
  return add(at('ty', idx), mul(sub(at('ty', add(idx, 1)), at('ty', idx)), f));
};

const svg = (w, h, body) => ({ svgString: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`, dimension: { width: w, height: h }, imageType: 'svg' });
const sky = svg(480, 270, `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2a6b"/><stop offset=".45" stop-color="#b44a7d"/><stop offset=".62" stop-color="#f59a52"/><stop offset=".72" stop-color="#ffd27a"/><stop offset="1" stop-color="#6d3c5e"/></linearGradient></defs><rect width="480" height="270" fill="url(#g)"/><circle cx="240" cy="96" r="44" fill="#ffe28a"/>`);

const objects = [
  obj('road', 'road', {
    scene: 'main',
    picture: svg(4, 4, '<rect width="4" height="4" fill="#000" opacity="0"/>'),
    entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true },
    threads: [[
      when.run(), s('frames', 0), timer.reset(), timer.start(), s('last', timer.value()), setFill(txt('#000000')),
      repeat.inf([
        s('now', timer.value()), s('dt', sub(v('now'), v('last'))), s('last', v('now')),
        if_(gt(v('dt'), 0.05), [s('dt', 0.05)]),
        s('pos', mod(add(v('pos'), mul(v('speed'), v('dt'))), L * SEG)),
        s('camX', 0),
        s('camY', add(K * CH, playerRoadY())),
        eraseAll(),
        call('render'),
        locateXY(0, -300),
        inc('frames', 1),
      ]),
    ]],
  }),
  obj('sky', 'sky', { scene: 'main', picture: sky, entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true }, threads: [[]] }),
];

export default { name: 'sunset proto', speed: 60, scenes: [scene('main', 'main')], variables, lists, functions, objects };
