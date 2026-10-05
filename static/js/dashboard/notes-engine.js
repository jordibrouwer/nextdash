/**
 * The one place the notes widget asks for processing.
 *
 * "On the server" (the default) posts text to the notes endpoints and draws what
 * comes back; "In the browser" (Config) runs the same work here, with no
 * request at all. The widget, the slash menu and the modal never choose: they
 * call this and get the same shape either way.
 */
(function (global) {
    'use strict';

    const CACHE_MAX = 40;
    const cache = new Map();

    function mode(dash) {
        return dash?.settings?.notesProcessing === 'client' ? 'client' : 'server';
    }

    async function post(path, body) {
        const headers = { 'Content-Type': 'application/json' };
        if (typeof nextDashWriteHeaders === 'function') Object.assign(headers, nextDashWriteHeaders());
        const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async function render(dash, text) {
        if (mode(dash) === 'client') {
            return { blocks: global.NotesMarkdown.parse(text), stats: global.NotesMarkdown.stats(text) };
        }
        if (cache.has(text)) return cache.get(text);
        const out = await post('/api/widgets/notes/render', { text });
        cache.set(text, out);
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
        return out;
    }

    async function command(dash, name, state, max) {
        if (mode(dash) === 'client') {
            const cmd = global.NotesSlash.COMMANDS.find((c) => c.name === name);
            if (!cmd) throw new Error(`Unknown command ${name}`);
            return cmd.run({ value: state.value, start: state.start, end: state.end }, max);
        }
        const out = await post('/api/widgets/notes/command', {
            command: name,
            value: state.value,
            start: state.start,
            end: state.end,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
            offsetMinutes: new Date().getTimezoneOffset(),
        });
        return out.error ? null : { value: out.value, start: out.start, end: out.end };
    }

    global.NotesEngine = { mode, render, command };
})(window);
