/**
 * The notes widget, large: a toolbar, the text on the left, the rendering on
 * the right. The same text as the widget -- it is saved through the widget's
 * own save, so closing the modal leaves the tile showing what was typed.
 * Everything that processes the text goes through NotesEngine, so the modal
 * follows the same "server or browser" setting as the widget.
 */
(function (global) {
    'use strict';

    const TOKEN = 'notes-modal';
    const SAVE_DELAY_MS = 600;
    const PREVIEW_DELAY_MS = 150;
    let current = false;

    function button(className, text, aria, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = className;
        b.textContent = text;
        b.setAttribute('aria-label', aria);
        // Keep the textarea's selection: a click must not blur it first.
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', onClick);
        return b;
    }

    function open(opts) {
        if (current) return;
        const { dash, text, max, save, onClose } = opts;
        const t = (key, fallback) => {
            const v = dash?.language?.t?.(key);
            return v && v !== key ? v : fallback;
        };

        const overlay = document.createElement('div');
        overlay.className = 'notes-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', opts.widget?.title || t('dashboard.widgetNotesTitle', 'Notes'));

        const box = document.createElement('div');
        box.className = 'notes-modal';
        box.dataset.tab = 'edit';

        const bar = document.createElement('div');
        bar.className = 'notes-modal-toolbar';
        const tabs = document.createElement('div');
        tabs.className = 'notes-modal-tabs';
        const body = document.createElement('div');
        body.className = 'notes-modal-body';
        const editPane = document.createElement('div');
        editPane.className = 'notes-modal-edit';
        const area = document.createElement('textarea');
        area.className = 'notes-modal-area';
        area.maxLength = max;
        area.value = text;
        area.setAttribute('aria-label', t('dashboard.widgetNotesEditLabel', 'Note text'));
        editPane.appendChild(area);
        const preview = document.createElement('div');
        preview.className = 'notes-modal-preview dashboard-widget-note-lines';
        body.append(editPane, preview);
        const count = document.createElement('span');
        count.className = 'notes-modal-count';

        async function run(name) {
            const sent = { value: area.value, start: area.selectionStart, end: area.selectionEnd };
            let next;
            try {
                next = await global.NotesEngine.command(dash, name, sent, max);
            } catch {
                count.textContent = t('dashboard.widgetNotesOffline', 'Could not reach the server.');
                return;
            }
            // Typing went on while the answer was on its way: that text is
            // newer than this edit, and the edit would overwrite it.
            if (area.value !== sent.value) return;
            if (!next) { count.textContent = t('dashboard.widgetNotesFull', 'Note full'); return; }
            area.value = next.value;
            area.focus();
            area.setSelectionRange(next.start, next.end);
            area.dispatchEvent(new Event('input', { bubbles: true }));
        }

        [
            ['Heading', 'H', 'h1'], ['Bold', 'B', 'bold'], ['Italic', 'I', 'italic'], ['Code', '</>', 'inlinecode'],
            ['Link', 'Link', 'link'], ['Bullet list', '•', 'bullet'], ['Task', '☐', 'todo'], ['Quote', '"', 'quote'],
            ['Table', 'Table', 'table'],
        ].forEach(([name, glyph, command]) => {
            bar.appendChild(button('notes-modal-tool', glyph, t(`dashboard.notesTool.${name}`, name), () => { void run(command); }));
        });
        bar.appendChild(button('notes-modal-tool', '/', t('dashboard.notesTool.Command', 'Command'), () => {
            area.focus();
            const at = area.selectionStart;
            const lead = at === 0 || /[ \t\n]/.test(area.value[at - 1]) ? '' : ' ';
            area.setRangeText(`${lead}/`, at, area.selectionEnd, 'end');
            area.dispatchEvent(new Event('input', { bubbles: true }));
        }));
        bar.appendChild(count);
        bar.appendChild(button('notes-modal-close', '×', t('dashboard.close', 'Close'), () => { void close(); }));

        function switchTab(which) {
            box.dataset.tab = which;
            tabs.querySelectorAll('.notes-modal-tab').forEach((b, i) => b.classList.toggle('is-active', (i === 0) === (which === 'edit')));
        }
        tabs.append(
            button('notes-modal-tab is-active', t('dashboard.widgetNotesEdit', 'Edit'), 'Edit', () => switchTab('edit')),
            button('notes-modal-tab', t('dashboard.widgetNotesPreview', 'Preview'), 'Preview', () => switchTab('preview')));
        box.append(bar, tabs, body);
        overlay.appendChild(box);

        let previewSeq = 0;
        let previewTimer = 0;
        function paint() {
            const mine = ++previewSeq;
            const value = area.value;
            count.textContent = `${[...value].length.toLocaleString()} / ${max.toLocaleString()}`;
            global.NotesEngine.render(dash, value).then(({ blocks }) => {
                if (mine !== previewSeq) return;
                preview.replaceChildren(global.NotesMarkdown.render(blocks, {
                    onTask: (block, input) => {
                        const lines = area.value.split('\n');
                        const at = lines[block.index] === block.raw ? block.index : lines.indexOf(block.raw);
                        if (at < 0) return;
                        lines[at] = lines[at].replace(/\[( |x|X)\]/, `[${input.checked ? 'x' : ' '}]`);
                        area.value = lines.join('\n');
                        area.dispatchEvent(new Event('input', { bubbles: true }));
                    },
                }));
            }).catch(() => {
                if (mine !== previewSeq) return;
                preview.textContent = value;
                count.textContent = t('dashboard.widgetNotesOffline', 'Could not reach the server.');
            });
        }

        let saveTimer = 0;
        let lastSaved = text;
        async function flush() {
            clearTimeout(saveTimer);
            saveTimer = 0;
            if (area.value === lastSaved) return;
            const value = area.value;
            if (await save(value)) lastSaved = value;
        }
        area.addEventListener('input', () => {
            clearTimeout(previewTimer);
            previewTimer = setTimeout(paint, PREVIEW_DELAY_MS);
            clearTimeout(saveTimer);
            saveTimer = setTimeout(flush, SAVE_DELAY_MS);
        });

        const slash = global.NotesSlash.attach(area, {
            dash,
            max,
            t,
            onLimit: () => { count.textContent = t('dashboard.widgetNotesFull', 'Note full'); },
            onError: () => { count.textContent = t('dashboard.widgetNotesOffline', 'Could not reach the server.'); },
        });

        async function close() {
            if (!current) return;
            current = false;
            clearTimeout(previewTimer);
            await flush();
            slash.destroy();
            overlay.remove();
            global.ScrollLock?.release(TOKEN);
            document.removeEventListener('keydown', onKey, true);
            onClose?.();
        }
        function onKey(e) {
            // An open slash menu has the first Escape.
            if (e.key === 'Escape' && overlay.querySelector('.notes-slash-menu:not([hidden])')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                void close();
            } else if (e.key === 'Tab') {
                global.FocusTrapUtils?.trapTabKey?.(e, overlay);
            }
        }

        document.body.appendChild(overlay);
        global.ScrollLock?.acquire(TOKEN);
        document.addEventListener('keydown', onKey, true);
        current = true;
        paint();
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
    }

    global.NotesModal = { open };
})(window);
