/**
 * The window that says the keyboard shortcuts were reworked.
 *
 * Over time every page had grown its own idea of what a key does, and the
 * result did not hold together. This release makes one set of rules for every
 * view (plain letters act on the row under the cursor, Shift opens views and
 * panels, the same search-mode keys everywhere), adds a key legend and a mode
 * strip to each view, and moves many keys. Someone whose fingers know the old
 * ones should not have to find that out by pressing them.
 *
 * Shown once, to installs that already existed; a fresh install has nothing to
 * unlearn and never sees it. It cannot be closed by Escape or a click beside
 * it: the reader ticks that they have read it, and "Continue" does the rest.
 * Only that counts as answered; a window that something else replaced comes
 * back later.
 *
 * English only, like the What's new window: it is a notice about a release.
 */
(function (global) {
    'use strict';

    const PROMO_ID = 'shortcuts-reworked-v1';
    const LOCAL_KEY = 'nextdash:shortcuts-changed-seen';
    const START_DELAY_MS = 3000;
    const RETRY_MS = 2500;
    const GIVE_UP_MS = 15 * 60 * 1000;

    let startedAt = 0;
    let timer = null;
    let open = false;

    function dash() {
        return global.dashboardInstance || null;
    }

    function seen() {
        try { if (global.localStorage?.getItem(LOCAL_KEY) === '1') return true; } catch { /* private mode */ }
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(PROMO_ID) === true;
    }

    function markSeen() {
        try { global.localStorage?.setItem(LOCAL_KEY, '1'); } catch { /* private mode */ }
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    const k = (text) => `<kbd>${text}</kbd>`;
    /** A block of keys, each with what it does: [key, label] pairs. */
    const keys = (list) => list.map(([key, label]) => `<span>${k(key)}<i>${label}</i></span>`).join('');

    function html() {
        return `
<div class="sc-changed" id="sc-changed-top" tabindex="-1">
  <p class="sc-changed-lead">A lot of nextDash's keyboard shortcuts are different in this release. Please read this before you carry on.</p>

  <h3>Why</h3>
  <p>Over time every page grew its own idea of what a key should do. The same key could mean one thing on the dashboard and another in the Inbox, Containers or Config, and many actions had no key at all. It never held together, and it could be confusing even if you use the keyboard all day.</p>

  <h3>What works the same everywhere now</h3>
  <div class="sc-rule">
    <p class="sc-rule-title">Plain letters act on the row under your cursor</p>
    <p class="sc-rule-note">Every action on a row has a letter, and the same action has the same letter on every page.</p>
    <div class="sc-keys">${keys([['e', 'edit'], ['m', 'move'], ['t', 'tags'], ['p', 'pin'], ['d', 'delete'], ['…', 'and more']])}</div>
  </div>
  <div class="sc-rule">
    <p class="sc-rule-title">Shift + a letter only opens a view or a panel</p>
    <div class="sc-keys">${keys([['Shift+B', 'bookmarks'], ['Shift+I', 'inbox'], ['Shift+C', 'containers'], ['Shift+T', 'tags'], ['Shift+P', 'pages'], ['Shift+E', 'edit mode']])}</div>
  </div>
  <div class="sc-rule">
    <p class="sc-rule-title">The search modes have fixed keys</p>
    <p class="sc-rule-note">In the tags mode you can join tags with AND and OR.</p>
    <div class="sc-keys">${keys([['&gt;', 'search'], [':', 'commands'], ['!', 'finders'], ['#', 'tags'], ['*', 'recent'], ['=', 'assistant'], ['?', 'cheat sheet']])}</div>
  </div>
  <div class="sc-rule">
    <p class="sc-rule-title">In every list, j and k move through the rows</p>
    <p class="sc-rule-note">In Config, Alt+↑/↓ steps between sections.</p>
    <div class="sc-keys">${keys([['j', 'next row'], ['k', 'previous row'], ['Alt+↑/↓', 'sections in Config']])}</div>
  </div>

  <h3>The key legend: what works on this page</h3>
  <p class="sc-rule-note sc-lead-note">Every view has a legend that lists the keys that work right there: the dashboard, the Bookmarks view, the Inbox, Containers, Tags and every Config page. On a list page it sits at the foot of the window; on the dashboard it rests under the grid. It starts short and fills in as you begin to move with the keyboard, most useful keys first. Config lets you place it above the list, below it, or switch it off for a view.</p>
  <div class="sc-keys">${keys([['Shift+H', 'hide / show the legend']])}</div>

  <h3>The mode strip: what your keys do right now</h3>
  <p class="sc-rule-note sc-lead-note">Beside the page name there is a small line that tells you which mode your keys are in. It steps aside when you use the mouse and comes back with your next key press.</p>
  <dl class="sc-modes">
    <dt>Search</dt><dd>Nothing is selected, so the letters you type search your bookmarks.</dd>
    <dt>Browse</dt><dd>You are in a list view such as the Inbox, Containers or Config.</dd>
    <dt>Cursor</dt><dd>You are on a row. It shows a few letters for that row, a different one now and then so you meet them all, and a dashed key you have not tried yet.</dd>
    <dt>Selected</dt><dd>You ticked several rows: you see what works on all of them.</dd>
    <dt>Edit mode</dt><dd>You can edit the dashboard in place. ${k('Shift+E')} ends it.</dd>
  </dl>
  <div class="sc-keys">${keys([['Shift+S', 'strip off / on, in every view at once']])}</div>
  <p class="sc-rule-note sc-after-keys">Config → Behavior → Keyboard has the same switch.</p>

  <p>I know this is annoying when your fingers already know the old keys, and I am sorry for that. I still believe it is the right choice: one set of rules is the only way to keep nextDash understandable, and to keep building on it. Some of the old Shift keys tell you where they went for a while.</p>

  <p>Press ${k('?')} at any time for the full cheat sheet.</p>

  <label class="sc-changed-ack">
    <input type="checkbox" id="sc-changed-ack">
    <span>I have read this and I understand that many shortcuts have changed.</span>
  </label>
  <div class="sc-more" hidden>
    <button type="button" class="sc-more-btn" aria-label="Scroll down: there is more to read" title="There is more to read">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M12 4v14M5.5 12.5 12 19l6.5-6.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </div>
</div>`;
    }

    /** Whether it is time: the page is calm and nothing else holds the window. */
    function ready() {
        const d = dash();
        if (!d?.settings || d.settings.onboardingCompleted !== true) return false;
        if (global.DemoLock?.on) return false;
        if (document.querySelector('.whats-new-modal')?.offsetParent) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        return Boolean(global.AppModal || d.modal);
    }

    function modal() {
        return global.AppModal || dash()?.modal || null;
    }

    function show() {
        const m = modal();
        if (!m || open) return;
        open = true;
        let confirmed = false;
        m.show({
            title: 'Your keyboard shortcuts have changed',
            htmlMessage: html(),
            confirmText: 'Continue',
            showCancel: false,
            mandatory: true,
            modalClass: 'shortcuts-changed-modal',
            modalMaxWidth: '40rem',
            initialFocusSelector: '#sc-changed-top',
            onConfirm: () => { confirmed = true; markSeen(); },
            onHide: () => {
                open = false;
                // Replaced by something else: not answered, so it comes back.
                if (!confirmed && !seen()) schedule(RETRY_MS);
            },
        });
        wireMore();
        const confirm = document.querySelector('#modal-actions .modal-button');
        const ack = document.getElementById('sc-changed-ack');
        if (confirm && ack) {
            confirm.disabled = true;
            confirm.setAttribute('aria-disabled', 'true');
            ack.addEventListener('change', () => {
                confirm.disabled = !ack.checked;
                confirm.setAttribute('aria-disabled', ack.checked ? 'false' : 'true');
            });
        }
    }

    /**
     * The arrow at the lower right says there is more to read: shown while the
     * text goes on below the window's edge, gone once the end is in view, and a
     * click carries the reader a screenful further.
     */
    function wireMore() {
        const top = document.getElementById('sc-changed-top');
        const scroller = top?.closest('.modal-text');
        const more = top?.querySelector('.sc-more');
        const button = more?.querySelector('.sc-more-btn');
        if (!scroller || !more || !button) return;
        const sync = () => {
            const left = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
            more.hidden = left <= 12;
        };
        scroller.addEventListener('scroll', sync, { passive: true });
        global.addEventListener('resize', sync);
        button.addEventListener('click', () => {
            const reduced = global.matchMedia?.('(prefers-reduced-motion: reduce)').matches
                || document.body.classList.contains('no-animations');
            scroller.scrollBy({ top: Math.round(scroller.clientHeight * 0.8), behavior: reduced ? 'auto' : 'smooth' });
        });
        // After layout: the text height is known only once the window is drawn.
        requestAnimationFrame(() => requestAnimationFrame(sync));
        setTimeout(sync, 300);
    }

    function tick() {
        timer = null;
        if (seen() || open) return;
        const d = dash();
        // A fresh install has nothing to unlearn: counted as answered, never shown.
        if (d?.settings?.firstRunInstall === true) { markSeen(); return; }
        if (Date.now() - startedAt > GIVE_UP_MS) return;
        if (!ready()) { schedule(RETRY_MS); return; }
        show();
    }

    function schedule(ms) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(tick, ms);
    }

    function start() {
        if (seen()) return;
        startedAt = Date.now();
        schedule(START_DELAY_MS);
    }

    global.ShortcutsChangedModal = {
        PROMO_ID,
        LOCAL_KEY,
        ask: () => { startedAt = Date.now(); schedule(0); },
        isOpen: () => open,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})(window);
