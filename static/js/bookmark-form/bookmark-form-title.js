/**
 * A name from the page, offered and never forced.
 *
 * The name is required, and the page usually has one. So when the name is
 * empty and untouched the page's title goes in, with a line under it saying
 * where it came from. A name the reader typed is theirs: the title is then
 * only offered, with Use.
 */
(function (global) {
    'use strict';

    /** A page's title as text: some pages write it with HTML entities. */
    function plain(value) {
        const box = document.createElement('textarea');
        box.innerHTML = String(value || '');
        return box.value.replace(/\s+/g, ' ').trim();
    }

    function hostOf(url) {
        try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
    }

    function attach(nameInput, noteEl, options = {}) {
        const t = typeof options.t === 'function' ? options.t : (_k, fallback) => fallback;
        let suggested = '';
        const placeholder = nameInput.placeholder;

        const clearNote = () => {
            noteEl.replaceChildren();
            noteEl.hidden = true;
        };
        const note = (text, actionLabel, action) => {
            noteEl.replaceChildren(document.createTextNode(text));
            if (actionLabel) {
                noteEl.appendChild(document.createTextNode(' · '));
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'bookmark-form-name-action';
                b.textContent = actionLabel;
                b.addEventListener('click', (e) => { e.preventDefault(); action(); });
                noteEl.appendChild(b);
            }
            noteEl.hidden = false;
        };
        const setName = (value) => {
            nameInput.value = value;
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
            delete nameInput.dataset.touchedByReader;
        };
        const onInput = (e) => {
            if (e.isTrusted) {
                nameInput.dataset.touchedByReader = '1';
                suggested = '';
                clearNote();
            }
        };
        nameInput.addEventListener('input', onInput);

        return {
            fetching() {
                // A name this form suggested belongs to the page it came from.
                // A new address clears it while the new page is read; a name
                // the reader typed stays.
                if (suggested && nameInput.dataset.touchedByReader !== '1'
                    && nameInput.value.trim() === suggested) {
                    setName('');
                    suggested = '';
                    clearNote();
                }
                if (!nameInput.value.trim()) nameInput.placeholder = t('config.bookmarkTitleFetching', 'Fetching title…');
            },
            offer(title, url) {
                nameInput.placeholder = placeholder;
                const value = plain(title) || hostOf(url);
                if (!value) return;
                const typed = nameInput.dataset.touchedByReader === '1' && nameInput.value.trim();
                if (!typed) {
                    suggested = value;
                    setName(value);
                    note(t('config.bookmarkTitleSuggested', 'Suggested from the page'),
                        t('config.bookmarkTitleClear', 'Clear'), () => { setName(''); clearNote(); options.onChange?.(); });
                } else if (value !== nameInput.value.trim()) {
                    note(`${t('config.bookmarkTitlePage', 'Page:')} ${value}`,
                        t('config.bookmarkTitleUse', 'Use'), () => { setName(value); clearNote(); options.onChange?.(); });
                }
                options.onChange?.();
            },
            /** Back to a form with nothing in it: Create + New. */
            reset() {
                suggested = '';
                clearNote();
                nameInput.placeholder = placeholder;
                delete nameInput.dataset.touchedByReader;
            },
            dispose() {
                nameInput.removeEventListener('input', onInput);
            },
        };
    }

    global.BookmarkFormTitle = { attach };
}(window));
