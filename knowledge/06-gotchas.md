# 함정 모음 (증상별)

우리가 실제로 부딪히고 해결한 버그. 비슷한 증상이 또 나오면 먼저 여기를 검색.

## `addChildAt` undefined

### 증상
```
TypeError: Cannot read properties of undefined (reading 'parent')
    at b.addChildAt (easeljs-0.8.0.min.js:...)
    at e.value (entry.min.js:...)
    at Entry.loadProject (entry.min.js:...)
```

엔트리 엔진이 프로젝트를 로드하다가 EaselJS `addChildAt(child, index)`에서
`child`가 undefined라서 `child.parent` 접근에 실패.

### 원인 (우리가 겪은 모든 경우)

1. **첫 scene id가 `"7dwq"`가 아님** — 가장 흔함.
   Entry 내장 starter가 scene id `"7dwq"`를 하드코딩해서 쓰는데
   ([`entryjs/src/class/project.js:82`](../../entryjs/src/class/project.js#L82)),
   편집기가 초기화 시 그 id로 스테이지를 바인딩한다. 사용자 프로젝트의 scene id가 다르면
   Entry.scene의 내부 참조가 끊어진다.
   **해결**: 첫 scene은 항상 `"7dwq"`.

2. **`interface.object`가 null 또는 존재하지 않는 id** — Entry가 초기 선택 오브젝트를 못 찾음.
   **해결**: `interface: { canvasWidth: 640, object: objects[0].id }`.

3. **`object.script`가 `"[]"`** — 빈 thread 리스트. 최소 `"[[]]"` 필요.
   **해결**: 빈 프로젝트도 최소 1개의 (비어도 좋은) thread.

4. **`clearProject()` 없이 두 번째 `loadProject`** — 기존 오브젝트와 충돌.
   **해결**: 항상 `Entry.clearProject()` 먼저.

### 디버깅
```js
// 브라우저 콘솔
Entry.scene.scenes_         // 장면 배열 - 길이 > 0, 첫 id가 '7dwq'?
Entry.container.objects_    // 오브젝트 배열
project.interface           // object 필드가 objects[0].id와 같은가?
project.objects[0].script   // '[[]]' 이상인가?
```

## 오브젝트 썸네일이 회색 박스

### 증상
오브젝트 리스트 패널(왼쪽 아래)에서 오브젝트 이름 옆 썸네일이 회색·빈 박스.

### 원인

1. **`clearProject()` 누락** — 현재 짐작컨대 가장 흔한 원인.
   기존 엔트리봇 위에 새 오브젝트가 덧붙어서 씬/렌더 상태가 엉킴.
   → [§clearProject 누락](#clearproject-없이-두-번째-loadproject) 참고.

2. **`fileurl`이 404** — tar에 없는 `temp/...` 경로 또는 public/에 없는 파일.
   DevTools Network 탭에서 확인.

3. **`fileurl`이 외부 경로** — `.ent`가 자가완결이 아니라 특정 서버에 의존.
   다른 환경에서 열 때 404.
   **해결**: make-ent에서 picture를 tar에 번들 ([03-objects-and-assets.md §자산 자동 번들링](03-objects-and-assets.md)).

4. **`thumbUrl`이 잘못된 값** — 과거 커밋 히스토리 혼동으로 thumbUrl을 지정했다가 경로가 어긋난 케이스.
   **empirical 정답**: playentry.org 레퍼런스는 thumbUrl 필드 자체를 쓰지 않음.
   → [03-objects-and-assets.md §Picture](03-objects-and-assets.md#picture--최신-포맷-playentry-레퍼런스-기준).

## `Entry.loadProject(project)`가 오브젝트를 **추가**함 (교체가 아니라)

### 증상
사용자가 "파일 열기"로 `.ent`를 열면 기존 엔트리봇 + 새 오브젝트가 **둘 다** 보임.

### 원인
`Entry.container.setObjects()`는 `objects_.push()`로 구현 ([`container.js:285`](../../entryjs/src/class/container.js#L285)).
replace가 아니라 append.

### 해결
```js
Entry.clearProject();
Entry.loadProject(project);
```

MYentry도 동일 패턴 ([`MYentry/public/js/editor.js:345`](../../MYentry/public/js/editor.js#L345)).

## 콘솔 에러: `module is not defined`

### 증상
```
ReferenceError: module is not defined
    at lib/vendor/preloadjs-0.6.0.min.js:12:30248
```

### 원인
npm `preload-js@0.6.3` 패키지 파일 끝에 `;module.exports=window.createjs;`가 붙어있음 — Node 환경용.
브라우저에서는 `module` 전역이 없어서 크래시.

### 해결
```bash
perl -i -pe 's/;module\.exports=[^;]*;\s*$/;/' public/lib/vendor/preloadjs-0.6.0.min.js
```

이 처리는 **vendor 파일을 복사할 때 한 번** 하면 됨.
EaselJS/SoundJS는 같은 패턴이 없으니 건드리지 않음.

## 콘솔 에러: `_parsePath Cannot read 'toString' of undefined`

### 증상
엔트리 초기화 중 SoundJS에서 TypeError.

### 원인
npm `soundjs@1.0.1`의 `_parsePath(src)`가 `src === undefined`일 때 `.toString()` 호출 크래시.
엔트리가 기본 사운드 등록 시 src 없이 호출하는 경로가 있음.
playentry 0.6.0은 관대했음.

### 해결
`editor.js`의 `patchCreateJSSoundParsePath()` — Entry.init 직전에 `_parsePath`를 try/catch로 감싸는 래퍼로 교체.
→ [05-host-editor.md §soundjs 패치](05-host-editor.md#soundjs-1x-호환-패치-editorjs에서).

## 하드웨어 WebSocket 에러 (127.0.0.1:23518)

### 증상
```
WebSocket connection to 'ws://127.0.0.1:23518/socket.io/...' failed
```

### 원인
엔트리는 로컬 "엔트리 하드웨어" 앱과 통신하려고 `ws://127.0.0.1:23518`에 연결 시도.
우리 용도(게임 제작)에는 불필요.

### 해결
`Entry.init(option)`의 `initOption`에 `hardwareEnable: false`.

## 이미지 404 (tar 업로드 시)

### 증상
`.ent`를 playentry.org에 올리면 모든 이미지가 깨짐.

### 원인 (MYentry 커밋 `b79d8a9`에서 근본 원인 규명)
tar 헤더가 npm `tar` portable 포맷과 불일치. 특히 **디렉터리 mode가 0644**.
엔트리 서버가 디렉터리 생성을 스킵 → 자식 파일 경로 매핑 실패 → 전부 404.

### 해결
tar 헤더를 엄격히 portable 포맷으로.
→ [01-binary-format.md §tar 헤더](01-binary-format.md#tar-헤더-ustar-portable).

## params 개수 불일치 (런타임 경고 블록)

### 증상
편집기에서 워크스페이스에 빨간 경고 블록이 표시됨.

### 원인
블록의 `params` 배열 길이가 엔진이 기대하는 `paramCount`와 다름.
파라미터 기본값이 `null`이어도 되지만 **슬롯 개수는 맞춰야 함**.

예: `repeat_basic`의 paramCount는 2 (값 + Indicator).

### 해결
`tools/block-registry.json`을 참고해 정확한 길이를 맞춤. make-ent의 `normalizeBlock`이
자동으로 해주지만, spec에서 직접 params를 구성할 때 주의.

## 필드 슬롯에 text 블록 넣어서 경고

### 증상
편집기는 로드되지만 블록이 빨갛게 경고 표시. 예: `see_angle_object(mouse)`가 안 먹음.

### 원인
DropdownDynamic 필드(`see_angle_object.VALUE`, `set_variable.VARIABLE` 등)에
`{"type":"text","params":["mouse"]}`로 wrap해서 넣음. 필드는 **바로 문자열**이어야 함.

### 해결
make-ent spec에서 `{ "__field": "mouse" }` sentinel 사용 → 언래핑돼서 바로 `"mouse"` 문자열로 emit.
→ [04-script-and-blocks.md §필드](04-script-and-blocks.md#4-필드-dropdown--dropdowndynamic--바로-문자열).

## SVG 이미지가 엔트리 편집기에서는 보이는데 playentry 업로드 시 안 보임

### 증상
내 에디터에서 SVG가 잘 보이는데 playentry.org로 업로드하면 회색.

### 원인
playentry.org가 받는 `.ent`는 **PNG만** 있어야 함 (레퍼런스 파일 관찰).
SVG 원본을 tar에 넣으면 엔트리 서버 파이프라인이 처리 못 함.

### 해결
make-ent와 /api/export에서 항상 `sharp(svg).png()`로 래스터라이즈해 PNG로 저장.
`picture.imageType = "png"`.
→ [03-objects-and-assets.md §Picture 핵심 규칙](03-objects-and-assets.md#핵심-규칙).

## 테스트: toggleRun이 tickEnabled 에러로 죽음

### 증상 (헤드리스 환경 전용)
```
TypeError: Cannot read properties of undefined (reading 'tickEnabled')
    at Entry.engine.toggleRun
```

### 원인
EaselJS가 실제 canvas에 마운트된 후에만 tick 시스템이 준비됨. Playwright 헤드리스에서는
stage 생성 타이밍이 엇나가 tickEnabled가 undefined.

### 해결
e2e 테스트에서 실제 실행은 건너뛰고 **블록 트리만** 검증. 런타임 검증은 수동 or CI에서
headed 모드로.
→ [`tests/e2e.spec.js`](../tests/e2e.spec.js).

## `boolean_and_or`에 단락 평가 (short-circuit) 없음 → 리스트 인덱스 범위 초과 크래시

### 증상
게임 실행 중, 리스트 정렬/탐색 로직에서:
```
반복하기 (pos ≤ 항목수 AND level ≤ _점수[pos]) 인 동안
  pos += 1
```
실행 → `can not insert value to array` 런타임 에러, 게임 멈춤.

### 원인
Entry `boolean_and_or`의 런타임 구현:
```js
let [leftValue, rightValue] = script.getValues(['LEFTHAND', 'RIGHTHAND'], script);
// ...
if (operator === 'AND') return leftValue && rightValue;
```
([`block_judgement.js:boolean_and_or`](../../entryjs/src/playground/blocks/block_judgement.js))

**두 피연산자를 모두 먼저 평가** — JavaScript의 `&&` 단락 평가 전에 `getValues`가 이미 두 값을 구해 놓는다.
따라서 LEFT가 false여도 RIGHT가 계산되고, `value_of_index_from_list`가 리스트 끝을 넘어가면
[`block_variable.js:866`](../../entryjs/src/playground/blocks/block_variable.js#L866)의 guard
`if (index > array.length) throw new Error('can not insert value to array')`가 터진다.

### 해결 패턴 — `_if + stop_repeat` 가드

단락 평가가 없으므로 **명시적으로 순차 가드**:
```
repeat_inf:
  if (pos > 항목수):     ← 먼저 범위 체크
    stop_repeat
  if (level > _점수[pos]): ← 여기는 pos ≤ 항목수 보장됨
    stop_repeat
  pos += 1
```

- 첫 `_if`가 통과하지 못하면 `stop_repeat`으로 루프 종료 → 두 번째 `_if`는 실행 안 됨.
- 두 번째 `_if`가 평가될 때는 `pos ≤ 항목수`가 보장 → 리스트 접근 안전.

### 일반화
Entry의 모든 boolean 합성(`boolean_and_or`, `boolean_basic_operator`, ...) 연산자는
**양쪽을 항상 평가**. 부작용/예외 가능성이 있는 sub-expression이 AND/OR 피연산자면 반드시
nested `_if` 패턴으로 변환.

### 관련
- memory-ranking.ent의 insertion-sort 스캔 루프에서 발견 (2026-04-23 6차)

---

## 리터럴 블록이 `[object Object]`로 표시됨

### 증상
워크스페이스에서 `말하기`·`≤` 같은 블록의 텍스트/숫자 슬롯에 `[object Object]`가 보임.
예: `체력 값 ≤ [object Object] 이라면`, `[object Object] 을(를) 말하기`.

### 원인
`normalizeBlock`에서 spec이 이미 `{type:"number", params:["0"]}` 형태여도 재귀적으로
`wrapParam`을 돌려 `params[0]="0"`을 **또** 블록으로 감싸버림:
```
{type:"number", params:[{type:"text", params:["0"]}]}   ← 이중 래핑
```

Entry 엔진은 `params[0]`을 값으로 해석하려다 문자열화된 객체를 얻음.

### 원인 (구조적)
`number`, `text`, `True`, `False`, `angle`, `color_hex`, `get_variable` 등
**value-wrapper(leaf) 블록**은 params가 **이미 리터럴 값**. 이들을 normalize 시
sub-block으로 취급해 재귀하면 안 됨.

### 해결
`normalizeBlock` 맨 앞에서 `PRIMITIVE_BLOCK_TYPES`를 먼저 체크하고 leaf로 return:
```js
if (PRIMITIVE_BLOCK_TYPES.has(spec.type)) {
    return {
        type: spec.type,
        params: Array.isArray(spec.params)
            ? spec.params.map(p => (p?.__field !== undefined) ? p.__field : p)
            : []
    };
}
```

`__field` sentinel도 여기서 언래핑해서 `get_variable.params[0]`처럼 변수 id가 나와야 할
자리에서 정상 작동하도록.

### 검증 방법
`.ent` 로드 후 브라우저에서:
```js
document.querySelectorAll('svg text').forEach(e => {
  if (e.textContent.includes('[object Object]')) console.log('BUG:', e);
});
```

### 엔트리 엔진 동작 참고
`entryjs/src/playground/blocks/block_variable.js`의 `text`, `number`는 `skeleton: 'basic_text'` /
`'basic_string_field'`로 params[0]을 **그대로 문자열 렌더**. 그래서 중간에 객체가 끼면
CSS에 `"[object Object]"`가 노출됨.

---

## 헤드리스 런타임 검증 — 이벤트 직접 dispatch 패턴

### 증상 / 필요
Playwright 헤드리스에서 **클릭 기반 게임**(`when_object_click`)의 동작을 검증하려면 실제로 클릭을
발생시켜야 하는데, 1) 스테이지 캔버스 위 좌표 계산이 번거롭고 2) `Entry.engine.toggleRun()`이
EaselJS `tickEnabled` 문제로 throw할 가능성이 있음.

### 해결 — `Entry.dispatchEvent` 직접 호출

Entry의 클릭 처리는 [`entryjs/src/class/entity.js:90`](../../entryjs/src/class/entity.js#L90)에서
`Entry.dispatchEvent('entityClick', this.entity)` 한 줄로 이벤트 버스에 쏜다. `when_object_click`
트리거는 이 이벤트 이름을 구독 ([`block_start.js:229`](../../entryjs/src/playground/blocks/block_start.js#L229) `event: 'when_object_click'`).

따라서 Playwright `page.evaluate` 안에서 바로:
```js
try { Entry.engine.toggleRun(); } catch (e) { /* tickEnabled throw 가끔 있음, 무시 */ }
const entity = Entry.container.getAllObjects()[0].entity;
for (let i = 0; i < 10; i++) {
    Entry.dispatchEvent('entityClick', entity);
    await new Promise(r => setTimeout(r, 100));
}
// 이제 entity.x / entity.y / Entry.variableContainer.getVariable('clicks').getValue() 검사
```

### 다른 이벤트로 일반화

| 사용자 동작 | Entry 이벤트 | 해당 트리거 블록 |
|-------------|--------------|------------------|
| 오브젝트 클릭 | `entityClick` | `when_object_click` |
| 오브젝트 클릭 해제 | `entityClickCanceled` | `when_object_click_canceled` |
| 키 누름 | `keyPressed` | `when_some_key_pressed` |
| 신호 보내기 | `message_cast` 블록 자체 트리거 | `when_message_cast` |

`Entry.Utils` / `Entry.dispatchEvent`를 찾아보면 더 있을 수 있음.

### 참고 테스트
[`tools/verify-click-teleport.mjs`](../tools/verify-click-teleport.mjs) — click-teleport 게임을
로드하고 10번 클릭 후 entity 위치 변화 확인.

---

## 엔트리 이미지 404 (내 서버에서)

### 증상
편집기 로드 시 콘솔에 수십 개의 404: `/images/block_icon/...`, `/lib/entry-js/images/...`.

### 원인
Entry는 같은 이미지를 두 경로에서 요청: `/images/*`와 `/lib/entry-js/images/*`.
entryjs/images 디렉터리를 둘 중 한 곳에만 두면 절반이 깨짐.

### 해결
`entryjs/images/`를 **양쪽에 복사**:
- `public/images/`
- `public/lib/entry-js/images/`

약 32MB × 2 = 64MB 중복. 심볼릭 링크/정션으로 대체 가능.
