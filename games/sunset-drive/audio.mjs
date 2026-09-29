// Original synthesized music and effects for SUNSET DRIVE (no samples, no external audio).
// Writes 16-bit mono WAV files; build.mjs encodes them to MP3 for the web.
import fs from 'node:fs';
import path from 'node:path';

export const RATE = 44100;

// ── primitives ─────────────────────────────────────────────────────────────
let seed = 12345;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x40000000) - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const TAU = Math.PI * 2;
// band-limited sawtooth / square by additive synthesis (cheap enough offline)
const saw = (ph, f, bright = 1) => {
  let v = 0;
  const n = Math.max(1, Math.min(40, Math.floor((RATE / 2.2 / f) * bright)));
  for (let k = 1; k <= n; k++) v += Math.sin(ph * k) / k;
  return v * 0.6;
};
const square = (ph, f) => {
  let v = 0;
  const n = Math.max(1, Math.min(25, Math.floor(RATE / 2.2 / f)));
  for (let k = 1; k <= n; k += 2) v += Math.sin(ph * k) / k;
  return v * 0.8;
};
const env = (t, a, d, s, r, len) => {
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < len) return s;
  if (t < len + r) return s * (1 - (t - len) / r);
  return 0;
};
class Track {
  constructor(seconds) { this.buf = new Float32Array(Math.ceil(seconds * RATE)); }
  // add a voice: fn(t, i) -> sample, rendered from start for dur seconds
  add(start, dur, fn) {
    const i0 = Math.max(0, Math.floor(start * RATE)), i1 = Math.min(this.buf.length, Math.floor((start + dur) * RATE));
    for (let i = i0; i < i1; i++) this.buf[i] += fn((i - i0) / RATE, i);
  }
  lowpassSection(from, to, cutoff) { // one-pole low-pass on a time range (used for pads)
    const a = Math.exp(-TAU * cutoff / RATE);
    let y = 0;
    for (let i = Math.floor(from * RATE); i < Math.min(this.buf.length, Math.floor(to * RATE)); i++) { y = (1 - a) * this.buf[i] + a * y; this.buf[i] = y; }
  }
  echo(delay, fb, mix) {
    const d = Math.floor(delay * RATE), out = Float32Array.from(this.buf);
    for (let i = d; i < out.length; i++) out[i] += out[i - d] * fb;
    for (let i = 0; i < out.length; i++) this.buf[i] = this.buf[i] * (1 - mix) + out[i] * mix;
  }
  mixIn(other, gain = 1) { for (let i = 0; i < Math.min(this.buf.length, other.buf.length); i++) this.buf[i] += other.buf[i] * gain; }
  // wrap the tail of the echo back into the start so the loop point is seamless
  foldLoop(loopLen) {
    const n = Math.floor(loopLen * RATE);
    for (let i = n; i < this.buf.length; i++) this.buf[i - n] += this.buf[i];
    this.buf = this.buf.slice(0, n);
  }
  finish(peak = 0.89, fade = 0) {
    let m = 0;
    for (const v of this.buf) m = Math.max(m, Math.abs(Math.tanh(v)));
    const g = m > 0 ? peak / m : 1;
    for (let i = 0; i < this.buf.length; i++) this.buf[i] = Math.tanh(this.buf[i]) * g;
    const fn = Math.floor(fade * RATE);
    for (let i = 0; i < fn; i++) { this.buf[i] *= i / fn; this.buf[this.buf.length - 1 - i] *= i / fn; }
    return this;
  }
}
const writeWav = (file, data) => {
  const n = data.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(file, b);
};

// ── instruments ───────────────────────────────────────────────────────────
const kick = (T, at, gain = 1) => T.add(at, 0.45, (t) => {
  const f = 45 + 110 * Math.exp(-t * 28);
  return Math.sin(TAU * (45 * t + (110 / 28) * (1 - Math.exp(-t * 28)))) * Math.exp(-t * 7) * 0.95 * gain + (t < 0.004 ? noise() * 0.3 * gain : 0) + 0 * f;
});
const snare = (T, at, gain = 1) => {
  let lp = 0;
  T.add(at, 0.32, (t) => { lp = lp * 0.55 + noise() * 0.45; return (lp * 0.9 * Math.exp(-t * 13) + Math.sin(TAU * 185 * t) * 0.35 * Math.exp(-t * 22)) * gain; });
};
const hat = (T, at, open = false, gain = 1) => {
  let prev = 0;
  T.add(at, open ? 0.22 : 0.06, (t) => { const n = noise(); const hp = n - prev; prev = n; return hp * 0.28 * gain * Math.exp(-t * (open ? 14 : 55)); });
};
const bass = (T, at, dur, midi, gain = 1) => {
  const f = mtof(midi);
  let lp = 0;
  T.add(at, dur + 0.03, (t) => {
    const e = env(t, 0.004, 0.09, 0.55, 0.03, dur);
    const cut = 0.08 + 0.35 * Math.exp(-t * 18);
    lp += cut * (saw(TAU * f * t, f, 0.5) - lp);
    return lp * e * 0.55 * gain;
  });
};
const pad = (T, at, dur, notes, gain = 1) => notes.forEach((m, k) => {
  const f = mtof(m);
  T.add(at, dur + 0.4, (t) => {
    const e = env(t, 0.35, 0.3, 0.8, 0.4, dur);
    const det = Math.sin(TAU * 0.3 * t + k);
    return (saw(TAU * f * t, f, 0.25) + saw(TAU * f * 1.006 * t + det * 0.02, f, 0.25)) * e * 0.08 * gain;
  });
});
const pluck = (T, at, dur, midi, gain = 1) => {
  const f = mtof(midi);
  T.add(at, dur + 0.2, (t) => square(TAU * f * t, f) * Math.exp(-t * 9) * 0.13 * gain * Math.min(1, t * 400));
};
const lead = (T, at, dur, midi, gain = 1) => {
  const f = mtof(midi);
  T.add(at, dur + 0.15, (t) => {
    const vib = t > 0.18 ? Math.sin(TAU * 5.5 * t) * 0.004 : 0;
    const e = env(t, 0.012, 0.12, 0.7, 0.12, dur);
    return (saw(TAU * f * (1 + vib) * t, f, 0.6) * 0.7 + square(TAU * f * 2 * t, 2 * f) * 0.12) * e * 0.2 * gain;
  });
};

// ── pieces ────────────────────────────────────────────────────────────────
// Race theme: 128 BPM, 16 bars (30 s), A minor: Am F C G | Am F C E
export function raceTheme() {
  const bpm = 128, beat = 60 / bpm, bar = beat * 4, bars = 16, len = bars * bar;
  const T = new Track(len + 2), P = new Track(len + 2), E = new Track(len + 2);
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60], [48, 52, 55], [52, 56, 59]];
  const roots = [45, 41, 48, 43, 45, 41, 48, 40];
  for (let b = 0; b < bars; b++) {
    const c = chords[Math.floor(b / 2) % 8], r = roots[Math.floor(b / 2) % 8], t0 = b * bar;
    pad(P, t0, bar - 0.05, c.map((m) => m + 12), 1);
    for (let e8 = 0; e8 < 8; e8++) bass(T, t0 + e8 * beat / 2, beat / 2 - 0.02, r + (e8 % 2 ? 12 : 0), 1);
    for (let q = 0; q < 4; q++) {
      kick(T, t0 + q * beat, 1);
      if (q % 2 === 1) snare(T, t0 + q * beat, 0.9);
      hat(T, t0 + q * beat + beat / 2, q === 3, 0.9);
      hat(T, t0 + q * beat, false, 0.5);
    }
    if (b >= 2) for (let s16 = 0; s16 < 16; s16++) {
      const note = [c[0], c[1], c[2], c[1] + 12][s16 % 4] + 12;
      pluck(E, t0 + s16 * beat / 4, beat / 4, note, s16 % 4 === 0 ? 1 : 0.7);
    }
  }
  // lead melody in the second half (bars 8-15), eighth-note grid [bar, eighth, midi, eighths]
  const mel = [
    [8, 0, 76, 3], [8, 3, 74, 1], [8, 4, 72, 2], [8, 6, 71, 2], [9, 0, 72, 4], [9, 4, 69, 4],
    [10, 0, 67, 3], [10, 3, 69, 1], [10, 4, 72, 2], [10, 6, 74, 2], [11, 0, 71, 6], [11, 6, 74, 2],
    [12, 0, 76, 3], [12, 3, 77, 1], [12, 4, 76, 2], [12, 6, 74, 2], [13, 0, 72, 4], [13, 4, 77, 4],
    [14, 0, 76, 2], [14, 2, 74, 2], [14, 4, 72, 2], [14, 6, 71, 2], [15, 0, 68, 4], [15, 4, 71, 2], [15, 6, 74, 2],
  ];
  const Lt = new Track(len + 2);
  for (const [b, e, m, d] of mel) lead(Lt, b * bar + e * beat / 2, d * beat / 2 - 0.03, m, 1);
  Lt.echo(beat * 0.75, 0.35, 0.35);
  E.echo(beat * 0.75, 0.4, 0.4);
  P.lowpassSection(0, len + 2, 2400);
  T.mixIn(P, 1); T.mixIn(E, 0.9); T.mixIn(Lt, 1);
  T.foldLoop(len);
  return T.finish(0.85);
}

// Title theme: dreamy, 100 BPM, 8 bars
export function titleTheme() {
  const bpm = 100, beat = 60 / bpm, bar = beat * 4, bars = 8, len = bars * bar;
  const T = new Track(len + 3), E = new Track(len + 3);
  const chords = [[57, 64, 67, 72], [53, 60, 64, 69], [48, 55, 60, 64], [55, 62, 67, 71]];
  for (let b = 0; b < bars; b++) {
    const c = chords[Math.floor(b / 2) % 4], t0 = b * bar;
    pad(T, t0, bar - 0.05, c, 1.3);
    bass(T, t0, bar * 0.45, c[0] - 12, 0.8);
    bass(T, t0 + bar * 0.5, bar * 0.45, c[0] - 12, 0.6);
    kick(T, t0, 0.55); kick(T, t0 + beat * 2, 0.45);
    snare(T, t0 + beat * 3, 0.3);
    for (let s8 = 0; s8 < 8; s8++) pluck(E, t0 + s8 * beat / 2, beat / 2, c[(s8 * 3) % 4] + 12, 0.8);
  }
  E.echo(beat * 0.75, 0.45, 0.45);
  T.mixIn(E, 0.9);
  T.lowpassSection(0, len + 3, 5000);
  T.foldLoop(len);
  return T.finish(0.8);
}

export function countdown() { // beeps at 0.6, 1.6, 2.6; GO at 3.6
  const T = new Track(4.4);
  for (const at of [0.6, 1.6, 2.6]) T.add(at, 0.2, (t) => square(TAU * 988 * t, 988) * env(t, 0.003, 0.02, 0.8, 0.05, 0.14) * 0.5);
  T.add(3.6, 0.75, (t) => (square(TAU * 1976 * t, 1976) * 0.6 + square(TAU * 988 * t, 988) * 0.4) * env(t, 0.003, 0.05, 0.8, 0.2, 0.5) * 0.5);
  return T.finish(0.8);
}

export function finishFanfare() {
  const T = new Track(4.2);
  const steps = [[0, [60, 64, 67, 72]], [0.28, [65, 69, 72, 77]], [0.56, [67, 71, 74, 79]], [0.9, [72, 76, 79, 84]]];
  for (const [at, notes] of steps) notes.forEach((m) => lead(T, at, at < 0.8 ? 0.22 : 2.4, m, 0.9));
  for (const at of [0, 0.28, 0.56, 0.9]) kick(T, at, 0.8);
  snare(T, 0.9, 1);
  const E = new Track(4.2);
  for (let k = 0; k < 12; k++) pluck(E, 1.0 + k * 0.1, 0.1, [84, 88, 91, 96][k % 4], 0.8);
  E.echo(0.2, 0.4, 0.4);
  T.mixIn(E, 0.8);
  return T.finish(0.85, 0.02);
}

// Engine: 1.0 s, fundamental 70 Hz (exactly 70 cycles), edge fades for overlapping restarts.
export function engine() {
  const T = new Track(1.0);
  let lp = 0, lpn = 0;
  T.add(0, 1.0, (t) => {
    const ph = TAU * 70 * t;
    const firing = saw(ph, 70, 0.35) * 0.8 + Math.sin(ph * 0.5) * 0.35 + Math.sin(ph * 2) * 0.25 + Math.sin(ph * 3 + 0.4) * 0.12;
    lp += 0.18 * (firing - lp);
    lpn += 0.08 * (noise() - lpn);
    const rough = 1 + 0.25 * Math.sin(ph * 0.25);
    const fade = Math.min(1, t / 0.06, (1 - t) / 0.06);
    return (lp * rough + lpn * 0.35) * fade;
  });
  return T.finish(0.38);
}

export function crash() {
  const T = new Track(0.8);
  let lp = 0;
  T.add(0, 0.8, (t) => {
    lp += 0.12 * (noise() - lp);
    return Math.sin(TAU * (40 * t + 60 * (1 - Math.exp(-t * 20)) / 20)) * Math.exp(-t * 6) * 0.9
      + lp * Math.exp(-t * 5) * 1.2
      + (Math.sin(TAU * 523 * t) + Math.sin(TAU * 1207 * t) * 0.6) * Math.exp(-t * 14) * 0.25;
  });
  return T.finish(0.9);
}

export function lapChime() {
  const T = new Track(1.0);
  T.add(0, 0.9, (t) => (Math.sin(TAU * 1318.5 * t) * Math.exp(-t * 5) + 0.5 * Math.sin(TAU * 2637 * t) * Math.exp(-t * 7)) * 0.4);
  T.add(0.14, 0.86, (t) => (Math.sin(TAU * 1975.5 * t) * Math.exp(-t * 4) + 0.4 * Math.sin(TAU * 3951 * t) * Math.exp(-t * 7)) * 0.4);
  return T.finish(0.8, 0.005);
}

export function skid() {
  const T = new Track(0.6);
  let b1 = 0, b2 = 0;
  T.add(0, 0.6, (t) => {
    // resonant noise around 1.7 kHz with a wobble: tyres scrubbing
    const f = 1700 + 180 * Math.sin(TAU * 23 * t);
    const w = TAU * f / RATE, q = 0.965;
    const x = noise();
    const y = x * 0.08 + 2 * q * Math.cos(w) * b1 - q * q * b2;
    b2 = b1; b1 = y;
    return y * Math.min(1, t / 0.03, (0.6 - t) / 0.2) * 0.9;
  });
  return T.finish(0.5);
}

export const SOUNDS = {
  race: { make: raceTheme, kbps: 128 },
  title: { make: titleTheme, kbps: 112 },
  countdown: { make: countdown, kbps: 96 },
  finish: { make: finishFanfare, kbps: 112 },
  engine: { make: engine, kbps: 128 },
  crash: { make: crash, kbps: 96 },
  lap: { make: lapChime, kbps: 96 },
  skid: { make: skid, kbps: 96 },
};

export function renderAll(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const info = {};
  for (const [name, { make }] of Object.entries(SOUNDS)) {
    seed = 12345;
    const T = make();
    writeWav(path.join(outDir, name + '.wav'), T.buf);
    info[name] = { seconds: +(T.buf.length / RATE).toFixed(3) };
  }
  return info;
}
