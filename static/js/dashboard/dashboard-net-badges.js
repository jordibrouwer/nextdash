/**
 * Network check status on dashboard rows.
 *
 * One bulk request (GET /api/net/checks, the same one the Bookmarks view and
 * the bell read) is indexed by page and address. A row's checks are chips in
 * the row's tag cluster (the strip behind the name that the row tags already
 * use): problems first, then the tags, and whatever does not fit is "+n". The
 * name always has priority: the cluster gives way first (see net-tools.css).
 *
 * The cluster itself is drawn by DashboardBookmarkRows.renderRowTags, which asks
 * `chipItems` for the checks, `chip` for how one looks and `moreChip` for the
 * "+n". Those three functions are the one place that decides how a check shows
 * on a row.
 *
 * A click on a chip opens the bookmark's Tests tab; a click on "+n" opens a
 * small popover with everything that did not fit (checks stay clickable); the
 * row's context menu has "Network checks" for the keyboard.
 *
 * Whether it shows is the setting netToolsDashboardBadges (problems | always |
 * never). It is read at draw time and also written on <body> as
 * data-net-badges; changing it repaints the rows without a reload. Nothing is
 * fetched when it is "never" or network checks are off. The data follows the
 * health badge's own cadence (DashboardVisual.updateHealthBadge).
 */
class DashboardNetBadges {
    constructor(dashboard) {
        this.dash = dashboard;
        /** `${pageId}\0${url}` -> scheduled check items of the bulk answer */
        this.byKey = new Map();
        this.at = 0;
        this._loading = null;
        this._bound = false;
        this._more = null;
    }

    mode() {
        const m = this.dash.settings?.netToolsDashboardBadges;
        return m === 'always' || m === 'never' ? m : 'problems';
    }

    enabled() {
        return this.dash.settings?.netToolsEnabled !== false && this.mode() !== 'never';
    }

    key(pageId, url) {
        return `${pageId}\u0000${url}`;
    }

    pageIdOf(bookmark) {
        return Number(bookmark?.pageId || bookmark?.pageID) || Number(this.dash.currentPageId) || 0;
    }

    t(key, fallback) {
        const v = this.dash.language?.t?.(key);
        return v && v !== key ? v : fallback;
    }

    model() {
        return window.NetChecksModel || null;
    }

    /** The checks model is 46 KB: fetched only once there is a check to draw. */
    ensureModel() {
        if (this.model()) return Promise.resolve(true);
        const load = window.LazyScript?.loadScriptOnce;
        if (!load) return Promise.resolve(false);
        return load('js/shared/net-checks-model.js', 'netChecksModel', () => Boolean(window.NetChecksModel))
            .then(() => true, () => false);
    }

    /** Whether the bookmark has any check at all, scheduled or not (the menu entry). */
    hasChecks(bookmark) {
        return Array.isArray(bookmark?.checks) && bookmark.checks.length > 0;
    }

    bind() {
        if (this._bound) return;
        this._bound = true;
        const open = (event) => {
            const more = event.target?.closest?.('[data-net-more]');
            const chip = event.target?.closest?.('.bookmark-net-chip[data-net-chip]');
            if (!more && !chip) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.type !== 'click') return;
            const row = (more || chip).closest('.bookmark-link');
            if (more) this.showMore(more, more._netHidden || []);
            else if (row?._netTarget) this.openTests(row._netTarget.pageId, row._netTarget.url);
        };
        document.addEventListener('click', open, true);
        document.addEventListener('auxclick', open, true);
    }

    openTests(pageId, url) {
        void this.dash.config?.openLibraryOnBookmark?.(pageId, url, { tab: 'tests', focusRow: true });
    }

    /** Called when settings are applied (startup, Config): load or repaint as the mode says. */
    sync() {
        this.bind();
        if (!this.enabled()) {
            this.paint();
            return;
        }
        if (!this.at) void this.refresh();
        else this.paint();
    }

    /** Take the bulk answer another reader already fetched (Config's own request). */
    adopt(items) {
        if (!this.enabled() || !Array.isArray(items)) return;
        this.index(items);
        void this.ensureModel().then(() => this.paint());
    }

    index(items) {
        const byKey = new Map();
        items.forEach((item) => {
            if (!item || item.enabled !== true) return;
            const k = this.key(item.pageId, item.url);
            if (!byKey.has(k)) byKey.set(k, []);
            byKey.get(k).push(item);
        });
        this.byKey = byKey;
        this.at = Date.now();
    }

    async refresh({ maxAgeMs = 0 } = {}) {
        if (!this.enabled()) return;
        if (this._loading) return this._loading;
        if (maxAgeMs && this.at && Date.now() - this.at < maxAgeMs) return;
        this._loading = (async () => {
            try {
                const res = await fetch('/api/net/checks', { cache: 'no-store' });
                if (!res.ok) return;
                const body = await res.json();
                this.index(Array.isArray(body.items) ? body.items : []);
                if (this.byKey.size) await this.ensureModel();
                this.paint();
            } catch {
                // The chips stay as they were; the next beat asks again.
            }
        })();
        try {
            await this._loading;
        } finally {
            this._loading = null;
        }
    }

    isProblem(state) {
        return state === 'down' || state === 'warn' || state === 'slow';
    }

    /**
     * The checks a row shows as chips, in the order they are shown: the setting
     * decides which, problems come first, the rest keep the checks' own order.
     * Empty until the model is there.
     */
    chipItems(row, bookmark) {
        const M = this.model();
        if (!M || !this.enabled()) return [];
        const target = row?._netTarget || { pageId: this.pageIdOf(bookmark), url: bookmark?.url || '' };
        const items = this.byKey.get(this.key(target.pageId, target.url)) || [];
        const order = { down: 4, warn: 3, slow: 2, unknown: 1, ok: 0 };
        return items
            .map((item, i) => ({ item, i, state: M.badgeState(item) }))
            .filter((x) => this.mode() === 'always' || this.isProblem(x.state))
            .sort((a, b) => ((order[b.state] ?? 0) - (order[a.state] ?? 0)) || (a.i - b.i))
            .map((x) => x.item);
    }

    /** What a chip says, in words: "TLS: Warning · 9 days left". */
    describe(item) {
        const M = this.model();
        const state = M.badgeState(item);
        const parts = [`${item.label || M.typeName(item.type)}: ${M.stateLabel(state, (k, f) => this.t(k, f))}`];
        if (item.state?.detail) parts.push(item.state.detail);
        return parts.join(' · ');
    }

    /** Changes when what a row shows changes; the row's cluster is rebuilt only then. */
    fingerprint(row, bookmark) {
        const M = this.model();
        const list = this.chipItems(row, bookmark)
            .map((i) => `${i.checkId}:${M.badgeState(i)}:${i.state?.detail || ''}`);
        return `${this.mode()}|${list.join(',')}`;
    }

    /** THE CHIP: a tag-sized chip with a status dot, part of the row's tag cluster. */
    chip(item) {
        const M = this.model();
        const text = this.describe(item);
        const chip = document.createElement('span');
        chip.className = 'bookmark-tag-chip bookmark-net-chip';
        chip.dataset.netChip = item.checkId;
        chip.dataset.state = M.badgeState(item);
        chip.setAttribute('role', 'img');
        chip.setAttribute('aria-label', text);
        chip.title = text;
        const dot = document.createElement('i');
        dot.setAttribute('aria-hidden', 'true');
        chip.append(dot, M.typeName(item.type));
        return chip;
    }

    /** The "+n" of a cluster; with checks in it, its title and label list everything that did not fit. */
    moreChip(hidden) {
        const more = document.createElement('span');
        more.className = 'bookmark-tag-chip bookmark-tag-chip--more';
        more.textContent = `+${hidden.length}`;
        if (hidden.some((h) => h.kind === 'net')) {
            const lines = hidden.map((h) => (h.kind === 'net' ? this.describe(h.item) : h.tag));
            more.dataset.netMore = '';
            more._netHidden = hidden;
            more.setAttribute('role', 'img');
            more.setAttribute('aria-label', lines.join(', '));
            more.title = lines.join('\n');
        }
        return more;
    }

    /** All the hidden items in one small popover; a check in it opens the Tests tab. */
    showMore(anchor, hidden) {
        this.closeMore();
        const pop = document.createElement('div');
        pop.className = 'net-more-pop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', this.t('nettools.dashMore', 'More on this bookmark'));
        const row = anchor.closest('.bookmark-link');
        hidden.forEach((h) => {
            if (h.kind === 'net') {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'bookmark-tag-chip bookmark-net-chip';
                b.dataset.state = this.model().badgeState(h.item);
                const dot = document.createElement('i');
                dot.setAttribute('aria-hidden', 'true');
                b.append(dot, h.item.label || this.model().typeName(h.item.type));
                b.title = this.describe(h.item);
                b.addEventListener('click', () => {
                    this.closeMore();
                    if (row?._netTarget) this.openTests(row._netTarget.pageId, row._netTarget.url);
                });
                pop.appendChild(b);
            } else {
                const tag = document.createElement('span');
                tag.className = 'bookmark-tag-chip';
                tag.textContent = h.tag;
                pop.appendChild(tag);
            }
        });
        document.body.appendChild(pop);
        const box = anchor.getBoundingClientRect();
        pop.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - pop.offsetWidth - 8))}px`;
        pop.style.top = `${Math.round(box.bottom + 4)}px`;
        this._more = pop;
        pop.querySelector('button')?.focus({ preventScroll: true });
        this._moreOff = (e) => {
            if (e.type === 'keydown' && e.key !== 'Escape') return;
            if (e.type !== 'keydown' && pop.contains(e.target)) return;
            this.closeMore();
        };
        setTimeout(() => {
            if (this._more !== pop) return;
            document.addEventListener('pointerdown', this._moreOff, true);
            document.addEventListener('keydown', this._moreOff, true);
            window.addEventListener('scroll', this._moreOff, true);
        }, 0);
    }

    closeMore() {
        if (!this._more) return;
        this._more.remove();
        this._more = null;
        document.removeEventListener('pointerdown', this._moreOff, true);
        document.removeEventListener('keydown', this._moreOff, true);
        window.removeEventListener('scroll', this._moreOff, true);
    }

    /** Called by the row builder, before the row's tag cluster is drawn. */
    decorate(row, bookmark) {
        row._netTarget = { pageId: this.pageIdOf(bookmark), url: bookmark?.url || '' };
        row._netBookmark = bookmark;
    }

    /** Redraw a row's cluster if what it shows has changed. */
    syncRow(row) {
        if (!row._netTarget) return;
        const openLink = row.querySelector('.bookmark-open');
        if (!openLink) return;
        if (row._netFp === this.fingerprint(row, row._netBookmark)) return;
        this.dash.bookmarkRows?.renderRowTags?.(row, openLink, row._netBookmark);
    }

    paint() {
        document.querySelectorAll('.bookmark-link').forEach((row) => {
            if (row._netTarget) this.syncRow(row);
        });
    }
}

window.DashboardNetBadges = DashboardNetBadges;
