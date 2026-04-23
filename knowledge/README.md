# `.ent` 파일 위키

엔트리(entryjs) 프로젝트 파일(`.ent`) 생성·조작에 필요한 지식. 이 저장소에서 **시행착오로 배운** 비자명한 사실 위주.
공식 스키마 문서가 아니라 "이대로 하면 작동한다"의 실전 레퍼런스.

## 언제 어느 문서를 볼 것인가

| 상황 | 읽을 문서 |
|------|-----------|
| 공식 typedef·API 직접 확인 / 어떤 필드가 공식인지 | [00-official-sources.md](00-official-sources.md) |
| `.ent` 바이너리가 깨짐 / tar 구조 확인 | [01-binary-format.md](01-binary-format.md) |
| `project.json` 최상위 키가 뭐가 필요한지 | [02-project-json.md](02-project-json.md) |
| 오브젝트·이미지 필드 / 이미지를 tar에 포함시키는 법 | [03-objects-and-assets.md](03-objects-and-assets.md) |
| 블록 type 이름 / params 쉐이프 / 필드 vs 블록 슬롯 | [04-script-and-blocks.md](04-script-and-blocks.md) |
| 편집기가 안 뜨거나 콘솔 에러 발생 | [05-host-editor.md](05-host-editor.md) |
| "이미지가 회색 박스", "addChildAt undefined", 이런 증상별 원인 | [06-gotchas.md](06-gotchas.md) |
| 날짜별로 뭘 배웠는지 | [CHANGELOG.md](CHANGELOG.md) |

## 사실의 출처 (우선 순위)

1. **[entrylabs/docs](https://github.com/entrylabs/docs)** — 공식 문서. 최고 권위. [00-official-sources.md](00-official-sources.md)에 인덱스.
2. **엔트리 원본 소스** — `C:\Users\young\prg\ENTRY\entryjs\src\…`. 공식 문서에 없는 세부 동작의 ground truth.
3. **공식 export 레퍼런스** — `C:\Users\young\Downloads\260423_작품.ent` (playentry.org에서 내려받은 정상 동작 파일).
4. **형제 프로젝트 MYentry 커밋** — `C:\Users\young\prg\ENTRY\MYentry\server.js` 의 역사 (`git log`).

주장 옆에는 가능하면 `파일:줄번호` 또는 `commit <hash>` 형태로 출처를 남긴다.
공식 문서에 있는 사실은 그쪽을 1순위로 인용.
추측이면 "(추정)" 표시.

## 업데이트 규칙

새 사실을 배웠을 때:
1. 관련 토픽 파일에 **짧은 섹션**으로 추가 (기존 서술을 고치지 말고 append).
2. `CHANGELOG.md`에 한 줄 — 날짜·토픽·요약·해결 커밋(있으면).
3. 주장은 반드시 **어떻게 재현했는지** 또는 **어떤 파일이 증거인지** 함께 기록.
4. 이전 지식이 틀렸다고 밝혀졌으면 지우지 말고 "~~취소선~~" + 정정 사유 추가.

## 한 줄 요약

`.ent` = ustar tar(npm portable 포맷) → gzip(memLevel:6). 내부는 `temp/project.json` + 에셋들(`temp/aa/bb/image|thumb|sound/<hash>.<ext>`). 에셋 hash는 base36 32자. 이미지는 PNG로 래스터라이즈해서 번들. picture 객체에 `thumbUrl` 필드는 **쓰지 않음** (playentry 포맷). 장면 id는 첫 번째가 `"7dwq"`. 스크립트는 JSON.stringify된 2차원 배열. 여기서 한 글자라도 어긋나면 엔진이 로드하다가 `addChildAt(undefined)`로 꺼진다.
