/**
 * Suggested tags, drawn as chips.
 *
 * The form, the Config side panel, the inbox and the kept list all offer the
 * engine's answers the same way: `+ tag` takes one, `✕` refuses it for the
 * site everywhere. Four copies of the same forty lines is how they would
 * start looking and behaving differently, so they share this one. It draws
 * and reports clicks; what "take" means is the caller's.
 */
(function (global) {
    'use strict';

    function render(host, offers, options = {}) {
        if (!host) return 0;
        host.replaceChildren();
        const list = (Array.isArray(offers) ? offers : []).slice(0, options.limit ?? 3);
        if (!list.length) {
            host.hidden = true;
            return 0;
        }
        const t = typeof options.t === 'function' ? options.t : (_k, fallback) => fallback;
        host.hidden = false;
        if (options.label) {
            const label = document.createElement('span');
            label.className = 'tag-suggest-chips-label';
            label.textContent = options.label;
            host.appendChild(label);
        }
        list.forEach((offer) => {
            const chip = document.createElement('span');
            chip.className = 'tag-suggest-chip';
            chip.dataset.tag = offer.tag;

            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'tag-suggest-chip-add';
            add.textContent = `#${offer.tag}`;
            add.title = t('dashboard.tagSuggestAdd', `Tag this bookmark #${offer.tag}`, { tag: offer.tag });
            add.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                options.onAccept?.(offer.tag, offer);
            });

            const off = document.createElement('button');
            off.type = 'button';
            off.className = 'tag-suggest-chip-dismiss';
            off.textContent = '×';
            off.title = t('dashboard.tagSuggestDismiss', `Stop proposing #${offer.tag} here`, { tag: offer.tag });
            off.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                options.onRefuse?.(offer);
            });

            chip.append(add, off);
            host.appendChild(chip);
        });
        return list.length;
    }

    /**
     * Refuse one against its pattern, the way Config does.
     *
     * `onUpdated` runs once the refusal is in memory and before the settings
     * are written, so the caller can redraw without waiting on the network.
     */
    async function refuse(dash, offer, { onUpdated } = {}) {
        const live = global.TagSuggestLive;
        if (!dash?.settings || !live) return false;
        const key = live.dismissKey(offer);
        const before = Array.isArray(dash.settings.dismissedTagSuggestions)
            ? dash.settings.dismissedTagSuggestions : [];
        if (before.includes(key)) return false;
        dash.settings.dismissedTagSuggestions = [...before, key];
        live.changed(dash);
        onUpdated?.();
        await dash.saveSettings?.();
        return true;
    }

    global.TagSuggestChips = { render, refuse };
}(window));
