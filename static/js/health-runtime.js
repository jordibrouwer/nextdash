/**
 * Health page runtime: coalesced renders, action locking, timed fetches, safe state saves.
 */
(function (global) {
    const DEFAULT_FETCH_TIMEOUT_MS = 15000;
    const RENDER_BURST_LIMIT = 12;
    const RENDER_BURST_WINDOW_MS = 250;

    function createHealthRuntime(options) {
        const {
            getReport,
            setReport,
            fetchReport,
            onRender,
            onBusyChange,
            onStatus
        } = options;

        let loadReportInFlight = null;
        let renderDepth = 0;
        let renderScheduled = false;
        let renderBurst = 0;
        let renderBurstTimer = null;
        let pageFilterSyncing = false;
        let sortSelectSyncing = false;
        let pendingStateSave = false;
        let saveStateFn = null;
        let activeAction = null;

        function setSaveStateHandler(fn) {
            saveStateFn = typeof fn === 'function' ? fn : null;
        }

        function scheduleSaveState() {
            if (renderDepth > 0) {
                pendingStateSave = true;
                return;
            }
            saveStateFn?.();
        }

        function flushPendingStateSave() {
            if (!pendingStateSave) return;
            pendingStateSave = false;
            saveStateFn?.();
        }

        function beginSelectSync(kind) {
            if (kind === 'page') pageFilterSyncing = true;
            if (kind === 'sort') sortSelectSyncing = true;
        }

        function endSelectSync(kind) {
            global.setTimeout(() => {
                if (kind === 'page') pageFilterSyncing = false;
                if (kind === 'sort') sortSelectSyncing = false;
            }, 0);
        }

        function isSelectSyncing(kind) {
            if (kind === 'page') return pageFilterSyncing;
            if (kind === 'sort') return sortSelectSyncing;
            return pageFilterSyncing || sortSelectSyncing;
        }

        function setBusy(busy) {
            onBusyChange?.(busy);
        }

        function scheduleRender() {
            if (renderScheduled) return;
            renderScheduled = true;
            global.requestAnimationFrame(() => {
                renderScheduled = false;
                renderNow();
            });
        }

        function renderNow() {
            if (!getReport()) return;
            if (renderDepth > 0) return;
            if (activeAction) return;

            renderBurst += 1;
            if (renderBurst > RENDER_BURST_LIMIT) {
                console.warn('Health render burst limited; deferring');
                scheduleRender();
                return;
            }
            if (renderBurstTimer) global.clearTimeout(renderBurstTimer);
            renderBurstTimer = global.setTimeout(() => {
                renderBurst = 0;
                renderBurstTimer = null;
            }, RENDER_BURST_WINDOW_MS);

            renderDepth += 1;
            try {
                onRender();
            } catch (error) {
                console.error('Health render failed', error);
                onStatus?.('Health view update failed.');
            } finally {
                renderDepth -= 1;
                flushPendingStateSave();
            }
        }

        async function loadReport() {
            if (loadReportInFlight) {
                return loadReportInFlight;
            }
            loadReportInFlight = (async () => {
                try {
                    const report = await fetchReport();
                    setReport(report);
                } finally {
                    loadReportInFlight = null;
                }
            })();
            return loadReportInFlight;
        }

        async function reloadReport() {
            await loadReport();
            scheduleRender();
        }

        async function apiFetchTimed(apiFetch, url, init = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
            const controller = new AbortController();
            const timer = global.setTimeout(() => controller.abort(), timeoutMs);
            const initSignal = init.signal;
            let abortListener = null;
            if (initSignal) {
                if (initSignal.aborted) {
                    controller.abort();
                } else {
                    abortListener = () => controller.abort();
                    initSignal.addEventListener('abort', abortListener, { once: true });
                }
            }
            try {
                return await apiFetch(url, { ...init, signal: controller.signal });
            } finally {
                global.clearTimeout(timer);
                if (abortListener && initSignal) {
                    initSignal.removeEventListener('abort', abortListener);
                }
            }
        }

        async function runAction(actionId, fn, { busyMessage, statusOnBusy = true } = {}) {
            if (activeAction) {
                onStatus?.('Another health action is still running.');
                return { ok: false, reason: 'busy' };
            }
            activeAction = actionId;
            setBusy(true);
            if (statusOnBusy && busyMessage) {
                onStatus?.(busyMessage);
            }
            try {
                const result = await fn();
                return { ok: true, result };
            } catch (error) {
                return { ok: false, error };
            } finally {
                activeAction = null;
                setBusy(false);
            }
        }

        function isActionActive() {
            return Boolean(activeAction);
        }

        return {
            setSaveStateHandler,
            scheduleSaveState,
            beginSelectSync,
            endSelectSync,
            isSelectSyncing,
            scheduleRender,
            renderNow,
            loadReport,
            reloadReport,
            apiFetchTimed,
            runAction,
            isActionActive
        };
    }

    global.HealthRuntime = { create: createHealthRuntime, DEFAULT_FETCH_TIMEOUT_MS };
}(window));
