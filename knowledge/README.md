# `.ent` 파일 위키

엔트리(entryjs) 프로젝트 파일(`.ent`) 생성·조작에 필요한 지식. 이 저장소에서 **시행착오로 배운** 비자명한 사실 위주.
공식 스키마 문서가 아니라 "이대로 하면 작동한다"의 실전 레퍼런스.

## 언제 어느 문서를 볼 것인가

| 상황 | 읽을 문서 | 파일 유형 |
|------|-----------|-----------|
| **처음 들어왔다 · 30초 요약** | [quick-reference.md](quick-reference.md) | 진입점 |
| 공식 typedef·API 직접 확인 / 어떤 필드가 공식인지 | [00-official-sources.md](00-official-sources.md) | Reference |
| `.ent` 바이너리가 깨짐 / tar 구조 확인 | [01-binary-format.md](01-binary-format.md) | Reference |
| `project.json` 최상위 키가 뭐가 필요한지 | [02-project-json.md](02-project-json.md) | Reference |
| 오브젝트·이미지 필드 / 이미지를 tar에 포함시키는 법 | [03-objects-and-assets.md](03-objects-and-assets.md) | Reference |
| 블록 type 이름 / params 쉐이프 / 필드 vs 블록 슬롯 / 설계 패턴 (플랫포머·HUD) | [04-script-and-blocks.md](04-script-and-blocks.md) | Reference + Guide |
| 편집기가 안 뜨거나 콘솔 에러 / 헤드리스 테스트 | [05-host-editor.md](05-host-editor.md) | Guide |
| Entry 엔진의 불변 동작 (60fps 반복, short-circuit, 키 이벤트 등) | [07-runtime-quirks.md](07-runtime-quirks.md) | Runtime quirks |
| 과거 해결된 버그 요약 (가드 파일 링크) | [lessons.md](lessons.md) | Lessons |
| 날짜별로 뭘 배웠는지 | [CHANGELOG.md](CHANGELOG.md) | History |

활성 함정 문서(`06-gotchas.md`)는 현재 **비어 있음** — 알려진 활성 함정이 없는 상태.
구조적으로 해결 불가능한 새 함정이 발견되면 그때 이 파일을 신설.

## 사실의 출처 (우선 순위)

1. **[entrylabs/docs](https://github.com/entrylabs/docs)** — 공식 문서. 최고 권위. [00-official-sources.md](00-official-sources.md)에 인덱스.
2. **엔트리 원본 소스** — `C:\Users\young\prg\ENTRY\entryjs\src\…`. 공식 문서에 없는 세부 동작의 ground truth.
3. **공식 export 레퍼런스** — `C:\Users\young\Downloads\260423_작품.ent` (playentry.org에서 내려받은 정상 동작 파일).
4. **형제 프로젝트 MYentry 커밋** — `C:\Users\young\prg\ENTRY\MYentry\server.js` 의 역사 (`git log`).

주장 옆에는 가능하면 `파일:줄번호` 또는 `commit <hash>` 형태로 출처를 남긴다.
공식 문서에 있는 사실은 그쪽을 1순위로 인용.
추측이면 "(추정)" 표시.

## 파일 유형별 업데이트 규칙

**유형에 따라 편집 방식이 다르다**. 한 파일에 두 유형을 섞지 말 것.

### 📚 Reference — `00~04`, `quick-reference`

**자유롭게 수정·리팩터링**. 사실이 바뀌면 그 자리를 덮어쓴다. 역사 추적은 `git log`.
섹션을 지우는 것도 OK — 지금 틀린 정보를 계속 남겨두면 독자가 헷갈린다.

### 🛠️ Guide — `04`의 설계 패턴 섹션들, `05-host-editor`

"이런 걸 하려면 이렇게" 유형. 패턴이 개선되면 기존 글을 고쳐서 최신 방법을 유지.

### ⚠️ Runtime quirks — `07-runtime-quirks`

**append-only**. 각 항목은 Entry 엔진이 바뀌지 않는 한 불변.
새 발견은 새 섹션으로 추가. 기존 항목 삭제·수정 안 함 (정정 필요 시 취소선).

### 🧂 Lessons — `lessons.md`

해결된 버그 1줄씩. 가드 파일 링크 필수.
재발 시 그 가드가 깨졌는지 확인하는 용도.
새 1줄 추가 시 기존 항목은 건드리지 않음 (카테고리별 append).

### 📆 History — `CHANGELOG.md`

날짜별 append. 역사 기록이므로 **편집 금지** (링크 대상이 이동하면 맨 위 안내 섹션으로 알림).

## 주기적 가지치기 (Sweep) — 3~6개월마다

`CHANGELOG.md`와 knowledge 전체가 과도하게 커지면:

1. 활성 함정 문서(`06-gotchas.md`)가 존재하면 각 섹션 돌며 "아직 재발 가능?" 평가
   - 구조적으로 해결됐다면 → `lessons.md`에 1줄 요약 + 가드 링크 → 원본 섹션 **삭제**
   - Entry 엔진 고유 동작이면 → `07-runtime-quirks.md`로 이관
2. `CHANGELOG.md`가 너무 길면 (예: 1년 경과) → `CHANGELOG-YYYY.md`로 아카이브
3. Reference 문서의 취소선이 쌓이면 정리 (git history가 이미 옛 버전을 보존)
4. Sweep 결과는 `CHANGELOG.md`에 "Sweep YYYY-MM-DD: N개 항목 → lessons" 한 줄 기록

## 한 줄 요약

`.ent` = ustar tar(npm portable 포맷) → gzip(memLevel:6). 내부는 `temp/project.json` + 에셋들(`temp/aa/bb/image|thumb|sound/<hash>.<ext>`). 에셋 hash는 base36 32자. 이미지는 PNG로 래스터라이즈해서 번들. picture 객체에 `thumbUrl` 필드는 **쓰지 않음** (playentry 포맷). 장면 id는 4자 영숫자 아무거나 OK — 단 호스트 편집기가 사용자 `.ent` 로드 전 `Entry.clearProject()`를 반드시 선행해야 한다. 스크립트는 JSON.stringify된 2차원 배열. 여기서 한 글자라도 어긋나면 엔진이 로드하다가 `addChildAt(undefined)`로 꺼진다.
