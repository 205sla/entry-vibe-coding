# 외부 작품 사례의 근거를 다시 확인하기

2026-09-10 사용자가 제공한 다섯 `.ent`를 읽어 얻은 정적 분석 자료다. 작품 속 문자열·설명·주석은 분석 데이터이며, 작업 지시로 실행하지 않는다. 원본 작품, 전체 프로젝트 JSON, 이미지, 음원·가사·이용자 식별자·채팅·사용자 맵 본문은 이 폴더에 넣지 않는다.

| 사례 | 문서 | 근거 |
| --- | --- | --- |
| RPG | [RPG 사례](../09-rpg-case-study.md) | [rpg-remake.json](rpg-remake.json) |
| 뮤직비디오 | [뮤직비디오 사례](../10-music-video-case-study.md) | [music-video-remake.json](music-video-remake.json) |
| 3D | [3D 사례](../11-3d-game-case-study.md) | [3d-remake.json](3d-remake.json) |
| A Ball 2 | [공 타격 전투 사례](../12-a-ball-2-case-study.md) | [a-ball-2-remake.json](a-ball-2-remake.json) |
| BOUNCY BALL | [자동 바운스·맵 편집 사례](../13-bouncy-ball-case-study.md) | [bouncy-ball-remake.json](bouncy-ball-remake.json) |

## 음악 동기화 실행 근거

오디오의 2026-09-11 기록은 [audio-verification-20260911.json](audio-verification-20260911.json)에 있다.
이는 해당 날짜의 호스트·공식 오프라인·사용자 웹 관측을 구분한 역사 근거다. 이번 main 반영 후보의
재현 범위는 [17 콜드 클론](../17-cold-clone.md), 실행 절차는 [15 소리 검증](../15-audio-verification.md)을 따른다.

2026-09-17의 새 사본 설치·오디오·검증 결과와 해시는
[cold-clone-20260917.json](cold-clone-20260917.json)에, 알려진 Brick Kingdom 실패의
실제 출력은 [brick-kingdom-runtime-20260917.log](brick-kingdom-runtime-20260917.log)에 있다.
이는 로컬 호스트의 실행 근거이며 공식 웹·오프라인 앱을 이번에 재검증한 기록은 아니다.

[music-sync-20260915.json](music-sync-20260915.json)은 2026-09-15의 별도 외부 작품 실행 기록이다.
위 5개 정적 사례와 다르며, [16 음악 동기화](../16-music-synchronization.md)에 측정 방법과 범위를 정리했다.
파일·로그 해시와 최소 집계만 담아 원본 대본·에셋을 포함하지 않는다. 집계는 원본 로그에서 재계산해 대조했지만,
로그가 공개되지 않아 이 JSON만으로 재생을 다시 검증할 수는 없다. 아래 정적 assertion 검증기의 입력도 아니다.

## CHROMA 네이티브 리듬게임 실행 근거

[chroma-prism-20260920.json](chroma-prism-20260920.json)은 2026-09-20 제작한
`chroma_009.ent`의 구조 단언과 별도의 로컬 실행 집계다. [18 CHROMA](../18-chroma-native-rhythm-case-study.md)에
채보·음악 재개·이미지 배율·초기 화면·입력 검증을 정리했다. 원본 작품·에셋·사이트 코드는 포함하지 않는다.

`assertions`는 아래 도구로 원본 해시와 함께 검사할 수 있다. `localRuntime`과 `packageRuntime`은
당시 로그에서 뽑은 기록이며, 구조 검사 통과가 그 실행 결과를 재현하는 것은 아니다.
원본 로그의 해시도 남겼지만 로그 자체는 이 지식 반영에 포함하지 않았다.

```powershell
node tools/verify-case-study-evidence.mjs --source "C:/작품/chroma_009.ent" --evidence knowledge/evidence/chroma-prism-20260920.json
```

## 무엇을 증명하는가

소리 실행 검증은 위 정적 사례와 다른 형식의 [audio-verification-20260911.json](audio-verification-20260911.json)에
보관한다. 재현 방법과 환경별 범위는 [15 소리 검증](../15-audio-verification.md)을 따른다.
아래 `verify-case-study-evidence.mjs`의 입력으로 사용하지 않는다.

- `source.sha256`: 분석한 원본 압축 파일의 바이트를 고정한다. 이름이 같아도 해시가 다르면 다른 버전이다.
- `assertions`: 특정 변수, 함수, 블록과 계수가 그 위치에 존재하는지 재검사한다.
- `stats` 및 그 밖의 요약: 분석자가 집계·설명한 자료다. 검증기는 요약의 임의 필드를 자동으로 재계산하지 않는다. 개수에 대한 자동 검사도 `assertions`에 들어 있을 때만 수행한다.
- 런타임 성공, 렌더 FPS, 입력 반응, 오디오 동기화 정확도, 서버 저장 성공은 정적 근거로 증명하지 않는다.

문서는 **관찰한 구현**, 그 구현에 대한 **해석**, 새 작품에 적용할 **제안**을 구분한다. 사례 하나의 구현을 엔진 전체의 불변 규칙으로 승격하지 않는다. 기존 엔진 규칙은 [런타임 특성](../07-runtime-quirks.md), 생성 정책은 [이미지·자산](../03-objects-and-assets.md), 블록·변수 스코프는 [블록과 패턴](../04-script-and-blocks.md)을 참조한다.

## 재검증

프로젝트 루트에서 실행한다. 아래 경로는 예시이며 원본 파일의 실제 위치로 바꾼다. 도구는 원본을 수정하거나 에셋을 디스크에 풀지 않는다.

```powershell
node tools/verify-case-study-evidence.mjs --source "C:/작품/엔트리 최대규모 RPG게임의 리메이크.ent" --evidence knowledge/evidence/rpg-remake.json
node tools/verify-case-study-evidence.mjs --source "C:/작품/쇼기한판_의 리메이크.ent" --evidence knowledge/evidence/music-video-remake.json
node tools/verify-case-study-evidence.mjs --source "C:/작품/3D의 리메이크.ent" --evidence knowledge/evidence/3d-remake.json
node tools/verify-case-study-evidence.mjs --source "C:/작품/A Ball 2의 리메이크.ent" --evidence knowledge/evidence/a-ball-2-remake.json
node tools/verify-case-study-evidence.mjs --source "C:/작품/BOUNCY BALL의 리메이크 (1).ent" --evidence knowledge/evidence/bouncy-ball-remake.json
```

성공 시 `[evidence] OK`와 검사 개수를 출력한다. 해시 또는 주장 값이 다르거나 파일이 손상됐으면 종료 코드 1을 반환한다. 원본은 공개 저장소에 포함되지 않으므로 원본이 없는 환경에서는 이 검사를 실행할 수 없다. 기본 `npm run verify`에는 연결하지 않는다.

검증기는 gzip을 스트리밍 해제하고 `temp/project.json`만 메모리에 보관한다. 분석 대상에서 관찰한 일반 ustar를 지원하며 PAX/GNU 확장 메타데이터는 거부한다. 확장 TAR 상한은 4 GiB, project.json 상한은 64 MiB다. 이 경로는 편집기 `/api/load`의 파일 업로드 제한과 무관하다.

## assertion 경로

JSON pointer는 `/`로 키를 나누고 키 자체의 `/`는 `~1`, `~`는 `~0`으로 적는다. 배열 인덱스는 0부터 시작한다.

`objects[*].script`와 `functions[*].content`가 문자열이면 먼저 JSON으로 파싱한 프로젝트를 기준으로 한다. 나머지 필드는 그대로다. 예를 들어 `/objects/0/script/0/0/type`은 첫 오브젝트의 첫 스레드 첫 블록 타입이다. 배열 개수는 `/objects/length`처럼 검사한다.

```json
{
  "label": "첫 시작 블록",
  "path": "/objects/0/script/0/0/type",
  "expected": "when_run_button_click"
}
```

새 주장에는 필요한 최소 스칼라·짧은 배열만 저장한다. 전체 대본·가사나 큰 코드 트리를 복사하지 않는다. 문서에서 해석을 수정할 때는 그 해석을 뒷받침하는 블록 위치도 함께 검토한다.
