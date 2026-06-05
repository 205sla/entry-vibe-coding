# `temp/project.json` 스키마

tar 내부에 있는 유일한 JSON 파일. 프로젝트의 모든 상태가 여기 담긴다.

## 최상위 키

[`entryjs/src/class/project.js:76`](../../../upstream/entryjs/src/class/project.js#L76) `Entry.getStartProject()`와
레퍼런스 `C:\Users\young\Downloads\260423_작품.ent` (저장소 외부, 사용자 로컬)에서 관찰한 내용을 합쳤다.

### 필수

| 키 | 타입 | 비고 |
|----|------|------|
| `name` | string | 프로젝트 이름 |
| `scenes` | array | 장면 (최소 1개, id는 4자 영숫자 아무거나. 호스트에서 `clearProject()` 선행만 보장되면 된다 — 자세한 건 [Scene 항](#scene)) |
| `variables` | array | 변수·리스트·타이머·대답 공용 배열 |
| `objects` | array | 오브젝트 |
| `speed` | number | 초당 틱 (기본 60) |

### 필수에 가까운 것 (없으면 로드 중 크래시)

| 키 | 타입 | 비고 |
|----|------|------|
| `interface` | object | `{ canvasWidth, object }`. `object`는 **초기 선택 오브젝트 id**. null이면 `addChildAt(undefined)` 크래시 |
| `functions` | array | 사용자 함수. 기본 `[]` |
| `messages` | array | 신호. 기본 `[]` |
| `tables` | array | 데이터분석 테이블. 기본 `[]` |
| `expansionBlocks` | array | 확장 블록 사용 목록. 기본 `[]` |
| `aiUtilizeBlocks` | array | 인공지능 활용. 기본 `[]` |
| `hardwareLiteBlocks` | array | 실과형 하드웨어. 기본 `[]` |
| `externalModules` | array | 외부 블록 모듈. 기본 `[]` |
| `externalModulesLite` | array | 외부 Lite 모듈. 기본 `[]` |
| `isPracticalCourse` | boolean | 실과 과정 여부. 기본 `false` |

### 선택 (있으면 쓰이지만 없어도 됨)

| 키 | 타입 | 비고 |
|----|------|------|
| `category` | string | 분류 태그 (`game`, `art`, ...) |
| `parent` | string | 부모 프로젝트 ID (리믹스). 우리는 쓰지 않음 |
| `learning` | ID | AI Learning 모델 ID. 공식 [project-data typedef](https://github.com/entrylabs/docs/blob/master/source/entryjs/typedef/2024-03-15-project-data.md) 명시. `Entry.aiLearning.load(project.learning)`로 사용 ([`entryjs/src/util/utils.js:51`](../../../upstream/entryjs/src/util/utils.js#L51)) |

### playentry.org 전용 (커뮤니티 메타데이터, 우리는 쓰지 않음)

`childCnt`, `comment`, `isopen`, `likeCnt`, `recentLikeCnt`, `visit` — 레퍼런스 파일에는 있지만
편집기 로드에는 영향 없음.

## Scene

```json
{ "id": "ab12", "name": "장면 1" }
```

| 필드 | 비고 |
|------|------|
| `id` | 4자 소문자 영숫자. 아무 값이나 가능 (make-ent는 `shortId()`로 랜덤 생성). 호스트 편집기에서 `Entry.clearProject()`를 선행하면 버전/id에 관계없이 로드됨 — [자세한 배경](07-runtime-quirks.md#entryclearproject--loadproject-전-필수) |
| `name` | 표시명 |

`objects[*].scene`은 이 `id` 중 하나와 반드시 일치.

> **참고**: Entry 내장 `Entry.loadProject()` (no args) starter는 scene id를
> `"7dwq"`로 하드코딩 ([`entryjs/src/class/project.js:82`](../../../upstream/entryjs/src/class/project.js#L82)).
> 하지만 이 건 Entry가 내부적으로 쓰는 초기 프로젝트일 뿐 우리 `.ent`에 강제되는 값이 아니다.
> playentry.org에 업로드된 실제 작품들의 scene id도 제각각이다 (장면 편집 과정에서 id 변경).

## Variable / List / Timer / Answer / Slide

같은 `variables` 배열에 `variableType` 필드로 구분.
공식 [variable-data typedef](https://github.com/entrylabs/docs/blob/master/source/entryjs/typedef/2024-03-15-variable-data.md)
기준 전체 필드:

```json
{
  "id": "abcd",
  "variableType": "variable",    // variable | list | timer | answer | slide
  "name": "점수",
  "value": "0",                  // 문자열
  "minValue": 0,                 // slide 전용: 최솟값
  "maxValue": 100,               // slide 전용: 최댓값
  "visible": true,
  "x": 10, "y": 10,              // 무대 좌표 (중앙 0,0, 우/상 +)
  "width": 100,                  // list 모니터 가로
  "height": 120,                 // list 모니터 세로
  "isCloud": false,
  "isRealTime": false,           // (선택)
  "cloudDate": false,            // (선택)
  "object": null,                // 지역 변수면 오브젝트 id
  "array": []                    // list 전용: [{"data":"값"},...]
}
```

| `variableType` | 전용 필드 | 설명 |
|----------------|-----------|------|
| `variable` | — | 일반 변수 |
| `list` | `array`, `width`, `height` | 리스트. 요소는 `{"data": "값"}` 객체 |
| `timer` | — | 타이머(초) |
| `answer` | — | 대답 (묻고 기다리기 블록 결과) |
| `slide` | `minValue`, `maxValue` | 슬라이더 변수 — 무대 위에서 사용자가 드래그로 조절 |

### 공유 리스트 (`isCloud: true`)

리스트(혹은 변수)에 `isCloud: true`를 세팅하면 **playentry.org 계정의 클라우드에 저장**되어
같은 프로젝트를 여러 사람/여러 세션이 공유한다. 대표 용도: **랭킹/스코어보드**.

```json
{ "id": "ranking", "name": "🏆 랭킹",
  "variableType": "list", "visible": true, "isCloud": true,
  "x": 90, "y": 20, "width": 170, "height": 210, "array": [], ... }
```

- 오프라인(이 저장소의 MYentry-game 편집기)에서는 브라우저 세션 범위에서만 유효.
  `.ent` 파일 자체에는 초기 `array`만 저장됨 — 실행 중 추가된 값은 `isCloud: false` 리스트와 동일하게
  세션 종료 시 사라짐.
- playentry.org에 업로드하면 서버가 리스트 내용을 계정별로 유지.
- 클라우드 변수/리스트는 실시간 변경 동기화가 기본 — `isRealTime: true` 추가 시 다른 세션의 업데이트도 받음.

### Timer / Answer (Entry 기본 프로젝트에 항상 존재)

```json
{ "name": "타이머", "id": "brih", "visible": false, "value": "0",
  "variableType": "timer", "x": 134, "y": -70, "array": [], "object": null, "isCloud": false }
{ "name": "대답",   "id": "1vu8", "visible": false, "value": "0",
  "variableType": "answer", "x": 150, "y": -100, "array": [], "object": null, "isCloud": false }
```

우리 `make-ent.mjs`는 이 둘을 자동 추가하지 않는다. 필요하면 spec에서 명시.
(TODO: 자동 추가가 맞는지 확인 필요 — Entry가 기본 프로젝트에는 넣지만 사용자 프로젝트 요구사항인지 불명)

## interface

공식 [interface-state typedef](https://github.com/entrylabs/docs/blob/master/source/entryjs/typedef/2024-03-15-interface-state.md):

```json
{ "canvasWidth": 640, "menuWidth": 280, "object": "<objects[0].id>" }
```

- `canvasWidth`: 스테이지 영역 폭. 기본 640.
- `menuWidth`: 블록 메뉴 영역 폭. 공식 필드 — 생략 가능.
- `object`: **현재 선택된 오브젝트의 id**. null 또는 존재하지 않는 id면 로드 중 `addChildAt(undefined)` 크래시. make-ent는 자동으로 `objects[0].id` 채움 ([lessons.md](lessons.md)).

## 전체 예시 (최소)

```json
{
  "name": "테스트",
  "scenes": [{ "id": "ab12", "name": "장면 1" }],
  "variables": [],
  "objects": [ /* ... Object 섹션 참조 ... */ ],
  "functions": [], "messages": [], "tables": [],
  "expansionBlocks": [], "aiUtilizeBlocks": [], "hardwareLiteBlocks": [],
  "externalModules": [], "externalModulesLite": [],
  "isPracticalCourse": false,
  "interface": { "canvasWidth": 640, "object": "<objects[0].id>" },
  "speed": 60
}
```
