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

[`entryjs/src/util/utils.js:831-844`](../../entryjs/src/util/utils.js#L831):
```js
Entry.pressedKeys = [];
const func = (e) => {
    const keyCode = Entry.Utils.inputToKeycode(e);  // ← event.code → 숫자 매핑
    if (!keyCode) return;
    if (Entry.pressedKeys.indexOf(keyCode) < 0) Entry.pressedKeys.push(keyCode);
};
addEntryEvent(doc, 'keydown', func);   // doc = document
```

`inputToKeycode` ([utils.js:881](../../entryjs/src/util/utils.js#L881)):
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

### 회피 패턴 2 — **엔티티 상속**으로 넘기기 (자리·모양이 목적일 때)

클론은 만들어지는 순간의 엔티티 상태(좌표·모양·크기·보임)를 그대로 복사한다. 그래서
"이 클론을 어디에 어떤 모양으로 둘 것인가" 가 목적이라면 전역을 거칠 이유가 없다 —
**템플릿을 그 상태로 맞춘 뒤 복제**하면 된다. 한 프레임에 여러 개를 만들어도 서로 안 섞인다.

```js
// 스포너(템플릿 자신의 스레드에서): 칸마다 모양·자리를 맞추고 복제
changeShape(color),
locateXY(valueAt('posx', i), valueAt('posy', i)),
createClone('self'),

// 클론: 물려받은 상태 그대로 보이기만 한다
[ when.cloneStart(), show() ],
```

**실패했던 형태** (2026-08-15, hexo): 전역 `그릴칸`·`그릴색` 에 담고 `when_clone_start` 에서
읽었더니, 한 번에 도착한 돌 3 개가 **전부 마지막 칸에 겹쳐** 그려졌다. `create_clone` 은
동기적으로 엔티티를 복사하지만 `when_clone_start` 스크립트는 나중에 실행되므로, 그때는
전역이 이미 마지막 값이다. 클론 수·`getClonedEntities().length` 는 정상이라 **숫자로는
멀쩡해 보이고 화면만 틀리다** — 좌표 집합의 크기(`new Set(clones.map(c => x+','+y)).size`)를
세는 회귀 가드가 필요하다.

⚠️ 단, 블록은 **실행 중인 오브젝트**에 작용한다. `locateXY`/`changeShape` 를 함수 안에서
쓰면 그 함수를 호출한 오브젝트가 움직인다 — 이 패턴은 템플릿 자신의 스레드(또는 템플릿이
부르는 함수) 안에서만 성립한다.

또는 spawner 가 클론별로 파라미터를 안전하게 전달해야 하면, **direction 을 캐리어로** 사용 (cloneStart 첫 블록에서 `coord('self','direction')` 으로 즉시 회수). 단 enemy/bb 처럼 direction 을 slot id 로 이미 쓰고 있으면 안 됨.

### 일반화 (확장)

- 단일 스레드 / 단일 클론 → 글로벌 scratch 안전 (예: spawner, manager)
- 다중 클론 같은 스크립트 + list iteration **본체 내** → 반드시 `fn.value` 로 캡슐화 (위 1차 패턴)
- 다중 클론 같은 스크립트 + cloneStart 가 spawner 의 카운터로 list lookup → 클론이 자체 결정값 (rand) 또는 direction-캐리어로 회피 (위 2차 변종)
- **클론 아님 — 같은 이벤트 핸들러의 빠른 재발화**: `when_some_key_pressed` 같은 핸들러가 빠르게 다시 발화하는데, 핸들러가 부르는 함수에 **프레임 양보 `repeat` 가 있으면**(반복=1프레임) 한 호출이 끝나기 전에 다음 호출이 시작 → 여러 호출이 동시 실행되며 같은 **전역 카운터를 공유** → 합산 증가로 인덱스가 list 길이 초과 → 동일 `can not insert value to array`. (검색 자동완성에서 긴 문자열/빠른 타이핑 시 재현 — `updateSuggestions` 의 `repeat 100` 이 si 를 100 초과시킴.) 회피: 순회를 **동기 `fn.value` 재귀**로 (repeat 제거 → 프레임 양보·동시성 자체가 사라짐). [`games/es-hangul/demo.mjs`](../games/es-hangul/demo.mjs) `scanSug`.
- list 접근 없는 단순 산술/위치 갱신 race → 시각 jank 만, 무시 가능

### 증거

- [`games/vampire-survival/spec.mjs`](../games/vampire-survival/spec.mjs) `fnFindBulletHit` — 1차: 재귀 함수로 슬롯 순회.
- [`games/vampire-survival/spec.mjs`](../games/vampire-survival/spec.mjs) `particle_template` cloneStart — 2차: `turnAbs(rand(0, 359))` 로 클론 자체 random.
- [`tests/fixtures/spec-bullet-circle.mjs`](../tests/fixtures/spec-bullet-circle.mjs) `dsq` — 동기 함수 race-free 패턴.

---

## Variable Y vs Entity Y — 부호 반대

Entry 의 stage 좌표계는 entity (sprite) 와 variable 에서 **Y 부호 처리가 다름**. 같은 좌표값이 화면 위/아래 정반대로 매핑됨. 원형 배치·시계 같이 sin/cos 로 좌표 계산할 때 시계방향이 반시계방향으로 뒤집힘.

### 동작 차이

| 대상 | 저장 y | 화면상 위치 | 근거 |
|------|--------|------------|------|
| **Entity (sprite)** | y > 0 → **화면 위** | `this.object.y = -this.y + rndPosY` 로 반전 | [`entryjs/src/class/entity.js:273`](../../entryjs/src/class/entity.js#L273) |
| **Variable** | y > 0 → **화면 아래** | `view_.y = this.getY()` 그대로 (반전 없음) | [`entryjs/src/class/variable/variable.js:264-265`](../../entryjs/src/class/variable/variable.js#L264) |

stage container 자체는 `canvas.x/y = (320, 180)` 으로 중앙 이동 + `scaleX/Y = 2/1.5` 만 적용 ([`stage.js:46-48`](../../entryjs/src/class/stage.js#L46)) — Y flip 없음. entity 는 setY 에서 별도로 반전하지만 variable 은 반전 없이 createjs/PIXI 기본 (Y 아래 양수) 그대로.

### 실측 (2026-05-18, headless chromium)

`coord-test_001.ent` 의 변수 4 개 — 이름은 MATH 컨벤션 (y 양수 = 위) 가정으로 명명:

| 변수 이름 | stage (x, y) | canvas pixel (x, y) | 실제 사분면 |
|-----------|-------------|---------------------|------------|
| `오른위`   | (+100, +100) | (453.3, 313.3) | 오른쪽-**아래** |
| `왼위`     | (-100, +100) | (186.7, 313.3) | 왼쪽-**아래** |
| `왼아래`   | (-100, -100) | (186.7, 46.7)  | 왼쪽-**위** |
| `오른아래` | (+100, -100) | (453.3, 46.7)  | 오른쪽-**위** |

canvas 중앙 = (320, 180). 변수의 stage y +100 → pixel y 313.3 → **중앙 아래**. 즉 변수에 한해서는 `y > 0 = 화면 아래`. entity 와 반대.

### 회피 — 원형 배치 공식

stage 좌표가 직관적인 **entity** (`y +` = 위) 기준으로 sin/cos 를 쓰면 sprite 는 시계방향, **변수 디스플레이는 반시계방향** 으로 돈다. variable 의 원형 배치는 cos 앞에 음수:

```js
// Entry direction (0=위, 90=오른쪽, 시계방향)
// Entity 용
x = cx + r * Math.sin(theta);
y = cy + r * Math.cos(theta);   // y + = 화면 위 → 시계방향 OK

// Variable 용 — cos 부호 반전
x = cx + r * Math.sin(theta);
y = cy - r * Math.cos(theta);   // y + = 화면 아래라서 부호 반대로
```

검증: [`games/name-circle/build.mjs`](../games/name-circle/build.mjs) `angleCoords` — 시침/분침/초침 시계방향 회전.

### 증거

- [`tools/verify-coord-test.mjs`](../tools/verify-coord-test.mjs) — variable 4 개 픽셀 위치 측정. canvas 중앙 (320, 180) 기준 사분면 판정.
- [`games/coord-test/coord-test_001.ent`](../games/coord-test/) — 테스트 fixture.

### 클릭 좌표 변환과의 차이

상단 ["Stage 논리 좌표 vs canvas 렌더 픽셀"](#stage-논리-좌표-vs-canvas-렌더-픽셀--clickstagepoint-변환-공식) 항목의 `clickStagePoint(sx, sy)` 변환은 **entity 좌표 컨벤션** (`y + = 위`) 기준 — sprite 클릭 시뮬에 사용. variable 픽셀 위치를 알고 싶으면 위 공식의 `cy` 계산에서 부호 반전 빼야 함.

---

## 변수 좌표 x=0 또는 y=0 → bin-packer 폴백

Variable 의 stored x 또는 y 가 정확히 0 이면 저장된 위치가 무시되고 `VariableBP` (binary packing) 자동 배치 위치로 떨어진다. 그리드/원형 배치 시 중앙 행/열만 흩어져 보임.

### 원인

[`entryjs/src/class/variable/variable.js:136`](../../entryjs/src/class/variable/variable.js#L136):

```js
const { x, y } = VariableBP.add(this.id_, this.x_, this.y_, ...);

if (this.getX() && this.getY()) {     // ← truthy check (0 은 falsy)
    this.setX(this.getX());
    this.setY(this.getY());
} else {
    this.setX(x - 230);                // bin-packer 폴백
    this.setY(y - 105);
}
```

`getX()` 또는 `getY()` 가 0 이면 `0 && anything === 0` (falsy) → else 분기 → bin-packer 가 자동 배정한 위치 사용. `!= null` 가드여야 하는데 truthy check 라 0 만 망가짐.

### 증상

- 11 행 × 24px 간격 그리드를 `y = (5 - row) * 24` 로 만들면 row 5 만 y=0 → 그 행 26 개 변수만 다른 위치로 흩어져 나타남.
- 360 변수 원 배치를 중심 (0, 0) + 반지름 r 로 하면 4 사분점 (0°, 90°, 180°, 270°) 중 (x, ±r) (0, ±r) 좌표 두 점이 falsy → 흩어짐.

### 회피

좌표가 0 이 안 되도록 작은 오프셋. 정수 그리드는 ±1 시프트, 원형 배치는 중심을 (0.5, 0.5) 같이 0.5 어긋나게.

```js
// 1) 11×N 그리드: Y_OFFSET=1 적용
const Y_TOP = ((ROWS - 1) * Y_STEP) / 2 + 1;
//                                          ↑ row 5 가 y=1 (truthy)

// 2) 원형 배치: 중심 0.5 오프셋
const CX = 0.5, CY = 0.5;
// 0°: (0.5, ±120.5) — 정확한 0 회피

// 3) 짝수 간격 그리드는 홀수 좌표 사용
xValues = [];
for (let x = -239; x <= 239; x += 2) xValues.push(x);
// 모두 홀수 → 0 자연 제외
```

### 증거

- [`games/bad-apple/build.mjs`](../games/bad-apple/build.mjs) `Y_OFFSET = 1` — 11 행 그리드에서 row 5 의 y=0 회피.
- [`games/name-circle/build.mjs`](../games/name-circle/build.mjs) `CX = CY = 0.5` — 원형 배치에서 4 사분점의 x=0/y=0 회피.
- [`games/name-row/build.mjs`](../games/name-row/build.mjs) — x = -239..+239 step 2 (홀수만) 로 x=0 자연 회피.
- 빌드 어서션: `if (v.x === 0 || v.y === 0) throw` — 파라미터 변경 시 재발 가드.

---

## `when_scene_start` 는 시작 시 첫 장면에서 발화 안 함 — `start_scene` 전환에서만

프로젝트를 실행(▶ / `Entry.engine.toggleRun`)하면 **첫(시작) 장면** 오브젝트의
`when_scene_start`(장면이 시작되었을 때) 핸들러는 **발화하지 않는다**. 시작 시점엔
`when_run_button_click`(시작하기 버튼 클릭) 만 발화. `when_scene_start` 는
**`start_scene`/`start_scene_of` 블록으로 장면을 바꿀 때만** 발화한다.

### 근거 (소스)

- 실행 시작: `entryjs/src/class/engine.js:662` — run 진입 시
  `this.fireEvent('start')` 만 호출. `'start'` = `when_run_button_click`. `when_scene_start` 는 안 부름.
- 장면 전환: `entryjs/src/playground/blocks/block_start.js:631`
  `start_scene` (및 `start_scene_of` L703/L711) 가 `Entry.scene.selectScene()` 직후
  `Entry.engine.fireEvent('when_scene_start')` 호출 — **명시적 전환만 발화원**.

따라서 헤드리스(`toggleRun`)뿐 아니라 **실제 플레이어에서도** 첫 장면은 시작 시 sceneStart 를 안 받는다.

### 증상

랜딩(첫) 장면 오브젝트의 초기화·루프를 `when_scene_start` 에만 걸면 시작 시 안 돈다.
변수 초기화가 누락되면 미설정 변수가 `'0'` 으로 읽혀(빈→0 강제) 로직이 줄줄이 깨진다.
(es-hangul 데모: IME init 을 sceneStart 에만 둬서 `mode` 미설정→`'0'`(영문)로 읽혀 입력·검색
전부 오작동, verify 12 실패. dualStart 적용 후 14/14.)

### 회피 패턴 — `when.run` + `when.sceneStart` 이중 트리거

랜딩 장면 오브젝트는 **두 트리거에 같은 초기화 본문**을 건다:

```js
const dualStart = (body) => [[when.run(), ...body], [when.sceneStart(), ...body]];
// 오브젝트 threads: [...dualStart(initBody), ...keyHandlers]
```

- **시작 시**: `when_run_button_click` 만 발화 → init 1회.
- **다른 장면 → 이 장면 재진입**(`start_scene`): `when_scene_start` 만 발화 → init 1회.
- 두 트리거가 동시에 뜨는 경우가 없어 **중복 실행 없음**. 전역 변수는 장면 간 유지되므로
  재진입 시 재초기화가 오히려 필요 → 이중 트리거가 정답.

전환으로만 들어가는 비-랜딩 장면은 `when_scene_start` 만으로 충분(전환 시 정상 발화).

### 증거

- [`games/es-hangul/demo.mjs`](../games/es-hangul/demo.mjs) — `dualStart` 헬퍼, search(랜딩) 오브젝트(ime/suggest/title/go_home)에 적용.
- [`tools/verify-es-hangul-demo.mjs`](../tools/verify-es-hangul-demo.mjs) — sceneStart-only 12 실패 → dualStart 후 14/14.

### 관련 패턴

- 멀티 장면 데모 구성: [`04 §멀티 장면 데모`](04-script-and-blocks.md#멀티-장면-데모--랜딩-장면--홈--기능-장면-startscene)

---

## textBox 정렬 — `regX`/`regY` 강제 0, 가운데는 `textAlign:0` (1 아님)

textBox 는 sprite 와 등록점(registration) 처리가 다르다. Entry 가 textBox 의 `regX`/`regY` 를
**무조건 0 으로 강제**한다 — spec 에서 `regX` 를 줘도 무시된다.

- `entityjs/src/class/entity.js:364` `setRegX`: `if (this.type === 'textBox') regX = 0;` (regY 도 L390 동일).
- 단 **위치 기준(`entity.x`)은 글상자의 가운데(중심)** 다 → regX 로 옮기는 게 아니라 **`x=0` 이면 폭과
  무관하게 스테이지 가운데 정렬**. (실측: width 320·440 모두 `x:0` → 텍스트 픽셀 centroid = 캔버스 중앙.)

**텍스트 가운데 정렬은 `textAlign`** 으로 (regX 아님):
- `textAlign`: **0 = 가운데**, 1 = 왼쪽, 2 = 오른쪽 (`Entry.TEXT_ALIGN_CENTER = 0` 가 기본).
  ⚠️ **1 을 가운데로 착각하기 쉬움** — 1 은 왼쪽 정렬.
- `setTextAlign` 끝에서 `setWidth(getMeasuredWidth())` 호출 → **`lineBreak:false` 면 width 가 내용 길이로
  자동 축소**(spec 의 고정 `width` 무시) → 짧은 내용이 좌측 고정점에 붙음. 고정 폭 유지는 `lineBreak:true`.

**글상자를 스테이지 가운데 두기**: `x:0` + `lineBreak:true`(고정 폭) + `textAlign:0`(글자 가운데) + 원하는 `width`.
`entity.x` 가 중심이라 **폭을 바꿔도 `x:0` 그대로 가운데**(`x = -width/2` 같은 보정 불필요 — 그렇게 하면 오히려 한쪽으로 치우침).

### 증거

- [`games/es-hangul/demo.mjs`](../games/es-hangul/demo.mjs) — 글상자 전부 `x:0`+`lineBreak:true`+`textAlign:0`+`width:440`, 텍스트 centroid 320 = 640/2 측정.
- 시행착오: `regX:160`(무시됨)·`textAlign:1`(왼쪽 정렬됨)·`x:-60`/`x:-160`(entity.x 가 중심이라 그만큼 왼쪽 쏠림) 실패 → `x:0`+`textAlign:0`. ⚠️ 폭 다른 케이스의 위치는 `entity.x` 만 믿지 말고 렌더 픽셀 centroid 로 검증.

---

## `wait_until_true` 조건 속 `continue_repeat` = 반복 딜레이 소멸 (동기 루프 트릭)

반복 바디 **마지막 블록**으로 `~이(가) 될 때까지 기다리기(참이 아니다(이번 반복 건너뛰기))`
— `wait_until_true(boolean_not(continue_repeat))` — 를 두면
["반복하기 = 1 프레임/반복"](#반복하기-블록--1-프레임반복-60fps-암묵-틱) 의 프레임 양보가 사라져
**전체 반복이 한 틱 안에 동기 실행**된다. 커뮤니티 트릭 — statement 블록인 `continue_repeat` 가
boolean 슬롯에 들어간 비정상 조립이라 편집기 드래그로는 못 만들고 project.json 레벨에서만
구성 가능(로드 후 렌더링·실행은 정상).

### 메커니즘 (근거 소스)

정상 딜레이의 정체: 바디 마지막 블록이 끝나면 `scope.block === null` → `_callStack.pop()` 으로
반복 블록에 복귀할 때 `isLooped` 불일치 → `break` = execute() 종료 = 다음 프레임까지 대기
([`executors.js:125-132`](../../entryjs/src/playground/executors.js#L125)).

트릭은 이 "정상 종료 → pop" 경로 자체를 우회한다:

1. `wait_until_true` 실행 시 param 은 **동기 평가** — `Scope.run` 이 func 호출 **전에**
   `getParams()` 로 중첩 블록을 즉시 실행 ([`scope.js:192`](../../entryjs/src/playground/scope.js#L192), [`:36-46`](../../entryjs/src/playground/scope.js#L36)).
2. 그 안의 `continue_repeat.func` = `this.executor.continueLoop()`
   ([`block_flow.js:348`](../../entryjs/src/playground/blocks/block_flow.js#L348)) —
   **콜스택을 반복 블록 scope 까지 즉석에서 되감고**(`executor.scope` 교체) `Entry.STATIC.BREAK`(=2) 를
   **값으로** 반환 ([`executors.js:227-241`](../../entryjs/src/playground/executors.js#L227)).
3. `boolean_not(2)` = false → `wait_until_true` 는 `return script` — 자신의 (이미 교체되기 전)
   **낡은 scope 객체** ([`block_flow.js:548-555`](../../entryjs/src/playground/blocks/block_flow.js#L548)).
4. executor 의 returnVal 분기(Promise / undefined·null·PASS / CONTINUE / `=== this.scope` / BREAK)
   중 **아무것도 매칭 안 됨** — `this.scope` 는 2에서 이미 반복 블록으로 교체됐으므로
   `returnVal === this.scope` 도 false → `while(true)` 가 **같은 틱에서** 다음 iteration 을 계속
   ([`executors.js:117-146`](../../entryjs/src/playground/executors.js#L117)). `iterCount` 소진 시에만
   `callReturn()`(undefined) 로 정상 탈출.

`boolean_not` 은 **필수**: `continue_repeat` 를 BOOL 에 직접 넣으면 값 2(truthy) → `callReturn()`
→ executor 가 `this.scope.block.getNextBlock()` 을 계산하는데 scope 가 이미 반복 블록이라
**반복 다음 블록으로 탈출**해버린다. 일반 흐름 블록 중에선 `wait_until_true` 가 유일한 호스트
(`_if` 는 false 면 `callReturn()` → 같은 탈출 문제) — 단 아래 변종처럼 **항상-대기 블록이면
무엇이든 호스트가 된다** (트릭 가족).

### 실측 (2026-07-22, headless chromium — `Entry.block.move_direction.func` 후킹 타임스탬프)

외부 작품 "sin,cos 없이 원그리기 예제의 리메이크" (반복 360회: 이동+1° 회전) A/B:

| 변형 | 360회(원 1바퀴) 소요 | 호출 간격 중앙값 |
|------|----:|----:|
| 트릭 원본 | **10 ms** (360개 한 틱 배치, span ≈5ms) | 0 ms |
| 트릭 블록 제거 | 5,744 ms | 16 ms (1 프레임) |
| `continue_repeat`→`False` 만 교체 | 5,742 ms | 16 ms |

세 번째 변형이 결정타 — `wait_until_true` 존재가 아니라 **`continue_repeat` 가 원인** (574배).
관찰 2.5초간 move 56,520회 = 외곽 `repeat_inf`(정상 양보 유지)가 **매 프레임 원 1개 전체**를
지우고 다시 그림. page error 0.

### 변종 — 항상-대기 하드웨어 블록 운반체 (.eo 유통 스니펫, 2026-07-22 실측)

호스트 조건의 일반형: **「continue_repeat 를 심을 param 슬롯이 있고, func 가 분기표 어디에도
안 걸리는 값(자신의 낡은 scope)을 반환」**. 유통 스니펫
`Talebot_Move(continue_repeat, continue_repeat)` (하드웨어 테일봇 이동 블록,
[`block_talebot.js:111-144`](../../entryjs/src/playground/blocks/hardware/block_talebot.js#L111)) 이 그 예:

- 하드웨어 대기 상태머신 — 기기 무연결이면 `portData.done` 이 영영 안 와 **매 호출 `return script`**
  → `boolean_not` 래퍼 불필요, 조건 없이 항상 성립.
- `getParams()` 는 슬롯 종류를 안 가림 — **드롭다운(방향) 자리의 continue_repeat 도** Block
  인스턴스면 평가·실행됨. 두 번째(거리 슬롯) continue_repeat 는 최상위 반복에선 no-op
  (첫 번째가 스택을 이미 되감아 `_callStack` 이 비면 즉시 PASS 반환 — [`executors.js:228-232`](../../entryjs/src/playground/executors.js#L228)).
- 하드웨어 블록 정의는 entryjs 에 상시 내장 — 기기 없이도 실행됨(블록 메뉴 노출만 연결 필요).
- 실측: 트릭 이식 시 360회 **14ms**(원본 트릭과 동일 스케일), **정상 파라미터(0, 10)면 1회 호출
  후 영원 대기**(무응답 대기 본성 — 루프가 1회차에서 정지). page error 0.

### 변종 2 — 별개 메커니즘: maze 모드 `ai_repeat_until_reach` 밀반입 (isLooped 미설정 루프)

유통 .ent "딜레이 없는 반복분(재귀함수x)": continue_repeat 가족이 아니라 **주니어 미로 코스웨어
전용**(`mode: 'maze'`) 반복 블록을 일반 작품 JSON 에 밀반입한 것
([`block_entry.js:7387-7412`](../../entryjs/src/playground/block_entry.js#L7387)).

- func 가 `stepInto(바디)` 만 하고 **`script.isLooped = true` 를 설정하지 않음** + 반복 횟수/조건도
  없음. executor 의 프레임 양보는 pop 복귀 시 **isLooped 불일치**에서만 발동하므로
  `undefined !== undefined` = false → **양보 자체가 없는 동기 무한 반복** (분기표 미아 트릭과
  무관한, 플래그 누락 경로).
- 미로 모드에선 대기·애니메이션을 Ntry 미로 엔진이 담당해 양보가 필요 없던 설계 — 일반 executor
  로 가져오면 무양보 루프가 된다.
- 탈출은 바디 안 `stop_repeat` 뿐. 이 블록은 `class` 자체가 없어 `breakLoop()` 가 class 'repeat'
  를 못 찾고 **스택 바닥까지 pop** → 결과적으로 루프 밖으로 나감(최상위일 때). 탈출 조건이 영영
  안 맞으면 **즉시 탭 freeze** (repeat_inf 조합보다 더 즉발).
- 실측(2026-07-22): 스탬프 격자 채우기 — `move_direction` 1,296회 전체 **22ms**, 8ms 초과 간격
  **0회**(전 호출 단일 연속 실행 = 틱 하나), `stop_repeat` 정상 탈출, page error 0.
- 금지 정책 동일 적용.

### ⛔ 작품 제작 사용 금지 (사용자 정책 2026-07-22)

**이 트릭을 우리 .ent 제작(바이브 코딩)에 쓰지 않는다** — 분석·리버스엔지니어링 전용 지식.
반복 고속화가 필요하면 정식 수단인 [`fn.value` 꼬리 재귀](#함수-호출은-반복하기의-60fps-틱을-우회-꼬리-재귀-최적화)
(동기 실행) 또는 per-frame delta 설계를 쓴다. 금지 이유:

- **비공식 동작** — executor 분기의 빈틈(비지원 조립)에 의존. 엔진 개편 시 언제든 깨질 수 있음.
- 편집기에서 정상 조립 불가(statement-in-boolean) → 작품을 열어본 사람이 재현·수정 불가.
- `repeat_inf` + 트릭 = `while(true)` 탈출 조건 소멸 → **탭 freeze**. 유한 반복에서만 성립.
- DSL(make-ent)도 이 조립을 지원하지 않음.

### 증거

- 실측 방법: 편집기 하네스로 .ent 로드 → `move_direction.func` 래핑해 `performance.now()` 로그
  → 호출 간격/배치 분석. 컨트롤 2종은 project.json 수술(트릭 블록 제거 / `continue_repeat` 노드만
  `False` 로 교체) 후 재패킹.
- npm prebuilt dist 에도 `continueLoop` 존재 확인 — 소스/배포 엔진 동일 동작.

---

## `brush_stamp` 타일 렌더러 — 매 프레임 252 칸 재그리기도 62fps (스크롤 게임 예산)

타일 기반 스크롤 게임(플랫포머)에서 "타일 하나 = 오브젝트 하나"는 오브젝트 수가 폭발한다.
대안은 **단일 sprite 가 매 프레임 가시창 전체를 다시 그리는 것**이고, 실측 결과 이 방식은
Entry 에서 넉넉하게 60fps 를 유지한다.

### 실측 (2026-07-31, headless chromium, 480×270 stage, TILE=24 → 가시창 21×12=252 칸)

| 렌더 방식 | 그린 칸/프레임 | 실효 fps | 비고 |
|---|---|---|---|
| 붓 라인 (희소 맵) | 46 | 62.2 | 바닥 2 줄 + 산발 벽돌 |
| 붓 라인 (전면 solid) | 252 | 62.0 | 최악 케이스 |
| `brush_stamp` (전면 solid) | 252 | 62.4 | 실제 스프라이트 이미지 |

### stamp 예산의 실제 한계는 **칸 수 ~250/프레임**

타일을 잘게 쪼개면 (= 가시창 칸 수가 늘면) 예산을 넘긴다. 같은 480×270 화면에서:

| TILE | 가시창 | 그린 칸/프레임 | 실효 fps |
|---|---|---|---|
| 32px | 16×10 | 160 (전면 solid) | **62.4** |
| 24px | 21×12 | 252 (전면 solid) | **62.4** |
| 16px | 31×18 | 558 (전면 solid) | **41.7** ✗ |
| 16px | 31×18 | 111 (지상 현실 밀도) | 62.5 |

즉 **stamp 호출 ~250 회/프레임이 60fps 경계**다. 그 위는 프레임을 떨군다.
16px 타일도 희소한 지상 스테이지(111 칸)면 60fps 가 나오지만, 지하처럼 화면이 꽉 차면
무너진다 → **타일 크기는 최악 케이스(가시창 전면 solid) 기준으로 정해야 한다.**
도트 그림을 정수배 확대(1 도트 = 2px, 16 도트 타일 → 32px)하면 선명함을 유지하면서
칸 수를 1/4 로 줄일 수 있다.

즉 **가시창 전량 재그리기는(칸 수가 250 이하라면) 프레임 예산을 거의 쓰지 않는다.**
전제는 순회를 **꼬리재귀 value 함수**로 하는 것 — `repeat` 로 하면 1 칸 = 1 프레임이라
252 프레임(≈4 초)이 걸려 애초에 불가능하다 (위 [함수 호출은 반복하기의 60fps 틱을 우회](#함수-호출은-반복하기의-60fps-틱을-우회-꼬리-재귀-최적화)).

### 붓 라인 vs `brush_stamp` — 타일에는 stamp

- **붓 라인은 정사각 타일을 못 만든다.** `brush_thick(24)` 로 24px 폭 선을 그으면 선 끝이
  **round cap** 이라 두께/2 만큼 양쪽으로 넘친다. 24×24 칸을 그렸는데 실측 커버 면적이
  칸당 784px(28×28 상당) — 인접 칸을 덮는 overdraw. 색 블록 프로토타이핑용으로만 쓸 것.
- **`brush_stamp` (pc=1)** 은 현재 sprite 이미지를 그대로 캔버스에 찍는다 → 진짜 픽셀아트
  타일. `change_to_some_shape` 로 모양을 바꿔가며 찍으면 한 오브젝트가 N 종 타일을 렌더한다.

### ⚠️ stamp 는 sprite 의 `visible` 을 따른다 (붓 라인과 다름)

붓 라인은 `hide` 한 sprite 에서도 계속 보이지만, **stamp 는 `visible:false` 면 아무것도
찍히지 않는다** (픽셀 0, `entity.stamps` 길이는 정상 증가 → 조용한 실패).

```js
// ✗ stamp 가 화면에 안 나옴 (stamps 배열은 채워지므로 디버깅이 헷갈린다)
entity: { visible: false }

// ✓ visible:true 로 두고, 그리기가 끝나면 sprite 본체만 화면 밖으로 치운다
entity: { visible: true }
// … 타일 순회 stamp …
locateXY(0, -400)          // 커서 sprite 자체는 화면 밖
```

### `brush_erase_all` 은 stamp 도 지운다 — 누수 없음

`entity.stamps` 는 매 프레임 `eraseAll` → 재그리기 사이클에서 **252 에서 더 늘지 않는다**
(실측: 252 → 252). `removeStamps()` 가 배열을 비우므로 누적 누수는 없다
([`entity.js:1636`](../../entryjs/src/class/entity.js#L1636), 호출부 [`block_brush.js:651`](../../entryjs/src/playground/blocks/block_brush.js#L651)).

### 증거

- [`games/brick-kingdom/`](../games/brick-kingdom/) 스파이크 — 붓/stamp 각 방식의 fps·픽셀·stamps 길이 실측

## `char_at` · `substring` 은 범위를 벗어나면 **`throw`** — 문자열 타일맵에 가드 필수

`0` 이나 빈 문자열을 반환하지 않고 **예외를 던진다**. 인자가 1-based 라는 점과 겹쳐
off-by-one 이 곧 스레드 정지로 이어진다.

```js
// entryjs/src/playground/blocks/block_calc.js:1852 (char_at)
const index = script.getNumberValue('RIGHTHAND', script) - 1;
if (index < 0 || index > str.length - 1) { throw new Error(); }   // ← 값이 아니라 예외

// 같은 파일:1992 (substring)
if (start < 0 || end < 0 || start > strLen || end > strLen) { throw new Error(); }
```

`substring` 은 추가로 **`start`/`end` 를 정렬해서** 쓴다 (`Math.min`/`Math.max` + `end+1`) —
즉 `substring(s, 5, 3)` 은 빈 문자열이 아니라 3~5 구간을 돌려준다. "시작 > 끝이면 빈 문자열"
을 가정한 코드는 조용히 틀린 값을 얻는다.

**증상이 어렵다**: 예외는 그 스레드만 죽이고 다른 오브젝트는 계속 돌아간다. 콘솔에는
`Error` 한 줄만 남고 어느 블록인지 나오지 않는다. 문자열 타일맵(행 = 문자열, 칸 = 문자)에서
캐릭터가 맵 경계로 나가는 순간 물리 스레드만 정지 → "화면은 살아 있는데 조작이 안 먹는다".

**가드**: 좌표 → 문자 변환 함수에서 **범위를 먼저 검사하고** 밖이면 상수를 돌려준다.
`and_` 는 단락 평가가 없으므로 ([§boolean_and_or](#boolean_and_or에-단락-평가short-circuit-없음))
한 조건씩 **중첩 `if_`** 로 쌓아야 한다 — `and_(r>=0, r<ROWS, …)` 로 묶으면 밖에 있는 값으로
`char_at` 이 이미 평가돼 던진다.

```js
// games/brick-kingdom/spec.mjs — fnTileAt
L.set('out', txt('#')),                    // 기본값 = 벽 (경계 밖으로 못 나감)
if_(cmp(r, '>=', 0), [ if_(cmp(r, '<', ROWS), [
  if_(cmp(c, '>=', 0), [ if_(cmp(c, '<', WORLD_COLS), [
    L.set('out', charAt(valueAt('lvl', calc(r, '+', 1)), calc(c, '+', 1))),
  ])])])]),
```

### 한 칸만 바꾸려면 `replace_string` 이 아니라 `substring` + `combine`

`replace_string` 은 `split(old).join(new)` 다 ([`block_calc.js:2261`](../../entryjs/src/playground/blocks/block_calc.js#L2261))
— **같은 문자를 전부** 바꾼다. 타일 한 칸(벽돌 파괴, 보상 블록 소진)을 교체하는 데 쓰면
그 행의 모든 벽돌이 함께 사라진다. 정답은 좌/우를 잘라 이어붙이기:

```js
L.set('left',  substr(row, 1, c)),                        // 1-based, c 까지
L.set('right', substr(row, calc(c, '+', 2), strLen(row))),
setListAt('lvl', r + 1, combine(combine(L.get('left'), ch), L.get('right'))),
```

`c` 가 행의 첫/끝 칸이면 `substring` 인자가 범위를 벗어나므로, 이 헬퍼도 위 가드 안에서만
부른다.

### 증거

- [`games/brick-kingdom/spec.mjs`](../games/brick-kingdom/spec.mjs) `fnTileAt`(가드) · `fnSetTile`(한 칸 교체)
- 문자열 타일맵 설계 전체는 [04 §문자열 타일맵 + 서브스텝 스윕](04-script-and-blocks.md#문자열-타일맵--서브스텝-스윕-충돌--사이드스크롤-플랫포머)

## 헤드리스 검증에서 브라우저를 ~10 회 재부팅하면 키 이벤트가 게임에 도달하지 않는다

한 Node 프로세스에서 `bootEditor()` → 검증 → `close()` 를 반복하면 **10 번째 부팅쯤부터**
`document.dispatchEvent(KeyboardEvent)` 가 무시된다. 게임은 정상 실행 중(`state` 전이·프레임
카운터 증가)인데 플레이어만 스폰 좌표에서 한 칸도 안 움직인다.

- 같은 시나리오를 **단독 실행하면 통과**한다 → 게임 결함이 아니라 **하네스 누적 문제**다.
- 클릭(`Entry.dispatchEvent('entityClick')`)은 계속 먹는다 — 이벤트 버스는 살아 있고
  `document` DOM 리스너 경로만 끊긴다 ([§키 이벤트는 `document` + `event.code`](#키-이벤트는-document--eventcode-로-dispatch)).
- 원인은 특정하지 못했다 (추정: 닫힌 페이지의 리스너가 남아 `Entry.pressedKeys` 소유가
  흐려지는 문제). 진단보다 격리가 싸서 격리를 택했다.

**대응 — 시나리오마다 자식 프로세스**. 부수 효과로 하나가 hang 해도 나머지가 진행되고,
실패 시나리오를 `--only N` 으로 단독 재현할 수 있다.

```js
// games/brick-kingdom/verify.mjs — runAllIsolated()
for (let i = 0; i < SCENARIOS.length; i++) {
    await new Promise((resolve) => {
        const ch = spawn(process.execPath, [process.argv[1], '--only', String(i)],
                         { stdio: ['ignore', 'pipe', 'pipe'] });
        ch.on('close', resolve);
    });
}
```

키 입력이 없는 검증(변수 관찰·클릭·픽셀)은 한 프로세스로 충분하다 — `tools/run-all-verify.mjs`
가 지금까지 문제없던 이유다. **방향키 hold 로 장시간 플레이하는 검증만** 이 격리가 필요하다.

### 증거

- [`games/brick-kingdom/verify.mjs`](../games/brick-kingdom/verify.mjs) `runAllIsolated` (주석에 실측 기록)

## brush_stamp 렌더 예산은 **방문 칸이 아니라 그린 칸**으로 센다 — 타일 크기를 바꾸면 다시 재야 한다

`brush_stamp` 타일 렌더러의 예산을 "프레임당 N 칸" 하나로 관리하면 **타일 크기를 줄일 때
틀린다.** 2026-07-31 brick-kingdom Phase 2-1 에서 TILE 32/24/20 을 밀도 4 단계로 실측했다
(케이스마다 브라우저 재기동, 3 회 반복 중앙값).

| TILE | 행 | empty (stamp 0) | sparse | dense | solid |
| --- | --- | --- | --- | --- | --- |
| 32 | 9 | 62.5 | 62.5 (46 칸) | 62.5 (87 칸) | 62.3 (144 칸) |
| 24 | 12 | 62.5 | 62.5 (54 칸) | 61.8 (120 칸) | 56.8 (252 칸) |
| 20 | 13 | 62.5 | 59.6 (69 칸) | 53.5 (151 칸) | 44.5 (325 칸) |

**순회는 사실상 공짜다.** `empty`(맵이 전부 공기 → `stamp` 0 회, 순회만) 는 방문 칸이
135 → 312 로 2.3 배 늘어도 세 크기 모두 62.5fps 다. 꼬리재귀 순회·`char_at`·좌표 계산이
아니라 **`stamp` 호출이 비용의 전부**다. 그래서 빈 칸이 많은 실제 레벨은 가시창 크기와
거의 무관하고, 예산은 그린 칸으로 세면 된다.

⚠️ **그런데 stamp 당 비용이 타일 크기에 따라 다르다.** 20/sparse 는 69 칸에 59.6fps 인데
24/dense 는 117 칸에 62.3fps 다 — 칸이 더 적은데 더 느리다. 칸 수만으로는 설명되지 않는다.
원인은 규명하지 않았다(20 을 다른 이유로 탈락시켜 더 파지 않았다). **결론: 타일 크기를 바꿀
때는 그 크기에서 다시 측정한다.** 옛 크기의 "N 칸 = 60fps" 경계를 이식하면 안 된다.

### 측정 방법 — 케이스마다 브라우저를 새로 띄운다

첫 회차에서 한 브라우저로 12 케이스를 연달아 쟀더니 뒤 케이스가 누적 열화를 뒤집어써서
**타일 크기의 영향과 구분되지 않았다** (그 회차 20/empty 62.5 → 격리 후 58.7~62.5,
24/solid 는 회차별 62.0/54.4 로 흔들림). 같은 파일 §브라우저 ~10 회 재부팅과 같은 계열이다.
성능 비교는 케이스마다 새 브라우저 + 반복 측정 + 중앙값이어야 성립한다.

### 증거

- `games/brick-kingdom/기획/Phase2-4-계획.md` §4 (측정 표·결정 기록)
- 기존 단발 실측(252 칸 62fps)은 이 문서 §brush_stamp 타일 렌더러

---

## 효과 블록(`change_effect_amount` 등)을 **글상자에 걸면 스레드가 죽는다**

`효과 정하기 / 효과 주기 / 효과 모두 지우기` 를 `objectType:'textBox'` 오브젝트에 쓰면
`Runtime Error: Cannot set properties of undefined (setting 'alpha')` 로 그 스레드가 즉시
멈춘다. 버튼을 반투명하게 만들어 "잠김" 을 표현하려는 흔한 요구에서 바로 밟는다.

### 원인 — `entity.effect` 를 sprite 에만 초기화한다

[`entity.js:42-48`](../../entryjs/src/class/entity.js#L42) 의 생성자는
`this.type === 'sprite'` 분기에서만 `this.setInitialEffectValue()` 를 부른다. 이어지는
`else if (this.type === 'textBox')` 분기([:49](../../entryjs/src/class/entity.js#L49))에는
그 호출이 **없다** — 글상자 엔티티는 `this.effect` 가 `undefined` 인 채로 살아간다.

블록 쪽은 그걸 모르고 바로 대입한다
([`block_looks.js:615-617`](../../entryjs/src/playground/blocks/block_looks.js#L615)):

```js
} else if (effect === 'transparency') {
    sprite.effect.alpha = 1 - effectValue / 100;   // ← sprite.effect 가 undefined
```

`this.object` 는 글상자에도 있으므로(컨테이너) 원인이 `object` 가 아니라 **`effect`** 라는
점이 헷갈린다. 에러 메시지의 `alpha` 도 `object.alpha` 가 아니라 `effect.alpha` 다.

### 증상이 넓게 번진다

관찰(2026-08-15): 로비 첫 프레임에 이 블록이 도는 스레드 하나가 죽자 **작품 전체가 멈춘
것처럼** 보였다 — 다른 오브젝트의 클릭 핸들러도 반응하지 않고, 장면 전환도 되지 않았다.
"버튼이 안 눌린다" 로 보이지만 실제 원인은 다른 오브젝트의 효과 블록 한 줄이다.

### 회피 — 상태를 **오브젝트 2개의 show/hide** 로 표현

같은 자리에 활성/비활성 글상자를 겹쳐 두고 조건에 따라 하나만 보인다. `bgColor` 는
런타임에 바꾸는 블록이 없으므로 어차피 색이 다른 두 오브젝트가 필요하다.

```js
// 열림 버튼 — 조건이 맞을 때만 보인다
threads: [ ...dualStart(() => [ repeat.inf([
    if_(cmp(getVar('ext'), '!=', 0), [ show() ], [ hide() ]), wait(0.2),
])]) ]
// 잠김 버튼 — 같은 좌표, 반대 조건, 회색 bgColor
```

투명도가 꼭 필요하면 글상자 대신 **sprite** 로 만든다(sprite 는 `effect` 가 초기화돼 있다).

### 증거

- [`games/hexo/spec.mjs`](../games/hexo/spec.mjs) `btnOnline` / `btnOnlineLocked` — 2 오브젝트 회피
- [`games/hexo/verify.mjs`](../games/hexo/verify.mjs) §1 — 두 버튼의 `visible` 을 직접 단언(회귀 가드)
- 시행착오: `setEffect('transparency', 55)` 를 글상자 버튼에 걸었더니 pageErrors 1 +
  로비 전체 무반응 → 효과 제거 후 36/36 통과


---

## 장면을 다시 들어가면 `when_scene_start` 들이 **지난 판의 값을 먼저 읽는다**

한 장면의 여러 오브젝트에 걸린 `when_scene_start` 는 같은 프레임에 일제히 깨어나고
**실행 순서는 보장되지 않는다**. 그래서 "A 오브젝트가 초기화하고 B 오브젝트가 그 값을
읽는" 구성은 재진입 때 깨진다 — B 가 먼저 깨면 **지난 판이 남긴 값**을 읽는다.

### 실패 예 (2026-08-15, hexo)

```js
// 진행 오브젝트 — 승부가 나면 결과 장면으로
[ when.sceneStart(), waitUntil(cmp(getVar('승자'), '!=', 0)), wait(1.3), startScene('result') ],
// 돌 오브젝트 — 판을 세우며 승자를 0 으로 되돌린다
[ when.sceneStart(), /* … */ setVar('승자', 0), /* … */ ],
```

두 번째 대국에 들어가면 진행 오브젝트가 먼저 깨어 **지난 판의 `승자`(=1)** 를 보고
`waitUntil` 을 즉시 통과한다. 1.3 초 뒤 결과 장면으로 튀어 대국이 저절로 끝난다.

**증상이 늦게·불규칙하게 나온다**: 1.3 초라는 지연 때문에 짧은 판은 우연히 통과하고,
플레이가 조금만 느려지면 갑자기 "게임이 혼자 끝난다". 오브젝트 순서를 바꾸면 증상이
사라지기도 해서 원인을 엉뚱한 곳에서 찾게 된다.

### 회피 — **장면이 바뀌기 전에** 초기화한다

장면 전환을 일으키는 쪽(버튼 핸들러 등)에서 미리 지운다. 아직 다른 장면이므로 새 장면의
어떤 핸들러보다도 확실히 먼저다.

```js
const resetGame = () => [ setVar('승자', 0), setVar('상태', 0) ];

[ when.objectClick(), ...resetGame(), startScene('game') ],
```

같은 장면 안에서 순서를 맞추려 하지 말 것 — 오브젝트 간 우선순위를 지정하는 수단이 없다.
한 오브젝트 안의 여러 스레드도 마찬가지이므로, 순서가 중요하면 **한 스레드에 순차로** 둔다.

### 증거

- [`games/hexo/spec.mjs`](../games/hexo/spec.mjs) `resetGame()` — 로비·대기 양쪽 입구에서 호출
- [`games/hexo/verify.mjs`](../games/hexo/verify.mjs) §6 — 재진입 후 2.2 초가 지나도 대국
  장면에 머무는지 확인(1.3 초 지연보다 길게 기다려야 잡힌다)
- 진단 흔적: 모든 오브젝트의 `script.executors.length` 가 0 이고 `Entry.engine.state` 는
  `run` → 스레드가 죽은 게 아니라 **장면이 바뀐** 것. 장면 id 를 같이 찍어야 구분된다.


---

## `몫`·`나머지` 는 **floor 나눗셈 + 진짜 모듈로** — JS `%` 가 아니다

`quotient_and_mod` 는 JS 의 절단 나눗셈/나머지가 아니라 **수학적 정의**를 쓴다
([`block_calc.js:654-657`](../../entryjs/src/playground/blocks/block_calc.js#L654)):

```js
if (operator === 'QUOTIENT') return Math.floor(left / right);
else                         return left - right * Math.floor(left / right);
```

즉 음수에서 JS 와 결과가 다르다.

| 식 | 엔트리 | JS |
|---|---:|---:|
| `-1 나머지 2` | **1** | -1 |
| `-3 나머지 2` | **1** | -1 |
| `-1 몫 2` | **-1** | 0 (`Math.trunc`) |

### 왜 중요한가 — 음수 좌표를 그냥 써도 된다

무한 판처럼 좌표가 음수로 내려가는 설계에서 홀짝(`나머지 2`)을 판정할 때, JS 감각으로
"음수면 -1 이 나오니 큰 수를 더해 보정해야 한다"고 생각하기 쉽다. **엔트리에서는 불필요**
하다 — `-1 나머지 2` 가 곧바로 `1` 이다. 보정을 넣으면 오히려 코드만 는다.

반대로 **JS 로 짠 빌드 타임 검산과 런타임 블록이 어긋날 수 있다.** spec 안에서 같은
판정을 JS 로 미리 확인한다면 `((r % 2) + 2) % 2` 처럼 JS 쪽을 수학적 모듈로로 맞춰야
두 결과가 일치한다.

### 증거

- [`games/hexo/spec.mjs`](../games/hexo/spec.mjs) — 커서 ↑↓ 의 홀짝 분기(`나머지(커서r, 2)`)를
  음수 r 에서 보정 없이 사용. 빌드 타임 어서션은 JS 쪽을 `((r%2)+2)%2` 로 맞춰 대조한다.


---

## 글상자 entity 를 비워두면 `fontSize` 가 **NaN** — 글자가 10px 로 쪼그라든다

spec 에서 글상자 entity 를 `{ x: 0, y: 0 }` 처럼만 주면 make-ent 의 기본값이 채워진다.
그 기본값은 **sprite 기준**이라 `font: 'undefinedpx '` 가 들어간다
([`tools/make-ent.mjs`](../tools/make-ent.mjs) `makeDefaultEntity`).

sprite 에서는 이 문자열이 관례지만([03 §Entity](03-objects-and-assets.md#entity)),
글상자에서는 **폰트 크기 파서를 그대로 통과한다**:

```js
// entity.js  setFont()
this.setFontSize(parseFloat(fontArray.shift()));   // parseFloat('undefinedpx') === NaN
```

```js
// entity.js  _syncFontStyle()
style.fontSize = `${this.getFontSize()}px`;        // → 'NaNpx'
```

`setFontSize` 는 `if (this.fontSize === fontSize) return;` 로만 걸러서 `NaN !== NaN` 때문에
**매번 통과한다** — 방어가 없다. 최종적으로 캔버스가 `context.font = '... NaNpx ...'` 를
받는데 이건 파싱 실패라 브라우저가 **직전 폰트(기본 10px sans-serif)** 를 유지한다.

### 증상이 "안 보인다" 로 온다

에러도 경고도 없다. 글자는 그려지지만 10px 라, 여기에 줄바꿈까지 없으면
(아래 §`lineBreak`) 긴 문장이 한 줄로 좌우로 뻗어 **화면에는 문장 가운데 토막만
아주 작게** 남는다. "글상자에 글이 안 나온다" 로 보고되지만 원인은 폰트다.

### 처방 — 보이는 글상자는 entity 를 전부 명시

```js
entity: {
    x: 0, y: 0, regX: 0, regY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, direction: 90,
    textAlign: 0, lineBreak: true,          // 0 = 가운데 (1 이 아니다)
    width: 440, height: 130,
    font: '16px NanumGothic', fontSize: 16, // 둘 다 준다
    colour: '#e8eef7', bgColor: 'transparent',
    visible: true,
}
```

`font` 만 주면 `syncModel_` 의 `setFontSize(fontSize || this.getFontSize())` 가 `undefined`
를 만나 앞서 파싱한 값으로 되돌아간다 — `fontSize` 를 같이 주는 편이 안전하다.
헬퍼로 감싸서 빠뜨릴 수 없게 만드는 걸 권한다.

### 증거

- [`entity.js`](../../entryjs/src/class/entity.js) `setFont` · `setFontSize` · `_syncFontStyle`
- 같은 파일 `syncModel_` — 호출 순서
  (`setScaleX` → `setLineBreak` → `setWidth` → `setHeight` → `setText` → `setTextAlign` → `setFontSize`)
- 가드: [`tools/verify-textbox-layout.mjs`](../tools/verify-textbox-layout.mjs) §① · 픽스처 [`tests/fixtures/spec-textbox-layout.mjs`](../tests/fixtures/spec-textbox-layout.mjs) 의 `기본entity` 오브젝트가
  **함정을 그대로 재현**한다(`entity: { x, y }` 만 준 글상자). 실측에서 `fontSize === NaN`.
  이 단언이 깨지면 make-ent 가 고쳐진 것이니 이 문서와 [03](03-objects-and-assets.md#textbox-오브젝트) 를 함께 갱신할 것.

---

## `lineBreak: true` 는 `height` 를 넘는 줄을 **그리지 않고 버린다**

[§textBox 정렬](#textbox-정렬--regxregy-강제-0-가운데는-textalign0-1-아님) 이 고정 폭을 위해
`lineBreak: true` 를 권하는데, 켜면 **세로 클리핑**이 함께 따라온다.

`alignTextBox()` 가 `textObject.style.maxHeight = this.getHeight()` 를 걸고, 렌더러가
그 밖의 줄을 건너뛴다:

```js
// PIXIText.js
const MAX_HEIGHT = style.maxHeight < 0 ? 0xffff : style.maxHeight - H_LH;
for (let i = 0; i < lines.length; i++) {
    linePositionY = style.strokeThickness / 2 + i * lineHeight + H_LH;
    if (WORD_WRAP && linePositionY > MAX_HEIGHT) break;   // ← 조용히 잘림
```

`lineHeight` 는 `fontSize + 2` (`entity.js` `setLineHeight`) 이므로
**들어가는 줄 수 ≈ `height / (fontSize + 2)`**. 잘려도 에러가 없고 `entity.getText()` 에는
전문이 남아 있어서, 변수만 찍어 보면 "값은 맞는데 화면만 짧다" 로 보인다.

| `lineBreak` | 폭 | 세로 |
|---|---|---|
| `false` | `setTextAlign` 이 **내용 길이로 덮어씀**(spec 의 width 무시) → 한 줄로 화면 밖까지 | 클리핑 없음 |
| `true` | `width` 에서 접힘 (고정 폭) | **`height` 초과분 삭제** |

길이를 모르는 텍스트(AI 응답, 사용자 입력)를 담을 땐 최악 길이로 `height` 를 잡는다.

### 증거

- [`entity.js`](../../entryjs/src/class/entity.js) `alignTextBox` · `setLineBreak`
- [`PIXIText.js`](../../entryjs/src/class/pixi/text/PIXIText.js) `MAX_HEIGHT` break
- ⚠️ **줄 수를 폭으로 검증하면 안 된다.** CreateJS 경로(`GEHelper.isWebGL === false`)의
  `getMeasuredWidth()` 는 **줄바꿈을 무시하고 원문 전체를 잰다**. 두 렌더러 모두
  `getMeasuredHeight()` 는 `lineWidth` 를 반영하므로 **높이 ÷ lineHeight 로 줄 수를 센다.**
  (로컬 편집기는 CreateJS, playentry.org 는 PIXI 로 뜰 수 있어 실측 결과가 갈린다.)
- 가드: [`tools/verify-textbox-layout.mjs`](../tools/verify-textbox-layout.mjs) §② — 폭 300·`fontSize` 16·`height` 60 글상자에
  70자를 넣어 **4줄로 접히고 3줄만 그려지는 것**과 `maxHeight === height`,
  `lineHeight === fontSize + 2` 를 단언한다.

---

## `묻고 대답 기다리기` — 입력칸이 무대 아래 **−71 부터**를 덮고, 말풍선은 `hide()` 로 안 사라진다

이 블록은 두 가지를 화면에 얹는다. 둘 다 레이아웃을 짤 때 계산에 넣어야 한다.

### 1. 입력칸 — 엔트리 좌표 −71 ~ −112

```js
// stage.js  _createInputField()
const posX = 15, posY = 275;
new classRef({ width: 520, height: 24, padding: 13, borderWidth: 2, x: posX, y: posY, … })
```

캔버스 좌표계(640×360) 기준이다. 세로로 `24 + 13×2 + 2×2 = 54px` 를 차지하므로
캔버스 y `275 ~ 329`. [무대 논리 좌표 변환](#stage-논리-좌표-vs-canvas-렌더-픽셀--clickstagepoint-변환-공식)
(`엔트리y = 135 − 캔버스y × 0.75`)을 적용하면

> **엔트리 좌표 y −71 부터 −112 까지는 입력칸 자리다.**

여기에 글상자를 두면 `visible: true` 이고 좌표도 맞는데 **눈에는 안 보인다**.
`묻기` 를 쓰는 작품은 세로 예산을 `135 ~ −71` (206 단위)로 잡는다.

입력칸은 답을 받으면 숨겨지고 다음 `묻기` 에 다시 뜬다. 장면을 바꿔도
`resetSceneDuringRun` 이 `Entry.stage.hideInputField()` 를 부른다
(아래 §장면 재진입).

### 2. 말풍선 — `hide()` 로는 안 사라진다

```js
// block_variable.js  ask_and_wait.func
Entry.stage.showInputField();
new Entry.Dialog(sprite, Entry.convertToRoundedDecimals(message, 3), 'ask');
```

말풍선은 묻는 오브젝트에 붙는다. 오브젝트를 숨겨도 남는다 —
`syncDialogVisible()` 은 **`setVisible` 이 호출될 때만** 돌고, 말풍선은 그 뒤에 생기므로
`visible: true` 인 채로 태어난다. `hide()` 를 먼저 걸어둔 오브젝트가 나중에 물으면
**말풍선만 떠 있다.**

### 회피 — 묻는 오브젝트를 **무대 오른쪽 밖**으로

```js
entity: { x: 500, … visible: false }
```

말풍선 위치는 오브젝트 bound 로 정하는데, 두 가지가 겹쳐서 오른쪽만 통한다
([`dialog.ts`](../../entryjs/src/class/dialog.ts) `setNotchPositionForPixi`):

```js
if (notchType.includes('e')) {                     // 오브젝트가 무대 왼쪽에 있을 때
    this.object.x = Math.min(bound.x + bound.width + this.width / 2,
                             240 - this.width / 2 - this.padding);   // ← 오른쪽으로 clamp
} else {                                           // 오브젝트가 무대 오른쪽에 있을 때
    this.object.x = Math.max(bound.x - this.width / 2,
                             -240 + this.width / 2 + this.padding);  // ← 왼쪽으로만 clamp
}
```

`w` 가지에는 **위쪽 clamp 가 없다.** `x: 500` 이면 말풍선이 `500 − 폭/2` 로 가서
무대(±240) 밖으로 나가 렌더되지 않는다. 반대로 `x: -500` 은 `Math.min` 에 걸려
왼쪽 가장자리에 붙는다 — **반드시 오른쪽(양수)으로 보낼 것.**

보험이 필요하면 같은 오브젝트의 **두 번째 스레드**에서 `말풍선 지우기`(`remove_dialog`)를
부른다. `sprite.dialog.remove()` 가 `parent.dialog = null` 로 만들 뿐이고
`ask_and_wait` 의 완료 처리도 `if (sprite.dialog)` 로 가드돼 있어 깨지지 않는다
([`block_looks.js`](../../entryjs/src/playground/blocks/block_looks.js) `remove_dialog`).
`묻기` 는 블로킹이므로 가드 스레드는 같은 메시지 핸들러를 하나 더 두면 된다
(`신호 보내고 기다리기` 는 두 스레드를 모두 기다리지만 가드 쪽은 즉시 끝난다).

안내 문구는 말풍선 대신 **화면 안의 글상자**로 보여주는 편이 낫다 — 말풍선은 위치·폭을
제어할 수 없다.

### 증거

- [`stage.js`](../../entryjs/src/class/stage.js) `_createInputField` · [`block_variable.js`](../../entryjs/src/playground/blocks/block_variable.js) `ask_and_wait` · [`dialog.ts`](../../entryjs/src/class/dialog.ts) `setNotchPositionForPixi` · [`entity.js`](../../entryjs/src/class/entity.js) `syncDialogVisible`
- 가드: [`tools/verify-textbox-layout.mjs`](../tools/verify-textbox-layout.mjs) §③ — `묻기` 를 실제로 실행해 입력칸 윗변 **−71.3** ·
  아랫변 **−111.8**(세로 54px)을 재고, `x: 500` 인 오브젝트의 말풍선이 **x ≈ 412** 로
  무대(±240) 밖에 있는 것과 `hide()` 를 해도 `dialog.object.visible !== false` 인 것을 단언한다.

### 곁다리 — `대답` 변수는 기본이 숨김

`variableType: 'answer'` 변수는 `visible: false` 로 생성된다
([`variable_container.js`](../../entryjs/src/class/variable_container.js) `generateAnswer`).
무대에 값 상자가 뜰 걱정은 없다. (임의로 만들면 안 되는 이유는 [lessons.md](lessons.md) 참조.)

---

## 장면을 다시 들어가도 **실행기는 쌓이지 않는다** — 대신 `entity.reset()` 이 좌표를 되돌린다

`start_scene` 은 `selectScene` + `fireEvent('when_scene_start')` 뿐이고
([`block_start.js`](../../entryjs/src/playground/blocks/block_start.js) `start_scene.func`),
`Code.raiseEvent` 는 **무조건 새 Executor 를 push** 한다
([`code.js`](../../entryjs/src/playground/code.js) `raiseEvent`). 여기까지만 읽으면
"장면을 왕복하면 `repeat.inf` 스레드가 2개, 3개로 늘어난다" 는 결론이 나온다.
**틀렸다** — 그 앞에서 정리된다.

```js
// scene.js  selectScene()
container.resetSceneDuringRun();
```

```js
// container.js
resetSceneDuringRun() {
    if (!Entry.engine.isState('run')) return;        // ← 정지 상태면 아무것도 안 함
    this.mapEntityOnScene((entity) => entity.reset());
    this.clearRunningStateOnScene();                 // → object.clearExecutor() → script.clearExecutors()
    Entry.stage.hideInputField();
}
```

**떠나는 장면**의 오브젝트마다 실행기가 통째로 비워진다. 그래서
`대화 장면 → 안내 장면 → 로딩 장면 → 대화 장면` 을 몇 번 돌아도 루프는 하나뿐이다.
`자신의 다른 코드 멈추기` 같은 가드를 넣을 필요가 없다.

### 따라오는 사실 — 좌표·크기는 **장면에 들어올 때마다 다시 잡는다**

같은 함수가 `entity.reset()` 도 부른다. 런타임에 `locate_xy` 로 옮겨 둔 위치, 바꿔 둔 크기는
장면을 떠나는 순간 **spec 의 entity 값으로 돌아간다**. 등장 애니메이션처럼 좌표를
움직이는 연출은 `장면이 시작되었을 때` 스레드 첫 줄에서 위치를 다시 세팅해야
두 번째 진입에서도 같게 보인다.

### 함께 볼 것

- 값이 **언제** 보이느냐는 별개 문제다 → [§장면 재진입 순서](#장면을-다시-들어가면-when_scene_start-들이-지난-판의-값을-먼저-읽는다)
  (실행기는 새것인데 **변수는 지난 판 값**인 구간이 있다).
- 첫 장면에서는 `when_scene_start` 가 아예 발화하지 않는다 →
  [§when_scene_start 첫 장면 미발화](#when_scene_start-는-시작-시-첫-장면에서-발화-안-함--start_scene-전환에서만).

### 증거

- [`scene.js`](../../entryjs/src/class/scene.js) `selectScene` · [`container.js`](../../entryjs/src/class/container.js) `resetSceneDuringRun`/`clearRunningStateOnScene` · [`object.js`](../../entryjs/src/class/object.js) `clearExecutor`
- 가드: [`tools/verify-textbox-layout.mjs`](../tools/verify-textbox-layout.mjs) §④ — 장면 3회 왕복 후 `repeat.inf` 오브젝트의
  `script.executors.length === 1` 을 단언하고, 런타임에 옮긴 좌표가 `entity.reset()` 으로
  spec 값으로 되돌아오는 것까지 확인한다.

---

## 불리언 false와 숫자 0은 같음 비교에서 다르다

2026-09-10 심연의 성채, npm `@entrylabs/entry` 4.0.20 로컬 실행에서 확인.
`boolean_and_or`는 불리언을 반환한다. 이를 변수에 저장해 놓고 `cmp(value, '==', 0)`으로
거짓을 검사하면 기대한 분기로 들어가지 않을 수 있다.

`boolean_basic_operator`의 `EQUAL`은 비어 있지 않은 숫자 문자열을 숫자로 바꾼 뒤
`===`로 비교한다. 따라서 숫자 문자열 `'0'`과 0은 같지만 **불리언 false와 0은 다르다**.
확인한 소스의 `NOT_EQUAL`은 `!=`를 사용하므로, 혼합 타입에서는 같음과 다름이 단순한
논리적 반대라고 가정해서도 안 된다.

심연의 성채의 `moving`은 불리언이었다. 정지 중 회피에서 `moving == 0`을 검사하던 것을
**원래의 숫자 입력인 `fwd == 0 && strafe == 0`**으로 바꾸어 해결했다.
일반적으로 상태 플래그는 숫자 0/1 또는 불리언 중 하나로 통일하고, 불리언 부정에는
`boolean_not`을 쓴다. 숫자 0/1이 필요하면 `if_`의 양쪽 분기에서 명시적으로 저장한다.

근거: `src/playground/blocks/block_judgement.js`의 `boolean_basic_operator.func`
(`EQUAL`/`NOT_EQUAL`)와 `boolean_and_or.func`.
소스 위치를 찾는 절차는 [공식 소스 인덱스](00-official-sources.md)를 따른다.
수정: [spec.mjs](../games/abyssal-keep/spec.mjs)의 `moveplayer`.
회귀 확인: [verify.mjs](../games/abyssal-keep/verify.mjs)의
`dash advances the player and starts its cooldown`은 이동 키 없이 Shift만 누른다.

## 전역 변수·리스트 조회는 배열 탐색이다

`src/class/variable_container.js`의 `getVariable`은 `variables_`를,
`getList`는 `lists_`를 ID 조건의 `_.find`로 찾는다. 복제본 전용 값은 이후 해당 엔티티의
저장소를 추가로 찾는다. 조회가 항상 ID 해시 맵의 상수 시간이라고 가정하면 안 된다.

심연의 성채는 DDA에서 반복해서 읽는 `mx`, `my`, `sideX`, `sideY`, `ddx`, `ddy` 등을
선언 배열 앞쪽으로 옮겼다. 이는 비교할 후보 수를 줄이는 선택이며 엔진을 수정하지 않는다.
일반 게임에서도 무조건 재정렬하라는 규칙은 아니다. 조회가 많은 경로인지 먼저 확인하고,
한 호출에서 재사용할 중간값과 [함수 지역 변수](04-script-and-blocks.md#함수-지역-변수-function-local-variables)를 검토한다.

근거: 위 엔진 함수와 [spec.mjs](../games/abyssal-keep/spec.mjs)의 `hot` 배열·`variables.sort`.
최종 처리량과 측정 조건은 [사례의 검증 범위](14-abyssal-keep-case-study.md#검증한-버전과-범위)에 있다.
변수 순서만 바꾼 A/B 수치는 남기지 않았으므로 성능 개선 배수는 미확인이다.
엔진 버전이 바뀌면 실제 조회 구현을 다시 확인한다.

## 낮은 알파의 클릭판도 pixelPerfect 검사에서 탈락할 수 있다

2026-09-10 심연의 성채에서 불투명 카드 배경 위에 `fill-opacity=".005"`인 별도 sprite를
클릭판으로 올렸더니 키보드 선택은 되지만 실제 마우스 클릭은 실패했다. 완전한 알파 0이
아니어도 매우 작은 값은 래스터화 과정에서 낮은 정수 알파가 되어 hit-test 기준을 넘지 못할 수 있다.
정확한 클릭 원리는 기존 [sprite pixelPerfect 항목](#sprite-도-pixelperfect--투명-픽셀-ring-가운데-등-클릭-안-됨)이 정본이다.

해결은 보이는 카드 그림 자체를 불투명 sprite로 만들어 클릭 이벤트를 받게 한 것이다.
투명한 여백·배경이 있는 이미지는 파일의 사각 경계 전체가 클릭된다고 가정하지 않는다.
이전 반투명 이미지의 래스터 알파 값을 별도로 보관하지 않았으므로 특정 반올림 결과까지 단정하지 않는다.

근거: [assets.mjs](../games/abyssal-keep/assets.mjs)의 `relicCard`,
[spec.mjs](../games/abyssal-keep/spec.mjs)의 `card1`〜`card3`.
회귀 확인: [verify.mjs](../games/abyssal-keep/verify.mjs)의
`real canvas click selects the middle relic card`는 실제 무대 좌표를 클릭한 뒤 선택 효과를 검사한다.
