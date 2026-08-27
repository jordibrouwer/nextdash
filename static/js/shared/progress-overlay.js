/**
 * The blocking "nextDash is working" overlay.
 *
 * Config grew this for source imports; the health view needs the same thing when
 * it saves a page to disk, which takes seconds and otherwise looks like the app
 * has frozen. Written once here rather than copied, because two overlays that
 * are almost the same is how two surfaces drift apart.
 *
 * It reuses the favicon prefetch's classes, which is where the look came from --
 * see the note in favicon-prefetch.css about the second, service-neutral
 * selector each rule carries.
 */
(function () {
    'use strict';

    const OVERLAY_ID = 'nextdash-progress-overlay';

    function ensureOverlay() {
        let overlay = document.getElementById(OVERLAY_ID);
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.className = 'progress-overlay';
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-live', 'polite');
        overlay.innerHTML = `
            <div class="progress-overlay-panel">
                <p class="progress-overlay-title" data-progress-title></p>
                <div class="progress-overlay-track" role="progressbar" aria-valuemin="0" aria-valuemax="100">
                    <div class="progress-overlay-fill progress-overlay-fill--indeterminate" data-progress-fill></div>
                </div>
                <p class="progress-overlay-status" data-progress-status></p>
            </div>`;
        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * Show it, indeterminate.
     *
     * Indeterminate because the work behind it is a single request whose length
     * nobody knows -- a page with fifty images takes as long as it takes. A bar
     * sitting at zero until it jumps to a hundred reads as frozen, which is the
     * problem this is here to solve rather than restate.
     */
    function show(title, status) {
        const overlay = ensureOverlay();
        const fill = overlay.querySelector('[data-progress-fill]');
        if (fill) {
            // Reset: the element is reused, so a second run must not open
            // already showing the first one's finished state.
            fill.classList.add('progress-overlay-fill--indeterminate');
            fill.style.removeProperty('width');
        }
        // An indeterminate bar has no value, and announcing zero would be read
        // aloud as no progress rather than as unknown progress.
        overlay.querySelector('[role="progressbar"]')?.removeAttribute('aria-valuenow');
        overlay.querySelector('[data-progress-title]').textContent = title || '';
        overlay.querySelector('[data-progress-status]').textContent = status || '';
        overlay.hidden = false;
        return overlay;
    }

    /*
     * Move the bar to a known position.
     *
     * For work whose size is known up front -- a collection walked in batches --
     * where an indeterminate sweep would be throwing away a number the caller
     * already has. "120 of 500" is the difference between waiting and knowing
     * how long you are waiting.
     */
    function update(done, total, status) {
        const overlay = document.getElementById(OVERLAY_ID);
        if (!overlay || overlay.hidden) return;
        const fill = overlay.querySelector('[data-progress-fill]');
        const bar = overlay.querySelector('[role="progressbar"]');
        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        if (fill) {
            fill.classList.remove('progress-overlay-fill--indeterminate');
            fill.style.width = `${pct}%`;
        }
        if (bar) {
            bar.setAttribute('aria-valuenow', String(pct));
            bar.setAttribute('aria-valuetext', `${pct}%`);
        }
        if (status !== undefined) {
            overlay.querySelector('[data-progress-status]').textContent = status;
        }
    }

    /** Fill the bar, say what happened, and go. */
    function finish(status) {
        const overlay = document.getElementById(OVERLAY_ID);
        if (!overlay || overlay.hidden) return;
        const fill = overlay.querySelector('[data-progress-fill]');
        if (fill) {
            fill.classList.remove('progress-overlay-fill--indeterminate');
            fill.style.width = '100%';
        }
        overlay.querySelector('[role="progressbar"]')?.setAttribute('aria-valuenow', '100');
        if (status) overlay.querySelector('[data-progress-status]').textContent = status;
        setTimeout(() => { overlay.hidden = true; }, 600);
    }

    function hide() {
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) overlay.hidden = true;
    }

    window.ProgressOverlay = { show, update, finish, hide };
})();
