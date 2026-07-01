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
    }

    window.ConfigTabGroups = {
        CONFIG_TAB_GROUPS,
        GROUP_ORDER,
        getGroupForTab,
        getTabsInGroup,
        updateActiveGroup,
        syncGroupVisibility,
    };
}());
