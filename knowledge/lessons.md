# Lessons — 해결된 버그의 짧은 기록

이 저장소에서 겪었던 버그·함정 중 **구조적으로 해결되어 재발할 수 없는 것들**을
한 줄씩, 가드(guard) 링크와 함께. 재발 시 바로 관련 파일을 찾을 수 있도록.

원본 상세는 `CHANGELOG.md` 또는 `git log` 에서. 항목 포맷:
`- [YYYY-MM-DD] 증상 한 줄 — 가드: <파일:줄 or 메커니즘>`

---

## 편집기 부팅

- [2026-04-23] SoundJS `_parsePath`가 undefined src로 crash — 가드: [`public/js/editor.js`](../public/js/editor.js) `patchCreateJSSoundParsePath` (defensive wrapper)
- [2026-04-23] preload-js npm dist 말미의 `;module.exports=window.createjs;`가 브라우저에서 `module is not defined` — 가드: [`scripts/setup.mjs`](../scripts/setup.mjs) perl strip
- [2026-04-23] 하드웨어 모듈이 `ws://127.0.0.1:23518` 연결 실패 로그 스팸 — 가드: [`editor.js`](../public/js/editor.js) init option `hardwareEnable: false`
- [2026-04-23] `/images/*`와 `/lib/entry-js/images/*` 404 (Entry가 두 경로 모두 요청) — 가드: [`scripts/setup.mjs`](../scripts/setup.mjs) 양쪽에 복사
- [2026-04-23] `Entry.engine.toggleRun()`이 tickEnabled 에러로 간헐 crash (헤드리스) — 가드: [`tools/lib/editor-harness.mjs`](../tools/lib/editor-harness.mjs) try/catch 래핑

## `.ent` 로드 · 렌더

- [2026-04-23] 오브젝트 썸네일이 회색 박스 — 가드: [`lib/asset-bundler.js`](../lib/asset-bundler.js) thumbUrl 필드 생략 + PNG 래스터라이즈 (playentry 포맷 준수)
- [2026-04-23] `addChildAt(undefined)` — `interface.object=null` 또는 `script="[]"` 때문 — 가드: [`tools/make-ent.mjs`](../tools/make-ent.mjs) 기본값 (`interface.object = objects[0].id`, `script` 최소 `"[[]]"`)
- [2026-04-23] 이미지 404 (tar 업로드 시 SVG 원본 누락) — 가드: [`tools/make-ent.mjs`](../tools/make-ent.mjs) 자산 자동 번들링 (`fileurl: /…`를 `resolveLocalPath` → sharp → tar 포함)
- [2026-04-23] SVG 이미지가 playentry.org 업로드 후 안 보임 — 가드: [`lib/asset-bundler.js`](../lib/asset-bundler.js) sharp로 모든 이미지 PNG 래스터라이즈
- [2026-04-24] 첫 scene id가 `"7dwq"` 아니면 crash한다는 오래된 미신 — 정정: `clearProject()` 선행만 보장되면 무관. 가드: 회귀 fixture [`tests/fixtures/spec-scene-custom-id.json`](../tests/fixtures/spec-scene-custom-id.json) (`zzzz` id 로 로드 통과)

## 블록 스크립트

- [2026-04-23] 블록 `params` 개수가 registry와 불일치해 런타임 경고 블록 표시 — 가드: [`tests/smoke.test.js`](../tests/smoke.test.js) `walkBlocks` 검증 (registry paramCount vs spec params.length)
- [2026-04-23] 필드 슬롯 (Dropdown) 에 text 블록 넣으면 매칭 실패 — 가드: [`tools/make-ent.mjs`](../tools/make-ent.mjs) `{"__field": "x"}` sentinel → `wrapParam` 에서 bare string 으로 언래핑
- [2026-04-23] 리터럴 블록(`number`/`text`/`True` 등)의 params 가 재귀 래핑되어 `[object Object]` 렌더 — 가드: [`tools/make-ent.mjs`](../tools/make-ent.mjs) `PRIMITIVE_BLOCK_TYPES` set 으로 leaf 처리
- [2026-04-24] `dialog` 블록 text 슬롯에 숫자 값을 넘기면 `this._text.replace is not a function` crash → 이 crash가 scene 전환도 망가뜨려 디버깅 어려움 — 가드: 정적 문자열만 dialog에, 숫자는 `show_variable` 로 분리 ([04-script-and-blocks.md §dialog + 숫자 값](04-script-and-blocks.md#주의-dialog--숫자-값))
- [2026-04-25] `combine_something` paramCount=5 — Text 라벨 슬롯이 0/2/4 위치 (UI 표시용 빈 라벨), VALUE 슬롯은 1/3 — `params: [valueA, valueB]` 처럼 짧게 쓰면 padding 후 슬롯 위치가 어긋나 결합 결과 깨짐. 가드: [`tools/lib/spec-dsl.mjs`](../tools/lib/spec-dsl.mjs) `combine(a, b)` helper 가 `[null, a, null, b, null]` 으로 알맞게 펼침
- [2026-04-25] `variableType: 'answer'` 변수를 임의로 지정하면 ask_and_wait 가 답을 받지 못해 후속 setVar 가 무효 → 이후 list insert 가 빈 lookup 실패 — 가드: 사용자 변수는 일반 `'variable'` 타입으로, 별도 `variableType: 'answer'` (이름 `대답`) 변수 1 개만 두고 `get_canvas_input_value()` 로 읽어 setVar 로 옮길 것

## 클론 / 메시지 (디펜스 게임 시리즈)

- [2026-04-28] `when_message('spawn'), createClone('self')` 패턴은 기존 클론도 핸들러 보유 → 메시지 1 회 발신에 N+1 클론 지수적 spawn — 가드: spawner 가 직접 `createClone('enemy')` (다른 sprite id), 클론은 `create_clone` 트리거 없음 ([`07-runtime-quirks.md` when_message fan-out](07-runtime-quirks.md#when_message-핸들러는-클론에도-살아-있음--fan-out-spawn))
- [2026-04-28] 한 오브젝트의 다중 `when_clone_start` 가 병렬 실행 → 한 스크립트가 다른 스크립트의 init 상태에 의존하면 race — 가드: 단일 핸들러로 통합 + 매 틱 수동 step 이동 ([`07-runtime-quirks.md` 다중 when_clone_start race](07-runtime-quirks.md#다중-when_clone_start-스크립트는-병렬-실행--클론-초기화-race))
- [2026-04-28] `message_cast` 다중 리스너가 같은 frame 동시 발화 → 한 리스너가 변수 갱신, 다른 리스너가 stale 값 read — 가드: 발신자가 변수 모두 set 한 뒤 메시지 발신, 핸들러는 read-only ([`07-runtime-quirks.md` message_cast race](07-runtime-quirks.md#message_cast-핸들러는-동시-실행--같은-메시지-다중-리스너-race))
- [2026-04-29] `when_message` 핸들러가 template (direction=90) 에도 발화 → direction-as-id 패턴에서 `valueAt('list', 90)` 범위 밖 lookup → silent error 로 scene 전체 손상 (cloneCount=0, 모든 변수 reset) — 가드: 핸들러 첫 블록에 `if_(cmp(coord('self','direction'), '<=', N), [...])` ([`07-runtime-quirks.md` template 발화 가드](07-runtime-quirks.md#when_message-핸들러가-template-에도-발화--direction-as-id-시-invalid-index-lookup-으로-scene-전체-손상))
- [2026-04-28] `deleteClone()` 후 같은 스크립트 후속 블록 안 실행 (클론 컨텍스트 즉시 소멸) → sendMessage 등이 deleteClone 뒤에 있으면 무발화 — 가드: `if_else` 분기 (deleteClone 은 한 가지에만, 메시지는 다른 가지에) ([`04-script-and-blocks.md` deleteClone 함정](04-script-and-blocks.md#함정-deleteclone-후-같은-스크립트-후속-블록-안-실행))
- [2026-04-29] 다중 클론이 같은 스크립트에서 글로벌 카운터 (`bul_i` 등) 로 슬롯 list 순회 → 본체 인터리브 실행으로 카운터 0 순간에 `valueAt(list, 0)` → "can not insert value to array" 엔진 정지 — 가드: 슬롯 순회를 `fn.value` 재귀 함수로 캡슐화 (동기 호출이라 atomic) ([`07-runtime-quirks.md` 다중 클론 repeat race](07-runtime-quirks.md#다중-클론의-repeatinf-본체--글로벌-scratch-변수-race))
- [2026-05-02] 위 race 의 변종 — spawner 가 `repeat.basic(N, [changeVar(idx, 1), createClone, ...])` 로 N 클론 spawn, 각 클론의 cloneStart 가 `valueAt(list, idx)` 읽음. 여러 spawner 동시 작동 시 한쪽이 `setVar(idx, 0)` 으로 리셋한 직후 in-flight 클론이 인덱스 0 lookup → 동일 throw — 가드: 클론이 cloneStart 에서 자체 결정값 (`rand(0, 359)` 등) 으로 글로벌 lookup 회피 ([`07-runtime-quirks.md` cloneStart spawner race 변종](07-runtime-quirks.md#변종-when_clone_start-가-spawner-의-글로벌-카운터를-race-로-읽음))

## 클릭 hit-test / 좌표

- [2026-04-29] sprite 도 `pixelPerfect = true` — source 픽셀 알파 검사. ring 가운데 (transparent) 클릭 무반응 — 가드: filled circle + `setEffect('transparency', N)` 으로 시각/클릭 분리 ([`07-runtime-quirks.md` sprite pixelPerfect](07-runtime-quirks.md#sprite-도-pixelperfect--투명-픽셀-ring-가운데-등-클릭-안-됨))
- [2026-04-29] `Entry.dispatchEvent('entityClick', e)` 는 pixel hit-test 우회 → verify 통과해도 실제 사용자 클릭 실패 가능 — 가드: UI 회귀 가드는 `page.mouse.click(px, py)` + canvas 좌표 변환 ([`tools/verify-frontier-guard.mjs`](../tools/verify-frontier-guard.mjs) Step 1b)
- [2026-04-29] stage 논리 좌표 (480×270) 와 canvas 렌더 픽셀 (640×360 등) 비율 다름 → `cx = w/2 + sx` 같은 1:1 가정 매핑이 fixture 마다 어긋남 — 가드: scale 적용 (`sx * (canvas.width / 480)`) ([`07-runtime-quirks.md` stage→canvas 변환](07-runtime-quirks.md#stage-논리-좌표-vs-canvas-렌더-픽셀--clickstagepoint-변환-공식))

---

## 재발 시 재구성 절차

1. 가드 파일/줄이 **실제로 작동 중인지** 확인 (리팩터 중 제거됐을 수 있음)
2. 가드가 망가졌으면 복원 또는 동등한 보호 장치 추가
3. 새로운 실패 패턴이면 → [07-runtime-quirks.md](07-runtime-quirks.md)(Entry 엔진 고유 동작) 에 추가. 구조적으로 해결할 수 없는 활성 함정이 쌓이면 `06-gotchas.md`를 신설
4. 해결 시 이 파일에 1줄로 요약
