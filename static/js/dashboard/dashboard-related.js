/**
 * Related links: the few bookmarks that belong with the one in view.
 *
 * The server finds them (GET /api/related, internal/app/related.go) from tags,
 * site and which links are opened close together. This file asks for them,
 * remembers the answer for a short while so hovering back and forth is free,
 * and draws them in the three places that show them: a row on the preview card,
 * a popover from the context menu and the `:related` command. Opening one
 * counts as an open; Shift on the click goes to the bookmark's place on the
 * dashboard instead.
 */
class DashboardRelated {
    // How long an answer is kept. Related links change as tags and opens do, but
    // not between two hovers.
    static KEEP_MS = 20 * 1000;

    constructor(dash) {
        this.dash = dash;
        this._cache = new Map();
        this._menu = null;
        this._outside = null;
        this._keys = null;
    }

    t(key, fallback, params) {
        const val = this.dash.language?.t ? this.dash.language.t(key) : null;
        const text = (val && val !== key) ? val : fallback;
        return params
            ? Object.entries(params).reduce(
                (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                String(text)
            )
            : String(text);
    }

    escape(text) {
        return window.NextDashHtml.escapeHtml(String(text ?? ''));
    }

    /** Forget what was asked: a tag, an address or an open has changed. */
    forget() {
        this._cache.clear();
    }

    /** The answer already held for a bookmark and still fresh, or null. */
    cached(bookmark) {
        const kept = this._cache.get(String(bookmark?.url || '').trim());
        return kept && Date.now() - kept.at < DashboardRelated.KEEP_MS ? kept.links : null;
    }

    /**
     * The links related to a bookmark, up to three, strongest first. Resolves to
     * an empty list when there are none or the request fails.
     */
    async for(bookmark) {
        const url = String(bookmark?.url || '').trim();
        if (!url) return [];
        const kept = this._cache.get(url);
        if (kept && Date.now() - kept.at < DashboardRelated.KEEP_MS) return kept.links;
        try {
            const res = await fetch(`/api/related?url=${encodeURIComponent(url)}`, { cache: 'no-store' });
            if (!res.ok) return [];
            const links = await res.json();
            const clean = Array.isArray(links) ? links.filter((l) => l && l.url) : [];
            this._cache.set(url, { at: Date.now(), links: clean });
            return clean;
        } catch {
            return [];
        }
    }

    /** What makes a link related, in words, for a tooltip. */
    reasonText(link) {
        const names = {
            tags: this.t('dashboard.relatedReasonTags', 'shared tags'),
            site: this.t('dashboard.relatedReasonSite', 'same site'),
            coopen: this.t('dashboard.relatedReasonCoOpen', 'often opened together'),
        };
        return (link.reasons || []).map((r) => names[r]).filter(Boolean).join(', ');
    }

    /**
     * Open a related link, or with Shift go to where it lives. Opening counts as
     * an open of that bookmark, like any other.
     */
    activate(link, event = null) {
        if (!link?.url) return;
        // Shift on a click; Alt+Enter in the palette, where Shift+Enter is the web.
        if (event?.shiftKey || event?.altKey) {
            void this.jump(link);
            return;
        }
        window.open(link.url, '_blank', 'noopener,noreferrer');
        const d = this.dash;
        const held = (d.allBookmarks || []).find((b) => b.url === link.url
            && (!b.pageId || Number(b.pageId) === Number(link.pageId)))
            || (d.bookmarks || []).find((b) => b.url === link.url);
        if (held) {
            d.recordBookmarkOpened?.(held, undefined, 'related');
        } else if (Number(link.pageId) > 0) {
            // The dashboard does not hold that page's bookmarks: the server finds
            // the row by its address.
            void d.analytics?.trackBookmarkOpen?.(Number(link.pageId), -1, 'related', undefined, undefined, link.url);
        }
        // An open is one of the things the list is made from.
        this.forget();
    }

    /** Switch to the link's page and put the row cursor on it. */
    async jump(link) {
        const d = this.dash;
        this.closeMenu();
        d.preview?.hideBookmarkPreviewCard?.();
        const pageId = Number(link.pageId);
        // Always, even when it is the page on screen: that also leaves a view
        // (Bookmarks, Inbox) that is covering it.
        if (pageId) await d.requestPageNavigation?.(pageId);
        const url = String(link.url || '');
        const find = () => [...document.querySelectorAll('.bookmark-link[data-bookmark-url]')]
            .find((r) => r.getAttribute('data-bookmark-url') === url
                && !r.closest('[data-smart-collection="true"]'));
        // The page draws after the switch; give it a moment.
        let row = find();
        for (let i = 0; !row && i < 10; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            row = find();
        }
        // Folded away under "show more": open the category's list first.
        if (row?.classList.contains('is-overflow-hidden')) {
            row.closest('.bookmarks-list')?.querySelector(':scope > .category-show-more')?.click();
            await new Promise((resolve) => setTimeout(resolve, 150));
            row = find() || row;
        }
        if (!row) {
            d.showNotification?.(this.t('dashboard.relatedNotFound', 'That bookmark is not on this page.'), 'info');
            return;
        }
        row.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        const kn = d.keyboardNavigation;
        if (kn) {
            kn.updateNavigableElements?.();
            const at = kn.navigableElements?.indexOf(row) ?? -1;
            if (at >= 0) {
                kn.currentIndex = at;
                kn.highlightCurrentElement?.({ keyboardNav: true, focus: true });
            }
        }
    }

    /** One chip per link, for the preview card. */
    chips(links, { clickable }) {
        return links.map((link) => {
            const chip = document.createElement(clickable ? 'button' : 'span');
            chip.className = 'bookmark-related-chip';
            if (clickable) chip.type = 'button';
            chip.textContent = link.name || link.url;
            const why = this.reasonText(link);
            chip.title = why ? `${link.url} (${why})` : link.url;
            if (clickable) {
                chip.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.activate(link, e);
                });
            }
            return chip;
        });
    }

    closeMenu() {
        if (this._menu) { this._menu.remove(); this._menu = null; }
        if (this._outside) { document.removeEventListener('click', this._outside, true); this._outside = null; }
        if (this._keys) { document.removeEventListener('keydown', this._keys, true); this._keys = null; }
    }

    /** The context menu's "Related…": a small list under `anchor`, filled when it arrives. */
    async openMenu(bookmark, anchor) {
        this.closeMenu();
        const menu = document.createElement('div');
        menu.id = 'related-menu';
        menu.className = 'inbox-snooze-menu related-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', this.t('dashboard.relatedMenuLabel', 'Related links'));
        menu.innerHTML = `<p class="related-menu-note">${this.escape(this.t('dashboard.relatedLoading', 'Looking…'))}</p>`;
        document.body.appendChild(menu);
        this._menu = menu;

        const place = () => {
            const rect = anchor?.getBoundingClientRect?.();
            if (!rect) return;
            menu.style.left = `${Math.max(8, Math.round(Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)))}px`;
            const below = rect.bottom + 6;
            menu.style.top = below + menu.offsetHeight > window.innerHeight - 8
                ? `${Math.max(8, Math.round(rect.top - menu.offsetHeight - 6))}px`
                : `${Math.round(below)}px`;
        };
        place();

        window.EscapeOwner?.registerOwner?.('related-menu', {
            isOpen: () => Boolean(document.getElementById('related-menu')),
        });
        this._outside = (e) => {
            if (!menu.contains(e.target) && !anchor?.contains?.(e.target)) this.closeMenu();
        };
        this._keys = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.closeMenu();
                anchor?.focus?.({ preventScroll: true });
                return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || !menu.contains(document.activeElement)) return;
            const stops = [...menu.querySelectorAll('[role="menuitem"]')];
            if (!stops.length) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            const last = stops.length - 1;
            const at = stops.indexOf(document.activeElement);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? last
                : e.key === 'ArrowDown' ? (at >= last ? 0 : at + 1) : (at <= 0 ? last : at - 1);
            stops[next]?.focus({ preventScroll: true });
        };
        setTimeout(() => document.addEventListener('click', this._outside, true), 0);
        document.addEventListener('keydown', this._keys, true);

        const links = await this.for(bookmark);
        if (this._menu !== menu) return;
        if (!links.length) {
            menu.innerHTML = `<p class="related-menu-note">${this.escape(this.t('dashboard.relatedNone', 'No related links'))}</p>`;
            place();
            return;
        }
        menu.innerHTML = links.map((link, i) => {
            const why = this.reasonText(link);
            return `<button type="button" class="inbox-snooze-option" role="menuitem" data-related-index="${i}"
                title="${this.escape(link.url)}">${this.escape(link.name || link.url)}${why
                    ? `<span class="related-menu-why">${this.escape(why)}</span>` : ''}</button>`;
        }).join('') + `<p class="related-menu-note">${this.escape(this.t('dashboard.relatedShiftHint', 'Shift+click goes to it'))}</p>`;
        menu.querySelectorAll('[data-related-index]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const link = links[Number(btn.getAttribute('data-related-index'))];
                this.closeMenu();
                this.activate(link, e);
            });
        });
        place();
        menu.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
    }
}

window.DashboardRelated = DashboardRelated;
