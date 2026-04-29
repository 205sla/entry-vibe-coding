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
`[object Object]`로 렌더됨 (구조적으로 해결됨 — [lessons.md](lessons.md) 참조).
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

### 장면 전환

| type | params | paramsKeyMap | 비고 |
|------|:------:|--------------|------|
| `when_scene_start`     | 1 | — | 트리거: 현재 오브젝트가 속한 장면이 시작될 때. 장면 전환 → 재진입 시에도 매번 fire |
| `start_scene`          | 2 | `VALUE=0` | 지정 장면으로 전환. **필드**: 대상 scene id (`{"__field": "play"}`) |
| `start_neighbor_scene` | 2 | `OPERATOR=0` | next/previous 로 이동 |

#### 장면 간 상태 전달 패턴

장면이 바뀌어도 `variables` / `messages` 는 **전역** 으로 유지된다.
- 이전 장면 결과를 다음 장면에 넘기려면 전역 variable에 저장 (예: `final_time`, `final_score`)
- 장면 전환 시 초기화가 필요한 상태는 각 장면의 `when_scene_start` 스레드에서 명시적으로 set/reset
- 장면 전환 시 이전 장면 클론은 자동 정리되지 않음 → `remove_all_clones` 또는 재생성 시 해결

#### 3-장면 게임 플로우 예

`tests/fixtures/spec-bullethell.json`:
```
menu(시작화면)
  start_btn.when_object_click → set hp=3 → start_scene(play)

play(게임화면)
  player.when_scene_start:
    hp=3, locate(0,-80), project timer RESET + START
  player.when_scene_start (별 스레드): arrow-key 이동
  player.when_scene_start (별 스레드): hp ≤ 0 감시 → STOP timer + 저장 + start_scene(result)
  player.when_message_cast(hit): hp -= 1
  bullet.when_scene_start: remove_all_clones, 반복 create_clone
  bullet.when_clone_start: 플레이어 쪽 방향 + 이동 + reach_something → message_cast(hit) + delete_clone

result(결과화면)
  restart_btn.when_object_click → start_scene(menu)
```

### 복제본 (Clone) 패턴 — 같은 역할의 오브젝트가 반복될 때

같은 동작을 하는 오브젝트가 N 개 필요하면 **`create_clone` + `when_clone_start`** 가 정답. spec 에 N 개 오브젝트를 나열하는 대신 하나의 **template 오브젝트**가 N 번 복제본을 만들고, 모든 동작은 template 의 스크립트 한 벌만 작성. 메인 게임의 적·발사체·HUD 격자 등에 표준.

#### 패턴 골자

```js
{
    id: 'brick_template', name: '벽돌',
    objectType: 'sprite',
    pictures: [/* 다중 모양 — 클론별 다른 색을 위해 */],
    entity: { ..., visible: false },   // 템플릿 자체는 숨김
    script: [
        // 1) 스폰 — when_run 한 번
        [
            when.run(),
            hide(),
            // 행 0 빨강
            changeShape('pic_r'),
            locateXY(-150, 120), createClone('self'),
            locateXY( -90, 120), createClone('self'),
            // ... 6 cols × 3 rows = 18 클론
        ],
        // 2) 클론별 동작 — when_clone_start 가 클론마다 한 번
        [
            when.cloneStart(),
            show(),
            repeat.inf([
                if_(reach('ball'), [
                    changeVar('score', 10),
                    sendMessage('ball_bounce'),
                    deleteClone(),     // 자기 자신 제거
                ]),
            ]),
        ],
    ],
}
```

#### 핵심 메커니즘

| 단계 | 메모 |
|---|---|
| **클론 생성 시점 스냅샷** | 클론은 createClone 호출 순간의 template 상태 (`x`, `y`, `selectedPictureId`, scale, direction, visible 등) 를 받음. 이후 template 이 바뀌어도 클론에 영향 없음. |
| **`when_run` vs `when_clone_start`** | `when_run` 은 template 에서만 발화 (클론은 스킵). `when_clone_start` 는 클론에서만 발화 (template 은 스킵). 자동 분기. |
| **`deleteClone()`** | 자기 자신만 제거. 메모리·렌더 자동 해제. 부모는 살아있음. |
| **`removeAllClones()`** | 모든 클론 일괄 제거. 장면 재시작 / 게임 리셋에 유용. |
| **여러 모양** | 클론마다 다른 색을 원하면 template 의 `pictures: []` 에 N 종 등록 + 스폰 루프에서 `changeShape(pictureId)` 로 토글한 직후 `createClone()` 호출. 각 클론이 자기만의 picture 를 들고 감. |

#### 클론 갯수 확인 (헤드리스 검증)

```js
const cloneCount = await page.evaluate(() => {
    const t = Entry.container.getAllObjects().find(o => o.id === 'brick_template');
    return t.clonedEntities ? t.clonedEntities.length : 0;
});
```

`Entry.container.getAllObjects()` 는 **template 만** 반환. 클론은 `template.clonedEntities[]` 배열로만 접근 가능. 검증 시 주의.

#### 사용 예

- [`tests/fixtures/spec-bounce-ball.mjs`](../tests/fixtures/spec-bounce-ball.mjs) — `brick_template` 1 개가 18 벽돌 클론. 행별 picture 토글로 빨강/주황/초록 색.
- [`tests/fixtures/spec-bullethell.json`](../tests/fixtures/spec-bullethell.json) — 발사체 클론 (반복 spawn).
- [`tests/fixtures/spec-fruit-hunt.mjs`](../tests/fixtures/spec-fruit-hunt.mjs) — 9 클론 grid + 좌표 비교로 클릭 클론의 정체 판정.

#### 함정: `deleteClone()` 후 같은 스크립트 후속 블록 안 실행

deleteClone 호출 후 그 스크립트의 뒤에 오는 블록은 **실행되지 않음** (클론 컨텍스트 소멸). 정답 처리에서 흔히 마주치는 패턴:

```js
// ❌ 깨짐 — sendMessage 가 deleteClone 뒤에 와서 발화 안 됨
if_(isTarget, [
    deleteClone(),
    if_(stageCleared, [ sendMessage('new_stage') ]),  // 이 줄은 절대 실행 안 됨
])
```

```js
// ✅ if_else 로 분기
if_(isTarget, [
    if_(stageCleared,
        [ sendMessage('new_stage') ],   // template 의 핸들러가 removeAllClones 함
        [ deleteClone() ],              // 부분 클리어 — 자기만 제거
    ),
])
```

증거: 회귀 가드 [`tools/verify-fruit-hunt.mjs`](../tools/verify-fruit-hunt.mjs) Step 3 — 두 번째 정답 클릭 후 레벨 증가 + 9 클론 재생성.

#### 클론 정체 판정 — 클론 좌표 = 고유 id 대용

클론은 글로벌 변수만 공유 — "이 클론이 정답인가?" 같은 판정에 클론별 식별자가 필요. Entry 에는 클론별 로컬 변수가 없고, `selectedPicture.id` 도 직접 못 읽음. 대안:

- **클론의 (x, y) 좌표를 정답 위치와 비교** — N 슬롯 그리드면 좌표 N 개가 모두 고유함.
- 클릭 핸들러에서 `coord('self', 'x')` / `coord('self', 'y')` 로 자기 좌표 읽고 `valueAt('grid_x', target_pos)` 와 비교.

```js
// 클론 클릭 핸들러
when.objectClick(),
setVar('is_target', 0),
if_(cmp(coord('self', 'x'), '==', valueAt('grid_x', target_pos1+1)), [
    if_(cmp(coord('self', 'y'), '==', valueAt('grid_y', target_pos1+1)), [
        setVar('is_target', 1),
    ]),
]),
// pos2 도 같은 방식
if_(cmp(getVar('is_target'), '==', 1), [/* 정답 처리 */])
```

증거: [`spec-fruit-hunt.mjs`](../tests/fixtures/spec-fruit-hunt.mjs) — 9 슬롯 클릭 판정.

#### 클론 정체 판정 — `direction` 속성을 id 저장소로 (좌표 불가능 시)

클론들이 **같은 출발 좌표에서 시작해 같은 경로를 따라 움직이는** 시나리오 (TD 적·총알·이펙트) 는 좌표를 id 로 못 씀. 대안: 엔티티의 `direction` 속성을 클론별 id 캐시로 사용.

원리: `entity.direction` 은 per-entity 속성 (각 클론마다 별도 저장). `turnAbs(N)` 으로 임의 값 set, `coord('self', 'direction')` 로 read. 원형 sprite 면 시각 회전이 무시되어 부작용 없음.

```js
// manager (또는 spawner):
repeat.basic(WAVE_TOTAL, [
    changeVar('next_id', 1),       // 1, 2, 3, ...
    createClone('enemy'),          // 클론은 createClone 시점의 next_id 를 자기 direction 으로
    wait(SPAWN_INTERVAL),
])

// enemy template (클론):
when.cloneStart(),
turnAbs(getVar('next_id')),   // ← 첫 블록. direction = 내 id (next_id 가 다음 spawn 에서 바뀌기 전).
// 이후 coord('self', 'direction') 으로 내 id 회수 가능
setListAt('enemy_active', getVar('next_id'), 1),
setListAt('enemy_hp',     getVar('next_id'), ENEMY_HP),
repeat.inf([
    moveX(SPEED),
    setListAt('enemy_x', coord('self', 'direction'), coord('self', 'x')),  // 내 슬롯에 위치 broadcast
    if_(cmp(valueAt('enemy_hp', coord('self', 'direction')), '<=', 0), [
        setListAt('enemy_active', coord('self', 'direction'), 0),
        deleteClone(),
    ]),
    wait(0.02),
])
```

**중요**: `turnAbs(getVar('next_id'))` 는 클론 시작 첫 블록이어야 함 — 다음 spawn 이 next_id 를 덮어쓰기 전에 캡처해야 함. 그리고 `when_clone_start` 가 한 클론에 여러 개면 병렬 실행되어 race — 단일 스크립트로 통합 권장 (07-runtime-quirks 참조).

**시각 영향 회피**: `direction` 은 `이동방향` 속성으로 sprite 회전에 영향. 원형 모양 (ball/coin 등) 은 시각 영향 없음. 비원형이면 `entity.rotateMethod: 'none'` 또는 `direction` 대신 다른 numeric 속성 활용.

**리스트 슬롯 매핑 패턴**: id N → list[N]. spec 의 lists 를 `Array(MAX_N).fill('0')` 로 미리 채워두고 `setListAt(listId, id, value)` 로 직접 쓰기 (DSL: `change_value_list_index`).

증거: [`spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs) — 5 적 클론, direction 1..5 = id, lists 인덱스 1..5 슬롯 매핑.

#### 클론 자기 복제 방지 — manager 가 `createClone(other_id)` 호출

`when_message('spawn')` → `createClone('self')` 패턴은 함정이 있음: **기존 클론도 같은 `when_message` 핸들러를 들고 있어** 메시지 발화 시 자기 자신도 복제. 결과: spawn 1 회 의도가 N+1 클론 생성 (N = 기존 클론 수).

회피: spawner (manager 등 별도 오브젝트) 가 직접 `createClone('enemy')` 로 적 오브젝트의 클론 생성. `create_clone` 블록의 target dropdown 은 `'self'` 외에도 다른 sprite id 허용 (registry: `clone` menu = spritesWithSelf).

```js
// ❌ 깨짐 — message 패턴
// manager: sendMessage('spawn')
// enemy template + 모든 기존 클론: when.message('spawn'), createClone('self')
// → 첫 spawn 후 N=1, 다음 spawn 시 (template + 기존 1 클론) × createClone = 2 신규 = 총 3.

// ✅ 직접 호출
// manager:
repeat.basic(WAVE_TOTAL, [
    changeVar('next_id', 1),
    createClone('enemy'),   // 클론은 createClone 트리거 없음 → 자기 복제 불가
    wait(SPAWN_INTERVAL),
])
// enemy template: when_message 핸들러 자체 없음
```

증거: [`spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs) — manager 가 `createClone('enemy')` 직접 호출. 회귀 가드 [`verify-frontier-guard.mjs`](../tools/verify-frontier-guard.mjs) Step 1 의 `cloneCount == next_id` (다중 spawn 0).

#### 클론 타입 분기 — `enemy_type_list[id]` + 데이터 주도 stat 룩업

여러 종류의 적 (스웜·탱커·비행…) 을 단일 template + N 클론으로 처리하려면, 각 클론마다 자기 타입을 알아야 함. 패턴:

1. **글로벌 `current_type` 변수** — manager 가 spawn 직전 타입 set
2. **클론 시작 첫 블록**들에서 `enemy_type_list[my_id] = current_type` 으로 슬롯에 저장
3. **타입별 stat 은 별도 lists** (`type_hp[type]`, `type_size[type]`, `type_speed[type]`) 로 룩업

```js
// 데이터 주도 stat — 인덱스 1=swarm, 2=tank
const TYPE_HP   = [25, 75];
const TYPE_SIZE = [35, 55];

lists: [
    { id: 'enemy_type', name: 'type', visible: false, array: Array(MAX).fill('0') },
    { id: 'type_hp',    name: 'thp',  visible: false, array: TYPE_HP.map(String) },
    { id: 'type_size',  name: 'tsz',  visible: false, array: TYPE_SIZE.map(String) },
],

// manager spawn:
setVar('current_type', valueAt('wave_types', getVar('spawn_idx'))),  // 1 or 2
createClone('enemy'),

// enemy clone start:
turnAbs(getVar('next_id')),                              // id 캡처
setListAt('enemy_type', getVar('next_id'), getVar('current_type')),
changeShape(getVar('current_type')),                     // 1=pic_swarm, 2=pic_tank (index fallback)
setListAt('enemy_hp', getVar('next_id'), valueAt('type_hp', getVar('current_type'))),
setSize(valueAt('type_size', getVar('current_type'))),
// forever:
//   타입별 속도 — coord('self','direction') = my id, enemy_type[id] 로 분기
if_(cmp(valueAt('enemy_type', coord('self', 'direction')), '==', 2),
    [ moveX(SPEED_TANK) ],
    [ moveX(SPEED_SWARM) ],
)
```

**핵심 트릭**: `changeShape(getVar('current_type'))` 는 `change_to_some_shape` 의 id → name → index 폴백을 활용 — 숫자 1, 2 가 picture id/name 에 없으면 index 1, 2 로 매칭됨 (07-runtime-quirks). 별도 picture id 룩업 list 불필요.

**확장**: 새 타입 추가는 (a) `pictures` 에 새 모양 추가 (b) `TYPE_HP` / `TYPE_SIZE` / `TYPE_SPEED` 끝에 값 추가 — 클론 코드 변경 없음.

증거: [`spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs) Phase 2 — swarm (type 1) + tank (type 2). 회귀 가드 [`verify-frontier-guard.mjs`](../tools/verify-frontier-guard.mjs) Step 6 — tank 의 picId/scale/hp 검증.

#### 데미지 플래시 — `enemy_last_hp` 리스트로 hp drop 감지 + setEffect 펄스

적이 공격받았다는 시각 피드백 (잠깐 밝아짐) 은 **per-clone 직전 hp 추적** 으로 구현. forever 루프에서 매 tick: `current_hp < last_hp` 면 hit 됐다 → brightness 펄스.

```js
lists: [
    // ... enemy_active, enemy_hp, enemy_x, enemy_y, enemy_type ...
    { id: 'enemy_last_hp', name: 'lhp', visible: false, array: Array(MAX).fill('0') },
],

// clone start (init):
turnAbs(getVar('next_id')),
setListAt('enemy_hp',      getVar('next_id'), valueAt('type_hp', getVar('current_type'))),
setListAt('enemy_last_hp', getVar('next_id'), valueAt('type_hp', getVar('current_type'))),  // 동일 init
setEffect('brightness', 0),  // 이전 게임 잔재 회피

// forever:
repeat.inf([
    moveX(SPEED),
    setListAt('enemy_x', coord('self', 'direction'), coord('self', 'x')),
    // 데미지 감지 — current < last 면 hit
    if_(cmp(valueAt('enemy_hp', coord('self', 'direction')), '<',
            valueAt('enemy_last_hp', coord('self', 'direction'))), [
        setEffect('brightness', 60),    // 펄스 ON
        wait(0.08),                      // 4 frame 스태거 효과
        setEffect('brightness', 0),      // 펄스 OFF
    ]),
    // last_hp 갱신 — 다음 비교 기준
    setListAt('enemy_last_hp', coord('self', 'direction'),
              valueAt('enemy_hp', coord('self', 'direction'))),
    // 처치 / 도달 체크 ...
    wait(0.02),
])
```

**부수 효과 (긍정적)**: `wait(0.08)` 이 forever 루프를 잠깐 멈춤 → 적이 hit 시 0.08 초 멈칫. "스태거" 게임 피드 효과 — 실제로 부드러움보다 인상에 더 좋음.

**다중 hit 누적 안전**: `setEffect` 는 absolute (= `change_effect_amount`). `addEffect` 와 달리 누적 안 됨. 동시 다중 데미지 (cannon splash + archer 같은 tick) 도 한 번의 펄스로 끝.

**검증 가능**: brightness 60 펄스가 0.08s 동안 유지 → playwright 로 10ms 간격 폴링으로 충분히 catch. `entity.effect.brightness` (또는 `_effect`) 로 read.

증거: [`spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs) Phase 2.1 enemy template forever. 회귀 가드 [`verify-frontier-guard.mjs`](../tools/verify-frontier-guard.mjs) Step 8 — hp 강제 drop 후 brightness > 30 catch + last_hp 가 hp 와 sync 검증.

#### 공격 빔 시각화 — manager 단일 sprite 의 brush 로 source→target 라인

타워가 적을 공격하는 순간을 시각화하려면 **manager 의 brush 가 (tower_x, tower_y) → (target_x, target_y) 라인을 매 cooldown 마다 erase + redraw**. 별도 projectile sprite/clone 없이도 명확한 attack 피드백.

원리:
- 단일 sprite (manager) 가 brush 보유 — visible:false 라도 brush 는 sprite 위치 추적해 그림.
- 매 cooldown cycle 시작 시 `eraseAll()` → 이전 라인 지움 → 각 타워 fire 마다 `setColor`/`setThickness` → `locateXY(tower)` → `startDraw` → `locateXY(target)` → `stopDraw`.
- 라인은 cooldown 만큼 (예: 0.5 초) 보임 → 다음 cycle 에서 erase + 새 라인.

```js
const drawBeam = (txExpr, tyExpr, color, thickness) => [
    setColor(color),
    setThickness(thickness),
    locateXY(txExpr, tyExpr),       // 타워 위치 (no draw)
    startDraw(),                     // 펜 down
    locateXY(getVar('target_x'), getVar('target_y')),  // 적 위치 (line 그어짐)
    stopDraw(),                      // 펜 up
];

const archerTick = (tx, ty, dmg) => [
    ...findNearestEnemy(tx, ty, ARCHER_RANGE_SQ),
    if_(cmp(getVar('target_id'), '>', 0), [
        setVar('target_x', valueAt('enemy_x', getVar('target_id'))),
        setVar('target_y', valueAt('enemy_y', getVar('target_id'))),
        ...drawBeam(tx, ty, '#fbbf24', 2),  // 노란 빔
        // 데미지 적용
        setListAt('enemy_hp', getVar('target_id'),
            calc(valueAt('enemy_hp', getVar('target_id')), '-', dmg)),
    ]),
];

// manager 타겟팅 루프
[
    when.sceneStart(),
    setThickness(2), setColor('#fbbf24'),
    repeat.inf([
        if_(cmp(getVar('game_state'), '==', 0), [
            if_(cmp(getVar('prep_done'), '==', 1), [
                eraseAll(),     // ← cycle 시작 시 erase
                ... 슬롯 순회: archerTick / cannonTick ...
            ]),
        ]),
        wait(TOWER_COOLDOWN),
    ]),
],
// 게임 종료 시 잔여 빔 정리
[ when.message('win'),  eraseAll() ],
[ when.message('lose'), eraseAll() ],
```

**색상 + 굵기로 타워 종류 구분**:
- Archer: `#fbbf24` (노란), thickness 2
- Cannon: `#f97316` (주황), thickness 3
- 한 cycle 안에서 여러 빔이 다른 색 — `setColor` 가 각 tick 마다 재설정하면 OK.

**검증 가능**: `findColoredPixels(page, '#fbbf24')` / `#f97316` 으로 픽셀 카운트. 활성 적 + 활성 타워 있을 때 cooldown 안에서 픽셀 발견. 짧은 폴링 (200ms × 6) 으로 한 cycle 안 catch.

**대안 (미구현)**:
- Projectile clone: 화살/포탄 sprite 가 tower → target 으로 비행 (더 게임답지만 클론 관리 복잡).
- Tower flash: setEffect brightness 펄스 (간단하지만 attack 방향성 안 보임).
- 본 패턴은 brush 단일 sprite 라 가장 적은 오브젝트로 모든 타워의 공격을 표현.

증거: [`spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs) Phase 3 manager 의 4번째 thread (타워 타겟팅) — cooldown 0.5s 마다 erase + 슬롯 별 빔. 회귀 가드 [`verify-frontier-guard.mjs`](../tools/verify-frontier-guard.mjs) Step 8b — `findColoredPixels` 로 노란/주황 빔 픽셀 모두 검출.

#### 데이터 주도 다중 웨이브 — `wave_counts` + `wave_types` flat 리스트

3 웨이브 + 다양한 적 조합을 manager 코드 안 hard-code 하지 않고 **두 개 리스트** 로 표현:

```js
const WAVE_COUNTS = [3, 3, 4];            // 각 웨이브 적 수
const WAVE_TYPES = [
    1, 1, 1,             // wave 1: 3 swarm
    1, 1, 2,             // wave 2: 2 swarm + 1 tank
    1, 1, 1, 2,          // wave 3: 3 swarm + 1 tank
];
const TOTAL_ENEMIES = WAVE_COUNTS.reduce((a, b) => a + b, 0);
```

manager 의 nested `repeat.basic` 으로 순회:

```js
when.run(),
setVar('wave_idx', 0),
setVar('spawn_idx', 0),
wait(2),
repeat.basic(WAVE_COUNTS.length, [
    changeVar('wave_idx', 1),  // 1, 2, 3
    repeat.basic(valueAt('wave_counts', getVar('wave_idx')), [
        changeVar('next_id', 1),
        changeVar('spawn_idx', 1),
        setVar('current_type', valueAt('wave_types', getVar('spawn_idx'))),
        createClone('enemy'),
        wait(SPAWN_INTERVAL),
    ]),
    wait(WAVE_BREAK),
])
```

`spawn_idx` 는 1-base 누적 카운터 — `wave_types[spawn_idx]` 로 다음 적 타입 read. wave 별로 reset 안 함, 끝까지 증가.

**HUD 갱신**: wave_idx 가 visible variable 이면 자동 표시. 또는 textBox 가 forever loop 으로 `wave_idx` 변화 감지 후 writeText (knowledge: race 회피 위해 last_shown 변수로 변화 시에만 write).

증거: [`spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs) Phase 2 — 3 웨이브, hud_status 가 `hud_last_wave` 변화 감지로 flicker 회피. [`verify-frontier-guard.mjs`](../tools/verify-frontier-guard.mjs) Step 5/8 — wave 진행 + type 리스트 wave_types 일치 가드.

#### Splash AOE — 타겟 좌표 중심 반경 내 모든 활성 적

단일 타겟 발견 후 그 좌표를 중심으로 splash radius 내 모든 활성 적에 데미지 (Cannon 등 광역 무기). 두 단계:

1. `findNearestEnemy(tx, ty, RANGE_SQ)` — 가장 가까운 active 적 → `target_id` 설정
2. 발견 시: target 의 좌표를 임시 변수에 캡처 → 활성 슬롯 다시 순회 → splash radius 안 모두에 dmg

```js
const cannonTick = (tx, ty) => [
    ...findNearestEnemy(tx, ty, CANNON_RANGE_SQ),
    if_(cmp(getVar('target_id'), '>', 0), [
        setVar('target_x', valueAt('enemy_x', getVar('target_id'))),
        setVar('target_y', valueAt('enemy_y', getVar('target_id'))),
        setVar('i', 0),
        repeat.basic(MAX_ENEMIES, [
            changeVar('i', 1),
            if_(cmp(valueAt('enemy_active', getVar('i')), '==', 1), [
                setVar('dx', calc(valueAt('enemy_x', getVar('i')), '-', getVar('target_x'))),
                setVar('dy', calc(valueAt('enemy_y', getVar('i')), '-', getVar('target_y'))),
                setVar('dist_sq', calc(
                    calc(getVar('dx'), '*', getVar('dx')),
                    '+',
                    calc(getVar('dy'), '*', getVar('dy')),
                )),
                if_(cmp(getVar('dist_sq'), '<', SPLASH_RADIUS_SQ), [
                    setListAt('enemy_hp', getVar('i'),
                        calc(valueAt('enemy_hp', getVar('i')), '-', CANNON_DAMAGE)),
                ]),
            ]),
        ]),
    ]),
];
```

**최적화**: `findNearestEnemy` 의 `best_dist` 초기값을 `range_sq` 로 두면 사거리 필터를 inline (사거리 밖이면 best_dist 갱신 안 됨 → target_id=0). 별도 if 추가 불필요.

**증거 검증의 어려움**: splash 의 다중 hit 을 헤드리스에서 분리 측정하기 어려움 — Entry 의 forever 루프가 매 틱 `enemy_x` 를 덮어써서 `c.x` JS 직접 변경이 즉시 무효화. 차선책: 구조 검증 (cannon 오브젝트 존재 + picture id) + 활동 검증 (5 cd 안 hp drop 발생). [`verify-frontier-guard.mjs`](../tools/verify-frontier-guard.mjs) Step 7 패턴 참조.

### 버튼 구현 — textBox 가 sprite + dialog 보다 깔끔

장면 메뉴/시작/재시작 버튼처럼 "텍스트가 있는 클릭 가능 영역"은 **textBox 오브젝트**가 sprite + `dialog("말하기")` 패턴보다 깔끔. 이유:

- sprite + dialog: 그림 자산이 따로 필요 + dialog 말풍선의 꼬리/모양이 버튼 디자인을 침해
- textBox: `text` 필드 한 줄로 라벨 지정 + `entity.font` 로 폰트/크기 + `bgColor` 로 배경 — 자산 0 개

### 단, 배경색은 hex 필수 (`bgColor: '#...'`)

textBox 의 `bgColor` 가 `'transparent'` 또는 빈값이면 **사각 영역의 빈 공간 클릭 무반응 — glyph(글자) 알파 픽셀만 hit**. 이론상 글자 위는 클릭되지만 stroke 정밀도가 필요해 버튼 UX 로 부적합.

원인: `bgObject.alpha=0` (배경 사각 비활성) + `textObject.pixelPerfect=true` (글자 알파>1 픽셀만 hit). 자세한 메커니즘 + 실측: [`07-runtime-quirks.md` textBox 클릭 영역](07-runtime-quirks.md#textbox-클릭-영역--bgcolor-에-따라-사각-전체-vs-glyph-픽셀만).

### 패턴

```js
obj('start_btn', '시작', {
    objectType: 'textBox',
    text: '시작하기',
    entity: {
        x: 0, y: -60,
        regX: 0, regY: 0,
        scaleX: 1, scaleY: 1,
        width: 160, height: 50,
        font: '24px NanumGothic',
        bgColor: '#3b82f6',     // ← hex 필수. scene 배경과 같은 hex 면 시각적으로 투명.
        colour: '#ffffff',
        visible: true,
    },
    script: [
        when.objectClick(),
        startScene('play'),
    ],
}),
```

### 정말 투명이 필요할 때

같은 좌표에 빈 sprite (투명 PNG) 를 두 번째 오브젝트로 깔고 `when_object_click` 을 sprite 에 붙이기. 글자는 textBox, hit-test 는 sprite — 두 오브젝트 분업.

### 주의: `dialog` + 숫자 값

`dialog(text, '말하기')`의 text 슬롯에 **숫자를 반환하는 블록**(`get_variable` on numeric, `calc_basic` 결과 등)을 넣거나, `combine_something` 으로 합성해 숫자를 포함시키면:
```
Runtime Error: (this._text || "").replace is not a function
```
crash 발생 (Entry dialog의 `_text.replace(...)` 호출에서 number는 `.replace` 없음).

**회피**:
- 정적 문자열만 `dialog` 로 전달 (예: `"게임 오버!"`)
- 숫자/동적 값은 `show_variable(var_id)` 로 무대에 상시 표시
- 꼭 합성 텍스트를 말풍선으로 보여야 한다면 변수에 `combine_something("생존: ", var + "초")` 를 set_variable 로 저장한 뒤, 그 변수를 `get_variable` 로 전달 (이 과정에서 변수 value는 문자열로 저장됨)

### 붓 (brush)

sprite에 `createjs.Shape`로 연결된 별도 그래픽 레이어. **sprite를 `hide`해도 붓은 계속 렌더링**된다 — 그리는 주체(=스프라이트)를 숨기고 선만 남기는 패턴이 가능.

| type | params | 비고 |
|------|:------:|------|
| `start_drawing` / `stop_drawing` | 1 | 이후 sprite 이동 시 선 추가/안 함. 없던 브러쉬는 `Entry.setBasicBrush(sprite)`로 자동 생성 |
| `set_color`               | 2 | 첫 파라미터: `color` 프리미티브 (`{"type":"color","params":["#00c853"]}`) 또는 hex 문자열 |
| `set_thickness`           | 2 | 굵기 (픽셀). 숫자 리터럴 OK |
| `brush_erase_all`         | 1 | 전체 지우기 (모든 선 제거) |
| `start_fill` / `stop_fill` / `set_fill_color` | 1/1/2 | 폐곡선 채우기용 |
| `brush_stamp`             | 1 | 현재 sprite 이미지를 도장 찍듯 캔버스에 고정 |

**그리기 원리**: `start_drawing` 시점에 `brush.moveTo(sprite.x, -sprite.y)`. 이후 `locate_xy` / `move_direction` 등으로 sprite가 움직이면 `brush.lineTo`가 호출되어 선이 이어짐. `stop_drawing` 호출 전까지 계속 누적.

**매 프레임 다시 그리기 패턴** (체력바, HUD 등):
```
repeat_inf {
    stop_drawing        // 이전 세그먼트 마감
    brush_erase_all     // 전체 지우기
    locate_xy(x0, y)    // 시작점 이동 (안 그림)
    set_color(green)
    start_drawing
    locate_xy(x0 + hp*k, y)   // 굵은 선 = 막대
    stop_drawing
    set_color(red)
    start_drawing
    locate_xy(x_end, y)
    stop_drawing
}
```

빈 반복 1회 = 1 프레임(1/60s) 딜레이 → 60fps 갱신. `wait_second`는 넣지 말 것 ([07-runtime-quirks.md §반복하기 블록](07-runtime-quirks.md#반복하기-블록--1-프레임반복-60fps-암묵-틱) 참고).

**증거 파일**: [`tests/fixtures/spec-healthbar-brush.json`](../tests/fixtures/spec-healthbar-brush.json) + [`tools/verify-healthbar-brush.mjs`](../tools/verify-healthbar-brush.mjs) (hp 100/50/10/0 스크린샷 + 픽셀 단조성 검증)

#### 시간제 게임의 붓 타이머 (목표 색 + 경고 깜빡임)

게임 화면 상단의 시간 표시 막대를 붓으로 매 프레임 redraw — 시간이 지남에 따라 막대가 짧아짐. 부수 효과로 색상·굵기·흔들림 같은 시각적 단서를 같은 sprite 에 합칠 수 있음.

```js
// 타이머 sprite — 별 모양 머리 + 매 프레임 redraw
[
    when.run(),
    setThickness(8),
    repeat.inf([
        eraseAll(),
        // 시간이 5 초 미만이면 빨강 경고 + y 살짝 흔들기
        if_(cmp(getVar('time_left'), '<', 5), [
            setColor('#dc2626'),
            locateXY(LEFT_X, calc(BAR_Y, '+', rand(-3, 3))),  // shake
        ]),
        if_(cmp(getVar('time_left'), '>=', 5), [
            // target 별 색 — 분기 또는 list 룩업
            if_(cmp(getVar('target_idx'), '==', 1), [setColor('#dc2626')]),
            if_(cmp(getVar('target_idx'), '==', 2), [setColor('#facc15')]),
            // ...
            locateXY(LEFT_X, BAR_Y),
        ]),
        startDraw(),
        // 시간 비례로 막대 끝 좌표 계산
        locateXY(calc(LEFT_X, '+', calc(getVar('time_left'), '*', SPEED)), BAR_Y),
        stopDraw(),
    ]),
],
```

별도 스레드: `time_left` 를 `MAX_TIME - timer.value() - penalty_total` 로 매 프레임 갱신 (`projectTimer` 는 누적, `penalty_total` 은 오답 패널티 누적).

증거: [`tests/fixtures/spec-fruit-hunt.mjs`](../tests/fixtures/spec-fruit-hunt.mjs) + [`tools/verify-fruit-hunt.mjs`](../tools/verify-fruit-hunt.mjs).

## 플랫포머 발판 충돌 패턴 (`reach_something` 기반)

Entry는 "어느 면에서 닿았는지" 정보 없이 `reach_something(block)`이 boolean만 반환.
그래서 "위에서 착지했을 때만 발판 위에 올라서기"를 직접 코드로 결정해야 한다.

### 매 프레임 순서

1. 중력: `vy -= 0.6`, `move_y(vy)`
2. 각 발판마다:
    ```
    _if (reach(발판) AND vy ≤ 0 AND landed == 0):
        set y = landing_y(발판)     ← 미리 계산한 상수
        set vy = 0
        set on_ground = 1
        set landed = 1              ← per-tick flag
    ```
3. 아무 발판도 안 닿았으면 바닥 fallback (예: y=-40) 또는 공중 유지
4. 다음 tick 시작에서 `landed = 0` 으로 리셋

### 핵심 아이디어

- **`vy ≤ 0` 가드**: 위로 점프 중이면 snap 안 함 → 발판 아래서 부딪혀도 관통해 올라감 (Super Mario 식)
- **`landed` per-tick flag**: 여러 발판이 겹칠 때 하나만 snap 처리 (단락 평가 없는 Entry 환경에서 필수)
- **landing_y 상수**: 각 발판마다 미리 계산해 하드코딩
- `boolean_and_or`는 단락 평가 없지만 ([07-runtime-quirks.md](07-runtime-quirks.md#boolean_and_or에-단락-평가short-circuit-없음)), `reach_something`/`vy`/`landed` 읽기는 부작용 없어 AND 사용 안전

### landing_y 공식

원본 이미지에 scale 적용된 스프라이트:
- 블록 상단 = `block.y + (block_h × block_scale) / 2`
- 플레이어 바닥 = `player.y - (player_h × player_scale) / 2`
- 착지 조건: `player_bottom == block_top`
    → `player_landing_y = block.y + (block_h × block_scale + player_h × player_scale) / 2`

예: 블록 100×100 scale 0.5 (half=25), 플레이어 200×240 scale 0.4 (half=48)
→ `player_landing_y = block.y + 73`

### 시차 스크롤과 결합

플레이어 x 고정 사이드스크롤러에서 `reach_something`은 **스크린 좌표 기준** 체크.
월드 offset으로 발판이 스크롤되어 플레이어 아래로 올 때 자동으로 충돌 감지 동작.
발판 아래 통과 → offset 계속 이동 → 발판이 플레이어 밖으로 → `reach=false` →
중력이 다음 발판 또는 바닥으로 낙하시킴.

### 참고 구현

[`tests/fixtures/spec-platformer.json`](../tests/fixtures/spec-platformer.json) — 3 발판
(y=-25/5/35), ground fallback y=-40. [`tools/verify-platformer.mjs`](../tools/verify-platformer.mjs) —
각 발판별 착지 y 자동 검증 (4/4 통과).

## 원-원 거리 기반 충돌 (`reach_something` 대체)

`reach_something` 은 Entry 내장 충돌이지만 **bounding-box 기반** — 원형 객체에는 부정확.
원형 캐릭터끼리 정확한 충돌을 원하면 두 중심 간 거리가 반지름 합보다 작은지 검사:

> `(x1-x2)² + (y1-y2)² < (r1+r2)²`

양변 제곱이라 `sqrt` 없이 산술만으로 비교 가능.

### 패턴 — 사용자 정의 value 함수로 거리² 계산

```
함수 dsq(x1, y1, x2, y2):    ← type: value
    body:
        dx = x1 - x2
        dy = y1 - y2
        ret = dx*dx + dy*dy
    return: ret

적 클론의 매 프레임 루프:
    if dsq(player_cx, player_cy, self.x, self.y) < (pr+er)²:
        충돌!
```

`dx`/`dy`/`ret` 는 전역 변수로 두고 함수 안에서 임시값 저장.
**함수는 동기 실행이라 동일 tick 내에서 변수 충돌 없음** — 다음 호출이 시작되기 전 현재
호출의 set/get/return 이 모두 끝남.

### 임계값 = 반지름 합의 제곱

붓 + 꼬리재귀로 원을 그리는 경우 (`drawstep(n, len, turn)`) 실제 반지름:

> r = len / (2 × sin(turn/2))

예: `drawstep(36, 2.5, -10)` → r = 2.5 / (2×sin(5°)) ≈ 14.3
`drawstep(24, 2.0, -15)` → r = 2.0 / (2×sin(7.5°)) ≈ 7.7

플레이어 r=14.3, 적 r=7.7 → 임계값 ≈ (14.3+7.7)² = 484. 약간 여유롭게 500 사용.

### 참고 구현

[`tests/fixtures/spec-bullet-circle.mjs`](../tests/fixtures/spec-bullet-circle.mjs) — 플레이어
파란 원 + 적 빨간 원 클론, 거리² 충돌, 충돌 시 message_cast('hit') → 결과 장면 전환.
[`tools/verify-bullet-circle.mjs`](../tools/verify-bullet-circle.mjs) — 픽셀 분석 + 메시지
주입으로 전체 흐름 자동 검증.

## 사용자 정의 함수 (`function_create` / `function_create_value`)

Entry는 사용자 함수를 지원한다. 정의는 `project.functions[]`에 들어가고, 호출은
**합성 타입** `func_<함수id>`로 한다.

### project.functions 항목 shape

```json
{
  "id": "fib",                         // 함수 id (4~32자 영숫자)
  "type": "value",                     // "normal" (void) | "value" (값 반환)
  "localVariables": [],
  "useLocalVariables": false,
  "content": "<JSON.stringify된 thread 배열>"
}
```

`content`는 `object.script` 와 동일한 shape: 2-D 블록 배열을 stringify. make-ent.mjs는
`functions[*].content`가 array 면 자동 stringify, string 이면 그대로 통과.

### 함수 정의 thread 구조

함수 본문은 `content[0][0]` 위치에 단 하나의 `function_create` (또는 `function_create_value`) 블록.

```
function_create_value:
  params:
    [0] function_field_label
        params: ["함수 이름", function_field_string {  // 다음 파라미터 chain
          params: [stringParam_<paramId>, null]        // 실제 파라미터 슬롯
        }]
    [1] null
    [2] null
    [3] <return value 표현식>     // value 함수 전용
  statements:
    [[ 함수 본문 블록들 ]]
```

- 파라미터 슬롯 타입은 **`stringParam_<unique4>`** (또는 boolean param 의 경우 `booleanParam_<unique4>`).
- 본문 안에서 그 파라미터를 참조할 때도 **같은 합성 타입** `stringParam_<paramId>` 블록을 재사용 (`params: []`)
- 호출자는 `func_<함수id>` 타입 블록의 params 슬롯에 인자 값 표현식을 채워 호출

### 호출자 예

```json
{
  "type": "set_variable",
  "params": [
    { "__field": "result" },
    { "type": "func_fib", "params": [
      { "type": "get_variable", "params": ["n_input", null] }
    ]},
    null
  ]
}
```

`set_variable`의 VALUE 슬롯에 `func_fib` 호출 결과가 들어간다.

### 함정 — 라벨 슬롯에 bare string 필요

`function_field_label`의 첫 params (라벨 텍스트)는 **bare string**이 들어가야 한다.
make-ent의 normalizeBlock이 일반 string을 자동으로 `text` 블록으로 wrap하므로
`{"__field": "함수이름"}` sentinel로 감싸 unwrap을 강제해야 한다. 그렇지 않으면
워크스페이스에서 함수 이름 자리에 `[object Object]` 출력.

### 함정 — 헤드리스 재실행 시 toggleStop 은 async

`Entry.engine.toggleStop()`은 변수 snapshot을 비동기로 복원
([`engine.js:715`](../../entryjs/src/class/engine.js#L715), `Promise.all` + `loadSnapshot`).
다음 `toggleRun()` 전에 await 하지 않으면 변수가 막 복원된 상태와 새 setValue 호출이
경합 → 두 번째 실행부터 빈 결과. 검증 스크립트는:
```js
await page.evaluate(async () => {
    if (Entry.engine.state !== 'stop') await Entry.engine.toggleStop();
});
// 이제 변수 setValue
// 이후 toggleRun
```

### 회귀 가드

[`tests/fixtures/spec-fibonacci.mjs`](../tests/fixtures/spec-fibonacci.mjs) — `value` 타입
함수 + 1개 파라미터 (DSL 작성). [`tools/verify-fibonacci.mjs`](../tools/verify-fibonacci.mjs) —
fib(0)~fib(15) 결과 + 수열 리스트 자동 검증.

## HUD textBox 갱신 — `last_shown` 변수로 flicker 회피

게임 진행 중 표시 textBox (예: "웨이브 1/3", 점수, 라이프) 가 변수 변화에 반응해 갱신해야 할 때, 매 프레임 `writeText` 면 flicker (텍스트 깜빡임) 가 보이거나 성능 부담. **변화가 있을 때만 write** 하는 패턴:

```js
{
    id: 'hud_status',
    objectType: 'textBox',
    text: '준비',
    script: [[
        when.sceneStart(),
        setVar('hud_last_wave', 0),  // 마지막으로 표시한 값
        repeat.inf([
            if_(cmp(getVar('wave_idx'), '!=', getVar('hud_last_wave')), [
                setVar('hud_last_wave', getVar('wave_idx')),  // 동기화
                if_(cmp(getVar('wave_idx'), '>', 0), [
                    writeText(combine(combine('웨이브 ', getVar('wave_idx')), '/3')),
                ]),
            ]),
            wait(0.2),  // 폴링 간격 — 200ms 면 거의 즉시지만 매 프레임 write 안 함
        ]),
    ]],
}
```

핵심: `last_shown` 변수가 표시된 마지막 값을 추적 → 현재 값과 다를 때만 갱신. 갱신과 동시에 last_shown 도 업데이트.

**확장**: 여러 변수를 한 textBox 에 표시하면 각 값마다 last_shown 따로 두거나 합성 키 (`combine(wave_idx, ',', score)` 같은) 한 번 비교.

증거: [`spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs) `hud_status` — `hud_last_wave` 로 wave_idx 변화 시에만 writeText.

## `wait_until` 패턴 — `repeat.inf + stopRepeat`

DSL 에 직접 `wait_until` 이 없지만 자주 필요 (특정 조건 만족까지 블로킹). Entry 의 `repeat_while_true` 블록을 쓰는 대신 `repeat.inf` + `stopRepeat` 으로 표현:

```js
// "prep_done == 1 까지 대기" — manager 의 spawn loop 시작 전
[
    when.sceneStart(),
    ... 초기화 ...,
    repeat.inf([
        if_(cmp(getVar('prep_done'), '==', 1), [
            stopRepeat(),
        ]),
        wait(0.1),  // 폴링 간격 — 너무 작으면 CPU 낭비
    ]),
    ... 본 로직 ...
]
```

**폴링 간격 선택**:
- 0.05~0.1s: 즉시감 + 부담 적음 — UI 응답 (버튼 클릭 후 진행 등)
- 0.5~1s: 게임 상태 변화 감지 — 종료 조건 등 즉시성 덜 중요한 경우

증거: [`spec-frontier-guard.mjs`](../tests/fixtures/spec-frontier-guard.mjs) Phase 3 manager — prep_done 대기 (0.1s 폴링), 게임 종료 판정 (0.1s 폴링).

## 대규모 게임 빌드 — 스코프 분할 / bisect 디버깅 / 회귀 가드 레이어

복잡한 spec (예: 디펜스 게임 — 슬롯·웨이브·메뉴·골드·업그레이드·시각화) 을 한 번에 작성하면 디버깅 비용이 폭증. 실측 워크플로:

### 스코프 분할 — 인프라 검증 vs 기능 추가

| 단계 종류 | 예시 | 분할 권장? |
|---|---|---|
| **새 패턴 (인프라) 검증** | direction-as-id, 클론 broadcast, manager spawn | ✓ 작은 fixture 로 분리 |
| **기능 추가 (기존 패턴 응용)** | 새 적 종 추가, 새 타워 종 추가, 웨이브 늘리기 | △ 한 번에 OK |

판단 기준: "이 spec 의 어느 부분이 작동 안 하면 *왜* 인지 추측해야 하나?" → 추측 필요하면 분리, 확신하면 합쳐도 OK.

실측 (frontier-guard):
- Phase 1 (MVP) ↔ Phase 2 (확장) **분리** → Phase 1 에서 발견한 race condition 2 가지 (`when_message` fan-out, 다중 `when_clone_start`) 가 Phase 2 의 multi-type/wave 환경에 묻혔다면 추적 어려웠을 것.
- Phase 2 → Phase 2.1 (intro+flash) **분리** → 작은 사항이지만 매끄럽게 추가됨.
- Phase 3 (풀 빌드 시스템) **한 번에** → catastrophic bug (when_message 가 template 발화 → scene 손상) 발생, bisect 디버깅 필요했음. 4 신기능 (슬롯·메뉴·골드·prep) 을 한 번에 한 비용.

### Bisect 디버깅 — Entry 의 catastrophic 동작 추적

Entry 가 silent error 로 scene 전체를 망가뜨리는 패턴 (예: 유효하지 않은 list index 룩업, 잘못된 슬롯 wrap 등) 발생 시:

1. **Minimal handler 부터 출발**. 클릭 핸들러를 `setVar('dbg1', 1)` 한 줄만 남기고 검증.
2. **작동 확인 후 점진 추가**. 한 번에 1-2 블록씩 더해서 매번 검증.
3. **dbg 변수로 진입 marker** + **dump 으로 상태 비교**. dbg1=0 이면 핸들러 진입 안 함, dbg1=1 인데 dbg2=0 이면 그 사이 블록이 문제.
4. **scene-corruption 신호**: cloneCount 가 갑자기 0, 모든 변수 default 로 reset, 후속 클릭 무반응. → 메시지 발신이 trigger 일 가능성 높음 (template 도 listen 하는데 invalid index 룩업 등).

frontier-guard Phase 3 사례: `setVar dbg1` 만 → 작동 → `if(state==1)` 추가 → 작동 → `changeVar gold` → 작동 → `setListAt slot_type` → 작동 → `sendMessage('refresh_slot')` → **scene 전체 손상**. 원인 격리: refresh_slot 의 receiver (slot_template) 가 template (direction=90) 까지 발화 → `valueAt('slot_type', 90)` 범위 밖 → 손상. 가드: `if_(cmp(coord('self', 'direction'), '<=', SLOT_COUNT), [...])`.

### 회귀 가드 레이어 (4 단)

| 레이어 | 도구 | 시간 | 잡는 것 |
|---|---|---|---|
| 1. 정적 | `make-ent --check` | < 1 초 | paramCount, 미지의 블록 type, 슬롯 mismatch |
| 2. 빌드 | `make-ent` (no `--check`) | 1-2 초 | 자산 누락, JSON 직렬화 실패 |
| 3. smoke (로드) | `tests/smoke.test.js` | ~ 5 초 | Entry 가 .ent 로드 시 crash (예: `addChildAt(undefined)`) |
| 4. runtime | `tools/verify-*.mjs` (playwright) | 10-60 초 | 변수 변화, 메시지 발화, 클론 카운트, **시각 픽셀 검증**, **실제 click hit-test** |

**4 의 sub-layer**:
- `Entry.dispatchEvent('entityClick', e)` — 핸들러 로직만 검증 (hit-test 우회). UI 회귀 가드로 부족.
- `page.mouse.click(px, py)` + canvas 좌표 변환 — pixel hit-test 까지 검증. 투명 영역 클릭 무반응 같은 함정 잡기.
- `findColoredPixels(page, '#fbbf24')` — 빔/효과의 시각 검증.

frontier-guard 의 회귀 가드 (46/46 pass) 는 4 레이어 + 모든 sub-layer 활용. 새 fixture 도 같은 레이어링 권장.

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
