# 블록 스크립트 · params · 블록 타입

## `object.script`는 JSON **문자열**

`object.script`는 플레인 배열이 아니라 **`JSON.stringify()`된 문자열**이다.
평면 배열로 넣으면 엔트리가 무시하고 워크스페이스에 블록이 한 개도 뜨지 않는다.

```js
object.script = JSON.stringify([
  [ /* thread 0: 블록 체인 */ ],
  [ /* thread 1: 독립된 다른 시작 블록 */ ],
])
```

### 최소 단위는 `"[[]]"`

빈 프로젝트라도 `"[]"` (빈 thread 리스트)는 안 되고 `"[[]]"` (빈 thread 하나)가 필요.
`"[]"`면 엔트리가 EntityObject 생성 시 `addChildAt(undefined)`로 꺼진다.

## Block 객체

```json
{
  "id": "qhj4",
  "x": 40, "y": 50,
  "type": "repeat_basic",
  "params": [
    { "type": "number", "params": ["10"] },
    null
  ],
  "statements": [ [ /* 감싸지는 thread */ ] ],
  "movable": null, "deletable": 1,
  "emphasized": false, "readOnly": null,
  "copyable": true, "assemble": true,
  "extensions": []
}
```

| 필드 | 필수 | 비고 |
|------|:----:|------|
| `type` | ✔ | 블록 타입. [`tools/block-registry.json`](../tools/block-registry.json)의 키 |
| `params` | ✔ | 길이는 블록의 `paramCount`. 슬롯별로 null / 리터럴 / 중첩 블록 / 필드 문자열 |
| `statements` | ○ | 블록이 감싸는 영역이 있을 때만 (`repeat_*`, `_if`, `if_else` 등) |
| `id` | ○ | 4자 해시. 생략하면 자동 생성되지만 명시 권장 |
| `x`, `y` | ○ | thread **시작** 블록에만 의미 있음 |
| `movable..extensions` | ○ | 일반적 기본값 `null/1/false/true/[]`. 편집기에서 만든 블록엔 꼭 있음. 생성 스크립트는 생략해도 작동 |

## params 슬롯 타입

블록의 params 배열 각 슬롯은 다음 중 하나:

### 1. `null` — 빈 슬롯

### 2. 리터럴 블록 (값 래퍼 / leaf)

| type | 의미 | 예 |
|------|------|---|
| `number` | 숫자 리터럴 | `{"type":"number","params":["10"]}` |
| `text` | 문자열 리터럴 | `{"type":"text","params":["안녕"]}` |
| `angle` | 각도(0-360) | `{"type":"angle","params":["90"]}` |
| `color_hex` | HEX 색 | `{"type":"color_hex","params":["#ff0000"]}` |
| `True` / `False` | 참·거짓 | `{"type":"True","params":[]}` |
| `get_variable` | 변수값 꺼내기 (반환 블록) | `{"type":"get_variable","params":["<varId>",null]}` |
| `get_list` / `get_canvas_input_value` / `get_boolean_value` | 같은 패턴 |

리터럴은 **항상 블록 객체 형태**로 wrap. 순수 문자열/숫자로 두면 로드는 돼도 런타임 경고가 뜬다.

**중요**: 이 리터럴 블록들은 **leaf**다. `params` 안의 값은 이미 최종 리터럴 문자열 —
절대 재귀 정규화하면 안 됨. 재귀하면 `"0"`이 다시 `{type:"text",...}`로 감싸져서
`[object Object]`로 렌더됨 ([06-gotchas.md §리터럴 블록이 [object Object]로 표시됨](06-gotchas.md#리터럴-블록이-object-object로-표시됨)).
make-ent는 `PRIMITIVE_BLOCK_TYPES` 세트로 이 경계를 지킨다.

### 3. 중첩 블록

임의의 블록을 params에 또 끼워넣기. 예: `repeat_basic`의 횟수에 `calc_rand`:

```json
{ "type": "repeat_basic", "params": [
    { "type": "calc_rand", "params": [null, {"type":"number","params":["1"]}, null, {"type":"number","params":["10"]}, null] },
    null
] }
```

### 4. 필드 (Dropdown / DropdownDynamic) — **바로 문자열**

드롭다운/필드 타입의 파라미터는 **블록으로 감싸지 않고 맨 문자열**이 들어간다.

예: `see_angle_object`의 타겟 슬롯은 Dropdown으로 `"mouse"` 같은 id가 바로 들어감.
`set_variable`의 VARIABLE 슬롯도 변수 id를 바로 문자열로.

```json
{ "type": "see_angle_object", "params": ["mouse", null] }
{ "type": "set_variable",     "params": ["<varId>", {"type":"number","params":["1"]}, null] }
```

이 슬롯에 `{"type":"text","params":["mouse"]}`로 wrap하면 엔진이 "text 블록의 결과값"으로 취급해서
`"mouse"`라는 문자열이 드롭다운과 매칭 안 됨 → 런타임에 빨간 경고 블록.

### make-ent.mjs의 `wrapParam` 동작

spec에서 편하게 쓰도록 파라미터를 자동 래핑:

| spec 값 | 결과 |
|---------|------|
| `null` | `null` |
| `10` (number) | `{"type":"number","params":["10"]}` |
| `"안녕"` (string) | `{"type":"text","params":["안녕"]}` |
| `true` / `false` | `{"type":"True","params":[]}` / `{"type":"False","params":[]}` |
| `{ "type": "..." }` | 중첩 블록으로 재귀 처리 |
| **`{ "__field": "mouse" }`** | 바로 문자열 `"mouse"` (드롭다운/필드용 sentinel) |

구현: [`tools/make-ent.mjs:130-149`](../tools/make-ent.mjs#L130).

## 블록 type을 어디서 찾나

### 레지스트리

빌드 산출물 [`tools/block-registry.json`](../tools/block-registry.json) — entryjs
소스를 AST 파싱해 274개 블록의 `type`, `paramCount`, `statementCount`, `paramsKeyMap`을 담은 JSON.

재생성: `npm run build:registry`.

### 사용 예

```js
const reg = require('./tools/block-registry.json').blocks;
reg['repeat_basic']
// { file: 'block_flow.js', category: 'flow', paramCount: 2, statementCount: 1,
//   paramsKeyMap: { VALUE: 0 }, skeleton: 'basic_loop', class: 'repeat', ... }
```

### 카테고리별 파일 매핑

엔트리의 블록 정의는 [`entryjs/src/playground/blocks/block_*.js`](../../entryjs/src/playground/blocks)에 흩어져 있다.

| 카테고리 | 파일 | 대표 블록 |
|----------|------|-----------|
| 시작 | `block_start.js` | `when_run_button_click`, `when_some_key_pressed`, `when_message_cast` |
| 흐름 | `block_flow.js` | `repeat_basic`, `repeat_inf`, `wait_second`, `_if`, `if_else`, `stop_repeat` |
| 움직임 | `block_moving.js` | `move_direction`, `locate_xy`, `bounce_wall`, `see_angle_object`, `rotate_relative`, `direction_absolute` |
| 생김새 | `block_looks.js` | `dialog`, `change_to_next_shape`, `set_effect`, `set_scale` |
| 붓 | `block_brush.js` | `start_drawing`, `stop_drawing`, `brush_thick` |
| 소리 | `block_sound.js` | `sound_something_with_block`, `sound_something_wait_with_block` |
| 판단 | `block_judgement.js` | `boolean_and_or`, `boolean_basic_operator`, `is_press_some_key`, `reach_something` |
| 계산 | `block_calc.js` | `calc_basic`, `calc_rand`, `calc_operation`, `get_date` |
| 자료 | `block_variable.js` | `get_variable`, `set_variable`, `change_variable`, `add_value_to_list`, `value_of_index_from_list` |
| 함수 | `block_func.js` | `function_general`, `function_param_string` |
| 인공지능 | `block_ai_utilize_*.js` | 제외 권장 (`aiUtilizeDisable: true`) |
| 확장 | `block_expansion_*.js` | 서버 API 필요 — 제외 권장 |

## 자주 쓰는 블록 레퍼런스 (게임 제작)

블록 id ≡ `type`. `paramCount` 개수를 params 배열 길이와 반드시 맞춰야 함.

### 이벤트 (시작 블록)

| type | params | paramsKeyMap | 비고 |
|------|:------:|--------------|------|
| `when_run_button_click`    | 1 | — | 시작 ▶ 클릭 |
| `when_some_key_pressed`    | 2 | `VALUE=1` | VALUE=키 이름 (`"space"`, `"up"`, `"left"`, `"a"`, …). **필드 문자열** |
| `when_message_cast`        | 2 | `VALUE=1` | VALUE=신호 id (messages[*].id). **필드 문자열** |
| `mouse_clicked`            | 1 | — | 마우스 클릭 순간 |
| `when_object_click`        | 1 | — | 이 오브젝트 클릭 시 |
| `when_scene_start`         | 1 | — | 장면 시작 시 |

### 흐름

| type | params | statements | paramsKeyMap | 비고 |
|------|:------:|:----------:|--------------|------|
| `repeat_basic`      | 2 | 1 | `VALUE=0` | N번 반복 |
| `repeat_inf`        | 2 | 1 | — | 계속 반복 |
| `repeat_while_true` | 3 | 1 | `BOOL=0` | 조건 동안 반복 |
| `wait_second`       | 2 | 0 | `SECOND=0` | N초 대기 |
| `wait_until_true`   | 2 | 0 | `BOOL=0` | 조건 될 때까지 |
| `stop_repeat`       | 1 | 0 | — | 반복 끊기 |
| `_if`               | 2 | 1 | `BOOL=0` | 만일 ~이면 |
| `if_else`           | 3 | 2 | `BOOL=0` | 만일 ~이면…아니면 |

### 움직임

| type | params | paramsKeyMap | 비고 |
|------|:------:|--------------|------|
| `move_direction`    | 2 | `VALUE=0` | 방향으로 N만큼 이동 |
| `move_x`            | 2 | `VALUE=0` | x 좌표 N만큼 |
| `locate_xy`         | 3 | `VALUE1=0, VALUE2=1` | (x,y)로 이동 (순간) |
| `locate_xy_time`    | 4 | `VALUE1=0, VALUE2=1, VALUE3=2` | T초 동안 (x,y)로 이동 |
| `locate`            | 2 | `VALUE=0` | **필드**: `"mouse"` 또는 오브젝트 id |
| `bounce_wall`       | 1 | — | 벽에 닿으면 튕기기 |
| `rotate_relative`   | 2 | `VALUE=0` | 회전 (도) |
| `direction_relative`| 2 | `VALUE=0` | **이동 방향** 회전 (도) |
| `direction_absolute`| 2 | `VALUE=0` | 이동 방향을 절대값으로 |
| `see_angle_object`  | 2 | `VALUE=0` | **필드**: `"mouse"` 또는 오브젝트 id — 쪽 바라보기 |
| `move_to_angle`     | 3 | `ANGLE=0, VALUE=1` | 각도 θ로 N만큼 이동 |

### 판단 / 논리

| type | params | paramsKeyMap | 비고 |
|------|:------:|--------------|------|
| `boolean_and_or`         | 3 | `LEFTHAND=0, OPERATOR=1, RIGHTHAND=2` | OPERATOR 필드: `"AND"`/`"OR"` |
| `boolean_basic_operator` | 3 | 동상 | OPERATOR: `"EQUAL"`, `"GREATER"`, `"LESS"`, `"NOT_EQUAL"`, `"GREATER_OR_EQUAL"`, `"LESS_OR_EQUAL"` |
| `is_press_some_key`      | 2 | `VALUE=0` | 키 누름 감지. **필드**: 키 이름 |
| `reach_something`        | 2 | `VALUE=0` | **필드**: `"mouse"` / `"wall"` / `"wall_up"` / `"wall_down"` / 오브젝트 id |

### 생김새

| type | params | paramsKeyMap | 비고 |
|------|:------:|--------------|------|
| `dialog`                 | 3 | `VALUE=0, OPTION=1` | OPTION: `"speak"` / `"think"` |
| `dialog_time`            | 4 | `VALUE=0, SECOND=1, OPTION=2` | 일정 시간 말하기 |
| `change_to_next_shape`   | 2 | `DRIECTION=0` | **오탈자 주의**: 키 이름은 `DRIECTION`. 필드값 `"next"` / `"prev"` |
| `change_to_some_shape`   | 2 | `VALUE=0` | **필드**: pictures[*].id |
| `set_effect`             | 3 | `EFFECT=0, VALUE=1` | EFFECT: `"color"`/`"brightness"`/`"transparency"` |
| `set_scale_size`         | 2 | `VALUE=0` | 크기를 N%로 |
| `show` / `hide`          | 1 | — | 보이기/숨기기 |

### 자료 (변수 · 리스트)

| type | params | paramsKeyMap | 비고 |
|------|:------:|--------------|------|
| `get_variable`            | 2 | `VARIABLE=0` | 리턴 블록. **필드**: 변수 id |
| `set_variable`            | 3 | `VARIABLE=0, VALUE=1` | **필드**: 변수 id |
| `change_variable`         | 3 | 동상 | 증분 |
| `show_variable` / `hide_variable` | 2 | `VARIABLE=0` | 모니터 on/off |
| `add_value_to_list`       | 3 | `VALUE=0, LIST=1` | **필드**: 리스트 id |
| `remove_value_from_list`  | 3 | `VALUE=0, LIST=1` | |
| `value_of_index_from_list`| 5 | `LIST=1, INDEX=3` | 리스트 N번째 값 |
| `length_of_list`          | 3 | `LIST=1` | 리스트 길이 |
| `is_included_in_list`     | 4 | `LIST=1, VALUE=3` | 리스트에 값이 있는지 |

### 입력 / 문자열 조합

| type | params | paramsKeyMap | 비고 |
|------|:------:|--------------|------|
| `ask_and_wait` | 2 | `VALUE=0` | 사용자에게 질문 → 답변 대기. **사용 조건**: `variableType: 'answer'` 변수가 프로젝트에 선언돼야 함 (엔트리 기본 프로젝트엔 `대답` id=`1vu8`로 기본 존재). 답변은 `get_canvas_input_value` 블록 또는 `대답` 변수로 읽음 |
| `get_canvas_input_value` | 1 | — | 마지막 `ask_and_wait` 답변 반환. leaf 블록 (PRIMITIVE) |
| `combine_something` | 5 | `VALUE1=1, VALUE2=3` | 문자열 두 개 이어붙이기. **둘씩만** 묶으므로 3개 이상은 중첩: `combine(A, combine(B, C))` |

### 소리

| type | params | paramsKeyMap | 비고 |
|------|:------:|--------------|------|
| `sound_something_with_block`      | 2 | `VALUE=0` | 소리 재생, 기다리지 않음. **필드**: sounds[*].id |
| `sound_something_wait_with_block` | 2 | `VALUE=0` | 끝까지 재생 |
| `sound_something_second_with_block`| 3 | `VALUE=0, SECOND=1` | N초 재생 |
| `sound_volume_set`                 | 2 | `VALUE=0` | 볼륨 N% |

### 계산

| type | params | paramsKeyMap | 비고 |
|------|:------:|--------------|------|
| `calc_basic`      | 3 | `LEFTHAND=0, OPERATOR=1, RIGHTHAND=2` | `+` `-` `*` `/` |
| `calc_rand`       | 5 | `LEFTHAND=1, RIGHTHAND=3` | 랜덤 정수. 슬롯 0,2,4는 null |
| `calc_operation`  | 4 | `LEFTHAND=1, VALUE=3` | 제곱/루트/싸인 등 |
| `get_date`        | 2 | `VALUE=0` | 현재 연/월/일/시/분/초 |

## 검증 — 잘못된 블록 잡기

### smoke 테스트가 잡는 것

- 레지스트리에 없는 `type` — 유효하지 않은 블록 이름.
- 필수 primitive(`number`/`text`/…)는 화이트리스트.

### smoke가 못 잡는 것

- params 배열 길이가 `paramCount`와 다름 — **런타임 경고 블록**으로만 표시됨.
  TODO: 레지스트리의 paramCount와 길이 일치 체크를 smoke 테스트에 추가하면 좋음.
- 필드 슬롯에 블록을 넣거나, 블록 슬롯에 필드 문자열을 넣음.
- statements 길이가 `statementCount`와 다름.

수동 확인:
```js
const reg = require('./tools/block-registry.json').blocks;
const b = JSON.parse(obj.script)[0][0];  // thread 0, block 0
console.log(b.type, 'expected', reg[b.type].paramCount, 'got', b.params.length);
```
