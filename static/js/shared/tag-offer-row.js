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

    /** Every offer a row does not already carry, best first. */
    function pickAll(offers, tags) {
        const have = new Set((Array.isArray(tags) ? tags : []).map((tag) => String(tag || '').trim().toLowerCase()));
        const seen = new Set();
        return (Array.isArray(offers) ? offers : []).filter((offer) => {
            const tag = String(offer?.tag || '').toLowerCase();
            if (!tag || have.has(tag) || seen.has(tag)) return false;
            seen.add(tag);
            return true;
        });
    }

    /** The best offer a row does not already carry, or null. */
    function pick(offers, tags) {
        return pickAll(offers, tags)[0] || null;
    }

    function sourceLabel(offer, t = identity) {
        const kind = offer?.reason?.kind;
        if (kind === 'app') return t('config.bmOfferFromApp', 'Recognised as {app}').replace('{app}', offer.reason.app || '');
        if (kind === 'home') return t('config.bmOfferFromHome', 'On your home network');
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

    /**
     * `+N` after the chip: the row's other offers, behind a popover. Drawn
     * for a row with more than one; fit() shows it, and counts the chip in
     * too when the chip itself had to go.
     */
    function moreHtml(total, { esc, t = identity, data }) {
        if (!(total > 1)) return '';
        return `<button type="button" class="tag-offer-more" data-${data}-offers-more data-total="${total}" tabindex="-1"`
            + ` aria-haspopup="dialog" title="${esc(t('config.bmOffersMoreTitle', 'All tag suggestions for this row'))}">+${total - 1}</button>`;
    }

    let pop = null;
    let popClose = null;

    function closePopover() {
        popClose?.();
    }

    /**
     * The row's offers in a small popover, each with + and ×. `onAdd` and
     * `onRefuse` get the offer; the popover closes after either, since the
     * row is drawn again with what is left.
     */
    function openPopover(anchor, offers, { t = identity, onAdd, onRefuse }) {
        if (!anchor || !offers?.length) return null;
        return openShell(anchor, t('config.bmOffersMoreTitle', 'All tag suggestions for this row'), (box) => offers.forEach((offer) => {
            const tag = String(offer.tag);
            const row = document.createElement('div');
            row.className = 'tag-offer-pop-row';
            row.dataset.offer = tag;
            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'tag-offer-pop-add';
            add.textContent = `+ ${tag}`;
            add.setAttribute('aria-label', t('config.bmOfferAdd', 'Add #{tag}').replace('{tag}', tag));
            const source = document.createElement('span');
            source.className = 'tag-offer-pop-source';
            source.textContent = sourceLabel(offer, t);
            const refuse = document.createElement('button');
            refuse.type = 'button';
            refuse.className = 'tag-offer-pop-refuse';
            refuse.textContent = '×';
            refuse.setAttribute('aria-label', t('config.bmOfferRefuse', 'Turn down #{tag}').replace('{tag}', tag));
            add.addEventListener('click', (e) => {
                e.stopPropagation();
                closePopover();
                onAdd?.(offer);
            });
            refuse.addEventListener('click', (e) => {
                e.stopPropagation();
                closePopover();
                onRefuse?.(offer);
            });
            row.append(add, source, refuse);
            box.appendChild(row);
        }));
    }

    /**
     * The row's own tags that `+n` stands for, in the same popover: to read,
     * not to click -- they are on the bookmark already.
     */
    function openTagList(anchor, names, { t = identity } = {}) {
        if (!anchor || !names?.length) return null;
        return openShell(anchor, t('config.bmTagsMoreTitle', 'The other tags on this row'), (box) => {
            const list = document.createElement('div');
            list.className = 'tag-offer-pop-tags';
            names.forEach((name) => {
                const chip = document.createElement('span');
                chip.className = 'tag-offer-pop-tag';
                chip.textContent = name;
                list.appendChild(chip);
            });
            box.appendChild(list);
        });
    }

    /** The popover itself: built by `fill`, under the anchor, closed by a click outside, Escape or a scroll. */
    function openShell(anchor, label, fill) {
        closePopover();
        pop = document.createElement('div');
        pop.className = 'tag-offer-pop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', label);
        pop.tabIndex = -1;
        fill(pop);
        document.body.appendChild(pop);
        // Under the anchor, held inside the window; above it when there is no room.
        const a = anchor.getBoundingClientRect();
        const b = pop.getBoundingClientRect();
        let top = a.bottom + 6;
        if (top + b.height > window.innerHeight - 4) top = Math.max(4, a.top - b.height - 6);
        const left = Math.min(Math.max(4, a.left), window.innerWidth - b.width - 4);
        pop.style.top = `${Math.round(top)}px`;
        pop.style.left = `${Math.round(left)}px`;
        const onDown = (e) => {
            if (!pop?.contains(e.target) && e.target !== anchor) closePopover();
        };
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            closePopover();
            anchor.focus?.({ preventScroll: true });
        };
        // A scroll that moves the row away closes it; one that settles
        // after the click (a scroll into view finishing) does not.
        const at = a.top;
        const onScroll = (e) => {
            if (pop?.contains(e.target)) return;
            if (!anchor.isConnected || Math.abs(anchor.getBoundingClientRect().top - at) > 2) closePopover();
        };
        document.addEventListener('pointerdown', onDown, true);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', closePopover);
        anchor.setAttribute('aria-expanded', 'true');
        popClose = () => {
            document.removeEventListener('pointerdown', onDown, true);
            document.removeEventListener('keydown', onKey, true);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', closePopover);
            anchor.setAttribute('aria-expanded', 'false');
            pop?.remove();
            pop = null;
            popClose = null;
        };
        (pop.querySelector('button') || pop).focus({ preventScroll: true });
        return pop;
    }

    // `+n` for a row's own tags, in every list that fits them here: one
    // listener, in the capture phase, so the row's own click does not follow.
    document.addEventListener('click', (e) => {
        const more = e.target.closest?.('.tag-offer-own-more');
        if (!more || more.hidden) return;
        e.preventDefault();
        e.stopPropagation();
        if (pop && more.getAttribute('aria-expanded') === 'true') {
            closePopover();
            return;
        }
        openTagList(more, String(more.dataset.tags || '').split('\n').filter(Boolean), {
            t: (key, fallback) => global.dashboardInstance?.language?.t?.(key) || fallback,
        });
    }, true);

    /** "N tag suggestions in this list · Add all"; hidden at none. */
    function renderCount(host, count, { t = identity, data, onAddAll, refused = 0, onRefused }) {
        if (!host) return;
        host.classList.add('tag-offer-count');
        host.hidden = !count && !refused;
        if (host.hidden) {
            host.replaceChildren();
            return;
        }
        const sep = () => {
            const dot = document.createElement('span');
            dot.textContent = '·';
            return dot;
        };
        const parts = [];
        if (count) {
            const label = document.createElement('span');
            label.textContent = count === 1
                ? t('config.bmOffersOne', '1 tag suggestion in this list')
                : t('config.bmOffersMany', '{n} tag suggestions in this list').replace('{n}', String(count));
            const all = document.createElement('button');
            all.type = 'button';
            all.className = 'tag-offer-count-all';
            all.setAttribute(`data-${data}-offers-all`, '');
            all.textContent = t('config.bmOffersAddAll', 'Add all');
            all.addEventListener('click', () => onAddAll?.());
            parts.push(label, sep(), all);
        }
        if (refused) {
            if (parts.length) parts.push(sep());
            parts.push(refusedLink(refused, { t, data, onRefused }));
        }
        host.replaceChildren(...parts);
    }

    /**
     * "5 turned down": the way back to what was refused, beside the offers
     * where the refusing happens. Every refusal holds for the whole site, so
     * the number is the collection's, not this list's.
     */
    function refusedLink(n, { t = identity, data, onRefused }) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'tag-offer-count-all tag-offer-count-refused';
        link.setAttribute(`data-${data}-offers-refused`, '');
        link.textContent = t('config.bmOffersRefused', '{n} turned down').replace('{n}', String(n));
        link.title = t('config.bmOffersRefusedHint', 'See what you turned down, and offer any of it again');
        link.addEventListener('click', () => onRefused?.());
        return link;
    }

    /**
     * Show as many whole tag chips per cell as fit, then `+n` for the rest.
     *
     * Three passes over every cell, so the layout is computed once: show all
     * chips (and a wide `+n` to measure), read every width, then hide.
     *
     * The offer goes first: its room is taken before the row's own tags are
     * fitted, and those fold into `+n` -- all of them if need be -- since
     * they are on the bookmark already and the offer is what asks for a
     * click. A row with more offers keeps their `+N` beside it. In a cell
     * too narrow even for the offer, it gives way to that `+N`, which then
     * counts it too and opens all of them.
     * `tag` and `more` are the caller's chip selectors.
     */
    function fit(cells, { tag, more: moreSel }) {
        if (!cells.length) return;
        cells.forEach((cell) => {
            cell.querySelectorAll(`${tag}, .tag-offer, .tag-offer-more`).forEach((chip) => { chip.hidden = false; });
            cell.querySelector('.tag-offer')?.style.removeProperty('max-width');
            const offers = cell.querySelector('.tag-offer-more');
            if (offers) offers.textContent = `+${Number(offers.dataset.total) - 1}`;
            const more = cell.querySelector(moreSel);
            if (more) more.textContent = '+99';
        });
        const plans = cells.map((cell) => {
            const chips = [...cell.querySelectorAll(tag)].filter((chip) => !chip.matches(`${moreSel}, .tag-offer`));
            const more = cell.querySelector(moreSel);
            const offer = cell.querySelector('.tag-offer');
            const offers = cell.querySelector('.tag-offer-more');
            const gap = parseFloat(getComputedStyle(cell).columnGap) || 0;
            return {
                chips,
                more,
                offer,
                offers,
                offersWidth: offers ? offers.getBoundingClientRect().width : 0,
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
            // The offer's `+N` and, for a row with tags of its own, their
            // `+n` keep their room; the rest is the offer's -- a long name
            // cut short to fit, and below a few letters it goes, into `+N`.
            const others = plan.offers ? plan.offersWidth + plan.gap : 0;
            const beside = plan.widths.length ? plan.moreWidth + plan.gap : 0;
            const room = Math.min(plan.offerWidth, plan.avail - others - beside);
            if (room < Math.min(56, plan.offerWidth)) {
                plan.offer.hidden = true;
                if (plan.offers) plan.offers.textContent = `+${plan.offers.dataset.total}`;
                plan.avail -= others;
                return;
            }
            if (room < plan.offerWidth) plan.offer.style.maxWidth = `${Math.floor(room)}px`;
            plan.avail -= room + plan.gap + others;
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
            // A click shows them (openTagList, wired once above).
            more.classList.add('tag-offer-own-more');
            more.dataset.tags = hiddenNames.join('\n');
            more.setAttribute('role', 'button');
            more.setAttribute('aria-haspopup', 'dialog');
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

    global.TagOfferRow = { pick, pickAll, sourceLabel, chipHtml, moreHtml, openPopover, openTagList, closePopover, renderCount, refusedLink, fit, observe };
}(window));
