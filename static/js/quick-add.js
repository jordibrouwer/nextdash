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

    /**
     * Run `fn` with the :new handler, fetching the search bundle first if the
     * handler is not there yet.
     *
     * The form is part of the search stack, which is loaded by the key that
     * opens it -- and the add-bookmark routes are not among those keys. So in
     * the seconds before the prefetch lands, + / Shift+B / Ctrl+Shift+A and the
     * toolbar button each found no handler and returned, doing nothing and
     * saying nothing. The loader already replays `>` `:` `?` `*` `/` for the
     * same reason; this is that promise kept for the one route it missed.
     *
     * Still a no-op when the bundle genuinely cannot load, which is the same
     * answer as before -- only now it is the answer to a failed fetch rather
     * than to a slow one.
     *
     * @param {(handler: any) => void} fn
     */
    withNewHandler(fn) {
        const handler = this.getNewHandler();
        if (handler) {
            fn(handler);
            return Promise.resolve(handler);
        }
        const ensure = window.SearchLoader?.ensureReady;
        if (typeof ensure !== 'function') return Promise.resolve(undefined);
        return window.SearchLoader.ensureReady().then(() => {
            const late = this.getNewHandler();
            if (late) fn(late);
            return late;
        });
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
            this.toggle();
        });
        this.shortcutBound = true;
    }

    toggle() {
        return this.withNewHandler((handler) => {
            if (handler.modal?.classList.contains('show')) {
                handler.closeModal();
            } else {
                // The open event fires inside openModal(), which every entry point uses.
                this.syncNewHandlerContext()?.openModal();
            }
        });
    }

    open() {
        return this.withNewHandler(() => {
            this.syncNewHandlerContext()?.openModal();
        });
    }

    close() {
        this.getNewHandler()?.closeModal();
    }
}
