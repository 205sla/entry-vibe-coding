# 위키 변경 이력

날짜별로 배운 것과 어느 커밋에서 다뤘는지.

> **📍 주의 (2026-04-24 5차 이후)**: 아래 역사 항목에서 `06-gotchas.md#…` 링크는 **깨졌을 수 있음**.
> 5차에서 해당 파일이 [lessons.md](lessons.md) (해결된 버그 1줄 요약) +
> [07-runtime-quirks.md](07-runtime-quirks.md) (Entry 엔진 고유 동작) +
> 기존 04/05 문서의 해당 섹션으로 분산됐다. 각 항목의 현재 위치:
>
> - addChildAt · thumbUrl · module is not defined · `[object Object]` 등 해결된 버그 → `lessons.md`
> - boolean_and_or · 반복 60fps · 키 이벤트 dispatch → `07-runtime-quirks.md`
> - 플랫포머 발판 충돌 패턴 → `04-script-and-blocks.md §플랫포머 발판 충돌 패턴`
> - 헤드리스 런타임 검증 → `05-host-editor.md §헤드리스 런타임 검증`

## 2026-04-24 (9차) — 재귀로 매 프레임 원 그리기 (실전 적용)

8차에서 검증한 "재귀 = 60fps 틱 우회" 원리를 실전 그래픽 예제로 적용.

- [x] 새 fixture [`tests/fixtures/spec-circle-recursive.json`](../tests/fixtures/spec-circle-recursive.json) — 재귀 함수 `drawstep(n)` 으로 60-세그먼트 정다각형(≈ 원, r≈57) 을 단일 프레임 안에 그리고, 방향키로 원 중심(`cx`,`cy`) 을 이동
- [x] **메인 루프**: `repeat_inf { 키입력 → erase_all → locate_xy → set_direction(0) → start_drawing → func_drawstep(60) → stop_drawing }`. 매 반복(=프레임)마다 원을 한 번에 다시 그림. `repeat_basic` 으로 60 세그먼트를 그렸다면 1 초/원 = 1fps 였을 것 (불가능)
- [x] **재귀 함수** (`type: 'normal'`): `drawstep(n)` = if n>0 then move_direction(6); direction_relative(-6); drawstep(n-1). 60 회 재귀 → 360° 회전 → 닫힌 원
- [x] **터틀 그래픽 공식**: r = step / (2 × sin(angle/2)). step=6, angle=6° → r ≈ 57.3
- [x] [`tools/verify-circle-recursive.mjs`](../tools/verify-circle-recursive.mjs) — 픽셀 분석으로 검증:
  - 시작 시 파란 픽셀 1600 개, 가로폭 155px (캔버스 640×360, stage 480×270 비율)
  - → 화살표 hold → cx/cy 변수 증가 + 화면에서 원이 해당 방향으로 이동
  - 11 개 assertion 전부 통과, pageErrors 0
- [x] 패턴 일반화: **반복 횟수 N 이 큰 그래픽** (도형 그리기 / 누적 변환 / 다단 캐스케이드) 은 `repeat_basic` 보다 재귀가 압도적으로 적합. N=60 도 차이가 60× → 1× (60 frames vs 1 frame)

## 2026-04-24 (8차) — 꼬리 재귀가 60fps 틱을 우회함을 실측 검증

- [x] 가설 검증: **재귀 함수 호출은 반복 블록의 1 프레임/반복 지연을 우회**한다 (사용자 제시) → ✓ 실측 일치
- [x] 새 fixture [`tests/fixtures/spec-recursion.json`](../tests/fixtures/spec-recursion.json) — 동일 알고리즘 3 변형:
  - `fibtail(n, a, b)` 꼬리재귀 + accumulator
  - `fibiter(n)` 반복(`repeat_basic`) 기반
  - `fibnaive(n)` 지수재귀 (비-꼬리, `fib(n-1) + fib(n-2)`)
- [x] [`tools/verify-recursion.mjs`](../tools/verify-recursion.mjs) — fib(30) 측정: **꼬리재귀 0ms vs 반복 ~480ms** (>500× 차이). 둘 다 결과 832040 정확
- [x] **per-frame budget 관찰**: fibnaive(28) = 832K 호출 = **11.5s** wall-clock (user 체감 "멈춤"). 25→3s, 22→0.7s 로 단조 증가. Entry 의 `funcRestExecute` (rAF 분할) 가 한 프레임에 처리 가능한 호출 수를 제한
- [x] RangeError 경고 경로([`executors.js:60-62`](../../entryjs/src/playground/executors.js#L60))는 **코드상 존재**하지만 우리 환경(Entry 1.x + V8)에서는 단순 깊이만으로는 발화 어려움 — 동기 stack overflow 대신 rAF 분할이 우선 작동. 그러나 실시간 사용 불가능한 정도로 느려지는 효과는 동일 (사용자 입장에서 "멈춤")
- [x] 관련 문서: [07-runtime-quirks.md §함수 호출은 반복하기의 60fps 틱을 우회](07-runtime-quirks.md#함수-호출은-반복하기의-60fps-틱을-우회-꼬리-재귀-최적화) — 패턴 + 한계 + 실측 표

## 2026-04-24 (7차) — 사용자 정의 함수 지원 (피보나치 fixture)

- [x] 새 fixture [`tests/fixtures/spec-fibonacci.json`](../tests/fixtures/spec-fibonacci.json) — Entry의 `function_create_value` 로 정의된 반복 알고리즘 피보나치 함수. 입력은 slide 변수 (0-30), 결과는 visible 변수 + 수열 리스트
- [x] make-ent.mjs `functions[]` 정식 지원: `content` 가 array 면 자동 stringify, 각 thread 의 블록은 `normalizeBlock` 처리. `id`/`type`/`localVariables`/`useLocalVariables` 기본값
- [x] 함수 호출은 합성 타입 **`func_<함수id>`**, 파라미터 슬롯은 **`stringParam_<param4자id>`** / **`booleanParam_<id>`** — 둘 다 동적 합성이라 우리 block-registry에 안 들어감
- [x] [`tests/smoke.test.js`](../tests/smoke.test.js) `walkBlocks` 가 `func_*` / `stringParam_*` / `booleanParam_*` 패턴을 unknown으로 보지 않게 화이트리스트 추가 (`isUserDefinedFuncType`)
- [x] **함정 1 (라벨 unwrap)**: `function_field_label` 의 첫 params (라벨 텍스트) 는 bare string 필수. 일반 string 으로 두면 normalizeBlock 이 `text` 블록으로 wrap → `[object Object]` 렌더. `{"__field": "함수이름"}` sentinel 로 unwrap 강제
- [x] **함정 2 (헤드리스 재실행)**: `Entry.engine.toggleStop()` 은 async — 변수 snapshot 복원이 `Promise.all` 안에 있어 await 안 하면 다음 setValue 와 경합. 실증: fib(0)만 통과, fib(1)~ 모두 0 반환 → await 추가 후 6/6 통과
- [x] [`tools/verify-fibonacci.mjs`](../tools/verify-fibonacci.mjs) — n ∈ {0,1,2,5,10,15} 결과 + 수열 자동 검증 (12개 assertion 모두 통과)
- [x] 관련 문서: [04-script-and-blocks.md §사용자 정의 함수](04-script-and-blocks.md#사용자-정의-함수-function_create--function_create_value)

## 2026-04-24 (6차) — 3 장면 게임 패턴 (탄막 피하기)

- [x] 새 fixture [`tests/fixtures/spec-bullethell.json`](../tests/fixtures/spec-bullethell.json): 3 장면 플로우 — `menu` → `play` → `result` → `menu` 순환
- [x] 구조: `when_object_click` + `start_scene({"__field": "<scene_id>"})` 로 버튼-기반 장면 전환. 장면 간 상태는 전역 variable (`hp`, `survive`) 로 전달
- [x] 게임 메커닉: 총알 clone (create_clone + when_clone_start + see_angle_object(player) + reach_something → message_cast(hit) + delete_clone). 플레이어는 message 수신으로 HP 감소, HP ≤ 0 시 타이머 기록 + result 장면 전환
- [x] 신규 도구: [`tools/verify-bullethell.mjs`](../tools/verify-bullethell.mjs) — 4 단계 플로우 자동 검증 (menu → play → (hp=0 강제) → result → menu). 생존시간이 실제로 기록되는지 확인
- [x] **새 함정 발견**: `dialog("...", "speak")`의 text 슬롯에 **숫자 값**(또는 숫자 포함 `combine_something` 결과)을 넘기면 `this._text.replace is not a function` crash. 에러가 scene 전환까지 망가뜨림 (겉보기엔 scene이 엉뚱한 곳으로 튀는 것처럼 보임)
- [x] **회피 패턴**: 정적 문자열만 `dialog`, 동적 숫자는 `show_variable` 로 stage 표시
- [x] 관련 문서: [04-script-and-blocks.md §장면 전환](04-script-and-blocks.md#장면-전환) + [§dialog + 숫자 값 주의](04-script-and-blocks.md#주의-dialog--숫자-값)

## 2026-04-24 (5차) — knowledge 구조 개편 + gotchas 분산

지식 축적 속도가 빠르다(2일 만에 문서 13 항목). append-only 규칙으로만 가면 `06-gotchas.md`가 무한 증식 → 산업 표준 (Diátaxis + ADR 상태 관리) 참고해 재편.

- [x] **유형 분리 원칙 확립**: Reference (스키마, 자유 편집) / Guide (how-to, 자유 편집) / Runtime quirks (엔진 불변 동작, append-only) / Lessons (해결된 버그 1줄) / History (append-only) — [README.md](README.md)에 업데이트 규칙 명시
- [x] **`06-gotchas.md` 폐지** — 17개 섹션을 성격별로 분산:
  - 13개 **구조적 해결된 버그** → [lessons.md](lessons.md) 1줄 요약 + 가드 링크. 255줄 → ~15줄 (94% 축소)
  - **`boolean_and_or` short-circuit 없음** + **반복 60fps 암묵 틱** + **키 이벤트 dispatch 규칙** + **`clearProject` 필수** → [07-runtime-quirks.md](07-runtime-quirks.md) 신설
  - **플랫포머 발판 충돌 패턴** → [04-script-and-blocks.md §플랫포머 발판 충돌 패턴](04-script-and-blocks.md#플랫포머-발판-충돌-패턴-reach_something-기반)
  - **헤드리스 런타임 검증** → [05-host-editor.md §헤드리스 런타임 검증](05-host-editor.md#헤드리스-런타임-검증--이벤트-직접-dispatch)
- [x] 전 파일의 `06-gotchas.md#…` 크로스 레퍼런스 업데이트: [`02-project-json.md`](02-project-json.md), [`04-script-and-blocks.md`](04-script-and-blocks.md), [`quick-reference.md`](quick-reference.md), [루트 `README.md`](../README.md)
- [x] 역사 항목(이 CHANGELOG 자체)의 깨진 링크는 편집 대신 **파일 상단에 안내 박스** 추가 — "06-gotchas 참조는 lessons/07-runtime-quirks로 이관됨"
- [x] **주기적 Sweep 절차** 문서화 ([README.md §주기적 가지치기](README.md#주기적-가지치기-sweep--3-6개월마다)) — 3-6개월 또는 컨텍스트 리팩터 시 해결된 함정을 lessons로 압축
- [x] 총 knowledge LOC: 약 2080 → ~1700 (−18%); `06-gotchas.md` 550줄 삭제 대비 신규 파일들 총량

## 2026-04-24 (4차) — 폴더·코드 정리 리팩터 8종

저장소 전반 위생 작업. 모든 단계별로 smoke 18/18 + e2e 19/19 + lint 0 errors 확인.

- [x] **1. `.gitignore`** — `tools/inspect-*.png` → `tools/{inspect,verify}-*.png` 확장. 검증 스크립트 artifact가 커밋 대상이 되지 않도록
- [x] **2. 빈 디렉터리 제거** — `temp/`, `vendor-install/` (44MB 스크래치), `test-results/`. 전부 gitignore됨, 재생성 가능
- [x] **3. npm `tar` 제거** — 어디서도 import 안 했음 (우리 `lib/tar-portable.js` 자체 구현 사용). `npm uninstall tar` → deps 7개
- [x] **4. `known-good.ent` 역할 명시** — `tests/smoke.test.js` 상단 주석에 "spec 없는 유일한 fixture, playentry.org 실제 export 회귀 가드" 기록
- [x] **5. `lib/tar-portable.js` 중복 축약** — `extractTarFile`이 `forEachTarEntry`의 동일 파싱 루프를 두 벌 갖고 있던 걸 제거. 이제 extractTarFile은 forEachTarEntry에 early-out 콜백(`return false`)으로 구현
- [x] **6. `tools/lib/editor-harness.mjs` 신설** — chromium launch + goto editor + wait Entry + fetch /api/load + clearProject + loadProject 30+줄 보일러플레이트가 4개 스크립트(`inspect.mjs`, `verify-platformer.mjs`, `verify-repeat-timing.mjs`, `verify-healthbar-brush.mjs`)에 중복됐던 것 통합. `bootEditor()` + `loadFixture()` 두 함수
- [x] **7. `lib/asset-bundler.js` 신설** — `server.js /api/export`의 `bundleAsset`와 `tools/make-ent.mjs`의 `buildAssets.bundleOne`이 거의 동일한 SVG→PNG 래스터라이즈 + 96px 썸네일 + `temp/XX/YY/{image,thumb,sound}/` 레이아웃 로직을 각자 구현했던 것 공통 팩토리로 통합. `createAssetBundler({thumbMaxPx})` → `{ bundle, getFiles }`
- [x] **8. `docs/ent-format.md` → `knowledge/quick-reference.md` 이관** — `docs/` 디렉터리에 파일 한 개만 있고 내용도 전부 `knowledge/`를 가리키는 포인터여서 지식 이중화. `knowledge/`로 통합
- [x] 새 파일: `lib/asset-bundler.js` (~110 LOC), `tools/lib/editor-harness.mjs` (~60 LOC). 제거된 중복 코드는 약 200 LOC

## 2026-04-24 (3차) — scene id `"7dwq"` 하드코딩 제거

- [x] **정정**: 이전에 "첫 scene id는 반드시 `\"7dwq\"`여야 한다"고 적은 것은 **과한 보수적 해석**이었음. 실측 결과 `Entry.clearProject()` 선행만 보장되면 scene id는 아무 4자 영숫자 OK
- [x] 근거: `Entry.clearProject` → `Entry.scene.clear()` 가 `scenes_=[]` 과 `selectedScene=null`로 완전 리셋 ([`entryjs/src/class/scene.js:727`](../../entryjs/src/class/scene.js#L727))
- [x] 실제 playentry.org 프로젝트도 scene id가 제각각 — 사용자가 장면을 삭제·재생성하면 id 바뀜 (starter `"7dwq"` 는 첫 로드 시에만)
- [x] [`tools/make-ent.mjs`](../tools/make-ent.mjs) 변경: `specScenes || [{name:'장면 1', id:'7dwq'}]` → `[{name:'장면 1'}]`, id는 `shortId()`로 랜덤 생성
- [x] 회귀 가드 fixture: [`tests/fixtures/spec-scene-custom-id.json`](../tests/fixtures/spec-scene-custom-id.json) (`"zzzz"` id로 정상 로드 + `Entry.scene.selectedScene.id === "zzzz"` 확인)
- [x] 편집기 측 코멘트([`public/js/editor.js`](../public/js/editor.js)) 업데이트 — starter는 `"7dwq"`지만 `clearProject`가 덮어쓰므로 `.ent` 측이 맞출 필요 없다
- [x] 모든 fixture(16개) 재생성 — smoke 18/18 + e2e 19/19 (flaky 1개 재시도 통과)
- [x] 관련 문서: [06-gotchas.md §addChildAt undefined](06-gotchas.md#addchildat-undefined) 원인 1번이 `clearProject` 누락으로 승격, 이전 "7dwq 불일치" 항목은 취소선 처리 + 정정 사유 추가. [02-project-json.md §Scene](02-project-json.md#scene), [03-objects-and-assets.md], [05-host-editor.md], [README.md (wiki)], [quick-reference.md](quick-reference.md) (이전 `docs/ent-format.md`, 2026-04-24(4차)에 이관) 전부 업데이트

## 2026-04-24 (2차) — 붓(brush) 사용법 + slide 변수 실전 검증

- [x] **신규 패턴**: 매 프레임 `brush_erase_all` → 재그리기로 동적 HUD (체력바 등) 렌더. 60fps 암묵 틱(이전 항목 참조) 덕분에 자연 갱신
- [x] 붓은 sprite의 `createjs.Shape`로 별도 렌더되므로 **sprite를 `hide`해도 선은 정상 출력** — 그리는 주체를 숨기고 결과만 남기는 기법
- [x] 굵은 선 = 막대 기법: `set_thickness(20)` + `start_drawing` + `locate_xy` 두 지점 이동 = 두께 20의 가로 막대
- [x] 신규 fixture [`tests/fixtures/spec-healthbar-brush.json`](../tests/fixtures/spec-healthbar-brush.json): `variableType: 'slide'` (min 0, max 100) + 붓 반복 그리기. 녹색(남은 체력) + 빨간색(깎인 부분)
- [x] [`tools/verify-healthbar-brush.mjs`](../tools/verify-healthbar-brush.mjs) — hp={100,50,10,0}별 스크린샷 + entryCanvas 픽셀 라인 스캔으로 녹/빨 단조성 자동 검증. hp=100(녹1330/빨0) → hp=50(665/665 정확히 반반) → hp=10(130/1200) → hp=0(0/1330). 전부 통과
- [x] `calc_basic`에 `MULTI` 연산자 사용 예: `locate_xy(-100 + hp * 2, 100)` → 1픽셀당 0.5 HP 해상도
- [x] 관련 문서: [04-script-and-blocks.md §붓(brush)](04-script-and-blocks.md#붓-brush) — 블록 표 + 매 프레임 재그리기 패턴

## 2026-04-24 — 반복하기 60fps 암묵 틱 + wait_second의 실제 비용

- [x] **"반복하기" 블록(`repeat_basic`/`repeat_inf` 등)의 한 반복당 최소 1 프레임(=1/60s ≈ 16.67ms) 지연** — `Entry.FPS=60` 기본값 기준. 무거운 블록이 없으면 정확히 1 tick씩 진행
- [x] 실측: 180회 `repeat_basic { move_direction(1) }` = **2.87s** (이론값 3.00s와 일치). 새 fixture [`tests/fixtures/spec-repeat-timing.json`](../tests/fixtures/spec-repeat-timing.json)
- [x] **교정된 가설**: "반복 안의 `wait_second(0.02)`는 거의 무시 가능" → **틀림**. 같은 180회 반복이 **8.62s**로 약 3배 늘어남. 실질 반복당 ≈ 48ms (≈ 3 프레임)
- [x] **원인 두 단계**: (1) `wait_second`는 Entry.TimeWaitManager의 setTimeout이 끝난 *다음 tick*에만 `timeFlag=0` → 20ms 대기가 2 프레임 소비. (2) 타이머 종료 시 `Entry.engine.isContinue = false` ([`block_flow.js:70`](../../entryjs/src/playground/blocks/block_flow.js#L70)) → 현 tick의 남은 시간 양보 → 1 프레임 추가
- [x] **실용 지침**: 부드러운 이동이 목적이면 wait를 넣지 말고 `delta = desired_px_per_sec / 60` 로 작게 이동. wait는 게임 상태 전환 같은 의도적 일시정지에만
- [x] 신규 도구: [`tools/verify-repeat-timing.mjs`](../tools/verify-repeat-timing.mjs) — 자동 판정 (경과시간이 예상 범위 내면 `✓`)
- [x] 관련 문서: [06-gotchas.md §반복하기의 60fps 암묵 틱과 `wait_second`의 실제 비용](06-gotchas.md#반복하기의-60fps-암묵-틱과-wait_second의-실제-비용)

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
