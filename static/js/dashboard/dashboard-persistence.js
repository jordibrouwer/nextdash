/**
 * Pending bookmark/category saves and order flush.
 */
class DashboardPersistence {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    async flushPendingDashboardSaves() {
        const d = this.dash;
        await d.flushPendingBookmarkSave();
        await this.flushPendingPreviewSave();
        await d.flushPendingCategorySave();
        await d.renderCore?.flushPendingBlockOrderSave?.();
    }


    async flushPendingPreviewSave() {
        const d = this.dash;
        if (!d.pendingPreviewSave) {
            return;
        }
        clearTimeout(d.pendingPreviewSave);
        d.pendingPreviewSave = null;
        await this.saveBookmarkPreviewMetadataNow();
    }


    flushPendingDashboardSavesOnExit() {
        const d = this.dash;
        const hadReorder = Boolean(d.pendingReorderSnapshot) || Boolean(d._bookmarkOrderSaveInFlight);
        const hadPreview = Boolean(d.pendingPreviewSave);
        const hadCategory = Boolean(d._pendingCategorySave);
        if (d.pendingReorderSave) {
            clearTimeout(d.pendingReorderSave);
            d.pendingReorderSave = null;
        }
        if (d.pendingPreviewSave) {
            clearTimeout(d.pendingPreviewSave);
            d.pendingPreviewSave = null;
        }
        if (d._pendingCategorySave) {
            clearTimeout(d._pendingCategorySave);
            d._pendingCategorySave = null;
        }
        const pendingBlocks = d._pendingBlockOrder;
        if (d._pendingBlockOrderSave) {
            clearTimeout(d._pendingBlockOrderSave);
            d._pendingBlockOrderSave = null;
        }
        d._pendingBlockOrder = null;
        if (!hadReorder && !hadPreview && !hadCategory && !pendingBlocks) {
            return;
        }

        const headers = typeof nextDashWriteHeaders === 'function'
            ? nextDashWriteHeaders({ 'Content-Type': 'application/json' })
            : { 'Content-Type': 'application/json' };

        // A category or widget dragged in the last second before the tab went.
        if (pendingBlocks && Number.isFinite(pendingBlocks.pageId) && pendingBlocks.order.length) {
            try {
                fetch(`/api/pages/${pendingBlocks.pageId}/blocks`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({ order: pendingBlocks.order }),
                    keepalive: true
                });
            } catch (_error) {
                // Best-effort on tab close; ignore network errors.
            }
        }
        const pageId = Number(d.currentPageId);

        if ((hadReorder || hadPreview) && Array.isArray(d.bookmarks) && Number.isFinite(pageId)) {
            try {
                // Without what the server keeps for itself (it puts those back,
                // see carryServerOwnedBookmarkFields): a keepalive body is capped
                // at 64 KB in all, and the open log alone ran a busy page past
                // it, so the last reorder was refused as the tab closed.
                const rows = d.bookmarks.map(({ openLog, openCount, lastOpened, lastChecked, lastError, brokenSince, ...rest }) => rest);
                void fetch(`/api/bookmarks?page=${pageId}`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(rows),
                    keepalive: true
                }).catch(() => {});
            } catch (_error) {
                // Best-effort on tab close; ignore network errors.
            }
        }

        if (hadCategory && Array.isArray(d.categories) && Number.isFinite(pageId)) {
            try {
                const categoryPayload = d.categories.map((c) => ({ ...c, originalId: c.id }));
                fetch(`/api/categories?page=${pageId}`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(categoryPayload),
                    keepalive: true
                });
            } catch (_error) {
                // Best-effort on tab close; ignore network errors.
            }
        }
    }


    async saveBookmarkPreviewMetadataNow() {
        const d = this.dash;
        if (!Array.isArray(d.bookmarks) || !Number.isFinite(Number(d.currentPageId))) {
            return;
        }
        try {
            const response = await dashFetch(`/api/bookmarks?page=${d.currentPageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(d.bookmarks)
            });
            if (!response.ok) {
                throw new Error('Failed to save bookmark preview metadata');
            }
            d.data?.updatePageDataCache?.(Number(d.currentPageId), { bookmarks: d.bookmarks });
            void d.data?.fetchAndStoreDataRevision?.();
        } catch (_error) {
            d.showErrorNotification(
                d.formatDashboardLabel(
                    'saveBookmarkPreviewFailed',
                    {},
                    'Failed to save bookmark preview metadata.'
                )
            );
        }
    }


    async saveBookmarkOrder(options = {}) {
        const d = this.dash;
        const pageId = Number(options.pageId ?? d.currentPageId);
        if (!Number.isFinite(pageId)) {
            return false;
        }

        const hasExplicitPayload = Array.isArray(options.payload);
        // Snapshot an explicit payload at call time (the caller's array may mutate
        // before the queued save runs). The implicit d.bookmarks path is read below,
        // after awaiting the prior save, so it reflects any post-failure rollback.
        const explicitPayload = hasExplicitPayload ? [...options.payload] : null;

        const priorSave = d._bookmarkOrderSaveInFlight;
        const saveTask = (async () => {
            if (priorSave) {
                try {
                    await priorSave;
                } catch (_error) {
                    // Prior save already notified; continue with latest payload.
                }
            }
            const source = hasExplicitPayload ? explicitPayload : d.bookmarks;
            const payload = source.map((bookmark) => ({ ...bookmark }));
            try {
                const response = await dashFetch(`/api/bookmarks?page=${pageId}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    let message = d.formatDashboardLabel(
                        'bookmarkOrderSaveFailed',
                        {},
                        'Failed to save bookmark order.'
                    );
                    try {
                        const errorBody = await response.json();
                        if (response.status === 409 && errorBody?.error === 'duplicate_shortcut') {
                            message = d.formatDashboardLabel(
                                'shortcutConflictOnBookmark',
                                { shortcut: String(errorBody.shortcut || '') },
                                `Shortcut "${errorBody.shortcut}" already exists on another bookmark.`
                            );
                        } else if (errorBody?.message) {
                            message = String(errorBody.message);
                        }
                    } catch (error) {
                        // Ignore parse issues and keep fallback message.
                    }
                    throw new Error(message);
                }

                // Cleared only when nothing newer is waiting: a drag made while
                // this save was on the wire has its own timer and snapshot, and
                // nulling them dropped that drag, and left its timer to post
                // whichever page was showing when it fired.
                if (pageId === Number(d.currentPageId) && !d.pendingReorderSave) {
                    d.pendingReorderSnapshot = null;
                }

                // Not awaited: with a snapshot pending it can reload the page,
                // whose flush waits on this very save -- a promise that waited
                // on itself, and every later page switch hung.
                if (d.settings.globalShortcuts) {
                    void d.loadAllBookmarks();
                }
                d.data?.updatePageDataCache?.(pageId, { bookmarks: payload });
                void d.data?.fetchAndStoreDataRevision?.();

                if (options.showReorderSavedToast && options.successMessage) {
                    d.showNotification(options.successMessage, 'success', { duration: 2000 });
                }
            } catch (error) {
                if (pageId === Number(d.currentPageId) && d.pendingReorderSnapshot) {
                    d.bookmarks = [...d.pendingReorderSnapshot];
                    d.renderDashboard();
                }
                if (pageId === Number(d.currentPageId)) {
                    // A drag made while this save was in flight armed a timer;
                    // left running, it posted the rolled-back list and said
                    // "Bookmark order saved" right after "Changes were reverted".
                    if (d.pendingReorderSave) clearTimeout(d.pendingReorderSave);
                    d.pendingReorderSave = null;
                    d.pendingReorderSnapshot = null;
                }
                const revertSuffix = d.formatDashboardLabel(
                    'bookmarkOrderChangesReverted',
                    {},
                    'Changes were reverted.'
                );
                const baseMessage = error.message || d.formatDashboardLabel(
                    'bookmarkOrderSaveFailed',
                    {},
                    'Failed to save bookmark order.'
                );
                d.showErrorNotification(`${baseMessage} ${revertSuffix}`);
                throw error;
            }
        })();

        d._bookmarkOrderSaveInFlight = saveTask;
        try {
            await saveTask;
            return true;
        } catch (_error) {
            return false;
        } finally {
            if (d._bookmarkOrderSaveInFlight === saveTask) {
                d._bookmarkOrderSaveInFlight = null;
            }
        }
    }

}

window.DashboardPersistence = DashboardPersistence;
