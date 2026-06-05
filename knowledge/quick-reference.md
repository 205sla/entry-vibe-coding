# `.ent` 포맷 빠른 레퍼런스

> 이 문서는 **요약**입니다. 각 항목별 상세는 같은 디렉터리의 다른 `*.md` 파일을 보세요 ([README](README.md) 목차).

`.ent` = **gzip + ustar tar**. 내부에 `temp/project.json` + 해시 샤딩된 에셋들.

## 30초 요약

```
<your>.ent  ≡  gzip(tar([
    temp/                           ← dir (mode 000755)
    temp/<XX>/                      ← dir (level-1)
    temp/project.json               ← 프로젝트 JSON 본체
    temp/<XX>/<YY>/                 ← dir (level-2)
    temp/<XX>/<YY>/image/           ← dir (level-3)
    temp/<XX>/<YY>/thumb/
    temp/<XX>/<YY>/sound/
    temp/<XX>/<YY>/image/<hash>.png
    temp/<XX>/<YY>/thumb/<hash>.png
    temp/<XX>/<YY>/sound/<hash>.mp3
]), { memLevel: 6 })
```

- **tar 포맷**: npm `tar.c({portable: true})` 출력과 바이트 동일. 디렉터리 mode `000755`,
  파일 mode `000644`, uid/gid/uname/gname NUL, 디렉터리 mtime NUL.
- **해시**: `uid(8) + puid.generate()` 공식 알고리즘, 32자 base36 (`[0-9a-z]`).
- **샤딩**: `d1 = hash[0:2]`, `d2 = hash[2:4]` → `temp/<d1>/<d2>/...`
- **이미지**: 항상 PNG (SVG 입력은 sharp로 래스터라이즈). thumb은 96px PNG.

## project.json 최소 유효 shape

```json
{
  "name": "my game",
  "scenes": [{ "id": "ab12", "name": "장면 1" }],
  "variables": [],
  "objects": [
    {
      "id": "o1",
      "name": "object",
      "script": "[[]]",
      "selectedPictureId": "p1",
      "objectType": "sprite",
      "rotateMethod": "free",
      "scene": "ab12",
      "sprite": { "pictures": [/* ... */], "sounds": [] },
      "entity": { /* x, y, regX, regY, scaleX, scaleY, direction, width, height, visible */ },
      "lock": false
    }
  ],
  "functions": [], "messages": [], "tables": [],
  "expansionBlocks": [], "aiUtilizeBlocks": [], "hardwareLiteBlocks": [],
  "externalModules": [], "externalModulesLite": [],
  "isPracticalCourse": false,
  "interface": { "canvasWidth": 640, "menuWidth": 280, "object": "o1" },
  "speed": 60
}
```

놓치면 크래시 나는 것들:
- **사용자 `.ent` 로드 전 반드시 `Entry.clearProject()`** — 이게 scene id/version을 초월해서 매끄러운 로드를 보장하는 핵심 ([`07-runtime-quirks.md §clearProject`](07-runtime-quirks.md#entryclearproject--loadproject-전-필수))
- `interface.object`는 `objects[0].id` — null이면 `addChildAt(undefined)`
- `script`는 JSON.stringify된 문자열, 최소 `"[[]]"`
- scene id는 4자 영숫자 아무거나 — `"7dwq"` 강제 아님 (2026-04-24 정정)

## 블록 규칙 (요약)

- `params` 슬롯 개수는 레지스트리 `paramCount`와 일치해야 함 ([`../tools/block-registry.json`](../tools/block-registry.json))
- 값 래퍼 블록(`number`, `text`, `True`, `False`, `get_variable` 등)은 **leaf** — 재귀 정규화 금지
- Dropdown 필드 값은 **bare string** (블록으로 감싸지 말 것) — `"mouse"`, `"player"`, `"EQUAL"` 등

## 변수 좌표 함정

- **`x === 0` 또는 `y === 0` → bin-packer 폴백** ([`variable.js:127`](../../../upstream/entryjs/src/class/variable/variable.js#L127) truthy check). 그리드/원형 배치 시 ±1 시프트나 0.5 오프셋으로 회피. 자세히는 [`07-runtime-quirks.md`](07-runtime-quirks.md) "변수 좌표 x=0 또는 y=0".
- **Variable y > 0 = 화면 아래** (entity 와 부호 반대). entity 는 `setY` 에서 반전하지만 variable 은 안 함. 원형 배치 시 `y = cy - r*cos(θ)` (cos 앞 마이너스). 자세히는 [`07-runtime-quirks.md`](07-runtime-quirks.md) "Variable Y vs Entity Y".

## 어디를 더 읽을지

| 더 깊게 알려면 | |
|---|---|
| 바이너리 포맷 (tar/gzip 헤더 바이트) | [`01-binary-format.md`](01-binary-format.md) |
| project.json 스키마 + 변수/리스트/interface | [`02-project-json.md`](02-project-json.md) |
| Object·Entity·Picture·Sound 필드 | [`03-objects-and-assets.md`](03-objects-and-assets.md) |
| 블록 타입 레퍼런스 + params 구조 + 필드 vs 블록 | [`04-script-and-blocks.md`](04-script-and-blocks.md) |
| 편집기(entryjs) 오프라인 호스팅 | [`05-host-editor.md`](05-host-editor.md) |
| Entry 엔진의 불변 동작 (60fps 반복, short-circuit, 키 이벤트 등) | [`07-runtime-quirks.md`](07-runtime-quirks.md) |
| 과거에 해결한 버그 요약 (가드 링크) | [`lessons.md`](lessons.md) |
| 엔트리랩스 공식 문서 인덱스 | [`00-official-sources.md`](00-official-sources.md) |
| 날짜별 학습 로그 | [`CHANGELOG.md`](CHANGELOG.md) |

## 생성 툴

```bash
# spec JSON → .ent
node tools/make-ent.mjs tests/fixtures/spec-<name>.json tests/fixtures/<name>.ent

# 검증
npm run verify
```

spec JSON 작성법은 저장소 루트의 [`../README.md`](../README.md) "② spec JSON" 섹션 참조.
