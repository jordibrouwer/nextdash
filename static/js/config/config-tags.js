/**
 * Tags Module
 * Manages tags across all bookmarks: list, rename (with merge), delete, drill-down.
 */
class ConfigTags {
    constructor(t) {
        this.t = typeof t === 'function' ? t : (k) => k;
        this.lastManager = null;
        this._expandedTags = new Set();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    refresh(manager) {
        this.lastManager = manager;
        this._render();
    }

    // ── Data helpers ──────────────────────────────────────────────────────────

    /**
     * Returns a map of { tagName -> [bookmark, ...] } collected from ALL pages
     * that are currently loaded in configManager.
     */
    _buildTagMap(manager) {
        const map = new Map();
        const allBookmarks = this._getAllBookmarks(manager);
        for (const bm of allBookmarks) {
            for (const tag of (bm.tags || [])) {
                if (!tag) continue;
                if (!map.has(tag)) map.set(tag, []);
                map.get(tag).push(bm);
            }
        }
        return map;
    }

    _getAllBookmarks(manager) {
        // configManager exposes bookmarksData for the current page.
        // For cross-page tag data we use allBookmarksData when available,
        // falling back to bookmarksData.
        if (Array.isArray(manager.allBookmarksData)) return manager.allBookmarksData;
        if (Array.isArray(manager.bookmarksData)) return manager.bookmarksData;
        return [];
    }

    // ── Render ────────────────────────────────────────────────────────────────

    _render() {
        const manager = this.lastManager;
        if (!manager) return;

        const container = document.getElementById('tags-list');
        const emptyState = document.getElementById('tags-empty-state');
        if (!container) return;

        const tagMap = this._buildTagMap(manager);
        this._renderCloud(tagMap);

        // Sort: used tags by count desc, then alpha; unused at bottom
        const used = [];
        const unused = [];
        for (const [tag, bookmarks] of tagMap.entries()) {
            (bookmarks.length > 0 ? used : unused).push([tag, bookmarks]);
        }
        used.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
        unused.sort((a, b) => a[0].localeCompare(b[0]));
        const sorted = [...used, ...unused];

        container.innerHTML = '';

        if (sorted.length === 0) {
            if (emptyState) emptyState.style.display = '';
            return;
        }
        if (emptyState) emptyState.style.display = 'none';

        // Used tags section
        if (used.length > 0) {
            used.forEach(([tag, bookmarks]) => {
                container.appendChild(this._createTagRow(tag, bookmarks, manager));
            });
        }

        // Unused tags section
        if (unused.length > 0) {
            const divider = document.createElement('div');
            divider.className = 'tags-section-divider';
            divider.textContent = 'Unused tags';
            container.appendChild(divider);
            unused.forEach(([tag, bookmarks]) => {
                container.appendChild(this._createTagRow(tag, bookmarks, manager));
            });
        }
    }

    _renderCloud(tagMap) {
        const cloud = document.getElementById('tags-cloud');
        if (!cloud) return;
        cloud.innerHTML = '';

        if (tagMap.size === 0) return;

        const entries = [...tagMap.entries()].filter(([, bms]) => bms.length > 0);
        if (entries.length === 0) return;

        const max = Math.max(...entries.map(([, bms]) => bms.length));
        const min = Math.min(...entries.map(([, bms]) => bms.length));
        entries.sort((a, b) => a[0].localeCompare(b[0]));

        for (const [tag, bookmarks] of entries) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'tag-cloud-chip';
            chip.textContent = `# ${tag}`;
            chip.title = bookmarks.length === 1 ? '1 bookmark' : `${bookmarks.length} bookmarks`;
            // Scale font between 0.75rem and 1.25rem based on usage
            const ratio = max === min ? 0.5 : (bookmarks.length - min) / (max - min);
            chip.style.setProperty('--tag-scale', ratio.toFixed(2));
            chip.addEventListener('click', () => {
                const item = document.querySelector(`.tag-item[data-tag="${CSS.escape(tag)}"]`);
                if (item) {
                    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    const wrap = item;
                    const panel = wrap.querySelector('.tag-drilldown');
                    if (panel && !panel.classList.contains('is-open')) {
                        this._toggleDrillDown(wrap, tag, bookmarks);
                    }
                }
            });
            cloud.appendChild(chip);
        }
    }

    _createTagRow(tag, bookmarks, manager) {
        const wrap = document.createElement('div');
        wrap.className = 'tag-item js-item is-idle';
        wrap.dataset.tag = tag;

        const row = document.createElement('div');
        row.className = 'tag-item-row';

        // Drag handle (visual consistency; no reorder for now)
        const handle = document.createElement('span');
        handle.className = 'drag-handle tag-drag-handle';
        handle.textContent = '⠿';
        handle.setAttribute('aria-hidden', 'true');
        row.appendChild(handle);

        // Tag label — clicking toggles drill-down
        const label = document.createElement('span');
        label.className = 'tag-item-label';
        label.textContent = `# ${tag}`;
        label.title = 'Click to show bookmarks';
        label.addEventListener('click', () => this._toggleDrillDown(wrap, tag, bookmarks));
        row.appendChild(label);

        // Count chip
        const count = document.createElement('span');
        count.className = 'tag-item-count';
        count.textContent = bookmarks.length === 1 ? '1 bookmark' : `${bookmarks.length} bookmarks`;
        count.title = 'Click to show bookmarks';
        count.addEventListener('click', () => this._toggleDrillDown(wrap, tag, bookmarks));
        row.appendChild(count);

        // Rename button
        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'btn btn-secondary btn-small';
        renameBtn.textContent = 'Rename';
        renameBtn.addEventListener('click', () => this._startRename(wrap, tag, bookmarks, manager));
        row.appendChild(renameBtn);

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Delete tag from all bookmarks';
        deleteBtn.addEventListener('click', () => this._deleteTag(tag, manager));
        row.appendChild(deleteBtn);

        wrap.appendChild(row);

        // Drill-down panel (collapsed by default, unless previously expanded)
        const drillDown = document.createElement('div');
        drillDown.className = 'tag-drilldown';
        if (this._expandedTags.has(tag)) {
            this._populateDrillDown(drillDown, tag, bookmarks, manager);
            drillDown.classList.add('is-open');
        }
        wrap.appendChild(drillDown);

        return wrap;
    }

    // ── Drill-down ────────────────────────────────────────────────────────────

    _toggleDrillDown(wrap, tag, bookmarks) {
        const panel = wrap.querySelector('.tag-drilldown');
        if (!panel) return;
        const isOpen = panel.classList.contains('is-open');
        if (isOpen) {
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
        const visible = bookmarks.slice(0, MAX_VISIBLE);

        visible.forEach(bm => {
            const row = document.createElement('div');
            row.className = 'tag-drilldown-row';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'tag-drilldown-name';
            nameSpan.textContent = bm.name || bm.url || '—';
            row.appendChild(nameSpan);

            const catSpan = document.createElement('span');
            catSpan.className = 'tag-drilldown-cat';
            catSpan.textContent = bm.category || '';
            row.appendChild(catSpan);

            // Open in bookmarks tab
            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'btn btn-secondary btn-small';
            openBtn.textContent = 'Open';
            openBtn.title = 'Open in Bookmarks tab';
            openBtn.addEventListener('click', () => {
                if (typeof configManager !== 'undefined') {
                    window.location.hash = '#bookmarks';
                    // Slight delay to let the tab switch, then find and open the bookmark
                    setTimeout(() => {
                        if (configManager.bookmarks && typeof configManager.bookmarks.openDetailPanel === 'function') {
                            const idx = (configManager.bookmarksData || []).findIndex(
                                b => b.name === bm.name && b.url === bm.url
                            );
                            if (idx >= 0) configManager.bookmarks.openDetailPanel(idx, configManager.bookmarksData, configManager.bookmarksPageCategories || []);
                        }
                    }, 80);
                }
            });
            row.appendChild(openBtn);

            // Remove tag from this bookmark
            const removeTagBtn = document.createElement('button');
            removeTagBtn.type = 'button';
            removeTagBtn.className = 'btn btn-secondary btn-small';
            removeTagBtn.textContent = '− tag';
            removeTagBtn.title = `Remove tag "${tag}" from this bookmark`;
            removeTagBtn.addEventListener('click', () => this._removeTagFromBookmark(bm, tag, manager));
            row.appendChild(removeTagBtn);

            panel.appendChild(row);
        });

        if (bookmarks.length > MAX_VISIBLE) {
            const more = document.createElement('div');
            more.className = 'tag-drilldown-more';
            more.textContent = `… and ${bookmarks.length - MAX_VISIBLE} more`;
            panel.appendChild(more);
        }
    }

    // ── Rename ────────────────────────────────────────────────────────────────

    _startRename(wrap, tag, bookmarks, manager) {
        const row = wrap.querySelector('.tag-item-row');
        const label = row.querySelector('.tag-item-label');
        const renameBtn = row.querySelector('.btn-secondary');

        // Swap label for input
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tag-rename-input';
        input.value = tag;
        label.replaceWith(input);
        input.focus();
        input.select();

        // Swap rename btn for confirm btn
        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'btn btn-success btn-small';
        confirmBtn.textContent = 'Save';
        renameBtn.replaceWith(confirmBtn);

        const commit = () => {
            const newTag = input.value.trim().toLowerCase().replace(/\s+/g, '-');
            if (!newTag || newTag === tag) {
                this._render();
                return;
            }
            this._applyRename(tag, newTag, manager);
        };

        confirmBtn.addEventListener('click', commit);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); this._render(); }
        });
    }

    _applyRename(oldTag, newTag, manager) {
        const allBookmarks = this._getAllBookmarks(manager);
        const tagMap = this._buildTagMap(manager);
        const targetExists = tagMap.has(newTag);

        if (targetExists) {
            // Merge: ask confirmation
            const count = (tagMap.get(newTag) || []).length;
            window.AppModal.danger({
                title: 'Merge tags?',
                message: `Tag "${newTag}" already exists on ${count} bookmark${count !== 1 ? 's' : ''}. Merge "${oldTag}" into it?`,
                confirmText: 'Merge',
                cancelText: 'Cancel'
            }).then(confirmed => {
                if (!confirmed) { this._render(); return; }
                this._rewriteTag(allBookmarks, oldTag, newTag, manager);
            });
            return;
        }

        this._rewriteTag(allBookmarks, oldTag, newTag, manager);
    }

    _rewriteTag(allBookmarks, oldTag, newTag, manager) {
        let changed = false;
        for (const bm of allBookmarks) {
            if (!Array.isArray(bm.tags)) continue;
            const idx = bm.tags.indexOf(oldTag);
            if (idx === -1) continue;
            bm.tags.splice(idx, 1);
            if (newTag && !bm.tags.includes(newTag)) {
                bm.tags.push(newTag);
            }
            changed = true;
        }
        if (changed) {
            this._expandedTags.delete(oldTag);
            if (newTag) this._expandedTags.add(newTag);
            this._saveAndRefresh(manager);
        } else {
            this._render();
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async _deleteTag(tag, manager) {
        const tagMap = this._buildTagMap(manager);
        const count = (tagMap.get(tag) || []).length;
        const confirmed = await window.AppModal.danger({
            title: `Delete tag "${tag}"?`,
            message: count > 0
                ? `This removes the tag from ${count} bookmark${count !== 1 ? 's' : ''}. The bookmarks themselves are not deleted.`
                : 'This tag has no bookmarks. Delete it?',
            confirmText: 'Delete',
            cancelText: 'Cancel'
        });
        if (!confirmed) return;
        this._rewriteTag(this._getAllBookmarks(manager), tag, null, manager);
    }

    // ── Remove tag from one bookmark ──────────────────────────────────────────

    _removeTagFromBookmark(bm, tag, manager) {
        if (!Array.isArray(bm.tags)) return;
        const idx = bm.tags.indexOf(tag);
        if (idx === -1) return;
        bm.tags.splice(idx, 1);
        this._expandedTags.delete(tag);
        this._saveAndRefresh(manager);
    }

    // ── Save helpers ──────────────────────────────────────────────────────────

    _saveAndRefresh(manager) {
        if (manager && typeof manager.markDirty === 'function') {
            manager.markDirty();
        }
        this._render();
    }
}

window.ConfigTags = ConfigTags;
