/**
 * Post-onboarding wizard for empty libraries — guides users to config#pages and first bookmark.
 */
const POST_SETUP_DELAY_MS = 24 * 60 * 60 * 1000;
const ONBOARDING_COMPLETED_AT_KEY = 'nextdash:onboarding-completed-at';

function recordOnboardingCompletedAt() {
    try {
        localStorage.setItem(ONBOARDING_COMPLETED_AT_KEY, String(Date.now()));
    } catch { /* ignore */ }
}

function isPostSetupEligible() {
    try {
        const raw = localStorage.getItem(ONBOARDING_COMPLETED_AT_KEY);
        if (!raw) return true;
        const completedAt = parseInt(raw, 10);
        if (!Number.isFinite(completedAt)) return true;
        return Date.now() - completedAt >= POST_SETUP_DELAY_MS;
    } catch {
        return false;
    }
}

class PostSetupWizard {
    constructor({ dashboard, language, queueMeta = null, onQueueComplete = null, onQueueDefer = null }) {
        this.dashboard = dashboard;
        this.language = language;
        this.queueMeta = queueMeta;
        this.onQueueComplete = typeof onQueueComplete === 'function' ? onQueueComplete : null;
        this.onQueueDefer = typeof onQueueDefer === 'function' ? onQueueDefer : null;
        this.storageKey = 'nextdash-post-setup-wizard-v1';
        this.currentStep = 0;
        this.overlay = null;
        this.card = null;
    }

    t(key, fallback, vars) {
        const raw = this.language && typeof this.language.t === 'function'
            ? this.language.t(key)
            : key;
        let text = raw && raw !== key ? raw : (fallback || key);
        if (vars) {
            Object.entries(vars).forEach(([k, v]) => {
                text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
            });
        }
        return text;
    }

    hasAnyBookmarks() {
        const dash = this.dashboard;
        return (Array.isArray(dash.allBookmarks) && dash.allBookmarks.length > 0)
            || (Array.isArray(dash.bookmarks) && dash.bookmarks.length > 0);
    }

    shouldStart() {
        if (this.hasAnyBookmarks()) return false;
        if (!this.dashboard?.settings?.onboardingCompleted) return false;
        if (this.dashboard.onboardingStartedInSession) return false;
        if (!isPostSetupEligible()) return false;
        try {
            if (localStorage.getItem(this.storageKey)) return false;
        } catch {
            return false;
        }
        return true;
    }

    getSteps() {
        const pageCount = Array.isArray(this.dashboard.pages) ? this.dashboard.pages.length : 0;
        return [
            {
                title: this.t('postSetup.pagesTitle', 'Organize with pages'),
                body: this.t(
                    'postSetup.pagesBody',
                    'Pages group bookmarks (Work, Personal, etc.). Open config → pages to rename tabs, reorder them, and set how many you need.'
                ),
                primary: this.t('postSetup.openPagesConfig', 'Open pages in config'),
                primaryAction: () => {
                    this.markSeen();
                    window.location.href = '/config#pages';
                },
                secondary: this.t('postSetup.next', 'Next'),
                secondaryAction: () => this.nextStep()
            },
            {
                title: this.t('postSetup.bookmarkTitle', 'Add your first bookmark'),
                body: this.t(
                    'postSetup.bookmarkBody',
                    'Press + for a quick one-line add, or & / Ctrl+Shift+A for the full bookmark form. You can also manage bookmarks in config.'
                ),
                primary: this.t('postSetup.addBookmark', 'Add bookmark now'),
                primaryAction: () => {
                    this.markSeen();
                    this.close();
                    if (this.dashboard.quickAddWidget) {
                        this.dashboard.quickAddWidget.open();
                    } else {
                        this.dashboard.openEmptyStateAdd();
                    }
                },
                secondary: this.t('postSetup.openBookmarksConfig', 'Open bookmarks in config'),
                secondaryAction: () => {
                    this.markSeen();
                    window.location.href = '/config#bookmarks';
                }
            },
            {
                title: this.t('postSetup.doneTitle', 'You are set'),
                body: this.t(
                    'postSetup.doneBody',
                    'Your dashboard is ready. You currently have {count} page(s) — add bookmarks anytime.',
                    { count: pageCount }
                ),
                primary: this.t('postSetup.finish', 'Got it'),
                primaryAction: () => this.finish(),
                showSkip: false
            }
        ];
    }

    start() {
        if (!this.shouldStart()) return;
        this.steps = this.getSteps();
        this.render();
        this.showStep(0);
        try {
            localStorage.setItem('nextdash-first-bookmark-guide-v1', '1');
        } catch { /* merged into this wizard */ }
    }

    render() {
        const overlay = document.createElement('div');
        overlay.className = 'post-setup-overlay onboarding-overlay';
        document.body.appendChild(overlay);
        this.overlay = overlay;

        const card = document.createElement('div');
        card.className = 'post-setup-card onboarding-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.innerHTML = `
            <div class="onboarding-progress post-setup-progress"></div>
            <h3 class="onboarding-title post-setup-title"></h3>
            <p class="onboarding-body post-setup-body"></p>
            <div class="onboarding-actions post-setup-actions">
                <button type="button" class="onboarding-btn post-setup-skip"></button>
                <button type="button" class="onboarding-btn onboarding-secondary post-setup-secondary"></button>
                <button type="button" class="onboarding-btn onboarding-next post-setup-primary"></button>
            </div>
        `;
        document.body.appendChild(card);
        this.card = card;

        if (this.queueMeta && window.DiscoverabilityQueueBar?.inject) {
            window.DiscoverabilityQueueBar.inject(this.card, this.queueMeta, () => {
                this.close();
                this.onQueueDefer?.();
            }, this.dashboard);
        }

        card.querySelector('.post-setup-skip').addEventListener('click', () => this.finish());
        document.addEventListener('keydown', this._onKeydown = (e) => {
            if (e.key === 'Escape') this.finish();
        });
    }

    showStep(index) {
        this.currentStep = Math.max(0, Math.min(index, this.steps.length - 1));
        const step = this.steps[this.currentStep];
        if (!this.card || !step) return;

        this.card.querySelector('.post-setup-progress').textContent =
            `${this.currentStep + 1}/${this.steps.length}`;
        this.card.querySelector('.post-setup-title').textContent = step.title;
        this.card.querySelector('.post-setup-body').textContent = step.body;

        const skip = this.card.querySelector('.post-setup-skip');
        skip.textContent = this.t('postSetup.skip', 'Skip');
        skip.hidden = step.showSkip === false;

        const primary = this.card.querySelector('.post-setup-primary');
        primary.textContent = step.primary;
        primary.onclick = () => step.primaryAction();

        const secondary = this.card.querySelector('.post-setup-secondary');
        if (step.secondary && step.secondaryAction) {
            secondary.hidden = false;
            secondary.textContent = step.secondary;
            secondary.onclick = () => step.secondaryAction();
        } else {
            secondary.hidden = true;
        }
    }

    nextStep() {
        if (this.currentStep >= this.steps.length - 1) {
            this.finish();
            return;
        }
        this.showStep(this.currentStep + 1);
    }

    markSeen() {
        try {
            localStorage.setItem(this.storageKey, '1');
        } catch { /* ignore */ }
    }

    close() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        if (this.card) {
            this.card.remove();
            this.card = null;
        }
        if (this._onKeydown) {
            document.removeEventListener('keydown', this._onKeydown);
        }
    }

    finish() {
        this.markSeen();
        this.close();
        this.onQueueComplete?.();
    }
}

/**
 * One-time tuning wizard after onboarding: language, theme, browser extension.
 */
class PostInstallTuningWizard {
    constructor({ dashboard, language, queueMeta = null, onQueueComplete = null, onQueueDefer = null }) {
        this.dashboard = dashboard;
        this.language = language;
        this.queueMeta = queueMeta;
        this.onQueueComplete = typeof onQueueComplete === 'function' ? onQueueComplete : null;
        this.onQueueDefer = typeof onQueueDefer === 'function' ? onQueueDefer : null;
        this.storageKey = 'nextdash-post-tuning-wizard-v1';
        this.currentStep = 0;
        this.overlay = null;
        this.card = null;
        this.fieldsHost = null;
    }

    t(key, fallback, vars) {
        const raw = this.language && typeof this.language.t === 'function'
            ? this.language.t(key)
            : key;
        let text = raw && raw !== key ? raw : (fallback || key);
        if (vars) {
            Object.entries(vars).forEach(([k, v]) => {
                text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
            });
        }
        return text;
    }

    shouldStart() {
        if (!this.dashboard?.settings?.onboardingCompleted) return false;
        if (!this.dashboard?.allowPostInstallTuningThisSession) return false;
        try {
            if (localStorage.getItem(this.storageKey)) return false;
        } catch {
            return false;
        }
        return true;
    }

    getSteps() {
        return [
            {
                id: 'language',
                title: this.t('postTuning.languageTitle', 'Choose your language'),
                body: this.t('postTuning.languageBody', 'Pick the language for the dashboard and config. You can change this anytime under Config → General.'),
                primary: this.t('postTuning.saveContinue', 'Save & continue'),
                secondary: this.t('postTuning.openConfig', 'Open in config'),
                secondaryAction: () => {
                    this.markSeen();
                    window.location.href = '/config#general';
                }
            },
            {
                id: 'theme',
                title: this.t('postTuning.themeTitle', 'Pick a theme'),
                body: this.t('postTuning.themeBody', 'Choose a starting theme. Customize colors later under Config → theme.'),
                primary: this.t('postTuning.saveContinue', 'Save & continue'),
                secondary: this.t('postTuning.openAppearance', 'Open appearance in config'),
                secondaryAction: () => {
                    this.markSeen();
                    window.location.href = '/config#general';
                }
            },
            {
                id: 'extension',
                title: this.t('postTuning.extensionTitle', 'Save bookmarks from your browser'),
                body: this.t('postTuning.extensionBody', 'Install the nextDash browser extension to add the current tab as a bookmark without leaving the page.'),
                primary: this.t('postTuning.openHelp', 'How to install'),
                primaryAction: () => {
                    this.markSeen();
                    window.location.href = '/config#help';
                },
                secondary: this.t('postTuning.finish', 'Finish'),
                secondaryAction: () => this.finish(),
                showSkip: false
            }
        ];
    }

    start() {
        if (!this.shouldStart()) return false;
        this.steps = this.getSteps();
        this.render();
        this.showStep(0);
        return true;
    }

    render() {
        const overlay = document.createElement('div');
        overlay.className = 'post-setup-overlay onboarding-overlay';
        document.body.appendChild(overlay);
        this.overlay = overlay;

        const card = document.createElement('div');
        card.className = 'post-setup-card onboarding-card post-tuning-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.innerHTML = `
            <div class="onboarding-progress post-setup-progress"></div>
            <h3 class="onboarding-title post-setup-title"></h3>
            <p class="onboarding-body post-setup-body"></p>
            <div class="post-tuning-fields"></div>
            <div class="onboarding-actions post-setup-actions">
                <button type="button" class="onboarding-btn post-setup-skip"></button>
                <button type="button" class="onboarding-btn onboarding-secondary post-setup-secondary"></button>
                <button type="button" class="onboarding-btn onboarding-next post-setup-primary"></button>
            </div>
        `;
        document.body.appendChild(card);
        this.card = card;
        this.fieldsHost = card.querySelector('.post-tuning-fields');

        if (this.queueMeta && window.DiscoverabilityQueueBar?.inject) {
            window.DiscoverabilityQueueBar.inject(this.card, this.queueMeta, () => {
                this.close();
                this.onQueueDefer?.();
            }, this.dashboard);
        }

        card.querySelector('.post-setup-skip').addEventListener('click', () => this.finish());
        document.addEventListener('keydown', this._onKeydown = (e) => {
            if (e.key === 'Escape') this.finish();
        });
    }

    renderFields(step) {
        if (!this.fieldsHost) return;
        this.fieldsHost.innerHTML = '';
        const settings = this.dashboard.settings || {};

        if (step.id === 'language') {
            const label = document.createElement('label');
            label.className = 'post-tuning-label';
            label.textContent = this.t('postTuning.languageLabel', 'Language');
            const select = document.createElement('select');
            select.id = 'post-tuning-language';
            [['en', 'English'], ['nl', 'Nederlands'], ['de', 'Deutsch'], ['fr', 'Français']].forEach(([value, name]) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = name;
                if ((settings.language || 'en') === value) opt.selected = true;
                select.appendChild(opt);
            });
            this.fieldsHost.append(label, select);
            return;
        }

        if (step.id === 'theme') {
            const label = document.createElement('label');
            label.className = 'post-tuning-label';
            label.textContent = this.t('postTuning.themeLabel', 'Theme');
            const select = document.createElement('select');
            select.id = 'post-tuning-theme';
            const themes = [
                ['dark', this.t('dashboard.darkTheme', 'Dark')],
                ['light', this.t('dashboard.lightTheme', 'Light')]
            ];
            themes.forEach(([value, name]) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = name;
                if ((settings.theme || 'dark') === value) opt.selected = true;
                select.appendChild(opt);
            });
            this.fieldsHost.append(label, select);
        }
    }

    async applyStepSettings(step) {
        const dash = this.dashboard;
        if (!dash?.settings) return;
        let changed = false;
        if (step.id === 'language') {
            const sel = document.getElementById('post-tuning-language');
            if (sel && sel.value && sel.value !== dash.settings.language) {
                dash.settings.language = sel.value;
                changed = true;
                if (dash.language?.loadTranslations) {
                    await dash.language.loadTranslations(sel.value);
                    dash.language.applyTranslations?.();
                }
            }
        }
        // Theme step is guidance only — do not overwrite the full theme id with "dark"/"light".
        if (changed && typeof dash.saveSettings === 'function') {
            await dash.saveSettings();
        }
    }

    showStep(index) {
        this.currentStep = Math.max(0, Math.min(index, this.steps.length - 1));
        const step = this.steps[this.currentStep];
        if (!this.card || !step) return;

        this.card.querySelector('.post-setup-progress').textContent =
            `${this.currentStep + 1}/${this.steps.length}`;
        this.card.querySelector('.post-setup-title').textContent = step.title;
        this.card.querySelector('.post-setup-body').textContent = step.body;
        this.renderFields(step);

        const skip = this.card.querySelector('.post-setup-skip');
        skip.textContent = this.t('postTuning.skip', 'Skip');
        skip.hidden = step.showSkip === false;

        const primary = this.card.querySelector('.post-setup-primary');
        primary.textContent = step.primary;
        primary.onclick = async () => {
            await this.applyStepSettings(step);
            if (step.primaryAction) {
                step.primaryAction();
                return;
            }
            this.nextStep();
        };

        const secondary = this.card.querySelector('.post-setup-secondary');
        if (step.secondary && step.secondaryAction) {
            secondary.hidden = false;
            secondary.textContent = step.secondary;
            secondary.onclick = () => step.secondaryAction();
        } else {
            secondary.hidden = true;
        }
    }

    nextStep() {
        if (this.currentStep >= this.steps.length - 1) {
            this.finish();
            return;
        }
        this.showStep(this.currentStep + 1);
    }

    markSeen() {
        try {
            localStorage.setItem(this.storageKey, '1');
        } catch { /* ignore */ }
    }

    close() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        if (this.card) {
            this.card.remove();
            this.card = null;
        }
        if (this._onKeydown) {
            document.removeEventListener('keydown', this._onKeydown);
        }
    }

    finish() {
        this.markSeen();
        this.close();
        this.onQueueComplete?.();
    }
}

if (typeof window !== 'undefined') {
    window.PostSetupWizard = PostSetupWizard;
    window.PostInstallTuningWizard = PostInstallTuningWizard;
    window.PostSetupTiming = {
        recordOnboardingCompletedAt,
        isPostSetupEligible,
        delayMs: POST_SETUP_DELAY_MS,
    };
}
