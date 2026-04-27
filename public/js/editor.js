// MYentry-game editor glue.
// Initializes Entry in #workspace, wires up .ent open/save.

(function () {
    'use strict';

    // Tell entry.min.js where to load async chunks (e.g. 522.*.js) from.
    window.PUBLIC_PATH_FOR_ENTRYJS = 'lib/entry-js/dist/';

    const statusEl = document.getElementById('status');
    function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ''; }

    // SoundJS 1.x (installed from npm as 0.6.0 alias) crashes in _parsePath
    // when entryjs registers sounds whose src is undefined at startup.
    // playentry.org's actual 0.6.0 silently skipped these; the 1.x code path
    // throws because the `toString()` call is unguarded. Patch defensively.
    function patchCreateJSSoundParsePath() {
        if (typeof createjs === 'undefined' || !createjs.Sound) return;
        const proto = Object.getPrototypeOf(createjs.Sound);
        // _parsePath lives on Sound class methods; find and wrap it.
        ['_parsePath', 'parsePath'].forEach(fn => {
            const target = createjs.Sound[fn] || (proto && proto[fn]);
            if (typeof target !== 'function' || target.__patched) return;
            const wrapped = function (src) {
                if (src == null) return null;
                try { return target.apply(this, arguments); }
                catch (e) { console.warn('[editor] _parsePath skipped for', src, e.message); return null; }
            };
            wrapped.__patched = true;
            createjs.Sound[fn] = wrapped;
            if (proto && proto[fn]) proto[fn] = wrapped;
        });
    }

    function initEntry() {
        if (typeof Entry === 'undefined') {
            console.error('[editor] Entry global missing — check script load order.');
            setStatus('엔트리 로드 실패');
            return;
        }
        patchCreateJSSoundParsePath();
        const initOption = {
            libDir: '',
            entryDir: '',
            type: 'workspace',
            textCodingEnable: false,
            // Disable the hardware companion client — it tries to connect to
            // localhost:23518 and floods the console with WS errors. Our target
            // use case (authoring .ent game projects) doesn't need hardware.
            hardwareEnable: false
        };
        Entry.creationChangedEvent = new Entry.Event(window);
        Entry.init(document.getElementById('workspace'), initOption);
        // Entry.loadProject() with no args loads Entry's built-in starter —
        // a blank workspace with one default bot and scene id '7dwq'
        // (entryjs/src/class/project.js:82). When the user later opens a .ent,
        // loadEntFile() calls Entry.clearProject() first, which resets
        // Entry.scene.scenes_ entirely — so the incoming .ent can carry any
        // scene id (tested with 'zzzz', see tests/fixtures/scene-custom-id.ent).
        Entry.loadProject();
        setStatus('준비됨');

        // If the entry page was opened with ?open=1, immediately prompt the file picker.
        const qp = new URLSearchParams(location.search);
        if (qp.get('open') === '1') {
            setTimeout(() => document.getElementById('open-ent').click(), 100);
        }
    }

    // Load a .ent file into the current Entry session via /api/load.
    // `Entry.container.setObjects()` *appends* — it does not replace (see
    // entryjs/src/class/container.js:285). Without clearProject() the default
    // entrybot stays in the object list and the loaded project's sprite gets
    // mounted on top of existing DisplayObjects, which ends up showing the
    // entrybot's thumbnail alongside a blank/gray box for the new object.
    // MYentry/public/js/editor.js:345 uses the same clearProject() gate.
    async function loadEntFile(file) {
        if (!file) return;
        setStatus('불러오는 중…');
        try {
            const fd = new FormData();
            fd.append('ent', file, file.name || 'project.ent');
            const res = await fetch('/api/load', { method: 'POST', body: fd });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const project = await res.json();
            if (!project || !Array.isArray(project.objects)) {
                throw new Error('invalid project JSON');
            }
            if (typeof Entry.clearProject === 'function') Entry.clearProject();
            Entry.loadProject(project);
            setStatus('불러오기 완료 · ' + (file.name || ''));
        } catch (e) {
            console.error('[editor] load failed', e);
            setStatus('불러오기 실패: ' + e.message);
            alert('불러오기 실패: ' + e.message);
        }
    }

    // Export the current Entry project to a .ent file (via /api/export).
    window.exportEnt = async function exportEnt() {
        if (typeof Entry === 'undefined' || !Entry.exportProject) {
            alert('엔트리가 아직 준비되지 않았습니다.');
            return;
        }
        setStatus('저장 준비 중…');
        try {
            const project = Entry.exportProject({});
            const res = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(project)
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const blob = await res.blob();
            const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'myentry-game-' + ts + '.ent';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
            setStatus('저장 완료');
        } catch (e) {
            console.error('[editor] export failed', e);
            setStatus('저장 실패: ' + e.message);
            alert('저장 실패: ' + e.message);
        }
    };

    // Block/python mode toggle (kept from entryjs example for debugging).
    window.changeWorkspaceMode = function changeWorkspaceMode(mode) {
        const option = {};
        if (mode === 'block') {
            option.boardType = Entry.Workspace.MODE_BOARD;
            option.textType = -1;
        } else {
            option.boardType = Entry.Workspace.MODE_VIMBOARD;
            option.textType = Entry.Vim ? Entry.Vim.TEXT_TYPE_PY : 0;
            option.runType  = Entry.Vim ? Entry.Vim.WORKSPACE_MODE : 0;
        }
        const ws = Entry.getMainWS();
        if (ws) ws.setMode(option);
    };

    // Expose a promise for tests to wait on ("Entry ready").
    window.__myentryReady = new Promise((resolve) => {
        (function poll() {
            if (typeof Entry !== 'undefined' && Entry.container) return resolve();
            setTimeout(poll, 50);
        })();
    });

    function wire() {
        const open = document.getElementById('open-ent');
        if (open) {
            open.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) loadEntFile(file);
                e.target.value = '';
            });
        }
    }

    $(document).ready(function () {
        initEntry();
        wire();
    });
})();
