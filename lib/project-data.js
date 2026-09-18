const SCENE_PREFIX = 'entry_vibe_coding_v1_';

function isGeneratedScene(id) {
    return typeof id === 'string' && id.startsWith(SCENE_PREFIX) && id.length > SCENE_PREFIX.length;
}

function restoreBuildMetadata(project) {
    if (Array.isArray(project.scenes) && project.scenes.some(scene => isGeneratedScene(scene?.id))) {
        project._entryVibeCoding = {
            generator: 'entry-vibe-coding',
            method: 'vibe-coding',
            schemaVersion: 1,
        };
    }
    return project;
}

function finalizeGeneratedProject(project, registry) {
    const reserved = new Set(project.scenes.map(scene => scene.id).filter(isGeneratedScene));
    const sceneIds = new Map();
    for (const scene of project.scenes) {
        const original = scene.id;
        const base = isGeneratedScene(original) ? original : SCENE_PREFIX + original;
        let id = base;
        if (!isGeneratedScene(original)) {
            for (let suffix = 2; reserved.has(id); suffix++) id = base + '_' + suffix;
        }
        reserved.add(id);
        sceneIds.set(original, id);
        scene.id = id;
    }

    const remapValue = value => {
        if (sceneIds.has(value)) return sceneIds.get(value);
        if (value && typeof value === 'object') {
            if (Object.hasOwn(value, '__field')) value.__field = remapValue(value.__field);
            else if (['text', 'number'].includes(value.type) && value.params) value.params[0] = remapValue(value.params[0]);
        }
        return value;
    };
    const remapBlock = block => {
        if (!block || typeof block !== 'object') return;
        for (const [index, value] of (block.params || []).entries()) {
            if (registry[block.type]?.params?.[index]?.menu === 'scenes') {
                block.params[index] = remapValue(value);
            }
            remapBlock(block.params[index]);
        }
        for (const thread of block.statements || []) thread.forEach(remapBlock);
    };
    const remapScript = script => {
        const threads = JSON.parse(script);
        threads.forEach(thread => thread.forEach(remapBlock));
        return JSON.stringify(threads);
    };
    for (const object of project.objects) {
        object.scene = sceneIds.get(object.scene) || object.scene;
        object.script = remapScript(object.script);
    }
    for (const fn of project.functions) fn.content = remapScript(fn.content);
    return restoreBuildMetadata(project);
}

module.exports = { finalizeGeneratedProject, restoreBuildMetadata };
