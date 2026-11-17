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
 * Tabs: Services (the stack's containers per service, with Up, Pull and
 * Restart for one), Compose file, .env, Logs (every service in one stream) and
 * Backups. The editor checks, diffs and applies (save, then Up).
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
                { name: 'services', label: this.t('dockerComposeTabServices', 'Services') },
                { name: 'compose', label: this.t('dockerComposeTabFile', 'Compose') },
                { name: 'env', label: this.t('dockerComposeTabEnv', '.env') },
                { name: 'logs', label: this.t('dockerComposeTabLogs', 'Logs') },
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
            const headMarkup = L.head(esc, {
                icon: '<span aria-hidden="true">▤</span>',
                title: project,
                badge: { text: this.t('dockerComposeCount', '{n} containers', { n: count }), tone: 'info' },
                more: [
                    { action: 'update', label: this.t('dockerComposePullUp', 'Pull and Up'), title: this.t('dockerComposePullUpHint', 'Pull newer images, then Up: the services whose image changed are recreated') },
                    { action: 'copy-name', label: this.t('dockerCopyName', 'Copy name') },
                ],
                where: this.t('dockerComposeWhere', 'Compose project'),
                actions: [
                    { action: 'reload', label: this.t('dockerComposeReload', 'Reload') },
                    { action: 'up', label: this.t('dockerActionUp', 'Up'), title: this.t('dockerComposeUpHint', 'Start the stack, and recreate the services whose file changed') },
                    { action: 'down', label: this.t('dockerActionDown', 'Down'), title: this.t('dockerComposeDownHint', 'Stop and remove the stack\'s containers; volumes stay') },
                    { action: 'pull', label: this.t('dockerActionPull', 'Pull'), title: this.t('dockerComposePullHint', 'Pull newer images; running containers are not changed') },
                    { action: 'restart', label: this.t('dockerActionRestart', 'Restart'), title: this.t('dockerComposeRestartHint', 'Restart every service of the stack; the file is not read again') },
                ],
            });
            // Next to the count: set when the file changed since the last Up nextDash ran.
            const head = headMarkup.replace(/(<span class="config-bm-score slp-badge"[^>]*>[^<]*<\/span>)/,
                `$1<span class="config-bm-score slp-badge docker-compose-pending" data-tone="warn" data-docker-compose-pending hidden>${esc(this.t('dockerComposePending', 'Edited, not applied'))}</span>`);
            const tabs = this._tabs();
            const back = backName
                ? `<button type="button" class="docker-compose-back" data-slp-action="back">← ${esc(backName)}</button>` : '';
            const body = (name) => `<div class="docker-compose-body" data-docker-compose-body="${esc(name)}"></div>`;
            const pane = (name) => L.pane(esc, 'dockerstack', tabs, name, body(name));
            const tabRow = L.tabs(esc, 'dockerstack', tabs);
            const runNote = '<p class="docker-compose-runnote" data-docker-compose-runnote hidden></p>';
            return `${back}${head}${runNote}${tabRow}${pane('services')}${pane('compose')}${pane('env')}${pane('logs')}${pane('backups')}`;
        }

        /** Binds the panel and loads. host actions: back(), copyName(). */
        mount(panel, project, { onBack = null } = {}) {
            this._panel = panel;
            this._project = project;
            this._data = null;
            this._editing = null;
            this._backups = null;
            this._running = false;
            this._stopLogs();
            this._logs = null;
            const mount = this._mount = (this._mount || 0) + 1;
            const compose = panel.querySelector('[data-slp-tab="compose"]');
            compose?.insertAdjacentHTML('beforeend', '<span class="config-bm-tab-dot docker-compose-dot" data-docker-compose-dot hidden></span>');
            global.SidePanelLayout.bind(panel, {
                group: 'dockerstack',
                onAction: (action) => {
                    if (action === 'reload') void this._headReload();
                    else if (['up', 'down', 'pull', 'restart', 'update'].includes(action)) void this._run(action);
                    else if (action === 'check') void this._checkQuick();
                    else if (action === 'edit-file') void this._editFirst();
                    else if (action === 'back') onBack?.();
                    else if (action === 'copy-name') {
                        void navigator.clipboard?.writeText?.(project);
                        this.view.dash?.showNotification?.(this.t('dockerNameCopied', 'Name copied'), 'success', { duration: 2000 });
                    }
                },
                onTab: (name) => {
                    if (name === 'backups') void this._loadBackups();
                    if (name === 'logs') void this._logsShow();
                    else this._stopLogs();
                    if (name === 'services') this._paintServices();
                },
            });
            if (panel.querySelector('[data-slp-tab="logs"].is-active')) void this._logsShow();
            panel.addEventListener('input', (e) => {
                if (this._mount === mount && e.target.matches?.('[data-docker-compose-editor]')) this._dirtyCheck();
            });
            panel.addEventListener('keydown', (e) => {
                if (this._mount === mount && e.target.matches?.('[data-docker-compose-editor]')) this._editorKey(e);
            });
            panel.addEventListener('scroll', (e) => {
                if (this._mount === mount && e.target.matches?.('[data-docker-compose-editor]')) this._syncHl();
            }, true);
            panel.addEventListener('click', (e) => {
                if (this._mount !== mount) return;
                const svc = e.target.closest('[data-docker-compose-svc]');
                if (svc) { void this._run(svc.getAttribute('data-docker-compose-svc'), svc.dataset.service); return; }
                const lc = e.target.closest('[data-docker-compose-logchip]');
                if (lc) { this._logFilter(lc.dataset.dockerComposeLogchip); return; }
                if (e.target.closest('[data-docker-compose-logreconnect]')) { void this._logsShow(true); return; }
                const bkd = e.target.closest('[data-docker-compose-bkdiff]');
                if (bkd) { void this._bkDiff(bkd); return; }
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
            bodies.filter((b) => b.getAttribute('data-docker-compose-body') !== 'logs')
                .forEach((b) => { b.textContent = this.t('dockerComposeLoading', 'Loading…'); });
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
            if (this._panel?.querySelector('[data-slp-tab="logs"].is-active')) void this._logsShow(true);
        }

        _bodies() {
            return [...(this._panel?.querySelectorAll('[data-docker-compose-body]') || [])];
        }

        _paint() {
            this._bodies().forEach((b) => {
                const role = b.getAttribute('data-docker-compose-body');
                if (role === 'logs') return;
                if (role === 'services') {
                    b.replaceChildren(this._renderServices());
                    return;
                }
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
            panel.querySelectorAll('[data-slp-action="up"],[data-slp-action="down"],[data-slp-action="pull"],[data-slp-action="restart"],[data-slp-action="update"],[data-docker-compose-svc]').forEach((b) => {
                if (b.dataset.hint === undefined) b.dataset.hint = b.title || '';
                b.disabled = off;
                b.title = why || b.dataset.hint;
            });
            this._syncPending();
            this._syncEditorButtons();
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

        /** The words for an action; Pull and Up is the server's `update`. */
        _runLabel(action) {
            return action === 'update' ? this.t('dockerComposePullUp', 'Pull and Up') : this.view.actions.label(action);
        }

        /**
         * Runs one compose action on the stack, or on one service (service:
         * Up, Pull, Restart). Resolves { ok, text } so Apply can say what failed.
         */
        async _run(action, service = '', opts = {}) {
            const actions = this.view.actions;
            const project = this._project;
            if (this._running || !actions || this._runBlock() || this._data?.state !== 'ok') return { ok: false, skipped: true };
            if (this._editing?.dirty) {
                this._notify(this.t('dockerComposeUnsavedRun', 'Save or discard your edit first.'), 'error');
                return { ok: false, skipped: true };
            }
            if (action === 'down') {
                const ok = await this._confirm(
                    this.t('dockerComposeDownTitle', 'Take {project} down', { project }),
                    this.t('dockerComposeDownBody', 'This stops and removes the containers and networks of {project}. Volumes and images stay, and Up brings the stack back.', { project }),
                    this.t('dockerActionDown', 'Down'), true);
                if (!ok) return { ok: false, skipped: true };
            } else if (action === 'restart' && !service) {
                const ok = await this._confirm(
                    this.t('dockerComposeRestartTitle', 'Restart {project}', { project }),
                    this.t('dockerComposeRestartBody', 'This restarts every container of {project}, one after the other. The compose file is not read again and nothing is recreated.', { project }),
                    this.t('dockerActionRestart', 'Restart'), false);
                if (!ok) return { ok: false, skipped: true };
            }
            this._running = true;
            this._syncRun();
            const label = opts.label || this._runLabel(action);
            const target = service ? `${project}/${service}` : project;
            const overlay = global.ProgressOverlay;
            overlay?.show?.(`${label} ${target}`, '');
            const runKey = action === 'update' ? 'composeupdate' : action;
            const progress = global.DockerUpdateRun ? new global.DockerUpdateRun(actions, runKey, [{ name: target }]) : null;
            progress?.begin(target);
            let res = null;
            let body = null;
            const base = this._url(`/${action}`);
            const url = `${base}${base.includes('?') ? '&' : '?'}${service ? `service=${encodeURIComponent(service)}&` : ''}stream=1`;
            try {
                ({ res, body } = await actions.streamAction(url, (ev) => progress?.event(target, ev)));
            } catch {
                res = null;
            }
            this._running = false;
            global.DockerSearchIndex?.invalidate?.();
            let out;
            if (!res || !res.ok) {
                const text = await actions.explain(res, body, { quiet: true });
                const tail = Array.isArray(body?.tail) ? body.tail : [];
                const row = progress?.rows?.get(target);
                if (row && tail.length) progress.appendLog(row, tail.join('\n'));
                progress?.end(target, { ok: false, text });
                overlay?.settle?.(text, this.t('dockerRunClose', 'Close'));
                actions.track?.(`compose-${action}`, false, 'stack');
                out = { ok: false, text };
            } else {
                progress?.end(target, { ok: true });
                overlay?.finish?.(this.t('dockerComposeRunDone', '{label} finished for {project}.', { label, project: target }));
                actions.track?.(`compose-${action}`, true, 'stack');
                await this.view.refreshContainers?.();
                out = { ok: true };
            }
            this._syncRun();
            this._paintServices();
            void this._pendingRefresh();
            return out;
        }

        /* ── Services, and edited-not-applied ─────────────────────────── */

        _members() {
            return (this.view.containers || []).filter((c) => c.composeProject === this._project);
        }

        /** One row per compose service, from the container list already loaded. */
        _services() {
            const by = new Map();
            this._members().forEach((c) => {
                const name = c.composeService || c.name;
                const row = by.get(name) || { name, image: c.image, states: new Set(), health: new Set(), ports: new Set(), count: 0 };
                row.count += 1;
                row.states.add(c.state || '');
                if (c.health) row.health.add(c.health);
                (c.ports || []).filter((p) => p && p.public).forEach((p) => row.ports.add(p.public));
                by.set(name, row);
            });
            return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
        }

        _stateTone(state) {
            if (state === 'running') return 'good';
            if (state === 'paused' || state === 'restarting') return 'warn';
            if (state === 'dead') return 'bad';
            return 'muted';
        }

        _renderServices() {
            const d = this._data || {};
            const frag = document.createDocumentFragment();
            const add = (html) => frag.appendChild(this._html(html));
            if (d.state === 'remote' || d.state === 'error') return this._render('compose');
            const esc = (v) => this.esc(v);
            if (d.pendingChange && this._canChange()) {
                add(`<div class="docker-compose-note" data-tone="warn" data-docker-compose-pending-note><h4>${esc(this.t('dockerComposePending', 'Edited, not applied'))}</h4>
                    <p>${esc(this.t('dockerComposePendingBody', 'The file changed after the last Up nextDash ran, so the running containers may not match it.'))}</p>
                    <p class="docker-compose-legend">${esc(this.t('dockerComposePendingLimit', 'nextDash can only tell for stacks it started itself.'))}</p>
                    <div class="docker-compose-noterow">
                        <button type="button" class="config-btn config-btn--small config-btn--primary" data-slp-action="up">${esc(this.t('dockerComposeApply', 'Apply'))}</button>
                        <button type="button" class="config-btn config-btn--small" data-slp-action="check">${esc(this.t('dockerComposeCheck', 'Check'))}</button>
                        <button type="button" class="config-btn config-btn--small" data-slp-action="edit-file">${esc(this.t('dockerComposeEditFile', 'Edit file'))}</button>
                    </div></div>`);
            }
            const rows = this._services();
            if (!rows.length) {
                add(this._note('info', this.t('dockerComposeNoServices', 'No containers in this stack'), [this._p(this.t('dockerComposeNoServicesFix', 'Press Up to start the stack\'s services.'))]));
                return frag;
            }
            const off = Boolean(this._runBlock()) || this._running;
            const btn = (act, glyph, text, name) => `<button type="button" class="config-btn config-btn--icon" data-docker-compose-svc="${act}" data-service="${esc(name)}"
                title="${esc(text)}" aria-label="${esc(text)}"${off ? ' disabled' : ''}>${glyph}</button>`;
            const body = rows.map((r) => {
                const states = [...r.states];
                const state = states.length === 1 ? states[0] : (states.find((x) => x !== 'running') || states[0]);
                const h = r.health.has('unhealthy') ? 'unhealthy' : (r.health.has('starting') ? 'starting' : (r.health.size ? 'healthy' : ''));
                const htone = h === 'healthy' ? 'good' : (h === 'unhealthy' ? 'bad' : 'warn');
                const ports = [...r.ports].sort((a, b) => a - b).map((p) => `<span class="docker-compose-port">${esc(p)}</span>`).join(' ');
                const count = r.count > 1 ? ` <span class="docker-compose-meta">×${r.count}</span>` : '';
                return `<tr data-docker-compose-service="${esc(r.name)}">
                    <td><span class="docker-compose-svcname">${esc(r.name)}${count}</span><span class="docker-compose-svcimg" title="${esc(r.image)}">${esc(r.image)}</span></td>
                    <td><div class="docker-compose-chips"><span class="config-bm-score slp-badge" data-tone="${this._stateTone(state)}">${esc(state || '—')}</span>${h ? `<span class="config-bm-score slp-badge" data-tone="${htone}">${esc(h)}</span>` : ''}</div></td>
                    <td>${ports || '<span class="docker-compose-meta">—</span>'}</td>
                    <td><div class="docker-compose-rowact">${btn('up', '▶', this.t('dockerComposeSvcUp', 'Up {service}', { service: r.name }), r.name)}${btn('pull', '↓', this.t('dockerComposeSvcPull', 'Pull {service}', { service: r.name }), r.name)}${btn('restart', '↻', this.t('dockerComposeSvcRestart', 'Restart {service}', { service: r.name }), r.name)}</div></td></tr>`;
            }).join('');
            add(`<table class="docker-compose-svctable"><colgroup><col class="c-name"><col class="c-state"><col class="c-ports"><col class="c-act"></colgroup>
                <thead><tr><th>${esc(this.t('dockerComposeColService', 'Service'))}</th><th>${esc(this.t('dockerComposeColState', 'Status'))}</th><th>${esc(this.t('dockerComposeColPorts', 'Ports'))}</th><th></th></tr></thead>
                <tbody>${body}</tbody></table>
                <p class="docker-compose-legend">${esc(this.t('dockerComposeSvcLegend', 'Up, Pull and Restart here act on one service and lock only its containers.'))}</p>`);
            return frag;
        }

        _paintServices() {
            const b = this._bodies().find((x) => x.getAttribute('data-docker-compose-body') === 'services');
            if (b && this._data?.state) b.replaceChildren(this._renderServices());
        }

        _syncPending() {
            const panel = this._panel;
            if (!panel) return;
            const d = this._data || {};
            const on = Boolean(d.pendingChange) && d.state === 'ok';
            const chip = panel.querySelector('[data-docker-compose-pending]');
            if (chip) {
                chip.hidden = !on;
                chip.title = this.t('dockerComposePendingTip', 'The file changed after the last Up nextDash ran. Only stacks nextDash started are tracked, so a stack changed outside nextDash is not flagged.');
            }
            const dot = panel.querySelector('[data-docker-compose-dot]');
            if (dot) dot.hidden = !on;
        }

        /** Asks the files again, only for the flags: the editor and the tabs stay as they are. */
        async _pendingRefresh() {
            const project = this._project;
            let data = null;
            try {
                const res = await global.nextDashFetch(this._url('/files'));
                if (res.ok) data = await res.json();
            } catch {
                data = null;
            }
            if (!data || this._project !== project || !this._data || this._data.state !== 'ok') return;
            this._data.pendingChange = data.pendingChange === true;
            (data.files || []).forEach((nf) => {
                const f = this._fileById(nf.id);
                if (f) { f.pendingChange = nf.pendingChange; f.appliedSha256 = nf.appliedSha256; f.sha256 = nf.sha256; }
            });
            this._syncPending();
            this._paintServices();
            this._syncEditorButtons();
        }

        async _editFirst() {
            const f = ((this._data || {}).files || []).find((x) => x.role === 'compose' && x.state === 'ok');
            this._panel?.querySelector('[data-slp-tab="compose"]')?.click();
            if (f) await this._edit(f.id);
        }

        /* ── Check ────────────────────────────────────────────────────── */

        /**
         * compose config -q on the saved files, or, with staged {file, content},
         * on that text in place of the file. { ok } or { ok: false, line, column, tail, text }.
         */
        async _check(staged = null) {
            let res = null;
            let body = null;
            try {
                res = await global.nextDashFetch(this._url('/check'), staged
                    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(staged) }
                    : { method: 'POST' });
                body = await res.json().catch(() => null);
            } catch {
                res = null;
            }
            if (res && res.ok) return { ok: true };
            if (res && res.status === 422 && body?.reason === 'compose-yaml') {
                return { ok: false, line: body.line || 0, column: body.column || 0, tail: [body.message || ''].filter(Boolean) };
            }
            if (res && res.status === 413) return { ok: false, text: this.t('dockerComposeCheckTooLarge', 'The text is too large to check before saving. Save it, then Check.') };
            if (res && res.status === 422 && body?.reason === 'compose-invalid') {
                const tail = (Array.isArray(body.tail) ? body.tail : []).filter(Boolean);
                return { ok: false, line: body.line || 0, column: body.column || 0, tail };
            }
            const text = (await this.view.actions?.explain?.(res, body, { quiet: true })) || this.t('dockerComposeCheckFailedRun', 'The check could not run.');
            return { ok: false, text };
        }

        _checkText(r) {
            if (r.text) return r.text;
            const last = (r.tail || []).slice(-1)[0] || '';
            if (r.line) return this.t('dockerComposeCheckAt', 'Line {line}{column}: {message}', { line: r.line, column: r.column ? `, column ${r.column}` : '', message: last });
            return last || this.t('dockerComposeInvalidFile', 'Compose rejected this file.');
        }

        /** Check from the Services note: no editor, so the answer is a toast. */
        async _checkQuick() {
            if (this._running) return;
            const r = await this._check();
            if (r.ok) this._notify(this.t('dockerComposeCheckPassed', 'Check passed. Nothing was written or started.'), 'success');
            else this._notify(this._checkText(r), 'error');
        }

        async _checkEditor() {
            const ed = this._editing;
            const ta = this._editor();
            if (!ed || !ta || ed.checking) return;
            ed.checking = true;
            this._syncEditorButtons();
            const status = this._$('[data-docker-compose-status]');
            if (status) status.textContent = this.t('dockerComposeChecking', 'Checking…');
            const text = ta.value;
            const r = await this._check(ed.dirty ? { file: ed.id, content: text } : null);
            ed.checking = false;
            if (!this._editor()) return;
            if (status) status.textContent = '';
            this._syncEditorButtons();
            if (r.ok) {
                this._setResult('good', this.t('dockerComposeCheckPassedTitle', 'Check passed'), [this.t('dockerComposeCheckPassedBody', 'compose config found no problems. Nothing was written or started.')]);
                ed.resultAt = text;
                return r;
            }
            ed.resultAt = text;
            r.failed = true;
            const where = r.line ? [this.t('dockerComposeCheckWhere', 'Line {line}{column}', { line: r.line, column: r.column ? `, column ${r.column}` : '' })] : (r.text ? [r.text] : []);
            this._setResult('bad', this.t('dockerComposeCheckFailed', 'Check failed'), where, r.line ? { line: r.line, column: r.column } : null, r.tail);
            if (r.line) this._goto(r.line, r.column, false);
            return r;
        }

        /* ── The result card under the editor ─────────────────────────── */

        _setResult(tone, title, lines, jump, tail) {
            const host = this._$('[data-docker-compose-result]');
            if (!host) return;
            const esc = (v) => this.esc(v);
            host.className = 'docker-compose-note';
            host.dataset.tone = tone;
            host.innerHTML = `<h4>${esc(title)}</h4>${lines.map((l) => `<p>${esc(l)}</p>`).join('')}
                ${tail && tail.length ? `<pre class="docker-compose-tail">${esc(tail.slice(-8).join('\n'))}</pre>` : ''}
                ${jump ? `<div class="docker-compose-noterow"><button type="button" class="config-btn config-btn--small" data-docker-compose-editor-action="jump" data-line="${jump.line}" data-col="${jump.column || 1}">${esc(this.t('dockerComposeGoToLine', 'Go to line {n}', { n: jump.line }))}</button></div>` : ''}
                <div class="docker-compose-noterow" data-docker-compose-result-actions></div>`;
            host.hidden = false;
            if (this._editing) this._editing.resultAt = this._editor()?.value ?? null;
        }

        _clearResult() {
            const host = this._$('[data-docker-compose-result]');
            if (host) { host.hidden = true; host.replaceChildren(); }
            this._hl(0);
        }

        /* ── Editor line mark, jump ───────────────────────────────────── */

        _lineHeight(ta) {
            return parseFloat(getComputedStyle(ta).lineHeight) || 18;
        }

        _hl(line) {
            const hl = this._$('[data-docker-compose-hl]');
            if (!hl) return;
            const ta = this._editor();
            hl.dataset.line = line ? String(line) : '';
            hl.hidden = !line;
            if (line && ta) hl.style.height = `${this._lineHeight(ta)}px`;
            this._syncHl();
        }

        _syncHl() {
            const hl = this._$('[data-docker-compose-hl]');
            const ta = this._editor();
            if (!hl || !ta || hl.hidden) return;
            const line = Number(hl.dataset.line) || 1;
            const pad = parseFloat(getComputedStyle(ta).paddingTop) || 0;
            hl.style.transform = `translateY(${pad + (line - 1) * this._lineHeight(ta) - ta.scrollTop}px)`;
        }

        _goto(line, column, focus = true) {
            const ta = this._editor();
            if (!ta) return;
            const off = this._offsetOf(ta.value, line, column);
            if (focus) ta.focus();
            ta.setSelectionRange(off, off);
            ta.scrollTop = Math.max(0, (line - 3) * this._lineHeight(ta));
            this._hl(line);
        }

        /** The editor's error line: the words, a jump link and the line marked. */
        _showError(text, line, column) {
            const err = this._$('[data-docker-compose-error]');
            if (!err) return;
            err.replaceChildren(document.createTextNode(text));
            if (line) {
                err.append(' ');
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'config-btn config-btn--small';
                b.setAttribute('data-docker-compose-editor-action', 'jump');
                b.dataset.line = String(line);
                b.dataset.col = String(column || 1);
                b.textContent = this.t('dockerComposeGoToLine', 'Go to line {n}', { n: line });
                err.append(b);
            }
            err.hidden = !text;
            if (this._editing) this._editing.resultAt = this._editor()?.value ?? null;
            this._hl(line || 0);
        }

        _editorKey(e) {
            const ed = this._editing;
            const ta = e.target;
            if (!ed) return;
            if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
                const save = this._$('[data-docker-compose-save]');
                if (save && !save.disabled) void this._save();
                return;
            }
            if (e.key === 'Escape') {
                // Leaves the field on the next Tab; the panel stays open.
                ed.tabFree = true;
                e.stopPropagation();
                return;
            }
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                if (ed.tabFree) return;
                e.preventDefault();
                ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }
            if (e.key !== 'Shift' && e.key !== 'Tab') ed.tabFree = false;
        }

        /* ── Diff ─────────────────────────────────────────────────────── */

        /** Lines of a text, without the empty piece a closing newline leaves. */
        _lines(text) {
            const l = String(text ?? '').split('\n');
            if (l.length && l[l.length - 1] === '') l.pop();
            return l;
        }

        /**
         * Line diff of two texts. The unchanged start and end are cut off first,
         * so a small edit stays cheap in a long file; null when what is left in
         * the middle is too big to compare here.
         */
        _diff(oldText, newText) {
            const a = this._lines(oldText);
            const b = this._lines(newText);
            let pre = 0;
            while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre += 1;
            let suf = 0;
            while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf += 1;
            const ma = a.slice(pre, a.length - suf);
            const mb = b.slice(pre, b.length - suf);
            if (ma.length * mb.length > 4e6) return null;
            const n = ma.length;
            const m = mb.length;
            const w = m + 1;
            const L = new Uint16Array((n + 1) * w);
            for (let i = n - 1; i >= 0; i -= 1) {
                for (let j = m - 1; j >= 0; j -= 1) {
                    L[i * w + j] = ma[i] === mb[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
                }
            }
            const ops = [];
            for (let i = 0; i < pre; i += 1) ops.push({ t: '=', s: a[i], i: i + 1, j: i + 1 });
            let i = 0;
            let j = 0;
            while (i < n && j < m) {
                if (ma[i] === mb[j]) { ops.push({ t: '=', s: ma[i], i: pre + i + 1, j: pre + j + 1 }); i += 1; j += 1; }
                else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) { ops.push({ t: '-', s: ma[i], i: pre + i + 1 }); i += 1; }
                else { ops.push({ t: '+', s: mb[j], j: pre + j + 1 }); j += 1; }
            }
            while (i < n) { ops.push({ t: '-', s: ma[i], i: pre + i + 1 }); i += 1; }
            while (j < m) { ops.push({ t: '+', s: mb[j], j: pre + j + 1 }); j += 1; }
            for (let k = 0; k < suf; k += 1) ops.push({ t: '=', s: a[a.length - suf + k], i: a.length - suf + k + 1, j: b.length - suf + k + 1 });
            const count = (t) => ops.filter((o) => o.t === t).length;
            return { ops, added: count('+'), removed: count('-') };
        }

        /** The unified diff, two lines of context around every change. */
        _diffHTML(diff, title, legend) {
            const esc = (v) => this.esc(v);
            const { ops } = diff;
            const keep = ops.map(() => false);
            ops.forEach((o, x) => {
                if (o.t === '=') return;
                for (let y = Math.max(0, x - 2); y <= Math.min(ops.length - 1, x + 2); y += 1) keep[y] = true;
            });
            let skipped = 0;
            let rows = '';
            const gap = () => {
                if (skipped) rows += `<div class="docker-compose-dl is-gap">${esc(this.t('dockerComposeDiffGap', '⋯ {n} unchanged lines', { n: skipped }))}</div>`;
                skipped = 0;
            };
            ops.forEach((o, x) => {
                if (!keep[x]) { skipped += 1; return; }
                gap();
                const cls = o.t === '+' ? ' is-add' : (o.t === '-' ? ' is-del' : '');
                rows += `<div class="docker-compose-dl${cls}"><span class="docker-compose-n">${o.i || ''}</span><span class="docker-compose-n">${o.j || ''}</span><span class="docker-compose-sg">${o.t === '+' ? '+' : (o.t === '-' ? '−' : '')}</span><span class="docker-compose-t">${esc(o.s)}</span></div>`;
            });
            gap();
            return `<div class="docker-compose-diff" data-docker-compose-diffbox><div class="docker-compose-diffhead"><span>${esc(title)}</span>
                <b class="is-add">+${diff.added}</b> <b class="is-del">−${diff.removed}</b>${legend ? `<span class="docker-compose-meta">${esc(legend)}</span>` : ''}</div>${rows}</div>`;
        }

        _diffMessage(diff) {
            if (!diff) return `<p class="docker-compose-legend">${this.esc(this.t('dockerComposeDiffTooBig', 'Too many changed lines to compare here.'))}</p>`;
            if (!diff.added && !diff.removed) return `<p class="docker-compose-legend">${this.esc(this.t('dockerComposeDiffSame', 'No differences.'))}</p>`;
            return '';
        }

        /** Chip counts and, when open, the diff under the editor. */
        _updateDiff() {
            const ed = this._editing;
            const ta = this._editor();
            const chip = this._$('[data-docker-compose-chg]');
            const host = this._$('[data-docker-compose-diff]');
            if (!ed || !ta || !chip || !host) return;
            if (!ed.dirty) {
                chip.hidden = true;
                host.hidden = true;
                ed.diffOpen = false;
                chip.setAttribute('aria-expanded', 'false');
                return;
            }
            const diff = this._diff(ed.original, ta.value);
            chip.hidden = false;
            chip.querySelector('[data-docker-compose-chg-add]').textContent = diff ? `+${diff.added}` : '';
            chip.querySelector('[data-docker-compose-chg-del]').textContent = diff ? `−${diff.removed}` : '';
            chip.setAttribute('aria-expanded', String(Boolean(ed.diffOpen)));
            chip.classList.toggle('is-on', Boolean(ed.diffOpen));
            host.hidden = !ed.diffOpen;
            if (ed.diffOpen) {
                host.innerHTML = diff && (diff.added || diff.removed)
                    ? this._diffHTML(diff, this.t('dockerComposeDiffSave', 'Your edit against the file on disk')) : this._diffMessage(diff);
            }
        }

        /** Buttons in the editor bar follow what the editor can do right now. */
        _syncEditorButtons() {
            const ed = this._editing;
            if (!ed) return;
            const apply = this._$('[data-docker-compose-apply]');
            const check = this._$('[data-docker-compose-check]');
            const pending = Boolean((this._data || {}).pendingChange);
            if (apply) {
                const why = this._runBlock();
                apply.disabled = Boolean(why) || this._running || ed.saving === true || ed.readOnly === true || ed.invalidAt !== null || (!ed.dirty && !pending);
                apply.title = why || (!ed.dirty && !pending ? this.t('dockerComposeApplyNothing', 'Nothing to apply: the running stack matches the file.') : this.t('dockerComposeApplyHint', 'Save the file, then Up the stack.'));
            }
            if (check) {
                check.disabled = ed.checking === true || ed.saving === true;
                check.title = this.t('dockerComposeCheckHint', 'Dry run: compose config on this text. Nothing is written or started.');
            }
        }

        async _apply() {
            const ed = this._editing;
            if (!ed || this._running) return;
            ed.lastBackup = null;
            if (ed.dirty) {
                // Check first: a text compose refuses is never written.
                const r = await this._checkEditor();
                if (!r || r.failed) return;
                const ok = await this._save();
                if (!ok) return;
            }
            const r = await this._run('up', '', { label: this.t('dockerComposeApply', 'Apply') });
            if (r.skipped || r.ok || !this._editor()) return;
            this._setResult('warn', this.t('dockerComposeApplyUpFailed', 'The file is saved, but Up failed'), [r.text,
                ed.lastBackup ? this.t('dockerComposeApplyKept', 'The new file stays as saved. The copy from before is in Backups.') : this.t('dockerComposeApplyKept2', 'The file stays as it is.')]);
            if (ed.lastBackup) {
                const row = this._$('[data-docker-compose-result-actions]');
                row?.insertAdjacentHTML('beforeend', `<button type="button" class="config-btn config-btn--small config-btn--primary" data-docker-compose-editor-action="restore-prev">${this.esc(this.t('dockerComposeRestorePrev', 'Restore previous copy'))}</button>`);
            }
        }

        /* ── A backup against the current file ────────────────────────── */

        /** Shows, under its row, what restoring this copy would change. */
        async _bkDiff(btn) {
            const li = btn.closest('li');
            if (!li) return;
            const next = li.nextElementSibling;
            if (next?.matches('[data-docker-compose-bkdiffrow]')) {
                next.remove();
                btn.setAttribute('aria-expanded', 'false');
                return;
            }
            const id = btn.dataset.file;
            const stamp = btn.dataset.stamp;
            const project = this._project;
            btn.disabled = true;
            let cur = null;
            let old = null;
            try {
                cur = await this._fetchRaw(id);
                const res = await global.nextDashFetch(this._url(`/backups/${encodeURIComponent(stamp)}/raw?file=${encodeURIComponent(id)}`));
                if (res.ok) old = await res.json();
            } catch {
                old = null;
            }
            btn.disabled = false;
            if (this._project !== project || !li.isConnected) return;
            if (!cur || typeof old?.content !== 'string') {
                this._notify(this.t('dockerComposeBackupReadFailed', 'The copy could not be read. Reading it needs the write token when one is set.'), 'error');
                return;
            }
            const diff = this._diff(cur.content, old.content);
            const why = this._whyNot(this._fileById(id));
            const msg = this._diffMessage(diff);
            const row = document.createElement('li');
            row.className = 'docker-compose-bkdiffrow';
            row.setAttribute('data-docker-compose-bkdiffrow', stamp);
            row.innerHTML = `${msg || this._diffHTML(diff, this.t('dockerComposeDiffRestore', 'Restoring this copy changes the current file like this'),
                this.t('dockerComposeDiffRestoreLegend', 'Red goes away, green comes back.'))}
                <div class="docker-compose-editbar"><button type="button" class="config-btn config-btn--small config-btn--primary" data-docker-compose-restore data-file="${this.esc(id)}" data-stamp="${this.esc(stamp)}"${why ? ` disabled title="${this.esc(why)}"` : ''}>${this.esc(this.t('dockerComposeRestoreThis', 'Restore this copy'))}</button>
                <button type="button" class="config-btn config-btn--small" data-docker-compose-bkdiff data-file="${this.esc(id)}" data-stamp="${this.esc(stamp)}">${this.esc(this.t('dockerComposeClosePreview', 'Close preview'))}</button></div>`;
            li.after(row);
            btn.setAttribute('aria-expanded', 'true');
        }

        /* ── Logs: every service in one stream ─────────────────────────── */

        _stopLogs() {
            this._logAbort?.abort();
            this._logAbort = null;
        }

        _svcColor(i) {
            return `var(--docker-svc-${(i % 4) + 1})`;
        }

        /** Builds the Logs tab and follows the stack's stream; again = reconnect, keeping the shell. */
        async _logsShow(again = false) {
            const body = this._bodies().find((b) => b.getAttribute('data-docker-compose-body') === 'logs');
            const d = this._data || {};
            if (!body) return;
            if (this._logs && this._logs.project === this._project && !again && this._logAbort) return;
            const esc = (v) => this.esc(v);
            if (d.state === 'remote') {
                body.replaceChildren(this._render('compose'));
                return;
            }
            const names = this._services().map((r) => r.name);
            this._logs = { project: this._project, names, only: null, lines: 0 };
            body.innerHTML = `<div class="docker-compose-logtool"><button type="button" class="docker-compose-logchip is-on" data-docker-compose-logchip="">${esc(this.t('dockerComposeLogAll', 'All'))}</button>
                ${names.map((n, i) => `<button type="button" class="docker-compose-logchip" data-docker-compose-logchip="${esc(n)}"><span class="docker-compose-logsw" style="background:${this._svcColor(i)}"></span>${esc(n)}</button>`).join('')}
                <span class="docker-compose-follow" data-docker-compose-logstate></span></div>
                <div class="docker-logs docker-compose-logbox" data-docker-compose-logbox role="log" aria-label="${esc(this.t('dockerComposeLogLabel', 'Logs of every service'))}"></div>
                <p class="docker-compose-legend">${esc(this.t('dockerComposeLogLegend', 'Merged from the containers\' own logs, in time order, last 200 lines of each.'))}
                    <button type="button" class="config-btn config-btn--small" data-docker-compose-logreconnect hidden>${esc(this.t('dockerComposeLogReconnect', 'Reconnect'))}</button></p>`;
            await this._logStream();
        }

        async _logStream() {
            this._stopLogs();
            const logs = this._logs;
            const box = this._$('[data-docker-compose-logbox]');
            const state = this._$('[data-docker-compose-logstate]');
            const again = this._$('[data-docker-compose-logreconnect]');
            if (!logs || !box) return;
            const abort = new AbortController();
            this._logAbort = abort;
            const setState = (text) => { if (state) state.textContent = text; };
            if (again) again.hidden = true;
            setState(this.t('dockerComposeLogConnecting', 'Connecting…'));
            let res = null;
            try {
                res = await global.nextDashFetch(this._url('/logs/stream?tail=200'), { signal: abort.signal, cache: 'no-store' });
            } catch {
                res = null;
            }
            if (abort.signal.aborted) return;
            if (!res || !res.ok || !res.body) {
                setState(res && res.status === 401
                    ? this.t('dockerLogsNeedsToken', 'Reading logs needs the write token.')
                    : this.t('dockerLogsUnreachable', 'The log could not be reached.'));
                if (again) again.hidden = false;
                return;
            }
            setState(this.t('dockerComposeLogFollowing', '● Following'));
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            try {
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (!this._panel?.isConnected || abort.signal.aborted) return;
                    buffer += decoder.decode(value, { stream: true });
                    let nl = buffer.indexOf('\n');
                    const batch = [];
                    while (nl >= 0) {
                        const raw = buffer.slice(0, nl).trim();
                        buffer = buffer.slice(nl + 1);
                        nl = buffer.indexOf('\n');
                        if (!raw) continue;
                        try { batch.push(JSON.parse(raw)); } catch { /* a torn line is skipped */ }
                    }
                    if (batch.length) this._logAppend(box, batch);
                }
            } catch {
                // Aborted, or the connection dropped: both end below.
            }
            if (abort.signal.aborted) return;
            setState(this.t('dockerLogsEnded', 'The stream ended — the container stopped, or the connection closed.'));
            if (again) again.hidden = false;
        }

        _logAppend(box, batch) {
            const logs = this._logs;
            const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 24;
            const frag = document.createDocumentFragment();
            batch.forEach((l) => {
                const service = String(l.service || '');
                let idx = logs.names.indexOf(service);
                if (idx < 0) { logs.names.push(service); idx = logs.names.length - 1; }
                const row = document.createElement('div');
                row.className = `docker-compose-lg${l.s === 'err' ? ' is-err' : ''}`;
                row.dataset.service = service;
                const time = String(l.t || '').slice(11, 19);
                const t = document.createElement('span'); t.className = 'docker-compose-lgt'; t.textContent = time;
                const tag = document.createElement('span'); tag.className = 'docker-compose-lgtag'; tag.style.color = this._svcColor(idx);
                const i = document.createElement('i'); i.textContent = service; tag.append(i);
                const m = document.createElement('span'); m.className = 'docker-compose-lgm'; m.textContent = String(l.m ?? '');
                row.append(t, tag, m);
                row.hidden = logs.only !== null && logs.only !== service;
                frag.appendChild(row);
            });
            box.appendChild(frag);
            while (box.childElementCount > 1000) box.firstElementChild.remove();
            if (stick) box.scrollTop = box.scrollHeight;
        }

        _logFilter(name) {
            const logs = this._logs;
            const box = this._$('[data-docker-compose-logbox]');
            if (!logs || !box) return;
            logs.only = name || null;
            this._panel.querySelectorAll('[data-docker-compose-logchip]').forEach((c) => {
                c.classList.toggle('is-on', (c.getAttribute('data-docker-compose-logchip') || null) === logs.only);
            });
            box.querySelectorAll('.docker-compose-lg').forEach((r) => { r.hidden = logs.only !== null && r.dataset.service !== logs.only; });
            box.scrollTop = box.scrollHeight;
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
            this._editing = { id, sha: raw.sha256, original: raw.content, dirty: false, invalidAt: null, resultAt: null, diffOpen: false, lastBackup: null };
            this._syncEditorButtons();
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
                <div class="docker-compose-edwrap"><div class="docker-compose-hlbox" aria-hidden="true"><div class="docker-compose-hl" data-docker-compose-hl hidden></div></div>
                <textarea class="docker-compose-editor" data-docker-compose-editor spellcheck="false" autocomplete="off" autocapitalize="off"
                    aria-label="${esc(f.hostPath)}">${esc(raw.content)}</textarea></div>
                <p class="docker-compose-yamlerr" data-docker-compose-error role="alert" hidden></p>
                <div data-docker-compose-result hidden role="status"></div>
                <div class="docker-compose-conflict" data-docker-compose-conflict hidden>
                    <p>${esc(this.t('dockerComposeConflict', 'The file changed on disk since you opened it. Reload to take the new version, or keep editing: saving then replaces it, and the current file is backed up first.'))}</p>
                    ${btn('conflict-reload', this.t('dockerComposeReload', 'Reload'))}${btn('conflict-keep', this.t('dockerComposeKeep', 'Keep editing'))}
                </div>
                <div class="docker-compose-readonly" data-docker-compose-readonly hidden></div>
                <ul class="docker-compose-warnings" data-docker-compose-warnings hidden></ul>
                <div class="docker-compose-editbar">
                    ${btn('save', this.t('dockerComposeSave', 'Save')).replace('<button', '<button disabled data-docker-compose-save')}
                    ${btn('check', this.t('dockerComposeCheck', 'Check')).replace('<button', '<button data-docker-compose-check')}
                    ${btn('apply', this.t('dockerComposeApply', 'Apply'), ' config-btn--primary').replace('<button', '<button disabled data-docker-compose-apply')}
                    ${btn('reload', this.t('dockerComposeReload', 'Reload'))}${btn('close', this.t('dockerComposeCloseEdit', 'Close'))}
                    <button type="button" class="docker-compose-chg" data-docker-compose-chg data-docker-compose-editor-action="diff" aria-expanded="false" hidden>${esc(this.t('dockerComposeChanges', 'Changes'))}
                        <b class="is-add" data-docker-compose-chg-add></b> <b class="is-del" data-docker-compose-chg-del></b></button>
                    <span class="docker-compose-status" data-docker-compose-status role="status"></span>
                </div>
                <div data-docker-compose-diff hidden></div>
                <div class="docker-compose-keys" data-docker-compose-keys>
                    <span><kbd>${esc(/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl')}</kbd><kbd>S</kbd> ${esc(this.t('dockerComposeKeySave', 'Save'))}</span>
                    <span><kbd>Tab</kbd> ${esc(this.t('dockerComposeKeyTab', 'Two spaces'))}</span>
                    <span><kbd>Esc</kbd> <kbd>Tab</kbd> ${esc(this.t('dockerComposeKeyLeave', 'Leave the field'))}</span>
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
            // After a refused parse the same text is not sent again. The marks of a
            // Check or a failed Up go once the text changes.
            if (ed.resultAt !== null && ed.resultAt !== undefined && ta.value !== ed.resultAt) {
                ed.resultAt = null;
                ed.invalidAt = null;
                const err = this._$('[data-docker-compose-error]');
                if (err) err.hidden = true;
                this._clearResult();
            }
            if (ed.invalidAt !== null && ta.value !== ed.invalidAt) ed.invalidAt = null;
            const save = this._$('[data-docker-compose-save]');
            if (save) save.disabled = !ed.dirty || ed.invalidAt !== null || ed.saving === true || ed.readOnly === true;
            const status = this._$('[data-docker-compose-status]');
            if (status && ed.dirty) status.textContent = '';
            this._updateDiff();
            this._syncEditorButtons();
        }

        async _editorAction(action) {
            const ed = this._editing;
            if (!ed) return;
            if (action === 'save') await this._save();
            else if (action === 'check') await this._checkEditor();
            else if (action === 'apply') await this._apply();
            else if (action === 'diff') {
                ed.diffOpen = !ed.diffOpen;
                this._updateDiff();
            } else if (action === 'jump') {
                const b = this._panel?.querySelector('[data-docker-compose-editor-action="jump"]');
                const line = Number(b?.dataset.line) || 1;
                this._goto(line, Number(b?.dataset.col) || 1);
            } else if (action === 'restore-prev') {
                if (ed.lastBackup) await this._restore(ed.id, ed.lastBackup);
            } else if (action === 'reload' || action === 'conflict-reload') {
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
            Object.assign(ed, { sha: raw.sha256, original: raw.content, dirty: false, invalidAt: null, resultAt: null, diskSha: null, readOnly: false, diffOpen: false });
            this._clearResult();
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
                ed.lastBackup = body?.backup || null;
                ed.resultAt = null;
                this._clearResult();
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
                void this._pendingRefresh();
                return true;
            }
            const reason = body?.reason;
            if (reason === 'compose-yaml' || reason === 'compose-invalid') {
                const y = body.yamlError || body;
                ed.invalidAt = content;
                const where = y.line
                    ? this.t('dockerComposeYAMLAt', 'Line {line}, column {column}: {message}', { line: y.line, column: y.column || 1, message: y.message || '' })
                    : (y.message || this.t('dockerComposeInvalidFile', 'Compose rejected this file.'));
                this._showError(where, y.line || 0, y.column || 1);
                if (y.line) this._goto(y.line, y.column, true);
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
            return false;
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
                        <button type="button" class="config-btn config-btn--small" data-docker-compose-bkdiff data-file="${esc(f.id)}" data-stamp="${esc(b.stamp)}" aria-expanded="false">${esc(this.t('dockerComposeDiff', 'Diff'))}</button>
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
