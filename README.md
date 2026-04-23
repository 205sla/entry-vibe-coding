# MYentry-game — 엔트리 `.ent` 작품 자동 생성기

"○○ 게임 만들어줘" 요청이 들어오면 이 저장소의 도구로 **엔트리 편집기에서 바로 실행되는
`.ent` 파일**을 생성한다. 이 문서는 그 자동화 파이프라인을 설명한다.

> 자연어 요청 → JSON spec → `.ent` (tar.gz) → 편집기에서 로드·실행

---

## 무엇을 하는가

| 구성요소 | 역할 |
|----------|------|
| `tools/make-ent.mjs` | **핵심 생성기** — JSON spec을 받아 `.ent` 파일을 만든다 |
| `tools/block-registry.json` | 274개 엔트리 블록의 type·params·statements 메타데이터 (AST 추출) |
| `public/` | 오프라인 엔트리 편집기 — 생성된 `.ent`를 로드·수정·저장 |
| `server.js` | 편집기 백엔드 (`/api/load`, `/api/export`, `/api/ent-asset/:sid/*`) |
| `knowledge/` | `.ent` 포맷·블록·편집기 관련 시행착오 지식 (위키) |
| `tests/fixtures/spec-*.json` | 예시 spec (empty ~ memory-ranking) |
| `tests/smoke.test.js` + `tests/e2e.spec.js` | 각 `.ent`가 구조적으로·런타임에 정상 동작하는지 검증 |

---

## 파이프라인 — "게임 만들어줘" 요청이 들어오면

```
사용자 자연어 요청
        │
        ▼
  ┌────────────────────┐
  │ ① 게임 설계        │  변수 / 오브젝트 / 스크립트 구조 결정
  │   (Claude 작업)    │  → knowledge/ 참조해 패턴 고름
  └────────────────────┘
        │
        ▼
  ┌────────────────────┐
  │ ② spec JSON 작성   │  tests/fixtures/spec-<name>.json
  │   (파일 생성)      │  name / variables / lists / messages / objects
  └────────────────────┘
        │
        ▼
  ┌────────────────────┐
  │ ③ make-ent.mjs 실행│  node tools/make-ent.mjs spec.json out.ent
  │   → .ent 파일      │  · 이미지 rasterize → PNG만 tar에 번들
  └────────────────────┘   · block params를 Entry JSON shape로 정규화
        │                  · tar(ustar portable) + gzip(memLevel:6)
        ▼
  ┌────────────────────┐
  │ ④ 검증             │  smoke: tar 파싱 / 필수 키 / 블록 type
  │                    │  e2e: 실제 편집기에 로드해 경고 블록 없는지
  │                    │  screenshot: 스테이지·블록 시각 확인
  └────────────────────┘
        │
        ▼
  사용자에게 .ent 파일 경로 + 설명 전달
```

**각 단계에서 참고하는 지식 문서**:

| 단계 | 참고 |
|------|------|
| ① 설계 | [knowledge/04-script-and-blocks.md](knowledge/04-script-and-blocks.md) — 카테고리별 블록·params 형태, [knowledge/06-gotchas.md](knowledge/06-gotchas.md) — 함정 미리 회피 |
| ② spec 작성 | [knowledge/02-project-json.md](knowledge/02-project-json.md) — 최상위 스키마, [knowledge/03-objects-and-assets.md](knowledge/03-objects-and-assets.md) — Object/Picture 필드 |
| ③ 생성 | `tools/make-ent.mjs`가 [knowledge/01-binary-format.md](knowledge/01-binary-format.md)의 tar 포맷을 실현 |
| ④ 검증 | 실패 시 [knowledge/06-gotchas.md](knowledge/06-gotchas.md)에서 증상으로 검색 |

---

## ① 게임 설계 — Claude가 하는 판단

요청을 받으면 다음 순서로 설계한다:

### 1-1. 오브젝트 개수·역할 정하기
- **싱글 플레이어**: 1 오브젝트만 (예: `follow-mouse`, `random-walk`)
- **플레이어 + 적**: 2 오브젝트 (예: `chase`, `chase-hp`)
- **플레이어 + 생성되는 장애물**: 원본 + 클론 (예: `dodge-poop`) — 원본 `visible: false`로 숨기고 `create_clone("self")` + `when_clone_start`
- **진행자만** (키 입력 + 내러티브): 1 오브젝트 + 여러 thread (예: `memory-pattern`, `memory-ranking`)

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

## ② spec JSON — 입력 형식

`tools/make-ent.mjs`가 받아먹는 JSON 구조:

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
      "scene": "7dwq",                    // 선택 (기본 7dwq)
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
| `scenes`가 빈 배열 | `scenes: [{id: "7dwq", name: "장면 1"}]` 자동 |
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

## ④ 검증 — 무엇을 체크하나

### smoke (`node --test tests/smoke.test.js`)
각 `.ent` fixture에 대해:
- gunzip + tar 파싱 성공
- `temp/project.json` 존재 + JSON 파싱
- 필수 top-level 키 (`objects`, `scenes`, `variables`)
- 모든 `object.script`가 문자열 + 파싱 가능한 2차원 배열
- 모든 블록 `type`이 `block-registry.json`에 존재 (primitive 화이트리스트 예외)
- 모든 picture `fileurl`이 tar 안 또는 public/ 아래에 실재
- `selectedPictureId`가 그 object의 pictures[*].id와 매칭
- `object.scene`이 scenes[*].id와 매칭

### e2e (`npx playwright test`)
- 편집기 부트스트랩 시 `pageErrors === [] && consoleErrors === []`, 외부 요청 0
- 각 fixture를 `/api/load` → `Entry.clearProject()` → `Entry.loadProject(json)`로 로드
- `Entry.container.objects_.length > 0`, `Entry.scene.scenes_.length > 0`
- 2초 대기 후 `_warningBlock`가 한 개도 없는지 (블록 type·params 형태가 유효)
- round-trip export (Entry → `/api/export` → gzip 마법 숫자 확인)

### 시각 확인 (선택)
`tools/screen-*.mjs` 스타일: fixture 로드 후 스크린샷 + DOM 텍스트에
`[object Object]` 문자열 부재 검증.

---

## 실전 예시 카탈로그

`tests/fixtures/spec-<name>.json` ↔ `tests/fixtures/<name>.ent`.

| fixture | 크기 | 시연하는 패턴 |
|---------|-----:|--------------|
| `empty` | 12 KB | 최소 자가완결 `.ent` — 1 오브젝트 + 빈 스크립트 |
| `move` | 12 KB | `when_run_button_click` → `move_direction` 단일 블록 |
| `variable` | 12 KB | 변수 + `repeat_basic` + `change_variable` + `wait_second` |
| `random-walk` | 12 KB | `repeat_inf` + `calc_rand` + `direction_relative` + `bounce_wall` |
| `follow-mouse` | 12 KB | `see_angle_object("mouse")` + `move_direction` (필드 슬롯) |
| `chase` | 24 KB | 2 오브젝트, `is_press_some_key` 방향키 입력 + 다른 오브젝트 추적 |
| `chase-hp` | 25 KB | 위 + `reach_something` 충돌 감지 + HP 변수 + 3 병렬 thread |
| `dodge-poop` | 24 KB | 클론 (`create_clone`/`when_clone_start`/`delete_clone`) + `wall_down` 감지 |
| `memory-pattern` | 13 KB | `message_cast`/`when_message_cast` + 리스트 + `wait_until_true` + 멀티 thread |
| `memory-ranking` | 13 KB | 위 + `ask_and_wait` + `combine_something` + 공유 리스트 + insertion-sort |

신규 게임은 가장 비슷한 것부터 복사해 수정하면 빠르다.

---

## 처음 설치

```bash
git clone https://github.com/205sla/entry-vibe-coding
cd entry-vibe-coding
npm install
npm run setup           # public/lib/ 와 public/images/ 재구축 (한 번만)
npm start               # → http://localhost:3000
```

`npm run setup` ([scripts/setup.mjs](scripts/setup.mjs))이 자동으로:

1. **entryjs dist·extern·images** — `../entryjs` 형제 디렉터리가 있으면 복사, 없으면
   `.setup-cache/entryjs`로 `entrylabs/entryjs` **자동 클론** 후 심볼릭 링크.
2. **External modules** (entry-tool / entry-paint / entry-lms / sound-editor / legacy-video) —
   `../MYentry/public/lib/*` 우선, 없으면 공개 GitHub 저장소에서 `dist/develop` 브랜치 클론
   (entry-tool · legacy-video만 공개). entry-paint·entry-lms·sound-editor는 entrylabs 내부
   패키지라 공개 미러가 없음 → 이 세 개는 **MYentry 같은 로컬 복사본 필요** (없으면 에러 메시지와 함께 중단).
3. **Mascot 이미지 + 커서 파일** — `../MYentry/public/images/mascot/`·`../MYentry/public/media/`에서 복사.
4. **Vendor npm 패키지** — jQuery / jQuery-UI / lodash / Velocity / CodeMirror / React / CreateJS
   등을 `vendor-install/`에 임시 설치 후 필요한 dist 파일만 `public/lib/vendor/`로 복사.
5. **preload-js 패치** — `;module.exports=window.createjs;` 접미사 제거
   (브라우저에서 `module is not defined` 방지).

재실행 안전 (idempotent). 벤더만 스킵: `npm run setup -- --skip-vendor`.

## 명령어 치트시트

```bash
# 의존성
npm install
npm run setup

# 블록 레지스트리 재생성 (entryjs 업데이트했을 때)
npm run build:registry

# 개발 서버 (편집기)
npm start                                  # http://localhost:3000

# spec → .ent
node tools/make-ent.mjs tests/fixtures/spec-foo.json tests/fixtures/foo.ent

# 검증
npm run test:smoke                         # Node 스모크
npm run test:e2e                           # Playwright
npm run verify                             # 둘 다

# 특정 fixture만 e2e
npx playwright test --grep "foo.ent"
```

---

## 문제 발생 시 어디를 보나

1. **증상별 원인 색인**: [knowledge/06-gotchas.md](knowledge/06-gotchas.md)
2. **공식 문서 매핑**: [knowledge/00-official-sources.md](knowledge/00-official-sources.md) ([entrylabs/docs](https://github.com/entrylabs/docs))
3. **각 블록의 정확한 스펙**: `entryjs/src/playground/blocks/block_*.js` 직접 확인 또는 `block-registry.json`
4. **엔진 동작의 ground truth**: `entryjs/src/class/` (project.js, container.js, object.js, utils.js)
5. **바이너리 포맷**: [knowledge/01-binary-format.md](knowledge/01-binary-format.md)
6. **호스팅 (편집기) 문제**: [knowledge/05-host-editor.md](knowledge/05-host-editor.md)
7. **이력**: [knowledge/CHANGELOG.md](knowledge/CHANGELOG.md)

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

더 복잡한 요청이면:
- **멀티 장면**: `scenes` 배열에 추가 + `start_scene` 블록 (추후 확장 시 knowledge에 기록)
- **사용자 정의 함수**: project.json의 `functions` 배열 + `function_general` 블록 (미정리 영역)
- **AI Learning / 하드웨어 / 확장 블록**: 현재 MYentry-game 편집기에선 꺼둠 (공식 playentry.org 서버 필요)

생성된 `.ent`는 **자가완결**(이미지 · 사운드 tar 내부 번들). 어떤 엔트리 편집기에
가져가도 동작 — 이 저장소 서버 밖(playentry.org 포함)에서도 이미지가 깨지지 않는다.
