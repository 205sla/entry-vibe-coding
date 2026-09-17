/* global Entry, document, KeyboardEvent, requestAnimationFrame */
// Observe the game's frame counter and drive only keyboard input. No variables,
// lists, engine functions or collision results are overwritten by this probe.
export async function exerciseShell(page, tile) {
    return page.evaluate(async TILE => {
        const V = name => Number(Entry.variableContainer.variables_.find(v => v.name_ === name).getValue());
        const list = name => Entry.variableContainer.lists_.find(v => v.name_ === name).array_.map(v => v.data);
        const held = new Set();
        const key = (code, down) => {
            if (held.has(code) === down) return;
            document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
            if (down) held.add(code); else held.delete(code);
        };
        const read = () => ({
            frame: V('frames'), state: V('state'), px: V('px'), grounded: V('grounded'),
            stomps: V('dbg_stomps'), kicks: V('dbg_kicks'), deaths: V('dbg_deaths'),
            score: V('score'), active: V('dbg_active_enemies'),
            kinds: list('en_kind'), states: list('en_state').map(Number),
            xs: list('en_x').map(Number), vxs: list('en_vx').map(Number),
        });
        const initial = read();
        const index = initial.kinds.map((kind, i) => ({ kind, i, dx: initial.xs[i] - initial.px }))
            .filter(e => e.kind === 'r' && e.dx > 0).sort((a, b) => a.dx - b.dx)[0]?.i;
        if (index === undefined) throw new Error('No rollstone ahead of the player');
        const result = { index, initial };
        let phase = 'approach', jumpFrame, lastFrame = -1;
        const deadline = performance.now() + 20_000;
        try {
            key('ArrowRight', true);
            while (performance.now() < deadline) {
                await new Promise(resolve => requestAnimationFrame(resolve));
                const s = read();
                result.last = s;
                if (s.state !== 2) throw new Error(`Shell scenario left PLAYING in ${phase}`);
                if (s.frame === lastFrame) continue;
                lastFrame = s.frame;
                if (phase === 'approach' && s.grounded && s.xs[index] - s.px <= TILE * 4) {
                    result.approach = s;
                    key('ArrowUp', true);
                    jumpFrame = s.frame;
                    phase = 'jump';
                } else if (phase === 'jump') {
                    if (s.frame - jumpFrame >= 9) key('ArrowUp', false);
                    if (s.stomps > initial.stomps) {
                        result.stomp = s;
                        key('ArrowUp', false);
                        key('ArrowRight', false);
                        phase = 'land';
                    }
                } else if (phase === 'land' && s.grounded) {
                    phase = 'kick';
                } else if (phase === 'kick') {
                    const right = s.px < s.xs[index];
                    key('ArrowRight', right);
                    key('ArrowLeft', !right);
                    if (s.kicks > initial.kicks) {
                        result.kick = s;
                        // Retreat in the direction opposite to the kicked shell.
                        key('ArrowRight', s.vxs[index] < 0);
                        key('ArrowLeft', s.vxs[index] > 0);
                        phase = 'travel';
                    }
                } else if (phase === 'travel' && Math.abs(s.xs[index] - result.kick.xs[index]) > TILE * 2.5) {
                    result.travel = s;
                    return result;
                }
            }
            throw new Error(`Shell scenario timed out in ${phase}`);
        } catch (error) {
            result.error = error.message;
            return result;
        } finally {
            for (const code of [...held]) key(code, false);
        }
    }, tile);
}
