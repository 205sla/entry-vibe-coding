# MYentry-game — 엔트리 `.ent` 작품 자동 생성기

"○○ 게임 만들어줘" 요청이 들어오면 이 저장소의 도구로 **엔트리 편집기에서 바로 실행되는
`.ent` 파일**을 생성한다. 이 문서는 그 자동화 파이프라인을 설명한다.

> 자연어 요청 → DSL `.mjs` (또는 JSON) spec → `.ent` (tar.gz) → 편집기에서 로드·실행

---

## 🚀 빠른 시작 — 엔트리 "만들기" 편집기 구성 → 첫 게임 → 테스트

> "이 저장소로 ○○ 게임 만들어줘" 를 받은 사람(또는 AI)이 **처음** 해야 할 것.
> 우리가 작업한 환경(오프라인 엔트리 편집기 + 헤드리스 검증)을 그대로 재현한다.

### 0. 전제
- **Node 18+**, **git** (git 은 entryjs 등 자동 클론에 필요)
- 헤드리스 테스트(`verify:runtime`/`test:e2e`)를 돌리려면 **Playwright Chromium**:
  ```bash
  npx playwright install chromium
  ```

### 1. 설치 + 편집기 띄우기
```bash
git clone https://github.com/205sla/entry-vibe-coding
cd entry-vibe-coding
npm install
npm run setup        # 엔트리 원본·외부 모듈·vendor 자동 구성 (아래 표) — 한 번만, idempotent
npm start            # → http://localhost:3000
```
**`http://localhost:3000` 이 곧 엔트리 "만들기" 페이지(오프라인 편집기)** — 생성한 `.ent` 를
로드·실행(▶)·수정·저장한다. 헤드리스 검증 스크립트도 이 서버에 붙어 동작한다.

### 2. 필수 외부 의존성 — `npm run setup` 이 가져오는 것

이 저장소에는 **엔트리 원본 엔진이 포함돼 있지 않다.** `setup` 이 아래를 끌어와 `public/lib/` 를 채운다
([scripts/setup.mjs](scripts/setup.mjs)):

| 의존성 | 출처 | setup 동작 |
|--------|------|-----------|
| **entryjs** (엔트리 원본 엔진·만들기 페이지) | **[github.com/entrylabs/entryjs](https://github.com/entrylabs/entryjs)** | 형제 `../entryjs` 있으면 사용, 없으면 `.setup-cache/` 로 **자동 클론** → `dist`·`extern`·`images` 복사. 블록 레지스트리 추출·소스 ground-truth 의 `src/` 도 여기 |
| entry-tool · legacy-video | entrylabs **공개** repo | `dist/develop` 브랜치 자동 클론 |
| **entry-paint · entry-lms · sound-editor** | entrylabs **내부**(공개 미러 없음) | ❌ 자동 불가 → 로컬 복사본 `../MYentry/public/lib/<pkg>` 를 링크. **없으면 setup 중단** |
| vendor (jQuery·jQuery-UI·lodash·CreateJS·Velocity·CodeMirror·React·socket.io) | npm | 임시 설치 후 dist 파일만 `public/lib/vendor/` 로 복사 + preload-js 패치 |
| mascot 이미지·커서 | `../MYentry/public/` | 복사 (없으면 스킵) |

⚠️ **유일한 블로커 — `entry-paint`/`entry-lms`/`sound-editor`**: entrylabs 비공개 패키지라 공개 클론이 안 된다.
이 셋의 로컬 복사본이 없는 **순수 외부 클론은 편집기가 완전히 부팅되지 않는다**(setup 이 명확한 에러로 중단).
→ 현재 개발 환경엔 형제 `../MYentry/public/lib/` 에 있어 setup 이 자동 링크. 외부 배포 시엔 **entrylabs 측 공개
또는 해당 패키지 사본 확보가 필요**(아래 "더 필요한 것" 참고).

### 3. 작업 사이클 (spec → `.ent` → 테스트)
```bash
node tools/make-ent.mjs tests/fixtures/spec-bounce-ball.mjs --check                       # ① 정적 검증 < 1초
node tools/make-ent.mjs tests/fixtures/spec-bounce-ball.mjs --out tests/fixtures/x.ent    # ② 빌드
npm run verify:runtime -- --filter bounce-ball                                            # ③ 헤드리스 런타임 검증
# 전체: npm run verify  (smoke + links + e2e + runtime)
```
편집기에서 눈으로 보려면 `npm start` 후 브라우저에서 생성한 `.ent` 를 불러온다. 상세 파이프라인·검증 레이어는 아래에.

---

## 무엇을 하는가

| 구성요소 | 역할 |
|----------|------|
| `tools/make-ent.mjs` | **핵심 생성기** — spec (DSL .mjs 또는 JSON) 을 받아 `.ent` 파일을 만든다. `--check` 로 빌드 없이 < 1 초 정적 검증 |
| `tools/lib/spec-dsl.mjs` | **DSL** — `setVar`, `when.run`, `obj`, `if_`, `repeat` 등 fluent helper. 8 단 중첩 JSON 회피, paramCount/슬롯 wrap 자동 |
| `tools/lib/sprite-gen.mjs` | **SVG primitive 생성** — `circle`, `rect`, `ring`, `regularPolygon`, `star`, `heart`, `shadedBall` 등 inline SVG 생성 |
| `tools/lib/game-assets.mjs` | **정적 자산 카탈로그** — `assets('ball-blue')` 등 의미 있는 이름 → fileurl. 콘텐츠 해시 dedup |
| `tools/block-registry.json` | 274 개 엔트리 블록의 type·params·statements 메타데이터 (entryjs 소스에서 AST 자동 추출) |
| `public/` | 오프라인 엔트리 편집기 — 생성된 `.ent`를 로드·수정·저장 |
| `server.js` | 편집기 백엔드 (`/api/load`, `/api/export`, `/api/ent-asset/:sid/*`) |
| `knowledge/` | `.ent` 포맷·블록·편집기·런타임 quirks·디자인 패턴·해결한 함정 위키 ([README](knowledge/README.md)) |
| `tests/fixtures/spec-*.{mjs,json}` | 21 개 예시 spec (empty ~ frontier-guard 디펜스 게임). DSL 우선 권장 |
| `tests/smoke.test.js` | 23 fixture 의 구조 검증 (tar/JSON 파싱, 블록 type 유효성, 자산 일치) |
| `tools/verify-*.mjs` | 14 fixture 의 런타임 동작 검증 (playwright + chromium): 변수 변화, 클론 카운트, 픽셀 색상, 실제 click hit-test |
| `tools/run-all-verify.mjs` | 모든 verify 일괄 실행 |
| `tests/e2e.spec.js` | 편집기 부트 + 모든 fixture 로드 시 console error 0 확인 |

---

## 파이프라인 — "게임 만들어줘" 요청이 들어오면

```
사용자 자연어 요청
        │
        ▼
  ┌────────────────────┐
  │ ① 게임 설계        │  변수 / 오브젝트 / 스크립트 구조 결정
  │   (Claude 작업)    │  → knowledge/ 참조해 패턴 고름
  └────────────────────┘   → 비슷한 fixture 부터 복제 시작
        │
        ▼
  ┌────────────────────┐
  │ ② DSL spec 작성    │  tests/fixtures/spec-<name>.mjs (DSL 권장)
  │   (.mjs 우선)      │  setVar(...), when.run(), obj(...), if_(...) 등
  └────────────────────┘   → JSON spec 도 가능 (legacy fixture 들)
        │
        ▼
  ┌────────────────────┐
  │ ③ --check 정적 검증 │  node tools/make-ent.mjs spec.mjs --check
  │   (< 1 초)         │  paramCount, 슬롯 wrap, unknown type 즉시 에러
  └────────────────────┘   → 통과하면 빌드, 실패하면 ② 로
        │
        ▼
  ┌────────────────────┐
  │ ④ make-ent 빌드    │  node tools/make-ent.mjs spec.mjs --out out.ent
  │   → .ent 파일      │  · 이미지 rasterize (sharp), 콘텐츠 해시 dedup
  └────────────────────┘   · block params 를 Entry JSON shape 로 정규화
        │                  · script 필드 JSON.stringify (이중 직렬화)
        │                  · tar(ustar portable) + gzip(memLevel: 6)
        ▼
  ┌────────────────────┐
  │ ⑤ 다층 검증         │  smoke: tar 파싱 / 블록 type 유효성 (5 초)
  │                    │  e2e: 편집기 부트 + console error 0
  │                    │  verify-runtime: 실제 게임 플레이 (playwright)
  │                    │   - 변수 변화, 클론 카운트, 픽셀 색상
  │                    │   - dispatchEvent (핸들러 로직) + mouse.click (hit-test)
  │                    │  screenshot: 시각 확인 (선택)
  └────────────────────┘
        │
        ▼
  사용자에게 .ent 파일 경로 + 설명 전달
```

**각 단계에서 참고하는 지식 문서** ([knowledge/README.md](knowledge/README.md) 의 canonical matrix 도 참조):

| 단계 | 참고 |
|------|------|
| ① 설계 | [knowledge/04-script-and-blocks.md](knowledge/04-script-and-blocks.md) — 카테고리별 블록·params + 설계 패턴 (클론, direction-as-id, 빌드 슬롯, 빔 시각화 등 25+ 패턴), [knowledge/07-runtime-quirks.md](knowledge/07-runtime-quirks.md) — Entry 엔진 함정 (60fps 틱, message fan-out, pixelPerfect, 좌표 변환 등) |
| ② spec 작성 | DSL: [`tools/lib/spec-dsl.mjs`](tools/lib/spec-dsl.mjs) — fluent helpers + JSDoc. JSON: [knowledge/02-project-json.md](knowledge/02-project-json.md), [knowledge/03-objects-and-assets.md](knowledge/03-objects-and-assets.md) |
| ③ --check | `make-ent.mjs` 의 `normalizeBlock` + registry (`tools/block-registry.json`) 기반 즉시 검증 |
| ④ 빌드 | [knowledge/01-binary-format.md](knowledge/01-binary-format.md) — tar/gzip 포맷, [knowledge/03-objects-and-assets.md](knowledge/03-objects-and-assets.md) — 자산 dedup |
| ⑤ 검증 | 실패 시 [knowledge/lessons.md](knowledge/lessons.md) (과거 해결 이슈 1줄 회귀 가드) + [knowledge/07-runtime-quirks.md](knowledge/07-runtime-quirks.md) (엔진 동작) |

---

## ① 게임 설계 — Claude가 하는 판단

요청을 받으면 다음 순서로 설계한다:

### 1-1. 오브젝트 개수·역할 정하기
- **싱글 플레이어**: 1 오브젝트만 (예: `circle-recursive`, `healthbar-brush`)
- **플레이어 + 적**: 2 오브젝트 (예: `chase-hp`)
- **플레이어 + 생성되는 장애물**: 원본 + 클론 (예: `bullethell`) — 원본 `visible: false`로 숨기고 `create_clone("self")` + `when_clone_start`
- **진행자만** (키 입력 + 내러티브): 1 오브젝트 + 여러 thread (예: `memory-ranking`)

### 1-2. 변수·리스트 식별
- **상태**: HP, 점수, 레벨, "듣는중" 같은 플래그
- **자료구조**: 리스트 — 패턴 저장, 랭킹, 인벤토리
- **공유 리스트 (`isCloud: true`)**: 랭킹처럼 여러 세션 공유하고 싶을 때

### 1-3. Thread 구조 설계
한 오브젝트 안에서 병렬 실행되는 thread:
- `when_run_button_click` — ▶ 버튼 시 1회
- `when_some_key_pressed(키코드)` — 키 눌릴 때마다 새 thread
- `when_object_click` — 오브젝트 클릭
- `when_message_cast(msg_id)` — 신호 받을 때
- `when_clone_start` — 클론 생성 시

**원칙**: 블로킹(`wait_second`, `ask_and_wait`, `repeat_inf`)이 포함된 로직은 **독립 thread로 분리**.
예: HP 깎임 + 무적 프레임(`wait_second(0.1)`)을 이동 loop과 같은 thread에 두면 이동이 멈춘다 →
별도 thread로.

### 1-4. 블록 선택
`tools/block-registry.json`에서 이름으로 검색해 param 구조 확인:
```bash
node -e "const r=require('./tools/block-registry.json').blocks;
  console.log(JSON.stringify(r['move_direction'], null, 2))"
```

자주 쓰는 블록은 [knowledge/04-script-and-blocks.md](knowledge/04-script-and-blocks.md)에 카테고리별로
정리돼 있다.

---

## ② spec 작성 — DSL `.mjs` 권장

신규 fixture 는 **DSL** 우선. 8 단 중첩 JSON 회피 + 슬롯 wrap 자동 + IDE 자동완성 + 5× 코드 압축 (Fibonacci 기준 163 줄 → 76 줄).

```js
// tests/fixtures/spec-my-game.mjs
import {
    when, repeat, if_, cmp, getVar, setVar, calc, wait,
    obj, locateXY, moveX, sendMessage,
    scene as makeScene,
} from '../../tools/lib/spec-dsl.mjs';
import { assets } from '../../tools/lib/game-assets.mjs';

export default {
    name: '내 게임',
    scenes: [ makeScene('play', '게임 화면') ],
    variables: [{ id: 'hp', name: '체력', value: '5', visible: true, x: -210, y: 110 }],
    objects: [
        obj('player', '플레이어', {
            scene: 'play',
            picture: assets('ball-blue'),
            entity: { x: 0, y: 0, scaleX: 0.4, scaleY: 0.4, direction: 90 },
            script: [
                when.sceneStart(),
                repeat.inf([
                    moveX(2),
                    if_(cmp(getVar('hp'), '<=', 0), [
                        sendMessage('lose'),
                    ]),
                ]),
            ],
        }),
    ],
};
```

DSL 의 모든 helper 는 [`tools/lib/spec-dsl.mjs`](tools/lib/spec-dsl.mjs) 상단 주석 + JSDoc 으로 문서화. SVG 그래픽이 필요하면 [`sprite-gen.mjs`](tools/lib/sprite-gen.mjs) 의 `circle`, `rect`, `ring`, `star`, `heart`, `shadedBall` 등 inline 생성 가능.

**검증된 DSL fixture (작동 reference)**:
- `spec-fibonacci.mjs` — 사용자 정의 함수 (`fn.value`, `fn.normal`)
- `spec-name-loop.mjs` — textBox + ask_and_wait 루프
- `spec-bounce-ball.mjs` — Breakout (패들·공·벽돌·클론)
- `spec-fruit-hunt.mjs` — 3×3 클론 grid + 붓 타이머
- `spec-bullet-circle.mjs` — 3 장면 + 클라우드 랭킹 + 함수
- `spec-frontier-guard.mjs` — **종합 reference**: 디펜스 게임 (다중 scene, 클론 슬롯, 메뉴, 골드, 업그레이드, brush 빔, multi-type 적, 데이터 주도 웨이브)

`spec-frontier-guard.mjs` 는 25+ 패턴 + 8 함정 회피가 한 spec 에 모여 있어 새 게임 시작 시 가장 좋은 출발점.

## ② (legacy) spec JSON — 직접 입력 형식

기존 JSON spec fixture 들도 여전히 작동. JSON 직접 작성 시:

```jsonc
{
  "name": "내 게임",
  "messages": [                           // 선택
    { "id": "round_start", "name": "라운드시작" }
  ],
  "variables": [                          // 선택
    { "id": "hp", "name": "체력", "variableType": "variable",
      "value": "100", "visible": true, "x": -220, "y": 120 }
  ],
  "lists": [                              // 변수 중 list 축약형
    { "id": "ranking", "name": "🏆 랭킹",
      "isCloud": true, "visible": true }
  ],
  "learning": "<ai-model-id>",            // 선택 (AI Learning)
  "interface": { ... },                   // 선택 (기본값 자동)
  "speed": 60,                            // 선택 (기본 60 fps)
  "objects": [
    {
      "id": "player",                     // 선택 (자동 4자 id)
      "name": "플레이어",
      "objectType": "sprite",             // sprite | textBox
      "pictures": [
        { "id": "pic1", "name": "player",
          "fileurl": "/images/mascot/bot205-hello.svg",
          "imageType": "svg",
          "dimension": { "width": 200, "height": 240 } }
      ],
      "sounds": [ ... ],                  // 선택
      "entity": { "x": 0, "y": -100, "scaleX": 0.4, "scaleY": 0.4 },
      "scene": "ab12",                    // 선택 (scenes[*].id 중 하나, 생략 시 첫 번째)
      "script": [
        [                                  // thread 1
          { "type": "when_run_button_click" },
          { "type": "move_direction", "params": [10] }
        ],
        [ ... ]                            // thread 2 (병렬)
      ]
    }
  ]
}
```

### 입력 편의 문법 — make-ent가 자동 변환

| spec에 쓰면 | `.ent`에 들어가는 형태 |
|-------------|--------------------|
| `params: [10]` | `params: [{type:"number", params:["10"]}]` |
| `params: ["hi"]` | `params: [{type:"text", params:["hi"]}]` |
| `params: [true]` | `params: [{type:"True", params:[]}]` |
| `params: [{"__field":"mouse"}]` | `params: ["mouse"]` ← **bare string** (Dropdown 필드용) |
| `fileurl: "/images/foo.svg"` | SVG → PNG rasterize → `temp/aa/bb/image/<hash>.png` 번들 |
| `scenes` 생략 | `[{id: <shortId>, name: "장면 1"}]` 자동 (랜덤 4자 id) |
| `interface` 생략 | `{canvasWidth: 640, menuWidth: 280, object: <첫 object id>}` 자동 |

### 필드(field) vs 블록(block) 슬롯 — 중요한 차이

블록의 params 슬롯은 두 종류:
- **Block 슬롯** (값을 반환하는 중첩 블록 받음): `{"type":"number","params":["10"]}` 또는 다른 블록
- **Field 슬롯** (드롭다운 문자열 바로 받음): `"mouse"`, `"player"`, `"EQUAL"`, `"speak"` 등

Field 슬롯에 `{"type":"text",...}`로 감싸면 엔진이 "text 블록의 결과값"으로 취급해서
드롭다운 매칭 실패. 반드시 **`{"__field":"<값>"}`** sentinel로 감싸 `wrapParam`이 언래핑하게.

---

## ③ make-ent.mjs 내부 — 어떻게 .ent가 만들어지나

[`tools/make-ent.mjs`](tools/make-ent.mjs) 주요 단계:

1. **`resolveLocalPath`**: `{fileurl: "/images/..."}` → `public/images/...` 절대경로
2. **`bundleOne(absPath, kind)`**: 이미지면 `sharp(buf).png()`로 rasterize, 96px 썸네일 생성, tar payload 추가
3. **`normalizeBlock`**: spec block의 params 정규화. leaf 블록(`number`/`text`/`get_variable` 등)은 재귀하지 않고 그대로 반환 (이중 래핑 방지)
4. **`wrapParam`**: primitive 값을 리터럴 블록으로 감싸거나 `__field` sentinel 언래핑
5. **`buildProject(spec)`**: 최상위 project 객체 조립 — scenes, variables, objects, interface, learning
6. **`tarHeader` + `makeTar`**: ustar portable 포맷 (mode 000755/000644, uid/gid/mtime NUL 등). 공식 npm `tar.c({portable:true})`와 동일 바이트 출력
7. **`zlib.gzipSync(tar, {memLevel: 6})`**: 공식 엔트리 문서 명시 설정

자산 해시는 공식 알고리즘 `uid(8) + puid.generate()` (npm `uid` + `puid` 패키지).

---

## ⑤ 검증 — 무엇을 체크하나

4 레이어로 누적 검증. 빠른 → 느린 순. LLM 의 자기 수정 루프 핵심.

### Layer 1. `--check` 정적 검증 (`node tools/make-ent.mjs spec.mjs --check`, < 1 초)

- 모든 블록 type 이 `block-registry.json` 에 존재
- `params.length === paramCount` (registry 와 일치)
- 슬롯 wrap 검증 (Field 슬롯에 Block 들어가는지 등)

빌드 없이 스펙 작성 직후 즉시 실행. LLM 이 수십 번 반복해도 부담 없음.

### Layer 2. smoke (`npm run test:smoke`, ~ 5 초)

각 `.ent` fixture (총 23) 에 대해:
- gunzip + tar 파싱 성공
- `temp/project.json` 존재 + JSON 파싱
- 필수 top-level 키 (`objects`, `scenes`, `variables`)
- 모든 `object.script` 가 문자열 + 파싱 가능한 2 차원 배열
- 모든 블록 `type` 이 `block-registry.json` 에 존재 (primitive 화이트리스트 예외)
- 모든 picture `fileurl` 이 tar 안 또는 public/ 아래에 실재
- `selectedPictureId` 가 그 object 의 pictures[*].id 와 매칭
- `object.scene` 이 scenes[*].id 와 매칭

### Layer 3. e2e (`npm run test:e2e`, ~ 30 초)

- 편집기 부트스트랩 시 `pageErrors === [] && consoleErrors === []`, 외부 요청 0
- 각 fixture 를 `/api/load` → `Entry.clearProject()` → `Entry.loadProject(json)` 로 로드
- `Entry.container.objects_.length > 0`, `Entry.scene.scenes_.length > 0`
- 2 초 대기 후 `_warningBlock` 가 한 개도 없는지 (블록 type·params 형태가 유효)
- round-trip export (Entry → `/api/export` → gzip 마법 숫자 확인)

### Layer 4. verify-runtime (`npm run verify:runtime`, ~ 4 분)

각 게임 fixture 에 대응하는 `tools/verify-*.mjs` 스크립트 (총 14) 가 playwright + headless chromium 으로 **실제 게임 플레이** 검증:
- 변수 / 리스트 변화 (점수 증가, 클론 카운트, hp drop 등)
- 메시지 발화 + 핸들러 동작 (race condition 회귀 가드)
- 픽셀 색상 검증 (`findColoredPixels` — 빔, 깜빡임, 그래픽)
- 클릭 hit-test — `Entry.dispatchEvent('entityClick', e)` (핸들러 로직) + `page.mouse.click(px, py)` (pixel hit-test)
- 좌표 변환 검증 (stage 논리 480×270 ↔ canvas 렌더 픽셀)

`tools/run-all-verify.mjs` 가 전체 일괄 실행 + 서버 자동 라이프사이클. `--filter <name>` 로 일부만.

### Layer 5. knowledge links (`npm run verify:links`, < 1 초)

knowledge/ 의 13 markdown 파일 간 cross-ref 검증 (300+ 링크). 깨진 앵커/경로 잡기.

### `npm run verify` — 전체

```bash
npm run verify   # smoke + verify:links + e2e + verify:runtime 순차
```

### 시각 확인 (선택)

`tools/screenshot-*.mjs` 스타일: fixture 로드 후 단계별 스크린샷 + 변수/리스트 dump 출력. 디버깅용.

---

## 실전 예시 카탈로그

`tests/fixtures/` 의 spec/`.ent` 짝 (21 spec, 23 fixture). 전체 색인은 [`tests/fixtures/README.md`](tests/fixtures/README.md) 참조.

### 기초 (JSON spec)

| fixture | 시연 패턴 |
|---|---|
| `empty` | 최소 자가완결 `.ent` |
| `move` / `variable` | 기본 블록 + 변수 + 반복 |
| `chase-hp` | 방향키 + 추적 + reach_something 충돌 + HP + 게임 오버 |
| `memory-ranking` | message_cast + 공유 리스트 + ask_and_wait + insertion sort |
| `platformer` | 시차 스크롤 + reach_something 발판 충돌 |
| `bullethell` | 3 장면 게임 (메뉴 → 플레이 → 결과) + 클론 탄막 + 메시지 |
| `healthbar-brush` | 붓 + slide 변수 + 매 프레임 erase+redraw |
| `circle-recursive` | 재귀로 매 프레임 60-segment 원 그리기 + 방향키 |
| `recursion` | 꼬리재귀 vs 반복 성능 비교 + 지수재귀 budget |
| `repeat-timing` | 60fps 암묵 틱 측정 (180회 = 3.0s) |
| `scene-custom-id` | scene id 가 `"7dwq"` 아니어도 OK 회귀 가드 |

### DSL 기반 게임 (`.mjs`)

| fixture | 시연 패턴 |
|---|---|
| `spec-fibonacci.mjs` | 사용자 정의 함수 (`function_create_value`), 꼬리 재귀 |
| `spec-name-loop.mjs` | textBox + ask_and_wait 반복 (이름 입력 → 출력) |
| `spec-textbox-click.mjs` | textBox 클릭 영역 회귀 가드 (투명 vs hex bgColor) |
| `spec-media-art.mjs` | 생김새 17 블록 종합 — 효과·모양·크기·뒤집기·z-order 동시 |
| `spec-bounce-ball.mjs` | Breakout (패들·공·18 벽돌 클론 + 메시지 충돌 반사) |
| `spec-fruit-hunt.mjs` | 3×3 클론 grid + 붓 타이머 + 점수/콤보/레벨 + 좌표로 클론 정체 판정 |
| `spec-bullet-circle.mjs` | 3 장면 + 클라우드 랭킹 + 함수 + 동적 배경 (10 객체 종합 데모) |
| **`spec-frontier-guard.mjs`** | **디펜스 게임 종합 reference** — 다중 scene + 빌드 슬롯 + 골드 + 업그레이드 + brush 빔 + multi-type 적 + splash AOE + 데이터 주도 웨이브 + direction-as-id + 25+ 패턴 + 8 함정 회피 |

신규 게임은 가장 비슷한 것부터 복사해 수정하면 빠르다. 복합 게임은 `spec-frontier-guard.mjs` 가 좋은 출발점.

---

## 처음 설치 (상세) — `npm run setup` 이 하는 일

설치 명령은 위 **🚀 빠른 시작** 참고. `setup` ([scripts/setup.mjs](scripts/setup.mjs)) 은 재실행 안전(idempotent):

1. **entryjs dist·extern·images** — `../entryjs` 형제 있으면 사용, 없으면 `.setup-cache/entryjs` 로
   [`entrylabs/entryjs`](https://github.com/entrylabs/entryjs) **자동 클론** 후 `../entryjs` 심볼릭 링크.
   (블록 레지스트리 추출·소스 ground-truth 의 `src/` 도 이 경로. knowledge 문서의 소스 인용 링크는 `../entryjs/src/...` 기준.)
2. **External modules** (entry-tool / entry-paint / entry-lms / sound-editor / legacy-video) —
   `../MYentry/public/lib/*` 우선, 없으면 공개 GitHub `dist/develop` 클론 (entry-tool · legacy-video 만 공개).
   **entry-paint·entry-lms·sound-editor 는 entrylabs 내부 → 공개 미러 없음 → 로컬 복사본 필요** (없으면 중단).
3. **Mascot 이미지 + 커서** — `../MYentry/public/images/mascot/`·`../MYentry/public/media/` 복사.
4. **Vendor npm 패키지** — jQuery / jQuery-UI / lodash / Velocity / CodeMirror / React / CreateJS 등을
   임시 설치 후 dist 파일만 `public/lib/vendor/` 로.
5. **preload-js 패치** — `;module.exports=window.createjs;` 제거 (`module is not defined` 방지).

벤더만 스킵: `npm run setup -- --skip-vendor`. entryjs 버전이 바뀌어 블록이 어긋나면 `npm run build:registry` 로 레지스트리 재생성.

### 헤드리스 테스트 준비

`verify:runtime`·`test:e2e` 는 Playwright + Chromium 으로 실제 편집기를 띄워 검증:
```bash
npx playwright install chromium     # 한 번만
```

### 외부 배포 시 "더 필요한 것" (이 개발 환경 밖)

순수 외부 클론만으로는 **편집기가 완전히 부팅되지 않을 수 있다.** 추가 확보가 필요한 것:

1. ⚠️ **entry-paint · entry-lms · sound-editor (entrylabs 비공개)** — 최대 블로커. 공개 미러가 없어
   자동 클론 불가 → entrylabs 공개본 또는 사본을 `../MYentry/public/lib/<pkg>` (또는 `public/lib/<pkg>`) 에
   두어야 setup 통과 + 편집기 부팅. (현 환경엔 형제 `../MYentry` 에 있어 자동 링크됨.)
2. **entryjs 버전 고정 (권장)** — setup 은 `entrylabs/entryjs` 최신을 클론. 블록 API 변화 시
   `block-registry.json` 과 어긋날 수 있으니 특정 태그/커밋 고정 또는 `build:registry` 재실행.
3. **Playwright Chromium** — 헤드리스 테스트용 (위).
4. **미지원** — AI Learning · 하드웨어 · 확장 블록은 playentry.org 서버 필요 → 이 편집기에선 비활성.

## 명령어 치트시트

```bash
# 의존성
npm install
npm run setup
npm run build:registry            # entryjs 업데이트 시 블록 레지스트리 재생성
npm run build:assets              # public/images/game/*.svg + manifest.json 재생성

# 개발 서버 (편집기)
npm start                         # http://localhost:3000

# spec → .ent
node tools/make-ent.mjs tests/fixtures/spec-foo.mjs --check                 # 정적 검증만 (< 1 초)
node tools/make-ent.mjs tests/fixtures/spec-foo.mjs --out tests/fixtures/foo.ent

# 검증 (4 레이어)
npm run test:smoke                # Node 스모크 (~ 5 초, 23 fixture)
npm run test:e2e                  # Playwright e2e (~ 30 초)
npm run verify:runtime            # playwright + chromium 게임 플레이 (~ 4 분, 14 fixture)
npm run verify:links              # knowledge md 간 링크 검증 (< 1 초)
npm run verify                    # 위 4 개 모두

# 일부만
node tools/run-all-verify.mjs --filter frontier-guard --keep-server
node tools/verify-frontier-guard.mjs

# Spec 트리 보기 (디버깅)
node tools/show-spec.mjs tests/fixtures/spec-foo.mjs [--object id] [--func id]
```

---

## 문제 발생 시 어디를 보나

1. **과거 해결한 버그 (가드 링크)**: [knowledge/lessons.md](knowledge/lessons.md)
2. **Entry 엔진 고유 동작**: [knowledge/07-runtime-quirks.md](knowledge/07-runtime-quirks.md)
3. **공식 문서 매핑**: [knowledge/00-official-sources.md](knowledge/00-official-sources.md) ([entrylabs/docs](https://github.com/entrylabs/docs))
4. **각 블록의 정확한 스펙**: `entryjs/src/playground/blocks/block_*.js` 직접 확인 또는 `block-registry.json`
5. **엔진 동작의 ground truth**: `entryjs/src/class/` (project.js, container.js, object.js, utils.js)
6. **바이너리 포맷**: [knowledge/01-binary-format.md](knowledge/01-binary-format.md)
7. **호스팅 (편집기) 문제**: [knowledge/05-host-editor.md](knowledge/05-host-editor.md)
8. **이력**: [knowledge/CHANGELOG.md](knowledge/CHANGELOG.md)

---

## 외부 사용자용 요약

사용자가 다음 중 하나를 요청하면 이 저장소가 소화 가능:

- "무작위로 움직이는 오브젝트 있는 게임"
- "키보드로 조작하는 캐릭터"
- "마우스 따라오는 것"
- "체력/점수가 있는 게임"
- "장애물 피하기 (클론 사용)"
- "패턴 기억 게임 / 반응속도 테스트"
- "랭킹 시스템 (닉네임 입력 + 공유 리스트)"
- "게임 오버 / 다이얼로그 / 효과음"
- **3 장면 게임** (메뉴 → 플레이 → 결과) — `start_scene` + `when_scene_start`
- **사용자 정의 함수** — `function_create_value` (값 반환) / `function_create` (절차)
- **Breakout / 벽돌깨기** 류 — 패들 + 공 + 클론 벽돌
- **3×3 클론 격자** + 클릭 정답 판정 + 시간제 + 점수/콤보
- **타워 디펜스** — 빌드 슬롯, 골드 경제, 업그레이드, 다중 웨이브, 공격 시각화 (`spec-frontier-guard.mjs`)
- **미디어 아트 / 생김새 효과** — 색·밝기·투명도 + 모양 순환 + 크기 펄스 + 뒤집기

복잡한 게임은 비슷한 reference fixture 부터 복제 시작 권장. 25+ 디자인 패턴은 [knowledge/04-script-and-blocks.md](knowledge/04-script-and-blocks.md) + 8 catastrophic 함정은 [knowledge/07-runtime-quirks.md](knowledge/07-runtime-quirks.md) 정리.

미지원:
- **AI Learning / 하드웨어 / 확장 블록**: 현재 MYentry-game 편집기에선 꺼둠 (공식 playentry.org 서버 필요)

생성된 `.ent`는 **자가완결** (이미지 · 사운드 tar 내부 번들). 어떤 엔트리 편집기에
가져가도 동작 — 이 저장소 서버 밖 (playentry.org 포함) 에서도 이미지가 깨지지 않는다.
