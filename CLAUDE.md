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

- setup 마지막 줄 `verify editor boot files … OK` 가 나오면 편집기 + 헤드리스 검증 환경 완성.
- setup 실패 시: 에러 메시지의 지시를 따른 뒤 **재실행** (idempotent).
- 형제 저장소(`../entryjs`, `../MYentry`)는 **없어도 된다** — 있으면 우선 사용할 뿐.

## 제작 사이클

1. **설계** — 요청과 가장 비슷한 기존 spec을 골라 복제에서 출발.
   카탈로그: [tests/fixtures/README.md](tests/fixtures/README.md) ·
   종합 reference: `tests/fixtures/spec-frontier-guard.mjs` (25+ 패턴) ·
   완성 게임 예시: `games/*/spec.mjs`
2. **spec 작성** — `games/<이름>/spec.mjs` (DSL 권장 — helper 문서는
   [tools/lib/spec-dsl.mjs](tools/lib/spec-dsl.mjs) 상단 주석 + JSDoc)
3. **정적 검증** — `node tools/make-ent.mjs games/<이름>/spec.mjs --check` (< 1초).
   통과할 때까지 2↔3 반복.
4. **빌드** — `node tools/make-ent.mjs games/<이름>/spec.mjs --out games/<이름>/<이름>_001.ent`
5. **검증 사다리** (아래) — 새 게임이면 `games/<이름>/verify.mjs`도 작성
   (기존 `tools/verify-*.mjs` 또는 `games/vampire-survival/verify.mjs` 복제·수정).
6. **보고** — `.ent` 경로 + 조작법/동작 설명 + 통과한 검증 레이어 명시.

## 검증 사다리 — 위에서부터, 막혀도 묻지 말고 끝까지

| 레이어 | 명령 | 전제 | 확인 내용 |
|---|---|---|---|
| L1 정적 | `node tools/make-ent.mjs <spec> --check` | `npm install`만 | 블록 type·paramCount·슬롯 wrap |
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

## 트러블슈팅

| 증상 | 처방 |
|---|---|
| verify가 **전부** 깨짐 / 편집기 부팅 실패 | `public/lib` 손상 의심 → `npm run setup` 재실행 (boot files 체크가 진단해줌) |
| 블록 type/param 에러 | `tools/block-registry.json`에서 검색: `node -e "console.log(JSON.stringify(require('./tools/block-registry.json').blocks['move_direction'],null,2))"` |
| Field 슬롯 드롭다운 매칭 실패 | `{"__field":"값"}` sentinel 사용 (README "필드 vs 블록 슬롯") |
| 엔진 고유 동작이 이상 | [knowledge/07-runtime-quirks.md](knowledge/07-runtime-quirks.md) — 60fps 틱, message fan-out 등 |
| entryjs **소스**가 필요 (레지스트리 재생성, 소스 인용) | `node scripts/setup.mjs --with-entryjs-src` — 그래도 빌드는 금지 |

## 지식 베이스 진입점

- [knowledge/README.md](knowledge/README.md) — **canonical matrix**: 문제 유형별 정본 문서 지도
- [knowledge/04-script-and-blocks.md](knowledge/04-script-and-blocks.md) — 블록 레퍼런스 + 설계 패턴 25+
- [knowledge/07-runtime-quirks.md](knowledge/07-runtime-quirks.md) — 엔진 함정 (게임이 "이상하게" 동작할 때)
- [knowledge/lessons.md](knowledge/lessons.md) — 과거 해결한 버그 1줄 회귀 가드
