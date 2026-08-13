/**
 * Smart collection evaluation and refresh.
 */
class DashboardSmartCollections {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    smartCollectionsNeedRefreshAfterOpen() {
        const d = this.dash;
        if (d.settings.showSmartTodayCollection !== false && this._isSmartCollectionPageAllowed(d.settings.smartTodayPageIds)) {
            return true;
        }
        if (d.settings.showSmartRecentCollection !== false && this._isSmartCollectionPageAllowed(d.settings.smartRecentPageIds)) {
            return true;
        }
        if (d.settings.showSmartStaleCollection !== false && this._isSmartCollectionPageAllowed(d.settings.smartStalePageIds)) {
            return true;
        }
        if (d.settings.showSmartMostUsedCollection === true && this._isSmartCollectionPageAllowed(d.settings.smartMostUsedPageIds)) {
            return true;
        }
        return false;
    }


    _sortSmartCollectionBookmarks(collection) {
        const d = this.dash;
        if (collection.id === '__smart_recent__') {
            return [...collection.bookmarks].sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
        }
        if (collection.id === '__smart_most_used__') {
            return [...collection.bookmarks].sort((a, b) => Number(b.openCount || 0) - Number(a.openCount || 0));
        }
        if (collection.id === '__smart_today__') {
            return [...collection.bookmarks];
        }
        return d.sortBookmarks(collection.bookmarks);
    }


    refreshSmartCollectionSections() {
        const d = this.dash;
        const container = document.getElementById('dashboard-layout');
        if (!container || d.hasActiveTagFilters()) {
            d.renderDashboard();
            return;
        }

        const collections = this.getSmartCollections(this.getSmartCollectionSourceBookmarks())
            .filter((collection) => Array.isArray(collection.bookmarks) && collection.bookmarks.length > 0);

        const existingSmart = Array.from(container.querySelectorAll('.category[data-smart-collection="true"]'));
        if (collections.length !== existingSmart.length) {
            d.renderDashboard();
            return;
        }

        const nextIds = collections.map((collection) => String(collection.id));
        const orderMatches = existingSmart.every((element, index) => (
            String(element.getAttribute('data-category-id')) === nextIds[index]
        ));
        if (!orderMatches) {
            d.renderDashboard();
            return;
        }

        collections.forEach((collection, index) => {
            const collectionBookmarks = this._sortSmartCollectionBookmarks(collection);
            const replacement = d.createCategoryElement({
                id: collection.id,
                name: collection.name,
                icon: collection.icon,
                isSmartCollection: true,
                customCollection: collection.customCollection || null,
            }, collectionBookmarks);
            existingSmart[index].replaceWith(replacement);
        });

        d._categoryListsCache = null;
        d.syncBookmarkGridA11y();
        d.keyboardNavigation?.scheduleUpdate?.();
    }


    getSmartCollections(bookmarks) {
        const d = this.dash;
        const now = Date.now();
        const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
        const staleWindowMs = 30 * 24 * 60 * 60 * 1000;
        const normalized = Array.isArray(bookmarks) ? bookmarks : [];

        const pageAllowed = (pageIds) => this._isSmartCollectionPageAllowed(pageIds);

        // Each list is built on first use rather than up front: this runs on every
        // dashboard render, and a collection that is switched off — Most used is,
        // by default — was still costing a full scan of every bookmark, plus a
        // sort in that one case.
        const memo = (fn) => {
            let value;
            let done = false;
            return () => {
                if (!done) { value = fn(); done = true; }
                return value;
            };
        };

        const recentBookmarks = memo(() => normalized.filter((bookmark) => {
            const lastOpened = Number(bookmark.lastOpened || 0);
            return lastOpened > 0 && (now - lastOpened) <= oneWeekMs;
        }));

        const staleBookmarks = memo(() => normalized.filter((bookmark) => {
            const lastOpened = Number(bookmark.lastOpened || 0);
            return lastOpened === 0 || (now - lastOpened) > staleWindowMs;
        }));

        const mostUsedBookmarks = memo(() => normalized
            .filter((bookmark) => Number(bookmark.openCount || 0) > 0)
            .sort((a, b) => Number(b.openCount || 0) - Number(a.openCount || 0)));

        const todayBookmarks = memo(() => this.getSmartStartTodayBookmarks(normalized));

        const collections = [];

        if (d.settings.showSmartTodayCollection !== false && pageAllowed(d.settings.smartTodayPageIds) && todayBookmarks().length > 0) {
            const today = todayBookmarks();
            const translatedTodayLabel = d.language?.t?.('dashboard.smartTodayCollection');
            const todayLabel = translatedTodayLabel && translatedTodayLabel !== 'dashboard.smartTodayCollection'
                ? translatedTodayLabel
                : 'Today';
            collections.push({
                id: '__smart_today__',
                name: `${todayLabel} (${today.length})`,
                icon: '☀',
                bookmarks: today
            });
        }

        if (d.settings.showSmartRecentCollection !== false && pageAllowed(d.settings.smartRecentPageIds) && recentBookmarks().length > 0) {
            const recent = recentBookmarks();
            const configuredLimit = Number(d.settings.smartRecentLimit ?? 50);
            const effectiveLimit = Number.isFinite(configuredLimit) && configuredLimit > 0
                ? configuredLimit
                : null;
            const recentLabel = d.language?.t?.('dashboard.smartRecentCollection');
            const recentTitle = recentLabel && recentLabel !== 'dashboard.smartRecentCollection'
                ? recentLabel
                : 'Recently opened';
            const recentCount = effectiveLimit ? Math.min(recent.length, effectiveLimit) : recent.length;
            collections.push({
                id: '__smart_recent__',
                name: `${recentTitle} (${recentCount})`,
                icon: '⚡',
                bookmarks: effectiveLimit ? recent.slice(0, effectiveLimit) : recent
            });
        }

        if (d.settings.showSmartStaleCollection !== false && pageAllowed(d.settings.smartStalePageIds) && staleBookmarks().length > 0) {
            const stale = staleBookmarks();
            const configuredLimit = Number(d.settings.smartStaleLimit ?? 50);
            const effectiveLimit = Number.isFinite(configuredLimit) && configuredLimit > 0
                ? configuredLimit
                : null;
            const staleLabel = d.language?.t?.('dashboard.smartStaleCollection');
            const staleTitle = staleLabel && staleLabel !== 'dashboard.smartStaleCollection'
                ? staleLabel
                : 'Stale bookmarks';
            const staleCount = effectiveLimit ? Math.min(stale.length, effectiveLimit) : stale.length;
            collections.push({
                id: '__smart_stale__',
                name: `${staleTitle} (${staleCount})`,
                icon: '⌛',
                bookmarks: effectiveLimit ? stale.slice(0, effectiveLimit) : stale
            });
        }

        if (d.settings.showSmartMostUsedCollection === true && pageAllowed(d.settings.smartMostUsedPageIds) && mostUsedBookmarks().length > 0) {
            const mostUsed = mostUsedBookmarks();
            const configuredLimit = Number(d.settings.smartMostUsedLimit ?? 25);
            const effectiveLimit = Number.isFinite(configuredLimit) && configuredLimit > 0
                ? configuredLimit
                : null;
            const mostUsedLabel = d.language?.t?.('dashboard.smartMostUsedCollection');
            const mostUsedTitle = mostUsedLabel && mostUsedLabel !== 'dashboard.smartMostUsedCollection'
                ? mostUsedLabel
                : 'Most used';
            collections.push({
                id: '__smart_most_used__',
                name: mostUsedTitle,
                icon: '📈',
                bookmarks: effectiveLimit ? mostUsed.slice(0, effectiveLimit) : mostUsed
            });
        }

        // User-defined collections from settings
        const userCollections = Array.isArray(d.settings?.collections) ? d.settings.collections : [];
        for (const col of userCollections) {
            if (!col.id || !col.name || !Array.isArray(col.rules) || col.rules.length === 0) continue;
            const matched = this._evaluateCollection(col, normalized);
            collections.push({
                id: `custom:${col.id}`,
                name: col.icon ? `${col.icon} ${col.name}` : col.name,
                icon: col.icon || '',
                bookmarks: matched,
                isSmartCollection: true,
                customCollection: col,
            });
        }

        if (d.settings?.showTagCollections) {
            const minCount = d.settings.tagCollectionsMinCount || 0;
            const tagMap = new Map();
            normalized.forEach(bm => {
                (bm.tags || []).forEach(tag => {
                    if (!tagMap.has(tag)) tagMap.set(tag, []);
                    tagMap.get(tag).push(bm);
                });
            });
            [...tagMap.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .forEach(([tag, bms]) => {
                    if (minCount > 0 && bms.length < minCount) return;
                    collections.push({
                        id: `tag:${tag}`,
                        name: `🏷 ${tag}`,
                        icon: '🏷',
                        bookmarks: bms,
                        isSmartCollection: true
                    });
                });
        }

        return collections;
    }


    _smartWhyT(key, fallback, vars = {}) {
        const d = this.dash;
        const fullKey = `dashboard.${key}`;
        let text = d.language?.t?.(fullKey);
        if (!text || text === fullKey) text = fallback;
        Object.entries(vars).forEach(([k, v]) => {
            text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        });
        return text;
    }


    _getCurrentPageDisplayName() {
        const d = this.dash;
        const page = (d.pages || []).find((p) => Number(p.id) === Number(d.currentPageId));
        const raw = page?.name || this._smartWhyT('defaultPageTitle', 'dashboard');
        return String(raw).trim() || 'dashboard';
    }


    _formatSmartWhyLimitSuffix(settingsKey, defaultLimit = 0) {
        const d = this.dash;
        const configured = Number(d.settings?.[settingsKey] ?? defaultLimit);
        if (!Number.isFinite(configured) || configured <= 0) return '';
        return this._smartWhyT('smartWhyLimitSuffix', ' Up to {limit} shown.', { limit: configured });
    }


    getSmartCollectionWhyHint(collectionId, category = {}) {
        const d = this.dash;
        const page = this._getCurrentPageDisplayName();

        if (collectionId === '__smart_today__') {
            return this._smartWhyT(
                'smartWhyToday',
                'Smart picks for now — recent opens, pins, and time-of-day keywords.{limitSuffix} Visible on page “{page}”.',
                { page, limitSuffix: this._formatSmartWhyLimitSuffix('smartTodayLimit', 8) }
            );
        }
        if (collectionId === '__smart_recent__') {
            return this._smartWhyT(
                'smartWhyRecent',
                'Bookmarks opened in the last 7 days.{limitSuffix} Visible on page “{page}”.',
                { page, limitSuffix: this._formatSmartWhyLimitSuffix('smartRecentLimit', 50) }
            );
        }
        if (collectionId === '__smart_stale__') {
            return this._smartWhyT(
                'smartWhyStale',
                'Not opened in 30+ days (or never).{limitSuffix} Visible on page “{page}”.',
                { page, limitSuffix: this._formatSmartWhyLimitSuffix('smartStaleLimit', 50) }
            );
        }
        if (collectionId === '__smart_most_used__') {
            return this._smartWhyT(
                'smartWhyMostUsed',
                'Your most-opened bookmarks.{limitSuffix} Visible on page “{page}”.',
                { page, limitSuffix: this._formatSmartWhyLimitSuffix('smartMostUsedLimit', 25) }
            );
        }
        if (String(collectionId).startsWith('tag:')) {
            const tag = String(collectionId).slice(4);
            return this._smartWhyT(
                'smartWhyTag',
                'All bookmarks tagged “{tag}”. Visible on page “{page}”.',
                { tag, page }
            );
        }
        if (String(collectionId).startsWith('custom:')) {
            const col = category.customCollection;
            if (!col || !Array.isArray(col.rules) || col.rules.length === 0) {
                return this._smartWhyT(
                    'smartWhyCustomGeneric',
                    'Matches rules you set in config → collections. Visible on page “{page}”.',
                    { page }
                );
            }
            const joiner = String(col.logic || 'and').toLowerCase() === 'or' ? ' OR ' : ' AND ';
            const rules = col.rules
                .map((rule) => {
                    const field = rule.field || 'tag';
                    const op = rule.operator === 'excludes' ? 'excludes' : 'includes';
                    const value = String(rule.value || '').trim();
                    if (!value) return '';
                    return `${field} ${op} “${value}”`;
                })
                .filter(Boolean)
                .join(joiner);
            return this._smartWhyT(
                'smartWhyCustom',
                'Your collection rules: {rules}. Visible on page “{page}”.',
                { rules: rules || '—', page }
            );
        }
        return '';
    }


    _evaluateCollection(collection, bookmarks) {
        const d = this.dash;
        return bookmarks.filter(bm => {
            const results = collection.rules.map(rule => {
                const field = rule.field;
                const op = rule.operator || 'includes';
                const val = (rule.value || '').toLowerCase();
                if (!val) return false;
                if (field === 'tag') {
                    const has = (bm.tags || []).some(t => t.toLowerCase() === val);
                    return op === 'excludes' ? !has : has;
                }
                if (field === 'category') {
                    const match = (bm.category || '').toLowerCase() === val;
                    return op === 'excludes' ? !match : match;
                }
                if (field === 'shortcut') {
                    const match = (bm.shortcut || '').toLowerCase() === val;
                    return op === 'excludes' ? !match : match;
                }
                return false;
            });
            return collection.logic === 'or' ? results.some(Boolean) : results.every(Boolean);
        });
    }


    getSmartStartTodayBookmarks(bookmarks) {
        const d = this.dash;
        const source = Array.isArray(bookmarks) ? bookmarks : [];
        if (source.length === 0) {
            return [];
        }

        const now = new Date();
        const nowMs = now.getTime();
        const hour = now.getHours();
        const day = now.getDay(); // 0 = Sunday, 1 = Monday, ...
        const oneDayMs = 24 * 60 * 60 * 1000;
        const oneWeekMs = 7 * oneDayMs;
        const oneMonthMs = 30 * oneDayMs;
        const configuredLimit = Number(d.settings.smartTodayLimit ?? 8);
        const maxItems = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : null;

        const keywordBoosts = this.getSmartStartKeywordBoosts(hour, day);
        const seenUrls = new Set();
        const scored = [];

        source.forEach((bookmark) => {
            const url = String(bookmark?.url || '').trim();
            if (!url || seenUrls.has(url)) {
                return;
            }
            seenUrls.add(url);

            const openCount = Number(bookmark.openCount || 0);
            const lastOpened = Number(bookmark.lastOpened || 0);
            const isPinned = Boolean(bookmark.pinned);
            const haystack = `${String(bookmark?.name || '')} ${url}`.toLowerCase();

            let score = 0;
            if (openCount > 0) {
                score += Math.min(18, Math.log2(openCount + 1) * 6);
            }
            if (isPinned) {
                score += 10;
            }

            if (lastOpened > 0) {
                const age = nowMs - lastOpened;
                if (age <= oneDayMs) {
                    score += 26;
                } else if (age <= (3 * oneDayMs)) {
                    score += 18;
                } else if (age <= oneWeekMs) {
                    score += 12;
                } else if (age <= oneMonthMs) {
                    score += 6;
                }
            } else if (openCount === 0) {
                score -= 4;
            }

            keywordBoosts.forEach(({ keyword, boost }) => {
                if (haystack.includes(keyword)) {
                    score += boost;
                }
            });

            if (this.isCurrentPageBookmark(bookmark)) {
                score += 2;
            }

            scored.push({ bookmark, score, lastOpened, openCount });
        });

        scored.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            if ((b.lastOpened || 0) !== (a.lastOpened || 0)) {
                return (b.lastOpened || 0) - (a.lastOpened || 0);
            }
            if ((b.openCount || 0) !== (a.openCount || 0)) {
                return (b.openCount || 0) - (a.openCount || 0);
            }
            return String(a.bookmark?.name || '').localeCompare(String(b.bookmark?.name || ''), undefined, { sensitivity: 'base' });
        });

        return (maxItems ? scored.slice(0, maxItems) : scored).map((entry) => entry.bookmark);
    }


    getSmartStartKeywordBoosts(hour, day) {
        const d = this.dash;
        const commonBoosts = this.parseSmartKeywordList(d.settings.smartTodayWorkKeywords, 4, 3);
        const eveningBoosts = this.parseSmartKeywordList(d.settings.smartTodayEveningKeywords, 5, 3);
        const weekendBoosts = this.parseSmartKeywordList(d.settings.smartTodayWeekendKeywords, 3, 2);

        const boosts = [...commonBoosts];
        if (hour >= 18 || hour < 6) {
            boosts.push(...eveningBoosts);
        }
        if (day === 0 || day === 6) {
            boosts.push(...weekendBoosts);
        }
        return boosts;
    }


    parseSmartKeywordList(raw, firstBoost = 4, restBoost = 3) {
        const d = this.dash;
        const text = String(raw || '');
        const tokens = text
            .split(',')
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean);
        return tokens.map((keyword, index) => ({
            keyword,
            boost: index === 0 ? firstBoost : restBoost
        }));
    }


    isCurrentPageBookmark(bookmark) {
        const d = this.dash;
        const bookmarkPage = Number(bookmark?.pageId);
        const currentPage = Number(d.currentPageId);
        if (Number.isFinite(bookmarkPage) && Number.isFinite(currentPage) && bookmarkPage > 0) {
            return bookmarkPage === currentPage;
        }
        return true;
    }


    getSmartCollectionSourceBookmarks() {
        const d = this.dash;
        if (Array.isArray(d.allBookmarks) && d.allBookmarks.length > 0) {
            return d.allBookmarks;
        }
        return d.bookmarks;
    }


    getStaleBookmarksList(days) {
        const d = this.dash;
        const effectiveDays = (days && days > 0) ? days : 30;
        const staleWindowMs = effectiveDays * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const source = this.getSmartCollectionSourceBookmarks();
        if (!Array.isArray(source)) {
            return [];
        }
        return source.filter((bookmark) => {
            const lastOpened = Number(bookmark.lastOpened || 0);
            return lastOpened === 0 || (now - lastOpened) > staleWindowMs;
        });
    }


    scrollToStaleCollection() {
        const d = this.dash;
        const el = document.querySelector('.category[data-category-id="__smart_stale__"]');
        if (!el) {
            d.showNotification(
                d.formatDashboardLabel(
                    'staleSectionNotVisible',
                    {},
                    'Stale section not visible (disabled in settings, wrong page filter, or no stale rows).'
                ),
                'info'
            );
            return;
        }
        const collapsedKey = 'smart:__smart_stale__';
        el.setAttribute('data-collapsed', 'false');
        d.collapsedCategories[collapsedKey] = false;
        d.saveCollapsedStates();
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        el.classList.add('nextdash-stale-flash');
        setTimeout(() => el.classList.remove('nextdash-stale-flash'), ANIM.STALE_FLASH);
    }


    /**
     * Shared by _isSmartCollectionPageAllowed here and
     * _smartCollectionFilterNeedsCrossPageData in dashboard-data.js. Those two
     * ask genuinely different questions from the same normalized id/index set
     * — "is the current page in scope" vs. "does this scope reach beyond the
     * current page" — and are NOT inverses of each other (a scope covering the
     * current page *and* another page is allowed=true and still needs
     * cross-page data=true; an empty/all-pages scope is allowed=true and
     * needs cross-page data=true too). An earlier commit collapsed the second
     * into `!` of the first, which silently broke cross-page loading for the
     * default (empty pageIds = all pages) case. Only the id normalization —
     * genuinely identical between them — gets shared here.
     */
    _resolveSmartCollectionPageIdentity() {
        const d = this.dash;
        const currentPageId = Number(d.currentPageId);
        const currentPageIndex = d.pages.findIndex((page) => Number(page.id) === currentPageId);
        const currentPageNumber = currentPageIndex >= 0 ? (currentPageIndex + 1) : null;
        return { currentPageId, currentPageNumber };
    }

    _normalizeSmartCollectionPageIds(pageIds) {
        return (Array.isArray(pageIds) ? pageIds : [])
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0);
    }

    _isSmartCollectionPageAllowed(pageIds) {
        const { currentPageId, currentPageNumber } = this._resolveSmartCollectionPageIdentity();
        if (!Array.isArray(pageIds) || pageIds.length === 0) {
            return true;
        }
        const normalizedIds = this._normalizeSmartCollectionPageIds(pageIds);
        if (normalizedIds.includes(currentPageId)) {
            return true;
        }
        if (currentPageNumber !== null && normalizedIds.includes(currentPageNumber)) {
            return true;
        }
        return false;
    }


    refreshSmartCollectionsAfterOpen(url) {
        const d = this.dash;
        if (!url) {
            return;
        }
        if (!this.smartCollectionsNeedRefreshAfterOpen()) {
            return;
        }
        if (d.inlineEditingBookmarkIndex !== null) {
            return;
        }
        // Smart collections are sections of the bookmarks grid, so refreshing
        // them from another view repaints something nobody is looking at — and
        // the repaint goes through renderDashboard, which re-renders whichever
        // view *is* active. Opening a bookmark from Config → Bookmarks that way
        // rebuilt the whole panel and re-ran its filters, so the row you had
        // just opened vanished out from under you when the list was filtered to
        // never-opened. The grid is rebuilt on the way back to it regardless.
        if (d.isBookmarksView && !d.isBookmarksView()) {
            return;
        }
        this.refreshSmartCollectionSections();
    }

}

window.DashboardSmartCollections = DashboardSmartCollections;
