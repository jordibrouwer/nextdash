/**
 * The title-cleanup fields, shared by the RSS widget's settings and the
 * per-feed settings of Watch feeds: a pattern cut out of every title, what
 * goes in its place, a Suggest button, and the first title shown before and
 * after.
 *
 * One block drawn the same in both places, and one set of listeners on the
 * document rather than per panel, because both panels are painted again
 * whenever their data changes and a listener bound to the old nodes would go
 * with them. The block says where its titles come from in data attributes; the
 * panel around it owns what happens to the values (the widget's draft and Save
 * bar, or the watch's own Save button).
 *
 * The pattern is checked on the server (POST /api/title-rewrite), never here:
 * the server is what applies it, and its regular expressions are not the
 * browser's, so a pattern the page accepted could be one the save refuses.
 */
(function (global) {
    'use strict';

    const MAX_LENGTH = 200;
    const PREVIEW_DELAY_MS = 300;

    function t(key, fallback) {
        const lang = global.dashboardInstance?.language;
        if (lang?.t) {
            const value = lang.t(key);
            if (value && value !== key) return value;
        }
        return fallback;
    }

    const esc = (value) => global.NextDashHtml.escapeHtml(String(value ?? ''));

    /**
     * The block. `findAttrs` and `replaceAttrs` are extra attributes for the
     * two inputs (the widget panel's draft wiring); `source` says where the
     * titles to try the pattern on come from; `save` adds the Save button the
     * watch panel uses, where nothing else commits a change.
     */
    function render({ id, find = '', replace = '', findAttrs = '', replaceAttrs = '', source = '', save = false }) {
        return `
            <div class="trf" data-trf ${source}>
                <div class="trf-head">
                    <label for="${esc(id)}-find">${esc(t('config.titleRewriteFind', 'Title: remove or find'))}</label>
                    <button type="button" class="config-btn config-btn--small" data-trf-suggest>${esc(t('config.titleRewriteSuggest', 'Suggest'))}</button>
                </div>
                <input type="text" id="${esc(id)}-find" class="config-text trf-input" data-trf-find ${findAttrs}
                    maxlength="${MAX_LENGTH}" value="${esc(find)}" spellcheck="false" autocomplete="off"
                    placeholder="${esc(t('config.titleRewriteFindPlaceholder', '^NCSC-\\d+-\\d+ '))}">
                <p class="trf-hint">${esc(t('config.titleRewriteFindHint', 'Regular expression. The matching part is removed.'))}</p>
                <label for="${esc(id)}-replace">${esc(t('config.titleRewriteReplace', 'Replace with'))}</label>
                <input type="text" id="${esc(id)}-replace" class="config-text trf-input" data-trf-replace ${replaceAttrs}
                    maxlength="${MAX_LENGTH}" value="${esc(replace)}" spellcheck="false" autocomplete="off"
                    placeholder="${esc(t('config.titleRewriteReplacePlaceholder', 'Leave empty to remove'))}">
                <p class="trf-error" data-trf-error role="alert" hidden></p>
                <p class="trf-status" data-trf-status role="status" aria-live="polite" hidden></p>
                <div class="trf-preview" data-trf-preview hidden>
                    <p class="trf-caption">${esc(t('config.titleRewriteFirst', 'First title in this feed'))}</p>
                    <p class="trf-before" data-trf-before></p>
                    <p class="trf-after" data-trf-after></p>
                </div>
                ${save ? `<div class="trf-actions"><button type="button" class="config-btn config-btn--small" data-trf-save>${esc(t('config.titleRewriteSave', 'Save'))}</button></div>` : ''}
            </div>`;
    }

    // Titles to try the pattern on, fetched once per block and kept until the
    // block is replaced by a repaint (which brings its own).
    const titlesOf = new WeakMap();

    async function fetchTitles(block) {
        try {
            if (block.hasAttribute('data-trf-widget')) {
                const page = block.getAttribute('data-trf-page');
                const widget = block.getAttribute('data-trf-widget');
                const res = await fetch(`/api/widgets/rss?pageId=${encodeURIComponent(page)}&id=${encodeURIComponent(widget)}&raw=1`);
                if (!res.ok) return [];
                const data = await res.json();
                return (data.items || []).map((item) => String(item.title || '')).filter(Boolean);
            }
            if (block.hasAttribute('data-trf-key')) {
                const key = block.getAttribute('data-trf-key');
                const feed = block.getAttribute('data-trf-feed');
                const res = await fetch(`/api/feeds/watch/items?key=${encodeURIComponent(key)}&raw=1`);
                if (!res.ok) return [];
                const data = await res.json();
                const all = [...(data.items || []), ...(data.recent || [])];
                return all.filter((item) => !feed || item.feedUrl === feed)
                    .map((item) => String(item.title || '')).filter(Boolean);
            }
        } catch { /* offline: the block simply has nothing to try the pattern on */ }
        return [];
    }

    function titles(block) {
        if (!titlesOf.has(block)) titlesOf.set(block, fetchTitles(block));
        return titlesOf.get(block);
    }

    async function ask(block, { suggest = false } = {}) {
        const list = await titles(block);
        const body = {
            find: block.querySelector('[data-trf-find]')?.value || '',
            replace: block.querySelector('[data-trf-replace]')?.value || '',
            titles: list,
            suggest,
        };
        const res = await fetch('/api/title-rewrite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(String(res.status));
        return { list, answer: await res.json() };
    }

    function setText(block, selector, text) {
        const node = block.querySelector(selector);
        if (!node) return;
        node.textContent = text || '';
        node.hidden = !text;
    }

    async function refresh(block) {
        const find = block.querySelector('[data-trf-find]')?.value.trim() || '';
        const sequence = (block._trfSeq = (block._trfSeq || 0) + 1);
        let result;
        try { result = await ask(block); } catch { return; }
        // A later keystroke has already asked again; its answer is the one.
        if (sequence !== block._trfSeq) return;
        const { list, answer } = result;
        setText(block, '[data-trf-status]', '');
        const preview = block.querySelector('[data-trf-preview]');
        if (answer.error) {
            setText(block, '[data-trf-error]', answer.error === 'too-long'
                ? t('config.titleRewriteTooLong', 'That pattern is too long.')
                : t('config.titleRewriteBad', "That isn't a valid pattern. Check the brackets."));
            if (preview) preview.hidden = true;
            return;
        }
        setText(block, '[data-trf-error]', '');
        if (!find || !list.length) { if (preview) preview.hidden = true; return; }
        // The first title the pattern changes; the first at all when it changes none.
        let at = answer.results.findIndex((out, i) => out !== list[i]);
        const changed = at >= 0;
        if (!changed) at = 0;
        block.querySelector('[data-trf-before]').textContent = list[at];
        block.querySelector('[data-trf-after]').textContent = changed
            ? answer.results[at]
            : t('config.titleRewriteNoChange', 'No change to this title.');
        if (preview) preview.hidden = false;
    }

    async function suggest(block) {
        let result;
        try { result = await ask(block, { suggest: true }); } catch { return; }
        const { list, answer } = result;
        if (!list.length) {
            setText(block, '[data-trf-status]', t('config.titleRewriteNoTitles', 'No titles to look at yet.'));
            return;
        }
        if (!answer.suggestion) {
            setText(block, '[data-trf-status]', t('config.titleRewriteNothing', 'Nothing to suggest.'));
            return;
        }
        const input = block.querySelector('[data-trf-find]');
        input.value = answer.suggestion;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // The widget panel keeps its settings on change; the watch panel keeps
        // them on its own Save button and must not hear a change here, or the
        // suggestion would be applied before it was read.
        if (!block.querySelector('[data-trf-save]')) input.dispatchEvent(new Event('change', { bubbles: true }));
        setText(block, '[data-trf-status]', t('config.titleRewriteSuggested', 'Suggested from the latest titles. Check the preview.'));
    }

    document.addEventListener('input', (event) => {
        const block = event.target.closest?.('[data-trf]');
        if (!block || !event.target.matches('[data-trf-find], [data-trf-replace]')) return;
        clearTimeout(block._trfTimer);
        block._trfTimer = setTimeout(() => { void refresh(block); }, PREVIEW_DELAY_MS);
    });

    document.addEventListener('click', (event) => {
        const button = event.target.closest?.('[data-trf-suggest]');
        const block = button?.closest('[data-trf]');
        if (block) void suggest(block);
    });

    /*
     * A block painted with a pattern already set shows its effect without a
     * keystroke. Both panels build their HTML as strings and insert it in
     * several places, so the block is noticed where it lands rather than
     * asking each place to call in.
     */
    function showNow(root) {
        const blocks = root.matches?.('[data-trf]') ? [root] : [...(root.querySelectorAll?.('[data-trf]') || [])];
        blocks.forEach((block) => {
            if (block.querySelector('[data-trf-find]')?.value.trim()) void refresh(block);
        });
    }

    new MutationObserver((records) => {
        records.forEach((record) => record.addedNodes.forEach((node) => {
            if (node.nodeType === 1) showNow(node);
        }));
    }).observe(document.body, { childList: true, subtree: true });

    global.TitleRewriteField = { render };
})(window);
