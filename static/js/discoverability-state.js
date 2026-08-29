/**
 * Server-backed discoverability state (settings.discoverabilityState).
 * Replaces per-browser localStorage for what's-new and tips progress.
 */
(function initDiscoverabilityState(global) {
    'use strict';

    const WHATS_NEW_LEGACY_KEY = 'nextdash:last-whats-new-dashboard-release';
    const TIPS_UNTIL_LEGACY_KEY = 'nextdash-tips-promo-until-v1';
    const TIPS_NOT_BEFORE_LEGACY_KEY = 'nextdash-tips-not-before-v1';

    let state = {
        lastWhatsNewRelease: '',
        tipsPromoUntil: 0,
        tipsNotBefore: 0,
        seenTips: [],
        seenSettingPromos: [],
    };
    let persistTimer = null;
    let migrateScheduled = false;

    function normalizeIncoming(raw) {
        if (!raw || typeof raw !== 'object') {
            return {
                lastWhatsNewRelease: '',
                tipsPromoUntil: 0,
                tipsNotBefore: 0,
                seenTips: [],
                seenSettingPromos: [],
            };
        }
        return {
            lastWhatsNewRelease: String(raw.lastWhatsNewRelease || '').trim(),
            tipsPromoUntil: Number(raw.tipsPromoUntil) || 0,
            tipsNotBefore: Number(raw.tipsNotBefore) || 0,
            seenTips: Array.isArray(raw.seenTips)
                ? raw.seenTips.map((id) => String(id || '').trim()).filter(Boolean)
                : [],
            seenSettingPromos: Array.isArray(raw.seenSettingPromos)
                ? raw.seenSettingPromos.map((id) => String(id || '').trim()).filter(Boolean)
                : [],
        };
    }

    function syncLegacyKeysFromState() {
        try {
            if (state.lastWhatsNewRelease) {
                localStorage.setItem(WHATS_NEW_LEGACY_KEY, state.lastWhatsNewRelease);
            }
            if (state.tipsPromoUntil > 0) {
                localStorage.setItem(TIPS_UNTIL_LEGACY_KEY, String(state.tipsPromoUntil));
            } else {
                localStorage.removeItem(TIPS_UNTIL_LEGACY_KEY);
            }
            if (state.tipsNotBefore > 0) {
                localStorage.setItem(TIPS_NOT_BEFORE_LEGACY_KEY, String(state.tipsNotBefore));
            } else {
                localStorage.removeItem(TIPS_NOT_BEFORE_LEGACY_KEY);
            }
        } catch {
            // Ignore storage errors.
        }
    }

    function getLastWhatsNewRelease() {
        if (state.lastWhatsNewRelease) {
            return state.lastWhatsNewRelease;
        }
        try {
            return String(localStorage.getItem(WHATS_NEW_LEGACY_KEY) || '').trim();
        } catch {
            return '';
        }
    }

    function setLastWhatsNewRelease(releaseToken, options = {}) {
        state.lastWhatsNewRelease = String(releaseToken || '').trim();
        try {
            if (state.lastWhatsNewRelease) {
                localStorage.setItem(WHATS_NEW_LEGACY_KEY, state.lastWhatsNewRelease);
            } else {
                localStorage.removeItem(WHATS_NEW_LEGACY_KEY);
            }
        } catch {
            // Ignore storage errors.
        }
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    function getTipsPromoUntil() {
        if (state.tipsPromoUntil > 0) {
            return state.tipsPromoUntil;
        }
        try {
            return Number(localStorage.getItem(TIPS_UNTIL_LEGACY_KEY) || 0);
        } catch {
            return 0;
        }
    }

    function setTipsPromoUntil(ts, options = {}) {
        state.tipsPromoUntil = Number(ts) > 0 ? Number(ts) : 0;
        try {
            if (state.tipsPromoUntil > 0) {
                localStorage.setItem(TIPS_UNTIL_LEGACY_KEY, String(state.tipsPromoUntil));
            } else {
                localStorage.removeItem(TIPS_UNTIL_LEGACY_KEY);
            }
        } catch {
            // Ignore storage errors.
        }
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    function getTipsNotBefore() {
        if (state.tipsNotBefore > 0) {
            return state.tipsNotBefore;
        }
        try {
            return Number(localStorage.getItem(TIPS_NOT_BEFORE_LEGACY_KEY) || 0);
        } catch {
            return 0;
        }
    }

    function setTipsNotBefore(ts, options = {}) {
        state.tipsNotBefore = Number(ts) > 0 ? Number(ts) : 0;
        try {
            if (state.tipsNotBefore > 0) {
                localStorage.setItem(TIPS_NOT_BEFORE_LEGACY_KEY, String(state.tipsNotBefore));
            } else {
                localStorage.removeItem(TIPS_NOT_BEFORE_LEGACY_KEY);
            }
        } catch {
            // Ignore storage errors.
        }
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    function getSeenTips() {
        return Array.isArray(state.seenTips) ? state.seenTips.slice() : [];
    }

    function hasSeenTip(id) {
        const key = String(id || '').trim();
        return !!key && (state.seenTips || []).includes(key);
    }

    /** Record a tip as shown. Capped so the list cannot grow without bound. */
    function markTipSeen(id, options = {}) {
        const key = String(id || '').trim();
        if (!key) return;
        if (!Array.isArray(state.seenTips)) state.seenTips = [];
        if (state.seenTips.includes(key)) return;
        state.seenTips.push(key);
        if (state.seenTips.length > 200) {
            state.seenTips = state.seenTips.slice(-200);
        }
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    /*
     * Forget one tip or tour, leaving the rest alone.
     *
     * clearSeenTips below is the "hand this install to someone else" answer.
     * This is the narrower one: someone wants the Health tour again and has no
     * quarrel with the forty keyboard tips they have already met. tipsNotBefore
     * is deliberately untouched -- that gap belongs to the rotating toasts, and
     * a tour asked for by name should not reopen the tip firehose with it.
     */
    function forgetTip(id, options = {}) {
        const key = String(id || '').trim();
        if (!key || !Array.isArray(state.seenTips)) return;
        const next = state.seenTips.filter((seen) => seen !== key);
        if (next.length === state.seenTips.length) return;
        state.seenTips = next;
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    /**
     * Forget every tip and tour, so they all show once more.
     *
     * seenTips holds two kinds of id: the rotating keyboard tips, and the
     * one-time tours (health, inbox, config). Both are what "replay the welcome
     * tour and tips" means, so both go. tipsNotBefore goes with them — it is
     * the few-days gap between toasts, and leaving it set would mean the tips
     * are back in principle but silent for the rest of the week.
     *
     * seenSettingPromos is deliberately left alone: those are attached to
     * individual settings in config, not to the dashboard's onboarding, and
     * bringing them all back would re-nag on every panel someone opens.
     */
    function clearSeenTips(options = {}) {
        state.seenTips = [];
        setTipsNotBefore(0, { persist: false });
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    function getSeenSettingPromos() {
        return Array.isArray(state.seenSettingPromos) ? state.seenSettingPromos.slice() : [];
    }

    function hasSeenSettingPromo(id) {
        const key = String(id || '').trim();
        return !!key && (state.seenSettingPromos || []).includes(key);
    }

    /** Record a config setting promo as dismissed; each id is shown once, ever. */
    function markSettingPromoSeen(id, options = {}) {
        const key = String(id || '').trim();
        if (!key) return;
        if (!Array.isArray(state.seenSettingPromos)) state.seenSettingPromos = [];
        if (state.seenSettingPromos.includes(key)) return;
        state.seenSettingPromos.push(key);
        if (state.seenSettingPromos.length > 100) {
            state.seenSettingPromos = state.seenSettingPromos.slice(-100);
        }
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    function resetSettingPromoSeen(id, options = {}) {
        const key = String(id || '').trim();
        if (!key || !Array.isArray(state.seenSettingPromos)) return;
        state.seenSettingPromos = state.seenSettingPromos.filter((entry) => entry !== key);
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    function exportState() {
        return {
            lastWhatsNewRelease: state.lastWhatsNewRelease || undefined,
            tipsPromoUntil: state.tipsPromoUntil > 0 ? state.tipsPromoUntil : undefined,
            tipsNotBefore: state.tipsNotBefore > 0 ? state.tipsNotBefore : undefined,
            seenTips: state.seenTips?.length ? state.seenTips.slice() : undefined,
            seenSettingPromos: state.seenSettingPromos?.length ? state.seenSettingPromos.slice() : undefined,
        };
    }

    function applyToDashboardSettings() {
        const exported = exportState();
        if (global.dashboardInstance?.settings) {
            global.dashboardInstance.settings.discoverabilityState = exported;
        }
        if (global.configManager?.settingsData) {
            global.configManager.settingsData.discoverabilityState = exported;
        }
    }

    function migrateFromLocalStorageIfNeeded() {
        let dirty = false;

        if (!state.lastWhatsNewRelease) {
            try {
                const seen = String(localStorage.getItem(WHATS_NEW_LEGACY_KEY) || '').trim();
                if (seen) {
                    state.lastWhatsNewRelease = seen;
                    dirty = true;
                }
            } catch {
                // Ignore storage errors.
            }
        }

        if (!state.tipsPromoUntil) {
            try {
                const until = Number(localStorage.getItem(TIPS_UNTIL_LEGACY_KEY) || 0);
                if (until > 0) {
                    state.tipsPromoUntil = until;
                    dirty = true;
                }
            } catch {
                // Ignore storage errors.
            }
        }

        if (!state.tipsNotBefore) {
            try {
                const notBefore = Number(localStorage.getItem(TIPS_NOT_BEFORE_LEGACY_KEY) || 0);
                if (notBefore > 0) {
                    state.tipsNotBefore = notBefore;
                    dirty = true;
                }
            } catch {
                // Ignore storage errors.
            }
        }

        if (dirty) {
            applyToDashboardSettings();
            schedulePersist();
        } else {
            syncLegacyKeysFromState();
        }
    }

    function init(serverState) {
        state = normalizeIncoming(serverState);
        applyToDashboardSettings();
        syncLegacyKeysFromState();
        if (!migrateScheduled) {
            migrateScheduled = true;
            queueMicrotask(() => migrateFromLocalStorageIfNeeded());
        }
    }

    async function persistNow() {
        const payload = { discoverabilityState: exportState() };
        applyToDashboardSettings();

        const dash = global.dashboardInstance;
        if (dash && typeof dash.saveSettings === 'function') {
            await dash.saveSettings();
            return true;
        }

        const fetchFn = typeof global.nextDashFetch === 'function' ? global.nextDashFetch : global.fetch;
        const response = await fetchFn('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return response.ok;
    }

    function schedulePersist() {
        clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            persistTimer = null;
            void persistNow().catch(() => {
                // Non-blocking; user can save config manually.
            });
        }, 700);
    }

    global.DiscoverabilityState = {
        init,
        exportState,
        getLastWhatsNewRelease,
        setLastWhatsNewRelease,
        getTipsPromoUntil,
        setTipsPromoUntil,
        getTipsNotBefore,
        setTipsNotBefore,
        getSeenTips,
        hasSeenTip,
        markTipSeen,
        forgetTip,
        clearSeenTips,
        getSeenSettingPromos,
        hasSeenSettingPromo,
        markSettingPromoSeen,
        resetSettingPromoSeen,
        schedulePersist,
        persistNow,
    };
}(typeof window !== 'undefined' ? window : globalThis));
