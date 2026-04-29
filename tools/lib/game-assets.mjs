// Phase A — public/images/game/ 정적 라이브러리 색인.
//
// `assets('ball-blue')` 으로 의미 있는 이름 → fileurl 경로 변환.
// manifest.json (build-game-assets 가 생성) 을 한 번 읽어서 캐시.
//
// 사용 예:
//   import { assets } from './lib/game-assets.mjs';
//   obj('ball', '공', { picture: assets('ball-blue') });
//
// 카탈로그에 없는 이름이면 throw — 오타 조기 발견. 동적 변형이 필요하면 sprite-gen 직접 호출.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, '..', '..', 'public', 'images', 'game', 'manifest.json');

let _manifest = null;
function loadManifest() {
    if (_manifest) return _manifest;
    if (!fs.existsSync(MANIFEST_PATH)) {
        throw new Error(
            `game-assets manifest 없음: ${MANIFEST_PATH}\n` +
            `먼저 \`node tools/build-game-assets.mjs\` 실행.`
        );
    }
    _manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    return _manifest;
}

// 의미 있는 이름 → picture 객체 ({ fileurl, dimension, imageType }).
// obj() / pictures: [] 에 그대로 전달 가능.
//
//   assets('ball-blue')   → { fileurl: '/images/game/ball-blue.svg', dimension: {w,h}, imageType: 'svg' }
//   assets('brick-red')   → ...
export function assets(name, opts = {}) {
    const m = loadManifest();
    const entry = m[name];
    if (!entry) {
        const known = Object.keys(m).slice(0, 8).join(', ') + (Object.keys(m).length > 8 ? ', ...' : '');
        throw new Error(
            `game-assets: '${name}' 없음. 알려진 이름: ${known}.\n` +
            `새 변형 필요하면 tools/build-game-assets.mjs 의 CATALOG 에 추가 + 재실행.`
        );
    }
    return {
        id: opts.id,
        name: opts.name || name,
        fileurl: entry.path,
        dimension: opts.dimension || entry.dimension,
        imageType: 'svg',
    };
}

// 카탈로그에 등록된 모든 이름 반환 — 디버깅 / 자동완성 용.
export function listAssets() {
    return Object.keys(loadManifest());
}
