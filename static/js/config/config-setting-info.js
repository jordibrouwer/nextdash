/**
 * Injects ℹ info buttons for config settings and binds localized help modals.
 */
const SETTING_INFO_DEFS = [
    { type: 'labelFor', labelFor: 'theme-select', btnId: 'theme-select-info-btn', title: 'themeInfoTitle', message: 'themeInfoMessage' },
    { type: 'checkbox', targetId: 'auto-dark-mode-checkbox', btnId: 'auto-dark-mode-info-btn', title: 'autoDarkModeInfoTitle', message: 'autoDarkModeInfoMessage' },
    { type: 'labelI18n', i18n: 'config.backgroundLabel', btnId: 'background-picker-info-btn', title: 'backgroundPickerInfoTitle', message: 'backgroundPickerInfoMessage' },
    { type: 'labelFor', labelFor: 'background-opacity-input', btnId: 'background-opacity-info-btn', title: 'backgroundOpacityInfoTitle', message: 'backgroundOpacityInfoMessage' },
    { type: 'checkbox', targetId: 'show-background-dots-checkbox', btnId: 'show-background-dots-info-btn', title: 'showBackgroundDotsInfoTitle', message: 'showBackgroundDotsInfoMessage' },
    { type: 'checkbox', targetId: 'animations-enabled-checkbox', btnId: 'animations-enabled-info-btn', title: 'enableAnimationsInfoTitle', message: 'enableAnimationsInfoMessage' },
    { type: 'labelFor', labelFor: 'font-preset-select', btnId: 'font-preset-info-btn', title: 'fontPresetInfoTitle', message: 'fontPresetInfoMessage' },
    { type: 'afterSelector', selector: '.font-size-selector', btnId: 'font-size-info-btn', title: 'fontSizeInfoTitle', message: 'fontSizeInfoMessage' },
    { type: 'labelFor', labelFor: 'font-weight-select', btnId: 'font-weight-info-btn', title: 'fontWeightInfoTitle', message: 'fontWeightInfoMessage' },
    { type: 'checkbox', targetId: 'theme-iconstyling-enable', btnId: 'theme-iconstyling-info-btn', title: 'iconStylingInfoTitle', message: 'iconStylingInfoMessage' },
    { type: 'labelFor', labelFor: 'columns-input', btnId: 'columns-info-btn', title: 'columnsInfoTitle', message: 'columnsInfoMessage' },
    { type: 'labelFor', labelFor: 'layout-version-select', btnId: 'layout-version-info-btn', title: 'layoutVersionInfoTitle', message: 'layoutVersionInfoMessage' },
    { type: 'labelFor', labelFor: 'layout-preset-select', btnId: 'layout-preset-info-btn', title: 'layoutPresetInfoTitle', message: 'layoutPresetInfoMessage' },
    { type: 'labelFor', labelFor: 'density-mode-select', btnId: 'density-mode-info-btn', title: 'densityModeInfoTitle', message: 'densityModeInfoMessage' },
    { type: 'checkbox', targetId: 'show-title-checkbox', btnId: 'show-title-info-btn', title: 'showDashboardTitleInfoTitle', message: 'showDashboardTitleInfoMessage' },
    { type: 'labelFor', labelFor: 'launcher-icon-size-select', btnId: 'launcher-icon-size-info-btn', title: 'launcherIconSizeInfoTitle', message: 'launcherIconSizeInfoMessage' },
    { type: 'labelFor', labelFor: 'calendar-url-input', btnId: 'calendar-url-info-btn', title: 'calendarUrlInfoTitle', message: 'calendarUrlInfoMessage' },
    { type: 'checkbox', targetId: 'show-icons-checkbox', btnId: 'show-icons-info-btn', title: 'showIconsInfoTitle', message: 'showIconsInfoMessage' },
    { type: 'checkbox', targetId: 'show-shortcuts-checkbox', btnId: 'show-shortcuts-info-btn', title: 'showShortcutsInfoTitle', message: 'showShortcutsInfoMessage' },
    { type: 'checkbox', targetId: 'show-pin-icon-checkbox', btnId: 'show-pin-icon-info-btn', title: 'showPinIconInfoTitle', message: 'showPinIconInfoMessage' },
    { type: 'checkbox', targetId: 'show-note-icon-checkbox', btnId: 'show-note-icon-info-btn', title: 'showNoteIconInfoTitle', message: 'showNoteIconInfoMessage' },
    { type: 'checkbox', targetId: 'show-link-preview-cards-checkbox', btnId: 'show-link-preview-cards-info-btn', title: 'showLinkPreviewCardsInfoTitle', message: 'showLinkPreviewCardsInfoMessage' },
    { type: 'labelFor', labelFor: 'link-preview-hover-delay-select', btnId: 'link-preview-hover-delay-info-btn', title: 'linkPreviewHoverDelayInfoTitle', message: 'linkPreviewHoverDelayInfoMessage' },
    { type: 'labelFor', labelFor: 'sort-method-select', btnId: 'sort-method-info-btn', title: 'bookmarkSortingInfoTitle', message: 'bookmarkSortingInfoMessage' },
    { type: 'checkbox', targetId: 'new-tab-checkbox', btnId: 'new-tab-info-btn', title: 'openLinksInNewTabInfoTitle', message: 'openLinksInNewTabInfoMessage' },
    { type: 'checkbox', targetId: 'paste-url-quick-add-checkbox', btnId: 'paste-url-quick-add-info-btn', title: 'pasteUrlQuickAddInfoTitle', message: 'pasteUrlQuickAddInfoMessage' },
    { type: 'checkbox', targetId: 'allow-local-bookmarks-checkbox', btnId: 'allow-local-bookmarks-info-btn', title: 'allowLocalBookmarksInfoTitle', message: 'allowLocalBookmarksInfoMessage' },
    { type: 'labelFor', labelFor: 'language-select', btnId: 'language-select-info-btn', title: 'languageInfoTitle', message: 'languageInfoMessage' },
    { type: 'checkbox', targetId: 'show-date-checkbox', btnId: 'show-date-info-btn', title: 'showDateInfoTitle', message: 'showDateInfoMessage' },
    { type: 'labelFor', labelFor: 'date-format-select', btnId: 'date-format-info-btn', title: 'dateFormatInfoTitle', message: 'dateFormatInfoMessage' },
    { type: 'checkbox', targetId: 'show-time-checkbox', btnId: 'show-time-info-btn', title: 'showTimeInfoTitle', message: 'showTimeInfoMessage' },
    { type: 'labelFor', labelFor: 'time-format-select', btnId: 'time-format-info-btn', title: 'timeFormatInfoTitle', message: 'timeFormatInfoMessage' },
    { type: 'checkbox', targetId: 'show-weather-with-date-checkbox', btnId: 'show-weather-with-date-info-btn', title: 'showWeatherWithDateInfoTitle', message: 'showWeatherWithDateInfoMessage' },
    { type: 'labelFor', labelFor: 'weather-source-select', btnId: 'weather-source-info-btn', title: 'weatherSourceInfoTitle', message: 'weatherSourceInfoMessage' },
    { type: 'labelFor', labelFor: 'weather-location-input', btnId: 'weather-location-info-btn', title: 'weatherLocationInfoTitle', message: 'weatherLocationInfoMessage' },
    { type: 'labelFor', labelFor: 'weather-unit-select', btnId: 'weather-unit-info-btn', title: 'weatherUnitInfoTitle', message: 'weatherUnitInfoMessage' },
    { type: 'labelFor', labelFor: 'weather-refresh-select', btnId: 'weather-refresh-info-btn', title: 'weatherRefreshInfoTitle', message: 'weatherRefreshInfoMessage' },
    { type: 'checkbox', targetId: 'enable-smart-collections-master', btnId: 'enable-smart-collections-info-btn', title: 'enableSmartCollectionsInfoTitle', message: 'enableSmartCollectionsInfoMessage' },
    { type: 'labelFor', labelFor: 'button-bar-position-select', btnId: 'button-bar-position-info-btn', title: 'buttonBarPositionInfoTitle', message: 'buttonBarPositionInfoMessage' },
    { type: 'checkbox', targetId: 'show-status-checkbox', btnId: 'show-status-info-btn', title: 'showBookmarkStatusInfoTitle', message: 'showBookmarkStatusInfoMessage' },
    { type: 'checkbox', targetId: 'colorize-status-checkbox', btnId: 'colorize-status-info-btn', title: 'colorizeStatusInfoTitle', message: 'colorizeStatusInfoMessage' },
    { type: 'labelFor', labelFor: 'status-recheck-interval-select', btnId: 'status-recheck-interval-info-btn', title: 'statusRecheckIntervalInfoTitle', message: 'statusRecheckIntervalInfoMessage' },
    { type: 'checkbox', targetId: 'show-ping-checkbox', btnId: 'show-ping-info-btn', title: 'showPingTimesInfoTitle', message: 'showPingTimesInfoMessage' },
    { type: 'checkbox', targetId: 'show-status-loading-checkbox', btnId: 'show-status-loading-info-btn', title: 'showStatusLoadingInfoTitle', message: 'showStatusLoadingInfoMessage' },
    { type: 'checkbox', targetId: 'device-specific-checkbox', btnId: 'device-specific-info-btn', title: 'deviceSpecificSettingsInfoTitle', message: 'deviceSpecificSettingsInfoMessage' },
    { type: 'checkbox', targetId: 'enable-custom-favicon-checkbox', btnId: 'enable-custom-favicon-info-btn', title: 'enableCustomFaviconInfoTitle', message: 'enableCustomFaviconInfoMessage' },
    { type: 'checkbox', targetId: 'enable-custom-title-checkbox', btnId: 'enable-custom-title-info-btn', title: 'enableCustomTitleInfoTitle', message: 'enableCustomTitleInfoMessage' },
    { type: 'checkbox', targetId: 'show-page-in-title-checkbox', btnId: 'show-page-in-title-info-btn', title: 'showPageInTitleInfoTitle', message: 'showPageInTitleInfoMessage' },
    { type: 'checkbox', targetId: 'fuzzy-suggestions-start-with-checkbox', btnId: 'fuzzy-suggestions-start-with-info-btn', title: 'fuzzySuggestionsStartWithInfoTitle', message: 'fuzzySuggestionsStartWithInfoMessage' },
];

function createInfoButton(btnId, titleKey) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = btnId;
    btn.className = 'info-button';
    btn.textContent = 'ℹ';
    btn.setAttribute('data-i18n-aria', titleKey);
    return btn;
}

/** Move ℹ buttons that were wrongly nested inside .checkbox-text (invisible in grid layout). */
function relocateMisplacedInfoButtons() {
    document.querySelectorAll('.checkbox-text .info-button').forEach((btn) => {
        const label = btn.closest('.checkbox-label');
        if (!label) return;
        label.appendChild(btn);
    });
}

function attachInfoToCheckboxLabel(label, btn) {
    if (!label || label.querySelector('.info-button')) return null;
    const text = label.querySelector('.checkbox-text');
    if (text) text.insertAdjacentElement('afterend', btn);
    else label.appendChild(btn);
    return btn;
}

function attachInfoToFormLabel(label, btn) {
    if (!label || label.querySelector('.info-button')) return null;
    btn.classList.add('form-group-info-btn');
    label.appendChild(btn);
    return btn;
}

function ensureInfoButton(def) {
    let btn = document.getElementById(def.btnId);
    if (btn) {
        relocateMisplacedInfoButtons();
        return btn;
    }

    const titleKey = `config.${def.title}`;
    btn = createInfoButton(def.btnId, titleKey);

    if (def.type === 'checkbox') {
        const input = document.getElementById(def.targetId);
        const label = input?.closest('.checkbox-label');
        return attachInfoToCheckboxLabel(label, btn);
    }

    if (def.type === 'labelFor') {
        const label = document.querySelector(`label[for="${def.labelFor}"]`);
        return attachInfoToFormLabel(label, btn);
    }

    if (def.type === 'labelI18n') {
        const label = document.querySelector(`[data-i18n="${def.i18n}"]`);
        return attachInfoToFormLabel(label, btn);
    }

    if (def.type === 'afterSelector') {
        const el = document.querySelector(def.selector);
        const label = el?.closest('.form-group')?.querySelector('label');
        return attachInfoToFormLabel(label, btn);
    }

    return null;
}

function installSettingInfoButtons(configSettings) {
    if (!configSettings || typeof configSettings.bindInfoButton !== 'function') return;

    relocateMisplacedInfoButtons();
    SETTING_INFO_DEFS.forEach((def) => {
        ensureInfoButton(def);
        configSettings.bindInfoButton(def.btnId, `config.${def.title}`, `config.${def.message}`);
    });
    relocateMisplacedInfoButtons();

    if (typeof configSettings.language?.applyTranslations === 'function') {
        configSettings.language.applyTranslations();
    }
}

window.installSettingInfoButtons = installSettingInfoButtons;
window.SETTING_INFO_DEFS = SETTING_INFO_DEFS;

const THEME_COLORS_INFO_DEFS = [
    { btnId: 'colors-save-info-btn', title: 'colors.saveColorsInfoTitle', message: 'colors.saveColorsInfoMessage' },
    { btnId: 'colors-palettes-info-btn', title: 'colors.palettesInfoTitle', message: 'colors.palettesInfoMessage' },
    { btnId: 'colors-custom-themes-info-btn', title: 'colors.customThemesInfoTitle', message: 'colors.customThemesInfoMessage' }
];

function installThemeColorsInfoButtons(configSettings) {
    if (!configSettings || typeof configSettings.bindInfoButton !== 'function') return;

    THEME_COLORS_INFO_DEFS.forEach((def) => {
        configSettings.bindInfoButton(def.btnId, def.title, def.message);
    });

    if (typeof configSettings.language?.applyTranslations === 'function') {
        configSettings.language.applyTranslations();
    }
}

window.installThemeColorsInfoButtons = installThemeColorsInfoButtons;
window.THEME_COLORS_INFO_DEFS = THEME_COLORS_INFO_DEFS;
