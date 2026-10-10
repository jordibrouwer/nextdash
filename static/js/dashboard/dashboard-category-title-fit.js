/**
 * Shrink category titles to fit beside sort controls; wrap to 2 lines at min font size.
 */
(function () {
    const MULTILINE_CLASS = 'category-title-name--multiline';
    const TITLE_MULTILINE_CLASS = 'category-title--multiline';
    function isTrailingElement(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }
        return node.classList.contains('category-sort-controls')
            || node.classList.contains('category-chevron')
            || node.classList.contains('smart-collection-why-btn');
    }

    let minCategoryFontPxCache = null;
    let resizeObserver = null;
    let scheduledFrame = null;

    function getRootRemPx() {
        return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    }

    function cssLengthToPx(value) {
        const raw = String(value || '').trim();
        if (!raw) {
            return null;
        }
        if (raw.endsWith('px')) {
            return parseFloat(raw);
        }
        if (raw.endsWith('rem')) {
            return parseFloat(raw) * getRootRemPx();
        }
        const numeric = parseFloat(raw);
        return Number.isFinite(numeric) ? numeric : null;
    }

    /*
     * The smallest a category title is ever set: the xs step's own size.
     *
     * Read off <body> with the class on it for one frame rather than from a
     * detached probe. The sizes are declared as `body.font-size-xs { ... }`, a
     * body element selector, so a <div class="font-size-xs"> never matched the
     * rule -- it merely inherited whatever the reader's current size happened
     * to be. Floor then equalled ceiling and the shrink loop below ran exactly
     * one iteration, which is why a long title jumped straight to two lines
     * instead of stepping down to fit.
     *
     * The class is put back in the same synchronous block, so nothing paints
     * in between and the reader never sees the page change size.
     */
    function getMinCategoryFontPx() {
        if (minCategoryFontPxCache != null) {
            return minCategoryFontPxCache;
        }
        const body = document.body;
        if (!body) return 0.75 * getRootRemPx();

        const had = body.className;
        const sizeClasses = [...body.classList].filter((name) => name.startsWith('font-size-'));
        sizeClasses.forEach((name) => body.classList.remove(name));
        body.classList.add('font-size-xs');
        const varSize = getComputedStyle(body).getPropertyValue('--font-size-category');
        body.className = had;

        minCategoryFontPxCache = cssLengthToPx(varSize) || (0.75 * getRootRemPx());
        return minCategoryFontPxCache;
    }

    function invalidateMinCategoryFontCache() {
        minCategoryFontPxCache = null;
    }

    function getBaseCategoryFontPx(titleEl) {
        const varSize = getComputedStyle(titleEl).getPropertyValue('--font-size-category');
        const fromVar = cssLengthToPx(varSize);
        if (fromVar != null) {
            return fromVar;
        }
        return parseFloat(getComputedStyle(titleEl).fontSize) || 16;
    }

    function ensureTitleStructure(titleEl) {
        if (!titleEl || titleEl.querySelector('.category-title-label')) {
            return;
        }
        const nameEl = titleEl.querySelector('.category-title-name');
        if (!nameEl) {
            return;
        }

        const labelWrap = document.createElement('span');
        labelWrap.className = 'category-title-label';

        const trailingWrap = document.createElement('span');
        trailingWrap.className = 'category-title-trailing';

        const childNodes = [...titleEl.childNodes];
        const nameIndex = childNodes.indexOf(nameEl);
        if (nameIndex < 0) {
            return;
        }

        childNodes.slice(0, nameIndex + 1).forEach((node) => {
            labelWrap.appendChild(node);
        });
        childNodes.slice(nameIndex + 1).forEach((node) => {
            if (isTrailingElement(node)) {
                trailingWrap.appendChild(node);
            } else if (node.nodeType === Node.TEXT_NODE && !String(node.textContent || '').trim()) {
                // skip whitespace between name and trailing controls
            } else {
                trailingWrap.appendChild(node);
            }
        });

        titleEl.appendChild(labelWrap);
        if (trailingWrap.childNodes.length > 0) {
            titleEl.appendChild(trailingWrap);
        }
    }

    function resetNameFit(titleEl, nameEl) {
        nameEl.style.fontSize = '';
        nameEl.classList.remove(MULTILINE_CLASS);
        titleEl.classList.remove(TITLE_MULTILINE_CLASS);
    }

    function getMaxNameWidth(titleEl, labelEl, nameEl) {
        const titleWidth = titleEl.clientWidth;
        if (titleWidth <= 0) {
            return 0;
        }
        const trailingEl = titleEl.querySelector('.category-title-trailing');
        const trailingWidth = trailingEl ? trailingEl.getBoundingClientRect().width : 0;
        const titleGap = parseFloat(getComputedStyle(titleEl).columnGap || getComputedStyle(titleEl).gap) || 0;
        const labelWidth = Math.max(0, titleWidth - trailingWidth - titleGap);
        const labelOverhead = Math.max(0, labelEl.clientWidth - nameEl.clientWidth);
        return Math.max(0, labelWidth - labelOverhead - 1);
    }

    /*
     * Fit every title in a fixed number of layouts, however many there are.
     *
     * One title at a time, each reset, read, and then sized by writing a font
     * size and reading the width back, a pixel per step: every read after a
     * write is a layout of the whole page, and thirty categories came to more
     * than two hundred of them on each render. Here all titles are written,
     * then all read, a pass at a time:
     *
     *   1. reset every title, and read what room each has;
     *   2. measure each name, on one line, at the largest size it may take;
     *   3. from that width, work out the size that should fit (a name's width
     *      scales with its font size), write it for the ones that need to
     *      shrink, and read them back -- moving a step down where a pixel of
     *      rounding left one too wide, and a step up where it is one short;
     *   4. what still does not fit at the smallest size goes to two lines.
     *
     * The answer is the same as stepping down a pixel at a time from the
     * largest size: the largest size, in whole pixels below it, that fits.
     */
    function fitTitles(titleEls) {
        const minPx = getMinCategoryFontPx();
        const fits = [];
        // Pass 1: structure and reset (writes), then the room each title has (reads).
        titleEls.forEach((titleEl) => {
            if (!titleEl || titleEl.classList.contains('category-title--renaming')) return;
            ensureTitleStructure(titleEl);
            const nameEl = titleEl.querySelector('.category-title-name');
            const labelEl = titleEl.querySelector('.category-title-label');
            if (!nameEl || !labelEl) return;
            fits.push({ titleEl, nameEl, labelEl });
        });
        // Hidden titles are skipped before anything is reset, as before.
        const shown = fits.filter((f) => f.titleEl.clientWidth > 0);
        shown.forEach((f) => resetNameFit(f.titleEl, f.nameEl));
        shown.forEach((f) => {
            f.max = getMaxNameWidth(f.titleEl, f.labelEl, f.nameEl);
            f.basePx = getBaseCategoryFontPx(f.titleEl);
        });
        const todo = shown.filter((f) => f.max > 0);
        todo.forEach((f) => {
            f.floorPx = Math.min(f.basePx, minPx);
            f.ceilPx = Math.max(f.basePx, minPx);
            // The sizes the stepping loop would try: ceil, ceil - 1, ... down to floor.
            f.steps = Math.max(0, Math.floor(f.ceilPx - f.floorPx + 1e-9));
        });
        const sizeAt = (f, i) => f.ceilPx - i;
        const measure = (list) => {
            list.forEach((f) => {
                f.nameEl.style.fontSize = `${sizeAt(f, f.at)}px`;
                f.nameEl.style.whiteSpace = 'nowrap';
            });
            list.forEach((f) => { f.width = f.nameEl.scrollWidth; });
        };
        // Pass 2: every name at its largest size.
        todo.forEach((f) => { f.at = 0; });
        measure(todo);
        let open = [];
        todo.forEach((f) => {
            if (f.width <= f.max) {
                f.chosen = 0;
                return;
            }
            // Pass 3's first guess: the step whose size should just fit.
            const target = sizeAt(f, 0) * (f.max / f.width);
            f.at = Math.min(f.steps, Math.max(1, Math.ceil(sizeAt(f, 0) - target - 1e-9)));
            f.lowestFit = null;
            f.highestMiss = 0;
            open.push(f);
        });
        // Pass 3: settle each guess. Usually one round; a few at most.
        for (let round = 0; open.length && round < 6; round += 1) {
            measure(open);
            const next = [];
            open.forEach((f) => {
                if (f.width <= f.max) {
                    f.lowestFit = f.at;
                    if (f.at - 1 <= f.highestMiss) { f.chosen = f.at; return; }
                    f.at -= 1;
                } else {
                    f.highestMiss = f.at;
                    if (f.lowestFit != null && f.at + 1 >= f.lowestFit) { f.chosen = f.lowestFit; return; }
                    if (f.at >= f.steps) { f.chosen = null; return; }
                    f.at += 1;
                }
                next.push(f);
            });
            open = next;
        }
        // Anything still unsettled is walked the slow way, so the answer holds.
        open.forEach((f) => {
            f.chosen = null;
            for (let i = f.highestMiss + 1; i <= f.steps; i += 1) {
                f.at = i;
                measure([f]);
                if (f.width <= f.max) { f.chosen = i; break; }
            }
        });
        // Pass 4: the sizes (writes only).
        todo.forEach((f) => {
            f.nameEl.style.whiteSpace = '';
            if (f.chosen != null) {
                const px = sizeAt(f, f.chosen);
                f.nameEl.style.fontSize = Math.abs(px - f.basePx) < 0.5 ? '' : `${px}px`;
                return;
            }
            f.nameEl.style.fontSize = `${f.floorPx}px`;
            f.nameEl.classList.add(MULTILINE_CLASS);
            f.titleEl.classList.add(TITLE_MULTILINE_CLASS);
        });
    }

    function fitCategoryTitle(titleEl) {
        fitTitles([titleEl]);
    }

    function fitAllCategoryTitles(root) {
        const scope = root?.querySelectorAll ? root : document;
        fitTitles([...scope.querySelectorAll('.category-title')]);
    }

    function scheduleFitAllCategoryTitles(root) {
        if (scheduledFrame) {
            cancelAnimationFrame(scheduledFrame);
        }
        scheduledFrame = requestAnimationFrame(() => {
            scheduledFrame = null;
            fitAllCategoryTitles(root);
        });
    }

    function ensureResizeObserver() {
        if (resizeObserver || typeof ResizeObserver === 'undefined') {
            return;
        }
        const layout = document.getElementById('dashboard-layout');
        if (!layout) {
            return;
        }
        resizeObserver = new ResizeObserver(() => {
            scheduleFitAllCategoryTitles(layout);
        });
        resizeObserver.observe(layout);
    }

    window.DashboardCategoryTitleFit = {
        ensureTitleStructure,
        fitCategoryTitle,
        fitAllCategoryTitles,
        scheduleFitAllCategoryTitles,
        invalidateMinCategoryFontCache,
        ensureResizeObserver,
    };
}());
