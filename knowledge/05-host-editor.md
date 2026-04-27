# 엔트리 편집기를 오프라인으로 호스팅하기

이 저장소 자체가 목적: 외부 CDN 의존 없이 브라우저에서 엔트리 편집기를 띄우고
`.ent` 파일을 로드·내보낸다. 정상 동작을 위해 맞춰야 할 조건들.

## 파일 트리 요건

```
public/
  lib/
    entry-js/
      dist/         ← entryjs/dist 전체 복사 (entry.min.js, entry.min.css, 522.*.js, libkhaiii.wasm, manifest.json)
      extern/       ← entryjs/extern 전체 복사 (lang, util/filbert, util/CanvasInput, util/static.js, ...)
      images/       ← entryjs/images 복사 (Entry 내부에서 /lib/entry-js/images/* 참조)
    entry-tool/     ← @entrylabs/tool 빌드
    entry-paint/    ← @entrylabs/paint
    entry-lms/      ← @entrylabs/lms
    sound-editor/   ← playentry-sound-editor
    legacy-video/   ← playentry-legacy-video
    vendor/         ← jQuery, jQuery-UI, CreateJS, lodash, CodeMirror, Fuzzy, React, Socket.IO, Velocity
  images/           ← entryjs/images 복사 (Entry가 /images/* 로도 참조함 - 양쪽 모두 필요)
  media/            ← cursor 파일 (handopen.cur, handclosed.cur)
```

`entryjs/images`를 **두 군데**에 복사해야 한다는 점이 핵심 — Entry 코드가 `/images/block_icon/*.svg` 와
`/lib/entry-js/images/btn_scene_add.png`를 **둘 다** 요청한다.

## Entry.init 옵션

```js
window.PUBLIC_PATH_FOR_ENTRYJS = 'lib/entry-js/dist/';   // 청크 로더 경로

const initOption = {
    libDir: '',
    entryDir: '',
    type: 'workspace',
    textCodingEnable: false,    // 파이썬 모드 끄기 (jshint/python.js 서버 의존)
    hardwareEnable: false,      // 하드웨어 소켓 ws://127.0.0.1:23518 연결 시도 끄기
    // 필요시 추가:
    // aiLearningEnable: false,   // AI 학습 블록
    // aiUtilizeDisable: true,    // AI 활용 블록 카테고리
    // expansionDisable: true,    // 확장 블록 (날씨 등, 서버 API 필요)
    // backpackDisable: true,     // 나만의 보관함 (서버 필요)
};
Entry.creationChangedEvent = new Entry.Event(window);
Entry.init(document.getElementById('workspace'), initOption);
Entry.loadProject();   // 기본 starter — 빈 워크스페이스 + 엔트리봇 하나 (starter scene id는 '7dwq'지만 이후 clearProject로 지워지므로 .ent 측이 신경 쓸 필요 없음)
```

구현: [`public/js/editor.js`](../public/js/editor.js).

### 주요 옵션 해설

| 옵션 | 기본 | 우리 설정 | 이유 |
|------|------|-----------|------|
| `textCodingEnable` | true | `false` | 파이썬 모드는 jshint/python.js(playentry 서버 전용) 필요. 게임 제작엔 불필요 |
| `hardwareEnable` | true | `false` | 하드웨어 모듈이 `ws://127.0.0.1:23518`에 접속 시도해서 콘솔에 WebSocket 에러 |
| `type` | — | `'workspace'` | `'workspace'` 또는 `'minimize'` (공식) |

### `Entry.init` 옵션 공식 목록

공식 [init-options typedef](https://github.com/entrylabs/docs/blob/master/source/entryjs/typedef/2024-03-11-init-options.md)에서:

| 옵션 | 타입 | 기본 | 설명 |
|------|------|------|------|
| `type` | `'workspace' \| 'minimize'` | — | 워크스페이스 타입 |
| `libDir` | string | `/lib` | 써드파티 라이브러리 위치 |
| `entryDir` | string | `/@entrylabs/entry` | entry media asset 위치 |
| `defaultDir` | string | — | 기본 assets 위치 |
| `soundDir` | string | — | 사운드 파일 위치 |
| `baseUrl` | string | — | AI/API 블록 호출 원본 API 주소 |
| `fonts` | Array | — | 웹폰트 정보 |
| `objectAddable` | boolean | true | 오브젝트 추가 가능 |
| `objectEditable` | boolean | true | 오브젝트 수정 가능 (false면 Addable도 false) |
| `objectdeletable` | boolean | true | 오브젝트 삭제 가능 (소문자 `d` 주의) |
| `soundeditable` | boolean | true | 소리 수정 가능 |
| `pictureeditable` | boolean | true | 모양 수정 가능 |
| `sceneEditable` | boolean | true | 장면 수정 가능 |
| `functionEnable` | boolean | true | 함수 |
| `messageEnable` | boolean | true | 신호 |
| `variableEnable` | boolean | true | 변수 |
| `listEnable` | boolean | true | 리스트 |
| `aiLearningEnable` | boolean | true | AI 학습 |
| `isForLecture` | boolean | false | 강의용 |
| `textCodingEnable` | boolean | true | 파이썬 |
| `hardwareEnable` | boolean | true | 하드웨어 |
| `expansionDisable` | boolean | true | 확장 블록 (네이밍 주의: Disable) |
| `aiUtilizeDisable` | boolean | true | AI 활용 블록 |
| `blockSaveImageEnable` | boolean | true | 블록 이미지로 저장 |

## 프로젝트 로드

### 초기 로드

`Entry.init()` 직후 반드시 `Entry.loadProject(someProject)` 호출. 안 하면 나중 로드 시
스테이지 컨테이너가 없어서 크래시.

인자 없이 부르면 Entry 내장 starter 프로젝트(엔트리봇 하나, scene id `'7dwq'`) 로드.
이 id는 Entry 내부 구현 상수일 뿐이므로 `.ent`가 맞출 필요는 없다 —
사용자 `.ent` 로드 전 `Entry.clearProject()`가 scene 상태를 싹 리셋하기 때문.

### 사용자 .ent 로드

```js
async function loadEntFile(file) {
    const fd = new FormData();
    fd.append('ent', file);
    const project = await fetch('/api/load', { method: 'POST', body: fd }).then(r => r.json());

    // ★ 필수: 기존 상태 정리
    Entry.clearProject();

    Entry.loadProject(project);
}
```

**`Entry.clearProject()`를 반드시 먼저 호출.** 생략하면 `setObjects()`가 `objects_.push()`로
기존 오브젝트 위에 **덧붙여서** — 엔트리봇 옆에 사용자 오브젝트가 달라붙고, 선택된 오브젝트의
블록/이미지가 뒤섞인다. [`entryjs/src/class/container.js:285`](../../entryjs/src/class/container.js#L285).

MYentry의 같은 패턴: [`MYentry/public/js/editor.js:345`](../../MYentry/public/js/editor.js#L345).

## 서버 — `/api/load` + `/api/export`

### `/api/load`: 업로드된 `.ent` → JSON

1. 멀티파트에서 파일 버퍼 받기 (`multer.memoryStorage()`)
2. `zlib.gunzipSync(buf)` → tar 버퍼
3. `extractTarFile(tarBuf, 'temp/project.json')` → JSON 파싱
4. **세션 캐시에 tar 저장** — 유저별 sid(16자 base36), TTL 30분
5. 프로젝트의 모든 `fileurl`/`thumbUrl` 리라이트:
   - `temp/aa/bb/…` → `/api/ent-asset/<sid>/temp/aa/bb/…`
   - `/...` (절대 경로) → 그대로
   - `http(s):`/`data:` → 그대로
6. 수정된 JSON 응답

### `/api/ent-asset/:sid/*`

세션 캐시에서 해당 경로의 tar 엔트리를 꺼내 스트리밍. content-type은 확장자로 결정.

### `/api/export`: JSON → `.ent`

1. project의 각 `picture.fileurl`을 해석 (temp/… 는 통과, 절대 경로는 public/에서 번들)
2. 이미지는 `sharp(buf).png()`로 래스터라이즈해 tar에 PNG만 저장
3. 썸네일은 96px 다운스케일 PNG
4. `picture.imageType = "png"`, `picture.filename = hash`, **`picture.thumbUrl` 삭제**
5. tar 생성 (portable 헤더) → `zlib.gzipSync(..., { memLevel: 6 })`
6. `application/x-gzip` 응답

구현: [`server.js:234-345`](../server.js#L234).

## 외부 모듈 로드 순서 (editor.html)

```html
<!-- 1. Language -->
<script src="lib/entry-js/extern/lang/ko.js"></script>

<!-- 2. CreateJS — 반드시 preloadjs → easeljs → soundjs 순 -->
<script src="lib/vendor/preloadjs-0.6.0.min.js"></script>
<script src="lib/vendor/easeljs-0.8.0.min.js"></script>
<script src="lib/vendor/soundjs-0.6.0.min.js"></script>
<script src="lib/vendor/flashaudioplugin-0.6.0.min.js"></script>

<!-- 3. 코어 라이브러리 -->
<script src="lib/vendor/lodash.min.js"></script>
<script src="lib/vendor/jquery.min.js"></script>
<script src="lib/vendor/jquery-ui.min.js"></script>
<script src="lib/vendor/velocity.min.js"></script>

<!-- 4. CodeMirror (textCodingEnable:false여도 entry-lms가 전역 참조) -->
<script src="lib/vendor/codemirror/lib/codemirror.js"></script>
<script src="lib/vendor/codemirror/addon/{hint,lint,selection,mode/javascript}/..."></script>

<!-- 5. fuzzy -->
<script src="lib/vendor/fuzzy.js"></script>

<!-- 6. Entry extern utils — entry.min.js가 전역으로 기대 -->
<script src="lib/entry-js/extern/util/filbert.js"></script>
<script src="lib/entry-js/extern/util/CanvasInput.js"></script>
<script src="lib/entry-js/extern/util/ndgmr.Collision.js"></script>
<script src="lib/entry-js/extern/util/handle.js"></script>
<script src="lib/entry-js/extern/util/bignumber.min.js"></script>

<!-- 7. Socket.IO -->
<script src="lib/vendor/socket.io.js"></script>

<!-- 8. React (UMD) -->
<script src="lib/vendor/react.production.min.js"></script>
<script src="lib/vendor/react-dom.production.min.js"></script>

<!-- 9. Entry LMS -->
<script src="lib/entry-lms/dist/assets/app.js"></script>

<!-- 10. Entry static helpers (전역 EntryStatic 정의) -->
<script src="lib/entry-js/extern/util/static.js"></script>

<!-- 11. Entry 도구들 -->
<script src="lib/entry-tool/dist/entry-tool.js"></script>
<script src="lib/entry-paint/dist/static/js/entry-paint.js"></script>
<script src="lib/sound-editor/sound-editor.js"></script>
<script src="lib/legacy-video/index.js"></script>

<!-- 12. Entry main — 마지막에 -->
<script src="lib/entry-js/dist/entry.min.js"></script>

<!-- 13. App -->
<script src="js/editor.js"></script>
```

순서를 지키지 않으면 "EntryStatic is not defined" / "createjs is not defined" / "Entry is not defined" 류 에러.

## 필수 vendor 라이브러리 패치

### preload-js npm 패키지 — `module.exports` 제거

`npm install preload-js`로 받은 파일 끝에 `;module.exports=window.createjs;`가 붙어있어
브라우저에서 `ReferenceError: module is not defined`.

수정:
```bash
perl -i -pe 's/;module\.exports=[^;]*;\s*$/;/' public/lib/vendor/preloadjs-0.6.0.min.js
```

### soundjs 1.x 호환 패치 (editor.js에서)

npm `soundjs@1.0.1`의 `_parsePath`가 undefined src에 대해 `toString()` 호출로 크래시.
playentry.org가 쓰는 0.6.0은 관대하게 null 반환. 방어 래퍼:

```js
function patchCreateJSSoundParsePath() {
    if (typeof createjs === 'undefined' || !createjs.Sound) return;
    const proto = Object.getPrototypeOf(createjs.Sound);
    ['_parsePath', 'parsePath'].forEach(fn => {
        const target = createjs.Sound[fn] || (proto && proto[fn]);
        if (typeof target !== 'function' || target.__patched) return;
        const wrapped = function (src) {
            if (src == null) return null;
            try { return target.apply(this, arguments); }
            catch (e) { return null; }
        };
        wrapped.__patched = true;
        createjs.Sound[fn] = wrapped;
        if (proto && proto[fn]) proto[fn] = wrapped;
    });
}
```

`Entry.init()` 호출 직전에 실행.

### CreateJS 버전 주의

- playentry.org CDN: PreloadJS 0.6.0, EaselJS 0.8.0, SoundJS 0.6.0 (legacy).
- npm latest: PreloadJS 0.6.3, EaselJS 1.0.2, SoundJS 1.0.1.
- npm 최신으로도 엔트리 엔진은 돌아간다(API drift 작음). 완전한 바이너리 round-trip 호환이
  중요하면 playentry.org 파일을 직접 복사해서 써야 하지만, 외부 호스트 금지 규칙과 충돌.
  우리는 npm latest + 위 패치로 타협.

## 헤드리스 런타임 검증 — 이벤트 직접 dispatch

Playwright 헤드리스에서 **클릭/키 기반 게임**을 검증하려면 실제 사용자 입력을 합성해야 한다.

공용 부트 헬퍼 [`tools/lib/editor-harness.mjs`](../tools/lib/editor-harness.mjs)의 `bootEditor()` +
`loadFixture()` 를 쓰고, 아래 dispatch 패턴을 `page.evaluate` 안에서 사용.

### 클릭 — `Entry.dispatchEvent`

Entry의 클릭 처리는 [`entity.js:90`](../../entryjs/src/class/entity.js#L90)에서
`Entry.dispatchEvent('entityClick', this.entity)` 한 줄로 이벤트 버스에 쏜다.
`when_object_click` 트리거는 이 이벤트를 구독
([`block_start.js:229`](../../entryjs/src/playground/blocks/block_start.js#L229)).

따라서 Playwright `page.evaluate` 안에서:
```js
try { Entry.engine.toggleRun(); } catch (_e) { /* tickEnabled 가끔 throw, 무시 */ }
const entity = Entry.container.getAllObjects()[0].entity;
for (let i = 0; i < 10; i++) {
    Entry.dispatchEvent('entityClick', entity);
    await new Promise(r => setTimeout(r, 100));
}
// 이제 entity.x/y, 변수 값 등을 검사
```

### 다른 이벤트 일반화

| 사용자 동작 | Entry 이벤트 | 트리거 블록 |
|-------------|--------------|-------------|
| 오브젝트 클릭 | `entityClick` | `when_object_click` |
| 오브젝트 클릭 해제 | `entityClickCanceled` | `when_object_click_canceled` |
| 키 누름 | DOM KeyboardEvent → `Entry.pressedKeys[]` | `when_some_key_pressed`, `is_press_some_key` |
| 신호 보내기 | `message_cast` 블록 자체 트리거 | `when_message_cast` |

### 키 — DOM KeyboardEvent

키는 이벤트 버스가 아니라 **document DOM 리스너**로 처리되므로 별도 규칙이 필요.
자세한 규칙·근거·올바른/틀린 예는 [07-runtime-quirks.md §키 이벤트는 `document` + `event.code`](07-runtime-quirks.md#키-이벤트는-document--eventcode-로-dispatch) 참조.

간단 레퍼런스:
```js
// 단발 탭
document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight' }));
document.dispatchEvent(new KeyboardEvent('keyup',   { code: 'ArrowRight', key: 'ArrowRight' }));
```

### 관련 도구

- [`tools/inspect.mjs`](../tools/inspect.mjs) `--click N`, `--key CODE N`, `--watch N` 플래그
- [`tools/verify-platformer.mjs`](../tools/verify-platformer.mjs) — 방향키 hold + offset 변화 측정
- [`tools/verify-healthbar-brush.mjs`](../tools/verify-healthbar-brush.mjs) — 변수 setValue로 상태 직접 조작
