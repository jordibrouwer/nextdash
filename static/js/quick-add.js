/**
 * Quick Add Widget — delegates to the unified :new bookmark modal.
 * Shortcuts: + (dashboard), Shift+B and Ctrl+Shift+A (global).
 */
class QuickAddWidget {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.shortcutBound = false;
        this.init();
    }

    init() {
        this.attachGlobalShortcut();
    }

    getNewHandler() {
        return this.dashboard?.searchComponent?.commandsComponent?.newCommandHandler;
    }

    syncNewHandlerContext() {
        const handler = this.getNewHandler();
        const d = this.dashboard;
        if (!handler || !d) {
            return handler;
        }
        handler.setContext(
            d.currentPageId || 1,
            d.categories || [],
            d.pages || []
        );
        return handler;
    }

    static isTypingTarget(e) {
        const tag = e?.target?.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(e?.target?.isContentEditable);
    }

    static matchesChordShortcut(e) {
        return Boolean(e?.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyA');
    }

    static matchesShiftBShortcut(e) {
        if (!e?.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.code !== 'KeyB') {
            return false;
        }
        if (QuickAddWidget.isTypingTarget(e)) {
            return false;
        }
        if (document.body.classList.contains('bookmark-inline-edit-active')) {
            return false;
        }
        return true;
    }

    static matchesAddBookmarkShortcut(e) {
        return QuickAddWidget.matchesChordShortcut(e) || QuickAddWidget.matchesShiftBShortcut(e);
    }

    attachGlobalShortcut() {
        if (this.shortcutBound) return;
        document.addEventListener('keydown', (e) => {
            if (!QuickAddWidget.matchesAddBookmarkShortcut(e)) return;
            e.preventDefault();
            window.DashboardShiftBPromo?.markSeen?.();
            this.toggle();
        });
        this.shortcutBound = true;
    }

    toggle() {
        const handler = this.getNewHandler();
        if (!handler) return;
        if (handler.modal?.classList.contains('show')) {
            handler.closeModal();
        } else {
            // The open event fires inside openModal(), which every entry point uses.
            this.syncNewHandlerContext()?.openModal();
        }
    }

    open() {
        this.syncNewHandlerContext()?.openModal();
    }

    close() {
        this.getNewHandler()?.closeModal();
    }
}
