/**
 * One-time Inbox page intro modal — explains what Inbox is and how it works.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'nextdash:inbox-intro-modal-v2';

    function language() {
        return window.dashboardInstance?.language || null;
    }

    function translate(key, fallback) {
        const fullKey = `dashboard.${key}`;
        const lang = language();
        const text = lang?.t?.(fullKey);
        if (text && text !== fullKey) {
            return text;
        }
        return fallback;
    }

    function hasShown() {
        try {
            if (window.DiscoverabilityState?.isStorageKeyConfirmed?.(STORAGE_KEY)) {
                return true;
            }
            return localStorage.getItem(STORAGE_KEY) === '1';
        } catch {
            return true;
        }
    }

    function markShown() {
        window.DiscoverabilityState?.markStorageKeyConfirmed?.(STORAGE_KEY);
        try {
            localStorage.setItem(STORAGE_KEY, '1');
        } catch { /* ignore */ }
    }

    function canShowOnInboxPage() {
        const dash = window.dashboardInstance;
        if (!dash) {
            return false;
        }
        if (!dash.inbox?.isEnabled?.()) {
            return false;
        }
        if (dash.activeView !== 'inbox') {
            return false;
        }
        if (!document.querySelector('#dashboard-layout.inbox-layout')) {
            return false;
        }
        if (dash.inbox?.triage?.isOpen?.()) {
            return false;
        }
        if (dash.isInlineEditActive?.()) {
            return false;
        }
        if (typeof dash.isModalOpen === 'function' && dash.isModalOpen({ excludeDiscoverabilityPromos: true })) {
            return false;
        }
        if (dash.searchComponent?.isActive?.()) {
            return false;
        }
        if (document.body.classList.contains('bookmark-inline-edit-active')) {
            return false;
        }
        return true;
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function buildItem(icon, textKey, textFallback) {
        const text = translate(textKey, textFallback);
        return `
            <li class="inbox-intro-item">
                <span class="inbox-intro-item-icon" aria-hidden="true">${icon}</span>
                <span class="inbox-intro-item-text">${text}</span>
            </li>
        `;
    }

    function buildSection(sectionIcon, titleKey, titleFallback, items) {
        const title = escapeHtml(translate(titleKey, titleFallback));
        const list = items.map(([icon, key, fallback]) => buildItem(icon, key, fallback)).join('');
        return `
            <section class="inbox-intro-section">
                <h3 class="inbox-intro-section-title">
                    <span class="inbox-intro-section-icon" aria-hidden="true">${sectionIcon}</span>
                    <span>${title}</span>
                </h3>
                <ul class="inbox-intro-list">${list}</ul>
            </section>
        `;
    }

    function buildShortcutsSection() {
        const zero = translate('inboxIntroModalShortcutZero', '<kbd>0</kbd> — open Inbox from the dashboard.');
        const command = translate('inboxIntroModalShortcutCommand', '<code>:inbox</code> — open from the command palette.');
        const title = escapeHtml(translate('inboxIntroModalSectionShortcuts', 'Shortcuts'));
        return `
            <section class="inbox-intro-section inbox-intro-section--shortcuts">
                <h3 class="inbox-intro-section-title">
                    <span class="inbox-intro-section-icon" aria-hidden="true">⌨️</span>
                    <span>${title}</span>
                </h3>
                <div class="inbox-intro-shortcuts">
                    <div class="inbox-intro-shortcut">${zero}</div>
                    <div class="inbox-intro-shortcut">${command}</div>
                </div>
            </section>
        `;
    }

    function buildHtml() {
        const lead = translate(
            'inboxIntroModalLead',
            'A lightweight place to save links you want to read or sort later — separate from your bookmark pages.'
        );
        const sections = [
            buildSection('➕', 'inboxIntroModalSectionAdd', 'Add links', [
                ['📋', 'inboxIntroModalAddPaste', 'Paste a URL on the dashboard (<kbd>Ctrl+V</kbd>) and choose <strong>Inbox</strong>, or set paste-to-inbox as the default in Config.'],
                ['🧩', 'inboxIntroModalAddExtension', 'Use the browser extension “save to Inbox” option when you install it.'],
                ['🔵', 'inboxIntroModalAddUnread', 'New links stay <strong>unread</strong> until you open them or run triage.'],
            ]),
            buildSection('📄', 'inboxIntroModalSectionPage', 'On this page', [
                ['🔍', 'inboxIntroModalPageFilter', 'Filter <strong>All</strong> / <strong>Unread</strong> and search saved links.'],
                ['🗂️', 'inboxIntroModalPageTriage', '<strong>Triage</strong> walks items one by one — open, promote to a bookmark, keep, or delete.'],
                ['📌', 'inboxIntroModalPagePromote', '<strong>Promote</strong> turns a link into a full bookmark on a page and category.'],
            ]),
            buildShortcutsSection(),
        ].join('');
        return `
            <div class="inbox-intro-content">
                <div class="inbox-intro-hero">
                    <span class="inbox-intro-hero-icon" aria-hidden="true">📥</span>
                    <div class="inbox-intro-hero-text">
                        <p class="inbox-intro-lead">${lead}</p>
                    </div>
                </div>
                ${sections}
            </div>
        `;
    }

    function isOpen() {
        return document.getElementById('app-modal')?.classList.contains('show') === true
            && Boolean(document.querySelector('#app-modal .inbox-intro-modal'));
    }

    function maybeShow(options = {}) {
        const force = options.force === true;
        if (!force && hasShown()) {
            return false;
        }
        if (!canShowOnInboxPage()) {
            return false;
        }
        if (!window.AppModal) {
            return false;
        }
        if (isOpen()) {
            return true;
        }
        if (document.getElementById('app-modal')?.classList.contains('show')) {
            return false;
        }

        const finish = () => {
            markShown();
        };

        window.AppModal.show({
            title: `📥 ${translate('inboxIntroModalTitle', 'Inbox')}`,
            htmlMessage: buildHtml(),
            confirmText: translate('inboxIntroModalClose', 'Got it'),
            showCancel: false,
            modalClass: 'inbox-intro-modal',
            onConfirm: finish,
        });

        requestAnimationFrame(() => {
            const overlay = document.getElementById('app-modal');
            const panel = overlay?.querySelector('.inbox-intro-modal');
            if (overlay) {
                overlay.style.zIndex = '13000';
            }
            if (panel) {
                panel.style.opacity = '1';
                panel.style.visibility = 'visible';
                panel.style.transform = 'translateY(0) scale(1)';
            }
        });

        return true;
    }

    function scheduleShow(options = {}) {
        const delay = Number.isFinite(options.delay) ? options.delay : 220;
        const maxAttempts = Number.isFinite(options.maxAttempts) ? options.maxAttempts : 12;
        let attempts = 0;

        const tryShow = () => {
            if (maybeShow(options)) {
                return;
            }
            if (options.force !== true && hasShown()) {
                return;
            }
            attempts += 1;
            if (attempts < maxAttempts) {
                window.setTimeout(tryShow, 180);
            }
        };

        window.setTimeout(tryShow, delay);
    }

    window.InboxIntroModal = {
        STORAGE_KEY,
        hasShown,
        markShown,
        maybeShow,
        scheduleShow,
        reset() {
            window.DiscoverabilityState?.clearStorageKey?.(STORAGE_KEY);
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch { /* ignore */ }
            return true;
        },
        replay(options = {}) {
            this.reset();
            return this.maybeShow({ force: true, ...options })
                || this.scheduleShow({ force: true, delay: options.delay ?? 0, ...options });
        },
    };
}());
