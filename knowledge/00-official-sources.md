# 공식 레퍼런스 출처 카탈로그

이 위키의 궁극적 근거는 **[entrylabs/docs](https://github.com/entrylabs/docs)** (GitHub)의
공식 문서다. 그 하위에서 우리가 참고한 문서의 직접 경로와 핵심 내용을 인덱싱.

의심 가는 주장이 있으면 이 표의 관련 문서를 먼저 확인.

## `.ent` 포맷 본문

| 문서 | 확인된 사실 |
|------|-------------|
| [`file/2024-07-24-ent.md`](https://github.com/entrylabs/docs/blob/master/source/entryjs/file/2024-07-24-ent.md) | tar + gzip memLevel 6. tar.c 호출 시 **`portable: true`** 옵션 사용. 파일구조 `temp/project.json` + `temp/aa/bb/image|thumb|sound/<hash>.<ext>`. 자산 파일명은 npm `uid(8) + puid.generate()` 조합. 추출 시 filter로 심볼릭 링크·크기·확장자 체크 |

공식 `tar.c` 호출 예:
```js
await tar.c({
    file: destination,
    gzip: { memLevel: 6 },
    cwd,
    filter: (path, stat) => !stat.isSymbolicLink(),
    portable: true,
}, [fileList]);
```

공식 추출 예:
```js
await tar.x({
    file: target,
    cwd: destination,
    filter: (path, entry) => {
        const { type, size } = entry;
        return type !== 'SymbolicLink' && maxSize > size && checkExtName(entry);
    },
});
```

공식 File ID 생성:
```js
const { uid } = require('uid');
const Puid = require('puid');
const puid = new Puid();
const createFileId = () => uid(8) + puid.generate();
// 예: "e49448cdlyy4s42e0013f820158i7nqj"
```

**make-ent.mjs는 2026-04-23 이후 공식 알고리즘(`uid + puid`)을 사용.**
server.js `/api/export`는 아직 `crypto.randomBytes → base36` 근사치(회귀 없어 교체 보류).

## 타입 정의 (typedef)

| 문서 | 필드 |
|------|------|
| [`typedef/2024-03-15-project-data.md`](https://github.com/entrylabs/docs/blob/master/source/entryjs/typedef/2024-03-15-project-data.md) | `speed, objects, variables, messages, functions, scenes, interface, tables, learning, aiUtilizeBlocks, expansionBlocks, hardwareLiteBlocks` |
| [`typedef/2024-03-15-object-data.md`](https://github.com/entrylabs/docs/blob/master/source/entryjs/typedef/2024-03-15-object-data.md) | `id, name, text, objectType('sprite'\|'textBox'), scene, lock, rotateMethod, entity, script, sprite, selectedPictureId` |
| [`typedef/2024-03-15-scene-data.md`](https://github.com/entrylabs/docs/blob/master/source/entryjs/typedef/2024-03-15-scene-data.md) | `id, name` |
| [`typedef/2024-03-15-variable-data.md`](https://github.com/entrylabs/docs/blob/master/source/entryjs/typedef/2024-03-15-variable-data.md) | `id, variableType('variable'\|'list'\|'timer'\|'answer'\|'slide'), name, value, minValue, maxValue, visible, x, y, width, height, isCloud, object, array` |
| [`typedef/2024-03-15-interface-state.md`](https://github.com/entrylabs/docs/blob/master/source/entryjs/typedef/2024-03-15-interface-state.md) | `canvasWidth, menuWidth, object` |
| [`typedef/2024-03-15-function-data.md`](https://github.com/entrylabs/docs/blob/master/source/entryjs/typedef/2024-03-15-function-data.md) | `id, content, type('normal'\|'value'), useLocalVariables, localVariables` |
| [`typedef/2024-03-15-message-data.md`](https://github.com/entrylabs/docs/blob/master/source/entryjs/typedef/2024-03-15-message-data.md) | `id, name` |
| [`typedef/2024-03-15-table-data.md`](https://github.com/entrylabs/docs/blob/master/source/entryjs/typedef/2024-03-15-table-data.md) | `id, name, fields, data, origin, chart, summary` |
| [`typedef/2024-03-11-init-options.md`](https://github.com/entrylabs/docs/blob/master/source/entryjs/typedef/2024-03-11-init-options.md) | 25개 필드 — [05-host-editor.md](05-host-editor.md#entryinit-옵션-공식-목록) 에 정리 |

## API 메서드

[`api/2024-02-29-api.md`](https://github.com/entrylabs/docs/blob/master/source/entryjs/api/2024-02-29-api.md) 에서:

| 메서드 | 설명 |
|--------|------|
| `Entry.init(container, options)` | 초기화. 페이지당 1회 |
| `Entry.loadProject(project)` | 프로젝트 JSON 로드. 인자 없으면 `getStartProject()` 반환값 사용 |
| `Entry.exportProject()` | 현재 상태를 Project Data로 반환 |
| `Entry.clearProject()` | 현재 상태 완전 초기화. **두 번째 `loadProject` 전에 반드시 호출** |
| `Entry.getStartProject(mediaFilePath)` | 기본 starter 프로젝트 생성. scene id `'7dwq'` 하드코딩 |
| `Entry.captureInterfaceState()` | 현재 UI 상태를 interfaceState로 추출 |
| `Entry.launchFullScreen()` / `exitFullScreen()` | 전체화면 |
| `Entry.isDefaultProject()` | 현재 프로젝트가 starter와 동일한지 |

## 시작하기 가이드

| 문서 | 내용 |
|------|------|
| [`started/2024-02-29-installation.md`](https://github.com/entrylabs/docs/blob/master/source/entryjs/started/2024-02-29-installation.md) | 의존성 라이브러리 로드 순서. 우리 `editor.html`과 일치 |
| [`started/2024-02-29-structure.md`](https://github.com/entrylabs/docs/blob/master/source/entryjs/started/2024-02-29-structure.md) | entryjs 내부 구조 |
| [`started/2024-03-05-run.md`](https://github.com/entrylabs/docs/blob/master/source/entryjs/started/2024-03-05-run.md) | 실행 방법 |

공식 CDN: `https://entry-cdn.pstatic.net/` (외부 의존 금지 규칙 때문에 우리는 사용 안 함).

## 우리 관측이 공식 문서와 어긋나는 부분

| 항목 | 공식 문서 | 우리 관측 | 결론 |
|------|-----------|-----------|------|
| 파일 ID 생성 (make-ent) | `uid(8) + puid.generate()` | **공식 알고리즘 채택** (2026-04-23) | 일치 |
| 파일 ID 생성 (server.js /api/export) | 동상 | `crypto.randomBytes → base36` | 외형 일치 근사치, 회귀 없어 보류 |
| Init `type` 값 | `'workspace' \| 'minimize'` | `'workspace'` 위주 | `'phone'`/`'playground'`는 비공식. `'workspace'` 또는 `'minimize'`만 |
| picture에 `thumbUrl` 필드 | **언급 없음** | playentry export에도 없음 | 쓰지 않는다 — 엔트리 내부는 `fileurl`에서 파생 |

## 우리 관측이 공식 문서에 없는 것

| 항목 | 출처 |
|------|------|
| Starter (`Entry.loadProject()` no-args) scene id가 `'7dwq'` | [`entryjs/src/class/project.js:82`](../../entryjs/src/class/project.js#L82) 소스 — 공식 typedef에는 언급 없음. 사용자 `.ent` 측은 임의 id 가능 (`clearProject` 선행 전제) |
| `object.script`가 JSON.stringify 문자열 | typedef에 `script: string`으로만 기재 — 문자열 내부가 이중 JSON임은 소스 확인 필요 |
| `"[[]]"` 최소 단위 | 소스에서 관찰 — 공식 문서엔 없음 |
| ustar 헤더 portable의 바이트 레벨 요건 | npm `tar` 패키지의 `portable: true` 동작과 동일. 공식 문서는 고수준 API만 언급 |
