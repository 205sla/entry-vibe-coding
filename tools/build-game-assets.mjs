#!/usr/bin/env node
// Phase A — public/images/game/ 정적 라이브러리 생성기.
//
// sprite-gen 으로 자주 쓰는 게임 자산을 프리셋으로 동결. fixture 에서 경로로 참조.
//   const ball = '/images/game/ball-blue.svg';
//
// 새 변형이 필요하면:
//   1. 이 파일에 항목 추가
//   2. `node tools/build-game-assets.mjs` 실행
//   3. 결과는 public/images/game/<name>.svg + manifest.json
//
// 정적 vs 생성기:
//   - 정적 (이 라이브러리): 자주 쓰는 색·크기 조합. 경로 한 줄로 참조.
//   - 생성기 (sprite-gen): 임의 변형. 콘텐츠 해시로 dedup.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import * as gen from './lib/sprite-gen.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'images', 'game');

// 자산 카탈로그 — 의미 있는 이름 → 생성기 호출.
// 새 변형 추가 시 여기에 한 줄.
const CATALOG = {
    // 공
    'ball-blue':   () => gen.shadedBall(20, '#3b82f6'),
    'ball-red':    () => gen.shadedBall(20, '#ef4444'),
    'ball-yellow': () => gen.shadedBall(20, '#facc15'),

    // 벽돌 (Breakout 표준)
    'brick-red':    () => gen.beveledBrick(50, 18, '#ef4444'),
    'brick-orange': () => gen.beveledBrick(50, 18, '#f59e0b'),
    'brick-green':  () => gen.beveledBrick(50, 18, '#10b981'),
    'brick-blue':   () => gen.beveledBrick(50, 18, '#3b82f6'),

    // 패들
    'paddle-blue':  () => gen.rect(80, 12, '#3b82f6', { rx: 4 }),
    'paddle-green': () => gen.rect(80, 12, '#10b981', { rx: 4 }),

    // HUD / 상태
    'heart':       () => gen.heart(24, '#ef4444'),
    'star':        () => gen.star(20, 9, 5, '#facc15'),
    'coin':        () => gen.ring(14, 5, '#facc15'),

    // 적 / 캐릭터
    'enemy-spike': () => gen.star(16, 5, 8, '#dc2626'),
    'enemy-bomb':  () => gen.shadedBall(14, '#1f2937'),

    // 발사체
    'bullet-blue':  () => gen.circle(5, '#3b82f6'),
    'bullet-red':   () => gen.circle(5, '#ef4444'),

    // 배경 데코
    'tile-purple':  () => gen.regularPolygon(6, 22, '#a78bfa'),
    'tile-cyan':    () => gen.regularPolygon(6, 22, '#22d3ee'),

    // 과일 — fruit-hunt 게임용. 색만 다른 그라데이션 공.
    'fruit-apple':      () => gen.shadedBall(22, '#dc2626'),  // 빨강
    'fruit-banana':     () => gen.shadedBall(22, '#facc15'),  // 노랑
    'fruit-grape':      () => gen.shadedBall(22, '#9333ea'),  // 보라
    'fruit-orange':     () => gen.shadedBall(22, '#fb923c'),  // 주황
    'fruit-watermelon': () => gen.shadedBall(22, '#16a34a'),  // 진초록
};

fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest = {};
let written = 0;
for (const [name, factory] of Object.entries(CATALOG)) {
    const out = factory();
    const filename = `${name}.svg`;
    const fullPath = path.join(OUT_DIR, filename);
    fs.writeFileSync(fullPath, out.svgString, 'utf8');
    manifest[name] = {
        path: `/images/game/${filename}`,
        dimension: out.dimension,
    };
    written++;
}

fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
);

console.log(`[build-game-assets] wrote ${written} SVGs + manifest.json → ${OUT_DIR}`);
