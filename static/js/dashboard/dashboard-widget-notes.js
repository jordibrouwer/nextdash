/**
 * The notes widget: a few lines of text, some of them tickable.
 *
 * A homelab page has things to do that are not links -- close a port, swap a
 * disk -- and they ended up in another program beside the dashboard that is
 * already open. One text, stored in the widget itself, written in a small
 * Markdown: a line that starts with `[ ]` or `[x]` is a checkbox, and headings,
 * lists, quotes, code and tables draw as such. Ticking rewrites that one line,
 * so what is saved is still plain text you can read in the editor. The text is
 * worked out through NotesEngine -- on the server, or in the browser when
 * Config says so -- and this file only draws what comes back.
 */
(function () {
    'use strict';

    const U = () => window.DashboardWidgetUtils;
    const MAX = 6000;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    /** The text as the widget has it now: saving replaces the widget object. */
    function currentText(dash, widget) {
        const live = (dash.widgets || []).find((w) => String(w?.id) === String(widget?.id)) || widget;
        const text = live?.config?.text;
        return typeof text === 'string' ? text : '';
    }

    function save(dash, widget, text) {
        const trimmed = String(text || '').replace(/\s+$/, '');
        return dash.renderCore?.saveWidgetPatch?.(widget.id, {
            config: { text: trimmed === '' ? undefined : trimmed },
        });
    }

    function draw(body, widget, dash) {
        const u = U();
        const panel = u.panel(body);
        const text = currentText(dash, widget);
        const lines = text === '' ? [] : text.split('\n');

        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'dashboard-widget-note-edit';
        edit.textContent = label(dash, 'dashboard.widgetNotesEdit', 'Edit');
        edit.addEventListener('click', () => startEdit(body, widget, dash));

        const actions = document.createElement('div');
        actions.className = 'dashboard-widget-note-actions';
        const expand = document.createElement('button');
        expand.type = 'button';
        expand.className = 'dashboard-widget-note-expand';
        expand.textContent = label(dash, 'dashboard.widgetNotesExpand', 'Open large');
        expand.addEventListener('click', () => openModal(body, widget, dash));
        actions.append(edit, expand);

        if (!lines.length) {
            const empty = u.say(panel, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetNotesEmpty', 'Nothing written yet. Start a line with [ ] for a checkbox.'));
            empty.after(actions);
            return;
        }

        const list = document.createElement('div');
        list.className = 'dashboard-widget-note-lines';
        panel.appendChild(list);
        // Only shown two columns wide: the count and the progress are more of
        // the reading, which a single column has no room for.
        const stat = document.createElement('span');
        stat.className = 'dashboard-widget-note-stats dashboard-widget-wide-only';
        actions.appendChild(stat);
        panel.appendChild(actions);

        const onTask = async (block, input, row) => {
            const fresh = currentText(dash, widget).split('\n');
            // The line as it was drawn: the text may have changed since
            // (another tab), and by position alone the wrong line was
            // ticked, or one past the end threw and nothing was saved.
            const at = fresh[block.index] === block.raw ? block.index : fresh.indexOf(block.raw);
            if (at < 0) {
                draw(body, widget, dash);
                return;
            }
            const mark = input.checked ? 'x' : ' ';
            fresh[at] = fresh[at].replace(/\[( |x|X)\]/, `[${mark}]`);
            row.classList.toggle('dashboard-widget-note-done', input.checked);
            if (!await save(dash, widget, fresh.join('\n'))) draw(body, widget, dash);
        };

        window.NotesEngine.render(dash, text).then(({ blocks, stats }) => {
            if (!list.isConnected) return;
            list.replaceChildren(window.NotesMarkdown.render(blocks, { onTask }));
            const parts = [`${stats.chars.toLocaleString()} / ${MAX.toLocaleString()}`];
            if (stats.tasksTotal) {
                parts.push(label(dash, 'dashboard.widgetNotesTasks', '{done} of {total} tasks')
                    .replace('{done}', String(stats.tasksDone)).replace('{total}', String(stats.tasksTotal)));
            }
            stat.textContent = parts.join(' · ');
        }).catch(() => {
            // The server could not be asked. Say so and show the words as they
            // are, rather than quietly working them out here: the setting
            // says where notes are processed, and that is not here.
            if (!list.isConnected) return;
            list.replaceChildren(...lines.map((line) => {
                const p = document.createElement('p');
                p.className = 'dashboard-widget-note-text';
                p.textContent = line;
                if (line.trim() === '') p.classList.add('dashboard-widget-note-gap');
                return p;
            }));
            const hint = document.createElement('p');
            hint.className = 'dashboard-widget-note-hint';
            hint.textContent = label(dash, 'dashboard.widgetNotesOfflinePlain', 'Could not reach the server. Showing plain text.');
            list.appendChild(hint);
        });
    }

    function openModal(body, widget, dash) {
        window.NotesModal?.open?.({
            dash,
            widget,
            text: currentText(dash, widget),
            max: MAX,
            save: (text) => save(dash, widget, text),
            onClose: () => draw(body, widget, dash),
        });
    }

    function startEdit(body, widget, dash) {
        const u = U();
        const panel = u.panel(body);
        const area = document.createElement('textarea');
        area.className = 'dashboard-widget-note-area';
        area.value = currentText(dash, widget);
        area.rows = Math.min(Math.max(area.value.split('\n').length + 1, 4), 14);
        area.maxLength = MAX;
        area.setAttribute('aria-label', label(dash, 'dashboard.widgetNotesEditLabel', 'Note text'));
        panel.appendChild(area);

        const hint = document.createElement('p');
        hint.className = 'dashboard-widget-note-hint';
        hint.textContent = label(dash, 'dashboard.widgetNotesHint', 'Ctrl+Enter saves, Escape cancels.');
        panel.appendChild(hint);

        // Registered before the keys below, in the capture phase: while its
        // menu is open, Escape and Enter are the menu's, not the editor's.
        const slash = window.NotesSlash?.attach(area, {
            dash,
            max: MAX,
            t: (key, fallback) => label(dash, key, fallback),
            onLimit: () => { hint.textContent = label(dash, 'dashboard.widgetNotesFull', 'Note full'); },
            onError: () => { hint.textContent = label(dash, 'dashboard.widgetNotesOfflinePlain', 'Could not reach the server. Showing plain text.'); },
        });

        let done = false;
        const finish = async (keep) => {
            if (done) return;
            done = true;
            slash?.destroy();
            if (keep && area.value !== currentText(dash, widget)) await save(dash, widget, area.value);
            draw(body, widget, dash);
        };
        area.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                void finish(false);
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void finish(true);
            }
        });
        area.addEventListener('blur', () => { void finish(true); });
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
    }

    function render(body, widget, dash) {
        body.replaceChildren();
        draw(body, widget, dash);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.notes = render;
})();
