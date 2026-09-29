# `.ent` 파일 위키

엔트리(entryjs) 프로젝트 파일(`.ent`) 생성·조작에 필요한 지식. 이 저장소에서 **시행착오로 배운** 비자명한 사실 위주.
공식 스키마 문서가 아니라 "이대로 하면 작동한다"의 실전 레퍼런스.

## 언제 어느 문서를 볼 것인가

| 상황 | 읽을 문서 | 파일 유형 |
|------|-----------|-----------|
| 새 환경 설치·재현 실패·공개 저장소 경계 | [17-cold-clone.md](17-cold-clone.md) | Guide · 현행 · 2026-09-17 |
| **소리가 안 남** / 소리 등록·디코딩·블록 출력·음소거·내보내기 왕복 / 웹 음원 404 | [15-audio-verification.md](15-audio-verification.md) | Guide · 현행 · 2026-09-17 |
| **처음 들어왔다 · 30초 요약** | [quick-reference.md](quick-reference.md) | 진입점 |
| 공식 typedef·API 직접 확인 / 어떤 필드가 공식인지 | [00-official-sources.md](00-official-sources.md) | Reference |
| `.ent` 바이너리가 깨짐 / tar 구조 확인 | [01-binary-format.md](01-binary-format.md) | Reference |
| `project.json` 최상위 키가 뭐가 필요한지 | [02-project-json.md](02-project-json.md) | Reference |
| 오브젝트·이미지 필드 / 이미지를 tar에 포함시키는 법 | [03-objects-and-assets.md](03-objects-and-assets.md) | Reference |
| AI로 오브젝트 생성 / 배경 제거 / 투명 PNG를 spec에 연결 | [03 AI 이미지 에셋](03-objects-and-assets.md#ai-이미지-생성과-투명-오브젝트) | Guide · 현행 · 2026-09-10 |
| 블록 type 이름 / params 쉐이프 / 필드 vs 블록 슬롯 / 설계 패턴 (플랫포머·HUD) | [04-script-and-blocks.md](04-script-and-blocks.md) | Reference + Guide |
| 편집기가 안 뜨거나 콘솔 에러 / 헤드리스 테스트 / **playentry 기존 작품에 덮어쓰기** | [05-host-editor.md](05-host-editor.md) | Guide |
| 가만히 있는 그림을 살리기(**보일링**) / 장면을 조각이 붙으며 열기(**팝업북**) | [04 보일링](04-script-and-blocks.md#보일링선-떨림--모양-세-장을-타이머-박자로-돌리기) · [04 장면 조립](04-script-and-blocks.md#장면-조립팝업북--조각을-하나씩-붙이며-장면-열기) | Guide · 현행 · 로컬 끝까지 플레이 검사 · 2026-09-29 |
| 음악과 장면·자막이 어긋남 / 로딩·준비 지연 / 시계 원점과 표시값 구분 | [16-music-synchronization.md](16-music-synchronization.md) | Guide · 현행 · 로컬 실행 근거 · 2026-09-15 |
| **리듬게임**의 채보·판정·일시정지 복귀·고해상도 자산·입력 완주 검증 | [18 CHROMA 네이티브 리듬게임](18-chroma-native-rhythm-case-study.md) | Case study · 현행 · 로컬 `.ent` 실행 근거 · 2026-09-20 |
| **유사 3D 레이싱**(커브·언덕 도로 렌더러·라이벌 AI·랩 타임·엔진음)과 블록별 실행 비용을 참고할 때 | [19 선셋 드라이브](19-sunset-drive-case-study.md) | Case study · 현행 · 로컬 런타임·키 입력 완주·실서비스 구현 대조 · 2026-09-23 |
| Entry 엔진의 불변 동작 (60fps 반복, short-circuit, 키 이벤트 등) | [07-runtime-quirks.md](07-runtime-quirks.md) | Runtime quirks |
| **온라인 대전 작품**을 만들 때 (Entry Online 확장 계약·동기화 설계) | [08-entry-online.md](08-entry-online.md) | Reference + Guide |
| **대규모 RPG**의 맵·복제본·대화·저장 설계를 참고할 때 | [09-rpg-case-study.md](09-rpg-case-study.md) | Case study · 정적 확인 · 2026-09-10 |
| **뮤직비디오**의 모양 시퀀스·타이머·신호별 레이어를 설계할 때 | [10-music-video-case-study.md](10-music-video-case-study.md) | Case study · 정적 확인 · 2026-09-10 |
| **3D 표현**의 직교투영·법선·면 선택·회전 수식을 참고할 때 | [11-3d-game-case-study.md](11-3d-game-case-study.md) | Case study · 정적 확인 · 2026-09-10 |
| **실행 가능한 1인칭 던전**의 DDA·깊이 버퍼·길찾기·전투·로그라이크를 참고할 때 | [14-abyssal-keep-case-study.md](14-abyssal-keep-case-study.md) | Case study · 현행 · 로컬 런타임·키 입력 완주 검증 · 2026-09-10 |
| **공 타격 전투·웨이브·스킬 선택**을 설계할 때 | [12-a-ball-2-case-study.md](12-a-ball-2-case-study.md) | Case study · 현행 · 정적 확인 · 2026-09-10 |
| **자동 바운스·맵 편집·클리어 후 저장**을 설계할 때 | [13-bouncy-ball-case-study.md](13-bouncy-ball-case-study.md) | Case study · 정적 확인 · 2026-09-10 |
| 사례의 원본 버전과 블록 근거를 다시 검사할 때 | [evidence/README.md](evidence/README.md) | 재검증 절차 · 2026-09-10 |
| 과거 해결된 버그 요약 (가드 파일 링크) | [lessons.md](lessons.md) | Lessons |
| 날짜별로 뭘 배웠는지 | [CHANGELOG.md](CHANGELOG.md) | History |

활성 함정 문서(`06-gotchas.md`)는 현재 **비어 있음** — 알려진 활성 함정이 없는 상태.
구조적으로 해결 불가능한 새 함정이 발견되면 그때 이 파일을 신설.

## 심연의 성채 제작에서 갱신한 정본

| 문서 | 책임 | 상태 | 갱신 |
| --- | --- | --- | --- |
| [14 심연의 성채 사례](14-abyssal-keep-case-study.md) | DDA·가림·벽 캐시·BFS·게임 조건, 대상 해시와 검증 범위 | 현행 · 기존 로컬 실행 기록과 소리 후속 진단을 구분 | 2026-09-11 |
| [04 블록·패턴](04-script-and-blocks.md#dsl-수식은-실행-시점에-따라-구분한다) | 제작 시 JS와 실행 중 DSL 수식 구분 | 현행 · 소스·수정 사례 확인 | 2026-09-10 |
| [07 런타임 특성](07-runtime-quirks.md#불리언-false와-숫자-0은-같음-비교에서-다르다) | 불리언/숫자 비교, 배열 조회 비용, 낮은 알파 클릭 재현 | 현행 · 소스·로컬 관측 | 2026-09-10 |
| [05 검증](05-host-editor.md#기능-검사와-입력-완주는-별도로-기록한다) | fixture 검사와 입력 완주의 구분·기록, 소리 vendor 지침 정정 | 현행 · 적용 확인 | 2026-09-11 |
| [03 소리](03-objects-and-assets.md#합성-wav를-포함하고-음악을-별도-스레드에서-반복하기) | WAV 생성·번들, 효과음과 음악 재생 스레드 | 현행 · 번들 확인, 출력 검증은 15 | 2026-09-11 |
| [15 소리 검증](15-audio-verification.md) | 호스트 소리 의존성·최소 작품·등록/디코딩/블록 출력·음소거·웹/오프라인 진단 | 현행 · 로컬/오프라인 출력 확인, 웹 MP3만 재생은 사용자 관측 | 2026-09-11 |
| [lessons](lessons.md#1인칭-던전-제작) | 이번에 해결한 오류 3개의 회귀 확인 위치 | 현행 | 2026-09-10 |

## 사실의 출처 (우선 순위)

1. **[entrylabs/docs](https://github.com/entrylabs/docs)** — 공식 문서. 최고 권위. [00-official-sources.md](00-official-sources.md)에 인덱스.
2. **[엔트리 원본 소스](https://github.com/entrylabs/entryjs/tree/53e121523760f15961cd14ab7cb93563a79eaab3/src)** — 공식 문서에 없는 세부 동작의 근거. 인용한 파일·리비전과 실제 실행 배포본의 버전을 구분한다.
3. **공식 내보내기 파일** — 정상 동작하는 `.ent`의 구조 근거. 원본은 공개하지 않으며 [사례 근거](evidence/README.md)에 파일 해시와 검증 범위를 남긴다.
4. **이 저장소의 구현·검증 기록** — [server.js](../server.js)와 [실측 근거](evidence/README.md). 특정 파일의 관측을 엔진 전체 규칙으로 일반화하지 않는다.

주장 옆에는 가능하면 `파일:줄번호` 또는 `commit <hash>` 형태로 출처를 남긴다.
공식 문서에 있는 사실은 그쪽을 1순위로 인용.
추측이면 "(추정)" 표시.

외부 작품 사례는 **그 파일이 어떻게 구성됐는지**의 근거다. 엔진 일반 규칙의 출처보다 우선하지 않는다.
[09〜13 사례의 증거](evidence/README.md)는 원본 SHA-256과 JSON pointer로 고정한다.
첨부 작품은 직접 실행하지 않고 구조를 분석했으며, 성능·플레이·공식 사이트 호환성 보장은 별도 검증이 필요하다.
[14 직접 제작 사례](14-abyssal-keep-case-study.md)는 대상 파일 해시와 로컬 기능 검사·입력 완주 기록에 근거한다.

## 정본 (canonical) 매트릭스 — DRY 유지

각 사실은 **정본 한 곳**에서만 풀 설명. 다른 파일은 한 줄 + 정본 링크. 이 규칙으로
중복 설명이 누적되는 걸 방지.

| 사실 | 정본 (full) | 다른 파일에선 한 줄 + 링크 |
|------|-------------|--------------------------|
| 콜드 클론 재현 조건·문서 경계·검증 결과 | [17 콜드 클론](17-cold-clone.md) | README, CLAUDE |
| 오디오 의존성·작품별 출력 검사 | [15 소리 검증](15-audio-verification.md) | README, CLAUDE, 03, 05, quick-reference, lessons, 14 |
| 음악 시작 기준 시각·프레임 대조·준비 지연 재현·동기화 검사 범위 | [16 음악 동기화](16-music-synchronization.md) | 10, lessons, evidence |
| 프로젝트 초시계 START/RESET과 저장값 갱신 지연 | [07 초시계](07-runtime-quirks.md#프로젝트-초시계의-원점과-표시값은-다르다) | 16, lessons |
| 크기 정하기의 폭·높이 평균 단위와 긴 자막 검사 | [07 크기](07-runtime-quirks.md#크기-정하기는-퍼센트가-아니다) | 03, lessons |
| 리듬 채보의 공통 시각·저장 위치에서 음악 재개·판정 결과 기반 연출 | [18 CHROMA](18-chroma-native-rhythm-case-study.md) | 16 (일반 동기화), lessons (회귀 확인) |
| CHROMA의 이미지 치수·배율·초기 표시와 자동 연주/입력 완주의 검증 범위 | [18 화면·검증 사례](18-chroma-native-rhythm-case-study.md#4-선명한-자산과-초기-화면도-작품-데이터다) | evidence (버전 고정·구조 단언) |
| 세그먼트 방식 유사 3D 도로 — 투영식·언덕 가림·재귀가 돌아오며 도장(화가 알고리즘)·거리 안개 팔레트 | [19 선셋 드라이브](19-sunset-drive-case-study.md) | 게임 README |
| 블록별 실행 비용 실측(전역 쓰기 5µs·BigNumber 나눗셈·지역 변수·도장) | [19 §5](19-sunset-drive-case-study.md#5-블록-비용을-재고-설계했다) | 07 (전역 쓰기 한 줄) |
| 전역 `변수 정하기`는 숨긴 변수여도 모니터 배치 계산 — 반복 안에서는 매개변수·지역 변수 | [07 전역 쓰기](07-runtime-quirks.md#전역-변수-정하기는-숨긴-변수여도-약-5µs--모니터-배치-계산이-매번-돈다) | 19 |
| 붓 선·채우기 레이어는 처음 만든 순서, 도장은 항상 위 | [07 레이어 순서](07-runtime-quirks.md#붓-선과-채우기-레이어는-처음-만든-순서대로-쌓이고-도장은-항상-그-위다) | 19 |
| `배경음악 재생하기`는 `소리 재생 속도`와 분리 — 엔진음 음높이와 음악 공존 | [07 BGM](07-runtime-quirks.md#배경음악-재생하기는-소리-재생-속도의-영향을-받지-않는다) | 19, 15 |
| 크기 정하기는 현재 모양의 치수 기준 — 모양을 바꾼 뒤 다시 정한다 | [07 모양 뒤 크기](07-runtime-quirks.md#크기-정하기는-현재-모양의-치수로-계산된다--모양을-바꾼-뒤-다시-정한다) | lessons, 19 |
| 사용 블록 구현을 실서비스와 해시로 대조(업로드 없이 호환성 근거) | [05 엔진 사본](05-host-editor.md#2026-09-23-실측--게임이-쓰는-블록실행-경로는-실서비스와-같다) | 19 §8 |
| 움직이는 썸네일(APNG) — Entry Debugger 변환 예산·달린 거리 기준 캡처(줄무늬 역행 방지)·작은 물체 색을 살리는 팔레트 | [19 §9](19-sunset-drive-case-study.md#9-홍보용-움직이는-썸네일apng) | — |
| 기존 script의 단일 파싱 트리·깊은 복제·블록 id와 변경 수 대조 | [04 기존 스크립트 수정](04-script-and-blocks.md#기존-스크립트의-여러-항목을-수정할-때) | 01, lessons |
| 외부 작품 tar 엔트리 보존과 허용 변경 검사 | [01 부분 수정](01-binary-format.md#기존-작품의-일부만-수정하기) | 16 |
| 글상자 초기 두 text 필드와 동적 text_write 데이터 출처 | [03 글상자](03-objects-and-assets.md#️-글상자-문자열은-objecttext-와-entitytext-두-곳에-있다) | lessons |
| 키 블록 값은 숫자 키 코드 · 누르고 있는 이동은 반복 + `isPressed` | [04 이벤트](04-script-and-blocks.md#이벤트-시작-블록) | CLAUDE, lessons |
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
| `when_scene_start` 첫 장면 미발화 (시작은 `when_run_button_click` 만) | [07 §when_scene_start 첫 장면 미발화](07-runtime-quirks.md#when_scene_start-는-시작-시-첫-장면에서-발화-안-함--start_scene-전환에서만) | 04 (멀티 장면 데모), lessons |
| 멀티 장면 데모 — 랜딩+홈+기능 / textBox 버튼 / self-only `text_write` | [04 §멀티 장면 데모](04-script-and-blocks.md#멀티-장면-데모--랜딩-장면--홈--기능-장면-startscene) | 07 (when_scene_start) |
| 한글 자모 prefix 자동완성 (disassemble + `index_of`==1) | [04 §한글 자모 prefix 자동완성](04-script-and-blocks.md#한글-자모-prefix-자동완성-disassemble-매칭) | (es-hangul 데모 전용) |
| textBox `entity.x`=가운데(폭 무관 `x:0`) · 글자 `textAlign:0`(1=왼쪽) · 고정폭 `lineBreak:true` · regX/regY 강제0 | [07 §textBox 정렬](07-runtime-quirks.md#textbox-정렬--regxregy-강제-0-가운데는-textalign0-1-아님) | 04 (멀티 장면 데모 — 버튼/박스) |
| 붓 슬로우컬러 단색 배경 (`set_color` 가 동적 hex 문자열 허용 → PALETTE 리스트 순환) | [04 §붓 슬로우컬러 배경](04-script-and-blocks.md#붓으로-슬로우-컬러-단색-배경-글상자-투명--뒤에-깔기) | (es-hangul 데모) |
| `brush_stamp` 렌더 예산 (프레임당 ~250 칸) | [07 §brush_stamp 타일 렌더러](07-runtime-quirks.md#brush_stamp-타일-렌더러--매-프레임-252-칸-재그리기도-62fps-스크롤-게임-예산) | 04 (타일맵 렌더 안에서) |
| `char_at`/`substring` 범위 밖 `throw` · `replace_string` 전량 치환 | [07 §char_at·substring throw](07-runtime-quirks.md#char_at--substring-은-범위를-벗어나면-throw--문자열-타일맵에-가드-필수) | 04 (맵 표현 안에서), lessons |
| 문자열 타일맵 + 서브스텝 스윕 충돌 (대규모 사이드스크롤 플랫포머) | [04 §문자열 타일맵 + 서브스텝 스윕](04-script-and-blocks.md#문자열-타일맵--서브스텝-스윕-충돌--사이드스크롤-플랫포머) | 04 (§발판 충돌 패턴에서 규모 한계 링크) |
| 헤드리스 브라우저 ~10 회 재부팅 후 키 이벤트 미도달 | [07 §브라우저 ~10 회 재부팅](07-runtime-quirks.md#헤드리스-검증에서-브라우저를-10-회-재부팅하면-키-이벤트가-게임에-도달하지-않는다) | 05 (봇 플레이 검증 안에서), lessons |
| 액션 게임 봇 플레이 검증 (센싱 왕복·키 hold·트리거 스윕) | [05 §액션 게임을 봇으로 플레이해서 검증](05-host-editor.md#액션-게임을-봇으로-플레이해서-검증하기) | (verify 작성 가이드 — 04 §회귀 가드 레이어의 L4 세부) |
| 렌더 예산은 **그린 칸**으로 센다 (순회는 공짜) · 타일 크기별 실측표 · 성능 비교는 케이스마다 브라우저 재기동 | [07 §렌더 예산은 그린 칸으로](07-runtime-quirks.md#brush_stamp-렌더-예산은-방문-칸이-아니라-그린-칸으로-센다--타일-크기를-바꾸면-다시-재야-한다) | 07 §brush_stamp(단발 실측) |
| 타일 배율은 상수 하나에서 유도 (길이 상수 누락·verify 사본이 단정을 헐겁게 만듦) | [04 §타일 크기는 한 곳에서 유도](04-script-and-blocks.md#타일-크기는-한-곳에서-유도한다--검증-코드까지) | lessons |
| 엔진 사본 버전 기준 (npm 4.0.20 핀 vs 실서비스 격차 · pull이 사본을 안 바꾸는 이유) | [05 §엔진 사본의 버전 기준](05-host-editor.md#엔진-사본의-버전-기준-npm-핀과-실서비스의-격차) | — |
| 글상자에 효과 블록 → 스레드 사망 (`entity.effect` 는 sprite 에만 초기화) | [07 §효과 블록과 글상자](07-runtime-quirks.md#효과-블록change_effect_amount-등을-글상자에-걸면-스레드가-죽는다) | (잠김/열림은 오브젝트 2개 show/hide), lessons |
| 장면 재진입 시 `when_scene_start` 들이 지난 판 값을 먼저 읽음 (오브젝트 간 순서 미보장) | [07 §장면 재진입 순서](07-runtime-quirks.md#장면을-다시-들어가면-when_scene_start-들이-지난-판의-값을-먼저-읽는다) | 08 (§3.3 관찰 가능한 조건), lessons |
| 클론 초기값은 **엔티티 상속**으로 (전역+`when_clone_start` 는 한 프레임 다중 생성 시 겹침) | [07 §회피 패턴 2 — 엔티티 상속](07-runtime-quirks.md#회피-패턴-2--엔티티-상속으로-넘기기-자리모양이-목적일-때) | 08 (§3.4 렌더러), lessons |
| Entry Online 계약(빈 함수·예약 변수) · 쓰기 소유권 · 상태 기반 렌더러 · 서버 없이 검증 | [08-entry-online.md](08-entry-online.md) | 07 (개별 엔진 함정), `games/hexo` |
| `몫`/`나머지` 는 floor 나눗셈 + 진짜 모듈로 (JS `%` 와 음수에서 다름) | [07 §몫·나머지](07-runtime-quirks.md#몫나머지-는-floor-나눗셈--진짜-모듈로--js--가-아니다) | 08 (무한 좌표), `games/hexo` |
| 글상자 entity 를 비워두면 `font:'undefinedpx '` → **fontSize NaN** → 글자 10px | [07 §fontSize NaN](07-runtime-quirks.md#글상자-entity-를-비워두면-fontsize-가-nan--글자가-10px-로-쪼그라든다) | 03 (§textBox 체크리스트 · §Entity `font` 행), lessons |
| `lineBreak:true` 는 `height` 넘는 줄을 **그리지 않고 버린다** (CreateJS `getMeasuredWidth()` 는 줄바꿈 무시 → 높이로 재라) | [07 §lineBreak 세로 클리핑](07-runtime-quirks.md#linebreak-true-는-height-를-넘는-줄을-그리지-않고-버린다) | 03 (§textBox 체크리스트), 07 §textBox 정렬 |
| `묻고 대답 기다리기` — 입력칸이 무대 y −71~−112 를 덮고, 말풍선은 `hide()` 로 안 사라짐 (`x:500` 으로 밀어냄) | [07 §묻기 입력칸·말풍선](07-runtime-quirks.md#묻고-대답-기다리기--입력칸이-무대-아래-71-부터를-덮고-말풍선은-hide-로-안-사라진다) | lessons |
| 장면 재진입 시 **실행기는 쌓이지 않는다**(`resetSceneDuringRun`) — 대신 `entity.reset()` 이 좌표를 되돌림 | [07 §장면 재진입 실행기](07-runtime-quirks.md#장면을-다시-들어가도-실행기는-쌓이지-않는다--대신-entityreset-이-좌표를-되돌린다) | 07 §장면 재진입 순서(값), 04 (등장 애니메이션) |
| 글상자만으로 애니메이션 — 글자 프레임·좌표·타자기 (효과 블록 금지의 회피) · KS X 1001 기호만 | [04 §글상자만으로 애니메이션](04-script-and-blocks.md#글상자만으로-애니메이션--글자-프레임--좌표--타자기) | 07 §효과 블록과 글상자, 05 (에셋 0 배포) |
| **콘솔 붙여넣기 배포** — 기존 playentry 작품에 `project.json` 만 교체(조회수·좋아요 보존). 전제 = **에셋 0** | [05 §콘솔 붙여넣기 배포](05-host-editor.md#playentryorg-배포--기존-작품에-projectjson-만-갈아끼우기-콘솔-붙여넣기) | 03 (글상자로 에셋 0), 01/02 (tar·JSON 구조) |
| 오브젝트 전용 변수·리스트와 클론별 저장소, 함수 지역 변수와의 구분 | [04 §오브젝트 전용 변수](04-script-and-blocks.md#오브젝트-전용-변수와-클론별-상태) | 09 (RPG의 사용 사례) |
| PNG 생성 정책과 외부 `.ent`의 SVG 원본·래스터·썸네일 구분 | [03 §외부 작품의 SVG](03-objects-and-assets.md#외부-작품을-읽을-때는-svg도-보존한다) | 01, quick-reference, 10 (실제 관측) |
| 대규모 RPG의 복제본 배치·대화 입력·직렬화와 외부 저장 경계 | [09 RPG 사례](09-rpg-case-study.md) | 04 (사례 탐색 링크) |
| 뮤직비디오의 누적 마감시각·독립 레이어·신호 오케스트레이션 | [10 뮤직비디오 사례](10-music-video-case-study.md) | 04 (사례 탐색 링크) |
| 정육면체의 직교투영·법선 부호 면 선택·조명 | [11 3D 사례](11-3d-game-case-study.md) | 04 (사례 탐색 링크) |
| 한글 타일 코드·시간 설정 직렬화·맵 수정 시 클리어 검증 무효화 | [13 BOUNCY BALL 사례](13-bouncy-ball-case-study.md) | 04 (사례 탐색 링크) |
| 외부 작품 원본 해시·정규화 JSON pointer 기반 주장 재검증 | [evidence 절차](evidence/README.md) | 09~13 (최소 근거 JSON) |
| DSL 함수 인자는 값이 아닌 블록 참조 — JS 수식과 실행 중 수식 구분 | [04 DSL 수식](04-script-and-blocks.md#dsl-수식은-실행-시점에-따라-구분한다) | 14, lessons |
| 불리언 false와 숫자 0의 같음 비교·타입 혼용 | [07 불리언 비교](07-runtime-quirks.md#불리언-false와-숫자-0은-같음-비교에서-다르다) | 14, lessons |
| 전역 변수·리스트의 ID 조회는 배열 탐색 — 빈번한 조회 순서 검토 | [07 조회 순서](07-runtime-quirks.md#전역-변수-리스트-조회는-배열-탐색이다) | 14 (적용과 성능 측정 조건) |
| 낮은 알파 카드의 마우스 실패 재현 | [07 낮은 알파 재현](07-runtime-quirks.md#낮은-알파의-클릭판도-pixelperfect-검사에서-탈락할-수-있다) | 14, lessons (원리는 기존 sprite pixelPerfect 항목) |
| 카메라 평면 DDA·조각별 가림·벽 캐시·완료 후 교체하는 BFS | [14 심연의 성채 사례](14-abyssal-keep-case-study.md) | 04, 게임 README |
| fixture 기능 검사와 상태 읽기·입력만의 완주, 버전별 결과 기록 | [05 검증 분리](05-host-editor.md#기능-검사와-입력-완주는-별도로-기록한다) | 14 (구체적인 결과) |
| 합성 PCM WAV 번들·효과음과 별도 음악 스레드 | [03 WAV 재생 사례](03-objects-and-assets.md#합성-wav를-포함하고-음악을-별도-스레드에서-반복하기) | 14, 게임 README |
| 런타임 오류(`throw`) → 작품 정지·변수를 실행 시작 값으로 되돌림 · 헤드리스 진단(엔진 상태·멈춤 스택·pageerror) | [07 런타임 오류](07-runtime-quirks.md#런타임-오류throw는-작품을-멈추고-변수리스트를-실행-시작-값으로-되돌린다--증상이-원인에서-멀리-보인다) | 05 (멈춤 진단), lessons |
| 신호 핸들러는 받는 오브젝트 차례에 돈다 — 이름 변수 하나 + 신호로 낸 효과음이 사라짐 → 리스트 줄 | [07 신호 핸들러 차례](07-runtime-quirks.md#신호-핸들러는-받는-오브젝트의-차례에-돈다--보낸-쪽이-곧바로-바꾼-변수를-읽는다) | 15 (진단 단계), 04 (장면 조립), lessons |
| `message_cast_wait` 는 현재 장면의 **모든** 리스너(복제본 포함)가 끝날 때까지 기다린다 | [07 §message_cast race 의 정정](07-runtime-quirks.md#message_cast-핸들러는-동시-실행--같은-메시지-다중-리스너-race) | 04 (장면 조립) |
| `클릭했는가?` 는 누른 동안만 참 — 틱 사이 클릭을 폴링이 놓침(헤드리스는 down·60ms·up) | [07 is_clicked](07-runtime-quirks.md#클릭했는가is_clicked는-누르고-있는-동안만-참--틱-사이에-눌렀다-뗀-클릭은-못-본다) | 05, lessons |
| 오브젝트 목록 앞쪽 = 위 레이어(spec 에서 먼저 `push` 한 것이 위) | [07 레이어](07-runtime-quirks.md#오브젝트-목록의-앞쪽이-위에-그려진다--spec-objects-배열-순서가-곧-레이어) | lessons |
| 보일링(선 떨림) — 후처리 세 장·모양 번호와 타이머 박자·`다음 모양` 금지·용량 | [04 보일링](04-script-and-blocks.md#보일링선-떨림--모양-세-장을-타이머-박자로-돌리기) | 03, lessons |
| 장면 조립(팝업북) — 장면 시작에 숨기고 신호 하나로 시차를 두고 붙이기 | [04 장면 조립](04-script-and-blocks.md#장면-조립팝업북--조각을-하나씩-붙이며-장면-열기) | 07 (message_cast_wait) |
| 헤드리스 장면 바로 가기(`fireEvent('when_scene_start')`)·그릴 때마다 재기·페이지 안 시각의 창으로 정확히 세기 | [05 헤드리스 런타임 검증](05-host-editor.md#그릴-때마다-재기--entrystageupdate-감싸기) | 15, lessons |
| 이미지 편집 요청의 지정 밖 변화 → 바뀐 곳만 조각으로 얹기, "사라진 먹"으로 바뀐 곳 찾기 | [03 편집 요청](03-objects-and-assets.md#편집-요청은-지정한-곳-밖도-조금-바꾼다--바뀐-곳만-얹는다) | lessons |

**규칙**: 새 사실 추가 시 위 표에 한 줄 추가. 정본을 두 곳에 둘 일이 생기면 둘 중
하나가 더 적합한 위치. 모호하면 07 (불변 동작) 또는 04 (블록·패턴) 우선.

## 파일 유형별 업데이트 규칙

**유형에 따라 편집 방식이 다르다**. 한 파일에 두 유형을 섞지 말 것.

### 📚 Reference — `00~04`, `quick-reference`

**자유롭게 수정·리팩터링**. 사실이 바뀌면 그 자리를 덮어쓴다. 역사 추적은 `git log`.
섹션을 지우는 것도 OK — 지금 틀린 정보를 계속 남겨두면 독자가 헷갈린다.

### 🛠️ Guide — `04`의 설계 패턴 섹션들, `05-host-editor`, `16-music-synchronization`

"이런 걸 하려면 이렇게" 유형. 패턴이 개선되면 기존 글을 고쳐서 최신 방법을 유지.

### Case study — `09~14`, `18`, `evidence/`

영속 레퍼런스의 사례 분석이다. 파일 버전·관측 범위를 명시하고 증거와 함께 수정한다. 기존 패턴과 엔진 특성은 정본에 링크하고, 작품의 설계 선택만 해당 사례에서 설명한다. 성능 수치나 실행 보장은 실제 측정 전에는 추가하지 않는다.

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

현재 생성기는 ustar tar → gzip(memLevel:6)으로 `temp/project.json`과 에셋을 묶고, 이미지를 PNG로 변환하며 Picture의 `thumbUrl`을 생략한다. 외부 `.ent`에는 SVG도 있다([이미지 형식 정본](03-objects-and-assets.md)). `object.script`는 JSON 문자열로 저장된 2차원 배열이며, 호스트 편집기는 로드 전에 `Entry.clearProject()`를 호출한다. 필수 필드와 참조 검증은 [블록·검증](04-script-and-blocks.md), 실제 작품의 설계 근거는 위 사례 문서에서 확인한다.
