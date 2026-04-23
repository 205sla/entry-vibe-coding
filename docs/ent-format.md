# `.ent` 파일 포맷 레퍼런스

엔트리(entryjs) `.ent` 파일을 스크립트로 생성·검증하기 위한 구조 명세.
이 문서는 이 저장소의 `tools/make-ent.mjs` + `tests/smoke.test.js`가 실제로
검증·생성하는 포맷을 따른다. 외부 LLM이 이 문서만 읽고도 동작하는
`.ent`를 재생성할 수 있도록 작성했다.

레퍼런스 출처:
- 기본 프로젝트 shape: [`entryjs/src/class/project.js:76`](../../entryjs/src/class/project.js) `Entry.getStartProject()`
- 블록 정의: [`entryjs/src/playground/blocks/block_*.js`](../../entryjs/src/playground/blocks/)
- export 절차 (tar/gzip 바이트 레이아웃): [`MYentry/server.js:178-227, 413-556`](../../MYentry/server.js)

---

## 1. 컨테이너: tar.gz

`.ent` 파일은 **ustar tar** 아카이브를 **gzip**으로 압축한 단일 파일이다.
파일 최상위에는 MIME 바이너리가 아니라 tar 헤더가 바로 들어간다.

### 1.1 tar 헤더 (ustar)

각 엔트리는 512-byte 헤더 + 데이터 + 512 배수로 패딩. 마지막에 두 개의
전부 NUL인 512-byte 블록(= 1024 바이트)을 붙여 아카이브 종료를 표시한다.

헤더 필드 (entryjs 서버 업로더가 엄격히 체크하는 값):

| offset | len | 내용 |
|-------:|---:|------|
| 0      | 100 | 파일명 (UTF-8) |
| 100    | 8   | mode: 디렉터리 `"000755 \0"`, 파일 `"000644 \0"` (공백 1개 + NUL) |
| 108    | 8   | uid — 모두 NUL (portable) |
| 116    | 8   | gid — 모두 NUL |
| 124    | 12  | size (octal) + NUL, 11자리 zero-pad |
| 136    | 12  | mtime — 디렉터리는 전부 NUL, 파일은 `floor(Date.now()/1000).toString(8)` |
| 148    | 8   | checksum — 처음엔 공백 8개로 채우고 체크섬 계산 후 `sum.toString(8).padStart(6,'0') + '\0 '` |
| 156    | 1   | typeflag: 파일 `'0'`, 디렉터리 `'5'` |
| 257    | 6   | `"ustar\0"` (magic) |
| 263    | 2   | `"00"` (version) |
| 265    | 32  | uname — NUL |
| 297    | 32  | gname — NUL |

중요: **디렉터리 mode가 0644면 entryjs 서버가 디렉터리 생성을 건너뛰고
그 아래 파일들이 전부 404가 된다**. 반드시 `000755 \0`.

### 1.2 gzip

`zlib.gzipSync(tar, { memLevel: 6 })`. entryjs 공식 export와 동일 세팅.

### 1.3 레이아웃 (flush 순서)

entryjs 자체 export와 동일한 순서로 내보낸다:

```
temp/                                    ← 최상위 dir
temp/<XX>/                               ← level-1 dirs
temp/project.json                        ← 프로젝트 본체
temp/<XX>/<YY>/                          ← level-2 dirs
temp/<XX>/<YY>/image|thumb|sound/        ← level-3 dirs
temp/<XX>/<YY>/image/<hash>.svg           ┐
temp/<XX>/<YY>/image/<hash>.png           │ asset payloads
temp/<XX>/<YY>/thumb/<hash>.png           │
temp/<XX>/<YY>/sound/<hash>.mp3           ┘
```

---

## 2. `temp/project.json` 최상위

UTF-8 JSON 단일 객체. 주요 키:

| 키 | 타입 | 필수 | 설명 |
|----|------|:---:|------|
| `name`              | string  |  ✔ | 프로젝트 이름 |
| `scenes`            | array   |  ✔ | 장면 목록 (최소 1개) |
| `variables`         | array   |  ✔ | 변수·리스트·타이머·대답 |
| `objects`           | array   |  ✔ | 오브젝트 목록 |
| `functions`         | array   |   | 사용자 정의 함수 |
| `messages`          | array   |   | 신호 목록 |
| `tables`            | array   |   | 데이터분석 테이블 |
| `expansionBlocks`   | array   |   | 확장 블록 사용 목록 (`[]`이면 미사용) |
| `aiUtilizeBlocks`   | array   |   | 인공지능 활용 블록 |
| `hardwareLiteBlocks`| array   |   | 실과형 하드웨어 블록 |
| `externalModules`   | array   |   | 외부 블록 모듈 |
| `externalModulesLite`| array  |   | 외부 Lite 모듈 |
| `interface`         | object  |  ★ | `{ canvasWidth, object }` — `object`는 **현재 선택된 오브젝트 id**. `null`로 두면 `addChildAt(undefined)` 발생 |
| `isPracticalCourse` | boolean |   | 실과 과정 여부 |
| `speed`             | number  |   | 초당 틱 (기본 60) |
| `category`          | string  |   | 분류 태그 (`game`, `art`, ...) |

★ `interface.object`가 null이거나 존재하지 않는 id를 가리키면 EaselJS
`addChildAt(undefined)`에서 크래시한다. 반드시 `objects[0].id`를 넣을 것.

### 2.1 첫 번째 장면 id는 `7dwq`로

Entry 내장 `Entry.loadProject()` (인자 없이) 호출 시 첫 장면 id가
**`"7dwq"`로 하드코딩**돼 있다. 에디터가 초기 상태에서 그 id에
바인딩돼 있기 때문에, 다른 id로 시작하는 `.ent`를 불러오면 기존
stage 참조가 끊어지며 같은 `addChildAt(undefined)` 에러가 난다.
첫 장면 id는 항상 `"7dwq"`로 둔다.

---

## 3. Scene

```json
{ "id": "7dwq", "name": "장면 1" }
```

| 키 | 타입 | 필수 | 설명 |
|----|------|:---:|------|
| `id`   | string |  ✔ | 첫 scene은 `"7dwq"`, 나머지는 4자 소문자영숫자 |
| `name` | string |  ✔ | 표시명 |

오브젝트의 `scene` 필드는 이 `id` 중 하나와 일치해야 한다.

---

## 4. Variable / List / Timer / Answer

같은 `variables` 배열에 모두 담긴다. `variableType`으로 구분.

```json
{
  "name": "점수",
  "id": "abcd",
  "visible": true,
  "value": "0",
  "variableType": "variable",
  "x": 10, "y": 10,
  "array": [],
  "object": null,
  "isCloud": false
}
```

| `variableType` | 추가 필드 | 설명 |
|----------------|-----------|------|
| `variable`     | — | 일반 변수 |
| `list`         | `array: [{"data":"값"},...]`, `width`, `height` | 리스트. `value`는 관례상 `"0"` |
| `timer`        | — | 타이머(초). Entry 기본 프로젝트에 항상 존재 |
| `answer`       | — | `대답` — 묻고 기다리기 블록 결과 |

공통 필드:

| 키 | 기본값 | 비고 |
|----|--------|------|
| `visible`      | true | 무대에 표시 여부 |
| `value`        | `"0"` | 문자열로 저장 |
| `x`, `y`       | 10, 10 | 변수 모니터 좌표. 무대 중심이 (0,0), 우측/위가 양수 |
| `object`       | null | 특정 오브젝트 지역 변수면 해당 id |
| `array`        | [] | 리스트일 때만 의미 있음 |
| `isCloud`      | false | 클라우드 변수 |
| `isRealTime`   | false | 실시간 변수 |

---

## 5. Object

```json
{
  "id": "abcd",
  "name": "객체1",
  "script": "[[ ... ]]",
  "selectedPictureId": "pic1",
  "objectType": "sprite",
  "rotateMethod": "free",
  "scene": "7dwq",
  "sprite": { "pictures": [...], "sounds": [...] },
  "entity": { ... },
  "lock": false
}
```

| 키 | 필수 | 비고 |
|----|:---:|------|
| `id`                | ✔ | 4자 소문자영숫자 권장 |
| `name`              | ✔ | 표시명 |
| `script`            | ✔ | **JSON 직렬화된 문자열** (평면 JSON이 아님!). 빈 프로젝트면 `"[[]]"` (빈 thread 하나). `"[]"`는 Entry 로더가 거부 |
| `selectedPictureId` | ✔ | 현재 선택된 picture id — `sprite.pictures[*].id` 중 하나 |
| `objectType`        | ✔ | `"sprite"` (이미지) / `"textBox"` (글상자) |
| `rotateMethod`      | ✔ | `"free"` / `"vertical"` / `"none"` |
| `scene`             | ✔ | `scenes[*].id` 중 하나 |
| `sprite`            | ✔ | `pictures`, `sounds` |
| `entity`            | ✔ | 좌표·크기·각도·가시성 |
| `lock`              | ✔ | 편집 잠금 |

### 5.1 Entity

```json
{
  "x": 0, "y": 0,
  "regX": 100, "regY": 120,
  "scaleX": 0.5128, "scaleY": 0.5128,
  "rotation": 0, "direction": 90,
  "width": 200, "height": 240,
  "font": "undefinedpx ",
  "visible": true
}
```

| 필드 | 설명 |
|------|------|
| `x`, `y`       | 무대 좌표. 무대 중앙 (0,0), 우측/위가 양수. 기본 무대 240×135 |
| `regX`, `regY` | 회전·스케일 기준점. 관례상 `width/2`, `height/2` |
| `scaleX`, `scaleY` | 이미지 배율 |
| `direction`    | 진행 방향 (도). `90`이 오른쪽 |
| `rotation`     | 시각적 회전 (도) |
| `width`, `height` | 보통 첫 picture의 `dimension`과 일치 |
| `font`         | textBox일 때만 의미. sprite는 `"undefinedpx "` 관례 |
| `visible`      | 무대 표시 여부 |

### 5.2 Picture

```json
{
  "id": "pic1",
  "fileurl": "/images/mascot/bot205-idle.svg",
  "thumbUrl": "/images/mascot/bot205-idle.svg",
  "name": "205봇_서기",
  "imageType": "svg",
  "dimension": { "width": 200, "height": 240 }
}
```

| 필드 | 설명 |
|------|------|
| `id`         | 오브젝트 내에서 유일. `selectedPictureId`로 참조 |
| `fileurl`    | **세 가지 형태**: `/public/` 하위 경로 (`/images/...`), tar 내 경로 (`temp/aa/bb/image/<hash>.svg`), `data:`/`http(s):` URI |
| `thumbUrl`   | 썸네일 경로. 보통 `fileurl`과 동일 |
| `name`       | 화면 표시명 |
| `imageType`  | `"svg"` / `"png"` / `"jpg"` / `"jpeg"` / `"gif"` / `"webp"` |
| `dimension`  | 원본 크기 |
| `filename`   | (tar 번들 케이스) 32자 소문자영숫자 해시 |

### 5.3 Sound

```json
{
  "id": "snd1",
  "fileurl": "temp/aa/bb/sound/<hash>.mp3",
  "filename": "aabb...32char",
  "ext": ".mp3",
  "name": "강아지 짖는 소리",
  "duration": 1.3
}
```

---

## 6. Script (블록 스크립트)

`object.script`는 **JSON 직렬화된 문자열**. 파싱하면:

```
[                       ← 오브젝트의 스크립트 묶음
  [                     ← thread (1개 이상, 최소 1개 필요)
    { block0 },         ← 블록이 위→아래로 실행되는 체인
    { block1 },
    ...
  ],
  [  ... ],             ← 독립된 다른 thread (여러 시작 블록)
]
```

### 6.1 Block

```json
{
  "id": "qhj4",
  "x": 40, "y": 50,
  "type": "repeat_basic",
  "params": [{ "type": "number", "params": ["10"] }, null],
  "statements": [ [ /* 감싸진 thread */ ] ],
  "movable": null, "deletable": 1,
  "emphasized": false, "readOnly": null,
  "copyable": true, "assemble": true,
  "extensions": []
}
```

| 필드 | 필수 | 설명 |
|------|:---:|------|
| `type`       | ✔ | `tools/block-registry.json`의 키 (`move_direction`, `_if`, `get_variable`, ...) |
| `params`     | ✔ | 길이는 블록의 `paramCount`. 빈 슬롯은 `null`, 리터럴은 `{type:'number',params:['10']}`, 중첩 블록은 또 하나의 Block |
| `statements` | 조건부 | 블록에 감싸는 영역이 있으면 (`repeat_basic`, `_if`, `if_else` 등). 각 원소는 thread 배열 |
| `id`         |   | 4자 해시. 생략하면 Entry가 자동 부여하려다 실패하는 경우 있음 — **반드시 부여 권장** |
| `x`, `y`     |   | thread 시작 블록에만 의미 있음 (워크스페이스 좌표) |
| `movable..extensions` |  | 일반적으로 `null/1/false/true/[]` 기본. 직접 드래그해 만든 블록에만 필수는 아님 |

### 6.2 파라미터 리터럴 타입

| type          | 용도 | 예 |
|---------------|------|---|
| `number`      | 숫자 리터럴 | `{ "type":"number", "params":["10"] }` |
| `text`        | 문자열 리터럴 | `{ "type":"text", "params":["안녕"] }` |
| `angle`       | 각도(0-360) | `{ "type":"angle", "params":["90"] }` |
| `True`/`False`| 참·거짓 | `{ "type":"True", "params":[] }` |
| `get_variable`| 변수값 꺼내기 | `{ "type":"get_variable", "params":["<varId>", null] }` |

`make-ent.mjs`는 `params: [10, "안녕"]` 같이 적으면 위 리터럴로 자동 포장한다.

---

## 7. 자주 쓰는 블록 레퍼런스 (게임 제작 관점)

블록 id는 **`type`**, 파라미터 개수는 **paramCount** — 이 둘이 맞아야 런타임 경고 블록으로 표시되지 않는다.

### 7.1 Events

| type | params | statements | 주 key (`paramsKeyMap`) | 용도 |
|------|:--:|:--:|------|------|
| `when_run_button_click`         | 1 | 0 | — | 시작 버튼 |
| `when_some_key_pressed`         | 2 | 0 | VALUE=1 | 특정 키 누르면 (VALUE=키 코드, 예: `"space"`, `"up"`) |
| `when_message_cast`             | 2 | 0 | VALUE=1 | 신호 받기 (VALUE=메시지 id) |

### 7.2 Flow

| type | params | statements | paramsKeyMap | 용도 |
|------|:--:|:--:|------|------|
| `repeat_basic`      | 2 | 1 | VALUE=0 | N번 반복 (VALUE=반복 횟수) |
| `repeat_inf`        | 2 | 1 | — | 계속 반복 |
| `repeat_while_true` | 3 | 1 | BOOL=0 | 조건 동안 반복 |
| `wait_second`       | 2 | 0 | SECOND=0 | N초 기다리기 |
| `wait_until_true`   | 2 | 0 | BOOL=0 | 조건 될 때까지 기다리기 |
| `stop_repeat`       | 1 | 0 | — | 반복 끊기 |
| `_if`               | 2 | 1 | BOOL=0 | 만일 ~이면 |
| `if_else`           | 3 | 2 | BOOL=0 | 만일 ~이면 … 아니면 … |

### 7.3 Judgement / Boolean

| type | params | paramsKeyMap | 설명 |
|------|:--:|------|------|
| `boolean_and_or`          | 3 | LEFTHAND=0, OPERATOR=1, RIGHTHAND=2 | AND/OR (`"AND"`/`"OR"`) |
| `boolean_basic_operator`  | 3 | 동상 | 비교 (`"EQUAL"`, `"GREATER"`, `"LESS"`, `"NOT_EQUAL"`) |

### 7.4 Moving

| type | params | paramsKeyMap | 설명 |
|------|:--:|------|------|
| `move_direction` | 2 | VALUE=0 | 방향으로 N만큼 이동 |
| `locate_xy`      | 3 | VALUE1=0, VALUE2=1 | (x,y)로 이동 |
| `bounce_wall`    | 1 | — | 벽에 닿으면 튕기기 |

### 7.5 Looks

| type | params | paramsKeyMap | 설명 |
|------|:--:|------|------|
| `dialog`                   | 3 | VALUE=0, OPTION=1 | 말하기 (OPTION=`"speak"`/`"think"`) |
| `change_to_next_shape`     | 2 | DRIECTION=0 | 다음/이전 모양 (DRIECTION=`"next"`/`"prev"`, **오탈자 주의**) |

### 7.6 Variable / List

| type | params | paramsKeyMap | 설명 |
|------|:--:|------|------|
| `set_variable`            | 3 | VARIABLE=0, VALUE=1 | VARIABLE에 **변수 id** 지정 |
| `change_variable`         | 3 | 동상 | 변수값 증가 |
| `get_variable`            | 2 | VARIABLE=0 | 변수값 읽기 (리터럴 위치에서 사용) |
| `add_value_to_list`       | 3 | VALUE=0, LIST=1 | 리스트 맨 뒤 추가 |
| `remove_value_from_list`  | 3 | VALUE=0, LIST=1 | 특정 인덱스 삭제 |
| `value_of_index_from_list`| 5 | LIST=1, INDEX=3 | 리스트 N번째 값 읽기 |

### 7.7 Sound

| type | params | paramsKeyMap | 설명 |
|------|:--:|------|------|
| `sound_something_with_block`      | 2 | VALUE=0 | 소리 재생 (기다리지 않음) |
| `sound_something_wait_with_block` | 2 | VALUE=0 | 소리 끝까지 재생 |

### 7.8 Func (사용자 정의 함수)

| type | paramCount | 설명 |
|------|:---:|------|
| `function_general`       | 1 | 함수 호출 |
| `function_param_string`  | 0 | 문자열 파라미터 받는 함수 |

> 전체 목록·실시간 정확한 메타데이터는 `tools/block-registry.json`에서
> 언제든 조회할 수 있다. `node tools/build-block-registry.mjs`로 재생성.

---

## 8. 자산 해시 규칙

번들된 자산의 파일명/경로:

```
filename = <32자 소문자 영숫자>         (crypto.randomBytes → base36)
d1       = filename.slice(0, 2)
d2       = filename.slice(2, 4)
fileurl  = temp/<d1>/<d2>/image/<filename>.<ext>
thumbUrl = temp/<d1>/<d2>/thumb/<filename>.png
```

SVG는 같은 해시로 `.png` 사본도 함께 번들한다 (Entry는 SVG 옆에 PNG를 기대).
썸네일 PNG는 한 변 96px로 리사이즈 (`sharp`).

---

## 9. 로드 실패 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| 워크스페이스에 블록이 빈칸으로 표시 | `Entry.block[type]`에 등록 안 된 타입 / 오타 | `tools/block-registry.json`에서 확인. smoke 테스트가 이를 잡는다 |
| 이미지가 회색 사각형 | `fileurl`이 404 / tar의 mode가 0644로 잘못 기록됨 | 디렉터리 mode를 `000755`로. 경로를 server.js rewrite 규칙과 맞게 |
| 변수가 무대에 안 보임 | `variableType` 오타 (`valiable` 등) / `visible: false` | 소문자 `variable` 정확히 |
| 스크립트가 워크스페이스에 안 붙음 | `object.script`가 문자열이 아니라 평면 배열 | 반드시 `JSON.stringify([[...]])` |
| `Entry.loadProject()` 즉시 크래시, `addChildAt` undefined | ① `interface.object`가 null ② 첫 scene id가 `7dwq`가 아님 ③ `script: "[]"` (빈 thread 없음) | 1) objects[0].id로 설정 2) scene id = `7dwq` 3) 최소 `"[[]]"` |
| 실행 시 경고(빨간) 블록 | params 개수 불일치 / `statements`가 필요한 블록인데 없음 | 레지스트리 `paramCount`/`statementCount`와 일치시킴. smoke 테스트가 레지스트리에 없는 `type`은 잡지만 개수 불일치는 런타임 경고로 발견됨 |
| 한 번은 잘 열리는데 두 번째 .ent 열면 addChildAt 크래시 | 첫 scene id 불일치 (→ 표 바로 위 항목) | |

---

## 10. 레퍼런스 경로

- 기본 프로젝트: [`entryjs/src/class/project.js:76-196`](../../entryjs/src/class/project.js)
- 블록 정의 디렉터리: [`entryjs/src/playground/blocks/`](../../entryjs/src/playground/blocks/)
- 엔진 초기화: [`entryjs/src/util/init.js`](../../entryjs/src/util/init.js)
- tar/gzip export 구현 (포팅 원본): [`MYentry/server.js:178-227`](../../MYentry/server.js), [`MYentry/server.js:413-556`](../../MYentry/server.js)
- 이 저장소의 생성기: [`tools/make-ent.mjs`](../tools/make-ent.mjs)
- 레지스트리: [`tools/block-registry.json`](../tools/block-registry.json) (빌드: `npm run build:registry`)
- smoke 테스트가 검증하는 불변식: [`tests/smoke.test.js`](../tests/smoke.test.js)
