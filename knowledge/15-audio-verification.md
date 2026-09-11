# 소리 재생 검증과 무음 진단

소리를 포함한 작품은 **파일 포함 → 로드 → 등록 → 디코딩 → 실제 블록 발화 → 출력 신호**까지
확인한다. `.ent` 구조 검사와 콘솔 오류 0만으로 재생 성공을 판정하지 않는다.
Sound 필드와 번들 형식은 [03](03-objects-and-assets.md#sound)이 정본이며,
이 문서는 실행 검증·호스트 호환성·실패 구분의 정본이다.

## 2026-09-11에 확인한 원인과 범위

| 환경 | 관측 | 판정 |
| --- | --- | --- |
| 수정 전 MYentry-game 로컬 호스트 | 파일명은 둘 다 `0.6.0`이지만 실제 PreloadJS는 `0.4.1`, SoundJS는 `1.0.0`. 새 테스트의 WAV·MP3 모두 미등록·미디코딩, 네이티브 블록 `playFailed`, 출력 0 | 호스트 의존성 조합 오류. 이번에 수정 |
| 수정 후 같은 호스트 | 같은 `_001.ent`에서 WAV·MP3 등록·디코딩·블록 재생 성공, 음소거 출력 0. 안내 화면을 정리한 `_003.ent`도 통과 | 로컬 호스트 수정 전후 재현 확인 |
| 공식 Entry 오프라인 2.1.35, 새 사용자 프로필 | `_003.ent`의 WAV·MP3 네이티브 블록 `playSucceeded`, 출력 RMS 약 0.092 / 0.089, 음소거 0 | 이 버전·프로필·파일에서 재생 확인 |
| 기존 공개 심연의 성채 | 실제 런타임이 요청한 8개 WAV `/uploads/…/*.wav` 주소가 404, `ambient`·`shot` 호출은 `playFailed` | 서버 음원 접근 실패. 로컬 호스트 오류와 별개이며 이번에 해결했다고 판정하지 않음 |
| 새 테스트 작품의 공식 사이트 업로드 | 사용자가 `_003.ent`를 엔트리 웹사이트에서 직접 실행하여 **2번 MP3만 재생**, 1번 WAV 무음을 보고함. 크롬 확인은 URL 식별 실패로 중단되고, 제공받은 작품의 익명 GraphQL 조회는 권한 오류 403을 반환 | 사용자 관측을 확보. 에이전트의 요청 경로·블록 출력 및 저장 후 재접속 검증은 미완료 |

수치·파일 해시·관측 범위는 [검증 근거](evidence/audio-verification-20260911.json),
현재 테스트의 상세 결과는 [로컬](../games/audio-check/verification.json)과
[공식 오프라인](../games/audio-check/verification-offline.json)에 있다.
정규 E2E 29개는 별도 헤드리스 Chrome 프로세스에서, smoke 34개는 Node에서 통과했다.
이 환경에는 Playwright 전용 Chromium 실행 파일이 없어 E2E의 브라우저 채널만 Chrome으로 지정했다.
새 빈 디렉터리에서 소리 vendor 다운로드·해시 검사·재실행도 통과했다.
기존 던전 `.ent`는 수정하지 않았다. 사용자 환경에서 발생한 공식 오프라인 무음은 새 프로필에서
재현되지 않았으므로, 모든 오프라인 무음의 원인을 위 라이브러리 오류로 단정하지 않는다.

## 공식 웹용 음원 형식 선택

**새 공개용 작품은 MP3를 기본으로 포함한다.** WAV를 합성 원본으로 만들었다면 실제 MP3로
인코딩한 파일을 `sounds[].path`에 연결한다. 확장자만 `.mp3`로 바꾸면 안 된다.

```powershell
ffmpeg -i source.wav -codec:a libmp3lame -b:a 128k sound.mp3
```

이 선택의 근거는 위 테스트 작품에서 사용자가 확인한 웹 MP3 성공·WAV 무음과 기존 공개 작품의
WAV 요청 404다. **엔트리 웹이 모든 WAV를 지원하지 않는다는 일반 규칙으로 확정한 것은 아니다.**
같은 WAV는 로컬 호스트와 공식 오프라인 새 프로필에서 정상 디코딩·출력됐다.
웹의 가져오기·변환·서빙 중 어디서 실패하는지는 테스트 작품의 실제 요청 URL을 확인해야 한다.
대상 [테스트 작품](https://playentry.org/ws/6aa3bd781af80892d3d1d982)의 공개 페이지는 HTTP 200이었지만,
`SELECT_PROJECT`는 HTTP 200 응답 안에 권한 오류 `statusCode: 403`을 반환하여 음원 메타데이터를
얻지 못했다. 이 결과를 음원 파일 자체의 HTTP 403 또는 404로 해석하지 않는다.
MP3도 정식 가져오기·저장·재접속 뒤 실제 블록으로 재생되는지 확인한다.
진단용 `_003.ent`는 형식 차이를 비교하기 위해 WAV와 MP3를 그대로 유지한다.

## 호스트 의존성은 파일명 대신 실제 버전을 맞춘다

옛 `preload-js@0.6.3` npm 패키지의 내부 구현은 PreloadJS 0.4.1,
`soundjs@1.0.1`의 내부 구현은 SoundJS 1.0.0이었다.
구 PreloadJS는 플러그인을 문자열 인자로 호출하지만 새 SoundJS는 `loadItem.src`를 읽는다.
이때 생기는 잘못된 인자를 `_parsePath` 방어 래퍼가 `null`로 삼켜,
**예외 없이 소리 등록 자체가 생략되는 무음**이 발생했다.

해결은 [setup-audio.mjs](../scripts/setup-audio.mjs)의 공식 CreateJS 0.6.0 브라우저 배포본이다.
PreloadJS·SoundJS·FlashAudioPlugin을 각각 공식 저장소의 고정 커밋과 SHA-256으로 검증해
로컬 `public/lib/vendor`에 설치한다. FlashAudioPlugin 파일은 기존 로드 구성과 맞추기 위한 것이며,
현대 브라우저에서의 검증 대상은 WebAudio이다.

- [PreloadJS 공식 0.6.0 배포본](https://github.com/CreateJS/PreloadJS/blob/ba52a4d4a1308962107cb1acd144bd28735637da/lib/preloadjs-0.6.0.min.js)
- [SoundJS 공식 0.6.0 배포본](https://github.com/CreateJS/SoundJS/blob/093c91fc1dc78dd85dd103467e280f01034a177b/lib/soundjs-0.6.0.min.js)

```powershell
# 기존 설치의 소리 의존성만 복구
node scripts/setup-audio.mjs
# 전체 설치에도 위 단계와 해시 검사가 포함됨
npm run setup
```

다운로드는 설치 때만 필요하다. 검증된 로컬 파일 또는 캐시가 있으면 재다운로드하지 않는다.
`--skip-vendor`는 npm vendor 설치만 건너뛰며 소리 세트 검사는 생략하지 않는다.
전체 세트를 확보·검증한 다음 설치 파일을 바꾼다. 체크섬이 다르면 실패시키며,
해시를 임의로 바꾸거나 예외를 삼켜 부팅시키지 않는다.
EntryJS 엔진 소스·dist는 수정하지 않는다. 다른 CreateJS 구성요소의 버전까지 무조건 같게 만들지 않는다.

[editor.js](../public/js/editor.js)는 `Entry.init()` 전에 `SoundJS.version`과
`PreloadJS.version`을 검사한다. 서로 맞지 않으면 상태창에 복구 명령을 표시하고
`__myentryReady`를 reject한다. 예전 `_parsePath` 래퍼와 npm 파일의 `module.exports`
제거 안내는 폐기했다. **구성요소 버전을 올릴 때 이 가드를 삭제하는 대신 호환성·소리 검사를 다시 통과시킨다.**

## 재사용할 최소 테스트 작품

[소리 검증실 `_003.ent`](../games/audio-check/audio-check_003.ent)는 외부 URL 없이
직접 합성한 1.6초 네 음을 PCM16 mono 22,050 Hz WAV와 MP3로 포함한다.
참고로 받은 음악 작품의 음원은 복사하지 않았다.

1. `.ent`를 열고 시작 버튼을 누른다.
2. 숫자 **1**: WAV, **2**: MP3. 두 경우에 같은 네 음이 들려야 한다.
3. 숫자 **3**: 같은 WAV를 음량 0으로 재생한다. 아무 소리도 나지 않아야 한다.
4. 각 음이 끝난 뒤 다음 키를 누른다. 키는 숫자열의 1·2·3을 사용한다.

재생은 `when_some_key_pressed` → `sound_volume_set` →
`sound_something_wait_with_block`으로 연결된 **기본 엔트리 블록**이다.
테스트 코드가 직접 `Sound.play()`를 호출해 작품의 재생 로직을 대체하지 않는다.
`sounds[].id`와 `name`을 다르게 두어 이름 참조의 해석도 검증한다.

```powershell
# 로컬 서버는 별도 터미널에서 npm start로 실행
node games/audio-check/verify.mjs
npx playwright test tests/audio-e2e.spec.js

# 공식 오프라인 앱이 설치된 환경에서 선택 실행. 경로는 실제 설치 위치로 지정
node tools/verify-audio-offline.mjs --entry-exe="C:/Entry/Entry.exe"

# 음원을 다시 합성할 때만 ffmpeg 필요. 기존 .ent 실행·검증에는 필요 없음
node games/audio-check/generate-audio.mjs
# 수정본은 기존 번호를 덮어쓰지 않고 새 번호로 생성
node tools/make-ent.mjs games/audio-check/spec.mjs games/audio-check/audio-check_004.ent
```

공식 오프라인 검사 도구는 빈 임시 프로필로 앱을 시작하고 `userData`와 `appData`의 격리를
검증한 뒤 앱의 `loadProject` IPC로 가져온다. 기존 사용자 작업이나 복구 파일이 있는 프로필을
사용하지 않는다. 테스트용 파일만 읽으며 원본 SHA-256이 같은지도 기록한다.

## 자동 검사가 확인하는 것

[audio-harness.mjs](../tools/lib/audio-harness.mjs)는 실제 소리 호출을 관찰하고
WebAudio의 최종 gain 노드 뒤에서 파형을 측정한다.

| 단계 | 반드시 확인할 증거 |
| --- | --- |
| 패키징 | tar 안의 실제 음원 바이트, `fileurl`·`filename`·`ext`·길이의 일치 |
| 로드 | 실제 요청 URL·응답 상태 또는 오프라인 파일 경로. `sound` 메타데이터의 존재만으로 통과하지 않음 |
| 등록·디코딩 | SoundJS 등록 ID 및 해당 경로의 AudioBuffer |
| 블록 발화 | 실제 키·공격·충돌·장면 이벤트가 실행한 소리 ID와 `playState` |
| 출력 | 사용자 제스처 후 AudioContext `running`, 최종 음량 뒤의 peak·RMS가 0보다 큼 |
| 음소거 | 재생 중에도 출력이 0이 되는지, 다시 켜면 재생되는지 |
| 왕복 | 편집기 내보내기 → 새로 가져오기 후 음원 해시 보존과 재생 재확인 |
| 웹 공개 | 정식 가져오기 → 저장 → 재접속 후 서버 URL의 정상 응답과 실제 블록 출력. 로컬 성공으로 대체하지 않음 |

최소 fixture의 합격선은 일반 재생 RMS ≥ 0.01, 음소거 peak ≤ 0.0001이다.
아주 작은 음량의 다른 작품에 이 수치를 그대로 적용하지 않는다. 무음 녹음·디코딩 실패도 구분한다.
키 입력은 [정본의 `event.code` 규칙](07-runtime-quirks.md#키-이벤트는-document--eventcode-로-dispatch)을 따른다.
`key`·`keyCode`만 보낸 뒤 반응이 없다고 작품 문제로 판단하지 않는다.

[audio-e2e.spec.js](../tests/audio-e2e.spec.js)는 WAV·MP3·음소거·내보내기 왕복 재생과
잘못된 버전의 부팅 차단을 `npm run test:e2e`에 포함한다.
[audio-vendor.test.js](../tests/audio-vendor.test.js)는 잘못된 다운로드/캐시가 기존 설치를
덮어쓰지 못하게 하는 검사이며 `npm run test:smoke`에 포함된다.
`games/audio-check/verify.mjs`는 일반 런타임 검사 목록에서도 발견된다.

새 게임의 검증에는 그 게임의 배경음·효과음·음소거 입력도 넣는다. 이 최소 fixture가 통과했다는
사실은 호스트의 재생 기능을 증명할 뿐, 모든 게임의 오디오 이벤트 연결을 대신 검증하지 않는다.

## 무음 발생 시 구분할 순서

1. **에셋을 못 찾음**: tar에 없는 파일, `ext` 불일치, HTTP 404를 먼저 확인한다.
   공개 사이트의 404는 실제 음원 URL을 기록하고 정식 `.ent` 가져오기 및 저장 결과를 조사한다.
   JSON만 교체하면 음원 바이트는 업로드되지 않는다([05의 에셋 경계](05-host-editor.md#전제--에셋이-0-이어야-한다)).
2. **요청·등록 자체가 없음**: 런타임 실제 라이브러리 버전을 확인한다. 파일 이름의 `0.6.0`이나
   npm 패키지 버전만 보지 않는다. 예외를 무시하는 호스트 패치도 점검한다.
3. **등록 후 실패**: 실제 바이트의 디코딩 결과·지원 코덱을 확인한다.
   "참고 작품은 MP3, 실패 작품은 WAV"라는 차이만으로 WAV 미지원이라고 결론 내리지 않는다.
4. **직접 호출만 성공**: 블록 실행 오브젝트의 소리 참조, 이벤트 발화, 게임의 음소거 조건을 확인한다.
5. **출력 신호는 정상인데 청취가 안 됨**: 사용자 제스처, 탭/사이트 음소거, OS 출력 장치·믹서 등
   사용자 환경과 구분한다. 파형 측정은 스피커에서 사람이 들었다는 증거가 아니다.

최종 보고에는 **어느 파일·환경에서 어디까지 확인했는지**를 적는다.
일반 재생 검사, 청취 품질, 원본 작품 수정, 서버 업로드 문제 해결을 서로 같은 의미로 쓰지 않는다.
