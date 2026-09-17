# CLAUDE.md — AI 에이전트 작업 지침

"이 저장소로 ○○ 게임(프로그램) 만들어줘" 요청을 받았을 때의 표준 절차.
사람용 상세 설명은 [README.md](README.md), 심화 지식은 [knowledge/](knowledge/README.md).

## 절대 규칙 4가지

1. **entryjs를 빌드하지 마라.** webpack·pnpm install 금지. 엔진 dist는 `npm run setup`이
   npm 공식 패키지 `@entrylabs/entry`의 **prebuilt 아티팩트**로 받아온다.
   "`../entryjs`에 dist가 없다"는 빌드하라는 신호가 아니다 — setup이 알아서 npm에서 가져온다.
2. **검증 방법을 사용자에게 묻지 마라.** 아래 검증 사다리를 가능한 레이어까지 자동으로 진행하고,
   막힌 레이어는 "왜 막혔는지 + 어디까지 통과했는지"를 최종 보고에 적는다.
3. **`.ent` 재생성 시 덮어쓰지 마라.** `games/<이름>/<이름>_001.ent`, `_002` … 식으로
   새 번호 파일을 만든다.
4. **엔진 소스를 패치하지 마라.** 모든 적응은 호스트 레이어(`public/js/editor.js`,
   `server.js`, `tools/`)에서만. (근거: README "엔트리 원본(entryjs)" 섹션)

## 환경 준비 — 처음 한 번 (인터넷 필요, 빌드 없음)

```bash
npm install
npm run setup                      # 편집기 의존성 자동 구성 (~수 분, 87MB npm 아티팩트 다운로드)
npx playwright install chromium    # 헤드리스 검증용 (한 번만)
```

- `verify editor boot files … OK`는 설치 파일 검사 통과다. Chromium 설치 후 L3로 실제
  부팅·로드·소리 출력을 검증해야 하며, 작품별 동작은 L4로 확인한다.
- setup 실패 시: 에러 메시지의 지시를 따른 뒤 **재실행** (idempotent).
- 형제 저장소(`../entryjs`, `../MYentry`)는 **없어도 된다** — 있으면 우선 사용할 뿐.
- 새 환경 재현 조건·알려진 한계·회귀 검사는 [콜드 클론 정본](knowledge/17-cold-clone.md)을 따른다.

## 제작 사이클

1. **설계** — 요청과 가장 비슷한 기존 spec을 골라 복제에서 출발.
   카탈로그: [tests/fixtures/README.md](tests/fixtures/README.md) ·
   종합 reference: `tests/fixtures/spec-frontier-guard.mjs` (25+ 패턴) ·
   완성 게임 예시: `games/*/spec.mjs`
2. **spec 작성** — `games/<이름>/spec.mjs` (DSL 권장 — helper 문서는
   [tools/lib/spec-dsl.mjs](tools/lib/spec-dsl.mjs) 상단 주석 + JSDoc)
   에셋 제작 방식은 현재 사용 가능한 도구를 기준으로 선택한다.
   **이미지 생성 도구가 없는 Claude Code 등의 환경에서는 기존 SVG 기능을 기본으로 사용한다.**
   [SVG 제작 절차](knowledge/03-objects-and-assets.md#이미지-생성-도구가-없는-환경의-svg-제작)에 따라
   `assets()`로 기존 모양을 재사용하고, `sprite-gen.mjs` 또는 직접 작성한 `svgString`으로
   캐릭터·아이템·배경·이펙트·애니메이션 모양을 완성한다. 도구 부재를 이유로 제작 범위를 줄이거나
   이미지 업로드·API 키·유료 도구 설치를 요구하며 멈추지 않는다.
   이미지 생성 도구가 있으면 일러스트 제작에 활용하고, 캐릭터·아이템은 투명 배경을 우선 요청한다.
   [AI 이미지 에셋 절차](knowledge/03-objects-and-assets.md#ai-이미지-생성과-투명-오브젝트)에 따라
   배경 제거·실제 알파 검사·등록을 진행한다. 실패하거나 사용할 수 없으면 SVG 제작으로 이어간다.
3. **정적 검증** — `node tools/make-ent.mjs games/<이름>/spec.mjs --check` (< 1초).
   통과할 때까지 2↔3 반복.
4. **빌드** — `node tools/make-ent.mjs games/<이름>/spec.mjs games/<이름>/<이름>_001.ent`
5. **검증 사다리** (아래) — 새 게임이면 `games/<이름>/verify.mjs`도 작성
   (기존 `tools/verify-*.mjs` 또는 `games/vampire-survival/verify.mjs` 복제·수정).
6. **보고** — `.ent` 경로 + 조작법/동작 설명 + 통과한 검증 레이어 명시.

## 검증 사다리 — 위에서부터, 막혀도 묻지 말고 끝까지

| 레이어 | 명령 | 전제 | 확인 내용 |
|---|---|---|---|
| L1 정적 | `node tools/make-ent.mjs <spec> --check` | `npm install`만 | 블록 type·슬롯·참조·ID 중복·로컬 에셋 (빌드 시에도 자동 검사) |
| L2 smoke | `npm run test:smoke` | `npm install`만 | tar/JSON 구조, 에셋 실재 |
| L3 부트+로드 | `npm run test:e2e` | setup + chromium | 편집기 부팅 console error 0, 전 fixture 로드 |
| L4 런타임 플레이 | `node tools/run-all-verify.mjs --filter <이름>` | setup + chromium | 실제 플레이: 변수 변화·클론·픽셀 |
| L5 사람 눈 (선택) | `npm start` → http://localhost:3000 | setup | 편집기에서 `.ent` 열어 ▶ 실행 |

- L3·L4가 **환경 문제**(chromium 설치 불가 등)로 막히면: L1+L2 통과한 `.ent`를 전달하되
  보고에 "런타임 검증 미수행 — 사유"를 명시한다. 사용자에게 검증 방식을 묻지 않는다.
- ⚠️ `npm run <script> -- --flag` 는 PowerShell 이 `--` 를 삼켜 인자가 유실된다 —
  필터 등 인자가 필요하면 위처럼 **`node tools/...` 직접 호출**을 쓴다.
- L4 실패가 **게임 로직 문제**면: [knowledge/lessons.md](knowledge/lessons.md)(과거 해결 이슈)와
  [knowledge/07-runtime-quirks.md](knowledge/07-runtime-quirks.md)(엔진 함정)부터 확인.
- **소리가 있는 작품은 오디오 기능 검사를 필수로 추가한다.** 배경음·효과음·음소거를 실제 입력으로
  발화시키고 등록·디코딩·블록 호출·출력 신호를 기록한다. console error 0이나 tar에 음원이 있다는
  사실만으로 소리 성공을 보고하지 않는다. 호스트 최소 검사는 `node games/audio-check/verify.mjs`이며,
  개별 작품의 소리 검사를 대체하지 않는다. [15 소리 검증](knowledge/15-audio-verification.md)의 절차와
  웹·오프라인·청취 검증 범위를 따른다.
- **공식 웹에 공개할 새 작품의 음원은 MP3를 기본으로 포함한다.** 합성 WAV는 실제 MP3로
  변환해서 번들하며 확장자만 바꾸지 않는다. [형식 선택 근거와 웹 검증](knowledge/15-audio-verification.md#공식-웹용-음원-형식-선택)을 따른다.

## 트러블슈팅

| 증상 | 처방 |
|---|---|
| verify가 **전부** 깨짐 / 편집기 부팅 실패 | `public/lib` 손상 의심 → `npm run setup` 재실행 (boot files 체크가 진단해줌) |
| 소리만 안 남 / 소리 라이브러리 버전 오류 | [15 소리 검증](knowledge/15-audio-verification.md) 순서로 에셋·등록·출력을 구분. 호스트 vendor 오류면 `node scripts/setup-audio.mjs` |
| 블록 type/param 에러 | `tools/block-registry.json`에서 검색: `node -e "console.log(JSON.stringify(require('./tools/block-registry.json').blocks['move_direction'],null,2))"` |
| Field 슬롯 드롭다운 매칭 실패 | `{"__field":"값"}` sentinel 사용 (README "필드 vs 블록 슬롯") |
| 엔진 고유 동작이 이상 | [knowledge/07-runtime-quirks.md](knowledge/07-runtime-quirks.md) — 60fps 틱, message fan-out 등 |
| entryjs **소스**가 필요 (레지스트리 재생성, 소스 인용) | `node scripts/setup.mjs --with-entryjs-src` — 그래도 빌드는 금지 |

## 지식 베이스 진입점

- [knowledge/README.md](knowledge/README.md) — **canonical matrix**: 문제 유형별 정본 문서 지도
- [knowledge/04-script-and-blocks.md](knowledge/04-script-and-blocks.md) — 블록 레퍼런스 + 설계 패턴 25+
- [knowledge/07-runtime-quirks.md](knowledge/07-runtime-quirks.md) — 엔진 함정 (게임이 "이상하게" 동작할 때)
- [knowledge/lessons.md](knowledge/lessons.md) — 과거 해결한 버그 1줄 회귀 가드
