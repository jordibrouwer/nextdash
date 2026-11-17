'use strict';
/**
 * A compose stack's files, read-only, in the stack side panel (layout B).
 *
 * Reached from the Files button on a stack's heading, or from the project chip
 * in a container's drawer. The panel is the Bookmarks layout (SidePanelLayout):
 * a head with Up / Down / Pull, tabs Compose file / .env / Backups, and in each
 * tab the file with its secrets masked. Reveal asks the server for one value at
 * a time, behind the write token. Edit opens a plain textarea on the raw file;
 * Save sends the sha it loaded, so a file changed on disk is refused (409).
 * Edit, Save and the run buttons need NEXTDASH_DOCKER_CONTROL and are never
 * offered for nextDash's own stack.
 *
 * Every state the server can answer has its own words and, where there is one,
 * the single line to add. The text is all t('key', 'English').
 */
(function (global) {
    const MASK = '••••••';

    class DockerComposeFiles {
        /** view: the DashboardDocker view (for t(), escape and notifications). */
        constructor(view) {
            this.view = view;
            this._project = null;
            this._data = null;
            this._panel = null;
            this._seq = 0;
        }

        t(key, fallback, params) {
            return this.view.t(`dashboard.${key}`, fallback, params);
        }

        esc(v) {
            return this.view.escape ? this.view.escape(v) : String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
        }

        _tabs() {
            return [
                { name: 'compose', label: this.t('dockerComposeTabFile', 'Compose file') },
                { name: 'env', label: this.t('dockerComposeTabEnv', '.env') },
                { name: 'backups', label: this.t('dockerComposeTabBackups', 'Backups') },
            ];
        }

        /**
         * Builds the panel's markup for one project. members: the container
         * summaries of the stack, for the count in the head.
         */
        layout(project, members, backName) {
            const L = global.SidePanelLayout;
            const esc = (v) => this.esc(v);
            L.moreLabel = this.t('dockerMoreActions', 'More actions');
            const count = members.length;
            const head = L.head(esc, {
                icon: '<span aria-hidden="true">▤</span>',
                title: project,
                badge: { text: this.t('dockerComposeCount', '{n} containers', { n: count }), tone: 'info' },
                more: [{ action: 'copy-name', label: this.t('dockerCopyName', 'Copy name') }],
                where: this.t('dockerComposeWhere', 'Compose project'),
                actions: [
                    { action: 'reload', label: this.t('dockerComposeReload', 'Reload') },
                    { action: 'up', label: this.t('dockerActionUp', 'Up'), title: this.t('dockerComposeUpHint', 'Start the stack, and recreate the services whose file changed') },
                    { action: 'down', label: this.t('dockerActionDown', 'Down'), title: this.t('dockerComposeDownHint', 'Stop and remove the stack\'s containers; volumes stay') },
                    { action: 'pull', label: this.t('dockerActionPull', 'Pull'), title: this.t('dockerComposePullHint', 'Pull newer images; running containers are not changed') },
                ],
            });
            const tabs = this._tabs();
            const back = backName
                ? `<button type="button" class="docker-compose-back" data-slp-action="back">← ${esc(backName)}</button>` : '';
            const body = (name) => `<div class="docker-compose-body" data-docker-compose-body="${esc(name)}"></div>`;
            const pane = (name) => L.pane(esc, 'dockerstack', tabs, name, body(name));
            const tabRow = L.tabs(esc, 'dockerstack', tabs);
            const runNote = '<p class="docker-compose-runnote" data-docker-compose-runnote hidden></p>';
            return `${back}${head}${runNote}${tabRow}${pane('compose')}${pane('env')}${pane('backups')}`;
        }

        /** Binds the panel and loads. host actions: back(), copyName(). */
        mount(panel, project, { onBack = null } = {}) {
            this._panel = panel;
            this._project = project;
            this._data = null;
            this._editing = null;
            this._backups = null;
            this._running = false;
            const mount = this._mount = (this._mount || 0) + 1;
            global.SidePanelLayout.bind(panel, {
                group: 'dockerstack',
                onAction: (action) => {
                    if (action === 'reload') void this._headReload();
                    else if (action === 'up' || action === 'down' || action === 'pull') void this._run(action);
                    else if (action === 'back') onBack?.();
                    else if (action === 'copy-name') {
                        void navigator.clipboard?.writeText?.(project);
                        this.view.dash?.showNotification?.(this.t('dockerNameCopied', 'Name copied'), 'success', { duration: 2000 });
                    }
                },
                onTab: (name) => { if (name === 'backups') void this._loadBackups(); },
            });
            panel.addEventListener('input', (e) => {
                if (this._mount === mount && e.target.matches?.('[data-docker-compose-editor]')) this._dirtyCheck();
            });
            panel.addEventListener('click', (e) => {
                if (this._mount !== mount) return;
                const edit = e.target.closest('[data-docker-compose-edit]');
                if (edit) { void this._edit(edit.getAttribute('data-docker-compose-edit')); return; }
                const ed = e.target.closest('[data-docker-compose-editor-action]');
                if (ed) { void this._editorAction(ed.getAttribute('data-docker-compose-editor-action')); return; }
                const rs = e.target.closest('[data-docker-compose-restore]');
                if (rs) { void this._restore(rs.dataset.file, rs.dataset.stamp); return; }
                const rev = e.target.closest('[data-docker-compose-reveal]');
                if (rev) { void this._reveal(rev); return; }
                const cp = e.target.closest('[data-docker-compose-copy]');
                if (cp) this._copy(cp);
            });
            void this.load();
        }

        _url(path) {
            const base = `/api/docker/compose/${encodeURIComponent(this._project)}${path}`;
            return typeof global.dockerHostURL === 'function' ? global.dockerHostURL(base) : base;
        }

        async load() {
            const project = this._project;
            const seq = ++this._seq;
            const bodies = this._bodies();
            // A remote host is answered here: the server refuses it too, but
            // there is nothing to ask.
            if (global.dockerActiveHost?.()) {
                this._data = { state: 'remote' };
                this._paint();
                this._syncRun();
                return;
            }
            bodies.forEach((b) => { b.textContent = this.t('dockerComposeLoading', 'Loading…'); });
            let data = null;
            let failed = false;
            try {
                const res = await global.nextDashFetch(this._url('/files'));
                if (res.ok) data = await res.json();
                else failed = res.status;
            } catch {
                failed = true;
            }
            if (this._seq !== seq || this._project !== project) return;
            this._data = data || { state: 'error', status: failed };
            this._editing = null;
            this._backups = null;
            this._paint();
            this._syncRun();
            if (this._panel?.querySelector('[data-slp-tab="backups"].is-active')) void this._loadBackups();
        }

        _bodies() {
            return [...(this._panel?.querySelectorAll('[data-docker-compose-body]') || [])];
        }

        _paint() {
            this._bodies().forEach((b) => {
                const role = b.getAttribute('data-docker-compose-body');
                if (role === 'backups') {
                    b.replaceChildren(this._renderBackups());
                    return;
                }
                b.replaceChildren(this._render(role));
            });
        }

        _html(html) {
            const t = document.createElement('template');
            t.innerHTML = html;
            return t.content;
        }

        _fix(text) {
            const esc = (v) => this.esc(v);
            return `<div class="docker-compose-fix"><code>${esc(text)}</code>
                <button type="button" class="config-btn config-btn--small" data-docker-compose-copy="${esc(text)}">${esc(this.t('dockerComposeCopy', 'Copy'))}</button></div>`;
        }

        _note(tone, title, parts) {
            const esc = (v) => this.esc(v);
            return `<div class="docker-compose-note" data-tone="${tone}"><h4>${esc(title)}</h4>${parts.join('')}</div>`;
        }

        _p(text) {
            return `<p>${this.esc(text)}</p>`;
        }

        _label(text) {
            return `<div class="docker-compose-fixlabel">${this.esc(text)}</div>`;
        }

        _render(role) {
            const d = this._data || {};
            const frag = document.createDocumentFragment();
            const add = (html) => frag.appendChild(this._html(html));

            if (d.state === 'remote') {
                add(this._note('info', this.t('dockerComposeRemote', 'Files on another host are not supported yet'),
                    [this._p(this.t('dockerComposeRemoteFix', 'Switch the Containers view to the local host to read its stacks\' files.'))]));
                return frag;
            }
            if (d.state === 'error') {
                add(this._note('bad', this.t('dockerComposeError', 'The files could not be loaded'),
                    [this._p(d.status === 404
                        ? this.t('dockerComposeGone', 'This stack is no longer in the container list. Close the panel and reload the view.')
                        : this.t('dockerComposeErrorFix', 'Check that Docker is reachable, then press Reload.'))]));
                return frag;
            }
            if (d.state === 'compose-no-labels') {
                add(this._note('info', this.t('dockerComposeNoLabels', 'No compose file for this stack'),
                    [this._p(this.t('dockerComposeNoLabelsFix', 'Docker did not record a compose file for these containers, so there is nothing to show.'))]));
                return frag;
            }
            if (d.self) {
                add(this._note('info', this.t('dockerComposeSelf', 'This is nextDash\'s own stack'),
                    [this._p(this.t('dockerComposeSelfFix', 'The file is readable here. Update it from your Docker host.'))]));
            }
            const files = (d.files || []).filter((f) => f.role === (role === 'env' ? 'env' : 'compose'));
            if (!files.length) {
                add(this._note('info',
                    role === 'env' ? this.t('dockerComposeNoEnv', 'No .env file for this stack') : this.t('dockerComposeNoFile', 'No compose file found'),
                    [this._p(role === 'env'
                        ? this.t('dockerComposeNoEnvFix', 'Neither the stack folder nor the compose file names one.')
                        : this.t('dockerComposeNoFileFix', 'Docker lists no compose file for this stack.'))]));
                return frag;
            }
            const shown = new Set();
            files.forEach((f) => {
                if (f.state !== 'ok') {
                    // The same fix for every file of the stack: said once.
                    if ((f.state === 'compose-unmapped' || f.state === 'compose-outside') && shown.has(f.state)) return;
                    shown.add(f.state);
                    add(this._problem(f, d));
                    return;
                }
                add(this._file(f));
            });
            return frag;
        }

        _mountLine(d) {
            const m = (d.map || [])[0];
            if (m) return `- ${m.host}:${m.container}:ro`;
            return d.suggest?.mount ? `- ${d.suggest.mount}` : '';
        }

        _problem(f, d) {
            const path = f.hostPath || '';
            const pathP = `<p>${this.esc(this.t('dockerComposePath', 'Path'))}: <b>${this.esc(path)}</b></p>`;
            const reload = `<div><button type="button" class="config-btn config-btn--small" data-slp-action="reload">${this.esc(this.t('dockerComposeReload', 'Reload'))}</button></div>`;
            switch (f.state) {
            case 'compose-unmapped': {
                const parts = [
                    `<p>${this.esc(this.t('dockerComposeUnmappedWhy', 'Docker says the file is'))} <b>${this.esc(path)}</b>. ${this.esc(this.t('dockerComposeUnmappedWhy2', 'nextDash runs in its own container and has no folder that leads there.'))}</p>`,
                ];
                if (d.suggest) {
                    parts.push(this._label(this.t('dockerComposeStep1', '1. Add to nextDash\'s environment')), this._fix(d.suggest.env));
                    parts.push(this._label(this.t('dockerComposeStep2', '2. Add a read-only mount')), this._fix(`- ${d.suggest.mount}`));
                }
                parts.push(this._p(this.t('dockerComposeRestart', 'Restart nextDash, then press Reload.')), reload);
                return this._note('warn', this.t('dockerComposeUnmapped', 'nextDash cannot see this stack\'s files yet'), parts);
            }
            case 'compose-outside': {
                const prefixes = (d.map || []).map((m) => m.host).join(', ') || this.t('dockerComposeNoPrefixes', '(none set)');
                const parts = [
                    `<p>${this.esc(this.t('dockerComposeOutsideWhy', 'The file is'))} <b>${this.esc(path)}</b>. ${this.esc(this.t('dockerComposeOutsideList', 'nextDash only reads files under:'))} <b>${this.esc(prefixes)}</b>.</p>`,
                    this._p(this.t('dockerComposeOutsideFix', 'Move the stack under one of those folders, or add its folder to the map and mount it too:')),
                ];
                if (d.suggest) {
                    const joined = (d.map || []).length
                        ? `NEXTDASH_COMPOSE_MAP=${d.map.map((m) => `${m.host}:${m.container}`).join(',')},${d.suggest.env.replace('NEXTDASH_COMPOSE_MAP=', '')}`
                        : d.suggest.env;
                    parts.push(this._fix(joined), this._fix(`- ${d.suggest.mount}`));
                }
                return this._note('bad', this.t('dockerComposeOutside', 'This path is outside the mapped folders'), parts);
            }
            case 'compose-missing': {
                const mount = this._mountLine(d);
                const parts = [pathP, this._p(this.t('dockerComposeMissingFix', 'The folder is mapped, but nothing is at that path. Check that the file still exists on the host and that the read-only mount points at the folder that holds it:'))];
                if (mount) parts.push(this._fix(mount));
                parts.push(reload);
                return this._note('bad', this.t('dockerComposeMissing', 'The file is not there'), parts);
            }
            case 'compose-denied':
                return this._note('bad', this.t('dockerComposeDenied', 'nextDash cannot read the file'), [
                    pathP,
                    this._p(this.t('dockerComposeDeniedFix', 'Permission denied. Make the file readable for the user nextDash runs as, or run nextDash as root:')),
                    this._fix('NEXTDASH_RUN_AS_ROOT=true'), reload]);
            case 'compose-not-file':
                return this._note('bad', this.t('dockerComposeNotFile', 'That path is not a file'), [
                    pathP, this._p(this.t('dockerComposeNotFileFix', 'Point the stack at its compose file, not a folder or link to elsewhere.')), reload]);
            case 'compose-not-yaml':
                return this._note('bad', this.t('dockerComposeNotYAML', 'That is not a compose file'), [
                    pathP, this._p(this.t('dockerComposeNotYAMLFix', 'Compose files end in .yml or .yaml.')), reload]);
            case 'compose-too-large':
                return this._note('bad', this.t('dockerComposeTooLarge', 'The file is too large to show'), [
                    pathP, this._p(this.t('dockerComposeTooLargeFix', 'nextDash shows files up to 1 MiB. Open it on the host.')), reload]);
            default:
                return this._note('bad', this.t('dockerComposeUnreadable', 'The file could not be read'), [pathP, reload]);
            }
        }

        /** status.control, the switch the rest of the view follows; the files answer when status is not loaded. */
        _control() {
            const st = this.view.status;
            return st && typeof st.control === 'boolean' ? st.control : (this._data || {}).control === true;
        }

        /** Whether this stack may be changed from here: control on, not nextDash's own. */
        _canChange() {
            const d = this._data || {};
            return d.state === 'ok' && this._control() && !d.self && !global.dockerActiveHost?.();
        }

        /** The words for why a file or the stack cannot be changed; '' when it can. */
        _whyNot(f) {
            const d = this._data || {};
            if (d.self) return this.t('dockerComposeSelfFix', 'The file is readable here. Update it from your Docker host.');
            if (!this._control()) return this.t('dockerComposeControlOff', 'Read-only: set NEXTDASH_DOCKER_CONTROL=1 to edit files and run Up, Down and Pull.');
            if (f && f.writable !== true) return this.t('dockerComposeNotWritable', 'nextDash cannot write this file: the folder is mounted read-only (drop :ro from the mount), or the user nextDash runs as has no write permission (set NEXTDASH_RUN_AS_ROOT=true, or change the file\'s owner).');
            return '';
        }

        _file(f) {
            const esc = (v) => this.esc(v);
            const masked = new Map((f.masked || []).map((m) => [m.line, m.key]));
            const lines = String(f.content ?? '').replace(/\n$/, '').split('\n');
            const kb = f.size >= 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`;
            const sha = String(f.sha256 || '').slice(0, 8);
            const rows = lines.map((line, i) => {
                const n = i + 1;
                const key = masked.get(n);
                let text = esc(line);
                let btn = '';
                if (key !== undefined) {
                    text = text.replace(esc(MASK), `<span class="docker-compose-mask" data-docker-compose-mask>${esc(MASK)}</span>`);
                    btn = `<button type="button" class="config-btn config-btn--small docker-compose-reveal" data-docker-compose-reveal
                        data-file="${esc(f.id)}" data-key="${esc(key)}">${esc(this.t('dockerComposeReveal', 'Reveal'))}</button>`;
                }
                return `<div class="docker-compose-line${key !== undefined ? ' has-mask' : ''}"><span class="docker-compose-n">${n}</span><span class="docker-compose-t">${text}</span>${btn}</div>`;
            }).join('');
            const err = f.yamlError
                ? `<p class="docker-compose-yamlerr" data-tone="warn">${esc(this.t('dockerComposeYAMLLine', 'This file does not parse: line {n}', { n: f.yamlError.line }))}</p>` : '';
            const n = (f.masked || []).length;
            const why = this._whyNot(f);
            const edit = !why
                ? `<button type="button" class="config-btn config-btn--small" data-docker-compose-edit="${esc(f.id)}">${esc(this.t('dockerComposeEdit', 'Edit'))}</button>` : '';
            const whyP = why && !(this._data || {}).self ? `<p class="docker-compose-legend" data-docker-compose-why>${esc(why)}</p>` : '';
            const legend = n
                ? `<p class="docker-compose-legend">${esc(this.t('dockerComposeMasked', '{n} values masked. Reveal fetches one value and needs the write token when one is set.', { n }))}</p>`
                : '';
            return `<div class="docker-compose-file" data-docker-compose-file="${esc(f.id)}">
                <div class="docker-compose-filebar"><span class="docker-compose-path" title="${esc(f.hostPath)}">${esc(f.hostPath)}</span>
                <span class="docker-compose-meta">${esc(kb)}${sha ? ` · ${esc(sha)}` : ''}</span>${edit}</div>
                ${whyP}${err}<div class="docker-logs docker-compose-code" role="region" aria-label="${esc(f.hostPath)}">${rows}</div>${legend}</div>`;
        }

        async _headReload() {
            if (this._editing?.dirty
                && !(await this._confirm(this.t('dockerComposeDiscardTitle', 'Discard your changes?'),
                    this.t('dockerComposeDiscardBody', 'Reload replaces what you typed with the file on disk.'),
                    this.t('dockerComposeReload', 'Reload'), true))) return;
            await this.load();
        }

        /* ── Up, Down, Pull ───────────────────────────────────────────── */

        /** Why the run buttons are off, or '' when they are on. */
        _runBlock() {
            const d = this._data || {};
            if (d.state === 'remote') return this.t('dockerComposeLocalOnly', 'Compose runs only on the local Docker host for now.');
            if (!d.state || d.state === 'error') return '';
            if (d.self) return this.t('dockerComposeSelfRun', 'This is nextDash\'s own stack: run Up, Down and Pull from your Docker host.');
            if (!this._control()) return this.t('dockerComposeControlOff', 'Read-only: set NEXTDASH_DOCKER_CONTROL=1 to edit files and run Up, Down and Pull.');
            if (d.state === 'compose-no-labels') return this.t('dockerComposeNoLabelsRun', 'Docker recorded no compose file for this stack, so compose cannot run it.');
            return '';
        }

        _syncRun() {
            const panel = this._panel;
            if (!panel) return;
            const d = this._data || {};
            const why = this._runBlock();
            const off = Boolean(why) || !d.state || d.state === 'error' || this._running;
            panel.querySelectorAll('[data-slp-action="up"],[data-slp-action="down"],[data-slp-action="pull"]').forEach((b) => {
                if (b.dataset.hint === undefined) b.dataset.hint = b.title || '';
                b.disabled = off;
                b.title = why || b.dataset.hint;
            });
            const note = panel.querySelector('[data-docker-compose-runnote]');
            if (note) {
                note.hidden = !why;
                note.textContent = why;
            }
        }

        async _confirm(title, message, confirmText, danger) {
            const modal = global.AppModal;
            if (typeof modal?.confirm !== 'function') return global.confirm(message);
            return Boolean(await modal.confirm({
                title, message, confirmText,
                cancelText: this.t('dockerCancel', 'Cancel'),
                ...(danger ? { confirmClass: 'danger' } : {}),
            }));
        }

        async _run(action) {
            const actions = this.view.actions;
            const project = this._project;
            if (this._running || !actions || this._runBlock() || this._data?.state !== 'ok') return;
            if (this._editing?.dirty) {
                this._notify(this.t('dockerComposeUnsavedRun', 'Save or discard your edit first.'), 'error');
                return;
            }
            if (action === 'down') {
                const ok = await this._confirm(
                    this.t('dockerComposeDownTitle', 'Take {project} down', { project }),
                    this.t('dockerComposeDownBody', 'This stops and removes the containers and networks of {project}. Volumes and images stay, and Up brings the stack back.', { project }),
                    this.t('dockerActionDown', 'Down'), true);
                if (!ok) return;
            }
            this._running = true;
            this._syncRun();
            const label = actions.label(action);
            const overlay = global.ProgressOverlay;
            overlay?.show?.(`${label} ${project}`, '');
            const progress = global.DockerUpdateRun ? new global.DockerUpdateRun(actions, action, [{ name: project }]) : null;
            progress?.begin(project);
            let res = null;
            let body = null;
            try {
                ({ res, body } = await actions.streamAction(`${this._url(`/${action}`)}${this._url(`/${action}`).includes('?') ? '&' : '?'}stream=1`, (ev) => progress?.event(project, ev)));
            } catch {
                res = null;
            }
            this._running = false;
            global.DockerSearchIndex?.invalidate?.();
            if (!res || !res.ok) {
                const text = await actions.explain(res, body, { quiet: true });
                const tail = Array.isArray(body?.tail) ? body.tail : [];
                const row = progress?.rows?.get(project);
                if (row && tail.length) progress.appendLog(row, tail.join('\n'));
                progress?.end(project, { ok: false, text });
                overlay?.settle?.(text, this.t('dockerRunClose', 'Close'));
                actions.track?.(`compose-${action}`, false, 'stack');
            } else {
                progress?.end(project, { ok: true });
                overlay?.finish?.(this.t('dockerComposeRunDone', '{label} finished for {project}.', { label, project }));
                actions.track?.(`compose-${action}`, true, 'stack');
                await this.view.refreshContainers?.();
            }
            this._syncRun();
        }

        _notify(text, tone) {
            this.view.dash?.showNotification?.(text, tone || 'info');
        }

        /* ── Editor ───────────────────────────────────────────────────── */

        _fileById(id) {
            return ((this._data || {}).files || []).find((f) => f.id === id) || null;
        }

        _fileEl(id) {
            return this._panel?.querySelector(`[data-docker-compose-file="${CSS.escape(id)}"]`) || null;
        }

        async _fetchRaw(id) {
            try {
                const res = await global.nextDashFetch(this._url(`/files/raw?file=${encodeURIComponent(id)}`));
                if (!res.ok) return null;
                const data = await res.json();
                return typeof data?.content === 'string' ? data : null;
            } catch {
                return null;
            }
        }

        async _edit(id) {
            const f = this._fileById(id);
            const el = this._fileEl(id);
            if (!f || !el || this._editing) return;
            const project = this._project;
            const raw = await this._fetchRaw(id);
            if (this._project !== project || !el.isConnected) return;
            if (!raw) {
                this._notify(this.t('dockerComposeRawFailed', 'The file could not be opened for editing. Opening it needs the write token when one is set.'), 'error');
                return;
            }
            this._editing = { id, sha: raw.sha256, original: raw.content, dirty: false, invalidAt: null };
            el.replaceWith(this._html(this._editorHTML(f, raw)));
            const ta = this._editor();
            ta?.focus();
        }

        _editor() {
            return this._panel?.querySelector('[data-docker-compose-editor]') || null;
        }

        _editorHTML(f, raw) {
            const esc = (v) => this.esc(v);
            const btn = (a, label, extra = '') => `<button type="button" class="config-btn config-btn--small${extra}" data-docker-compose-editor-action="${a}">${esc(label)}</button>`;
            return `<div class="docker-compose-file docker-compose-editing" data-docker-compose-file="${esc(f.id)}">
                <div class="docker-compose-filebar"><span class="docker-compose-path" title="${esc(f.hostPath)}">${esc(f.hostPath)}</span>
                <span class="docker-compose-dirty" data-docker-compose-dirty hidden>● ${esc(this.t('dockerComposeUnsaved', 'Unsaved changes'))}</span></div>
                <textarea class="docker-compose-editor" data-docker-compose-editor spellcheck="false" autocomplete="off" autocapitalize="off"
                    aria-label="${esc(f.hostPath)}">${esc(raw.content)}</textarea>
                <p class="docker-compose-yamlerr" data-docker-compose-error role="alert" hidden></p>
                <div class="docker-compose-conflict" data-docker-compose-conflict hidden>
                    <p>${esc(this.t('dockerComposeConflict', 'The file changed on disk since you opened it. Reload to take the new version, or keep editing: saving then replaces it, and the current file is backed up first.'))}</p>
                    ${btn('conflict-reload', this.t('dockerComposeReload', 'Reload'))}${btn('conflict-keep', this.t('dockerComposeKeep', 'Keep editing'))}
                </div>
                <div class="docker-compose-readonly" data-docker-compose-readonly hidden></div>
                <ul class="docker-compose-warnings" data-docker-compose-warnings hidden></ul>
                <div class="docker-compose-editbar">
                    ${btn('save', this.t('dockerComposeSave', 'Save'), ' config-btn--primary').replace('<button', '<button disabled data-docker-compose-save')}
                    ${btn('reload', this.t('dockerComposeReload', 'Reload'))}${btn('close', this.t('dockerComposeCloseEdit', 'Close'))}
                    <span class="docker-compose-status" data-docker-compose-status role="status"></span>
                </div></div>`;
        }

        _$(sel) {
            return this._panel?.querySelector(sel) || null;
        }

        _dirtyCheck() {
            const ed = this._editing;
            const ta = this._editor();
            if (!ed || !ta) return;
            ed.dirty = ta.value !== ed.original;
            const mark = this._$('[data-docker-compose-dirty]');
            if (mark) mark.hidden = !ed.dirty;
            // After a refused parse the same text is not sent again.
            if (ed.invalidAt !== null && ta.value !== ed.invalidAt) {
                ed.invalidAt = null;
                const err = this._$('[data-docker-compose-error]');
                if (err) err.hidden = true;
            }
            const save = this._$('[data-docker-compose-save]');
            if (save) save.disabled = !ed.dirty || ed.invalidAt !== null || ed.saving === true || ed.readOnly === true;
            const status = this._$('[data-docker-compose-status]');
            if (status && ed.dirty) status.textContent = '';
        }

        async _editorAction(action) {
            const ed = this._editing;
            if (!ed) return;
            if (action === 'save') await this._save();
            else if (action === 'reload' || action === 'conflict-reload') {
                if (action === 'reload' && ed.dirty
                    && !(await this._confirm(this.t('dockerComposeDiscardTitle', 'Discard your changes?'),
                        this.t('dockerComposeDiscardBody', 'Reload replaces what you typed with the file on disk.'),
                        this.t('dockerComposeReload', 'Reload'), true))) return;
                await this._reloadRaw();
            } else if (action === 'conflict-keep') {
                const box = this._$('[data-docker-compose-conflict]');
                if (box) box.hidden = true;
                if (ed.diskSha) ed.sha = ed.diskSha;
            } else if (action === 'close') {
                if (ed.dirty
                    && !(await this._confirm(this.t('dockerComposeDiscardTitle', 'Discard your changes?'),
                        this.t('dockerComposeCloseBody', 'Closing the editor throws away what you typed.'),
                        this.t('dockerComposeCloseEdit', 'Close'), true))) return;
                this._editing = null;
                await this.load();
            }
        }

        async _reloadRaw() {
            const ed = this._editing;
            const raw = await this._fetchRaw(ed.id);
            const ta = this._editor();
            if (!raw || !ta) {
                this._notify(this.t('dockerComposeRawFailed', 'The file could not be opened for editing. Opening it needs the write token when one is set.'), 'error');
                return;
            }
            Object.assign(ed, { sha: raw.sha256, original: raw.content, dirty: false, invalidAt: null, diskSha: null, readOnly: false });
            ta.value = raw.content;
            ['[data-docker-compose-error]', '[data-docker-compose-conflict]', '[data-docker-compose-readonly]', '[data-docker-compose-warnings]']
                .forEach((s) => { const n = this._$(s); if (n) n.hidden = true; });
            const status = this._$('[data-docker-compose-status]');
            if (status) status.textContent = '';
            this._dirtyCheck();
        }

        /** Character offset of a 1-based line and column. */
        _offsetOf(text, line, column) {
            const lines = text.split('\n');
            const at = Math.min(Math.max(line, 1), lines.length) - 1;
            let off = 0;
            for (let i = 0; i < at; i += 1) off += lines[i].length + 1;
            return off + Math.min(Math.max((column || 1) - 1, 0), lines[at].length);
        }

        async _save() {
            const ed = this._editing;
            const ta = this._editor();
            if (!ed || !ta || ed.saving || !ed.dirty) return;
            const content = ta.value;
            ed.saving = true;
            this._dirtyCheck();
            const status = this._$('[data-docker-compose-status]');
            if (status) status.textContent = this.t('dockerComposeSaving', 'Saving…');
            let res = null;
            let body = null;
            try {
                res = await global.nextDashFetch(this._url(`/files?file=${encodeURIComponent(ed.id)}`), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content, sha256: ed.sha }),
                });
                body = await res.json().catch(() => null);
            } catch {
                res = null;
            }
            ed.saving = false;
            if (!this._editor()) return;
            if (status) status.textContent = '';
            const show = (sel, text) => { const n = this._$(sel); if (n) { n.textContent = text; n.hidden = !text; } return n; };
            if (res && res.ok) {
                ed.sha = body?.sha256 || ed.sha;
                ed.original = content;
                const f = this._fileById(ed.id);
                if (f) { f.sha256 = ed.sha; f.content = content; }
                this._backups = null;
                const warns = this._$('[data-docker-compose-warnings]');
                if (warns) {
                    warns.replaceChildren(...(body?.warnings || []).map((w) => {
                        const li = document.createElement('li');
                        li.textContent = w.line ? this.t('dockerComposeWarnLine', 'Line {n}: {message}', { n: w.line, message: w.message }) : w.message;
                        return li;
                    }));
                    warns.hidden = !(body?.warnings || []).length;
                }
                this._dirtyCheck();
                if (status) status.textContent = body?.backup
                    ? this.t('dockerComposeSavedBackup', 'Saved. The old file is in Backups.') : this.t('dockerComposeSaved', 'Saved.');
                if (this._$('[data-slp-tab="backups"].is-active')) void this._loadBackups();
                return;
            }
            const reason = body?.reason;
            if (reason === 'compose-yaml' || reason === 'compose-invalid') {
                const y = body.yamlError || body;
                ed.invalidAt = content;
                const where = y.line
                    ? this.t('dockerComposeYAMLAt', 'Line {line}, column {column}: {message}', { line: y.line, column: y.column || 1, message: y.message || '' })
                    : (y.message || this.t('dockerComposeInvalidFile', 'Compose rejected this file.'));
                show('[data-docker-compose-error]', where);
                if (y.line) {
                    const off = this._offsetOf(content, y.line, y.column);
                    ta.focus();
                    ta.setSelectionRange(off, off);
                    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
                    ta.scrollTop = Math.max(0, (y.line - 3) * lh);
                }
            } else if (reason === 'compose-stale') {
                ed.diskSha = body?.sha256 || null;
                const box = this._$('[data-docker-compose-conflict]');
                if (box) box.hidden = false;
            } else if (reason === 'compose-read-only' || reason === 'compose-denied') {
                ed.readOnly = true;
                const note = show('[data-docker-compose-readonly]', reason === 'compose-read-only'
                    ? this.t('dockerComposeMountRO', 'The mount is read-only, so nothing can be saved. Remove :ro from the compose folder\'s mount, then restart nextDash.')
                    : this.t('dockerComposeDenied403', 'Permission denied: the user nextDash runs as cannot write this file. Set NEXTDASH_RUN_AS_ROOT=true, or change the file\'s owner.'));
                if (note) note.className = 'docker-compose-note docker-compose-readonly';
            } else {
                const text = await this.view.actions?.explain?.(res, body, { quiet: true })
                    || this.t('dockerComposeSaveFailed', 'The file could not be saved.');
                show('[data-docker-compose-error]', text);
            }
            this._dirtyCheck();
        }

        /* ── Backups ──────────────────────────────────────────────────── */

        async _loadBackups() {
            const d = this._data;
            if (!d || d.state !== 'ok') return;
            const project = this._project;
            const files = (d.files || []).filter((f) => f.state === 'ok');
            const out = {};
            await Promise.all(files.map(async (f) => {
                try {
                    const res = await global.nextDashFetch(this._url(`/backups?file=${encodeURIComponent(f.id)}`));
                    out[f.id] = res.ok ? ((await res.json())?.backups || []) : { error: res.status };
                } catch {
                    out[f.id] = { error: true };
                }
            }));
            if (this._project !== project) return;
            this._backups = out;
            // Only the Backups tab: repainting the others would wipe an open editor.
            this._bodies().filter((b) => b.getAttribute('data-docker-compose-body') === 'backups')
                .forEach((b) => b.replaceChildren(this._renderBackups()));
        }

        _stampDate(stamp) {
            const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp || '');
            if (!m) return stamp || '';
            const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
            return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
        }

        _renderBackups() {
            const frag = document.createDocumentFragment();
            const add = (html) => frag.appendChild(this._html(html));
            const d = this._data || {};
            if (d.state === 'remote' || d.state === 'error' || !d.state) {
                add(this._note('info', this.t('dockerComposeBackupsNone', 'No backups to show'), [this._p(this.t('dockerComposeBackupsNoneFix', 'Backups are listed once the stack\'s files can be read.'))]));
                return frag;
            }
            const files = (d.files || []).filter((f) => f.state === 'ok');
            if (!files.length) {
                add(this._note('info', this.t('dockerComposeBackupsNone', 'No backups to show'), [this._p(this.t('dockerComposeBackupsNoFiles', 'There is no readable file in this stack.'))]));
                return frag;
            }
            if (!this._backups) {
                add(this._p(this.t('dockerComposeLoading', 'Loading…')));
                return frag;
            }
            const esc = (v) => this.esc(v);
            const why = this._whyNot(null) || '';
            add(`<p class="docker-compose-legend">${esc(this.t('dockerComposeBackupsLegend', 'nextDash copies a file here before every save, and keeps the last 20. They stay out of the settings backup, since they can hold secrets.'))}</p>`);
            files.forEach((f) => {
                const list = this._backups[f.id];
                const fileWhy = why || (f.writable === true ? '' : this._whyNot(f));
                let rows;
                if (!Array.isArray(list)) {
                    rows = `<p class="docker-compose-legend">${esc(this.t('dockerComposeBackupsFailed', 'The backups could not be listed. Listing them needs the write token when one is set.'))}</p>`;
                } else if (!list.length) {
                    rows = `<p class="docker-compose-legend" data-docker-compose-nobackups>${esc(this.t('dockerComposeBackupsEmpty', 'No backups yet. The first save makes one.'))}</p>`;
                } else {
                    rows = `<ul class="docker-compose-backups">${list.map((b) => `<li data-docker-compose-backup="${esc(b.stamp)}">
                        <span>${esc(this._stampDate(b.stamp))}</span><span class="docker-compose-meta">${esc(b.size >= 1024 ? `${(b.size / 1024).toFixed(1)} KB` : `${b.size} B`)}</span>
                        <button type="button" class="config-btn config-btn--small" data-docker-compose-restore data-file="${esc(f.id)}" data-stamp="${esc(b.stamp)}"
                            ${fileWhy ? `disabled title="${esc(fileWhy)}"` : ''}>${esc(this.t('dockerComposeRestore', 'Restore'))}</button></li>`).join('')}</ul>`;
                }
                add(`<div class="docker-compose-file"><div class="docker-compose-filebar"><span class="docker-compose-path" title="${esc(f.hostPath)}">${esc(f.hostPath)}</span></div>${rows}</div>`);
            });
            return frag;
        }

        async _restore(id, stamp) {
            const f = this._fileById(id);
            if (!f || this._running) return;
            const when = this._stampDate(stamp);
            const ok = await this._confirm(
                this.t('dockerComposeRestoreTitle', 'Restore this copy?'),
                this.t('dockerComposeRestoreBody', 'The file goes back to the copy from {when}. The current file is backed up first.', { when }),
                this.t('dockerComposeRestore', 'Restore'), false);
            if (!ok) return;
            let res = null;
            let body = null;
            try {
                res = await global.nextDashFetch(this._url(`/backups/${encodeURIComponent(stamp)}/restore?file=${encodeURIComponent(id)}`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sha256: f.sha256 }),
                });
                body = await res.json().catch(() => null);
            } catch {
                res = null;
            }
            if (res && res.ok) {
                this._notify(this.t('dockerComposeRestored', 'Restored the copy from {when}.', { when }), 'success');
                this._backups = null;
                await this.load();
                if (this._$('[data-slp-tab="backups"].is-active')) void this._loadBackups();
                return;
            }
            const text = body?.reason === 'compose-stale'
                ? this.t('dockerComposeStale', 'The file changed on disk since it was opened.') + ' ' + this.t('dockerComposeReloadFirst', 'Press Reload, then restore again.')
                : (await this.view.actions?.explain?.(res, body, { quiet: true })) || this.t('dockerComposeRestoreFailed', 'The copy could not be restored.');
            this._notify(text, 'error');
        }

        async _reveal(btn) {
            const line = btn.closest('.docker-compose-line');
            const maskEl = line?.querySelector('[data-docker-compose-mask]');
            if (!maskEl) return;
            // Shown again as masked on a second press.
            if (btn.dataset.shown === '1') {
                maskEl.textContent = MASK;
                maskEl.classList.remove('is-revealed');
                btn.dataset.shown = '0';
                btn.textContent = this.t('dockerComposeReveal', 'Reveal');
                return;
            }
            btn.disabled = true;
            const project = this._project;
            let data = null;
            try {
                const q = `?file=${encodeURIComponent(btn.dataset.file)}&key=${encodeURIComponent(btn.dataset.key)}`;
                const res = await global.nextDashFetch(this._url(`/files/value${q}`));
                if (res.ok) data = await res.json();
            } catch {
                data = null;
            }
            if (this._project !== project || !btn.isConnected) return;
            btn.disabled = false;
            if (!data || typeof data.value !== 'string') {
                const msg = this.t('dockerEnvUnreadable', 'The value could not be read. Reading values needs the write token.');
                btn.title = msg;
                this.view.dash?.showNotification?.(msg, 'error');
                return;
            }
            maskEl.textContent = data.value;
            maskEl.classList.add('is-revealed');
            btn.dataset.shown = '1';
            btn.textContent = this.t('dockerComposeHide', 'Hide');
        }

        _copy(btn) {
            const text = btn.getAttribute('data-docker-compose-copy') || '';
            const old = btn.textContent;
            const done = (label) => {
                btn.textContent = label;
                setTimeout(() => { btn.textContent = old; }, 1200);
            };
            try {
                navigator.clipboard.writeText(text).then(
                    () => done(this.t('dockerComposeCopied', 'Copied')),
                    () => done(this.t('dockerComposeSelectIt', 'Select it')),
                );
            } catch {
                done(this.t('dockerComposeSelectIt', 'Select it'));
            }
        }
    }

    global.DockerComposeFiles = DockerComposeFiles;
}(typeof window !== 'undefined' ? window : globalThis));
