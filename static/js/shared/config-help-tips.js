/**
 * Config → Help: the tips & tricks section.
 *
 * Renders grouped tips into the #help-tips block. The block is a normal
 * .help-block, so the help filter, the quick-links nav and the accordion pick
 * it up for free — typing "tag" in the help filter finds these tips too.
 *
 * Tips are markup (they contain <code> keys), so they are inserted as HTML from
 * our own locale files and never from user input.
 */
(function () {
    'use strict';

    const TIP_GROUPS = [
        {
            titleKey: 'tipsGroupEveryday',
            titleFallback: 'Everyday',
            tips: [
                // What the dashboard does with a keystroke, before which key
                // does what: this is the question every other tip assumes an
                // answer to.
                'tipEverydayTyping',
                'tipEverydayGridLetters',
                'tipEverydayModes',
                'tipEverydayPages',
                'tipEverydayArrows',
                'tipEverydayEsc',
                'tipEverydayOverview',
                'tipEverydayViews',
                'tipEverydayGridFilter',
                'tipEverydayScrollBack',
                'tipEverydayCheatsheet',
            ],
        },
        {
            titleKey: 'tipsGroupAdding',
            titleFallback: 'Adding bookmarks',
            tips: [
                'tipAddPaste',
                'tipAddQuickAdd',
                'tipAddAnywhere',
                'tipAddCapture',
                'tipAddDuplicate',
                'tipAddFullModal',
                'tipAddShortcut',
            ],
        },
        {
            titleKey: 'tipsGroupEditing',
            titleFallback: 'Editing and organising',
            tips: [
                'tipEditInline',
                'tipEditQuickActions',
                'tipEditUndo',
                'tipEditDrag',
                'tipEditMoveCategory',
                'tipEditSelectionActions',
                'tipEditRenamePage',
                'tipEditPageTabDot',
                'tipEditCopyUrl',
                'tipEditCategorySpread',
            ],
        },
        {
            titleKey: 'tipsGroupFinding',
            titleFallback: 'Finding things',
            tips: [
                'tipFindFilters',
                'tipFindShortcutMode',
                'tipFindAllPages',
                'tipFindFinders',
                'tipFindTagCloud',
                'tipFindRecent',
                'tipFindAddressBar',
            ],
        },
        {
            titleKey: 'tipsGroupMaintenance',
            titleFallback: 'Keeping it healthy',
            tips: [
                'tipMaintHealth',
                'tipMaintReview',
                'tipMaintRotReport',
                'tipMaintMerge',
                'tipMaintMonitorStats',
                'tipMaintStatsUptime',
                'tipMaintCert',
                'tipMaintExpectText',
                'tipMaintMaintenanceWindow',
                'tipMaintTrash',
                'tipMaintBackup',
                'tipMaintSignIn',
                'tipMaintArchive',
                'tipMaintNote',
            ],
        },
        {
            titleKey: 'tipsGroupTuning',
            titleFallback: 'Making it yours',
            tips: [
                'tipTuneInfo',
                'tipTuneTheme',
                'tipTuneThemeBrowser',
                'tipTunePreview',
                'tipTuneSmartCollections',
                'tipTuneFresh',
                'tipTuneWidgets',
                'tipTuneWidgetFold',
                'tipTuneCustomWidget',
                'tipTuneCommands',
            ],
        },
        {
            titleKey: 'tipsGroupConfig',
            titleFallback: 'Config',
            tips: ['tipConfigKeyboard', 'tipConfigFindValue'],
        },
        {
            // Where bookmarks come from and where what happens here goes —
            // the two directions Data & backups grew in v1.4.0.
            titleKey: 'tipsGroupData',
            titleFallback: 'Data in and out',
            tips: ['tipDataSources', 'tipDataPortable', 'tipDataWebhooks', 'tipDataBeyondBookmarks'],
        },
    ];

    function t(language, key, fallback) {
        const lang = language || window.configManager?.language;
        if (!lang?.t) return fallback ?? '';
        const full = `config.${key}`;
        const value = lang.t(full);
        return value && value !== full ? value : (fallback ?? '');
    }

    function render(language) {
        const host = document.getElementById('help-tips-body');
        if (!host) return false;

        const frag = document.createDocumentFragment();
        let count = 0;

        TIP_GROUPS.forEach((group) => {
            const items = group.tips
                .map((key) => t(language, key, ''))
                .filter(Boolean);
            if (!items.length) return;

            const title = document.createElement('h4');
            title.className = 'help-tips-group-title';
            title.textContent = t(language, group.titleKey, group.titleFallback);
            frag.appendChild(title);

            const list = document.createElement('ul');
            list.className = 'help-tips-list';
            items.forEach((html) => {
                const li = document.createElement('li');
                li.innerHTML = html;
                list.appendChild(li);
                count += 1;
            });
            frag.appendChild(list);
        });

        host.innerHTML = '';
        host.appendChild(frag);
        return count > 0;
    }

    window.ConfigHelpTips = { render, TIP_GROUPS };
}());
