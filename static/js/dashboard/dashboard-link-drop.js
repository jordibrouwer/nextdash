/**
 * A link dragged in from another window, dropped on the dashboard.
 *
 * On a category it opens the bookmark form with the address, the title, the page
 * and the category filled in: dropping there says what is meant. Anywhere else it
 * follows paste (DashboardPasteChoice): ask, bookmark or Inbox, as set. Several
 * links at once go to the Inbox. What a drop holds is read by LinkDropModel.
 *
 * It leaves alone what is not a drop from outside: the dashboard's own drags
 * (rows and blocks, which set __dragReorderState), files (the page template
 * drop), a field, an open dialog, and every view but the bookmarks.
 */
class DashboardLinkDrop {
    constructor(dashboard) {
        this.dash = dashboard;
        this._target = null;
    }

    bind() {
        if (typeof document === 'undefined' || document.documentElement.dataset.linkDrop) return;
        document.documentElement.dataset.linkDrop = '1';
        // A drag that starts on this page is the dashboard's own, whatever it
        // carries: a Recent row or a widget image is an anchor and holds a
        // link, and moving it is not a new link coming in.
        document.addEventListener('dragstart', () => { this._own = true; }, true);
        document.addEventListener('dragover', (e) => this.onOver(e));
        document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) this.mark(null); });
        document.addEventListener('dragend', () => { this._own = false; this.mark(null); });
        document.addEventListener('drop', (e) => { void this.onDrop(e); });
    }

    /** Whether this is a drop to leave alone. */
    ignores(e, { atDrop = false } = {}) {
        const d = this.dash;
        const model = window.LinkDropModel;
        // Not defaultPrevented at the drop: the lists that reorder rows answer
        // every drop with preventDefault, an outside one included.
        if (!model || this._own || (!atDrop && e.defaultPrevented)) return true;
        if (d.settings?.pasteUrlQuickAdd === false) return true;
        if (window.__dragReorderState?.selected) return true;
        if (!model.mayCarryLink(e.dataTransfer?.types)) return true;
        if (e.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return true;
        if (typeof d.isBookmarksView === 'function' && !d.isBookmarksView()) return true;
        if (d.isModalOpen?.() || window.DashboardTagCloud?.modalOpen) return true;
        if (d.searchComponent?.isActive?.() || d.isInlineEditActive?.()) return true;
        if (document.getElementById('paste-choice-modal')?.classList.contains('show')) return true;
        return false;
    }

    /** The category under the pointer that a bookmark can be filed in, or null. */
    categoryAt(e) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const category = el?.closest?.('#dashboard-layout .category[data-category-id]');
        if (!category || category.classList.contains('dashboard-widget')) return null;
        if (category.getAttribute('data-smart-collection') === 'true') return null;
        return category;
    }

    mark(category) {
        if (this._target === category) return;
        this._target?.classList.remove('link-drop-target');
        this._target = category;
        category?.classList.add('link-drop-target');
    }

    onOver(e) {
        if (this.ignores(e)) { this.mark(null); return; }
        // Without this the browser opens the address in place of the dashboard.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        this.mark(this.categoryAt(e));
    }

    async onDrop(e) {
        const ignored = this.ignores(e, { atDrop: true });
        const category = ignored ? null : this.categoryAt(e);
        this.mark(null);
        this._own = false;
        if (ignored) return;
        // Taken at dragover, so the drop is ours even when it holds no link:
        // left to the browser, Firefox loads the dropped text in this tab.
        e.preventDefault();
        const links = window.LinkDropModel.linksFromTransfer(e.dataTransfer);
        if (!links.length) return;
        const d = this.dash;
        if (links.length > 1 && d.settings?.inboxEnabled !== false && d.inbox?.addFromUrl) {
            let saved = 0;
            for (const link of links) {
                if (await d.inbox.addFromUrl(link.url, { source: 'paste', title: link.title, quiet: true })) saved += 1;
            }
            const label = saved === links.length
                ? d.formatDashboardLabel?.('linkDropInbox', { n: saved }, '{n} links sent to the Inbox') || `${saved} links sent to the Inbox`
                : d.formatDashboardLabel?.('linkDropInboxSome', { n: saved, total: links.length }, '{n} of {total} links sent to the Inbox') || `${saved} of ${links.length} links sent to the Inbox`;
            d.showNotification?.(label, saved === links.length ? 'success' : 'error');
            return;
        }
        const [link] = links;
        if (!category && d.pasteChoice?.isEnabled?.()) {
            d.pasteChoice.handlePasteUrl(link.url);
            return;
        }
        const handler = d.searchComponent?.commandsComponent?.newCommandHandler || await d.newBookmarkHandler?.();
        handler?.openModal?.({
            url: link.url,
            name: link.title || undefined,
            pageId: Number(d.currentPageId) || undefined,
            ...(category ? { category: String(category.getAttribute('data-category-id')) } : {}),
        });
    }
}

window.DashboardLinkDrop = DashboardLinkDrop;
