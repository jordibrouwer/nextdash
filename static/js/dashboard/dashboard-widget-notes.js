/**
 * The notes widget: a few lines of text, some of them tickable.
 *
 * A homelab page has things to do that are not links -- close a port, swap a
 * disk -- and they ended up in another program beside the dashboard that is
 * already open. One text, stored in the widget itself. A line that starts with
 * `[ ]` or `[x]` is a checkbox; every other line is text. Ticking rewrites that
 * one line, so what is saved is still plain text you can read in the editor.
 */
(function () {
    'use strict';

    const U = () => window.DashboardWidgetUtils;
    const BOX = /^\s*(?:[-*]\s+)?\[( |x|X)\]\s?(.*)$/;

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

        if (!lines.length) {
            const empty = u.say(panel, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetNotesEmpty', 'Nothing written yet. Start a line with [ ] for a checkbox.'));
            empty.after(edit);
            return;
        }

        const list = document.createElement('div');
        list.className = 'dashboard-widget-note-lines';
        lines.forEach((line, index) => {
            const box = BOX.exec(line);
            if (!box) {
                const p = document.createElement('p');
                p.className = 'dashboard-widget-note-text';
                p.textContent = line;
                if (line.trim() === '') p.classList.add('dashboard-widget-note-gap');
                list.appendChild(p);
                return;
            }
            const row = document.createElement('label');
            row.className = 'dashboard-widget-note-task';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = box[1] !== ' ';
            const span = document.createElement('span');
            span.textContent = box[2];
            if (input.checked) row.classList.add('dashboard-widget-note-done');
            input.addEventListener('change', async () => {
                const fresh = currentText(dash, widget).split('\n');
                // The line as it was drawn: the text may have changed since
                // (another tab), and by position alone the wrong line was
                // ticked, or one past the end threw and nothing was saved.
                const at = fresh[index] === line ? index : fresh.indexOf(line);
                if (at < 0) {
                    draw(body, widget, dash);
                    return;
                }
                const mark = input.checked ? 'x' : ' ';
                fresh[at] = fresh[at].replace(/\[( |x|X)\]/, `[${mark}]`);
                row.classList.toggle('dashboard-widget-note-done', input.checked);
                if (!await save(dash, widget, fresh.join('\n'))) draw(body, widget, dash);
            });
            row.append(input, span);
            list.appendChild(row);
        });
        panel.appendChild(list);
        panel.appendChild(edit);
    }

    function startEdit(body, widget, dash) {
        const u = U();
        const panel = u.panel(body);
        const area = document.createElement('textarea');
        area.className = 'dashboard-widget-note-area';
        area.value = currentText(dash, widget);
        area.rows = Math.min(Math.max(area.value.split('\n').length + 1, 4), 14);
        area.maxLength = 4000;
        area.setAttribute('aria-label', label(dash, 'dashboard.widgetNotesEditLabel', 'Note text'));
        panel.appendChild(area);

        const hint = document.createElement('p');
        hint.className = 'dashboard-widget-note-hint';
        hint.textContent = label(dash, 'dashboard.widgetNotesHint', 'Ctrl+Enter saves, Escape cancels.');
        panel.appendChild(hint);

        let done = false;
        const finish = async (keep) => {
            if (done) return;
            done = true;
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
