// Course data for SUNSET DRIVE, generated at build time and stored in ordinary Entry lists.
// The running .ent only reads these lists; every frame of the race is computed by blocks.
//
// Units: one list entry = one "band" (road slice) SEG world units long.
//   curve  – how much the road bends during the band (world units / band², like Jake Gordon's
//            javascript-racer "curve", rescaled for 500-unit bands)
//   y      – road height at the band's near edge (world units)
//   theme  – scenery/colour set (0 beach, 1 forest, 2 canyon)
//   sprites – up to two roadside objects per band: [type, lateral offset in road half-widths]

export const SEG = 500;

const easeIn = (a, b, p) => a + (b - a) * p * p;
const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);

export const CURVE = { NONE: 0, EASY: 6, MEDIUM: 11, HARD: 17 };
export const HILL = { NONE: 0, LOW: 1800, MEDIUM: 3600, HIGH: 5600 };

// Sprite types (1-based picture numbers in the stamper object).
export const SPRITE = {
  PALM: 1, PALM2: 2, BILLBOARD: 3, SIGN_LEFT: 4, SIGN_RIGHT: 5, ROCK: 6, PINE: 7, CACTUS: 8,
  LAMP: 9, GANTRY: 10, BOARD_ENTRY: 11, BOARD_205: 12, HOUSE: 13, BUSH: 14,
};

export function buildTrack() {
  const bands = [];
  let lastY = 0;
  let theme = 0;
  const add = (enter, hold, leave, curve, hill) => {
    const startY = lastY, endY = startY + hill, total = enter + hold + leave;
    const push = (c, p) => bands.push({ curve: c, y: easeInOut(startY, endY, p), theme, sprites: [] });
    for (let n = 0; n < enter; n++) push(easeIn(0, curve, n / enter), n / total);
    for (let n = 0; n < hold; n++) push(curve, (enter + n) / total);
    for (let n = 0; n < leave; n++) push(easeInOut(curve, 0, n / leave), (enter + hold + n) / total);
    lastY = endY;
  };
  const straight = (n, hill = 0) => add(4, n - 8, 4, 0, hill);
  const curve = (n, c, hill = 0) => add(Math.round(n / 4), n - 2 * Math.round(n / 4), Math.round(n / 4), c, hill);

  // ── Lap layout (~820 bands ≈ 410,000 world units) ─────────────────────────
  theme = 0;                                  // Coconut beach
  straight(40);                               // start / finish straight
  curve(50, CURVE.EASY);                      // gentle right along the sea
  straight(24, HILL.LOW);                     // first rise
  curve(44, -CURVE.MEDIUM, -HILL.LOW);        // sweeping left, downhill
  add(10, 16, 10, CURVE.EASY, 0);             // S-bend
  add(10, 16, 10, -CURVE.EASY, 0);
  straight(30, HILL.MEDIUM);                  // big climb …
  straight(20, -HILL.MEDIUM);                 // … and a blind crest
  theme = 1;                                  // Pine forest
  curve(56, CURVE.MEDIUM, HILL.LOW);          // long right through the trees
  add(6, 10, 6, 0, HILL.LOW);                 // rolling bumps
  add(6, 10, 6, 0, -HILL.LOW);
  add(6, 10, 6, 0, HILL.LOW);
  add(6, 10, 6, 0, -HILL.LOW);
  curve(40, -CURVE.HARD);                     // tight left hairpin
  straight(22);
  curve(36, CURVE.HARD, -HILL.LOW);           // tight right, dropping
  theme = 2;                                  // Sunset canyon
  straight(36, HILL.HIGH);                    // canyon climb
  curve(48, -CURVE.MEDIUM, -HILL.MEDIUM);     // left, plunging
  curve(40, CURVE.EASY, 0);
  add(8, 14, 8, -CURVE.MEDIUM, HILL.LOW);     // chicane
  add(8, 14, 8, CURVE.MEDIUM, -HILL.LOW);
  curve(50, -CURVE.EASY, -HILL.MEDIUM);       // long descent back to the coast
  theme = 0;
  curve(44, CURVE.MEDIUM, 0);                 // final right-hander
  straight(34, -lastY);                       // home straight, back to sea level
  const L = bands.length;

  // ── Roadside scenery ──────────────────────────────────────────────────────
  const rng = mulberry32(20260923);
  bands.forEach((b, i) => {
    const t = b.theme;
    const side = i % 2 ? 1 : -1;
    if (i < 3 || i > L - 3) return;
    if (t === 0) {
      if (i % 3 === 0) b.sprites.push([rng() < 0.5 ? SPRITE.PALM : SPRITE.PALM2, side * (1.55 + rng() * 0.5)]);
      if (i % 11 === 5) b.sprites.push([SPRITE.BUSH, -side * (1.45 + rng() * 0.4)]);
      if (i % 47 === 20) b.sprites = [[SPRITE.HOUSE, (i % 2 ? 1 : -1) * 2.3]];
    } else if (t === 1) {
      if (i % 2 === 0) b.sprites.push([SPRITE.PINE, side * (1.5 + rng() * 0.9)]);
      if (i % 5 === 1) b.sprites.push([SPRITE.PINE, -side * (1.9 + rng() * 1.2)]);
    } else {
      if (i % 4 === 0) b.sprites.push([rng() < 0.6 ? SPRITE.ROCK : SPRITE.CACTUS, side * (1.5 + rng() * 0.8)]);
      if (i % 9 === 3) b.sprites.push([SPRITE.CACTUS, -side * (1.6 + rng() * 0.6)]);
    }
  });
  // Curve warning signs before sharp curves, billboards, lamps near the start.
  for (let i = 8; i < L; i++) {
    const c = bands[i].curve, prev = bands[i - 1].curve;
    if (Math.abs(c) >= CURVE.MEDIUM * 0.95 && Math.abs(prev) < CURVE.MEDIUM * 0.95) {
      for (const k of [6, 4, 2]) {
        const j = i - k;
        if (j > 2) bands[j].sprites = [[c > 0 ? SPRITE.SIGN_RIGHT : SPRITE.SIGN_LEFT, c > 0 ? -1.35 : 1.35]];
      }
    }
  }
  const boards = [[70, SPRITE.BILLBOARD, -1.9], [205, SPRITE.BOARD_205, 1.9], [330, SPRITE.BOARD_ENTRY, -1.9], [470, SPRITE.BILLBOARD, 1.9], [620, SPRITE.BOARD_ENTRY, 1.9], [740, SPRITE.BOARD_205, -1.9]];
  for (const [i, type, x] of boards) if (i < L) bands[i].sprites = [[type, x]];
  for (let i = L - 30; i < L; i += 3) bands[i].sprites = [[SPRITE.LAMP, -1.3], [SPRITE.LAMP, 1.3]];
  for (let i = 3; i < 30; i += 3) bands[i].sprites = [[SPRITE.LAMP, -1.3], [SPRITE.LAMP, 1.3]];
  bands[8].sprites = [[SPRITE.GANTRY, 0]];

  return { bands, L };
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
