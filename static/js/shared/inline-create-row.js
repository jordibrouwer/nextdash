/**
 * The name-a-new-page / name-a-new-category row.
 *
 * The bookmark form grew this shape first: a text input with Create and Cancel
 * beside it, and a conflict message that drops onto its own line. It is now the
 * one gesture for "make a page or a category" wherever that is offered — the
 * form's dropdowns, the pages overlay, the grid's category placeholder — so the
 * markup lives here rather than in any one caller's closure.
 *
 * The classes stay the bookmark form's (.bookmark-inline-create*): they are what
 * the stylesheet targets, and a second set of names for the same visual row is
 * how two surfaces drift apart.
 */
(function () {
    'use strict';

    /**
     * Build the row. `labels` supplies the already-translated strings, so this
     * module never has to know how a caller resolves them.
     *
     * Returns the parts the caller wires up: `{ box, input, okBtn, cancelBtn, error }`.
     */
    function createInlineCreateRow({ kind, placeholder, labels = {} } = {}) {
        const box = document.createElement('div');
        box.className = 'bookmark-inline-create';
        if (kind) {
            box.dataset.createKind = kind;
        }
        box.hidden = true;
        // The row appears in place of a control the user just activated, so it is
        // announced as a group rather than as three loose widgets.
        box.setAttribute('role', 'group');
        if (labels.group) {
            box.setAttribute('aria-label', labels.group);
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'bookmark-inline-input bookmark-inline-create-input';
        input.placeholder = placeholder || '';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.maxLength = 60;
        // A placeholder is not a label: without this the field is announced as
        // unnamed. Falls back to the placeholder text, which is always set by
        // every caller and already says what the field is for.
        input.setAttribute('aria-label', labels.input || placeholder || '');

        // Deliberately not .bookmark-inline-action-btn: that class marks the
        // form's own footer buttons (save / cancel / delete), and a second pair
        // wearing it would make "the form's cancel button" ambiguous. These get
        // their own class and borrow the styling instead.
        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'bookmark-inline-create-btn bookmark-inline-create-ok';
        okBtn.textContent = labels.create || 'Create';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'bookmark-inline-create-btn bookmark-inline-create-cancel';
        cancelBtn.textContent = labels.cancel || 'Cancel';

        const error = document.createElement('span');
        error.className = 'bookmark-inline-conflict';
        error.hidden = true;
        // "That page already exists" is the one thing here a screen reader user
        // would otherwise miss entirely: focus stays in the input, so nothing
        // announces the failure without a live region.
        error.setAttribute('role', 'status');
        error.setAttribute('aria-live', 'polite');

        box.append(input, okBtn, cancelBtn, error);
        return { box, input, okBtn, cancelBtn, error };
    }

    /**
     * Wire the row's three ways to confirm and two ways to back out.
     *
     * `submit(name)` returns a message to show the user, or a falsy value when
     * the create succeeded. It is awaited with the Create button disabled, so a
     * slow POST cannot be fired twice.
     *
     * Enter and Escape are stopped here. Every surface that hosts this row sits
     * inside something that already binds them — the bookmark form saves on
     * Enter, the modal closes on Escape — and while the row is open it owns both.
     */
    function wireInlineCreateRow(ui, { submit, onCancel } = {}) {
        const run = async () => {
            const name = ui.input.value.trim();
            if (!name) {
                ui.input.focus({ preventScroll: true });
                return;
            }
            ui.okBtn.disabled = true;
            try {
                const failure = await submit(name);
                if (failure) {
                    ui.error.textContent = failure;
                    ui.error.hidden = false;
                    ui.input.focus({ preventScroll: true });
                }
            } finally {
                ui.okBtn.disabled = false;
            }
        };

        ui.okBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            void run();
        });
        ui.cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onCancel?.();
        });
        ui.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                void run();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onCancel?.();
            }
        });

        return { run };
    }

    window.InlineCreateRow = { create: createInlineCreateRow, wire: wireInlineCreateRow };
})();
