/**
 * Config tab bar groups (v5).
 * System | Dashboard | Extras | Help (right)
 */
(function () {
    'use strict';

    /** @type {Record<string, string[]>} */
    const CONFIG_TAB_GROUPS = {
        system: ['general', 'colors', 'backups', 'stats', 'keyboard'],
        dashboard: ['pages', 'categories', 'bookmarks'],
        extras: ['tags', 'finders', 'collections'],
        help: ['help'],
    };

    const GROUP_ORDER = ['system', 'dashboard', 'extras', 'help'];

    /** @type {Record<string, string>} */
    const TAB_TO_GROUP = Object.fromEntries(
        Object.entries(CONFIG_TAB_GROUPS).flatMap(([group, tabs]) => (
            tabs.map((tab) => [tab, group])
        ))
    );

    function getGroupForTab(tab) {
        return TAB_TO_GROUP[tab] || null;
    }

    function getTabsInGroup(group) {
        return CONFIG_TAB_GROUPS[group] ? [...CONFIG_TAB_GROUPS[group]] : [];
    }

    function updateActiveGroup(tab) {
        const group = getGroupForTab(tab);
        document.querySelectorAll('.config-tab-group[data-tab-group]').forEach((el) => {
            el.classList.toggle('config-tab-group--active', Boolean(group) && el.dataset.tabGroup === group);
        });
    }

    function countVisibleTabsInGroup(groupEl) {
        return Array.from(groupEl.querySelectorAll('.tab-button')).filter((btn) => {
            if (btn.hidden) return false;
            const style = window.getComputedStyle(btn);
            return style.display !== 'none' && style.visibility !== 'hidden';
        }).length;
    }

    function syncGroupFlexWeights() {
        document.querySelectorAll('.config-tab-group[data-tab-group]').forEach((groupEl) => {
            if (groupEl.hidden) {
                groupEl.style.removeProperty('--config-tab-group-weight');
                return;
            }
            const weight = Math.max(1, countVisibleTabsInGroup(groupEl));
            groupEl.style.setProperty('--config-tab-group-weight', String(weight));
        });
    }

    function syncGroupVisibility() {
        document.querySelectorAll('.config-tab-group[data-tab-group]').forEach((groupEl) => {
            const tabs = groupEl.querySelectorAll('.tab-button');
            const hasVisible = Array.from(tabs).some((btn) => {
                if (btn.hidden) return false;
                const style = window.getComputedStyle(btn);
                return style.display !== 'none' && style.visibility !== 'hidden';
            });
            groupEl.hidden = !hasVisible;
        });
        syncGroupFlexWeights();
    }

    /**
     * @param {object} manager
     * @returns {Set<string>}
     */
    function getDirtyTabs(manager) {
        const dirty = new Set();
        if (!manager) return dirty;

        const scope = typeof manager.getPendingChangeScope === 'function'
            ? manager.getPendingChangeScope()
            : null;
        if (!scope) return dirty;

        if (scope.hasNonCollectionSettingsChanges) {
            dirty.add('general');
            dirty.add('keyboard');
        }
        if (scope.hasCollectionsChanges) {
            dirty.add('collections');
        }
        if (manager.colorsDirty) {
            dirty.add('colors');
        }
        if (scope.hasPagesChanges) {
            dirty.add('pages');
        }
        if (scope.hasCategoriesChanges) {
            dirty.add('categories');
        }
        if (scope.changedBookmarkPageIds?.length) {
            dirty.add('bookmarks');
            dirty.add('tags');
        }
        if (scope.hasFindersChanges) {
            dirty.add('finders');
        }
        return dirty;
    }

    /**
     * Tab + group unsaved dots (C14).
     * @param {object} [manager]
     */
    function syncUnsavedIndicators(manager = window.configManager) {
        const dirtyTabs = getDirtyTabs(manager);
        const dirtyGroups = new Set();

        dirtyTabs.forEach((tab) => {
            const group = getGroupForTab(tab);
            if (group) dirtyGroups.add(group);
        });

        document.querySelectorAll('.tab-button[data-tab]').forEach((btn) => {
            const tab = btn.getAttribute('data-tab');
            btn.classList.toggle('tab-has-unsaved', Boolean(tab && dirtyTabs.has(tab)));
        });

        document.querySelectorAll('.config-tab-group[data-tab-group]').forEach((groupEl) => {
            const group = groupEl.dataset.tabGroup;
            groupEl.classList.toggle('config-tab-group--unsaved', Boolean(group && dirtyGroups.has(group)));
        });
    }

    function getGroupBoundaries(filterTabFn) {
        const filter = typeof filterTabFn === 'function' ? filterTabFn : () => true;
        return GROUP_ORDER.reduce((acc, group) => {
            const tabs = getTabsInGroup(group).filter(filter);
            if (tabs.length) acc.push({ group, tabs });
            return acc;
        }, []);
    }

    /**
     * @param {'left'|'right'} direction
     * @param {string} currentTab
     * @param {(tab: string) => boolean} filterTabFn
     * @returns {string|null}
     */
    function getAdjacentTabAcrossGroups(direction, currentTab, filterTabFn) {
        const boundaries = getGroupBoundaries(filterTabFn);
        if (!boundaries.length) return null;

        const flat = boundaries.flatMap((entry) => entry.tabs);
        const currentIdx = flat.indexOf(currentTab);
        if (currentIdx < 0) {
            return direction === 'right' ? flat[0] : flat[flat.length - 1];
        }

        const currentGroupEntry = boundaries.find((entry) => entry.tabs.includes(currentTab));
        if (!currentGroupEntry) {
            const nextIdx = direction === 'right'
                ? (currentIdx + 1) % flat.length
                : (currentIdx - 1 + flat.length) % flat.length;
            return flat[nextIdx];
        }

        const idxInGroup = currentGroupEntry.tabs.indexOf(currentTab);
        const groupIdx = boundaries.indexOf(currentGroupEntry);

        if (direction === 'right') {
            if (idxInGroup < currentGroupEntry.tabs.length - 1) {
                return currentGroupEntry.tabs[idxInGroup + 1];
            }
            const nextGroup = boundaries[(groupIdx + 1) % boundaries.length];
            return nextGroup.tabs[0];
        }

        if (idxInGroup > 0) {
            return currentGroupEntry.tabs[idxInGroup - 1];
        }
        const prevGroup = boundaries[(groupIdx - 1 + boundaries.length) % boundaries.length];
        return prevGroup.tabs[prevGroup.tabs.length - 1];
    }

    /**
     * Jump to first tab of previous/next visible group.
     * @param {'left'|'right'} direction
     * @param {string} currentTab
     * @param {(tab: string) => boolean} filterTabFn
     * @returns {string|null}
     */
    function getJumpTabForGroup(direction, currentTab, filterTabFn) {
        const boundaries = getGroupBoundaries(filterTabFn);
        if (!boundaries.length) return null;

        const currentGroupIdx = boundaries.findIndex((entry) => entry.tabs.includes(currentTab));
        const pivot = currentGroupIdx >= 0 ? currentGroupIdx : 0;
        const nextGroupIdx = direction === 'right'
            ? (pivot + 1) % boundaries.length
            : (pivot - 1 + boundaries.length) % boundaries.length;
        return boundaries[nextGroupIdx].tabs[0];
    }

    window.ConfigTabGroups = {
        CONFIG_TAB_GROUPS,
        GROUP_ORDER,
        getGroupForTab,
        getTabsInGroup,
        getGroupBoundaries,
        getAdjacentTabAcrossGroups,
        getJumpTabForGroup,
        updateActiveGroup,
        syncGroupVisibility,
        syncGroupFlexWeights,
        getDirtyTabs,
        syncUnsavedIndicators,
    };
}());
