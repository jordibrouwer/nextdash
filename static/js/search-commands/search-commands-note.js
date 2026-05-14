/**
 * Search Command: :note <query>
 * Edit a bookmark's note directly from the command palette.
 * Usage:
 *   :note          → shows all bookmarks (current page first, then others)
 *   :note github   → filters bookmarks whose name/url contains "github"
 * Selecting a match opens a small modal to edit the note and saves immediately.
 */
class SearchCommandNote {
    constructor(language = null) {
        this.language = language;
    }

    setLanguage(language) {
        this.language = language;
    }

    handle(args, currentBookmarks = [], allBookmarks = []) {
        const query = args.join(' ').trim().toLowerCase();

        // Build candidate list: current page bookmarks first, then rest (deduplicated by url)
        const currentUrls = new Set((currentBookmarks || []).map(b => b.url));
        const others = (allBookmarks || []).filter(b => !currentUrls.has(b.url));
        const pool = [...(currentBookmarks || []), ...others];

        const filtered = query
            ? pool.filter(b =>
                (b.name || '').toLowerCase().includes(query) ||
                (b.url  || '').toLowerCase().includes(query)
              )
            : pool;

        if (filtered.length === 0) {
            return [{
                name: query ? `No bookmarks matching "${query}"` : 'No bookmarks found',
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
            return {
                name: bookmark.name || bookmark.url,
                shortcut: ':NOTE',
                meta: hasNote ? `note${notePreview}` : 'no note',
                action: () => this._openNoteModal(bookmark),
                type: 'command'
            };
        });
    }

    _openNoteModal(bookmark) {
        const existing = document.getElementById('note-command-modal');
        if (existing) existing.remove();

        const escHtml = s => String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        const overlayEl = document.createElement('div');
        overlayEl.id = 'note-command-modal';
        overlayEl.className = 'modal-overlay show';
        overlayEl.innerHTML = `
            <div class="modal note-command-modal-inner">
                <div class="note-cmd-header">
                    <span class="note-cmd-title">
                        <span class="note-cmd-label">note</span>
                        <span class="note-cmd-bookmark-name">${escHtml(bookmark.name || bookmark.url)}</span>
                    </span>
                    <button type="button" class="note-cmd-close" aria-label="Close">✕</button>
                </div>
                <div class="note-cmd-body">
                    <textarea id="note-cmd-textarea" class="note-cmd-textarea" rows="5" placeholder="Add a note…" spellcheck="false">${escHtml(bookmark.note || '')}</textarea>
                </div>
                <div class="note-cmd-footer">
                    <span class="note-cmd-hint">Enter to save · Esc to cancel</span>
                    <div class="note-cmd-actions">
                        <button type="button" class="note-cmd-btn note-cmd-btn-secondary" id="note-cmd-cancel">Cancel</button>
                        <button type="button" class="note-cmd-btn note-cmd-btn-primary"  id="note-cmd-save">Save note</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlayEl);
        document.body.style.overflow = 'hidden';

        const textarea  = document.getElementById('note-cmd-textarea');
        const saveBtn   = document.getElementById('note-cmd-save');
        const cancelBtn = document.getElementById('note-cmd-cancel');
        const closeBtn  = overlayEl.querySelector('.note-cmd-close');

        // Focus & place cursor at end
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);

        let done = false;

        const close = () => {
            if (done) return;
            done = true;
            document.body.style.overflow = '';
            overlayEl.remove();
        };

        const save = async () => {
            if (done) return;
            const newNote = textarea.value;
            close();
            bookmark.note = newNote;
            await this._persistBookmark(bookmark);
            const dash = window.dashboardInstance;
            if (dash) {
                // Re-render the row badge without full re-render
                if (typeof dash.scheduleBookmarkOrderSave === 'function') {
                    dash.scheduleBookmarkOrderSave({ successMessage: 'Note saved.' });
                }
            }
        };

        saveBtn.addEventListener('click', save);
        cancelBtn.addEventListener('click', close);
        closeBtn.addEventListener('click', close);

        textarea.addEventListener('keydown', (e) => {
            // Ctrl+Enter or Meta+Enter → save (plain Enter stays as newline in textarea)
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                save();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        });

        overlayEl.addEventListener('mousedown', (e) => {
            if (e.target === overlayEl) close();
        });
    }

    async _persistBookmark(bookmark) {
        const dash = window.dashboardInstance;
        if (!dash) return;

        const pageId = Number(bookmark.pageId || bookmark.pageID || dash.currentPageId);
        if (!pageId) return;

        // Get the full page bookmark list, update the matching entry, and POST it back
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
            // Keep in-memory bookmarks in sync if it's the current page
            if (dash.bookmarks && Number(dash.currentPageId) === pageId) {
                const localIdx = dash.bookmarks.findIndex(b => b.url === bookmark.url && b.name === bookmark.name);
                if (localIdx >= 0) dash.bookmarks[localIdx].note = bookmark.note;
            }
        } catch (e) {
            // ignore
        }
    }
}

window.SearchCommandNote = SearchCommandNote;
