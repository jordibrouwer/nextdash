class Modal {
    constructor(language = null) {
        this.language = language;
        this._mouseDownTarget = null;
        this.focusTrapHandler = null;
        this.previouslyFocusedElement = null;
        this.activeModalClasses = [];
        this.previousModalStyles = null;
        this.createModalHTML();
        this.setupEventListeners();
    }

    createModalHTML() {
        if (document.getElementById('app-modal')) {
            this.modal = document.getElementById('app-modal');
            this.modalPanel = this.modal.querySelector('.modal');
            this.ensureModalStructure();
            return;
        }

        const modalHTML = `
            <div id="app-modal" class="modal-overlay" role="presentation">
                <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
                    <div class="modal-header">
                        <span class="modal-title" id="modal-title"></span>
                    </div>
                    <div class="modal-body">
                        <div class="modal-text" id="modal-text"></div>
                    </div>
                    <div class="modal-actions" id="modal-actions">
                    </div>
                    <div class="modal-esc-hint" id="modal-esc-hint" aria-hidden="true"></div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.modal = document.getElementById('app-modal');
        this.modalPanel = this.modal.querySelector('.modal');
        this.modal.setAttribute('aria-hidden', 'true');
    }

    ensureModalStructure() {
        if (!document.getElementById('app-modal')) {
            this.createModalHTML();
            return;
        }

        this.modal = document.getElementById('app-modal');
        this.modalPanel = this.modal.querySelector('.modal');
        if (!this.modalPanel) {
            this.modal.remove();
            this.activeModalClasses = [];
            this.createModalHTML();
            return;
        }

        if (!this.modalPanel.querySelector('.modal-header')) {
            const header = document.createElement('div');
            header.className = 'modal-header';
            header.innerHTML = '<span class="modal-title" id="modal-title"></span>';
            this.modalPanel.insertBefore(header, this.modalPanel.firstChild);
        } else if (!document.getElementById('modal-title')) {
            const title = document.createElement('span');
            title.className = 'modal-title';
            title.id = 'modal-title';
            this.modalPanel.querySelector('.modal-header')?.appendChild(title);
        }

        let body = this.modalPanel.querySelector('.modal-body');
        if (!body) {
            body = document.createElement('div');
            body.className = 'modal-body';
            const actions = this.modalPanel.querySelector('.modal-actions');
            this.modalPanel.insertBefore(body, actions || null);
        }

        if (!document.getElementById('modal-text')) {
            const text = document.createElement('div');
            text.className = 'modal-text';
            text.id = 'modal-text';
            body.appendChild(text);
        }

        if (!document.getElementById('modal-actions')) {
            const actions = document.createElement('div');
            actions.className = 'modal-actions';
            actions.id = 'modal-actions';
            this.modalPanel.appendChild(actions);
        }

        if (!document.getElementById('modal-esc-hint')) {
            const hint = document.createElement('div');
            hint.className = 'modal-esc-hint';
            hint.id = 'modal-esc-hint';
            hint.setAttribute('aria-hidden', 'true');
            this.modalPanel.appendChild(hint);
        }
    }

    setupEventListeners() {
        if (!this.modal) {
            return;
        }
        // Close modal when clicking outside
        this.modal.addEventListener('mousedown', (e) => {
            this._mouseDownTarget = e.target;
        });

        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal && this._mouseDownTarget === this.modal) {
                this.hide();
            }
        });

        // Close modal with Escape key and implement focus trap
        this.focusTrapHandler = (e) => {
            if (this.modal && this.modal.classList.contains('show')) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.hide();
                    return;
                }
                if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') {
                    // Config command palette handles Enter on its filter input (list selection).
                    if (this.modalPanel?.classList.contains('config-command-palette-modal')) {
                        return;
                    }
                    // Do not auto-confirm from arbitrary modal inputs (accidental submit risk).
                    return;
                }
                if (e.key === 'Tab') {
                    this.handleTabKey(e);
                }
            }
        };
        
        document.addEventListener('keydown', this.focusTrapHandler);
    }

    _setBackgroundInert() {
        window.FocusTrapUtils?.syncDashboardInert?.();
    }

    handleTabKey(e) {
        if (window.FocusTrapUtils?.trapTabKey(e, this.modalPanel || this.modal)) {
            return;
        }
    }

    _t(key, fallback) {
        if (!this.language) return fallback;
        const val = this.language.t(key);
        return val !== key ? val : fallback;
    }

    show(options) {
        const {
            title = this._t('dashboard.confirmTitle', 'Confirm'),
            message = this._t('dashboard.confirmMessage', 'Are you sure?'),
            htmlMessage = null,
            confirmText = this._t('dashboard.confirmTitle', 'Confirm'),
            cancelText = this._t('dashboard.cancel', 'Cancel'),
            confirmClass = '',
            onConfirm = () => {},
            onCancel = () => {},
            showCancel = true,
            modalClass = '',
            modalMaxWidth = '',
            modalWidth = '',
            initialFocusSelector = null,
            onHide = null
        } = options;

        this.ensureModalStructure();

        this._onHideCallback = typeof onHide === 'function' ? onHide : null;

        const titleEl = document.getElementById('modal-title');
        const textEl = document.getElementById('modal-text');
        const actionsContainer = document.getElementById('modal-actions');
        if (!titleEl || !textEl || !actionsContainer) {
            return;
        }

        // Set content
        titleEl.textContent = title;
        if (htmlMessage !== null) {
            textEl.innerHTML = htmlMessage;
        } else {
            textEl.textContent = message;
        }

        // Clear and set actions
        actionsContainer.innerHTML = '';

        // Confirm button (styled like search matches)
        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.className = `modal-button ${confirmClass}`;
        const confirmName = document.createElement('span');
        confirmName.className = 'modal-button-name';
        confirmName.textContent = confirmText;
        confirmButton.appendChild(confirmName);
        confirmButton.onclick = () => {
            this.hide();
            onConfirm();
        };
        actionsContainer.appendChild(confirmButton);

        // Cancel button
        if (showCancel) {
            const cancelButton = document.createElement('button');
            cancelButton.type = 'button';
            cancelButton.className = 'modal-button';
            const cancelName = document.createElement('span');
            cancelName.className = 'modal-button-name';
            cancelName.textContent = cancelText;
            cancelButton.appendChild(cancelName);
            cancelButton.onclick = () => {
                this.hide();
                onCancel();
            };
            actionsContainer.appendChild(cancelButton);
        }

        // ESC hint
        const escHintEl = document.getElementById('modal-esc-hint');
        if (escHintEl) {
            const hintText = this._t('dashboard.escToClose', 'to close');
            escHintEl.innerHTML = `<kbd>ESC</kbd> ${hintText}`;
        }

        // Show modal
        if (this.activeModalClasses.length > 0) {
            this.modalPanel.classList.remove(...this.activeModalClasses);
        }
        this.activeModalClasses = modalClass ? modalClass.split(/\s+/).filter(Boolean) : [];
        if (this.activeModalClasses.length > 0) {
            this.modalPanel.classList.add(...this.activeModalClasses);
        }
        if (window.MobileExperience?.isMobileLayout?.()) {
            this.modalPanel.classList.add('modal--mobile-sheet');
        } else {
            this.modalPanel.classList.remove('modal--mobile-sheet');
        }

        this.previousModalStyles = {
            maxWidth: this.modalPanel.style.maxWidth,
            width: this.modalPanel.style.width
        };
        if (modalMaxWidth) {
            this.modalPanel.style.maxWidth = modalMaxWidth;
        }
        if (modalWidth) {
            this.modalPanel.style.width = modalWidth;
        }

        this.modal.classList.add('show');
        this.modal.setAttribute('aria-hidden', 'false');
        this._setBackgroundInert();
        
        // Store the element that triggered the modal so we can return focus
        this.previouslyFocusedElement = document.activeElement;
        
        // Prevent body scroll
        this.previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        
        // Prevent scroll events
        this.preventScrollHandler = (e) => {
            if (e.target.closest('.modal')) return;
            e.preventDefault();
        };
        document.body.addEventListener('touchmove', this.preventScrollHandler, { passive: false });
        document.body.addEventListener('wheel', this.preventScrollHandler, { passive: false });
        
        // Focus initial element or confirm button for keyboard navigation
        setTimeout(() => {
            if (initialFocusSelector) {
                const initialEl = this.modal.querySelector(initialFocusSelector);
                if (initialEl && typeof initialEl.focus === 'function') {
                    initialEl.focus();
                    if (typeof initialEl.setSelectionRange === 'function' && typeof initialEl.value === 'string') {
                        const len = initialEl.value.length;
                        initialEl.setSelectionRange(len, len);
                    }
                    return;
                }
            }
            const panel = this.modalPanel || this.modal;
            const focusable = window.FocusTrapUtils?.getFocusableElements?.(panel) || [];
            const target = focusable[0] || confirmButton;
            if (target && typeof target.focus === 'function') {
                target.focus({ preventScroll: true });
            }
        }, 100);
    }

    hide() {
        if (typeof this._onHideCallback === 'function') {
            const callback = this._onHideCallback;
            this._onHideCallback = null;
            callback();
        }

        // Move focus out of the modal before hiding it. Setting aria-hidden
        // while a descendant still holds focus triggers a Chrome console
        // warning (focus must not be hidden from assistive tech).
        const opener = this.previouslyFocusedElement;
        this.previouslyFocusedElement = null;
        if (this.modal && this.modal.contains(document.activeElement)) {
            if (window.FocusTrapUtils?.focusIfConnected) {
                window.FocusTrapUtils.focusIfConnected(opener);
            } else if (opener?.isConnected && typeof opener.focus === 'function') {
                opener.focus({ preventScroll: true });
            }
            // The opener may not accept focus (e.g. <body> without tabindex),
            // in which case focus stays on the modal descendant — blur it so
            // nothing focused remains inside the aria-hidden overlay.
            if (this.modal.contains(document.activeElement)
                && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
            }
        }

        if (this.modal) {
            this.modal.classList.remove('show');
            this.modal.setAttribute('aria-hidden', 'true');
            this._setBackgroundInert();
            if (this.activeModalClasses.length > 0) {
                this.modalPanel.classList.remove(...this.activeModalClasses);
            }
            this.activeModalClasses = [];
            this.modalPanel.classList.remove('modal--mobile-sheet');

            if (this.previousModalStyles) {
                this.modalPanel.style.maxWidth = this.previousModalStyles.maxWidth;
                this.modalPanel.style.width = this.previousModalStyles.width;
                this.previousModalStyles = null;
            }
        }
        // Restore body scroll
        document.body.style.overflow = this.previousOverflow || '';
        
        // Remove scroll prevention
        if (this.preventScrollHandler) {
            document.body.removeEventListener('touchmove', this.preventScrollHandler);
            document.body.removeEventListener('wheel', this.preventScrollHandler);
        }
        
        // Return focus to the element that triggered the modal. When focus was
        // inside the modal we already restored it synchronously above; this
        // re-affirms it after the DOM settles (and covers openers that were not
        // focused at hide time).
        if (window.FocusTrapUtils?.focusIfConnected) {
            setTimeout(() => {
                window.FocusTrapUtils.focusIfConnected(opener);
            }, 0);
        } else if (opener?.isConnected && typeof opener.focus === 'function') {
            setTimeout(() => {
                opener.focus({ preventScroll: true });
            }, 0);
        }
    }

    // Convenience methods for common modal types
    confirm(options) {
        return new Promise((resolve) => {
            this.show({
                ...options,
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false)
            });
        });
    }

    alert(options) {
        return new Promise((resolve) => {
            this.show({
                ...options,
                showCancel: false,
                confirmText: options.confirmText || this._t('dashboard.ok', 'OK'),
                onConfirm: () => resolve(true)
            });
        });
    }

    danger(options) {
        return this.confirm({
            ...options,
            confirmClass: 'danger'
        });
    }

    // Method to update language after initialization
    setLanguage(language) {
        this.language = language;
    }
}

// Create global modal instance
window.AppModal = new Modal();