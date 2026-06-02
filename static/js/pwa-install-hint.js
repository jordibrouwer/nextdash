/**
 * One-time mobile toast after onboarding when the app can be added to the home screen.
 * Uses the dynamic manifest for the app name (/manifest.webmanifest).
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'nextdash-pwa-install-hint-v1';
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

    async function maybeShow() {
        const dash = window.dashboardInstance;
        if (!dash || typeof dash.showNotification !== 'function') return;
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return;
        if (!isMobile()) return;
        if (dash.settings?.onboardingCompleted !== true) return;
        if (hasShown()) return;
        if (!canInstall()) return;
        if (typeof dash.isModalOpen === 'function' && dash.isModalOpen()) return;

        const name = await getManifestName();

        if (deferredPrompt) {
            markShown();
            dash.showNotification(
                t('pwaInstallHintAndroid', 'Install {name} on your home screen for quick access.', { name }),
                'info',
                {
                    duration: 12000,
                    actionLabel: t('pwaInstallHintAction', 'Install'),
                    onAction: async () => {
                        if (!deferredPrompt) return;
                        try {
                            await deferredPrompt.prompt();
                            await deferredPrompt.userChoice;
                        } catch { /* ignore */ }
                        deferredPrompt = null;
                    },
                }
            );
            return;
        }

        if (isIos()) {
            markShown();
            dash.showNotification(
                t(
                    'pwaInstallHintIos',
                    'Add {name} to your home screen: tap Share, then "Add to Home Screen".',
                    { name }
                ),
                'info',
                { duration: 14000 }
            );
        }
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
        window.addEventListener('beforeinstallprompt', (e) => {
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
