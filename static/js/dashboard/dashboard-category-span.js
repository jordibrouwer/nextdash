/**
 * Spread: whether a category may run across several grid columns.
 *
 * It is a switch, not a number. How many columns a spread category takes is not
 * a preference — it follows from two things that already exist:
 *
 *   items per category  caps the height of one column
 *   bookmarks in it     is how much there is to place
 *
 * So a spread category holding forty bookmarks with a limit of fifteen takes
 * three columns, and shrinks back to two when five of them are deleted. Nothing
 * to keep in sync by hand, and no way to end up with a category three columns
 * wide and half empty.
 *
 * Two things bound it: the grid never has more columns than the column count,
 * and with no limit at all ("Unlimited") there is no column height to fill, so a
 * category stays one column wide and grows downwards as it always did.
 *
 * Where the switch lives depends on what the category is. A real category is a
 * stored object, so it rides along with its name and sort mode in
 * bookmarks-{page}.json. Uncategorized and the smart collections have no stored
 * object at all, so theirs goes in settings.categorySpreads[pageId][categoryId] —
 * the same shape, and for the same reason, as categorySortModes. Everything that
 * changes it goes through setCategorySpread, so no caller has to know which of
 * the two applies.
 */
(function () {
    const MAX_SPAN = 12;

    function isPersistedCategory(dash, categoryId) {
        const id = String(categoryId ?? '');
        return (dash?.categories || []).some((cat) => String(cat.id) === id);
    }

    /** Whether this category is allowed to run across columns. */
    function isCategorySpread(dash, category) {
        if (!dash || !category || category.tagFilterChunk === true) {
            return false;
        }
        const id = String(category.id ?? '');
        if (category.spread != null) {
            return category.spread === true;
        }
        if (category.isSmartCollection !== true && isPersistedCategory(dash, id)) {
            const match = (dash.categories || []).find((cat) => String(cat.id) === id);
            return match?.spread === true;
        }
        const pageKey = String(dash.currentPageId);
        return dash.settings?.categorySpreads?.[pageKey]?.[id] === true;
    }

    /** The columns the grid can give, which is also the ceiling on any width. */
    function availableColumns(dash) {
        return dash?.renderCore?.getEffectiveColumnsPerRow?.() || 1;
    }

    /**
     * Whether spreading can do anything at all right now.
     *
     * One column has nothing to spread across — that is also every phone. And
     * with items per category set to Unlimited there is no column height to
     * fill, so a spread category would have nothing to spread into.
     */
    function spreadUnavailableReason(dash) {
        if (availableColumns(dash) <= 1) {
            return 'single-column';
        }
        const limit = Number(dash?.settings?.categoryItemLimit);
        if (!Number.isFinite(limit) || limit <= 0) {
            return 'unlimited-items';
        }
        return null;
    }

    function spreadSupported(dash) {
        return spreadUnavailableReason(dash) === null;
    }

    /**
     * The columns `count` bookmarks ask for in a spread category.
     *
     * Rounded up, so the last column may be short — sixteen bookmarks with a
     * limit of fifteen take two columns, one of them holding a single row. The
     * alternative is hiding that sixteenth behind "+ 1 more" while the space
     * for it is right there.
     */
    function spanForCount(dash, count) {
        if (!spreadSupported(dash)) {
            return 1;
        }
        const limit = Number(dash.settings.categoryItemLimit);
        const rows = Number(count) || 0;
        const needed = Math.ceil(rows / limit);
        return Math.max(1, Math.min(needed, availableColumns(dash), MAX_SPAN));
    }

    /** The bookmarks a rendered category holds, hidden overflow included. */
    function countFromElement(categoryEl) {
        return categoryEl?.querySelectorAll('.bookmark-link').length || 0;
    }

    /** The width a rendered category was given, read back off the element. */
    function effectiveSpanFromElement(el) {
        if (!el || !el.classList?.contains('category--wide')) {
            return 1;
        }
        const parsed = parseInt(el.style.getPropertyValue('--category-span'), 10);
        return Number.isFinite(parsed) && parsed > 1 ? Math.min(parsed, MAX_SPAN) : 1;
    }

    /** The width this category should be drawn at, switch and content together. */
    function effectiveCategorySpan(dash, category, count) {
        if (!isCategorySpread(dash, category)) {
            return 1;
        }
        return spanForCount(dash, count);
    }

    function ensurePageSpreadMap(dash, pageId) {
        if (!dash.settings.categorySpreads) {
            dash.settings.categorySpreads = {};
        }
        const pageKey = String(pageId);
        if (!dash.settings.categorySpreads[pageKey]) {
            dash.settings.categorySpreads[pageKey] = {};
        }
        return dash.settings.categorySpreads[pageKey];
    }

    /**
     * Turn spreading on or off. Returns what was stored.
     *
     * Off is the absence of the flag rather than a stored `false`, so neither
     * the category file nor the settings grows an entry that says "default".
     */
    function setCategorySpread(dash, categoryId, on) {
        const id = String(categoryId ?? '');
        const next = on === true;

        if (isPersistedCategory(dash, id)) {
            const cat = (dash.categories || []).find((entry) => String(entry.id) === id);
            if (cat) {
                if (next) {
                    cat.spread = true;
                } else {
                    delete cat.spread;
                }
            }
            dash.renderCore?.scheduleCategoryOrderSave?.();
            return next;
        }

        const pageMap = ensurePageSpreadMap(dash, dash.currentPageId);
        if (next) {
            pageMap[id] = true;
        } else {
            delete pageMap[id];
        }
        dash.saveSettings?.();
        return next;
    }

    function toggleCategorySpread(dash, categoryId) {
        const category = (dash.categories || []).find((cat) => String(cat.id) === String(categoryId))
            || { id: categoryId };
        return setCategorySpread(dash, categoryId, !isCategorySpread(dash, category));
    }

    /**
     * Turn spreading off everywhere.
     *
     * `scope` is 'page' or 'all'. 'all' has to reach pages that are not loaded,
     * so it goes through the API per page rather than through dash.categories,
     * which only ever holds the page on screen.
     */
    async function resetAllCategorySpreads(dash, scope = 'page') {
        const reach = scope === 'all' ? 'all' : 'page';
        let changed = 0;

        if (dash.settings?.categorySpreads) {
            const pageKey = String(dash.currentPageId);
            if (reach === 'all') {
                changed += Object.values(dash.settings.categorySpreads)
                    .reduce((sum, spreads) => sum + Object.keys(spreads || {}).length, 0);
                dash.settings.categorySpreads = {};
            } else if (dash.settings.categorySpreads[pageKey]) {
                changed += Object.keys(dash.settings.categorySpreads[pageKey]).length;
                delete dash.settings.categorySpreads[pageKey];
            }
            if (changed > 0) {
                await dash.saveSettings?.();
            }
        }

        const pageIds = reach === 'all'
            ? (dash.pages || []).map((page) => Number(page.id)).filter(Number.isFinite)
            : [Number(dash.currentPageId)];

        for (const pageId of pageIds) {
            const isCurrent = pageId === Number(dash.currentPageId);
            let categories;
            if (isCurrent) {
                categories = dash.categories || [];
            } else {
                try {
                    const res = await fetch(`/api/categories?page=${pageId}`);
                    categories = res.ok ? await res.json() : [];
                } catch (_err) {
                    continue;
                }
            }
            const spread = (categories || []).filter((cat) => cat?.spread === true);
            if (spread.length === 0) {
                continue;
            }
            changed += spread.length;
            spread.forEach((cat) => { delete cat.spread; });
            if (isCurrent) {
                await dash.renderCore?.saveCategoryOrder?.({ pageId, payload: categories });
                // The cached page still holds the categories as they were, and
                // the next reload writes them back over the reset — which is
                // how a reset could undo itself a moment after it succeeded.
                dash.data?.invalidatePageDataCache?.(pageId);
            } else {
                try {
                    await fetch(`/api/categories?page=${pageId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(categories.map((cat) => ({ ...cat, originalId: cat.id }))),
                    });
                } catch (_err) {
                    // Reported by the caller through the count it gets back.
                }
            }
        }

        return changed;
    }

    /** True when anything on this install is set to spread. */
    function anySpreadCategory(dash) {
        if (dash?.settings?.defaultCategorySpread === true) {
            return true;
        }
        if ((dash?.categories || []).some((cat) => cat?.spread === true)) {
            return true;
        }
        return Object.values(dash?.settings?.categorySpreads || {})
            .some((spreads) => Object.values(spreads || {}).some(Boolean));
    }

    /**
     * Write the width onto a rendered category.
     *
     * The class is what the CSS keys off (and what a test can select on), the
     * property is what the grid and the inner bookmark columns read. The
     * attribute records the switch, so the menu can show what is set even where
     * the layout cannot act on it.
     */
    function applyCategorySpan(dash, categoryEl, category, count) {
        if (!categoryEl) {
            return 1;
        }
        const spread = isCategorySpread(dash, category);
        const span = spread ? spanForCount(dash, count) : 1;
        categoryEl.setAttribute('data-spread', spread ? 'true' : 'false');
        categoryEl.classList.toggle('category--wide', span > 1);
        if (span > 1) {
            categoryEl.style.setProperty('--category-span', String(span));
        } else {
            categoryEl.style.removeProperty('--category-span');
        }
        syncSpreadBadge(dash, categoryEl, span);
        return span;
    }

    /**
     * The marker in the header, kept in step with the width.
     *
     * Lives here rather than in the renderer because the width can change
     * without the category being rebuilt — a bookmark added, the limit changed,
     * a narrower window — and the marker has to follow it.
     */
    function syncSpreadBadge(dash, categoryEl, span) {
        const trailing = categoryEl.querySelector('.category-title-trailing');
        const existing = trailing?.querySelector('.category-spread-badge');
        if (!trailing || span <= 1) {
            existing?.remove();
            return;
        }
        const label = dash?.formatDashboardLabel?.('categorySpreadBadge', { n: span },
            `Spread across ${span} columns`) || `${span}`;
        const badge = existing || document.createElement('span');
        if (!existing) {
            badge.className = 'category-spread-badge';
            // Announced through its label rather than read out as "left right
            // arrow two": the symbol is shorthand for the sentence in `title`.
            badge.setAttribute('aria-hidden', 'true');
            trailing.prepend(badge);
        }
        badge.textContent = `↔${span}`;
        badge.title = label;
    }

    /**
     * Pin the intrinsic columns of a spread category's bookmark list.
     *
     * The list repeats one track pattern per column, and an intrinsic track
     * sizes to the rows that happen to land in its copy: with rows flowing left
     * to right, the odd ones size the first column and the even ones the
     * second. A single wide shortcut on one side made that copy wider than the
     * other, and every column after the first sat a few pixels off the
     * categories above and below it.
     *
     * Measured across the whole list and written back as a length, so every
     * copy of the pattern is identical. Safe to re-run: the elements measured
     * are content-sized either way, so the value does not depend on the value
     * it produced last time.
     */
    function syncWideColumnTracks(root = document) {
        const scope = root?.querySelectorAll ? root : document;
        scope.querySelectorAll('.category--wide .bookmarks-list').forEach((list) => {
            const widest = (selector) => Array.from(list.querySelectorAll(selector))
                .reduce((max, el) => Math.max(max, el.getBoundingClientRect().width), 0);
            // Only "always" leaves the label standing in the row's flow. Under
            // "hover" it is positioned out of it and under "never" it is not
            // drawn -- but it still measures, so asking for its width here
            // would pin a track for a column that is not there and hand the
            // reclaimed width straight back.
            const labelInFlow = document.body.getAttribute('data-shortcut-display') === 'always';
            const shortcut = labelInFlow
                ? widest('.bookmark-link > .bookmark-shortcut:not(.is-empty)')
                : 0;
            const lead = widest('.bookmark-link > .bookmark-reorder-handle, .bookmark-link > .bookmark-icon-slot');
            if (shortcut > 0) {
                list.style.setProperty('--bookmark-shortcut-col', `${Math.ceil(shortcut)}px`);
            } else {
                list.style.removeProperty('--bookmark-shortcut-col');
            }
            if (lead > 0) {
                list.style.setProperty('--bookmark-lead-col', `${Math.ceil(lead)}px`);
            } else {
                list.style.removeProperty('--bookmark-lead-col');
            }
        });
    }

    /** The category an element stands for, stored record or not. */
    function categoryFromEl(dash, el) {
        const id = String(el?.getAttribute('data-category-id') ?? '');
        const persisted = (dash?.categories || []).find((cat) => String(cat.id) === id);
        if (persisted) {
            return persisted;
        }
        return {
            id,
            name: el?.querySelector('.category-title-name')?.textContent?.trim() || id,
            isSmartCollection: el?.getAttribute('data-smart-collection') === 'true',
        };
    }

    /**
     * Recompute every width from what the categories now hold.
     *
     * All three inputs move without a category being touched: the column count
     * and the items-per-category limit are settings, and the bookmark count
     * changes with every add, delete and move. That last one is why this also
     * runs after an incremental patch — a category that has just grown past its
     * limit needs the extra column then, not at the next reload.
     *
     * @returns {HTMLElement[]} the categories whose width actually changed.
     */
    function refreshAllCategorySpans(dash, root = document) {
        const scope = root?.querySelectorAll ? root : document;
        const changed = [];
        /*
         * Categories only. A widget block carries the `category` class and a
         * data-category-id of its own — it is a block in the same grid — so it
         * matched this sweep and had its width reset to one column on every
         * pass, whatever its own setting said. Its width is the widget
         * builder's to decide, and this has no category to decide it from.
         */
        scope.querySelectorAll('.category[data-category-id]:not([data-tag-filter-chunk="true"]):not([data-widget-id])').forEach((el) => {
            const before = effectiveSpanFromElement(el);
            const after = applyCategorySpan(dash, el, categoryFromEl(dash, el), countFromElement(el));
            if (before !== after) {
                changed.push(el);
            }
        });
        syncWideColumnTracks(scope);
        return changed;
    }

    /**
     * Follow a width change through everything that depends on it.
     *
     * Two things do. The "+ N more" cut is the limit once per column, so a
     * category that gained a column may show more of itself; and packed mode
     * lays the page out in a different shape depending on whether anything is
     * spread at all, which only a full render can change.
     *
     * @returns {boolean} true when the caller should stop — the page is being
     *   rebuilt from scratch and anything else it was about to patch is moot.
     */
    function settleSpanChange(dash, changedElements) {
        if (!changedElements.length) {
            return false;
        }
        if (dash.renderCore?.shouldPackDashboardColumns()) {
            dash.renderDashboard?.({ animate: false, forceFull: true });
            return true;
        }
        changedElements.forEach((el) => {
            if (el.getAttribute('data-smart-collection') === 'true') {
                return;
            }
            const list = el.querySelector('.bookmarks-list');
            if (list) {
                dash.renderCore?.applyCategoryItemLimit(list, categoryFromEl(dash, el));
            }
        });
        return false;
    }

    /**
     * Redraw one category after its switch was flipped.
     *
     * Always a re-render: spreading changes how many bookmarks are visible (the
     * limit applies per column), and in packed mode it changes which shape the
     * whole page is laid out in. The scroll position is restored by hand, since
     * a category growing above the viewport would otherwise move the page under
     * the reader's hands.
     */
    function refreshCategorySpreadUi(dash, categoryId) {
        const selector = `#dashboard-layout .category[data-category-id="${CSS.escape(String(categoryId))}"]`;
        // Through the shared redraw rather than a scrollTo of its own: this used
        // to put the old offset back in the same tick, before the masonry
        // columns had been measured, so a page that was briefly shorter clamped
        // the scroll and kept the clamped value once it grew again. That is the
        // jump to the top a reader sees after flipping a width.
        dash.renderCore?.redrawKeepingPlace?.(categoryId);
        return effectiveSpanFromElement(document.querySelector(selector));
    }

    /**
     * The category the keyboard is in.
     *
     * Smart collections are kept: spreading is a layout choice, and a smart
     * collection occupies a column like any other block. Tag-filter chunks are
     * excluded — they are slices of one list, sized by the view.
     *
     * With nothing focused the answer depends on who is asking, so the caller
     * says. The command palette wants the first category on the page: running
     * `:width` takes focus out of the grid, and the palette names the category
     * it is about to act on, so there is no surprise. A key press has no such
     * label — Shift+W with the cursor nowhere would reshape whichever category
     * happens to render first — so it passes fallbackToFirst: false and lets
     * the key fall through instead.
     */
    function resolveFocusedCategoryEl(dash, options) {
        const fallbackToFirst = options?.fallbackToFirst !== false;
        const selector = '#dashboard-layout .category[data-category-id]:not([data-tag-filter-chunk="true"])';
        const kn = dash?.keyboardNavigation;
        if (kn && Number.isFinite(kn.currentIndex) && kn.currentIndex >= 0) {
            const fromNav = kn.navigableElements?.[kn.currentIndex]?.closest?.(selector);
            if (fromNav) {
                return fromNav;
            }
        }
        const fromActive = document.activeElement?.closest?.(selector);
        if (fromActive) {
            return fromActive;
        }
        return fallbackToFirst ? document.querySelector(selector) : null;
    }

    window.DashboardCategorySpan = {
        MAX_SPAN,
        isCategorySpread,
        setCategorySpread,
        toggleCategorySpread,
        resetAllCategorySpreads,
        anySpreadCategory,
        spreadSupported,
        spreadUnavailableReason,
        spanForCount,
        countFromElement,
        effectiveCategorySpan,
        effectiveSpanFromElement,
        applyCategorySpan,
        refreshAllCategorySpans,
        settleSpanChange,
        refreshCategorySpreadUi,
        syncWideColumnTracks,
        categoryFromEl,
        resolveFocusedCategoryEl,
    };
})();
