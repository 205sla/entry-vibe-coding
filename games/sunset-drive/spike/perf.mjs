// Performance spike: how many fill polygons / stamps / math ops fit in one Entry frame?
// mode 1: N fill quads, colour switch per quad   mode 2: N fill quads, one colour
// mode 3: N iterations x 10 arithmetic setVar     mode 4: N scaled stamps
// mode 5: N brush lines                           mode 6: N quads with 4 local-var reads each
import {
  when, repeat, if_, cmp, calc, mod, txt, getVar as v, setVar as s, changeVar as inc,
  fn, call, obj, scene, locateXY, eraseAll, stamp, show, setSize, startDraw, stopDraw, setThickness, setColor,
} from '../../../tools/lib/spec-dsl.mjs';

const add = (a, b) => calc(a, '+', b), sub = (a, b) => calc(a, '-', b), mul = (a, b) => calc(a, '*', b), div = (a, b) => calc(a, '/', b);
const lt = (a, b) => cmp(a, '<', b), eq = (a, b) => cmp(a, '==', b);
const run = (id, ...args) => s('sink', call(id, ...args));
const vf = (id, p, b, locals = []) => fn.value(id, p, b, () => 0, locals);
const fillColor = (x) => ({ type: 'set_fill_color', params: [x, null] });
const startFill = () => ({ type: 'start_fill', params: [null] });
const stopFill = () => ({ type: 'stop_fill', params: [null] });

const variables = ['sink', 'mode', 'N', 'frames', 'y1', 'y2', 'a', 'b', 'c', 'd', 'e']
  .map((id) => ({ id, name: id, value: String({ mode: 1, N: 100 }[id] ?? 0), visible: false }));

const svg = (w, h, body) => ({ svgString: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`, dimension: { width: w, height: h }, imageType: 'svg' });

const quad = (i) => [
  s('y1', add(-135, mul(i, div(270, v('N'))))),
  s('y2', add(v('y1'), div(270, v('N')))),
  locateXY(sub(-100, mod(i, 7)), v('y1')),
  startFill(),
  locateXY(add(100, mod(i, 7)), v('y1')),
  locateXY(add(80, mod(i, 5)), v('y2')),
  locateXY(sub(-80, mod(i, 5)), v('y2')),
  stopFill(),
];

const functions = [
  vf('quads', ['qi'], (i) => [
    if_(lt(i, v('N')), [
      if_(eq(mod(i, 2), 0), [fillColor(txt('#3c8c46'))], [fillColor(txt('#707078'))]),
      ...quad(i),
      run('quads', add(i, 1)),
    ]),
  ]),
  vf('quads1', ['ri'], (i) => [
    if_(lt(i, v('N')), [
      ...quad(i),
      run('quads1', add(i, 1)),
    ]),
  ]),
  vf('mathonly', ['mi'], (i) => [
    if_(lt(i, v('N')), [
      s('a', mul(i, 1.5)), s('b', add(v('a'), 3)), s('c', div(v('b'), 7)), s('d', sub(v('c'), v('a'))), s('e', mul(v('d'), v('d'))),
      s('a', add(v('e'), 1)), s('b', mul(v('a'), 0.5)), s('c', add(v('b'), v('a'))), s('d', div(v('c'), 3)), s('e', sub(v('d'), 1)),
      run('mathonly', add(i, 1)),
    ]),
  ]),
  vf('stamps', ['si'], (i) => [
    if_(lt(i, v('N')), [
      setSize(add(20, mod(i, 30))),
      locateXY(sub(mod(mul(i, 37), 440), 220), sub(mod(mul(i, 23), 240), 120)),
      stamp(),
      run('stamps', add(i, 1)),
    ]),
  ]),
  vf('lines', ['li'], (i) => [
    if_(lt(i, v('N')), [
      s('y1', add(-135, mul(i, div(270, v('N'))))),
      stopDraw(), locateXY(-150, v('y1')), startDraw(), locateXY(150, v('y1')), stopDraw(),
      run('lines', add(i, 1)),
    ]),
  ]),
  vf('localquads', ['ti'], (i, L) => [
    if_(lt(i, v('N')), [
      L.set('p', add(-135, mul(i, div(270, v('N'))))),
      L.set('q', add(L.get('p'), div(270, v('N')))),
      locateXY(-100, L.get('p')), startFill(),
      locateXY(100, L.get('p')), locateXY(80, L.get('q')), locateXY(-80, L.get('q')), stopFill(),
      run('localquads', add(i, 1)),
    ]),
  ], ['p', 'q']),
];

const painter = obj('painter', 'painter', {
  scene: 'main',
  picture: svg(40, 40, '<rect width="40" height="40" fill="#e33"/>'),
  entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true },
  threads: [[
    when.run(), setThickness(3), setColor('#ffffff'), fillColor(txt('#3c8c46')), s('frames', 0),
    repeat.inf([
      eraseAll(),
      if_(eq(v('mode'), 1), [run('quads', 0)]),
      if_(eq(v('mode'), 2), [run('quads1', 0)]),
      if_(eq(v('mode'), 3), [run('mathonly', 0)]),
      if_(eq(v('mode'), 4), [run('stamps', 0)]),
      if_(eq(v('mode'), 5), [run('lines', 0)]),
      if_(eq(v('mode'), 6), [run('localquads', 0)]),
      locateXY(0, 0),
      inc('frames', 1),
    ]),
  ]],
});

export default {
  name: 'perf spike',
  speed: 60,
  scenes: [scene('main', 'main')],
  variables,
  functions,
  objects: process.env.DUMMY ? [obj('dummy','dummy',{scene:'main',picture: svg(10,10,'<rect width="10" height="10" fill="#000"/>'),entity:{x:-230,y:-130,scaleX:1,scaleY:1,visible:true},threads:[[]]}), painter] : [painter],
};
