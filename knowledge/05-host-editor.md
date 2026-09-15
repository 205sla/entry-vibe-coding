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

## 엔진 사본의 버전 기준 — npm 핀과 실서비스의 격차

`public/lib/entry-js/`는 `scripts/setup.mjs`가 npm `@entrylabs/entry` prebuilt tarball에서 받아온다.
핀은 `scripts/setup.mjs:39` `ENTRY_NPM_VERSION_DEFAULT = '4.0.20'`.

> **`upstream/entryjs`를 pull해도 이 사본은 바뀌지 않는다.** setup은 소스 트리가 아니라 npm에서
> `dist/`를 받고, `apps/entryjs` 심볼릭 링크는 이 문서들의 소스 인용에만 쓰인다. 그래서 업스트림을
> 최신으로 당겨도 `npm run test:smoke`·런타임 동작은 그대로다. (엔진 직접 빌드는 CLAUDE.md 절대규칙 1로 금지.)

### 2026-07-31 실측 — playentry.org 실서비스와의 격차

playentry.org에는 EntryJS 4.56.0(2026년 7월 업데이트)이 배포됐지만 우리 사본(4.0.20)에는 없다.

| 7월 수정 심볼 | 실서비스 번들 | 우리 사본 |
| --- | --- | --- |
| `sanitizeCoordinate` (변수 표시창 좌표 ±10000 clamp) | 있음 | 0건 |
| `runWithScrollPreserved` (모양·소리 목록 스크롤 보존) | 있음 | 0건 |
| `_bindInputFieldFullScreenChange` (전체화면 대답 입력) | 있음 | 0건 |
| `codingboxv2` (신규 하드웨어) | 있음 | 0건 |

7월 것만 빠진 게 아니다. **5월 29일 prototype pollution Stored XSS 픽스(`668c3d6f8`)도 없다** —
번들의 `filterReservedKeywords`가 `_reservedKeywords.has(t)`로 정규화 단계가 없는 옛 형태다
(업스트림 현재 코드는 `typeof param === 'object'`일 때 `String(param)`으로 정규화한 뒤 조회).
이 저장소는 자기가 만든 `.ent`만 여는 로컬 편집기라 저장형 XSS의 전달 경로가 없지만,
npm에 새 버전이 올라와 `setup.mjs` 핀을 올릴 때 함께 해소되는 항목으로 기억해 둔다.

**현재 무해하다.** 워크스페이스 `.ent` 193개(변수 8,668개) 전수 실측에서 최대 |좌표|가 307이라
clamp 한계에 걸리는 자산이 없고, 이 저장소는 변수창 숨김을 좌표가 아니라 `visible:false` +
`hide_variable`로 처리한다.

**언제 문제가 되나**: 좌표로 변수창을 화면 밖에 숨긴 **외부 작품**을 로드할 때. 실서비스에서는
clamp돼 화면에 나타나지만 우리 사본에서는 숨은 채로 보인다 — "playentry에서만 다르게 보인다"의 원인.

**해소 조건**: 엔트리랩이 npm에 새 버전을 올려야 한다. `@entrylabs/entry` 최신 배포는
`4.0.20`(2025-05-30)이고 develop의 `package.json`은 `4.0.22`다. 새 버전이 나오면
`node scripts/setup.mjs --entry-version=<새버전>`으로 갱신하고, 이 표의 심볼을 다시 대조한다.

전체 변경 목록·판정 근거: [`upstream/지식/entryjs-4.56.0-2026-07-update.md`](../../../upstream/지식/entryjs-4.56.0-2026-07-update.md)

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
블록/이미지가 뒤섞인다. [`entryjs/src/class/container.js:285`](https://github.com/entrylabs/entryjs/blob/53e121523760f15961cd14ab7cb93563a79eaab3/src/class/container.js#L285).

기존 상태 정리의 원리와 확인 위치는 [07의 clearProject 항목](07-runtime-quirks.md#entryclearproject--loadproject-전-필수)을 따른다.

## playentry.org 배포 — 기존 작품에 `project.json` 만 갈아끼우기 (콘솔 붙여넣기)

`.ent` 를 **오프라인 작품 불러오기**로 새로 올리면 작품 id 가 새로 생겨
**조회수·좋아요·댓글이 0 부터 시작한다.** 이미 사람이 모인 작품을 개정할 때는
껍데기를 남기고 내용물만 바꿔야 한다.

`Entry.loadProject` 는 편집기 안에서 호출하면 되고 (위 §프로젝트 로드), playentry.org 의
편집기도 같은 전역 API 를 쓴다. 그래서 **브라우저 콘솔에서 project.json 을 직접 밀어넣고
저장**하면 같은 작품 id 로 내용만 교체된다.

```js
Entry.clearProject();            // ★ 필수 — 안 하면 기존 오브젝트에 덧붙는다
Entry.loadProject(project);
Entry.projectId = keptId;        // 로드가 덮어쓰므로 되돌려 놓는다 → 같은 작품으로 저장
```

절차: `playentry.org/ws/<작품id>` 열기 → F12 콘솔에 스크립트 전체 붙여넣기 → **저장**.

### 전제 — **에셋이 0 이어야 한다**

이게 이 기법의 유일한 제약이자 핵심이다.

`.ent` 는 `temp/project.json` + `temp/aa/bb/image|sound/<hash>.<ext>` 로 이루어진 tar 다
([01](01-binary-format.md)). **콘솔로 옮길 수 있는 건 JSON 하나뿐**이고 그림·소리 파일은
따라가지 않는다. picture 를 참조하는 오브젝트가 하나라도 있으면 로드 후 이미지 404 가 나고,
경우에 따라 `addChildAt(undefined)` 로 엔진이 꺼진다.

sprite 오브젝트는 **그림이 최소 1장 필요하다** — 없으면 make-ent 가 placeholder 를
tar 에 넣는다([03 §자산 자동 번들링](03-objects-and-assets.md#자산-자동-번들링-make-entmjs-동작)).
따라서 이 배포 경로를 쓰려면:

> **보이지 않아도 되는 오브젝트는 전부 `objectType: 'textBox'` 로 만든다.**

글상자는 텍스트 렌더 경로를 타서 picture 가 필요 없다. `hide`/`show`/`묻고 대답 기다리기`
모두 `isNotFor` 제한이 없어 sprite 전용이 아니다. 배경·버튼·패널도
`entity.bgColor` 를 hex 로 주면 `width × height` 사각형이 칠해지므로
([07 §textBox 클릭 영역](07-runtime-quirks.md#textbox-클릭-영역--bgcolor-에-따라-사각-전체-vs-glyph-픽셀만)
의 `updateBG`) 이미지 없이 화면을 다 짤 수 있다.

애니메이션도 **모양 바꾸기 없이** 만들 수 있다 →
[04 §글상자만으로 애니메이션](04-script-and-blocks.md#글상자만으로-애니메이션--글자-프레임--좌표--타자기).

### 생성기 쪽에서 지킬 것

빌드 스크립트에 **자립성 검사**를 넣는다. 나중에 누가 그림 한 장을 추가하면 조용히
깨지는 게 아니라 생성 자체가 거부돼야 한다.

```js
// .ent 에서 project.json 만 꺼내고, 에셋이 하나라도 있으면 거부
const assets = tarEntries.filter(e => !e.name.endsWith('project.json') && e.size > 0);
if (assets.length) throw new Error(`에셋 ${assets.length}개 — 콘솔 붙여넣기로 옮길 수 없다`);
```

추가로 챙기면 좋은 것:

| 항목 | 왜 |
| --- | --- |
| gzip + base64 로 싸기 | JSON 원문 234KB → 12KB. 콘솔 붙여넣기 한계와 스크롤 부담을 줄인다 |
| `DecompressionStream('gzip')` 로 해동 | 브라우저 내장. 외부 라이브러리 불필요 |
| `new Function(script)` 로 문법 검사 | 생성 직후 걸러낸다. 콘솔에서 SyntaxError 를 보는 것보다 낫다 |
| 서버 메타데이터 제거 | `_id`, `user`, `visit`, `likeCnt` 등 playentry 전용 필드([02 §playentry 전용](02-project-json.md#playentryorg-전용-커뮤니티-메타데이터-우리는-쓰지-않음))는 빼고 넘긴다 |
| 되돌리기 훅 | 덮어쓰기 **전에** `Entry.exportProject()` 로 원본을 떠서 `window.__restore()` 에 담아 둔다. 저장 전이면 한 줄로 복구된다 |

### 한계

- **저장을 누르는 순간 되돌릴 수 없다.** 되돌리기 훅은 그 페이지 세션에서만 산다.
- 작품 이름·설명·썸네일은 안 바뀐다(그게 목적이다). 바꾸려면 편집기 UI 로.
- 에셋이 필요한 작품은 이 경로를 못 쓴다 — 새로 업로드하거나, 에셋을 playentry 에
  먼저 올려 `fileurl` 을 받아 JSON 에 박는 수밖에 없다.

## 서버 — `/api/load` + `/api/export`

### `/api/load`: 업로드된 `.ent` → JSON

1. 멀티파트에서 파일 버퍼 받기 (`multer.memoryStorage()`)
2. `zlib.gunzipSync(buf)` → tar 버퍼
3. `extractTarFile(tarBuf, 'temp/project.json')` → JSON 파싱
4. **세션의 tar를 메모리와 서버 임시 파일에 저장** — 세션별 sid(16자). 30분 미사용 시 메모리만 정리하며, 이후 요청은 임시 파일에서 복원한다. 탭 절전·장시간 편집에도 원본 에셋은 남는다.
5. 프로젝트의 모든 `fileurl`/`thumbUrl` 리라이트:
   - `temp/aa/bb/…` → `/api/ent-asset/<sid>/temp/aa/bb/…`
   - `/...` (절대 경로) → 그대로
   - `http(s):`/`data:` → 그대로
6. 수정된 JSON 응답

### `/api/ent-asset/:sid/*`

세션 캐시에서 해당 경로의 tar 엔트리를 꺼내 스트리밍. content-type은 확장자로 결정.

`DELETE /api/ent-session/:sid`는 해당 세션의 메모리와 임시 파일을 제거한다. 편집기가 다른 작품을 성공적으로 불러오면 이전 세션을 해제한다. 나머지 임시 파일은 서버 정상 종료 때 정리한다. 강제 종료 시 OS 임시 폴더에 파일이 남을 수 있으며, 서버 재시작 후 기존 세션 복구는 지원하지 않는다. 구현: [ent-session-store.js](../lib/ent-session-store.js).

### `/api/export`: JSON → `.ent`

1. 모양·소리 주소를 해석한다. `/api/ent-asset/<sid>/...`는 세션에서, `/...`는 public에서 읽는다. `temp/...`는 요청 `__sid`로 원본에서 찾아 번들한다. 원본이 없으면 409, 주소가 없으면 422로 중단하며 편집기에 이유를 표시한다. HTTP/data 주소는 기존처럼 통과하므로 항상 자체 포함한 파일이라는 뜻은 아니다.
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

Entry의 클릭 처리는 [`entity.js:90`](https://github.com/entrylabs/entryjs/blob/53e121523760f15961cd14ab7cb93563a79eaab3/src/class/entity.js#L90)에서
`Entry.dispatchEvent('entityClick', this.entity)` 한 줄로 이벤트 버스에 쏜다.
`when_object_click` 트리거는 이 이벤트를 구독
([`block_start.js:229`](https://github.com/entrylabs/entryjs/blob/53e121523760f15961cd14ab7cb93563a79eaab3/src/playground/blocks/block_start.js#L229)).

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

## 액션 게임을 봇으로 "플레이해서" 검증하기

변수를 정답 값으로 세팅하는 검증은 로직을 안 건드린다. 실제 플레이 가능성을 확인하려면
**키 입력만으로 스테이지를 진행**해야 하는데, 그러면 봇이 사람과 같은 제약을 받는다. 실측으로
확정한 규칙들 ([`games/brick-kingdom/verify.mjs`](../games/brick-kingdom/verify.mjs) 16 시나리오).

### `page.evaluate` 왕복이 게임 시간을 잡아먹는다 — 센싱은 **한 번에**

한 번의 `page.evaluate` 가 10~15 ms = 게임 0.6~0.9 프레임. 항목마다 따로 읽으면 루프 한 바퀴가
쉽게 300 ms(18 프레임)를 넘고, 달리기 5 px/frame 이면 그 사이 **90 px** 을 지나간다.
위치·상태·앞쪽 지형·앞쪽 적을 **한 evaluate 안에서** 모아 읽는다.

```js
async function sense(page) {
    return page.evaluate(() => {
        const V   = (n) => Number(Entry.variableContainer.variables_.find(x => x.name_ === n).getValue());
        const LST = (n) => Entry.variableContainer.lists_.find(x => x.name_ === n).array_.map(o => o.data);
        // px·py·state·grounded + lvl 행 문자열까지 한 번에 → 앞쪽 구멍/벽/적을 JS 쪽에서 계산
        return { px: V('px'), py: V('py'), state: V('state'), rows: LST('lvl').map(String), /* … */ };
    });
}
```

되돌린 접근: 항목별로 읽었을 때 28 열 적에게 3 연속 사망. 밟기 직후 리스트를 4 번 나눠 읽으면
왕복 60 ms 가 10 프레임(167 ms) 잠금 창을 잡아먹어 판정 결과가 매번 뒤집혔다.

### 눌린 키는 **반대 키를 놓기 전에는** 방향이 안 바뀐다

`ArrowRight` 를 hold 한 상태로 `ArrowLeft` 를 누르면 Right 가 계속 이긴다 (게임이 두 키를
따로 검사하므로). 방향을 바꿀 때마다 전 방향을 `keyup` 하는 `release()` 를 부른다.

```js
async function release(page) {
    for (const c of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyX','KeyZ']) await up(page, c);
}
```

증상: 아이템을 쫓아가는 루프가 반대 방향으로 흘러가 구멍에 빠졌다 (`col 44 → 60`).

### 프레임 단위 잠금 창 안에는 키를 걸 수 없다

가속이 `0.074 px/frame` 이면 10 프레임 잠금 동안 이동량은 `≈ 3.7 px` 다. 접촉 판정 폭이
26 px 이면 **그 창 안에 반대편으로 갈 수 없다** — 봇이 아무리 빨라도 물리가 막는다.
이런 판정(셸 차기 방향 등)은 봇이 통제하려 하지 말고 **게임 규칙에 맞춰 상황을 만든다**
(방향을 뒤집는 대신, 가려는 방향에 표적을 미리 배치).

### 트리거 거리는 추측하지 말고 스윕한다

"적 앞 몇 px 에서 점프하나" 같은 값은 실측으로만 정해진다. 마주 걸어오는 적 기준 스윕:

| 발동 거리 | 결과 |
|---|---|
| 165 px | 일찍 뛰어 적 **앞**에 착지 → 측면 피격 사망 |
| 120 px | 3 연속 구간에서 2 회 밟기 성공 ← 채택 |
| 100 px | 늦게 뛰어 적 **뒤**에 착지 (3/3 실패) |

창이 좁은 것 자체는 게임 결함이 아니다 — 원작과 같은 정밀도다.

### 분기 우선순위: 지형이 적보다 먼저

"앞에 적이 있으면 점프" 를 지형 판정보다 먼저 두면, **닿을 수 없는 위치의 적**(언덕 위 등)에
접근하려다 벽에 붙어 영원히 멈춘다 (실측: `col=91.7` 고정, 적은 활성 범위 밖이라 얼어붙음).
`grounded && 앞 칸이 더 높음` 이면 적 분기를 건너뛴다.

### 못 한 것은 조건을 지우지 말고 근거와 함께 남긴다

봇이 못 하는 검사를 삭제·완화하면 회귀 가드가 사라진다. 대신 ① 같은 성질을 확인하는 **다른
지점**으로 검사를 옮기고(탈락시킨 후보와 이유를 주석에), ② 그래도 남는 실패는
"봇 정밀도 문제 / 게임 로직 문제" 를 **측정값으로 구분해** 문서에 적는다.
[`games/brick-kingdom/README.md`](../games/brick-kingdom/README.md) 의 실패 귀속 표가 그 형식.

### 키 hold 검증은 시나리오마다 프로세스를 격리한다

같은 프로세스에서 브라우저를 ~10 회 재부팅하면 키 이벤트가 게임에 도달하지 않는다 —
[07 §헤드리스 검증에서 브라우저를 ~10 회 재부팅하면](07-runtime-quirks.md#헤드리스-검증에서-브라우저를-10-회-재부팅하면-키-이벤트가-게임에-도달하지-않는다).
