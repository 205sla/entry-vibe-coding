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

### 기존 스크립트의 여러 항목을 수정할 때

**오브젝트마다 한 번 파싱한 트리를 공유하고, 모든 수정 후 한 번 저장한다.**
매핑을 만들 때마다 원래 script를 새로 파싱하면 서로 다른 사본을 수정하게 된다.
마지막 사본만 저장되어 구조 검사는 통과하고 앞선 수정은 사라질 수 있다.
실제 외부 작품에서 예정 25건 중 6건만 남았던 원인이다.

```js
const parsed = new Map(project.objects.map(o => [o.id, JSON.parse(o.script)]));
for (const change of changes) {
  const script = parsed.get(change.objectId);
  if (!script) throw new Error('대상 오브젝트 없음');
  applyChange(script, change); // 대상의 기존 타입·값·분기를 확인한 뒤 수정
}
for (const object of project.objects) {
  object.script = JSON.stringify(parsed.get(object.id));
}
```

블록 쌍을 복제할 때는 깊은 복사 후 **중첩 params·statements를 포함한 모든 새 블록 id**를 재발급한다.
변수·리스트·신호·오브젝트를 가리키는 참조 id까지 바꾸면 안 된다. 원본에서 서로 다른 오브젝트가
블록 id를 재사용한 사례가 있으므로, 파일 전체 중복을 일괄 교정하지 말고 오브젝트 안의 충돌을 검사한다.
새로 발급할 id는 기존 전체 집합과 충돌하지 않게 만든다.

매핑에는 오브젝트와 분기·회차를 함께 기록한다. 삽입 후 달라지는 walk 인덱스를 그대로 재사용하지 않는다.
저장 후 다시 파싱해 **예정한 변경 수와 변경 값**을 전수 대조한다. wait를 쪼갰다면 대기 합 검사에 더해
[실제 음악 기준 시각](16-music-synchronization.md)도 확인한다.

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

엔트리의 블록 정의는 [`entryjs/src/playground/blocks/block_*.js`](https://github.com/entrylabs/entryjs/tree/53e121523760f15961cd14ab7cb93563a79eaab3/src/playground/blocks)에 흩어져 있다.

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
| `when_some_key_pressed`    | 2 | `VALUE=1` | VALUE=**숫자 키 코드 문자열** (`"37"` ←, `"38"` ↑, `"39"` →, `"40"` ↓, `"32"` 스페이스, `"65"` A). 엔진이 코드로 대조하므로([`code.js:137`](https://github.com/entrylabs/entryjs/blob/53e121523760f15961cd14ab7cb93563a79eaab3/src/playground/code.js#L137)) `"left"` 같은 이름은 로드는 되지만 **절대 발화하지 않는다**. DSL `when.keyPressed('space')` 는 이름을 코드로 바꿔 준다. keydown 마다 한 번(누르고 있으면 OS 키 반복 지연 뒤 연속) → 점프·발사·재시작용 |
| `when_message_cast`        | 2 | `VALUE=1` | VALUE=신호 id (messages[*].id). **필드 문자열** |
| `mouse_clicked`            | 1 | — | 마우스 클릭 순간 |
| `when_object_click`        | 1 | — | 이 오브젝트 클릭 시 |
| `when_scene_start`         | 1 | — | 장면 시작 시 |

### 흐름

| type | params | statements | paramsKeyMap | 비고 |
|------|:------:|:----------:|--------------|------|
| `repeat_basic`      | 2 | 1 | `VALUE=0` | N번 반복 |
| `repeat_inf`        | 2 | 1 | — | 계속 반복 |
| `repeat_while_true` | 3 | 1 | `BOOL=0`, `OPTION=1` | 필드 `'until'`(될 때까지) / `'while'`(동안). ⚠️ DSL 주석의 `repeat.until` 은 **구현이 없다**(2026-09-29) → `{ type: 'repeat_while_true', params: [cond, 'until', null], statements: [body] }` 를 직접 쓴다 |
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
| `is_press_some_key`      | 2 | `VALUE=0` | 지금 눌려 있는가. **필드**: 숫자 키 코드 문자열(`Number(값)` 으로 대조 — [`block_judgement.js:102`](https://github.com/entrylabs/entryjs/blob/53e121523760f15961cd14ab7cb93563a79eaab3/src/playground/blocks/block_judgement.js#L102)). **부드러운 이동은 `repeat.inf` + 이 블록**(DSL `isPressed('ArrowLeft')`) |
| `reach_something`        | 2 | `VALUE=0` | **필드**: `"mouse"` / `"wall"` / `"wall_up"` / `"wall_down"` / 오브젝트 id |

### 생김새

| type | params | paramsKeyMap | 비고 |
|------|:------:|--------------|------|
| `dialog`                 | 3 | `VALUE=0, OPTION=1` | OPTION: `"speak"` / `"think"` |
| `dialog_time`            | 4 | `VALUE=0, SECOND=1, OPTION=2` | 일정 시간 말하기 |
| `change_to_next_shape`   | 2 | `DRIECTION=0` | **오탈자 주의**: 키 이름은 `DRIECTION`. 필드값 `"next"` / `"prev"` |
| `change_to_some_shape`   | 2 | `VALUE=0` | 값: pictures 의 id → 이름 → **1부터 순번** 차례로 찾는다([07](07-runtime-quirks.md#change_to_some_shape-매칭-우선순위--id--name--index)). 현재 번호는 `coordinate_object(self, 'picture_index')` |
| `set_effect`             | 3 | `EFFECT=0, VALUE=1` | EFFECT: `"color"`/`"brightness"`/`"transparency"` |
| `set_scale_size`         | 2 | `VALUE=0` | 퍼센트가 아니라 **폭·높이 평균 px**([07 크기](07-runtime-quirks.md#크기-정하기는-퍼센트가-아니다)) |
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

#### 오브젝트 전용 변수와 클론별 상태

`project.variables[*].object`에 오브젝트 ID를 지정한 변수는 전역 변수와 구분된다. 복제본을 만들 때 오브젝트 전용 변수·리스트가 복사되며, 클론에서 해당 변수를 읽고 쓰면 클론의 저장소를 사용한다. 함수의 `localVariables`와는 별개 기능이다.

| 상태 범위 | 선언·저장 방식 | 용도 |
| --- | --- | --- |
| 전역 | `variables[*].object: null` | 점수, 진행 상태, 여러 오브젝트가 읽는 병렬 리스트 |
| 오브젝트 전용 | `variables[*].object: "enemy"` | 복제본별 번호, 원본/복제본 구분, 개별 타이머 |
| 함수 지역 | `functions[*].localVariables` | 함수 안 임시 계산값. 클론 ID의 영속 저장소로 혼동하지 않음 |

생성기 `make-ent.mjs`는 `spec.variables[*].object`를 전달한다. 예를 들어 `variables: [{ id: 'enemy_id', name: '내 번호', object: 'enemy', value: 0 }]`로 선언할 수 있다. 단축형 `spec.lists`는 현재 `object: null`로 생성하므로, 오브젝트 전용 리스트에는 `spec.variables`의 `variableType: 'list'`와 `object`를 사용한다.

2026-09-10 소스 대조: `src/class/object.js`의 `addCloneEntity` → `addCloneVariables`는 대상 오브젝트의 변수·리스트를 각각 `clone()`한다. `src/class/variable_container.js`의 `getVariable`·`getList`는 클론이며 `object_`가 있는 경우 클론 저장소에서 조회한다. 이는 로컬 엔진 소스 확인이며 이번 작업에서 브라우저 실행 검증은 하지 않았다.

[RPG 사례](09-rpg-case-study.md)는 이 스코프와 전역 병렬 리스트를 함께 사용하는 실제 블록 근거를 제공한다. 변수 스코프가 분리돼도 같은 클론의 여러 시작 스레드끼리는 상태를 공유한다. [다중 시작 핸들러의 순서 문제](07-runtime-quirks.md#다중-when_clone_start-스크립트는-병렬-실행--클론-초기화-race)는 별도로 설계해야 한다.

#### 클론 정체 판정 — 클론 좌표 = 고유 id 대용

"이 클론이 정답인가?" 같은 판정에는 클론별 식별자가 필요하다. **오브젝트 전용 변수는 복제본별로 복사되므로 이를 사용할 수 있다**([오브젝트 전용 변수와 클론별 상태](#오브젝트-전용-변수와-클론별-상태)). 아래는 기존 예제처럼 전역 변수와 엔티티 속성을 사용하는 설계의 대안이며, 엔진에 로컬 변수가 없어서 필요한 우회는 아니다:

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

### 발판이 수십~수백 개면 이 패턴을 쓰지 않는다

위 패턴은 **발판마다 오브젝트 1 개 + `landing_y` 상수**가 필요해서 3~10 개까지가 실용 한계다.
NES 급 스크롤 스테이지(수백 칸)에는 아래 [문자열 타일맵 + 서브스텝 스윕](#문자열-타일맵--서브스텝-스윕-충돌--사이드스크롤-플랫포머)
을 쓴다 — 오브젝트 수가 맵 크기와 무관해진다.

## 문자열 타일맵 + 서브스텝 스윕 충돌 — 사이드스크롤 플랫포머

`reach_something` 발판 패턴이 감당 못 하는 규모(수백 칸 × 여러 행)의 스테이지를 만드는 방법.
핵심은 **맵을 오브젝트가 아니라 데이터로 두고**, 충돌을 엔진에 묻지 않고 직접 계산하는 것.

### 맵 표현 — 리스트 한 개, 행 = 문자열

```js
lists: [{ id: 'lvl', array: [
    '................................',   // 행 0 (화면 상단)
    '...........?BB?.................',
    '............................PP..',
    '################################',   // 행 8 (바닥)
]}],
```

- 한 칸 = 문자 1 개. `#`=흙 `=`=돌 `B`=벽돌 `?`=보상 `u`=소진 `P/p`=파이프 `c`=코인 `F`=깃대 `.`=공기.
- 읽기 = `char_at(valueAt('lvl', r+1), c+1)` (둘 다 1-based).
  **범위 밖은 `throw`** 하므로 반드시 가드 — [07 §char_at·substring 은 범위를 벗어나면 throw](07-runtime-quirks.md#char_at--substring-은-범위를-벗어나면-throw--문자열-타일맵에-가드-필수).
- 쓰기(벽돌 파괴 등) = `substring` 좌/우 + `combine`. **`replace_string` 은 같은 문자를 전부
  바꿔서 못 쓴다** (같은 07 섹션).
- 원본 맵을 `lvl_src` 로 따로 들고 있으면 재시작이 `setListAt` 복사 한 번이다.

### 충돌 — AABB 겹침 질의 + 서브스텝 스윕

발판마다 검사하는 대신, **"이 사각형이 단단한 타일과 겹치나"** 를 묻는 값함수 하나를 만든다.

```
sd(ch)          → 문자가 단단한가 (1/0)
sa(x, y)        → 월드 픽셀 → 그 칸이 단단한가         : quotient(x,TILE), quotient(y,TILE) → ta → sd
bh(x, y, w, h)  → AABB 가 단단한 타일과 겹치나         : 모서리 4 점 + 좌우 변 중앙 2 점
```

히트박스가 타일보다 작으면 (예: 20×44 vs TILE 32) 한 변에 타일 경계가 2 개 이상 걸릴 수 없어
**6 점 샘플로 충분**하다. 히트박스가 타일보다 크면 변마다 샘플을 늘려야 한다.

이동은 한 번에 옮기지 않고 **`SUBSTEP` px 씩 나눠 전진하며 매 조각마다 `bh`** 를 본다
(꼬리재귀 값함수 — [반복 블록은 프레임을 먹는다](07-runtime-quirks.md#함수-호출은-반복하기의-60fps-틱을-우회-꼬리-재귀-최적화)).
막히면 그 자리에서 멈추고 속도를 0 으로. 이게 고속 낙하의 **바닥 관통(터널링)** 을 막는다.

```js
const fnMoveY = fn.value('my', ['remain', 'dir'], (remain, dir, L) => [
    if_(cmp(remain, '<=', 0), [L.set('done', 1)], [
        L.set('step', P.SUBSTEP),
        if_(cmp(remain, '<', P.SUBSTEP), [L.set('step', remain)]),
        L.set('ny', calc(getVar('py'), '+', calc(L.get('step'), '*', dir))),
        if_(cmp(call('bh', getVar('px'), L.get('ny'), W, getVar('box_h')), '==', 1), [
            if_(cmp(dir, '>', 0), [                      // 아래로 → 착지
                setVar('grounded', 1), setVar('vy', 0),
                setVar('py', calc(quotient(calc(L.get('ny'), '+', 1), TILE), '*', TILE)),
            ], [                                          // 위로 → 머리박기
                setVar('vy', 0), setVar('bumped', 1),
                setVar('hit_c', quotient(getVar('px'), TILE)),
                setVar('hit_r', quotient(calc(L.get('ny'), '-', getVar('box_h')), TILE)),
            ]),
            L.set('done', 1),
        ], [
            setVar('py', L.get('ny')),
            L.set('done', call('my', calc(remain, '-', L.get('step')), dir)),   // 꼬리재귀
        ]),
    ]),
], (remain, dir, L) => L.get('done'), ['done', 'step', 'ny', 'h']);
```

**착지 스냅 공식**: `py` 를 **발 위치(= 몸의 하단 경계, 배타적)** 로 정의하면
`py = quotient(ny + 1, TILE) * TILE` 한 줄로 타일 상단에 정확히 붙는다. 이 정의 때문에
`bh` 의 하단 샘플은 `py` 가 아니라 **`py - 1`** 을 봐야 한다 — `py` 를 쓰면
`quotient(py, TILE)` 이 지면 행을 가리켜 "항상 충돌"이 되고 **걷기가 멈춘다**.

머리박기 지점(`hit_c`/`hit_r`)을 기록해 두면 블록 반응(벽돌 파괴·보상 지급)을 이동 코드와
분리해서 처리할 수 있다.

### 렌더 — 타일 오브젝트 0 개, 가시창만 stamp

맵이 커도 오브젝트는 늘리지 않는다. `world` sprite 하나가 매 프레임 `eraseAll` 후
**가시창 칸만** 문자별 `changeShape` + `stamp`. 예산은 프레임당 ~250 칸
([07 §brush_stamp 타일 렌더러](07-runtime-quirks.md#brush_stamp-타일-렌더러--매-프레임-252-칸-재그리기도-62fps-스크롤-게임-예산)).

카메라는 변수 `cam_x` 하나. 화면 좌표 = 월드 − `cam_x`. 부드러운 스크롤을 위해
`cam_col = quotient(cam_x, TILE)` / `cam_frac = mod(cam_x, TILE)` 로 쪼개, 칸은 열 단위로
돌면서 `cam_frac` 만큼 밀어 그린다. 역스크롤 금지는 목표값이 현재보다 클 때만 대입.

### 액터 — 클론 대신 고정 길이 병렬 리스트

적·아이템·발사체를 클론으로 두면 [클론 초기화 race](07-runtime-quirks.md#다중-when_clone_start-스크립트는-병렬-실행--클론-초기화-race) ·
[template 발화](07-runtime-quirks.md#when_message-핸들러가-template-에도-발화--direction-as-id-시-invalid-index-lookup-으로-scene-전체-손상) ·
[글로벌 scratch race](07-runtime-quirks.md#다중-클론의-repeatinf-본체--글로벌-scratch-변수-race) 를 전부 상대해야 한다.
타일맵 게임에서는 어차피 충돌을 직접 계산하므로 **클론이 줄 이점(개별 `reach_something`)이 없다** —
그러면 클론을 안 쓰는 쪽이 구조적으로 안전하다.

| 클론 방식 | 리스트 방식 |
|---|---|
| 상태가 클론 속성에 흩어짐 | `en_x`/`en_y`/`en_vx`/`en_state`/`en_timer`/`en_kind` 같은 인덱스 |
| 스폰/제거로 개수가 변함 | **고정 길이** — 슬롯 재사용 (`en_state=3` = 죽음) |
| 재시작 = `removeAllClones` + 재스폰 | 재시작 = `setListAt` 으로 원위치 덮어쓰기 |
| 개수 증가 버그가 생길 수 있음 | `add_value_to_list` 를 아예 안 써서 **길이가 자랄 수 없음** |

갱신은 꼬리재귀 값함수 하나가 인덱스를 훑고, 그리기도 같은 방식으로 화면 안 슬롯만 stamp.
**활성 범위 가드**(`-M < en_x - cam_x < SCR_W + M`)를 넣으면 화면 밖 액터는 계산도 안 한다 —
단, 이건 검증 봇에게 함정이 된다: 멈춰서 적을 기다릴 수 없고 카메라가 밀려야 적이 움직인다.

### 스크래치 변수는 스레드별 전용으로

`player` 와 `world` 가 각자 `repeat.inf` 를 돌면 **글로벌 변수 하나를 여러 용도로 돌려쓰는 순간
프레임 중간에 서로 덮어쓴다** (클론이 아니어도 발생). `cam_tmp`/`box_h`/`max_spd`/`accel` 처럼
용도별 전용 이름을 쓰고, 스레드 경계를 넘는 값은 이름에 소유자를 남긴다 —
[lessons.md](lessons.md) 2026-07-31 항목.

### 타일 크기는 **한 곳**에서 유도한다 — 검증 코드까지

타일 스케일은 나중에 바뀐다. 원작 대비 세로 행 수가 안 맞거나 렌더 예산이 남으면 조정하게 되는데,
그때 **"현재 타일 크기를 전제로 박아둔 숫자"가 전부 조용한 버그가 된다.** 한 사이드스크롤 작품을
TILE 32 → 24 로 옮길 때 실제로 걸린 곳:

| 박혀 있던 값 | 무엇이었나 |
|---|---|
| `ROW0_Y = 137` | `-HALF_H + TILE/2 + (ROWS-1)*TILE` 의 계산 결과 |
| `HITBOX_W/H = 20/44`, `SUBSTEP = 4`, `CAM_MAX_STEP = 12`, `ENEMY_ACTIVE_MARGIN = 64` | 전부 32px 격자 기준 길이 |
| 적 왕복 진폭 `±48px` | 1.5 칸 |
| verify 의 `const TILE = 32` 사본 | 게임과 별도로 복제된 격자 |

그래서 배율은 **상수 하나(`S`)와 그로부터의 유도**로만 둔다. 속도·중력만 곱하고 길이를 놓치는
게 흔한 실수다 — 물리 상수 모듈에서 길이 상수도 `L = (base) => Math.round(base * S)` 로 만든다.
스프라이트 `scale` 도 기본값에 의존하지 말고 명시한다: 기본값에 맡기면 타일만 작아지고
캐릭터는 옛 크기로 남는다.

⚠️ **검증 쪽 사본이 특히 위험하다.** 단정에 옛 값이 남으면 실패하지 않고 **헐거워져서 통과한다** —
`MAX_FALL` 이 12 → 9 로 줄었는데 `maxVy <= 12.01` 을 보고 있으면 그 단정은 아무것도 안 지킨다.
verify 도 게임과 같은 모듈에서 `TILE`/`GROUND`/`ROWS`/`PHYS` 를 import 해야 한다.
단, `page.evaluate` 안은 별 컨텍스트라 import 가 안 보이므로 **인자로 넘긴다**:

```js
await page.evaluate(([TILE, ROWS]) => { /* ... */ }, [TILE, ROWS]);
```

체감이 배율에 안전한지 확인하는 방법: **칸 단위로 환산해서 비교한다.** 그 작품은
`S` 를 2 → 1.5 로 바꿨을 때 최대 점프가 112px 로 줄었지만 4.7 칸으로 그대로였다
(속도와 중력이 같은 배율로 스케일되므로 칸 단위 궤적이 보존된다).

### 이 절의 출처

이 절의 설계와 코드는 356 열 × 12 행 스테이지를 오브젝트 6 개로 만든 사이드스크롤 작품
(적·아이템·발사체 전부 리스트, 평지에서 프레임당 45 스탬프, 검사 16 시나리오)에서 나왔다.
작품은 검사 일부가 통과하지 않은 미완성이라 2026-09-29 공개 저장소에서 내려 로컬 전용으로
옮겼다. 필요한 코드는 이 절과 [07](07-runtime-quirks.md#char_at--substring-은-범위를-벗어나면-throw--문자열-타일맵에-가드-필수)에
옮겨 두었고, 렌더 예산 실측은 [07 §렌더 예산은 그린 칸으로](07-runtime-quirks.md#brush_stamp-렌더-예산은-방문-칸이-아니라-그린-칸으로-센다--타일-크기를-바꾸면-다시-재야-한다)에 있다.

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

`dx`/`dy`/`ret` 같은 함수 내부 임시값은 **함수 지역 변수**로 두는 게 깔끔하다 (아래
[함수 지역 변수](#함수-지역-변수-function-local-variables) 섹션). 전역으로 둬도 동작은 함 —
**함수는 동기 실행이라 동일 tick 내에서 변수 충돌 없음** (다음 호출 시작 전 현재 호출의
set/get/return 이 모두 끝남) — 다만 전역 namespace 오염 + 중첩 호출 시 같은 전역을 공유하면
clobbering 위험. 지역 변수는 함수마다 별개 저장소라 이 문제가 없다.

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

### ⚠️ 함정 — value 함수 호출을 **문장 위치**에 두면 `.ent` 가 로드되지 않는다

`fn.value` 로 만든 함수의 호출(`func_<id>`)은 **반드시 값 슬롯**에 있어야 한다.
스레드에 문장처럼 나란히 두면 — 부수효과만 쓰고 반환값을 버리려는 자연스러운 코드 —
`Entry.loadProject` 가 블록 렌더 단계에서 죽는다:

```
TypeError: Failed to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'
```

3중으로 침묵한다: `--check` 통과, 빌드 성공(정상 크기 `.ent`), 로드 실패 시 console 단서
없음. 편집기에서 프로젝트가 **아예 열리지 않으므로** 사람 눈 확인(L5)도 불가능하다.

```js
// ✗ 로드 불가 — 문장 위치
threads: [[ when.run(), call('st', 7, 4, txt('.')) ]]

// ✓ 값 슬롯에 sink — 반환값이 필요 없어도 변수에 버린다
threads: [[ when.run(), setVar('sink', call('st', 7, 4, txt('.'))) ]]
```

부수효과 전용 함수라면 애초에 `fn.normal` 로 정의하는 게 맞다 (`function_create`,
호출이 문장으로 유효). `fn.value` 를 쓰는 이유가 "재귀 + 동기 실행"이라면 위처럼
sink 변수 하나를 두면 된다.

**가드**: [`tools/make-ent.mjs`](../tools/make-ent.mjs) `validateSpec` → `walkStatement` 가
statement 위치의 `func_<id>`(spec.functions 에서 `type: 'value'`)를 L1 **error** 로 잡는다.
`spec.functions` 를 보고 판정하므로, 함수 정의가 다른 파일에 있어도 같은 spec 안에 있으면 잡힌다.

### 함정 — 라벨 슬롯에 bare string 필요

`function_field_label`의 첫 params (라벨 텍스트)는 **bare string**이 들어가야 한다.
make-ent의 normalizeBlock이 일반 string을 자동으로 `text` 블록으로 wrap하므로
`{"__field": "함수이름"}` sentinel로 감싸 unwrap을 강제해야 한다. 그렇지 않으면
워크스페이스에서 함수 이름 자리에 `[object Object]` 출력.

### 함정 — 헤드리스 재실행 시 toggleStop 은 async

`Entry.engine.toggleStop()`은 변수 snapshot을 비동기로 복원
([`engine.js:715`](https://github.com/entrylabs/entryjs/blob/53e121523760f15961cd14ab7cb93563a79eaab3/src/class/engine.js#L715), `Promise.all` + `loadSnapshot`).
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

## DSL 수식은 실행 시점에 따라 구분한다

[`spec-dsl.mjs`](../tools/lib/spec-dsl.mjs)의 `fn.value` 콜백에 전달되는 인자는 숫자가 아니라
`{ type: 'stringParam_…', params: [] }` 형태의 **블록 참조 객체**다. `getVar()`와
`L.get()`도 값을 즉시 읽지 않고 블록을 만든다.

```js
// row는 실행 중에 결정되는 함수 인자다.
// 잘못: row => 98 - row * 2   → spec 생성 중 JS가 객체를 곱해 NaN
fn.value('mapy', ['row'], () => [],
    row => calc(98, '-', calc(row, '*', 2)));

// x는 제작 시 정해지는 JS 숫자이므로 일반 수식으로 계산해도 된다.
Array.from({ length: 19 }, (_, x) => 174 + x * 2);
```

판단 기준은 수식의 길이가 아니라 **피연산자 중 실행 중 값이 있는가**다. 하나라도 블록
참조이면 사칙연산·비교·문자 결합을 `calc`·`cmp`·`combine`으로 구성한다. 정해진 개수의
블록을 `Array.from`으로 펼칠 때에도 JS 인덱스와 엔트리 함수 인자를 구별한다.

심연의 성채에서는 `mapdrawrow`의 X는 JS 상수, Y는 엔트리 함수 인자여서 같은 좌표식에서도
두 방식을 나눠야 했다. [수정된 소스](../games/abyssal-keep/spec.mjs)의
`locateXY(174+x*2, sub(98, mul(y,2)))`가 재사용 예다.
구조 검사가 통과했다는 것만으로 수식의 의도까지 확인되지는 않는다. 생성 전 블록 값의
`NaN`·`Infinity`와 잘못 문자열화된 객체를 살피고, 실행 화면에서 좌표를 확인한다.

## 함수 지역 변수 (function local variables)

함수 안에서만 쓰는 임시값은 **전역 변수 대신 함수 지역 변수**로 둘 수 있다. 전역
namespace 오염 방지 + 함수별 격리(같은 이름이라도 함수마다 별개 저장소 → 중첩 호출
clobbering 없음). playentry.org export (`260603_205님 작품.ent`) 로 포맷 확인 + make-ent
라운드트립으로 실제 동작 검증 완료.

### 포맷 (`project.functions[*]`)

```json
{
  "id": "dbl",
  "type": "value",
  "useLocalVariables": true,
  "localVariables": [
    { "name": "tmp", "value": 0, "id": "dbl_tmp" }   // id 관례: `<funcId>_<name>`
  ],
  "content": "…"
}
```

- 지역변수 `id` 는 보통 **`<함수id>_<이름>`** (예시 export 는 `<funcId>_<rand4>`; 이름 기반이
  더 읽기 쉬움). 함수 안 블록은 이 id 로 참조.
- `useLocalVariables: true` (지역변수 있으면).

### 블록 타입 (둘뿐 — registry `func` 카테고리)

| type | params | 의미 |
|------|--------|------|
| `get_func_variable` | `[<localVarId>, null]` | 지역변수 읽기 (반환 블록). VARIABLE=0 (DropdownDynamic → **bare id 문자열**) |
| `set_func_variable` | `[<localVarId>, <valueBlock>, null]` | 지역변수 정하기. VARIABLE=0, VALUE=1, Indicator=2 |

**`change_func_variable` 블록은 없다.** 증감은 `set + calc(get, +, delta)` 로 합성:
`set_func_variable(id, calc_basic(get_func_variable(id), 'PLUS', delta))`.

VARIABLE 슬롯이 `DropdownDynamic` 이라 make-ent 의 `wrapParam` 이 bare 문자열을 그대로 통과
(field 슬롯) — `__field` sentinel 불필요. `--check` 도 통과.

### ⚠️ 함정 — 함수 지역변수는 **빈 문자열을 저장 못 함**

`set_func_variable(x, "")` 후 `get_func_variable(x)` 를 읽으면 **`0`** 이 나온다 (빈 문자열이
숫자 0 으로 취급됨). 전역 `set_variable(g, "")` 는 정상(`""` 유지)이라 전역→지역 전환 시
**문자열 누산기(`out = ""` 로 시작해 append)** 가 `"0..."` 로 깨지는 형태로 드러난다.
(substring 으로 만든 빈 문자열을 set 해도 동일하게 0. 지역변수 선언 `value` 를 `""`/`0` 어느
쪽으로 둬도 무관 — set 자체가 문제.)

**회피 — SEED 센티넬**: 누산기를 빈 문자열 대신 데이터에 없는 1글자 센티넬(예:
`String.fromCharCode(0xE000)`, PUA)로 시드 → 정상 append → **반환 직전** `replace_string` 으로
센티넬 제거. 지역변수가 한 번도 비지 않으므로 0 강제를 회피한다. 반환값(센티넬 제거 결과)은
호출자(전역 변수)로 나가므로 빈 결과여도 안전.

```js
const SEED = String.fromCharCode(0xE000);
const seedOut = (L) => L.set('out', txt(SEED));                       // "" 대신 SEED
const flush   = (L) => replaceStr(L.get('out'), txt(SEED), txt(''));  // 반환 직전 제거
// 그룹 구분 공백 등 "out 이 비었나" 검사는 strLen(out) > 1 로 (SEED 1글자 보정)
```

증거: [`games/es-hangul/spec.mjs`](../games/es-hangul/spec.mjs) 의 모든 문자열 누산기
(getChoseong·numberToHangul·disassemble·removeLastCharacter 등) + 회귀 가드
[`tools/verify-es-hangul.mjs`](../tools/verify-es-hangul.mjs) 42 assert (SEED 적용 전엔 누산기
함수 15개가 leading `0` 으로 실패).

### DSL 사용법 (`fn.value`/`fn.normal` 의 `locals` 인자 + `L` 접근자)

[`tools/lib/spec-dsl.mjs`](../tools/lib/spec-dsl.mjs) `fn.value(id, params, body, ret, locals)` —
`locals` 배열(이름들)을 넘기면 `localVariables`/`useLocalVariables` 자동 생성, body/return 의
**마지막 인자**로 `L` 접근자 전달:

```js
fn.value('dbl', ['n'],
    (n, L) => [ L.set('tmp', calc(n, '*', 2)) ],   // L.set / L.get / L.change(name, delta) / L.id(name)
    (n, L) => calc(L.get('tmp'), '+', 1),
    ['tmp'])                                         // ← 지역변수 이름들
```

`L.change(name, delta)` 는 위 set+calc 합성을 캡슐화 (루프 카운터 `L.change('i', 1)` 등).
저수준 헬퍼도 export: `getFuncVar(lid)`, `setFuncVar(lid, v)`, `changeFuncVar(lid, d)`.

### 전역으로 남겨야 하는 것 (지역으로 옮기면 안 됨)

- **여러 함수가 공유하는 읽기 전용 데이터** (룩업 테이블·상수 문자열). 지역변수는 한 함수
  전용이라 공유 불가 → 전역 유지.
- **함수 밖(오브젝트 스크립트)에서도 읽는 값** (함수 반환을 받는 결과 변수 등).
- 즉 "**단일 함수 안에서만** set/get 되는 임시값"만 지역으로.

### 검증

- 포맷 동작: dbl(20)=41 (`tmp`), sumTo(10)=55 (`s`/`i` 루프 + change 합성), Entry 가
  `useLocalVariables:true` + locals 인식, pageErrors 0. (make-ent 라운드트립 1회성 테스트.)
- 실사용: [`games/es-hangul/spec.mjs`](../games/es-hangul/spec.mjs) — 30개 함수의 스크래치를
  전부 지역변수화, [`tools/verify-es-hangul.mjs`](../tools/verify-es-hangul.mjs) 54 assert 통과.

## ⚠️ 값 함수 **중첩 호출** — 루프 있으면 조기 반환 (인라인 필수)

`repeat` 루프가 있는 **값 함수를 다른 함수의 표현식 안에서 호출**(중첩)하면, 루프가
프레임을 양보하는 동안 호출자는 **루프 완료 전 값을 받는다** (≈1회 반복분만 처리된 부분값).
top-level (오브젝트 스크립트의 `setVar(x, call(fn))`)에서는 스레드가 프레임을 넘기며 끝까지
기다리므로 정상.

- **증상**: `convertHangulToQwerty('한글')` 이 `disassemble`(루프 함수)을 중첩 호출 →
  분해 결과가 첫 글자만(`'ㅎ'`) → 출력 `'g'`. `disassemble` 자체를 top-level 로 부르면 정상.
- **정상 케이스**: 루프 **없는** 값 함수(`grp`·`assembleChar`·`binChars`·`canBe*` 등 if/계산만)
  는 중첩 호출해도 동기 반환 (예: `numberToHangul`→`grp`).
- **회피**: 중첩이 필요하면 (a) 호출 대상의 루프를 **호출자 안에 인라인**(루프 없는 보조 함수만
  중첩), 또는 (b) 루프를 재귀/언롤로 대체.

증거: `games/es-hangul/spec.mjs` 의 `assemble`/`convertHangulToQwerty`/`convertQwertyToHangul`
는 분해·매핑 루프를 인라인하고, 결합은 루프 없는 `binAssemble`만 중첩 호출.

### 부수 함정 — 미설정 변수는 `'0'` 으로 읽힘 → verify 폴링 주의

값 `''` 인 변수를 `getValue()` 하면 **`0`** 이 나온다 (빈→0 강제, 위 set_func_variable 함정과
동일 원인). 그래서 헤드리스 verify 에서 "결과 변수 non-empty" 폴링은 미설정('0')을 즉시 통과
→ 스레드 완료 전 read. **마지막 결과의 기대값**(예: `=== '빵'`)으로 폴링해 완료를 보장할 것.
(프레임 양보 루프가 많은 데모는 완료까지 수 초 — `tools/verify-es-hangul.mjs` 참고.)

## 멀티 장면 데모 — 랜딩 장면 + 홈 + 기능 장면 (`startScene`)

여러 기능을 장면으로 나눠 보여주는 데모의 뼈대. spec 최상위 `scenes: [scene(id,name), ...]`,
각 오브젝트에 `scene: '<id>'`. **scene 미지정 오브젝트는 `scenes[0]`(첫 장면)** 으로 간다
([make-ent `resolveSceneId`](../tools/make-ent.mjs)). 그래서 **첫 장면 = 랜딩**.

- **네비게이션**: 버튼 오브젝트에 `when.objectClick()` → `startScene('대상id')`. textBox 도 버튼 가능 —
  단 `bgColor` 를 hex 로 줘야 사각 전체가 클릭 영역([07 §textBox 클릭 영역](07-runtime-quirks.md#textbox-클릭-영역--bgcolor-에-따라-사각-전체-vs-glyph-픽셀만)).
- **랜딩 장면 초기화**: `when_scene_start` 는 시작 시 첫 장면엔 **안 뜬다** → `when.run`+`when.sceneStart`
  이중 트리거(`dualStart`). 상세 [07 §when_scene_start 첫 장면 미발화](07-runtime-quirks.md#when_scene_start-는-시작-시-첫-장면에서-발화-안-함--start_scene-전환에서만).
- **`text_write`/`text_append` 는 실행 중인 self 오브젝트의 textBox 에만** 쓴다. **다른** textBox 에
  표시하려면 그 오브젝트 자신의 스레드가 (전역 변수를 폴링하거나 메시지를 받아) 자기 박스에 write.
  예: 입력창(ime)이 전역 `sug` 를 set → 추천 박스(suggest)가 `repeat.inf([writeText(getVar('sug')), wait(0.1)])`
  자체 루프로 그림. (한 오브젝트가 두 박스에 못 씀.)
- **하이브리드 인터랙션**: 각 기능 장면 = `when.sceneStart` 자동 예시 + 박스 클릭(`when.objectClick`)
  → `ask_and_wait` + `get_canvas_input_value` 직접 입력.

증거: [`games/es-hangul/demo.mjs`](../games/es-hangul/demo.mjs) (6장면: search 랜딩 + home + 자모/조사/숫자/자판),
[`tools/verify-es-hangul-demo.mjs`](../tools/verify-es-hangul-demo.mjs) (장면 전환 + 자동예시 14/14).
멀티 장면 레퍼런스: [`tests/fixtures/spec-bullet-circle.mjs`](../tests/fixtures/spec-bullet-circle.mjs) (3장면).

## 한글 자모 prefix 자동완성 (`disassemble` 매칭)

한글 검색 자동완성의 정석: 단어와 입력을 **자모로 분해**해 prefix 비교. 완성형 글자 단위로 비교하면
중간 조합 상태를 못 잡지만(예: '삭'은 '사과'의 접두가 아님), 자모로 풀면 자연히 잡힌다.

- `disassemble('삭')='ㅅㅏㄱ'`, `disassemble('사과')='ㅅㅏㄱㅗㅏ'` → `ㅅㅏㄱ` 가 prefix.
  (삭+ㅗ→사고, 사고+ㅏ→사과 의 조합 경로가 곧 자모 prefix 관계.)
- **매칭**: `index_of_string(단어자모, 입력자모) == 1` (1=맨 앞=prefix). 입력이 더 길면 0 → 자동 제외.
- **샘플 단어 자모는 빌드 때 JS 로 사전계산**해 리스트로 주입 → 런타임은 단어 분해 0회(입력만 분해).
  JS 분해는 Entry `disassemble` 와 **동일 표**(CHO/JUNGD/JONGD)로 짜야 결과가 일치.
- **한국어+영어 혼합은 이중 쿼리**: 단어 키 = 한국어→자모, 영어→소문자. 입력에서 **q1=자모**
  (한글모드 `disassemble` / 영문모드 `convertQwertyToAlphabet`) 와 **q2=원문 버퍼** 둘 다 계산 →
  각 단어가 `index_of(키, q1)==1 OR index_of(키, q2)==1` 이면 매칭. 자모 문자열↔영문 문자열은 서로
  교차매칭 안 돼 안전. 결과: 영문 `app`→apple…, `tkrhk`→사과, 한글 `사`→사과… 모두. (영문은 소문자 입력 가정.)
- ⚠️ `disassemble`/`convertQwertyToAlphabet` 은 **루프 값 함수** → 입력 자모(q1) 계산은 키 핸들러
  **스레드 최상위 `setVar('q', call(...))`** 로만(중첩 금지 — 위쪽 **§값 함수 중첩 호출** 참고).
- ⚠️ **순회는 동기 재귀 값함수**(`scanSug`)로. `repeat` 루프로 300단어 순회하면 프레임 양보+전역 카운터
  공유로 빠른 입력 시 race(인덱스 초과 크래시) → [07 §다중…repeat race](07-runtime-quirks.md#다중-클론의-repeatinf-본체--글로벌-scratch-변수-race) 변종. 재귀(동기·원자적)로 회피.

증거: [`games/es-hangul/demo.mjs`](../games/es-hangul/demo.mjs) `scanSug`/`updateSuggestions` + `WORDS`/`WORDS_KEY`(300),
[`tools/verify-es-hangul-demo.mjs`](../tools/verify-es-hangul-demo.mjs) (`삭`→사과, 영문 `tkrhk`→사과·`app`→apple).

### 붓으로 슬로우-컬러 단색 배경 (글상자 투명 + 뒤에 깔기)

글상자 배경을 투명(`bgColor:'transparent'`)으로 두고, 별도 sprite 가 **붓으로 화면 전체를 단색 띠로
덮어** 배경을 만든다(색을 아주 느리게 순환 → 은은한 효과). `zOrder('BACK')` 으로 글상자 뒤에.

- **`set_color` 는 정적 색만 아니라 문자열(hex) 블록을 받음**(registry: param `Block, accept:"string"`)
  → 팔레트 리스트의 hex 를 `valueAt` 로 넘겨 **동적 색 변경** 가능: `{type:'set_color', params:[valueAt(PAL,i), null]}`.
- 화면 덮기: 큰 `setThickness` + `locateXY(좌)` → `turnAbs(90)` → `startDraw` → `move(긴 거리)` → `stopDraw`.
  띠가 불투명이라 매 색마다 다시 그려도 이전 띠를 덮음(erase 불필요·flicker 없음).
- 색 순환: 어두운 팔레트(JS HSL→hex 사전계산, 같은 톤 유지하며 hue 만 sin 으로 루프) 를 `wait` 로 천천히.
- 증거: [`games/es-hangul/demo.mjs`](../games/es-hangul/demo.mjs) `bgDrawer`/`PALETTE`, verify ⑭(어두운 픽셀 98%).

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

## 글상자만으로 애니메이션 — 글자 프레임 · 좌표 · 타자기

에셋 0 을 지켜야 하는 작품(→ [05 §콘솔 붙여넣기 배포](05-host-editor.md#playentryorg-배포--기존-작품에-projectjson-만-갈아끼우기-콘솔-붙여넣기))은
오브젝트가 전부 글상자다. 그러면 연출 수단이 셋으로 줄어든다.

| 못 쓰는 것 | 왜 | 대신 |
| --- | --- | --- |
| `효과 주기`·`효과 정하기` (투명도·밝기) | 글상자는 `entity.effect` 가 없어 **스레드가 죽는다** → [07 §효과 블록과 글상자](07-runtime-quirks.md#효과-블록change_effect_amount-등을-글상자에-걸면-스레드가-죽는다) | `show`/`hide`, 글자 바꾸기 |
| `다음 모양으로` | picture 가 없다 | **글자 프레임** 교체 |
| `크기 바꾸기` | 동작은 하지만(`setScaleX` 는 컨테이너 스케일) `lineBreak` 글상자는 `wordWrapWidth` 가 그대로라 줄바꿈이 어긋난다 | 좌표 이동 |

남는 셋 — **글자 바꾸기 · 좌표 이동 · show/hide** — 로 충분히 움직임을 만든다.

### 회전 표시 — 폭이 같은 글자 프레임

```js
const SPIN = ['●○○○', '○●○○', '○○●○', '○○○●'];

repeat.inf([
    setVar(V.spin, calc(mod(getVar(V.spin), num(SPIN.length)), '+', num(1))),
    ...SPIN.map((frame, i) => if_(cmp(getVar(V.spin), '==', num(i + 1)), [
        writeText(txt(frame)),
    ])),
    wait(0.16),
]),
```

프레임 폭을 **모두 같게** 만드는 게 요령이다. `.` → `..` → `...` 처럼 길이가 변하면
가운데 정렬 글상자가 매 프레임 좌우로 흔들린다.

> ⚠️ **기호는 KS X 1001 안에서 고른다.** 무대 기본 폰트가 나눔고딕이고 이 폰트는
> KS X 1001 을 전부 덮는다: `● ○ ◆ ◇ ■ □ ▲ ▼ ◀ ▶ ★ ☆ · … ※ ♥ ♬ →`.
> 점자 스피너(`⠋⠙⠹`)나 블록 요소(`▁▂▃`)는 **집합 밖이라 두부(□)로 폴백**한다.

### 살아 있다는 신호 — 2px 흔들기

```js
if_(or_(cmp(getVar(V.spin), '==', num(1)), cmp(getVar(V.spin), '==', num(3))),
    [locateY(num(BASE_Y))], [locateY(num(BASE_Y + 2))]),
```

좌표 블록은 글상자에서도 안전하다. 등장 연출은 `glideTo`(`locate_xy_time`) 로
무대 밖에서 미끄러뜨리면 된다.

> ⚠️ 장면을 떠나면 `entity.reset()` 이 좌표를 spec 값으로 되돌린다 →
> [07 §장면 재진입](07-runtime-quirks.md#장면을-다시-들어가도-실행기는-쌓이지-않는다--대신-entityreset-이-좌표를-되돌린다).
> 위치를 바꾸는 연출은 **`장면이 시작되었을 때` 첫 줄에서 좌표를 다시 잡는다.**

### 타자기 — `substring` 은 범위를 넘으면 **throw** 다

긴 답변을 한 번에 툭 띄우지 않고 조금씩 드러내면 체감 대기가 줄어든다.
단계 수를 고정하면 길이와 무관하게 시간이 일정하다.

```js
const REVEAL_STEPS = 12, REVEAL_TICK = 0.03;   // 최대 0.36초

const revealText = (valueExpr) => [
    setVar(V.answer, valueExpr),
    setVar(V.reveal, num(0)),
    if_(cmp(strLen(getVar(V.answer)), '>', num(0)), [          // 빈 문자열 가드
        setVar(V.step,
            calc(quotient(strLen(getVar(V.answer)), num(REVEAL_STEPS)), '+', num(1))),
        repeat.basic(num(REVEAL_STEPS), [
            setVar(V.reveal, calc(getVar(V.reveal), '+', getVar(V.step))),
            if_(cmp(getVar(V.reveal), '>=', strLen(getVar(V.answer))), [stopRepeat()]),
            writeText(substr(getVar(V.answer), num(1), getVar(V.reveal))),
            wait(REVEAL_TICK),
        ]),
    ]),
    writeText(getVar(V.answer)),   // 무슨 일이 있어도 전문으로 끝낸다
];
```

두 가지가 안전장치다.

1. **끝을 넘기 전에 `stopRepeat`.** `substring` 은 clamp 가 아니라 `throw` 다 →
   [07 §char_at·substring throw](07-runtime-quirks.md#char_at--substring-은-범위를-벗어나면-throw--문자열-타일맵에-가드-필수).
   `reveal >= 길이` 면 자르지 않고 루프를 끊는다.
2. **루프 뒤에 전문 쓰기.** 걸음 계산이 어긋나도 화면에는 항상 완성된 글이 남는다.
   `step = ⌊len/12⌋ + 1` 이므로 `12 × step ≥ len + 1` — 12 걸음 안에 반드시 끝난다.

`writeText`(`text_write`)는 **자기 글상자에만** 쓴다. 상태 표시를 다른 글상자로 나누려면
변수를 통해 건네고 그쪽에서 폴링한다 → [§HUD textBox 갱신](#hud-textbox-갱신--last_shown-변수로-flicker-회피).

### 정적인 상태는 **바뀔 때 한 번만** 쓴다

애니메이션이 아닌 문구까지 매 틱 `writeText` 하면 `setText` → `updateBG` →
`Entry.stage.updateObject()` 가 계속 돌아 깜빡인다. 상태 코드를 변수에 두고
전이할 때만 쓴다.

```js
repeat.inf([
    if_(cmp(getVar(V.phase), '!=', getVar(V.lastPhase)), [
        setVar(V.lastPhase, getVar(V.phase)),
        ...정적 문구 분기...,
    ]),
    if_(cmp(getVar(V.phase), '==', num(PH.thinking)), [ ...매 틱 회전... ]),
    wait(0.16),
]),
```

## 보일링(선 떨림) — 모양 세 장을 타이머 박자로 돌리기

손그림 애니메이션의 "보일링": 가만히 있는 그림도 **선과 윤곽만 조금씩 다른 세 장**을 약 0.15초마다 돌려 살아 있게 보이게 한다.
2026-09-29 비공개 로컬 스토리 게임(인물 그림 약 15장 + 대사창 종이)에서 만들고 끝까지 플레이 검사로 확인한 방법이다.

### 세 장 만들기 — 이미지 생성 AI 로 다시 그리지 않는다

AI 로 세 번 다시 그리면 자세·표정·옷 주름까지 달라져 "떨림"이 아니라 "튐"이 된다. 세 장은 **픽셀 단위로 같은 자리에 겹쳐야** 하므로
완성된 번들 PNG 를 후처리로 조금씩 민다.

- **부드러운 무작위 변위장**: 정규분포 잡음을 가우스로 흐린 것(가로·세로 각각)을 표준편차 **약 0.25 무대 px**(최대 약 1px), 물결 크기 약 3 무대 px 로 맞춘다.
  무대 px → 번들 px 는 그 그림을 주로 쓰는 표시 배율로 나눈다(배율 0.5 면 ×2) — 그림마다 화면에서 같은 크기로 흔들린다.
- **다시 뽑기**: 알파를 **미리 곱한** RGBA 를 3차 스플라인(`scipy.ndimage.map_coordinates(order=3)`)으로 — 선이 흐려지지 않고 가장자리 색이 번지지 않는다.
  색이 고른 면은 밀려도 그대로라 눈에 보이는 차이는 선·흰 테두리뿐이다.
- **캔버스 크기·중심점을 바꾸지 않는다** — 모양을 바꿀 때 중심이 튄다([07 모양 치수](07-runtime-quirks.md#크기-정하기는-현재-모양의-치수로-계산된다--모양을-바꾼-뒤-다시-정한다)).
- **글자가 얹히는 판(대사창 종이 등)은 가장자리 띠만**: 알파 가장자리에서의 거리(`distance_transform_edt`)로 변위에 가중치 — 6px 안쪽까지 1, 16px 에서 0.
  안쪽(글자 자리)은 세 장이 픽셀 단위로 같아 가독성이 그대로다.
- seed 를 에셋 이름에서 정하면(`crc32(id) + 장 번호`) 다시 돌려도 같은 세 장.
- **용량 약 3배**(보일링 PNG 는 원본보다 5~10% 크다). 실측 `.ent` 12.8 → 17.5 MB. 잠깐(1초 미만)만 보이는 큰 그림은 빼는 편이 낫다.

### 작품에 끼우기 — 그림 한 장 → 세 장 연속, 모양 번호로 차례 계산

```js
// pictures: [A~1, A~2, A~3, B~1, B~2, B~3, …] — 첫 장이 원래 이름을 가져 changeShape('A') 는 그 자세의 첫 장으로 간다
const idx = coord('self', 'picture_index');                          // 현재 모양 번호(1부터)
const target = add(sub(idx, mod(sub(idx, 1), 3)),                     // 자세(세 장 묶음)의 첫 번호
                   mod(floorOf(calc(timer.value(), '/', 0.15)), 3));  // + 타이머로 정한 차례 0·1·2
starts(sc, [repeat.inf([if_(and_(eq(getVar('pen'), 0), cmp(idx, '!=', target)), [changeShape(target)])])]);
```

- `모양 바꾸기`에 **숫자**를 넣으면 순번으로 찾는다([07 매칭 순서](07-runtime-quirks.md#change_to_some_shape-매칭-우선순위--id--name--index)). 그림 이름을 숫자로 짓지 않는다.
- **타이머로 차례를 정하면** 모든 오브젝트가 같은 박자로 바뀌고 `기다리기` 누적 오차도 없다. 프로젝트 타이머는 실행 시작 때 켜 둔다([07 초시계](07-runtime-quirks.md#프로젝트-초시계의-원점과-표시값은-다르다)).
- 같은 모양이면 바꾸지 않는다 → 매 틱 모양 바꾸기 비용이 없다.
- 중요한 연출 중(예: 단서를 강조하는 연출이 진행되는 동안)엔 멈춤 조건을 둔다 — 화면 전체가 멈춰 그 순간이 선다.
- ⚠️ **보일링 오브젝트에 `다음 모양`(`change_to_next_shape`) 금지** — 같은 자세의 다음 장으로 간다. 두 자세를 번갈아 걷던 오브젝트는
  `만약 모양 번호 < 4 이면 B 로, 아니면 A 로` 처럼 자세 이름·번호로 바꾼다.
- 한 오브젝트에 보일링 없는 그림이 섞이면 같은 그림을 세 번 넣는다 — 같은 파일 경로는 번들에 한 번만 들어간다(`make-ent` 는 경로로 중복을 거른다).

### 검증

모양 번호를 30ms 마다 1.2초 재서: 세 장이 모두 나옴 · 바뀐 횟수 5~10 · 자세(세 장 묶음) 그대로 · 여러 오브젝트의 차례(`(번호−1) mod 3`)가 90% 이상 같음.
대사 중에는 글자 칸의 자리·크기가 전후 같은지, 멈춤 조건 동안 바뀐 횟수가 0 인지 본다. 움직임의 느낌(세기)은 사람 눈으로 따로 본다.

## 장면 조립(팝업북) — 조각을 하나씩 붙이며 장면 열기

장면이 처음 보일 때 **배경만 먼저** 드러나고 문·창·물건·인물 스티커가 하나씩 "붙는" 연출. 종이 콜라주 화풍에 맞고, 대사가 시작되기 전에
무엇을 누를 수 있는지 한 번씩 보여 준다(2026-09-29 비공개 로컬 스토리 게임, 장면 6개).

```js
// 1) 조각은 장면 시작 때 숨긴다(첫 공개 전 — 암막 뒤)
o.script.push(...starts(sc, [hide()]),
// 2) 감독의 신호에 맞춰 시차를 두고 붙는다: 조금 크고 기운 채 나타나 두 계단 만에 제자리
    [when.message('assemble'), wait(0.12 + i * 0.08),
        scaleTo(key, s * 1.14), rotAbs(rot + 4), show(), ...sfx('stick'), wait(0.05),
        scaleTo(key, s * 1.05), rotAbs(rot + 1.5), wait(0.05), scaleTo(key, s), rotAbs(rot)]);
// scaleTo = set_scale_size 에 (폭+높이)/2 × 배율 — 퍼센트가 아니다(07 크기)
// 3) 감독: 첫 공개(암막 걷기) 바로 뒤
sendMessageWait('fade_in'), sendMessageWait('assemble'), ...says(…)
```

- **`신호 보내고 기다리기`는 모든 리스너의 `기다리기`까지 기다린다**([07 정정](07-runtime-quirks.md#message_cast-핸들러는-동시-실행--같은-메시지-다중-리스너-race)) — 조각이 다 붙은 뒤에 대사가 시작된다.
- 기존 시작 스크립트가 `보이기`를 해도, 뒤에 덧붙인 `숨기기` 스크립트가 같은 틱에 이어 돌아 첫 공개 때 조각은 0개였다(측정).
  이 순서에 기대기 싫으면 시작 스크립트의 `보이기`를 빼고 조립만 보이게 한다.
- 순서는 **환경(문·창·표지판) → 물건 → 인물**, 간격 0.08초, 조각마다 작은 종이 소리. 조각 6~9개면 0.3~0.7초.
- 빼는 것: 보이기/숨기기를 매 틱 스스로 정하는 오브젝트(대사창·소지품 표시 등), 이미 움직이는 장면(낙하 등), 처음엔 숨어 있다 연출로 나오는 것.
- 배경에서 오려 낸 조각은 배경 그림에도 같은 물건이 그려져 있어, 빈 배경 → 흰 테두리 스티커가 제자리에 "붙는" 모습이 된다.
- 효과음을 조각마다 내면 짧은 간격으로 여러 번 부르게 된다 → 이름 변수 하나로 내면 앞 소리가 사라진다([07 신호 핸들러 차례](07-runtime-quirks.md#신호-핸들러는-받는-오브젝트의-차례에-돈다--보낸-쪽이-곧바로-바꾼-변수를-읽는다)). 리스트 줄로 낸다.
- 검증: 화면을 그릴 때마다(`Entry.stage.update` 감싸기, [05](05-host-editor.md#그릴-때마다-재기--entrystageupdate-감싸기)) 암막이 처음 걷힌 프레임의 조각 수(0), 조각별 처음 보인 시각의 순서, 전체 폭을 잰다.

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
| 1. 정적 | `make-ent --check` | < 1 초 | 블록·슬롯, 변수/함수/장면 등의 참조, ID 중복, 로컬 에셋 |
| 2. 빌드 | `make-ent` (no `--check`) | 1-2 초 | 정적 검사 자동 실행, 에셋 번들링, JSON 직렬화 |
| 3. 구조·로드 | `npm run test:smoke` + `npm run test:e2e` | 수 초~수 분 | tar/JSON 구조·참조·에셋 회귀 검사 + 실제 Entry 로드 |
| 4. runtime | `npm run verify:runtime` (`tools/` + `games/`) | 시나리오별 상이 | 변수 변화, 메시지 발화, 클론 카운트, **시각 픽셀 검증**, **실제 click hit-test** |

**4 의 sub-layer**:
- `Entry.dispatchEvent('entityClick', e)` — 핸들러 로직만 검증 (hit-test 우회). UI 회귀 가드로 부족.
- `page.mouse.click(px, py)` + canvas 좌표 변환 — pixel hit-test 까지 검증. 투명 영역 클릭 무반응 같은 함정 잡기.
- `findColoredPixels(page, '#fbbf24')` — 빔/효과의 시각 검증.

frontier-guard 의 회귀 가드 (46/46 pass) 는 4 레이어 + 모든 sub-layer 활용. 새 fixture 도 같은 레이어링 권장.

## 실제 작품에서 확인한 설계 사례

| 만들려는 것 | 참고할 설계 | 정본 |
| --- | --- | --- |
| 대규모 RPG | 공통 배치 함수, 복제본별 상태와 병렬 리스트, 대화 입력 단계, 저장 직렬화와 외부 연동 경계 | [RPG 사례](09-rpg-case-study.md) |
| 뮤직비디오 | 타이머의 누적 마감시각, 모양 프레임 시퀀스, 신호별 독립 레이어 | [뮤직비디오 사례](10-music-video-case-study.md) |
| 회전하는 3D 정육면체 | 직교투영, 꼭짓점과 법선의 회전, 앞면 선택과 조명 | [3D 사례](11-3d-game-case-study.md) |
| 공 타격 전투·웨이브·스킬 보상 | 단계별 전투, 고정 인덱스와 활성 ID 목록, 접촉별 피해 가드, 중복 없는 후보 추첨 | [A Ball 2 사례](12-a-ball-2-case-study.md) |
| 자동 바운스 + 맵 편집기 | 한글 타일 코드, 시간 설정을 본문 뒤에 저장, 시험 클리어와 저장 허용, 편집 시 검증 무효화 | [BOUNCY BALL 사례](13-bouncy-ball-case-study.md) |
| 1인칭 던전 로그라이크 | 카메라 평면 DDA, 조각별 깊이 가림, 벽 캐시, BFS 작업 버퍼, 입력 완주 검증 | [심연의 성채 사례](14-abyssal-keep-case-study.md) |

09〜13은 2026-09-10 제공된 파일의 정적 분석이다. 동작 의도와 관측 가능한 블록 구조를 구분하며,
원본 해시와 블록 위치는 [근거 재검증 절차](evidence/README.md)로 확인한다.
14는 직접 제작한 작품의 로컬 런타임 사례이며, 해당 문서에 실행 환경·측정값·완주 기록을 연결했다.

## 검증 — 잘못된 블록 잡기

### 정적 검사와 smoke 테스트

`make-ent --check`는 블록 type·슬롯 형태뿐 아니라 선언된 변수·리스트·신호·함수·장면 참조,
명시된 ID 중복, 로컬 에셋 파일 존재 여부도 검사한다. 문자열 형태의 script/content도 파싱한다.
빌드 시 같은 검사가 자동 실행되므로 `--check`를 생략해도 오류가 있는 spec은 생성되지 않는다.

`npm run test:smoke`는 기존 `.ent`의 tar/JSON·블록 구조를 검사하고, fixture 소스 전체를
메모리에서 다시 빌드해 참조와 에셋을 확인한다. 에셋 보존·저장 실패·검증 파일 탐색 회귀 검사도 포함한다.

계산된 참조의 실제 값, 외부 URL의 접근 가능 여부, 실행 중 변수 변화와 화면 동작은 정적 검사만으로
보장하지 않는다. 브라우저 로드와 `tools/`·`games/` 런타임 검증을 함께 실행한다.

수동 확인:
```js
const reg = require('./tools/block-registry.json').blocks;
const b = JSON.parse(obj.script)[0][0];  // thread 0, block 0
console.log(b.type, 'expected', reg[b.type].paramCount, 'got', b.params.length);
```
