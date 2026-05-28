/**
 * Post-onboarding wizard for empty libraries — guides users to config#pages and first bookmark.
 */
class PostSetupWizard {
    constructor({ dashboard, language }) {
        this.dashboard = dashboard;
        this.language = language;
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
        try {
            if (localStorage.getItem(this.storageKey)) return false;
        } catch {
            return false;
        }
        if (this.dashboard.onboardingStartedInSession) return false;
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
                    'Use + below for a quick add, or manage bookmarks in bulk from config. Shortcuts: {shortcut}.',
                    { shortcut: '+' }
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
        this.dashboard?.maybeShowWhatsNew?.();
    }
}

if (typeof window !== 'undefined') {
    window.PostSetupWizard = PostSetupWizard;
}
