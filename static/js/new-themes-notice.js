/**
 * The popover that introduces the eight new theme groups to an install that was already in use.
 *
 * It opens once, in the middle of the dashboard, with one tab per group, a screenshot and a
 * line for every theme, a Dark / Light switch, and a button on every card that puts that theme
 * on the page. A click on a screenshot opens it large. The footer opens the theme studio on the
 * New themes.
 *
 * Who sees it: an install that was upgraded, not a fresh one (settings.firstRunInstall), and
 * only once. The question counts as answered the moment the popover is shown, so closing it any
 * way at all leaves it answered. It waits for the What's new window, other dialogs and the setup
 * cards, and stands in the way of corner cards while it is still to come (blocking()).
 *
 * The screenshots are static/img/new-themes/<theme id>.webp (small) and <theme id>-large.webp.
 */
(function (global) {
    'use strict';

    const PROMO_ID = 'theme-groups-v1';
    const START_DELAY_MS = 3000;
    const RETRY_MS = 2000;
    const MAX_ATTEMPTS = 150;

    // The groups in the order the theme studio shows them, each with its families.
    const GROUPS = [
        { id: 'stationery', families: ['gallery', 'ledger', 'typewriter', 'zen'] },
        { id: 'living', families: ['daydrift', 'skywatch', 'tidewatch'] },
        { id: 'instrument', families: ['cockpit', 'dive-computer', 'oscilloscope'] },
        { id: 'tactile', families: ['keycap', 'label-maker', 'rack-unit'] },
        { id: 'spatial', families: ['diorama', 'lightbox', 'orbit'] },
        { id: 'cartographic', families: ['atlas', 'nautical', 'subway'] },
        { id: 'riso', families: ['green-orange', 'mimeograph', 'pink-blue'] },
        { id: 'legible', families: ['colour-blind-safe', 'high-contrast-calm', 'low-vision-amber'] },
    ];
    // The families that answer to something besides colour, named on their card.
    const SPECIAL = {
        'living-daydrift': ['dashboard.newThemesBadgeClock', 'Follows the time of day'],
        'living-skywatch': ['dashboard.newThemesBadgeWeather', 'Reacts to the weather'],
        'living-tidewatch': ['dashboard.newThemesBadgeHealth', 'Follows the health of your services'],
    };
    const GROUP_FALLBACK = {
        stationery: ['Stationery', 'One bookmark per line'],
        living: ['Living', 'Answers to your data'],
        instrument: ['Instrument', 'History in the row'],
        tactile: ['Tactile', 'The row is a thing'],
        spatial: ['Spatial', 'Depth you can see'],
        cartographic: ['Cartographic', 'The page is a map'],
        riso: ['Riso', 'A two-ink print'],
        legible: ['Legible', 'Accessibility as a style'],
    };
    const NAMES = {
        gallery: 'Swiss Poster', 'colour-blind-safe': 'Colour-blind Safe', 'high-contrast-calm': 'High Contrast Calm',
        'low-vision-amber': 'Low Vision Amber', 'green-orange': 'Riso Green-Orange', 'pink-blue': 'Riso Pink-Blue',
        subway: 'Subway Map',
    };

    let shown = false;
    let gaveUp = false;
    let group = 0;
    let mode = 'dark';
    let applied = '';

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const value = lang.t(key);
        return value && value !== key ? value : fallback;
    }

    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function hasAnswered() {
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(PROMO_ID) === true;
    }

    function markAnswered() {
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    /** An install that was upgraded and has not been asked; a fresh install finds the themes itself. */
    function wanted() {
        const settings = dash()?.settings;
        if (!settings || settings.firstRunInstall === true) return false;
        return !hasAnswered();
    }

    function themeId(g, family) {
        return `${GROUPS[g].id}-${family}-${mode}`;
    }

    function familyName(g, family) {
        return NAMES[family] || family.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    function groupLabel(g) {
        const id = GROUPS[g].id;
        return t(`config.themeArchetype.${id}`, GROUP_FALLBACK[id][0]);
    }

    function image(g, family, large) {
        return `/static/img/new-themes/${themeId(g, family)}${large ? '-large' : ''}.webp`;
    }

    function currentMode() {
        return /-light$/.test(String(dash()?.settings?.theme || '')) ? 'light' : 'dark';
    }

    function isCurrent(id) {
        return (dash()?.settings?.theme || '') === id;
    }

    function useButton(id) {
        const on = isCurrent(id);
        return `<button type="button" class="new-themes-use${on ? ' is-current' : ''}" data-new-themes-use="${esc(id)}"${on ? ' disabled' : ''}>${esc(
            on ? t('dashboard.newThemesInUse', 'In use') : t('dashboard.newThemesUse', 'Use this theme'))}</button>`;
    }

    function cardHtml(g, family, index) {
        const id = themeId(g, family);
        const key = `${GROUPS[g].id}-${family}`;
        const name = familyName(g, family);
        const desc = t(`config.themeDesc.${key}`, '');
        const special = SPECIAL[key];
        return `
            <div class="new-themes-card" data-new-themes-card="${esc(id)}">
                <button type="button" class="new-themes-shot" data-new-themes-zoom="${index}" aria-label="${esc(
                    t('dashboard.newThemesEnlarge', 'Enlarge {name}').replace('{name}', name))}">
                    <img src="${esc(image(g, family, false))}" alt="" loading="lazy" decoding="async">
                    <span class="new-themes-zoom" aria-hidden="true">${esc(t('dashboard.newThemesEnlargeShort', 'Enlarge'))}</span>
                </button>
                <div class="new-themes-name">${esc(name)}</div>
                ${special ? `<span class="new-themes-badge">${esc(t(special[0], special[1]))}</span>` : ''}
                <p class="new-themes-desc">${esc(desc)}</p>
                <div class="new-themes-foot">${useButton(id)}</div>
            </div>`;
    }

    function bodyHtml() {
        const tabs = GROUPS.map((entry, i) => `<button type="button" role="tab" class="new-themes-tab${i === group ? ' is-on' : ''}"
            aria-selected="${i === group}" data-new-themes-tab="${i}">${esc(groupLabel(i))}</button>`).join('');
        const tag = t(`dashboard.newThemesTag.${GROUPS[group].id}`, GROUP_FALLBACK[GROUPS[group].id][1]);
        const seg = (m, label) => `<button type="button" class="new-themes-seg${mode === m ? ' is-on' : ''}" data-new-themes-mode="${m}"
            aria-pressed="${mode === m}">${esc(label)}</button>`;
        return `
            <div class="new-themes" data-new-themes>
                <p class="new-themes-intro">${esc(t('dashboard.newThemesIntro',
                    '50 new themes, each built around an idea beyond colour. Try one on the real page, or look at them all in the theme studio.'))}</p>
                <div class="new-themes-tabs" role="tablist">${tabs}</div>
                <div class="new-themes-bar">
                    <p class="new-themes-tag"><b>${esc(groupLabel(group))}</b> — ${esc(tag)}</p>
                    <span class="new-themes-modes" role="group">${seg('dark', t('dashboard.newThemesDark', 'Dark'))}${seg('light', t('dashboard.newThemesLight', 'Light'))}</span>
                </div>
                <div class="new-themes-cards">${GROUPS[group].families.map((f, i) => cardHtml(group, f, i)).join('')}</div>
            </div>`;
    }

    function redraw() {
        const host = document.querySelector('#app-modal [data-new-themes]');
        if (!host) return;
        host.outerHTML = bodyHtml();
    }

    async function useTheme(id) {
        const d = dash();
        const config = d?.config;
        if (!config?.applyThemeChoice) return;
        const previous = d.settings?.theme;
        try {
            await config.applyThemeChoice(id);
            await config.applyThemeLookAndSave?.(id, previous);
        } catch { /* the page keeps what it had */ }
        applied = id;
        redraw();
    }

    function closeLightbox() {
        document.getElementById('new-themes-lightbox')?.remove();
    }

    function openLightbox(index) {
        const family = GROUPS[group].families[index];
        if (!family) return;
        closeLightbox();
        const id = themeId(group, family);
        const key = `${GROUPS[group].id}-${family}`;
        const name = familyName(group, family);
        const special = SPECIAL[key];
        const box = document.createElement('div');
        box.id = 'new-themes-lightbox';
        box.className = 'new-themes-lightbox';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-label', name);
        box.innerHTML = `
            <div class="new-themes-lightbox-panel">
                <div class="new-themes-lightbox-head">
                    <b>${esc(name)} · ${esc(groupLabel(group))}</b>
                    <button type="button" class="new-themes-lightbox-x" data-new-themes-lightbox-close aria-label="${esc(t('dashboard.newThemesClose', 'Close'))}">×</button>
                </div>
                <img src="${esc(image(group, family, true))}" alt="">
                <p class="new-themes-lightbox-desc">${esc(t(`config.themeDesc.${key}`, ''))}${special ? ` — ${esc(t(special[0], special[1]))}.` : ''}</p>
                <div class="new-themes-lightbox-foot">${useButton(id)}</div>
            </div>`;
        document.body.appendChild(box);
        box.querySelector('.new-themes-use:not([disabled]), .new-themes-lightbox-x')?.focus();
    }

    function openStudio() {
        const d = dash();
        if (d?.config?.openThemeBrowser) {
            void Promise.resolve(d.config.openThemeBrowser({ segment: 'new' })).catch(() => {});
        } else {
            global.location.hash = 'config/appearance';
        }
    }

    let bound = false;
    function bind() {
        if (bound) return;
        bound = true;
        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!target?.closest) return;
            const root = target.closest('[data-new-themes], #new-themes-lightbox');
            if (!root) {
                // A click on the dimmed area round the large picture closes it.
                return;
            }
            const tab = target.closest('[data-new-themes-tab]');
            if (tab) { group = Number(tab.getAttribute('data-new-themes-tab')) || 0; redraw(); return; }
            const m = target.closest('[data-new-themes-mode]');
            if (m) { mode = m.getAttribute('data-new-themes-mode') === 'light' ? 'light' : 'dark'; redraw(); return; }
            const zoom = target.closest('[data-new-themes-zoom]');
            if (zoom) { openLightbox(Number(zoom.getAttribute('data-new-themes-zoom'))); return; }
            const use = target.closest('[data-new-themes-use]');
            if (use && !use.disabled) {
                void useTheme(use.getAttribute('data-new-themes-use')).then(() => {
                    // The large picture stays up with its button turned to "In use".
                    const lb = document.getElementById('new-themes-lightbox');
                    if (lb) {
                        const foot = lb.querySelector('.new-themes-lightbox-foot');
                        if (foot) foot.innerHTML = useButton(use.getAttribute('data-new-themes-use'));
                    }
                });
                return;
            }
            if (target.closest('[data-new-themes-lightbox-close]') || target === root) closeLightbox();
        });
        // Escape closes the large picture first, and only then the popover.
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (!document.getElementById('new-themes-lightbox')) return;
            event.stopPropagation();
            event.preventDefault();
            closeLightbox();
        }, true);
    }

    function isBusy() {
        const d = dash();
        if (document.querySelector('.whats-new-modal, #app-modal.modal-overlay.active, #app-modal.show, .look-studio-open, .quickstart-card, [data-holds-corner]')) return true;
        if (typeof d?.isModalOpen === 'function' && d.isModalOpen()) return true;
        if (d?.activeView && d.activeView !== 'bookmarks') return true;
        if (global.LookMigrationNotice?.blocking?.()) return true;
        return false;
    }

    function show(again) {
        if (!global.AppModal || (shown && again !== true)) return;
        shown = true;
        group = 0;
        mode = currentMode();
        applied = '';
        bind();
        // Answered now, whichever way the popover is closed.
        markAnswered();
        global.AppModal.show({
            title: t('dashboard.newThemesTitle', 'Eight new theme groups'),
            htmlMessage: bodyHtml(),
            confirmText: t('dashboard.newThemesStudio', 'Open the theme studio'),
            cancelText: t('dashboard.newThemesClose', 'Close'),
            modalClass: 'new-themes-modal',
            modalMaxWidth: '58rem',
            initialFocusSelector: '.new-themes-tab.is-on',
            onConfirm: openStudio,
            onHide: closeLightbox,
        });
    }

    /*
     * A tip in the bell that opens the popover again, for whoever closed it too soon: it waits in
     * the Tips group until it is read, on every upgraded install, whether or not the popover was
     * shown. The bell closes first and then runs the action, so the popover does not open under it.
     */
    function registerBellTip() {
        if (!global.NoticeCard?.define) return;
        const card = global.NoticeCard.define({
            id: 'new-themes-bell',
            title: () => t('dashboard.newThemesBellTitle', 'The eight new theme groups'),
            bell: {
                kind: 'tip',
                group: 'tips',
                icon: '\u{1F3A8}',
                no: 'forever',
                state: async () => (dash()?.settings && dash().settings.firstRunInstall !== true ? {
                    count: 1,
                    text: t('dashboard.newThemesBellText',
                        '50 new themes in eight groups, each with a screenshot and a line about what it does. Look at them again, and put one on your page.'),
                } : null),
                actions: [
                    {
                        label: () => t('dashboard.newThemesBellOpen', 'Show the new themes'),
                        primary: true,
                        marksRead: true,
                        onClick: () => show(true),
                    },
                ],
            },
        });
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
        } else {
            card.autoStart();
        }
    }

    /** True while the popover is still to come on this load, or on screen: no corner card opens meanwhile. */
    function blocking() {
        if (document.querySelector('#app-modal.show .new-themes-modal, #app-modal .new-themes')) return true;
        return !gaveUp && !shown && wanted();
    }

    function start() {
        let attempts = 0;
        const tick = () => {
            attempts += 1;
            if (shown || !wanted()) return;
            if (!isBusy() && dash()?.config && global.AppModal) {
                show();
                return;
            }
            if (attempts < MAX_ATTEMPTS) setTimeout(tick, RETRY_MS);
            else gaveUp = true;
        };
        setTimeout(tick, START_DELAY_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }

    registerBellTip();

    global.NewThemesNotice = { show, wanted, blocking, PROMO_ID, GROUPS };
}(typeof window !== 'undefined' ? window : globalThis));
