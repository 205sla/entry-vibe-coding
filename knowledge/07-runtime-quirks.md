# Runtime Quirks — Entry 엔진의 불변 동작

Entry 엔진(entryjs) 고유 동작 중 **make-ent가 자동으로 처리할 수 없는 것들**.
스크립트를 짜거나 테스트 할 때 직접 알고 있어야 한다.

각 항목은:
- 증상 / 재현 조건
- 근거 (entryjs 소스 줄 번호)
- 회피 / 해결 패턴

이 파일은 **append-only**. 항목 자체는 Entry 엔진이 바뀌지 않는 한 불변.

---

## `Entry.clearProject()` — loadProject 전 필수

Entry는 `loadProject(project)` 시 **기존 scene/object를 덮어쓰지 않고 append** 한다.
- [`entryjs/src/class/container.js:285`](../../entryjs/src/class/container.js#L285) `setObjects` — 기존 objects에 push
- [`entryjs/src/util/utils.js:143`](../../entryjs/src/util/utils.js#L143) `Entry.clearProject`는
  `Entry.scene.clear()` + `Entry.container.clear()` + `Entry.variableContainer.clear()` 로 완전 리셋

두 번째 `loadProject` 전 `clearProject()`를 선행하지 않으면:
- 기존 오브젝트(starter의 엔트리봇 등)가 남은 채로 새 프로젝트 오브젝트가 덧붙음 → 썸네일 회색 박스
- 이전 scene 바인딩이 새 scene id와 충돌 → `addChildAt(undefined)` crash

**구현**: [`public/js/editor.js`](../public/js/editor.js) `loadEntFile`.

**부수 효과**: scene id도 무엇이든 가능해짐 — starter의 `"7dwq"`에 맞출 필요 없음.

---

## 반복하기 블록 = 1 프레임/반복 (60fps 암묵 틱)

`repeat_basic` / `repeat_inf` 등 반복 블록의 각 iteration 마지막에 **프레임 경계**가
삽입된다. `Entry.FPS=60` 기본값 기준 반복 1회 ≈ 16.67ms.

### 실측 (2026-04-24, headless chromium)

| 루프 내용 | 반복 180회 소요 | 반복당 |
|----------|----:|----:|
| `move_direction(1)` | **2.87s** (이론 3.00s) | ≈ 16ms (1 프레임) |
| `move_direction(1)` + `wait_second(0.02)` | **8.62s** | ≈ 48ms (≈ 3 프레임) |

### `wait_second(t)`의 실제 비용

이론은 `t` 초 추가지만, 실제는 **`ceil(t / 16.67ms) + 1` 프레임**:
`wait_second(0.02)` → 3 프레임 ≈ 50ms (2.5× 부풀림).

원인 2단계 ([`block_flow.js:47-73`](../../entryjs/src/playground/blocks/block_flow.js#L47)):
1. `Entry.TimeWaitManager`의 setTimeout이 다음 tick에만 `timeFlag=0` 확인 —
   20ms 대기 요청이 16.67ms 프레임 경계를 이미 지나쳤으면 2 프레임 소모
2. 타이머 종료 시 `Entry.engine.isContinue = false` → 현 tick의 남은 시간을 다음 tick으로 양보 → +1 프레임

### 실용 지침

- **자연스러운 이동은 wait 없이, 작은 delta로 반복**.
  `wait_second(0.1) + move(10)` → `move(0.167)` (같은 100px/s 속도지만 60fps).
  공식: `per_frame_delta = desired_px_per_sec / 60`.
- **wait는 의도적 일시정지에만** — 게임 상태 전환, 메시지 표시 등. 매 프레임 움직이는 루프에는 불필요.
- **"반복은 초당 최대 60회"** — 무거운 블록이 많으면 한 프레임 안에 다 못 돌 수도 있음

### 증거

- [`tests/fixtures/spec-repeat-timing.json`](../tests/fixtures/spec-repeat-timing.json) — baseline
- [`tests/fixtures/spec-repeat-timing-wait.json`](../tests/fixtures/spec-repeat-timing-wait.json) — wait 변형
- [`tools/verify-repeat-timing.mjs`](../tools/verify-repeat-timing.mjs) — 자동 판정 스크립트

---

## 함수 호출은 반복하기의 60fps 틱을 우회 (꼬리 재귀 최적화)

`function_value` (값 반환 함수) 호출은 동기 평가되어 **반복하기의 1 프레임/반복 지연을
우회**한다. 그래서 무거운 반복 연산은 꼬리 재귀 함수로 옮기면 성능이 크게 향상.

### 실측 비교 (n=30)

같은 fibonacci(30) = 832040 계산:

| 구현 | 소요시간 (projectTimer) | 비고 |
|------|--------------------:|------|
| `func_fibtail(30, 0, 1)` 꼬리재귀 | **0.00s** (단일 프레임) | 30 번의 함수 호출이 한 tick 내에 동기 완료 |
| `func_fibiter(30)` (`repeat_basic` 기반) | **0.48s** | 30 × 1/60 ≈ 500ms — 매 반복 1 프레임 소비 |

차이: **>500×**. 이게 꼬리재귀 최적화의 핵심 동기.

### 패턴

```
함수 fib_tail(n, a, b) 반환값:                ← 본문
    ↑ 본문에서 if_else:
        n == 0 이면: ret = a
        아니면:      ret = fib_tail(n-1, b, a+b)
    ↑ 반환값(params[3]): get_variable(ret)
```

본문에서 `set_variable("ret", <recursive call>)` 로 갱신, 반환은 단순 `get_variable("ret")`.

### 단, 한계: 한 프레임 안의 호출 budget

함수 호출이 **단일 프레임 안에 너무 많이** 누적되면:

1. **이상적 한계**: 동기 깊이가 JS 스택을 초과 → `RangeError` → Entry 의 catch 블록이
   `Entry.toast.alert(RecursiveCallWarningTitle, …)` + `stopProjectWithToast`로 정지.
   근거: [`entryjs/src/playground/executors.js:60-62`](../../entryjs/src/playground/executors.js#L60).

2. **실측 관찰 (Entry 1.x + 모던 V8)**: 단순 깊이만 큰 재귀는 RangeError 까지 가지 않고
   Entry 가 `funcRestExecute` (rAF 큐) 로 자동 분할 → 매우 느리게 진행.
   `fibnaive(28)` ≈ 832K 호출 = **11.5s** wall-clock (사용자 체감 "멈춤").
   `fibnaive(25)` ≈ 150K 호출 = 3s.

### 실용 지침

- **반복 → 꼬리 재귀**: `repeat_basic` 안에 무거운 계산이 있다면 같은 알고리즘을 꼬리
  재귀로 바꿔 한 프레임 내 동기 처리. 60fps 틱 비용 제거.
- **재귀 깊이/총 호출 수 모니터**: 깊이 ≥ ~수천, 또는 총 호출 수 ≥ ~10만이면 사용자
  체감 멈춤. 알고리즘이 지수 폭발(`fib(n-1) + fib(n-2)`)이면 꼬리 재귀로도 안 됨 →
  메모이제이션 (전역 리스트에 캐시) 필요.
- **경고 토스트** 출현 시 (특히 playentry.org 업로드 후 실행): "재귀 호출 횟수가 너무
  많습니다" 류 메시지가 떴다면 꼬리 재귀 + 깊이 축소를 적용

### 증거

- [`tests/fixtures/spec-recursion.json`](../tests/fixtures/spec-recursion.json) — `fibtail` (꼬리재귀, value), `fibiter` (반복, value), `fibnaive` (지수재귀, 비-꼬리)
- [`tools/verify-recursion.mjs`](../tools/verify-recursion.mjs) — Test 1+2: 꼬리재귀 0ms vs 반복 ~480ms 자동 검증. Test 3: per-frame budget 관찰
- [`entryjs/src/playground/blocks/block_func.js:415-491`](../../entryjs/src/playground/blocks/block_func.js#L415) — `function_value.func` 의 sync/async 분기
- [`entryjs/src/playground/code.js:587`](../../entryjs/src/playground/code.js#L587) — `funcRestExecute` rAF 분할

---

## `boolean_and_or`에 단락 평가(short-circuit) 없음

Entry의 AND/OR 블록은 **두 피연산자를 항상 평가**.
JavaScript의 `&&` 단락 평가 전에 `getValues(['LEFTHAND', 'RIGHTHAND'])`가 이미 두 값을
구해 놓는다 ([`block_judgement.js:boolean_and_or`](../../entryjs/src/playground/blocks/block_judgement.js)).

### 실패 예

```
반복하기 (pos ≤ 항목수 AND level ≤ _점수[pos]) 인 동안:
    pos += 1
```

pos가 리스트 끝을 넘어가는 순간에도 RIGHTHAND가 평가되어 `value_of_index_from_list`가
[`block_variable.js:866`](../../entryjs/src/playground/blocks/block_variable.js#L866)의
guard `if (index > array.length) throw …`를 터뜨림 → `can not insert value to array`
런타임 에러.

### 해결 패턴 — 순차 `_if + stop_repeat` 가드

AND 대신 **순차 가드**로 명시적으로 short-circuit 흉내:

```
repeat_inf:
    _if (pos > 항목수):            ← 먼저 범위 체크
        stop_repeat
    _if (level > _점수[pos]):       ← 여기는 pos ≤ 항목수 보장됨
        stop_repeat
    pos += 1
```

첫 `_if`가 통과하면 `stop_repeat`으로 루프 종료 → 두 번째 `_if`는 실행 안 됨.
두 번째 `_if` 도달 시 `pos ≤ 항목수`가 보장 → 리스트 접근 안전.

### 일반화

`boolean_and_or`, `boolean_basic_operator` 등 **모든 Entry 불리언 합성 연산자**는
양쪽 항상 평가. 부작용 / 예외 가능성이 있는 sub-expression은 nested `_if` 패턴으로 분해.

### 증거

- [`tests/fixtures/spec-memory-ranking.json`](../tests/fixtures/spec-memory-ranking.json) — insertion sort 루프에서 적용

---

## 키 이벤트는 `document` + `event.code` 로 dispatch

Entry의 키 리스너는 **`document`에 직접** 붙어 있고 **`event.code`** (W3C 코드 문자열) 를 읽음.

### 핵심 규칙 (헤드리스 합성 이벤트 기준)

1. **타겟은 `document`** (window 아님)
2. **`event.code`** (`'ArrowRight'`, `'Space'`, `'KeyA'` 등) 필수. `event.keyCode`는 무시됨
   (Modern KeyboardEvent에서 `keyCode`는 read-only라 생성자 옵션도 먹지 않음)
3. 키 누름 **유지**가 필요하면 keydown만 쏘고 keyup 미전송. Entry가 `pressedKeys[]` 배열로 상태 관리 —
   keydown push, keyup pop. 단발 탭은 keydown+keyup 짝

### 근거

[`entryjs/src/util/utils.js:810-823`](../../entryjs/src/util/utils.js#L810):
```js
Entry.pressedKeys = [];
const func = (e) => {
    const keyCode = Entry.Utils.inputToKeycode(e);  // ← event.code → 숫자 매핑
    if (!keyCode) return;
    if (Entry.pressedKeys.indexOf(keyCode) < 0) Entry.pressedKeys.push(keyCode);
};
addEntryEvent(doc, 'keydown', func);   // doc = document
```

`inputToKeycode` ([utils.js:860](../../entryjs/src/util/utils.js#L860)):
```js
let keyCode = event.code == undefined ? event.key : event.code;
return Entry.KeyboardCode.codeToKeyCode[keyCode];
```

### 올바른 예

```js
// 단발 탭
document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight' }));
document.dispatchEvent(new KeyboardEvent('keyup',   { code: 'ArrowRight', key: 'ArrowRight' }));

// 누른 상태 유지 (플랫포머처럼)
document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight' }));
// …게임 플레이…
document.dispatchEvent(new KeyboardEvent('keyup',   { code: 'ArrowRight', key: 'ArrowRight' }));
```

### 틀린 예 (시행착오)

```js
// 실패 1: window에 dispatch — Entry 리스너는 document에
window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 39 }));

// 실패 2: keyCode만 — event.code가 undefined → inputToKeycode null
document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 39 }));
```

### 도구

- [`tools/inspect.mjs`](../tools/inspect.mjs) `--key CODE N` — CODE_MAP 으로 숫자 shorthand 지원 (37→ArrowLeft)
- [`tools/verify-platformer.mjs`](../tools/verify-platformer.mjs) — 방향키 유지 상태 시뮬
