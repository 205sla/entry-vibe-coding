# Lessons — 해결된 버그의 짧은 기록

이 저장소에서 겪었던 버그·함정 중 **구조적으로 해결되어 재발할 수 없는 것들**을
한 줄씩, 가드(guard) 링크와 함께. 재발 시 바로 관련 파일을 찾을 수 있도록.

원본 상세는 `CHANGELOG.md` 또는 `git log` 에서. 항목 포맷:
`- [YYYY-MM-DD] 증상 한 줄 — 가드: <파일:줄 or 메커니즘>`

---

## 편집기 부팅

- [2026-09-17] 아래 2026-04-23의 SoundJS 래퍼·preload-js strip은 폐기됐다. 현재 가드는 [공식 오디오 설치·검증](15-audio-verification.md)이며 예외를 무시한 부팅은 무음을 숨겼다.
- [2026-09-17] Git Bash 설치·저장소 밖 링크·Brick Kingdom 봇 실패 — 재현과 가드: [17 콜드 클론](17-cold-clone.md#재발-방지-검사).
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
- [2026-07-31] **값함수 호출을 문장 위치에 두면 `.ent` 가 아예 로드 불가** — `Entry.loadProject` 안에서 `appendChild ... parameter 1 is not of type 'Node'` TypeError. `--check` 통과 + 빌드 성공 + console 단서 없음의 3중 침묵이라 bisect 없이는 원인 특정 불가. 반환값이 필요 없어도 값 슬롯에 넣어야 한다 (`setVar('sink', call('st', …))`) — 가드: [`tools/make-ent.mjs`](../tools/make-ent.mjs) `validateSpec` 의 `walkStatement` 가 statement 위치의 `func_<id>`(type `value`)를 L1 error 로 잡는다
- [2026-04-24] 첫 scene id가 `"7dwq"` 아니면 crash한다는 오래된 미신 — 정정: `clearProject()` 선행만 보장되면 무관. 가드: 회귀 fixture [`tests/fixtures/spec-scene-custom-id.json`](../tests/fixtures/spec-scene-custom-id.json) (`zzzz` id 로 로드 통과)

## 블록 스크립트

- [2026-04-23] 블록 `params` 개수가 registry와 불일치해 런타임 경고 블록 표시 — 가드: [`tests/smoke.test.js`](../tests/smoke.test.js) `walkBlocks` 검증 (registry paramCount vs spec params.length)
- [2026-04-23] 필드 슬롯 (Dropdown) 에 text 블록 넣으면 매칭 실패 — 가드: [`tools/make-ent.mjs`](../tools/make-ent.mjs) `{"__field": "x"}` sentinel → `wrapParam` 에서 bare string 으로 언래핑
- [2026-04-23] 리터럴 블록(`number`/`text`/`True` 등)의 params 가 재귀 래핑되어 `[object Object]` 렌더 — 가드: [`tools/make-ent.mjs`](../tools/make-ent.mjs) `PRIMITIVE_BLOCK_TYPES` set 으로 leaf 처리
- [2026-04-24] `dialog` 블록 text 슬롯에 숫자 값을 넘기면 `this._text.replace is not a function` crash → 이 crash가 scene 전환도 망가뜨려 디버깅 어려움 — 가드: 정적 문자열만 dialog에, 숫자는 `show_variable` 로 분리 ([04-script-and-blocks.md §dialog + 숫자 값](04-script-and-blocks.md#주의-dialog--숫자-값))
- [2026-04-25] `combine_something` paramCount=5 — Text 라벨 슬롯이 0/2/4 위치 (UI 표시용 빈 라벨), VALUE 슬롯은 1/3 — `params: [valueA, valueB]` 처럼 짧게 쓰면 padding 후 슬롯 위치가 어긋나 결합 결과 깨짐. 가드: [`tools/lib/spec-dsl.mjs`](../tools/lib/spec-dsl.mjs) `combine(a, b)` helper 가 `[null, a, null, b, null]` 으로 알맞게 펼침
- [2026-04-25] `variableType: 'answer'` 변수를 임의로 지정하면 ask_and_wait 가 답을 받지 못해 후속 setVar 가 무효 → 이후 list insert 가 빈 lookup 실패 — 가드: 사용자 변수는 일반 `'variable'` 타입으로, 별도 `variableType: 'answer'` (이름 `대답`) 변수 1 개만 두고 `get_canvas_input_value()` 로 읽어 setVar 로 옮길 것

- [2026-06-04] 검색 자동완성이 **긴 문자열 입력 시** "can not insert value to array" 크래시 (편집기가 `repeat` 블록 빨갛게 표시) — `updateSuggestions` 의 `repeat 100`(반복=1프레임 양보)이 빠른 키 입력마다 동시 실행돼 전역 카운터 `si` 가 100 초과 → list 범위 밖. **클론 아닌** 이벤트 핸들러 재발화 race — 가드: 순회를 동기 재귀 `fn.value`(`scanSug`)로 위임 ([`07-runtime-quirks.md` repeat 글로벌 race](07-runtime-quirks.md#다중-클론의-repeatinf-본체--글로벌-scratch-변수-race))

- [2026-06-17] 글상자(textBox)에 투명도/효과(`set_effect`/`add_effect` `'transparency'`)를 적용하면 `Cannot set properties of undefined (setting 'alpha')` 런타임 에러로 **엔진 전체가 정지** — 같은 프레임의 다른 오브젝트 스크립트·키 이벤트(`when_some_key_pressed`)까지 멈춘다(증상이 엉뚱한 곳에 나타나 디버깅 어려움). textBox 의 textObject 는 sprite 처럼 effect 대상 객체가 없음. 가드: textBox 는 **색/`show`·`hide`** 로만 연출, 페이드 전환은 **sprite 풀스크린 오버레이**의 transparency 로 ([`games/online-match/spec.mjs`](../games/online-match/spec.mjs) `fader`)
- [2026-07-31] 플랫포머에서 **가속도 < 기어가기 스냅 임계값**이면 캐릭터가 영원히 안 움직인다 — `vx += ACCEL(0.074)` 직후 `if |vx| < MIN_SPEED(0.10) → vx = 0` 이 매 프레임 되돌려서 `vx` 가 항상 0. 키 입력·물리 함수·충돌 전부 정상인데 위치만 안 바뀌므로 원인이 엉뚱한 곳(입력 블록·히트박스)으로 보인다. 기어가기 방지는 **마찰 분기 안에서 부호가 바뀌는 순간 0 으로** 클램프해 처리하고, 가속 경로에는 스냅을 걸지 않는다 — 가드: [`games/brick-kingdom/spec.mjs`](../games/brick-kingdom/spec.mjs) `horizontalPhysics` 말미 주석 + `verify.mjs` 의 좌우 이동 Δ 측정
- [2026-07-31] 여러 오브젝트가 각자 `repeat.inf` 를 돌 때 **글로벌 스크래치 변수 한 개를 여러 용도로 돌려쓰면** 프레임 중간에 서로 덮어쓴다 (한 오브젝트의 카메라 계산이 다른 오브젝트의 "최대 속도" 스크래치를 클로버). 클론이 아니어도 발생하는 [글로벌 scratch race](07-runtime-quirks.md#다중-클론의-repeatinf-본체--글로벌-scratch-변수-race) 의 2-오브젝트 변형 — 가드: 스크래치는 **용도별 전용 변수**로 (`cam_tmp`/`box_h`/`max_spd`/`accel`/`grav`/`bumped`/`tile_ch`/`shape`), 스레드 경계를 넘는 값은 이름에 소유 스레드를 남긴다
- [2026-07-31] 문자열 타일맵에서 캐릭터가 맵 경계로 나가면 **물리 스레드만 조용히 죽는다** — `char_at`/`substring` 이 범위 밖에서 값이 아니라 `throw` 하고([07 §char_at·substring throw](07-runtime-quirks.md#char_at--substring-은-범위를-벗어나면-throw--문자열-타일맵에-가드-필수)), 예외는 그 스레드만 정지시켜 "화면은 살아 있는데 조작이 안 먹는" 증상이 된다. `and_` 는 단락 평가가 없어 `and_(r>=0, r<ROWS, …)` 로 묶으면 이미 평가돼 던진다 — 가드: 좌표→문자 함수에서 **중첩 `if_`** 로 한 조건씩 검사하고 밖이면 상수 반환 ([`games/brick-kingdom/spec.mjs`](../games/brick-kingdom/spec.mjs) `fnTileAt` — 기본값 `'#'`)
- [2026-07-31] 타일 한 칸을 `replace_string` 으로 바꾸면 **그 행의 같은 문자가 전부** 바뀐다 (`split(old).join(new)` 구현) — 벽돌 하나를 깨면 행 전체가 사라진다. 가드: `substring` 좌/우 + `combine` 으로 교체 ([`games/brick-kingdom/spec.mjs`](../games/brick-kingdom/spec.mjs) `fnSetTile`)
- [2026-07-31] AABB 충돌에서 `py` 를 **발 위치(하단 경계 배타적)** 로 정의하면 하단 샘플을 `py` 로 잡는 순간 `quotient(py, TILE)` 이 지면 행을 가리켜 "항상 충돌" → **걷기가 아예 멈춘다**. 가드: 하단 샘플은 `py - 1`, 상단은 `py - h` ([`games/brick-kingdom/spec.mjs`](../games/brick-kingdom/spec.mjs) `fnBoxHits` 주석)
- [2026-07-31] 한 Node 프로세스에서 편집기를 ~10 회 재부팅하면 **키 이벤트가 게임에 도달하지 않는다**(클릭은 계속 먹음) — 게임이 아니라 하네스 누적 문제이고 단독 실행하면 통과한다. 가드: 키 hold 검증은 시나리오마다 자식 프로세스로 격리 ([`games/brick-kingdom/verify.mjs`](../games/brick-kingdom/verify.mjs) `runAllIsolated`, [07 §브라우저 ~10 회 재부팅](07-runtime-quirks.md#헤드리스-검증에서-브라우저를-10-회-재부팅하면-키-이벤트가-게임에-도달하지-않는다))
- [2026-07-31] 타일 배율을 바꿀 때(brick-kingdom TILE 32→24) 실패가 아니라 **단정이 헐거워져서 통과하는** 쪽이 더 위험하다 — verify 가 `TILE`/`MAX_FALL` 사본을 들고 있으면 `MAX_FALL` 이 9 로 줄어도 `maxVy <= 12.01` 이 그냥 통과해 아무것도 안 지킨다. 속도·중력만 배율을 곱하고 **길이 상수**(히트박스·서브스텝·카메라 스텝·활성 범위·`ROW0_Y`)를 놓치는 것도 같은 계열 — 가드: 배율은 `S` 하나에서 `L=(b)=>Math.round(b*S)` 로 유도([`games/brick-kingdom/physics.mjs`](../games/brick-kingdom/physics.mjs)), verify 는 게임 모듈에서 `TILE`/`GROUND`/`ROWS`/`PHYS` 를 import 하고 `page.evaluate` 에는 인자로 넘긴다 ([04 §타일 크기는 한 곳에서 유도](04-script-and-blocks.md#타일-크기는-한-곳에서-유도한다--검증-코드까지))
- [2026-06-17] textBox `textAlign` 상수가 직관과 반대 — **0=center / 1=left / 2=right** (`entry.js` `TEXT_ALIGN_CENTER=0`). `textAlign:1` 로 두면 좌측정렬돼 가운데로 안 옴. center 정렬은 `alignTextBox` 가 `textObject.x=0`(엔티티 로컬 원점)으로 두므로 `regX:0` 이면 stage x 에 중앙배치되고, `lineBreak:true` 로 width 자동축소를 막아야 안정적. 가드: [`tests/fixtures/spec-textbox-click.mjs`](../tests/fixtures/spec-textbox-click.mjs) 주석 정정 + [`games/online-match/spec.mjs`](../games/online-match/spec.mjs) `tbox`

## 클론 / 메시지 (디펜스 게임 시리즈)

- [2026-04-28] `when_message('spawn'), createClone('self')` 패턴은 기존 클론도 핸들러 보유 → 메시지 1 회 발신에 N+1 클론 지수적 spawn — 가드: spawner 가 직접 `createClone('enemy')` (다른 sprite id), 클론은 `create_clone` 트리거 없음 ([`07-runtime-quirks.md` when_message fan-out](07-runtime-quirks.md#when_message-핸들러는-클론에도-살아-있음--fan-out-spawn))
- [2026-04-28] 한 오브젝트의 다중 `when_clone_start` 가 병렬 실행 → 한 스크립트가 다른 스크립트의 init 상태에 의존하면 race — 가드: 단일 핸들러로 통합 + 매 틱 수동 step 이동 ([`07-runtime-quirks.md` 다중 when_clone_start race](07-runtime-quirks.md#다중-when_clone_start-스크립트는-병렬-실행--클론-초기화-race))
- [2026-04-28] `message_cast` 다중 리스너가 같은 frame 동시 발화 → 한 리스너가 변수 갱신, 다른 리스너가 stale 값 read — 가드: 발신자가 변수 모두 set 한 뒤 메시지 발신, 핸들러는 read-only ([`07-runtime-quirks.md` message_cast race](07-runtime-quirks.md#message_cast-핸들러는-동시-실행--같은-메시지-다중-리스너-race))
- [2026-04-29] `when_message` 핸들러가 template (direction=90) 에도 발화 → direction-as-id 패턴에서 `valueAt('list', 90)` 범위 밖 lookup → silent error 로 scene 전체 손상 (cloneCount=0, 모든 변수 reset) — 가드: 핸들러 첫 블록에 `if_(cmp(coord('self','direction'), '<=', N), [...])` ([`07-runtime-quirks.md` template 발화 가드](07-runtime-quirks.md#when_message-핸들러가-template-에도-발화--direction-as-id-시-invalid-index-lookup-으로-scene-전체-손상))
- [2026-04-28] `deleteClone()` 후 같은 스크립트 후속 블록 안 실행 (클론 컨텍스트 즉시 소멸) → sendMessage 등이 deleteClone 뒤에 있으면 무발화 — 가드: `if_else` 분기 (deleteClone 은 한 가지에만, 메시지는 다른 가지에) ([`04-script-and-blocks.md` deleteClone 함정](04-script-and-blocks.md#함정-deleteclone-후-같은-스크립트-후속-블록-안-실행))
- [2026-04-29] 다중 클론이 같은 스크립트에서 글로벌 카운터 (`bul_i` 등) 로 슬롯 list 순회 → 본체 인터리브 실행으로 카운터 0 순간에 `valueAt(list, 0)` → "can not insert value to array" 엔진 정지 — 가드: 슬롯 순회를 `fn.value` 재귀 함수로 캡슐화 (동기 호출이라 atomic) ([`07-runtime-quirks.md` 다중 클론 repeat race](07-runtime-quirks.md#다중-클론의-repeatinf-본체--글로벌-scratch-변수-race))
- [2026-05-02] 위 race 의 변종 — spawner 가 `repeat.basic(N, [changeVar(idx, 1), createClone, ...])` 로 N 클론 spawn, 각 클론의 cloneStart 가 `valueAt(list, idx)` 읽음. 여러 spawner 동시 작동 시 한쪽이 `setVar(idx, 0)` 으로 리셋한 직후 in-flight 클론이 인덱스 0 lookup → 동일 throw — 가드: 클론이 cloneStart 에서 자체 결정값 (`rand(0, 359)` 등) 으로 글로벌 lookup 회피 ([`07-runtime-quirks.md` cloneStart spawner race 변종](07-runtime-quirks.md#변종-when_clone_start-가-spawner-의-글로벌-카운터를-race-로-읽음))

## 장면 / 초기화

- [2026-06-04] 랜딩(첫) 장면 오브젝트의 init 을 `when_scene_start` 에만 걸면 시작 시 안 돎 (실행 시작은 `when_run_button_click` 만 발화, `when_scene_start` 는 `start_scene` 전환에서만 — engine.js:662 / block_start.js:631) → 변수 미설정('0')으로 로직 붕괴 — 가드: `when.run`+`when.sceneStart` 이중 트리거(`dualStart`), [`games/es-hangul/demo.mjs`](../games/es-hangul/demo.mjs) ([`07-runtime-quirks.md` when_scene_start 첫 장면](07-runtime-quirks.md#when_scene_start-는-시작-시-첫-장면에서-발화-안-함--start_scene-전환에서만))

- [2026-08-15] 장면을 다시 들어가면 다른 오브젝트의 `when_scene_start` 가 **지난 판의 `$승자`** 를 먼저 읽어 1.3 초 뒤 결과 장면으로 튐(오브젝트 간 실행 순서 미보장) → 두 번째 대국이 저절로 끝남. 짧은 판은 우연히 통과해 늦게 드러난다 — 가드: 장면 전환을 일으키는 쪽에서 미리 초기화(`resetGame()`), 재진입 후 지연보다 길게 기다려 장면 유지 확인 ([`games/hexo/verify.mjs`](../games/hexo/verify.mjs) §6, [`07` 장면 재진입 순서](07-runtime-quirks.md#장면을-다시-들어가면-when_scene_start-들이-지난-판의-값을-먼저-읽는다))

- [2026-09-01] **장면 재진입에 `자신의 다른 코드 멈추기` 가드를 넣었다가 뺐다** — `Code.raiseEvent` 가 무조건 새 Executor 를 push 하는 것만 보고 "왕복하면 루프가 2개가 된다" 고 추론했으나, `selectScene` 첫 줄의 `resetSceneDuringRun()` 이 **떠나는 장면의 실행기를 이미 지운다**. 실측(재진입 3회 후 오브젝트당 실행기 1개)으로 뒤집었다 — 가드: [`tools/verify-textbox-layout.mjs`](../tools/verify-textbox-layout.mjs) §④ 가 `script.executors.length` 를 직접 세어 전제를 지킨다. 대신 `entity.reset()` 이 함께 도므로 **좌표 연출은 장면 진입 때마다 다시 잡아야 한다** ([07 §장면 재진입 실행기](07-runtime-quirks.md#장면을-다시-들어가도-실행기는-쌓이지-않는다--대신-entityreset-이-좌표를-되돌린다))

## 클릭 hit-test / 좌표

- [2026-08-15] 글상자에 효과 블록(`setEffect('transparency', …)`)을 걸면 `Cannot set properties of undefined (setting 'alpha')` 로 스레드 사망 — 엔트리가 `entity.effect` 를 **sprite 분기에서만** 초기화(entity.js:42-48). 증상은 "다른 오브젝트의 버튼이 안 눌린다" 로 나타난다 — 가드: 잠김/열림을 오브젝트 2개의 show/hide 로 표현, 두 버튼의 `visible` 을 단언 ([`games/hexo/verify.mjs`](../games/hexo/verify.mjs) §1, [`07` 효과 블록과 글상자](07-runtime-quirks.md#효과-블록change_effect_amount-등을-글상자에-걸면-스레드가-죽는다))
- [2026-08-15] 한 프레임에 만든 클론들이 `when_clone_start` 에서 전역을 읽으면 **전부 마지막 값에 겹쳐** 그려짐(클론 수는 정상 → 숫자 검증으로 안 잡힘) — 가드: 템플릿을 목표 자리·모양으로 맞춘 뒤 복제(상속), 좌표 집합 크기 `new Set(...).size` 단언 ([`games/hexo/verify.mjs`](../games/hexo/verify.mjs) §7, [`07` 엔티티 상속](07-runtime-quirks.md#회피-패턴-2--엔티티-상속으로-넘기기-자리모양이-목적일-때))

- [2026-04-29] sprite 도 `pixelPerfect = true` — source 픽셀 알파 검사. ring 가운데 (transparent) 클릭 무반응 — 가드: filled circle + `setEffect('transparency', N)` 으로 시각/클릭 분리 ([`07-runtime-quirks.md` sprite pixelPerfect](07-runtime-quirks.md#sprite-도-pixelperfect--투명-픽셀-ring-가운데-등-클릭-안-됨))
- [2026-04-29] `Entry.dispatchEvent('entityClick', e)` 는 pixel hit-test 우회 → verify 통과해도 실제 사용자 클릭 실패 가능 — 가드: UI 회귀 가드는 `page.mouse.click(px, py)` + canvas 좌표 변환 ([`tools/verify-frontier-guard.mjs`](../tools/verify-frontier-guard.mjs) Step 1b)
- [2026-04-29] stage 논리 좌표 (480×270) 와 canvas 렌더 픽셀 (640×360 등) 비율 다름 → `cx = w/2 + sx` 같은 1:1 가정 매핑이 fixture 마다 어긋남 — 가드: scale 적용 (`sx * (canvas.width / 480)`) ([`07-runtime-quirks.md` stage→canvas 변환](07-runtime-quirks.md#stage-논리-좌표-vs-canvas-렌더-픽셀--clickstagepoint-변환-공식))

## 글상자 / 화면 레이아웃

- [2026-09-01] **글상자에 글이 안 보인다** — spec 의 entity 를 `{x, y}` 만 줬더니 make-ent 의 sprite 기본값 `font: 'undefinedpx '` 가 들어가 `parseFloat` → `fontSize` NaN → 캔버스가 `NaNpx` 를 파싱 못 해 브라우저 기본 10px 로 그렸다. 여기에 `lineBreak` 가 없어 한 줄로 화면 밖까지 뻗어 "문장 가운데 토막만 아주 작게" 보였다. 에러·경고 없음 — 가드: 보이는 글상자를 만드는 헬퍼가 `font`/`fontSize`/`lineBreak`/`width`/`height`/`textAlign`/`scaleX/Y`/`colour`/`bgColor`/`visible` 을 전부 채운다. 회귀 가드 [`tools/verify-textbox-layout.mjs`](../tools/verify-textbox-layout.mjs) §① 이 함정을 픽스처로 재현·단언 ([07 §fontSize NaN](07-runtime-quirks.md#글상자-entity-를-비워두면-fontsize-가-nan--글자가-10px-로-쪼그라든다))
- [2026-09-01] **`묻고 대답 기다리기` 를 쓰는 장면에서 하단 글상자가 통째로 안 보임** — 입력칸(`stage.js _createInputField`, 캔버스 y 275 + 세로 54px)이 엔트리 좌표 **−71 ~ −112** 를 덮는다. 좌표도 `visible` 도 정상이라 원인이 안 보인다 — 가드: 세로 예산을 `135 ~ −71` 로 잡는다. [`tools/verify-textbox-layout.mjs`](../tools/verify-textbox-layout.mjs) §③ 이 입력칸 윗변(−71.3)·아랫변(−111.8)을 실제로 재서 단언 ([07 §묻기 입력칸](07-runtime-quirks.md#묻고-대답-기다리기--입력칸이-무대-아래-71-부터를-덮고-말풍선은-hide-로-안-사라진다))
- [2026-09-01] **`묻기` 말풍선이 `hide()` 로 안 사라짐** — `syncDialogVisible()` 은 `setVisible` 이 호출될 때만 도는데 말풍선은 그 뒤에 생겨 `visible: true` 로 태어난다 — 가드: 묻는 오브젝트를 `entity.x: 500` (무대 **오른쪽** 밖)으로. `dialog.ts` 의 `w` 가지가 `Math.max` 라 위쪽 clamp 가 없어 무대 밖으로 나간다. `x: -500` 은 `Math.min` 에 걸려 안 통한다. [`tools/verify-textbox-layout.mjs`](../tools/verify-textbox-layout.mjs) §③ 이 말풍선 x ≈ 412 를 단언 ([07 §말풍선](07-runtime-quirks.md#묻고-대답-기다리기--입력칸이-무대-아래-71-부터를-덮고-말풍선은-hide-로-안-사라진다))
- [2026-09-02] **기존 `.ent` 의 글상자 문구를 바꿨는데 화면이 그대로** — 글상자 문자열은 `object.text` 와 **`entity.text`** 두 곳에 있고 엔진이 그리는 건 후자다. 앞의 것만 고치면 tar·JSON 구조 검사를 전부 통과하면서 화면만 안 바뀐다(에러·경고 없음). 런타임에 `text_write` 로 덮는 글상자면 세 번째 출처(블록 파라미터)도 있다 — 가드: 고칠 때 **둘 다** 쓰고, 검증에 `object.text === entity.text` 전수 확인 + **무대 렌더 문자열 대조**를 넣는다. 구조 검사만으로는 절대 안 잡힌다 ([`03` §글상자 문자열 두 곳](03-objects-and-assets.md#️-글상자-문자열은-objecttext-와-entitytext-두-곳에-있다))
- [2026-09-01] **헤드리스에서 줄바꿈을 폭으로 검증하면 틀린다** — 로컬 편집기는 CreateJS 로 뜨는데 그쪽 `getMeasuredWidth()` 는 **줄바꿈을 무시하고 원문 전체를 잰다**(100자가 3줄로 접혔는데 폭 1307 로 보고). playentry 는 PIXI 라 `_lines` 가 있지만 로컬엔 없다 — 가드: 두 렌더러 공통인 `getMeasuredHeight() / lineHeight` 로 줄 수를 센다 ([`tools/verify-textbox-layout.mjs`](../tools/verify-textbox-layout.mjs) §②) ([07 §lineBreak 세로 클리핑](07-runtime-quirks.md#linebreak-true-는-height-를-넘는-줄을-그리지-않고-버린다))

---

## 음악 동기화와 기존 작품 수정

- [2026-09-15] **Run 경과 시간을 음악 시각으로 사용** — 실제 본 재생 인스턴스의 위치와 준비 호출을 구분한다. 회귀 확인: 로드 뒤 추가 대기 0, 준비 시간을 늘린 전 구간 재생에서도 장면·자막 수와 오차를 대조한다 ([16](16-music-synchronization.md)).
- [2026-09-15] **wait 합만 보존했는데 뒤쪽 자막이 밀림** — 추가 틱 때문에 합산 검사가 실행 검사를 대신하지 못한다. 음악 기준 목표 시각과 실제 이벤트를 비교한다 ([16](16-music-synchronization.md#4-상대-대기-합과-실제-출력-시각을-구분한다)).
- [2026-09-15] **표시 초시계의 순간 차이를 누적 드리프트로 오판** — 캐시 갱신 지연·시계 원점·실제 출력 오차를 나누고, 미측정 원점은 통과로 표시하지 않는다 ([07](07-runtime-quirks.md#프로젝트-초시계의-원점과-표시값은-다르다)).
- [2026-09-15] **여러 문구 중 마지막 수정만 남음** — 오브젝트당 파싱 트리를 공유하고 저장 후 변경 수·내용을 전수 대조한다 ([04](04-script-and-blocks.md#기존-스크립트의-여러-항목을-수정할-때)).
- [2026-09-15] **fontSize를 줄여도 자막이 넘침** — 뒤에 실행되는 크기 정하기와 모든 대상 문자열의 렌더 경계를 확인한다 ([07](07-runtime-quirks.md#크기-정하기는-퍼센트가-아니다)).
- [2026-09-15] **정적 설명문을 고쳐도 다른 내용이 뜸** — text_write 입력의 변수·리스트 반환 블록까지 추적한다 ([03](03-objects-and-assets.md#️-글상자-문자열은-objecttext-와-entitytext-두-곳에-있다)).

## 네이티브 리듬게임 제작

- [2026-09-20] 복귀 카운트가 곡 시간에 포함되지 않도록 `base`를 유지하고 재개 직전 초시계를 RESET한 뒤 같은 위치부터 음악을 재생한다 — 가드: [CHROMA 근거](evidence/chroma-prism-20260920.json)의 pause/resume 시퀀스 단언과 별도 재개 싱크 기록 ([18 재개](18-chroma-native-rhythm-case-study.md#3-일시정지는-저장-시각과-복귀-대기를-분리한다)).
- [2026-09-20] 작은 자산을 확대하거나 막대 높이를 `setSize`로 바꿔 폭까지 변형하지 않는다 — 가드: [CHROMA 근거](evidence/chroma-prism-20260920.json)의 모양 치수·배율·고정 캔버스 모양 수, 별도 렌더 검수 ([18 화면](18-chroma-native-rhythm-case-study.md#4-선명한-자산과-초기-화면도-작품-데이터다)).
- [2026-09-20] 시작 뒤 `hide`만 처리하면 정지 화면에 내부 요소가 남는다 — 가드: [CHROMA 근거](evidence/chroma-prism-20260920.json)의 모든 변수·리스트 및 오브젝트 초기 visible 단언과 편집기 왕복 기록 ([18 초기 화면](18-chroma-native-rhythm-case-study.md#시작-버튼을-누르기-전부터-타이틀이-보여야-한다)).
- [2026-09-20] 자동 연주 성공이 실제 키 입력 성공을 보장하지 않는다 — 가드: [CHROMA 실행 기록](evidence/chroma-prism-20260920.json)의 자동 284노트와 상태 읽기·키 이벤트만의 204노트 완주를 구분 ([18 검증](18-chroma-native-rhythm-case-study.md#6-자동-연주-성공과-키-입력-완주는-다른-증거다)).

## 재발 시 재구성 절차

1. 가드 파일/줄이 **실제로 작동 중인지** 확인 (리팩터 중 제거됐을 수 있음)
2. 가드가 망가졌으면 복원 또는 동등한 보호 장치 추가
3. 새로운 실패 패턴이면 → [07-runtime-quirks.md](07-runtime-quirks.md)(Entry 엔진 고유 동작) 에 추가. 구조적으로 해결할 수 없는 활성 함정이 쌓이면 `06-gotchas.md`를 신설
4. 해결 시 이 파일에 1줄로 요약
