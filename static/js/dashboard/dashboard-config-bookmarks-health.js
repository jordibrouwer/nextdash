/**
 * Health, inside Config → Bookmarks.
 *
 * The Health module does the work it always did -- the report, what a filter
 * means, how a score is broken down, every action on a bookmark's health --
 * loaded without its view (dash.health.load()) and asked from here. This file
 * only joins its answers to the bookmarks, by the same URL key the preview
 * cards read health facts with, and hands them to the workbench to draw.
 *
 * Loaded after the workbench, by ensureBookmarkRenderers.
 */
(function (global) {
    'use strict';
    if (typeof global.DashboardConfig !== 'function') return;

    Object.assign(global.DashboardConfig.prototype, {
        /**
         * The Health module with its report loaded, or null when Health is
         * switched off. Loaded once; later calls wait on the same fetch.
         */
        async bmHealth() {
            if (this.dash.settings?.healthViewEnabled === false) return null;
            let health;
            try {
                health = await this.dash.health?.load?.();
            } catch {
                return null;
            }
            if (!health) return null;
            if (!this._bmHealthLoading) {
                this._bmHealthLoading = health.fetchReport()
                    .then(() => this.rebuildBmHealthJoin(health))
                    .catch(() => {
                        // A failed report leaves the list as it was; the next
                        // open tries again.
                        this._bmHealthLoading = null;
                    });
            }
            await this._bmHealthLoading;
            return health;
        },

        rebuildBmHealthJoin(health) {
            this._bmHealthReport = health.report || null;
            const byUrl = new Map();
            (health.report?.issues || []).forEach((issue) => {
                const key = global.HealthFacts?.keyFor?.(issue.url);
                if (key) byUrl.set(key, issue);
            });
            this._bmHealthByUrl = byUrl;
        },

        /** The report's issue for one bookmark, or null before the report lands. */
        bmHealthIssue(b) {
            const key = global.HealthFacts?.keyFor?.(b?.url);
            return key ? (this._bmHealthByUrl?.get(key) || null) : null;
        },

        /** Re-read the report (refresh: ask the server to run the checks again). */
        async refreshBmHealth({ refresh = false } = {}) {
            let health;
            try {
                health = await this.dash.health?.load?.();
            } catch {
                return;
            }
            if (!health) return;
            await health.fetchReport({ refresh });
            this.rebuildBmHealthJoin(health);
            this.repaintBmHealthDependents();
        },

        /**
         * What draws from the join: the rail's counts and the panel always,
         * the rows only while a Health filter decides which rows there are.
         * Repainting the rows otherwise swapped them out from under a pointer
         * that had just reached one, a second after the list opened.
         */
        repaintBmHealthDependents() {
            if (this.section !== 'bookmarks' || !this.isActiveView?.()) return;
            this.repaintWorkbenchRail?.();
            if (this.bmHealthFilter) this.repaintBookmarksList?.();
            this.repaintWorkbenchPanel?.();
        },

        /** Kicked when the list is bound: load once, repaint when it lands. */
        startBmHealth() {
            if (this._bmHealthByUrl || this._bmHealthStarted) return;
            this._bmHealthStarted = true;
            void this.bmHealth().then((health) => {
                this._bmHealthStarted = false;
                if (health) this.repaintBmHealthDependents();
            });
        },
    });

    global.DashboardConfigBookmarksHealthReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
