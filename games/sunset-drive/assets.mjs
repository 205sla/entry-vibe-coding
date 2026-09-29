// Original vector art for SUNSET DRIVE. make-ent rasterizes every SVG to PNG and embeds it,
// so the .ent needs no network assets. Style: sunset back-light — dark silhouettes, warm rims.
export const svg = (w, h, body, view = `0 0 ${w} ${h}`) => ({
  svgString: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${view}">${body}</svg>`,
  dimension: { width: w, height: h },
  imageType: 'svg',
});
const FONT = "Arial Black, Arial, Malgun Gothic, sans-serif";
const KFONT = "Malgun Gothic, Apple SD Gothic Neo, sans-serif";

// ── Background layers ──────────────────────────────────────────────────────
// Stage is 480×270; layers are drawn at 2× and shown at scale 0.5.
export const sky = () => {
  let stars = '';
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * 960, y = rnd() * 110, r = rnd() * 1.6 + 0.4;
    stars += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#fff" opacity="${(0.25 + rnd() * 0.6 * (1 - y / 110)).toFixed(2)}"/>`;
  }
  const clouds = [
    [120, 96, 300, 9], [700, 80, 360, 10], [430, 128, 260, 7], [40, 150, 220, 6], [820, 140, 200, 6], [560, 176, 320, 5],
  ].map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#ff9ac0" opacity=".32"/><rect x="${x + 30}" y="${y + h * 0.35}" width="${w - 60}" height="${h * 0.4}" rx="${h / 4}" fill="#ffd0a0" opacity=".35"/>`).join('');
  const sunStripes = [0, 1, 2, 3, 4, 5].map((k) => {
    const y = 158 + k * 13, h = 2.5 + k * 1.8;
    return `<rect x="330" y="${y}" width="300" height="${h}" fill="url(#skyg)"/>`;
  }).join('');
  return svg(960, 540, `
    <defs>
      <linearGradient id="skyg" x1="0" y1="0" x2="0" y2="540" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#0e0f33"/><stop offset=".12" stop-color="#231a52"/>
        <stop offset=".22" stop-color="#4a2270"/><stop offset=".30" stop-color="#8a2e72"/>
        <stop offset=".35" stop-color="#d04c6c"/><stop offset=".38" stop-color="#f5824f"/>
        <stop offset=".405" stop-color="#ffc06a"/><stop offset=".425" stop-color="#ffe2a0"/>
        <stop offset=".55" stop-color="#f4b08a"/><stop offset="1" stop-color="#e98a78"/>
      </linearGradient>
      <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff6b8"/><stop offset=".55" stop-color="#ffc85a"/><stop offset="1" stop-color="#ff6f6a"/>
      </linearGradient>
      <radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe7a0" stop-opacity=".75"/><stop offset=".45" stop-color="#ff9a6a" stop-opacity=".25"/><stop offset="1" stop-color="#ff7a6a" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="960" height="540" fill="url(#skyg)"/>
    ${stars}
    <circle cx="480" cy="160" r="250" fill="url(#glow)"/>
    <circle cx="480" cy="150" r="100" fill="url(#sun)"/>
    ${sunStripes}
    ${clouds}`);
};

// Scrolling layers: period 960 stage px, width 1440 → shown at x = offset mod 960 - 480 … see spec.
// Drawn at 1.5× (2160 px wide), shown at scale 1/1.5. Horizon (stage y = 25) sits at layer row HY.
const LS = 1.5, LW = 1440, LH = 200, HY = 110; // layer height 200 stage px, horizon 110 px from top
const ridge = (pts, fill, extra = '') => `<path d="M0 ${LH * LS} ${pts.map(([x, y]) => `L${(x * LS).toFixed(1)} ${(y * LS).toFixed(1)}`).join(' ')} L${LW * LS} ${LH * LS}Z" fill="${fill}" ${extra}/>`;
const periodic = (fn, n) => {
  // generate points over one period (0..960) then repeat for the extra 480 px
  const base = fn();
  const out = [];
  for (const off of [0, 960]) for (const [x, y] of base) if (x + off <= LW + 1) out.push([x + off, y]);
  return out;
};
const noisePts = (seed, step, lo, hi, smooth = 0.5) => {
  let s = seed;
  const rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  const pts = [];
  let y = (lo + hi) / 2;
  for (let x = 0; x <= 960; x += step) {
    y = y * smooth + (lo + rnd() * (hi - lo)) * (1 - smooth);
    pts.push([x, x === 960 ? pts[0][1] : y]);
  }
  return pts;
};
export const farLayer = () => {
  const m1 = periodic(() => noisePts(11, 40, HY - 40, HY - 12, 0.35));
  const m2 = periodic(() => noisePts(29, 32, HY - 24, HY - 4, 0.45));
  return svg(LW * LS, LH * LS, `
    <defs><linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e58f86" stop-opacity="0"/><stop offset="1" stop-color="#e59a82"/></linearGradient>
    <linearGradient id="mA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a4a8e"/><stop offset="1" stop-color="#c0677f"/></linearGradient>
    <linearGradient id="mB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5e2f70"/><stop offset="1" stop-color="#a45a7e"/></linearGradient></defs>
    ${ridge(m1, 'url(#mA)')}
    ${ridge(m2, 'url(#mB)')}
    <rect y="${(HY - 14) * LS}" width="${LW * LS}" height="${14 * LS}" fill="url(#haze)"/>
    <rect y="${HY * LS}" width="${LW * LS}" height="${(LH - HY) * LS}" fill="#e59a82"/>`);
};

// Near layer, one picture per theme (beach, forest, canyon).
export const nearLayer = (theme) => {
  let body = '';
  if (theme === 0) {
    // Sea with the sun's reflection and a few islands / a lighthouse.
    const isl = [[80, 70, 9], [420, 110, 14], [700, 50, 7]].flatMap(([x, w, h]) => [0, 960].map((o) => `<path d="M${(x + o) * LS} ${HY * LS} q${w * LS / 2} ${-h * 2 * LS} ${w * LS} 0Z" fill="#6a3160"/>`)).join('');
    const glints = Array.from({ length: 18 }, (_, k) => {
      const y = HY + 2 + k * 5, w = 30 + k * 7;
      return [0, 960].map((o) => `<rect x="${(480 - w / 2 + o - 480 + 480) * LS}" y="${y * LS}" width="${w * LS}" height="${1.4 * LS}" fill="#ffd79a" opacity="${(0.55 - k * 0.025).toFixed(2)}"/>`).join('');
    }).join('');
    body = `<defs><linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3857e"/><stop offset=".35" stop-color="#b95a7a"/><stop offset="1" stop-color="#6e3a6e"/></linearGradient></defs>
      <rect y="${HY * LS}" width="${LW * LS}" height="${(LH - HY) * LS}" fill="url(#sea)"/>${isl}${glints}
      ${[250, 1210].map((x) => `<rect x="${x * LS}" y="${(HY - 26) * LS}" width="${5 * LS}" height="${26 * LS}" fill="#4a2248"/><rect x="${(x - 1) * LS}" y="${(HY - 30) * LS}" width="${7 * LS}" height="${5 * LS}" fill="#ffe6a0"/>`).join('')}`;
  } else if (theme === 1) {
    // Rolling hills with pine silhouettes.
    const h1 = periodic(() => noisePts(5, 48, HY - 30, HY - 8, 0.5));
    let pines = '';
    let s = 3;
    const rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);
    for (let x = 0; x < 960; x += 11 + rnd() * 10) {
      const h = 10 + rnd() * 16, y = HY - 6 + rnd() * 4;
      for (const o of [0, 960]) if (x + o <= LW) pines += `<path d="M${(x + o) * LS} ${(y - h) * LS} l${4 * LS} ${h * LS} h${-8 * LS}Z" fill="#23233f"/>`;
    }
    body = `${ridge(h1, '#3b2d55')}${pines}<rect y="${(HY - 1) * LS}" width="${LW * LS}" height="${(LH - HY + 1) * LS}" fill="#2c2944"/>`;
  } else {
    // Red canyon mesas.
    const mesa = (x, w, h, c) => [0, 960].map((o) => `<path d="M${(x + o) * LS} ${HY * LS} l${6 * LS} ${-h * LS} h${(w - 12) * LS} l${6 * LS} ${h * LS}Z" fill="${c}"/><rect x="${(x + o + 6) * LS}" y="${(HY - h) * LS}" width="${(w - 12) * LS}" height="${3 * LS}" fill="#f0a060" opacity=".7"/>`).join('');
    body = `${mesa(40, 120, 34, '#8e3b3f')}${mesa(260, 70, 22, '#a3473f')}${mesa(420, 160, 42, '#7d3340')}${mesa(700, 110, 28, '#96413f')}
      <rect y="${HY * LS}" width="${LW * LS}" height="${(LH - HY) * LS}" fill="#8a4640"/>`;
  }
  return svg(LW * LS, LH * LS, body);
};
export const LAYER = { LS, LW, LH, HY };

// ── Roadside sprites (all 512×512, content bottom-centred) ─────────────────
const RIM = '#ffb070', SIL = '#2a1633';
const S = 512;
export const blank = () => svg(4, 4, '');

export const palm = (variant) => {
  // trunk curves toward the crown; fronds are feathered polygons drooping from the crown
  const lean = variant ? -44 : 50;
  const tx = 256 + lean, ty = 118;
  const trunkPts = (side) => Array.from({ length: 13 }, (_, k) => {
    const p = k / 12, y = 512 - p * (512 - ty), x = 257 + lean * Math.pow(p, 1.7) + side * (13 - p * 6);
    return [x, y];
  });
  const L = trunkPts(-1), R = trunkPts(1).reverse();
  const trunk = `<path d="M${L.map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join(' L')} L${R.map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join(' L')}Z" fill="#3a1f35"/>`
    + `<path d="M${trunkPts(1).map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join(' L')}" stroke="${RIM}" stroke-width="3" fill="none" opacity=".75"/>`;
  const rings = Array.from({ length: 14 }, (_, k) => {
    const p = (k + 0.5) / 14, y = 512 - p * (512 - ty), x = 257 + lean * Math.pow(p, 1.7);
    return `<path d="M${(x - 12 + p * 6).toFixed(1)} ${y.toFixed(1)} q${(12 - p * 6).toFixed(1)} 6 ${(24 - p * 12).toFixed(1)} 0" stroke="#1d0f1c" stroke-width="3" fill="none" opacity=".55"/>`;
  }).join('');
  const frond = (ang, len, droop, shade) => {
    const r = (ang * Math.PI) / 180;
    const ex = tx + Math.cos(r) * len, ey = ty - Math.sin(r) * len * 0.45 + droop;
    const cx = tx + Math.cos(r) * len * 0.5, cy = ty - Math.sin(r) * len * 0.45 - 70;
    const pt = (t) => [(1 - t) * (1 - t) * tx + 2 * (1 - t) * t * cx + t * t * ex, (1 - t) * (1 - t) * ty + 2 * (1 - t) * t * cy + t * t * ey];
    const up = [], dn = [];
    const N = 22;
    for (let k = 0; k <= N; k++) {
      const t = k / N, [x, y] = pt(t), [x2, y2] = pt(Math.min(1, t + 0.01)), [x0, y0] = pt(Math.max(0, t - 0.01));
      const dx = x2 - x0, dy = y2 - y0, n = Math.hypot(dx, dy) || 1, nx = -dy / n, ny = dx / n;
      const w = 30 * Math.pow(Math.sin(Math.PI * t), 0.55) * (1 - 0.5 * t);
      const serr = k % 2 ? 1.18 : 0.72;
      up.push([x + nx * w * 0.55, y + ny * w * 0.55]); dn.push([x - nx * w * serr, y - ny * w * serr]);
    }
    const poly = [...up, ...dn.reverse()].map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join(' L');
    const rim = up.map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join(' L');
    return `<path d="M${poly}Z" fill="${shade}"/><path d="M${rim}" stroke="${RIM}" stroke-width="2" fill="none" opacity=".65"/>`;
  };
  const fronds = [[160, 200, 150, '#2a1740'], [205, 170, 160, '#24143a'], [135, 190, 95, '#321b48'], [110, 150, 60, '#2d1944'],
    [80, 150, 70, '#261538'], [52, 185, 110, '#331c4a'], [22, 200, 150, '#2a1740'], [-25, 170, 165, '#24143a'], [95, 120, 20, '#3a2050']]
    .map(([a, l, d, c]) => frond(variant ? 180 - a : a, l, d, c)).join('');
  return svg(S, S, `<ellipse cx="258" cy="506" rx="64" ry="8" fill="#000" opacity=".25"/>${trunk}${rings}${fronds}
    <circle cx="${tx - 9}" cy="${ty + 10}" r="10" fill="#3b2230"/><circle cx="${tx + 9}" cy="${ty + 13}" r="10" fill="#3b2230"/><circle cx="${tx}" cy="${ty + 20}" r="9" fill="#452838"/>`);
};

export const tower = () => svg(S, S, `<ellipse cx="256" cy="506" rx="150" ry="9" fill="#000" opacity=".25"/>
  <path d="M150 512 L 196 250 M362 512 L 316 250 M170 400 H 342 M184 320 H 328" stroke="#3a2a36" stroke-width="12" fill="none"/>
  <path d="M170 400 L 328 320 M342 400 L 184 320" stroke="#3a2a36" stroke-width="6"/>
  <rect x="170" y="180" width="172" height="80" rx="6" fill="#f2efe4"/>
  <rect x="170" y="210" width="172" height="16" fill="#e8484a"/>
  <rect x="188" y="190" width="40" height="30" fill="#2a3a55"/><rect x="284" y="190" width="40" height="30" fill="#2a3a55"/>
  <path d="M150 190 L 256 128 L 362 190Z" fill="#e8484a"/><path d="M150 190 L 256 128 L 362 190" stroke="${RIM}" stroke-width="4" fill="none"/>
  <rect x="246" y="260" width="20" height="140" fill="#6a4a3a"/>
  <path d="M256 128 V 90 L 300 102 L 256 114" fill="#ffd23a"/>`);

export const pine = () => {
  const layers = [0, 1, 2, 3, 4, 5].map((k) => {
    const y = 470 - k * 70, w = 170 - k * 24;
    return `<path d="M256 ${y - 120} L ${256 + w} ${y} L ${256 - w} ${y} Z" fill="${k % 2 ? '#1c2440' : '#222c4a'}"/>
      <path d="M256 ${y - 120} L ${256 + w} ${y}" stroke="${RIM}" stroke-width="3" opacity=".7"/>`;
  }).join('');
  return svg(S, S, `<ellipse cx="256" cy="506" rx="120" ry="8" fill="#000" opacity=".25"/><rect x="244" y="440" width="24" height="72" fill="#2a1a24"/>${layers}`);
};

export const cactus = () => svg(S, S, `<ellipse cx="256" cy="506" rx="70" ry="8" fill="#000" opacity=".25"/>
  <path d="M236 512 V 180 a20 20 0 0 1 40 0 V 512Z" fill="#2c3a2a"/>
  <path d="M236 330 H 190 a18 18 0 0 1 -18 -18 V 240 a14 14 0 0 1 28 0 V 300 H 236Z" fill="#26331f"/>
  <path d="M276 380 H 318 a18 18 0 0 0 18 -18 V 270 a14 14 0 0 0 -28 0 V 350 H 276Z" fill="#26331f"/>
  <path d="M272 185 V 505 M 330 272 V 350" stroke="${RIM}" stroke-width="4" opacity=".75"/>`);

export const rock = () => svg(S, S, `<ellipse cx="256" cy="506" rx="200" ry="10" fill="#000" opacity=".3"/>
  <path d="M60 512 L 90 380 L 170 300 L 280 290 L 380 330 L 450 420 L 470 512Z" fill="#5a2f35"/>
  <path d="M170 300 L 280 290 L 380 330 L 330 360 L 210 350Z" fill="#7a4040"/>
  <path d="M90 380 L 170 300 L 280 290 L 380 330 L 450 420" stroke="${RIM}" stroke-width="5" fill="none" opacity=".8"/>`);

export const bush = () => svg(S, S, `<ellipse cx="256" cy="506" rx="200" ry="10" fill="#000" opacity=".25"/>
  ${[[150, 440, 90], [250, 410, 110], [360, 445, 85], [300, 470, 70], [190, 480, 70]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#24303a"/><path d="M${x - r * 0.7} ${y - r * 0.7} A ${r} ${r} 0 0 1 ${x + r * 0.7} ${y - r * 0.7}" stroke="${RIM}" stroke-width="4" fill="none" opacity=".7"/>`).join('')}
  <rect x="40" y="480" width="432" height="32" fill="#24303a"/>`);

export const lamp = () => svg(S, S, `<rect x="250" y="120" width="12" height="392" fill="#2b2436"/>
  <path d="M256 124 Q 256 96 300 96 H 330" stroke="#2b2436" stroke-width="10" fill="none"/>
  <rect x="316" y="92" width="44" height="14" rx="5" fill="#3a3346"/>
  <ellipse cx="338" cy="108" rx="22" ry="6" fill="#fff4c0"/>
  <circle cx="338" cy="110" r="36" fill="#ffe7a0" opacity=".25"/>
  <rect x="240" y="490" width="32" height="22" fill="#2b2436"/>`);

export const curveSign = (dir) => {
  const chev = [0, 1, 2].map((k) => {
    const x = 160 + k * 72;
    const d = dir > 0 ? `M${x} 230 L ${x + 50} 280 L ${x} 330 L ${x + 26} 330 L ${x + 76} 280 L ${x + 26} 230Z` : `M${x + 76} 230 L ${x + 26} 280 L ${x + 76} 330 L ${x + 50} 330 L ${x} 280 L ${x + 50} 230Z`;
    return `<path d="${d}" fill="#ffd23c"/>`;
  }).join('');
  return svg(S, S, `<rect x="244" y="360" width="24" height="152" fill="#3a3346"/>
    <rect x="120" y="200" width="272" height="160" rx="10" fill="#161320" stroke="#ffd23c" stroke-width="8"/>${chev}`);
};

export const billboard = (kind) => {
  let face = '';
  if (kind === 'sunset') {
    face = `<defs><linearGradient id="bb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#28115a"/><stop offset="1" stop-color="#ff5e7a"/></linearGradient></defs>
      <rect x="40" y="150" width="432" height="200" rx="8" fill="url(#bb)"/>
      <clipPath id="bbc"><rect x="40" y="150" width="432" height="200" rx="8"/></clipPath><g clip-path="url(#bbc)"><circle cx="256" cy="372" r="92" fill="#ffc15a"/>${[0, 1, 2, 3].map((k) => `<rect x="150" y="${318 + k * 9}" width="212" height="${2 + k * 1.5}" fill="#b83d7a"/>`).join('')}</g>
      <text x="256" y="222" text-anchor="middle" font-family="${FONT}" font-size="62" font-style="italic" fill="#fff" stroke="#ff4fa0" stroke-width="3" paint-order="stroke">SUNSET</text>
      <text x="256" y="278" text-anchor="middle" font-family="${FONT}" font-size="48" font-style="italic" fill="#7df9ff" stroke="#1a2a5a" stroke-width="3" paint-order="stroke">DRIVE</text>`;
  } else if (kind === 'entry') {
    face = `<rect x="40" y="150" width="432" height="200" rx="8" fill="#15a36b"/>
      <text x="256" y="252" text-anchor="middle" font-family="${KFONT}" font-weight="bold" font-size="76" fill="#fff">엔트리</text>
      <text x="256" y="316" text-anchor="middle" font-family="${KFONT}" font-weight="bold" font-size="36" fill="#dfffe9">블록으로 달린다!</text>`;
  } else {
    face = `<rect x="40" y="150" width="432" height="200" rx="8" fill="#ffd23c"/>
      <text x="256" y="268" text-anchor="middle" font-family="${FONT}" font-size="110" fill="#e8343f" font-style="italic">205</text>
      <text x="256" y="322" text-anchor="middle" font-family="${KFONT}" font-weight="bold" font-size="34" fill="#301a2a">205와 엔트리</text>`;
  }
  return svg(S, S, `<rect x="110" y="340" width="20" height="172" fill="#2b2436"/><rect x="382" y="340" width="20" height="172" fill="#2b2436"/>
    <rect x="30" y="140" width="452" height="220" rx="12" fill="#1e1a28"/>${face}
    <rect x="30" y="140" width="452" height="220" rx="12" fill="none" stroke="${RIM}" stroke-width="4" opacity=".8"/>`);
};

export const gantry = () => {
  let checks = '';
  for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) if ((x + y) % 2 === 0) checks += `<rect x="${48 + x * 26}" y="${118 + y * 13}" width="26" height="13" fill="#111"/>`;
  return svg(S, S, `<rect x="16" y="90" width="28" height="422" fill="#3a3346"/><rect x="468" y="90" width="28" height="422" fill="#3a3346"/>
    <rect x="16" y="90" width="480" height="84" fill="#f4f0e6"/>${checks}
    <rect x="16" y="144" width="480" height="30" fill="#e8343f"/>
    <text x="256" y="168" text-anchor="middle" font-family="${FONT}" font-size="26" fill="#fff" font-style="italic">START · FINISH</text>
    <rect x="16" y="90" width="480" height="84" fill="none" stroke="${RIM}" stroke-width="3"/>
    ${[60, 120, 392, 452].map((x) => `<circle cx="${x}" cy="104" r="7" fill="#ff5a5a"/>`).join('')}`);
};

// ── Cars ───────────────────────────────────────────────────────────────────
// Rival car, rear view, 256×256 canvas, body ~200 px wide at the bottom.
// view: -1 = seen from its left side (car is right of screen centre), 0 centre, 1 = from right.
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
};
export const rivalCar = (color, view, style = 0) => {
  const hi = shade(color, 0.35), dk = shade(color, -0.35), dk2 = shade(color, -0.6);
  const o = view * 10; // roof shift toward the far side
  const side = view === 0 ? '' : view > 0
    ? `<path d="M228 196 L 244 186 L 246 236 L 228 240Z" fill="${dk}"/><rect x="234" y="226" width="14" height="22" rx="4" fill="#111"/>`
    : `<path d="M28 196 L 12 186 L 10 236 L 28 240Z" fill="${dk}"/><rect x="8" y="226" width="14" height="22" rx="4" fill="#111"/>`;
  const roof = style === 1
    ? `<path d="M${74 + o} 150 L ${88 + o} 118 L ${168 + o} 118 L ${182 + o} 150Z" fill="${dk2}"/><path d="M${80 + o} 150 L ${92 + o} 124 L ${164 + o} 124 L ${176 + o} 150Z" fill="#1b2433"/>`
    : `<path d="M${66 + o} 158 L ${86 + o} 124 L ${170 + o} 124 L ${190 + o} 158Z" fill="${dk2}"/><path d="M${74 + o} 156 L ${91 + o} 130 L ${165 + o} 130 L ${182 + o} 156Z" fill="#162030"/><path d="M${96 + o} 134 L ${140 + o} 134" stroke="#8fb6d8" stroke-width="3" opacity=".6"/>`;
  return svg(256, 256, `
    <ellipse cx="128" cy="246" rx="118" ry="10" fill="#000" opacity=".35"/>
    ${side}
    <rect x="22" y="218" width="36" height="32" rx="6" fill="#121015"/><rect x="198" y="218" width="36" height="32" rx="6" fill="#121015"/>
    ${roof}
    <path d="M28 162 Q 128 146 228 162 L 234 222 Q 128 232 22 222Z" fill="${color}"/>
    <path d="M28 162 Q 128 146 228 162 L 229 172 Q 128 158 27 172Z" fill="${hi}"/>
    ${style === 1 ? `<rect x="30" y="150" width="196" height="8" rx="3" fill="${dk2}"/><rect x="40" y="156" width="6" height="10" fill="${dk2}"/><rect x="210" y="156" width="6" height="10" fill="${dk2}"/>` : ''}
    <rect x="34" y="184" width="56" height="16" rx="5" fill="#ff2a3a"/><rect x="166" y="184" width="56" height="16" rx="5" fill="#ff2a3a"/>
    <rect x="38" y="187" width="48" height="5" rx="2" fill="#ffb0b0" opacity=".8"/><rect x="170" y="187" width="48" height="5" rx="2" fill="#ffb0b0" opacity=".8"/>
    <rect x="100" y="190" width="56" height="20" rx="3" fill="#f2f2e8"/><rect x="104" y="194" width="48" height="12" fill="#d8d8cc"/>
    <path d="M24 212 Q 128 222 232 212 L 233 224 Q 128 234 23 224Z" fill="${dk}"/>
    <rect x="60" y="222" width="18" height="7" rx="3" fill="#555"/><rect x="178" y="222" width="18" height="7" rx="3" fill="#555"/>`);
};

// Player convertible, rear view, 320×200. steer: -1 left, 0, 1 right. brake: lights on.
export const playerCar = (steer, brake) => {
  const tilt = steer * 3; // degrees
  const sx = steer * 7;
  const light = brake ? '#ff3040' : '#b0141f';
  const glow = brake ? `<ellipse cx="72" cy="120" rx="46" ry="18" fill="#ff4050" opacity=".35"/><ellipse cx="248" cy="120" rx="46" ry="18" fill="#ff4050" opacity=".35"/>` : '';
  const side = steer === 0 ? '' : steer < 0
    ? `<path d="M300 92 L 314 86 L 316 150 L 300 156Z" fill="#8c0c14"/><rect x="302" y="146" width="16" height="36" rx="5" fill="#111"/>`
    : `<path d="M20 92 L 6 86 L 4 150 L 20 156Z" fill="#8c0c14"/><rect x="2" y="146" width="16" height="36" rx="5" fill="#111"/>`;
  const slats = Array.from({ length: 6 }, (_, k) => `<rect x="92" y="${104 + k * 7}" width="136" height="3.5" rx="1.5" fill="#151015"/>`).join('');
  return svg(320, 200, `<g transform="rotate(${tilt} 160 150)">
    <ellipse cx="160" cy="190" rx="150" ry="10" fill="#000" opacity=".4"/>
    ${side}
    <rect x="18" y="138" width="54" height="52" rx="9" fill="#141116"/><rect x="248" y="138" width="54" height="52" rx="9" fill="#141116"/>
    <rect x="22" y="146" width="46" height="6" rx="2" fill="#2a2630"/><rect x="252" y="146" width="46" height="6" rx="2" fill="#2a2630"/>
    <!-- occupants -->
    <path d="M${96 + sx} 70 q 0 -22 22 -22 q 22 0 22 22 v 16 h -44Z" fill="#2a1a18"/>
    <circle cx="${118 + sx}" cy="50" r="17" fill="#3a2418"/>
    <path d="M${178 + sx} 72 q 0 -22 22 -22 q 22 0 22 22 v 14 h -44Z" fill="#c23a5a"/>
    <path d="M${182 + sx} 48 q 18 -18 40 -2 q 14 8 26 2 q -6 14 -24 12 q -20 0 -42 -12Z" fill="#ffd66a"/>
    <circle cx="${200 + sx}" cy="50" r="15" fill="#ffcf5a"/>
    <path d="M${60} 84 Q 160 64 260 84 L 266 96 Q 160 80 54 96Z" fill="#1c1418"/>
    <!-- body -->
    <path d="M14 96 Q 160 76 306 96 L 312 168 Q 160 182 8 168Z" fill="#e5202e"/>
    <path d="M16 96 Q 160 76 304 96 L 306 108 Q 160 90 14 108Z" fill="#ff6a70"/>
    <path d="M12 150 Q 160 164 308 150 L 310 170 Q 160 184 10 170Z" fill="#a5101b"/>
    <rect x="86" y="100" width="148" height="46" rx="4" fill="#26181c"/>${slats}
    ${glow}
    <rect x="30" y="112" width="52" height="16" rx="4" fill="${light}"/><rect x="238" y="112" width="52" height="16" rx="4" fill="${light}"/>
    <rect x="34" y="115" width="44" height="4" rx="2" fill="#ffc0c0" opacity="${brake ? 0.95 : 0.5}"/><rect x="242" y="115" width="44" height="4" rx="2" fill="#ffc0c0" opacity="${brake ? 0.95 : 0.5}"/>
    <rect x="132" y="150" width="56" height="18" rx="3" fill="#f4f2e8"/><text x="160" y="164" text-anchor="middle" font-family="${FONT}" font-size="13" fill="#222">ENTRY</text>
    <rect x="96" y="166" width="20" height="8" rx="3" fill="#777"/><rect x="204" y="166" width="20" height="8" rx="3" fill="#777"/>
  </g>`);
};

// Dust / smoke puffs behind the wheels (3 animation frames), 320×200 to overlay the car.
export const smoke = (frame) => {
  const puffs = [[46, 176], [274, 176], [30, 160], [290, 160]];
  return svg(320, 200, puffs.map(([x, y], k) => {
    const r = 12 + ((k + frame) % 3) * 6 + frame * 3;
    return `<circle cx="${x + (k % 2 ? 1 : -1) * frame * 8}" cy="${y - frame * 5}" r="${r}" fill="#f2eef6" opacity="${(0.6 - frame * 0.15).toFixed(2)}"/>`;
  }).join(''));
};
export const dust = (frame) => {
  const puffs = [[40, 172], [280, 172], [20, 150], [300, 150], [60, 150], [260, 150]];
  return svg(320, 200, puffs.map(([x, y], k) => {
    const r = 14 + ((k + frame) % 3) * 7;
    return `<circle cx="${x + (k % 2 ? 1 : -1) * frame * 6}" cy="${y - frame * 6}" r="${r}" fill="#d8b89a" opacity="${(0.55 - frame * 0.12).toFixed(2)}"/>`;
  }).join(''));
};

// ── HUD ────────────────────────────────────────────────────────────────────
// Arcade digits: 64×64 canvas each (glyph ~40 wide), orange-yellow gradient with dark outline.
const DIG = (ch, color1 = '#fff27a', color2 = '#ff8a2a') => svg(64, 64, `
  <defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color1}"/><stop offset="1" stop-color="${color2}"/></linearGradient></defs>
  <text x="32" y="54" text-anchor="middle" font-family="${FONT}" font-size="58" font-style="italic" fill="url(#d)" stroke="#2a0f24" stroke-width="5" paint-order="stroke">${ch}</text>`);
export const digit = (d) => DIG(String(d));
export const digitMark = (ch) => DIG(ch);
export const digitCool = (d) => DIG(String(d), '#e8fbff', '#5fd8ff');

// Static HUD labels (480×270 overlay at 2×).
export const hudFrame = () => svg(960, 540, `
  <defs><linearGradient id="pn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a0c2e" stop-opacity=".72"/><stop offset="1" stop-color="#1a0c2e" stop-opacity=".35"/></linearGradient></defs>
  <path d="M0 0 H 360 L 330 104 H 0Z" fill="url(#pn)"/>
  <path d="M960 0 H 700 L 730 84 H 960Z" fill="url(#pn)"/>
  <path d="M960 540 H 640 L 680 440 H 960Z" fill="url(#pn)"/>
  <text x="18" y="36" font-family="${FONT}" font-size="26" font-style="italic" fill="#7df9ff">TIME</text>
  <text x="18" y="88" font-family="${FONT}" font-size="20" font-style="italic" fill="#ffb3d9">BEST</text>
  <text x="740" y="34" font-family="${FONT}" font-size="22" font-style="italic" fill="#7df9ff">LAP</text>
  <text x="740" y="72" font-family="${FONT}" font-size="22" font-style="italic" fill="#7df9ff">POS</text>
  <text x="886" y="72" font-family="${FONT}" font-size="30" font-style="italic" fill="#ffe28a">/8</text>
  <text x="886" y="34" font-family="${FONT}" font-size="30" font-style="italic" fill="#ffe28a">/3</text>
  <text x="872" y="528" font-family="${FONT}" font-size="22" font-style="italic" fill="#7df9ff">km/h</text>
  <text x="30" y="500" font-family="${FONT}" font-size="17" font-style="italic" fill="#ffb3d9">COURSE</text>`);

// Big centred banners (countdown, lap, finish) 480×160 each at 2×.
const banner = (text, c1, c2, size = 150, sub = '') => svg(960, 320, `
  <defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <text x="480" y="${sub ? 190 : 220}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-style="italic" fill="url(#b)" stroke="#2a0f24" stroke-width="12" paint-order="stroke">${text}</text>
  ${sub ? `<text x="480" y="280" text-anchor="middle" font-family="${KFONT}" font-weight="bold" font-size="46" fill="#fff" stroke="#2a0f24" stroke-width="8" paint-order="stroke">${sub}</text>` : ''}`);
export const banners = () => [
  ['b3', banner('3', '#fff27a', '#ff5a3a', 230)],
  ['b2', banner('2', '#fff27a', '#ff5a3a', 230)],
  ['b1', banner('1', '#fff27a', '#ff5a3a', 230)],
  ['bgo', banner('GO!', '#baffc9', '#1fd17a', 210)],
  ['blap2', banner('LAP 2', '#e8fbff', '#5fd8ff', 150)],
  ['bfinal', banner('FINAL LAP', '#ffe0f0', '#ff4fa0', 130)],
  ['bfinish', banner('FINISH!', '#fff27a', '#ff8a2a', 170)],
  ['bpause', banner('PAUSE', '#e8fbff', '#5fd8ff', 150, 'P 키로 계속')],
];

// Title logo 480×200 at 2×.
export const logo = () => svg(960, 400, `
  <defs>
    <linearGradient id="t1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6c0"/><stop offset=".5" stop-color="#ffb347"/><stop offset=".52" stop-color="#ff5f8a"/><stop offset="1" stop-color="#b0247a"/></linearGradient>
    <linearGradient id="t2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8fdff"/><stop offset="1" stop-color="#3fc8ff"/></linearGradient>
  </defs>
  <text x="480" y="170" text-anchor="middle" font-family="${FONT}" font-size="150" font-style="italic" fill="url(#t1)" stroke="#2a0f24" stroke-width="14" paint-order="stroke" letter-spacing="4">SUNSET</text>
  <text x="520" y="300" text-anchor="middle" font-family="${FONT}" font-size="120" font-style="italic" fill="url(#t2)" stroke="#12203a" stroke-width="12" paint-order="stroke" letter-spacing="8">DRIVE</text>
  <rect x="160" y="320" width="640" height="6" fill="#ff5fa2"/>
  <text x="480" y="378" text-anchor="middle" font-family="${KFONT}" font-weight="bold" font-size="40" fill="#fff" stroke="#2a0f24" stroke-width="7" paint-order="stroke">엔트리 블록만으로 달리는 3D 레이싱</text>`);

export const pressStart = () => svg(960, 160, `
  <text x="480" y="70" text-anchor="middle" font-family="${FONT}" font-size="52" font-style="italic" fill="#fff27a" stroke="#2a0f24" stroke-width="9" paint-order="stroke">PRESS SPACE</text>
  <text x="480" y="116" text-anchor="middle" font-family="${KFONT}" font-weight="bold" font-size="28" fill="#fff" stroke="#2a0f24" stroke-width="7" paint-order="stroke">← → 핸들   ↑ 가속   ↓ 브레이크   3바퀴 레이스</text>`);

// Results panel (static text); numbers are stamped by the HUD object.
export const resultsPanel = (isRecord) => svg(960, 540, `
  <rect x="190" y="70" width="580" height="400" rx="22" fill="#12081f" opacity=".82" stroke="#ff5fa2" stroke-width="5"/>
  <text x="480" y="140" text-anchor="middle" font-family="${FONT}" font-size="58" font-style="italic" fill="#fff27a" stroke="#2a0f24" stroke-width="8" paint-order="stroke">RESULT</text>
  <text x="240" y="222" font-family="${FONT}" font-size="30" font-style="italic" fill="#7df9ff">POSITION</text>
  <text x="240" y="282" font-family="${FONT}" font-size="30" font-style="italic" fill="#7df9ff">TOTAL</text>
  <text x="240" y="342" font-family="${FONT}" font-size="30" font-style="italic" fill="#ffb3d9">BEST LAP</text>
  <text x="240" y="402" font-family="${FONT}" font-size="30" font-style="italic" fill="#c9b8ff">RECORD</text>
  <text x="480" y="452" text-anchor="middle" font-family="${KFONT}" font-weight="bold" font-size="28" fill="#fff">스페이스바: 다시 달리기   R: 타이틀</text>
  ${isRecord ? `<g transform="rotate(-8 700 120)"><rect x="600" y="92" width="230" height="54" rx="10" fill="#ff2f7a"/><text x="715" y="132" text-anchor="middle" font-family="${FONT}" font-size="30" font-style="italic" fill="#fff27a">NEW RECORD!</text></g>` : ''}`);

// Ordinal place pictures for the results / HUD (1ST … 8TH).
export const places = () => ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH'].map((t, k) =>
  svg(256, 96, `<defs><linearGradient id="pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${k === 0 ? '#fff6b0' : '#e8fbff'}"/><stop offset="1" stop-color="${k === 0 ? '#ffb020' : '#5fd8ff'}"/></linearGradient></defs>
  <text x="128" y="78" text-anchor="middle" font-family="${FONT}" font-size="76" font-style="italic" fill="url(#pl)" stroke="#2a0f24" stroke-width="8" paint-order="stroke">${t}</text>`));
