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

playentry.org 레퍼런스 `C:\Users\young\Downloads\260423_작품.ent` (저장소 외부, 사용자 로컬) 분석 결과:

- **tar에는 PNG만** — SVG 원본 파일은 저장되지 않음.
- SVG를 업로드해도 서버가 `sharp(svg).png()`로 래스터라이즈해 PNG만 남긴다.
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
