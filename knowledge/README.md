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

## 정본 (canonical) 매트릭스 — DRY 유지

각 사실은 **정본 한 곳**에서만 풀 설명. 다른 파일은 한 줄 + 정본 링크. 이 규칙으로
중복 설명이 누적되는 걸 방지.

| 사실 | 정본 (full) | 다른 파일에선 한 줄 + 링크 |
|------|-------------|--------------------------|
| 60fps 암묵 틱 + `wait_second` 비용 | [07 §반복하기 블록](07-runtime-quirks.md#반복하기-블록--1-프레임반복-60fps-암묵-틱) | 04 (브러쉬 패턴 안에서) |
| 꼬리 재귀가 틱 우회 | [07 §함수 호출은 반복하기의 60fps 틱을 우회](07-runtime-quirks.md#함수-호출은-반복하기의-60fps-틱을-우회-꼬리-재귀-최적화) | 04 (함수 정의), CHANGELOG |
| `boolean_and_or` 단락 평가 없음 | [07 §`boolean_and_or`](07-runtime-quirks.md#boolean_and_or에-단락-평가short-circuit-없음) | 04 (플랫포머 패턴 안에서) |
| 키 이벤트 `document` + `event.code` | [07 §키 이벤트](07-runtime-quirks.md#키-이벤트는-document--eventcode-로-dispatch) | 05 (헤드리스 검증 가이드 안에서) |
| `Entry.clearProject()` 필수 | [07 §clearProject](07-runtime-quirks.md#entryclearproject--loadproject-전-필수) | 02 (Scene 필드), lessons |
| `addChildAt(undefined)` 원인 | [lessons.md](lessons.md) 1줄 + make-ent 가드 | 02 (interface 필드), 04 (script 필드) |
| 블록 type 카탈로그 + params 형식 | [04](04-script-and-blocks.md) | (없음 — 04 가 유일 풀 reference) |
| 자산 번들링 / tar 포맷 | [01](01-binary-format.md) + [03](03-objects-and-assets.md) | (없음) |
| textBox 클릭 영역 (bgColor 의존) | [07 §textBox 클릭 영역](07-runtime-quirks.md#textbox-클릭-영역--bgcolor-에-따라-사각-전체-vs-glyph-픽셀만) | 04 (버튼 패턴), 03 (textBox 필드 안에서) |
| sprite pixelPerfect — 투명 픽셀 (ring 가운데) 클릭 안 됨 | [07 §sprite pixelPerfect](07-runtime-quirks.md#sprite-도-pixelperfect--투명-픽셀-ring-가운데-등-클릭-안-됨) | (filled circle + transparency 효과로 시각/클릭 분리) |
| Stage 논리 좌표 (480×270) vs canvas 픽셀 (640×360) 변환 | [07 §clickStagePoint 변환](07-runtime-quirks.md#stage-논리-좌표-vs-canvas-렌더-픽셀--clickstagepoint-변환-공식) | (verify 의 `page.mouse.click` 좌표 계산) |
| HUD 변화 감지 — `last_shown` 변수로 flicker 회피 | [04 §HUD 변화 감지](04-script-and-blocks.md#hud-textbox-갱신--last_shown-변수로-flicker-회피) | (textBox 매 프레임 writeText 부담 회피) |
| `wait_until` — `repeat.inf + if cond stopRepeat` | [04 §wait_until 패턴](04-script-and-blocks.md#wait_until-패턴--repeatinf--stoprepeat) | (DSL 직접 wait_until 없음 → 폴링 패턴) |
| 대규모 게임 빌드 메타-패턴 (스코프 분할 / bisect / 가드 레이어) | [04 §대규모 게임 빌드](04-script-and-blocks.md#대규모-게임-빌드--스코프-분할--bisect-디버깅--회귀-가드-레이어) | (개발 프로세스 — frontier-guard 7 phase 학습 정리) |
| 현재 picture id (`entity.picture.id` vs `selectedPictureId`) | [07 §현재 picture](07-runtime-quirks.md#현재-picture-는-entitypictureid--selectedpictureid-는-spec-의-초기값) | 03 (Object 키 순서 안에서), 04 (생김새 카테고리) |
| 복제본 (Clone) 패턴 — 반복 오브젝트 1 template + N 클론 | [04 §복제본 패턴](04-script-and-blocks.md#복제본-clone-패턴--같은-역할의-오브젝트가-반복될-때) | (spec 패턴 — 다른 파일에서 참조 시 한 줄 + 링크) |
| 게임 이미지 라이브러리 (sprite-gen / assets) | [03 §게임 이미지 라이브러리](03-objects-and-assets.md#게임-이미지-라이브러리--a-정적--b-생성기) | 04 (자산이 필요한 패턴 안에서) |
| `change_to_some_shape` 매칭 (id → name → index) | [07 §change_to_some_shape 매칭](07-runtime-quirks.md#change_to_some_shape-매칭-우선순위--id--name--index) | 04 (생김새 카테고리 안에서) |
| `message_cast` 다중 리스너 race | [07 §message_cast race](07-runtime-quirks.md#message_cast-핸들러는-동시-실행--같은-메시지-다중-리스너-race) | 04 (메시지 패턴 안에서) |
| `when_message` fan-out spawn (클론도 핸들러 보유) | [07 §when_message fan-out](07-runtime-quirks.md#when_message-핸들러는-클론에도-살아-있음--fan-out-spawn) | 04 (클론 자기 복제 방지 안에서) |
| 다중 `when_clone_start` 병렬 race | [07 §다중 when_clone_start race](07-runtime-quirks.md#다중-when_clone_start-스크립트는-병렬-실행--클론-초기화-race) | 04 (direction-as-id 안에서) |
| 클론 정체 — `direction` 속성을 id 저장소로 (좌표 불가능 시) | [04 §direction 으로 id 저장](04-script-and-blocks.md#클론-정체-판정--direction-속성을-id-저장소로-좌표-불가능-시) | (TD/총알/이펙트 — 좌표가 동적이라 식별 불가) |
| 클론 타입 분기 — `enemy_type_list[id]` + 데이터 주도 stat | [04 §클론 타입 분기](04-script-and-blocks.md#클론-타입-분기--enemy_type_listid--데이터-주도-stat-룩업) | (다종 적·아이템 — 단일 template 으로 처리) |
| 데이터 주도 다중 웨이브 — `wave_counts` + `wave_types` | [04 §다중 웨이브](04-script-and-blocks.md#데이터-주도-다중-웨이브--wave_counts--wave_types-flat-리스트) | (TD/스테이지 게임 — manager nested loop) |
| Splash AOE — 타겟 좌표 중심 반경 내 모든 적 | [04 §Splash AOE](04-script-and-blocks.md#splash-aoe--타겟-좌표-중심-반경-내-모든-활성-적) | (cannon/폭탄/이펙트) |
| 데미지 플래시 — `enemy_last_hp` drop 감지 + setEffect 펄스 | [04 §데미지 플래시](04-script-and-blocks.md#데미지-플래시--enemy_last_hp-리스트로-hp-drop-감지--seteffect-펄스) | (적 hit 시각 피드백 — 누적 안 되는 absolute 펄스) |
| `when_message` 가 template 발화 — direction-as-id 시 invalid index lookup | [07 §template 발화 가드](07-runtime-quirks.md#when_message-핸들러가-template-에도-발화--direction-as-id-시-invalid-index-lookup-으로-scene-전체-손상) | (range 가드: `if_(coord('self','direction') <= N)`) |
| 공격 빔 시각화 — brush source→target 라인 + cooldown erase | [04 §공격 빔 시각화](04-script-and-blocks.md#공격-빔-시각화--manager-단일-sprite-의-brush-로-sourcetarget-라인) | (TD/RTS — projectile 없이 attack 표현) |

**규칙**: 새 사실 추가 시 위 표에 한 줄 추가. 정본을 두 곳에 둘 일이 생기면 둘 중
하나가 더 적합한 위치. 모호하면 07 (불변 동작) 또는 04 (블록·패턴) 우선.

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
