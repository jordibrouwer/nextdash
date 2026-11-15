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

        /*
         * The way back to the page's own title.
         *
         * When the app took a login word or the site's own name off the title it
         * suggested, a small turned arrow stands at the end of the name field.
         * It is there only for a name the app chose and the reader has not
         * touched; a press brings the original back, and another press the
         * cleaned one.
         */
        const wrap = document.createElement('span');
        wrap.className = 'bookmark-form-name-wrap';
        nameInput.parentNode?.insertBefore(wrap, nameInput);
        wrap.appendChild(nameInput);
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'bookmark-form-name-restore';
        restore.hidden = true;
        wrap.appendChild(restore);
        const ARROW_BACK = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M6 3 2.5 6.5 6 10M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const ARROW_FORWARD = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M10 3l3.5 3.5L10 10M13 6.5H6.5a3.5 3.5 0 0 0 0 7H9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        let cleanedName = '';
        let originalName = '';
        const hideRestore = () => {
            restore.hidden = true;
            wrap.classList.remove('has-restore');
            cleanedName = '';
            originalName = '';
        };
        const paintRestore = (showingOriginal) => {
            const label = showingOriginal
                ? t('config.bookmarkTitleUseCleaned', 'Use cleaned title')
                : t('config.bookmarkTitleUseOriginal', 'Use original title');
            restore.innerHTML = showingOriginal ? ARROW_FORWARD : ARROW_BACK;
            restore.title = label;
            restore.setAttribute('aria-label', label);
            restore.dataset.state = showingOriginal ? 'original' : 'cleaned';
            restore.hidden = false;
            wrap.classList.add('has-restore');
        };
        restore.addEventListener('click', (e) => {
            e.preventDefault();
            const toOriginal = restore.dataset.state !== 'original';
            setName(toOriginal ? originalName : cleanedName);
            suggested = toOriginal ? originalName : cleanedName;
            paintRestore(toOriginal);
            options.onChange?.();
        });

        const clearNote = () => {
            noteEl.replaceChildren();
            noteEl.hidden = true;
        };
        // A line of text and any number of buttons after it: [label, action].
        const note = (text, ...actions) => {
            noteEl.replaceChildren(document.createTextNode(text));
            actions.filter(Boolean).forEach(([label, action]) => {
                noteEl.appendChild(document.createTextNode(' · '));
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'bookmark-form-name-action';
                b.textContent = label;
                b.addEventListener('click', (e) => { e.preventDefault(); action(); });
                noteEl.appendChild(b);
            });
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
                hideRestore();
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
                    hideRestore();
                }
                if (!nameInput.value.trim()) nameInput.placeholder = t('config.bookmarkTitleFetching', 'Fetching title…');
            },
            /**
             * `original` is the page's title before nextDash took the login word
             * or the site's own name off it. When it differs and the name is the
             * one the form suggested, the arrow at the end of the field brings it
             * back.
             */
            offer(title, url, original) {
                nameInput.placeholder = placeholder;
                const value = plain(title) || hostOf(url);
                if (!value) return;
                const raw = plain(original);
                const typed = nameInput.dataset.touchedByReader === '1' && nameInput.value.trim();
                hideRestore();
                if (!typed) {
                    suggested = value;
                    setName(value);
                    note(t('config.bookmarkTitleSuggested', 'Suggested from the page'),
                        [t('config.bookmarkTitleClear', 'Clear'), () => { setName(''); clearNote(); hideRestore(); options.onChange?.(); }]);
                    if (raw && raw !== value) {
                        cleanedName = value;
                        originalName = raw;
                        paintRestore(false);
                    }
                } else if (value !== nameInput.value.trim()) {
                    note(`${t('config.bookmarkTitlePage', 'Page:')} ${value}`,
                        [t('config.bookmarkTitleUse', 'Use'), () => { setName(value); clearNote(); options.onChange?.(); }]);
                }
                options.onChange?.();
            },
            /** Back to a form with nothing in it: Create + New. */
            reset() {
                suggested = '';
                clearNote();
                nameInput.placeholder = placeholder;
                delete nameInput.dataset.touchedByReader;
                hideRestore();
            },
            dispose() {
                nameInput.removeEventListener('input', onInput);
            },
        };
    }

    global.BookmarkFormTitle = { attach };
}(window));
