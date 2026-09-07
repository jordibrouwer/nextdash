'use strict';

/**
 * How tightly list rows sit. One setting for the whole app rather than one per
 * view: it is a reading preference, not a property of a particular list.
 */
const DENSITIES = ['compact', 'comfortable'];
const STORAGE_KEY = 'nextdash:list-density';
const DEFAULT = 'comfortable';

const ListDensity = {
    DEFAULT,
    STORAGE_KEY,
    get() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return DENSITIES.includes(stored) ? stored : DEFAULT;
        } catch {
            return DEFAULT;
        }
    },
    set(value) {
        const next = DENSITIES.includes(value) ? value : DEFAULT;
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch { /* private mode: the setting still applies this session */ }
        document.body.dataset.listDensity = next;
        window.dispatchEvent(new CustomEvent('nextdash:list-density', { detail: next }));
    },
    apply() {
        document.body.dataset.listDensity = this.get();
    },
};

window.ListDensity = ListDensity;
ListDensity.apply();
