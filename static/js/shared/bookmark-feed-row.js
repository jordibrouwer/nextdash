/**
 * Shared bookmark feed row chrome used by Health, Inbox-adjacent styling, and
 * Config → Bookmarks. Health and Inbox own their data shapes; this module
 * centralises the check-mode badge, action bar, overflow menu, and menu
 * open/close behaviour so the three surfaces stay visually aligned.
 */
(function (global) {
    'use strict';

    function checkModeMeta(mode) {
        const meta = global.CheckMode?.meta?.(mode) || {
            badge: mode,
            hint: '',
            cls: 'is-off',
        };
        return { ...meta, label: meta.badge };
    }

    function renderIcon(iconSrc, escapeHtml) {
        const esc = escapeHtml || ((v) => String(v ?? ''));
        if (iconSrc) {
            return `<div class="health-view-item-icon" aria-hidden="true"><img class="health-view-item-icon-img" src="${esc(iconSrc)}" alt="" loading="lazy"></div>`;
        }
        return `<div class="health-view-item-icon" aria-hidden="true">🔗</div>`;
    }

    function renderCheckModeBadge(key, mode, escapeHtml, t) {
        const esc = escapeHtml || ((v) => String(v ?? ''));
        const translate = typeof t === 'function' ? t : (_k, fb) => fb;
        const meta = checkModeMeta(mode);
        const title = `${meta.hint} — ${translate('dashboard.healthCheckModeChange', 'click to change')}`;
        return `<button type="button"
            class="health-check-mode ${meta.cls}"
            aria-haspopup="menu"
            aria-expanded="false"
            data-menu-toggle="${esc(key)}"
            data-menu-kind="check"
            title="${esc(title)}"
            aria-label="${esc(title)}"
        >${esc(meta.label)}<kbd>c</kbd></button>`;
    }

    function renderCheckModeMenu(key, activeMode, escapeHtml, t) {
        const esc = escapeHtml || ((v) => String(v ?? ''));
        const translate = typeof t === 'function' ? t : (_k, fb) => fb;
        const options = global.CheckMode?.options?.() || [];
        const items = options.map((o) => {
            const isActive = o.mode === activeMode;
            return `<button type="button"
                class="health-view-menu-item health-check-option${isActive ? ' is-active' : ''}"
                role="menuitemradio"
                aria-checked="${isActive ? 'true' : 'false'}"
                data-check-mode="${esc(o.mode)}"
            >
                <span class="health-check-option-label">${esc(o.label)}</span>
                <span class="health-check-option-body">${esc(o.body)}</span>
            </button>`;
        }).join('');

        return `<span class="health-view-menu health-check-menu" role="menu" hidden
            data-menu-for="${esc(key)}" data-menu-owner="check"
            aria-label="${esc(translate('dashboard.healthCheckModeLabel', 'Availability checking'))}">${items}</span>`;
    }

    function renderActionsBar(options) {
        const esc = options.escapeHtml || ((v) => String(v ?? ''));
        const t = options.t || ((_k, fb) => fb);
        const key = esc(options.key);
        const recheck = options.showRecheck !== false
            ? `<button type="button" class="health-view-action-btn" data-feed-action="recheck">${esc(t('dashboard.healthRecheck', 'Re-check'))}<kbd>p</kbd></button>`
            : '';
        return `
            <div class="health-view-item-actions">
                <div class="health-view-item-actions-inner">
                    ${recheck}
                    <button type="button" class="health-view-action-btn" data-feed-action="open">${esc(t('dashboard.healthOpen', 'Open'))}</button>
                    <button type="button" class="health-view-action-btn" data-feed-action="edit">${esc(t('dashboard.healthEdit', 'Edit'))}<kbd>e</kbd></button>
                    <div class="health-view-menu-wrap">
                        <button type="button" class="health-view-action-btn health-view-more-btn" aria-haspopup="menu" aria-expanded="false" data-menu-toggle="${key}" data-menu-kind="more" aria-label="${esc(t('dashboard.healthMore', 'More actions'))}">${esc(t('dashboard.healthMore', 'More'))}<kbd>m</kbd></button>
                        ${options.moreMenuHtml || ''}
                    </div>
                </div>
            </div>`;
    }

    function renderMoreMenu(key, itemsHtml, escapeHtml, t) {
        const esc = escapeHtml || ((v) => String(v ?? ''));
        const translate = typeof t === 'function' ? t : (_k, fb) => fb;
        return `<div class="health-view-menu" role="menu" hidden data-menu-for="${esc(key)}" data-menu-owner="more" aria-label="${esc(translate('dashboard.healthMore', 'More actions'))}">${itemsHtml}</div>`;
    }

    function menuOwner(menu) {
        const owner = menu?.getAttribute('data-menu-owner');
        const key = menu?.getAttribute('data-menu-for');
        if (!owner || !key) return null;
        return document.querySelector(`[data-menu-toggle="${CSS.escape(key)}"][data-menu-kind="${CSS.escape(owner)}"]`);
    }

    function closeAllMenus(root) {
        const scope = root && root.querySelectorAll ? root : document;
        scope.querySelectorAll('.health-view-menu').forEach((menu) => {
            menu.hidden = true;
        });
        scope.querySelectorAll('[aria-haspopup="menu"]').forEach((btn) => {
            btn.setAttribute('aria-expanded', 'false');
        });
    }

    function toggleMenu(key, kind, root) {
        const scope = root && root.querySelectorAll ? root : document;
        const menu = scope.querySelector(
            `.health-view-menu[data-menu-for="${CSS.escape(key)}"][data-menu-owner="${CSS.escape(kind)}"]`
        );
        if (!menu) return false;
        const btn = menuOwner(menu);
        if (!btn) return false;
        const willOpen = menu.hidden;
        closeAllMenus(scope);
        if (!willOpen) return false;
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        menu.querySelector('.health-view-menu-item, .health-check-option')?.focus({ preventScroll: true });
        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            menu.classList.toggle('health-view-menu--up', rect.bottom > window.innerHeight - 8);
        });
        return true;
    }

    function bindIconFallback(img) {
        if (!img) return;
        img.addEventListener('error', () => {
            const slot = img.parentElement;
            img.remove();
            if (slot) slot.textContent = '🔗';
        }, { once: true });
    }

    function syncRowBusy(key, busy, root) {
        const scope = root && root.querySelector ? root : document;
        const row = scope.querySelector(`.config-bm-row[data-bm-key="${CSS.escape(key)}"]`);
        row?.querySelectorAll('.health-view-action-btn, .health-view-menu-item, .health-check-mode').forEach((btn) => {
            btn.disabled = busy;
        });
    }

    global.BookmarkFeedRow = {
        checkModeMeta,
        renderIcon,
        renderCheckModeBadge,
        renderCheckModeMenu,
        renderActionsBar,
        renderMoreMenu,
        menuOwner,
        closeAllMenus,
        toggleMenu,
        bindIconFallback,
        syncRowBusy,
    };
})(typeof window !== 'undefined' ? window : globalThis);
