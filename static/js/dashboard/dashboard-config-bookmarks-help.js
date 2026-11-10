/**
 * Help in the bookmark panel's Tests tab: a small info button beside a
 * heading or a field, and under it a card with a title and a few short
 * sentences.
 *
 * The button is the ℹ of Config (config-info-btn); the card follows the "+n"
 * popover of the list (net-list-pop): fixed under its anchor, closed by Escape
 * (focus goes back to the button), by a click outside and by tabbing away, and
 * it is not modal. One card at a time: opening another closes the first.
 *
 * The Tests tab draws itself again on every refresh, so the open card is kept
 * by its key: after a redraw it finds the new button with the same key, puts
 * its text right (the type card follows the type chosen in the form) and
 * moves under it. It goes when its button does (another tab, another row).
 *
 * Loaded before the tab and the form, which call bmHelpBtn().
 */
(function (global) {
    'use strict';
    if (typeof global.DashboardConfig !== 'function') return;

    const POP_ID = 'net-help-pop';
    const TYPE_KEYS = { tcp: 'TypeTcp', ping: 'TypePing', dns: 'TypeDns', tls: 'TypeTls', http: 'TypeHttp', json: 'TypeJson' };

    Object.assign(global.DashboardConfig.prototype, {
        /** The title and text of one help key; the type key follows the type being edited. */
        bmHelpContent(key, b) {
            const t = (k, f) => this.bmNetT(k, f);
            let name = key;
            if (key === 'type') {
                const draft = b ? this.bmNetState(b).editing?.draft : null;
                name = TYPE_KEYS[draft?.type] || 'TypeTcp';
            }
            switch (name) {
            case 'Tests': return { title: t('nettools.helpTestsTitle', 'What Tests does'), body: t('nettools.helpTestsBody', 'A check watches one thing about this bookmark on a schedule: reachability, DNS, the certificate, a response or a JSON value. It keeps a history and alerts you with the bookmark’s alert rules.\n**Run once** looks right now and saves nothing. Open this tab with [[4]].\n**Checks** counts the scheduled checks; **down** the ones failing now. **Up 24 h** is the average of their last 24 hours. Checks that are off or not measured are left out.') };
            case 'Status': return { title: t('nettools.helpStatusTitle', 'What the states mean'), body: t('nettools.helpStatusBody', '**Up**, **down**, **warning** (for example a certificate that expires soon) and **slow** (still up).\n**Via TCP**: ping fell back to TCP because ICMP is not allowed. **Not measured**: ping is off, ICMP or the host is blocked by the safety guard, or a custom host is turned off. That is not an outage, so nothing alerts.') };
            case 'Run': return { title: t('nettools.helpRunTitle', 'Run once'), body: t('nettools.helpRunBody', 'Runs one test now, from the nextDash server. Nothing is saved and nothing alerts.\nIt uses the same safety guard as scheduled checks and only reaches this bookmark’s host and the ports from its address or saved checks. Never a free host or a port scan, and it is rate-limited.\nWorth keeping? Choose **Save as scheduled check...** under the result.') };
            case 'TypeTcp': return { title: t('nettools.helpTypeTcpTitle', 'TCP'), body: t('nettools.helpTypeTcpBody', 'Opens a connection to a port and says whether it accepts. Without a port it uses the one in the bookmark address.\nA connect slower than **Slow from** is flagged slow but still counts as up.') };
            case 'TypePing': return { title: t('nettools.helpTypePingTitle', 'Ping'), body: t('nettools.helpTypePingBody', 'Sends ICMP echo requests and reports the time and the loss. In Docker, ICMP is often not allowed; the check then falls back to TCP and shows **via TCP**.\nTo allow ICMP set `net.ipv4.ping_group_range` on the container (on the host with host networking), or run as root with NET_RAW.') };
            case 'TypeDns': return { title: t('nettools.helpTypeDnsTitle', 'DNS'), body: t('nettools.helpTypeDnsBody', 'Looks up a record type, with the system resolver, 1.1.1.1 or 8.8.8.8, and can require an expected value. The DNSSEC chip is information only.\nWith **When the records change** a change in the set of records shows in the bell, and you accept it to set a new baseline. It starts off for A and AAAA, because CDNs rotate addresses.') };
            case 'TypeTls': return { title: t('nettools.helpTypeTlsTitle', 'TLS'), body: t('nettools.helpTypeTlsBody', 'Reads the certificate the server presents and shows its chain.\nIt warns when the certificate has the chosen number of days left or fewer, and sends one expiry notice. STARTTLS ports are not supported.') };
            case 'TypeHttp': return { title: t('nettools.helpTypeHttpTitle', 'HTTP detail'), body: t('nettools.helpTypeHttpBody', 'Makes a GET and shows the timings and the redirect chain. It can expect a status (a list works) and a header.\nA response slower than **Slow from** is still up, only flagged. A credential is sent only to this bookmark’s own address.') };
            case 'TypeJson': return { title: t('nettools.helpTypeJsonTitle', 'JSON'), body: t('nettools.helpTypeJsonBody', 'Reads one value from a JSON answer. The path uses dots for objects, [0] for a list position, [name=api] to pick an entry and a trailing # to count.\nUp when the value is eq, ne, gt, lt, contains or exists. Values under a path that looks secret are hidden; with a credential, strings show only their length.') };
            case 'Alerts': return { title: t('nettools.helpAlertsTitle', 'Alerts'), body: t('nettools.helpAlertsBody', '**Alerts on** uses the bookmark’s retries, quiet hours and maintenance windows. **Muted** still records the history but sends no alerts.\nTo stop checking altogether, set Planning to Off.') };
            case 'Planning': return { title: t('nettools.helpPlanningTitle', 'Planning'), body: t('nettools.helpPlanningBody', '**Like the bookmark** runs this check on the bookmark’s own interval. Choose an interval to give it one of its own (the shortest is 5 minutes), or **Off** to keep the check without running it.') };
            case 'Timeout': return { title: t('nettools.helpTimeoutTitle', 'Time-out'), body: t('nettools.helpTimeoutBody', 'How long the check waits for an answer before it counts as failed. The default suits most checks; a shorter time-out fails faster.') };
            case 'Slow': return { title: t('nettools.helpSlowTitle', 'Slow from'), body: t('nettools.helpSlowBody', 'If the answer takes longer than this, the check is flagged slow. It is still up, so nothing is sent as down. Empty turns the flag off.') };
            default: return null;
            }
        },

        /** The ℹ button for one key. Its card opens on a click, Enter or Space. */
        bmHelpBtn(key) {
            const esc = (v) => this.dash.escapeHtml(v);
            const label = this.bmNetT('nettools.helpMore', 'More info');
            return `<button type="button" class="config-info-btn net-help-btn" data-net-help="${esc(key)}" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(label)}" title="${esc(label)}">ℹ</button>`;
        },

        /** Escaped text with a little markup: **bold**, `code`, [[key]] for a keyboard chip; one line per paragraph. */
        bmHelpHtml(text) {
            const esc = (v) => this.dash.escapeHtml(v);
            return String(text || '').split('\n').filter(Boolean).map((line) => {
                const html = esc(line)
                    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
                    .replace(/`([^`]+)`/g, '<code>$1</code>')
                    .replace(/\[\[([^\]]+)\]\]/g, '<kbd>$1</kbd>');
                return `<p>${html}</p>`;
            }).join('');
        },

        /** Fill the card (title and text) for the key it stands for. */
        bmHelpFill(state) {
            const content = this.bmHelpContent(state.key, state.b);
            if (!content) return false;
            const esc = (v) => this.dash.escapeHtml(v);
            state.pop.innerHTML = `<b class="net-help-title" id="${POP_ID}-title">${esc(content.title)}</b>${this.bmHelpHtml(content.body)}`;
            return true;
        },

        /** Put the card under its button, inside the panel's width, with the arrow on the button. */
        bmHelpPlace() {
            const state = this._bmHelp;
            if (!state) return;
            const { pop, anchor } = state;
            const host = state.panel || anchor.closest('.lvs-drawer') || null;
            const bounds = host ? host.getBoundingClientRect() : { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
            const a = anchor.getBoundingClientRect();
            // A button scrolled out of the panel takes the card with it, and gives it back.
            pop.style.visibility = a.bottom < bounds.top || a.top > bounds.bottom ? 'hidden' : '';
            const width = Math.max(160, Math.min(352, bounds.right - bounds.left - 16));
            pop.style.width = `${Math.round(width)}px`;
            const centre = a.left + a.width / 2;
            const left = Math.max(bounds.left + 8, Math.min(centre - 24, bounds.right - width - 8));
            const height = pop.getBoundingClientRect().height;
            let top = a.bottom + 8;
            const up = top + height > window.innerHeight - 8 && a.top - height - 8 > 4;
            if (up) top = a.top - height - 8;
            pop.classList.toggle('is-up', up);
            pop.style.left = `${Math.round(left)}px`;
            pop.style.top = `${Math.round(top)}px`;
            pop.style.setProperty('--net-help-ax', `${Math.round(Math.max(14, Math.min(centre - left - 5, width - 24)))}px`);
        },

        /** The button's card is open. */
        bmHelpIsOpen(anchor) {
            return Boolean(this._bmHelp && this._bmHelp.anchor === anchor);
        },

        /** Close the card; with focus, the button gets it back (Escape). */
        bmHelpClose(focus = false) {
            const state = this._bmHelp;
            if (!state) return;
            this._bmHelp = null;
            state.off();
            state.anchor.setAttribute?.('aria-expanded', 'false');
            state.anchor.removeAttribute?.('aria-controls');
            state.pop.remove();
            if (focus && state.anchor.isConnected) state.anchor.focus({ preventScroll: true });
        },

        /** A click on a ℹ: opens its card, or closes it when it is the one already open. */
        bmHelpToggle(anchor, b) {
            const key = anchor.getAttribute('data-net-help');
            if (!key) return;
            if (this.bmHelpIsOpen(anchor)) {
                this.bmHelpClose();
                return;
            }
            this.bmHelpClose();
            const pop = document.createElement('div');
            pop.className = 'net-help-pop';
            pop.id = POP_ID;
            pop.setAttribute('role', 'dialog');
            pop.setAttribute('aria-labelledby', `${POP_ID}-title`);
            pop.tabIndex = -1;
            const panel = anchor.closest('#config-bm-panel') || this._libPanel || document.getElementById('config-bm-panel');
            const state = { key, b, anchor, pop, panel, focused: true, off: null };
            if (!this.bmHelpFill(state)) return;
            document.body.appendChild(pop);
            anchor.setAttribute('aria-expanded', 'true');
            anchor.setAttribute('aria-controls', POP_ID);
            this._bmHelp = state;

            // The field the button sits in is part of it: choosing a type there keeps the card open.
            const inside = (node) => Boolean(node && (pop.contains(node) || state.anchor.contains(node)
                || node.closest?.('[data-net-help]') === state.anchor
                || (state.anchor.closest('.config-bm-field') && state.anchor.closest('.config-bm-field').contains(node))));
            const onDown = (e) => {
                if (inside(e.target) || e.target.closest?.('[data-net-help]')) return;
                this.bmHelpClose();
            };
            const onFocus = (e) => {
                state.focused = e.target === state.anchor;
                if (!inside(e.target)) this.bmHelpClose();
            };
            const onKey = (e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.stopImmediatePropagation();
                this.bmHelpClose(true);
            };
            const onMove = () => this.bmHelpPlace();
            // After a redraw the old button is gone: find the new one, or go.
            const sync = () => {
                if (this._bmHelp !== state) return;
                let el = state.anchor;
                if (!el.isConnected) {
                    el = state.panel?.querySelector(`[data-net-help="${key}"]`) || null;
                    if (!el) {
                        this.bmHelpClose();
                        return;
                    }
                    state.anchor = el;
                    el.setAttribute('aria-expanded', 'true');
                    el.setAttribute('aria-controls', POP_ID);
                    if (state.focused) el.focus({ preventScroll: true });
                }
                if (el.closest('[hidden]')) {
                    this.bmHelpClose();
                    return;
                }
                if (!this.bmHelpFill(state)) {
                    this.bmHelpClose();
                    return;
                }
                this.bmHelpPlace();
            };
            const observer = new MutationObserver(sync);
            if (state.panel) observer.observe(state.panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
            document.addEventListener('pointerdown', onDown, true);
            document.addEventListener('focusin', onFocus, true);
            // On window: the list's and the page's own Escape handling listen on document and would take the key first.
            window.addEventListener('keydown', onKey, true);
            window.addEventListener('scroll', onMove, true);
            window.addEventListener('resize', onMove);
            state.off = () => {
                observer.disconnect();
                document.removeEventListener('pointerdown', onDown, true);
                document.removeEventListener('focusin', onFocus, true);
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('scroll', onMove, true);
                window.removeEventListener('resize', onMove);
            };
            this.bmHelpPlace();
        },

        /** The Tests pane's root is bound once per draw: one listener there serves every button in it. */
        bindBmHelp(root, b) {
            root.addEventListener('click', (event) => {
                const btn = event.target.closest('[data-net-help]');
                if (!btn || !root.contains(btn)) return;
                // A button in an accordion's head must not also fold the accordion; one in a label must not reach its field.
                event.preventDefault();
                event.stopPropagation();
                this.bmHelpToggle(btn, b);
            });
        },
    });

    global.DashboardConfigBookmarksHelpReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
