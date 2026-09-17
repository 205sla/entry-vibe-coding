/* global createjs */
// Observe real native-block playback; do not replace it with direct Sound.play calls.
export async function installAudioProbe(page) {
    await page.evaluate(() => {
        const plugin = createjs.Sound.activePlugin;
        if (!plugin?.context || !plugin?.gainNode) throw new Error('WebAudio plugin is unavailable');
        const analyser = plugin.context.createAnalyser();
        analyser.fftSize = 2048;
        plugin.gainNode.connect(analyser);
        const original = Entry.Utils.playSound;
        const calls = [];
        Entry.Utils.playSound = function (id, options) {
            const instance = original.call(this, id, options);
            calls.push({ id, state: instance.playState, src: instance.src });
            return instance;
        };
        window.__entryAudioProbe = { analyser, calls, original };
    });
}

export async function readAudioState(page) {
    return page.evaluate(() => ({
        soundjs: createjs.SoundJS?.version,
        preloadjs: createjs.PreloadJS?.version,
        context: createjs.WebAudioPlugin?.context?.state,
        volume: Entry.Utils.getVolume(),
        sounds: Entry.container.objects_.flatMap(o => (o.sounds || []).map(s => ({
            id: s.id, name: s.name, path: s.path,
            registered: !!createjs.Sound._idHash[s.id],
            decoded: !!createjs.Sound.activePlugin._audioSources?.[s.path]?.getChannelData,
        }))),
        calls: window.__entryAudioProbe?.calls.slice() || [],
        phase: Entry.variableContainer.variables_.find(v => v.name_ === 'phase')?.getValue(),
    }));
}

export async function sampleAudio(page, milliseconds = 300) {
    return page.evaluate(async ms => {
        const analyser = window.__entryAudioProbe.analyser;
        let peak = 0, sum = 0, count = 0;
        const end = performance.now() + ms;
        do {
            const values = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(values);
            for (const v of values) { peak = Math.max(peak, Math.abs(v)); sum += v * v; count++; }
            await new Promise(resolve => setTimeout(resolve, 20));
        } while (performance.now() < end);
        return { peak, rms: Math.sqrt(sum / count) };
    }, milliseconds);
}

export async function exerciseAudioFixture(page) {
    await installAudioProbe(page);
    // A real page click supplies a user gesture before starting playback.
    await page.locator('#entryCanvas').click({ position: { x: 20, y: 20 }, force: true });
    await page.evaluate(async () => {
        const context = createjs.WebAudioPlugin.context;
        if (context.state === 'suspended') await context.resume();
        Entry.engine.toggleRun();
    });
    const result = { initial: await readAudioState(page), cases: [] };
    for (const [code, phase, expectedId] of [['Digit1', 'wav', 'wav1'], ['Digit2', 'mp3', 'mp31'], ['Digit3', 'mute', 'wav1']]) {
        await page.evaluate(code => document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })), code);
        await page.waitForTimeout(100);
        await page.evaluate(code => document.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })), code);
        await page.waitForFunction(phase => Entry.variableContainer.variables_.find(v => v.name_ === 'phase')?.getValue() === phase, phase, { timeout: 4000 });
        const signal = await sampleAudio(page);
        result.cases.push({ phase, expectedId, signal, runtime: await readAudioState(page) });
        await page.waitForFunction(() => Entry.variableContainer.variables_.find(v => v.name_ === 'phase')?.getValue() === 'idle', null, { timeout: 5000 });
    }
    await page.evaluate(async () => {
        await Entry.engine.toggleStop();
        Entry.Utils.playSound = window.__entryAudioProbe.original;
        createjs.Sound.activePlugin.gainNode.disconnect(window.__entryAudioProbe.analyser);
    });
    return result;
}

export function assertAudioFixture(result) {
    if (!result.initial.sounds.length || result.initial.sounds.some(s => !s.registered || !s.decoded)) throw new Error('Audio was not registered and decoded');
    if (result.cases.length !== 3) throw new Error('Audio test cases are incomplete');
    for (const c of result.cases) {
        const call = c.runtime.calls.at(-1);
        if (call?.id !== c.expectedId || call.state !== 'playSucceeded') throw new Error(`${c.phase}: native sound block did not play successfully`);
        if (c.phase === 'mute' ? c.signal.peak > 0.0001 : c.signal.rms < 0.01) throw new Error(`${c.phase}: unexpected output signal ${JSON.stringify(c.signal)}`);
    }
}
