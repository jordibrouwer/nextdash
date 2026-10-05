/**
 * Markdown for the notes widget: the browser's engine and the renderer.
 *
 * `parse` and `stats` are the "In the browser" setting's engine; the default,
 * "On the server", gets the same blocks from /api/widgets/notes/render
 * (internal/app/notes_markdown.go). Both are held to
 * tests/fixtures/notes-markdown-cases.json, so they agree. `render` draws
 * blocks from either: DOM nodes and textContent only, so a note can hold any
 * text without it ever becoming markup. Whitespace in the patterns is ASCII,
 * as on the server.
 */
(function (global) {
    'use strict';

    const TASK = /^[ \t]*(?:[-*][ \t]+)?\[( |x|X)\][ \t]?([^\n]*)$/;
    const HEADING = /^(#{1,3})[ \t]+([^\n]*)$/;
    const BULLET = /^[ \t]*[-*][ \t]+([^\n]*)$/;
    const ORDERED = /^[ \t]*\d+[.)][ \t]+([^\n]*)$/;
    const QUOTE = /^>[ \t]?([^\n]*)$/;
    const TABLE_ROW = /^[ \t]*\|[^\n]*\|[ \t]*$/;
    const TABLE_SEP = /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/;
    const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^* \t\r\n][^*]*\*)|(\[[^\]]+\]\([^) \t\r\n]+\))/g;
    const HTTP = /^https?:\/\/[^ \t\r\n]+$/i;
    const RELATIVE = /^\.{1,2}\/[^ \t\r\n]*$/;

    function safeHref(url) {
        const value = String(url || '');
        if (HTTP.test(value) || RELATIVE.test(value)) return value;
        if (value.startsWith('/') && !value.startsWith('//') && !/[ \t\r\n]/.test(value)) return value;
        return null;
    }

    function inline(text) {
        const out = [];
        let last = 0;
        const source = String(text || '');
        source.replace(INLINE, (match, code, bold, italic, link, offset) => {
            if (offset > last) out.push({ t: 'text', v: source.slice(last, offset) });
            if (code) {
                out.push({ t: 'code', v: code.slice(1, -1) });
            } else if (bold) {
                out.push({ t: 'bold', v: bold.slice(2, -2) });
            } else if (italic) {
                out.push({ t: 'italic', v: italic.slice(1, -1) });
            } else {
                const mid = link.indexOf('](');
                const href = safeHref(link.slice(mid + 2, -1));
                out.push(href ? { t: 'link', v: link.slice(1, mid), href } : { t: 'text', v: link });
            }
            last = offset + match.length;
            return match;
        });
        if (last < source.length) out.push({ t: 'text', v: source.slice(last) });
        return out;
    }

    function cells(row) {
        let value = row.trim();
        if (value.startsWith('|')) value = value.slice(1);
        if (value.endsWith('|')) value = value.slice(0, -1);
        return value.split('|').map((c) => inline(c.trim()));
    }

    function parse(text) {
        const source = String(text || '').replace(/\r\n/g, '\n');
        if (source === '') return [];
        const lines = source.split('\n');
        const blocks = [];
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            if (line.trim() === '') { blocks.push({ type: 'gap' }); continue; }
            const task = TASK.exec(line);
            if (task) {
                blocks.push({ type: 'task', checked: task[1] !== ' ', spans: inline(task[2]), index: i, raw: line });
                continue;
            }
            if (line.startsWith('```')) {
                let end = -1;
                for (let j = i + 1; j < lines.length; j += 1) {
                    if (lines[j].startsWith('```')) { end = j; break; }
                }
                if (end > i) {
                    blocks.push({ type: 'code', text: lines.slice(i + 1, end).join('\n') });
                    i = end;
                    continue;
                }
                blocks.push({ type: 'para', spans: inline(line) });
                continue;
            }
            const heading = HEADING.exec(line);
            if (heading) { blocks.push({ type: 'heading', level: heading[1].length, spans: inline(heading[2]) }); continue; }
            if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
                const rows = [];
                let j = i + 2;
                while (j < lines.length && TABLE_ROW.test(lines[j])) { rows.push(cells(lines[j])); j += 1; }
                blocks.push({ type: 'table', head: cells(line), rows });
                i = j - 1;
                continue;
            }
            const quote = QUOTE.exec(line);
            if (quote) {
                const last = blocks[blocks.length - 1];
                if (last && last.type === 'quote') last.lines.push(inline(quote[1]));
                else blocks.push({ type: 'quote', lines: [inline(quote[1])] });
                continue;
            }
            const bullet = BULLET.exec(line);
            const ordered = bullet ? null : ORDERED.exec(line);
            if (bullet || ordered) {
                const isOrdered = !bullet;
                const item = inline((bullet || ordered)[1]);
                const last = blocks[blocks.length - 1];
                if (last && last.type === 'list' && last.ordered === isOrdered) last.items.push(item);
                else blocks.push({ type: 'list', ordered: isOrdered, items: [item] });
                continue;
            }
            blocks.push({ type: 'para', spans: inline(line) });
        }
        return blocks;
    }

    function stats(text) {
        const value = String(text || '');
        const tasks = parse(value).filter((b) => b.type === 'task');
        return {
            chars: [...value].length,
            tasksDone: tasks.filter((t) => t.checked).length,
            tasksTotal: tasks.length,
        };
    }

    function el(tag, className) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        return node;
    }

    function appendSpans(parent, spans) {
        (spans || []).forEach((span) => {
            if (span.t === 'text') { parent.appendChild(document.createTextNode(span.v)); return; }
            const node = document.createElement({ code: 'code', bold: 'strong', italic: 'em', link: 'a' }[span.t] || 'span');
            node.textContent = span.v;
            if (span.t === 'link') {
                const href = safeHref(span.href);
                if (href) {
                    node.href = href;
                    node.target = '_blank';
                    node.rel = 'noopener noreferrer';
                }
            }
            parent.appendChild(node);
        });
    }

    function render(blocks, options = {}) {
        const frag = document.createDocumentFragment();
        (blocks || []).forEach((block) => {
            if (block.type === 'gap') {
                frag.appendChild(el('p', 'dashboard-widget-note-text dashboard-widget-note-gap'));
            } else if (block.type === 'para') {
                const p = el('p', 'dashboard-widget-note-text');
                appendSpans(p, block.spans);
                frag.appendChild(p);
            } else if (block.type === 'heading') {
                const h = el('p', `dashboard-widget-note-heading dashboard-widget-note-h${block.level}`);
                appendSpans(h, block.spans);
                frag.appendChild(h);
            } else if (block.type === 'task') {
                const row = el('label', 'dashboard-widget-note-task');
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = Boolean(block.checked);
                const span = document.createElement('span');
                appendSpans(span, block.spans);
                if (input.checked) row.classList.add('dashboard-widget-note-done');
                input.addEventListener('change', () => options.onTask?.(block, input, row));
                row.append(input, span);
                frag.appendChild(row);
            } else if (block.type === 'list') {
                const list = el(block.ordered ? 'ol' : 'ul', 'dashboard-widget-note-list');
                block.items.forEach((item) => { const li = document.createElement('li'); appendSpans(li, item); list.appendChild(li); });
                frag.appendChild(list);
            } else if (block.type === 'quote') {
                const q = el('blockquote', 'dashboard-widget-note-quote');
                block.lines.forEach((line, n) => {
                    if (n) q.appendChild(document.createElement('br'));
                    appendSpans(q, line);
                });
                frag.appendChild(q);
            } else if (block.type === 'code') {
                const pre = el('pre', 'dashboard-widget-note-code');
                const code = document.createElement('code');
                code.textContent = block.text;
                pre.appendChild(code);
                frag.appendChild(pre);
            } else if (block.type === 'table') {
                const wrap = el('div', 'dashboard-widget-note-table-wrap');
                const table = el('table', 'dashboard-widget-note-table');
                const head = document.createElement('tr');
                block.head.forEach((c) => { const th = document.createElement('th'); appendSpans(th, c); head.appendChild(th); });
                table.appendChild(head);
                block.rows.forEach((row) => {
                    const tr = document.createElement('tr');
                    row.forEach((c) => { const td = document.createElement('td'); appendSpans(td, c); tr.appendChild(td); });
                    table.appendChild(tr);
                });
                wrap.appendChild(table);
                frag.appendChild(wrap);
            }
        });
        return frag;
    }

    global.NotesMarkdown = { parse, stats, inline, render, safeHref };
})(window);
