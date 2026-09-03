/**
 * Reusable one-time popovers that highlight new or updated config settings.
 *
 * Add entries in config-setting-promos.js; this module handles placement,
 * dismissal, guards, and cross-browser "seen" state.
 */
(function initConfigSettingPromo(global) {
    'use strict';

    const STORAGE_PREFIX = 'nextdash:config-setting-promo-seen-v1:';
    const ANCHOR_ATTR = 'data-config-setting-promo-anchor';
    const MAX_ATTEMPTS = 12;
    const RETRY_MS = 500;
    const VIEWPORT_PAD = 12;

    /** @type {ConfigSettingPromoDefinition[]} */
    const registry = [];

    let activePromoId = null;
    /** @type {ConfigSettingPromoDefinition | null} */
    let activePromoDef = null;
    let activeEl = null;
    let anchorFieldEl = null;
    let anchorTargetEl = null;
    let scheduleTimer = null;
    let retryTimer = null;
    let attempts = 0;
    let pendingSection = null;
    /** Set once the sub-tab is chosen deliberately (click or deep link). */
    let subTabTouched = false;
    /** @type {{ config?: object } | null} */
    let pendingCtx = null;
    let onReposition = null;
    let repositionRaf = null;
    let onEscape = null;
    let onAnchorInteract = null;

    /**
     * @typedef {object} ConfigSettingPromoDefinition
     * @property {string} id Unique id; bump the suffix to show the promo again.
     * @property {string} section Config section id (e.g. appearance, behavior).
     * @property {string} [subTab] Only show on this sub-tab (internal id, e.g. general).
     * @property {string} [ensureSubTab] Switch to this sub-tab when the anchor is hidden.
     * @property {string} anchor Value for data-config-setting-promo-anchor on the field.
     * @property {'below' | 'beside'} [placement] Default below the control.
     * @property {string} titleKey Locale key under config.*
     * @property {string} bodyKey Locale key under config.*
     * @property {string} [badgeKey] Locale key for the badge (default settingPromoNewBadge).
     * @property {string} [dismissKey] Locale key for the button (default settingPromoDismiss).
     * @property {(ctx: { config?: object }) => boolean} [when] Optional extra guard.
     */

    function storageKey(id) {
        return `${STORAGE_PREFIX}${id}`;
    }

    function t(config, key, fallback) {
        if (config?.t) return config.t(key, fallback);
        const lang = global.configManager?.language || global.dashboardInstance?.language;
        if (lang?.t) return lang.t(key, fallback);
        return fallback;
    }

    const escapeHtml = window.NextDashHtml.escapeHtml;

    function hasSeen(id) {
        const key = String(id || '').trim();
        if (!key) return true;
        if (global.DiscoverabilityState?.hasSeenSettingPromo?.(key)) return true;
        try {
            return localStorage.getItem(storageKey(key)) === '1';
        } catch {
            return false;
        }
    }

    function markSeen(id) {
        const key = String(id || '').trim();
        if (!key) return;
        global.DiscoverabilityState?.markSettingPromoSeen?.(key);
        try {
            localStorage.setItem(storageKey(key), '1');
        } catch {
            // Ignore storage errors.
        }
    }

    function resetSeen(id) {
        const key = String(id || '').trim();
        if (!key) return;
        global.DiscoverabilityState?.resetSettingPromoSeen?.(key);
        try {
            localStorage.removeItem(storageKey(key));
        } catch {
            // Ignore storage errors.
        }
    }

    function register(promo) {
        if (!promo?.id || !promo.section || !promo.anchor) return;
        const idx = registry.findIndex((p) => p.id === promo.id);
        if (idx >= 0) registry[idx] = promo;
        else registry.push(promo);
    }

    function registerAll(promos) {
        (promos || []).forEach(register);
    }

    function subTabProp(section) {
        return global.DashboardConfig?.SUB_TAB_STATE?.[section] || null;
    }

    function currentSubTab(config, section) {
        const prop = subTabProp(section);
        if (!prop || !config) return null;
        return config[prop] ?? null;
    }

    function matchesSubTab(promo, config, section) {
        if (!promo.subTab) return true;
        return currentSubTab(config, section) === promo.subTab;
    }

    function pickPromo(section, ctx) {
        const config = ctx?.config;
        return registry.find((promo) => {
            if (promo.section !== section) return false;
            if (hasSeen(promo.id)) return false;
            if (!matchesSubTab(promo, config, section)) return false;
            if (typeof promo.when === 'function' && !promo.when(ctx)) return false;
            return true;
        }) || null;
    }

    /** Field wrapper (highlight) and the control we point at (position). */
    function resolveAnchor(promo) {
        const field = document.querySelector(`[${ANCHOR_ATTR}="${CSS.escape(promo.anchor)}"]`);
        if (!field || !field.isConnected) return { field: null, target: null };
        // .config-choices covers fields built from a button group (Random theme,
        // Favicon harmonisation): the group is the control, so point at the row
        // rather than falling through to the whole field including its label.
        const target = field.querySelector('select, .config-select, input[type="checkbox"], input[type="range"], textarea, .config-choices, button.config-btn')
            || field;
        const rect = target.getBoundingClientRect();
        if (rect.width < 1 && rect.height < 1) return { field: null, target: null };
        return { field, target };
    }

    function revealAnchor(promo, ctx) {
        const { field } = resolveAnchor(promo);
        if (field) return false;
        const tab = promo.ensureSubTab;
        const config = ctx?.config;
        const prop = subTabProp(promo.section);
        if (!tab || !config || !prop || config[prop] === tab) return false;
        // Only pull the sub-tab over on the way in, before the user has picked a
        // tab of their own. The retry loop reschedules on every repaint, so
        // without this it drags them out of whatever tab they just opened.
        if (subTabTouched) return false;
        config[prop] = tab;
        config.render?.();
        return true;
    }

    function isWhatsNewOpen() {
        const overlay = document.getElementById('app-modal');
        return overlay?.classList.contains('show') === true
            && !!overlay.querySelector('.whats-new-modal');
    }

    function canShowEnvironment(ctx) {
        if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        const dash = global.dashboardInstance;
        if (dash?.onboardingStartedInSession) return false;
        if (dash?.settings && dash.settings.onboardingCompleted === false) return false;
        if (typeof dash?.isModalOpen === 'function' && dash.isModalOpen()) return false;
        if (isWhatsNewOpen()) return false;
        if (document.body.classList.contains('bookmark-inline-edit-active')) return false;
        /*
         * An open menu owns the pointer, and showing over it costs the click.
         *
         * The promo scrolls its anchor into view on the way up. The config
         * bookmark context menu closes on any scroll it did not cause -- it is
         * anchored to a viewport point, so the row would otherwise slide out
         * from under it -- and a promo arriving a few hundred milliseconds
         * after a right-click therefore took the menu away while the pointer
         * was still on it. Waiting is free: the caller retries, so the promo
         * arrives once the menu is gone.
         */
        if (document.querySelector('.move-popover, .config-bm-context-menu')) return false;
        if (ctx?.config && !ctx.config.isActiveView?.()) return false;
        return true;
    }

    function positionBelow(pop, target) {
        pop.classList.remove('is-left', 'is-right', 'is-above');
        pop.classList.add('is-below');
        const rect = target.getBoundingClientRect();
        pop.style.visibility = 'hidden';
        pop.style.display = 'block';
        const width = Math.min(300, Math.max(220, pop.offsetWidth || 260));
        pop.style.width = `${width}px`;
        const height = pop.offsetHeight || 150;
        let left = rect.left + (rect.width / 2) - (width / 2);
        left = Math.max(VIEWPORT_PAD, Math.min(left, global.innerWidth - width - VIEWPORT_PAD));
        let top = rect.bottom + 12;
        if (top + height > global.innerHeight - VIEWPORT_PAD) {
            top = rect.top - height - 12;
            pop.classList.remove('is-below');
            pop.classList.add('is-above');
        }
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(Math.max(VIEWPORT_PAD, top))}px`;
        pop.style.setProperty('--promo-arrow-left', `${Math.round(rect.left + (rect.width / 2) - left)}px`);
        pop.style.visibility = '';
    }

    function positionBeside(pop, target) {
        const rect = target.getBoundingClientRect();
        pop.style.visibility = 'hidden';
        pop.style.display = 'block';
        const width = Math.min(280, Math.max(220, pop.offsetWidth || 260));
        const height = pop.offsetHeight || 160;
        const placement = global.DashboardPromoPlacement?.positionBesideAnchor
            ? global.DashboardPromoPlacement.positionBesideAnchor(rect, width, height, { gap: 14, minWidth: 200 })
            : {
                left: rect.right + 14,
                top: Math.max(VIEWPORT_PAD, rect.top + (rect.height / 2) - (height / 2)),
                width,
                placeRight: true,
            };
        pop.style.width = `${Math.round(placement.width)}px`;
        pop.style.left = `${Math.round(placement.left)}px`;
        pop.style.top = `${Math.round(placement.top)}px`;
        pop.classList.remove('is-below', 'is-above');
        pop.classList.toggle('is-left', !placement.placeRight);
        pop.classList.toggle('is-right', placement.placeRight);
        pop.style.visibility = '';
    }

    function positionPopover(pop, target, promo) {
        if ((promo?.placement || 'below') === 'beside') {
            positionBeside(pop, target);
        } else {
            positionBelow(pop, target);
        }
    }

    function bindInteractHandlers(field) {
        onAnchorInteract = () => dismissActive({ persist: true });
        field.querySelectorAll('select, input[type="checkbox"], input[type="range"], textarea').forEach((el) => {
            el.addEventListener('change', onAnchorInteract);
        });
    }

    /**
     * Record that the sub-tab was chosen on purpose, so ensureSubTab stops
     * steering. Called for a click on the tab strip, and by the config module
     * when a `#config/<section>/<tab>` hash names one.
     */
    function markSubTabChosen() {
        subTabTouched = true;
    }

    /**
     * Button-group fields (Random theme, Favicon harmonisation) never fire
     * `change`, and acting on one repaints the whole panel — so a listener bound
     * to the button, or torn down per promo, is gone before the click lands.
     * One permanent delegated listener matches on the anchor attribute instead,
     * which the repaint preserves. Marking it seen here also stops the repaint's
     * scheduleForSection from immediately showing the promo again.
     */
    function bindAnchorClickDelegate() {
        document.addEventListener('click', (e) => {
            // A sub-tab the user picked themselves outranks ensureSubTab.
            if (e.target?.closest?.('.config-subtab')) markSubTabChosen();
            const btn = e.target?.closest?.(`[${ANCHOR_ATTR}] .config-choices button`);
            if (!btn) return;
            const anchor = btn.closest(`[${ANCHOR_ATTR}]`)?.getAttribute(ANCHOR_ATTR);
            if (!anchor) return;
            // Resolve the promo from the anchor rather than from activePromoDef:
            // saving repaints the panel, which re-runs scheduleForSection and can
            // tear the popover down (persist: false) before this handler runs.
            // Marking it seen here is what stops it coming straight back.
            const promo = activePromoDef?.anchor === anchor
                ? activePromoDef
                : registry.find((p) => p.anchor === anchor && !hasSeen(p.id));
            if (!promo) return;
            markSeen(promo.id);
            dismissActive({ persist: true });
        }, true);
    }

    function teardownListeners() {
        if (onReposition) {
            global.removeEventListener('resize', onReposition);
            global.removeEventListener('scroll', onReposition, true);
            onReposition = null;
        }
        if (onEscape) {
            document.removeEventListener('keydown', onEscape, true);
            onEscape = null;
        }
        if (onAnchorInteract && anchorFieldEl) {
            anchorFieldEl.querySelectorAll('select, input[type="checkbox"], input[type="range"], textarea').forEach((el) => {
                el.removeEventListener('change', onAnchorInteract);
            });
            onAnchorInteract = null;
        }
    }

    function dismissActive(options = {}) {
        const persist = options.persist !== false;
        if (!activeEl) return false;
        if (persist && activePromoId) markSeen(activePromoId);
        anchorFieldEl?.classList.remove('config-setting-promo-anchor-highlight');
        activeEl.remove();
        activeEl = null;
        anchorFieldEl = null;
        anchorTargetEl = null;
        activePromoId = null;
        activePromoDef = null;
        teardownListeners();
        return true;
    }

    function show(promo, ctx) {
        dismissActive({ persist: false });
        const config = ctx?.config;
        const { field, target } = resolveAnchor(promo);
        if (!field || !target) return false;

        field.scrollIntoView({ block: 'center', behavior: 'auto' });

        const pop = document.createElement('div');
        pop.className = 'config-setting-promo';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-modal', 'false');
        const titleId = `config-setting-promo-title-${promo.id}`;
        const bodyId = `config-setting-promo-body-${promo.id}`;
        pop.setAttribute('aria-labelledby', titleId);
        pop.setAttribute('aria-describedby', bodyId);

        const badgeKey = promo.badgeKey || 'config.settingPromoNewBadge';
        const dismissKey = promo.dismissKey || 'config.settingPromoDismiss';
        const title = t(config, promo.titleKey, promo.titleKey);
        const body = t(config, promo.bodyKey, promo.bodyKey);
        const badge = t(config, badgeKey, 'New');
        const dismiss = t(config, dismissKey, 'Got it');

        pop.innerHTML = `
            <div class="config-setting-promo-arrow" aria-hidden="true"></div>
            <div class="config-setting-promo-inner">
                <span class="config-setting-promo-badge">${escapeHtml(badge)}</span>
                <h3 class="config-setting-promo-title" id="${escapeHtml(titleId)}">${escapeHtml(title)}</h3>
                <p class="config-setting-promo-body" id="${escapeHtml(bodyId)}">${escapeHtml(body)}</p>
                <button type="button" class="config-setting-promo-dismiss">${escapeHtml(dismiss)}</button>
            </div>`;

        document.body.appendChild(pop);
        field.classList.add('config-setting-promo-anchor-highlight');
        positionPopover(pop, target, promo);

        activeEl = pop;
        anchorFieldEl = field;
        anchorTargetEl = target;
        activePromoId = promo.id;
        activePromoDef = promo;

        pop.querySelector('.config-setting-promo-dismiss')?.addEventListener('click', () => {
            dismissActive({ persist: true });
        });

        onReposition = () => {
            if (repositionRaf) return;
            repositionRaf = requestAnimationFrame(() => {
                repositionRaf = null;
                if (activeEl && anchorTargetEl?.isConnected) {
                    positionPopover(activeEl, anchorTargetEl, activePromoDef);
                }
            });
        };
        global.addEventListener('resize', onReposition, { passive: true });
        global.addEventListener('scroll', onReposition, { passive: true, capture: true });

        onEscape = (e) => {
            if (e.key !== 'Escape' || !activeEl) return;
            // A field being edited owns Escape: there it means "put back what
            // was there", and only the field knows what that was. This handler
            // is on document in the capture phase, so without the guard it
            // dismissed the balloon and the field never saw the key — the edit
            // was then torn down by the focus moving, and its blur saved the
            // half-typed value. The balloon is still one Escape away.
            const active = document.activeElement;
            const tag = active?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            dismissActive({ persist: true });
        };
        document.addEventListener('keydown', onEscape, true);

        bindInteractHandlers(field);

        requestAnimationFrame(() => {
            if (activeEl && anchorTargetEl?.isConnected) {
                positionPopover(activeEl, anchorTargetEl, activePromoDef);
            }
            pop.classList.add('is-visible');
        });
        return true;
    }

    function tryShowScheduled() {
        if (!pendingSection || !pendingCtx) return;
        const promo = pickPromo(pendingSection, pendingCtx);
        if (!promo) {
            clearTimeout(retryTimer);
            retryTimer = null;
            attempts = 0;
            return;
        }
        if (!canShowEnvironment(pendingCtx)) {
            attempts += 1;
            if (attempts < MAX_ATTEMPTS) {
                clearTimeout(retryTimer);
                retryTimer = setTimeout(tryShowScheduled, RETRY_MS);
            }
            return;
        }
        const { field } = resolveAnchor(promo);
        if (!field) {
            if (revealAnchor(promo, pendingCtx)) {
                attempts += 1;
                clearTimeout(retryTimer);
                retryTimer = setTimeout(tryShowScheduled, 180);
                return;
            }
            attempts += 1;
            if (attempts < MAX_ATTEMPTS) {
                clearTimeout(retryTimer);
                retryTimer = setTimeout(tryShowScheduled, RETRY_MS);
            }
            return;
        }
        attempts = 0;
        clearTimeout(retryTimer);
        retryTimer = null;
        show(promo, pendingCtx);
    }

    function scheduleForSection(section, ctx = {}) {
        dismissActive({ persist: false });
        clearTimeout(scheduleTimer);
        clearTimeout(retryTimer);
        attempts = 0;
        // Repaints reschedule the same section; only leaving one and coming back
        // is a fresh arrival where ensureSubTab may steer the sub-tab again.
        // pendingSection is null on the very first schedule, which is also when a
        // deep link has just named a sub-tab — clearing there would discard it.
        if (pendingSection !== null && section !== pendingSection) subTabTouched = false;
        pendingSection = section;
        pendingCtx = ctx;
        scheduleTimer = setTimeout(() => {
            scheduleTimer = null;
            tryShowScheduled();
        }, 500);
    }

    bindAnchorClickDelegate();

    global.ConfigSettingPromo = {
        register,
        registerAll,
        scheduleForSection,
        dismissActive,
        hasSeen,
        markSeen,
        markSubTabChosen,
        resetSeen,
        /** @internal tests */
        _registry: registry,
    };
}(typeof window !== 'undefined' ? window : globalThis));
