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
        if (!hadReorder && !hadPreview && !hadCategory) {
            return;
        }

        const headers = typeof nextDashWriteHeaders === 'function'
            ? nextDashWriteHeaders({ 'Content-Type': 'application/json' })
            : { 'Content-Type': 'application/json' };
        const pageId = Number(d.currentPageId);

        if ((hadReorder || hadPreview) && Array.isArray(d.bookmarks) && Number.isFinite(pageId)) {
            try {
                fetch(`/api/bookmarks?page=${pageId}`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify([...d.bookmarks]),
                    keepalive: true
                });
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
        } catch (error) {
            console.error('Failed to save bookmark preview metadata:', error);
        }
    }


    async saveBookmarkOrder(options = {}) {
        const d = this.dash;
        const pageId = Number(options.pageId ?? d.currentPageId);
        if (!Number.isFinite(pageId)) {
            return;
        }

        const payload = Array.isArray(options.payload)
            ? options.payload.map((bookmark) => ({ ...bookmark }))
            : [...d.bookmarks];

        const priorSave = d._bookmarkOrderSaveInFlight;
        const saveTask = (async () => {
            if (priorSave) {
                try {
                    await priorSave;
                } catch (_error) {
                    // Prior save already notified; continue with latest payload.
                }
            }
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

                if (d.settings.globalShortcuts) {
                    await d.loadAllBookmarks();
                }

                if (pageId === Number(d.currentPageId)) {
                    d.pendingReorderSave = null;
                    d.pendingReorderSnapshot = null;
                }
                d.data?.updatePageDataCache?.(pageId, { bookmarks: payload });

                if (options.showReorderSavedToast && options.successMessage) {
                    d.showNotification(options.successMessage, 'success', { duration: 2000 });
                }
            } catch (error) {
                if (pageId === Number(d.currentPageId) && d.pendingReorderSnapshot) {
                    d.bookmarks = [...d.pendingReorderSnapshot];
                    d.renderDashboard();
                }
                if (pageId === Number(d.currentPageId)) {
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
        } catch (_error) {
            // Notification shown in saveTask.
        } finally {
            if (d._bookmarkOrderSaveInFlight === saveTask) {
                d._bookmarkOrderSaveInFlight = null;
            }
        }
    }

}

window.DashboardPersistence = DashboardPersistence;
