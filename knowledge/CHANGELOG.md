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

## 2026-05-18 — Variable 좌표 quirk 2 종 (07-runtime-quirks.md)

원형/그리드 변수 배치 작업 (`games/bad-apple`, `games/name-row`, `games/name-circle`) 에서 발견:

- **Variable Y vs Entity Y — 부호 반대**: entity 는 `setY` 에서 `this.object.y = -this.y` 로 반전하지만 variable 은 `view_.y = getY()` 직접 사용 → variable 의 `y > 0` 은 화면 **아래**. 시계 fixture 가 반시계로 돌던 원인. 실측은 [`tools/verify-coord-test.mjs`](../tools/verify-coord-test.mjs) 와 [`games/coord-test/coord-test_001.ent`](../games/coord-test/).
- **변수 좌표 x=0 또는 y=0 → bin-packer 폴백**: [`variable.js:127`](../../entryjs/src/class/variable/variable.js#L127) 의 `if (this.getX() && this.getY())` truthy check 때문에 정확히 0 인 좌표는 무시되고 자동 배치. 그리드 중앙 행/열만 흩어지는 증상. 회피는 ±1 시프트 또는 0.5 오프셋.

## 2026-04-29 — 뱀서라이크 확장팩 (`games/vampire-survival/` Phase A→E)

MVP 슬림 → 기획서 90% 구현 완성판. 5 단계 추가 (적 변종, 피격감, 채찍, 보스+보물상자, 점수). spec ~1,100 → ~1,830 LoC, 18 → 26 오브젝트, 17 → 28 verify.

| Phase | 추가 | 핵심 패턴 |
|---|---|---|
| A | 박쥐 + 골렘 (멀티 picture, type slot list) | 시간대별 type 풀, `changeShape(type)` 클론 시작, `valueAt('enemy_speed_t', type)` 매 tick 배수 |
| B | 데미지 플래시 + 사망 파티클 | `enemy_last_hp` 슬롯 + brightness 펄스 (frontier-guard 패턴), 6 방향 angle table 파티클 |
| C | 채찍 무기 + 메뉴 3 종 + 카드 5 종 | 단일 매니저 thread 좌/우 alternating, box collision (단일 thread → race 없음) |
| D | 보스 + 보물상자 + boss bullet (라디얼 8 발) | 단일 인스턴스 sprite + 4 스레드 (spawn/move/attack/death), 별도 bb 슬롯 시스템, `fn.value` `fhb`/`fhp` 추가, 카드 5 회 연속 (treasure_picks_left) |
| E | 점수 (kills*10 + level*50 + time + boss*500) + 랭킹 (insertion sort) | spec-bullet-circle 의 ranking 패턴 그대로, `대답` 변수 + `ask_and_wait` |

기존 MVP 함정 (다중 클론 race) 가 Phase D 의 boss bullet 에 그대로 재발 → 같은 `fn.value` 패턴 (`fhb`, `fhp`) 으로 일관 해결.

**병합 후 발견 (2026-05-02)** — 첫 레벨업 시 엔진 멈춤. 같은 race 의 **변종** 이 Phase B 의 사망 파티클에 잠복. spawner (적 사망 코드) 의 `setVar('p_spawn_idx', 0) → repeat.basic(6, [changeVar(psi, 1), createClone])` 와 클론의 cloneStart `valueAt('pat', psi)` 사이 race — 여러 적 동시 사망 시 한 적의 reset(0) 직후 다른 적의 in-flight 클론이 인덱스 0 lookup → throw. 1 차 race 와 다른 변종이라 회피 패턴도 다름: cloneStart 에서 자체 결정값 (`rand(0, 359)`) 사용. 정착: [`07-runtime-quirks.md` cloneStart 변종](07-runtime-quirks.md#변종-when_clone_start-가-spawner-의-글로벌-카운터를-race-로-읽음) sub-section + lessons.md.

테스트 전략 메모: manager 가 `survival_time` 을 매 0.1s 덮어쓰므로 verify 에서 `setVar('시간', 121)` 이 즉시 reset. 보스 spawn 검증 시엔 `boss_active` 변수 직접 강제 설정으로 spawn watcher 우회. 보스 bullet 발사 검증은 movement thread 가 `boss_x` 를 -300 에서 이동시키며 bullet 이 즉시 화면 밖에서 spawn → despawn 하는 race 라 미세 검증 어려움 — `boss_atk_cd` 사이클 (증가 → 180 도달 → 0 reset) 으로 간접 확인.

스트레스 (8 초 모든 무기 Lv5 + 보스 + 적 다중) 통과 — 엔진 정상, pageErrors 0.

---

## 2026-04-29 — 뱀서라이크 MVP (`games/vampire-survival/`)

뱀서라이크 (Vampire Survivors 류) 3 분 슬림 게임 작품. 메뉴 → play (오라/지팡이 자동 공격, 좀비 슬롯, 카드 레벨업) → result. 17/17 verify 통과.

새 함정 발견 + 위키 정착:
- **다중 클론 같은 스크립트의 `repeat.inf` 본체에서 글로벌 카운터 race** — bullet 클론 N 개가 동시 비행 시 `bul_i` reset/increment 가 인터리브되어 list 인덱스 0 순간 발생, `Runtime Error: can not insert value to array` 로 엔진 정지. 회피: 슬롯 순회를 `fn.value` 재귀 함수에 위임 (동기 호출이라 atomic). 정착: [`07-runtime-quirks.md`](07-runtime-quirks.md#다중-클론의-repeatinf-본체--글로벌-scratch-변수-race) 새 섹션 + [`lessons.md`](lessons.md) 한 줄.

## 2026-04-29 — 디펜스 게임 시리즈 회고 (frontier-guard Phase 1 → 3.2)

7 단계 작업 통합 회고. 자세한 항목별 history 는 아래 각 phase 참조. 본 entry 는 cross-cutting 학습 정리 — 컨텍스트 리셋 후 재진입할 때 빠르게 컨텍스트 회복할 용도.

### 작업 진행 단계

| Phase | 추가 기능 | LoC 변화 | verify | 핵심 발견 |
|---|---|---|---|---|
| 1 (MVP) | 단일 라인 / 적 5 / 타워 2 (Archer) | spec ~250 | 18/18 | direction-as-id, when_message fan-out, 다중 cloneStart race |
| 2 | Cannon (splash), Tank, 3 웨이브 데이터 주도 | +60 | 28/28 | 클론 타입 분기, splash AOE, multi-wave nested loop |
| 2.1 | intro 장면, 데미지 플래시 | +50 | 35/35 | 다중 scene + sceneStart, last_hp 추적 + setEffect |
| 3 | 빌드 슬롯 4, 메뉴, 골드, prep, 업그레이드 | +200 | 42/42 | when_message 가 template 발화 (catastrophic), wait_until 패턴 |
| 3.1 | 공격 빔 시각화 (brush) | +30 | 44/44 | source→target brush 라인, findColoredPixels 검증 |
| 3.2 | 슬롯 가운데 클릭 fix | +5 | 46/46 | sprite pixelPerfect, stage→canvas 좌표 변환 |

최종: 12 오브젝트, 34 KB .ent, 46 자동 검증, 14 verify scripts 모두 회귀 없이 통과.

### 발견된 critical 함정 (전부 [`07-runtime-quirks.md`](07-runtime-quirks.md) + [`lessons.md`](lessons.md))

1. **`when_message` 핸들러가 클론에도 살아 있음** → fan-out spawn 지수적 증가
2. **다중 `when_clone_start` 병렬 실행** → 클론 init 상태 race
3. **`message_cast` 다중 리스너 동시 발화** → stale read race
4. **`when_message` 가 template 에도 발화** → direction-as-id 시 invalid index lookup → scene 전체 silent 손상 (가장 catastrophic)
5. **sprite pixelPerfect = source 알파 검사** → ring 가운데 transparent 클릭 무반응
6. **`Entry.dispatchEvent` 는 hit-test 우회** → verify 가드만으론 실제 클릭 보장 안 됨
7. **stage 논리 480×270 ≠ canvas 픽셀 640×360** → 좌표 변환 1:1 가정 fixture 마다 어긋남
8. **`deleteClone` 후 후속 블록 무실행** → if_else 분기 필수

### 수립된 패턴 (전부 [`04-script-and-blocks.md`](04-script-and-blocks.md))

1. **direction-as-id** — 클론 좌표 unique 못할 때 entity.direction 으로 id 캐시
2. **list 슬롯 broadcast** — 클론별 상태를 글로벌 list[id] 슬롯에
3. **manager-as-spawner** — `createClone('other_id')` 직접 호출 (메시지 fan-out 회피)
4. **multi-type 클론** — `enemy_type[id]` 슬롯 + 데이터 주도 stat 룩업 (`type_hp`, `type_size`)
5. **데이터 주도 다중 웨이브** — `wave_counts[]` + `wave_types[]` flat list, manager nested loop
6. **Splash AOE** — 타겟 좌표 캡처 → 활성 슬롯 재순회 + 반경 dmg
7. **데미지 플래시** — `enemy_last_hp[id]` drop 감지 + `setEffect('brightness', 60)` 펄스
8. **공격 빔 시각화** — manager 의 brush 가 매 cooldown source→target 라인, color/thickness 로 종류 구분
9. **HUD 변화 감지** — `last_shown` 변수 비교로 flicker 회피
10. **wait_until 패턴** — `repeat.inf + if cond stopRepeat`
11. **빌드 슬롯 시스템** — 1 template + N 클론, 다중 picture, 메뉴 메시지 동기화
12. **direction 범위 가드** — message handler 가 template 까지 발화하므로 `if_(coord('self','direction') <= N)` 가드 필수

### 메타-패턴 (개발 프로세스 — [`04-script-and-blocks.md` §대규모 게임 빌드](04-script-and-blocks.md#대규모-게임-빌드--스코프-분할--bisect-디버깅--회귀-가드-레이어))

1. **새 패턴 검증 ↔ 기능 추가 분리**: unfamiliar 인프라 (direction-as-id, brush 시각화 등) 는 작은 fixture 로 먼저 검증. 이후 기능 추가는 합쳐도 OK.
2. **catastrophic bug 의 bisect 디버깅**: minimal handler (`setVar dbg1, 1`) 부터 점진 추가. dbg 변수 + dump 으로 어떤 블록이 손상 trigger 인지 격리.
3. **회귀 가드 4 레이어**: `--check` (정적, 1 초) → 빌드 → smoke (로드) → runtime (playwright). 마지막 layer 는 `dispatchEvent` (핸들러 로직) + `page.mouse.click` (실제 hit-test) + `findColoredPixels` (시각) 의 조합.

### 디펜스 게임 = 종합 reference fixture

frontier-guard 는 위 12 패턴 + 8 함정 회피 + 다중 scene 모두 한 spec 안에. 새 게임 만들 때 시작점/참고 fixture 로 활용.

- [`tests/fixtures/spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs) — 740 LoC, 12 objects
- [`tools/verify-frontier-guard.mjs`](../tools/verify-frontier-guard.mjs) — 46 자동 검증 (정적 + 픽셀 + 좌표)
- [`tools/screenshot-frontier-guard.mjs`](../tools/screenshot-frontier-guard.mjs) — 8 단계 시각 디버깅 도구

## 2026-04-29 — 프론티어 가드 Phase 3.2 (slot 가운데 클릭 fix + 좌표 매핑 수정)

- [x] **빈 슬롯 가운데 클릭 무반응 fix**. 사용자 보고: ring 모양 슬롯의 가운데가 시각적으로 비어있는데 클릭 안 됨. 원인: sprite 도 textBox 처럼 `pixelPerfect = true` ([entity.js:46](../../entryjs/src/class/entity.js#L46)) — source 픽셀 알파 검사. `ring(22, 16)` 의 가운데 16px 가 투명 → hit 실패. `setEffect('transparency', N)` 효과는 렌더링 단계라 source 알파에 영향 없음.
  해결: `circle(20, '#94a3b8')` (filled disc) 로 변경 + `setEffect('transparency', 70)` 으로 시각 ghost. source 픽셀 전체 알파 ≥ 1, 가운데 클릭 가능.
  정본: [`07-runtime-quirks.md` sprite pixelPerfect](07-runtime-quirks.md#sprite-도-pixelperfect--투명-픽셀-ring-가운데-등-클릭-안-됨).

- [x] **클릭 회귀 가드 — 실제 stage point click**. `Entry.dispatchEvent('entityClick', e)` 는 pixel hit-test 우회 → verify 통과해도 실제 사용자 클릭이 실패할 수 있음. `page.mouse.click(px, py)` + canvas 좌표 변환으로 진짜 hit-test 검증 (Step 1b).
  좌표 매핑: stage logical 480x270 → canvas (예: 640x360) 픽셀로 scale 후 DOM rect 적용. textbox-click 의 매핑 함수가 stage=canvas 1:1 가정해 작동했지만, 우리 fixture 의 canvas 가 다른 비율 → scale 적용 필요. clickStagePoint 헬퍼 수정.

- [x] **검증 46/46 pass** (Phase 3.1 44 → Phase 3.2 46). Step 1b 의 빈 슬롯 가운데 픽셀 클릭 → menu_state=1 + building_slot=1 회귀 가드.

## 2026-04-29 — 프론티어 가드 Phase 3.1 (공격 빔 시각화)

- [x] **공격 빔 시각화** — manager 의 brush 가 매 cooldown cycle 마다 (tower_x, tower_y) → (target_x, target_y) 라인 그림. archer 노란 (`#fbbf24`, thickness 2), cannon 주황 (`#f97316`, thickness 3). cycle 시작 시 `eraseAll()` → 0.5 초 동안 visible 후 새 cycle 에서 redraw. 게임 종료 (win/lose) 시 별도 listener 가 `eraseAll`.
- [x] **`drawBeam` 헬퍼** — `setColor` + `setThickness` + `locateXY(source)` + `startDraw` + `locateXY(target)` + `stopDraw`. archerTick / cannonTick 둘 다 사용.
- [x] **검증**: `findColoredPixels(page, '#fbbf24')` 로 노란 빔, `'#f97316'` 으로 주황 빔 검출. cooldown 안에서 짧은 폴링으로 catch (44/44 pass).
- [x] 정본: [`04-script-and-blocks.md` 공격 빔 시각화](04-script-and-blocks.md#공격-빔-시각화--manager-단일-sprite-의-brush-로-sourcetarget-라인).

## 2026-04-29 — 프론티어 가드 Phase 3 (풀 빌드 시스템: 슬롯 + 골드 + 업그레이드 + 준비 시간)

- [x] **Phase 3 풀 빌드 시스템** [`spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs).
  Phase 2.1 의 자동 진행 → 플레이어가 능동적으로 타워를 배치/업그레이드하는 진짜 게임:
  - **빌드 슬롯 4 개** (slot_template 1 + 4 클론, direction = id 1..4). 초기 비어있음 (`pic_empty` ring), 클릭 시 메뉴.
  - **빌드 메뉴**: 3 textBox (`menu_btn1/2/cancel`). 슬롯 상태에 따라 동적 텍스트 — 빈 슬롯이면 "궁수 50G / 대포 80G / 취소", Lv1 슬롯이면 "업그레이드 40G / (숨김) / 취소". 메시지 (`open_menu` / `close_menu` / `refresh_slot`) 로 동기화.
  - **골드 시스템**: 초기 100G, 적 처치 시 +10 (스웜) / +30 (탱크), 빌드/업그레이드 시 차감. HUD 변수 표시.
  - **준비 단계**: 게임 시작 후 manager 가 `prep_done == 1` 까지 대기 (repeat.inf + stopRepeat). "✓ 준비 완료" 버튼 클릭 → 첫 웨이브 spawn 시작.
  - **Lv2 업그레이드**: archer 8→12 dmg, cannon 4→7 dmg. 시각적으로 brightness +30. 데이터 주도 룩업 (`archer_dmg[level]`).
  - **타워 타겟팅 리팩터**: manager 가 슬롯 4 개 순회, type/level 별 분기. 임시 변수 (`cur_tx, cur_ty, cur_dmg`) 로 dynamic stat 전달.
  - 검증 42/42 pass — 슬롯 spawn, 메뉴 동작, 골드 부족 (구매 실패), 업그레이드, prep flow, 적 처치 골드 보상, WIN/LOSE.

- [x] **새 함정 발견 + 회피**: **`when_message` 핸들러가 template 에도 발화 — direction-as-id 시 invalid index lookup 으로 scene 전체 손상**.
  template 의 default direction (90) 으로 list 룩업 시 silent error → scene reset 같은 catastrophic 증상 (cloneCount → 0, 모든 변수 default, 클릭 핸들러 발화 안 함). bisect 디버깅으로 정확한 원인 (refresh_slot 의 template 발화) 식별. 회피: `if_(cmp(coord('self','direction'), '<=', SLOT_COUNT), [...])` 가드로 template 분기 차단.
  정본: [`07-runtime-quirks.md` template 발화 가드](07-runtime-quirks.md#when_message-핸들러가-template-에도-발화--direction-as-id-시-invalid-index-lookup-으로-scene-전체-손상).

- [x] **메뉴 닫힘 시 글로벌 상태 리셋**. menu_state / building_slot 은 close_menu 메시지 발신 시 manager 의 별도 listener 가 0 으로 reset — textBox 의 hide 와 분리한 글로벌 정리 책임.

## 2026-04-29 — 프론티어 가드 Phase 2.1 (intro 장면 + 데미지 플래시)

- [x] **intro 장면** — 제목 ("프론티어 가드") + 설명 (3 줄 게임 룰) + 시작 버튼 ("▶ 게임 시작", 녹색 textBox).
  버튼 클릭 → `startScene('play')` 로 게임 진입. 모든 게임 오브젝트 (`hud_status`, `base`, `tower_*`, `enemy`, `manager`) 는 `scene: 'play'` + 트리거 `when.sceneStart()` (이전 `when.run()` 대체).
- [x] **데미지 플래시** — 적이 공격받으면 brightness 60 으로 0.08 초 펄스. `enemy_last_hp` 리스트로 직전 tick hp 추적, forever 루프에서 `current < last` 면 `setEffect` 펄스 + `wait(0.08)` 스태거. 동시 다중 데미지 (cannon splash + archer 같은 tick) 도 setEffect (absolute) 라 누적 안 됨.
  정본: [`04-script-and-blocks.md` 데미지 플래시](04-script-and-blocks.md#데미지-플래시--enemy_last_hp-리스트로-hp-drop-감지--seteffect-펄스).
- [x] **검증 35/35 pass** (Phase 2 28 → Phase 2.1 35). intro 장면 sceneId 검증, 시작 버튼 텍스트 검증, 클릭 후 sceneId='play' 검증, brightness 60 직접 catch (10ms 폴링), last_hp ↔ hp sync 검증.
- [x] **다중 클론 효과 누적 회피**: `setEffect('brightness', N)` 는 absolute (= `change_effect_amount`). `addEffect` (= `add_effect_amount`) 와 달리 펄스가 누적 안 됨 — 다중 hit 받아도 한 번의 펄스로 안전.

## 2026-04-29 — 프론티어 가드 Phase 2 (확장 TD: cannon + tank + 3 웨이브)

- [x] **Phase 2 확장** [`spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs).
  Phase 1 (MVP — 적 5 / 타워 2) → Phase 2 (적 10 / 타워 3 / 3 웨이브 데이터 주도):
  - **Cannon 타워** 추가 (tile-cyan): 타겟 발견 후 그 좌표 중심 SPLASH_RADIUS=50 내 모든 활성 적에 dmg 4. 군집에 강함, 단일 탱커엔 약함.
  - **Tank 적** 추가 (ball-yellow, scale 0.55): hp 75 (3× swarm), 속도 0.6× swarm. 시각적 큰 노란 ball.
  - **3 웨이브 데이터 시스템**: `WAVE_COUNTS = [3,3,4]` + `WAVE_TYPES` flat 리스트로 각 spawn 의 타입 표현. manager 의 nested `repeat.basic` 으로 순회. 웨이브 사이 4 초 휴식.
  - **데이터 주도 stat**: `type_hp` / `type_size` 리스트로 인덱스 룩업. 클론 코드 변경 없이 새 적 타입 추가 가능.
  - **HUD 웨이브 표시**: `hud_last_wave` 변수로 wave_idx 변화 감지 시에만 `writeText` (flicker 회피).
  - 검증: 28/28 pass — id 충돌 회귀 가드, wave_types 일치 (10 슬롯), tank picId/scale/hp, cannon 구조, 활동 누적, WIN/LOSE 분기.

- [x] **다중 클론 타입 패턴** ([`04-script-and-blocks.md` 클론 타입 분기](04-script-and-blocks.md#클론-타입-분기--enemy_type_listid--데이터-주도-stat-룩업)). `current_type` 변수 → `enemy_type_list[id]` slot 저장 → forever 루프에서 `valueAt('enemy_type', coord('self','direction'))` 으로 자기 타입 read → 분기. picture 토글은 `changeShape(getVar('current_type'))` 의 index 폴백으로 깔끔.

- [x] **Splash AOE 패턴** ([`04-script-and-blocks.md` Splash AOE](04-script-and-blocks.md#splash-aoe--타겟-좌표-중심-반경-내-모든-활성-적)). 단일 타겟 발견 후 target 좌표 캡처 → 활성 슬롯 재순회 → splash radius 안 모두에 dmg. `findNearestEnemy` 의 `best_dist` 초기값을 `range_sq` 로 두면 사거리 필터 inline.

- [x] **데이터 주도 다중 웨이브** ([`04-script-and-blocks.md` 다중 웨이브](04-script-and-blocks.md#데이터-주도-다중-웨이브--wave_counts--wave_types-flat-리스트)). `WAVE_COUNTS` (각 웨이브 적 수) + `WAVE_TYPES` (flat 적 타입 시퀀스). manager nested `repeat.basic` 으로 순회. 웨이브 별로 spawn_idx reset 안 함 — 끝까지 누적.

- [x] **Splash 검증의 한계 발견**. JS 직접 클론 위치 조작 (`c.x = 0` + 리스트 강제 update) 으로 splash 다중 hit 측정 시도 → forever 루프가 매 틱 `enemy_x` 덮어써 효과 무효. 차선책: 구조 검증 (cannon 존재 + picture id) + 활동 검증 (n cd 안 hp drop 발생). 정확한 데미지 분리는 spec 만 확인 가능.

## 2026-04-28 — 프론티어 가드 MVP (타워 디펜스) + 클론 함정 2 가지

- [x] **프론티어 가드 MVP** [`spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs).
  단일 라인 경로 + 적 5 마리 + 타워 2 대 (option a 미니 스코프). 검증 목표: 타겟팅 알고리즘 + 클론 id 패턴.
  - 적: ball-red 클론 5 개. manager 가 2 초 간격 spawn. direction 속성 = 클론 id (1..5) — 글로벌 리스트의 슬롯 인덱스. forever 루프에서 매 틱 수동 step 이동 (`SPEED_PER_TICK = 1.5`) + 위치 broadcast + hp/도달 체크.
  - 타워: tile-purple/cyan, 시각 전용. manager 의 forever 루프 (cooldown 0.4s) 가 양 타워에 대해 직렬로 `towerTick(tx,ty)`: list 5 슬롯 순회 → 가장 가까운 active 적 → 사거리 (130 px) 내면 hp 깎기.
  - HUD: textBox "웨이브 1 — 적 5 마리" / "YOU WIN!" / "GAME OVER".
  - 검증: 18/18 pass — id 충돌 회귀 가드, 클론 direction 유니크, 타워 데미지, 강제 처치 (hp=0 setListAt), WIN/LOSE 분기.

- [x] **함정 1 (큰 버그): `when_message` 핸들러는 클론에도 살아있어 fan-out spawn 발생**.
  enemy template 이 `when_message('spawn'), createClone('self')` 가지면 **기존 클론도 같은 핸들러 보유** → 메시지 1 회 발신에 (template + 기존 N 클론) × createClone = N+1 신규 클론. 첫 진단 dump 에서 cloneCount=3 vs next_id=2, 두 클론이 같은 direction (id 충돌). 회피: spawner (manager) 가 직접 `createClone('enemy')` 호출 — `create_clone` 의 dropdown 은 `'self'` 외 다른 sprite id 허용.
  정본: [`07-runtime-quirks.md` when_message fan-out](07-runtime-quirks.md#when_message-핸들러는-클론에도-살아-있음--fan-out-spawn).

- [x] **함정 2: 다중 `when_clone_start` 스크립트는 병렬 실행 → 클론 초기화 race**.
  Script A 가 `turnAbs(getVar('next_id'))` 로 direction 캡처, Script B 가 `coord('self', 'direction')` 으로 슬롯 인덱스 read → B 가 A 보다 먼저 실행되면 default direction (90) 으로 슬롯 90 에 write (5-슬롯 리스트 범위 밖) → silently 무시. 회피: 단일 `when_clone_start` 로 통합. glide 의 부드러움 포기하고 매 틱 `moveX(SPEED_PER_TICK)` 수동 step.
  정본: [`07-runtime-quirks.md` 다중 when_clone_start race](07-runtime-quirks.md#다중-when_clone_start-스크립트는-병렬-실행--클론-초기화-race).

- [x] **DSL 추가**: `setListAt(listId, index, value)` (= `change_value_list_index`), `glideTo(sec, x, y)` (= `locate_xy_time`). 둘 다 클론별 상태/이동에 핵심. (단 frontier-guard 최종 spec 은 race 회피로 glideTo 대신 수동 moveX.)

- [x] **direction-as-id 패턴 (positive)**. 클론들이 같은 좌표에서 시작해 같은 경로로 움직이는 시나리오 (TD/총알/이펙트) 는 좌표 식별 불가능 — `entity.direction` 을 per-clone id 캐시로 사용. 원형 sprite 면 시각 회전 무시 가능.
  정본: [`04-script-and-blocks.md` direction 으로 id 저장](04-script-and-blocks.md#클론-정체-판정--direction-속성을-id-저장소로-좌표-불가능-시).

## 2026-04-28 — `message_cast` 다중 리스너 race condition

- [x] **`message_cast` 의 모든 리스너가 같은 frame 에 동시 시작 — 실행 순서 비보장**.
  버그: `spec-fruit-hunt.mjs` 의 fruit_template 이 `when_message('new_stage')` 안에서 `target_idx` setVar. title 도 같은 메시지 listen 후 `target_idx` read → stale 값을 읽어 "찾아라: 사과" 라고 표시했지만 화면엔 다른 과일.
  진단: 캡처한 화면에서 title 텍스트 ≠ 실제 spawn 된 target picture.
  수정: 메시지 발신 전에 발신자가 변수 모두 갱신. 메시지 핸들러는 read-only.
  정본: [`07-runtime-quirks.md` message_cast race](07-runtime-quirks.md#message_cast-핸들러는-동시-실행--같은-메시지-다중-리스너-race).
- [x] **회귀 가드** [`verify-fruit-hunt.mjs`](../tools/verify-fruit-hunt.mjs) Step 1 — title text 의 과일 이름 ↔ target_idx 일치 검증. 19/19 pass.

## 2026-04-28 — `change_to_some_shape` 매칭 우선순위 + DSL `if_else` paramCount 수정

- [x] **`change_to_some_shape` 의 매칭은 id → name → index 순서** ([`object.js:342`](../../entryjs/src/class/object.js#L342) `getPicture`).
  picture id 와 name 이 다르면 (예: `id='pic_apple'`, `name='fruit-apple'` — `assets()` 로 생성 시 흔함) 편집기 UI 가 name 만 보여 혼란. **인덱스 (1-base) 직접 전달** 이 가장 깔끔.
- [x] **`spec-fruit-hunt.mjs` 리팩터** — `fruit_pics` list 제거, `changeShape(getVar('shape_idx'))` 직접. list 룩업 줄 + visual 혼란 해소. 18/18 그대로 통과.
- [x] **DSL `if_else` paramCount 수정** — registry 는 3 슬롯 (`Block, Indicator, LineBreak`) 인데 DSL 이 2 슬롯만 채워서 warning 발생. `params: [_val(cond), null, null]` 로 정정.
- [x] 정본: [`07-runtime-quirks.md` change_to_some_shape](07-runtime-quirks.md#change_to_some_shape-매칭-우선순위--id--name--index).

## 2026-04-28 — 과일 사냥 (3×3 + 붓 타이머) + 클론 패턴 함정 2 가지

- [x] **과일 사냥 게임** [`spec-fruit-hunt.mjs`](../tests/fixtures/spec-fruit-hunt.mjs).
  3×3 격자에 9 과일 클론 (5 종 그라데이션 공 — 사과·바나나·포도·귤·수박). 매 라운드 정확히 2 개가 목표 — `target_pos1`/`pos2` 변수 + modulo 트릭으로 항상 다른 위치. 비-target 슬롯은 `rand(1,4) + (>= target_idx 면 +1)` 로 target 회피.
  붓 타이머: 화면 상단에 매 프레임 erase + redraw, 시간 비례 막대 길이. <5 초 빨강 경고 + y 흔들림. `time_left = MAX_TIME - projectTimer.value() - penalty_total`.
  정답 클릭 → score +100×combo, combo +1, targets_remaining -1. 2 개 다 맞히면 `new_stage` 메시지 → 클론 재생성 + 새 목표.
  오답 클릭 → combo 0, penalty +2 (타이머 2 초 깎임).
  검증: 18/18 pass — clone count, target picture id 정확히 2 개, score/combo/level 증가, deleteClone 으로 클론 감소, 페널티 누적, GAME OVER.

- [x] **함정 1: `deleteClone()` 후 같은 스크립트의 후속 블록 안 실행**.
  Entry 의 deleteClone 은 클론 컨텍스트를 즉시 소멸 → 그 뒤에 오는 sendMessage / setVar 등은 fire 안 됨.
  해결: `if_else` 로 분기 — `if (cleared) sendMessage('new_stage'); else deleteClone()`. sendMessage 는 template 의 핸들러가 removeAllClones 로 정리.
  정본: [`04-script-and-blocks.md` 함정](04-script-and-blocks.md#함정-deleteclone-후-같은-스크립트-후속-블록-안-실행).

- [x] **함정 2: 클론은 글로벌 변수만 공유 → "내가 정답인가?" 판정 불가**.
  Entry 클론에는 로컬 변수가 없고 `selectedPicture.id` 도 직접 못 읽음.
  해결: **클론 좌표 = 고유 id 대용**. N 슬롯 그리드면 좌표 N 개가 모두 고유 → `coord('self', 'x')` / `coord('self', 'y')` 를 정답 위치 (`grid_x[target_pos+1]` 등) 와 비교.
  정본: [`04-script-and-blocks.md` 클론 정체 판정](04-script-and-blocks.md#클론-정체-판정--클론-좌표--고유-id-대용).

- [x] **5 종 fruit asset 추가** ([`tools/build-game-assets.mjs`](../tools/build-game-assets.mjs)): `fruit-apple/banana/grape/orange/watermelon` (각 색의 그라데이션 공). 라이브러리 이제 23 종.
- [x] **DSL `mod(a, b)` / `quotient(a, b)` 헬퍼** — `quotient_and_mod` 블록 (paramsKeyMap LH=1, RH=3, OPERATOR=5).

## 2026-04-28 — 바운스 볼: 이미지 마이그레이션 + 복제본 패턴

- [x] **바운스 볼 — 벽돌·패들 모두 이미지 sprite 로 전환**.
  벽돌: textBox bgColor → sprite `assets('brick-red'/'brick-orange'/'brick-green')`. 패들: textBox bgColor → sprite `assets('paddle-blue')`.
  이전 18 벽돌 + 1 paddle = 19 textBox → 4 sprite (1 brick_template + 18 clones + 1 paddle + 1 ball + 1 status_msg).
- [x] **벽돌 18 개 → 1 brick_template + 18 clones**.
  template 의 `when_run` 스레드가 행별 `changeShape(pic_r/pic_o/pic_g)` + `locateXY` + `createClone('self')` 18 회 → 18 클론 생성. 각 클론은 `when_clone_start` 로 `show` + 충돌 감시 + `deleteClone()` (자기 제거).
  spec LOC 절감 + 동작이 한 곳에 — 복제본은 같은 역할 반복 오브젝트의 표준 패턴.
- [x] **클론 검증 메커니즘**: `Entry.container.getAllObjects()` 는 template 만 반환. 클론 갯수는 `template.clonedEntities.length`. verify-bounce-ball 이 이 패턴으로 18 클론 spawn 확인 + deleteClone 으로 감소 확인 (15/15 pass).
- [x] 정본: [`04-script-and-blocks.md` 복제본 패턴](04-script-and-blocks.md#복제본-clone-패턴--같은-역할의-오브젝트가-반복될-때).

## 2026-04-28 — 게임 이미지 라이브러리 (A 정적 + B 생성기)

- [x] **Phase B: SVG 인라인 생성기** [`tools/lib/sprite-gen.mjs`](../tools/lib/sprite-gen.mjs).
  `circle / rect / ring / regularPolygon / triangle / pentagon / hexagon / star / heart / shadedBall / beveledBrick`. 각 함수가 `{ svgString, dimension, imageType: 'svg' }` 반환.
  make-ent 가 svgString 을 콘텐츠 해시(sha1) cacheKey 로 dedup → 같은 모양·색이 여러 곳에서 호출되어도 tar 안에는 한 번만 들어감.
  통합: [`tools/make-ent.mjs`](../tools/make-ent.mjs) 의 picture 루프가 `p.svgString` 우선 검사 + `bundleBuf()` 신설.
  DSL: `obj({ picture: gen.shadedBall(15, '#3b82f6') })` 한 줄로 전달 — `obj()` 가 자동 wrap.
- [x] **Phase A: 정적 자산 라이브러리** [`public/images/game/`](../public/images/game/).
  `tools/build-game-assets.mjs` (`npm run build:assets`) 이 sprite-gen 으로 18 개 SVG + `manifest.json` 생성. ball-blue/red/yellow, brick-red/orange/green/blue, paddle-blue/green, heart, star, coin, enemy-spike/bomb, bullet-blue/red, tile-purple/cyan.
  spec 에서 [`assets('name')`](../tools/lib/game-assets.mjs) 헬퍼로 의미 있는 이름 → picture 객체 변환. 카탈로그에 없는 이름은 throw (오타 조기 발견).
- [x] **데모: bounce-ball 의 공이 mascot bot205 → `assets('ball-blue')`**.
  Verify 14/14 그대로 통과 (게임 로직 무관).
- [x] **make-ent `bundleOne` cacheKey 추가** — 같은 file path 가 여러 picture 에서 참조되어도 tar 한 번 (기존엔 매번 새 hash 부여 → 사이즈 부풀음).
- [x] 정본: [`03-objects-and-assets.md` 게임 이미지 라이브러리](03-objects-and-assets.md#게임-이미지-라이브러리--a-정적--b-생성기).

## 2026-04-28 — 바운스 볼 (Breakout) 게임 + DSL `reach()` 슬롯 수정 + textBox 빈 text 폴백

- [x] **바운스 볼 게임** [`spec-bounce-ball.mjs`](../tests/fixtures/spec-bounce-ball.mjs).
  좌/우 화살표로 패들 이동, 공 위치 매 프레임 갱신, 벽·천장·벽돌·패들 반사. 6×3=18 벽돌 (행별 색).
  벽돌은 `when_run` + `repeat.inf([if reach('ball'): score+10, send 'ball_bounce', hide, stopRepeat])` 패턴으로 자기 충돌 감시 + 한 번 hit 후 종료.
  공은 메시지 두 종류: `ball_bounce` (dy 부호 반전, 벽돌용), `paddle_hit` (dy 양수 강제, 패들 더블 hit 방지).
  검증: [`verify-bounce-ball.mjs`](../tools/verify-bounce-ball.mjs) — 21 오브젝트 + 이동 + 키 입력 + 벽돌 파괴 + 패들 hit + GAME OVER (14/14 pass).
- [x] **DSL `reach()` 슬롯 위치 수정**.
  `reach_something` 의 paramsKeyMap 은 `VALUE: 1` — `[Text 라벨, DropdownDynamic 타겟, Text 라벨]`. 기존 DSL 은 `[target, null]` (2 슬롯, 잘못된 위치) → `[null, target, null]` 으로 정정.
  영향: DSL 로 작성된 fixture 는 `reach()` 가 정상. JSON 으로 작성된 기존 fixture (`spec-bullethell.json` 등) 는 raw 셰이프 그대로 — 별도 영향 없음 (단 spec-bullethell 의 2-슬롯 형태는 padding 후 idx 1 이 비어 정상 작동 안 했을 가능성).
- [x] **textBox `text: ''` 는 객체 이름으로 폴백** ([`entity.js:142`](../../entryjs/src/class/entity.js#L142): `entityModel.text || parent.text || parent.name`).
  빈 사각형이 필요하면 `text: ' '` (공백 1 개) 사용. 회귀 가드: `spec-bounce-ball.mjs` 의 18 벽돌 + 패들.

## 2026-04-28 — 생김새 17 블록 미디어 아트 + picture 런타임 상태

- [x] **생김새 카테고리 17 블록 전부 활용한 미디어 아트** [`spec-media-art.mjs`](../tests/fixtures/spec-media-art.mjs).
  3×3 mascot 그리드 + textBox 타이틀. 각 셀이 효과 / 모양 / 크기 / 뒤집기 / z-order / dialog 사이클을 평행 실행.
  검증: [`verify-media-art.mjs`](../tools/verify-media-art.mjs) — 17 블록 type 등장 + 3 시점 스크린샷 + entity 효과 누적 (23/23 pass).
  스레드 평행화 패턴: `cell()` 헬퍼가 thread 배열 (`[[trigger, ...], [trigger, ...]]`) 또는 단일 thread 자동 판별.
- [x] **DSL 생김새 13 블록 헬퍼 추가** ([`tools/lib/spec-dsl.mjs`](../tools/lib/spec-dsl.mjs)):
  `addEffect / setEffect / clearEffects` (color/brightness/transparency),
  `changeSize / setSize / stretch / resetSize`,
  `nextShape / prevShape / changeShape`,
  `flipX / flipY`, `zOrder('FRONT'|'FORWARD'|'BACKWARD'|'BACK')`, `removeDialog`.
- [x] **런타임 picture id = `entity.picture.id`** (NOT `selectedPictureId`).
  `selectedPictureId` 는 spec 초기값 고정. 헤드리스에서 현재 picture 읽을 때 주의.
  정본: [`07-runtime-quirks.md` 현재 picture](07-runtime-quirks.md#현재-picture-는-entitypictureid--selectedpictureid-는-spec-의-초기값).

## 2026-04-28 — textBox 클릭 hit-test (투명 vs hex bgColor) + 글상자 ask/answer 루프

- [x] **textBox 클릭 영역 = bgColor 의 함수**. `bgColor='#xxxxxx'` 면 사각 전체, `'transparent'`/falsy 면 textObject 의 glyph 알파 픽셀만 (pixelPerfect=true).
  실측: 5×5=25 점 그리드 → 투명 6/25 (24%, 70px ■■■), 불투명 25/25 (100%). 24px 작은 글자는 0/25 가능.
  근거: [`entity.js:65`](../../entryjs/src/class/entity.js#L65) (`textObject.pixelPerfect=true`) + [`entity.js:1538`](../../entryjs/src/class/entity.js#L1538) (`bgObject.alpha = hasColor ? 1 : 0`).
  **버튼 용도는 hex bgColor 필수**. 시각적 투명이 필요하면 scene 배경과 같은 hex.
  새 fixture: [`spec-textbox-click.mjs`](../tests/fixtures/spec-textbox-click.mjs), verify: [`verify-textbox-click.mjs`](../tools/verify-textbox-click.mjs).
  정본: [`07-runtime-quirks.md` textBox 클릭 영역](07-runtime-quirks.md#textbox-클릭-영역--bgcolor-에-따라-사각-전체-vs-glyph-픽셀만), [`04-script-and-blocks.md` 버튼 패턴](04-script-and-blocks.md#버튼-구현--textbox-가-sprite--dialog-보다-깔끔).
- [x] **DSL `obj()` 가 `text` 필드 통과 + `writeText`/`appendText`/`flushText` 헬퍼 추가**.
  textBox 오브젝트를 `obj('id', 'name', { objectType: 'textBox', text: '...', entity: { font, bgColor } })` 한 줄로 생성.
- [x] **글상자 ask/answer 루프 데모**: [`spec-name-loop.mjs`](../tests/fixtures/spec-name-loop.mjs) — `repeat.inf([askWait, writeText(getInput)])`. 한 textBox 가 자기 자신에게 답을 출력. verify: [`verify-name-loop.mjs`](../tools/verify-name-loop.mjs).

## 2026-04-25 — 종합 데모: 탄막 피하기 (붓 + 거리 충돌 + 랭킹 + 동적 배경)

지금까지 구축한 모든 인프라(DSL, verify-harness, --check, 함수, 재귀, 브러쉬, 거리 충돌)를 한 fixture 로 통합 데모.

- [x] 신규 [`tests/fixtures/spec-bullet-circle.mjs`](../tests/fixtures/spec-bullet-circle.mjs) — 10 오브젝트, 3 장면, 2 함수, 1 메시지, 2 cloud 리스트. **DSL 사용으로 수십개 블록을 평면 JS 로 작성**
- [x] **새 패턴 1 — 원-원 거리² 충돌**: 두 중심 간 `(x1-x2)² + (y1-y2)² < (r1+r2)²` 비교. sqrt 없이 산술만. 사용자 정의 value 함수 `dsq` 로 캡슐화
- [x] **새 패턴 2 — 동적 spawn rate**: spawner 가 `생존시간` 변수를 읽어 `spawn_count = 1 + floor(t/8)` 으로 시간 따라 동시 spawn 증가 (8/16/24/32/40/50초마다 +1). spawn 간격은 0.45 초로 고정
- [x] **새 패턴 3 — 4 모서리 무작위 spawn + 플레이어 조준**: `random(1, 4)` 로 모서리 선택 후 `see_angle_object('player')` (보이지 않는 player anchor sprite 가 cx/cy 추적) 으로 조준
- [x] **새 패턴 4 — 동적 주황 배경**: `bg_drawer` sprite 가 scene 시작 시 5 개 큰 부드러운 원을 다양한 색조 (peach-200/orange-300/orange-400) 로 brush 로 그림. drawstep 함수 재사용
- [x] **랭킹**: `nickname` 일반 변수 + `대답` (variableType: 'answer') 별도. `ask_and_wait` → `get_canvas_input_value` → setVar('nickname'). 점수 정렬은 memory-ranking 의 insertion-sort 패턴 재사용
- [x] DSL 확장: `seeAngle`, `combine` (5-슬롯 정렬), `insertAt` 추가
- [x] [`tools/verify-bullet-circle.mjs`](../tools/verify-bullet-circle.mjs) — 6-단계 검증 (메뉴 → 게임 → 충돌 → 결과 → 랭킹 → 메뉴 복귀): **10/10 통과, 0 페이지 에러**
- [x] **함정 발견**:
  - `combine_something` 의 paramCount=5 (Text 라벨 0/2/4 + Block VALUE 1/3) — 짧게 쓰면 padding 후 슬롯 어긋남. `combine(a, b)` DSL helper 가 `[null, a, null, b, null]` 로 풀어줌
  - `variableType: 'answer'` 변수를 임의 변수에 지정하면 ask_and_wait 가 답을 읽지 못함. `대답` 한 개만 두는 게 안전
  - `findColoredPixels` 의 hex 모드는 closure 값이 page.evaluate 직렬화 후 사라짐 — 임계값을 함수 소스에 inline 해서 우회 (verify-harness 수정)
- [x] 관련 문서: [04-script-and-blocks.md §원-원 거리 기반 충돌](04-script-and-blocks.md#원-원-거리-기반-충돌-reach_something-대체) 신설, [lessons.md](lessons.md) 에 함정 2 개 추가

## 2026-04-24 (13차) — Tier-3 #8 + #9 + #10: fixture 정리 + canonical 매트릭스 + spec 트리 viz

- [x] **#8 fixture 정리** — 22 spec → 14 spec (+ known-good = 15 fixture). 제거: `chase` (chase-hp 가 superset), `memory-pattern` (memory-ranking 이 superset), `random-walk`/`follow-mouse` (movement primitive 단순 데모, 다른 fixture 가 더 풍부), `dodge-poop`/`click-teleport` (각각 bullethell + 더 단순 패턴이 대체)
- [x] 인입 ref 갱신: [`knowledge/01-binary-format.md`](01-binary-format.md) (tar 검사 예제 follow-mouse → move), [루트 `README.md`](../README.md) (오브젝트 디자인 예시), [`tests/fixtures/README.md`](../tests/fixtures/README.md) (학습 경로 표)
- [x] **#9 canonical matrix 추가** — knowledge/README.md 에 "정본 매트릭스" 표 추가. 8 개 핵심 사실에 대해 정본 위치 + 다른 파일에서 한 줄로 줄이는 곳 명시. 새 사실 추가 시 이 표가 분기점
- [x] **#10 spec 트리 viz** — [`tools/show-spec.mjs`](../tools/show-spec.mjs) 신설. spec 파일을 ASCII 트리로 출력. 예: `node tools/show-spec.mjs tests/fixtures/spec-fibonacci.mjs --object runner`. 필드 슬롯 `«변수id»`, 블록 슬롯 child, 통계 inline. spec 검토를 editor 안 띄우고 가능
- [x] smoke: 21 → 15 (테스트 줄긴 했지만 모두 통과), verify:links 171 → 더 적게 (제거된 fixture 참조 줄음), 0 broken

## 2026-04-24 (12차) — Tier-3 #7a: knowledge 링크 무결성 자동 검증

knowledge 파일이 11개로 늘면서 cross-reference 부패가 우려되어 link checker 추가.

- [x] 신규 [`tools/check-knowledge-links.mjs`](../tools/check-knowledge-links.mjs) — 13 개 markdown 파일을 스캔, 203 개 link 검증. 검사 항목:
  - `[text](file)` — 상대 경로 타겟 파일 존재 여부
  - `[text](file#anchor)` — 타겟 파일에 해당 heading 존재 여부 (alnum 정규화로 GitHub slug 변형에 너그럽게 매칭)
  - 코드 펜스(```...```) 안 링크는 무시, `<!-- link-check: skip-rest-of-file -->` marker 부터 파일 끝까지 무시
- [x] 첫 실행에서 12 개 깨진 링크 발견:
  - 5 개 — 실제 깨진 링크 (Downloads/, 구 spec-fibonacci.json) → 텍스트로 변환하거나 새 위치로 갱신
  - 7 개 — 의도적으로 stale 한 5차 이전 history (`06-gotchas.md` 참조) → CHANGELOG의 5차/4차 경계에 skip marker 삽입
- [x] `npm run verify:links` 추가, 메인 `verify` 파이프라인이 smoke 직후 실행 (e2e/runtime 보다 빠르므로 빠른 피드백)

### 효과

다음 리팩터에서 파일 이동/삭제 시 깨진 링크가 자동으로 검출됨. 6차 (gotchas 분산) 같은 큰 구조 변경 후 7개 링크가 자동 검증 안 되어 한참 후에야 발견됐던 일을 방지.

## 2026-04-24 (11차) — Tier-2 워크플로 자동화: --check + verify:runtime + fixture 색인

10차 인프라 위에 작업 사이클을 빠르게 만드는 보완재.

- [x] **#5 — `make-ent --check` flag**: spec 빌드 없이 검증만. 잡는 항목:
  - 알 수 없는 블록 타입 (registry 에 없음)
  - paramCount 초과 (실제 에러)
  - paramCount 미달 (경고 — make-ent 가 padding)
  - statementCount 초과 (실제 에러)
  - **field 슬롯에 block 들어감** (경고 — 우리가 가장 자주 겪던 함정)
  - exit 1 if errors, 0 otherwise
- [x] **`validateSpec(spec)` export**: 다른 도구가 재사용 가능 (예: spec lint)
- [x] **#4 — `npm run verify:runtime`**: [`tools/run-all-verify.mjs`](../tools/run-all-verify.mjs) 가
  `tools/verify-*.mjs` 7 개를 순차 실행 + 서버 자동 기동/정리 + 결과 집계.
  현재 실행: 7/7 통과, 총 98초. `npm run verify` 가 이제 smoke + e2e + runtime 다 포함
- [x] **#6 — [`tests/fixtures/README.md`](../tests/fixtures/README.md)**: 22 fixture 색인.
  패턴별 "정본" 매트릭스 + verify 스크립트 매핑 + DSL 마이그레이션 가이드 + 새 fixture
  추가 8 단계 절차. 미래의 자기/협업자가 어디서 시작할지 즉시 알 수 있게

### 작업 사이클 변화

이전 (10번의 fixture 작성에서):
```
spec 작성 → make-ent → smoke → server up → 단일 verify → spec 수정 → 재빌드 → 재실행
```
한 사이클 평균 5–10분. 새 패턴은 더.

이후:
```
spec 작성 (DSL)
  → make-ent --check     ← 즉시 (1초)
  → make-ent
  → npm run verify:runtime  ← 회귀 자동 검출
```
한 사이클 평균 1–2분. 함정을 더 빨리 잡고, 다른 fixture 까지 깨졌는지 자동 확인.

## 2026-04-24 (10차) — Tier-1 인프라 개선: 슬롯 타입 + DSL + verify-harness

지난 9개 fixture 작성에서 가장 비싼 함정(`__field` vs bare string 5회 + 8단 중첩 JSON 작성 비용)을 근본적으로 줄이기 위한 3개 인프라 업그레이드.

- [x] **#2 — block-registry 에 슬롯 타입 정보 추가**: [`tools/build-block-registry.mjs`](../tools/build-block-registry.mjs) 에 `extractParamShape` 추가. 274 블록 모두 파싱하여 각 param의 `{type, accept?, menu?, defaultType?}` 추출 (Block / Dropdown / DropdownDynamic / Keyboard / TextInput / Indicator / ...)
- [x] **make-ent `wrapParam` 가 슬롯 타입을 인식**: 필드 타입(`Dropdown` / `DropdownDynamic` / `Keyboard` / `TextInput`) 슬롯에 bare string 이 들어오면 자동으로 통과 — `__field` sentinel 명시 없이도 정상 작동. `__field` 는 여전히 합성 타입(`stringParam_<id>`) 등 registry 에 없는 슬롯의 안전판으로 유효
- [x] **#3 — `tools/lib/verify-harness.mjs` 신설**: 6개 verify 스크립트가 각자 재구현하던 헬퍼 통합:
  - `runFresh(page, vars)` — toggleStop(async await) + setVar + toggleRun 안전 순서. `toggleStop` 이 비동기로 변수 snapshot 복원하므로 set 은 stop 이후, run 이전에 (8차 발견)
  - `setVar` / `getVar` / `getList`
  - `clickObject` / `sendMessage` / `holdKey` / `tapKey` (KEY_CODE_MAP 포함)
  - `waitFor` / `waitForVar` 폴링
  - `findColoredPixels` (green/red/blue/hex tolerance) — 이전 healthbar/circle 에 중복됐던 픽셀 분석
  - `createReporter()` 미니 expect — `t.eq/t.ok/t.between` + 자동 summary
- [x] **#1 — `tools/lib/spec-dsl.mjs` 신설**: spec 작성용 DSL. `setVar('hp', 0)` / `getVar` / `calc` / `cmp` / `if_` / `repeat.basic` / `fn.value(id, params, body, returnExpr)` / `call(id, ...args)` / `obj()` / `picture()` 등. 8단 중첩 JSON → 평면 JS
- [x] **make-ent CLI 가 `.mjs` spec 지원**: `node make-ent.mjs spec.mjs out.ent` — dynamic import 후 default export 사용
- [x] **데모: fibonacci 마이그레이션**: [`tests/fixtures/spec-fibonacci.mjs`](../tests/fixtures/spec-fibonacci.mjs) (76줄) ↔ 이전 `spec-fibonacci.json` (163줄). **53% LOC 감소**, 동일한 `.ent` 출력. [`tools/verify-fibonacci.mjs`](../tools/verify-fibonacci.mjs) 도 verify-harness 사용으로 122줄 → 75줄 (38% 감소). 12/12 assertion 통과
- [x] 기존 22 fixture 의 `.json` spec 은 그대로 유지 (호환). 새 fixture 부터 `.mjs` + DSL 권장

### 함의

이전: `set_variable("hp", 0)` 작성 = `{type: "set_variable", params: [{__field: "hp"}, {type: "number", params: ["0"]}, null]}` (수동 JSON, `__field` 까먹으면 `[object Object]`).

이후: `setVar('hp', 0)` (DSL 한 줄). registry 가 슬롯 0이 `DropdownDynamic` 임을 알아서 bare string 자동 처리.

이 변경은 **이전 9개 fixture 의 모든 `__field` 디버깅 시간 (총 ~3시간) 을 향후 0 으로 만든다**.

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

- [x] 새 fixture `tests/fixtures/spec-fibonacci.json` (10차에서 [`.mjs`](../tests/fixtures/spec-fibonacci.mjs) 로 이관) — Entry의 `function_create_value` 로 정의된 반복 알고리즘 피보나치 함수. 입력은 slide 변수 (0-30), 결과는 visible 변수 + 수열 리스트
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

<!-- link-check: skip-rest-of-file -->
<!--
   아래 항목들은 5차 이전의 역사 기록입니다. `06-gotchas.md` 가 5차에서 폐지되어
   이 섹션의 링크들은 의도적으로 깨져 있고, 파일 상단 안내 박스가 새 위치를 알려줍니다.
   tools/check-knowledge-links.mjs 는 위 marker 아래 영역을 검사하지 않습니다.
-->

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
