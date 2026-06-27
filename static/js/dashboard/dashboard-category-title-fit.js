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

    function getMinCategoryFontPx() {
        if (minCategoryFontPxCache != null) {
            return minCategoryFontPxCache;
        }
        let probe = document.getElementById('nextdash-category-font-min-probe');
        if (!probe) {
            probe = document.createElement('div');
            probe.id = 'nextdash-category-font-min-probe';
            probe.className = 'font-size-xs';
            probe.setAttribute('aria-hidden', 'true');
            probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;';
            document.body.appendChild(probe);
        }
        const varSize = getComputedStyle(probe).getPropertyValue('--font-size-category');
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

    function measureNameWidth(nameEl, fontPx) {
        const previous = nameEl.style.fontSize;
        nameEl.style.fontSize = `${fontPx}px`;
        nameEl.classList.remove(MULTILINE_CLASS);
        nameEl.style.whiteSpace = 'nowrap';
        const width = nameEl.scrollWidth;
        nameEl.style.whiteSpace = '';
        nameEl.style.fontSize = previous;
        return width;
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

    function fitCategoryTitle(titleEl) {
        if (!titleEl || titleEl.classList.contains('category-title--renaming')) {
            return;
        }

        ensureTitleStructure(titleEl);

        const nameEl = titleEl.querySelector('.category-title-name');
        const labelEl = titleEl.querySelector('.category-title-label');
        if (!nameEl || !labelEl) {
            return;
        }

        if (titleEl.clientWidth <= 0) {
            return;
        }

        resetNameFit(titleEl, nameEl);

        const maxNameWidth = getMaxNameWidth(titleEl, labelEl, nameEl);
        if (maxNameWidth <= 0) {
            return;
        }

        const basePx = getBaseCategoryFontPx(titleEl);
        const minPx = getMinCategoryFontPx();
        const floorPx = Math.min(basePx, minPx);
        const ceilPx = Math.max(basePx, minPx);

        let chosenPx = ceilPx;
        for (let px = ceilPx; px >= floorPx; px -= 1) {
            if (measureNameWidth(nameEl, px) <= maxNameWidth) {
                chosenPx = px;
                break;
            }
            chosenPx = px;
        }

        if (measureNameWidth(nameEl, chosenPx) <= maxNameWidth) {
            if (Math.abs(chosenPx - basePx) < 0.5) {
                nameEl.style.fontSize = '';
            } else {
                nameEl.style.fontSize = `${chosenPx}px`;
            }
            return;
        }

        nameEl.style.fontSize = `${floorPx}px`;
        nameEl.classList.add(MULTILINE_CLASS);
        titleEl.classList.add(TITLE_MULTILINE_CLASS);
    }

    function fitAllCategoryTitles(root) {
        const scope = root?.querySelectorAll ? root : document;
        scope.querySelectorAll('.category-title').forEach((titleEl) => {
            fitCategoryTitle(titleEl);
        });
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
