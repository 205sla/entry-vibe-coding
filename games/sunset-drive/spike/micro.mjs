// Micro-benchmark: cost of individual block families inside a tail-recursive value function.
// Each iteration runs 10 copies of the op under test; `mode` selects the op, `N` the iterations.
// build: node tools/make-ent.mjs games/sunset-drive/spike/micro.mjs games/sunset-drive/spike/micro.ent
// run:   node games/sunset-drive/spike/micro-run.mjs 300   (editor server on :3000)
import {
  when, repeat, if_, cmp, calc, mod, txt, getVar as v, setVar as s, changeVar as inc,
  fn, call, obj, scene, locateXY, valueAt, setListAt, eraseAll,
} from '../../../tools/lib/spec-dsl.mjs';

const add = (a, b) => calc(a, '+', b), mul = (a, b) => calc(a, '*', b), div = (a, b) => calc(a, '/', b);
const lt = (a, b) => cmp(a, '<', b), eq = (a, b) => cmp(a, '==', b);
const op = (a, f) => ({ type: 'calc_operation', params: [null, a, null, f] });
const run = (id, ...args) => s('sink', call(id, ...args));

const hot = ['a', 'b', 'c', 'sink', 'mode', 'N', 'frames'];
const filler = Array.from({ length: Number(process.env.FILLER || 0) }, (_, i) => 'f' + i);
const variables = [...hot, ...filler].map((id) => ({ id, name: id, value: String({ mode: 1, N: 100, a: 3.7, b: 1.3, c: 2 }[id] ?? 0), visible: false }));
const lists = [{ id: 'lst', name: 'lst', array: Array.from({ length: 64 }, (_, i) => i * 1.5), visible: false }];

const TEN = (f) => Array.from({ length: 10 }, f);
const fillColor = (x) => ({ type: 'set_fill_color', params: [x, null] });
const startFill = () => ({ type: 'start_fill', params: [null] });
const stopFill = () => ({ type: 'stop_fill', params: [null] });
const stamp = () => ({ type: 'brush_stamp', params: [null] });
const bodies = {
  1: () => TEN(() => s('c', 5)),                                  // set literal
  2: () => TEN(() => s('c', v('a'))),                             // set + global read
  3: () => TEN(() => s('c', add(v('a'), v('b')))),                // + (BigNumber)
  4: () => TEN(() => s('c', mul(v('a'), v('b')))),                // * (BigNumber)
  5: () => TEN(() => s('c', div(v('a'), v('b')))),                // / (BigNumber)
  6: () => TEN(() => s('c', mod(v('a'), v('b')))),                // quotient_and_mod (plain JS)
  7: () => TEN(() => s('c', op(v('a'), 'abs'))),                  // calc_operation
  8: () => TEN(() => locateXY(v('a'), v('b'))),                   // locate (no pen)
  9: () => TEN(() => s('c', valueAt('lst', v('c')))),             // list read (index var)
  10: (p) => TEN(() => s('c', p)),                                // param read
  11: (p, L) => TEN(() => L.set('t', L.get('u'))),                // local set/get
  12: () => TEN(() => setListAt('lst', 5, v('a'))),               // list write
  13: () => TEN(() => s('c', add(v('a'), 1))),                    // + literal
  14: (p) => TEN(() => [locateXY(-50, p), startFill(), locateXY(50, p), locateXY(40, add(p, 3)), locateXY(-40, add(p, 3)), stopFill()]).flat(), // fill quad
  15: () => TEN(() => fillColor(txt('#3c8c46'))),                 // set_fill_color
  16: (p) => TEN(() => s('sink', call('leaf', p, 2, 3, 4, 5, 6))),   // call overhead (6 params, 4 locals)
  17: (p) => TEN(() => [locateXY(mod(mul(p, 37), 400), 0), stamp()]).flat(), // stamp
  18: (p, L) => TEN(() => L.set('t', add(L.get('u'), p))),          // local set(add(local,param))
  19: (p) => TEN(() => s('sink', call('leaf0', p))),                 // call overhead (1 param, 0 locals)
  20: (p) => TEN((_, k) => ({ type: 'change_to_some_shape', params: [k % 2 ? 1 : 2, null] })),  // costume switch (literal index)
  21: (p) => TEN((_, k) => ({ type: 'set_scale_size', params: [add(20, k), null] })),   // set size
  22: (p) => TEN((_, k) => [({ type: 'change_to_some_shape', params: [k % 2 ? 1 : 2, null] }), ({ type: 'set_scale_size', params: [add(20, k), null] }), locateXY(mul(k, 20), 0), stamp()]).flat(), // full stamp
};

const functions = Object.entries(bodies).map(([m, body]) =>
  fn.value('m' + m, ['i' + m], (i, L) => [
    if_(lt(i, v('N')), [...body(i, L), run('m' + m, add(i, 1))]),
  ], () => 0, (m === '11' || m === '18') ? ['t', 'u'] : []));
functions.push(fn.value('leaf', ['la', 'lb', 'lc', 'ld', 'le', 'lf'], (a, b, c, d, e, f, L) => [L.set('w', a)], (a, b, c, d, e, f, L) => L.get('w'), ['w', 'x', 'y', 'z']));
functions.push(fn.value('leaf0', ['ma'], (a) => [], (a) => a));

const painter = obj('painter', 'painter', {
  scene: 'main',
  pictures: [{ id: 'pa', name: 'pa', svgString: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#e33"/></svg>', dimension: { width: 20, height: 20 }, imageType: 'svg' }, { id: 'pb', name: 'pb', svgString: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#3e3"/></svg>', dimension: { width: 40, height: 40 }, imageType: 'svg' }],
  entity: { x: 0, y: 0, scaleX: 1, scaleY: 1, visible: true },
  threads: [[
    when.run(), s('frames', 0), s('c', 3), eraseAll(),
    repeat.inf([
      ...Object.keys(bodies).map((m) => if_(eq(v('mode'), Number(m)), [run('m' + m, 0)])),
      inc('frames', 1), eraseAll(),
    ]),
  ]],
});

export default { name: 'micro bench', speed: 60, scenes: [scene('main', 'main')], variables, lists, functions, objects: [painter] };
