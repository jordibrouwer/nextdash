/**
 * The full Unsorted view: every bookmark kept from the inbox without a
 * dashboard category, in fixed-width packed columns, chronological.
 *
 * The masonry layout is not reimplemented here. DashboardTagFilter already
 * builds it from an arbitrary bookmark array chunked into groups of ten and
 * handed to _distributeTagFilterColumnBlocks -- this view supplies a
 * different bookmark array (from /api/unsorted, not a tag match) and reuses
 * the exact same chunking and column-distribution calls.
 */
class DashboardUnsorted {
    static VIEW = 'unsorted';

    constructor(dashboard) {
        this.dash = dashboard;
    }

    isEnabled() {
        return this.dash.settings?.unsortedEnabled !== false;
    }

    isActiveView() {
        return this.dash.activeView === DashboardUnsorted.VIEW;
    }

    async openUnsortedView() {
        const d = this.dash;
        if (!this.isEnabled()) {
            return false;
        }
        if (d.activeView === DashboardUnsorted.VIEW) {
            return true;
        }
        if (d.isInlineEditActive() && !(await d.confirmInlineEditBeforeNavigation())) {
            return false;
        }
        d._abortInlineEditForRender?.();
        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
        d.setActiveView(DashboardUnsorted.VIEW);
        window.nextdashTrack?.('view:unsorted');
        await this.loadAndRender();
        return true;
    }

    async loadAndRender() {
        const d = this.dash;
        let bookmarks = [];
        try {
            const res = await fetch('/api/unsorted');
            if (res.ok) {
                const data = await res.json();
                bookmarks = Array.isArray(data?.bookmarks) ? data.bookmarks : [];
                d._unsortedPageId = data?.page?.id;
            }
        } catch (_error) {
            // Falls through to the empty-state render below.
        }
        this.render(bookmarks);
    }

    render(bookmarks) {
        const d = this.dash;
        const container = document.getElementById('dashboard-layout');
        if (!container) return;

        container.innerHTML = '';
        container.classList.add('unsorted-view');

        if (!bookmarks.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state empty-state--unsorted';
            empty.textContent = d.formatDashboardLabel('unsortedEmpty', {}, 'Nothing kept yet.');
            container.appendChild(empty);
            return;
        }

        const CHUNK_SIZE = 10;
        const chunkBlocks = [];
        for (let offset = 0; offset < bookmarks.length; offset += CHUNK_SIZE) {
            const chunk = bookmarks.slice(offset, offset + CHUNK_SIZE);
            const chunkIndex = Math.floor(offset / CHUNK_SIZE);
            chunkBlocks.push(
                d.createCategoryElement(
                    { id: `__unsorted_chunk_${chunkIndex}`, name: '', tagFilterChunk: true },
                    chunk
                )
            );
        }

        const body = document.createElement('div');
        d._copyDashboardGridLayoutToElement(body, container);
        const gridLayout = d.syncDashboardGridLayout();
        d.tagFilter._distributeTagFilterColumnBlocks(body, chunkBlocks, { animate: false, gridLayout });
        container.appendChild(body);
    }
}

window.DashboardUnsorted = DashboardUnsorted;
