/**
 * Search Command: :note <query>
 * Edit a bookmark's note directly from the command palette.
 * Usage:
 *   :note          → shows all bookmarks (current page first, then others)
 *   :note github   → filters bookmarks whose name/url contains "github"
 * Selecting a match opens a modal to edit the note and saves immediately.
 */
class SearchCommandNote {
    constructor(language = null) {
        this.language = language;
    }

    setLanguage(language) {
        this.language = language;
    }

    _t(key, fallback, replacements = {}) {
        let text = fallback;
        if (this.language?.t) {
            const val = this.language.t(key);
            if (val && val !== key) {
                text = val;
            }
        }
        return Object.entries(replacements).reduce(
            (acc, [token, value]) => acc.split(`{${token}}`).join(String(value)),
            text
        );
    }

    handle(args, currentBookmarks = [], allBookmarks = []) {
        const query = args.join(' ').trim().toLowerCase();

        const currentUrls = new Set((currentBookmarks || []).map(b => b.url));
        const others = (allBookmarks || []).filter(b => !currentUrls.has(b.url));
        const pool = [...(currentBookmarks || []), ...others];

        const filtered = query
            ? pool.filter(b =>
                (b.name || '').toLowerCase().includes(query) ||
                (b.url || '').toLowerCase().includes(query)
            )
            : pool;

        if (filtered.length === 0) {
            return [{
                name: query
                    ? this._t('commands.noteNoMatch', 'No bookmarks matching "{query}"', { query })
                    : this._t('commands.noteNoBookmarks', 'No bookmarks found'),
                shortcut: ':NOTE',
                action: () => {},
                type: 'command'
            }];
        }

        return filtered.slice(0, 12).map(bookmark => {
            const hasNote = String(bookmark.note || '').trim().length > 0;
            const notePreview = hasNote
                ? ` · "${String(bookmark.note).trim().slice(0, 40)}${bookmark.note.length > 40 ? '…' : ''}"`
                : '';
            const metaNoNote = this._t('commands.noteMetaNoNote', 'no note');
            const metaHasNote = this._t('commands.noteMetaHasNote', 'note');
            return {
                name: bookmark.name || bookmark.url,
                shortcut: ':NOTE',
                meta: hasNote ? `${metaHasNote}${notePreview}` : metaNoNote,
                action: () => this._openNoteModal(bookmark),
                type: 'command'
            };
        });
    }

    _escHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    _openNoteModal(bookmark) {
        if (!window.AppModal || typeof window.AppModal.show !== 'function') {
            return;
        }

        const bookmarkName = bookmark.name || bookmark.url || '';
        const title = this._t('commands.noteModalTitle', 'Edit note — {name}', { name: bookmarkName });
        const placeholder = this._t('commands.noteModalPlaceholder', 'Add a note…');
        const hint = this._t('commands.noteModalHint', 'Ctrl+Enter to save · Esc to cancel');
        const saveLabel = this._t('commands.noteModalSave', 'Save note');
        const cancelLabel = this._t('dashboard.cancel', 'Cancel');

        const htmlMessage = `
            <div class="note-cmd-body">
                <textarea id="note-cmd-textarea" class="note-cmd-textarea" rows="5"
                    placeholder="${this._escHtml(placeholder)}" spellcheck="false"
                    aria-label="${this._escHtml(placeholder)}">${this._escHtml(bookmark.note || '')}</textarea>
                <p class="note-cmd-hint" id="note-cmd-hint">${this._escHtml(hint)}</p>
            </div>
        `;

        window.AppModal.show({
            title,
            htmlMessage,
            confirmText: saveLabel,
            cancelText: cancelLabel,
            modalClass: 'note-command-modal-inner',
            modalMaxWidth: '480px',
            modalWidth: 'min(480px, 92vw)',
            initialFocusSelector: '#note-cmd-textarea',
            onConfirm: async () => {
                const textarea = document.getElementById('note-cmd-textarea');
                const newNote = textarea ? textarea.value : '';
                bookmark.note = newNote;
                await this._persistBookmark(bookmark);
                const dash = window.dashboardInstance;
                if (dash && typeof dash.scheduleBookmarkOrderSave === 'function') {
                    dash.scheduleBookmarkOrderSave({
                        successMessage: this._t('commands.noteSavedToast', 'Note saved.')
                    });
                }
            },
            onCancel: () => {}
        });

        setTimeout(() => {
            const textarea = document.getElementById('note-cmd-textarea');
            if (!textarea) return;
            textarea.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    const confirmBtn = document.querySelector('#app-modal.show .modal-button');
                    confirmBtn?.click();
                }
            });
        }, 120);
    }

    async _persistBookmark(bookmark) {
        const dash = window.dashboardInstance;
        if (!dash) return;

        const pageId = Number(bookmark.pageId || bookmark.pageID || dash.currentPageId);
        if (!pageId) return;

        try {
            const res = await fetch(`/api/bookmarks?page=${pageId}`);
            if (!res.ok) return;
            const bookmarks = await res.json();
            const idx = bookmarks.findIndex(b => b.url === bookmark.url && b.name === bookmark.name);
            if (idx >= 0) {
                bookmarks[idx].note = bookmark.note;
            }
            await fetch(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bookmarks)
            });
            if (dash.bookmarks && Number(dash.currentPageId) === pageId) {
                const localIdx = dash.bookmarks.findIndex(b => b.url === bookmark.url && b.name === bookmark.name);
                if (localIdx >= 0) dash.bookmarks[localIdx].note = bookmark.note;
            }
        } catch {
            // ignore
        }
    }
}

window.SearchCommandNote = SearchCommandNote;
