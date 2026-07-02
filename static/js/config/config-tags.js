/**
 * Tags Module — list, cloud, rename/merge, delete, drill-down (all pages).
 */

class ConfigTags {
    constructor(t) {
        this.t = typeof t === 'function' ? t : (k) => k;
        this.lastManager = null;
        this._expandedTags = new Set();
        this._filterQuery = '';
        this._drillDownShowAll = new Set();
        this._renamingTag = null;
    }

    static normalizeTagList(raw) {
        if (typeof raw === 'string') {
            return raw
                .split(',')
                .map((part) => ConfigTags.normalizeTagName(part))
                .filter(Boolean)
                .filter((tag, index, arr) => arr.indexOf(tag) === index);
        }
        if (!Array.isArray(raw)) return [];
        const out = [];
        const seen = new Set();
        raw.forEach((tag) => {
            const normalized = ConfigTags.normalizeTagName(tag);
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            out.push(normalized);
        });
        return out;
    }

    static normalizeTagName(raw) {
        return String(raw || '').trim().toLowerCase();
    }

    static hashRotate(tag) {
        let h = 0;
        const s = String(tag || '');
        for (let i = 0; i < s.length; i += 1) {
            h = (h * 31 + s.charCodeAt(i)) | 0;
        }
        return ((h % 9) - 4) * 0.55;
    }

    /** 0–1 scale with boosted contrast — smaller tags shrink more when spread is wide. */
    static scaleForCount(count, minCount, maxCount) {
        if (maxCount <= 0) return 0.5;
        if (maxCount === minCount) return 1;
        const ratio = (count - minCount) / (maxCount - minCount);
        const spread = maxCount / Math.max(1, minCount);
        const power = spread > 8 ? 0.5 : 0.68;
        const floor = spread > 8 ? 0.08 : spread > 3 ? 0.16 : 0.24;
        return floor + (1 - floor) * Math.pow(Math.max(0, Math.min(1, ratio)), power);
    }

    static tierClassForScale(scale) {
        if (scale >= 0.82) return 'tag-cloud-word--tier-xl';
        if (scale >= 0.62) return 'tag-cloud-word--tier-lg';
        if (scale >= 0.42) return 'tag-cloud-word--tier-md';
        if (scale >= 0.22) return 'tag-cloud-word--tier-sm';
        return 'tag-cloud-word--tier-xs';
    }

    static listTierClassForScale(scale) {
        if (scale >= 0.82) return 'tag-item--tier-xl';
        if (scale >= 0.62) return 'tag-item--tier-lg';
        if (scale >= 0.42) return 'tag-item--tier-md';
        if (scale >= 0.22) return 'tag-item--tier-sm';
        return 'tag-item--tier-xs';
    }

    refresh(manager) {
        this.lastManager = manager;
        this._bindFilterInput();
        this._render();
    }

    _bindFilterInput() {
        const input = document.getElementById('tags-filter-input');
        if (!input || input.dataset.tagsFilterBound === '1') return;
        input.dataset.tagsFilterBound = '1';
        const clearBtn = document.getElementById('tags-filter-clear');
        const syncClear = () => {
            if (clearBtn) clearBtn.hidden = !input.value;
        };
        input.addEventListener('input', () => {
            this._filterQuery = String(input.value || '').trim().toLowerCase();
            syncClear();
            this._render();
            window.configManager?.ui?.refreshTabBreadcrumb?.('tags');
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && input.value) {
                e.preventDefault();
                input.value = '';
                this._filterQuery = '';
                syncClear();
                this._render();
                window.configManager?.ui?.refreshTabBreadcrumb?.('tags');
            }
        });
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                input.value = '';
                this._filterQuery = '';
                clearBtn.hidden = true;
                input.focus();
                this._render();
                window.configManager?.ui?.refreshTabBreadcrumb?.('tags');
            });
        }
    }

    _buildTagMap(manager) {
        const map = new Map();
        for (const bm of this._getAllBookmarks(manager)) {
            for (const tag of ConfigTags.normalizeTagList(bm.tags || [])) {
                if (!map.has(tag)) map.set(tag, []);
                map.get(tag).push(bm);
            }
        }
        return map;
    }

    _getAllBookmarks(manager) {
        if (Array.isArray(manager.allBookmarksData)) return manager.allBookmarksData;
        if (Array.isArray(manager.bookmarksData)) return manager.bookmarksData;
        return [];
    }

    _getPageName(manager, pageId) {
        const pid = Number(pageId) || 1;
        const page = (manager.pagesData || []).find((p) => Number(p.id) === pid);
        if (page?.name) return page.name;
        return `${this.t('config.page') || 'Page'} ${pid}`;
    }

    _tagMatchesFilter(tag) {
        if (!this._filterQuery) return true;
        return String(tag).toLowerCase().includes(this._filterQuery);
    }

    _render() {
        if (this._renamingTag) return;

        const manager = this.lastManager;
        if (!manager) return;

        const container = document.getElementById('tags-list');
        const emptyState = document.getElementById('tags-empty-state');
        const tagsBody = document.getElementById('tags-body');
        const listPanel = document.getElementById('tags-list-panel');
        if (!container) return;

        const tagMap = this._buildTagMap(manager);
        this._renderCloud(tagMap, manager);

        const entries = [...tagMap.entries()]
            .filter(([, bookmarks]) => bookmarks.length > 0)
            .filter(([tag]) => this._tagMatchesFilter(tag));
        entries.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

        const counts = entries.map(([, bms]) => bms.length);
        const maxCount = counts.length ? Math.max(...counts) : 1;
        const minCount = counts.length ? Math.min(...counts) : maxCount;

        container.innerHTML = '';

        const hasAnyTags = tagMap.size > 0;
        const hasFiltered = entries.length > 0;

        if (!hasAnyTags) {
            if (emptyState) emptyState.hidden = false;
            if (tagsBody) tagsBody.hidden = true;
            if (listPanel) listPanel.hidden = true;
            return;
        }
        if (emptyState) emptyState.hidden = true;
        if (tagsBody) tagsBody.hidden = false;
        if (listPanel) listPanel.hidden = false;

        if (!hasFiltered) {
            if (this._filterQuery) {
                const hint = document.createElement('li');
                hint.className = 'tags-filter-empty-hint';
                hint.setAttribute('role', 'status');
                hint.textContent = this.t('config.tagsFilterEmpty') || 'No tags match your filter.';
                container.appendChild(hint);
            }
            return;
        }

        entries.forEach(([tag, bookmarks]) => {
            const scale = ConfigTags.scaleForCount(bookmarks.length, minCount, maxCount);
            container.appendChild(this._createTagRow(tag, bookmarks, manager, scale));
        });
    }

    _renderCloud(tagMap, manager) {
        const cloud = document.getElementById('tags-cloud');
        if (!cloud) return;
        cloud.classList.remove('tags-cloud--live');
        cloud.innerHTML = '';
        cloud.setAttribute('role', 'list');

        const entries = [...tagMap.entries()]
            .filter(([, bms]) => bms.length > 0)
            .filter(([tag]) => this._tagMatchesFilter(tag));
        if (entries.length === 0) {
            cloud.hidden = true;
            return;
        }
        cloud.hidden = false;

        const maxCount = Math.max(...entries.map(([, bms]) => bms.length));
        const minCount = Math.min(...entries.map(([, bms]) => bms.length));
        entries.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

        entries.forEach(([tag, bookmarks], index) => {
            const scale = ConfigTags.scaleForCount(bookmarks.length, minCount, maxCount);
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `tag-cloud-word ${ConfigTags.tierClassForScale(scale)}`;
            chip.setAttribute('role', 'listitem');
            chip.style.setProperty('--tag-scale', scale.toFixed(3));
            chip.style.setProperty('--tag-rotate', `${ConfigTags.hashRotate(tag).toFixed(2)}deg`);
            chip.style.setProperty('--tag-index', String(index));

            const hashEl = document.createElement('span');
            hashEl.className = 'tag-cloud-word-hash';
            hashEl.textContent = '#';
            hashEl.setAttribute('aria-hidden', 'true');

            const labelEl = document.createElement('span');
            labelEl.className = 'tag-cloud-word-label';
            labelEl.textContent = tag;

            chip.append(hashEl, labelEl);

            const countTpl = this.t('config.tagBookmarkCount') || '{count} bookmarks';
            const countLabel = countTpl.replace('{count}', String(bookmarks.length));
            chip.title = `#${tag} — ${countLabel}`;
            chip.setAttribute('aria-label', `${tag}. ${countLabel}`);
            chip.addEventListener('click', () => {
                const item = document.querySelector(`.tag-item[data-tag="${CSS.escape(tag)}"]`);
                if (item) {
                    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    const panel = item.querySelector('.tag-drilldown');
                    if (panel && !panel.classList.contains('is-open')) {
                        this._toggleDrillDown(item, tag, bookmarks);
                    }
                    item.focus?.();
                }
            });
            cloud.appendChild(chip);
        });

        requestAnimationFrame(() => {
            cloud.classList.add('tags-cloud--live');
        });
    }

    _createTagRow(tag, bookmarks, manager, scale = 0.5) {
        const li = document.createElement('li');
        li.className = `tag-item js-item is-idle ${ConfigTags.listTierClassForScale(scale)}`;
        li.setAttribute('role', 'listitem');
        li.dataset.tag = tag;
        li.tabIndex = 0;
        li.style.setProperty('--tag-popularity', scale.toFixed(3));

        const row = document.createElement('div');
        row.className = 'tag-item-row';

        const labelId = `tag-label-${CSS.escape(tag).replace(/%/g, '')}`;
        const label = document.createElement('button');
        label.type = 'button';
        label.className = 'tag-item-label';
        label.id = labelId;
        label.textContent = tag;
        label.title = `# ${tag}`;
        label.addEventListener('click', () => this._toggleDrillDown(li, tag, bookmarks));
        row.appendChild(label);

        const meta = document.createElement('div');
        meta.className = 'tag-item-meta';

        const popularity = document.createElement('div');
        popularity.className = 'tag-popularity';
        popularity.setAttribute('aria-hidden', 'true');
        const popularityBar = document.createElement('span');
        popularityBar.className = 'tag-popularity-bar';
        popularityBar.style.setProperty('--tag-fill', `${Math.round(scale * 100)}%`);
        popularity.appendChild(popularityBar);
        meta.appendChild(popularity);

        const count = document.createElement('button');
        count.type = 'button';
        count.className = 'tag-item-count';
        const countTpl = this.t('config.tagBookmarkCount') || '{count} bookmarks';
        count.textContent = countTpl.replace('{count}', String(bookmarks.length));
        count.title = this.t('config.tagShowBookmarks') || 'Show bookmarks';
        count.addEventListener('click', () => this._toggleDrillDown(li, tag, bookmarks));
        meta.appendChild(count);
        row.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'tag-item-actions';

        const searchBtn = document.createElement('button');
        searchBtn.type = 'button';
        searchBtn.className = 'btn btn-secondary btn-small';
        searchBtn.textContent = this.t('config.tagSearch') || 'Search';
        searchBtn.addEventListener('click', () => this._searchTag(tag));
        actions.appendChild(searchBtn);

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'btn btn-secondary btn-small tag-rename-btn';
        renameBtn.textContent = this.t('config.rename') || 'Rename';
        renameBtn.addEventListener('click', () => this._startRename(li, tag, bookmarks, manager));
        actions.appendChild(renameBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-danger btn-small';
        deleteBtn.textContent = '×';
        deleteBtn.setAttribute('aria-label', (this.t('config.tagDeleteAria') || 'Delete tag {name}').replace('{name}', tag));
        deleteBtn.addEventListener('click', () => this._deleteTag(tag, manager));
        actions.appendChild(deleteBtn);

        row.appendChild(actions);

        li.appendChild(row);

        li.addEventListener('keydown', (e) => {
            if (e.target !== li) return;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                this._moveTagFocus(li, e.key === 'ArrowUp' ? -1 : 1);
                return;
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this._toggleDrillDown(li, tag, bookmarks);
            }
        });

        const drillDown = document.createElement('div');
        drillDown.className = 'tag-drilldown';
        if (this._expandedTags.has(tag)) {
            this._populateDrillDown(drillDown, tag, bookmarks, manager);
            drillDown.classList.add('is-open');
        }
        li.appendChild(drillDown);

        return li;
    }

    _moveTagFocus(currentLi, direction) {
        const items = [...document.querySelectorAll('#tags-list .tag-item')];
        const idx = items.indexOf(currentLi);
        const next = items[idx + direction];
        if (next) next.focus();
    }

    _searchTag(tag) {
        window.location.hash = '#bookmarks';
        if (window.configManager?.ui?.switchToTab) {
            window.configManager.ui.switchToTab('bookmarks');
        }
        setTimeout(() => {
            const search = document.getElementById('bookmarks-search');
            if (search) {
                search.value = `tag:${tag}`;
                search.dispatchEvent(new Event('input', { bubbles: true }));
                search.focus();
            } else if (window.SearchCommands?.openWithQuery) {
                window.SearchCommands.openWithQuery(`tag:${tag}`);
            }
        }, 80);
    }

    _toggleDrillDown(wrap, tag, bookmarks) {
        const panel = wrap.querySelector('.tag-drilldown');
        if (!panel) return;
        if (panel.classList.contains('is-open')) {
            panel.classList.remove('is-open');
            this._expandedTags.delete(tag);
        } else {
            this._populateDrillDown(panel, tag, bookmarks, this.lastManager);
            panel.classList.add('is-open');
            this._expandedTags.add(tag);
        }
    }

    _populateDrillDown(panel, tag, bookmarks, manager) {
        panel.innerHTML = '';
        const MAX_VISIBLE = 20;
        const showAll = this._drillDownShowAll.has(tag);
        const visible = showAll ? bookmarks : bookmarks.slice(0, MAX_VISIBLE);

        visible.forEach((bm) => {
            const row = document.createElement('div');
            row.className = 'tag-drilldown-row';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'tag-drilldown-name';
            nameSpan.textContent = bm.name || bm.url || '—';
            row.appendChild(nameSpan);

            const pageSpan = document.createElement('span');
            pageSpan.className = 'tag-drilldown-page';
            pageSpan.textContent = this._getPageName(manager, bm.pageId);
            row.appendChild(pageSpan);

            const catSpan = document.createElement('span');
            catSpan.className = 'tag-drilldown-cat';
            catSpan.textContent = bm.category || this.t('config.noCategory') || '';
            row.appendChild(catSpan);

            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'btn btn-secondary btn-small';
            openBtn.textContent = this.t('config.open') || 'Open';
            openBtn.addEventListener('click', () => {
                void this._openBookmarkInConfig(bm, manager);
            });
            row.appendChild(openBtn);

            const removeTagBtn = document.createElement('button');
            removeTagBtn.type = 'button';
            removeTagBtn.className = 'btn btn-secondary btn-small';
            removeTagBtn.textContent = this.t('config.tagRemoveFromBookmark') || '− tag';
            removeTagBtn.addEventListener('click', () => this._removeTagFromBookmark(bm, tag, manager));
            row.appendChild(removeTagBtn);

            panel.appendChild(row);
        });

        if (!showAll && bookmarks.length > MAX_VISIBLE) {
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'tag-drilldown-more btn btn-secondary btn-small';
            const moreTpl = this.t('config.tagDrilldownShowAll') || 'Show all {count} bookmarks';
            more.textContent = moreTpl.replace('{count}', String(bookmarks.length));
            more.addEventListener('click', () => {
                this._drillDownShowAll.add(tag);
                this._populateDrillDown(panel, tag, bookmarks, manager);
                panel.classList.add('is-open');
            });
            panel.appendChild(more);
        }
    }

    async _openBookmarkInConfig(bm, manager) {
        if (!manager || !bm) return;
        const pageId = Number(bm.pageId) || Number(manager.currentPageId) || 1;
        if (manager.ui?.switchToTab) {
            manager.ui.switchToTab('bookmarks');
        }
        window.location.hash = '#bookmarks';
        manager.currentPageId = pageId;
        try {
            await manager.loadPageBookmarks(pageId);
            await manager.loadPageCategories(pageId);
        } catch (e) {
            console.warn('Could not load bookmark page', e);
        }
        const match = manager.bookmarkStore?.findByUrl?.(bm, pageId);
        const idx = match
            ? (manager.bookmarksData || []).indexOf(match)
            : (manager.bookmarksData || []).findIndex(
                  (b) =>
                      String(b.url || '').trim().toLowerCase() ===
                      String(bm.url || '').trim().toLowerCase()
              );
        if (idx >= 0 && manager.bookmarks?.openDetailPanel) {
            manager.bookmarks.openDetailPanel(
                idx,
                manager.bookmarksData,
                manager.bookmarksPageCategories || []
            );
        }
        manager.syncBookmarksPageSelectorUI?.(pageId);
        manager.refreshBookmarksList?.();
    }

    _startRename(wrap, tag, bookmarks, manager) {
        this._renamingTag = tag;
        const row = wrap.querySelector('.tag-item-row');
        const label = row.querySelector('.tag-item-label');
        const renameBtn = row.querySelector('.tag-rename-btn');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tag-rename-input';
        input.value = tag;
        input.setAttribute('aria-label', this.t('config.tagRenameInputAria') || 'New tag name');
        label.replaceWith(input);
        input.focus();
        input.select();

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'btn btn-success btn-small';
        confirmBtn.textContent = this.t('config.save') || 'Save';
        if (renameBtn) renameBtn.replaceWith(confirmBtn);

        const commit = () => {
            const newTag = ConfigTags.normalizeTagName(input.value);
            if (!newTag || newTag === tag) {
                this._renamingTag = null;
                this._render();
                return;
            }
            void this._applyRename(tag, newTag, manager);
        };

        confirmBtn.addEventListener('click', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') {
                e.preventDefault();
                this._renamingTag = null;
                this._render();
            }
        });
    }

    async _applyRename(oldTag, newTag, manager) {
        try {
            const tagMap = this._buildTagMap(manager);
            if (tagMap.has(newTag)) {
                const count = (tagMap.get(newTag) || []).length;
                const msgTpl = this.t('config.tagMergeMessage') || 'Tag "{new}" already exists on {count} bookmarks. Merge "{old}" into it?';
                const confirmed = await window.AppModal.danger({
                    title: this.t('config.tagMergeTitle') || 'Merge tags?',
                    message: msgTpl
                        .replace('{new}', newTag)
                        .replace('{old}', oldTag)
                        .replace('{count}', String(count)),
                    confirmText: this.t('config.merge') || 'Merge',
                    cancelText: this.t('config.cancel') || 'Cancel'
                });
                if (!confirmed) return;
            }
            await this._rewriteTag(oldTag, newTag, manager, {
                undoMessage: (this.t('config.tagRenamed') || 'Tag renamed.').replace('{name}', newTag)
            });
        } finally {
            this._renamingTag = null;
            this._render();
        }
    }

    async _rewriteTag(oldTag, newTag, manager, options = {}) {
        const allBookmarks = this._getAllBookmarks(manager);
        const undoSnapshot = manager.captureUndoSnapshot?.();
        let changed = false;

        for (const bm of allBookmarks) {
            if (!Array.isArray(bm.tags)) continue;
            const normalized = ConfigTags.normalizeTagList(bm.tags);
            const idx = normalized.indexOf(oldTag);
            if (idx === -1) continue;
            normalized.splice(idx, 1);
            if (newTag && !normalized.includes(newTag)) {
                normalized.push(newTag);
            }
            bm.tags = normalized;
            changed = true;
        }

        if (!changed) {
            this._render();
            return;
        }

        this._expandedTags.delete(oldTag);
        if (newTag) this._expandedTags.add(newTag);
        await this._persistAndRefresh(manager, {
            eventType: newTag ? 'tag-renamed' : 'tag-deleted',
            undoMessage: options.undoMessage,
            undoSnapshot
        });
    }

    async _deleteTag(tag, manager) {
        const tagMap = this._buildTagMap(manager);
        const count = (tagMap.get(tag) || []).length;
        const msgTpl = count > 0
            ? (this.t('config.tagDeleteMessage') || 'Removes the tag from {count} bookmarks. Bookmarks are kept.')
            : (this.t('config.tagDeleteEmptyMessage') || 'This tag has no bookmarks.');
        const confirmed = await window.AppModal.danger({
            title: (this.t('config.tagDeleteTitle') || 'Delete tag "{name}"?').replace('{name}', tag),
            message: msgTpl.replace('{count}', String(count)),
            confirmText: this.t('config.remove') || 'Delete',
            cancelText: this.t('config.cancel') || 'Cancel'
        });
        if (!confirmed) return;
        await this._rewriteTag(tag, null, manager, {
            undoMessage: this.t('config.tagDeleted') || 'Tag deleted.'
        });
    }

    async _removeTagFromBookmark(bm, tag, manager) {
        if (!Array.isArray(bm.tags)) return;
        const normalized = ConfigTags.normalizeTagList(bm.tags);
        const idx = normalized.indexOf(tag);
        if (idx === -1) return;
        const undoSnapshot = manager.captureUndoSnapshot?.();
        normalized.splice(idx, 1);
        bm.tags = normalized;
        await this._persistAndRefresh(manager, {
            eventType: 'tag-removed-from-bookmark',
            undoMessage: this.t('config.tagRemovedFromBookmark') || 'Tag removed from bookmark.',
            undoSnapshot
        });
    }

    async _persistAndRefresh(manager, options = {}) {
        if (!manager?.persistTagsChanges) {
            manager?.markDirty?.();
            this._render();
            return;
        }
        clearTimeout(manager._tagsPersistTimer);
        manager._tagsPersistSeq = (manager._tagsPersistSeq || 0) + 1;
        const runId = manager._tagsPersistSeq;
        manager.markDirty?.();
        if (!this._renamingTag) this._render();
        manager._tagsPersistTimer = setTimeout(async () => {
            if (runId !== manager._tagsPersistSeq) return;
            try {
                await manager.persistTagsChanges({ eventType: options.eventType || 'tags-updated' });
                if (options.undoMessage && options.undoSnapshot) {
                    manager.showUndoNotification(options.undoMessage, options.undoSnapshot, {
                        persistTags: true
                    });
                }
            } catch (error) {
                console.error('Error persisting tag changes:', error);
            }
        }, 600);
    }
}

window.ConfigTags = ConfigTags;
