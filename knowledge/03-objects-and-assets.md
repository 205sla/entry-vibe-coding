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
- `text` 필드에 표시할 문자열. **빈 문자열이면 오브젝트 `name` 으로 폴백**해서 이름이 화면에 뜬다 — 색 사각형만 원하면 공백 한 칸(`" "`)을 넣는다 ([`07` §textBox `text: ''`](07-runtime-quirks.md#textbox-text--는-객체-이름으로-폴백))

#### ⚠️ 글상자 문자열은 `object.text` 와 `entity.text` **두 곳**에 있다

기존 `.ent` 의 글상자 문구를 프로그램으로 바꿀 때 가장 걸리기 쉬운 함정이다.

```jsonc
{
  "objectType": "textBox",
  "text": "안녕",              // ① 오브젝트 레벨
  "entity": { "text": "안녕" } // ② 엔티티 레벨 — **엔진이 실제로 그리는 쪽**
}
```

**`object.text` 만 고치면 파일은 바뀌는데 화면은 그대로다.** tar·JSON 구조 검사는 전부
통과하므로 조용히 지나간다 — 무대에 올려 렌더된 문자열을 봐야 잡힌다.

- 고칠 때는 **항상 둘 다** 쓴다.
- 검증에는 `object.text === entity.text` 전수 확인을 넣는다.
- 런타임에 `text_write` 로 덮는 글상자라면 세 번째 출처(**블록 파라미터**)도 있다.
  정적 두 필드는 그 블록이 실행되기 **전 첫 프레임**에 보이는 값이다.

`text_write` 입력이 항상 문자열 리터럴인 것은 아니다. 변수·리스트 값을 읽는 **반환 블록**이면
그 타입과 참조를 따라 실제 데이터 출처를 찾는다. JSON의 빈 슬롯 `null`, 문자열 `"null"`,
분석기가 해석하지 못한 값을 구분한다. 입력의 고정 인덱스만 읽고 정적 text가 계속 보인다고 결론 내리면 안 된다.
엔진도 [text_write 실행 시 입력을 평가](https://github.com/entrylabs/entryjs/blob/53e121523760f15961cd14ab7cb93563a79eaab3/src/playground/blocks/block_text.js#L113)한다.
초기 필드 일치는 파일 검사이며, 실행 중에는 **그 시점의 기대 문구**와 렌더 문자열을 비교한다.

문구가 길어졌다면 [크기 블록의 실제 단위](07-runtime-quirks.md#크기-정하기는-퍼센트가-아니다)와
줄바꿈 높이를 함께 확인한다. 폰트만 줄이면 뒤의 크기 블록이 다시 확대할 수 있다.

make-ent 로 새로 만들 때는 DSL 이 둘 다 채워주므로 문제가 없다. **기존 작품을 외과적으로
수정할 때** 걸린다.
- `sprite.pictures`는 보통 비어있거나 무시됨
- `entity.bgColor` 는 hex(`'#xxxxxx'`) 일 때만 사각 전체 클릭 — 투명이면 글자(glyph) 픽셀만 hit. 자세한 건 [`07-runtime-quirks.md` textBox 클릭 영역](07-runtime-quirks.md#textbox-클릭-영역--bgcolor-에-따라-사각-전체-vs-glyph-픽셀만)
- 썸네일은 `text_icon_ko.svg` / `text_icon.svg` 자동 사용 ([`object.js:240-243`](https://github.com/entrylabs/entryjs/blob/53e121523760f15961cd14ab7cb93563a79eaab3/src/class/object.js#L240))

#### ⚠️ 보이는 글상자는 entity 를 **전부** 명시한다

`entity` 를 `{ x, y }` 만 주면 make-ent 가 **sprite 기본값**으로 채운다. 그 안의
`font: "undefinedpx "` 가 글상자에서는 `parseFloat` → **`fontSize` NaN** 이 되어
글자가 브라우저 기본 10px 로 쪼그라든다. 에러도 경고도 없다.
전체 메커니즘: [`07` §글상자 entity fontSize NaN](07-runtime-quirks.md#글상자-entity-를-비워두면-fontsize-가-nan--글자가-10px-로-쪼그라든다).

| 필드 | 왜 필요한가 |
|------|-------------|
| `font` + `fontSize` | 둘 다. `font` 만 주면 `syncModel_` 이 파싱값으로 되돌아간다 |
| `lineBreak` | `true` 여야 줄바꿈이 생긴다. `false` 면 한 줄로 화면 밖까지 뻗는다 |
| `width`, `height` | `lineBreak: true` 일 때 접는 폭 / **넘는 줄은 그리지 않고 버린다** |
| `textAlign` | **0 = 가운데**, 1 = 왼쪽, 2 = 오른쪽 (1 을 가운데로 착각하기 쉽다) |
| `scaleX`, `scaleY` | `1` 로. 기본값 1.2 가 들어가면 폰트만 확대돼 접는 폭과 어긋난다 |
| `colour`, `bgColor` | 무대 기본 배경은 흰색이다 |
| `visible` | `hide()` 로 숨길 오브젝트는 **여기서도 `false`** — 첫 프레임에 이름이 번쩍인다 |

정렬 규칙(`entity.x` 가 가운데 기준, `regX/regY` 강제 0)은
[`07` §textBox 정렬](07-runtime-quirks.md#textbox-정렬--regxregy-강제-0-가운데는-textalign0-1-아님).

make-ent 는 `objectType: "textBox"` + `text` 필드를 자동 emit (sprite 와 달리 picture 불필요).
DSL `obj()` 는 `text`, `entity.bgColor` 등을 그대로 통과 — 사용 예: [`tests/fixtures/spec-name-loop.mjs`](../tests/fixtures/spec-name-loop.mjs).
버튼 패턴은 [`04-script-and-blocks.md` 버튼 구현](04-script-and-blocks.md#버튼-구현--textbox-가-sprite--dialog-보다-깔끔),
애니메이션은 [`04` §글상자만으로 애니메이션](04-script-and-blocks.md#글상자만으로-애니메이션--글자-프레임--좌표--타자기) 참조.

**에셋 0 이 필요하면 오브젝트를 전부 글상자로 만든다** — sprite 는 picture 가 최소 1장
필요해서 tar 없이는 못 옮긴다. 그 이유와 배포 경로는
[`05` §콘솔 붙여넣기 배포](05-host-editor.md#playentryorg-배포--기존-작품에-projectjson-만-갈아끼우기-콘솔-붙여넣기).

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
| `font` | sprite는 **`"undefinedpx "`** 문자열 (엔트리 관례 — 없으면 런타임 경고). ⚠️ **글상자에 이 값이 가면 `fontSize` 가 NaN 이 되어 글자가 10px 로 쪼그라든다** — 글상자는 `"16px NanumGothic"` 처럼 실제 값 + `fontSize` 를 함께 준다 ([07](07-runtime-quirks.md#글상자-entity-를-비워두면-fontsize-가-nan--글자가-10px-로-쪼그라든다)) |
| `visible` | 무대 표시 |

**글상자 전용 필드** (sprite 에는 없음): `text`, `fontSize`, `lineBreak`, `textAlign`,
`colour`, `bgColor`, `underLine`, `strike`. 위 §textBox 오브젝트의 체크리스트 참조.

구현: [`tools/make-ent.mjs:159-174`](../tools/make-ent.mjs#L159) `makeDefaultEntity()`.
⚠️ 이 함수는 **sprite 기준**이다 — 글상자는 spec 에서 entity 를 채워 덮어써야 한다.

## Picture — PNG 생성 정책과 외부 작품의 SVG

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

### 이 저장소가 생성하는 Picture

1. **현재 생성기는 `imageType: "png"`를 출력한다.** `lib/asset-bundler.js`가 이미지를 PNG로 변환하는 정책이며, 모든 외부 `.ent`의 형식 제약은 아니다.
2. **`thumbUrl` 필드를 쓰지 않는다.** Entry의 `updateThumbnailView`
   ([`object.js:223-245`](https://github.com/entrylabs/entryjs/blob/53e121523760f15961cd14ab7cb93563a79eaab3/src/class/object.js#L223))가 `thumbUrl || fileurl`로
   fallback하는데, fileurl이 PNG면 CSS `background-image`로 썸네일을 바로 띄운다.
3. **`fileurl`은 tar 경로** — `temp/<d1>/<d2>/image/<hash>.png`.
4. **`filename`은 해시만** (확장자 없음) — Entry가 필요시 `<defaultPath>/uploads/…/thumb/<hash>.png`로 derive.
5. **키 순서** (레퍼런스): `id, dimension, filename, name, imageType, fileurl`.

### 외부 작품을 읽을 때는 SVG도 보존한다

- 과거 레퍼런스 `260423_작품.ent`의 이미지가 PNG뿐이었다는 관찰을 전체 포맷 규칙으로 일반화하면 안 된다.
- 2026-09-10 분석한 뮤직비디오에는 `imageType: "svg"` Picture와 SVG 원본·PNG 래스터·PNG 썸네일이 함께 있다. 일부 기본 모양은 엔진 자산 경로를 참조한다. 개수와 원본 식별 근거는 [뮤직비디오 사례](10-music-video-case-study.md)에 둔다.
- 읽기·분석 도구는 `imageType`, `fileurl`, `filename`과 TAR 내부 파일을 함께 확인한다. SVG 메타데이터 또는 엔진 기본 모양 경로만 보고 손상으로 판정하지 않는다.
- 새 작품의 PNG 번들 정책은 유지한다. 기존 작품을 다시 내보낼 때 SVG를 PNG로 바꾸는 것은 변환이며, 벡터 편집 정보까지 그대로 보존하는 왕복이 아니다. 이번 정적 분석은 공식 사이트 재업로드 성공을 검증한 것이 아니다.

### 흔한 실수 / 혼란

- ~~picture.thumbUrl 필드를 꼭 써야 한다~~ — MYentry 커밋 `68a8dc4`가 그렇게 말하지만,
  실제 playentry.org가 내놓는 파일(우리 레퍼런스)을 보면 thumbUrl이 **없다**.
  `68a8dc4`는 중간 정정이었고, 이후 `b984b2f`가 다시 제거.
  empirical 정답: **쓰지 말 것**.
- `imageType: "svg"` 자체를 업로드 실패 원인으로 단정하지 않는다. 원본·래스터·썸네일의 파일명과 참조 관계를 먼저 검사하고, 업로드 호환성은 별도 실사이트 검증으로 확인한다.

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
번들 가능 형식과 공식 웹의 가져오기·재생 호환성은 다르다. 새 공개용 작품은
[15의 MP3 기본 방침](15-audio-verification.md#공식-웹용-음원-형식-선택)을 따른다.

### 합성 WAV를 포함하고 음악을 별도 스레드에서 반복하기

심연의 성채의 [build.mjs](../games/abyssal-keep/build.mjs)는 22,050 Hz·16-bit·mono PCM
WAV를 생성한다. RIFF 헤더의 샘플 수와 실제 데이터 크기, `duration`을 같은 길이에서 계산하고
샘플을 16-bit 범위로 제한한다. 만들어진 파일은 오브젝트의 `sounds`에
`{ id, name, path, duration }`으로 등록하여 기존 생성기가 tar 내부 경로로 바꾸게 한다.
합성 JS는 제작 시에만 실행하며 작품 안의 재생은 소리 블록이 담당한다.

게임 로직의 효과음은 `sound_something_with_block`, 배경 음악은 전용 오브젝트의
`repeat.inf` 안에서 `sound_something_wait_with_block`으로 끝까지 재생한 뒤 반복한다.
음악 완료를 기다리는 블록을 이동·전투 루프에 넣으면 그 루프가 기다리므로 스레드를 나눈다.
음원은 재생 블록을 실행하는 오브젝트에 등록한다. 정확한 슬롯과 기존 소리 블록은
[04 소리](04-script-and-blocks.md#소리)를 참고한다.

이 사례는 `muted` 플래그로 새 효과음을 거르고 `sound_volume_set`으로 진행 중 음악의
음량도 바꾼다. 일시정지 때 음악은 계속 흐르는 설계다. 끝까지 기다린 뒤 반복하는 방식은
샘플 단위의 끊김 없는 연결을 보장하지 않는다.

근거: [spec.mjs](../games/abyssal-keep/spec.mjs)의 `sound`, `music`, N키 처리와
[번들·실행 검사](../games/abyssal-keep/verification.json).
위 검사는 tar 실재와 로컬 실행 무오류에 한정되며 실제 소리 출력 성공의 근거가 아니다.
2026-09-11에 발견한 호스트 의존성 오류와 별도 WAV·MP3 테스트 결과는
[15 소리 검증](15-audio-verification.md)에 정리했다. 소리를 쓰는 새 작품은 그 문서의
등록·디코딩·네이티브 블록·출력 신호 검사를 반드시 추가한다.

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
- `node tools/build-game-assets.mjs` (`npm run build:assets`) 가 sprite-gen 으로 SVG 카탈로그 + manifest.json 생성
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

### 이미지 생성 도구가 없는 환경의 SVG 제작

**이미지 생성 도구가 없는 Claude Code 등의 환경은 이 절차를 기본으로 사용한다.**
에이전트가 SVG 코드를 작성하고 기존 빌더가 PNG로 변환하므로 이미지 생성 API나 배경 제거 도구가
필요 없다. 도구가 없다는 이유로 기존 에셋만 사용하거나 요청된 캐릭터·배경 제작을 생략하지 않는다.

1. 기존 카탈로그에 맞는 모양이 있으면 `assets('ball-blue')`처럼 재사용한다.
   카탈로그 파일이 없을 때는 `npm run build:assets`로 생성한다.
2. 공·별·하트·벽돌 등은 `sprite-gen.mjs`의 함수로 원하는 크기와 색을 만든다.
3. 캐릭터·몬스터·장비·배경은 `path`, `circle`, `rect`, `polygon`, 그라데이션을 조합해
   게임별 SVG를 직접 작성한다. `{ svgString, dimension, imageType: 'svg' }`를 `obj()`의
   `picture` 또는 `pictures` 배열에 연결한다. 기본 도형만 늘어놓지 말고 실루엣·색·명암으로 역할을 구분한다.
   도트 느낌의 캐릭터·타일은 [`pixel-art.mjs`](../tools/lib/pixel-art.mjs)의 `px(행 배열, 팔레트)`로
   문자 그리드를 그린다(한 문자 = 한 도트, `.`은 투명). SVG 단계에서 정수배(기본 3배)로 키우므로
   엔트리에서 확대할 때처럼 흐려지지 않는다. 좌우 반전은 `mirror(rows)`로 모양을 따로 만든다.
4. 캐릭터·아이템은 캔버스 전체를 덮는 배경 도형을 넣지 않아 투명 영역을 유지한다.
   무대 배경에는 전체 배경색을 넣어도 된다. 외부 이미지·폰트·스크립트 참조 없이 SVG 안에서 완결한다.
   애니메이션은 같은 캔버스 크기·중심으로 여러 모양을 만들고 엔트리 모양 전환 블록으로 재생한다.
5. `make-ent.mjs --check`와 빌드를 실행한다. 빌더가 SVG를 PNG 이미지·썸네일로 변환해
   `.ent`에 포함한다. 편집기에서 크기·투명 영역·모양 전환을 확인하고 가능한 런타임 검증까지 진행한다.

```js
// games/<game>/spec.mjs — 이미지 생성 도구 없이 만드는 투명 캐릭터
import { obj } from '../../tools/lib/spec-dsl.mjs';
import * as gen from '../../tools/lib/sprite-gen.mjs';
import { px } from '../../tools/lib/pixel-art.mjs';

const slime = {
    svgString: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <path d="M8 48 Q8 16 32 16 Q56 16 56 48 Q32 60 8 48Z" fill="#34d399" stroke="#065f46" stroke-width="3"/>
      <ellipse cx="24" cy="26" rx="8" ry="4" fill="#a7f3d0"/>
      <circle cx="24" cy="37" r="3" fill="#172554"/>
      <circle cx="42" cy="37" r="3" fill="#172554"/>
      <path d="M28 45 Q33 49 38 45" fill="none" stroke="#172554" stroke-width="2"/>
    </svg>`,
    dimension: { width: 64, height: 64 },
    imageType: 'svg',
};

export default {
    objects: [
        obj('slime', '슬라임', { picture: slime }),
        obj('star', '보상 별', { picture: gen.star(20, 9, 5, '#facc15') }),
        obj('bat', '도트 박쥐', { picture: px(['a..a', 'abba', '.bb.'], { a: '#4c1d95', b: '#a78bfa' }) }),
    ],
};
```

위 코드는 에셋 연결 예시다. 실제 작품에서는 이동·전투 등 게임 로직과 연결해 완성한다.
SVG는 `svgString`으로 바로 연결하므로 PNG 전용 `import-image-asset.mjs`에 넣지 않는다.

### AI 이미지 생성과 투명 오브젝트

현재 에이전트에 이미지 생성 도구가 제공되면, 제작 중 필요한 캐릭터·아이템·배경을 직접 생성하여
사용한다. **에이전트의 제작 절차**이며 오프라인 편집기 자체에 이미지 생성 API가 탑재되는 것은 아니다.
도구의 사용 가능 여부는 매 작업의 도구 목록에서 확인한다. 단순 도형이나 기존 벡터 스타일의 확장은
위 SVG 도구를 사용하고, 일러스트가 필요한 자산은 이미지 생성 도구를 사용한다.

1. 필요한 오브젝트, 시점, 크기, 스타일을 게임 설계에서 정한다. 한 오브젝트씩 생성하며
   애니메이션은 프레임마다 캔버스 크기·중심·시점·비율을 맞춘다.
2. 캐릭터·아이템·이펙트는 **실제 투명 배경 PNG**를 요청한다. 흰색·체크무늬를 배경에 그리지 말고,
   오브젝트 전체와 약간의 여백을 담으며 텍스트·워터마크는 제외하도록 명시한다.
   무대 배경은 작품의 무대 비율에 맞게 생성하고 불투명 이미지를 허용한다.
3. 배경이 남으면 결과를 먼저 이미지 뷰어로 확인한 뒤, 이미지 편집 도구에 **배경 제거**를 요청한다.
   피사체의 형태·색·얼굴·포즈를 유지하고 가장자리의 흰 테두리를 없애도록 지시한다.
   임의의 흰색 픽셀 삭제로 대체하지 않는다. 배경 제거도 완료되었다고 가정하지 않고 다시 검사한다.
4. 완성된 PNG를 아래 도구로 가져온다. 원본 바이트와 알파를 그대로 복사하고 크기·투명도·SHA-256·
   선택한 프롬프트를 JSON에 기록한다. 기본 `sprite` 모드는 완전 투명 픽셀이 없는 이미지와
   전체가 투명한 이미지를 거부한다. **불투명한 체크무늬도 검사에서 거부**된다.
   수치 검사는 누끼 품질·배경 잔여물까지 판정하지 못하므로 밝은/어두운 배경에서 눈으로도 확인한다.
5. 반환된 모양을 spec에 연결하고 빌드·로드·런타임 검사로 크기, 중심, 가장자리와 실제 플레이를 확인한다.
   원본 생성 도구의 개인 출력 폴더를 참조하는 상태로 끝내지 않는다.

```powershell
node tools/import-image-asset.mjs --source "C:/path/to/generated-image.png" --name forest-hero-v1 --prompt-file "C:/path/to/prompt.txt"
# 불투명 무대 배경은 명시적으로 구분
node tools/import-image-asset.mjs --source "C:/path/to/background.png" --name forest-background-v1 --kind background
```

위 경로는 예시다. 실제 생성 도구가 반환한 로컬 경로를 사용하며, 파일을 먼저 요구하거나 API 키를
요구할 필요는 없다. 가져오기 도구 자체는 생성·배경 제거·리사이즈를 하지 않는다.
출력은 `public/images/game/generated/<name>.png`와 같은 이름의 `.json`이다. 기존 파일은
덮어쓰지 않으므로 수정본은 `-v2`처럼 새 이름을 사용한다. 기존 SVG 카탈로그 재생성과도 독립적이다.

```js
// games/<game>/spec.mjs (위 가져오기를 완료한 이름만 참조)
import { generatedPicture } from '../../tools/lib/generated-assets.mjs';
import { obj, when, moveX } from '../../tools/lib/spec-dsl.mjs';
const hero = generatedPicture('forest-hero-v1');
const scale = 96 / hero.dimension.width;
export default {
    objects: [obj('hero', '주인공', {
        picture: hero,
        entity: { x: 0, y: 0, scaleX: scale, scaleY: scale },
        script: [when.run(), moveX(10)],
    })],
};
```

생성 프롬프트 예시: “엔트리 게임용 [필요한 오브젝트] 하나. [게임의 시점과 스타일].
오브젝트 전체와 약간의 여백, 실제 알파가 있는 투명 PNG 배경. 흰 배경, 체크무늬 배경,
바닥, 텍스트, 워터마크 없이.” 배경 제거 편집에서는 “피사체를 유지하고 배경만 제거”를 추가한다.

이미지 생성·편집 도구가 없거나 실패하면 [SVG 제작 절차](#이미지-생성-도구가-없는-환경의-svg-제작)로
필요한 에셋을 직접 만들어 제작을 계속한다. 최종 보고에는 실제 사용한 제작 방식을 적는다.
별도 유료 API/CLI 방식은 사용자가 선택한 경우에만 사용한다. 자동으로 키를 찾거나 다른 모델로 바꾸지 않는다.
검증 근거: [가져오기·알파 보존 회귀 검사](../tests/generated-assets.test.js)는 투명·반투명 픽셀이
가져오기와 `.ent` 번들링 뒤에도 유지되는지, 불투명 sprite와 덮어쓰기가 차단되는지 확인한다.

#### 편집 요청은 지정한 곳 **밖도 조금** 바꾼다 — 바뀐 곳만 얹는다

"이 그림에서 ○○ 만 바꿔라(나머지는 그대로)"는 편집 요청은 대체로 지켜지지만, 결과를 통째로 쓰면 종이결·얼룩 같은 **지정 밖의 미세한 변화**가 따라온다
(2026-09-29 제목 그림에서 글자 몇 개만 지우는 편집: 도구가 스스로 "지정 영역 밖 종이결도 바뀌었다"고 보고했고, 멀리 떨어진 물감 얼룩의 색이 달라져 있었다).

- **바뀐 곳만 조각으로 얹는다**: 원본과 편집본을 **원본과 똑같은 자르기·배율**로 맞춘 뒤, 바꾼 상자(+여백 10px)만 잘라 원본 위 제자리에 둔다.
  여백은 원본과 같은 픽셀이라 이음매가 없다(측정: 조각 테두리와 원본 차이 최대 1/255). 조각 가운데 − 원본 가운데 오프셋을 기록해 두고 같은 배율로 놓는다.
- **바꾼 곳을 찾을 때 색 차이를 쓰지 않는다** — 위의 지정 밖 변화까지 잡힌다(실제로 엉뚱한 얼룩 영역이 가장 크게 잡혔다).
  "지웠다"면 **사라진 먹**: 원본에서 어둡던(글자) 픽셀 중 편집본에선 근처(3×3)에도 어두운 게 없는 곳 → 닫기 연산 → 가장 큰 덩어리.
- 단계 애니메이션(반쯤 지움 → 다 지움)은 상자 안에서만 편집본을 왼쪽부터 드러낸 몇 장으로 만든다.
- 용량: 제목 전체를 네 장 두던 것을 작은 조각 세 장으로 바꿔 `.ent` 가 약 1.4 MB 줄었다(제목 그림은 다른 장면과 같은 파일이라 번들에 한 번만).

배경 속 물건을 그려 넣고 오려 누를 수 있게 만드는 경우도 같은 원리다(편집본 전체 대신 바뀐 곳만 쓰기).

#### 가만히 있는 그림에 "선 떨림"(보일링)을 줄 때

생성 AI 로 세 번 다시 그리지 말고 완성 PNG 를 후처리로 조금씩 민 세 장을 쓴다 → [04 보일링](04-script-and-blocks.md#보일링선-떨림--모양-세-장을-타이머-박자로-돌리기).

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

현재 생성기가 번들한 이미지에는 image/*.png + thumb/*.png 페어가 있어야 한다. 외부 작품에는 SVG 원본이나 엔진 기본 자산 참조도 있을 수 있으므로 이 검사를 그대로 적용하지 않는다.

## 오브젝트 시각 크기 기본값

입력 이미지 dimension이 200×240일 때 make-ent가 emit하는 entity 기본값:
- `regX = 100, regY = 120` (이미지 중심)
- `scaleX = scaleY = 120/200 = 0.6` (스테이지에 120px 정도로 표시)
- `width = 200, height = 240` (picture와 동일)

이 값들이 "맞아야" 엔트리 편집기에서 선택 박스가 이미지 경계와 일치한다.
