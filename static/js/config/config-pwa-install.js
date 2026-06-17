/**
 * "Add to home screen" helper for Config → General → Advanced (HyprMode / PWA).
 */
(function initConfigPwaInstall(global) {
    let deferredPrompt = null;

    function t(key, fallback) {
        const lang = global.configManager?.language;
        const fullKey = `config.${key}`;
        const value = lang?.t?.(fullKey);
        return value && value !== fullKey ? value : fallback;
    }

    function isStandalone() {
        return global.matchMedia?.('(display-mode: standalone)')?.matches === true
            || global.navigator?.standalone === true;
    }

    function detectPlatform() {
        const ua = String(global.navigator?.userAgent || '');
        if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
        if (/android/i.test(ua)) return 'android';
        if (/edg\//i.test(ua)) return 'edge';
        if (/chrome|chromium|crios/i.test(ua)) return 'chrome';
        return 'desktop';
    }

    function sync(root) {
        if (!root) return;
        const statusEl = root.querySelector('#pwa-install-status');
        const installBtn = root.querySelector('#pwa-install-trigger-btn');
        const stepsEl = root.querySelector('#pwa-install-steps');

        if (isStandalone()) {
            if (statusEl) {
                statusEl.textContent = t('pwaInstallAlreadyInstalled', 'Installed — nextDash is running as an app.');
            }
            if (installBtn) installBtn.hidden = true;
            return;
        }

        if (statusEl) {
            statusEl.textContent = deferredPrompt
                ? t('pwaInstallReady', 'Install is available on this device.')
                : t('pwaInstallHint', 'Install nextDash for launcher-style access (pairs well with HyprMode).');
        }

        if (installBtn) {
            installBtn.hidden = !deferredPrompt;
        }

        if (stepsEl) {
            const platform = detectPlatform();
            const stepKey = {
                ios: 'pwaInstallStepsIos',
                android: 'pwaInstallStepsAndroid',
                edge: 'pwaInstallStepsEdge',
                chrome: 'pwaInstallStepsChrome',
                desktop: 'pwaInstallStepsDesktop',
            }[platform] || 'pwaInstallStepsDesktop';
            stepsEl.innerHTML = t(stepKey, stepsEl.getAttribute('data-fallback') || '');
        }
    }

    function bind(root) {
        if (!root || root.dataset.pwaBound === '1') return;
        root.dataset.pwaBound = '1';

        global.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault();
            deferredPrompt = event;
            sync(root);
        });

        const installBtn = root.querySelector('#pwa-install-trigger-btn');
        if (installBtn) {
            installBtn.addEventListener('click', async () => {
                if (!deferredPrompt) return;
                deferredPrompt.prompt();
                try {
                    await deferredPrompt.userChoice;
                } catch {
                    // Ignore prompt errors.
                }
                deferredPrompt = null;
                sync(root);
            });
        }

        sync(root);
    }

    global.ConfigPwaInstall = {
        bind,
        sync,
        isStandalone,
    };
}(window));
