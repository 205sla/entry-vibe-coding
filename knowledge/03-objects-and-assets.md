# 오브젝트 · Entity · Picture · Sound

## Object

공식 [object-data typedef](https://github.com/entrylabs/docs/blob/master/source/entryjs/typedef/2024-03-15-object-data.md):

```json
{
  "id": "abcd",
  "name": "객체1",
  "text": "안녕",                   // objectType='textBox'일 때만
  "script": "[[...]]",              // JSON.stringify된 문자열
  "selectedPictureId": "pic1",      // pictures[*].id 중 하나
  "objectType": "sprite",           // sprite | textBox
  "rotateMethod": "free",           // free | vertical | none
  "scene": "ab12",                  // scenes[*].id 중 하나
  "sprite": { "pictures": [...], "sounds": [...] },
  "entity": { ... },
  "lock": false
}
```

### textBox 오브젝트

`objectType: "textBox"`일 때:
- `text` 필드에 표시할 문자열
- `sprite.pictures`는 보통 비어있거나 무시됨
- `entity.font` (예: `"20px NanumGothic"`)로 글꼴·크기 지정 — 공백만 있는 `"undefinedpx "`는 sprite 관례
- `entity.bgColor` 는 hex(`'#xxxxxx'`) 일 때만 사각 전체 클릭 — 투명이면 글자(glyph) 픽셀만 hit. 자세한 건 [`07-runtime-quirks.md` textBox 클릭 영역](07-runtime-quirks.md#textbox-클릭-영역--bgcolor-에-따라-사각-전체-vs-glyph-픽셀만)
- 썸네일은 `text_icon_ko.svg` / `text_icon.svg` 자동 사용 ([`object.js:240-243`](../../../upstream/entryjs/src/class/object.js#L240))

make-ent 는 `objectType: "textBox"` + `text` 필드를 자동 emit (sprite 와 달리 picture 불필요).
DSL `obj()` 는 `text`, `entity.bgColor` 등을 그대로 통과 — 사용 예: [`tests/fixtures/spec-name-loop.mjs`](../tests/fixtures/spec-name-loop.mjs).
버튼 패턴은 [`04-script-and-blocks.md` 버튼 구현](04-script-and-blocks.md#버튼-구현--textbox-가-sprite--dialog-보다-깔끔) 참조.

### 키 순서 관찰 (레퍼런스 기준)

playentry.org 출력 기준 Object 키 순서:
`entity, id, lock, name, objectType, rotateMethod, scene, script, selectedPictureId, sprite`

JSON.stringify 결과는 키 순서에 의존하지 않고 엔진도 순서 체크 안 하지만, 그래도
레퍼런스와 같은 순서면 diff 노이즈가 줄어든다.

### 절대 넣지 말 것

- `active` — 우리가 한때 넣었다가 로드 에러 냈던 필드. 엔트리 스키마에 없음.

## Entity

```json
{
  "x": 0, "y": 0,
  "regX": 100, "regY": 120,
  "scaleX": 0.5128, "scaleY": 0.5128,
  "rotation": 0, "direction": 90,
  "width": 200, "height": 240,
  "font": "undefinedpx ",
  "visible": true
}
```

| 필드 | 비고 |
|------|------|
| `x`, `y` | 무대 좌표. 중앙이 (0,0), 기본 무대 240×135 (스테이지 내부 좌표계는 -240…+240, -135…+135) |
| `regX`, `regY` | 회전·스케일 기준점. **관례: 첫 picture의 width/2, height/2** |
| `scaleX/Y` | 이미지 배율. `120/width` 정도로 두면 스테이지에 적당한 크기 |
| `direction` | 진행 방향(도). `90` = 오른쪽 |
| `rotation` | 시각적 회전(도) |
| `width`, `height` | **첫 picture의 dimension과 일치시킬 것** — 맞추지 않으면 히트박스·스케일 계산에서 어긋남 |
| `font` | textBox일 때만 의미. sprite는 **`"undefinedpx "`** 문자열 (엔트리 관례 — 없으면 런타임 경고) |
| `visible` | 무대 표시 |

구현: [`tools/make-ent.mjs:159-174`](../tools/make-ent.mjs#L159) `makeDefaultEntity()`.

## Picture — 최신 포맷 (playentry 레퍼런스 기준)

```json
{
  "id": "6tf8",
  "dimension": { "width": 284, "height": 350 },
  "filename": "12f7bba7moangysk0006b89619dd6r5k",
  "name": "205봇",
  "imageType": "png",
  "fileurl": "temp/12/f7/image/12f7bba7moangysk0006b89619dd6r5k.png"
}
```

### 핵심 규칙

1. **`imageType`은 항상 `"png"`** — SVG 원본을 올려도 엔트리가 서버에서 PNG로 래스터라이즈한다.
2. **`thumbUrl` 필드를 쓰지 않는다.** Entry의 `updateThumbnailView`
   ([`object.js:223-245`](../../../upstream/entryjs/src/class/object.js#L223))가 `thumbUrl || fileurl`로
   fallback하는데, fileurl이 PNG면 CSS `background-image`로 썸네일을 바로 띄운다.
3. **`fileurl`은 tar 경로** — `temp/<d1>/<d2>/image/<hash>.png`.
4. **`filename`은 해시만** (확장자 없음) — Entry가 필요시 `<defaultPath>/uploads/…/thumb/<hash>.png`로 derive.
5. **키 순서** (레퍼런스): `id, dimension, filename, name, imageType, fileurl`.

### 왜 PNG로 강제?

- 레퍼런스 `C:\Users\young\Downloads\260423_작품.ent` (저장소 외부, 사용자 로컬) tar에는 SVG 파일이 **전혀 없음**.
  오직 `image/*.png` + `thumb/*.png` 페어만 존재.
- 엔트리 엔진은 사실 SVG도 렌더 가능(EaselJS Bitmap이 SVG URL 지원).
  하지만 playentry.org 업로더가 SVG를 그대로 받으면 관례 외 파일이 되어 서버 측 처리 경로에서 문제가 생길 수 있음 (MYentry 커밋 `b79d8a9` 메모).
- **결론**: SVG 입력이 있어도 `sharp(svg).png()`로 래스터라이즈해 PNG만 번들.

### 흔한 실수 / 혼란

- ~~picture.thumbUrl 필드를 꼭 써야 한다~~ — MYentry 커밋 `68a8dc4`가 그렇게 말하지만,
  실제 playentry.org가 내놓는 파일(우리 레퍼런스)을 보면 thumbUrl이 **없다**.
  `68a8dc4`는 중간 정정이었고, 이후 `b984b2f`가 다시 제거.
  empirical 정답: **쓰지 말 것**.
- `imageType: "svg"` 로 넣고 fileurl을 SVG로 두면 엔트리 편집기에서는 보이지만
  playentry.org로 업로드 시 서버가 거부하거나 썸네일만 비어 보이는 케이스 있음.

## Sound

```json
{
  "id": "3rxi",
  "duration": 1.3,
  "filename": "112f7bbamoangysk0006b89619dd5uhn",
  "name": "강아지 짖는 소리",
  "ext": ".mp3",
  "fileurl": "temp/11/2f/sound/112f7bbamoangysk0006b89619dd5uhn.mp3"
}
```

| 필드 | 비고 |
|------|------|
| `id` | 오브젝트 내 유일 |
| `duration` | 초 (미리 측정한 값) |
| `filename` | 32자 해시 (확장자 없음) |
| `name` | 표시명 |
| `ext` | **점 포함** — `".mp3"`, `".wav"` 등 |
| `fileurl` | tar 경로 `temp/…/sound/<hash>.<ext>` |

사운드는 이미지와 달리 **원본 바이트 그대로** tar에 저장 (MP3/WAV/OGG).
`imageType` 같은 필드는 없고 `ext`가 그 역할.

## 자산 자동 번들링 (make-ent.mjs 동작)

spec에서 picture/sound 참조 방법:

1. **`svgString`** — 인라인 SVG 문자열. 콘텐츠 해시(sha1) 로 dedup → 같은 SVG 가 여러 곳에서 호출되어도 tar 안에는 한 번만 들어감. 생성기 ([sprite-gen.mjs](../tools/lib/sprite-gen.mjs)) 출력에 사용.
2. **`path`** 명시 — 파일시스템 절대경로. 그대로 읽어서 번들 (path 자체가 cacheKey).
3. **`fileurl`이 `/...`로 시작** — `public/<fileurl>`에서 해석해 자동 번들.
4. **`fileurl`이 `http(s):` 또는 `data:`** — 번들 안 하고 그대로 둠.
5. **`fileurl`이 `temp/...`** — 이미 tar 내부 참조로 간주, 건드리지 않음.

구현: [`tools/make-ent.mjs:27-44`](../tools/make-ent.mjs#L27) `resolveLocalPath()` + `bundleBuf()`.

### 게임 이미지 라이브러리 — A (정적) + B (생성기)

자주 쓰는 ball / brick / paddle / heart / star 등의 SVG 자산을 두 갈래로 제공:

**A. 정적 라이브러리** ([`public/images/game/`](../public/images/game/)):
- `node tools/build-game-assets.mjs` (`npm run build:assets`) 가 sprite-gen 으로 18 개 SVG + manifest.json 생성
- spec 에서 [`assets()`](../tools/lib/game-assets.mjs) 헬퍼로 의미 있는 이름 → fileurl 변환:
  ```js
  import { assets } from '../../tools/lib/game-assets.mjs';
  obj('ball', '공', { picture: assets('ball-blue') });
  ```
- 새 변형 필요하면 [`tools/build-game-assets.mjs`](../tools/build-game-assets.mjs) 의 `CATALOG` 에 한 줄 추가 + 재실행.

**B. 인라인 생성기** ([`tools/lib/sprite-gen.mjs`](../tools/lib/sprite-gen.mjs)):
- `circle`, `rect`, `ring`, `regularPolygon`, `triangle/pentagon/hexagon`, `star`, `heart`, `shadedBall`, `beveledBrick`
- 각 함수 출력: `{ svgString, dimension, imageType: 'svg' }`
- DSL `obj()` 의 `picture:` 에 그대로 전달:
  ```js
  import * as gen from '../../tools/lib/sprite-gen.mjs';
  obj('paddle', '패들', { picture: gen.rect(80, 12, '#3b82f6', { rx: 6 }) });
  ```
- make-ent 가 svgString 을 콘텐츠 해시 dedup → 같은 모양·색이 여러 곳에서 호출되어도 tar 한 번.

**선택 가이드**: 자주 쓰는 변형은 A (콜사이트 짧음, 카탈로그 검토 가능). 일회성·동적 변형은 B (정확히 원하는 크기/색).
A 의 자산은 사실상 B 의 산출물을 동결한 것 — `build-game-assets.mjs` 가 sprite-gen 호출.

### 자산이 tar에 들어가야 하는 이유

`fileurl: "/images/mascot/bot205-idle.svg"` 같이 서버 상대경로로 두면
**내 서버에서만** 이미지가 보이고, 다른 사람이 같은 `.ent`를 playentry.org나 다른 편집기에 열면
이미지가 전부 깨진다. `.ent`는 자가완결(self-contained)이어야 한다.

확인 방법:
```bash
# 이미지가 tar에 포함됐는지
node -e "const z=require('zlib'),f=require('fs');const{forEachTarEntry}=require('./server.js');
  forEachTarEntry(z.gunzipSync(f.readFileSync('X.ent')), e=>
    e.name.match(/image\|sound/)&&console.log(e.name,e.data.length));"
```

image/*.png + thumb/*.png 페어가 각 picture마다 나와야 정상.

## 오브젝트 시각 크기 기본값

입력 이미지 dimension이 200×240일 때 make-ent가 emit하는 entity 기본값:
- `regX = 100, regY = 120` (이미지 중심)
- `scaleX = scaleY = 120/200 = 0.6` (스테이지에 120px 정도로 표시)
- `width = 200, height = 240` (picture와 동일)

이 값들이 "맞아야" 엔트리 편집기에서 선택 박스가 이미지 경계와 일치한다.
