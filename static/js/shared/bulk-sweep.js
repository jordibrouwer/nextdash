/**
 * Walk a selection one row at a time, behind the counting progress bar.
 *
 * The Bookmarks view's fetch-icons and fetch-previews, Health's refresh and
 * rebuild, and the dashboard's selection bar all do the same thing: ask
 * somebody else's server about each row in turn. They had two loops for it,
 * one with a Stop button and rate-limit handling and one without; this is
 * the one loop.
 *
 * Serial, because every row is a request to a server that is not ours, through
 * endpoints that allow sixty a minute per client. A refusal (429) is not a
 * failure: the server says how long to wait, and the row is asked for again.
 * One row failing never ends the sweep; a row answering 'stop' does, for the
 * failures that mean every following row will fail too.
 *
 * `run(row)` answers 'ok' (or true), 'skipped', 'failed', 'stop', or
 * { rateLimited: true, retryAfter: seconds }.
 */
(function () {
    'use strict';

    const fill = (text, vars) => Object.entries(vars || {})
        .reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), String(text));

    /**
     * @param {Array} targets
     * @param {{ title: string, status?: string, run: Function, done: Function,
     *   t?: Function, intervalMs?: number, notify?: Function }} options
     *   t(key, fallback) translates; notify(summary, type) reports the end
     *   (callers that report it themselves leave it out).
     * @returns {Promise<{ ok: number, failed: number, stopped: boolean }>}
     */
    async function run(targets, { title, status, run: runRow, done, t, intervalMs = 0, notify }) {
        const tr = (key, fallback, vars) => fill(typeof t === 'function' ? t(key, fallback) : fallback, vars);
        const overlay = window.ProgressOverlay;
        const total = targets.length;
        const counted = (n) => tr('config.bulkSweepProgress', '{done} of {total}', { done: n, total });
        let ok = 0;
        let failed = 0;
        let stopped = false;
        overlay?.show(title, status || counted(0), {
            onCancel: () => { stopped = true; },
            cancelLabel: tr('config.bulkSweepStop', 'Stop'),
            cancellingLabel: tr('config.bulkSweepStopping', 'Stopping…'),
        });
        overlay?.update(0, total, counted(0));
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const attempt = async (row) => {
            try {
                return await runRow(row);
            } catch {
                return 'failed';
            }
        };
        for (let i = 0; i < total; i += 1) {
            if (stopped) break;
            let result = await attempt(targets[i]);
            if (result && result.rateLimited) {
                overlay?.update(i, total, tr('config.bulkSweepWaiting', 'Rate limit reached — waiting {seconds}s',
                    { seconds: result.retryAfter }));
                await wait((Number(result.retryAfter) + 1) * 1000);
                if (stopped) break;
                result = await attempt(targets[i]);
                if (result && result.rateLimited) result = 'failed';
            }
            if (result === 'stop') {
                overlay?.hide();
                return { ok, failed, stopped: true };
            }
            if (result === 'ok' || result === true) ok += 1;
            else if (result !== 'skipped') failed += 1;
            overlay?.update(i + 1, total, counted(i + 1));
            if (intervalMs > 0 && i + 1 < total) await wait(intervalMs);
        }
        const summary = stopped
            ? tr('config.bulkSweepStopped', 'Stopped after {done} of {total}', { done: ok + failed, total })
            : done(ok, failed);
        // A stopped sweep did not finish: filling the bar would say it had.
        if (stopped) overlay?.hide();
        else overlay?.finish(summary);
        notify?.(summary, stopped ? 'info' : (failed && !ok ? 'warning' : 'success'));
        return { ok, failed, stopped };
    }

    window.BulkSweep = { run };
})();
