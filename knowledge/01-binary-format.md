# 바이너리 포맷 — tar + gzip

`.ent` = **ustar tar** 아카이브 → **gzip** 단일 파일.

## tar 헤더 (ustar portable)

npm `tar` 패키지의 portable 출력 포맷과 정확히 일치해야 한다.
엔트리 서버 업로더도 npm `tar`로 풀기 때문에, 사소한 차이 하나로 디렉터리 생성이 스킵되고
그 하위 파일들이 전부 경로 매핑 실패 → 브라우저에서 404 → 이미지 회색 박스.

참조 구현: [`server.js:67-103`](../server.js#L67).

### 헤더 필드 (각 엔트리 앞 512 바이트)

| offset | len | 내용 |
|-------:|----:|------|
| 0      | 100 | 파일명 (UTF-8) |
| 100    | 8   | **mode** — 디렉터리 `"000755 \0"`, 파일 `"000644 \0"` (공백 1개 + NUL) |
| 108    | 8   | uid — **전부 NUL** (portable은 실제 uid 대신 NUL) |
| 116    | 8   | gid — **전부 NUL** |
| 124    | 12  | size — octal + NUL, 11자리 zero-pad |
| 136    | 12  | mtime — **디렉터리는 전부 NUL**, 파일만 `floor(Date.now()/1000).toString(8).padStart(11,'0')+'\0'` |
| 148    | 8   | checksum — 먼저 공백 8개로 초기화, 전 512바이트 합산 후 `sum.toString(8).padStart(6,'0')+'\0 '` |
| 156    | 1   | typeflag — 파일 `'0'`, 디렉터리 `'5'` |
| 257    | 6   | magic `"ustar\0"` |
| 263    | 2   | version `"00"` |
| 265    | 32  | uname — NUL (portable) |
| 297    | 32  | gname — NUL |

### 흔한 실수

- 디렉터리 mode를 `000644` (파일용)로 써서 엔트리 서버가 디렉터리 생성 스킵.
- mode의 공백 빠뜨림: `"0000755\0"` (공백 없음) 은 틀림. `"000755 \0"` 처럼 **1바이트 공백 + NUL**.
- 디렉터리에 mtime을 기입. 반드시 NUL 유지.
- chksum을 계산 전부터 빈 값으로 두면 0이 들어가고 대부분의 tar 구현은 관대하지만 npm tar는 엄격.

### 종료 마커

tar 말미에 **전부 NUL인 512바이트 블록 두 개** (= 1024 바이트) 추가.

## tar 레이아웃 순서

엔트리 자체 export와 바이너리 레벨 동일 순서:

```
temp/                                    ← 최상위 dir (mode 000755)
temp/<XX>/                               ← level-1 dirs
temp/project.json                        ← JSON 본체 (여기에!)
temp/<XX>/<YY>/                          ← level-2 dirs
temp/<XX>/<YY>/image/                    ← level-3 dirs
temp/<XX>/<YY>/thumb/
temp/<XX>/<YY>/sound/
temp/<XX>/<YY>/image/<hash>.png          ← payloads
temp/<XX>/<YY>/thumb/<hash>.png
temp/<XX>/<YY>/sound/<hash>.mp3
```

`project.json`이 level-1 dirs **뒤**, level-2 dirs **앞**에 온다. 순서가 다르면
파싱은 되지만 엔트리 인식이 비결정적.

## gzip 설정

```js
zlib.gzipSync(tarBuf, { memLevel: 6 })
```

`memLevel: 6` — 공식 [`.ent` 문서](https://github.com/entrylabs/docs/blob/master/source/entryjs/file/2024-07-24-ent.md)
명시. 기본값(8)이면 압축은 되지만 playentry.org 쪽에서 바이트 레벨 round-trip이 깨진다는
MYentry 커밋 `68a8dc4` 메모.

## 공식 tar 사용법

공식 문서의 tar.c 호출:
```js
await tar.c({
    file: destination,
    gzip: { memLevel: 6 },
    cwd,
    filter: (path, stat) => !stat.isSymbolicLink(),
    portable: true,
}, [fileList]);
```

**`portable: true`** — 이 옵션 하나로 npm `tar` 패키지가 portable 헤더(uid/gid/uname/gname NUL,
디렉터리 0755 등)를 생성한다. 우리가 수작업으로 구현한 `tarHeader`는 이 옵션의 동작을 모방한 것.

추출:
```js
await tar.x({
    file: target,
    cwd: destination,
    filter: (path, entry) => {
        const { type, size } = entry;
        return type !== 'SymbolicLink' && maxSize > size && checkExtName(entry);
    },
});
```

엔트리 서버가 받은 `.ent`를 풀 때 이 filter로 **심볼릭 링크 / 너무 큰 파일 / 허용 안 된 확장자**를
거른다. 우리가 생성하는 파일에 심볼릭 링크가 들어가면 안 된다.

## 자산 해시 규칙

| 항목 | 값 |
|------|----|
| 길이 | **32자** |
| 문자 집합 | **base36** = `[0-9a-z]` (hex 아님) |
| 샤딩 | `d1 = hash.slice(0,2)`, `d2 = hash.slice(2,4)` |
| 경로 | `temp/<d1>/<d2>/<kind>/<hash>.<ext>` (kind ∈ {image, thumb, sound}) |

### 공식 생성 알고리즘

공식 [`.ent` 문서](https://github.com/entrylabs/docs/blob/master/source/entryjs/file/2024-07-24-ent.md):
```js
const { uid } = require('uid');     // npm uid — 암호학 난수 기반 짧은 id
const Puid = require('puid');       // npm puid — 프로세스/시간 기반 id
const puid = new Puid();
const createFileId = () => uid(8) + puid.generate();  // 8 + 24 = 32자
```

공식 예시: `e49448cdlyy4s42e0013f820158i7nqj`.

### 우리 구현 (공식 알고리즘 채택)

```js
import { uid } from 'uid';
import Puid from 'puid';
const __puid = new Puid();
function entryStyleHash() {
    return uid(8) + __puid.generate();   // 공식과 동일
}
```

make-ent.mjs는 공식 `uid + puid` 조합을 사용해서 바이트 레벨 호환.
server.js `/api/export`는 아직 `crypto.randomBytes → base36` 사용 중 (외형 호환, 회귀 없음 확인됨).

구현:
- [`tools/make-ent.mjs`](../tools/make-ent.mjs) — `entryStyleHash()` 공식 알고리즘
- [`server.js:105-111`](../server.js#L105) — 근사치 (필요 시 교체)

### 이전 근사 알고리즘 (참고용)

```js
// crypto.randomBytes를 base36 문자표로 매핑 — 외형은 같지만 통계적 분포 다름
function entryStyleHash() {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    const bytes = crypto.randomBytes(32);
    let out = '';
    for (let i = 0; i < 32; i++) out += chars[bytes[i] % 36];
    return out;
}
```

엔트리 엔진 로드 기준 둘은 구분 불가 (실측). playentry.org 업로드 시에도 둘 다 통과.

## 이미지 규칙 (중요)

아래는 과거에 레퍼런스로 쓴 playentry.org 내보내기 작품과 **현재 생성기의 PNG 출력 정책**이다. 외부 작품 전체의 제약이 아니다. SVG와 PNG가 공존하는 실제 작품 및 Picture 해석의 정본은 [03의 이미지 형식 설명](03-objects-and-assets.md#외부-작품을-읽을-때는-svg도-보존한다)을 따른다.

- 현재 생성기가 번들한 이미지 payload는 PNG이며 SVG 원본은 별도 보존하지 않는다.
- 변환은 이 저장소의 `lib/asset-bundler.js`가 수행한다. 공식 서버의 모든 업로드 처리에 대한 단정이 아니다.
- `image/<hash>.png` = 원본 해상도 PNG.
- `thumb/<hash>.png` = 같은 hash의 **96px 한 변** 다운스케일 PNG.
- 이미지와 썸네일이 **같은 hash**, 다른 폴더.
- `picture.fileurl`은 `temp/…/image/<hash>.png`, `picture.imageType: "png"`.
- `picture.thumbUrl` 필드는 **없음** — Entry의 `updateThumbnailView`가 `fileurl`로 fallback.

구현: [`tools/make-ent.mjs:177-216`](../tools/make-ent.mjs#L177) (`bundleOne`).

## 검증 명령어

```bash
# 레이아웃 확인
node -e "const z=require('zlib'),f=require('fs');const{forEachTarEntry}=require('./server.js');
  const t=z.gunzipSync(f.readFileSync('tests/fixtures/move.ent'));
  forEachTarEntry(t,e=>console.log(e.type,e.name,'size='+e.data.length));"

# 헤더 바이너리 확인
xxd tests/fixtures/move.ent | head -40
```

mode 필드(offset 100)가 디렉터리는 `30 30 30 37 35 35 20 00` ("000755 \0"),
파일은 `30 30 30 36 34 34 20 00` ("000644 \0")인지 확인.

## 기존 작품의 일부만 수정하기

빌드 spec이 없는 외부 작품은 원본 tar를 기준으로 변경 대상을 제한할 수 있다.
이는 확인한 일반 ustar 파일에 적용한 편집 방법이며, 모든 확장 tar를 처리한다는 뜻은 아니다.

1. 원본을 보존하고 새 번호의 파일에 저장한다. gzip 해제 후 엔트리의 이름·순서·헤더·payload를 기록한다.
2. 바꿀 엔트리만 교체한다. 크기가 바뀌면 헤더의 size와 checksum을 갱신하고 512바이트 패딩을 다시 계산한다.
   바뀌지 않은 엔트리의 헤더와 payload는 그대로 복사한다. 알 수 없는 PAX/GNU 확장은 임의로 재해석하지 않고 거부한다.
3. 다시 연 파일에서 **허용한 JSON 필드와 에셋만 달라졌는지** 대조한다.
   tar 개수·블록 개수가 같다는 사실만으로 문구 교체 성공을 판정하지 않는다.
4. 변경 예정 항목 수와 실제 반영 수를 대조하고, 편집기 로드·렌더·실제 재생 순서로 확인한다.
   검증기 자체도 입력 0건 및 같은 파일 비교에서 변경 0건을 보고하는지 먼저 검사한다.

gzip 압축 결과 전체의 바이트 일치와 tar 엔트리의 보존은 다르다. 압축 파일 해시는 버전 식별에 쓰고,
의도하지 않은 변경은 압축을 푼 엔트리별로 검사한다. 블록 수정은
[스크립트 파싱·복제 규칙](04-script-and-blocks.md#기존-스크립트의-여러-항목을-수정할-때)을 따른다.
그림 교체 시에는 [원본·래스터·썸네일](03-objects-and-assets.md#외부-작품을-읽을-때는-svg도-보존한다)의
실제 참조와 치수를 조사한다. 모든 작품에 같은 이름의 PNG 동반 파일이 있다고 가정하지 않는다.

적용 근거: [음악 동기화 수정의 구조 검사](evidence/music-sync-20260915.json).
이 사례는 tar 1,831개 중 project.json 1개만 바뀌었고 나머지 1,830개 엔트리를 보존했다.
이 숫자는 해당 파일의 검사 결과이며 다른 작품의 고정 기준이 아니다.
