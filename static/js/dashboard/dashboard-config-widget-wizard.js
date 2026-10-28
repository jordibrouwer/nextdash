/**
 * Config → Widgets: the Add wizard's shell.
 *
 * Adding a widget used to land on "whichever page the list happens to show",
 * which on the all-pages view was no page at all. The picker now names the
 * page itself, and only when there is a choice to make. The helpers here are
 * the questions the wizard asks: what kind of widget needs a connection
 * step, which pages exist, and which one is the sensible default.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    Object.assign(global.DashboardConfig.prototype, {
        /*
         * What the wizard does for a kind: 'media' when it connects to a
         * service first, 'custom' for the Custom widget, null for the rest.
         * Beszel, Home Assistant, Unraid and Glances stay null for now -- their
         * connection lives in their own settings panel.
         */
        widgetWizardKind(type) {
            if (type === 'custom') return 'custom';
            const service = global.DashboardConfig.MEDIA_SERVICES?.[type];
            if (!service) return null;
            const setup = service.setup || service.id;
            return setup === 'beszel' || setup === 'homeassistant' ? null : 'media';
        },

        widgetWizardPages() {
            const pages = Array.isArray(this.dash.pages) ? this.dash.pages : [];
            return pages.map((p) => ({ id: Number(p.id), name: String(p.name || p.id) }));
        },

        /** The page the list shows, else the one on screen, else the first. */
        widgetWizardDefaultPage() {
            if (typeof this._widgetPageId === 'number') return this._widgetPageId;
            const pages = this.widgetWizardPages();
            const current = this.dash.currentPageId ?? pages[0]?.id;
            return Number(current);
        },

        /*
         * The page choice, drawn only when there is one to make. On the
         * all-pages view the list's own page means nothing, so the select
         * starts on the page being looked at.
         */
        widgetWizardPageSelect() {
            const pages = this.widgetWizardPages();
            if (pages.length < 2) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            // A choice already made survives the preview being redrawn for
            // another kind; it is forgotten when the picker opens afresh.
            const remembered = pages.some((p) => p.id === this._widgetWizardPageId)
                ? this._widgetWizardPageId : null;
            const chosen = remembered ?? (this.isAllPagesView()
                ? Number(this.dash.currentPageId ?? pages[0].id)
                : this.widgetWizardDefaultPage());
            return `<label class="config-widget-wizard-page">
                <span>${esc(this.t('config.widgetsAddOnPage', 'On page'))}</span>
                <select class="config-select" data-widget-wizard-page>${pages.map((p) =>
                    `<option value="${esc(p.id)}"${p.id === chosen ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
            </label>`;
        },

        /*
         * The connect screen: a media kind asks where it runs and for its key
         * before it is added, and can try them first.
         *
         * It replaces the picker inside the same modal, so Escape and Close
         * leave it the way they leave the picker -- and the picker's onHide
         * forgets what was typed. The key lives in this object and in the
         * password box's value, never in markup: the screen is drawn once and
         * only its result line and buttons change afterwards.
         */
        openWidgetWizardConnect(type, pageId) {
            const service = global.DashboardConfig.MEDIA_SERVICES?.[type];
            const text = document.getElementById('modal-text');
            if (!service || !text) return;
            this._widgetWizard = {
                type, pageId: pageId ?? null, screen: 'connect',
                server: '', user: '', secret: '', test: null, busy: false, round: 0,
            };
            text.innerHTML = this.renderWidgetWizardConnect();
            const screen = text.querySelector('[data-widget-wizard-screen="connect"]');
            if (!screen) return;

            screen.addEventListener('input', (event) => {
                const w = this._widgetWizard;
                const box = event.target;
                if (!w || !box?.matches) return;
                if (box.matches('[data-widget-wizard-server]')) w.server = box.value;
                else if (box.matches('[data-widget-wizard-user]')) w.user = box.value;
                else if (box.matches('[data-widget-wizard-secret]')) w.secret = box.value;
                else return;
                // What was tested is no longer what is on screen, and an answer
                // still on its way is about the old text.
                w.test = null;
                w.round += 1;
                this.syncWidgetWizardConnect();
            });
            screen.addEventListener('change', (event) => {
                const select = event.target?.closest?.('[data-widget-wizard-page]');
                if (!select || !this._widgetWizard) return;
                this._widgetWizardPageId = Number(select.value);
                this._widgetWizard.pageId = Number(select.value);
            });
            screen.addEventListener('click', (event) => {
                const w = this._widgetWizard;
                if (!w) return;
                if (event.target?.closest?.('[data-widget-wizard-back]')) {
                    this.openWidgetCatalogue({ focusType: w.type, pageId: w.pageId, again: true });
                } else if (event.target?.closest?.('[data-widget-wizard-test]')) {
                    void this.runWidgetWizardTest();
                } else if (event.target?.closest?.('[data-widget-wizard-finish]')) {
                    void this.finishWidgetWizard();
                }
            });
            this.syncWidgetWizardConnect();
            screen.querySelector('[data-widget-wizard-server]')?.focus({ preventScroll: true });
        },

        /** How a service signs in when nothing has been chosen: qBittorrent's first mode. */
        widgetWizardAuth(service) {
            return this.mediaAuthShape(service, null);
        },

        renderWidgetWizardConnect() {
            const w = this._widgetWizard;
            const service = global.DashboardConfig.MEDIA_SERVICES?.[w?.type];
            if (!service) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            const session = this.widgetWizardAuth(service).kind === 'session';
            const user = session ? `
                <div class="config-widget-field">
                    <label for="widget-wizard-user">${esc(this.mediaWord(service, 'user'))}</label>
                    <input type="text" id="widget-wizard-user" class="config-text" autocomplete="off"
                        spellcheck="false" maxlength="200" data-widget-wizard-user>
                </div>` : '';
            return `
            <div class="config-widget-wizard" data-widget-wizard-screen="connect" data-type="${esc(w.type)}">
                <div class="config-widget-picker-head">
                    <div class="config-widget-picker-title">
                        <h3 class="config-widget-picker-name">${esc(service.name)}</h3>
                        ${service.hint ? `<span class="config-widget-note">${esc(this.t(service.hint[0], service.hint[1]))}</span>` : ''}
                    </div>
                </div>
                <div class="config-custom-grid">
                    <div class="config-widget-field">
                        <label for="widget-wizard-server">${esc(this.mediaWord(service, 'server'))}</label>
                        <input type="text" id="widget-wizard-server" class="config-text" maxlength="2000"
                            autocomplete="off" spellcheck="false" data-widget-wizard-server
                            placeholder="${esc(service.placeholder || '')}">
                    </div>
                    ${user}
                    <div class="config-widget-field">
                        <label for="widget-wizard-secret">${esc(this.mediaWord(service, session ? 'password' : 'key'))}</label>
                        <input type="password" id="widget-wizard-secret" class="config-text" autocomplete="off"
                            spellcheck="false" maxlength="1024" data-widget-wizard-secret
                            ${session ? '' : `aria-describedby="widget-wizard-secret-where"`}>
                        ${session ? '' : `<span class="config-widget-note" id="widget-wizard-secret-where">${
                            esc(this.mediaWord(service, 'keyWhere'))}</span>`}
                    </div>
                </div>
                <p class="config-widget-note is-error" data-widget-wizard-problem role="alert" hidden></p>
                <p class="config-widget-note" data-widget-wizard-result role="status"></p>
                <div class="config-widget-picker-add">
                    ${this.widgetWizardPageSelect()}
                    <button type="button" class="config-btn" data-widget-wizard-back>${
                        esc(this.t('config.widgetWizardBack', 'Back'))}</button>
                    <button type="button" class="config-btn" data-widget-wizard-test>${
                        esc(this.t('config.widgetWizardTest', 'Test'))}</button>
                    <button type="button" class="config-btn config-btn--primary" data-widget-wizard-finish></button>
                </div>
            </div>`;
        },

        /*
         * What is wrong with the fields as typed, said before anything is sent:
         * an address without its scheme is not one the server will try, and a
         * password without its username is a sign-in Save would refuse.
         */
        widgetWizardProblem() {
            const w = this._widgetWizard;
            const service = global.DashboardConfig.MEDIA_SERVICES?.[w?.type];
            if (!w || !service) return { scheme: false, user: false };
            const server = w.server.trim();
            const session = this.widgetWizardAuth(service).kind === 'session';
            return {
                scheme: Boolean(server) && !/^https?:\/\//i.test(server),
                user: session && Boolean(w.secret.trim()) && !w.user.trim(),
            };
        },

        /** The parts of the screen that follow the state: the result line and the buttons. */
        syncWidgetWizardConnect() {
            const w = this._widgetWizard;
            const screen = document.querySelector('#modal-text [data-widget-wizard-screen="connect"]');
            const service = global.DashboardConfig.MEDIA_SERVICES?.[w?.type];
            if (!w || !screen || !service) return;
            const result = screen.querySelector('[data-widget-wizard-result]');
            const problemLine = screen.querySelector('[data-widget-wizard-problem]');
            const problem = this.widgetWizardProblem();
            if (problemLine) {
                const said = [
                    problem.scheme ? this.t('config.widgetWizardNeedsScheme', 'Start the address with http:// or https://') : '',
                    problem.user ? this.t('config.widgetWizardNeedsUser', 'Fill in the username as well') : '',
                ].filter(Boolean).join(' ');
                problemLine.textContent = said;
                problemLine.hidden = !said;
            }
            const test = screen.querySelector('[data-widget-wizard-test]');
            const finish = screen.querySelector('[data-widget-wizard-finish]');
            let said = '';
            if (w.busy && !w.test) said = this.mediaWord(service, 'connecting');
            else if (w.test?.ok) {
                said = this.mediaWord(service, 'connected', w.test.answer?.serverName || service.name)
                    .replace('{version}', w.test.answer?.version || w.test.answer?.connected || '');
            } else if (w.test) said = this.mediaWord(service, w.test.code);
            if (result) {
                result.textContent = said;
                result.classList.toggle('is-error', Boolean(w.test && !w.test.ok));
            }
            if (test) test.disabled = w.busy || !w.server.trim() || problem.scheme || problem.user;
            if (finish) {
                finish.disabled = w.busy || problem.user;
                finish.textContent = w.test?.ok ? this.t('config.widgetWizardAdd', 'Add widget')
                    : w.test ? this.t('config.widgetWizardAddAnyway', 'Add anyway')
                        : this.t('config.widgetWizardAddUntested', 'Add without testing');
            }
        },

        /** The key as it would be filed: a service mends a careless copy (Seerr's "=="). */
        widgetWizardSecret(service, auth) {
            const secret = String(this._widgetWizard?.secret || '').trim();
            return typeof service.normalizeKey === 'function' && secret ? service.normalizeKey(secret, auth) : secret;
        },

        async runWidgetWizardTest() {
            const w = this._widgetWizard;
            const service = global.DashboardConfig.MEDIA_SERVICES?.[w?.type];
            if (!w || !service || w.busy || !w.server.trim()) return;
            const problem = this.widgetWizardProblem();
            if (problem.scheme || problem.user) return;
            const round = w.round;
            const shape = this.widgetWizardAuth(service);
            const auth = { ...shape, basicUser: w.user, secret: this.widgetWizardSecret(service, shape) };
            const payload = this.mediaSetupPayload(service, w.server.trim(), auth, '');
            w.busy = true;
            w.test = null;
            this.syncWidgetWizardConnect();
            let answer;
            try {
                const res = await this.writeFetch(`/api/widgets/${service.setup || service.id}/setup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                answer = res.ok ? await res.json() : { error: 'unreachable' };
            } catch (_error) {
                answer = { error: 'unreachable' };
            }
            // Closed, or gone Back, while it was asking: nothing to tell.
            if (this._widgetWizard !== w) return;
            w.busy = false;
            // Typed over while it was asking: the answer is about other text.
            if (w.round !== round) {
                this.syncWidgetWizardConnect();
                return;
            }
            w.test = answer && !answer.error
                ? { ok: true, answer }
                : { ok: false, code: String(answer?.error || 'unreachable') };
            this.syncWidgetWizardConnect();
        },

        /*
         * Add it, then file what was typed through the same draft and Save the
         * settings panel uses -- the key goes to the credential store, the
         * widget names it, and neither path is written twice.
         */
        async finishWidgetWizard() {
            const w = this._widgetWizard;
            const service = global.DashboardConfig.MEDIA_SERVICES?.[w?.type];
            if (!w || !service || w.busy || this.widgetWizardProblem().user) return;
            w.busy = true;
            const shape = this.widgetWizardAuth(service);
            const server = w.server.trim();
            const user = w.user.trim();
            const secret = this.widgetWizardSecret(service, shape);
            const { type, pageId } = w;
            this._widgetWizard = null;
            window.AppModal?.hide();

            const added = await this.addWidget(type, pageId != null ? { pageId } : undefined);
            if (!added || (!server && !secret)) return;
            const index = this.lastWidgetIndex();
            const draft = this.widgetDraft(index);
            if (!draft || this._widgetBlocks[index]?.type !== type) return;
            if (server) draft.config.server = server;
            // A password without its username never gets here: the screen
            // asks for it and keeps Add off until it is given or cleared.
            if (secret) {
                this.ensureMediaAuth(index, service);
                draft.auth.secret = secret;
                if (shape.kind === 'session') draft.auth.basicUser = user;
            } else {
                draft.auth = { kind: 'none' };
            }
            await this.saveWidgetDraft(index);
        },
    });

    global.DashboardConfigWidgetWizardReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
