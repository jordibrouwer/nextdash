/**
 * The live channel: one server-sent-events stream (GET /api/live) that says
 * "health changed", so a monitor outage reaches the badge and the bell in
 * seconds instead of at the next poll.
 *
 * A second event, "docker", says a container changed state; it becomes the
 * DOM event livechannel:docker for whatever is open and shows containers.
 *
 * The event carries no data. The page answers with the requests it already
 * makes -- the health badge and the net-check rows -- so the bell and the badge
 * keep reading one source.
 *
 * The polls stay as a fallback. `connected` is true only while the stream is
 * open, and `livechannel:state` fires when it changes; the badge poll and the
 * bell tick read both, slowing down while connected and returning to their
 * normal pace when the stream drops.
 *
 * The stream is open only while the tab is visible: a hidden tab neither needs
 * a ping (dashboard.js refreshes the badge on return) nor should hold one of the
 * browser's few connections per origin. A refusal (503 at the cap, 404 in the
 * demo) gets one retry after five minutes; a second refusal closes the stream
 * for good this page load.
 *
 * `hello` refreshes only when it follows a drop while the tab was visible. On
 * page load and on returning to the tab the dashboard and the bell already
 * refresh, and doing it here too fetched everything twice.
 */
(function initLiveChannel(global) {
    'use strict';

    const URL = '/api/live';
    const DEBOUNCE_MS = 750;
    const RETRY_AFTER_REFUSAL_MS = 5 * 60 * 1000;

    let source = null;
    let connected = false;
    let debounce = null;
    let dockerDebounce = null;
    let retryTimer = null;
    let refusals = 0;
    let catchUp = false;

    function setConnected(next) {
        if (connected === next) return;
        connected = next;
        global.dispatchEvent(new CustomEvent('livechannel:state', { detail: { connected } }));
    }

    function onHealth() {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            if (document.visibilityState !== 'visible') return;
            // The badge refresh also refreshes the bell's outage row.
            void global.dashboardInstance?.updateHealthBadge?.();
            void global.NetBellSource?.refresh?.();
            // Whatever else shows monitoring (the Service overview) listens.
            global.dispatchEvent(new CustomEvent('livechannel:health'));
        }, DEBOUNCE_MS);
    }

    /*
     * A container changed state. Nothing here refreshes by itself: whatever
     * shows containers and is open (the Service overview) listens. The health poll
     * and the 30 s polls stay as the fallback.
     */
    function onDocker() {
        clearTimeout(dockerDebounce);
        dockerDebounce = setTimeout(() => {
            if (document.visibilityState !== 'visible') return;
            global.dispatchEvent(new CustomEvent('livechannel:docker'));
        }, DEBOUNCE_MS);
    }

    function close() {
        // A close we chose is not a drop: the return to the tab refreshes anyway.
        catchUp = false;
        if (source) {
            source.close();
            source = null;
        }
        setConnected(false);
    }

    function open() {
        if (source || retryTimer || typeof global.EventSource !== 'function') return;
        if (document.visibilityState !== 'visible') return;
        const es = new global.EventSource(URL);
        source = es;
        es.addEventListener('hello', () => {
            refusals = 0;
            setConnected(true);
            // Something may have changed while the stream was down.
            if (catchUp) {
                catchUp = false;
                onHealth();
            }
        });
        es.addEventListener('health', onHealth);
        es.addEventListener('docker', onDocker);
        es.addEventListener('error', () => {
            setConnected(false);
            catchUp = true;
            // CLOSED means the browser gave up (a non-200 answer); anything else
            // it reconnects by itself, using the server's retry hint.
            if (es.readyState === global.EventSource.CLOSED) {
                source = null;
                refusals += 1;
                if (refusals > 1) return;
                retryTimer = setTimeout(() => { retryTimer = null; open(); }, RETRY_AFTER_REFUSAL_MS);
            }
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') open();
        else close();
    });

    global.LiveChannel = {
        get connected() { return connected; },
        open,
        close,
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', open);
    else open();
})(window);
