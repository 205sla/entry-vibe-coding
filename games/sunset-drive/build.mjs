// Build SUNSET DRIVE: synthesize audio → MP3 → numbered .ent (never overwrites an existing number).
//   node games/sunset-drive/build.mjs            → games/sunset-drive/sunset-drive_NNN.ent
//   node games/sunset-drive/build.mjs --out X    → write X instead (dev builds)
//   node games/sunset-drive/build.mjs --no-audio → reuse existing audio/*.mp3
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderAll, SOUNDS } from './audio.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../..');
const args = process.argv.slice(2);
const audioDir = path.join(dir, 'audio');

if (!args.includes('--no-audio')) {
  const info = renderAll(audioDir);
  const durations = {};
  for (const [name, { kbps }] of Object.entries(SOUNDS)) {
    const wav = path.join(audioDir, name + '.wav'), mp3 = path.join(audioDir, name + '.mp3');
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', `${kbps}k`, mp3], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ffmpeg failed for ' + name);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3], { encoding: 'utf8' });
    durations[name] = +(+probe.stdout.trim()).toFixed(3) || info[name].seconds;
  }
  fs.writeFileSync(path.join(audioDir, 'durations.json'), JSON.stringify(durations, null, 2) + '\n');
  console.log('audio', durations);
}

let out = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : null;
if (!out) {
  const nums = fs.readdirSync(dir).map((n) => n.match(/^sunset-drive_(\d{3})\.ent$/)).filter(Boolean).map((m) => +m[1]);
  out = path.join(dir, `sunset-drive_${String(1 + Math.max(0, ...nums)).padStart(3, '0')}.ent`);
}
const r = spawnSync(process.execPath, ['tools/make-ent.mjs', path.join(dir, 'spec.mjs'), out], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log(out);
