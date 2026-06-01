/**
 * Quick Add Widget — delegates to the unified :new bookmark modal.
 * Shortcuts: + (dashboard) and Ctrl+Shift+A (global).
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

    static matchesChordShortcut(e) {
        return Boolean(e?.ctrlKey && e.shiftKey && e.code === 'KeyA');
    }

    attachGlobalShortcut() {
        if (this.shortcutBound) return;
        document.addEventListener('keydown', (e) => {
            if (!QuickAddWidget.matchesChordShortcut(e)) return;
            e.preventDefault();
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
            handler.openModal();
        }
    }

    open() {
        this.getNewHandler()?.openModal();
    }

    close() {
        this.getNewHandler()?.closeModal();
    }
}
