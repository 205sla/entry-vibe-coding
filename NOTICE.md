# 제3자 구성 요소와 자산 고지 (Third-party notices)

이 저장소의 코드·문서, 그리고 저장소의 생성 코드로 만든 그림·소리는 [MIT](LICENSE) 로 배포한다.
아래는 출처가 따로 있거나 조건이 다른 것이다.

## 저장소에 들어 있는 것

| 파일 | 출처 | 조건 |
| --- | --- | --- |
| `public/media/handclosed.cur`, `public/media/handopen.cur` | [entryjs](https://github.com/entrylabs/entryjs) `images/` 의 같은 파일(원래 Google Blockly) | Apache-2.0 |
| `tests/fixtures/known-good.ent` | 저장소 관리자의 playentry.org 작품 「01_정답의 리메이크」를 내보낸 파일. playentry 리메이크 기능으로 다른 작품(`parent` 필드의 원작)을 이어 만든 것이다. 그림·소리는 없고 블록 JSON 과 엔트리 기본 자산 경로만 담았다 | `.ent` 형식 회귀 검사용. 원작에서 온 부분의 권리는 원작자에게 있다 |
| `public/images/mascot/bot205-*.svg` | 저장소 관리자가 만든 마스코트 | MIT |
| `public/images/game/*`, `games/*` 의 그림·소리·스크린샷 | 저장소의 SVG 생성기·합성음 코드와 검사 도구가 만든 것 | MIT |

## 설치할 때 내려받는 것 (저장소에 포함하지 않음)

`npm run setup` 이 아래를 받아 `public/lib/` 에 둔다. 각 구성 요소의 라이선스를 따른다.

| 구성 요소 | 받는 곳 | 라이선스 |
| --- | --- | --- |
| 엔트리 엔진 `@entrylabs/entry` | npm | Apache-2.0 |
| entry-tool | entrylabs 공개 저장소 | 해당 저장소의 조건 |
| entry-paint · entry-lms · sound-editor · legacy-video | playentry.org · code.205.kr 의 정적 빌드 파일 | 엔트리(playentry) 의 조건 |
| PreloadJS · SoundJS · FlashAudioPlugin 0.6.0 | CreateJS 고정 커밋 | MIT |
| jQuery · jQuery UI · lodash · EaselJS · Velocity · CodeMirror · React · socket.io | npm | 각 패키지의 조건(대부분 MIT) |
| 개발 의존성(Playwright, sharp, ESLint 등) | npm | 각 패키지의 조건 |

## 문서 안의 인용과 분석

- `knowledge/` 의 엔트리 엔진 소스 인용은 Apache-2.0 코드에서 필요한 몇 줄만 옮긴 것이며, 원문 링크(entryjs 커밋 고정)를 함께 달았다.
- `knowledge/` 의 사례 문서(RPG·뮤직비디오·3D·A Ball 2 등)는 외부 작품을 읽고 구조를 분석한 기록이다.
  원본 이미지·소리·가사·전체 스크립트는 저장소에 넣지 않았고, 원본은 SHA-256 으로만 가리킨다.
