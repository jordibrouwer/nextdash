'use strict';

/**
 * How tightly list rows sit.
 *
 * One setting for the whole app rather than one per view: it is a reading
 * preference, not a property of a particular list. That was the intent from
 * the start and it was not what the code did -- this module kept its own value
 * in localStorage, defaulting to `comfortable`, while the dashboard read
 * `densityMode` off the server, defaulting to `compact`. So a reader who chose
 * compact rows on the dashboard opened Health and got comfortable ones, and
 * the control that would fix it lived only in the view's own toolbar, never
 * reached the server, and did not survive a different browser.
 *
 * There is one value now: `densityMode`. This is the front for it, kept so the
 * shell's buttons and anything else reading ListDensity carry on working.
 */
const DENSITIES = ['comfortable', 'compact', 'dense', 'auto'];
/** The two the shell's toggle offers; dense and auto are set from config. */
const TOGGLE_DENSITIES = ['compact', 'comfortable'];
const STORAGE_KEY = 'nextdash:list-density';
const DEFAULT = 'compact';

const ListDensity = {
    DEFAULT,
    STORAGE_KEY,
    DENSITIES,
    TOGGLE_DENSITIES,

    /**
     * The value in force.
     *
     * The body attribute is the one the page is actually drawn with, so it is
     * read first; before setupDOM() has run there is the dashboard's own copy
     * of the settings, and before that the default.
     */
    get() {
        const stamped = document.body?.dataset?.densityMode;
        if (DENSITIES.includes(stamped)) return stamped;
        const stored = window.dashboardInstance?.settings?.densityMode;
        if (DENSITIES.includes(stored)) return stored;
        return DEFAULT;
    },

    set(value) {
        const next = DENSITIES.includes(value) ? value : DEFAULT;
        const dash = window.dashboardInstance;
        if (dash?.settings) {
            dash.settings.densityMode = next;
            // The same three steps the command palette takes: the attribute is
            // stamped by setupDOM, and saveSettings is what makes it outlast
            // the tab.
            dash.setupDOM?.();
            dash.saveSettings?.();
        }
        // Stamped here too: a view can ask for a density before the dashboard
        // is up, and the rows have to follow immediately either way.
        if (document.body) document.body.dataset.densityMode = next;
        window.dispatchEvent(new CustomEvent('nextdash:list-density', { detail: next }));
    },

    /**
     * Carry a reader's old choice over, once.
     *
     * The value this module used to keep in localStorage is a real preference
     * somebody set; dropping it on upgrade would silently reset their rows. It
     * is pushed into the setting the first time the dashboard is up and the key
     * is then removed, so this runs once per browser and never again.
     */
    migrate() {
        let stored = null;
        try {
            stored = localStorage.getItem(STORAGE_KEY);
        } catch {
            return;
        }
        if (!stored) return;
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch { /* private mode: the push below still applies it this session */ }
        if (!DENSITIES.includes(stored) || stored === this.get()) return;

        /*
         * Written directly rather than through set(): migrate() is called from
         * setupDOM, and set() calls setupDOM, so going through it would re-enter
         * the function that is still running.
         */
        const dash = window.dashboardInstance;
        if (dash?.settings) {
            dash.settings.densityMode = stored;
            dash.saveSettings?.();
        }
        if (document.body) document.body.dataset.densityMode = stored;
        window.dispatchEvent(new CustomEvent('nextdash:list-density', { detail: stored }));
    },

    apply() {
        // The attribute belongs to setupDOM, which knows the settings. Before
        // that, stamp what is known so a view rendered early is not left
        // without a density at all.
        if (document.body && !document.body.dataset.densityMode) {
            document.body.dataset.densityMode = this.get();
        }
    },
};

window.ListDensity = ListDensity;
ListDensity.apply();
