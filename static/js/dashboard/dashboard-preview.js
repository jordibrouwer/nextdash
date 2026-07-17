/**
 * Bookmark link preview cards.
 */
class DashboardPreview {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    attachBookmarkPreviewBehavior(openLink, bookmark) {
        const d = this.dash;
        const initialTitle = bookmark.previewTitle || bookmark.name || '';
        const initialDescription = bookmark.previewDesc || '';

        if (d.settings.showLinkPreviewCards !== true) {
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

        // Prevent browser native title tooltip when card preview is enabled.
        openLink.removeAttribute('title');

        openLink.addEventListener('mouseenter', async (event) => {
            openLink._previewHoverActive = true;
            if (openLink._previewHoverTimer) {
                clearTimeout(openLink._previewHoverTimer);
            }
            const hoverDelay = [100, 150, 250].includes(Number(d.settings.linkPreviewHoverDelayMs))
                ? Number(d.settings.linkPreviewHoverDelayMs)
                : 150;
            openLink._previewHoverTimer = setTimeout(async () => {
                if (!openLink._previewHoverActive || d.settings.showLinkPreviewCards !== true) {
                    return;
                }
                const preview = await this.fetchBookmarkPreviewData(openLink, bookmark);
                if (!preview || !openLink._previewHoverActive) return;
                preview.note = bookmark.note || '';
                preview.tags = Array.isArray(bookmark.tags) ? bookmark.tags.filter(Boolean) : [];
                preview.openCount = Number(bookmark.openCount || 0);
                preview.lastOpened = bookmark.lastOpened || null;
                this.showBookmarkPreviewCard(preview, event, { openLink, bookmark });
            }, hoverDelay);
        });

        openLink.addEventListener('mousemove', (event) => {
            if (d.previewCardElement && d.previewCardElement.classList.contains('is-visible')) {
                this.positionBookmarkPreviewCard(event.clientX, event.clientY);
                const ctx = d.previewCardElement._previewContext;
                if (ctx) {
                    ctx.pointer = { clientX: event.clientX, clientY: event.clientY };
                }
            }
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


    scheduleHideBookmarkPreviewCard() {
        const d = this.dash;
        if (d._previewHideTimer) {
            clearTimeout(d._previewHideTimer);
        }
        d._previewHideTimer = setTimeout(() => {
            d._previewHideTimer = null;
            if (!d._previewCardHovered) {
                this.hideBookmarkPreviewCard();
            }
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
            if (d.settings.showLinkPreviewCards !== true) {
                openLink.title = `${title}${description ? `\n${description}` : ''}`;
            } else {
                openLink.removeAttribute('title');
            }
            openLink.dataset.previewLoaded = 'true';
            openLink._previewData = preview;
            return preview;
        } catch (_error) {
            openLink.dataset.previewLoaded = 'true';
            return null;
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

        const refreshBtn = card.querySelector('.bookmark-preview-card-refresh');
        refreshBtn?.classList.add('is-loading');
        refreshBtn?.setAttribute('disabled', 'true');

        try {
            delete ctx.openLink._previewData;
            delete ctx.openLink.dataset.previewLoaded;
            const preview = await this.fetchBookmarkPreviewData(ctx.openLink, ctx.bookmark, { forceRefresh: true });
            if (!preview) return false;

            preview.note = ctx.bookmark.note || '';
            preview.tags = Array.isArray(ctx.bookmark.tags) ? ctx.bookmark.tags.filter(Boolean) : [];
            preview.openCount = Number(ctx.bookmark.openCount || 0);
            preview.lastOpened = ctx.bookmark.lastOpened || null;

            const pointer = ctx.pointer || { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 };
            this.showBookmarkPreviewCard(preview, pointer, ctx);
            return true;
        } finally {
            refreshBtn?.classList.remove('is-loading');
            refreshBtn?.removeAttribute('disabled');
        }
    }


    extractDomainFromUrl(url) {
        const d = this.dash;
        try {
            return new URL(url).hostname || '';
        } catch (_error) {
            return '';
        }
    }


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


    formatPreviewUsageText(openCount, lastOpened) {
        const d = this.dash;
        const countText = openCount === 1
            ? d.formatDashboardLabel('previewOpenedOnce', {}, 'opened once')
            : d.formatDashboardLabel('previewOpenedMany', { count: openCount }, `opened ${openCount} times`);
        if (!lastOpened) {
            return countText;
        }
        const date = new Date(lastOpened);
        const diffDays = Math.floor((Date.now() - date.getTime()) / 86400000);
        const lastText = this.formatPreviewLastOpened(diffDays);
        return d.formatDashboardLabel(
            'previewUsageWithLast',
            { count: countText, last: lastText },
            `${countText} · last ${lastText}`
        );
    }


    ensureBookmarkPreviewCard() {
        const d = this.dash;
        if (d.previewCardElement) {
            return d.previewCardElement;
        }
        const card = document.createElement('div');
        card.className = 'bookmark-preview-card';
        card.innerHTML = `
            <button type="button" class="bookmark-preview-card-refresh">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-2.64-6.36"/>
                    <polyline points="21 3 21 9 15 9"/>
                </svg>
            </button>
            <div class="bookmark-preview-card-image-wrap"><img class="bookmark-preview-card-image" alt="" /></div>
            <div class="bookmark-preview-card-content">
                <div class="bookmark-preview-card-title"></div>
                <div class="bookmark-preview-card-description"></div>
                <div class="bookmark-preview-card-note"></div>
                <div class="bookmark-preview-card-tags"></div>
                <div class="bookmark-preview-card-url"></div>
                <div class="bookmark-preview-card-domain"></div>
                <div class="bookmark-preview-card-usage"></div>
            </div>
        `;
        const refreshBtn = card.querySelector('.bookmark-preview-card-refresh');
        if (refreshBtn) {
            refreshBtn.setAttribute(
                'aria-label',
                d.formatDashboardLabel('previewCardRefreshAria', {}, 'Refresh preview')
            );
            refreshBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.refreshVisibleBookmarkPreview();
            });
        }
        card.addEventListener('mouseenter', () => {
            d._previewCardHovered = true;
            if (d._previewHideTimer) {
                clearTimeout(d._previewHideTimer);
                d._previewHideTimer = null;
            }
        });
        card.addEventListener('mouseleave', () => {
            d._previewCardHovered = false;
            this.scheduleHideBookmarkPreviewCard();
        });
        document.body.appendChild(card);
        d.previewCardElement = card;
        return card;
    }


    showBookmarkPreviewCard(preview, event, context = null) {
        const d = this.dash;
        const card = this.ensureBookmarkPreviewCard();
        const refreshBtn = card.querySelector('.bookmark-preview-card-refresh');
        if (refreshBtn) {
            const label = d.language?.t?.('dashboard.previewCardRefreshAria');
            refreshBtn.setAttribute(
                'aria-label',
                label && label !== 'dashboard.previewCardRefreshAria' ? label : 'Refresh preview'
            );
        }
        if (context?.openLink && context?.bookmark) {
            card._previewContext = {
                openLink: context.openLink,
                bookmark: context.bookmark,
                pointer: {
                    clientX: event?.clientX ?? context.pointer?.clientX ?? 0,
                    clientY: event?.clientY ?? context.pointer?.clientY ?? 0,
                },
                promoSource: context.promoSource,
            };
        }
        const titleEl = card.querySelector('.bookmark-preview-card-title');
        const descEl = card.querySelector('.bookmark-preview-card-description');
        const domainEl = card.querySelector('.bookmark-preview-card-domain');
        const imageEl = card.querySelector('.bookmark-preview-card-image');
        const imageWrap = card.querySelector('.bookmark-preview-card-image-wrap');

        const title = String(preview?.title || '').trim()
            || String(preview?.url || '').trim()
            || d.formatDashboardLabel('previewUntitledLink', {}, 'Untitled link');
        const description = String(preview?.description || '').trim();
        const noteText = String(preview?.note || '').trim();
        const domain = String(preview?.domain || this.extractDomainFromUrl(preview?.url || '')).trim();
        const image = window.BookmarkUrlUtils?.safeHttpResourceUrl?.(preview?.image)
            || '';

        titleEl.textContent = title;
        descEl.textContent = description;
        descEl.style.display = description ? 'block' : 'none';
        const noteEl = card.querySelector('.bookmark-preview-card-note');
        if (noteEl) {
            if (noteText) {
                const truncated = noteText.length > 140 ? `${noteText.slice(0, 137)}...` : noteText;
                noteEl.textContent = truncated;
                noteEl.style.display = 'block';
            } else {
                noteEl.textContent = '';
                noteEl.style.display = 'none';
            }
        }
        const tagsEl = card.querySelector('.bookmark-preview-card-tags');
        if (tagsEl) {
            const tags = Array.isArray(preview?.tags) ? preview.tags.filter(Boolean) : [];
            if (tags.length > 0) {
                tagsEl.innerHTML = '';
                tags.forEach(tag => {
                    const chip = document.createElement('span');
                    chip.className = 'bookmark-tag-chip';
                    chip.textContent = tag;
                    tagsEl.appendChild(chip);
                });
                tagsEl.style.display = 'flex';
            } else {
                tagsEl.innerHTML = '';
                tagsEl.style.display = 'none';
            }
        }

        domainEl.textContent = domain;
        domainEl.style.display = domain ? 'block' : 'none';

        const urlEl = card.querySelector('.bookmark-preview-card-url');
        if (urlEl) {
            const rawUrl = String(preview?.url || '').trim();
            urlEl.textContent = rawUrl;
            urlEl.style.display = rawUrl ? 'block' : 'none';
        }

        const usageEl = card.querySelector('.bookmark-preview-card-usage');
        if (usageEl) {
            const openCount = Number(preview?.openCount || 0);
            const lastOpened = preview?.lastOpened || null;
            if (openCount > 0) {
                usageEl.textContent = this.formatPreviewUsageText(openCount, lastOpened);
                usageEl.style.display = 'block';
            } else {
                usageEl.textContent = '';
                usageEl.style.display = 'none';
            }
        }

        if (image) {
            imageEl.src = image;
            imageEl.alt = title;
            imageWrap.style.display = 'block';
        } else {
            imageEl.removeAttribute('src');
            imageEl.alt = '';
            imageWrap.style.display = 'none';
        }

        card.classList.add('is-visible');
        document.body.classList.add('preview-card-active');
        this.positionBookmarkPreviewCard(event.clientX, event.clientY);
        if (context?.promoSource === 'keyboard') {
        }
    }


    positionBookmarkPreviewCard(clientX, clientY) {
        const d = this.dash;
        const card = d.previewCardElement;
        if (!card) return;
        const offsetX = 16;
        const offsetY = 18;
        const margin = 12;

        const rect = card.getBoundingClientRect();
        const width = rect.width || 360;
        const height = rect.height || 140;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Prefer right of cursor; flip left if it would overflow right edge
        let left = clientX + offsetX;
        if (left + width > vw - margin) {
            left = clientX - width - offsetX;
        }

        // Prefer below cursor; flip above if it would overflow bottom edge
        let top = clientY + offsetY;
        if (top + height > vh - margin) {
            top = clientY - height - offsetY;
        }

        // Final clamp so the card never goes off any edge
        left = Math.min(Math.max(margin, left), vw - width - margin);
        top = Math.min(Math.max(margin, top), vh - height - margin);

        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
    }


    hideBookmarkPreviewCard() {
        const d = this.dash;
        if (!d.previewCardElement) return;
        d.previewCardElement.classList.remove('is-visible');
        d.previewCardElement._previewContext = null;
        d._previewCardHovered = false;
        document.body.classList.remove('preview-card-active');
    }


    dismissBookmarkPreviewInteractions() {
        const d = this.dash;
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
