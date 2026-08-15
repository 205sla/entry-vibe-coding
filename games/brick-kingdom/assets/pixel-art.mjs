// 픽셀아트 생성기 — 문자 그리드를 SVG 로 변환.
//
// sprite-gen.mjs 는 기하 도형(원·사각·별) 전용이라 캐릭터 스프라이트를 못 만든다.
// 여기서는 NES 시대 감성의 도트 그림을 **문자 그리드**로 직접 찍는다.
//
//   const HERO = px(['..aa..', '.abba.'], { a: '#c87137', b: '#2a9d8f' });
//
// 각 문자 = 픽셀 1 개. '.' 과 ' ' 는 투명. 나머지는 palette 의 색.
// 반환 형식은 sprite-gen 과 동일한 `{ svgString, dimension, imageType }` 이라
// DSL `picture:` / `pictures: []` 에 그대로 넣을 수 있다 (make-ent 가 해시 dedup).
//
// SCALE=1 로 두고 엔트리 쪽 scaleX/scaleY 로 확대하면 보간 때문에 도트가 흐려지므로,
// **SVG 단계에서 정수배 확대**한다 (픽셀당 SCALE×SCALE 사각형) → 항상 선명한 도트.

const SCALE = 3;          // 1 도트 = 3×3 SVG 단위 (16 도트 → 48px)
const TRANSPARENT = new Set(['.', ' ']);

/**
 * 문자 그리드 → SVG 픽셀아트.
 * @param {string[]} rows  각 행의 문자열 (모두 같은 길이 권장, 짧으면 투명 취급)
 * @param {Record<string,string>} palette  문자 → CSS 색
 * @param {{scale?: number}} [opts]
 */
export function px(rows, palette, opts = {}) {
    const scale = opts.scale || SCALE;
    const h = rows.length;
    const w = Math.max(...rows.map(r => r.length));

    // 같은 색이 가로로 이어지면 한 <rect> 로 합친다 (run-length) — SVG 크기 절감.
    // 도트 그림은 수평 런이 길어서 효과가 크다 (16×16 기준 rect 수 절반 이하).
    const parts = [];
    for (let y = 0; y < h; y++) {
        const row = rows[y];
        let x = 0;
        while (x < w) {
            const ch = row[x];
            if (ch === undefined || TRANSPARENT.has(ch)) { x++; continue; }
            const color = palette[ch];
            if (!color) throw new Error(`px(): palette 에 '${ch}' 없음 (row ${y}, col ${x})`);
            let run = 1;
            while (x + run < w && row[x + run] === ch) run++;
            parts.push(`<rect x="${x * scale}" y="${y * scale}" width="${run * scale}" height="${scale}" fill="${color}"/>`);
            x += run;
        }
    }

    const width = w * scale, height = h * scale;
    return {
        svgString:
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
            `width="${width}" height="${height}" shape-rendering="crispEdges">${parts.join('')}</svg>`,
        dimension: { width, height },
        imageType: 'svg',
    };
}

/** 좌우 반전 그리드 (걷기 방향용 — 엔트리 flipX 대신 별 모양으로 두면 stamp 에도 적용됨) */
export function mirror(rows) {
    return rows.map(r => r.split('').reverse().join(''));
}

/** 단색 꽉 찬 타일 — 배경/디버그용 */
export function solid(size, color, scale = SCALE) {
    return px(Array.from({ length: size }, () => 'x'.repeat(size)), { x: color }, { scale });
}
