# 위키 변경 이력

날짜별로 배운 것과 어느 커밋에서 다뤘는지.

## 2026-04-23 (9차) — 플랫포머 발판 충돌 패턴

- [x] `platformer.ent` 재작성 — `reach_something(block)` 기반 실제 발판-플레이어 충돌
- [x] 3 발판 다른 높이(y=-25/5/35) + ground fallback. 각 발판별 landing_y 계산식 문서화
- [x] `vy ≤ 0` 가드로 위로 점프 시 발판 아래 통과 허용 (Super Mario Bros 식 동작)
- [x] `landed` per-tick flag로 여러 발판 겹침 시 하나만 처리 (단락 평가 없는 Entry에서 필수)
- [x] 시차 스크롤과 자동 호환: 발판이 월드 offset으로 스크린에 진입하면 충돌 자동 감지
- [x] [`tools/verify-platformer.mjs`](../tools/verify-platformer.mjs) — 각 발판별 착지 y 자동 검증 (4/4 통과)
- [x] 관련 문서: [06-gotchas.md §reach_something 기반 플랫포머 발판 충돌 패턴](06-gotchas.md#reach_something-기반-플랫포머-발판-충돌-패턴)

## 2026-04-23 (8차) — 키 이벤트 dispatch 규칙 / 플랫포머 fixture

- [x] **키 이벤트는 클릭과 달리 `Entry.dispatchEvent`로 안 됨**. Entry가 `document`에
  DOM 리스너로 직접 붙어서 합성 이벤트 3가지 규칙 필요:
  (1) 타겟은 `document` (window 아님)
  (2) `event.code` (`'ArrowRight'`) — `event.keyCode`는 무시됨 (modern KeyboardEvent에서 read-only)
  (3) 누름 유지는 keydown만, 단발은 keydown+keyup 페어
  [`entryjs/src/util/utils.js:810-823`](../../entryjs/src/util/utils.js#L810)
  + `Entry.Utils.inputToKeycode` at line 860
- [x] [`tools/inspect.mjs`](../tools/inspect.mjs) `--key` 플래그 수정 — CODE_MAP으로 숫자 shorthand(37→ArrowLeft 등) 제공
- [x] [`tools/verify-platformer.mjs`](../tools/verify-platformer.mjs) — 방향키 hold 상태 시뮬레이션 레퍼런스
- [x] 새 fixture `platformer.ent` (6 오브젝트, 시차 스크롤) — 플레이어 x 고정 + 배경/블럭이 offset으로 이동, parallax factor 0.15/0.4/1.0
- [x] [06-gotchas.md §헤드리스 런타임 검증](06-gotchas.md#헤드리스-런타임-검증--이벤트-직접-dispatch-패턴) 업데이트 — 올바른/틀린 예 포함

## 2026-04-23 (7차) — 헤드리스 런타임 검증 테크닉

- [x] `Entry.dispatchEvent('entityClick', entity)` 로 프로그래매틱 클릭 시뮬레이션 가능 — Playwright 캔버스 좌표 계산 없이 `when_object_click` 트리거 동작 검증
- [x] 이벤트 이름 출처: [`entity.js:90`](../../entryjs/src/class/entity.js#L90), 구독은 [`block_start.js:229`](../../entryjs/src/playground/blocks/block_start.js#L229)
- [x] 적용: `click-teleport.ent` 게임 (10번 클릭 시 순간이동) — 1~9 클릭은 카운터만 증가, 10번째에 reset + locate_xy(rand) 정상 동작 관찰
- [x] 문서: [06-gotchas.md §헤드리스 런타임 검증](06-gotchas.md#헤드리스-런타임-검증--이벤트-직접-dispatch-패턴) — 일반화 표 포함 (entityClick / entityClickCanceled / keyPressed)
- [x] `toggleRun()`의 tickEnabled throw는 항상 터지는 게 아니라 **간헐적** — try/catch로 감싸면 이벤트 버스는 정상 셋업되어 dispatchEvent가 먹힘

## 2026-04-23 (6차) — `boolean_and_or`에 단락 평가 없음

- [x] **증상**: `repeat_while_true(pos ≤ len AND level ≤ list[pos])` 루프에서 `can not insert value to array` 런타임 에러
- [x] **원인**: Entry `boolean_and_or.func`가 `getValues(['LEFTHAND','RIGHTHAND'])`로 **두 피연산자를 먼저 모두 평가** ([`block_judgement.js:boolean_and_or`](../../entryjs/src/playground/blocks/block_judgement.js)). JavaScript `&&`의 단락 평가는 `return left && right` 시점에만 일어남. LEFT가 false여도 RIGHT의 `value_of_index_from_list(list, out_of_range)`가 먼저 throw (`block_variable.js:866`의 guard)
- [x] **해결**: AND 대신 순차 가드. `repeat_inf` 내부에 `_if(범위체크) → stop_repeat`를 먼저 두고, 두 번째 `_if(실제조건)` → 두 번째 if에 도달하면 범위 안전 보장
- [x] memory-ranking.ent의 insertion-sort 루프에 적용 — 재생성 후 smoke 6/6 + e2e 13/13 통과
- [x] 일반화: **모든 boolean 합성 연산자는 양쪽 항상 평가**. 부작용/예외 가능성이 있는 sub-expression은 nested `_if`로 반드시 분리
- [x] 관련 문서: [06-gotchas.md §`boolean_and_or`에 단락 평가 없음](06-gotchas.md#boolean_and_or에-단락-평가-short-circuit-없음--리스트-인덱스-범위-초과-크래시)

## 2026-04-23 (5차) — 공유 리스트(`isCloud`) + ask_and_wait 패턴

- [x] **make-ent.mjs 버그**: `spec.lists[]` 단축 문법 사용 시 `isCloud` 필드가 `false`로 하드코딩됨 → `!!l.isCloud`로 수정. `spec.variables[]`에서는 이미 정상 작동했음
- [x] **`ask_and_wait`** 블록 문서화 — 사용하려면 `variableType: 'answer'` 변수가 프로젝트에 선언돼 있어야 함 (엔트리 기본 프로젝트는 `대답` id=`1vu8`로 자동 포함, 우리 make-ent는 spec에 명시해야 함)
- [x] **`get_canvas_input_value`** PRIMITIVE 목록에 이미 포함 — 답변을 그대로 문자열로 반환
- [x] **`combine_something`** 이항 전용 — 3개 이상 결합은 중첩 호출 (`combine(A, combine(B, C))`)
- [x] **insertion-sort 패턴**: 2개 평행 리스트(`ranking_score` 숫자, `ranking` 표시 텍스트) + `sort_pos` 변수로 위치 탐색 + `insert_value_to_list(value, list, index)`
- [x] 관련 문서: [02-project-json.md §공유 리스트](02-project-json.md#공유-리스트-iscloud-true), [04-script-and-blocks.md §입력/문자열 조합](04-script-and-blocks.md#입력--문자열-조합)

## 2026-04-23 (4차) — 리터럴 블록 이중 래핑 버그 수정

- [x] **증상**: `[object Object]` 텍스트가 말하기·비교 블록에 표시됨
- [x] **원인**: `normalizeBlock`이 `{type:"number", params:["0"]}` 같은 value-wrapper(leaf) 블록의
  params도 재귀 `wrapParam`으로 돌려서 `"0"`을 또 `{type:"text",...}`로 감싸버림
- [x] **해결**: `PRIMITIVE_BLOCK_TYPES` = { number, text, angle, color, color_hex, True, False,
  get_variable, get_list, get_canvas_input_value, get_boolean_value }. 이들은 normalize 맨 앞에서
  leaf로 return하고 재귀하지 않음. `__field` sentinel도 여기서 언래핑 처리
- [x] `get_variable`도 PRIMITIVE 목록에 포함 — 변수 id를 verbatim 전달
- [x] 검증: 브라우저 SVG text 추출해 `[object Object]` 부재 확인. chase-hp.ent의 "0", "-1", "게임 오버!" 모두 정상 렌더
- [x] 관련 gotcha를 [06-gotchas.md](06-gotchas.md#리터럴-블록이-object-object로-표시됨)에 기록

## 2026-04-23 (3차 업데이트) — 공식 사실을 코드에 반영

`make-ent.mjs` 가 공식 문서의 사실을 따르도록 업데이트:

- [x] **파일 ID 알고리즘**을 공식 `uid(8) + puid.generate()` 로 교체 (npm `uid`, `puid` 의존성 추가).
  이전 `crypto.randomBytes → base36` 근사치는 제거. 기존 fixture 전부 재생성 — 포맷/크기 변화 없이 해시 구조만 공식 패턴.
- [x] **Variable — `variableType: 'slide'` 1급 지원**. `minValue`/`maxValue` 자동 주입.
  다른 variableType에서도 spec에 `minValue`/`maxValue`/`width`/`height`/`isRealTime`/`cloudDate`가 있으면 pass-through.
- [x] **Object — `text` 필드**. `objectType: 'textBox'`일 때 `text` 자동 emit. textBox는 blank picture fallback 생략.
- [x] **Project — `learning` pass-through**. spec에 `learning` 있으면 project 최상위에 전달.
- [x] **interface 기본값에 `menuWidth: 280`** 포함 (공식 typedef 필드).

전체 verify 통과 — smoke 6/6 + e2e 8/8.

## 2026-04-23 (2차 업데이트) — 공식 문서 반영

### entrylabs/docs 통합
- [x] 공식 문서 카탈로그 [`00-official-sources.md`](00-official-sources.md) 신설 — 공식 typedef/API 문서 직접 링크와 우리 관측 vs 공식 비교표
- [x] 파일 ID 생성 공식 알고리즘: **`uid(8) + puid.generate()`** (npm `uid` + `puid` 패키지).
  우리 `entryStyleHash()`는 외형 일치 근사치 — 공식과 호환은 되지만 통계적 속성만 다름
- [x] 공식 `tar.c` 호출이 `portable: true` 옵션 사용 — 우리 수동 헤더 생성과 동일 효과
- [x] 공식 `tar.x` 필터: 심볼릭 링크 / 파일 크기 / 확장자 체크 — 우리가 생성하는 tar에 심링크 금지

### project.json 필드 추가
- [x] `variableType: 'slide'` — 슬라이더 변수. `minValue`, `maxValue` 동반 필수
- [x] Variable에 `minValue`, `maxValue`, `width`, `height` 필드 명시
- [x] `learning` — AI Learning 모델 id (프로젝트 최상위, `Entry.aiLearning.load(project.learning)`로 소비)
- [x] `interface.menuWidth` — 블록 메뉴 폭
- [x] Object의 `text` 필드 — `objectType: 'textBox'` 전용

### Init 옵션 완전 목록
- [x] `type: 'workspace' | 'minimize'` (공식) — `'phone'`/`'playground'`는 비공식으로 판단
- [x] 25개 init 옵션 전체 표 — `objectAddable`, `objectEditable`, `sceneEditable`, `functionEnable`, `variableEnable`, `listEnable`, `aiLearningEnable`, `isForLecture`, `blockSaveImageEnable` 등
- [x] `libDir` 기본값 `/lib`, `entryDir` 기본값 `/@entrylabs/entry`
- [x] `baseUrl` — AI/API 블록용 원본 API 주소

## 2026-04-23 (1차 — 초기 지식 정리)

### 바이너리 포맷
- [x] ustar portable tar 헤더 규격 확정 (MYentry 커밋 `b79d8a9`에서 이미 확립됨)
- [x] 자산 해시는 **base36 32자** (hex 아님) — MYentry 커밋 `68a8dc4`
- [x] gzip `memLevel: 6` 명시

### project.json
- [x] 첫 scene id는 반드시 **`"7dwq"`** — Entry 내장 starter 하드코딩
  (`entryjs/src/class/project.js:82`)
- [x] `interface.object` 필수 — objects[0].id로 초기화. null이면 `addChildAt(undefined)` 크래시
- [x] `object.script`는 JSON.stringify된 문자열, 최소 `"[[]]"` (빈 thread 하나 필요)
- [x] Object에 `active` 필드 쓰지 말 것

### 오브젝트 · 자산
- [x] **playentry.org 레퍼런스 분석**: tar에 PNG만 (SVG 없음), picture에 `thumbUrl` 필드 없음,
  `imageType: "png"`. 출처: `C:\Users\young\Downloads\260423_작품.ent`
- [x] make-ent.mjs가 `fileurl: /images/...`를 자동으로 public/에서 해석해 tar에 번들
- [x] SVG는 `sharp(svg).png()`로 래스터라이즈 — tar에는 PNG만 저장
- [x] 썸네일은 같은 hash의 96px PNG (`temp/aa/bb/thumb/<hash>.png`)
- [x] Entity 기본값: regX/regY는 picture.width/2, picture.height/2
- [x] Entity.font는 sprite도 `"undefinedpx "` 문자열로

### 블록 · 스크립트
- [x] 274개 블록 type 레지스트리 AST 추출 (`tools/block-registry.json`)
- [x] Dropdown/DropdownDynamic 필드는 **bare string**, 블록으로 wrap 금지
- [x] make-ent `{"__field": "mouse"}` sentinel — wrapParam에서 언래핑
- [x] 리터럴 primitives 화이트리스트: `number, text, angle, color_hex, True, False, get_variable` 등

### 편집기 호스팅
- [x] npm `preload-js`의 `;module.exports=window.createjs;` 접미사 제거 필수
  (브라우저에서 `module is not defined`)
- [x] npm `soundjs@1.0.1`의 `_parsePath` 방어 패치 (undefined src 처리)
- [x] `Entry.init()` 옵션: `textCodingEnable: false`, `hardwareEnable: false`
- [x] **`Entry.clearProject()` 호출 없이 `loadProject`하면 오브젝트가 append됨** —
  `entryjs/src/class/container.js:285`. MYentry도 같은 패턴 사용 (`editor.js:345`)
- [x] `entryjs/images/`를 `public/images/`와 `public/lib/entry-js/images/` **양쪽**에 복사

### 검증
- [x] smoke (node --test): gunzip, tar 파싱, 필수 키, script 문자열, 블록 type 체크
- [x] e2e (playwright): 부트스트랩 + fixture 로드 + 경고 블록 체크 + round-trip export

## 최초 지식 정리 (2026-04-23)

- 위키 구조 생성: README + 6개 토픽 + CHANGELOG
- 모든 fixture가 자가완결(self-contained) 상태로 재생성
  (`empty.ent`, `move.ent`, `variable.ent`, `random-walk.ent`, `follow-mouse.ent`)

---

## 업데이트 작성 가이드

새 항목 추가 시:
```markdown
## YYYY-MM-DD

### 토픽 (01-binary-format / 02-project-json / ...)
- [x] 배운 것 한 줄 요약 — 관련 파일/커밋 링크
```

해결 실패로 끝난 건도 기록:
```markdown
- [ ] ~~시도한 것~~ — 안 됐음. 사유: ...
```
