/**
 * Server-backed discoverability state (settings.discoverabilityState).
 * Replaces per-browser localStorage for what's-new and tips progress.
 */
(function initDiscoverabilityState(global) {
    'use strict';

    const WHATS_NEW_LEGACY_KEY = 'nextdash:last-whats-new-dashboard-release';
    const TIPS_UNTIL_LEGACY_KEY = 'nextdash-tips-promo-until-v1';
    const TIPS_NOT_BEFORE_LEGACY_KEY = 'nextdash-tips-not-before-v1';
    const DAY_MS = 24 * 60 * 60 * 1000;
    const TIPS_WINDOW_MS = DAY_MS;
    const TIPS_WEEK_MS = 7 * DAY_MS;
    const TIPS_PER_WINDOW = 1;

    let state = {
        lastWhatsNewRelease: '',
        tipsPromoUntil: 0,
        tipsNotBefore: 0,
        tipsShownAt: [],
        seenTips: [],
        seenSettingPromos: [],
        bell: {},
        tipCardShownAt: 0,
    };
    let persistTimer = null;
    let migrateScheduled = false;
    // Tips marked seen on this page. A settings read that left before the mark
    // was saved still lands afterwards, and init() took it whole: a tour just
    // closed showed again on the next visit to its view.
    const markedHere = new Set();
    // The same guard for bell rows, by id: a row marked or reset on this page
    // keeps the local record when a stale read lands.
    const bellMarkedHere = new Set();

    function cleanBellMark(raw) {
        if (!raw || typeof raw !== 'object') return undefined;
        const mark = {
            count: Math.max(0, Math.floor(Number(raw.count) || 0)),
        };
        if (Array.isArray(raw.ids) && raw.ids.length) {
            mark.ids = raw.ids.map((id) => String(id || '').trim()).filter(Boolean);
        }
        if (raw.forever === true) mark.forever = true;
        return mark;
    }

    function cleanBell(raw) {
        const out = {};
        if (!raw || typeof raw !== 'object') return out;
        Object.keys(raw).forEach((id) => {
            const key = String(id || '').trim();
            if (!key || !raw[id] || typeof raw[id] !== 'object') return;
            const record = {};
            const read = cleanBellMark(raw[id].read);
            const no = cleanBellMark(raw[id].no);
            if (read) record.read = read;
            if (no) record.no = no;
            out[key] = record;
        });
        return out;
    }

    function normalizeIncoming(raw) {
        if (!raw || typeof raw !== 'object') {
            return {
                lastWhatsNewRelease: '',
                tipsPromoUntil: 0,
                tipsNotBefore: 0,
                tipsShownAt: [],
                seenTips: [],
                seenSettingPromos: [],
                bell: {},
                tipCardShownAt: 0,
            };
        }
        return {
            lastWhatsNewRelease: String(raw.lastWhatsNewRelease || '').trim(),
            tipsPromoUntil: Number(raw.tipsPromoUntil) || 0,
            tipsNotBefore: Number(raw.tipsNotBefore) || 0,
            tipsShownAt: Array.isArray(raw.tipsShownAt)
                ? raw.tipsShownAt.map(Number).filter((ts) => ts > 0)
                : [],
            seenTips: Array.isArray(raw.seenTips)
                ? raw.seenTips.map((id) => String(id || '').trim()).filter(Boolean)
                : [],
            seenSettingPromos: Array.isArray(raw.seenSettingPromos)
                ? raw.seenSettingPromos.map((id) => String(id || '').trim()).filter(Boolean)
                : [],
            bell: cleanBell(raw.bell),
            tipCardShownAt: Number(raw.tipCardShownAt) > 0 ? Number(raw.tipCardShownAt) : 0,
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

    /*
     * How often tips may appear: at most TIPS_PER_WINDOW in any rolling 24
     * hours, so the first tip shows right away and the next one a day later. A
     * rolling window rather than a calendar day: no time zone to get wrong. tipsNotBefore is still honoured so a gap set by
     * an earlier version runs out instead of being dropped.
     */
    function tipsWindowMs() {
        const frequency = global.dashboardInstance?.settings?.sessionTipsFrequency;
        return frequency === 'weekly' ? TIPS_WEEK_MS : TIPS_WINDOW_MS;
    }

    function tipsAllowedNow(now = Date.now()) {
        if (state.tipsNotBefore > 0 && now < state.tipsNotBefore) return false;
        const window = tipsWindowMs();
        const recent = (state.tipsShownAt || []).filter((ts) => now - ts < window);
        return recent.length < TIPS_PER_WINDOW;
    }

    /** Count one tip as shown, for the rate limit. */
    function noteTipShown(options = {}) {
        const now = Date.now();
        // Kept for the longer window, so switching to weekly counts the tip
        // shown yesterday instead of forgetting it.
        state.tipsShownAt = (state.tipsShownAt || []).filter((ts) => now - ts < TIPS_WEEK_MS);
        state.tipsShownAt.push(now);
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
        markedHere.add(key);
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
        markedHere.delete(key);
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
        markedHere.clear();
        state.seenTips = [];
        setTipsNotBefore(0, { persist: false });
        state.tipsShownAt = [];
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

    /** The marks kept for one bell row; an empty object when there are none. */
    function getBellRecord(id) {
        const key = String(id || '').trim();
        const record = key && state.bell ? state.bell[key] : null;
        return record ? JSON.parse(JSON.stringify(record)) : {};
    }

    function setBellMark(id, kind, mark, options) {
        const key = String(id || '').trim();
        const clean = cleanBellMark(mark);
        if (!key || !clean) return;
        if (kind === 'read') delete clean.forever;
        if (!state.bell) state.bell = {};
        const record = state.bell[key] || {};
        record[kind] = clean;
        state.bell[key] = record;
        bellMarkedHere.add(key);
        applyToDashboardSettings();
        if (options?.persist !== false) {
            schedulePersist();
        }
    }

    /** Remember how much of a row the person has read: {count, ids}. */
    function markBellRead(id, mark, options = {}) {
        setBellMark(id, 'read', mark, options);
    }

    /** Remember a "No" for a row: {count, ids, forever?}. */
    function markBellNo(id, mark, options = {}) {
        setBellMark(id, 'no', mark, options);
    }

    /*
     * Forget every "No" that was given forever; read marks and No marks that
     * only cover the current items stay. The record is kept without its `no`
     * (even when that leaves it empty) because the server takes a record the
     * client sends per id as the truth: a merge that kept the "greater" mark
     * would bring the cleared No back. Returns the ids it cleared.
     */
    function resetBellNo(options = {}) {
        const cleared = [];
        Object.keys(state.bell || {}).forEach((id) => {
            if (state.bell[id].no && state.bell[id].no.forever) {
                delete state.bell[id].no;
                bellMarkedHere.add(id);
                cleared.push(id);
            }
        });
        if (!cleared.length) return cleared;
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
        return cleared;
    }

    function getTipCardShownAt() {
        return Number(state.tipCardShownAt) > 0 ? Number(state.tipCardShownAt) : 0;
    }

    function noteTipCardShown(ms, options = {}) {
        state.tipCardShownAt = Number(ms) > 0 ? Number(ms) : 0;
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    function exportState() {
        const bellIds = Object.keys(state.bell || {});
        return {
            lastWhatsNewRelease: state.lastWhatsNewRelease || undefined,
            tipsPromoUntil: state.tipsPromoUntil > 0 ? state.tipsPromoUntil : undefined,
            tipsNotBefore: state.tipsNotBefore > 0 ? state.tipsNotBefore : undefined,
            tipsShownAt: state.tipsShownAt?.length ? state.tipsShownAt.slice() : undefined,
            seenTips: state.seenTips?.length ? state.seenTips.slice() : undefined,
            seenSettingPromos: state.seenSettingPromos?.length ? state.seenSettingPromos.slice() : undefined,
            bell: bellIds.length ? JSON.parse(JSON.stringify(state.bell)) : undefined,
            tipCardShownAt: state.tipCardShownAt > 0 ? state.tipCardShownAt : undefined,
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
        const localBell = state.bell || {};
        state = normalizeIncoming(serverState);
        bellMarkedHere.forEach((key) => {
            if (localBell[key]) state.bell[key] = localBell[key];
        });
        markedHere.forEach((key) => {
            if (!state.seenTips.includes(key)) state.seenTips.push(key);
        });
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
            // This key only: the whole copy put back whatever another tab or
            // the API had changed since this one loaded.
            await dash.saveSettings({ keys: ['discoverabilityState'] });
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
        tipsAllowedNow,
        noteTipShown,
        getSeenTips,
        hasSeenTip,
        markTipSeen,
        forgetTip,
        clearSeenTips,
        getSeenSettingPromos,
        hasSeenSettingPromo,
        markSettingPromoSeen,
        resetSettingPromoSeen,
        getBellRecord,
        markBellRead,
        markBellNo,
        resetBellNo,
        getTipCardShownAt,
        noteTipCardShown,
        schedulePersist,
        persistNow,
    };
}(typeof window !== 'undefined' ? window : globalThis));
