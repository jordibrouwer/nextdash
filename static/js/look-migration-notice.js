/**
 * The dialog that explains why the dashboard looks different after the update.
 *
 * Every existing install is moved onto Aurora Glass once, on the dark or the light half it was
 * on (migrateToAuroraGlass, server side), and the theme it had is kept in settings.lookMigration
 * with pending: true. This opens a dialog in the middle of the page, not a corner card, because
 * the change is large and the reader should not have to guess what happened.
 *
 * It names the theme the install had, says what is better, says that nothing else was touched,
 * and offers three ways on: open the Theme Studio at Surface (where Classic lives), go back to
 * the old theme, or carry on. A fresh install carries no lookMigration and never sees it.
 *
 * The question counts as answered the moment the dialog is shown, so closing it any way at all
 * (Escape, a click outside, a reload) leaves it answered. The old theme id is kept so the
 * way back keeps working inside the dialog.
 */
(function () {
    'use strict';

    const START_DELAY_MS = 2500;
    const RETRY_MS = 1500;
    const MAX_ATTEMPTS = 40;

    let shownFor = null;
    let backBound = false;
    let gaveUp = false;

    function dash() {
        return window.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (lang?.t) {
            const value = lang.t(key);
            if (value && value !== key) return value;
        }
        return fallback;
    }

    function escape(value) {
        return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function pending() {
        const migration = dash()?.settings?.lookMigration;
        return migration && migration.pending === true ? migration : null;
    }

    /** "slate-dark" becomes "Slate [dark]": the name as the theme list writes it. */
    function nameOf(id) {
        const config = dash()?.config;
        if (typeof config?.themeDisplayName === 'function' && (config._themeList?.[id] || id === 'dark' || id === 'light')) {
            return config.themeDisplayName(id, config._themeList?.[id]);
        }
        const match = String(id || '').match(/^(.*?)(?:-(dark|light))?$/);
        const words = (match?.[1] || id || 'dark').split('-').filter(Boolean)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        return match?.[2] ? `${words} [${match[2]}]` : words;
    }

    function nowName() {
        const id = dash()?.settings?.theme || 'aurora-glass-dark';
        return nameOf(id);
    }

    function answer() {
        const d = dash();
        if (!d?.settings?.lookMigration) return;
        d.settings.lookMigration.pending = false;
        Promise.resolve(d.saveSettings?.()).catch(() => {});
    }

    function goBack(from) {
        const d = dash();
        window.AppModal?.hide?.();
        if (!from || !d?.config?.applyThemeChoice) return;
        void d.config.applyThemeChoice(from);
    }

    function openStudio() {
        const d = dash();
        if (d?.config?.openLookStudio) void d.config.openLookStudio({ tab: 'surface' });
    }

    function isBusy() {
        if (document.querySelector('.whats-new-modal, #app-modal.modal-overlay.active, .look-studio-open')) return true;
        return false;
    }

    async function show(migration) {
        if (!window.AppModal || shownFor) return;
        shownFor = migration.from || 'unknown';
        // The names are the theme list's ("Gloss Amber [dark]"), not the id spelled out.
        try { await dash()?.config?.loadThemeList?.(); } catch { /* the id, spelled out, will do */ }
        const from = migration.from || '';
        const hadName = nameOf(from);
        const nowLabel = nowName();
        const backLabel = t('dashboard.lookMigrationBack', 'Go back to {theme}').replace('{theme}', hadName);

        const html = `
            <div class="look-migration">
                <p class="look-migration-sorry">${escape(t('dashboard.lookMigrationSorry',
                    'Sorry! Your dashboard went to the hairdresser while you were not looking, and came back with opinions about glass.'))}</p>
                <p>${escape(t('dashboard.lookMigrationIntro1',
                    'Every material now has a surface of its own: glass looks like glass, paper like paper, a terminal like a terminal. Cards, headers, menus, dialogs and the side panel share one design, so everything feels like a whole instead of loose parts.'))}</p>
                <p>${escape(t('dashboard.lookMigrationIntro2',
                    'New backdrops come with it: patterns and drawings that fit each theme, like a blue sea for Ocean and a honeycomb for Amber. Aurora Glass is the starting point for everyone, a calm base to build on.'))}</p>
                ${from ? `
                <div class="look-migration-cmp">
                    <div class="look-migration-theme look-migration-theme--old"><span>${escape(t('dashboard.lookMigrationHad', 'You had'))}</span><b>${escape(hadName)}</b></div>
                    <div class="look-migration-arrow" aria-hidden="true">→</div>
                    <div class="look-migration-theme look-migration-theme--new"><span>${escape(t('dashboard.lookMigrationNow', 'Now'))}</span><b>${escape(nowLabel)}</b></div>
                </div>` : ''}
                <ul class="look-migration-list">
                    <li>${escape(t('dashboard.lookMigrationKept', 'Your bookmarks, categories, settings and own themes are exactly as you left them.'))}</li>
                    <li>${escape(t('dashboard.lookMigrationBrowse', 'More than 190 themes and more than 70 backdrops are waiting in the Theme Studio (Shift+A → Themes), your old theme included.'))}</li>
                    <li>${escape(t('dashboard.lookMigrationClassic', 'Prefer the flat, old look? It is in the Theme Studio under Surface → Material style → Classic.'))}</li>
                </ul>
                ${from ? `<p class="look-migration-back"><button type="button" class="look-migration-backbtn" data-look-migration="back" data-from="${escape(from)}">↩ ${escape(backLabel)}</button></p>` : ''}
                <p class="look-migration-once">${escape(t('dashboard.lookMigrationOnce', 'This message appears once.'))}</p>
            </div>`;

        // Answered now, whichever way the dialog is closed.
        answer();
        window.AppModal.show({
            title: t('dashboard.lookMigrationTitle', 'Your dashboard looks different now, and better'),
            htmlMessage: html,
            confirmText: t('dashboard.lookMigrationOpen', 'Open the Theme Studio'),
            cancelText: t('dashboard.lookMigrationGotIt', 'Got it'),
            modalClass: 'look-migration-modal',
            modalMaxWidth: '44rem',
            initialFocusSelector: '#modal-actions .modal-button',
            onConfirm: openStudio,
        });

        if (!backBound) {
            backBound = true;
            document.addEventListener('click', (event) => {
                const link = event.target?.closest?.('[data-look-migration="back"]');
                if (!link) return;
                event.preventDefault();
                goBack(link.getAttribute('data-from'));
            });
        }
    }

    /**
     * Whether the dialog has the corner: it is still to come on this load, or it is on screen. No
     * corner card opens meanwhile (NoticeCard.cornerIsFree and the start guide ask), and a card
     * that waited is woken when the dialog closes. It gives the corner back if it never found a
     * quiet moment to open.
     */
    function blocking() {
        if (document.querySelector('#app-modal.show .look-migration-modal')) return true;
        return !gaveUp && !shownFor && pending() !== null;
    }

    function start() {
        let attempts = 0;
        const tick = () => {
            attempts += 1;
            const migration = pending();
            if (!migration || shownFor) return;
            if (!isBusy() && dash()?.config) {
                show(migration);
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

    window.LookMigrationNotice = { show, pending, nameOf, blocking };
})();
