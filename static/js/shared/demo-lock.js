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

    /**
     * The demo's own events (umami-analytics.js adds mode: 'demo' to each).
     * Always a name from a closed list or a route with its ids taken out --
     * nothing a visitor typed.
     */
    function track(name, props) {
        try { global.nextdashTrack?.(name, props); } catch { /* counting must never break the demo */ }
    }

    /** A refused request as its route: `/api/sources/{id}/run` -> `/api/sources/:id/run`. */
    function routeName(input) {
        try {
            const raw = typeof input === 'string' ? input : (input?.url || String(input));
            const path = new URL(raw, global.location.href).pathname;
            // `/api/<area>/...`: whatever follows the area (an id, a name) is one `:id`.
            const parts = path.split('/');
            return (parts.length > 3 ? [...parts.slice(0, 3), ':id'] : parts).join('/').slice(0, 80);
        } catch {
            return 'unknown';
        }
    }

    /**
     * What a visitor's own notice says, if this demo is being counted: the
     * tracker the server wrote for the demo's website is on the page. A demo
     * nobody counts says nothing about it.
     */
    const counting = !!document.querySelector('script[data-nextdash-analytics][data-mode="demo"]');

    /**
     * The explanation for one kind of lock. The default is the checks (the demo
     * visits no website); `privacy` is Config → Behavior → Privacy & sync, which
     * is locked as a whole.
     */
    function text(kind) {
        if (kind === 'privacy') {
            return t('privacyLocked',
                'These settings stay as they are in the demo. In your own install they are yours to change.');
        }
        return t('checksLocked',
            'The demo checks no website. Anyone could otherwise make this server knock on any address, again and again. In your own install these settings are yours to change.');
    }

    const popoverId = (kind) => (kind === 'privacy' ? `${POPOVER_ID}-privacy` : POPOVER_ID);

    /** The shared popover of a kind, made the first time it is asked for. */
    function popover(kind) {
        let el = document.getElementById(popoverId(kind));
        if (el) return el;
        el = document.createElement('div');
        el.id = popoverId(kind);
        el.className = 'demo-lock-popover';
        el.setAttribute('popover', '');
        el.innerHTML = `<p class="demo-lock-popover-title">${esc(t('lockedTitle', 'Locked in the demo'))}</p>
            <p class="demo-lock-popover-text">${esc(text(kind))}</p>`;
        document.body.appendChild(el);
        return el;
    }

    /** Show the explanation. `action` names what was refused, for the demo's count. */
    function explain(action) {
        track('demo:refused', { action: String(action || 'locked').slice(0, 80) });
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
    function chip(kind) {
        popover(kind);
        return `<button type="button" class="demo-lock-chip" popovertarget="${popoverId(kind)}"
            title="${esc(text(kind))}">${esc(t('lockedChip', 'Locked in the demo'))}</button>`;
    }

    if (on) {
        document.documentElement.dataset.demo = '1';
        // The chip beside a locked panel opens the explanation by itself (popovertarget).
        document.addEventListener('click', (event) => {
            if (event.target?.closest?.('.demo-lock-chip')) track('demo:refused', { action: 'locked-panel' });
        }, true);
        // Install and Community Apps: the links a visitor leaves the demo by.
        const cta = (event) => {
            // A middle click only: the other buttons do not open the link.
            if (event.type === 'auxclick' && event.button !== 1) return;
            const link = event.target?.closest?.('.demo-bar-install, .demo-unraid-note-link');
            if (!link) return;
            track('demo:cta', { target: link.classList.contains('demo-bar-install') ? 'install' : 'unraid-ca' });
        };
        document.addEventListener('click', cta, true);
        document.addEventListener('auxclick', cta, true);
        // The explanation belongs to the view it was opened from.
        global.addEventListener('hashchange', () => {
            [POPOVER_ID, `${POPOVER_ID}-privacy`].forEach((id) => {
                const el = document.getElementById(id);
                try { if (el?.matches(':popover-open')) el.hidePopover(); } catch { /* not open */ }
            });
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
            explain('check-mode');
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

    /** What the demo records, in the words a visitor can read. Config → Privacy says the same. */
    function analyticsNotice() {
        return t('analyticsNotice',
            'This demo records visits anonymously, including clicks and screen replays, to improve nextDash. Replays show what is on screen; only what you type into form fields is masked.');
    }

    /** Config → Privacy in the demo: the separate count, then the notice. */
    function privacyNote() {
        if (!on || !counting) return '';
        return `${t('privacyNote',
            'This demo counts visits anonymously in a separate count. Your own install only counts when you turn it on.')} ${analyticsNotice()}`;
    }

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
                <a class="demo-bar-install" href="${INSTALL_URL}" target="_blank" rel="noopener">${esc(t('barInstall', 'Install'))}<span class="demo-bar-install-name"> nextDash</span> →</a>
                ${counting ? `<span class="demo-bar-notice">${esc(analyticsNotice())}</span>` : ''}`;
            document.body.prepend(bar);
        }
        const reset = bar.querySelector('[data-demo-reset]');
        if (reset) reset.textContent = resetText();
    }

    async function refreshResetAt() {
        // A hidden tab neither polls nor reloads; it catches up when it is shown.
        if (document.visibilityState === 'hidden') return;
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
                        track('demo:refused', { action: routeName(args[0]) });
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
                    track('demo:reset-seen');
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

    global.DemoLock = { on, explain, chip, text, unraidNote, privacyNote, track };
})(window);
