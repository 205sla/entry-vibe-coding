// Rasterize the SVG art into one contact sheet for a quick visual check.
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../assets.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const items = [
  ['palm0', A.palm(0)], ['palm1', A.palm(1)], ['pine', A.pine()], ['cactus', A.cactus()], ['rock', A.rock()], ['bush', A.bush()],
  ['lamp', A.lamp()], ['signL', A.curveSign(-1)], ['signR', A.curveSign(1)], ['bbS', A.billboard('sunset')], ['bbE', A.billboard('entry')], ['bb205', A.billboard('205')],
  ['gantry', A.gantry()], ['carB0', A.rivalCar('#2f6bff', 0)], ['carY-1', A.rivalCar('#ffd23a', -1, 1)], ['carW1', A.rivalCar('#f2f2f2', 1)],
  ['tower', A.tower()], ['p0', A.playerCar(0, false)], ['pL', A.playerCar(-1, false)], ['pR', A.playerCar(1, true)], ['dust', A.dust(1)],
  ...(process.env.EXTRA ? JSON.parse(process.env.EXTRA) : []),
];
const cell = 200, cols = 5;
const rows = Math.ceil(items.length / cols);
const composites = [];
for (let k = 0; k < items.length; k++) {
  const [, g] = items[k];
  const buf = await sharp(Buffer.from(g.svgString)).resize(cell, cell, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  composites.push({ input: buf, left: (k % cols) * cell, top: Math.floor(k / cols) * cell });
}
await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: { r: 233, g: 150, b: 120, alpha: 1 } } })
  .composite(composites).png().toFile(path.join(dir, 'assets-sheet.png'));
const bgs = [['sky', A.sky()], ['far', A.farLayer()], ['near0', A.nearLayer(0)], ['near1', A.nearLayer(1)], ['near2', A.nearLayer(2)]];
for (const [n, g] of bgs) await sharp(Buffer.from(g.svgString)).png().toFile(path.join(dir, `bg-${n}.png`));
console.log('ok', items.length);
