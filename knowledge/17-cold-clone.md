# 새 환경에서의 설치·제작·검증 계약

이 저장소는 형제 저장소 없이 `.ent`를 생성하고 로컬 편집기에서 검증하는 도구다.
저장소 링크 자체가 모든 머신의 설치 성공, 임의 게임의 완성도, 공식 웹 업로드 성공을
보장하지는 않는다. 에이전트는 [CLAUDE.md](../CLAUDE.md)의 제작·검증 절차를 실행하고
실제로 통과한 범위를 보고한다. 다른 에이전트의 진입점인 [AGENTS.md](../AGENTS.md)도 같은 정본을 가리킨다.

## 재현 조건

- Node·npm·Git·tar가 필요하다. 2026-09-17 로컬 검증 환경은 Windows / Git Bash,
  Node 22.17.0, npm 10.9.2다. CI(Windows·Ubuntu / Node 22)는 2026-09-30 main 에서 전 과정 초록이다(아래 현재 상태).
- 설치 시 npm registry, GitHub, CreateJS의 raw GitHub 배포본, `playentry.org`,
  `code.205.kr` 접속이 필요하다. 특히 일부 편집기 모듈은 마지막 호스트에만 의존한다.
- L3·L4에는 Playwright Chromium과 해당 OS의 브라우저 실행 라이브러리가 필요하다.
  Linux는 필요 시 `npx playwright install --with-deps chromium`을 사용한다.
- 엔진은 `scripts/setup.mjs`의 핀(현재 4.0.20)의 prebuilt 파일을 사용한다. 형제 저장소가
  있으면 그것을 우선하는 개발 환경과, 형제가 없는 재현 환경은 구분해서 기록한다.
- 외부 모듈의 일부 URL은 가변이다. 이번 통과는 향후 모든 다운로드까지 보장하지 않는다.
  실패를 엔진 빌드 요청으로 해석하지 말고 실패한 다운로드·검증 단계를 보고한다.

```bash
git clone https://github.com/205sla/entry-vibe-coding.git
cd entry-vibe-coding
npm install
npm run setup
npx playwright install chromium
node tools/make-ent.mjs tests/fixtures/spec-bounce-ball.mjs --check
npm run verify
```

재현 검사에는 기존 `node_modules`, `.setup-cache`, `public/lib`를 복사하지 않는다.
사용 중인 로컬 서버를 재사용하면 다른 사본을 검증할 수 있으므로 비어 있는 전용 포트와
그 클론에서 시작한 서버를 사용한다. `setup`의 파일 검사 OK와 실제 브라우저 부팅은 별개다.

## 현재 상태 (2026-09-30)

- main 의 [cold-clone.yml](../.github/workflows/cold-clone.yml) 이 Windows·Ubuntu(Node 22)의 새 클론에서
  `npm ci` → `npm run setup`(재실행 포함) → Chromium 설치 → L1 → `npm run verify` 까지 통과한다.
- 2026-09-17 기록의 알려진 L4 실패(Brick Kingdom)는 작품을 공개 저장소에서 내려 검사 목록에서 빠졌고,
  느린 CI 러너에서 깨지던 다른 게임 검사는 [게임 시계 기준](05-host-editor.md#느린-러너에서는-시간을-게임-시계로-잰다)으로 고쳤다.
- 아래 진단·검증 기록과 실패 기록은 **2026-09-17 회차의 역사**다. 테스트 개수 등 수치는 당시 값이다.

## 2026-09-17 진단 검토

비교 기준 공개 main은 `9538c61dc421d1e6ca665be24d431a9daf9043f8`이다.
원격 브랜치는 `git ls-remote`로 확인했다. 이번 수정 후보는 이 main 위에 작성했다.

| 보고서의 주장 | 재검토 결과와 결정 |
| --- | --- |
| Git Bash tar에서 설치 실패 | 재현. GNU tar에 넘긴 Windows 드라이브 콜론이 원격 주소로 해석됐다. 압축 파일과 출력 디렉터리 모두 cwd 기준 상대경로로 전달한다. BSD tar 전용 경로 하드코딩이나 엔진 빌드는 필요 없다. |
| 공개 main의 소리 조합이 무음 | 같은 `_003.ent`로 재현. 실제 버전은 SoundJS 1.0.0 / PreloadJS 0.4.1, 등록·디코딩 없음, 네이티브 블록 `playFailed`, RMS 0, page error 0이었다. 공식 CreateJS 0.6.0 호환 세트를 해시 고정으로 가져왔다. |
| 오디오 변경은 로컬에만 있고 미푸시 | 부정확. `09b6c1b`는 원격 `docs/textbox-layout-knowledge`에도 존재한다. 정확한 결함은 main 미반영이다. 오디오 설치·가드·자체 합성 fixture·검증 도구를 선별하고 던전 작품 묶음은 포함하지 않았다. |
| 저장소 밖 링크 5개 | 재현. 기존 파일 존재 검사는 개발 머신의 형제 파일 때문에 통과할 수 있었다. 아래 문서 경계를 적용하고, 존재하더라도 저장소 밖이면 실패시키는 가드를 추가했다. |
| Brick Kingdom의 실패는 환경 문제와 별개 | 설치 문제와 분리할 근거는 있으나 같은 코드가 두 환경에서 실패했다는 사실만으로 게임 로직 결함을 확정할 수 없다. 이번 재현에서는 8개가 실패했고 첫 점프가 적 앞에 착지했다. 프레임·좌표 기반 입력과 관측으로 바꾼 뒤 동일 `_002.ent`에서 셸 정지·차기·이동 13개 단언이 통과했다. 전진 봇이 뒤의 적을 계속 재선택하는 별도 반복 문제도 확인했다. 전진용 센서의 표적 범위를 분리한 뒤 같은 경로에서 88열에 목숨 3개를 유지하며 도달했다. 엔진·게임 로직은 바꾸지 않았다. |
| boot files 14/14면 환경 완성 | 과장. 이전 검사는 HTML이 요청하는 모든 파일도 검사하지 않았다. 현재는 HTML의 script/link 파일을 따라 누락·빈 파일을 확인하고 소리 해시도 대조한다. 런타임 성공은 L3·L4에서 별도로 판단한다. |

수정 전의 L1은 0 errors, L2는 33/33이었다. 링크는 788개 중 5개 실패했다.
수정 후 상세 결과는 아래 검증 기록에 남긴다. [소리 진단 정본](15-audio-verification.md)의
공식 웹·오프라인 앱·스피커 청취 범위와 로컬 WebAudio 출력 검사를 혼동하지 않는다.

## 문서 경계

공개 저장소 안의 자료는 상대경로로 연결한다. 저장소 밖 자료는 공개된 고정 커밋의 URL을
사용하거나, 이 저장소 안의 관련 계약·정본에 연결한다. 비공개 워크스페이스 자료는 선택적
출처 설명으로만 남기고 설치·제작의 전제로 만들지 않는다. 링크 체커에서 밖으로 나가는
경로를 예외 처리하지 않는다. 실제로 존재하는 형제 파일·절대경로·인코딩된 `..`·외부
심볼릭 링크도 검출한다. HTTP URL의 존재 검증은 로컬 링크 검사 범위에 포함되지 않는다.

이는 ENTRY 워크스페이스 지식 관리 헌장 §4의 공개 저장소 예외와 일치한다. 프로젝트 전용
지식은 `knowledge/`에 유지하고, 레퍼런스와 기획을 구분하며, 상태·갱신은 이 클러스터
[문서 지도](README.md)에서 관리한다. 공개 저장소에는 워크스페이스 상향 링크를 요구하지 않는다.

보관용 초기 지시문(`bootstrap-prompt.txt`)은 당시 경로를 유지하고 실행 금지를 표시했다가, 2026-09-30 개인 경로가 많아 공개 저장소에서 내렸다.
과거 지시문을 현재 명령으로 실행하지 않는다.

## 재발 방지 검사

- [setup.test.js](../tests/setup.test.js): 공백이 있는 절대 경로의 압축 해제·재실행,
  HTML에 추가된 vendor·CSS 누락과 빈 파일 검출. Windows CI에서는 GNU tar를 PATH 우선으로 둔다.
- [knowledge-links.test.js](../tests/knowledge-links.test.js): 외부 파일이 실제 존재하는 경우에도
  경계 이탈을 검출하고 정상적인 인코딩된 내부 경로는 허용한다.
- [audio-vendor.test.js](../tests/audio-vendor.test.js), [audio-e2e.spec.js](../tests/audio-e2e.spec.js):
  손상된 다운로드 거부, 실제 버전 가드, WAV·MP3 출력·음소거·내보내기 왕복 확인.
- Brick Kingdom 검사(2026-09-29 저장소에서 내림): 실제 게임 프레임과 적 슬롯을 읽어
  키 입력만 수행한다. 앞으로 이동할 때에는 이미 뒤로 지나간 적을 표적으로 잡지 않는다.
  검증 결과를 맞추려고 변수·리스트·엔진 함수를 덮어쓰지 않는다.
- [전체 런타임 러너](../tools/run-all-verify.mjs): 기본 스크립트 제한 600초와 실패 반환을
  유지하고, 스크립트별 출력(마지막 256,000자)을 `test-results/runtime/`에 저장한다.
  콘솔에 보이는 마지막 30줄만으로 앞선 단언 실패를 놓치지 않도록 한다.
- [cold-clone.yml](../.github/workflows/cold-clone.yml): 형제 저장소가 없는 Windows·Ubuntu에서
  설치·재실행·L1·전체 verify를 실행한다. CI 설정 추가와 원격 CI 실행 완료는 별개다(2026-09-30 main 에서 실행·통과).

## 검증 기록

공개 main을 **다시 네트워크 clone한 공백 경로**에 수정 후보를 적용했다. 그 사본에는
형제 저장소와 기존 `node_modules`, `.setup-cache`, `public/lib`가 없었다.
설치한 라이브러리를 첫 번째 작업 사본에서 복사하지 않았다. npm의 머신 공용 다운로드
캐시와 이미 설치된 Playwright Chromium은 사용했으므로, 새 OS 이미지에서의 실측은 아니다.
브라우저 검사는 이 사본에서 새로 시작한 전용 서버를 대상으로 했다.

| 단계 | 수정 후보의 실측 결과 |
| --- | --- |
| Git Bash GNU tar 1.35에서 `npm install && npm run setup` | PASS — 37 boot files present; audio hashes verified |
| `node scripts/setup.mjs --skip-vendor` 재실행 | PASS — 같은 파일·해시 검사 통과 |
| L1 bounce-ball spec `--check` | PASS — 0 errors, 0 warnings |
| L2 `npm run test:smoke` | PASS — 37/37 |
| `npm run verify:links` | PASS — 0 broken (최종 개수는 근거 JSON) |
| L3 `npm run test:e2e` | PASS — 29/29, 소리 출력·음소거·내보내기 왕복·버전 오류 거부 포함 |
| 오디오 | 공식 PreloadJS·SoundJS·FlashAudioPlugin 0.6.0의 SHA-256 일치. WAV·MP3 등록·디코딩·네이티브 블록 `playSucceeded`, 출력 RMS > 0.01, 음소거 peak 0 |
| 엔진·작품 보존 | 설치된 `entry.min.js`와 npm prebuilt 해시 일치. 기존 Brick Kingdom `_002.ent`와 오디오 `_003.ent` 해시 보존 |
| L4 전체 러너 | **28 PASS / 1 FAIL** — 아래에 남긴 Brick Kingdom의 실패·600초 제한 초과 |
| L5·공식 웹·공식 오프라인 앱 | 이번 회차 미실행. 로컬 WebAudio 신호 관측은 실제 스피커 청취나 공식 배포 환경 검증을 뜻하지 않는다 |
| Windows·Ubuntu 원격 CI | 당시 설정만 추가(실행 결과 없음). 2026-09-30 main 에서 초록 — 위 현재 상태 |

측정값·해시·명령 결과는 [콜드 클론 근거](evidence/cold-clone-20260917.json),
Brick Kingdom 실행 로그는 2026-09-29 작품과 함께 공개 저장소에서 내렸다.
[설치·smoke 로그](evidence/cold-clone-install-20260917.log),
[E2E 로그](evidence/cold-clone-e2e-20260917.log),
[전체 런타임 로그](evidence/cold-clone-runtime-20260917.log)도 함께 보관한다.
L3 첫 시도에서는 수정안 전달 시 `editor.js`가 빠진 오류와 기존 memory-ranking의
간헐적 context 소멸이 드러났다. 누락을 고친 뒤 전체 29개를 다시 통과했고,
memory-ranking 단독 반복 3회도 통과했다. 후보와 검증 사본의 파일 해시 대조를 추가했다.

## 명시적으로 남긴 L4 실패와 후속 작업

> **2026-09-29 갱신** — Brick Kingdom 은 아래 실패가 풀리지 않은 미완성 작품이라 공개 저장소에서
> 내리고(`.gitignore`) 로컬 전용으로 옮겼다. 그 작품에서 나온 일반 지식(문자열 타일맵·서브스텝 충돌·
> 렌더 예산·봇 검증)은 [04](04-script-and-blocks.md#문자열-타일맵--서브스텝-스윕-충돌--사이드스크롤-플랫포머)·
> [05](05-host-editor.md#액션-게임을-봇으로-플레이해서-검증하기)·[07](07-runtime-quirks.md#brush_stamp-렌더-예산은-방문-칸이-아니라-그린-칸으로-센다--타일-크기를-바꾸면-다시-재야-한다)에
> 옮겼다. 느린 CI 러너에서 깨지던 다른 게임 검사는 [05 느린 러너](05-host-editor.md#느린-러너에서는-시간을-게임-시계로-잰다)대로
> 게임 시간 기준으로 고쳤다. 아래는 2026-09-17 당시 기록이다.

이 수정안은 **Brick Kingdom의 진행 중인 전체 경로 검증을 알려진 실패로 남긴다**.
셸 시나리오 [6]은 13/13을 통과했지만, 다음 항목은 해결됐다고 보고하지 않는다.

- [3] 오른쪽 벽까지 접근·충돌은 통과. 골 앞 계단 346열 도달은 실패했다.
- [4] 천장 타격 후 착지·성장 아이템 획득·BIG 전환·BIG 상태 벽돌 파괴, 4개 단언이 실패했다.
  보상 블록의 1회 사용·아이템 등장 자체는 통과했다. 게임 로직과 봇 입력 중 원인은 아직 분리하지 못했다.
- [9] 실행 중 전체 스크립트의 600초 제한에 걸렸다. [9]는 미완료, [10]~[15]는 이번 전체 실행에서 미실행이다.

기존 게임 README에도 `_002` 재검증 미완과
장거리 봇 조작 한계가 기록돼 있었다. 호스트 설치·소리 복구와 분리하여 이 상태를 보존한다.
통과시키기 위해 단언을 지우거나 기대값을 완화하거나 게임 변수를 정답으로 바꾸지 않았다.
기본 600초 제한과 nonzero 종료도 유지한다. 따라서 **당시 `npm run verify`와 이 조건을
재현하는 CI는 전체 녹색이 아니었다**(2026-09-30 현재는 초록 — 위 현재 상태). 문서화된 실패는 성공 판정의 예외가 아니다.

후속 수정은 작품의 Phase 2 계획(경로 재생 검증)과
연결한다. [3]·[4]의 입력·프레임 추적을 먼저 고정해 게임/봇 원인을 분리하고,
[9]~[15]까지 실제 키 입력으로 검사를 마친 뒤에만 이 알려진 실패 표기를 제거한다.

이 결과가 지지하는 결론은 **외부 링크 하나를 출발점으로 설치·생성·검증 절차를 실행할 수
있다**는 것이다. 임의의 요청을 한 번에 완성하거나 모든 기존 예제가 통과한다는 보장은 아니다.
