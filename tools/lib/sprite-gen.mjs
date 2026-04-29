// SVG primitive generators — game 공통 기하 도형을 inline SVG 문자열로 생성.
//
// 각 함수는 `{ svgString, dimension: {width, height}, imageType: 'svg' }` 반환.
// DSL `obj()` 의 `picture:` 또는 spec 의 `pictures: []` 항목에 그대로 전달.
//
// make-ent 가 svgString 을 발견하면 콘텐츠 해시로 dedup 한 뒤 tar 에 번들 →
// 같은 모양·색을 여러 곳에서 호출해도 .ent 안에는 한 번만 들어감.
//
// 사용 예:
//   import * as gen from './lib/sprite-gen.mjs';
//   obj('ball', '공', { picture: gen.circle(20, '#3b82f6') });
//   obj('brick', '벽돌', { picture: gen.rect(44, 16, '#ef4444', { rx: 2 }) });
//
// 모든 도형은 viewBox 사방에 PAD 픽셀 여유 — anti-aliasing 안전.

const PAD = 2;

function svg(width, height, body) {
    return {
        svgString:
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
            `width="${width}" height="${height}">${body}</svg>`,
        dimension: { width, height },
        imageType: 'svg',
    };
}

function strokeAttr({ stroke, strokeWidth = 1 }) {
    return stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : '';
}

// ── Basic shapes ─────────────────────────────────────────────────

// 원. radius 만, fill 색.
//   gen.circle(20, '#3b82f6')
//   gen.circle(15, '#ef4444', { stroke: '#fff', strokeWidth: 2 })
export function circle(radius, fill = '#000', opts = {}) {
    const d = (radius + PAD) * 2;
    const cx = d / 2;
    return svg(d, d,
        `<circle cx="${cx}" cy="${cx}" r="${radius}" fill="${fill}"${strokeAttr(opts)}/>`);
}

// 사각형 (옵션 둥근 모서리 rx).
//   gen.rect(44, 16, '#ef4444')
//   gen.rect(80, 12, '#3b82f6', { rx: 6 })
export function rect(width, height, fill = '#000', opts = {}) {
    const { rx = 0 } = opts;
    const w = width + PAD * 2, h = height + PAD * 2;
    return svg(w, h,
        `<rect x="${PAD}" y="${PAD}" width="${width}" height="${height}" ` +
        `rx="${rx}" fill="${fill}"${strokeAttr(opts)}/>`);
}

// 도넛/링 — outer/inner 반경.
export function ring(radiusOuter, radiusInner, fill = '#000') {
    const d = (radiusOuter + PAD) * 2;
    const cx = d / 2;
    // even-odd 채움으로 가운데 구멍.
    const path =
        `M ${cx - radiusOuter} ${cx} a ${radiusOuter} ${radiusOuter} 0 1 0 ${radiusOuter * 2} 0 ` +
        `a ${radiusOuter} ${radiusOuter} 0 1 0 ${-radiusOuter * 2} 0 ` +
        `M ${cx - radiusInner} ${cx} a ${radiusInner} ${radiusInner} 0 1 0 ${radiusInner * 2} 0 ` +
        `a ${radiusInner} ${radiusInner} 0 1 0 ${-radiusInner * 2} 0`;
    return svg(d, d, `<path d="${path}" fill="${fill}" fill-rule="evenodd"/>`);
}

// 정 N 각형.
export function regularPolygon(sides, radius, fill = '#000', opts = {}) {
    const { rotation = 0 } = opts;
    const d = (radius + PAD) * 2;
    const cx = d / 2;
    const pts = [];
    for (let i = 0; i < sides; i++) {
        const a = rotation + (Math.PI * 2 * i) / sides - Math.PI / 2;
        pts.push(`${(cx + radius * Math.cos(a)).toFixed(2)},${(cx + radius * Math.sin(a)).toFixed(2)}`);
    }
    return svg(d, d, `<polygon points="${pts.join(' ')}" fill="${fill}"${strokeAttr(opts)}/>`);
}

export const triangle = (r, fill, opts) => regularPolygon(3, r, fill, opts);
export const pentagon = (r, fill, opts) => regularPolygon(5, r, fill, opts);
export const hexagon  = (r, fill, opts) => regularPolygon(6, r, fill, opts);

// 별 (꼭짓점 N).
//   gen.star(20, 8, 5, '#facc15')   // 외 20, 내 8, 5 꼭짓점
export function star(rOuter, rInner = rOuter * 0.45, points = 5, fill = '#000') {
    const d = (rOuter + PAD) * 2;
    const cx = d / 2;
    const pts = [];
    for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? rOuter : rInner;
        const a = (Math.PI * 2 * i) / (points * 2) - Math.PI / 2;
        pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cx + r * Math.sin(a)).toFixed(2)}`);
    }
    return svg(d, d, `<polygon points="${pts.join(' ')}" fill="${fill}"/>`);
}

// 하트.
export function heart(size, fill = '#ef4444') {
    const d = size + PAD * 2;
    const cx = d / 2;
    const top = PAD + size * 0.25;
    const bottom = PAD + size * 0.85;
    // 두 개의 베지어 곡선으로 양쪽 곡면 + 아래 점.
    const path =
        `M ${cx} ${bottom} ` +
        `C ${PAD - size * 0.1} ${PAD + size * 0.4}, ${PAD + size * 0.05} ${PAD - size * 0.05}, ${cx} ${top} ` +
        `C ${d - PAD - size * 0.05} ${PAD - size * 0.05}, ${d - PAD + size * 0.1} ${PAD + size * 0.4}, ${cx} ${bottom} Z`;
    return svg(d, d, `<path d="${path}" fill="${fill}"/>`);
}

// ── Composite / decorated ────────────────────────────────────────

// 그라데이션 공 — radial gradient 로 입체감.
//   gen.shadedBall(20, '#3b82f6')
export function shadedBall(radius, fill = '#3b82f6') {
    const d = (radius + PAD) * 2;
    const cx = d / 2;
    const id = `g${Math.abs(hashStr(fill + radius)).toString(36).slice(0, 6)}`;
    return svg(d, d,
        `<defs><radialGradient id="${id}" cx="35%" cy="35%" r="65%">` +
        `<stop offset="0%" stop-color="#fff" stop-opacity="0.7"/>` +
        `<stop offset="100%" stop-color="${fill}" stop-opacity="1"/>` +
        `</radialGradient></defs>` +
        `<circle cx="${cx}" cy="${cx}" r="${radius}" fill="url(#${id})"/>`);
}

// 입체 벽돌 — 위쪽 highlight + 아래쪽 shadow.
export function beveledBrick(width, height, fill = '#ef4444') {
    const w = width + PAD * 2, h = height + PAD * 2;
    const id = `g${Math.abs(hashStr(fill + width + height)).toString(36).slice(0, 6)}`;
    return svg(w, h,
        `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0%" stop-color="#fff" stop-opacity="0.5"/>` +
        `<stop offset="60%" stop-color="${fill}" stop-opacity="1"/>` +
        `<stop offset="100%" stop-color="#000" stop-opacity="0.2"/>` +
        `</linearGradient></defs>` +
        `<rect x="${PAD}" y="${PAD}" width="${width}" height="${height}" ` +
        `rx="2" fill="url(#${id})"/>`);
}

// ── Internal: deterministic non-crypto hash ──────────────────────
// Used only for unique gradient ids. Same input → same id.
function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    return h | 0;
}
