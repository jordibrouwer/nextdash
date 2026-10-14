/**
 * One tag on offer in a list row, and the line that counts them.
 *
 * The Bookmarks view showed it first: a dashed chip after a row's own tags,
 * `+ tag` to take it and `×` to turn it down, and "12 tag suggestions in this
 * list · Add all" over the column heads. The inbox shows the same thing, so
 * the drawing and the fitting live here once; what "take" writes is the
 * caller's (a bookmark PATCH there, an inbox batch here).
 */
(function (global) {
    'use strict';

    const identity = (_key, fallback) => fallback;

    /** The best offer a row does not already carry, or null. */
    function pick(offers, tags) {
        const have = new Set((Array.isArray(tags) ? tags : []).map((tag) => String(tag || '').trim().toLowerCase()));
        return (Array.isArray(offers) ? offers : [])
            .find((offer) => offer?.tag && !have.has(String(offer.tag).toLowerCase())) || null;
    }

    function sourceLabel(offer, t = identity) {
        const kind = offer?.reason?.kind;
        if (kind === 'app') return t('config.bmOfferFromApp', 'Recognised as {app}').replace('{app}', offer.reason.app || '');
        if (kind === 'online') return t('config.bmOfferFromOnline', 'Suggested by Wikidata');
        if (kind === 'catalogue') return t('config.bmOfferFromCatalogue', 'Suggested by the catalogue');
        if (kind === 'text') return t('config.bmOfferFromPage', 'Suggested by the page itself');
        if (kind === 'rule') return t('config.bmOfferFromRule', 'Suggested by your rule');
        return t('config.bmOfferFromYours', 'Suggested by your other tags');
    }

    /**
     * The dashed chip. `data` names the hooks (`data-<data>-offer`,
     * `-offer-add`, `-offer-refuse`) the caller's click handler looks for;
     * `className` adds the caller's own chip class beside `tag-offer`.
     */
    function chipHtml(offer, { esc, t = identity, data, className = '' }) {
        if (!offer?.tag) return '';
        const tag = String(offer.tag);
        const cls = className ? `tag-offer ${className}` : 'tag-offer';
        return `<span class="${cls}" data-${data}-offer="${esc(tag)}" title="${esc(sourceLabel(offer, t))}">`
            + `<button type="button" class="tag-offer-add" data-${data}-offer-add tabindex="-1"`
            + ` aria-label="${esc(t('config.bmOfferAdd', 'Add #{tag}').replace('{tag}', tag))}">+ ${esc(tag)}</button>`
            + `<button type="button" class="tag-offer-refuse" data-${data}-offer-refuse tabindex="-1"`
            + ` aria-label="${esc(t('config.bmOfferRefuse', 'Turn down #{tag}').replace('{tag}', tag))}">×</button></span>`;
    }

    /** "N tag suggestions in this list · Add all"; hidden at none. */
    function renderCount(host, count, { t = identity, data, onAddAll }) {
        if (!host) return;
        host.classList.add('tag-offer-count');
        host.hidden = !count;
        if (!count) {
            host.replaceChildren();
            return;
        }
        const label = document.createElement('span');
        label.textContent = count === 1
            ? t('config.bmOffersOne', '1 tag suggestion in this list')
            : t('config.bmOffersMany', '{n} tag suggestions in this list').replace('{n}', String(count));
        const sep = document.createElement('span');
        sep.textContent = '·';
        const all = document.createElement('button');
        all.type = 'button';
        all.className = 'tag-offer-count-all';
        all.setAttribute(`data-${data}-offers-all`, '');
        all.textContent = t('config.bmOffersAddAll', 'Add all');
        all.addEventListener('click', () => onAddAll?.());
        host.replaceChildren(label, sep, all);
    }

    /**
     * Show as many whole tag chips per cell as fit, then `+n` for the rest.
     *
     * Three passes over every cell, so the layout is computed once: show all
     * chips (and a wide `+n` to measure), read every width, then hide.
     *
     * The offer goes first: its room is taken before the row's own tags are
     * fitted, since those can fold into `+n` and it cannot. In a cell too
     * narrow even for that, it gives way -- the side panel still offers it.
     * `tag` and `more` are the caller's chip selectors.
     */
    function fit(cells, { tag, more: moreSel }) {
        if (!cells.length) return;
        cells.forEach((cell) => {
            cell.querySelectorAll(`${tag}, .tag-offer`).forEach((chip) => { chip.hidden = false; });
            cell.querySelector('.tag-offer')?.style.removeProperty('max-width');
            const more = cell.querySelector(moreSel);
            if (more) more.textContent = '+99';
        });
        const plans = cells.map((cell) => {
            const chips = [...cell.querySelectorAll(tag)].filter((chip) => !chip.matches(`${moreSel}, .tag-offer`));
            const more = cell.querySelector(moreSel);
            const offer = cell.querySelector('.tag-offer');
            const gap = parseFloat(getComputedStyle(cell).columnGap) || 0;
            return {
                chips,
                more,
                offer,
                gap,
                avail: cell.clientWidth,
                widths: chips.map((chip) => chip.getBoundingClientRect().width),
                moreWidth: more ? more.getBoundingClientRect().width : 0,
                // Its own width, not the squeezed one: it may shrink in the
                // cell while everything else is shown for measuring.
                offerWidth: offer ? (offer.querySelector('.tag-offer-add')?.scrollWidth || 0) + 2 : 0,
            };
        });
        plans.forEach((plan) => {
            if (!plan.offer) return;
            // The row's first tag stays: an offer never pushes all of its own
            // tags into `+n`. Then the `+n` for the rest, and what is left is
            // the offer's -- a long name cut short to fit, and below a few
            // letters it goes.
            const first = plan.widths.length ? plan.widths[0] + plan.gap : 0;
            const beside = plan.widths.length > 1 ? plan.moreWidth + plan.gap : 0;
            const room = Math.min(plan.offerWidth, plan.avail - first - beside);
            if (room < Math.min(56, plan.offerWidth)) {
                plan.offer.hidden = true;
                return;
            }
            if (room < plan.offerWidth) plan.offer.style.maxWidth = `${Math.floor(room)}px`;
            plan.avail -= room + plan.gap;
        });
        plans.forEach(({ chips, more, gap, avail, widths, moreWidth }) => {
            if (!more) return;
            const total = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
            let keep = widths.length;
            if (total > avail + 1) {
                keep = 0;
                let used = moreWidth;
                while (keep < widths.length && used + widths[keep] + gap <= avail + 1) {
                    used += widths[keep] + gap;
                    keep += 1;
                }
            }
            const hiddenNames = [];
            chips.forEach((chip, i) => {
                chip.hidden = i >= keep;
                if (chip.hidden) hiddenNames.push(chip.textContent);
            });
            more.hidden = hiddenNames.length === 0;
            more.textContent = hiddenNames.length ? `+${hiddenNames.length}` : '';
            if (hiddenNames.length) more.title = hiddenNames.join(', ');
            else more.removeAttribute('title');
        });
    }

    /**
     * Refit whenever `host` changes width: a window resize, a panel folding,
     * or the first layout after the rows were put in. Returns the observer,
     * so a caller that swaps hosts can let the old one go.
     */
    function observe(host, refit) {
        if (!host || !global.ResizeObserver) return null;
        let queued = false;
        let lastWidth = -1;
        const observer = new global.ResizeObserver(() => {
            if (queued || host.clientWidth === lastWidth) return;
            queued = true;
            global.requestAnimationFrame(() => {
                queued = false;
                lastWidth = host.clientWidth;
                if (host.isConnected) refit();
            });
        });
        observer.observe(host);
        return observer;
    }

    global.TagOfferRow = { pick, sourceLabel, chipHtml, renderCount, fit, observe };
}(window));
