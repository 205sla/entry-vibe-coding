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

---

## textBox 클릭 영역 — bgColor 에 따라 사각 전체 vs glyph 픽셀만

textBox 오브젝트의 `when_object_click` 클릭 인식 영역은 **`entity.bgColor`** 에 따라 결정:

| bgColor | bgObject.alpha | 클릭 hit 영역 |
|---------|:----:|--------------|
| `'#xxxxxx'` (hex) | 1 | **사각 전체** (entity.width × entity.height) |
| `'transparent'` / undefined / 빈값 | 0 | **글자(glyph) 알파>1 픽셀만** — `textObject.pixelPerfect=true` |

투명 textBox 는 **글자 stroke 위 정확한 픽셀**에만 클릭이 잡힘. 사각 영역의 빈 공간이나 글자 사이 whitespace 는 무반응.

### 메커니즘

1. **bgObject (사각 배경) 의 alpha 게이팅** — [`entity.js:1537-1539`](../../entryjs/src/class/entity.js#L1537):
   ```js
   const hasColor = (bgColor || '').indexOf('#') === 0;
   this.bgObject.alpha = hasColor ? 1 : 0;   // ← transparent → 0 → 사각 영역 hit 비활성
   ```

2. **textObject 는 pixel-perfect hit-test** — [`entity.js:65`](../../entryjs/src/class/entity.js#L65):
   ```js
   this.textObject.pixelPerfect = true;     // ← glyph 알파>1 픽셀만 hit
   ```
   plugin 동작: [`PIXIPixelPerfectInteractionPlugIn.js:84`](../../entryjs/src/class/pixi/plugins/PIXIPixelPerfectInteractionPlugIn.js#L84) — `rgba.data[3] > pixelPerfectAlpha (=1)` 체크.

3. 결과: 투명 배경 → bgObject 비활성 + textObject 만 hit-test → glyph 만 클릭됨.

### 실측 (verify-textbox-click.mjs, 5×5=25 점 그리드, 70px 폰트 ■■■)

| | 사각 영역 25 점 클릭 | hit 율 |
|--|--:|--:|
| 투명 (`bgColor='transparent'`) | 6 / 25 | **24%** |
| 불투명 (`bgColor='#3b82f6'`) | 25 / 25 | **100%** |

투명 box 의 6 회 hit 는 그리드 점이 ■ glyph 위에 떨어진 경우. 글자가 작거나 stroke 가 얇으면 hit 율이 0% 에 수렴 (24px 폰트 + 작은 ■ 1 개로 테스트 시 0/25). `entityClick` 직접 dispatch 는 두 box 모두 정상 fire — 핸들러 자체는 wired.

### 실용 지침

- **버튼으로 쓰려면 `bgColor: '#ffffff'` (또는 임의 hex) 명시**. 사각 전체 hit 가능. 시각적 투명이 필요하면 scene 배경과 같은 hex — 보이지 않지만 hit 영역 살아남음.
- 디자인상 정말 투명 + 사각 영역 클릭이 필요하면: 같은 위치에 투명 PNG sprite 를 별도 오브젝트로 깔고 `when_object_click` 을 sprite 에 붙이기. 글자는 textBox, hit-test 는 sprite — 분업.
- 디버깅: `Entry.container.getAllObjects().find(o=>o.id===X).entity.bgColor` 로 확인. `'transparent'` 또는 falsy 면 사각 클릭 안 됨.

### 증거

- [`tests/fixtures/spec-textbox-click.mjs`](../tests/fixtures/spec-textbox-click.mjs) — 투명 vs hex bgColor 두 textBox
- [`tools/verify-textbox-click.mjs`](../tools/verify-textbox-click.mjs) — 5×5 그리드 클릭 + entityClick 직접 dispatch + canvas 좌표 변환

### 관련 패턴

- 버튼 디자인 패턴: [`04-script-and-blocks.md` 버튼 — textBox 권장](04-script-and-blocks.md#버튼-구현--textbox-가-sprite--dialog-보다-깔끔)

---

## sprite 도 pixelPerfect — 투명 픽셀 (ring 가운데 등) 클릭 안 됨

textBox 의 `pixelPerfect` 함정과 같은 원리가 **모든 sprite 에도 적용**. [`entity.js:46`](../../entryjs/src/class/entity.js#L46) 에서 sprite 생성 시 `this.object.pixelPerfect = true`. 클릭 hit-test 가 source 텍스처의 픽셀 알파 검사.

`PIXIPixelPerfectInteractionPlugIn.js:78-87` — `containsPoint` → `_pixelHasAlpha`:
```js
ctx.drawImage(source, left, top, 1, 1, 0, 0, 1, 1);
const rgba = ctx.getImageData(0, 0, 1, 1);
return rgba.data[3] > this.pixelPerfectAlpha;  // = 1
```

source 의 한 픽셀 알파 > 1 만 hit. **`setEffect('transparency', N)` 같은 entity 효과는 source 알파에 영향 없음** — 효과는 렌더링 단계, hit-test 는 source 단계.

### 실패 패턴 — ring 모양 가운데 클릭 무반응

sprite-gen 의 `ring(rOuter, rInner, fill)` 은 도넛 모양 → 가운데 (rInner 안) 픽셀이 transparent. 가운데 클릭 시 source 알파 0 → hit 실패.

```js
import { ring } from '../../tools/lib/sprite-gen.mjs';
const slotEmpty = ring(22, 16, '#94a3b8');  // 외부 22, 내부 16 → 가운데 16px 투명
// 슬롯 클릭 시 가장자리 6px 두께 annulus 만 hit. 가운데 안 됨.
```

증상: 작은 sprite 의 가운데에 ring 같은 빈 영역이 있을 때, 가운데가 시각적으로 비어있어 보이지만 사실 클릭 무반응 — UI 슬롯/뱃지 디자인의 흔한 함정.

### 회피 패턴 — filled circle 사용

```js
import { circle } from '../../tools/lib/sprite-gen.mjs';
const slotEmpty = circle(20, '#94a3b8');  // 전체 면 채움
// 추후 setEffect('transparency', 70) 으로 시각적 ghosted — 클릭은 전체 면적
```

요점: **시각 transparency (효과) 와 클릭 hit-test 는 분리**. 효과로 fade out 해도 source 픽셀 알파 가 1 보다 크면 클릭 가능.

### 일반화

- 시각 강조 위해 ring/도넛 모양이 필요할 때, **클릭 가능 영역은 별도** sprite 로 (filled circle 위에 ring overlay) 또는 ring 가운데에 작은 invisible filled sprite.
- pixel-perfect hit-test 검증: `Entry.dispatchEvent('entityClick', entity)` 는 hit-test 우회 → verify 통과해도 실제 사용자 클릭은 실패할 수 있음. 회귀 가드는 **`page.mouse.click(px, py)` 로 stage point 직접 클릭** 해야 정확히 잡힘.

### 증거

- [`tests/fixtures/spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs) Phase 3.2 — `circle(20, '#94a3b8')` 로 전환. 이전 `ring(22, 16, ...)` 는 가운데 클릭 무반응.
- [`tools/verify-frontier-guard.mjs`](../tools/verify-frontier-guard.mjs) Step 1b — 실제 stage point click (`clickStagePoint(-160, 50)`) 로 슬롯 가운데 클릭 → 메뉴 열림 검증. dispatchEvent 와 분리된 회귀 가드.
- 코드: [`PIXIPixelPerfectInteractionPlugIn.js:78`](../../entryjs/src/class/pixi/plugins/PIXIPixelPerfectInteractionPlugIn.js#L78) `_pixelHasAlpha`. `pixelPerfectAlpha = 1` (= 알파 > 1 만 hit).

### 관련 패턴

- textBox 의 같은 함정: [§textBox 클릭 영역](#textbox-클릭-영역--bgcolor-에-따라-사각-전체-vs-glyph-픽셀만)

---

## 현재 picture 는 `entity.picture.id` — `selectedPictureId` 는 spec 의 초기값

`change_to_some_shape` / `change_to_next_shape` 로 picture 를 바꿔도 **`object.selectedPictureId` 는 갱신되지 않음** — spec 의 초기 설정값에 고정. 실시간 picture 는 **`object.entity.picture.id`** 로만 정확히 읽을 수 있다.

### 실측

`spec-media-art.mjs` 의 `cell_ml` 이 `repeat.inf([wait(0.4), nextShape()])` 로 mascot 4 종을 순환할 때:

| 필드 | 2.5 초 후 값 | 의미 |
|------|------------|------|
| `o.selectedPictureId` | `'pic_idle'` | 스펙 초기값 (변하지 않음) |
| `o.selectedPicture.id` | `'pic_idle'` | 마찬가지로 spec 초기값 |
| `o.entity.picture.id`  | `'pic_w1'`  | **실시간 갱신** (PIXI 텍스처에 바인딩) |

### 왜 이렇게 분리?

- `Object.selectedPictureId` 는 .ent 에 저장되는 **초기 상태 메타데이터** (편집기가 다시 로드할 때의 시작점).
- 런타임 picture 변경은 `Entry.Entity.setImage(picture)` 가 `entity.picture` 와 PIXI 텍스처만 갱신.
- `selectedPictureId` 까지 갱신하면 .ent 가 런타임 상태로 오염됨 → 의도적 분리.

### 실용 지침

- **헤드리스 검증에서 picture 상태 읽을 때**: `o.entity.picture.id` 사용. `selectedPictureId` 는 초기값 확인용에만.
- **picture id 비교 시**: `o.entity.picture && o.entity.picture.id === 'target'` (null 가드 — 첫 프레임에는 아직 미할당일 수 있음).

### 증거

- [`tools/verify-media-art.mjs`](../tools/verify-media-art.mjs) Step 3 — 두 필드 비교 후 `entity.picture.id` 채택

---

## textBox `text: ''` 는 객체 이름으로 폴백

`objectType: 'textBox'` 의 `text` 필드가 **빈 문자열 / undefined** 이면 entity 가 객체 이름(`object.name`)을 표시. 색만 있는 사각형(버튼·벽돌·HUD 박스)을 만들고 싶을 때 흔한 함정.

### 근거

[`entryjs/src/class/entity.js:142`](../../entryjs/src/class/entity.js#L142):
```js
entityModel.text = entityModel.text || parent.text || parent.name;
```

`||` 가 빈 문자열을 falsy 로 처리 → `parent.text` (spec 의 text) 도 빈 문자열이면 → `parent.name` (객체 이름) 사용.

### 회피

- `text: ' '` (공백 1 개) — 시각적 빈 텍스트 + name 폴백 차단.
- 또는 의도적으로 `name` 을 라벨로 활용 (예: `name: '시작'`).

### 증거

- [`tests/fixtures/spec-bounce-ball.mjs`](../tests/fixtures/spec-bounce-ball.mjs) — 18 벽돌 + 패들이 `text: ' '` 사용 (회귀 가드).

---

## `change_to_some_shape` 매칭 우선순위 — id → name → index

`change_to_some_shape(value)` 의 `value` 가 picture 와 매칭되는 순서:

1. **`pictures[*].id == value`** — id 가 정확히 일치
2. **`pictures[*].name == value`** — name 이 정확히 일치 (id 매칭 실패 시)
3. **숫자 인덱스 (1-base)** — `Entry.parseNumber(value)` 가 1-N 정수면 `pictures[N-1]` 반환

근거: [`entryjs/src/class/object.js:342-372`](../../entryjs/src/class/object.js#L342) `getPicture(value)`.

### 실용 지침

picture 의 `id` 와 `name` 을 다르게 두면 (예: id='pic_apple', name='fruit-apple') 편집기 UI 는 **name 만** 표시 → 스크립트가 id 로 매칭하면 시각적으로 혼란 ("이름과 다른 값이 들어있는데 왜 작동하지?"). 회피책:

- **인덱스 사용**: 변수가 1-N 범위면 `change_to_some_shape(getVar('idx'))` 로 직접 전달. 이름·id 무관하게 작동, 편집기에서 `1 모양으로 바꾸기` 와 동일한 의미 가시.
- **id = name 통일**: 수동으로 picture 마다 같은 문자열 지정.
- **list 룩업 제거**: list 에 picture id 를 넣고 인덱스로 룩업하느니 **list 자체를 없애고 인덱스 직접** 전달.

### 증거

- [`tests/fixtures/spec-fruit-hunt.mjs`](../tests/fixtures/spec-fruit-hunt.mjs) — `changeShape(getVar('shape_idx'))` 로 인덱스 직접 전달. picture id (`'pic_apple'`) 와 picture name (`'fruit-apple'`) 이 다르지만 인덱스 매칭이라 무관.

---

## `message_cast` 핸들러는 동시 실행 — 같은 메시지 다중 리스너 race

`Entry.engine.raiseMessage(msgId)` (DSL `sendMessage`) 가 발화되면 그 메시지를 듣는 모든 `when_message_cast` 핸들러가 **같은 frame 에 일제히 시작**. 핸들러 간 실행 순서는 보장 안 됨.

여러 리스너 중 하나가 다른 리스너가 의존하는 변수를 같은 핸들러 안에서 setVar 하면 **stale read race** 발생 — 늦게 실행되는 리스너는 새 값, 먼저 실행되는 리스너는 옛 값을 봄.

### 실패 패턴

```js
// fruit_template
[ when.message('new_stage'),
  setVar('target_idx', rand(1, 5)),  // 새 target 설정
  ...spawnLoop,
],
// title
[ when.message('new_stage'),
  writeText(combine('찾아라: ', valueAt('fruit_names', getVar('target_idx')))),  // ← stale read 가능
],
```

증상: title 이 "찾아라: 사과" 인데 화면엔 사과가 없음 (다른 과일이 target). title 이 OLD target_idx 를 읽었기 때문.

### 회피 패턴 — 메시지 발신 전에 변수 설정

발신자 측에서 변수를 모두 갱신한 뒤 메시지 발송. 메시지 핸들러는 read-only 로 만들기:

```js
// 메시지를 발생시키는 곳 (when_run / 이전 클론 클릭 핸들러 등)
setVar('target_idx', rand(1, 5)),
setVar('target_pos1', rand(0, 8)),
sendMessage('new_stage'),  // 모든 리스너가 새 값 read

// fruit_template — read-only
[ when.message('new_stage'),
  ...spawnLoop,  // target_idx 만 read
],
// title — read-only
[ when.message('new_stage'),
  writeText(combine('찾아라: ', valueAt('fruit_names', getVar('target_idx')))),
],
```

### 다른 회피 옵션

- **단일 리스너 + 후속 메시지 체인**: 한 핸들러에서 변수 갱신 → 다른 메시지로 chain (`sendMessage('target_set')` 후 `sendMessage('new_stage')`).
- **`message_cast_wait`**: 발신자가 핸들러 완료까지 BLOCK. 단 다중 리스너가 있으면 어떤 리스너의 완료를 기다리는지 불명확 (구현상 한 리스너만).

### 증거

- [`tests/fixtures/spec-fruit-hunt.mjs`](../tests/fixtures/spec-fruit-hunt.mjs) — title + fruit_template 둘 다 `new_stage` listen. target_idx 는 발신 전에 set.
- [`tools/verify-fruit-hunt.mjs`](../tools/verify-fruit-hunt.mjs) — title text 의 과일 이름 ↔ target_idx 일치 회귀 가드.

---

## `when_message` 핸들러는 클론에도 살아 있음 — fan-out spawn

`message_cast` 가 발화되면 **template 뿐 아니라 모든 클론** 에서도 동일한 `when_message_cast` 핸들러가 발화. 클론은 createClone 시점에 template 의 모든 스크립트 (이벤트 핸들러 포함) 를 그대로 복사하기 때문.

핸들러가 `createClone('self')` 같은 부수효과를 가지면 **각 메시지 발신마다 N+1 신규 클론** (N = 기존 클론 수). 의도치 않은 지수적 증가.

### 실패 패턴

```js
// enemy template
[ when.message('spawn'),
  createClone('self'),  // ← 기존 클론도 이걸 실행
],

// manager
repeat.basic(5, [ sendMessage('spawn'), wait(2) ])
```

웨이브 5 마리 의도 → 실제 1, 2, 4, 8, 16 마리 (지수). dump 에서 cloneCount 가 next_id 보다 크면 이 버그.

### 회피 패턴

- **`createClone(<other_id>)` 직접 호출**: spawner 오브젝트 (manager 등) 가 message 없이 직접 `createClone('enemy')`. 클론은 `create_clone` 트리거 자체가 없으므로 자기 복제 못 함. (DSL: `createClone('enemy')` — `'self'` 대신 sprite id 전달.)
- **메시지 핸들러를 template-only 로 가드**: 클론이면 무시하는 분기 추가. 하지만 Entry 에는 "나는 template 인가?" 직접 판정 블록이 없음 → 변수 트릭 필요해 비추천.

### 증거

- [`tests/fixtures/spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs) — manager 가 `createClone('enemy')` 직접 호출. 메시지 spawn 패턴은 폐기.
- [`tools/verify-frontier-guard.mjs`](../tools/verify-frontier-guard.mjs) Step 1 — `cloneCount == next_id` 회귀 가드 (다중 spawn 검출).
- 디버깅 dump 패턴: `clones.map(e => e.direction)` 에 중복 값 있으면 fan-out — 두 클론이 같은 id 캐시 → 같은 list 슬롯 충돌.

---

## 다중 `when_clone_start` 스크립트는 병렬 실행 — 클론 초기화 race

한 오브젝트에 `when_clone_start` 가 여러 개 등록되면 클론 시작 시 **병렬로 모두 발화**. 서로 다른 스크립트가 같은 클론에서 동시에 실행되며, **실행 순서 보장 없음**.

직전 패턴 (`turnAbs(next_id)` 로 direction 캡처) 처럼 한 스크립트가 다른 스크립트를 위한 초기 상태를 set 해야 한다면 race — 늦게 set 되면 다른 스크립트가 default 값을 읽음.

### 실패 패턴

```js
// Script A — id 캡처 + 이동
[ when.cloneStart(),
  turnAbs(getVar('next_id')),   // direction = id
  ...등록,
  glideTo(12, PATH_END_X, PATH_Y),
],
// Script B — 위치 broadcast (병렬 실행)
[ when.cloneStart(),
  repeat.inf([
    setListAt('enemy_x', coord('self', 'direction'), coord('self', 'x')),
    //                    ↑ A 의 turnAbs 보다 먼저 실행되면 default direction (90) 으로 슬롯 90 에 write
    wait(0.02),
  ]),
],
```

증상: `coord('self', 'direction')` 가 default 90 이면 `setListAt(list, 90, ...)` 는 5-슬롯 리스트 범위 밖 → silently 무시. 슬롯 90 에 쓰려는 클론 데이터가 모두 사라짐. 처치 카운트 안 올라감, deleteClone 발화 안 됨, cloneCount 가 spawn 수보다 많음.

### 회피 패턴 — 단일 스크립트로 통합

```js
[ when.cloneStart(),
  turnAbs(getVar('next_id')),  // 첫 블록 — 이후 모든 read 가 안전
  ...등록,
  repeat.inf([
    moveX(SPEED),
    setListAt('enemy_x', coord('self', 'direction'), coord('self', 'x')),  // 안전
    if_(cmp(valueAt('enemy_hp', coord('self', 'direction')), '<=', 0), [
        deleteClone(),
    ]),
    if_(cmp(coord('self', 'x'), '>=', PATH_END_X), [
        deleteClone(),
    ]),
    wait(0.02),
  ]),
],
```

이동 (`glideTo` 블로킹) 도 같은 forever 루프로 옮기되, 매 틱 `moveX(per_tick)` 으로 수동 step 이동. 글라이드의 부드러움 일부 포기하는 대가로 race 회피.

### 일반화

같은 오브젝트의 여러 클론 초기화 핸들러 → 단일 핸들러 + 통합 forever 루프. 병렬 실행이 진짜 필요한 경우는 거의 없고, 통합이 race 안전 + 디버깅 쉬움.

### 증거

- [`tests/fixtures/spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs) — enemy template 의 `when.cloneStart()` 단일. 수동 step 이동 (`SPEED_PER_TICK = 1.5`) 으로 broadcast/체크 통합.
- 디버깅 흔적: cloneCount=3 vs next_id=2, clones[].direction 에 [1, 2, 2] 중복 — Script B 가 default direction 으로 슬롯 90 에 쓰며, A 가 늦게 turnAbs(2) 한 클론과 다른 클론이 같은 direction 갖는 식.

---

## `when_message` 핸들러가 template 에도 발화 — direction-as-id 시 invalid index lookup 으로 scene 전체 손상

`when_message_cast` 핸들러는 [클론에도 살아있다](#when_message-핸들러는-클론에도-살아-있음--fan-out-spawn) 는 fan-out 함정과 별개로, **template 자체에서도 발화**. 핸들러가 `coord('self', 'direction')` 을 인덱스로 list 룩업하는 경우 — direction-as-id 패턴에서 흔함 — template 의 default direction (보통 90) 이 슬롯 N (= 클론 수) 범위 밖.

`valueAt('slot_type', 90)` 가 (Entry 의 1-base 4-슬롯 리스트에서) 어떻게 처리되는지에 따라 invalid index lookup 의 결과는 크게 달라짐. **관찰된 증상**: scene 전체가 reset 된 듯한 상태 — 모든 변수 default 로 돌아감, 클론 사라짐, 클릭 핸들러도 발화 안 함. 정확한 원인은 Entry 내부의 silent error 로 보이지만 **현상은 catastrophic**.

### 실패 패턴

```js
// 슬롯 클론 = direction 1..4 = id. template 자체는 direction 90.
[
    when.message('refresh_slot'),
    if_(cmp(valueAt('slot_type', coord('self', 'direction')), '==', 0), [
        // ↑ template 도 이걸 실행. valueAt('slot_type', 90) 은 4-슬롯 리스트의 범위 밖
        //   → Entry 내부 silent error → scene 전체 손상 (관찰됨)
        changeShape(1),
    ]),
    // ... 추가 분기
],
```

증상 (실측): 메뉴 클릭 (= refresh_slot 발신) 후
- cloneCount: 4 → 0 (모든 클론 사라짐)
- 모든 글로벌 변수: default 로 reset
- 클릭 핸들러 발화 안 함 (다음 클릭이 사실상 무력화)

### 회피 패턴 — direction 범위 가드

```js
[
    when.message('refresh_slot'),
    // 가드: direction 이 슬롯 id 범위 (1..N) 인 클론만 처리
    if_(cmp(coord('self', 'direction'), '<=', SLOT_COUNT), [
        if_(cmp(valueAt('slot_type', coord('self', 'direction')), '==', 0), [
            changeShape(1),
        ]),
        // ... 모든 분기 가드 안에 들어감
    ]),
],
```

template 의 direction (보통 90) > SLOT_COUNT (예: 4) 면 가드 통과 못 해 invalid lookup 회피.

### 일반화

`coord('self', 'direction')` 또는 비슷한 entity 속성을 list/array 인덱스로 쓰는 모든 메시지 핸들러는 **template 발화 가드** 필요:

- 명시적 범위 체크: `if_(cmp(coord('self', 'direction'), '<=', N), [...])`
- 또는 별도 "is_clone" 변수: 클론 시작 시 1 set, template 은 0 — 핸들러 첫 줄에서 체크. 하지만 변수가 글로벌이라 클론간 공유 — 좌표/direction 가드가 더 견고.

이 함정은 **다중 `when_clone_start` race** (위 섹션) 와 다르다 — 후자는 클론끼리의 race, 이건 template 자체가 핸들러 발화하면서 발생. 같은 spec 에 양쪽 다 발생할 수 있음.

### 증거

- [`tests/fixtures/spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs) Phase 3 — slot_template 의 `when.message('refresh_slot')` 첫 블록이 `if_(cmp(coord('self','direction'), '<=', 4), [...])` 가드.
- [`tools/verify-frontier-guard.mjs`](../tools/verify-frontier-guard.mjs) — 슬롯 빌드 → 메뉴 닫힘 → cloneCount 보존 검증.
- 디버깅 흔적: 메뉴 클릭 핸들러의 첫 setVar('dbg1', 1) 도 발화 안 함, 그 외 모든 변수 reset → 메시지 발신 자체가 scene 손상의 trigger 임을 1-블록 minimal 클릭 핸들러 + 점진 추가 bisect 으로 확인.

---

## Stage 논리 좌표 vs canvas 렌더 픽셀 — `clickStagePoint` 변환 공식

Entry stage 의 사용자 좌표계 (entity.x/y, locateXY 의 인자) 는 **stage 논리 단위**. 기본값은 480×270 (x ∈ [-240, 240], y ∈ [-135, 135]). 하지만 실제 canvas 는 **다른 픽셀 해상도** 로 렌더 — fixture 마다 또는 high-DPI 환경마다 다름. 헤드리스 검증에서 `page.mouse.click(px, py)` 같은 실제 클릭 (pixel hit-test 통과 필수) 을 시뮬할 때 좌표 변환이 필요.

### 실측 (frontier-guard 환경)

```
canvas.width  = 640    (렌더 픽셀)
canvas.height = 360
stage 논리      = 480 × 270  (Entry 사용자 좌표)
scale         = 640/480 = 1.333 (canvas/stage)
DOM rect       = 454 × 256 (CSS px, 브라우저 렌더 크기)
```

### 잘못된 변환 (textbox-click verify 의 stage=canvas 가정)

```js
// stage logical = canvas pixel 1:1 가정 — 일부 fixture 는 OK, frontier-guard 는 X
const cx = w / 2 + sx;  // sx 가 stage 좌표인데 canvas 픽셀 offset 으로 그대로 사용
const cy = h / 2 - sy;
```

stage (-160, 50) 클릭 시 잘못 매핑되어 슬롯이 아닌 빈 영역 클릭 → handler 발화 안 함.

### 올바른 변환

```js
async function clickStagePoint(sx, sy) {
    const pos = await page.evaluate(({ sx, sy }) => {
        const canvas = Entry.stage.canvas.canvas;
        const rect = canvas.getBoundingClientRect();
        const w = canvas.width, h = canvas.height;
        const stageW = 480, stageH = 270;       // Entry 기본 stage 논리 크기
        const scaleX = w / stageW, scaleY = h / stageH;
        const cx = w / 2 + sx * scaleX;          // stage → canvas 픽셀
        const cy = h / 2 - sy * scaleY;          // (y 는 위쪽이 +)
        return {
            px: rect.left + cx * (rect.width / w),    // canvas → DOM 픽셀
            py: rect.top  + cy * (rect.height / h),
        };
    }, { sx, sy });
    await page.mouse.click(pos.px, pos.py);
}
```

핵심: **2 단 변환**. (1) stage 좌표 → canvas 렌더 픽셀 (stage 논리 크기와 canvas 해상도 비율). (2) canvas 픽셀 → DOM 페이지 픽셀 (CSS rect 비율).

### 확인 방법

올바른 변환인지 확신 안 서면, 알려진 위치의 sprite 클릭으로 검증. frontier-guard 의 슬롯 1 (-160, 50) 클릭 시 `menu_state == 1` 이 되면 OK.

### `interface.canvasWidth` 가 다른 fixture

bullet-circle 처럼 `interface: { canvasWidth: 640, ... }` 명시 시 stage 논리도 영향받을 수 있음 (Entry 가 stage 크기를 interface 기반으로 조정). 좌표 변환 식의 `stageW/H` 를 fixture 별로 조정 필요.

### 증거

- [`tools/verify-frontier-guard.mjs`](../tools/verify-frontier-guard.mjs) `clickStagePoint` — 위 공식. Step 1b 슬롯 가운데 클릭 회귀 가드.
- [`tools/verify-textbox-click.mjs`](../tools/verify-textbox-click.mjs) — stage=canvas 1:1 가정 (5×5 그리드 클릭). 본 fixture 는 단일 scene + 직접 좌표 매칭으로 작동.

---

## 다중 클론의 `repeat.inf` 본체 = 글로벌 scratch 변수 race

같은 스크립트의 클론 N 개가 각자 `repeat.inf` 본체를 돌리면, Entry 의 executor 가 클론 본체를 **블록 단위로 인터리브** 실행. 본체가 슬롯 순회용 글로벌 카운터 (`i`, `bul_i` 등) 를 reset → increment → list lookup 하는 패턴이면, 한 클론의 `setVar('i', 0)` 와 다른 클론의 `valueAt('list', getVar('i'))` 가 교차 → `i` 가 순간 0 인 채 list 접근 → `Runtime Error: can not insert value to array` (block_variable.js:873) → 엔진 정지.

### 실패 패턴

```js
// 같은 wand_template 클론 N 개가 각자 동시 실행
when.cloneStart(),
repeat.inf([
    setVar('bul_i', 0),               // ← clone A 가 0 으로 reset
    setVar('bul_hit', 0),
    repeat.basic(MAX_ENEMIES, [
        changeVar('bul_i', 1),         // ← clone B 는 아직 +1 전. 이 사이 A 가 다시 0 으로
        if_(cmp(valueAt('enemy_active', getVar('bul_i')), '==', 1), [...]),
        //              ↑ bul_i 가 0 인 순간 → throw
    ]),
])
```

단일 스레드 (player collision, aura tick, spawner) 는 같은 글로벌을 써도 race 없어서 안전. **여러 클론이 같은 스크립트를 도는 경우만** 함정.

### 회피 패턴 — 슬롯 순회를 value 함수에 위임

`fn.value` 호출은 동기 실행 → 한 호출이 끝나야 다음 호출 시작 → 글로벌 globals 가 호출 안에서 atomic. 재귀로 1..MAX 순회.

```js
const fbh = fn.value('fbh', ['x', 'y', 'idx'],
    (x, y, idx) => [
        if_(cmp(idx, '>', MAX_ENEMIES), [
            setVar('fbh_ret', 0),
        ], [
            setVar('fbh_dx', calc(valueAt('enemy_x', idx), '-', x)),
            setVar('fbh_dy', calc(valueAt('enemy_y', idx), '-', y)),
            setVar('fbh_dsq', calc(
                calc(getVar('fbh_dx'), '*', getVar('fbh_dx')),
                '+',
                calc(getVar('fbh_dy'), '*', getVar('fbh_dy')),
            )),
            if_(and_(
                cmp(valueAt('enemy_active', idx), '==', 1),
                cmp(getVar('fbh_dsq'), '<', BULLET_HIT_SQ),
            ), [
                setVar('fbh_ret', idx),
            ], [
                setVar('fbh_ret', call('fbh', x, y, calc(idx, '+', 1))),
            ]),
        ]),
    ],
    () => getVar('fbh_ret'),
);

// bullet 클론 본체에서 한 줄로 호출 — race 없음
setVar('bul_hit', call('fbh', coord('self', 'x'), coord('self', 'y'), 1)),
```

`spec-bullet-circle.mjs` 의 `dsq` 함수도 동일 원리 — 다중 enemy 클론이 호출해도 글로벌 `dx`/`dy`/`ret` 가 atomic.

### 변종: `when_clone_start` 가 spawner 의 글로벌 카운터를 race 로 읽음

같은 race 의 다른 발현. spawner 가 `repeat.basic(N, [changeVar(idx, 1), createClone, ...])` 로 N 클론을 spawn 하고, 각 클론의 `cloneStart` 가 `valueAt('list', getVar('idx'))` 를 읽는 패턴. spawner 의 다음 iter 가 idx 갱신을 진행하는 동안 클론의 첫 블록이 idx 값을 캡처 — 어느 시점에 클론이 읽는지 보장 안 됨. 다중 spawner (예: 여러 적이 동시 사망 시 각자 파티클 spawn) 는 더 심각: 한 spawner 가 `setVar(idx, 0)` 로 리셋한 직후 다른 spawner 의 in-flight 클론이 idx=0 으로 list lookup → 인덱스 0 → throw.

```js
// 실패 패턴 — 적 사망 시 6 방향 파티클 spawn
setVar('p_spawn_idx', 0),
repeat.basic(6, [
    changeVar('p_spawn_idx', 1),       // 1, 2, ..., 6
    createClone('particle_template'),
])

// particle 클론 cloneStart:
turnAbs(valueAt('particle_angles_t', getVar('p_spawn_idx')))
//                                    ↑ 여러 적 동시 사망 시 다른 적의 reset(0) 캡처 → throw
```

### 회피 패턴 — 클론이 자체 결정값 갖기

cloneStart 에서 글로벌 lookup 대신 **클론 스스로 값 결정**. 균일 6 방향이 random 6 방향이 되지만 시각 차이 미미.

```js
// particle 클론 cloneStart — 자체 random angle
turnAbs(rand(0, 359)),
```

또는 spawner 가 클론별로 파라미터를 안전하게 전달해야 하면, **direction 을 캐리어로** 사용 (cloneStart 첫 블록에서 `coord('self','direction')` 으로 즉시 회수). 단 enemy/bb 처럼 direction 을 slot id 로 이미 쓰고 있으면 안 됨.

### 일반화 (확장)

- 단일 스레드 / 단일 클론 → 글로벌 scratch 안전 (예: spawner, manager)
- 다중 클론 같은 스크립트 + list iteration **본체 내** → 반드시 `fn.value` 로 캡슐화 (위 1차 패턴)
- 다중 클론 같은 스크립트 + cloneStart 가 spawner 의 카운터로 list lookup → 클론이 자체 결정값 (rand) 또는 direction-캐리어로 회피 (위 2차 변종)
- list 접근 없는 단순 산술/위치 갱신 race → 시각 jank 만, 무시 가능

### 증거

- [`games/vampire-survival/spec.mjs`](../games/vampire-survival/spec.mjs) `fnFindBulletHit` — 1차: 재귀 함수로 슬롯 순회.
- [`games/vampire-survival/spec.mjs`](../games/vampire-survival/spec.mjs) `particle_template` cloneStart — 2차: `turnAbs(rand(0, 359))` 로 클론 자체 random.
- [`tests/fixtures/spec-bullet-circle.mjs`](../tests/fixtures/spec-bullet-circle.mjs) `dsq` — 동기 함수 race-free 패턴.
