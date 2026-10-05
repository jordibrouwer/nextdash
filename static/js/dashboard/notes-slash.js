/**
 * Edits and slash commands for the notes editors, the browser's copy.
 *
 * The default setting runs these on the server (internal/app/notes_commands.go);
 * "In the browser" runs them here. `ops` take {value, start, end} and give the
 * next one, or null when the text would outgrow the limit. Offsets are UTF-16
 * code units, as selectionStart gives them. tests/fixtures/notes-command-cases.json
 * holds both implementations to the same answers. The menu that picks a command
 * is `attach`, at the end of this file.
 */
(function (global) {
    'use strict';

    const pad = (n) => String(n).padStart(2, '0');
    const length = (value) => [...value].length;

    function fit(value, caret, max) {
        return length(value) > max ? null : { value, start: caret, end: caret };
    }

    function insert(state, text, max) {
        const value = state.value.slice(0, state.start) + text + state.value.slice(state.end);
        return fit(value, state.start + text.length, max);
    }

    function lineRange(state) {
        const from = state.start === 0 ? 0 : state.value.lastIndexOf('\n', state.start - 1) + 1;
        const nl = state.value.indexOf('\n', state.end);
        return { from, to: nl < 0 ? state.value.length : nl };
    }

    function mapSelection(state, fn, max) {
        const selected = state.start !== state.end;
        const { from, to } = selected ? { from: state.start, to: state.end } : lineRange(state);
        const next = fn(state.value.slice(from, to));
        const result = fit(state.value.slice(0, from) + next + state.value.slice(to), from + next.length, max);
        if (result && selected) result.start = from;
        return result;
    }

    function wrap(state, before, after, max) {
        const chosen = state.value.slice(state.start, state.end);
        const value = state.value.slice(0, state.start) + before + chosen + after + state.value.slice(state.end);
        return fit(value, state.start + before.length + chosen.length, max);
    }

    function prefixLines(state, prefix, max) {
        const { from, to } = lineRange(state);
        const next = state.value.slice(from, to).split('\n').map((l) => prefix + l).join('\n');
        return fit(state.value.slice(0, from) + next + state.value.slice(to), from + next.length, max);
    }

    function uuid() {
        if (global.crypto?.randomUUID) return global.crypto.randomUUID();
        const b = global.crypto.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }

    const title = (s) => s.toLowerCase().replace(/(^|[ \t\r\n])([^ \t\r\n])/g, (m, sp, ch) => sp + ch.toUpperCase());

    const COMMANDS = [
        { name: 'date', label: 'Insert today\'s date', run: (s, max) => { const d = new Date(); return insert(s, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, max); } },
        { name: 'time', label: 'Insert the time', run: (s, max) => { const d = new Date(); return insert(s, `${pad(d.getHours())}:${pad(d.getMinutes())}`, max); } },
        { name: 'uuid', label: 'Insert a random UUID', run: (s, max) => insert(s, uuid(), max) },
        { name: 'upper', label: 'UPPERCASE', run: (s, max) => mapSelection(s, (t) => t.toUpperCase(), max) },
        { name: 'lower', label: 'lowercase', run: (s, max) => mapSelection(s, (t) => t.toLowerCase(), max) },
        { name: 'title', label: 'Title Case', run: (s, max) => mapSelection(s, title, max) },
        { name: 'todo', label: 'Checkbox', run: (s, max) => prefixLines(s, '[ ] ', max) },
        { name: 'h1', label: 'Heading', run: (s, max) => prefixLines(s, '# ', max) },
        { name: 'code', label: 'Code block', run: (s, max) => { const r = insert(s, '```\n\n```', max); if (r) r.start = r.end = s.start + 4; return r; } },
        { name: 'table', label: 'Table', run: (s, max) => insert(s, '| Column | Column |\n| --- | --- |\n|  |  |\n', max) },
        { name: 'bold', label: 'Bold', menu: false, run: (s, max) => wrap(s, '**', '**', max) },
        { name: 'italic', label: 'Italic', menu: false, run: (s, max) => wrap(s, '*', '*', max) },
        { name: 'inlinecode', label: 'Inline code', menu: false, run: (s, max) => wrap(s, '`', '`', max) },
        { name: 'link', label: 'Link', menu: false, run: (s, max) => wrap(s, '[', '](https://)', max) },
        { name: 'bullet', label: 'Bullet list', menu: false, run: (s, max) => prefixLines(s, '- ', max) },
        { name: 'quote', label: 'Quote', menu: false, run: (s, max) => prefixLines(s, '> ', max) },
    ];

    function attach(area, options = {}) {
        const max = options.max || 6000;
        const t = options.t || ((key, fallback) => fallback);
        const menu = document.createElement('div');
        menu.className = 'notes-slash-menu';
        menu.setAttribute('role', 'listbox');
        menu.hidden = true;
        // The menu lives beside the textarea, so a click in it is not a click
        // outside the editor.
        area.parentNode.style.position = area.parentNode.style.position || 'relative';
        area.parentNode.appendChild(menu);

        let matches = [];
        let active = 0;
        let tokenStart = -1;

        function close() { menu.hidden = true; matches = []; tokenStart = -1; active = 0; }

        function draw() {
            menu.replaceChildren();
            matches.forEach((cmd, i) => {
                const row = document.createElement('div');
                row.setAttribute('role', 'option');
                row.className = 'notes-slash-item';
                row.setAttribute('aria-selected', i === active ? 'true' : 'false');
                const name = document.createElement('span');
                name.textContent = `/${cmd.name}`;
                const hint = document.createElement('span');
                hint.className = 'notes-slash-hint';
                hint.textContent = t(`dashboard.notesSlash.${cmd.name}`, cmd.label);
                row.append(name, hint);
                row.addEventListener('mousedown', (e) => { e.preventDefault(); void choose(i); });
                menu.appendChild(row);
            });
            const line = area.value.slice(0, area.selectionStart).split('\n').length;
            const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 20;
            const top = area.offsetTop + Math.min(line * lineHeight - area.scrollTop, area.clientHeight - 8);
            menu.style.top = `${top}px`;
            menu.style.left = `${area.offsetLeft + 8}px`;
            menu.hidden = false;
        }

        function refresh() {
            const caret = area.selectionStart;
            if (caret !== area.selectionEnd) { close(); return; }
            const m = /(^|[ \t\n])\/([a-z0-9]*)$/.exec(area.value.slice(0, caret));
            if (!m) { close(); return; }
            tokenStart = caret - m[2].length - 1;
            matches = COMMANDS.filter((c) => c.menu !== false && c.name.startsWith(m[2]));
            if (!matches.length) { close(); return; }
            active = Math.min(active, matches.length - 1);
            draw();
        }

        async function choose(i) {
            const cmd = matches[i];
            if (!cmd) return;
            const caret = area.selectionStart;
            // close() forgets the token, and the check after the answer needs it.
            const from = tokenStart;
            const sent = {
                value: area.value.slice(0, from) + area.value.slice(caret),
                start: from,
                end: from,
            };
            close();
            let next;
            try {
                next = await global.NotesEngine.command(options.dash, cmd.name, sent, max);
            } catch {
                options.onError?.();
                return;
            }
            // Typing went on while the answer was on its way: that text is
            // newer than this edit, and the edit would overwrite it.
            if (area.value.slice(0, from) + area.value.slice(caret) !== sent.value) return;
            if (!next) { options.onLimit?.(); return; }
            area.value = next.value;
            area.setSelectionRange(next.start, next.end);
            area.dispatchEvent(new Event('input', { bubbles: true }));
        }

        area.addEventListener('input', refresh);
        area.addEventListener('keydown', (e) => {
            if (menu.hidden) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                close();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                active = (active + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
                draw();
            } else if ((e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                void choose(active);
            }
        }, true);
        area.addEventListener('blur', close);

        return { destroy() { menu.remove(); } };
    }

    global.NotesSlash = { ops: { insert, mapSelection, wrap, prefixLines }, COMMANDS, attach };
})(window);
