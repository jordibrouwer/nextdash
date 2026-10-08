/**
 * What the public demo keeps out of reach, and the one explanation for it.
 *
 * The demo checks no website: availability checks, monitoring and feed
 * polling would let any visitor make the server knock on any address, over
 * and over. The settings stay on screen, so a visitor sees what nextDash can
 * do, but they cannot be changed. The server refuses them as well (demo.go);
 * this is only what the visitor sees.
 *
 * DemoLock.on is read from a meta tag the server writes in demo mode, so
 * nothing changes outside the demo.
 */
(function (global) {
    'use strict';

    const on = !!document.querySelector('meta[name="nextdash-demo"]');
    const POPOVER_ID = 'demo-lock-popover';
    // The availability radio groups: the add form and Config's editor share one
    // markup, the dashboard's inline form has its own.
    const CHECK_MODE_INPUTS = '.bookmark-detail-checkmode-input, .bookmark-inline-checkmode-input';

    function t(key, fallback) {
        const lang = global.dashboardInstance?.language;
        const full = `demo.${key}`;
        const value = lang?.t?.(full);
        return value && value !== full ? value : fallback;
    }

    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function text() {
        return t('checksLocked',
            'The demo checks no website. Anyone could otherwise make this server knock on any address, again and again. In your own install these settings are yours to change.');
    }

    /** The shared popover, made the first time it is asked for. */
    function popover() {
        let el = document.getElementById(POPOVER_ID);
        if (el) return el;
        el = document.createElement('div');
        el.id = POPOVER_ID;
        el.className = 'demo-lock-popover';
        el.setAttribute('popover', '');
        el.innerHTML = `<p class="demo-lock-popover-title">${esc(t('lockedTitle', 'Locked in the demo'))}</p>
            <p class="demo-lock-popover-text">${esc(text())}</p>`;
        document.body.appendChild(el);
        return el;
    }

    /** Show the explanation. */
    function explain() {
        const el = popover();
        try {
            if (typeof el.showPopover === 'function') {
                if (!el.matches(':popover-open')) el.showPopover();
                return;
            }
        } catch { /* fall through to the modal */ }
        global.AppModal?.alert?.({
            title: t('lockedTitle', 'Locked in the demo'),
            htmlMessage: esc(text()),
            confirmText: t('gotIt', 'Got it'),
        });
    }

    /** The chip beside a locked panel's title; a click opens the explanation. */
    function chip() {
        popover();
        return `<button type="button" class="demo-lock-chip" popovertarget="${POPOVER_ID}"
            title="${esc(text())}">${esc(t('lockedChip', 'Locked in the demo'))}</button>`;
    }

    if (on) {
        document.documentElement.dataset.demo = '1';
        // The explanation belongs to the view it was opened from.
        global.addEventListener('hashchange', () => {
            const el = document.getElementById(POPOVER_ID);
            try { if (el?.matches(':popover-open')) el.hidePopover(); } catch { /* not open */ }
        });
        /*
         * The availability check in the add and edit forms: choosing Periodic
         * or Monitor goes back to Off, with the reason. One listener for every
         * form that draws the shared radio group.
         */
        document.addEventListener('change', (event) => {
            const input = event.target;
            if (!input?.matches?.(CHECK_MODE_INPUTS) || input.value === 'off') return;
            // The form never hears of Periodic: it hears Off instead.
            event.stopImmediatePropagation();
            const off = document.querySelector(`input[name="${CSS.escape(input.name)}"][value="off"]`);
            if (off) {
                off.checked = true;
                off.dispatchEvent(new Event('change', { bubbles: true }));
            }
            explain();
        }, true);
    }

    /*
     * The demo bar: a filled strip above the header, always there and not to
     * be closed. It says the demo is shared and when it resets, counted down
     * from /api/demo, and links to the install page. When the server has
     * reset, the page reloads itself and says so once it is back.
     */
    const INSTALL_URL = 'https://nextdash.cc/install/';
    // Where an Unraid user finds nextDash: the Community Apps site, searched.
    const UNRAID_CA_URL = 'https://unraid.net/community/apps?q=nextdash';
    const RESET_NOTE_KEY = 'nextdash:demo-was-reset';
    let resetAt = 0;
    let lastReset = 0;
    let soonTimer = null;

    function resetText() {
        const left = resetAt - Date.now();
        if (!resetAt) return '';
        if (left <= 0) return t('barResetting', 'Resetting…');
        const minutes = Math.ceil(left / 60000);
        return minutes <= 1
            ? t('barResetsSoon', 'Resets in under a minute')
            : t('barResetsIn', 'Resets in {n} min').replace('{n}', String(minutes));
    }

    function renderBar() {
        let bar = document.getElementById('demo-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'demo-bar';
            bar.className = 'demo-bar';
            bar.setAttribute('role', 'note');
            bar.innerHTML = `<span class="demo-bar-label">${esc(t('barLabel', 'Demo'))}</span>
                <span class="demo-bar-text"><span data-demo-reset></span><span class="demo-bar-shared"> · ${esc(t('barShared', 'what you change is shared with other visitors until then'))}</span></span>
                <a class="demo-bar-install" href="${INSTALL_URL}" target="_blank" rel="noopener">${esc(t('barInstall', 'Install'))}<span class="demo-bar-install-name"> nextDash</span> →</a>`;
            document.body.prepend(bar);
        }
        const reset = bar.querySelector('[data-demo-reset]');
        if (reset) reset.textContent = resetText();
    }

    async function refreshResetAt() {
        try {
            const res = await fetch('/api/demo', { cache: 'no-store' });
            const data = await res.json();
            if (data?.demo) {
                resetAt = Number(data.resetAt) || 0;
                const reset = Number(data.lastReset) || 0;
                /*
                 * The server reset since this page loaded: start again from the
                 * fresh data. A reload rather than a refresh of the views, so
                 * nothing the visitor had open is left showing the old state.
                 */
                if (lastReset && reset && reset !== lastReset) {
                    try { sessionStorage.setItem(RESET_NOTE_KEY, '1'); } catch { /* the note is optional */ }
                    global.location.reload();
                    return;
                }
                lastReset = reset || lastReset;
            }
        } catch { /* the bar keeps its last answer */ }
        renderBar();
        // Near the end of the countdown, ask every few seconds, so the reload
        // follows the reset rather than the next half-minute round.
        clearTimeout(soonTimer);
        if (resetAt && resetAt - Date.now() < 20000) {
            soonTimer = setTimeout(() => void refreshResetAt(), 3000);
        }
    }

    /*
     * A refused action says why, as an ordinary notification: the demo's own
     * answers (403, 429, 503) carry a sentence meant for the visitor, and the
     * caller's own error toast would only say that something failed.
     */
    const DEMO_ANSWERS = [/not available in the demo/i, /demo holds no more/i, /the demo is shared/i, /demo is being reset/i];
    function watchDemoAnswers() {
        const original = global.fetch.bind(global);
        global.fetch = async (...args) => {
            const response = await original(...args);
            if ([403, 429, 503].includes(response.status)) {
                response.clone().text().then((body) => {
                    const message = String(body || '').trim();
                    if (message && DEMO_ANSWERS.some((re) => re.test(message))) {
                        global.dashboardInstance?.showNotification?.(message.slice(0, 160), 'warning', { duration: 5000 });
                    }
                }).catch(() => {});
            }
            return response;
        };
    }

    if (on) {
        watchDemoAnswers();
        const start = () => {
            try {
                if (sessionStorage.getItem(RESET_NOTE_KEY)) {
                    sessionStorage.removeItem(RESET_NOTE_KEY);
                    setTimeout(() => global.dashboardInstance?.showNotification?.(
                        t('wasReset', 'The demo was reset to its start'), 'info', { duration: 5000 }), 1500);
                }
            } catch { /* the note is optional */ }
            renderBar();
            void refreshResetAt();
            setInterval(renderBar, 15000);
            setInterval(() => void refreshResetAt(), 30000);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') void refreshResetAt();
            });
        };
        if (document.body) start();
        else document.addEventListener('DOMContentLoaded', start, { once: true });
    }

    /*
     * On top of Config → Unraid, where the demo's server "Tower" stands: the
     * place an Unraid user looks, told that nextDash is one search away in
     * Community Apps.
     */
    function unraidNote() {
        if (!on) return '';
        return `<div class="demo-unraid-note" role="note">
            <p class="demo-unraid-note-title">${esc(t('unraidTitle', 'On Unraid? nextDash is in Community Apps.'))}</p>
            <p class="demo-unraid-note-text">${esc(t('unraidText', 'Open the Apps tab on your server and search for "nextDash" to install it. The server below is the demo\'s own, answering from sample data.'))}</p>
            <a class="demo-unraid-note-link" href="${UNRAID_CA_URL}" target="_blank" rel="noopener">${esc(t('unraidLink', 'Open in Community Apps'))} →</a>
        </div>`;
    }

    global.DemoLock = { on, explain, chip, text, unraidNote };
})(window);
