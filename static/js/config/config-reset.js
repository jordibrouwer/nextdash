/**
 * Full data reset flow (destructive).
 */
class ConfigResetController {
    constructor(config) {
        this.config = config;
    }

    get c() {
        return this.config;
    }

    async resetToDefaults() {
        const tx = (key, fallback) => {
            const value = this.c.language.t(key);
            return value === key ? fallback : value;
        };
        const confirmed = await window.AppModal.danger({
            title: tx('config.resetAllDataTitle', 'Reset all data'),
            message: tx('config.resetAllDataMessage', 'This permanently deletes all pages, categories, bookmarks, finders, settings, custom themes, uploaded favicon/font, bookmark icons, and caches. You start over with default sample bookmarks and built-in settings. This cannot be undone.'),
            confirmText: tx('config.resetAllDataButton', 'Reset all data and start over'),
            cancelText: tx('config.cancel', 'Cancel')
        });

        if (!confirmed) return;
        const confirmToken = 'RESET';
        const typedToken = await new Promise((resolve) => {
            const typePromptText = tx('config.resetAllDataTypePrompt', `Type ${confirmToken} to confirm permanent reset:`);
            const inputLabel = tx('config.resetAllDataTypeLabel', 'Confirmation text');
            const confirmLabel = tx('config.resetAllDataTypeConfirm', 'Confirm reset');
            const cancelLabel = tx('config.cancel', 'Cancel');
            window.AppModal.show({
                title: tx('config.resetAllDataTypeTitle', 'Final confirmation'),
                htmlMessage: `
                    <p>${typePromptText}</p>
                    <input id="reset-confirm-input" class="modal-select" type="text" autocomplete="off" spellcheck="false" aria-label="${inputLabel}" />
                `,
                confirmText: confirmLabel,
                cancelText: cancelLabel,
                confirmClass: 'danger',
                onConfirm: () => {
                    const input = document.getElementById('reset-confirm-input');
                    resolve(input ? input.value : '');
                },
                onCancel: () => resolve(null)
            });
            setTimeout(() => {
                const input = document.getElementById('reset-confirm-input');
                if (input) {
                    input.focus();
                    input.select();
                }
            }, 80);
        });
        if (typedToken === null) {
            return;
        }
        if (String(typedToken).trim().toUpperCase() !== confirmToken) {
            this.c.ui.showNotification(
                tx('config.resetAllDataTypeMismatch', 'Reset cancelled: confirmation text did not match.'),
                'warning'
            );
            return;
        }

        const resetBtn = document.getElementById('reset-btn');
        const originalLabel = resetBtn?.textContent;
        if (resetBtn) {
            resetBtn.disabled = true;
            resetBtn.textContent = tx('config.resetAllDataResetting', 'Resetting…');
        }

        try {
            const response = await fetch('/api/reset', {
                method: 'POST',
                headers: nextDashWriteHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ confirm: true }),
            });
            if (!response.ok) throw new Error('Reset failed');
        } catch (error) {
            console.error('Error resetting all data:', error);
            this.c.ui.showNotification(tx('config.errorSavingConfig', 'Error saving configuration'), 'error');
            if (resetBtn) {
                resetBtn.disabled = false;
                resetBtn.textContent = originalLabel;
            }
            return;
        }

        try {
            sessionStorage.removeItem('nextDashSearchFlowHintDismissedV2');
            localStorage.removeItem('nextDashSearchFlowHintDismissedV1');
        } catch { /* ignore */ }
        try {
            this.c.storage.clearDeviceSettings();
        } catch (error) {
            console.warn('Could not clear device settings during reset:', error);
        }

        this.c.isNavigatingAway = true;
        setTimeout(() => { window.location.href = '/'; }, 1000);
    }

    async deleteAllBookmarks() {
        const tx = (key, fallback) => {
            const value = this.c.language.t(key);
            return value === key ? fallback : value;
        };
        const confirmed = await window.AppModal.danger({
            title: tx('config.deleteAllBookmarksTitle', 'Delete all bookmarks'),
            message: tx('config.deleteAllBookmarksMessage', 'This permanently deletes every bookmark on every page. Your pages, categories, finders, and all settings stay exactly as they are. No default sample bookmarks are added back. This cannot be undone.'),
            confirmText: tx('config.deleteAllBookmarksConfirm', 'Delete all bookmarks'),
            cancelText: tx('config.cancel', 'Cancel')
        });

        if (!confirmed) return;
        const confirmToken = 'DELETE';
        const typedToken = await new Promise((resolve) => {
            const typePromptText = tx('config.deleteAllBookmarksTypePrompt', `Type ${confirmToken} to confirm deleting all bookmarks:`);
            const inputLabel = tx('config.deleteAllBookmarksTypeLabel', 'Confirmation text');
            const confirmLabel = tx('config.deleteAllBookmarksTypeConfirm', 'Confirm deletion');
            const cancelLabel = tx('config.cancel', 'Cancel');
            window.AppModal.show({
                title: tx('config.deleteAllBookmarksTypeTitle', 'Final confirmation'),
                htmlMessage: `
                    <p>${typePromptText}</p>
                    <input id="delete-all-bookmarks-confirm-input" class="modal-select" type="text" autocomplete="off" spellcheck="false" aria-label="${inputLabel}" />
                `,
                confirmText: confirmLabel,
                cancelText: cancelLabel,
                confirmClass: 'danger',
                onConfirm: () => {
                    const input = document.getElementById('delete-all-bookmarks-confirm-input');
                    resolve(input ? input.value : '');
                },
                onCancel: () => resolve(null)
            });
            setTimeout(() => {
                const input = document.getElementById('delete-all-bookmarks-confirm-input');
                if (input) {
                    input.focus();
                    input.select();
                }
            }, 80);
        });
        if (typedToken === null) {
            return;
        }
        if (String(typedToken).trim().toUpperCase() !== confirmToken) {
            this.c.ui.showNotification(
                tx('config.deleteAllBookmarksTypeMismatch', 'Deletion cancelled: confirmation text did not match.'),
                'warning'
            );
            return;
        }

        const deleteBtn = document.getElementById('delete-all-bookmarks-btn');
        const originalLabel = deleteBtn?.textContent;
        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.textContent = tx('config.deleteAllBookmarksDeleting', 'Deleting…');
        }

        try {
            const response = await fetch('/api/bookmarks/delete-all', {
                method: 'POST',
                headers: nextDashWriteHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ confirm: true }),
            });
            if (!response.ok) throw new Error('Delete all bookmarks failed');
        } catch (error) {
            console.error('Error deleting all bookmarks:', error);
            this.c.ui.showNotification(tx('config.errorSavingConfig', 'Error saving configuration'), 'error');
            if (deleteBtn) {
                deleteBtn.disabled = false;
                deleteBtn.textContent = originalLabel;
            }
            return;
        }

        this.c.ui.showNotification(
            tx('config.deleteAllBookmarksDone', 'All bookmarks deleted.'),
            'success'
        );
        this.c.isNavigatingAway = true;
        setTimeout(() => { window.location.href = '/'; }, 1000);
    }

    installPublicMethods() {
        const c = this.config;
        c.resetToDefaults = (...args) => this.resetToDefaults(...args);
        c.deleteAllBookmarks = (...args) => this.deleteAllBookmarks(...args);
    }
}

window.ConfigResetController = ConfigResetController;
