/**
 * A tip in the notifications bell, after onboarding, when the app can be added to the
 * home screen on a phone. It waits there until it is read.
 * Uses the dynamic manifest for the app name (/manifest.webmanifest).
 */
(function () {
    'use strict';

    // Set once the browser reports the app installed. v1 meant "the toast was
    // shown once"; the tip now returns daily, so that old flag must not hide it.
    const STORAGE_KEY = 'nextdash-pwa-installed-v2';
    let deferredPrompt = null;
    let manifestNamePromise = null;
    let scheduleTimer = null;

    function t(key, fallback, vars) {
        const lang = window.dashboardInstance?.language;
        let text = lang?.t?.(`dashboard.${key}`);
        if (!text || text === `dashboard.${key}`) text = fallback;
        if (vars) {
            Object.entries(vars).forEach(([k, v]) => {
                text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
            });
        }
        return text;
    }

    function isMobile() {
        return window.MobileExperience?.isMobileLayout?.() === true;
    }

    function isAlreadyInstalled() {
        if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
        if (window.matchMedia?.('(display-mode: fullscreen)').matches) return true;
        if (window.navigator.standalone === true) return true;
        return false;
    }

    function isIos() {
        const ua = navigator.userAgent || '';
        if (/iPad|iPhone|iPod/.test(ua)) return true;
        return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    }

    function hasShown() {
        try {
            return localStorage.getItem(STORAGE_KEY) === '1';
        } catch {
            return true;
        }
    }

    function markShown() {
        try {
            localStorage.setItem(STORAGE_KEY, '1');
        } catch { /* ignore */ }
    }

    function canInstall() {
        if (isAlreadyInstalled()) return false;
        if (deferredPrompt) return true;
        if (isIos() && isMobile()) return true;
        return false;
    }

    function fallbackAppName() {
        return document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content?.trim()
            || document.title?.trim()
            || 'nextDash';
    }

    function getManifestName() {
        if (!manifestNamePromise) {
            manifestNamePromise = fetch('/manifest.webmanifest', { cache: 'no-cache' })
                .then((res) => (res.ok ? res.json() : null))
                .then((manifest) => {
                    if (!manifest) return fallbackAppName();
                    return (manifest.short_name || manifest.name || fallbackAppName()).trim();
                })
                .catch(() => fallbackAppName());
        }
        return manifestNamePromise;
    }

    /**
     * What the bell row says, or null while there is nothing to offer: not on
     * a phone, before onboarding is done, once installed, or when the browser
     * has no way to install it (no install prompt and not iOS).
     */
    /** Today as a local date: the tip is offered again each day until installed. */
    function today() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    async function hintState() {
        const dash = window.dashboardInstance;
        if (!dash) return null;
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return null;
        if (!isMobile()) return null;
        if (hasShown()) return null; // installed here, as far as the browser told us
        if (dash.settings?.onboardingCompleted !== true) return null;
        if (!canInstall()) return null;

        const name = await getManifestName();
        if (deferredPrompt) {
            return { count: 1, ids: [today()], text: t('pwaInstallHintAndroid', 'Install {name} on your home screen for quick access.', { name }) };
        }
        if (isIos()) {
            return {
                count: 1,
                ids: [today()],
                text: t('pwaInstallHintIos', 'Add {name} to your home screen: tap Share, then "Add to Home Screen".', { name }),
            };
        }
        return null;
    }

    // A tip in the bell (group Tips), not a toast: it waits there until it is
    // read, and the install button reads it. Read, it comes back the next day
    // (its id is the date) for as long as the app is not installed.
    let bellHandle = null;

    function registerWithBell() {
        if (bellHandle || !window.NotificationBell) return;
        bellHandle = window.NotificationBell.register({
            id: 'pwa-install-hint',
            group: 'tips',
            kind: 'tip',
            icon: '\u{1F4F2}',
            no: 'forever',
            state: hintState,
            actions: [{
                // Only Android has something to press; iOS is told what to tap.
                label: () => t('pwaInstallHintAction', 'Install'),
                primary: true,
                marksRead: true,
                onClick: async () => {
                    if (!deferredPrompt) return;
                    try {
                        await deferredPrompt.prompt();
                        await deferredPrompt.userChoice;
                    } catch { /* ignore */ }
                    deferredPrompt = null;
                },
            }],
        });
    }

    async function maybeShow() {
        registerWithBell();
        await bellHandle?.refresh();
    }

    function scheduleShow(options = {}) {
        if (scheduleTimer) {
            clearTimeout(scheduleTimer);
        }
        const delay = options.afterOnboarding ? 2800 : 1600;
        scheduleTimer = setTimeout(() => {
            scheduleTimer = null;
            maybeShow();
        }, delay);
    }

    function init() {
        registerWithBell();
        window.addEventListener('beforeinstallprompt', (e) => {
            // preventDefault() suppresses Chrome's own install banner so we can
            // surface our own "add to home screen" hint instead. This makes
            // Chrome log "Banner not shown: beforeinstallpromptevent.preventDefault()
            // called" to the console — that message is expected, not an error.
            e.preventDefault();
            deferredPrompt = e;
            if (window.dashboardInstance?.settings?.onboardingCompleted === true) {
                scheduleShow({ afterOnboarding: false });
            }
        });

        window.addEventListener('appinstalled', () => {
            markShown();
            deferredPrompt = null;
        });
    }

    window.PwaInstallHint = {
        init,
        scheduleShow,
        maybeShow,
    };

    init();
})();
