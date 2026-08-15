// Brick Kingdom — 스테이지 데이터 + 조립 도구.
//
// 런타임 로직과 완전히 분리된 순수 데이터다 (요구사항 H: "레벨 데이터와 런타임
// 오브젝트 분리"). 엔진은 이 문자 그리드를 읽어 동작만 한다 — 스테이지를 추가할 때
// 엔진 코드는 손대지 않는다.
//
// 스테이지는 **구간(section)의 열거**로 조립한다. 한 구간 = 폭 + 그리기 함수.
// 32 스테이지를 만들 때 같은 구간 어휘를 재사용하되 배치·간격·적 조합을 바꾼다.
//
// ── 타일 문자 (1 칸 = 32px) ────────────────────────────────────
//   .  공기
//   #  흙 지형 (파괴 불가)
//   =  석재 (파괴 불가, 지하/요새)
//   B  벽돌 (강화 상태에서만 파괴)
//   ?  보상 블록 (아래서 치면 아이템/동전, 1 회용 → 'u')
//   u  사용 완료 블록
//   c  동전 (먹으면 사라짐)
//   P  파이프 상단 / p 파이프 몸통
//   ^  가시 결정 (닿으면 피격)
//   F  목표 깃대
//
// ── 적 문자 (tiles 와 같은 좌표계의 별도 그리드) ────────────────
//   r  롤스톤   (벽에서 반전, 절벽에서 떨어짐)
//   g  코그워커 (절벽에서 반전 — 안 떨어짐)
//   s  스파이크샤드 (제자리, 파괴 불가)
//   f  글라이드핀 (공중 비행)

// 2026-07-31 Phase 2-1: TILE 32→24. 세로 9 행 → 12 행을 얻는 게 목적이다
// (원작 플레이필드 13 행에 근접). 실측 근거는 `기획/Phase2-4-계획.md` §4.
export const TILE = 24;
export const ROWS = 12;          // 12*24 = 288px, 화면 270 보다 커서 행 0 일부만 잘림
export const VIEW_COLS = 21;     // ceil(480 / 24) = 20 + 1 (부분 스크롤 칸)
export const GROUND = 10;        // 기본 바닥 표면 행 (행 10~11 = 바닥 2 줄, 원작과 같은 두께)

/** 빈 캔버스 — 지정 폭의 타일/적 그리드 한 쌍 */
function canvas(width) {
    const tiles = Array.from({ length: ROWS }, () => Array(width).fill('.'));
    const enemies = Array.from({ length: ROWS }, () => Array(width).fill('.'));
    const rewards = {};
    return {
        width, tiles, enemies, rewards,
        put(r, c, ch) { if (this.tiles[r] && c >= 0 && c < width) this.tiles[r][c] = ch; return this; },
        fill(r0, r1, c0, c1, ch) {
            for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.put(r, c, ch);
            return this;
        },
        enemy(r, c, ch) { if (this.enemies[r] && c >= 0 && c < width) this.enemies[r][c] = ch; return this; },
        reward(r, c, kind) { this.put(r, c, '?'); this.rewards[`${r},${c}`] = kind; return this; },
        /** 지면 채우기 — 표면 행부터 그리드 바닥까지 */
        ground(c0, c1, surface = GROUND, ch = '#') { return this.fill(surface, ROWS - 1, c0, c1, ch); },
        /** 구멍 파기 (추락사 지대) */
        pit(c0, c1) { return this.fill(GROUND, ROWS - 1, c0, c1, '.'); },
        /** 계단 — 높이 h 만큼 한 칸씩 올라감 */
        stairsUp(c0, h, surface = GROUND) {
            for (let i = 0; i < h; i++) this.fill(surface - 1 - i, ROWS - 1, c0 + i, c0 + i, '#');
            return this;
        },
        stairsDown(c0, h, surface = GROUND) {
            for (let i = 0; i < h; i++) this.fill(surface - h + i, ROWS - 1, c0 + i, c0 + i, '#');
            return this;
        },
    };
}

/**
 * 구간들을 이어붙여 하나의 스테이지 그리드로 만든다.
 * 각 구간은 `{ width, draw(c) }` — c 는 이 구간의 시작 열(전역 좌표).
 */
function assemble(sections) {
    const width = sections.reduce((a, s) => a + s.width, 0);
    const cv = canvas(width);
    let c = 0;
    for (const s of sections) { s.draw(cv, c); c += s.width; }
    return cv;
}

// ── 구간 어휘 ──────────────────────────────────────────────────
// 각 구간은 폭과 그리기 규칙만 안다. 좌표는 항상 구간 시작(c0) 기준 상대값.

/** 평지 — 옵션으로 동전 줄 */
const flat = (w, { coins = [], enemies = [] } = {}) => ({
    width: w,
    draw(cv, c0) {
        cv.ground(c0, c0 + w - 1);
        coins.forEach(([dc, up = 1]) => cv.put(GROUND - up, c0 + dc, 'c'));
        enemies.forEach(([dc, ch]) => cv.enemy(GROUND - 1, c0 + dc, ch));
    },
});

/** 구멍 — 폭 gap 의 추락 지대, 양쪽은 평지 */
const gapSection = (w, gap, { at = null, coins = [] } = {}) => ({
    width: w,
    draw(cv, c0) {
        cv.ground(c0, c0 + w - 1);
        const start = at === null ? Math.floor((w - gap) / 2) : at;
        cv.pit(c0 + start, c0 + start + gap - 1);
        coins.forEach(([dc, up]) => cv.put(GROUND - up, c0 + dc, 'c'));
    },
});

/** 벽돌 플랫폼 — 공중에 뜬 벽돌 줄, 가운데에 보상 블록 옵션 */
const brickRow = (w, { row = 4, from = 2, len = 5, reward = null, rewardAt = 2, coinAbove = [], enemies = [] } = {}) => ({
    width: w,
    draw(cv, c0) {
        cv.ground(c0, c0 + w - 1);
        cv.fill(GROUND - row, GROUND - row, c0 + from, c0 + from + len - 1, 'B');
        if (reward) cv.reward(GROUND - row, c0 + from + rewardAt, reward);
        coinAbove.forEach(dc => cv.put(GROUND - row - 3, c0 + dc, 'c'));
        enemies.forEach(([dc, ch]) => cv.enemy(GROUND - 1, c0 + dc, ch));
    },
});

/**
 * 계단 언덕 — 올라갔다 내려오는 지형.
 * 적은 `dc` 열의 **실제 표면 위**에 놓는다 (평지 기준으로 놓으면 언덕 위에서 공중에 뜬다).
 */
const hill = (w, h, { enemies = [] } = {}) => ({
    width: w,
    draw(cv, c0) {
        cv.ground(c0, c0 + w - 1);
        cv.stairsUp(c0 + 2, h);
        cv.fill(GROUND - h, ROWS - 1, c0 + 2 + h, c0 + w - 3 - h, '#');
        cv.stairsDown(c0 + w - 2 - h, h);
        // 표면 행을 찾아 그 바로 위에 배치
        enemies.forEach(([dc, ch]) => {
            const c = c0 + dc;
            let surf = ROWS - 1;
            for (let r = 0; r < ROWS; r++) if (cv.tiles[r][c] !== '.') { surf = r; break; }
            cv.enemy(surf - 1, c, ch);
        });
    },
});

/** 파이프 지형 — 높이 ht 의 파이프 (진입 가능 여부는 스테이지의 exits 로) */
const pipeSection = (w, { at = 4, ht = 2, enemies = [] } = {}) => ({
    width: w,
    draw(cv, c0) {
        cv.ground(c0, c0 + w - 1);
        const top = GROUND - ht;
        cv.put(top, c0 + at, 'P'); cv.put(top, c0 + at + 1, 'P');
        for (let r = top + 1; r < GROUND; r++) { cv.put(r, c0 + at, 'p'); cv.put(r, c0 + at + 1, 'p'); }
        enemies.forEach(([dc, ch]) => cv.enemy(GROUND - 1, c0 + dc, ch));
    },
});

/** 목표 구간 — 마지막 계단 + 깃대 */
const goalSection = (w) => ({
    width: w,
    draw(cv, c0) {
        cv.ground(c0, c0 + w - 1);
        for (let i = 0; i < 6; i++) cv.fill(GROUND - 1 - i, ROWS - 1, c0 + 3 + i, c0 + 3 + i, '#');
        cv.fill(GROUND - 6, ROWS - 1, c0 + 9, c0 + 11, '#');
        cv.put(GROUND - 7, c0 + w - 6, 'F');
    },
    goalAt: (c0, w2) => c0 + w2 - 6,
});

/**
 * 스테이지 1-1 "구리 평원" — 수직 슬라이스.
 *
 * 원작 1-1 의 타일 배치를 베끼지 않고, **가르치는 순서**만 같은 원리로 설계했다:
 *   1) 빈 평지에서 걷기/달리기 습득 → 2) 첫 적 1 마리(밟기) → 3) 보상 블록(아이템)
 *   → 4) 좁은 구멍(걷기 점프로 넘김) → 5) 벽돌 지대 + 적 2 → 6) 넓은 구멍(달리기 점프 필요)
 *   → 7) 파괴 불가 적(회피 학습) → 8) 언덕 + 복합 → 9) 목표.
 *
 * 폭 약 380 칸 = 12,160px. 보통 플레이(점프·회피로 유효속도 60%) ≈ 108 초 → 요구 90~150 초.
 */
function stage11() {
    const sections = [
        flat(20, { coins: [[12], [14], [16]] }),                                     // A 도입
        flat(16, { enemies: [[8, 'r']] }),                                            // B 첫 적
        brickRow(18, { row: 4, from: 4, len: 5, reward: 'grow', rewardAt: 2, coinAbove: [8] }),
        gapSection(16, 2, { at: 7 }),                                                 // C 좁은 구멍
        brickRow(20, { row: 4, from: 5, len: 6, reward: 'coin', rewardAt: 3, enemies: [[15, 'r']] }),
        hill(20, 3, { enemies: [[10, 'g']] }),                                        // D 언덕 + 코그워커
        flat(18, { enemies: [[6, 'r'], [12, 'r']] }),                                 // 적 2 동시
        brickRow(20, { row: 5, from: 6, len: 5, reward: 'beam', rewardAt: 2 }),
        gapSection(20, 4, { at: 8, coins: [[9, 4], [10, 4]] }),                       // E 넓은 구멍
        flat(16, { coins: [[4], [6], [8]], enemies: [[12, 'r']] }),
        pipeSection(18, { at: 6, ht: 2, enemies: [[13, 's']] }),                       // F 파이프 + 가시
        gapSection(16, 2, { at: 6 }),
        brickRow(20, { row: 4, from: 4, len: 7, reward: 'star', rewardAt: 3, enemies: [[16, 'g']] }),
        hill(22, 4, { enemies: [[12, 'g']] }),
        flat(20, { enemies: [[6, 'r'], [11, 'r'], [16, 'r']] }),                       // 밟기 연속 기회
        brickRow(18, { row: 3, from: 5, len: 4, reward: 'life', rewardAt: 1 }),
        gapSection(18, 3, { at: 7 }),
        flat(16, { coins: [[4, 1], [7, 1], [10, 1]] }),
        goalSection(24),                                                               // G 목표
    ];

    const cv = assemble(sections);
    // 목표 열 = 마지막 구간의 깃대 위치
    const beforeGoal = sections.slice(0, -1).reduce((a, s) => a + s.width, 0);
    const goalCol = beforeGoal + sections[sections.length - 1].width - 6;

    return {
        id: '1-1',
        name: '구리 평원',
        kind: 'overworld',
        timeLimit: 400,
        tiles: cv.tiles.map(r => r.join('')),
        enemies: cv.enemies.map(r => r.join('')),
        rewards: cv.rewards,
        spawnCol: 3,
        spawnRow: GROUND - 1,
        goalCol,
        bg: '#5c94fc',
    };
}

export const STAGES = [stage11()];
export const stageById = (id) => STAGES.find(s => s.id === id);
export { canvas, assemble, flat, gapSection, brickRow, hill, pipeSection, goalSection };
