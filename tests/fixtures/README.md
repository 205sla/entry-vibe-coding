# Fixture 색인

각 fixture 의 목적, 시연 패턴, 관련 verify 스크립트, 관련 knowledge 페이지를 정리.

> 빌드: `node tools/make-ent.mjs <spec.{json,mjs}> <name>.ent`
> 검증만 (빌드 없이): `node tools/make-ent.mjs --check <spec>`
> 트리 보기: `node tools/show-spec.mjs <spec> [--object id] [--func id]`
> 검증 (단일): `node tools/verify-<name>.mjs`
> 검증 (전체): `npm run verify:runtime`

## 학습 경로 — 처음 본다면 어디부터?

새 fixture 작성 시 참고할 "정본" 예제. 패턴별로 가장 단순/완전한 것 우선.

| 알고 싶은 것 | 정본 fixture | DSL? | 보조 |
|---|---|:---:|---|
| **빈 프로젝트** (최소 구조) | [`empty`](spec-empty.json) | | |
| **블록 한 줄 실행** | [`move`](spec-move.json) | | |
| **변수 + repeat_basic** | [`variable`](spec-variable.json) | | |
| **방향키 + 추격 + HP 변수 + 충돌 + 게임 오버** | [`chase-hp`](spec-chase-hp.json) | | |
| **원-원 거리 충돌 + 시간 점수 + 클라우드 랭킹 + 동적 배경** | [`bullet-circle`](spec-bullet-circle.mjs) | ✓ | 종합 데모 (10 오브젝트, 3 장면, 2 함수) |
| **공유 리스트 (`isCloud`) + ask_and_wait + insertion sort** | [`memory-ranking`](spec-memory-ranking.json) | | |
| **시차 스크롤 플랫포머 + reach_something 충돌** | [`platformer`](spec-platformer.json) | | |
| **3 장면 게임 (메뉴 → 플레이 → 결과)** | [`bullethell`](spec-bullethell.json) | | |
| **붓 + slide 변수로 동적 그래픽** | [`healthbar-brush`](spec-healthbar-brush.json) | | |
| **반복하기 60fps 암묵 틱 측정** | [`repeat-timing`](spec-repeat-timing.json) | | `repeat-timing-wait` (wait 비교) |
| **사용자 정의 함수 (`function_create_value`)** | [`spec-fibonacci.mjs`](spec-fibonacci.mjs) | ✓ | |
| **글상자 (`text_write`) + ask_and_wait 루프** | [`spec-name-loop.mjs`](spec-name-loop.mjs) | ✓ | textBox 단일 오브젝트 데모 |
| **textBox 클릭 hit-test (투명 vs hex bgColor)** | [`spec-textbox-click.mjs`](spec-textbox-click.mjs) | ✓ | 버튼 디자인 회귀 가드 |
| **생김새 17 블록 종합 — 미디어 아트** | [`spec-media-art.mjs`](spec-media-art.mjs) | ✓ | 3×3 mascot 그리드 + 효과/모양/크기/뒤집기/z-order 동시 시연 |
| **바운스 볼 (Breakout 스타일) — 패들·벽돌·점수·목숨·게임오버** | [`spec-bounce-ball.mjs`](spec-bounce-ball.mjs) | ✓ | 6×3 벽돌 + 메시지 기반 충돌 반사 |
| **과일 사냥 — 3×3 클론 grid + 붓 타이머 + 점수/콤보/레벨** | [`spec-fruit-hunt.mjs`](spec-fruit-hunt.mjs) | ✓ | 클론 좌표 비교로 정답 판정 + 붓 매 프레임 redraw |
| **프론티어 가드 Phase 3.2 — 디펜스 게임 종합 reference (12 패턴, 7 단계 진화)** | [`spec-frontier-guard.mjs`](spec-frontier-guard.mjs) | ✓ | 다중 scene + 빌드 슬롯 + 골드 + 업그레이드 + 준비 단계 + brush 공격 빔 + 데미지 플래시 + multi-type 적 + splash AOE + direction-as-id + manager-as-spawner + filled-circle 클릭 가능 슬롯. 새 게임 시작 시 reference 로 활용 가능. 자세한 작업 history: [knowledge/CHANGELOG.md §디펜스 게임 회고](../../knowledge/CHANGELOG.md) |
| **꼬리 재귀로 60fps 틱 우회 + per-frame budget** | [`recursion`](spec-recursion.json) | | |
| **재귀로 매 프레임 그래픽 (원 + 방향키 이동)** | [`circle-recursive`](spec-circle-recursive.json) | | |
| **임의 scene id 회귀 가드** | [`scene-custom-id`](spec-scene-custom-id.json) | | |

## 외부 레퍼런스

| | |
|---|---|
| [`known-good.ent`](known-good.ent) | playentry.org 실제 export (`01_정답의 리메이크`). spec 짝 없음 — smoke 회귀 가드 ([`tests/smoke.test.js`](../smoke.test.js) 상단 주석 참조) |

## DSL vs JSON

기존 fixture 22개 중 `spec-fibonacci.mjs` 만 [DSL](../../tools/lib/spec-dsl.mjs) 로 작성됨 — 비교용 데모 (76 LOC vs 이전 JSON 163 LOC, 동일 `.ent`). 새 fixture 부터는 **DSL 권장**:

```js
// .mjs spec example
import { setVar, getVar, calc, when, repeat, fn, call, obj, picture } from '../../tools/lib/spec-dsl.mjs';

export default {
    name: '예시',
    variables: [{ id: 'hp', name: '체력', value: '3' }],
    objects: [obj('p', '플레이어', {
        picture: '/images/mascot/bot205-idle.svg',
        script: [ when.run(), setVar('hp', 3), /* ... */ ],
    })],
};
```

## Verify 스크립트 매핑

런타임 동작까지 검증하는 fixture:

| Fixture | Verify 스크립트 | 검증 내용 |
|---|---|---|
| `bullethell` | [`verify-bullethell.mjs`](../../tools/verify-bullethell.mjs) | 4 단계 장면 전환 (menu → play → result → menu) + 생존시간 변수 |
| `circle-recursive` | [`verify-circle-recursive.mjs`](../../tools/verify-circle-recursive.mjs) | 픽셀 분석으로 원 렌더 + 방향키로 이동 |
| `fibonacci` | [`verify-fibonacci.mjs`](../../tools/verify-fibonacci.mjs) | n ∈ {0,1,2,5,10,15} fib 결과 + 수열 리스트 (verify-harness 데모) |
| `name-loop` | [`verify-name-loop.mjs`](../../tools/verify-name-loop.mjs) | 답 3 회 주입 → 글상자 text 갱신 (`canvasInputComplete` + `text_write`) |
| `textbox-click` | [`verify-textbox-click.mjs`](../../tools/verify-textbox-click.mjs) | 5×5 그리드 클릭: 투명 24% vs 불투명 100% — pixelPerfect 동작 회귀 가드 |
| `media-art`     | [`verify-media-art.mjs`](../../tools/verify-media-art.mjs)         | 17 looks 블록 type 등장 + 3 시점 스크린샷 + 효과/picture 누적 변화 |
| `bounce-ball`   | [`verify-bounce-ball.mjs`](../../tools/verify-bounce-ball.mjs)     | 21 오브젝트 + 공 이동 + 좌/우 키 패들 + 벽돌 파괴 + 패들 hit + GAME OVER |
| `fruit-hunt`    | [`verify-fruit-hunt.mjs`](../../tools/verify-fruit-hunt.mjs)       | 9 클론 spawn + 정답 클릭 → score/combo + 스테이지 클리어 → 새 라운드 + 페널티 + GAME OVER |
| `healthbar-brush` | [`verify-healthbar-brush.mjs`](../../tools/verify-healthbar-brush.mjs) | hp ∈ {100,50,10,0} 픽셀 단조성 |
| `platformer` | [`verify-platformer.mjs`](../../tools/verify-platformer.mjs) | 발판별 착지 y + 시차 스크롤 |
| `recursion` | [`verify-recursion.mjs`](../../tools/verify-recursion.mjs) | 꼬리재귀 0ms vs 반복 480ms + 지수재귀 budget |
| `repeat-timing` | [`verify-repeat-timing.mjs`](../../tools/verify-repeat-timing.mjs) | 180회 repeat = 2.87s ≈ 3.00s (60fps) |

전체 일괄 실행: `npm run verify:runtime`

## Knowledge 페이지

| 패턴 | Knowledge |
|---|---|
| 블록 type / params shape | [`knowledge/04-script-and-blocks.md`](../../knowledge/04-script-and-blocks.md) |
| 60fps 틱, 재귀 우회, short-circuit, 키 이벤트 | [`knowledge/07-runtime-quirks.md`](../../knowledge/07-runtime-quirks.md) |
| 헤드리스 검증 (이벤트 dispatch 등) | [`knowledge/05-host-editor.md`](../../knowledge/05-host-editor.md) |
| 해결된 버그 (가드 링크) | [`knowledge/lessons.md`](../../knowledge/lessons.md) |
| 30초 진입점 | [`knowledge/quick-reference.md`](../../knowledge/quick-reference.md) |

## 새 fixture 추가 절차

1. `tests/fixtures/spec-<name>.mjs` (DSL) 또는 `.json` 작성
2. `node tools/make-ent.mjs --check tests/fixtures/spec-<name>.{mjs,json}` 으로 검증
3. `node tools/make-ent.mjs tests/fixtures/spec-<name>.{mjs,json} tests/fixtures/<name>.ent` 빌드
4. `npm run test:smoke` (자동 발견)
5. (선택) `tools/verify-<name>.mjs` 작성 — `bootEditor`/`loadFixture` + `verify-harness` 사용
6. `npm run verify:runtime` 으로 회귀 확인
7. 새 패턴/함정 발견 시 → `knowledge/07-runtime-quirks.md` 또는 `lessons.md` 에 추가
8. 이 README 의 "학습 경로" 표에 한 줄 추가
