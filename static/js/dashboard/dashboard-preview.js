/**
 * Bookmark link preview cards.
 *
 * The card answers three questions in a fixed order — what is this, what does
 * it say, what do I know about it — so the eye lands in the same place every
 * time. A band with no data is absent rather than blank.
 *
 * Two modes, deliberately separate. **Peek** is what hovering gives you: it
 * takes no pointer events, carries no buttons, and cannot be aimed at, so it
 * never has to chase the cursor. **Pinned** is asked for (Shift + V, or the
 * keyboard toggle): it takes focus, carries its actions in a footer, and closes
 * on Escape. Only pinned mode is allowed to ask the server for anything.
 */
class DashboardPreview {
    /**
     * The rows a card can carry, in the order it draws them.
     *
     * A reader who writes no notes should never see a note row, and one who
     * monitors nothing should never see a status row — the checklist under
     * Appearance is stored as a subset of these names.
     */
    static PARTS = ['image', 'description', 'note', 'tags', 'status', 'opens', 'fresh', 'location'];

    constructor(dashboard) {
        this.dash = dashboard;
    }

    /**
     * "off" | "hover" | "keyboard".
     *
     * `linkPreviewMode` is the setting; the old boolean is still read so an
     * install that has not been migrated yet — or a test that flips the
     * boolean — behaves as it always did.
     */
    previewMode() {
        const raw = String(this.dash.settings?.linkPreviewMode || '').trim().toLowerCase();
        if (raw === 'off' || raw === 'hover' || raw === 'keyboard') return raw;
        return this.dash.settings?.showLinkPreviewCards === true ? 'hover' : 'off';
    }

    /**
     * How long the pointer has to rest on a row before the card opens.
     *
     * Calm by default: a card that opens the moment the pointer crosses a row
     * opens on rows you were only passing over on the way somewhere else.
     */
    previewHoverDelay() {
        const stored = Number(this.dash.settings?.linkPreviewHoverDelayMs);
        return [100, 150, 250].includes(stored) ? stored : 250;
    }

    /** Cards at all — by hover or by key. */
    cardsEnabled() {
        return this.previewMode() !== 'off';
    }

    /** Which rows this reader asked for; everything, unless they said otherwise. */
    previewParts() {
        const raw = this.dash.settings?.linkPreviewParts;
        if (!Array.isArray(raw)) return new Set(DashboardPreview.PARTS);
        const wanted = raw.map((p) => String(p || '').trim()).filter(Boolean);
        // An empty list is a card with a header and nothing else, which is a
        // choice someone can make; only an absent list means "all".
        return new Set(wanted.filter((p) => DashboardPreview.PARTS.includes(p)));
    }

    attachBookmarkPreviewBehavior(openLink, bookmark) {
        const d = this.dash;
        const initialTitle = bookmark.previewTitle || bookmark.name || '';
        const initialDescription = bookmark.previewDesc || '';

        if (!this.cardsEnabled()) {
            openLink.title = d.buildBookmarkTooltip(bookmark, initialTitle, initialDescription);
            if (openLink.dataset.previewLoaded === 'true') return;
            openLink.addEventListener('mouseenter', async () => {
                if (openLink.dataset.previewLoaded === 'true') return;
                const preview = await this.fetchBookmarkPreviewData(openLink, bookmark);
                if (!preview) return;
                openLink.title = d.buildBookmarkTooltip(bookmark, preview.title || bookmark.name || '', preview.description || '');
            }, { once: true });
            return;
        }

        // The native tooltip would sit on top of the card, so it goes — but it
        // was also the only description assistive tech ever got, and peek mode
        // is mouse-only. The text moves to a hidden element the row points at.
        openLink.removeAttribute('title');
        this.applyPreviewDescription(openLink, bookmark, initialTitle, initialDescription);

        if (this.previewMode() !== 'hover') return;

        openLink.addEventListener('mouseenter', async () => {
            openLink._previewHoverActive = true;
            if (openLink._previewHoverTimer) {
                clearTimeout(openLink._previewHoverTimer);
            }
            const hoverDelay = this.previewHoverDelay();
            openLink._previewHoverTimer = setTimeout(async () => {
                if (!openLink._previewHoverActive || this.previewMode() !== 'hover') {
                    return;
                }
                const preview = await this.fetchBookmarkPreviewData(openLink, bookmark);
                if (!preview || !openLink._previewHoverActive) return;
                this.showBookmarkPreviewCard(
                    this.buildPreviewPayload(bookmark, preview),
                    null,
                    { openLink, bookmark, mode: 'peek' }
                );
            }, hoverDelay);
        });

        // Close preview when link activated via keyboard (Enter / Space)
        openLink.addEventListener('keydown', (e) => {
            const key = e.key;
            if (key === 'Enter' || key === ' ') {
                try { this.dismissBookmarkPreviewInteractions(); } catch (_e) {}
            }
        });

        openLink.addEventListener('mouseleave', () => {
            openLink._previewHoverActive = false;
            if (openLink._previewHoverTimer) {
                clearTimeout(openLink._previewHoverTimer);
                openLink._previewHoverTimer = null;
            }
            this.scheduleHideBookmarkPreviewCard();
        });
    }

    /**
     * Give the row a description a screen reader can reach.
     *
     * With cards on, the `title` is removed — otherwise the browser tooltip
     * would sit over the card — and peek mode never opens for a keyboard user.
     * Without this, turning cards on quietly took the description away from
     * anyone not using a mouse.
     */
    applyPreviewDescription(openLink, bookmark, title, description) {
        const text = this.dash.buildBookmarkTooltip(bookmark, title, description);
        if (!String(text || '').trim()) return;
        let id = openLink.dataset.previewDescId;
        let host = id ? document.getElementById(id) : null;
        if (!host) {
            id = `bm-preview-desc-${Math.random().toString(36).slice(2, 10)}`;
            host = document.createElement('span');
            host.id = id;
            host.className = 'sr-only';
            openLink.dataset.previewDescId = id;
            openLink.appendChild(host);
        }
        host.textContent = text;
        openLink.setAttribute('aria-describedby', id);
    }


    scheduleHideBookmarkPreviewCard() {
        const d = this.dash;
        if (d._previewHideTimer) {
            clearTimeout(d._previewHideTimer);
        }
        d._previewHideTimer = setTimeout(() => {
            d._previewHideTimer = null;
            // A pinned card was asked for; only Escape, a click away or the
            // toggle closes it.
            if (d.previewCardElement?.dataset.previewMode === 'pinned') return;
            this.hideBookmarkPreviewCard();
        }, 140);
    }


    async fetchBookmarkPreviewData(openLink, bookmark, { forceRefresh = false } = {}) {
        const d = this.dash;
        if (!forceRefresh && openLink._previewData) {
            return openLink._previewData;
        }
        try {
            let preview = null;
            if (!forceRefresh && (bookmark.previewTitle || bookmark.previewDesc || bookmark.previewImage)) {
                preview = {
                    title: bookmark.previewTitle || bookmark.name || '',
                    description: bookmark.previewDesc || '',
                    image: bookmark.previewImage || '',
                    domain: this.extractDomainFromUrl(bookmark.url),
                    url: bookmark.url
                };
            } else {
                const refreshParam = forceRefresh ? '&refresh=1' : '';
                const response = await dashFetch(`/api/bookmark-preview?url=${encodeURIComponent(bookmark.url)}${refreshParam}`);
                if (!response.ok) return null;
                preview = await response.json();
                bookmark.previewTitle = preview.title || bookmark.previewTitle || '';
                bookmark.previewDesc = preview.description || bookmark.previewDesc || '';
                bookmark.previewImage = preview.image || bookmark.previewImage || '';
                if (forceRefresh) {
                    this.persistBookmarkPreviewMetadata(bookmark);
                }
            }

            const title = preview.title || bookmark.name || '';
            const description = preview.description || '';
            if (!this.cardsEnabled()) {
                openLink.title = `${title}${description ? `\n${description}` : ''}`;
            } else {
                openLink.removeAttribute('title');
                this.applyPreviewDescription(openLink, bookmark, title, description);
            }
            openLink.dataset.previewLoaded = 'true';
            openLink._previewData = preview;
            return preview;
        } catch (_error) {
            openLink.dataset.previewLoaded = 'true';
            return null;
        }
    }


    /**
     * Everything the card can draw, in one place.
     *
     * Hover, the keyboard toggle and the refresh button each used to assemble
     * this by hand, which is why the card never grew a field: every addition
     * meant three edits in three files. Nothing here makes a request — the
     * status, the feed count and the health figures are read from whatever the
     * app already has in memory.
     */
    buildPreviewPayload(bookmark, preview = null) {
        const d = this.dash;
        const url = String(bookmark?.url || preview?.url || '');
        const tags = Array.isArray(bookmark?.tags) ? bookmark.tags.filter(Boolean) : [];
        return {
            url,
            title: this.decodeEntities(preview?.title || bookmark?.name || '').trim(),
            domain: String(preview?.domain || this.extractDomainFromUrl(url) || '').trim(),
            image: preview?.image || '',
            description: this.decodeEntities(preview?.description || '').trim(),
            note: String(bookmark?.note || '').trim(),
            tags,
            icon: String(bookmark?.icon || '').trim(),
            shortcut: String(bookmark?.shortcut || '').trim(),
            location: this.bookmarkLocationLabel(bookmark),
            openCount: Number(bookmark?.openCount || 0),
            lastOpened: bookmark?.lastOpened || null,
            createdAt: Number(bookmark?.createdAt || 0) || 0,
            checked: this.bookmarkCheckState(bookmark),
            fresh: this.bookmarkFreshState(bookmark),
            health: this.bookmarkHealthState(bookmark),
            archive: this.bookmarkArchiveState(bookmark),
        };
    }

    /*
     * When the web lost this page, and where the last working copy is.
     *
     * Read off the bookmark, never fetched: the card is drawn on hover and must
     * not make a request. The server fills these in while checking links.
     *
     * Separate from `health.brokenSince`, which is when this install started
     * seeing failures. For a bookmark added last week to a page that died in
     * 2019 those differ by six years, and only this one describes the page.
     */
    bookmarkArchiveState(bookmark) {
        const diedAt = Number(bookmark?.archiveDiedAt || 0) || 0;
        const snapshot = String(bookmark?.archiveSnapshotUrl || '').trim();
        if (!diedAt && !snapshot) return null;
        return { diedAt, snapshot };
    }

    /** "Work › Reference", from the page and category the bookmark sits in. */
    bookmarkLocationLabel(bookmark) {
        const d = this.dash;
        const pageId = bookmark?.pageId;
        const page = (d.pages || []).find((p) => String(p.id) === String(pageId));
        // Category is stored as an id, never the name — the same rule the rest
        // of the app follows.
        const category = (d.categories || []).find((c) => String(c.id) === String(bookmark?.category));
        const parts = [page?.name, category?.name].filter((v) => String(v || '').trim());
        return parts.join(' › ');
    }

    /**
     * What the last reachability check found, from the status cache only.
     *
     * Never triggers a ping: hovering a row must stay free. Returns null for a
     * bookmark nothing has checked.
     */
    bookmarkCheckState(bookmark) {
        const monitor = this.dash.statusMonitor;
        const url = String(bookmark?.url || '');
        if (!url) return null;
        const cached = typeof monitor?.getCachedStatus === 'function'
            ? monitor.getCachedStatus(url)
            : null;
        const state = String(cached?.status || '').toLowerCase();
        const lastChecked = Number(cached?.timestamp || bookmark?.lastChecked || 0) || 0;
        const error = String(cached?.errorDetail || bookmark?.lastError || '').trim();
        if (!state && !lastChecked && !error) return null;
        return {
            state: state === 'online' || state === 'offline' ? state : (error ? 'offline' : ''),
            ping: Number(cached?.ping || 0) || 0,
            lastChecked,
            error,
        };
    }

    /** The feed count Fresh already keeps for this bookmark, if it has one. */
    bookmarkFreshState(bookmark) {
        const feeds = this.dash.feeds;
        if (!feeds?.enabled) return null;
        const entry = typeof feeds.freshFor === 'function' ? feeds.freshFor(bookmark) : null;
        if (entry) {
            return { newCount: Number(entry.newCount || 0), lastItemAt: Number(entry.lastItemAt || 0) || 0, hasFeed: true };
        }
        if (typeof feeds.hasFeed === 'function' && feeds.hasFeed(bookmark)) {
            return { newCount: 0, lastItemAt: 0, hasFeed: true };
        }
        return null;
    }

    /**
     * Uptime, certificate expiry and how long something has been failing.
     *
     * Read from the index the health badge fills in — the dashboard fetches the
     * whole health report on every load to put a number on that icon, and used
     * to drop everything but the counts. So these facts cost no request at all,
     * and a hover shows them as readily as a pinned card does. The health
     * view's own report is preferred when it is loaded, since it is the fresher
     * of the two.
     */
    bookmarkHealthState(bookmark) {
        const url = String(bookmark?.url || '').trim();
        if (!url) return null;
        const fromView = this.healthStateFromReport(bookmark);
        if (fromView) return fromView;
        const facts = window.HealthFacts?.get?.(url);
        if (!facts) return null;
        return {
            uptime30d: facts.uptime30d,
            uptimeSamples: facts.uptimeSamples,
            certExpiresAt: facts.certExpiresAt,
            brokenSince: facts.brokenSince,
            reason: facts.lastError,
        };
    }

    /** The same four facts from the health view's report, when it is open. */
    healthStateFromReport(bookmark) {
        const report = this.dash.health?.report;
        const url = String(bookmark?.url || '').trim();
        if (!report || !url) return null;
        const issues = Array.isArray(report.issues) ? report.issues : [];
        const issue = issues.find((i) => String(i?.url || '').trim() === url);
        if (!issue) return null;
        const stats = issue.monitorStats || null;
        const cert = issue.certHost ? report.certificates?.[issue.certHost] : null;
        return {
            uptime30d: stats?.uptime30d?.samples ? Number(stats.uptime30d.ratio) : null,
            uptimeSamples: Number(stats?.uptime30d?.samples || 0) || 0,
            certExpiresAt: Number(cert?.expiresAt || 0) || 0,
            brokenSince: Number(issue.brokenSince || 0) || 0,
            reason: String(issue.lastError || '').trim(),
        };
    }

    /**
     * Load the health report once, for a card that was asked for.
     *
     * Hovering is free by design, so this runs in pinned mode only, and only
     * when neither the health view's report nor the badge's index has the
     * answer already — which on a dashboard showing the health icon is never.
     */
    async ensureHealthFactsLoaded() {
        const d = this.dash;
        if (d.health?.report) return false;
        // Normally the badge has already filled the index, and this does
        // nothing. It is here for a dashboard with the health icon switched
        // off, where nothing else fetches the report.
        if (window.HealthFacts?.size > 0) return false;
        if (typeof d.health?.fetchReport !== 'function') return false;
        if (this._healthFactsTried) return false;
        this._healthFactsTried = true;
        try {
            await d.health.fetchReport();
            return true;
        } catch (_error) {
            return false;
        }
    }


    persistBookmarkPreviewMetadata(bookmark) {
        const d = this.dash;
        if (!bookmark) return;

        const updatedUrl = String(bookmark.url || '').trim();
        if (!updatedUrl) return;

        (d.bookmarks || []).forEach((bm) => {
            if (String(bm.url || '').trim() === updatedUrl) {
                bm.previewTitle = bookmark.previewTitle || '';
                bm.previewDesc = bookmark.previewDesc || '';
                bm.previewImage = bookmark.previewImage || '';
            }
        });
        (d.allBookmarks || []).forEach((bm) => {
            if (String(bm.url || '').trim() === updatedUrl) {
                bm.previewTitle = bookmark.previewTitle || '';
                bm.previewDesc = bookmark.previewDesc || '';
                bm.previewImage = bookmark.previewImage || '';
            }
        });

        if (d.pendingPreviewSave) {
            clearTimeout(d.pendingPreviewSave);
        }
        d.pendingPreviewSave = setTimeout(() => {
            d.pendingPreviewSave = null;
            void d.saveBookmarkPreviewMetadataNow();
        }, 1000);
    }


    async refreshVisibleBookmarkPreview() {
        const d = this.dash;
        const card = d.previewCardElement;
        const ctx = card?._previewContext;
        if (!card || !ctx?.openLink || !ctx?.bookmark) return false;

        const refreshBtn = card.querySelector('[data-preview-action="refresh"]');
        refreshBtn?.classList.add('is-loading');
        refreshBtn?.setAttribute('disabled', 'true');

        try {
            delete ctx.openLink._previewData;
            delete ctx.openLink.dataset.previewLoaded;
            const preview = await this.fetchBookmarkPreviewData(ctx.openLink, ctx.bookmark, { forceRefresh: true });
            if (!preview) return false;

            this.showBookmarkPreviewCard(
                this.buildPreviewPayload(ctx.bookmark, preview),
                null,
                { ...ctx, mode: ctx.mode || 'pinned' }
            );
            return true;
        } finally {
            refreshBtn?.classList.remove('is-loading');
            refreshBtn?.removeAttribute('disabled');
        }
    }


    /**
     * Turn the entities a page's own markup carries back into characters.
     *
     * Titles and descriptions come from `content="…"` attributes, where an
     * apostrophe is written `&#39;`. The server unescapes what it fetches now,
     * but every preview stored before this release still holds the entity, and
     * the card sets text rather than markup — so it would print it as written.
     * A table plus numeric escapes rather than innerHTML: this is text from
     * someone else's page and it never becomes markup on the way through.
     */
    decodeEntities(value) {
        const text = String(value ?? '');
        if (!text.includes('&')) return text;
        const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
        return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
            if (body[0] === '#') {
                const code = body[1] === 'x' || body[1] === 'X'
                    ? parseInt(body.slice(2), 16)
                    : parseInt(body.slice(1), 10);
                return Number.isFinite(code) && code > 0 && code <= 0x10ffff
                    ? String.fromCodePoint(code)
                    : whole;
            }
            const hit = named[body.toLowerCase()];
            return hit === undefined ? whole : hit;
        });
    }

    extractDomainFromUrl(url) {
        try {
            return new URL(url).hostname || '';
        } catch (_error) {
            return '';
        }
    }


    /**
     * A day count rendered as "3 days ago" / "2 months ago".
     *
     * Kept for the recent-opened modal, which counts minutes and hours itself
     * and hands down a day count once it passes 24h. The preview card no longer
     * uses it: it needs the calendar-day boundary the shared formatLastOpened
     * applies, which a plain day count cannot express.
     */
    formatPreviewLastOpened(diffDays) {
        const d = this.dash;
        if (diffDays === 0) {
            return d.formatDashboardLabel('previewLastOpenedToday', {}, 'today');
        }
        if (diffDays === 1) {
            return d.formatDashboardLabel('previewLastOpenedYesterday', {}, 'yesterday');
        }
        if (diffDays < 7) {
            return d.formatDashboardLabel('previewLastOpenedDaysAgo', { count: diffDays }, `${diffDays} days ago`);
        }
        const weeks = Math.floor(diffDays / 7);
        if (diffDays < 30) {
            return weeks === 1
                ? d.formatDashboardLabel('previewLastOpenedWeekAgo', {}, '1 week ago')
                : d.formatDashboardLabel('previewLastOpenedWeeksAgo', { count: weeks }, `${weeks} weeks ago`);
        }
        const months = Math.floor(diffDays / 30);
        if (diffDays < 365) {
            return months === 1
                ? d.formatDashboardLabel('previewLastOpenedMonthAgo', {}, '1 month ago')
                : d.formatDashboardLabel('previewLastOpenedMonthsAgo', { count: months }, `${months} months ago`);
        }
        const years = Math.floor(diffDays / 365);
        return years === 1
            ? d.formatDashboardLabel('previewLastOpenedYearAgo', {}, '1 year ago')
            : d.formatDashboardLabel('previewLastOpenedYearsAgo', { count: years }, `${years} years ago`);
    }


    /**
     * "opened 35 times · last yesterday" for the preview card.
     *
     * The last-opened half goes through the shared formatLastOpened rather than
     * a local day count. Dividing elapsed milliseconds by a day, as this did,
     * measures elapsed hours and not calendar days: something opened at 23:00
     * last night still reported "today" until 23:00 the next day. The shared
     * formatter counts the day boundary crossed, so it says "yesterday" — and
     * says it in the same words Health and the config editor use.
     */
    formatPreviewUsageText(openCount, lastOpened) {
        const d = this.dash;
        const countText = openCount === 1
            ? d.formatDashboardLabel('previewOpenedOnce', {}, 'opened once')
            : d.formatDashboardLabel('previewOpenedMany', { count: openCount }, `opened ${openCount} times`);
        if (!lastOpened) {
            return countText;
        }
        const lastText = this.formatLastOpenedShared(lastOpened);
        if (!lastText) {
            return countText;
        }
        return d.formatDashboardLabel(
            'previewUsageWithLast',
            { count: countText, last: lastText },
            `${countText} · last ${lastText}`
        );
    }

    /**
     * The shared last-opened label, or '' when the bookmark has never been
     * opened. Dashboard labels are stored unprefixed, so the "dashboard." that
     * formatLastOpened asks for is stripped before the lookup.
     */
    formatLastOpenedShared(timestamp) {
        const d = this.dash;
        if (typeof window.formatLastOpened !== 'function') return '';
        const { label, never } = window.formatLastOpened(timestamp, {
            t: (key, fallback, params) => {
                const bare = String(key).startsWith('dashboard.') ? String(key).slice('dashboard.'.length) : key;
                return d.formatDashboardLabel(bare, params || {}, fallback);
            },
        });
        return never ? '' : label;
    }

    /*
     * "March 2019", for something that happened long ago.
     *
     * Not formatPreviewAgo: "6 years ago" is a worse answer than a date when the
     * question is when a page stopped existing. Month and year rather than a
     * full date because the archive's precision is a sampling interval, not a
     * moment -- claiming a day would be claiming more than is known.
     */
    formatPreviewDate(timestamp) {
        const at = Number(timestamp || 0);
        if (!at) return '';
        try {
            return new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
        } catch {
            return new Date(at).toISOString().slice(0, 7);
        }
    }

    /** "2 min ago" / "just now", for a timestamp the card reports on. */
    formatPreviewAgo(timestamp) {
        const d = this.dash;
        const at = Number(timestamp || 0);
        if (!at) return '';
        const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
        if (seconds < 60) return d.formatDashboardLabel('previewAgoJustNow', {}, 'just now');
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return d.formatDashboardLabel('previewAgoMinutes', { count: minutes }, `${minutes} min ago`);
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return d.formatDashboardLabel('previewAgoHours', { count: hours }, `${hours} h ago`);
        const days = Math.floor(hours / 24);
        return this.formatPreviewLastOpened(days);
    }


    /**
     * The card's markup, shared by the live card and the sample drawn in the
     * setting — so what the checklist previews is the card itself, not a
     * drawing of it that can drift.
     */
    static cardMarkup() {
        return `
            <div class="bookmark-preview-card-head">
                <span class="bookmark-preview-card-fav" hidden><img alt="" /></span>
                <div class="bookmark-preview-card-headtext">
                    <div class="bookmark-preview-card-title"></div>
                    <div class="bookmark-preview-card-domain"></div>
                </div>
                <span class="bookmark-preview-card-pill" hidden></span>
            </div>
            <div class="bookmark-preview-card-image-wrap" hidden><img class="bookmark-preview-card-image" alt="" loading="lazy" decoding="async" /></div>
            <div class="bookmark-preview-card-description" hidden></div>
            <p class="bookmark-preview-card-empty" hidden></p>
            <div class="bookmark-preview-card-note" hidden>
                <b class="bookmark-preview-card-note-label"></b>
                <span class="bookmark-preview-card-note-text"></span>
            </div>
            <div class="bookmark-preview-card-tags" hidden></div>
            <dl class="bookmark-preview-card-facts" hidden></dl>
            <div class="bookmark-preview-card-foot" hidden>
                <button type="button" class="bookmark-preview-card-action" data-preview-action="copy"></button>
                <button type="button" class="bookmark-preview-card-action" data-preview-action="refresh"></button>
                <button type="button" class="bookmark-preview-card-action" data-preview-action="edit"></button>
                <span class="bookmark-preview-card-esc">esc</span>
            </div>
        `;
    }

    ensureBookmarkPreviewCard() {
        const d = this.dash;
        if (d.previewCardElement) {
            return d.previewCardElement;
        }
        const card = document.createElement('div');
        card.className = 'bookmark-preview-card';
        card.id = 'bookmark-preview-card';
        // Named blocks with `hidden`, rather than seven siblings each toggled
        // through style.display: a band that has nothing to say is absent, and
        // whether it is absent is one attribute rather than an inline style.
        card.innerHTML = DashboardPreview.cardMarkup();
        const image = card.querySelector('.bookmark-preview-card-image');
        if (image) {
            // A hot-linked og:image rots at least as fast as the page behind
            // it. Without this the card drew the broken-image glyph in a
            // 150px band — the one kind of rot this app should never show.
            image.addEventListener('error', () => {
                card.querySelector('.bookmark-preview-card-image-wrap').hidden = true;
                image.removeAttribute('src');
            });
        }
        card.querySelector('.bookmark-preview-card-foot')?.addEventListener('click', (e) => {
            const button = e.target.closest('[data-preview-action]');
            if (!button) return;
            e.preventDefault();
            e.stopPropagation();
            this.runPreviewCardAction(button.dataset.previewAction);
        });
        card.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            const openLink = card._previewContext?.openLink;
            this.hideBookmarkPreviewCard();
            openLink?.focus?.();
        });
        document.body.appendChild(card);
        d.previewCardElement = card;
        return card;
    }

    /** Copy, refresh and edit, from a pinned card's footer. */
    runPreviewCardAction(action) {
        const d = this.dash;
        const ctx = d.previewCardElement?._previewContext;
        const bookmark = ctx?.bookmark;
        if (!bookmark) return;
        if (action === 'refresh') {
            void this.refreshVisibleBookmarkPreview();
            return;
        }
        if (action === 'copy') {
            const url = String(bookmark.url || '');
            void navigator.clipboard?.writeText?.(url);
            d.showNotification?.(
                d.formatDashboardLabel('previewCopied', {}, 'Link copied'),
                'success'
            );
            return;
        }
        if (action === 'edit') {
            const row = ctx.openLink?.closest?.('.bookmark-link') || null;
            const ref = d.resolveBookmarkReference?.(bookmark);
            this.hideBookmarkPreviewCard();
            if (row && ref) {
                d.openBookmarkInlineEditor(row, ref);
            }
        }
    }


    /**
     * Draw the card for one bookmark.
     *
     * `context.mode` is 'peek' (hover: nothing to aim at, no footer) or
     * 'pinned' (asked for: focusable, actions, Escape closes). `anchor` is the
     * element the card sits beside — the row — so the card is placed once and
     * holds still.
     */
    showBookmarkPreviewCard(preview, event = null, context = null) {
        const card = this.ensureBookmarkPreviewCard();
        const mode = context?.mode === 'pinned' ? 'pinned' : 'peek';

        if (context?.openLink && context?.bookmark) {
            card._previewContext = {
                openLink: context.openLink,
                bookmark: context.bookmark,
                mode,
            };
        }

        this.paintPreviewCard(card, preview, { mode });
        card.classList.add('is-visible');
        document.body.classList.add('preview-card-active');
        this.positionBookmarkPreviewCard(context?.openLink || null, event);

        if (mode === 'pinned') {
            card.focus?.();
            // The one place the card may ask the server: the figures the health
            // report holds, fetched once and redrawn when they land.
            void this.ensureHealthFactsLoaded().then((loaded) => {
                const ctx = card._previewContext;
                if (!loaded || !ctx?.bookmark || !card.classList.contains('is-visible')) return;
                this.paintPreviewFacts(card, this.buildPreviewFacts(
                    this.buildPreviewPayload(ctx.bookmark, ctx.openLink?._previewData || null),
                    this.previewParts()
                ));
            });
        }
    }

    /**
     * Fill one card element from a payload.
     *
     * Separate from showing it so the setting can draw the same card from a
     * real bookmark as the checklist is flipped — the one setting you otherwise
     * have to leave the screen and hover something to understand.
     */
    paintPreviewCard(card, preview, { mode = 'peek', parts = null } = {}) {
        const d = this.dash;
        const want = parts || this.previewParts();

        const text = (selector, value) => {
            const el = card.querySelector(selector);
            if (!el) return null;
            const shown = String(value || '').trim();
            el.textContent = shown;
            el.hidden = !shown;
            return el;
        };

        const title = String(preview?.title || '').trim()
            || String(preview?.url || '').trim()
            || d.formatDashboardLabel('previewUntitledLink', {}, 'Untitled link');
        card.querySelector('.bookmark-preview-card-title').textContent = title;
        text('.bookmark-preview-card-domain', this.formatPreviewAddress(preview));

        const favWrap = card.querySelector('.bookmark-preview-card-fav');
        const favImg = favWrap?.querySelector('img');
        const iconSrc = this.resolvePreviewIconSrc(preview?.icon);
        if (favWrap && favImg) {
            favWrap.hidden = !iconSrc;
            if (iconSrc) favImg.src = iconSrc;
            else favImg.removeAttribute('src');
        }

        this.paintPreviewPill(card, preview, want);

        const imageWrap = card.querySelector('.bookmark-preview-card-image-wrap');
        const imageEl = card.querySelector('.bookmark-preview-card-image');
        const image = want.has('image')
            ? (window.BookmarkUrlUtils?.safeHttpResourceUrl?.(preview?.image) || '')
            : '';
        if (image) {
            imageEl.alt = title;
            imageEl.src = image;
            // Shown once it loads: a card with no picture is a normal card,
            // never a broken one.
            imageWrap.hidden = false;
        } else {
            imageEl.removeAttribute('src');
            imageEl.alt = '';
            imageWrap.hidden = true;
        }

        const description = want.has('description') ? String(preview?.description || '').trim() : '';
        text('.bookmark-preview-card-description', description);

        // The note is the one line on the card nobody else could have written,
        // and it used to be the faintest thing on it. Clamped by CSS only — the
        // 140-character cut in JavaScript landed mid-word for no reason.
        const noteText = want.has('note') ? String(preview?.note || '').trim() : '';
        const noteEl = card.querySelector('.bookmark-preview-card-note');
        if (noteEl) {
            noteEl.hidden = !noteText;
            noteEl.querySelector('.bookmark-preview-card-note-label').textContent =
                d.formatDashboardLabel('previewYourNote', {}, 'Your note');
            noteEl.querySelector('.bookmark-preview-card-note-text').textContent = noteText;
        }

        const tagsEl = card.querySelector('.bookmark-preview-card-tags');
        const tags = want.has('tags') && Array.isArray(preview?.tags) ? preview.tags.filter(Boolean) : [];
        if (tagsEl) {
            tagsEl.innerHTML = '';
            tags.forEach((tag) => {
                const chip = document.createElement('span');
                chip.className = 'bookmark-tag-chip';
                chip.textContent = tag;
                tagsEl.appendChild(chip);
            });
            tagsEl.hidden = tags.length === 0;
        }

        const facts = this.buildPreviewFacts(preview, want);
        this.paintPreviewFacts(card, facts);

        // A link with no description, no picture and nothing to report would
        // otherwise be a title over empty space.
        const emptyEl = card.querySelector('.bookmark-preview-card-empty');
        if (emptyEl) {
            const bare = !description && !image && !noteText && !tags.length && !facts.length;
            emptyEl.textContent = bare
                ? d.formatDashboardLabel('previewNoDescription', {}, 'No description was fetched from this page.')
                : '';
            emptyEl.hidden = !bare;
        }

        this.applyPreviewCardMode(card, mode);
    }

    /** Peek takes no pointer events and carries no actions; pinned does both. */
    applyPreviewCardMode(card, mode) {
        const d = this.dash;
        card.dataset.previewMode = mode;
        card.classList.toggle('is-pinned', mode === 'pinned');
        const foot = card.querySelector('.bookmark-preview-card-foot');
        if (foot) {
            foot.hidden = mode !== 'pinned';
            if (mode === 'pinned') {
                foot.querySelector('[data-preview-action="copy"]').textContent =
                    d.formatDashboardLabel('previewActionCopy', {}, 'Copy');
                foot.querySelector('[data-preview-action="refresh"]').textContent =
                    d.formatDashboardLabel('previewActionRefresh', {}, 'Refresh');
                foot.querySelector('[data-preview-action="edit"]').textContent =
                    d.formatDashboardLabel('previewActionEdit', {}, 'Edit');
            }
        }
        if (mode === 'pinned') {
            card.setAttribute('role', 'dialog');
            card.setAttribute('aria-label', d.formatDashboardLabel('previewCardAria', {}, 'Bookmark preview'));
            card.setAttribute('tabindex', '-1');
        } else {
            card.removeAttribute('role');
            card.removeAttribute('aria-label');
            card.removeAttribute('tabindex');
        }
    }

    /** The address, once — the domain, with the path when there is one. */
    formatPreviewAddress(preview) {
        const domain = String(preview?.domain || '').trim();
        const url = String(preview?.url || '').trim();
        if (!domain) return url;
        try {
            const parsed = new URL(url);
            const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
            const host = parsed.host || domain;
            return path && path !== '/' ? `${host}${path}` : host;
        } catch (_error) {
            return domain;
        }
    }

    /** Bare filenames are served from /data/icons/, as everywhere else. */
    resolvePreviewIconSrc(icon) {
        const value = String(icon || '').trim();
        if (!value) return '';
        if (/^(https?:|data:|\/)/i.test(value)) return value;
        return `/data/icons/${encodeURIComponent(value)}`;
    }

    /** The status pill: the question the rest of the app exists to answer. */
    paintPreviewPill(card, preview, parts) {
        const d = this.dash;
        const pill = card.querySelector('.bookmark-preview-card-pill');
        if (!pill) return;
        const checked = parts.has('status') ? preview?.checked : null;
        if (!checked) {
            pill.hidden = true;
            pill.className = 'bookmark-preview-card-pill';
            return;
        }
        let tone = 'unknown';
        let label = d.formatDashboardLabel('previewStatusUnchecked', {}, 'Not checked');
        if (checked.state === 'online') {
            // Slow is still online — but "2.4 s" beside a green dot reads as
            // fine, and it is the thing worth noticing.
            const slow = checked.ping >= 1500;
            tone = slow ? 'warn' : 'ok';
            label = slow
                ? d.formatDashboardLabel('previewStatusSlow', {}, 'Slow')
                : d.formatDashboardLabel('previewStatusOnline', {}, 'Online');
        } else if (checked.state === 'offline') {
            tone = 'bad';
            label = d.formatDashboardLabel('previewStatusOffline', {}, 'Offline');
        }
        pill.className = `bookmark-preview-card-pill is-${tone}`;
        pill.textContent = label;
        pill.hidden = false;
    }

    /**
     * The facts strip: label, value, and a tone for the values that carry one.
     *
     * Every row is optional and every row is derived from what is already in
     * memory. "Never opened" is a row rather than nothing — it is the most
     * interesting state a bookmark can be in, and the old card hid it.
     */
    buildPreviewFacts(preview, parts = null) {
        const d = this.dash;
        const want = parts || this.previewParts();
        const rows = [];
        const checked = preview?.checked;
        if (want.has('status') && checked) {
            if (checked.state === 'offline') {
                rows.push({
                    label: d.formatDashboardLabel('previewFactFailing', {}, 'Failing'),
                    value: checked.error || d.formatDashboardLabel('previewStatusOffline', {}, 'Offline'),
                    muted: preview.health?.brokenSince
                        ? this.formatPreviewAgo(preview.health.brokenSince)
                        : this.formatPreviewAgo(checked.lastChecked),
                    tone: 'bad',
                });
            } else if (checked.ping > 0 || checked.lastChecked) {
                rows.push({
                    label: d.formatDashboardLabel('previewFactChecked', {}, 'Checked'),
                    value: checked.ping > 0 ? `${checked.ping} ms` : '—',
                    muted: this.formatPreviewAgo(checked.lastChecked),
                    tone: checked.ping >= 1500 ? 'warn' : 'good',
                });
            }
        }
        /*
         * When the web lost this page, beside how long it has been failing here.
         *
         * Only for a link that is actually failing: a working page has no death
         * to report, and the archive's view of a page that briefly 500'd is not
         * news. It sits directly under the failure it explains, because "failing
         * since Tuesday" and "gone since 2019" only make sense together.
         */
        const archive = want.has('status') ? preview?.archive : null;
        if (archive?.diedAt && checked?.state === 'offline') {
            rows.push({
                label: d.formatDashboardLabel('previewFactGoneSince', {}, 'Gone from the web'),
                value: this.formatPreviewDate(archive.diedAt),
                muted: archive.snapshot
                    ? d.formatDashboardLabel('previewFactArchiveHasCopy', {}, 'the archive has a copy')
                    : '',
                tone: 'bad',
            });
        }

        const health = want.has('status') ? preview?.health : null;
        if (health?.uptime30d !== null && health?.uptime30d !== undefined && health?.uptimeSamples) {
            rows.push({
                label: d.formatDashboardLabel('previewFactUptime', {}, 'Uptime'),
                value: `${(Number(health.uptime30d) * 100).toFixed(2)}%`,
                muted: d.formatDashboardLabel('previewFactUptimeWindow', {}, 'over 30 days'),
            });
        }
        if (health?.certExpiresAt) {
            const days = Math.round((health.certExpiresAt - Date.now()) / 86400000);
            if (days <= 30) {
                rows.push({
                    label: d.formatDashboardLabel('previewFactCert', {}, 'Cert'),
                    value: d.formatDashboardLabel('previewFactCertExpires', { count: days }, `Expires in ${days} days`),
                    tone: days <= 14 ? 'bad' : 'warn',
                });
            }
        }
        const fresh = want.has('fresh') ? preview?.fresh : null;
        if (fresh?.newCount > 0) {
            rows.push({
                label: d.formatDashboardLabel('previewFactFresh', {}, 'Fresh'),
                value: d.formatDashboardLabel('previewFactFreshCount', { count: fresh.newCount }, `${fresh.newCount} new`),
                muted: fresh.lastItemAt ? this.formatPreviewAgo(fresh.lastItemAt) : '',
                tone: 'good',
            });
        } else if (fresh?.hasFeed) {
            rows.push({
                label: d.formatDashboardLabel('previewFactFresh', {}, 'Fresh'),
                value: d.formatDashboardLabel('previewFactFreshNone', {}, 'Nothing new'),
            });
        }
        if (want.has('opens')) {
            const openCount = Number(preview?.openCount || 0);
            if (openCount > 0) {
                rows.push({
                    label: d.formatDashboardLabel('previewFactOpens', {}, 'Opens'),
                    value: String(openCount),
                    muted: preview?.lastOpened ? this.formatLastOpenedShared(preview.lastOpened) : '',
                });
            } else {
                // The old card hid this row entirely, so the state worth acting
                // on was the one state it never showed.
                rows.push({
                    label: d.formatDashboardLabel('previewFactOpens', {}, 'Opens'),
                    value: d.formatDashboardLabel('previewNeverOpened', {}, 'Never opened'),
                    // When it was saved, not when it was last anything — "never
                    // opened · just now" reads as a contradiction.
                    muted: preview?.createdAt
                        ? d.formatDashboardLabel('previewSavedAgo', { ago: this.formatPreviewAgo(preview.createdAt) },
                            `saved ${this.formatPreviewAgo(preview.createdAt)}`)
                        : '',
                    tone: 'warn',
                });
            }
        }
        if (want.has('location')) {
            const shortcut = String(preview?.shortcut || '').trim();
            const location = String(preview?.location || '').trim();
            if (shortcut || location) {
                rows.push({
                    label: d.formatDashboardLabel('previewFactKey', {}, 'Key'),
                    value: shortcut,
                    key: Boolean(shortcut),
                    muted: location,
                });
            }
        }
        return rows;
    }

    paintPreviewFacts(card, rows) {
        const list = card.querySelector('.bookmark-preview-card-facts');
        if (!list) return;
        list.innerHTML = '';
        rows.forEach((row) => {
            const dt = document.createElement('dt');
            dt.textContent = row.label;
            const dd = document.createElement('dd');
            if (row.tone) dd.classList.add(`is-${row.tone}`);
            if (row.value) {
                const strong = document.createElement(row.key ? 'kbd' : 'b');
                strong.textContent = row.value;
                dd.appendChild(strong);
            }
            if (row.muted) {
                const muted = document.createElement('span');
                muted.className = 'bookmark-preview-card-muted';
                muted.textContent = row.value ? ` · ${row.muted}` : row.muted;
                dd.appendChild(muted);
            }
            list.appendChild(dt);
            list.appendChild(dd);
        });
        list.hidden = rows.length === 0;
    }


    /**
     * Place the card beside its row, once.
     *
     * It used to be repositioned on every pixel of mousemove, so reaching it
     * meant chasing something that moved away, and on a dense grid it slid
     * across the rows underneath. Anchored to the row it describes, it holds
     * still — the keyboard path already did exactly this.
     */
    positionBookmarkPreviewCard(anchor, event = null) {
        const d = this.dash;
        const card = d.previewCardElement;
        if (!card) return;
        const margin = 12;
        const gap = 16;

        const rect = card.getBoundingClientRect();
        const width = rect.width || 360;
        const height = rect.height || 140;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const row = anchor?.closest?.('.bookmark-link') || anchor || null;
        const box = row?.getBoundingClientRect?.();
        let left;
        let top;
        if (box && box.width) {
            left = box.right + gap;
            if (left + width > vw - margin) {
                left = box.left - width - gap;
            }
            top = box.top;
        } else {
            const x = Number(event?.clientX ?? vw / 2);
            const y = Number(event?.clientY ?? vh / 2);
            left = x + gap;
            if (left + width > vw - margin) left = x - width - gap;
            top = y + gap;
        }

        left = Math.min(Math.max(margin, left), Math.max(margin, vw - width - margin));
        top = Math.min(Math.max(margin, top), Math.max(margin, vh - height - margin));

        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
    }


    hideBookmarkPreviewCard() {
        const d = this.dash;
        if (!d.previewCardElement) return;
        d.previewCardElement.classList.remove('is-visible', 'is-pinned');
        d.previewCardElement.dataset.previewMode = '';
        d.previewCardElement._previewContext = null;
        d._previewCardHovered = false;
        document.body.classList.remove('preview-card-active');
    }


    dismissBookmarkPreviewInteractions() {
        const hoverLinks = document.querySelectorAll('.bookmark-open');
        hoverLinks.forEach((linkEl) => {
            if (linkEl && linkEl._previewHoverTimer) {
                clearTimeout(linkEl._previewHoverTimer);
                linkEl._previewHoverTimer = null;
            }
            if (linkEl) {
                linkEl._previewHoverActive = false;
            }
        });
        this.hideBookmarkPreviewCard();
    }

}

window.DashboardPreview = DashboardPreview;
