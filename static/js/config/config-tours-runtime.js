/**
 * Config tours removed (fase 2, blok A). This stub keeps only the small
 * non-tour helper the tab-tours module still uses (isConfigTabActive); all the
 * scheduling / seen-state / mark-completed tour machinery is gone.
 */
class ConfigToursRuntime {
    constructor(config) {
        this.config = config;
    }

    isConfigTabActive(tabName) {
        const c = this.config;
        if (c.ui?._currentTab === tabName) {
            return true;
        }
        const activeTab = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
        if (activeTab === tabName) {
            return true;
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        return hash.startsWith(tabName);
    }
}

window.ConfigToursRuntime = ConfigToursRuntime;
